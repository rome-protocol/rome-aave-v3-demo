"use client";

// /dashboard. useAaveConfig + useUserData drive the hero, supplies, and
// borrows columns. Per-row CTAs pass an {mode, symbol} intent to
// onOpenAction, and the page renders ActionModal at the top level —
// same pattern AssetDetailContent uses.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveAddress } from "@/hooks/useActiveLane";
import { useUniWallet } from "@/hooks/useUniWallet";
import {
  Button,
  Container,
  Eyebrow,
  Hairline,
  Tag,
  WalletPrompt,
  AssetSymbol,
  Banner,
  CollateralToggle,
  hfTierStyle,
  NetworkLabel,
} from "@/components/primitives";
import { PageHeader, PageFooter } from "@/components/PageHeader";
import { fallbackChainInfo } from "@/lib/registry-config";
import { IconAlert, IconCopy, IconSpark } from "@/components/icons";
import { Tip } from "@/components/Tip";
import { useAaveConfig, useUserData } from "@/hooks/useAaveData";
import { fmt, fmtAmount, fmtUsd, computeUserAggregates } from "@/lib/format";
import { useAaveCollateral } from "@/hooks/useAaveCollateral";
import { ActionModal, type ActionIntent } from "@/components/ActionModal";
import { EmodeModal } from "@/components/EmodeModal";
import type {
  ChainInfo,
  EmodeCategoryConfig,
  Reserve,
  UserData,
  UserPosition,
  ComputedAggregates,
} from "@/lib/types";

const pageShell: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-canvas)",
  color: "var(--fg1)",
  fontFamily: "var(--font-sans)",
  display: "flex",
  flexDirection: "column",
};

const fallbackChainStub: ChainInfo = fallbackChainInfo;

