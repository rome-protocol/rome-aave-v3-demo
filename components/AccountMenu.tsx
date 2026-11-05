"use client";

// The one wallet control of the header (the DEX's AccountMenu.tsx). Not connected: "Connect wallet" opens the chooser. Connected: a pill with
// the wallet's logo, the short address and a chevron, which opens the account menu: the wallet's name and place, the short address with a
// copy button and an explorer link, the Theme choice, then Change wallet and Disconnect.
// The app acts under one wallet at a time: the EVM wallet or the Solana wallet (hooks/useActiveLane.ts). The pill and the menu are that wallet's.
import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useActiveLane } from "@/hooks/useActiveLane";
import { useUniWallet } from "@/hooks/useUniWallet";
import { useLaneStore } from "@/store/laneStore";
import { fmt } from "@/lib/format";
import { NETWORK_LABEL } from "@/lib/brand";
import { hadrian } from "@/lib/wagmi";
import { evmExplorerAddressUrl, solanaExplorerAddressUrl } from "@/lib/registry-config";
import { IconChange, IconCheck, IconChevronDown, IconCopy, IconDisconnect, IconExternal } from "@/components/icons";
import { Tip } from "@/components/Tip";
import { ThemeButton, ThemeRow } from "@/components/Theme";
import { WalletMark } from "@/components/WalletChooser";

export default function AccountMenu() {
  const active = useActiveLane();
  const wallets = useUniWallet();
  const evm = useAccount();
  const solana = useWallet();
  const { switchChainAsync } = useSwitchChain();
  const { preferred, setPreferred } = useLaneStore();
  const [mounted, setMounted] = useState(false);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMounted(true); }, []);

  // "Change wallet" opens the chooser from a menu item that is gone by the time the chooser closes: focus goes to the pill, not to the page.
  const chooserOpen = wallets.isModalOpen;
  const chooserWasOpen = useRef(false);
  useEffect(() => {
    if (chooserWasOpen.current && !chooserOpen && (!document.activeElement || document.activeElement === document.body)) pill.current?.focus({ preventScroll: true });
    chooserWasOpen.current = chooserOpen;
  }, [chooserOpen]);

  useEffect(() => {
    if (!menu) return;
    const onPointer = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); root.current?.querySelector<HTMLElement>("button")?.focus(); } };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [menu]);

  // A remembered wallet is still being restored: a grey pill of the same size, not a flash of "Connect wallet".
  const restoring = !mounted || evm.status === "reconnecting" || solana.connecting;
  const lane = active.lane;
  if (!active.isConnected || !lane || !active.address) {
    return (
      <>
        <ThemeButton />
        {restoring
          ? <span className="connect-btn wpill-skel" data-testid="wallet-pending" aria-hidden="true" />
          : <button type="button" className="btn connect-btn" data-testid="connect-wallet" onClick={() => wallets.openFilteredWalletModal("all")}>Connect wallet</button>}
      </>
    );
  }

  const address = lane === "solana" && active.solanaAddress ? active.solanaAddress : active.address;
  const short = lane === "solana" ? fmt.addr(address, 4, 4) : fmt.addr(address, 6, 4);
  const kind = lane === "solana" ? "solana" : "evm";
  const where = lane === "solana" ? "Solana wallet" : "EVM wallet";
  const walletId = lane === "solana" ? wallets.connectedSolanaWalletId : wallets.connectedEvmWalletId;
  const info = wallets.getAvailableWallets().find((w) => w.id === walletId);
  const href = lane === "solana" ? solanaExplorerAddressUrl(hadrian.id, address) : evmExplorerAddressUrl(hadrian.id, address);
  // An EVM wallet that sits on another network: an amber dot on the pill and a line with "Switch network" in the menu.
  const networkIssue = lane === "evm" && typeof evm.chainId === "number" && evm.chainId !== hadrian.id;
  const copy = () => {
    try {
      void navigator.clipboard.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
    } catch { /* no clipboard here: the address is in the explorer link */ }
  };
  const disconnect = () => {
    setMenu(false);
    if (preferred === lane) setPreferred(null);
    if (lane === "solana") wallets.disconnectSolana(); else wallets.disconnectEVM();
  };

  return (
    <div className="account-root" ref={root}>
      <button ref={pill} type="button" className={`wpill ${kind === "evm" ? "evm" : "sol"} on`} data-testid="wallet-account" aria-haspopup="menu" aria-expanded={menu} aria-label={`${where} ${short}`} onClick={() => setMenu((m) => !m)}>
        <WalletMark icon={info?.icon} kind={kind} size={22} />
        <span className="mono">{short}</span>
        {networkIssue && <span className="warn-dot" data-testid="network-issue-dot" aria-hidden="true" />}
        <IconChevronDown size={14} className="caret" />
      </button>
      {menu && (
        <div className="account-menu" role="menu" aria-label="Wallet" data-testid="account-menu">
          <div className="am-head">
            <WalletMark icon={info?.icon} kind={kind} size={36} />
            <div className="am-who">
              {info?.name ? <span className="am-name">{info.name}</span> : null}
              <span className="am-sub">{lane === "solana" ? where : `${where} · ${NETWORK_LABEL}`}</span>
            </div>
          </div>
          <div className="am-addr">
            <Tip text={address} align="start"><span className="mono" data-testid="account-address">{short}</span></Tip>
            <span className="am-addr-btns">
              <button type="button" className="am-icon" data-testid="account-copy" aria-label={copied ? "Address copied" : "Copy address"} onClick={copy}>
                {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
              </button>
              {href && <a className="am-icon" data-testid="account-explorer" href={href} target="_blank" rel="noopener noreferrer" aria-label="View on explorer"><IconExternal size={15} /></a>}
            </span>
          </div>
          {networkIssue && (
            <div className="am-warn" data-testid="network-issue">
              <span>Your wallet is on another network.</span>
              <button type="button" className="btn ghost" data-testid="network-switch" onClick={() => void switchChainAsync({ chainId: hadrian.id }).catch(() => {})}>Switch network</button>
            </div>
          )}
          <ThemeRow />
          <button type="button" className="am-item" role="menuitem" data-testid="wallet-change" onClick={() => { setMenu(false); wallets.openFilteredWalletModal("all"); }}>Change wallet<IconChange size={15} /></button>
          <button type="button" className="am-item am-out" role="menuitem" data-testid="wallet-disconnect" onClick={disconnect}>Disconnect<IconDisconnect size={15} /></button>
        </div>
      )}
    </div>
  );
}
