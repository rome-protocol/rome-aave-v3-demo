"use client";

// /markets/[symbol]. Reserve metadata + per-user position both come from
// TanStack Query (useAaveConfig + useUserData). User-info CTAs route
// through ActionModal — the same shared modal Dashboard uses.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveAddress } from "@/hooks/useActiveLane";
import { useUniWallet } from "@/hooks/useUniWallet";
import {
  AddressRow,
  Banner,
  Button,
  Container,
  Eyebrow,
  Hairline,
  SectionTitle,
  Tag,
} from "@/components/primitives";
import { TokenIcon } from "@/components/TokenIcon";
import { useAssetIdentity } from "@/hooks/useAssetIdentity";
import { PageHeader, PageFooter } from "@/components/PageHeader";
import { fallbackChainInfo } from "@/lib/registry-config";
import { IconChevronLeft, IconExternal, IconWallet, IconAlert } from "@/components/icons";
import { useAaveConfig, useUserData } from "@/hooks/useAaveData";
import { addressHref } from "@/lib/explorer-links";
import { fmt, fmtAmount, fmtPrice, fmtShare, fmtUsd } from "@/lib/format";
import { IR, irLayout } from "@/lib/ir-labels";
import { ActionModal, type ActionIntent } from "@/components/ActionModal";
import type { ChainInfo, Reserve, UserPosition } from "@/lib/types";

const pageShell: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-canvas)",
  color: "var(--fg1)",
  fontFamily: "var(--font-sans)",
  display: "flex",
  flexDirection: "column",
};

const fallbackChainStub: ChainInfo = fallbackChainInfo;

export function AssetDetailContent({ symbol }: { symbol: string }) {
  const cfg = useAaveConfig();
  const usr = useUserData();
  const { isConnected } = useActiveAddress();
  const wallet = useUniWallet();
  const openConnectModal = () => wallet.openFilteredWalletModal("all");
  const router = useRouter();
  const [actionIntent, setActionIntent] = useState<ActionIntent | null>(null);

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

  const { chain, reserves, aaveAddresses } = cfg.data;
  const reserve = reserves.find((r) => r.symbol === symbol);
  const hf = usr.data?.aggregate.healthFactor;

  if (!reserve) {
    return (
      <div style={pageShell}>
        <PageHeader chain={chain} hf={hf} />
        <Container max={1280} style={{ paddingTop: 20 }}>
          <Banner variant="warn">
            No market for <code>{symbol}</code>.
          </Banner>
          <div style={{ marginTop: 16 }}>
            <Button variant="secondary" onClick={() => router.push("/")}>← Back to markets</Button>
          </div>
        </Container>
        <PageFooter chain={chain} />
      </div>
    );
  }

  const userPosition = isConnected ? usr.data?.positions?.[symbol] : undefined;
  const availableBorrowsUsd = usr.data?.aggregate.availableBorrowsUsd ?? 0;

  return (
    <div style={pageShell}>
      <PageHeader chain={chain} hf={hf} />
      <AssetDetailBody
        chain={chain}
        reserve={reserve}
        position={userPosition}
        isConnected={isConnected}
        availableBorrowsUsd={availableBorrowsUsd}
        onConnect={openConnectModal}
        onBack={() => router.push("/")}
        onOpenAction={setActionIntent}
      />
      <ActionModal
        open={!!actionIntent}
        intent={actionIntent}
        reserve={reserve}
        position={userPosition}
        aggregate={usr.data?.aggregate}
        positions={isConnected ? usr.data?.positions : undefined}
        pool={aaveAddresses.pool as `0x${string}`}
        availableBorrowsUsd={availableBorrowsUsd}
        onClose={() => setActionIntent(null)}
      />
      <PageFooter chain={chain} />
    </div>
  );
}

const ShellWithPlaceholder = ({ children }: { children: React.ReactNode }) => (
  <div style={pageShell}>
    <PageHeader chain={fallbackChainStub} />
    <Container max={1280} style={{ paddingTop: 20, paddingBottom: 40 }}>{children}</Container>
    <PageFooter chain={fallbackChainStub} />
  </div>
);

// ───────────────── AssetDetailBody ─────────────────

interface AssetDetailBodyProps {
  chain: ChainInfo;
  reserve: Reserve;
  position: UserPosition | undefined;
  isConnected: boolean;
  availableBorrowsUsd: number;
  onConnect: (() => void) | undefined;
  onBack: () => void;
  onOpenAction: (intent: ActionIntent) => void;
}

