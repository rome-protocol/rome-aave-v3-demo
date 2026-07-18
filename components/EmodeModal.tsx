"use client";

// EmodeModal — switch the user's active e-mode category via
// Pool.setUserEMode. Categories come from /api/aave-config; the active
// id from /api/user-data#aggregate.userEmodeCategoryId. id=0 means
// "Disabled" — selecting it calls setUserEMode(0).

import { useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  Eyebrow,
  Tag,
} from "@/components/primitives";
import {
  ModalShell,
  OverviewRow,
  Spinner,
  SpinnerRow,
  TxLinkRow,
} from "@/components/ActionModal";
import { IconAlert, IconCheck, IconExternal, IconSpark } from "@/components/icons";
import { evmExplorerTxUrl } from "@/lib/registry-config";
import { fmt } from "@/lib/format";
import { hadrian } from "@/lib/wagmi";
import { useAaveEmode } from "@/hooks/useAaveEmode";
import type { EmodeCategoryConfig } from "@/lib/types";

interface DisabledCategory {
  id: 0;
  label: "Disabled";
}
type CategoryOption = DisabledCategory | EmodeCategoryConfig;

interface EmodeModalProps {
  open: boolean;
  pool: `0x${string}` | undefined;
  categories: EmodeCategoryConfig[];
  currentCategoryId: number;
  onClose: () => void;
}

export function EmodeModal({
  open,
  pool,
  categories,
  currentCategoryId,
  onClose,
}: EmodeModalProps) {
  if (!open) return null;
  return (
    <EmodeModalInner
      pool={pool}
      categories={categories}
      currentCategoryId={currentCategoryId}
      onClose={onClose}
    />
  );
}

