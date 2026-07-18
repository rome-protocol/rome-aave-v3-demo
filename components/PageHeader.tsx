"use client";

// Sticky page header. usePathname drives the active-nav highlight,
// RainbowKit's ConnectButton.Custom drives the wallet pill (matches
// the Rome web app's Header.WalletChip shape), and the chain pill is read-only
// for v1 (one chain — Hadrian).

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/WalletConnectButton";
import { useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { hadrian } from "@/lib/wagmi";
import { Button, Container, HealthFactorPill } from "@/components/primitives";
import { fmt } from "@/lib/format";
import {
  IconAlert,
  IconClose,
  IconMenu,
  IconWallet,
  IconWarn,
} from "@/components/icons";
import { ETHIcon } from "@/components/icons";
import { useTheme } from "@/hooks/useTheme";
import type { ChainInfo } from "@/lib/types";

interface NavItem { href: string; label: string }

const NAV_ITEMS: NavItem[] = [
  { href: "/",          label: "Markets" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/liquidate", label: "Liquidate" },
  { href: "/flashloan", label: "Flash Loan" },
  { href: "/history",   label: "History" },
  { href: "/faucet",    label: "Faucet" },
];

export const ChainStatusDot = ({ status }: { status: ChainInfo["status"] }) => {
  const c = status === "live" ? "var(--hf-safe)" : status === "degraded" ? "var(--hf-warn)" : "var(--hf-danger)";
  return <span style={{ width: 7, height: 7, borderRadius: 7, background: c, boxShadow: `0 0 6px ${c}` }} />;
};

export const PageHeader = ({
  chain,
  hf,
}: {
  chain: ChainInfo;
  hf?: number | null;
}) => {
  const pathname = usePathname();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { theme, toggle: onToggleTheme } = useTheme();

  const [mobileOpen, setMobileOpen] = useState(false);

  const logomark = theme === "light" ? "/assets/logomark-purple.svg" : "/assets/logomark-white.svg";
  const wordmark = theme === "light" ? "/assets/wordmark-purple.svg" : "/assets/wordmark-white.svg";

  const onWrongChain = walletChainId !== 0 && walletChainId !== chain.chainId;

  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 30,
      background: "var(--header-bg)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      borderBottom: "1px solid var(--border-subtle)",
    }}>
      <Container max={1320}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          padding: "14px 0",
          minHeight: 72,
        }}>
          {/* Brand */}
          <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <img src={logomark} alt="Rome" style={{ display: "block", height: 30, width: "auto" }} />
            <img src={wordmark} alt="Rome" style={{ display: "block", height: 30, width: "auto" }} />
            <span className="mono" style={{
              marginLeft: 10, fontSize: 10, color: "var(--fg2)",
              letterSpacing: "0.12em", textTransform: "uppercase",
              padding: "5px 8px", background: "var(--bg-surface-2)",
              borderRadius: "var(--r-sm)", fontWeight: 500,
            }}>Aave V3</span>
          </Link>

          {/* Desktop nav */}
          <nav style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 16 }} className="desktop-nav">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link key={item.href} href={item.href}
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 13,
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? "var(--fg1)" : "var(--fg2)",
                    textDecoration: "none",
                    padding: "8px 14px",
                    borderRadius: "var(--r-pill)",
                    background: isActive ? "rgba(197, 139, 198, 0.10)" : "transparent",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}>
                  {isActive ? <span style={{ width: 5, height: 5, borderRadius: 5, background: "var(--rome-purple-tint)" }} /> : null}
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div style={{ flex: 1 }} />

          {/* Sticky HF pill */}
          {hf != null && hf !== Infinity ? (
            <Link href="/dashboard" style={{ textDecoration: "none" }} title="View health factor">
              <HealthFactorPill hf={hf} size="sm" showLabel={false} />
            </Link>
          ) : null}

          {/* Theme toggle (optional — only renders when handler provided) */}
          {onToggleTheme ? (
            <button onClick={onToggleTheme}
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              aria-label="Toggle theme"
              style={{
                background: "transparent",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--r-pill)",
                width: 32, height: 32,
                color: "var(--fg2)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
              }}>
              {theme === "light" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                </svg>
              )}
            </button>
          ) : null}

          {/* Chain pill (read-only for v1; one chain) */}
          <span style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--r-pill)",
            padding: "6px 12px 6px 8px",
            color: "var(--fg1)",
            fontSize: 12,
            display: "inline-flex", alignItems: "center", gap: 8,
          }}>
            <ChainStatusDot status={chain.status} />
            <span>{chain.displayName}</span>
          </span>

          {/* Wallet — shape mirrors the Rome web app Header.WalletChip:
              disconnected → primary button "Connect wallet"
              connected    → rounded-full pill [ETH glyph] [0xabcd…1234] [✕] */}
          <ConnectButton.Custom>
            {({ account, chain: rkChain, openConnectModal, openChainModal, mounted }) => {
              const ready = mounted;
              const connected = ready && account && rkChain;
              if (!connected) {
                return (
                  <Button variant="primary" size="sm" onClick={openConnectModal}>
                    <IconWallet size={13} /> Connect wallet
                  </Button>
                );
              }
              if (rkChain.unsupported) {
                return (
                  <Button variant="danger" size="sm" onClick={openChainModal}>
                    Wrong network
                  </Button>
                );
              }
              return <WalletChip addr={account.address} />;
            }}
          </ConnectButton.Custom>

          {/* Mobile menu trigger */}
          <button onClick={() => setMobileOpen(true)} className="mobile-nav-trigger"
            style={{ background: "transparent", border: "1px solid var(--border-default)", borderRadius: "var(--r-pill)", padding: 8, color: "var(--fg1)", display: "none", cursor: "pointer" }}>
            <IconMenu size={16} />
          </button>
        </div>
      </Container>

      {/* Liquidatable banner */}
      {hf != null && hf < 1 && hf !== Infinity ? (
        <div style={{ background: "var(--hf-danger)", color: "var(--on-danger)" }}>
          <Container max={1320}>
            <div style={{ padding: "10px 0", display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 500 }}>
              <IconWarn size={16} />
              Your position is liquidatable. Repay or add collateral immediately.
              <span style={{ flex: 1 }} />
              <Link href="/dashboard" style={{
                background: "transparent", border: "1px solid var(--on-danger)",
                color: "var(--on-danger)", padding: "4px 12px", borderRadius: "var(--r-pill)",
                fontSize: 12, fontWeight: 600, textDecoration: "none",
              }}>
                Open Dashboard
              </Link>
            </div>
          </Container>
        </div>
      ) : null}

      {/* Wrong chain banner */}
      {onWrongChain ? (
        <div style={{ background: "rgba(232, 160, 78, 0.10)", borderBottom: "1px solid rgba(232, 160, 78, 0.32)" }}>
          <Container max={1320}>
            <div style={{ padding: "10px 0", display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--hf-warn)" }}>
              <IconAlert size={16} />
              <span style={{ color: "var(--fg1)" }}>
                Wrong network. Switch to <b>{chain.displayName}</b> to use Rome Aave.
              </span>
              <span style={{ flex: 1 }} />
              <Button variant="secondary" size="xs" onClick={() => void switchChainAsync({ chainId: hadrian.id })}>
                Switch network
              </Button>
            </div>
          </Container>
        </div>
      ) : null}

      {mobileOpen ? <MobileMenu logomark={logomark} wordmark={wordmark} onClose={() => setMobileOpen(false)} pathname={pathname} /> : null}

      <style>{`
        @media (max-width: 1023px) {
          .desktop-nav { display: none !important; }
          .mobile-nav-trigger { display: inline-flex !important; }
        }
      `}</style>
    </header>
  );
};

