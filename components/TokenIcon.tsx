"use client";
// The one token mark (a square icon fills the circle; any other shape is drawn whole, never cropped). The token's real logo, read by mint and
// served from this app's own origin, and when there is none, or it has not loaded, a letter on a palette colour. The letter is drawn by CSS
// from data-letter, so it is never part of the page text. Used on every screen that shows a token.
import { useCallback, useState } from "react";
import { logoUrl, useTokenIdentity } from "@/lib/tokenIdentity";
import { markColor, markFit, markLetter } from "@/lib/tokenMark.mjs";

export function TokenIcon({ symbol, mint, size = 30, className = "" }: { symbol: string; mint?: string | null; size?: number; className?: string }) {
  const identity = useTokenIdentity(mint);
  const src = identity?.logo && mint ? logoUrl(mint) : null;
  return <Mark key={src ?? "letter"} src={src} symbol={symbol} size={size} className={className} />;
}

function Mark({ src, symbol, size, className }: { src: string | null; symbol: string; size: number; className: string }) {
  // The letter stays until the image has really loaded, and comes back if it fails: never a broken-image box.
  const [state, setState] = useState<"loading" | "ok" | "failed">(src ? "loading" : "failed");
  const [fit, setFit] = useState<"fill" | "whole">("fill");
  const showLetter = state !== "ok";
  const loaded = (img: HTMLImageElement) => { setFit(markFit(img.naturalWidth, img.naturalHeight)); setState("ok"); };
  // An image the browser already had can finish loading before React attaches onLoad.
  const ref = useCallback((img: HTMLImageElement | null) => { if (img && img.complete && img.naturalWidth > 0) loaded(img); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span
      className={`tmark c${markColor(symbol)} ${className}`.trim()}
      data-testid="token-icon"
      data-logo={state === "ok" ? "yes" : "no"}
      data-symbol={symbol}
      data-fit={state === "ok" ? fit : undefined}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
      data-letter={showLetter ? markLetter(symbol) : undefined}
      aria-hidden="true"
    >
      {src && state !== "failed" && (
        // eslint-disable-next-line @next/next/no-img-element -- the logo comes from this app's own route
        <img ref={ref} src={src} alt="" width={size} height={size} draggable={false} hidden={state !== "ok"} onLoad={(e) => loaded(e.currentTarget)} onError={() => setState("failed")} />
      )}
    </span>
  );
}
