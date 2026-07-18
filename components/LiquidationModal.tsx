"use client";

// LiquidationModal — drives Pool.liquidationCall through useAaveLiquidate.
// Caller picks a debtToCover amount (default = ½ debt, the V3 close
// factor on healthy markets) and the modal previews collateral-out +
// bonus before sign. Reuses ModalShell + Spinner + ApproveStepper +
// OverviewRow + SpinnerRow + TxLinkRow from ActionModal.tsx.

import { useEffect, useMemo, useState } from "react";
import {
  AmountInput,
  Banner,
  Button,
  Eyebrow,
  HealthFactorPill,
  Tag,
} from "@/components/primitives";
import { AssetSymbol } from "@/components/primitives";
import {
  ApproveStepper,
  ModalShell,
  OverviewRow,
  Spinner,
  SpinnerRow,
  TxLinkRow,
} from "@/components/ActionModal";
import {
  IconAlert,
  IconBoom,
  IconCheck,
  IconExternal,
} from "@/components/icons";
import { evmExplorerTxUrl } from "@/lib/registry-config";
import { fmt } from "@/lib/format";
import { hadrian } from "@/lib/wagmi";
import { useAaveLiquidate } from "@/hooks/useAaveLiquidate";
import type { AtRiskRow, Reserve } from "@/lib/types";

interface LiquidationModalProps {
  open: boolean;
  row: AtRiskRow | null;
  reservesBySymbol: Record<string, Reserve>;
  pool: `0x${string}` | undefined;
  onClose: () => void;
}

export function LiquidationModal({
  open,
  row,
  reservesBySymbol,
  pool,
  onClose,
}: LiquidationModalProps) {
  if (!open || !row) return null;
  return (
    <LiquidationModalInner
      row={row}
      reservesBySymbol={reservesBySymbol}
      pool={pool}
      onClose={onClose}
    />
  );
}

