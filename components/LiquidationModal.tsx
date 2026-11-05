"use client";

// LiquidationModal — drives Pool.liquidationCall through useAaveLiquidate.
// Caller picks a debtToCover amount (default per Aave v3.6, see
// lib/liquidation-amount.ts) and the modal previews collateral-out +
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
import { fmt, fmtAmount, fmtUsd } from "@/lib/format";
import { defaultDebtUsd, previewCollateral, toTokenString } from "@/lib/liquidation-amount";
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

  // Default amount follows Aave v3.6 (see lib/liquidation-amount.ts): full debt on small
  // positions or HF <= 0.95, else at most half the total debt, lowered so no dust is left.
  const def = useMemo(
    () => defaultDebtUsd({ hf: row.hf, totalDebtUsd: row.debtUsd, debtAssetUsd: row.debtAssetUsd, collatUsd: row.collatUsd, bonusPct: row.bonusPct }),
    [row.hf, row.debtUsd, row.debtAssetUsd, row.collatUsd, row.bonusPct],
  );
  const initialAmount = useMemo(
    () => (debt ? toTokenString(def.usd, debt.priceUsd, debt.decimals, def.full) : "0"),
    [debt, def],
  );

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
          Market data missing for {row.collatSym} / {row.debtSym}.
        </Banner>
      </ModalShell>
    );
  }

  const amtN = Number(amount) || 0;
  const debtUsd = amtN * debt.priceUsd;
  const { outUsd: collatOutUsd, tokens: collatOut, bonusUsd } = previewCollateral(debtUsd, row.bonusPct, row.collatUsd, collat.priceUsd);

  const approveExplorer = liquidate.approveHash ? evmExplorerTxUrl(hadrian.id, liquidate.approveHash) : undefined;
  const executeExplorer = liquidate.executeHash ? evmExplorerTxUrl(hadrian.id, liquidate.executeHash) : undefined;

  const showStepper = liquidate.needsApprove;
  const busy = ["funding", "approving", "executing", "sweeping"].includes(liquidate.phase);
  const submitDisabled = liquidate.debtToCoverRaw === 0n || busy;

  return (
    <ModalShell
      open
      onClose={onClose}
      title={`Liquidate ${fmt.addr(row.borrower, 6, 4)}`}
      dismissible={!busy}
      dismissOnGround={false}
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
        <SwatchCard label="Collateral" symbol={row.collatSym} sub={fmtUsd(row.collatUsd)} />
        <SwatchCard label="Debt" symbol={row.debtSym} sub={fmtUsd(row.debtAssetUsd)} />
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
            balanceValue={`${fmtUsd(def.usd)} (${def.full ? "full debt" : "max allowed"})`}
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
                  <span className="mono tabular" style={{ color: "var(--fg1)", fontWeight: 500 }}>~{fmtAmount(collatOut)}</span>
                  <span style={{ color: "var(--fg2)" }}>{fmtUsd(collatOutUsd)}</span>
                </span>
              }
            />
            <OverviewRow
              label="Liquidation bonus"
              value={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--hf-safe)" }}>
                  +<span className="mono tabular">{fmtUsd(bonusUsd)}</span>
                  <Tag tone="success">{(row.bonusPct * 100).toFixed(1)}%</Tag>
                </span>
              }
            />
            <OverviewRow
              label="Borrower HF"
              value={<HealthFactorPill hf={row.hf} size="sm" showLabel={false} dp={3} />}
            />
          </div>

          {showStepper ? <ApproveStepper step1Done={false} /> : null}

          {liquidate.phase === "error" && liquidate.error ? (
            <Banner variant="danger" icon={<IconAlert size={16} />}>{liquidate.error}</Banner>
          ) : null}
          {liquidate.phase === "error" && executeExplorer ? (
            <TxLinkRow label="Liquidation transaction" hash={liquidate.executeHash!} href={executeExplorer} />
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

      {liquidate.phase === "funding" ? <SpinnerRow caption={`Moving ${row.debtSym} from your wallet…`} /> : null}
      {liquidate.phase === "sweeping" ? <SpinnerRow caption="Sending collateral to your wallet…" /> : null}

      {liquidate.phase === "approving" ? (
        <>
          <SpinnerRow caption={`Approving ${row.debtSym}…`} />
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
            Done.
          </div>
          <div style={{ color: "var(--fg2)", fontSize: 13 }}>
            ~{fmtAmount(collatOut)} {row.collatSym} received · {fmtUsd(collatOutUsd)}
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

      {busy ? (
        <Button variant="secondary" fullWidth size="lg" disabled>
          <Spinner /> {liquidate.phase === "approving" ? "Awaiting approval…" : liquidate.phase === "funding" ? "Moving funds…" : liquidate.phase === "sweeping" ? "Sending to your wallet…" : "Submitting…"}
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
