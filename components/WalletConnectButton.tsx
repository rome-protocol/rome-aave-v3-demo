"use client";

// The "Connect wallet" / address button of a page body (the header uses AccountMenu). It opens the chooser; the pill names the identity the app acts under.

import { useEffect, useState } from "react";
import { useActiveLane } from "@/hooks/useActiveLane";
import { useUniWallet } from "@/hooks/useUniWallet";

// Default rendering — matches `<ConnectButton showBalance={false} />` from
// RainbowKit (a chunky pill that toggles between "Connect wallet" and the
// shortened address). `showBalance` is accepted but ignored — the demo
// never surfaced balance in the default pill.
interface DefaultProps {
  showBalance?: boolean;
}

export function ConnectButton({ showBalance: _ }: DefaultProps = {}) {
  const active = useActiveLane();
  const wallet = useUniWallet();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const baseStyle: React.CSSProperties = {
    // colour, edge and hover come from .btn / .btn.ghost (globals.css, theme.css)
    borderRadius: "999px",
    padding: "10px 20px",
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  };

  if (!active.isConnected || !active.address) {
    return (
      <button
        type="button"
        className="btn"
        style={baseStyle}
        onClick={() => wallet.openFilteredWalletModal("all")}
      >
        Connect wallet
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn ghost"
      style={baseStyle}
      onClick={() => wallet.openFilteredWalletModal("all")}
    >
      {active.lane === "solana" && active.solanaAddress
        ? `${active.solanaAddress.slice(0, 4)}…${active.solanaAddress.slice(-4)}`
        : `${active.address.slice(0, 6)}…${active.address.slice(-4)}`}
    </button>
  );
}

