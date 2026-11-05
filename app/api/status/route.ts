// /api/status — data-path health for ops: RPC reachable, oracle readable,
// and how far the history and at-risk indexers have scanned. Separate from
// /api/health, which stays the liveness probe. Failures are
// reported as short flags only; detail goes to the server log.

import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { getAaveDeployment, getChain, DEFAULT_CHAIN_ID } from "@/lib/registry-config";
import { getHistoryLastScannedBlock } from "@/lib/history-indexer";
import { getAtRiskLastScannedBlock } from "@/lib/at-risk-indexer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ORACLE_ABI = parseAbi(["function getAssetPrice(address asset) view returns (uint256)"]);
const PROVIDER_ABI = parseAbi(["function getPriceOracle() view returns (address)"]);

export async function GET() {
  const chainId = DEFAULT_CHAIN_ID;
  const chain = getChain(chainId);
  const dep = getAaveDeployment(chainId);
  let latestBlock: string | null = null;
  let oracleReadable = false;

  if (chain && dep) {
    const client = createPublicClient({ transport: http(chain.rpcUrl) });
    try {
      latestBlock = (await client.getBlockNumber()).toString();
    } catch (err) {
      console.error("[/api/status] block number", err instanceof Error ? err.message : String(err));
    }
    try {
      // The pool's oracle is whatever the provider returns now: the market can switch oracle contracts
      // (AaveOracle -> RomePriceOracle) without a config change, so the config's address is not trusted here.
      const oracle = await client.readContract({
        address: dep.addressesProvider as Address,
        abi: PROVIDER_ABI,
        functionName: "getPriceOracle",
      });
      const price = await client.readContract({
        address: oracle,
        abi: ORACLE_ABI,
        functionName: "getAssetPrice",
        args: [dep.reserves[0].underlying as Address],
      });
      oracleReadable = price > 0n;
    } catch (err) {
      console.error("[/api/status] oracle", err instanceof Error ? err.message : String(err));
    }
  }

  const ok = latestBlock !== null && oracleReadable;
  return NextResponse.json(
    {
      ok,
      chainId,
      latestBlock,
      oracleReadable,
      historyScannedBlock: getHistoryLastScannedBlock(chainId).toString(),
      atRiskScannedBlock: getAtRiskLastScannedBlock(chainId).toString(),
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
