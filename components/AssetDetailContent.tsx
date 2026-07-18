"use client";

// /markets/[symbol]. Reserve metadata + per-user position both come from
// TanStack Query (useAaveConfig + useUserData). User-info CTAs route
// through ActionModal — the same shared modal Dashboard uses.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
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
import { AssetSymbol } from "@/components/primitives";
import { PageHeader, PageFooter } from "@/components/PageHeader";
import { fallbackChainInfo } from "@/lib/registry-config";
import { IconChevronLeft, IconExternal, IconWallet, IconAlert } from "@/components/icons";
import { useAaveConfig, useUserData } from "@/hooks/useAaveData";
import { fmt } from "@/lib/format";
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
  const { isConnected } = useAccount();
  const wallet = useUniWallet();
  const openConnectModal = () => wallet.openFilteredWalletModal("evm");
  const router = useRouter();
  const [actionIntent, setActionIntent] = useState<ActionIntent | null>(null);

  if (cfg.isLoading) {
    return (
      <ShellWithPlaceholder>
        <div style={{ color: "var(--fg2)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading reserve…</div>
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
  const reserve = reserves.find((r) => r.symbol === symbol);
  const hf = usr.data?.aggregate.healthFactor;

  if (!reserve) {
    return (
      <div style={pageShell}>
        <PageHeader chain={chain} hf={hf} />
        <Container max={1280} style={{ paddingTop: 20 }}>
          <Banner variant="warn">
            Reserve <code>{symbol}</code> not found on {chain.displayName}.
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
        <AssetSymbol symbol={symbol} size={48} />
        <div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 38, letterSpacing: "-0.02em" }}>
            {symbol} <span style={{ color: "var(--fg2)" }}>— {reserve.name}</span>
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
            {fmt.usd(reserve.priceUsd, { dp: reserve.priceUsd > 100 ? 2 : 4 })}
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
            <b>{symbol}</b> on Rome is backed 1:1 by <i>{symbol}</i> on Solana
            {reserve.solanaMint ? (
              <>
                {" "}(mint <code className="mono" style={{ color: "var(--fg-brand)" }}>{reserve.solanaMint}</code>)
              </>
            ) : null}
            . Bridge {symbol} in or out via{" "}
            <a href={chain.bridgeUrl || "#"} target="_blank" rel="noreferrer" style={{ color: "var(--fg-brand)" }}>
              bridge.{chain.slug}.romeprotocol.xyz ↗
            </a>
            . The on-chain contract symbol is{" "}
            <code className="mono" style={{ color: "var(--fg2)" }}>w{symbol}</code>; this UI displays the underlying
            asset name.
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
          <Eyebrow>Total supplied</Eyebrow>
          <div className="mono tabular" style={{ fontSize: 26, marginTop: 6, color: "var(--fg1)" }}>
            {fmt.usd(reserve.totalSupplyUsd, { compact: true })}
          </div>
          <CapBarFull label="Cap" used={reserve.totalSupply} total={reserve.supplyCap} />
        </div>
        <div className="card" style={{ padding: 18 }}>
          <Eyebrow>Total borrowed</Eyebrow>
          <div className="mono tabular" style={{ fontSize: 26, marginTop: 6, color: "var(--fg1)" }}>
            {fmt.usd(reserve.totalBorrowUsd, { compact: true })}
          </div>
          <CapBarFull label="Cap" used={reserve.totalBorrow} total={reserve.borrowCap} />
        </div>
        <div className="card" style={{ padding: 18 }}>
          <Eyebrow>Utilization</Eyebrow>
          <div className="mono tabular" style={{ fontSize: 26, marginTop: 6, color: "var(--fg1)" }}>
            {fmt.pct(utilization, 1)}
          </div>
          <CapBarFull label="of optimal" used={utilization} total={reserve.optimalUsageRatio} colorOk="var(--fg-brand)" colorWarn="var(--hf-warn)" />
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
          <IRCurveChart reserve={reserve} />
        </div>
      </div>

      {/* Token addresses */}
      <div style={{ marginTop: 28 }}>
        <SectionTitle>Token addresses</SectionTitle>
        <div className="card" style={{ padding: "4px 20px" }}>
          <AddressRow label="Token contract" address={reserve.contract} explorerHref={explorerHref(chain, reserve.contract)} />
          <AddressRow label="aToken" address={reserve.aToken} explorerHref={explorerHref(chain, reserve.aToken)} />
          <AddressRow label="Variable debt token" address={reserve.varDebt} explorerHref={explorerHref(chain, reserve.varDebt)} />
          {reserve.solanaMint ? (
            <AddressRow
              label="Solana backing (mint)"
              address={reserve.solanaMint}
              explorerLabel="Solscan"
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

// chain.evmExplorer is a template containing the literal "${hash}"
// placeholder. Substitute the address in for a real link.
const explorerHref = (chain: ChainInfo, hash: string): string | undefined => {
  if (!chain.evmExplorer) return undefined;
  return chain.evmExplorer.includes("${hash}")
    ? chain.evmExplorer.replace("${hash}", hash)
    : `${chain.evmExplorer.replace(/\/$/, "")}/address/${hash}`;
};
const solanaExplorerHref = (chain: ChainInfo, mint: string): string | undefined => {
  if (!chain.solanaExplorer) return undefined;
  return chain.solanaExplorer.includes("${hash}")
    ? chain.solanaExplorer.replace("${hash}", mint)
    : `${chain.solanaExplorer.replace(/\/$/, "")}/address/${mint}`;
};

// ───────────────── ReserveStatusCard (left column) ─────────────────

const ReserveStatusCard = ({ reserve, utilization }: { reserve: Reserve; utilization: number }) => {
  const rows: Array<[string, React.ReactNode]> = [
    ["Utilization", fmt.pct(utilization, 1)],
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
    ["Supply cap", fmt.usd(reserve.supplyCap * reserve.priceUsd, { compact: true })],
    ["Borrow cap", fmt.usd(reserve.borrowCap * reserve.priceUsd, { compact: true })],
    ["E-mode category", <Tag tone={reserve.emodeCategory === "—" ? "neutral" : "brand"}>{reserve.emodeCategory}</Tag>],
    ["Isolation mode", reserve.isolation
      ? <Tag tone="warn">Yes</Tag>
      : <span style={{ color: "var(--fg3)" }}>No</span>],
  ];
  return (
    <div className="card" style={{ padding: "4px 20px" }}>
      <div style={{ padding: "16px 0 12px", borderBottom: "1px solid var(--border-subtle)" }}>
        <Eyebrow>Reserve status</Eyebrow>
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
          background: "rgba(197, 139, 198, 0.10)",
          border: "1px solid var(--border-brand)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--fg-brand)",
        }}>
          <IconWallet size={18} />
        </div>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 18 }}>Your info</div>
        <div style={{ color: "var(--fg2)", fontSize: 13 }}>
          Connect your wallet to supply, borrow, or repay {symbol}.
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
        <Eyebrow>Your info</Eyebrow>
        <span className="mono" style={{ fontSize: 11, color: "var(--fg2)" }}>
          Wallet:{" "}
          <span style={{ color: "var(--fg1)" }} className="tabular">
            {fmt.num(position.walletBalance, 4)} {symbol}
          </span>
        </span>
      </div>

      {/* Supply box */}
      <div style={{ padding: "16px 0" }}>
        <div style={infoRowStyle}>
          <span style={infoLabelStyle}>Supplied</span>
          <span className="mono tabular" style={{ color: "var(--fg1)" }}>
            {fmt.num(position.suppliedBalance, 4)} {symbol}
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
            {fmt.num(position.debtBalance, 4)} {symbol}
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
            {fmt.usd(availableBorrowsUsd, { compact: true })}
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
}: {
  label: string;
  used: number;
  total: number;
  colorOk?: string;
  colorWarn?: string;
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
        <span>{label} {fmt.pct(pct, 0)}</span>
        <span className="tabular" style={{ color: "var(--fg2)" }}>
          {fmt.num(used, 0)}/{fmt.num(total, 0)}
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
  const W = 720, H = 220, padL = 50, padR = 16, padT = 18, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const U_opt = reserve.optimalUsageRatio;
  const maxRate = reserve.slope1 + reserve.slope2 + 0.04;

  // Variable borrow rate as a function of utilization. Above the kink
  // (U_opt) the curve steepens by slope2 / (1 - U_opt).
  const rateAt = (u: number) => {
    if (u <= U_opt) return (u / U_opt) * reserve.slope1;
    return reserve.slope1 + ((u - U_opt) / (1 - U_opt)) * reserve.slope2;
  };
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= 100; i++) {
    const u = i / 100;
    points.push([padL + (u * innerW), padT + innerH - (rateAt(u) / maxRate) * innerH]);
  }
  const path = "M " + points.map((p) => p.join(",")).join(" L ");
  const cur = reserve.totalSupply > 0 ? reserve.totalBorrow / reserve.totalSupply : 0;
  const curX = padL + cur * innerW;
  const curY = padT + innerH - (rateAt(cur) / maxRate) * innerH;
  const kinkX = padL + U_opt * innerW;
  const kinkY = padT + innerH - (rateAt(U_opt) / maxRate) * innerH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, height: "auto", display: "block" }}>
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
          <stop offset="0%" stopColor="#C58BC6" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#C58BC6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path} fill="none" stroke="var(--fg-brand)" strokeWidth="2" />
      <line x1={kinkX} x2={kinkX} y1={kinkY} y2={padT + innerH} stroke="var(--border-default)" strokeDasharray="3 3" />
      <circle cx={kinkX} cy={kinkY} r="3" fill="var(--fg-brand)" />
      <text x={kinkX + 8} y={kinkY - 8} fill="var(--fg2)" fontSize="10" fontFamily="var(--font-mono)">
        U_opt = {fmt.pct(U_opt, 0)}
      </text>
      <line x1={curX} x2={curX} y1={curY} y2={padT + innerH} stroke="var(--hf-warn)" strokeDasharray="2 2" />
      <circle cx={curX} cy={curY} r="5" fill="var(--hf-warn)" stroke="var(--bg-surface)" strokeWidth="2" />
      <text x={curX + 8} y={curY + 14} fill="var(--hf-warn)" fontSize="11" fontFamily="var(--font-mono)" fontWeight="500">
        Current · {fmt.pct(cur, 1)}
      </text>
      <text x={W / 2} y={H - 4} fill="var(--fg2)" fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" letterSpacing="0.1em">
        UTILIZATION
      </text>
      <text x={12} y={padT + 4} fill="var(--fg2)" fontSize="10" fontFamily="var(--font-mono)" letterSpacing="0.1em">
        BORROW APY
      </text>
    </svg>
  );
};
