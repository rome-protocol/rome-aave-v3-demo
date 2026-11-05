"use client";

// /flashloan — composer for Pool.flashLoanSimple. Asset picker + amount
// + receiver + calldata, with a live Solidity + ethers code-preview pane
// on the right. No bundled receiver — users supply their own
// IFlashLoanSimpleReceiver address; the page banner spells out what
// that contract has to implement.

import { useEffect, useRef, useState } from "react";
import { useActiveAddress } from "@/hooks/useActiveLane";
import { useUniWallet } from "@/hooks/useUniWallet";
import {
  AmountInput,
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
import { useFlashPremium } from "@/hooks/useFlashPremium";
import { premiumFraction } from "@/lib/flash-premium";
import { TokenButton, TokenPickerModal, type PickerToken } from "@/components/TokenPicker";
import { useAssetIdentities } from "@/hooks/useAssetIdentity";
import { MultiAssetFlashLoanForm } from "@/components/MultiAssetFlashLoanForm";
import { fmt, fmtAmount, fmtUsd } from "@/lib/format";
import { defaultFlashAmount, maxFlashAmount } from "@/lib/flash-amount";
import { Hint } from "@/components/Tip";
import { evmExplorerTxUrl, fallbackChainInfo } from "@/lib/registry-config";
import { hadrian } from "@/lib/wagmi";
import type { ChainInfo, Reserve } from "@/lib/types";

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
  const { isConnected } = useActiveAddress();
  const wallet = useUniWallet();
  const openConnectModal = () => wallet.openFilteredWalletModal("all");

  const [assetSym, setAssetSym] = useState<string>("USDC");
  const [amount, setAmount] = useState<string>("1000");
  // Until the user types or picks an asset, the starting amount follows what is available.
  const amountTouched = useRef(false);
  const [receiver, setReceiver] = useState<string>("");
  const [calldata, setCalldata] = useState<string>("0x");
  // Advanced (bring-your-own-receiver) composer is open by default.
  // Controlled state rather than native <details> — the demo's global CSS
  // doesn't reliably hide closed <details> content.
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(true);

  const reserves = cfg.data?.reserves ?? [];
  const reserve = reserves.find((r) => r.symbol === assetSym) ?? reserves[0];
  const pool = cfg.data?.aaveAddresses.pool;

  const reserveAvail = reserve ? Math.max(0, reserve.totalSupply - reserve.totalBorrow) : null;
  const reserveDecimals = reserve?.decimals ?? 0;
  useEffect(() => {
    if (amountTouched.current || reserveAvail === null) return;
    setAmount(defaultFlashAmount(reserveAvail, reserveDecimals));
  }, [reserveAvail, reserveDecimals]);

  const { bps: premiumBps, isError: premiumFailed } = useFlashPremium(pool as `0x${string}` | undefined);
  const premiumKnown = premiumBps !== undefined;
  const FLASH_PREMIUM = premiumFraction(premiumBps ?? 0);

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
        <div style={{ color: "var(--fg2)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading…</div>
      </ShellWithPlaceholder>
    );
  }
  if (cfg.isError || !cfg.data || !reserve) {
    return (
      <ShellWithPlaceholder>
        <Banner variant="danger" icon={<IconAlert size={16} />}>
          Can&rsquo;t load market data.
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
          sub={<>{`Repay in the same transaction${!premiumKnown ? "" : premiumBps ? `, plus a ${fmt.pct(FLASH_PREMIUM, 2)} premium` : ", no fee"}.`}<Hint text="If repayment fails, the whole transaction reverts." /></>}
        />

        {/* Multi-asset demo with a pre-approved receiver. Renders nothing on a
            chain with no receiver registered. */}
        <MultiAssetFlashLoanForm reserves={reserves} pool={pool!} />

        {/* Advanced / developer path: the canonical single-asset flashLoanSimple.
            Needs a receiver contract you deploy yourself (+ calldata). */}
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
            Your own receiver
            <span style={{ color: "var(--fg2)", fontSize: 12, fontWeight: 400 }}>
              · single asset
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
              <AssetPicker reserves={reserves} value={assetSym} onChange={(sym) => {
                  amountTouched.current = true;
                  setAssetSym(sym);
                  const r = reserves.find((x) => x.symbol === sym);
                  if (r) setAmount(defaultFlashAmount(Math.max(0, r.totalSupply - r.totalBorrow), r.decimals));
                  if (flash.phase === "error") flash.reset();
                }} />
            </FormRow>

            <FormRow label="Amount">
              <AmountInput
                value={amount}
                onChange={(v) => {
                  amountTouched.current = true;
                  setAmount(v);
                  if (flash.phase === "error") flash.reset();
                }}
                suffix={assetSym}
                balanceLabel="Available"
                balanceValue={fmtUsd(available * reserve.priceUsd)}
                onMax={() => { amountTouched.current = true; setAmount(maxFlashAmount(available, reserve.decimals)); }}
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
                value={premiumKnown
                  ? <span><span className="tabular">{fmt.pct(FLASH_PREMIUM, 2)}</span> · <span className="tabular" style={{ color: "var(--fg1)" }}>{fmtAmount(fee)} {assetSym}</span></span>
                  : <span className="tabular">{premiumFailed ? "Couldn\u2019t read the premium" : "\u2014"}</span>}
              />
              <OverviewRow
                label="Repay total"
                value={<span className="tabular" style={{ color: "var(--fg1)", fontWeight: 500 }}>{premiumKnown ? `${fmtAmount(repayTotal)} ${assetSym}` : "\u2014"}</span>}
              />
            </div>

            <FormRow label="Receiver">
              <input
                value={receiver}
                onChange={(e) => {
                  setReceiver(e.target.value);
                  if (flash.phase === "error") flash.reset();
                }}
                placeholder="0x…"
                className="in"
                style={inputStyle}
              />
              <div style={hintStyle}>
                Your <code className="mono">IFlashLoanSimpleReceiver</code> contract.
                <Hint text="It must approve the Pool for amount + premium before returning true. A failed callback reverts the whole transaction." />
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
                className="in"
                style={inputStyle}
              />
              <div style={hintStyle}>
                Passed to <code className="mono">executeOperation</code> as params.
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
                  <><Spinner /> Sending…</>
                ) : (
                  <><IconBolt size={14} /> Run flash loan</>
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
                <IconCheck size={14} /> Done.
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

            {flash.phase === "error" && executeExplorer ? (
              <TxLinkRow label="Flash loan transaction" hash={flash.executeHash!} href={executeExplorer} />
            ) : null}
            {flash.phase === "error" && flash.error ? (
              <Banner variant="danger" icon={<IconAlert size={16} />}>{flash.error}</Banner>
            ) : null}
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
            .flash-grid { grid-template-columns: minmax(0, 1fr) !important; }
            .flash-grid > * { min-width: 0; }
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

const PageHero = ({ eyebrow, title, sub }: { eyebrow: string; title: React.ReactNode; sub: React.ReactNode }) => (
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
  // The DEX's token picker; the names follow the wallet's lane (hooks/useAssetIdentity.ts). Lists are kept by mint (a plain ERC-20 by its address).
  const ids = useAssetIdentities(reserves);
  const tokens: PickerToken[] = reserves.map((r, i) => ({
    mint: r.solanaMint ?? r.contract,
    logoMint: r.solanaMint,
    symbol: ids[i].symbol,
    name: ids[i].name,
    detail: fmtUsd(Math.max(0, r.totalSupply - r.totalBorrow) * r.priceUsd),
  }));
  const at = reserves.findIndex((r) => r.symbol === value);
  const current = tokens[at >= 0 ? at : 0];
  if (!current) return null;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <TokenButton token={current} onClick={() => setOpen(true)} ariaLabel="Asset" />
      {open ? (
        <TokenPickerModal
          title="Select asset"
          tokens={tokens}
          selectedMint={current.mint}
          onClose={() => setOpen(false)}
          onPick={(t) => {
            const r = reserves.find((x) => (x.solanaMint ?? x.contract) === t.mint);
            if (r) onChange(r.symbol);
            setOpen(false);
          }}
        />
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
  ${receiver || "receiver"},
  ${reserve.contract},
  ${amount} * 10 ** ${reserve.decimals},
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
  "${receiver || "RECEIVER_ADDR"}",
  "${reserve.contract}",
  ethers.parseUnits("${amount}", ${reserve.decimals}),
  "${calldata || "0x"}",
  0
);
await tx.wait();`;

// ───────────────── inline-style helpers ─────────────────

// Used with className="in" (the Rome look's one input): size and face only.
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  fontFamily: "var(--font-mono)",
  fontSize: 13,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--fg2)",
  marginTop: 6,
};