const EmodeModalInner = ({
  pool,
  categories,
  currentCategoryId,
  onClose,
}: {
  pool: `0x${string}` | undefined;
  categories: EmodeCategoryConfig[];
  currentCategoryId: number;
  onClose: () => void;
}) => {
  // The picker always offers "Disabled" plus the configured categories.
  const options: CategoryOption[] = useMemo(
    () => [{ id: 0, label: "Disabled" } as DisabledCategory, ...categories],
    [categories],
  );
  const [selectedId, setSelectedId] = useState<number>(currentCategoryId);

  useEffect(() => {
    setSelectedId(currentCategoryId);
  }, [currentCategoryId]);

  const action = useAaveEmode({ pool, categoryId: selectedId });

  const currentOption = options.find((o) => o.id === currentCategoryId);
  const nextOption = options.find((o) => o.id === selectedId);
  const isNoOp = selectedId === currentCategoryId;
  const executeExplorer = action.executeHash ? evmExplorerTxUrl(hadrian.id, action.executeHash) : undefined;

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Switch E-mode"
      icon={
        <div style={{
          width: 28, height: 28, borderRadius: 28,
          background: "rgba(197, 139, 198, 0.10)",
          border: "1px solid var(--border-brand)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--fg-brand)",
        }}>
          <IconSpark size={14} />
        </div>
      }
      width={520}
    >
      <p style={{ margin: 0, fontSize: 13, color: "var(--fg2)" }}>
        E-mode unlocks higher LTV for correlated assets. While active, only
        the category&rsquo;s collateral counts toward your borrow power and
        only its borrowable assets can be borrowed.
      </p>

      {(action.phase === "editing" || action.phase === "error") ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {options.map((c) => {
              const checked = selectedId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(c.id);
                    if (action.phase === "error") action.reset();
                  }}
                  style={{
                    textAlign: "left",
                    background: checked ? "rgba(197, 139, 198, 0.10)" : "var(--bg-surface-2)",
                    border: `1px solid ${checked ? "var(--border-brand)" : "var(--border-subtle)"}`,
                    borderRadius: "var(--r-md)",
                    padding: 14,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    color: "var(--fg1)",
                    cursor: "pointer",
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: 16,
                    border: `2px solid ${checked ? "var(--fg-brand)" : "var(--border-strong)"}`,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {checked ? <span style={{ width: 6, height: 6, borderRadius: 6, background: "var(--fg-brand)" }} /> : null}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{c.label}</span>
                      {c.id === currentCategoryId ? <Tag tone="brand">Current</Tag> : null}
                    </div>
                    {"collateralSymbols" in c && c.collateralSymbols.length > 0 ? (
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        {c.collateralSymbols.map((s) => (
                          <Tag key={s} tone="brand">{s}</Tag>
                        ))}
                      </div>
                    ) : c.id === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--fg2)", marginTop: 4 }}>
                        Standard LTV. All assets borrowable per their reserve config.
                      </div>
                    ) : null}
                  </div>
                  {"ltv" in c ? (
                    <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      <div style={{ color: "var(--fg2)" }}>Max LTV</div>
                      <div className="tabular" style={{ color: "var(--fg1)", fontWeight: 500 }}>
                        {fmt.pct(c.ltv / 10_000, 0)}
                      </div>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>

          {currentOption && nextOption && !isNoOp ? (
            <div style={{
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--r-md)",
              padding: "10px 14px",
              background: "var(--bg-surface-2)",
            }}>
              <Eyebrow style={{ paddingBottom: 6 }}>Effect on your position</Eyebrow>
              <OverviewRow label="Current category" value={currentOption.label} />
              <OverviewRow label="New category" value={nextOption.label} />
              {"ltv" in currentOption && "ltv" in nextOption ? (
                <OverviewRow
                  label="Max LTV"
                  value={
                    <span>
                      <span style={{ color: "var(--fg2)" }}>{fmt.pct(currentOption.ltv / 10_000, 0)}</span>
                      <span style={{ color: "var(--fg3)" }}> → </span>
                      <span style={{ color: "var(--fg1)", fontWeight: 500 }}>{fmt.pct(nextOption.ltv / 10_000, 0)}</span>
                    </span>
                  }
                />
              ) : (
                <OverviewRow
                  label="Max LTV"
                  value={
                    <span style={{ color: "var(--fg2)" }}>
                      {"ltv" in currentOption ? fmt.pct(currentOption.ltv / 10_000, 0) : "standard"}
                      <span style={{ color: "var(--fg3)" }}> → </span>
                      <span style={{ color: "var(--fg1)", fontWeight: 500 }}>
                        {"ltv" in nextOption ? fmt.pct(nextOption.ltv / 10_000, 0) : "standard"}
                      </span>
                    </span>
                  }
                />
              )}
              {"liquidationThreshold" in nextOption && "liquidationThreshold" in currentOption ? (
                <OverviewRow
                  label="Liquidation threshold"
                  value={
                    <span>
                      <span style={{ color: "var(--fg2)" }}>{fmt.pct(currentOption.liquidationThreshold / 10_000, 0)}</span>
                      <span style={{ color: "var(--fg3)" }}> → </span>
                      <span style={{ color: "var(--fg1)", fontWeight: 500 }}>{fmt.pct(nextOption.liquidationThreshold / 10_000, 0)}</span>
                    </span>
                  }
                />
              ) : null}
            </div>
          ) : null}

          {action.phase === "error" && action.error ? (
            <Banner variant="danger" icon={<IconAlert size={16} />}>{action.error}</Banner>
          ) : null}

          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={isNoOp}
            onClick={() => void action.submit()}
          >
            {isNoOp
              ? "Already active"
              : selectedId === 0
                ? "Disable E-mode"
                : `Enable ${nextOption?.label ?? "category"}`}
          </Button>
        </>
      ) : null}

      {action.phase === "executing" ? (
        <>
          <SpinnerRow caption="Switching e-mode…" />
          {executeExplorer ? (
            <TxLinkRow label="E-mode transaction" hash={action.executeHash!} href={executeExplorer} />
          ) : null}
          <Button variant="secondary" fullWidth size="lg" disabled>
            <Spinner /> Submitting…
          </Button>
        </>
      ) : null}

      {action.phase === "success" ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "24px 0" }}>
            <div style={{
              width: 56, height: 56, borderRadius: 56,
              background: "var(--hf-safe-bg)",
              border: "1px solid var(--hf-safe)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--hf-safe)",
            }}>
              <IconCheck size={24} />
            </div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: "var(--fg1)" }}>
              {selectedId === 0 ? "E-mode disabled." : `Switched to ${nextOption?.label ?? "category"}.`}
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
          <Button variant="primary" fullWidth size="lg" onClick={onClose}>Close</Button>
        </>
      ) : null}
    </ModalShell>
  );
};
