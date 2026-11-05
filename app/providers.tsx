"use client";

// Top-level client-side provider tree. Mirrors the Rome web app's _app.tsx layering:
//
//   QueryClientProvider
//    └── Solana ConnectionProvider (devnet endpoint — Hadrian's substrate)
//        └── WagmiProvider
//            └── Solana WalletProvider (wallet-adapter — adapters dormant
//                until a Solana-via-ED25519 flow lands)
//                └── Solana WalletModalProvider (context only — UI never
//                    rendered; we ship our own WalletModal)
//                    └── UniWalletProvider (our wallet selector + EVM/SOL
//                        connect state)
//                        └── ToastContainer (toast surface for connect errors)
//                            └── {children}
//
// RainbowKit is intentionally NOT in this tree. The Aave demo uses
// the Rome web app's UniWallet stack — EVM today, Solana plumbing ready for
// the ED25519 path that's already proven on Compound.

import { useMemo, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import { TrustWalletAdapter } from "@solana/wallet-adapter-trust";
import { ToastContainer } from "react-toastify";
import { wagmiConfig } from "@/lib/wagmi";
import { getChain, DEFAULT_CHAIN_ID } from "@/lib/registry-config";
import { UniWalletProvider } from "@/components/UniWalletProvider";
import { createAutoConnectOnce, readStoredSolanaWallet } from "@/utils/solanaAutoConnect";
import "react-toastify/dist/ReactToastify.css";

// Solana RPC endpoint. Defaults to the public RPC for the chain's anchored
// cluster (from the registry snapshot) — never a baked production value.
// Override per-deploy with NEXT_PUBLIC_SOLANA_RPC_URL (e.g. a Rome-managed or
// private endpoint).
const SOLANA_CLUSTER = getChain(DEFAULT_CHAIN_ID)?.solana?.cluster ?? "devnet";
const SOLANA_CLUSTER_RPC: Record<string, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
  testnet: "https://api.testnet.solana.com",
  devnet: "https://api.devnet.solana.com",
};
const SOLANA_RPC_FALLBACK =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? SOLANA_CLUSTER_RPC[SOLANA_CLUSTER] ?? SOLANA_CLUSTER_RPC.devnet;
// In the browser every Solana read/send goes through the same-origin
// forwarder (/api/solana-rpc → the chain's substrate RPC, next.config.mjs);
// the substrate RPC has the same CORS gap as the EVM RPC. web3.js needs an
// absolute URL, so the origin is added at runtime; SSR uses the fallback.
const solanaEndpoint = () =>
  typeof window !== "undefined" ? new URL("/api/solana-rpc", window.location.origin).toString() : SOLANA_RPC_FALLBACK;

export function Providers({ children }: { children: ReactNode }) {
  // QueryClient must be stable across renders but per-tree (not module-level)
  // so SSR + concurrent rendering don't share cache instances.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Aave per-reserve / per-user data changes on every tx; 10s
            // matches what /api/aave-config caches server-side.
            staleTime: 10_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  // Only the wallet stored at page load reconnects silently, once. A click in the
  // modal must not go down the same path (it would end the modal's connect early).
  const [autoConnect] = useState(() => createAutoConnectOnce(readStoredSolanaWallet()));

  // Wallet adapter instances are referentially stable across renders.
  const solanaWallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new TrustWalletAdapter(),
    ],
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={solanaEndpoint()}>
        <WagmiProvider config={wagmiConfig}>
          {/* autoConnect: re-selects the stored wallet and reconnects it silently on load
              (adapter.autoConnect(), no prompt for a trusted site). Without it the
              Solana wallet is forgotten on every refresh. Gated so a modal click is
              never auto-connected (see utils/solanaAutoConnect.ts). */}
          <WalletProvider wallets={solanaWallets} autoConnect={autoConnect}>
            <WalletModalProvider>
              <UniWalletProvider>
                {children}
                <ToastContainer autoClose={false} position="bottom-right" theme="dark" />
              </UniWalletProvider>
            </WalletModalProvider>
          </WalletProvider>
        </WagmiProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
