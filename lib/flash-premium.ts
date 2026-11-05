// Flash-loan premium, read from the pool (Pool.FLASHLOAN_PREMIUM_TOTAL, in
// basis points: 9 = 0.09%). It is 0 on Hadrian today, so nothing is hard-coded.

const PremiumAbi = [
  {
    type: "function",
    name: "FLASHLOAN_PREMIUM_TOTAL",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
] as const;

interface ReadClient {
  readContract: (args: {
    address: `0x${string}`;
    abi: typeof PremiumAbi;
    functionName: "FLASHLOAN_PREMIUM_TOTAL";
  }) => Promise<bigint>;
}

/** Premium in basis points, straight from the pool. */
export async function readFlashPremiumBps(client: ReadClient, pool: `0x${string}`): Promise<number> {
  const bps = await client.readContract({ address: pool, abi: PremiumAbi, functionName: "FLASHLOAN_PREMIUM_TOTAL" });
  return Number(bps);
}

/** Premium as a fraction of the amount (9 bps -> 0.0009). */
export const premiumFraction = (bps: number): number => bps / 10_000;
