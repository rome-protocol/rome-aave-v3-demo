"use client";

// ActionModal — supply / withdraw / borrow / repay. Phase machine:
//   editing | error → AmountInput + overview + submit button
//   approving       → spinner + (when present) approve-tx link
//   executing       → spinner + (when present) action-tx link
//   success         → check + amount + explorer link + close button
// useAaveAction owns the wire-level state. LiquidationModal +
// FlashLoanContent each have their own phase-machine hook.

import { useEffect, useMemo, useState } from "react";
import {
  AmountInput,
  Banner,
  Button,
  Eyebrow,
} from "@/components/primitives";
import { AssetSymbol } from "@/components/primitives";
import {
  IconAlert,
  IconCheck,
  IconClose,
  IconExternal,
} from "@/components/icons";
import { evmExplorerTxUrl } from "@/lib/registry-config";
import { fmt } from "@/lib/format";
import { hadrian } from "@/lib/wagmi";
import { useAaveAction, type ActionMode } from "@/hooks/useAaveAction";
import { projectHealthFactor, type HfProjection } from "@/lib/hf-projection";
import { hfTierStyle } from "@/components/primitives";
import { checkActionSafety } from "@/lib/liquidity-guard";
import type { Reserve, UserPosition, UserAggregate } from "@/lib/types";

const PHASE_VERBS: Record<ActionMode, { title: string; verb: string; past: string }> = {
  supply:   { title: "Supply",   verb: "Supply",   past: "Supplied" },
  withdraw: { title: "Withdraw", verb: "Withdraw", past: "Withdrew" },
  borrow:   { title: "Borrow",   verb: "Borrow",   past: "Borrowed" },
  repay:    { title: "Repay",    verb: "Repay",    past: "Repaid" },
};

export interface ActionIntent {
  mode: ActionMode;
  symbol: string;
}

export interface ActionModalProps {
  open: boolean;
  intent: ActionIntent | null;
  reserve: Reserve | undefined;
  position: UserPosition | undefined;
  aggregate: UserAggregate | undefined;
  pool: `0x${string}` | undefined;
  availableBorrowsUsd: number;
  onClose: () => void;
}

export function ActionModal({
  open,
  intent,
  reserve,
  position,
  aggregate,
  pool,
  availableBorrowsUsd,
  onClose,
}: ActionModalProps) {
  if (!open || !intent || !reserve) return null;
  return (
    <ActionModalInner
      intent={intent}
      reserve={reserve}
      position={position}
      aggregate={aggregate}
      pool={pool}
      availableBorrowsUsd={availableBorrowsUsd}
      onClose={onClose}
    />
  );
}

interface InnerProps {
  intent: ActionIntent;
  reserve: Reserve;
  position: UserPosition | undefined;
  aggregate: UserAggregate | undefined;
  pool: `0x${string}` | undefined;
  availableBorrowsUsd: number;
  onClose: () => void;
}

