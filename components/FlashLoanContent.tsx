"use client";

// /flashloan — composer for Pool.flashLoanSimple. Asset picker + amount
// + receiver + calldata, with a live Solidity + ethers code-preview pane
// on the right. No bundled receiver — users supply their own
// IFlashLoanSimpleReceiver address; the page banner spells out what
// that contract has to implement.

import { useState } from "react";
import { useAccount } from "wagmi";
import { useUniWallet } from "@/hooks/useUniWallet";
import {
  AmountInput,
  AssetSymbol,
  Banner,
  Button,
  Container,
  Eyebrow,
} from "@/components/primitives";
import { PageHeader, PageFooter } from "@/components/PageHeader";
import {
  OverviewRow,
  Spinner,
  TxLinkRow,
} from "@/components/ActionModal";
import {
  IconAlert,
  IconBolt,
  IconChevronDown,
  IconCheck,
  IconCopy,
  IconExternal,
} from "@/components/icons";
import { useAaveConfig } from "@/hooks/useAaveData";
import { useAaveFlashLoan } from "@/hooks/useAaveFlashLoan";
import { MultiAssetFlashLoanForm } from "@/components/MultiAssetFlashLoanForm";
import { fmt } from "@/lib/format";
import { evmExplorerTxUrl, fallbackChainInfo } from "@/lib/registry-config";
import { hadrian } from "@/lib/wagmi";
import type { ChainInfo, Reserve } from "@/lib/types";

// Aave V3 default premium — 0.09%. Hardcoded here because every V3
// deployment ships this value; if Hadrian ever raises it we expose it
// via getReservesData (Pool.FLASHLOAN_PREMIUM_TOTAL) and read it in.
const FLASH_PREMIUM = 0.0009;

const pageShell: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-canvas)",
  color: "var(--fg1)",
  fontFamily: "var(--font-sans)",
  display: "flex",
  flexDirection: "column",
};

const fallbackChainStub: ChainInfo = fallbackChainInfo;

