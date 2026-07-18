"use client";

// Client component carrying the Markets page interactive surface. Wraps
// the data hooks + nav. app/page.tsx is a thin server component that
// pulls /api/aave-config once at request time so we get a fast first
// paint; this component subscribes to the same endpoint via TanStack
// Query for live updates after wallet actions.

import Link from "next/link";
import { useAaveConfig, useUserData } from "@/hooks/useAaveData";
import { useAccount } from "wagmi";
import {
  Banner,
  Container,
  Eyebrow,
  SectionTitle,
  Stat,
  WalletPrompt,
  AssetSymbol,
} from "@/components/primitives";
import { PageHeader, PageFooter } from "@/components/PageHeader";
import { fallbackChainInfo } from "@/lib/registry-config";
import { fmt } from "@/lib/format";
import { IconAlert, IconChevronRight } from "@/components/icons";
import { ConnectButton } from "@/components/WalletConnectButton";
import type { ChainInfo, Reserve, MarketTotals } from "@/lib/types";

export function MarketsContent() {
  const cfg = useAaveConfig();
  const usr = useUserData();
  const { isConnected } = useAccount();

  if (cfg.isLoading) {
    return (
      <ShellWithPlaceholder>
        <div style={{ color: "var(--fg2)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading reserves…</div>
      </ShellWithPlaceholder>
    );
  }
  if (cfg.isError || !cfg.data) {
    return (
      <ShellWithPlaceholder>
        <Banner variant="danger" icon={<IconAlert size={16} />}>
          Couldn't reach the chain RPC. Reserve data is unavailable.
        </Banner>
      </ShellWithPlaceholder>
    );
  }

  const { chain, reserves, marketTotals } = cfg.data;
  const hf = usr.data?.aggregate.healthFactor;

  return (
    <div style={pageShell}>
      <PageHeader chain={chain} hf={hf} />

      <Container max={1320} style={{ paddingTop: 20, paddingBottom: 40, display: "flex", flexDirection: "column", gap: 22 }}>
        <PageHero
          eyebrow={`${chain.displayName} · ${chain.env}`}
          title={<>Lend, borrow, <i>liquidate</i>. Aave V3 on Rome.</>}
          sub={`Solana-fast settlement, EVM-canonical contracts. ${reserves.length} reserves live.`}
        />

        <MarketStatsStrip chain={chain} marketTotals={marketTotals} />

        {!isConnected ? (
          <WalletConnectStrip />
        ) : null}

        <AllReservesTable reserves={reserves} />
      </Container>

      <PageFooter chain={chain} />
    </div>
  );
}

const ShellWithPlaceholder = ({ children }: { children: React.ReactNode }) => (
  <div style={pageShell}>
    <PageHeader chain={fallbackChainStub} />
    <Container max={1320} style={{ paddingTop: 20, paddingBottom: 40 }}>{children}</Container>
    <PageFooter chain={fallbackChainStub} />
  </div>
);

const fallbackChainStub: ChainInfo = fallbackChainInfo;

const pageShell: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-canvas)",
  color: "var(--fg1)",
  fontFamily: "var(--font-sans)",
  display: "flex",
  flexDirection: "column",
};

// ────────────── PageHero ──────────────

const PageHero = ({ eyebrow, title, sub }: { eyebrow: string; title: React.ReactNode; sub: string }) => (
  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
    <div style={{ maxWidth: 720 }}>
      <Eyebrow style={{ marginBottom: 6 }}>{eyebrow}</Eyebrow>
      <h1 style={{
        margin: 0,
        fontFamily: "var(--font-serif)",
        fontWeight: 400,
        fontSize: "clamp(22px, 3vw, 34px)",
        letterSpacing: "-0.015em",
        lineHeight: 1.05,
        color: "var(--fg1)",
      }}>
        {title}
      </h1>
      <div style={{ marginTop: 8, color: "var(--fg2)", fontSize: 14, maxWidth: 560 }}>{sub}</div>
    </div>
  </div>
);

// ────────────── MarketStatsStrip ──────────────

const MarketStatsStrip = ({ chain, marketTotals }: { chain: ChainInfo; marketTotals: MarketTotals }) => (
  <div className="card" style={{ padding: 20, display: "flex", flexWrap: "wrap", gap: 28, alignItems: "center" }}>
    <Stat label="Market" value={chain.displayName} size="md" emphasis="serif" />
    <Stat label="Total supply" value={fmt.usd(marketTotals.totalSizeUsd, { compact: true })} size="md" />
    <Stat label="Available" value={fmt.usd(marketTotals.availableUsd, { compact: true })} size="md" />
    <Stat label="Total borrow" value={fmt.usd(marketTotals.totalBorrowsUsd, { compact: true })} size="md" />
    <div style={{ flex: 1 }} />
    <div className="mono tabular" style={{ color: "var(--fg2)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
      {chain.displayName} · {chain.chainId}
    </div>
  </div>
);

// ────────────── WalletConnect strip (replaces the SPA's WalletPrompt path) ──────────────

const WalletConnectStrip = () => (
  <div className="card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 20, color: "var(--fg1)" }}>Connect to start lending</div>
      <div style={{ color: "var(--fg2)", fontSize: 13, marginTop: 4 }}>
        Connect your wallet to see your positions, supply, and borrow across all reserves on Rome Aave.
      </div>
    </div>
    <ConnectButton showBalance={false} />
  </div>
);

// ────────────── AllReservesTable ──────────────

const AllReservesTable = ({ reserves }: { reserves: Reserve[] }) => (
  <section>
    <SectionTitle>All reserves</SectionTitle>
    <div className="card">
      <table className="rome-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th className="num">Total supply</th>
            <th className="num">Supply APY</th>
            <th className="num">Total borrow</th>
            <th className="num">Borrow APY</th>
            <th style={{ width: 28 }}></th>
          </tr>
        </thead>
        <tbody>
          {reserves.map((r) => (
            <tr key={r.symbol} style={{ cursor: "pointer" }}>
              <td>
                <Link href={`/markets/${r.symbol}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                  <AssetSymbol symbol={r.symbol} size={26} />
                </Link>
              </td>
              <td className="num">
                <div>{fmt.num(r.totalSupply, 0)}</div>
                <div style={{ color: "var(--fg2)", fontSize: 11 }}>{fmt.usd(r.totalSupplyUsd, { compact: true })}</div>
              </td>
              <td className="num" style={{ color: "var(--hf-safe)" }}>{fmt.pct(r.supplyApy)}</td>
              <td className="num">
                <div>{fmt.num(r.totalBorrow, 0)}</div>
                <div style={{ color: "var(--fg2)", fontSize: 11 }}>{fmt.usd(r.totalBorrowUsd, { compact: true })}</div>
              </td>
              <td className="num" style={{ color: "var(--hf-warn)" }}>{fmt.pct(r.borrowApy)}</td>
              <td><IconChevronRight size={14} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);
