import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionManager } from "./sessionManager";

const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;

beforeEach(() => {
  store.clear();
  g.window = {};
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
afterEach(() => {
  delete g.window;
  delete g.localStorage;
});

describe("sessionManager.ensureSession", () => {
  it("starts a session when none exists, so a reconnected wallet is not idle-disconnected", () => {
    expect(sessionManager.isValid()).toBe(false);
    sessionManager.ensureSession();
    expect(sessionManager.isValid()).toBe(true);
  });

  it("replaces an expired session (refresh after the idle timeout)", () => {
    const old = (Date.now() - 31 * 60 * 1000).toString();
    store.set("wallet_connected_at", old);
    store.set("wallet_last_activity", old);
    expect(sessionManager.isValid()).toBe(false);
    sessionManager.ensureSession();
    expect(sessionManager.isValid()).toBe(true);
  });

  it("leaves a valid session untouched, so the 24h cap keeps counting", () => {
    const connectedAt = (Date.now() - 60 * 60 * 1000).toString();
    store.set("wallet_connected_at", connectedAt);
    store.set("wallet_last_activity", Date.now().toString());
    sessionManager.ensureSession();
    expect(store.get("wallet_connected_at")).toBe(connectedAt);
  });

  it("does nothing on the server", () => {
    delete g.window;
    expect(() => sessionManager.ensureSession()).not.toThrow();
    expect(store.size).toBe(0);
  });
});
