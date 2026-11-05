"use client";

// Client component carrying the Markets page interactive surface. Wraps
// the data hooks + nav. app/page.tsx is a thin server component that
// pulls /api/aave-config once at request time so we get a fast first
// paint; this component subscribes to the same endpoint via TanStack
// Query for live updates after wallet actions.

import Link from "next/link";
import { useAaveConfig, useMarketOverview, useUserData } from "@/hooks/useAaveData";
import { useActiveAddress } from "@/hooks/useActiveLane";
import {
  Banner,
  Container,
  Eyebrow,
  NetworkLabel,
  SectionTitle,
  Stat,
  WalletPrompt,
  AssetSymbol,
} from "@/components/primitives";
import { PageHeader, PageFooter } from "@/components/PageHeader";
import { fallbackChainInfo } from "@/lib/registry-config";
import { NETWORK_ON } from "@/lib/brand";
import { fmt, fmtAmount, fmtPrice, fmtShare, fmtUsd } from "@/lib/format";
import { IconAlert, IconChevronRight } from "@/components/icons";
import { ConnectButton } from "@/components/WalletConnectButton";
import { SplitBar, SplitText } from "@/components/MarketSplit";
import { sumSides, type MarketOverview } from "@/lib/market-split";
import type { ChainInfo, Reserve, MarketTotals } from "@/lib/types";

export function MarketsContent() {
  const cfg = useAaveConfig();
  const usr = useUserData();
  // The server sends no snapshot while its per-side balances are stale: the page then shows the plain totals.
  const ov = useMarketOverview().data ?? null;
  const { isConnected } = useActiveAddress();

  if (cfg.isLoading) {
    return (
      <ShellWithPlaceholder>
        <div style={{ color: "var(--fg2)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading…</div>
      </ShellWithPlaceholder>
    );
  }
  if (cfg.isError || !cfg.data) {
    return (
      <ShellWithPlaceholder>
        <Banner variant="danger" icon={<IconAlert size={16} />}>
          Can't load market data.
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
          eyebrow={<NetworkLabel />}
          title={<>Lend, borrow, <i>liquidate</i> {NETWORK_ON}.</>}
          sub={`Aave V3, enabled by Rome. ${reserves.length} assets live.`}
        />

        <MarketStatsStrip marketTotals={marketTotals} ov={ov} />

        {!isConnected ? (
          <WalletConnectStrip />
        ) : null}

        <AllReservesTable reserves={reserves} ov={ov} />
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

const PageHero = ({ eyebrow, title, sub }: { eyebrow: React.ReactNode; title: React.ReactNode; sub: string }) => (
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

const usdC = fmtUsd;

const MarketStatsStrip = ({ marketTotals, ov }: { marketTotals: MarketTotals; ov: MarketOverview | null }) => {
  const h = ov?.headline;
  // From one snapshot when the split is loaded, so the shown parts add up to the shown total.
  const size = h ? sumSides(h.sizeUsd) : marketTotals.totalSizeUsd;
  const borrows = h ? sumSides(h.borrowsUsd) : marketTotals.totalBorrowsUsd;
  const available = h ? sumSides(h.availableUsd) : marketTotals.totalSizeUsd - marketTotals.totalBorrowsUsd;
  const split = (v?: Parameters<typeof SplitBar>[0]["v"]) =>
    v ? <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><SplitText v={v} f={usdC} /><SplitBar v={v} /></div> : undefined;
  return (
    <div className="card" style={{ padding: 20, display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start" }}>
      <Stat label="Market size" value={usdC(size)} size="md" sublabel={split(h?.sizeUsd)} />
      <Stat label="Available" value={usdC(available)} size="md" sublabel={split(h?.availableUsd)} />
      <Stat label="Borrowed" value={usdC(borrows)} size="md" sublabel={split(h?.borrowsUsd)} />
    </div>
  );
};

// ────────────── WalletConnect strip (replaces the SPA's WalletPrompt path) ──────────────

const WalletConnectStrip = () => (
  <div className="card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 20, color: "var(--fg1)" }}>Start lending</div>
      <div style={{ color: "var(--fg2)", fontSize: 13, marginTop: 4 }}>
        Connect to supply and borrow.
      </div>
    </div>
    <ConnectButton showBalance={false} />
  </div>
);

// ────────────── AllReservesTable ──────────────

const AllReservesTable = ({ reserves, ov }: { reserves: Reserve[]; ov: MarketOverview | null }) => {
  const bySymbol = new Map(ov?.reserves.map((r) => [r.symbol, r]));
  return (
    <section>
      <SectionTitle>All assets</SectionTitle>
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="rome-table compact-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th className="num">Supplied</th>
              <th className="num hide-sm">Supply APY</th>
              <th className="num">Borrowed</th>
              <th className="num hide-sm">Borrow APY</th>
              <th className="num hide-sm">Utilization</th>
              <th className="num hide-sm">Price</th>
              <th className="hide-sm" style={{ width: 28 }}></th>
            </tr>
          </thead>
          <tbody>
            {reserves.map((r) => {
              const o = bySymbol.get(r.symbol);
              return (
                <tr key={r.symbol} style={{ cursor: "pointer" }}>
                  <td>
                    <Link href={`/markets/${r.symbol}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <AssetSymbol symbol={r.symbol} size={26} />
                    </Link>
                  </td>
                  <td className="num">
                    <div>{fmtAmount(o ? sumSides(o.supplied) : r.totalSupply)}</div>
                    <div style={{ color: "var(--fg2)", fontSize: 11 }}>{usdC(o ? sumSides(o.suppliedUsd) : r.totalSupplyUsd)}</div>
                    {o ? <SplitText v={o.suppliedUsd} f={usdC} /> : null}
                    <div className="show-sm" style={{ color: "var(--hf-safe)", fontSize: 11 }}>{fmt.pct(r.supplyApy)} APY</div>
                  </td>
                  <td className="num hide-sm" style={{ color: "var(--hf-safe)" }}>{fmt.pct(r.supplyApy)}</td>
                  <td className="num">
                    <div>{fmtAmount(o ? sumSides(o.borrowed) : r.totalBorrow)}</div>
                    <div style={{ color: "var(--fg2)", fontSize: 11 }}>{usdC(o ? sumSides(o.borrowedUsd) : r.totalBorrowUsd)}</div>
                    {o ? <SplitText v={o.borrowedUsd} f={usdC} /> : null}
                    <div className="show-sm" style={{ color: "var(--hf-warn)", fontSize: 11 }}>{fmt.pct(r.borrowApy)} APY</div>
                  </td>
                  <td className="num hide-sm" style={{ color: "var(--hf-warn)" }}>{fmt.pct(r.borrowApy)}</td>
                  <td className="num hide-sm">{fmtShare((o ? o.utilization : r.utilization) * 100)}</td>
                  <td className="num hide-sm">{fmtPrice(r.priceUsd)}</td>
                  <td className="hide-sm"><IconChevronRight size={14} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