const LiquidationModalInner = ({
  row,
  reservesBySymbol,
  pool,
  onClose,
}: {
  row: AtRiskRow;
  reservesBySymbol: Record<string, Reserve>;
  pool: `0x${string}` | undefined;
  onClose: () => void;
}) => {
  const collat = reservesBySymbol[row.collatSym];
  const debt = reservesBySymbol[row.debtSym];

  // Aave V3 close factor: 50% normally, but 100% once HF < 0.95
  // (CLOSE_FACTOR_HF_THRESHOLD). A partial liquidation that leaves a
  // remaining debt below the protocol's MIN_LEFTOVER reverts with
  // MustNotLeaveDust (0xb629b0e4) — common on small positions. So when a
  // 100% close is allowed we default to the FULL debt and round UP slightly
  // (Aave caps debtToCover at the actual debt, so over-covering is safe and
  // dust-free); only in the 50%-close band do we floor to half.
  const fullClose = row.hf < 0.95;
  const maxDebtUsd = fullClose ? row.debtUsd : row.debtUsd / 2;

  const initialAmount = useMemo(() => {
    if (!debt || debt.priceUsd <= 0) return "0";
    const tokens = maxDebtUsd / debt.priceUsd;
    // Full close: round up + 1% headroom so accrued interest can't leave dust.
    // Partial: floor to stay under the 50% close factor.
    return fullClose ? String(Math.ceil(tokens * 1.01)) : String(Math.floor(tokens));
  }, [debt, maxDebtUsd, fullClose]);

  const [amount, setAmount] = useState<string>(initialAmount);

  useEffect(() => {
    setAmount(initialAmount);
    // Reset when targeting a different borrower.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.borrower]);

  const liquidate = useAaveLiquidate({
    collateralAsset: collat?.contract as `0x${string}` | undefined,
    debtAsset: debt?.contract as `0x${string}` | undefined,
    borrower: row.borrower as `0x${string}`,
    pool,
    debtDecimals: debt?.decimals ?? 0,
    debtToCover: amount,
  });

  if (!collat || !debt) {
    return (
      <ModalShell open onClose={onClose} title="Liquidate" width={500}>
        <Banner variant="danger" icon={<IconAlert size={16} />}>
          Reserve metadata missing for {row.collatSym} / {row.debtSym}.
        </Banner>
      </ModalShell>
    );
  }

  const amtN = Number(amount) || 0;
  const debtUsd = amtN * debt.priceUsd;
  const collatOutUsd = debtUsd * (1 + row.bonusPct);
  const collatOut = collat.priceUsd > 0 ? collatOutUsd / collat.priceUsd : 0;
  const bonusUsd = debtUsd * row.bonusPct;

  const approveExplorer = liquidate.approveHash ? evmExplorerTxUrl(hadrian.id, liquidate.approveHash) : undefined;
  const executeExplorer = liquidate.executeHash ? evmExplorerTxUrl(hadrian.id, liquidate.executeHash) : undefined;

  const showStepper = liquidate.needsApprove;
  const submitDisabled = liquidate.debtToCoverRaw === 0n || liquidate.phase === "approving" || liquidate.phase === "executing";

  return (
    <ModalShell
      open
      onClose={onClose}
      title={`Liquidate ${fmt.addr(row.borrower, 6, 4)}`}
      icon={
        <div style={{
          width: 28, height: 28, borderRadius: 28,
          background: "var(--hf-danger-bg)",
          border: "1px solid var(--hf-danger)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--hf-danger)",
        }}>
          <IconBoom size={14} />
        </div>
      }
      width={500}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <SwatchCard label="Collateral asset" symbol={row.collatSym} sub={fmt.usd(row.collatUsd, { compact: true })} />
        <SwatchCard label="Debt asset" symbol={row.debtSym} sub={fmt.usd(row.debtUsd, { compact: true })} />
      </div>

      {(liquidate.phase === "editing" || liquidate.phase === "error") ? (
        <>
          <AmountInput
            value={amount}
            onChange={(v) => {
              setAmount(v);
              if (liquidate.phase === "error") liquidate.reset();
            }}
            suffix={row.debtSym}
            balanceLabel="Max"
            balanceValue={`${fmt.usd(maxDebtUsd, { compact: true })} (${fullClose ? "full debt — 100% close" : "½ debt — 50% close"})`}
            onMax={() => setAmount(initialAmount)}
          />

          <div style={{
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--r-md)",
            padding: "10px 14px",
            background: "var(--bg-surface-2)",
          }}>
            <Eyebrow style={{ paddingBottom: 6 }}>You receive</Eyebrow>
            <OverviewRow
              label={`${row.collatSym} (incl. bonus)`}
              value={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span className="mono tabular" style={{ color: "var(--fg1)", fontWeight: 500 }}>~{fmt.num(collatOut)}</span>
                  <span style={{ color: "var(--fg2)" }}>{fmt.usd(collatOutUsd, { compact: true })}</span>
                </span>
              }
            />
            <OverviewRow
              label="Liquidation bonus"
              value={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--hf-safe)" }}>
                  +<span className="mono tabular">{fmt.usd(bonusUsd, { compact: true })}</span>
                  <Tag tone="success">{(row.bonusPct * 100).toFixed(1)}%</Tag>
                </span>
              }
            />
            <OverviewRow
              label="Borrower HF (current)"
              value={<HealthFactorPill hf={row.hf} size="sm" showLabel={false} />}
            />
          </div>

          {showStepper ? <ApproveStepper step1Done={false} /> : null}

          {liquidate.phase === "error" && liquidate.error ? (
            <Banner variant="danger" icon={<IconAlert size={16} />}>{liquidate.error}</Banner>
          ) : null}

          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={submitDisabled}
            onClick={() => void liquidate.submit()}
          >
            {liquidate.needsApprove ? `Approve ${row.debtSym} and liquidate` : "Liquidate"}
          </Button>
        </>
      ) : null}

      {liquidate.phase === "approving" ? (
        <>
          <SpinnerRow caption={`Approving ${row.debtSym} for Pool…`} />
          {approveExplorer ? (
            <TxLinkRow label="Approval transaction" hash={liquidate.approveHash!} href={approveExplorer} />
          ) : null}
          <ApproveStepper step1Done={false} />
        </>
      ) : null}

      {liquidate.phase === "executing" ? (
        <>
          <SpinnerRow caption="Liquidating…" />
          {executeExplorer ? (
            <TxLinkRow label="Liquidation transaction" hash={liquidate.executeHash!} href={executeExplorer} />
          ) : null}
          {showStepper ? <ApproveStepper step1Done /> : null}
        </>
      ) : null}

      {liquidate.phase === "success" ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "24px 0" }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: 56,
            background: "var(--hf-safe-bg)",
            border: "1px solid var(--hf-safe)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--hf-safe)",
          }}>
            <IconCheck size={24} />
          </div>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: "var(--fg1)" }}>
            Liquidation complete.
          </div>
          <div style={{ color: "var(--fg2)", fontSize: 13 }}>
            ~{fmt.num(collatOut)} {row.collatSym} received · {fmt.usd(collatOutUsd, { compact: true })}
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
      ) : null}

      {liquidate.phase === "approving" || liquidate.phase === "executing" ? (
        <Button variant="secondary" fullWidth size="lg" disabled>
          <Spinner /> {liquidate.phase === "approving" ? "Awaiting approval…" : "Submitting…"}
        </Button>
      ) : null}

      {liquidate.phase === "success" ? (
        <Button variant="primary" fullWidth size="lg" onClick={onClose}>Close</Button>
      ) : null}
    </ModalShell>
  );
};

const SwatchCard = ({ label, symbol, sub }: { label: string; symbol: string; sub: string }) => (
  <div style={{
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--r-md)",
    padding: 12,
  }}>
    <Eyebrow style={{ marginBottom: 8 }}>{label}</Eyebrow>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <AssetSymbol symbol={symbol} size={24} />
      <span style={{ marginLeft: "auto", color: "var(--fg2)", fontSize: 12 }} className="mono tabular">{sub}</span>
    </div>
  </div>
);
