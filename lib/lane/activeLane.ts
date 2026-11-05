// One identity at a time. Both wallets reconnect silently on mount (wagmi's
// reconnectOnMount, the Solana adapter's autoConnect), so "both connected" is
// reachable with nobody touching a control. The decision therefore lives in
// ONE pure function the provider applies on every change — never in the click
// handlers, and never derived from whichever lane happened to reconnect first.

export type Lane = "evm" | "solana";

export interface LaneConnections {
  evmConnected: boolean;
  solanaConnected: boolean;
}

export interface LaneDecision {
  /** The identity the app acts under, or null when a click must resolve it. */
  active: Lane | null;
  /** The wallet whose live session must be dropped so it cannot be mistaken for the active one. */
  evict: Lane | null;
}

/**
 * - one connected → it is active, regardless of the stored preference (a stale
 *   preference must never hide the wallet that IS connected);
 * - both connected + a preference → the preference wins and the other is evicted;
 * - both connected + no preference → nothing is active and nothing is evicted:
 *   picking a side would guess which identity the visitor intends to act under.
 */
export function decideActiveLane(c: LaneConnections, preferred: Lane | null): LaneDecision {
  if (c.evmConnected && !c.solanaConnected) return { active: "evm", evict: null };
  if (c.solanaConnected && !c.evmConnected) return { active: "solana", evict: null };
  if (!c.evmConnected && !c.solanaConnected) return { active: null, evict: null };
  if (preferred === "evm") return { active: "evm", evict: "solana" };
  if (preferred === "solana") return { active: "solana", evict: "evm" };
  return { active: null, evict: null };
}