const ActionModalInner = ({
  intent,
  reserve,
  position,
  aggregate,
  pool,
  availableBorrowsUsd,
  onClose,
}: InnerProps) => {
  const { mode, symbol } = intent;

  // Reset the form when the modal target changes (mode / symbol).
  const initialAmount = defaultInitialAmount(mode, reserve, position, availableBorrowsUsd);
  const [amount, setAmount] = useState<string>(initialAmount);

  useEffect(() => {
    setAmount(initialAmount);
    // initialAmount is recomputed each render from {mode, reserve, position,
    // availableBorrowsUsd}; only reset when intent.mode/symbol identity
    // changes to avoid clobbering user typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, symbol]);

  const action = useAaveAction({
    mode,
    asset: reserve.contract as `0x${string}`,
    pool,
    decimals: reserve.decimals,
    amount,
    // Full withdraw/repay → send MAX sentinel (see useAaveAction).
    maxAmount:
      mode === "withdraw"
        ? position?.suppliedBalance
        : mode === "repay"
          ? position?.debtBalance
          : undefined,
  });

  const verbs = PHASE_VERBS[mode];
  const showApproveStepper = action.needsApprove && (mode === "supply" || mode === "repay");

  const amtN = Number(amount) || 0;
  const amtUsd = amtN * reserve.priceUsd;

  const balanceLabel = useMemo(() => {
    if (mode === "supply") return { label: "Wallet", value: `${fmt.num(position?.walletBalance ?? 0)} ${symbol}` };
    if (mode === "withdraw") return { label: "Supplied", value: `${fmt.num(position?.suppliedBalance ?? 0)} ${symbol}` };
    if (mode === "borrow") {
      const avail = reserve.priceUsd > 0 ? availableBorrowsUsd / reserve.priceUsd : 0;
      return { label: "Available", value: `${fmt.num(avail, 4)} ${symbol}` };
    }
    return { label: "Debt", value: `${fmt.num(position?.debtBalance ?? 0)} ${symbol}` };
  }, [mode, position, reserve.priceUsd, availableBorrowsUsd, symbol]);

  const onMax = () => {
    if (mode === "supply") setAmount(String(position?.walletBalance ?? 0));
    else if (mode === "withdraw") setAmount(String(position?.suppliedBalance ?? 0));
    else if (mode === "borrow") {
      const avail = reserve.priceUsd > 0 ? availableBorrowsUsd / reserve.priceUsd : 0;
      setAmount(String(avail));
    } else setAmount(String(position?.debtBalance ?? 0));
  };

  // Project the post-action health factor once — feeds both the overview
  // display and the pre-submit guard (so withdraw/borrow that would drop HF
  // below 1 are caught before the user signs, instead of reverting raw).
  const projection = projectHealthFactor({
    mode,
    amountUsd: amtUsd,
    reserve,
    position,
    aggregate,
  });

  // Pre-submit safety guard across all four modes. Without this the user hits
  // raw Aave reverts: arithmetic underflow (withdraw past liquidity),
  // 0x6679996d HealthFactorLowerThanLiquidationThreshold (withdraw/borrow past
  // HF=1), 0x2c5211c6 InvalidAmount (borrow past pool cash), etc.
  const safetyCheck = checkActionSafety({
    mode,
    amountHuman: amount,
    symbol,
    decimals: reserve.decimals,
    priceUsd: reserve.priceUsd,
    walletBalance: position?.walletBalance,
    suppliedBalance: position?.suppliedBalance,
    debtBalance: position?.debtBalance,
    availableLiquidity: reserve.availableLiquidity,
    availableBorrowsUsd,
    totalSupply: reserve.totalSupply,
    supplyCap: reserve.supplyCap,
    frozen: reserve.frozen,
    canBeBorrowed: reserve.canBeBorrowed,
    projectedHfAfter: projection?.after,
  });

  const submitDisabled =
    action.amountRaw === 0n ||
    action.phase === "approving" ||
    action.phase === "executing" ||
    !safetyCheck.ok;

  const submitLabel = action.needsApprove
    ? `Approve ${symbol} and ${verbs.verb.toLowerCase()}`
    : `${verbs.verb} ${amount || "0"} ${symbol}`;

  const approveExplorer = action.approveHash ? evmExplorerTxUrl(hadrian.id, action.approveHash) : undefined;
  const executeExplorer = action.executeHash ? evmExplorerTxUrl(hadrian.id, action.executeHash) : undefined;

  return (
    <ModalShell
      open
      onClose={onClose}
      title={`${verbs.title} ${symbol}`}
      icon={<AssetSymbol symbol={symbol} size={26} />}
      width={480}
    >
      {/* Editing / error — form */}
      {(action.phase === "editing" || action.phase === "error") ? (
        <>
          <AmountInput
            value={amount}
            onChange={(v) => {
              setAmount(v);
              if (action.phase === "error") action.reset();
            }}
            suffix={symbol}
            balanceLabel={balanceLabel.label}
            balanceValue={balanceLabel.value}
            onMax={onMax}
            autoFocus
          />
          <div style={{ marginTop: -8, fontSize: 12, color: "var(--fg2)" }}>
            ≈{" "}
            <span className="mono tabular" style={{ color: "var(--fg1)" }}>
              {fmt.usd(amtUsd)}
            </span>
          </div>

          {!safetyCheck.ok && safetyCheck.message ? (
            <Banner variant="warn" icon={<IconAlert size={16} />}>{safetyCheck.message}</Banner>
          ) : null}

          {action.phase === "error" && action.error ? (
            <Banner variant="danger" icon={<IconAlert size={16} />}>{action.error}</Banner>
          ) : null}

          <TransactionOverview
            mode={mode}
            reserve={reserve}
            projection={projection}
          />

          {showApproveStepper ? <ApproveStepper step1Done={false} /> : null}
        </>
      ) : null}

      {/* Approving — spinner + (when known) approve-tx link */}
      {action.phase === "approving" ? (
        <>
          <SpinnerRow caption={`Approving ${symbol} for Pool…`} />
          {approveExplorer ? (
            <TxLinkRow label="Approval transaction" hash={action.approveHash!} href={approveExplorer} />
          ) : null}
          <ApproveStepper step1Done={false} />
        </>
      ) : null}

      {/* Executing — spinner + action hash if available */}
      {action.phase === "executing" ? (
        <>
          <SpinnerRow caption={`Submitting ${verbs.verb.toLowerCase()}…`} />
          {executeExplorer ? (
            <TxLinkRow label={`${verbs.title} transaction`} hash={action.executeHash!} href={executeExplorer} />
          ) : null}
          {showApproveStepper ? <ApproveStepper step1Done /> : null}
        </>
      ) : null}

      {/* Success */}
      {action.phase === "success" ? (
        <>
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            padding: "24px 0",
          }}>
            <div style={successIconStyle}>
              <IconCheck size={24} />
            </div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: "var(--fg1)" }}>
              {verbs.past}.
            </div>
            <div style={{ color: "var(--fg2)", fontSize: 13 }}>
              {action.amountRaw ? `${fmt.num(amtN)} ${symbol} · ${fmt.usd(amtUsd)}` : symbol}
            </div>
            {executeExplorer ? (
              <a
                href={executeExplorer}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--fg-brand)",
                  textDecoration: "none",
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                }}
              >
                View transaction <IconExternal size={11} />
              </a>
            ) : null}
          </div>
        </>
      ) : null}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
        {(action.phase === "editing" || action.phase === "error") ? (
          <Button
            variant="primary"
            fullWidth
            size="lg"
            disabled={submitDisabled}
            onClick={() => void action.submit()}
          >
            {submitLabel}
          </Button>
        ) : null}
        {(action.phase === "approving" || action.phase === "executing") ? (
          <Button variant="secondary" fullWidth size="lg" disabled>
            <Spinner /> {action.phase === "approving" ? "Awaiting approval…" : "Submitting…"}
          </Button>
        ) : null}
        {action.phase === "success" ? (
          <Button variant="primary" fullWidth size="lg" onClick={onClose}>Close</Button>
        ) : null}
      </div>
    </ModalShell>
  );
};

