"use client";

// /faucet — one-click test funds for the Aave-on-Rome demo.
//
// Slice 1 refactor: now uses wagmi (useAccount + useChainId + useReadContract
// + useWriteContract) + RainbowKit's ConnectButton, matching the the Rome web app
// pattern documented in the architectural study. The previous
// window.ethereum direct implementation was a phase-1 scaffold artifact.

import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@/components/WalletConnectButton";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from "wagmi";
import { encodeFunctionData } from "viem";
import { getFaucetMeta, faucetTokenSymbols, faucetTokenDrops, FAUCET_ABI } from "@/lib/faucet-config";
import { evmExplorerTxUrl } from "@/lib/registry-config";
import { hadrian } from "@/lib/wagmi";
import { decodeAaveError } from "@/lib/decode-aave-error";

const CHAIN_ID = hadrian.id;

type Phase = "idle" | "ready" | "claiming" | "success" | "error" | "already-claimed";

export default function FaucetPage() {
  const faucet = getFaucetMeta(CHAIN_ID)!;
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  const [phase, setPhase] = useState<Phase>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live `claimed[user]` view — refetches every 8s while connected so the
  // success state survives a manual page reload.
  const { data: alreadyClaimed, refetch: refetchClaimed } = useReadContract({
    address: faucet.address as `0x${string}`,
    abi: FAUCET_ABI,
    functionName: "claimed",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!address && walletChainId === CHAIN_ID,
      refetchInterval: 8_000,
      staleTime: 4_000,
    },
  });

  // Phase transition driven by wallet state + claimed read.
  useEffect(() => {
    if (!isConnected) {
      setPhase("idle");
      return;
    }
    if (walletChainId !== CHAIN_ID) {
      // user connected but on wrong chain — leave at idle, show switch CTA
      return;
    }
    if (alreadyClaimed === true) {
      setPhase("already-claimed");
      return;
    }
    if (alreadyClaimed === false) {
      setPhase((p) => (p === "claiming" || p === "success" || p === "error" ? p : "ready"));
    }
  }, [isConnected, walletChainId, alreadyClaimed]);

  // Wait for tx receipt + refetch claimed.
  const { isSuccess: txMined } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!txHash },
  });
  useEffect(() => {
    if (txMined && phase === "claiming") {
      setPhase("success");
      void refetchClaimed();
    }
  }, [txMined, phase, refetchClaimed]);

  const onHadrian = walletChainId === CHAIN_ID;

  async function switchToHadrian() {
    setError(null);
    try {
      await switchChainAsync({ chainId: CHAIN_ID });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }

  async function claim() {
    if (!address || !publicClient) return;
    setError(null);
    setPhase("claiming");
    try {
      // Dynamic gas — same the Rome web app pattern: eth_estimateGas + 30% buffer.
      // Hardcoded gas was the original bug (PR #2); claim() actually meters
      // ~9.7M on Hadrian (1× native send + 4× external mint calls).
      const data = encodeFunctionData({ abi: FAUCET_ABI, functionName: "claim", args: [] });
      const estimated = await publicClient.estimateGas({
        account: address,
        to: faucet.address as `0x${string}`,
        data,
      });
      const gas = (estimated * 13_000n) / 10_000n;

      const hash = await writeContractAsync({
        address: faucet.address as `0x${string}`,
        abi: FAUCET_ABI,
        functionName: "claim",
        args: [],
        chainId: CHAIN_ID,
        gas,
      });
      setTxHash(hash);
    } catch (e: unknown) {
      setError(decodeAaveError(e));
      setPhase("error");
    }
  }

  const explorerUrl = useMemo(() => (txHash ? evmExplorerTxUrl(CHAIN_ID, txHash) : null), [txHash]);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <img src="/assets/logomark-white.svg" alt="Rome" style={{ width: 32, height: 32 }} />
        <span style={{ fontFamily: "var(--font-serif)", fontSize: 22, letterSpacing: "-0.01em" }}>
          Rome Aave V3 · Faucet
        </span>
        <span style={{ flex: 1 }} />
        <a href="/" style={{ color: "var(--fg2)", fontSize: 13, textDecoration: "none" }}>‹ Back to demo</a>
      </header>

      <main style={mainStyle}>
        <div style={cardStyle}>
          <h1 style={titleStyle}>Test funds for Hadrian</h1>
          <p style={pStyle}>
            One-time claim per wallet. Sends <strong style={{ color: "var(--fg1)" }}>{faucet.gasDropDisplay} native gas</strong>
            {" "}and <strong style={{ color: "var(--fg1)" }}>{faucet.tokens.length} test tokens</strong>{" "}
            ({faucetTokenSymbols(faucet)}) so you can test supply, borrow, and liquidation flows without bridging from Solana.
            USDC / ETH / SOL aren't dripped here — bridge them in from Solana via the demo's main page.
          </p>

          <div style={listCardStyle}>
            <div style={eyebrowStyle}>You'll receive</div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", fontFamily: "var(--font-mono)", fontSize: 13 }}>
              <li style={liStyle}>
                <span style={{ color: "var(--fg1)" }}>Native gas</span>
                <span style={{ color: "var(--fg-brand)" }}>{faucet.gasDropDisplay} ROME</span>
              </li>
              {faucet.tokens.map((t) => (
                <li key={t.symbol} style={liStyle}>
                  <span style={{ color: "var(--fg1)" }}>{t.symbol}</span>
                  <span style={{ color: "var(--fg-brand)" }}>{t.dropDisplay} {t.symbol}</span>
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
            {!isConnected ? (
              <ConnectButton showBalance={false} />
            ) : !onHadrian ? (
              <>
                <p style={{ color: "var(--fg2)", fontSize: 13, marginBottom: 0 }}>
                  Current network: chain {walletChainId ?? "?"}. Switch to Hadrian ({CHAIN_ID}) to continue.
                </p>
                <button onClick={switchToHadrian} style={primaryButton}>Switch to Hadrian</button>
              </>
            ) : phase === "ready" ? (
              <button onClick={claim} style={primaryButton}>Claim test funds</button>
            ) : phase === "claiming" ? (
              <button disabled style={primaryButton}>Claiming… check your wallet</button>
            ) : phase === "success" ? (
              <div style={successBanner}>
                Funds dropped. Check your wallet for {faucet.gasDropDisplay} ROME + {faucetTokenDrops(faucet)}.
                {explorerUrl && (
                  <>
                    <br />
                    <a href={explorerUrl} target="_blank" rel="noreferrer" style={{ color: "var(--hf-safe)" }}>
                      View transaction ↗
                    </a>
                  </>
                )}
              </div>
            ) : phase === "already-claimed" ? (
              <div style={warnBanner}>
                This wallet has already claimed. Switch to a fresh address if you need more.
              </div>
            ) : phase === "error" ? (
              <div style={errorBanner}>{error || "Unknown error"}</div>
            ) : (
              <button disabled style={primaryButton}>Checking…</button>
            )}
          </div>

          <details style={{ marginTop: 32, fontSize: 12, color: "var(--fg2)" }}>
            <summary style={{ cursor: "pointer" }}>Contract details</summary>
            <div style={{ marginTop: 12, fontFamily: "var(--font-mono)" }}>
              <div>Chain: Hadrian ({CHAIN_ID})</div>
              <div>Faucet: {faucet.address}</div>
              {faucet.tokens.map((t) => (
                <div key={t.symbol}>{t.symbol}: {t.address}</div>
              ))}
            </div>
          </details>
        </div>
      </main>

      <footer style={footerStyle}>
        <span>Hadrian · {CHAIN_ID} · testnet</span>
      </footer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Inline styles. These should move to a shared `FaucetLayout` component
// in slice 2 alongside the other chrome elements (PageHeader / PageFooter).
// Keeping inline here to keep slice 1 focused on the providers + wiring.

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-canvas)",
  color: "var(--fg1)",
  fontFamily: "var(--font-sans)",
  display: "flex",
  flexDirection: "column",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "20px 32px",
  borderBottom: "1px solid var(--border-subtle)",
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 32,
};

const cardStyle: React.CSSProperties = {
  maxWidth: 560,
  width: "100%",
  background: "var(--bg-surface)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 12,
  padding: 32,
};

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontSize: 28,
  letterSpacing: "-0.01em",
  margin: 0,
  marginBottom: 8,
};

const pStyle: React.CSSProperties = {
  color: "var(--fg2)",
  fontSize: 14,
  lineHeight: 1.5,
  marginTop: 0,
};

const listCardStyle: React.CSSProperties = {
  marginTop: 24,
  padding: "12px 16px",
  background: "var(--bg-surface-2)",
  borderRadius: 8,
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--fg2)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  marginBottom: 6,
};

const liStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "4px 0",
};

const primaryButton: React.CSSProperties = {
  width: "100%",
  padding: "14px 22px",
  fontSize: 15,
  fontWeight: 500,
  fontFamily: "var(--font-sans)",
  background: "var(--rome-purple)",
  color: "var(--on-rome-purple)",
  border: "1px solid var(--rome-purple)",
  borderRadius: 999,
  cursor: "pointer",
};

const successBanner: React.CSSProperties = {
  padding: "12px 16px",
  background: "rgba(92, 207, 166, 0.10)",
  border: "1px solid rgba(92, 207, 166, 0.35)",
  borderRadius: 8,
  color: "var(--hf-safe, #5CCFA6)",
  fontSize: 14,
};

const warnBanner: React.CSSProperties = {
  padding: "12px 16px",
  background: "rgba(232, 160, 78, 0.10)",
  border: "1px solid rgba(232, 160, 78, 0.35)",
  borderRadius: 8,
  color: "var(--hf-warn, #E8A04E)",
  fontSize: 14,
};

const errorBanner: React.CSSProperties = {
  padding: "12px 16px",
  background: "rgba(226, 106, 106, 0.10)",
  border: "1px solid rgba(226, 106, 106, 0.35)",
  borderRadius: 8,
  color: "var(--hf-danger, #E26A6A)",
  fontSize: 13,
  fontFamily: "var(--font-mono)",
};

const footerStyle: React.CSSProperties = {
  padding: "16px 32px",
  borderTop: "1px solid var(--border-subtle)",
  color: "var(--fg2)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
};
