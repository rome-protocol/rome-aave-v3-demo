// rome-via API client. The block explorer at https://via-<chain>.../api/v1
// indexes the Rome EVM → Solana mapping that the Rome JSON-RPC doesn't
// surface directly. We use it for one specific need today: pulling the
// real Solana signature list behind a given EVM tx hash so /history can
// render a per-tx Solana timeline.

export interface ViaSolanaLeg {
  solChain: string;     // "mainnet" | "devnet" | "testnet"
  solSignature: string; // base58
}

export interface ViaTx {
  hash: string;
  status: "success" | "pending" | "failed";
  type: "Rhea" | "Remus" | "Romulus";
  method?: string;
  from: string;
  to?: string;
  value: string;
  gasUsed: string;
  blockNumber: number;
  timestamp: string;
  solanaLegs?: ViaSolanaLeg[];
}

/** Fetch an EVM tx record from rome-via. Returns null on 404 / 5xx. */
export async function fetchViaTx(baseUrl: string, txHash: string): Promise<ViaTx | null> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) return null;
  const url = `${baseUrl.replace(/\/$/, "")}/txs/${txHash}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    // rome-via returns 404 for unknown / pre-indexed txs; treat as
    // "no data yet" rather than an error.
    return null;
  }
  return (await res.json()) as ViaTx;
}
