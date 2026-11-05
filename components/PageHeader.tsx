"use client";

// Sticky page header, in the shape of the Rome DEX's TopNav: the logo and product name, the pages, then on the right the health factor
// (when there is a position), the network (read-only: one chain) and the wallet (AccountMenu). usePathname drives the active page.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AccountMenu from "@/components/AccountMenu";
import { Tip } from "@/components/Tip";
import { useChainId, useSwitchChain } from "wagmi";
import { hadrian } from "@/lib/wagmi";
import { Button, Container, HealthFactorPill, NetworkLabel } from "@/components/primitives";
import { IconAlert, IconClose, IconMenu, IconWarn } from "@/components/icons";
import { useTheme } from "@/hooks/useTheme";
import { ThemeRow } from "@/components/Theme";
import type { ChainInfo } from "@/lib/types";
import { NETWORK_LABEL } from "@/lib/brand";

interface NavItem { href: string; label: string }

const NAV_ITEMS: NavItem[] = [
  { href: "/",          label: "Markets" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/liquidate", label: "Liquidate" },
  { href: "/flashloan", label: "Flash Loan" },
  { href: "/history",   label: "History" },
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
  const { theme } = useTheme();

  // The page menu (the DEX's TopNav menu): closes on navigation, on Escape (focus goes back to the button) and on a click outside the header.
  const [menu, setMenu] = useState(false);
  const top = useRef<HTMLElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMenu(false); }, [pathname]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); menuBtn.current?.focus(); } };
    const onPointer = (e: MouseEvent) => { if (top.current && !top.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onPointer); };
  }, [menu]);

  const logomark = theme === "light" ? "/assets/logomark-purple.svg" : "/assets/logomark-white.svg";
  const wordmark = theme === "light" ? "/assets/wordmark-purple.svg" : "/assets/wordmark-white.svg";

  const onWrongChain = walletChainId !== 0 && walletChainId !== chain.chainId;
  const showHf = hf != null && hf !== Infinity;

  return (
    <header ref={top} className={`top${showHf ? " hf" : ""}`} style={{ position: "sticky", top: 0, zIndex: 40 }}>
      <div className="thread" />
      <Container max={1320}>
        <div className={`nav hdr-row${showHf ? " has-hf" : ""}`}>
          {/* Brand: the Rome logo, a thin divider and the product name in the serif (the DEX's .mark) */}
          <Link href="/" className="mark" aria-label="Rome Aave home">
            <img src={logomark} alt="" style={{ display: "block", height: 30, width: "auto" }} />
            <img className="hdr-wordmark" src={wordmark} alt="Rome" style={{ display: "block", height: 30, width: "auto" }} />
            <span className="mark-sep" aria-hidden />
            <span className="mark-name">Aave</span>
          </Link>

          {/* Desktop nav */}
          <nav className="tabs desktop-nav" role="tablist">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link key={item.href} href={item.href} role="tab" aria-selected={isActive}
                  aria-current={isActive ? "true" : undefined}
                  style={{ whiteSpace: "nowrap" }}>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="rightnav">
            {/* Sticky HF pill */}
            {showHf ? (
              <Tip text="View health factor" place="below">
                <Link href="/dashboard" aria-label={`View health factor, ${hf.toFixed(2)}`} style={{ textDecoration: "none" }}>
                  <HealthFactorPill hf={hf} size="sm" showLabel={false} />
                </Link>
              </Tip>
            ) : null}

            {/* The network (one chain; read-only) */}
            <span className="hdr-chain wpill" style={{ borderRadius: "var(--r-pill)", padding: "6px 12px 6px 10px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <ChainStatusDot status={chain.status} />
              <NetworkLabel tag={false} />
            </span>

            {/* The wallet: Connect wallet, or the pill with its menu (the Theme choice sits in the menu, and beside Connect wallet) */}
            <AccountMenu />

            {/* The page menu button (narrow screens; the page links move into the menu panel) */}
            <div className="menu-root">
              <button ref={menuBtn} type="button" className="menu-btn" data-testid="menu-button" aria-label="Menu" aria-expanded={menu}
                aria-controls={menu ? "site-menu" : undefined} onClick={() => setMenu((m) => !m)}>
                {menu ? <IconClose size={16} /> : <IconMenu size={16} />}
              </button>
            </div>
          </div>
        </div>
        {menu && (
          <nav className="menu-panel" id="site-menu" aria-label="Pages">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} onClick={() => setMenu(false)}>{item.label}</Link>
            ))}
            <ThemeRow />
          </nav>
        )}
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
        <div style={{ background: "color-mix(in srgb, var(--warn) 12%, transparent)", borderBottom: "1px solid color-mix(in srgb, var(--warn) 40%, transparent)" }}>
          <Container max={1320}>
            <div style={{ padding: "10px 0", display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--hf-warn)" }}>
              <IconAlert size={16} />
              <span style={{ color: "var(--fg1)" }}>
                Wrong network. Switch to <b>{NETWORK_LABEL}</b>.
              </span>
              <span style={{ flex: 1 }} />
              <Button variant="secondary" size="xs" onClick={() => void switchChainAsync({ chainId: hadrian.id })}>
                Switch network
              </Button>
            </div>
          </Container>
        </div>
      ) : null}

      <style>{`
        .menu-root, .menu-panel { display: none; }
        @media (max-width: 1230px) {
          .desktop-nav, .hdr-theme { display: none !important; }
          .menu-root { display: block; }
          .menu-panel { display: flex; }
        }
        @media (max-width: 1366px) {
          .top.hf .desktop-nav, .top.hf .hdr-theme { display: none !important; }
          .top.hf .menu-root { display: block; }
          .top.hf .menu-panel { display: flex; }
        }
        .menu-panel { flex-direction: column; padding: 6px 16px 14px; border-top: 1px solid var(--line); max-height: calc(100dvh - 76px); overflow-y: auto; overscroll-behavior: contain; }
        .menu-panel a { padding: 13px 4px; font-size: 16px; font-weight: 500; color: var(--muted); border-bottom: 1px solid var(--line-2); text-decoration: none; }
        .menu-panel a[aria-current="page"] { color: var(--ink); font-weight: 600; }
        @media (max-width: 767px) {
          .hdr-chain { display: none !important; }
        }
`}</style>
    </header>
  );
};

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
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "var(--fg2)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ChainStatusDot status={chain.status} />
              <NetworkLabel />
              {chain.status !== "live" ? <span>{chain.status}</span> : null}
            </span>
            <a href="https://github.com/rome-protocol/rome-aave-v3" target="_blank" rel="noreferrer"
              style={{ color: "var(--fg2)", textDecoration: "none", borderBottom: "1px solid var(--border-subtle)" }}>
              Contracts ↗
            </a>
          </div>
        </div>
      </Container>
    </footer>
  );
};
