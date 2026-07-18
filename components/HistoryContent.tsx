"use client";

// /history — read-only activity log. Backed by /api/history via
// useUserHistory. Each row expands to surface block + tx timestamp;
// the per-sig Solana timeline lives on the EVM explorer (the API
// indexes signature counts only).

import { useState } from "react";
import { useAccount } from "wagmi";
import { useUniWallet } from "@/hooks/useUniWallet";
import {
  Banner,
  Button,
  Container,
  Eyebrow,
  Tag,
  WalletPrompt,
  AssetSymbol,
} from "@/components/primitives";
import { PageHeader, PageFooter } from "@/components/PageHeader";
import {
  IconAlert,
  IconArrowDown,
  IconArrowUp,
  IconArrowURDown,
  IconArrowURUp,
  IconBolt,
  IconBoom,
  IconChevronDown,
  IconExternal,
} from "@/components/icons";
import type { FC, ReactNode } from "react";
import { useAaveConfig, useUserHistory } from "@/hooks/useAaveData";
import { useTxSolanaSigs } from "@/hooks/useTxSolanaSigs";
import { fmt } from "@/lib/format";
import { evmExplorerTxUrl, solanaExplorerTxUrl, fallbackChainInfo } from "@/lib/registry-config";
import { hadrian } from "@/lib/wagmi";
import type { ChainInfo, HistoryRow, Reserve } from "@/lib/types";

const pageShell: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-canvas)",
  color: "var(--fg1)",
  fontFamily: "var(--font-sans)",
  display: "flex",
  flexDirection: "column",
};

const fallbackChainStub: ChainInfo = fallbackChainInfo;

type ActionFilter = "All" | HistoryRow["action"];

interface ActionMeta {
  Icon: FC<{ size?: number }>;
  tone: "safe" | "warn" | "danger" | "brand" | "neutral";
  verb: string;
}

const ACTION_META: Record<HistoryRow["action"], ActionMeta> = {
  Supply:          { Icon: IconArrowDown,   tone: "safe",    verb: "Supplied" },
  Borrow:          { Icon: IconArrowUp,     tone: "warn",    verb: "Borrowed" },
  Repay:           { Icon: IconArrowURUp,   tone: "safe",    verb: "Repaid"   },
  Withdraw:        { Icon: IconArrowURDown, tone: "neutral", verb: "Withdrew" },
  FlashLoan:       { Icon: IconBolt,        tone: "brand",   verb: "Flash loaned" },
  LiquidationCall: { Icon: IconBoom,        tone: "danger",  verb: "Liquidated"   },
};

const ACTION_OPTIONS: ActionFilter[] = ["All", "Supply", "Borrow", "Repay", "Withdraw", "FlashLoan", "LiquidationCall"];

export function HistoryContent() {
  const cfg = useAaveConfig();
  const hist = useUserHistory(50);
  const { isConnected } = useAccount();
  const wallet = useUniWallet();
  const openConnectModal = () => wallet.openFilteredWalletModal("evm");

  const [typeFilter, setTypeFilter] = useState<ActionFilter>("All");
  const [assetFilter, setAssetFilter] = useState<string>("Any");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
          Couldn&rsquo;t reach the chain RPC. Reserve data is unavailable.
        </Banner>
      </ShellWithPlaceholder>
    );
  }

  const { chain, reserves } = cfg.data;
  const reservesBySymbol: Record<string, Reserve> = Object.fromEntries(
    reserves.map((r) => [r.symbol, r]),
  );
  const symbolOptions = ["Any", ...reserves.map((r) => r.symbol)];

  if (!isConnected) {
    return (
      <div style={pageShell}>
        <PageHeader chain={chain} />
        <Container max={1280} style={{ paddingTop: 20, paddingBottom: 40 }}>
          <PageHero eyebrow="History" title="Your activity" />
          <div style={{ paddingTop: 24 }}>
            <WalletPrompt onConnect={openConnectModal} />
          </div>
        </Container>
        <PageFooter chain={chain} />
      </div>
    );
  }

  const rows = hist.data?.rows ?? [];
  const filtered = rows.filter((h) => {
    if (typeFilter !== "All" && h.action !== typeFilter) return false;
    if (assetFilter !== "Any" && h.symbol !== assetFilter) return false;
    return true;
  });

  const groups: Record<string, HistoryRow[]> = {};
  for (const h of filtered) {
    (groups[h.day] = groups[h.day] || []).push(h);
  }

  return (
    <div style={pageShell}>
      <PageHeader chain={chain} />
      <Container max={1280} style={{ paddingTop: 20, paddingBottom: 40, display: "flex", flexDirection: "column", gap: 22 }}>
        <PageHero
          eyebrow="History"
          title={<>Your <i>activity</i>.</>}
          sub={`All of your supplies, borrows, repays, withdraws, flash loans, and liquidations on ${chain.displayName}.`}
        />

        <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <FilterPill label="Type" value={typeFilter} options={ACTION_OPTIONS} onChange={(v) => setTypeFilter(v as ActionFilter)} />
          <FilterPill label="Asset" value={assetFilter} options={symbolOptions} onChange={setAssetFilter} />
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--fg2)", fontFamily: "var(--font-mono)" }}>
            {filtered.length} events
          </span>
        </div>

        {hist.isError ? (
          <Banner
            variant="danger"
            icon={<IconAlert size={16} />}
            action={<Button variant="secondary" size="sm" onClick={() => void hist.refetch()}>Retry</Button>}
          >
            History backend unreachable.
          </Banner>
        ) : null}

        {filtered.length === 0 ? (
          <div className="card" style={{ padding: "48px 32px", textAlign: "center", color: "var(--fg2)", fontSize: 14 }}>
            No activity matches the current filters.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {Object.entries(groups).map(([day, dayRows]) => (
              <DayGroup
                key={day}
                day={day}
                rows={dayRows}
                reservesBySymbol={reservesBySymbol}
                expanded={expanded}
                onToggle={(k) => setExpanded((e) => ({ ...e, [k]: !e[k] }))}
              />
            ))}
          </div>
        )}
      </Container>
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

