"use client";

// /dashboard. useAaveConfig + useUserData drive the hero, supplies, and
// borrows columns. Per-row CTAs pass an {mode, symbol} intent to
// onOpenAction, and the page renders ActionModal at the top level —
// same pattern AssetDetailContent uses.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
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
} from "@/components/primitives";
import { PageHeader, PageFooter } from "@/components/PageHeader";
import { fallbackChainInfo } from "@/lib/registry-config";
import { IconAlert, IconCopy, IconSpark } from "@/components/icons";
import { useAaveConfig, useUserData } from "@/hooks/useAaveData";
import { fmt, computeUserAggregates } from "@/lib/format";
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
  const { isConnected, address } = useAccount();
  const wallet = useUniWallet();
  const openConnectModal = () => wallet.openFilteredWalletModal("evm");
  const router = useRouter();
  const [actionIntent, setActionIntent] = useState<ActionIntent | null>(null);
  const [emodeOpen, setEmodeOpen] = useState(false);

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
        connectAddress={address}
        onConnect={openConnectModal}
        onNavigate={(path) => router.push(path)}
        onOpenAction={setActionIntent}
        emodeCategories={emodeCategories}
        activeEmodeLabel={activeEmodeLabel}
        onOpenEmode={() => setEmodeOpen(true)}
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
}: DashboardBodyProps) => {
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
            <i>$0</i> · 0% · No active loans.
          </div>
          <div style={{ color: "var(--fg2)", marginTop: 12, marginBottom: 24 }}>
            Browse the markets to start lending or borrowing.
          </div>
          <Button variant="primary" size="lg" onClick={() => onNavigate("/")}>Go to Markets</Button>
        </div>
      </Container>
    );
  }

  const tier = hfTierStyle(agg.hf);
  const firstDebtSymbol = Object.entries(positions).find(([, p]) => p.debtBalance > 0)?.[0];

  return (
    <Container max={1320} style={{ paddingTop: 20, paddingBottom: 40, display: "flex", flexDirection: "column", gap: 22 }}>
      <DashboardHero
        chain={chain}
        address={user?.address ?? connectAddress ?? ""}
        agg={agg}
        tier={tier}
        onReduceRisk={firstDebtSymbol ? () => onOpenAction({ mode: "repay", symbol: firstDebtSymbol }) : undefined}
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
        />
        <PositionsColumn
          title="Your borrows"
          kind="borrow"
          positions={positions}
          reservesBySymbol={reservesBySymbol}
          agg={agg}
          onNavigate={onNavigate}
          onOpenAction={onOpenAction}
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
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span style={{ width: 22, height: 22, borderRadius: 22, background: "linear-gradient(135deg, #5E0A60 0%, #9d3aa0 50%, #C58BC6 100%)" }} />
      <span className="mono" style={{ fontSize: 12, color: "var(--fg1)", letterSpacing: "0.02em" }}>
        {fmt.addr(address, 10, 8)}
      </span>
      <button
        type="button"
        title="Copy address"
        onClick={() => { void navigator.clipboard?.writeText(address); }}
        style={{ background: "transparent", border: "1px solid var(--border-default)", color: "var(--fg2)", padding: 6, borderRadius: 6, display: "inline-flex" }}
      >
        <IconCopy size={11} />
      </button>
      <Tag tone="brand">{chain.displayName}</Tag>
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
        <div style={heroNumStyle()}>{fmt.usd(agg.netWorth)}</div>
        <div style={heroSubStyle}>Supplied {fmt.usd(agg.suppliedUsd, { compact: true })} · Debt {fmt.usd(agg.debtUsd, { compact: true })}</div>
      </div>
      <div style={{ background: "var(--bg-surface)", padding: "24px 28px" }}>
        <Eyebrow>Net APY</Eyebrow>
        <div style={heroNumStyle(agg.netApy > 0 ? "var(--hf-safe)" : "var(--hf-danger)")}>
          {agg.netApy > 0 ? "+" : ""}{fmt.pct(agg.netApy)}
        </div>
        <div style={heroSubStyle}>Earn {fmt.pct(agg.netSupplyApy)} · Pay {fmt.pct(agg.netBorrowApy)}</div>
      </div>
      <div style={{ background: "var(--bg-surface)", padding: "24px 28px", position: "relative" }}>
        <Eyebrow>Health Factor</Eyebrow>
        <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 14 }}>
          <div style={heroNumStyle(tier?.color ?? "var(--fg1)", false)}>{fmt.hf(agg.hf)}</div>
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
  fontFamily: "var(--font-serif)",
  fontSize: 44,
  letterSpacing: "-0.02em",
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
  onOpenAction,
}: {
  title: string;
  kind: "supply" | "borrow";
  positions: Record<string, UserPosition>;
  reservesBySymbol: Record<string, Reserve>;
  agg: ComputedAggregates;
  onNavigate: (path: string) => void;
  onOpenAction: (intent: ActionIntent) => void;
}) => {
  const isSupply = kind === "supply";
  const rows = Object.entries(positions).filter(([, p]) =>
    isSupply ? p.suppliedBalance > 0 : p.debtBalance > 0,
  );
  const firstSymbol = rows[0]?.[0] || "USDC";

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 20, letterSpacing: "-0.005em" }}>{title}</h3>
        <span className="mono tabular" style={{ fontSize: 18, color: "var(--fg1)", fontFamily: "var(--font-mono)" }}>
          {fmt.usd(isSupply ? agg.suppliedUsd : agg.debtUsd, { compact: true })}
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
            {isSupply ? fmt.usd(agg.collateralUsd, { compact: true }) : fmt.pct(agg.ltvPct, 0)}
          </span>
        </span>
      </div>

      <Hairline />

      {rows.length === 0 ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--fg2)", fontSize: 13 }}>
          No {isSupply ? "supplies" : "borrows"} yet.
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
                    {fmt.num(bal, isSupply && bal > 100 ? 2 : 4)}
                  </div>
                  <div style={{ color: "var(--fg2)", fontSize: 11 }}>
                    {fmt.usd(bal * r.priceUsd, { compact: true })}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 60 }}>
                  <div className="mono tabular" style={{ color: isSupply ? "var(--hf-safe)" : "var(--hf-warn)" }}>
                    {fmt.pct(apy)}
                  </div>
                  {isSupply ? (
                    <CollateralToggle
                      on={p.isCollateral}
                      disabled={!r.canBeCollateral}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <Tag>Variable</Tag>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {isSupply ? (
          <>
            <Button variant="primary" size="sm" fullWidth onClick={() => onOpenAction({ mode: "supply", symbol: firstSymbol })}>
              Supply more
            </Button>
            <Button variant="secondary" size="sm" fullWidth onClick={() => onOpenAction({ mode: "withdraw", symbol: firstSymbol })}>
              Withdraw
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" fullWidth onClick={() => onOpenAction({ mode: "borrow", symbol: firstSymbol })}>
              Borrow more
            </Button>
            <Button variant="primary" size="sm" fullWidth onClick={() => onOpenAction({ mode: "repay", symbol: firstSymbol })}>
              Repay
            </Button>
          </>
        )}
      </div>
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
      background: "rgba(197, 139, 198, 0.10)",
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
          ? "No e-mode categories configured on this market."
          : "Boost borrow power for correlated assets by joining an efficiency category."}
      </div>
    </div>
    {categories.length > 0 ? (
      <Button variant="secondary" size="sm" onClick={onOpen}>Switch e-mode</Button>
    ) : null}
  </div>
);
