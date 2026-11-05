// What an asset is called on screen, by lane: when the user is supplying with the Solana wallet, it is just SOL, not
// "Rome SOL". A Solana wallet sees the Solana identity the token service read for the mint; an EVM wallet, or none, keeps the wrapper's own words.
import type { TokenIdentity } from "@/lib/tokenIdentity";

export interface Shown { symbol: string; name: string }

/** The words to show for an asset. A Solana wallet never sees the wrapper's name: while the mint is unread, when the read failed, or when the service found
 * no symbol ("none"), it sees the reserve's symbol alone, and the name is added only once the service returns one. */
export function shownIdentity(lane: "evm" | "solana" | null, id: TokenIdentity | null, wrapper: Shown): Shown {
  if (lane !== "solana") return wrapper;
  if (!id || id.source === "none" || !id.symbol) return { symbol: wrapper.symbol, name: "" };
  return { symbol: id.symbol, name: id.name || "" };
}