// ───────────────── PageHero ─────────────────

const PageHero = ({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: string }) => (
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
    {sub ? <div style={{ marginTop: 8, color: "var(--fg2)", fontSize: 14, maxWidth: 560 }}>{sub}</div> : null}
  </div>
);

// ───────────────── DayGroup ─────────────────

const DayGroup = ({
  day,
  rows,
  reservesBySymbol,
  expanded,
  onToggle,
}: {
  day: string;
  rows: HistoryRow[];
  reservesBySymbol: Record<string, Reserve>;
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
}) => (
  <div>
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
      <h3 style={{
        margin: 0,
        fontFamily: "var(--font-serif)",
        fontWeight: 400,
        fontSize: 18,
        color: "var(--fg1)",
        letterSpacing: "-0.005em",
      }}>
        {day}
      </h3>
      <div style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
      <span style={{ fontSize: 11, color: "var(--fg2)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>
        {rows.length} events
      </span>
    </div>
    <div className="card" style={{ padding: 0 }}>
      {rows.map((row, i) => {
        const key = `${day}-${row.evmHash}-${i}`;
        return (
          <HistoryRowItem
            key={key}
            row={row}
            reserve={reservesBySymbol[row.symbol]}
            expanded={!!expanded[key]}
            onToggle={() => onToggle(key)}
            isLast={i === rows.length - 1}
          />
        );
      })}
    </div>
  </div>
);

// ───────────────── HistoryRowItem ─────────────────

const HistoryRowItem = ({
  row,
  reserve,
  expanded,
  onToggle,
  isLast,
}: {
  row: HistoryRow;
  reserve: Reserve | undefined;
  expanded: boolean;
  onToggle: () => void;
  isLast: boolean;
}) => {
  const meta = ACTION_META[row.action] ?? ACTION_META.Supply;
  const Icon = meta.Icon;
  const tone = meta.tone;

  const toneColor =
    tone === "safe"   ? "var(--hf-safe)"
    : tone === "warn"   ? "var(--hf-warn)"
    : tone === "danger" ? "var(--hf-danger)"
    : tone === "brand"  ? "var(--fg-brand)"
    : "var(--fg2)";
  const toneBg =
    tone === "safe"   ? "var(--hf-safe-bg)"
    : tone === "warn"   ? "var(--hf-warn-bg)"
    : tone === "danger" ? "var(--hf-danger-bg)"
    : tone === "brand"  ? "rgba(197, 139, 198, 0.10)"
    : "var(--bg-surface-2)";

  const priceUsd = reserve?.priceUsd ?? 0;
  const evmExplorer = evmExplorerTxUrl(hadrian.id, row.evmHash);

  return (
    <div style={{ borderBottom: isLast ? "none" : "1px solid var(--border-subtle)" }}>
      <div
        onClick={onToggle}
        style={{
          display: "grid",
          gridTemplateColumns: "44px 1fr auto auto",
          gap: 14,
          padding: "16px 20px",
          cursor: "pointer",
          alignItems: "center",
        }}
      >
        <div style={{
          width: 36, height: 36,
          borderRadius: "var(--r-pill)",
          background: toneBg,
          border: `1px solid ${toneColor}`,
          color: toneColor,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <Icon size={14} />
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "var(--fg1)", fontWeight: 500 }}>{meta.verb}</span>
            <span className="mono tabular" style={{ color: "var(--fg1)" }}>{fmt.num(row.amount)} {row.symbol}</span>
            <span style={{ color: "var(--fg2)", fontSize: 12 }}>· {fmt.usd(row.amount * priceUsd, { compact: true })}</span>
            {row.liqRole === "liquidator" ? <Tag tone="success">As liquidator</Tag> : null}
            {row.liqRole === "liquidatee" ? <Tag tone="danger">Liquidated</Tag> : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 4, color: "var(--fg2)", fontSize: 11, flexWrap: "wrap" }}>
            <span>{row.time}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              EVM{" "}
              {evmExplorer ? (
                <a
                  href={evmExplorer}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="mono"
                  style={{ color: "var(--fg-brand)", textDecoration: "none" }}
                >
                  {fmt.addr(row.evmHash, 6, 4)}
                </a>
              ) : (
                <span className="mono">{fmt.addr(row.evmHash, 6, 4)}</span>
              )}
              <IconExternal size={10} />
            </span>
            <SolanaSigSummary
              txHash={row.evmHash}
              expanded={expanded}
            />
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <AssetSymbol symbol={row.symbol} size={22} />
        </div>
        <div></div>
      </div>
      {expanded ? (
        <div style={{
          padding: "0 20px 16px 76px",
          color: "var(--fg2)",
          fontSize: 12,
        }}>
          <SolanaSigPanel
            txHash={row.evmHash}
            blockNumber={row.blockNumber}
            timestamp={row.timestamp}
          />
        </div>
      ) : null}
    </div>
  );
};

// ───────────────── FilterPill ─────────────────
// Same shape as /liquidate. Kept inline rather than hoisting until a
// third consumer needs it.

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

// ───────────────── SolanaSigSummary (compact row label) ─────────────────
// The "Solana N sigs ▾" widget on the un-expanded row. Pre-expand we
// don't know the count yet; the hook only fires once `expanded` flips
// true. So we show a placeholder until then.

const SolanaSigSummary = ({
  txHash,
  expanded,
}: {
  txHash: string;
  expanded: boolean;
}) => {
  const { data } = useTxSolanaSigs(hadrian.id, txHash, expanded);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      Solana{" "}
      {data ? (
        <span className="mono" style={{ color: "var(--fg1)" }}>{data.count}</span>
      ) : (
        <span className="mono" style={{ color: "var(--fg3)" }}>…</span>
      )}{" "}
      sigs
      <span style={{
        display: "inline-flex",
        transform: expanded ? "rotate(180deg)" : "none",
        transition: "transform 120ms",
      }}>
        <IconChevronDown size={11} />
      </span>
    </span>
  );
};