// ────────────── ModalShell ──────────────

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  width?: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const ModalShell = ({
  open,
  onClose,
  title,
  icon,
  width = 460,
  children,
  footer,
}: ModalShellProps) => {
  if (!open) return null;
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "var(--bg-overlay)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div style={{
        width: `min(${width}px, 100%)`,
        maxHeight: "calc(100vh - 48px)",
        overflowY: "auto",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--r-md)",
        boxShadow: "0 40px 80px -20px rgba(0,0,0,0.7)",
        display: "flex",
        flexDirection: "column",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 22px",
          borderBottom: "1px solid var(--border-subtle)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {icon}
            <h2 style={{
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontWeight: 400,
              fontSize: 20,
              color: "var(--fg1)",
              letterSpacing: "-0.01em",
            }}>
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--fg2)",
              padding: 4,
              borderRadius: "var(--r-sm)",
              cursor: "pointer",
            }}
          >
            <IconClose size={16} />
          </button>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>{children}</div>
        {footer ? <div style={{ padding: "16px 22px", borderTop: "1px solid var(--border-subtle)" }}>{footer}</div> : null}
      </div>
    </div>
  );
};

// ────────────── Spinner ──────────────

export const Spinner = ({ size = 14 }: { size?: number }) => (
  <span
    style={{
      width: size,
      height: size,
      display: "inline-block",
      border: "2px solid var(--border-default)",
      borderTopColor: "var(--fg1)",
      borderRadius: "50%",
      animation: "ramSpin 700ms linear infinite",
    }}
  >
    <style>{`@keyframes ramSpin { to { transform: rotate(360deg) } }`}</style>
  </span>
);

export const SpinnerRow = ({ caption }: { caption: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0" }}>
    <Spinner size={16} />
    <span className="mono" style={{ fontSize: 12, color: "var(--fg2)", letterSpacing: "0.04em" }}>{caption}</span>
  </div>
);

export const TxLinkRow = ({ label, hash, href }: { label: string; hash: `0x${string}`; href: string }) => (
  <div style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--r-md)",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
  }}>
    <span style={{ color: "var(--fg2)" }}>{label}</span>
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{ color: "var(--fg-brand)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {fmt.addr(hash, 8, 6)} <IconExternal size={11} />
    </a>
  </div>
);

// ────────────── ApproveStepper ──────────────

export const ApproveStepper = ({ step1Done }: { step1Done: boolean }) => (
  <div style={{
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    background: "var(--bg-surface-2)",
    borderRadius: "var(--r-pill)",
    border: "1px solid var(--border-subtle)",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: "var(--fg2)",
    letterSpacing: "0.06em",
  }}>
    <span style={{
      width: 14, height: 14, borderRadius: 14,
      background: step1Done ? "var(--hf-safe)" : "var(--rome-purple)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      color: step1Done ? "var(--on-safe)" : "var(--on-rome-purple)",
    }}>
      {step1Done ? <IconCheck size={9} /> : <span style={{ fontSize: 9 }}>1</span>}
    </span>
    <span style={{ color: step1Done ? "var(--fg2)" : "var(--fg1)", textTransform: "uppercase" }}>Approve</span>
    <span style={{ width: 22, height: 1, background: "var(--border-default)" }} />
    <span style={{
      width: 14, height: 14, borderRadius: 14,
      background: step1Done ? "var(--rome-purple)" : "var(--bg-surface-3)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      color: step1Done ? "var(--on-rome-purple)" : "var(--fg3)",
    }}>
      <span style={{ fontSize: 9 }}>2</span>
    </span>
    <span style={{ color: step1Done ? "var(--fg1)" : "var(--fg2)", textTransform: "uppercase" }}>Submit</span>
  </div>
);