// WalletChip — direct shape port of the Rome web app's Header.WalletChip:
// rounded-full pill containing [chain glyph] [0xabcd…1234] [✕]. The ✕
// disconnects (matches the Rome web app's onDisconnect={wallet.disconnectEVM}).
// Click the addr opens RainbowKit's account modal so users can switch
// wallets — the Rome web app's chip opens the WalletModal for the same purpose.
const WalletChip = ({ addr }: { addr: string }) => {
  const { disconnect } = useDisconnect();
  return (
    <ConnectButton.Custom>
      {({ openAccountModal }) => (
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px",
          borderRadius: 999,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--fg2)",
        }}>
          <ETHIcon size={20} />
          <button onClick={openAccountModal} style={{
            background: "transparent", border: "none",
            color: "var(--fg1)", padding: "0 4px",
            fontFamily: "var(--font-mono)", fontSize: 11,
            cursor: "pointer",
          }}>
            {fmt.addr(addr, 4, 4)}
          </button>
          <button
            type="button"
            aria-label="Disconnect"
            title="Disconnect"
            onClick={() => disconnect()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 20,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              color: "var(--fg3)",
              cursor: "pointer",
              padding: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-surface-2)";
              e.currentTarget.style.color = "var(--fg1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--fg3)";
            }}
          >
            <IconClose size={12} />
          </button>
        </div>
      )}
    </ConnectButton.Custom>
  );
};