// ───────────────── SolanaSigPanel (expanded-row body) ─────────────────
// Fetches from rome-via on first expand and lists every Solana signature
// behind this EVM tx. Each sig links to the Solana explorer with the
// chain's anchored cluster (?cluster=devnet for Hadrian) so the user
// gets a working trace, not a 404.

const SolanaSigPanel = ({
  txHash,
  blockNumber,
  timestamp,
}: {
  txHash: string;
  blockNumber: number;
  timestamp: number;
}) => {
  const { data, isLoading, isError, refetch } = useTxSolanaSigs(hadrian.id, txHash, true);

  return (
    <div style={{
      background: "var(--bg-surface-3)",
      border: "1px solid var(--border-subtle)",
      borderRadius: 8,
      padding: "10px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <div style={{
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--fg2)",
        fontSize: 10,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        Solana signatures
        {data ? <span style={{ color: "var(--fg1)" }}>· {data.count} sigs</span> : null}
      </div>

      {isLoading ? (
        <div style={{ color: "var(--fg2)" }}>Loading from rome-via…</div>
      ) : isError || !data ? (
        <div style={{ color: "var(--fg2)" }}>
          Couldn&rsquo;t reach rome-via.{" "}
          <button
            type="button"
            onClick={() => void refetch()}
            style={{
              background: "transparent",
              border: "1px solid var(--border-default)",
              color: "var(--fg-brand)",
              borderRadius: "var(--r-pill)",
              padding: "2px 10px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      ) : data.sigs.length === 0 ? (
        <div style={{ color: "var(--fg2)" }}>
          No Solana sigs indexed for this tx yet — try again in a moment.
        </div>
      ) : (
        <ol style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}>
          {data.sigs.map((leg, i) => {
            const url = solanaExplorerTxUrl(hadrian.id, leg.solSignature);
            const label = `${(i + 1).toString().padStart(2, "0")}.`;
            return (
              <li
                key={leg.solSignature}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px 1fr auto",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--fg2)",
                }}
              >
                <span style={{ color: "var(--fg3)" }}>{label}</span>
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: "var(--fg-brand)",
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {leg.solSignature}
                  </a>
                ) : (
                  <span style={{ color: "var(--fg1)" }}>{leg.solSignature}</span>
                )}
                <span style={{ color: "var(--fg3)" }}>{leg.solChain}</span>
              </li>
            );
          })}
        </ol>
      )}

      <div style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: "var(--fg3)",
        borderTop: "1px solid var(--border-subtle)",
        paddingTop: 6,
        marginTop: 2,
      }}>
        Block <span style={{ color: "var(--fg2)" }}>{blockNumber}</span>
        {timestamp ? <> · <span>{new Date(timestamp).toISOString()}</span></> : null}
      </div>
    </div>
  );
};