export function FlashLoanContent() {
  const cfg = useAaveConfig();
  const { isConnected } = useAccount();
  const wallet = useUniWallet();
  const openConnectModal = () => wallet.openFilteredWalletModal("evm");

  const [assetSym, setAssetSym] = useState<string>("USDC");
  const [amount, setAmount] = useState<string>("250000");
  const [receiver, setReceiver] = useState<string>("");
  const [calldata, setCalldata] = useState<string>("0x");
  // Advanced (bring-your-own-receiver) composer is collapsed by default.
  // Controlled state rather than native <details> — the demo's global CSS
  // doesn't reliably hide closed <details> content.
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);

  const reserves = cfg.data?.reserves ?? [];
  const reserve = reserves.find((r) => r.symbol === assetSym) ?? reserves[0];
  const pool = cfg.data?.aaveAddresses.pool;

  const flash = useAaveFlashLoan({
    asset: reserve?.contract as `0x${string}` | undefined,
    pool: pool as `0x${string}` | undefined,
    decimals: reserve?.decimals ?? 0,
    amount,
    receiver: receiver.trim(),
    paramsHex: calldata.trim() || "0x",
  });

  if (cfg.isLoading) {
    return (
      <ShellWithPlaceholder>
        <div style={{ color: "var(--fg2)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading reserves…</div>
      </ShellWithPlaceholder>
    );
  }
  if (cfg.isError || !cfg.data || !reserve) {
    return (
      <ShellWithPlaceholder>
        <Banner variant="danger" icon={<IconAlert size={16} />}>
          Couldn&rsquo;t reach the chain RPC. Reserve data is unavailable.
        </Banner>
      </ShellWithPlaceholder>
    );
  }

  const { chain } = cfg.data;
  const amtN = Number(amount) || 0;
  const fee = amtN * FLASH_PREMIUM;
  const repayTotal = amtN + fee;
  const available = Math.max(0, reserve.totalSupply - reserve.totalBorrow);

  const executeExplorer = flash.executeHash ? evmExplorerTxUrl(hadrian.id, flash.executeHash) : undefined;
  const submitDisabled =
    !isConnected ||
    !receiver.trim() ||
    flash.amountRaw === 0n ||
    flash.phase === "executing";

  return (
    <div style={pageShell}>
      <PageHeader chain={chain} />
      <Container max={1320} style={{ paddingTop: 20, paddingBottom: 40, display: "flex", flexDirection: "column", gap: 22 }}>
        <PageHero
          eyebrow="Flash Loan"
          title={<>Borrow any amount. <i>No collateral.</i></>}
          sub={`Borrow 1-3 assets with zero collateral and repay + ${fmt.pct(FLASH_PREMIUM, 2)} premium — all in a single atomic transaction. If repayment fails, the whole transaction reverts as if it never happened.`}
        />

        {/* Primary path: the pre-wired multi-asset demo. No receiver contract
            needed — it uses a deployed, pre-approved receiver so anyone can run
            a real flash loan by just picking assets + amounts. */}
        <MultiAssetFlashLoanForm reserves={reserves} pool={pool!} />

        {/* Advanced / developer path: the canonical single-asset flashLoanSimple.
            Collapsed by default because it requires a receiver contract you
            deploy yourself (+ calldata) — not usable without one. */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            style={{
              width: "100%",
              cursor: "pointer",
              background: "transparent",
              border: "none",
              padding: "16px 24px",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--fg1)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              textAlign: "left",
            }}
          >
            <IconBolt size={14} />
            Build your own — single-asset <code className="mono" style={{ fontSize: 12 }}>flashLoanSimple</code>
            <span style={{ color: "var(--fg2)", fontSize: 12, fontWeight: 400 }}>
              · for developers with their own receiver contract
            </span>
            <span style={{ marginLeft: "auto", color: "var(--fg2)", display: "inline-flex", transition: "transform 0.15s ease", transform: advancedOpen ? "rotate(180deg)" : "none" }}>
              <IconChevronDown size={16} />
            </span>
          </button>

          {advancedOpen ? (
          <div style={{ padding: "0 24px 24px" }}>
        <div className="flash-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Composer */}
          <div className="card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
            <Eyebrow>Composer</Eyebrow>

            <FormRow label="Asset">
              <AssetPicker reserves={reserves} value={assetSym} onChange={setAssetSym} />
            </FormRow>

            <FormRow label="Amount">
              <AmountInput
                value={amount}
                onChange={(v) => {
                  setAmount(v);
                  if (flash.phase === "error") flash.reset();
                }}
                suffix={assetSym}
                balanceLabel="Available"
                balanceValue={fmt.usd(available * reserve.priceUsd, { compact: true })}
                onMax={() => setAmount(String(Math.floor(available)))}
              />
            </FormRow>

            <div style={{
              background: "var(--bg-surface-2)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--r-md)",
              padding: 14,
            }}>
              <OverviewRow
                label="Premium"
                value={<span><span className="tabular">{fmt.pct(FLASH_PREMIUM, 2)}</span> · <span className="tabular" style={{ color: "var(--fg1)" }}>{fmt.num(fee, 4)} {assetSym}</span></span>}
              />
              <OverviewRow
                label="Repay total"
                value={<span className="tabular" style={{ color: "var(--fg1)", fontWeight: 500 }}>{fmt.num(repayTotal, 4)} {assetSym}</span>}
              />
            </div>

            <FormRow label="Receiver">
              <input
                value={receiver}
                onChange={(e) => {
                  setReceiver(e.target.value);
                  if (flash.phase === "error") flash.reset();
                }}
                placeholder="0x… (your IFlashLoanSimpleReceiver contract)"
                style={inputStyle}
              />
              <div style={hintStyle}>
                Must implement <code className="mono">IFlashLoanSimpleReceiver.executeOperation</code> and approve the Pool to pull <code className="mono">amount + premium</code> before returning true.
              </div>
            </FormRow>

            <FormRow label="Calldata">
              <input
                value={calldata}
                onChange={(e) => {
                  setCalldata(e.target.value);
                  if (flash.phase === "error") flash.reset();
                }}
                placeholder="0x"
                style={inputStyle}
              />
              <div style={hintStyle}>
                Passed to your <code className="mono">executeOperation(asset, amount, premium, initiator, params)</code>.
              </div>
            </FormRow>

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
                {flash.phase === "executing" ? (
                  <><Spinner /> Submitting…</>
                ) : (
                  <><IconBolt size={14} /> Execute flash loan</>
                )}
              </Button>
            )}

            {flash.phase === "executing" && executeExplorer ? (
              <TxLinkRow label="Flash loan transaction" hash={flash.executeHash!} href={executeExplorer} />
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
                <IconCheck size={14} /> Flash loan executed.
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
            ) : (
              <Banner variant="warn" icon={<IconAlert size={16} />}>
                Receiver must <code className="mono">approve(Pool, amount + premium)</code> before returning true. Failed callbacks revert the entire transaction.
              </Banner>
            )}
          </div>

          {/* Code preview */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <CodeBlock title="Solidity" code={buildSoliditySnippet({ receiver, reserve, amount: amtN, calldata })} />
            <CodeBlock title="ethers.js" code={buildEthersSnippet({ receiver, reserve, amount: amtN, calldata })} />
          </div>
        </div>
          </div>
          ) : null}
        </div>

        <style>{`
          @media (max-width: 1023px) {
            .flash-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </Container>
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

// ───────────────── PageHero ─────────────────

const PageHero = ({ eyebrow, title, sub }: { eyebrow: string; title: React.ReactNode; sub: string }) => (
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
    <div style={{ marginTop: 8, color: "var(--fg2)", fontSize: 14, maxWidth: 560 }}>{sub}</div>
  </div>
);

// ───────────────── FormRow + AssetPicker ─────────────────

const FormRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div style={{
      marginBottom: 8,
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "var(--fg2)",
    }}>
      {label}
    </div>
    {children}
  </div>
);

const AssetPicker = ({
  reserves,
  value,
  onChange,
}: {
  reserves: Reserve[];
  value: string;
  onChange: (v: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const current = reserves.find((r) => r.symbol === value);
  return (
    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          background: "var(--bg-surface-2)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--r-md)",
          padding: 12,
          color: "var(--fg1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          cursor: "pointer",
        }}
      >
        <AssetSymbol symbol={value} size={26} showName name={current?.name} />
        <IconChevronDown size={14} />
      </button>
      {open ? (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          right: 0,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--r-md)",
          padding: 6,
          maxHeight: 280,
          overflowY: "auto",
          zIndex: 20,
          boxShadow: "0 24px 48px -12px rgba(0,0,0,0.6)",
        }}>
          {reserves.map((r) => {
            const available = Math.max(0, r.totalSupply - r.totalBorrow);
            return (
              <button
                key={r.symbol}
                type="button"
                onClick={() => { onChange(r.symbol); setOpen(false); }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: value === r.symbol ? "var(--bg-surface-2)" : "transparent",
                  border: "none",
                  padding: "8px 10px",
                  color: "var(--fg1)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  borderRadius: "var(--r-sm)",
                  cursor: "pointer",
                }}
              >
                <AssetSymbol symbol={r.symbol} size={22} showName name={r.name} />
                <span style={{ marginLeft: "auto", color: "var(--fg2)", fontSize: 11 }} className="mono tabular">
                  {fmt.usd(available * r.priceUsd, { compact: true })}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

// ───────────────── CodeBlock + Copy ─────────────────

const CodeBlock = ({ title, code }: { title: string; code: string }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
        <Eyebrow>{title}</Eyebrow>
        <button
          type="button"
          onClick={onCopy}
          style={{
            background: "transparent",
            border: "1px solid var(--border-default)",
            color: "var(--fg2)",
            padding: "4px 10px",
            borderRadius: "var(--r-pill)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          {copied ? <><IconCheck size={11} /> Copied</> : <><IconCopy size={11} /> Copy</>}
        </button>
      </div>
      <pre style={{
        margin: 0,
        padding: 18,
        background: "var(--bg-surface-3)",
        color: "var(--fg1)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.6,
        overflowX: "auto",
        whiteSpace: "pre",
      }}>
        <code>{code}</code>
      </pre>
    </div>
  );
};

// ───────────────── Snippet builders ─────────────────

const buildSoliditySnippet = ({
  receiver,
  reserve,
  amount,
  calldata,
}: {
  receiver: string;
  reserve: Reserve;
  amount: number;
  calldata: string;
}) => `IPool(pool).flashLoanSimple(
  ${receiver ? fmt.addr(receiver, 8, 6) : "receiver"},
  ${fmt.addr(reserve.contract, 8, 6)},
  ${amount.toLocaleString("en-US")} * 10^${reserve.decimals},
  ${calldata || "0x"},
  0
);`;

const buildEthersSnippet = ({
  receiver,
  reserve,
  amount,
  calldata,
}: {
  receiver: string;
  reserve: Reserve;
  amount: number;
  calldata: string;
}) => `const pool = new ethers.Contract(POOL_ADDR, abi, signer);
const tx = await pool.flashLoanSimple(
  "${receiver ? fmt.addr(receiver, 8, 6) : "RECEIVER_ADDR"}",
  "${fmt.addr(reserve.contract, 8, 6)}",
  ethers.parseUnits("${amount}", ${reserve.decimals}),
  "${calldata || "0x"}",
  0
);
await tx.wait();`;

// ───────────────── inline-style helpers ─────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-surface-2)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--r-md)",
  padding: 14,
  color: "var(--fg1)",
  fontFamily: "var(--font-mono)",
  fontSize: 13,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--fg2)",
  marginTop: 6,
};
