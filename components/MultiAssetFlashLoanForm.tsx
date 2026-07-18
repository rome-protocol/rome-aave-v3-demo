"use client";

// Multi-asset Pool.flashLoan composer — Rome pre-approve pattern.
//
// Sits below the canonical single-asset flashLoanSimple composer on
// /flashloan. The single-asset form uses the user-supplied receiver
// with in-callback approve; this one uses Rome's deployed pre-approved
// receiver (DemoOpenMultiFlashReceiver on Hadrian) and runs the
// canonical multi-asset Pool.flashLoan path.
//
// Why a separate composer: canonical Aave V3 in-callback `approve(POOL, ...)`
// inside `receiver.executeOperation` overflows Solana's per-tx
// account_locks cap when 2+ cached SPL wrappers are involved. Rome's
// answer is to pre-approve in a separate setup tx, then run flashLoan
// without an in-callback approve. The receiver was deployed + init'd
// once via `hardhat deploy-flash-receiver --demo true` (Aave v3);
// the UI just calls Pool.flashLoan against it.

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useUniWallet } from "@/hooks/useUniWallet";
import {
  AmountInput,
  AssetSymbol,
  Banner,
  Button,
  Eyebrow,
} from "@/components/primitives";
import {
  OverviewRow,
  Spinner,
  TxLinkRow,
} from "@/components/ActionModal";
import {
  IconAlert,
  IconBolt,
  IconCheck,
  IconExternal,
} from "@/components/icons";
import { useAaveMultiFlashLoan } from "@/hooks/useAaveMultiFlashLoan";
import { fmt } from "@/lib/format";
import { evmExplorerTxUrl } from "@/lib/registry-config";
import { hadrian } from "@/lib/wagmi";
import type { Reserve } from "@/lib/types";
import config from "@/lib/aave-hadrian.json";

const FLASH_PREMIUM = 0.0009;

// The demo receiver address comes from Aave v3's deploy artifact,
// vendored into lib/aave-hadrian.json#flashLoanReceivers.demoMulti.
const DEMO_RECEIVER = (config as any).flashLoanReceivers?.demoMulti?.address as
  | `0x${string}`
  | undefined;

interface Props {
  reserves: Reserve[];
  pool: string;
}

