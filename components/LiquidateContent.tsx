"use client";

// /liquidate — at-risk feed + LiquidationModal launcher. useAtRiskFeed
// drives the table; each row's Liquidate button opens LiquidationModal.
// FilterPill is inlined here (also used by /history) — hoist if a third
// consumer ever lands.

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useUniWallet } from "@/hooks/useUniWallet";
import {
  Banner,
  Button,
  Container,
  Eyebrow,
  HealthFactorPill,
  Tag,
  AssetSymbol,
} from "@/components/primitives";
import { PageHeader, PageFooter } from "@/components/PageHeader";
import { fallbackChainInfo } from "@/lib/registry-config";
import {
  IconAlert,
  IconChevronDown,
  IconInfo,
  IconRefresh,
} from "@/components/icons";
import { useAaveConfig, useAtRiskFeed, useUserData } from "@/hooks/useAaveData";
import { fmt } from "@/lib/format";
import { LiquidationModal } from "@/components/LiquidationModal";
import type { AtRiskRow, ChainInfo, Reserve } from "@/lib/types";

const pageShell: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-canvas)",
  color: "var(--fg1)",
  fontFamily: "var(--font-sans)",
  display: "flex",
  flexDirection: "column",
};

const fallbackChainStub: ChainInfo = fallbackChainInfo;

type HfBand = "< 1.00" | "< 1.05" | "< 1.10" | "All";