export function DashboardContent() {
  const cfg = useAaveConfig();
  const usr = useUserData();
  const { isConnected, address } = useActiveAddress();
  const wallet = useUniWallet();
  const openConnectModal = () => wallet.openFilteredWalletModal("all");
  const router = useRouter();
  const [actionIntent, setActionIntent] = useState<ActionIntent | null>(null);
  const [emodeOpen, setEmodeOpen] = useState(false);

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
          Can&rsquo;t load market data.
        </Banner>
      </ShellWithPlaceholder>
    );
  }

  const { chain, reserves, aaveAddresses, emodeCategories } = cfg.data;
  const reservesBySymbol: Record<string, Reserve> = Object.fromEntries(
    reserves.map((r) => [r.symbol, r]),
  );
  const hf = usr.data?.aggregate.healthFactor;
  const modalReserve = actionIntent ? reservesBySymbol[actionIntent.symbol] : undefined;
  const modalPosition = actionIntent ? usr.data?.positions?.[actionIntent.symbol] : undefined;
  const userEmodeId = usr.data?.aggregate.userEmodeCategoryId ?? 0;
  const activeEmodeLabel = userEmodeId === 0
    ? "Disabled"
    : emodeCategories.find((c) => c.id === userEmodeId)?.label ?? `id=${userEmodeId}`;

  return (
    <div style={pageShell}>
      <PageHeader chain={chain} hf={hf} />
      <DashboardBody
        chain={chain}
        reservesBySymbol={reservesBySymbol}
        user={usr.data}
        isConnected={isConnected}
        connectAddress={address ?? undefined}
        onConnect={openConnectModal}
        onNavigate={(path) => router.push(path)}
        onOpenAction={setActionIntent}
        emodeCategories={emodeCategories}
        activeEmodeLabel={activeEmodeLabel}
        onOpenEmode={() => setEmodeOpen(true)}
        pool={aaveAddresses.pool as `0x${string}`}
      />
      <ActionModal
        open={!!actionIntent}
        intent={actionIntent}
        reserve={modalReserve}
        position={modalPosition}
        aggregate={usr.data?.aggregate}
        pool={aaveAddresses.pool as `0x${string}`}
        availableBorrowsUsd={usr.data?.aggregate.availableBorrowsUsd ?? 0}
        onClose={() => setActionIntent(null)}
      />
      <EmodeModal
        open={emodeOpen}
        pool={aaveAddresses.pool as `0x${string}`}
        categories={emodeCategories}
        currentCategoryId={userEmodeId}
        onClose={() => setEmodeOpen(false)}
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

// ───────────────── DashboardBody ─────────────────
// Branches on connection + position state. Mirrors the JSX original's
// three top-level shapes (disconnected → connected-empty → has-positions).

interface DashboardBodyProps {
  chain: ChainInfo;
  reservesBySymbol: Record<string, Reserve>;
  user: UserData | undefined;
  isConnected: boolean;
  connectAddress: string | undefined;
  onConnect: (() => void) | undefined;
  onNavigate: (path: string) => void;
  onOpenAction: (intent: ActionIntent) => void;
  emodeCategories: EmodeCategoryConfig[];
  activeEmodeLabel: string;
  onOpenEmode: () => void;
  pool: `0x${string}`;
}

const DashboardBody = ({
  chain,
  reservesBySymbol,
  user,
  isConnected,
  connectAddress,
  onConnect,
  onNavigate,
  onOpenAction,
  emodeCategories,
  activeEmodeLabel,
  onOpenEmode,
  pool,
}: DashboardBodyProps) => {
  const collateral = useAaveCollateral(pool);
  if (!isConnected) {
    return (
      <Container max={1320} style={{ paddingTop: 20 }}>
        <PageHero eyebrow="Dashboard" title="Your positions" />
        <div style={{ paddingTop: 24 }}>
          <WalletPrompt onConnect={onConnect} />
        </div>
      </Container>
    );
  }

  const positions = user?.positions ?? {};
  const localAgg = computeUserAggregates(positions, reservesBySymbol);
  // Server `user.aggregate.healthFactor` (Pool.getUserAccountData via
  // /api/user-data) is authoritative; the local compute uses SWR-cached prices
  // and can drift across oracle ticks. lib/format.ts says local is for
  // skeleton renders only — honor that for the hero's HF.
  const agg = { ...localAgg, hf: user?.aggregate?.healthFactor ?? localAgg.hf };
  const hasPositions = agg.suppliedUsd > 0 || agg.debtUsd > 0;

  if (!hasPositions) {
    return (
      <Container max={1320} style={{ paddingTop: 20 }}>
        <PageHero eyebrow="Dashboard" title="Your positions" />
        <div className="card" style={{ marginTop: 24, padding: "48px 32px", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: 28, color: "var(--fg1)", letterSpacing: "-0.01em" }}>
            <i>$0</i> · 0% · No positions.
          </div>
          <div style={{ color: "var(--fg2)", marginTop: 12, marginBottom: 24 }}>
            Supply or borrow to start.
          </div>
          <Button variant="primary" size="lg" onClick={() => onNavigate("/")}>Open markets</Button>
        </div>
      </Container>
    );
  }

  const tier = hfTierStyle(agg.hf);
  const largestDebtSymbol = Object.entries(positions)
    .filter(([, p]) => p.debtBalance > 0)
    .sort(([a, pa], [b, pb]) =>
      pb.debtBalance * (reservesBySymbol[b]?.priceUsd ?? 0) - pa.debtBalance * (reservesBySymbol[a]?.priceUsd ?? 0))[0]?.[0];

  return (
    <Container max={1320} style={{ paddingTop: 20, paddingBottom: 40, display: "flex", flexDirection: "column", gap: 22 }}>
      <DashboardHero
        chain={chain}
        address={user?.address ?? connectAddress ?? ""}
        agg={agg}
        tier={tier}
        onReduceRisk={largestDebtSymbol ? () => onOpenAction({ mode: "repay", symbol: largestDebtSymbol }) : undefined}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }} className="positions-grid">
        <PositionsColumn
          title="Your supplies"
          kind="supply"
          positions={positions}
          reservesBySymbol={reservesBySymbol}
          agg={agg}
          onNavigate={onNavigate}
          onOpenAction={onOpenAction}
          collateral={collateral}
        />
        <PositionsColumn
          title="Your borrows"
          kind="borrow"
          positions={positions}
          reservesBySymbol={reservesBySymbol}
          agg={agg}
          onNavigate={onNavigate}
          onOpenAction={onOpenAction}
          collateral={collateral}
        />
      </div>

      <EmodeCard
        categories={emodeCategories}
        activeLabel={activeEmodeLabel}
        onOpen={onOpenEmode}
      />

      <style>{`
        @media (max-width: 1023px) {
          .dashboard-hero { grid-template-columns: 1fr 1fr !important; }
          .dashboard-hero > div:nth-child(3) { grid-column: 1 / -1; }
          .positions-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 767px) {
          .dashboard-hero { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </Container>
  );
};

// ───────────────── PageHero ─────────────────

const PageHero = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
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
  </div>
);

// ───────────────── Dashboard hero (user-address + 3 stats) ─────────────────

const DashboardHero = ({
  chain,
  address,
  agg,
  tier,
  onReduceRisk,
}: {
  chain: ChainInfo;
  address: string;
  agg: ComputedAggregates;
  tier: ReturnType<typeof hfTierStyle>;
  onReduceRisk: (() => void) | undefined;
}) => (
  <div>
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, rowGap: 8, marginBottom: 14 }}>
      <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 22, background: "linear-gradient(135deg, var(--btn-1) 0%, var(--btn-2) 55%, var(--btn-3) 100%)" }} />
      <span className="mono" style={{ fontSize: 12, color: "var(--fg1)", letterSpacing: "0.02em", flexShrink: 0, whiteSpace: "nowrap" }}>
        {fmt.addr(address, 10, 8)}
      </span>
      <Tip text="Copy address">
        <button
          type="button"
          aria-label="Copy address"
          onClick={() => { void navigator.clipboard?.writeText(address); }}
          style={{ background: "transparent", border: "1px solid var(--border-default)", color: "var(--fg2)", padding: 6, borderRadius: 6, display: "inline-flex" }}
        >
          <IconCopy size={11} />
        </button>
      </Tip>
      <NetworkLabel />
    </div>

    <div className="dashboard-hero" style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1.4fr",
      gap: 1,
      background: "var(--border-subtle)",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--r-md)",
      overflow: "hidden",
    }}>
      <div style={{ background: "var(--bg-surface)", padding: "24px 28px" }}>
        <Eyebrow>Net worth</Eyebrow>
        <div className="headline-num" style={heroNumStyle()}>{fmtUsd(agg.netWorth)}</div>
        <div style={heroSubStyle}>Supplied {fmtUsd(agg.suppliedUsd)} · Debt {fmtUsd(agg.debtUsd)}</div>
      </div>
      <div style={{ background: "var(--bg-surface)", padding: "24px 28px" }}>
        <Eyebrow>Net APY</Eyebrow>
        <div className="headline-num" style={heroNumStyle(agg.netApy > 0 ? "var(--hf-safe)" : "var(--hf-danger)")}>
          {agg.netApy > 0 ? "+" : ""}{fmt.pct(agg.netApy)}
        </div>
        <div style={heroSubStyle}>Earn {fmt.pct(agg.netSupplyApy)} · Pay {fmt.pct(agg.netBorrowApy)}</div>
      </div>
      <div style={{ background: "var(--bg-surface)", padding: "24px 28px", position: "relative" }}>
        <Eyebrow>Health Factor</Eyebrow>
        <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 14 }}>
          <div className="headline-num" style={heroNumStyle(tier?.color ?? "var(--fg1)", false)}>{fmt.hf(agg.hf)}</div>
          {tier ? <Tag tone={tier.key === "safe" ? "success" : tier.key === "danger" ? "danger" : "warn"}>{tier.label}</Tag> : null}
        </div>
        <HFGauge hf={agg.hf} />
        {tier?.key === "risk" || tier?.key === "danger" ? (
          <Button variant="primary" size="sm" style={{ marginTop: 12 }} onClick={onReduceRisk} disabled={!onReduceRisk}>
            Reduce risk
          </Button>
        ) : null}
      </div>
    </div>
  </div>
);

const heroNumStyle = (color: string = "var(--fg1)", withMargin = true): React.CSSProperties => ({
  marginTop: withMargin ? 8 : 0,
  fontSize: 44,
  color,
  lineHeight: 1.0,
  fontFeatureSettings: "'tnum'",
});

const heroSubStyle: React.CSSProperties = { color: "var(--fg2)", fontSize: 12, marginTop: 6 };

// ───────────────── HF gauge ─────────────────

const HFGauge = ({ hf }: { hf: number }) => {
  const cap = 3.0;
  const pct = Math.min(100, (hf / cap) * 100);
  return (
    <div style={{ marginTop: 16, position: "relative" }}>
      <div style={{
        height: 4,
        borderRadius: 4,
        background:
          "linear-gradient(90deg, var(--hf-danger) 0%, var(--hf-danger) 33%, var(--hf-warn) 33%, var(--hf-warn) 66%, var(--hf-safe) 66%, var(--hf-safe) 100%)",
        opacity: 0.5,
      }} />
      <div style={{
        position: "absolute",
        left: `calc(${pct}% - 7px)`,
        top: -5,
        width: 14, height: 14,
        borderRadius: 14,
        background: "var(--fg1)",
        border: "2px solid var(--bg-surface)",
        boxShadow: "0 0 0 1px var(--border-strong)",
      }} />
      <div style={{
        display: "flex", justifyContent: "space-between",
        marginTop: 6, fontSize: 10, color: "var(--fg3)",
        fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
      }}>
        <span>1.0</span><span>1.5</span><span>2.0</span><span>3.0+</span>
      </div>
    </div>
  );
};

// ───────────────── PositionsColumn (Supplies or Borrows) ─────────────────

const PositionsColumn = ({
  title,
  kind,
  positions,
  reservesBySymbol,
  agg,
  onNavigate,
  collateral,
  onOpenAction,
}: {
  title: string;
  kind: "supply" | "borrow";
  positions: Record<string, UserPosition>;
  reservesBySymbol: Record<string, Reserve>;
  agg: ComputedAggregates;
  onNavigate: (path: string) => void;
  collateral: ReturnType<typeof useAaveCollateral>;
  onOpenAction: (intent: ActionIntent) => void;
}) => {
  const isSupply = kind === "supply";
  const rows = Object.entries(positions).filter(([, p]) =>
    isSupply ? p.suppliedBalance > 0 : p.debtBalance > 0,
  );

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 20, letterSpacing: "-0.005em" }}>{title}</h3>
        <span className="mono tabular" style={{ fontSize: 18, color: "var(--fg1)", fontFamily: "var(--font-mono)" }}>
          {fmtUsd(isSupply ? agg.suppliedUsd : agg.debtUsd)}
        </span>
      </div>
      <div style={{
        display: "flex", gap: 16, fontSize: 11,
        color: "var(--fg2)", marginBottom: 16,
        fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}>
        <span>
          APY{" "}
          <span className="tabular" style={{ color: "var(--fg1)" }}>
            {fmt.pct(isSupply ? agg.netSupplyApy : agg.netBorrowApy)}
          </span>
        </span>
        <span>
          {isSupply ? "Collateral" : "Borrow power used"}{" "}
          <span className="tabular" style={{ color: "var(--fg1)" }}>
            {isSupply ? fmtUsd(agg.collateralUsd) : fmt.pct(agg.ltvPct, 0)}
          </span>
        </span>
      </div>

      <Hairline />

      {rows.length === 0 ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--fg2)", fontSize: 13 }}>
          No {isSupply ? "supplies" : "borrows"}.{" "}
          <a href="/" onClick={(e) => { e.preventDefault(); onNavigate("/"); }} style={{ color: "var(--fg-brand)" }}>Open markets</a>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map(([sym, p]) => {
            const r = reservesBySymbol[sym];
            if (!r) return null;
            const bal = isSupply ? p.suppliedBalance : p.debtBalance;
            const apy = isSupply ? r.supplyApy : r.borrowApy;
            return (
              <div
                key={sym}
                onClick={() => onNavigate(`/markets/${sym}`)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 0",
                  borderBottom: "1px solid var(--border-subtle)",
                  cursor: "pointer",
                }}
              >
                <AssetSymbol symbol={sym} size={24} showName name={r.name} />
                <div style={{ textAlign: "right" }}>
                  <div className="mono tabular" style={{ color: "var(--fg1)" }}>
                    {fmtAmount(bal)}
                  </div>
                  <div style={{ color: "var(--fg2)", fontSize: 11 }}>
                    {fmtUsd(bal * r.priceUsd)}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 60 }}>
                  <div className="mono tabular" style={{ color: isSupply ? "var(--hf-safe)" : "var(--hf-warn)" }}>
                    {fmt.pct(apy)}
                  </div>
                  {isSupply ? (
                    <CollateralToggle
                      on={p.isCollateral}
                      disabled={!r.canBeCollateral || collateral.pending !== null}
                      onClick={(e) => {
                        e.stopPropagation();
                        void collateral.setCollateral(sym, r.contract, !p.isCollateral);
                      }}
                    />
                  ) : (
                    <Tag>Variable</Tag>
                  )}
                </div>
                <div
                  style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {(isSupply
                    ? [["supply", "Supply more", "primary"], ["withdraw", "Withdraw", "secondary"]]
                    : [["borrow", "Borrow more", "secondary"], ["repay", "Repay", "primary"]] as const
                  ).map(([mode, label, variant]) => (
                    <Button
                      key={mode}
                      variant={variant as "primary" | "secondary"}
                      size="sm"
                      fullWidth
                      onClick={() => onOpenAction({ mode: mode as ActionIntent["mode"], symbol: sym })}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isSupply && collateral.error ? (
        <div style={{ color: "var(--hf-danger)", fontSize: 12, marginTop: 12 }}>{collateral.error}</div>
      ) : null}
    </div>
  );
};

// ───────────────── E-mode card ─────────────────
// Shows the user's active category (or "Disabled") and opens the
// EmodeModal switcher. Hides the switch CTA when no categories are
// configured on this deployment.

const EmodeCard = ({
  categories,
  activeLabel,
  onOpen,
}: {
  categories: EmodeCategoryConfig[];
  activeLabel: string;
  onOpen: () => void;
}) => (
  <div className="card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
    <div style={{
      width: 44, height: 44, borderRadius: 44,
      background: "color-mix(in srgb, var(--bridge) 12%, transparent)",
      border: "1px solid var(--border-brand)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--fg-brand)",
    }}>
      <IconSpark size={18} />
    </div>
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-serif)", fontSize: 18, color: "var(--fg1)" }}>E-mode</span>
        <Tag tone={activeLabel === "Disabled" ? "neutral" : "brand"}>{activeLabel}</Tag>
      </div>
      <div style={{ color: "var(--fg2)", fontSize: 13, marginTop: 4 }}>
        {categories.length === 0
          ? "No e-mode categories."
          : "Higher borrow power for correlated assets."}
      </div>
    </div>
    {categories.length > 0 ? (
      <Button variant="secondary" size="sm" onClick={onOpen}>Switch e-mode</Button>
    ) : null}
  </div>
);