const AssetDetailBody = ({
  chain,
  reserve,
  position,
  isConnected,
  availableBorrowsUsd,
  onConnect,
  onBack,
  onOpenAction,
}: AssetDetailBodyProps) => {
  const [aboutOpen, setAboutOpen] = useState(false);
  const utilization = reserve.totalSupply > 0 ? reserve.totalBorrow / reserve.totalSupply : 0;
  const symbol = reserve.symbol;
  const id = useAssetIdentity(symbol, reserve.name);

  return (
    <Container max={1280} style={{ paddingTop: 32, paddingBottom: 40 }}>
      <a
        href="#"
        onClick={(e) => { e.preventDefault(); onBack(); }}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg2)", textDecoration: "none", fontSize: 13, marginBottom: 24 }}
      >
        <IconChevronLeft size={14} /> Markets
      </a>

      {/* Asset header */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 28, flexWrap: "wrap" }}>
        <TokenIcon symbol={id.symbol} mint={id.mint} size={48} />
        <div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 38, letterSpacing: "-0.02em" }}>
            {id.symbol}{id.name ? <span style={{ color: "var(--fg2)" }}> — {id.name}</span> : null}
          </h1>
          <div style={{ marginTop: 6, color: "var(--fg2)", fontSize: 13 }}>
            Backed 1:1 by <i>{symbol}</i> on Solana.
            <button
              type="button"
              onClick={() => setAboutOpen((o) => !o)}
              style={{
                marginLeft: 12,
                background: "transparent",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--r-pill)",
                padding: "2px 10px",
                color: "var(--fg-brand)",
                fontSize: 11,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              About <IconExternal size={10} />
            </button>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <Eyebrow>Oracle price</Eyebrow>
          <div className="mono tabular" style={{ fontSize: 22, color: "var(--fg1)", fontFamily: "var(--font-mono)" }}>
            {fmtPrice(reserve.priceUsd)}
          </div>
        </div>
      </div>

      {aboutOpen ? (
        <div style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-brand)",
          borderRadius: "var(--r-md)",
          padding: 18,
          marginBottom: 28,
          fontSize: 13,
          color: "var(--fg1)",
          lineHeight: 1.6,
        }}>
          <p style={{ margin: 0 }}>
            <b>{symbol}</b> is backed 1:1 by <i>{symbol}</i> on Solana
            {reserve.solanaMint ? (
              <>
                {" "}(mint <code className="mono" style={{ color: "var(--fg-brand)" }}>{reserve.solanaMint}</code>)
              </>
            ) : null}
            . Bridge in or out via{" "}
            <a href={chain.bridgeUrl || "#"} target="_blank" rel="noreferrer" style={{ color: "var(--fg-brand)" }}>
              {chain.bridgeUrl ? new URL(chain.bridgeUrl).host : "Bridge"} ↗
            </a>
            .
          </p>
        </div>
      ) : null}

      {/* Top stats */}
      <div className="detail-stats" style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 16,
        marginBottom: 24,
      }}>
        <div className="card" style={{ padding: 18 }}>
          <Eyebrow>Supplied</Eyebrow>
          <div className="headline-num tabular" style={{ fontSize: 26, marginTop: 6, color: "var(--fg1)" }}>
            {fmtUsd(reserve.totalSupplyUsd)}
          </div>
          <CapBarFull label="Cap" used={reserve.totalSupply} total={reserve.supplyCap} />
        </div>
        <div className="card" style={{ padding: 18 }}>
          <Eyebrow>Borrowed</Eyebrow>
          <div className="headline-num tabular" style={{ fontSize: 26, marginTop: 6, color: "var(--fg1)" }}>
            {fmtUsd(reserve.totalBorrowUsd)}
          </div>
          <CapBarFull label="Cap" used={reserve.totalBorrow} total={reserve.borrowCap} />
        </div>
        <div className="card" style={{ padding: 18 }}>
          <Eyebrow>Utilization</Eyebrow>
          <div className="headline-num tabular" style={{ fontSize: 26, marginTop: 6, color: "var(--fg1)" }}>
            {fmtShare(utilization * 100)}
          </div>
          <CapBarFull label="of optimal" used={utilization} total={reserve.optimalUsageRatio} format={(n) => fmt.pct(n, 0)} colorOk="var(--fg-brand)" colorWarn="var(--hf-warn)" />
        </div>
      </div>

      {/* Two-column reserve status + user info */}
      <div className="detail-grid" style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24 }}>
        <ReserveStatusCard reserve={reserve} utilization={utilization} />
        <UserInfoCard
          reserve={reserve}
          position={position}
          isConnected={isConnected}
          availableBorrowsUsd={availableBorrowsUsd}
          onConnect={onConnect}
          onOpenAction={onOpenAction}
        />
      </div>

      {/* IR curve */}
      <div style={{ marginTop: 28 }}>
        <SectionTitle right={<Tag>Variable</Tag>}>Interest rate model</SectionTitle>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ overflowX: "auto" }}><IRCurveChart reserve={reserve} /></div>
        </div>
      </div>

      {/* Token addresses */}
      <div style={{ marginTop: 28 }}>
        <SectionTitle>Token addresses</SectionTitle>
        <div className="card" style={{ padding: "4px 20px" }}>
          <AddressRow label="Token" address={reserve.contract} explorerHref={explorerHref(chain, reserve.contract)} />
          <AddressRow label="aToken" address={reserve.aToken} explorerHref={explorerHref(chain, reserve.aToken)} />
          <AddressRow label="Debt token" address={reserve.varDebt} explorerHref={explorerHref(chain, reserve.varDebt)} />
          {reserve.solanaMint ? (
            <AddressRow
              label="Solana mint"
              address={reserve.solanaMint}
              explorerLabel="Solana Explorer"
              explorerHref={solanaExplorerHref(chain, reserve.solanaMint)}
            />
          ) : null}
        </div>
      </div>

      <style>{`
        @media (max-width: 1023px) {
          .detail-grid { grid-template-columns: 1fr !important; }
          .detail-stats { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </Container>
  );
};

// Token, aToken, debt-token and mint links open the explorer's address page.
const explorerHref = (chain: ChainInfo, address: string): string | undefined => addressHref(chain.evmExplorer, address);
const solanaExplorerHref = (chain: ChainInfo, mint: string): string | undefined => addressHref(chain.solanaExplorer, mint);

// ───────────────── ReserveStatusCard (left column) ─────────────────

const ReserveStatusCard = ({ reserve, utilization }: { reserve: Reserve; utilization: number }) => {
  const rows: Array<[string, React.ReactNode]> = [
    ["Utilization", fmtShare(utilization * 100)],
    ["Supply APY", <span style={{ color: "var(--hf-safe)" }}>{fmt.pct(reserve.supplyApy)}</span>],
    ["Borrow APY (variable)", <span style={{ color: "var(--hf-warn)" }}>{fmt.pct(reserve.borrowApy)}</span>],
    ["Max LTV", fmt.pct(reserve.ltv, 0)],
    ["Liquidation threshold", fmt.pct(reserve.liqThreshold, 0)],
    ["Liquidation bonus", fmt.pct(reserve.liqBonus, 1)],
    ["Reserve factor", fmt.pct(reserve.reserveFactor, 0)],
    ["Can be collateral", reserve.canBeCollateral
      ? <span style={{ color: "var(--hf-safe)" }}>Yes</span>
      : <span style={{ color: "var(--fg3)" }}>No</span>],
    ["Can be borrowed", reserve.canBeBorrowed
      ? <span style={{ color: "var(--hf-safe)" }}>Yes</span>
      : <span style={{ color: "var(--fg3)" }}>No</span>],
    ["Supply cap", fmt.cap(reserve.supplyCap, reserve.priceUsd)],
    ["Borrow cap", fmt.cap(reserve.borrowCap, reserve.priceUsd)],
    ["E-mode category", <Tag tone={reserve.emodeCategory === "—" ? "neutral" : "brand"}>{reserve.emodeCategory}</Tag>],
    ["Isolation mode", reserve.isolation
      ? <Tag tone="warn">Yes</Tag>
      : <span style={{ color: "var(--fg3)" }}>No</span>],
  ];
  return (
    <div className="card" style={{ padding: "4px 20px" }}>
      <div style={{ padding: "16px 0 12px", borderBottom: "1px solid var(--border-subtle)" }}>
        <Eyebrow>Status</Eyebrow>
      </div>
      {rows.map(([k, v], i) => (
        <div
          key={k}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 0",
            borderBottom: i < rows.length - 1 ? "1px solid var(--border-subtle)" : "none",
            fontSize: 13,
          }}
        >
          <span style={{ color: "var(--fg2)" }}>{k}</span>
          <span style={{ color: "var(--fg1)", fontFamily: "var(--font-mono)" }}>{v}</span>
        </div>
      ))}
    </div>
  );
};

// ───────────────── UserInfoCard (right column) ─────────────────

const UserInfoCard = ({
  reserve,
  position,
  isConnected,
  availableBorrowsUsd,
  onConnect,
  onOpenAction,
}: {
  reserve: Reserve;
  position: UserPosition | undefined;
  isConnected: boolean;
  availableBorrowsUsd: number;
  onConnect: (() => void) | undefined;
  onOpenAction: (intent: ActionIntent) => void;
}) => {
  const symbol = reserve.symbol;

  if (!isConnected || !position) {
    return (
      <div className="card" style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center" }}>
        <div style={{
          width: 44, height: 44, borderRadius: 44,
          background: "color-mix(in srgb, var(--bridge) 12%, transparent)",
          border: "1px solid var(--border-brand)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--fg-brand)",
        }}>
          <IconWallet size={18} />
        </div>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 18 }}>Your position</div>
        <div style={{ color: "var(--fg2)", fontSize: 13 }}>
          Connect to supply, borrow or repay.
        </div>
        <Button variant="primary" onClick={onConnect}>Connect wallet</Button>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: "4px 20px" }}>
      <div style={{
        padding: "16px 0 12px",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <Eyebrow>Your position</Eyebrow>
        <span className="mono" style={{ fontSize: 11, color: "var(--fg2)" }}>
          Wallet:{" "}
          <span style={{ color: "var(--fg1)" }} className="tabular">
            {fmtAmount(position.walletBalance)} {symbol}
          </span>
        </span>
      </div>

      {/* Supply box */}
      <div style={{ padding: "16px 0" }}>
        <div style={infoRowStyle}>
          <span style={infoLabelStyle}>Supplied</span>
          <span className="mono tabular" style={{ color: "var(--fg1)" }}>
            {fmtAmount(position.suppliedBalance)} {symbol}
          </span>
        </div>
        <div style={infoRowStyle}>
          <span style={infoLabelStyle}>Earning APY</span>
          <span className="mono tabular" style={{ color: "var(--hf-safe)" }}>
            {fmt.pct(reserve.supplyApy)}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="primary" size="sm" fullWidth onClick={() => onOpenAction({ mode: "supply", symbol })}>
            Supply
          </Button>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            disabled={position.suppliedBalance === 0}
            onClick={() => onOpenAction({ mode: "withdraw", symbol })}
          >
            Withdraw
          </Button>
        </div>
      </div>

      <Hairline />

      {/* Borrow box */}
      <div style={{ padding: "16px 0" }}>
        <div style={infoRowStyle}>
          <span style={infoLabelStyle}>Borrowed</span>
          <span className="mono tabular" style={{ color: "var(--fg1)" }}>
            {fmtAmount(position.debtBalance)} {symbol}
          </span>
        </div>
        <div style={infoRowStyle}>
          <span style={infoLabelStyle}>Borrow APY</span>
          <span className="mono tabular" style={{ color: "var(--hf-warn)" }}>
            {fmt.pct(reserve.borrowApy)}
          </span>
        </div>
        <div style={infoRowStyle}>
          <span style={infoLabelStyle}>Available to borrow</span>
          <span className="mono tabular" style={{ color: "var(--fg1)" }}>
            {fmtUsd(availableBorrowsUsd)}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            variant="primary"
            size="sm"
            fullWidth
            disabled={!reserve.canBeBorrowed}
            onClick={() => onOpenAction({ mode: "borrow", symbol })}
          >
            Borrow
          </Button>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            disabled={position.debtBalance === 0}
            onClick={() => onOpenAction({ mode: "repay", symbol })}
          >
            Repay
          </Button>
        </div>
      </div>
    </div>
  );
};

const infoRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", marginBottom: 8 };
const infoLabelStyle: React.CSSProperties = { color: "var(--fg2)", fontSize: 12 };

// ───────────────── Cap bar ─────────────────

const CapBarFull = ({
  label,
  used,
  total,
  colorOk = "var(--fg-brand)",
  colorWarn = "var(--hf-warn)",
  format = fmtAmount,
}: {
  label: string;
  used: number;
  total: number;
  colorOk?: string;
  colorWarn?: string;
  format?: (n: number) => string;
}) => {
  const pct = total > 0 ? Math.min(1, used / total) : 0;
  const color = pct > 0.85 ? colorWarn : colorOk;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 10,
        color: "var(--fg2)",
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        marginBottom: 4,
      }}>
        <span>{label}{total > 0 ? ` ${fmt.pct(pct, 0)}` : ""}</span>
        <span className="tabular" style={{ color: "var(--fg2)" }}>
          {total > 0 ? `${format(used)}/${format(total)}` : `${format(used)} · No cap`}
        </span>
      </div>
      <div style={{ height: 4, background: "var(--bg-surface-3)", borderRadius: 3 }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
};

// ───────────────── Interest-rate curve ─────────────────

const IRCurveChart = ({ reserve }: { reserve: Reserve }) => {
  const { W, H, padL, padR, padT, padB } = IR;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const U_opt = reserve.optimalUsageRatio;
  const cur = reserve.totalSupply > 0 ? reserve.totalBorrow / reserve.totalSupply : 0;
  const curText = `Current · ${fmtShare(cur * 100)}`;
  const kinkText = `U_opt = ${fmt.pct(U_opt, 0)}`;
  const L = irLayout({ cur, uOpt: U_opt, slope1: reserve.slope1, slope2: reserve.slope2 }, curText, kinkText);
  const { maxRate, curX, curY, kinkX, kinkY } = L;
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= 100; i++) points.push([L.xOf(i / 100), L.yOf(i / 100)]);
  const path = "M " + points.map((p) => p.join(",")).join(" L ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 560, maxWidth: W, height: "auto", display: "block" }}>
      {[0, 0.25, 0.5, 0.75, 1.0].map((t) => {
        const y = padT + innerH - t * innerH;
        return (
          <g key={`y-${t}`}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--border-subtle)" strokeDasharray="2 4" />
            <text x={padL - 8} y={y + 4} fill="var(--fg2)" fontSize="10" fontFamily="var(--font-mono)" textAnchor="end">
              {fmt.pct(t * maxRate, 0)}
            </text>
          </g>
        );
      })}
      {[0, 0.25, 0.5, 0.75, 1.0].map((t) => {
        const x = padL + t * innerW;
        return (
          <text key={`x-${t}`} x={x} y={H - padB + 18} fill="var(--fg2)" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle">
            {fmt.pct(t, 0)}
          </text>
        );
      })}
      <path d={path + ` L ${padL + innerW},${padT + innerH} L ${padL},${padT + innerH} Z`} fill="url(#irGrad)" opacity="0.4" />
      <defs>
        <linearGradient id="irGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--bridge)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--bridge)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path} fill="none" stroke="var(--fg-brand)" strokeWidth="2" />
      <line x1={kinkX} x2={kinkX} y1={kinkY} y2={padT + innerH} stroke="var(--border-default)" strokeDasharray="3 3" />
      <circle cx={kinkX} cy={kinkY} r="3" fill="var(--fg-brand)" />
      <text x={L.kink.x} y={L.kink.y} textAnchor={L.kink.anchor} fill="var(--fg2)" fontSize="10" fontFamily="var(--font-mono)">
        {kinkText}
      </text>
      <line x1={curX} x2={curX} y1={curY} y2={padT + innerH} stroke="var(--hf-warn)" strokeDasharray="2 2" />
      <circle cx={curX} cy={curY} r="5" fill="var(--hf-warn)" stroke="var(--bg-surface)" strokeWidth="2" />
      <text x={L.current.x} y={L.current.y} textAnchor={L.current.anchor}
        fill="var(--hf-warn)" fontSize="11" fontFamily="var(--font-mono)" fontWeight="500">
        {curText}
      </text>
      <text x={W / 2} y={H - 6} fill="var(--fg2)" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" letterSpacing="0.1em">
        UTILIZATION
      </text>
      <text x={12} y={12} fill="var(--fg2)" fontSize="10" fontFamily="var(--font-mono)" letterSpacing="0.1em">
        BORROW APY
      </text>
    </svg>
  );
};
