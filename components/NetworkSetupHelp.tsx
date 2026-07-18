// Per-wallet network-setup hints shown at the bottom of each section in
// the wallet connect modal. Keeps users from getting stuck after install:
//   - EVM: Rome Marcus is added via wallet_addEthereumChain on connect, so
//     users rarely need to do anything. We surface that fact so it doesn't
//     feel invisible, plus the chain params for manual fallback.
//   - Solana: Marcus runs on Solana Devnet. Wallets default to mainnet,
//     so balances don't show until the user switches — and the switch path
//     is different for every wallet.

import { useState } from "react";
import { ChevronDownIcon } from "@heroicons/react/20/solid";
import { useRomeBridgeChain } from "@/hooks/useRomeBridgeChain";

type WalletKind = "evm" | "solana";

interface Props {
  kind: WalletKind;
}

const SOLANA_WALLET_STEPS: Array<{ wallet: string; steps: string }> = [
  {
    wallet: "Phantom",
    steps: "Settings → Developer Settings → Testnet Mode → Solana Devnet",
  },
  {
    wallet: "Solflare",
    steps: "Settings → Network → Devnet",
  },
  {
    wallet: "Backpack",
    steps:
      "Wallet Settings (top-right) → RPC Connection → Custom → paste https://api.devnet.solana.com/",
  },
];

export const NetworkSetupHelp = ({ kind }: Props) => {
  const [open, setOpen] = useState(false);
  const { chainId: romeChainId, chain: romeChain } = useRomeBridgeChain();

  // EVM chain params come from the active chain config — name, RPC,
  // chain id all flow from /api/chains so the help text stays correct
  // for whichever Rome chain the user is on (Marcus on devnet, mainnet
  // chain on prod, etc.). Falls back to placeholder when chain config
  // hasn't loaded yet (modal is interactive immediately on mount).
  const evmChainParams = romeChain
    ? {
        name: romeChain.name,
        chainId: romeChain.chainId,
        chainIdHex: "0x" + romeChainId.toString(16).toUpperCase(),
        rpcUrl: romeChain.rpcUrl,
        currency: romeChain.nativeCurrency?.symbol ?? "—",
        decimals: romeChain.nativeCurrency?.decimals ?? 18,
      }
    : null;

  const heading =
    kind === "evm"
      ? `${romeChain?.name ?? "Rome"} network`
      : "Rome runs on Solana";
  const summary =
    kind === "evm"
      ? "Added to your wallet automatically when you connect. Approve the prompt."
      : "Switch your Solana wallet to the right cluster so balances and transactions show up.";

  const codeStyle: React.CSSProperties = { fontFamily: "var(--font-mono)", color: "var(--fg1)" };
  return (
    <div style={{ marginTop: 12, borderRadius: "var(--r-md)", border: "1px solid var(--border-subtle)", background: "var(--bg-surface-2)", fontSize: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", textAlign: "left", cursor: "pointer", background: "transparent", border: "none" }}
      >
        <div>
          <div style={{ fontWeight: 500, color: "var(--fg1)" }}>{heading}</div>
          <div style={{ color: "var(--fg2)", marginTop: 2 }}>{summary}</div>
        </div>
        <ChevronDownIcon
          style={{ width: 16, height: 16, color: "var(--fg2)", transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "none", flexShrink: 0 }}
        />
      </button>
      {open ? (
        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "8px 12px", color: "var(--fg2)", display: "flex", flexDirection: "column", gap: 8 }}>
          {kind === "evm" ? (
            <>
              <p style={{ margin: 0 }}>
                If your wallet doesn&apos;t prompt, you can add{" "}
                {evmChainParams?.name ?? "the Rome network"} manually under its Networks/RPC settings:
              </p>
              {evmChainParams ? (
                <ul style={{ paddingLeft: 16, margin: 0, display: "flex", flexDirection: "column", gap: 2, listStyle: "disc" }}>
                  <li>Network name: <span style={{ fontWeight: 500, color: "var(--fg1)" }}>{evmChainParams.name}</span></li>
                  <li>Chain ID: <code style={codeStyle}>{evmChainParams.chainId}</code>{" "}<span style={{ color: "var(--fg2)" }}>({evmChainParams.chainIdHex})</span></li>
                  <li>RPC URL: <code style={{ ...codeStyle, wordBreak: "break-all" }}>{evmChainParams.rpcUrl}</code></li>
                  <li>Currency: <code style={codeStyle}>{evmChainParams.currency}</code> ({evmChainParams.decimals} decimals)</li>
                </ul>
              ) : (
                <p style={{ margin: 0, color: "var(--fg2)" }}>Loading network details…</p>
              )}
            </>
          ) : (
            <>
              <p style={{ margin: 0 }}>Switch to Devnet in your wallet:</p>
              <ul style={{ paddingLeft: 16, margin: 0, display: "flex", flexDirection: "column", gap: 4, listStyle: "disc" }}>
                {SOLANA_WALLET_STEPS.map((item) => (
                  <li key={item.wallet}>
                    <span style={{ fontWeight: 500, color: "var(--fg1)" }}>{item.wallet}:</span> {item.steps}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};