export function MultiAssetFlashLoanForm({ reserves, pool }: Props) {
  const { isConnected } = useAccount();
  const wallet = useUniWallet();
  const openConnectModal = () => wallet.openFilteredWalletModal("evm");

  // Default selection: the first two cached reserves that the deployed
  // receiver was pre-init'd for (wUSDC + wETH on Hadrian).
  const cached = reserves.filter((r) => ["USDC", "ETH", "SOL"].includes(r.symbol));
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(
    cached.slice(0, 2).map((r) => r.symbol),
  );
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const selectedAssets = useMemo(() => {
    return selectedSymbols
      .map((sym) => reserves.find((r) => r.symbol === sym))
      .filter((r): r is Reserve => Boolean(r))
      .map((r) => ({
        address: r.contract as `0x${string}`,
        decimals: r.decimals,
        amount: amounts[r.symbol] ?? "",
        symbol: r.symbol,
        priceUsd: r.priceUsd,
      }));
  }, [selectedSymbols, reserves, amounts]);

  const flash = useAaveMultiFlashLoan({
    pool: pool as `0x${string}`,
    receiver: DEMO_RECEIVER,
    assets: selectedAssets,
    flashPremiumBps: 9,
  });

  const toggleAsset = (sym: string) => {
    flash.reset();
    setSelectedSymbols((prev) => {
      if (prev.includes(sym)) {
        if (prev.length === 1) return prev; // keep at least 1 selected
        return prev.filter((s) => s !== sym);
      }
      if (prev.length >= 3) return prev; // cap at 3 (matches the 3 init'd cached wrappers)
      return [...prev, sym];
    });
  };

  const setAmount = (sym: string, v: string) => {
    flash.reset();
    setAmounts((prev) => ({ ...prev, [sym]: v }));
  };

  const totalUsd = selectedAssets.reduce(
    (acc, a) => acc + (Number(a.amount) || 0) * a.priceUsd,
    0,
  );
  const totalPremiumUsd = totalUsd * FLASH_PREMIUM;

  const executeExplorer = flash.executeHash
    ? evmExplorerTxUrl(hadrian.id, flash.executeHash)
    : undefined;

  const submitDisabled =
    !isConnected ||
    !flash.isReady ||
    flash.phase === "fundingPremium" ||
    flash.phase === "executing";

  if (!DEMO_RECEIVER) {
    return (
      <div className="card" style={{ padding: 20 }}>
        <Banner variant="warn" icon={<IconAlert size={16} />}>
          Multi-asset flash loan unavailable on this chain — no receiver registered in <code>lib/aave-hadrian.json#flashLoanReceivers.demoMulti</code>. Deploy via{" "}
          <code>hardhat deploy-flash-receiver --demo true</code> on Aave v3.
        </Banner>
      </div>
    );
  }

  return (
    <div className="flash-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      {/* LEFT — the transaction */}
      <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
        <Eyebrow>Multi-asset Composer</Eyebrow>
        <div>
          <div style={{ color: "var(--fg2)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Pick 1-3 assets</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {cached.map((r) => {
              const selected = selectedSymbols.includes(r.symbol);
              return (
                <button
                  key={r.symbol}
                  onClick={() => toggleAsset(r.symbol)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 14px",
                    background: selected ? "var(--rome-purple)" : "var(--bg-surface-2)",
                    border: `1px solid ${selected ? "var(--rome-purple)" : "var(--border-default)"}`,
                    borderRadius: "var(--r-md)",
                    color: selected ? "var(--on-rome-purple)" : "var(--fg2)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  <AssetSymbol symbol={r.symbol} size={20} />
                </button>
              );
            })}
          </div>
        </div>

        {selectedAssets.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {selectedAssets.map((a) => (
              <div key={a.symbol}>
                <div style={{ color: "var(--fg2)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                  {a.symbol} amount
                </div>
                <AmountInput
                  value={a.amount}
                  onChange={(v) => setAmount(a.symbol, v)}
                  suffix={a.symbol}
                  balanceLabel="Price"
                  balanceValue={fmt.usd(a.priceUsd)}
                />
              </div>
            ))}
          </div>
        ) : null}

        <div style={{
          background: "var(--bg-surface-2)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--r-md)",
          padding: 14,
        }}>
          <OverviewRow
            label="Total notional"
            value={<span className="tabular" style={{ color: "var(--fg1)", fontWeight: 500 }}>{fmt.usd(totalUsd)}</span>}
          />
          <OverviewRow
            label={`Premium (${fmt.pct(FLASH_PREMIUM, 2)} per asset)`}
            value={<span className="tabular" style={{ color: "var(--fg1)" }}>~ {fmt.usd(totalPremiumUsd)}</span>}
          />
          <OverviewRow
            label="Receiver"
            value={<code className="mono" style={{ fontSize: 11, color: "var(--fg1)" }}>{shorten(DEMO_RECEIVER)} (demo, pre-init&apos;d)</code>}
          />
        </div>

        {!isConnected ? (
          <Button variant="primary" size="lg" fullWidth onClick={openConnectModal}>
            Connect wallet
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={submitDisabled}
            onClick={() => void flash.submit()}
          >
            {flash.phase === "fundingPremium" ? (
              <><Spinner /> Funding premium ({flash.fundingTxHashes.length}/{selectedAssets.length})…</>
            ) : flash.phase === "executing" ? (
              <><Spinner /> Running Pool.flashLoan…</>
            ) : (
              <><IconBolt size={14} /> Execute multi-asset flash loan</>
            )}
          </Button>
        )}

        {flash.phase === "fundingPremium" && flash.fundingTxHashes.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "var(--fg2)" }}>
            {flash.fundingTxHashes.map((h, i) => (
              <div key={i}>
                {h === "0x" ? (
                  <>Step {i + 1}/{selectedAssets.length}: pre-funded — {selectedAssets[i].symbol} skipped</>
                ) : (
                  <>Step {i + 1}/{selectedAssets.length}: funded {selectedAssets[i].symbol} premium · <code className="mono" style={{ fontSize: 11 }}>{shorten(h)}</code></>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {flash.executeHash && executeExplorer ? (
          <TxLinkRow label="Multi-asset flashLoan transaction" hash={flash.executeHash as `0x${string}`} href={executeExplorer} />
        ) : null}

        {flash.phase === "success" && executeExplorer ? (
          <div style={{
            padding: "12px 14px",
            background: "var(--hf-safe-bg)",
            border: "1px solid var(--hf-safe)",
            borderRadius: "var(--r-md)",
            color: "var(--hf-safe)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <IconCheck size={14} /> Multi-asset flash loan executed atomically.
            <a
              href={executeExplorer}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--hf-safe)", marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              View transaction <IconExternal size={11} />
            </a>
          </div>
        ) : null}

        {flash.phase === "error" && flash.error ? (
          <Banner variant="danger" icon={<IconAlert size={16} />}>{flash.error}</Banner>
        ) : null}
      </div>

      {/* RIGHT — narrative / education */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="card" style={{ padding: 20 }}>
          <Eyebrow style={{ marginBottom: 10 }}>How it works</Eyebrow>
          <p style={{ margin: 0, color: "var(--fg2)", fontSize: 13, lineHeight: 1.6 }}>
            Borrow 2-3 assets at once with <strong style={{ color: "var(--fg1)" }}>zero collateral</strong>, then repay them
            {" "}+ a {fmt.pct(FLASH_PREMIUM, 2)} premium — all inside a single <code className="mono">Pool.flashLoan</code> call.
            If repayment fails, the whole transaction reverts as if it never happened.
          </p>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <Eyebrow style={{ marginBottom: 10 }}>Rome pre-approve pattern</Eyebrow>
          <p style={{ margin: 0, color: "var(--fg2)", fontSize: 13, lineHeight: 1.6 }}>
            Solana caps how many accounts one transaction can touch. Aave&rsquo;s usual in-callback
            {" "}<code className="mono">approve</code> would push a 2-asset flash loan over that cap — so Rome
            {" "}<strong style={{ color: "var(--fg1)" }}>pre-approves</strong> the receiver in a one-time setup tx,
            and the flash-loan tx itself carries no extra approve.
          </p>
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--fg2)" }}>
            Receiver <code className="mono" style={{ color: "var(--fg1)" }}>{shorten(DEMO_RECEIVER)}</code>
            {" "}· demo, pre-init&apos;d for the cached wrappers. Source:
            {" "}<code className="mono">PreApprovedFlashReceiverBase.sol</code>.
          </div>
        </div>
      </div>
    </div>
  );
}

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