const MobileMenu = ({ logomark, wordmark, onClose, pathname }: { logomark: string; wordmark: string; onClose: () => void; pathname: string | null }) => (
  <div style={{
    position: "fixed", inset: 0, zIndex: 60,
    background: "var(--bg-canvas)",
    display: "flex", flexDirection: "column",
  }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img src={logomark} alt="Rome" style={{ height: 24, width: "auto" }} />
        <img src={wordmark} alt="Rome" style={{ height: 24, width: "auto" }} />
        <span className="mono" style={{ marginLeft: 4, fontSize: 10, color: "var(--fg2)", letterSpacing: "0.12em", textTransform: "uppercase", padding: "4px 7px", background: "var(--bg-surface-2)", borderRadius: "var(--r-sm)", fontWeight: 500 }}>Aave V3</span>
      </span>
      <button onClick={onClose} style={{ background: "transparent", border: "1px solid var(--border-default)", borderRadius: "var(--r-pill)", padding: 8, color: "var(--fg1)", cursor: "pointer" }}>
        <IconClose size={16} />
      </button>
    </div>
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 4 }}>
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} onClick={onClose}
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 28,
              color: isActive ? "var(--fg1)" : "var(--fg2)",
              textDecoration: "none",
              padding: "10px 0",
              letterSpacing: "-0.01em",
              borderBottom: "1px solid var(--border-subtle)",
            }}>
            {item.label}
          </Link>
        );
      })}
    </div>
  </div>
);

// ────────────── Footer ──────────────

export const PageFooter = ({ chain }: { chain: ChainInfo }) => {
  const { theme } = useTheme();
  const logomark = theme === "light" ? "/assets/logomark-purple.svg" : "/assets/logomark-white.svg";
  const wordmark = theme === "light" ? "/assets/wordmark-purple.svg" : "/assets/wordmark-white.svg";
  return (
    <footer style={{
      marginTop: 80,
      borderTop: "1px solid var(--border-subtle)",
      padding: "32px 0 48px",
      background: "transparent",
    }}>
      <Container max={1320}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src={logomark} alt="Rome" style={{ height: 18, width: "auto" }} />
            <img src={wordmark} alt="Rome" style={{ height: 18, width: "auto", opacity: 0.9 }} />
            <span className="mono" style={{ marginLeft: 4, fontSize: 9, color: "var(--fg2)", letterSpacing: "0.12em", textTransform: "uppercase", padding: "3px 6px", background: "var(--bg-surface-2)", borderRadius: "var(--r-sm)" }}>Aave V3</span>
            <span style={{ marginLeft: 8, fontSize: 13, color: "var(--fg2)" }}>
              Solana cluster:{" "}
              <span className="mono" style={{ color: "var(--fg1)" }}>{chain.solanaCluster}</span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "var(--fg2)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ChainStatusDot status={chain.status} />
              {chain.displayName} {chain.status}
            </span>
            <a href="https://github.com/aave/aave-v3-origin" target="_blank" rel="noreferrer"
              style={{ color: "var(--fg2)", textDecoration: "none", borderBottom: "1px solid var(--border-subtle)" }}>
              GitHub ↗
            </a>
          </div>
        </div>
      </Container>
    </footer>
  );
};