export function LiquidateContent() {
  const cfg = useAaveConfig();
  const hfMax = 1.05;
  const feed = useAtRiskFeed(hfMax);
  const usr = useUserData();
  const { address: connectedAddress, isConnected } = useAccount();
  const wallet = useUniWallet();
  const openConnectModal = () => wallet.openFilteredWalletModal("evm");

  const [hfFilter, setHfFilter] = useState<HfBand>("< 1.05");
  const [collatFilter, setCollatFilter] = useState<string>("Any");
  const [debtFilter, setDebtFilter] = useState<string>("Any");
  const [minSize, setMinSize] = useState<string>("0");
  const [activeRow, setActiveRow] = useState<AtRiskRow | null>(null);

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
          Couldn&rsquo;t reach the chain RPC. Reserve data is unavailable.
        </Banner>
      </ShellWithPlaceholder>
    );
  }

  const { chain, reserves, aaveAddresses } = cfg.data;
  const reservesBySymbol: Record<string, Reserve> = Object.fromEntries(
    reserves.map((r) => [r.symbol, r]),
  );
  const userHf = usr.data?.aggregate.healthFactor;

  const rows = feed.data?.rows ?? [];
  const filtered = rows.filter((row) => {
    if (collatFilter !== "Any" && row.collatSym !== collatFilter) return false;
    if (debtFilter !== "Any" && row.debtSym !== debtFilter) return false;
    const minN = Number(minSize) || 0;
    if (row.debtUsd < minN) return false;
    if (hfFilter === "< 1.00" && row.hf >= 1) return false;
    if (hfFilter === "< 1.05" && row.hf >= 1.05) return false;
    if (hfFilter === "< 1.10" && row.hf >= 1.1) return false;
    return true;
  });

  const feedStatus: FeedStatus = feed.isError
    ? "error"
    : feed.isFetching
      ? "stale"
      : "live";

  return (
    <div style={pageShell}>
      <PageHeader chain={chain} hf={userHf} />
      <Container max={1320} style={{ paddingTop: 20, paddingBottom: 40, display: "flex", flexDirection: "column", gap: 22 }}>
        <PageHero
          eyebrow="Liquidate"
          title={<>Earn the <i>liquidation</i> bonus.</>}
          sub={`Repay undercollateralized debt on ${chain.displayName} and receive collateral at a discount. HF < 1 is actionable; 1.00–1.05 listed for situational awareness.`}
        />

        <FilterBar
          hfFilter={hfFilter}
          collatFilter={collatFilter}
          debtFilter={debtFilter}
          minSize={minSize}
          reserves={reserves}
          feedStatus={feedStatus}
          onChangeHf={setHfFilter}
          onChangeCollat={setCollatFilter}
          onChangeDebt={setDebtFilter}
          onChangeMinSize={setMinSize}
          onRefresh={() => void feed.refetch()}
        />

        {feed.isError ? (
          <Banner
            variant="danger"
            icon={<IconAlert size={16} />}
            action={<Button variant="secondary" size="sm" onClick={() => void feed.refetch()}>Retry</Button>}
          >
            At-risk backend unreachable.
          </Banner>
        ) : null}

        <RowTable
          rows={filtered}
          connectedAddress={connectedAddress}
          isConnected={isConnected}
          onConnect={openConnectModal}
          onLiquidate={(row) => setActiveRow(row)}
        />

        <Banner variant="info" icon={<IconInfo size={16} />}>
          <span style={{ color: "var(--fg2)" }}>
            HF &lt; 1 is actionable. 1.00–1.05 listed for situational awareness; liquidation reverts if HF ≥ 1 at execution time.
          </span>
        </Banner>
      </Container>

      <LiquidationModal
        open={!!activeRow}
        row={activeRow}
        reservesBySymbol={reservesBySymbol}
        pool={aaveAddresses.pool as `0x${string}`}
        onClose={() => setActiveRow(null)}
      />

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

// ───────────────── PageHero ─────────────────

const PageHero = ({ eyebrow, title, sub }: { eyebrow: string; title: React.ReactNode; sub: string }) => (
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
);

// ───────────────── FilterBar + pills ─────────────────

type FeedStatus = "live" | "stale" | "error";

interface FilterBarProps {
  hfFilter: HfBand;
  collatFilter: string;
  debtFilter: string;
  minSize: string;
  reserves: Reserve[];
  feedStatus: FeedStatus;
  onChangeHf: (v: HfBand) => void;
  onChangeCollat: (v: string) => void;
  onChangeDebt: (v: string) => void;
  onChangeMinSize: (v: string) => void;
  onRefresh: () => void;
}

const FilterBar = ({
  hfFilter,
  collatFilter,
  debtFilter,
  minSize,
  reserves,
  feedStatus,
  onChangeHf,
  onChangeCollat,
  onChangeDebt,
  onChangeMinSize,
  onRefresh,
}: FilterBarProps) => {
  const hfOptions: HfBand[] = ["< 1.00", "< 1.05", "< 1.10", "All"];
  const symbolOptions = useMemo(() => ["Any", ...reserves.map((r) => r.symbol)], [reserves]);

  return (
    <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <FilterPill label="HF" value={hfFilter} options={hfOptions} onChange={(v) => onChangeHf(v as HfBand)} />
      <FilterPill label="Collateral" value={collatFilter} options={symbolOptions} onChange={onChangeCollat} />
      <FilterPill label="Debt" value={debtFilter} options={symbolOptions} onChange={onChangeDebt} />
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Min size $</span>
        <input
          value={minSize}
          onChange={(e) => onChangeMinSize(e.target.value.replace(/[^\d]/g, ""))}
          style={{
            background: "var(--bg-surface-2)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--r-pill)",
            padding: "5px 12px",
            color: "var(--fg1)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            width: 84,
          }}
        />
      </div>
      <div style={{ flex: 1 }} />
      <FeedStatusIndicator status={feedStatus} />
      <button
        type="button"
        onClick={onRefresh}
        title="Refresh"
        style={{
          background: "transparent",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--r-pill)",
          padding: 8,
          color: "var(--fg2)",
          cursor: "pointer",
        }}
      >
        <IconRefresh size={14} />
      </button>
    </div>
  );
};