// ────────────── TransactionOverview ──────────────
// Shows the APY context for the action. Dropped the HF projection from
// the JSX original — those values were hardcoded mock projections;
// real-time projections would need replaying the V3 calc here, which is
// out of scope for slice 4a. Add back in slice 4b if needed.

const TransactionOverview = ({
  mode,
  reserve,
  projection,
}: {
  mode: ActionMode;
  reserve: Reserve;
  projection: HfProjection | null;
}) => (
  <div style={{
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--r-md)",
    padding: "10px 14px",
    background: "var(--bg-surface-2)",
  }}>
    <Eyebrow style={{ paddingBottom: 6 }}>Transaction overview</Eyebrow>
    <OverviewRow
      label={mode === "supply" || mode === "withdraw" ? "Supply APY" : "Borrow APY"}
      value={fmt.pct(mode === "supply" || mode === "withdraw" ? reserve.supplyApy : reserve.borrowApy)}
    />
    {(mode === "supply" || mode === "withdraw") && reserve.canBeCollateral ? (
      <OverviewRow
        label="Collateral"
        value={mode === "supply" ? "Enabled by default" : "Stays enabled"}
      />
    ) : null}
    {projection && !projection.bothInfinite ? (
      <OverviewRow
        label="Health Factor"
        value={<HfDelta before={projection.before} after={projection.after} />}
      />
    ) : null}
  </div>
);

const HfDelta = ({ before, after }: { before: number; after: number }) => {
  const tierBefore = hfTierStyle(before);
  const tierAfter = hfTierStyle(after);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span
        className="mono tabular"
        style={{ color: tierBefore?.color ?? "var(--fg2)" }}
      >
        {fmt.hf(before)}
      </span>
      <span style={{ color: "var(--fg3)" }}>→</span>
      <span
        className="mono tabular"
        style={{ color: tierAfter?.color ?? "var(--fg1)", fontWeight: 500 }}
      >
        {fmt.hf(after)}
      </span>
    </span>
  );
};

export const OverviewRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
    borderTop: "1px solid var(--border-subtle)",
    fontSize: 13,
  }}>
    <span style={{ color: "var(--fg2)" }}>{label}</span>
    <span style={{ color: "var(--fg1)", fontFamily: "var(--font-mono)" }}>{value}</span>
  </div>
);

// ────────────── helpers ──────────────

const successIconStyle: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 56,
  background: "var(--hf-safe-bg)",
  border: "1px solid var(--hf-safe)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--hf-safe)",
};

const defaultInitialAmount = (
  mode: ActionMode,
  reserve: Reserve,
  position: UserPosition | undefined,
  availableBorrowsUsd: number,
): string => {
  // Seed each mode with a sensible default so the user doesn't start at 0.
  // For supply we pick min(wallet, 100). For borrow we pick min(available, 100).
  // For repay/withdraw we pick min(position, 50).
  switch (mode) {
    case "supply": {
      const wallet = position?.walletBalance ?? 0;
      return toPlainAmount(Math.min(wallet, sensibleDefault(reserve.symbol)), reserve.decimals);
    }
    case "borrow": {
      const avail = reserve.priceUsd > 0 ? availableBorrowsUsd / reserve.priceUsd : 0;
      return toPlainAmount(Math.min(avail, sensibleDefault(reserve.symbol)), reserve.decimals);
    }
    case "repay":   return toPlainAmount(Math.min(position?.debtBalance ?? 0, sensibleDefault(reserve.symbol) / 2), reserve.decimals);
    case "withdraw":return toPlainAmount(Math.min(position?.suppliedBalance ?? 0, sensibleDefault(reserve.symbol) / 2), reserve.decimals);
  }
};

// String() on a small float yields scientific notation ("1e-7") which
// parseUnits rejects → amountRaw=0n → silently-disabled submit. toFixed avoids
// the exponent; we cap at the token's decimals and strip trailing zeros.
const toPlainAmount = (n: number, decimals: number): string => {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return n.toFixed(Math.min(decimals, 18)).replace(/\.?0+$/, "") || "0";
};

// USD-equivalent ~$100 default per symbol — keeps the demo intuitive for
// USDC/HEAT/MILK (low decimals, big balances) and ETH/SOL (high decimals,
// fractional balances).
const sensibleDefault = (symbol: string): number => {
  switch (symbol) {
    case "ETH":  return 0.05;
    case "SOL":  return 0.5;
    case "WBTC": return 0.002;
    default:     return 100;
  }
};
