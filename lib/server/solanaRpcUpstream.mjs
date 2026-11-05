// The Solana RPC the same-origin /api/solana-rpc forwarder and the token service read through: SOLANA_RPC_UPSTREAM when set, else the
// default in the chain config (lib/hadrian-chain.json, solana.rpc). The default is configuration, not code, so a build can ship another.
// No Next.js imports.
export function solanaRpcUpstream(env, chain) {
  return env.SOLANA_RPC_UPSTREAM || chain.solana.rpc;
}