const FilterPill = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "var(--bg-surface-2)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--r-pill)",
          padding: "5px 10px 5px 12px",
          color: "var(--fg1)",
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-mono)",
          cursor: "pointer",
        }}
      >
        <span style={{ color: "var(--fg2)", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 11 }}>{label}</span>
        <span>{value}</span>
        <IconChevronDown size={12} />
      </button>
      {open ? (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--r-md)",
          padding: 6,
          minWidth: 160,
          zIndex: 20,
          boxShadow: "0 24px 48px -12px rgba(0,0,0,0.6)",
        }}>
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => { onChange(o); setOpen(false); }}
              style={{
                width: "100%",
                textAlign: "left",
                background: value === o ? "var(--bg-surface-2)" : "transparent",
                border: "none",
                padding: "6px 10px",
                color: "var(--fg1)",
                fontSize: 12,
                borderRadius: "var(--r-sm)",
                cursor: "pointer",
              }}
            >
              {o}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const FeedStatusIndicator = ({ status }: { status: FeedStatus }) => {
  const c = status === "live" ? "var(--hf-safe)" : status === "stale" ? "var(--hf-warn)" : "var(--hf-danger)";
  const label = status === "live" ? "Live · 6s tick" : status === "stale" ? "Refreshing…" : "Error";
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: "transparent",
      border: "1px solid var(--border-default)",
      borderRadius: "var(--r-pill)",
      padding: "5px 12px",
      color: "var(--fg2)",
      fontSize: 11,
      fontFamily: "var(--font-mono)",
      letterSpacing: "0.04em",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 6, background: c, boxShadow: `0 0 6px ${c}` }} />
      <span style={{ color: c }}>{label}</span>
    </span>
  );
};

// ───────────────── Table ─────────────────

interface RowTableProps {
  rows: AtRiskRow[];
  connectedAddress: string | undefined;
  isConnected: boolean;
  onConnect: (() => void) | undefined;
  onLiquidate: (row: AtRiskRow) => void;
}

const RowTable = ({ rows, connectedAddress, isConnected, onConnect, onLiquidate }: RowTableProps) => {
  if (rows.length === 0) {
    return (
      <div className="card" style={{ padding: "32px 20px", textAlign: "center", color: "var(--fg2)", fontSize: 14 }}>
        No at-risk positions match the current filters.
      </div>
    );
  }

  return (
    <div className="card">
      <table className="rome-table">
        <thead>
          <tr>
            <th>Borrower</th>
            <th className="num">HF</th>
            <th>Collateral</th>
            <th>Debt</th>
            <th className="num">Bonus</th>
            <th style={{ width: 160, textAlign: "right" }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelf = isConnected && connectedAddress && row.borrower.toLowerCase() === connectedAddress.toLowerCase();
            const tooHealthy = row.hf >= 1.05;
            const disabled = !!isSelf || tooHealthy || !isConnected;
            const title = !isConnected
              ? "Connect a wallet to liquidate"
              : isSelf
                ? "Cannot liquidate your own position"
                : tooHealthy
                  ? "HF too high to liquidate"
                  : "Liquidate";
            return (
              <tr key={row.borrower}>
                <td>
                  <span className="mono" style={{ fontSize: 12, color: "var(--fg1)" }}>
                    {fmt.addr(row.borrower, 8, 6)}
                  </span>
                  {isSelf ? <Tag tone="warn">You</Tag> : null}
                </td>
                <td className="num"><HealthFactorPill hf={row.hf} size="sm" showLabel={false} /></td>
                <td><CollatDebtCell sym={row.collatSym} usd={row.collatUsd} /></td>
                <td><CollatDebtCell sym={row.debtSym} usd={row.debtUsd} /></td>
                <td className="num">
                  <span style={{ color: "var(--hf-safe)" }}>+{fmt.pct(row.bonusPct, 1)}</span>
                </td>
                <td style={{ textAlign: "right" }}>
                  {!isConnected ? (
                    <Button variant="secondary" size="sm" onClick={onConnect}>Connect</Button>
                  ) : (
                    <Button
                      variant={row.hf < 1 ? "primary" : "secondary"}
                      size="sm"
                      disabled={disabled}
                      title={title}
                      onClick={() => onLiquidate(row)}
                    >
                      Liquidate
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const CollatDebtCell = ({ sym, usd }: { sym: string; usd: number }) => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
    <AssetSymbol symbol={sym} size={22} />
    <span className="mono tabular" style={{ color: "var(--fg2)", fontSize: 12 }}>{fmt.usd(usd, { compact: true })}</span>
  </div>
);
