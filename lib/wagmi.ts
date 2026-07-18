// Wagmi config for the Aave-on-Rome demo. Chain metadata comes from the
// vendored registry chain.json (lib/hadrian-chain.json) so there's zero
// hardcoding — same pattern as the Rome web app's /api/chains discovery, scaled
// down to one chain since this demo is Aave-on-Hadrian-specific.
//
// The RPC transport routes through the same-origin /api/rome-rpc proxy
// to bypass the Rome RPC's CORS gap (the Rome web app calls it /api/rome-proxy).

import { createConfig, http } from "wagmi";
import { defineChain } from "viem";
import { getChain, DEFAULT_CHAIN_ID } from "@/lib/registry-config";
import { injected, walletConnect } from "wagmi/connectors";

const chainEntry = getChain(DEFAULT_CHAIN_ID)!;

export const hadrian = defineChain({
  id: chainEntry.chainId,
  name: chainEntry.name,
  nativeCurrency: chainEntry.nativeCurrency,
  rpcUrls: { default: { http: [chainEntry.rpcUrl] } },
  blockExplorers: { default: { name: `${chainEntry.name} Explorer`, url: chainEntry.explorerUrl } },
});

// WalletConnect projectId is optional. Without it we still get every
// injected EIP-1193 wallet (MetaMask, Rabby, Brave). Drop a real id into
// NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable the QR-code path.
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [hadrian],
  transports: {
    [hadrian.id]: http("/api/rome-rpc"),
  },
  connectors: [
    injected(),
    ...(walletConnectProjectId
      ? [walletConnect({ projectId: walletConnectProjectId, showQrModal: false })]
      : []),
  ],
  ssr: true,
});
