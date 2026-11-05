"use client";

// EVM / Solana split display: "EVM x · Solana y" text and a thin two-colour bar.

import type { BySide } from "@/lib/market-split";
import { sumSides } from "@/lib/market-split";

const COLORS = { evm: "var(--fg-brand)", solana: "var(--hf-safe)", other: "var(--fg3)" } as const;

export const SplitBar = ({ v }: { v: BySide<number> }) => {
  const t = sumSides(v);
  if (t <= 0) return null;
  return (
    <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", background: "var(--bg-surface-3)", minWidth: 120 }}>
      {(["evm", "solana", "other"] as const).map((k) => (v[k] > 0 ? <div key={k} style={{ width: `${(v[k] / t) * 100}%`, background: COLORS[k] }} /> : null))}
    </div>
  );
};

export const SplitText = ({ v, f }: { v: BySide<number>; f: (n: number) => string }) => (
  <span className="split" style={{ fontSize: 11, color: "var(--fg2)", display: "block" }}>
    <span style={{ whiteSpace: "nowrap" }}><span style={{ color: COLORS.evm }}>EVM</span> {f(v.evm)}</span>
    <span className="split-sep"> · </span>
    <span style={{ whiteSpace: "nowrap" }}><span style={{ color: COLORS.solana }}>Solana</span> {f(v.solana)}</span>
    {v.other >= 0.01 ? <><span className="split-sep"> · </span><span style={{ whiteSpace: "nowrap" }}>Other {f(v.other)}</span></> : null} {/* only real dust (under one cent) stays hidden */}
  </span>
);
