// The chain the token service reads for: the app's one chain, with its registry folder and the Solana RPC its /api/solana-rpc forwards to.
import { DEFAULT_CHAIN_ID, getAaveDeployment, getChain } from "@/lib/registry-config";
import hadrianChain from "@/lib/hadrian-chain.json";

export function tokenChain() {
  const slug = getAaveDeployment(DEFAULT_CHAIN_ID)?.chainSlug;
  return {
    chainId: String(DEFAULT_CHAIN_ID),
    name: getChain(DEFAULT_CHAIN_ID)?.name ?? "",
    // The registry folder is <chainId>-<slug> ("200010-hadrian"); the chain's display name is not the slug.
    registryDir: slug ? `${DEFAULT_CHAIN_ID}-${slug}` : undefined,
    solanaRpc: process.env.SOLANA_RPC_UPSTREAM ?? hadrianChain.solana.rpc,
  };
}
