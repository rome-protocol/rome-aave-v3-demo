// The network-setup hint at the bottom of the Solana section of the wallet chooser. The app runs on Solana's test network; wallets default to
// mainnet, so balances don't show until the user switches, and the switch path is different for every wallet.
// (An EVM wallet needs no hint: the network is added by the wallet's own prompt on connect.)

import { useState } from "react";
import { ChevronDownIcon } from "@heroicons/react/20/solid";

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

export const NetworkSetupHelp = () => {
  const [open, setOpen] = useState(false);

  const summary = "Switch your Solana wallet to its test network so balances show.";
  return (
    <div style={{ marginTop: 12, borderRadius: "var(--r-md)", border: "1px solid var(--border-subtle)", background: "var(--bg-surface-2)", fontSize: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", textAlign: "left", cursor: "pointer", background: "transparent", border: "none" }}
      >
        <div>
          <div style={{ fontWeight: 500, color: "var(--fg1)" }}>Rome runs on Solana</div>
          <div style={{ color: "var(--fg2)", marginTop: 2 }}>{summary}</div>
        </div>
        <ChevronDownIcon
          style={{ width: 16, height: 16, color: "var(--fg2)", transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "none", flexShrink: 0 }}
        />
      </button>
      {open ? (
        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "8px 12px", color: "var(--fg2)", display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0 }}>Switch your wallet to the Solana test network:</p>
          <ul style={{ paddingLeft: 16, margin: 0, display: "flex", flexDirection: "column", gap: 4, listStyle: "disc" }}>
            {SOLANA_WALLET_STEPS.map((item) => (
              <li key={item.wallet}>
                <span style={{ fontWeight: 500, color: "var(--fg1)" }}>{item.wallet}:</span> {item.steps}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};
