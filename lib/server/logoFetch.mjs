// The guarded reads behind the token logos, ported from another Rome app's logo service: https only, a host name (never an address or
// localhost), a host that resolves to a public address, redirects followed by hand and capped, the body cut off past a size, the image
// type read from the bytes (never from the upstream's content type). Nothing is drawn or made up here: no image, no logo.
// No Next.js imports.
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { USER_AGENT } from "./registryAuth.mjs";

/** A logo larger than this is not one: marks are a few kilobytes. */
export const LOGO_MAX_BYTES = 256 * 1024;
/** A token's metadata JSON (the file its on-chain uri names) is a few hundred bytes. */
export const JSON_MAX_BYTES = 64 * 1024;
export const FETCH_TIMEOUT_MS = 3000;
export const MAX_REDIRECTS = 3;

/** The upstream names something this service will not serve (not https, too large, a loop of redirects, a private address): a fault of the data, not an outage. */
export class Refused extends Error {}

/** The image type the bytes themselves show, or null when they are not an image this service serves. raw.githubusercontent.com serves an SVG as text/plain, so the content type is never trusted. */
export function sniffImage(bytes) {
  const at = (i, ...v) => v.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  // An SVG is XML text with an <svg> element near the top (after an XML declaration, a doctype or comments).
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 2048)).replace(/^﻿/, "");
  if (startsWithSvg(head)) return "image/svg+xml";
  return null;
}

/** Whether the text opens with an <svg> element, after any XML declaration, doctype and comments. Read in one linear pass (a single regex with a repeated group of comments backtracks without bound). */
function startsWithSvg(head) {
  let i = 0;
  for (;;) {
    while (i < head.length && /\s/.test(head[i])) i++;
    const rest = head.slice(i, i + 9).toLowerCase();
    let end;
    if (rest.startsWith("<?xml")) end = head.indexOf(">", i) + 1;
    else if (rest.startsWith("<!--")) { const j = head.indexOf("-->", i + 4); end = j < 0 ? 0 : j + 3; }
    else if (rest === "<!doctype") end = head.indexOf(">", i) + 1;
    else return /^<svg[\s>]/i.test(head.slice(i, i + 5));
    if (end === 0) return false;
    i = end;
  }
}

/** Whether a URL is one this service may fetch: https, a host name (not an address or localhost), no credentials. */
export function isLogoUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return u.protocol === "https:" && u.username === "" && u.password === "" && host.includes(".") && isIP(host) === 0 && host !== "localhost" && !host.endsWith(".localhost") && !host.endsWith(".internal") && !host.endsWith(".local");
}

/** Whether an address a host resolved to is a public one (not loopback, private, link-local, carrier-grade NAT, multicast or reserved). */
export function isPublicAddress(addr) {
  const a = String(addr).toLowerCase();
  const v4 = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const [o1, o2] = [Number(v4[1]), Number(v4[2])];
    if (o1 === 0 || o1 === 10 || o1 === 127 || o1 >= 224) return false;
    if (o1 === 169 && o2 === 254) return false;
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return false;
    if (o1 === 192 && o2 === 168) return false;
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return false;
    if (o1 === 192 && o2 === 0) return false;
    if (o1 === 198 && (o2 === 18 || o2 === 19)) return false;
    return true;
  }
  if (isIP(a) === 6) {
    if (a === "::" || a === "::1") return false;
    if (/^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a)) return false; // unique local, link-local, multicast
    return true;
  }
  return false;
}

async function checkHost(url, lookup) {
  const host = new URL(url).hostname;
  let answers;
  try { answers = await lookup(host, { all: true }); } catch { throw new Error("the host did not resolve"); }
  if (!answers.length || !answers.every((x) => isPublicAddress(x.address))) throw new Refused("the host resolves to a non-public address");
}

async function readCapped(res, maxBytes) {
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Refused("the body is too large");
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Refused("the body is too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

/**
 * Reads an absolute https URL: redirects are followed by hand, only to other https hosts (three at most), every hop's host must resolve to
 * public addresses, and the body is cut off past maxBytes. Null on a 404. Throws Refused for a fault of the data, Error for an outage.
 * @param {string} url
 * @param {{ fetch?: typeof fetch, lookup?: (host: string, opts: { all: true }) => Promise<{ address: string }[]>, maxBytes?: number, accept?: string }} [opts]
 */
export async function fetchCapped(url, opts = {}) {
  const doFetch = opts.fetch ?? fetch;
  const lookup = opts.lookup ?? dnsLookup;
  let at = url;
  for (let hop = 0; ; hop++) {
    if (!isLogoUrl(at)) throw new Refused("the URL is not an https address of a host");
    await checkHost(at, lookup);
    const res = await doFetch(at, { headers: { accept: opts.accept ?? "*/*", "user-agent": USER_AGENT }, redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next || hop >= MAX_REDIRECTS) throw new Refused("the URL redirects too far");
      at = new URL(next, at).toString();
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`the URL answered ${res.status}`);
    return readCapped(res, opts.maxBytes ?? LOGO_MAX_BYTES);
  }
}
