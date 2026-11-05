"use client";
// The wallet chooser window, in the Rome app's shape (the DEX's WalletChooser.tsx): the wallet's own logo, its name, a line saying where it
// was found, and what a tap does. Rows are grouped by the kind of wallet, because several wallets support both and the group says which
// one a row creates. A wallet that is not installed has an Install row. The app holds an EVM and a Solana wallet at once; a tap on a
// connected row disconnects it.
import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { IconChevronRight, IconExternal, IconWallet } from "@/components/icons";
import { NetworkSetupHelp } from "@/components/NetworkSetupHelp";
import { logger } from "@/utils/errorHandler";
import type { WalletInfo } from "@/hooks/useUniWallet";
import type { WalletModalView } from "@/store/walletStore";

type Kind = "evm" | "solana";

// The generic "no logo" file of the wallet list (a raster in dark plum): it vanishes on Aurora, so it is drawn as the wallet glyph instead.
const GENERIC_LOGO = "/images/ic_wallet.svg";

/** A wallet's logo; a wallet that sent none (or whose logo does not load) gets the wallet glyph in a square tinted by its kind, in the ink of the palette. */
export function WalletMark({ icon, kind, size = 30 }: { icon?: string; kind: Kind; size?: number }) {
  const [failed, setFailed] = useState(false);
  const px = { width: size, height: size };
  if (icon && icon !== GENERIC_LOGO && !failed) {
    // eslint-disable-next-line @next/next/no-img-element -- a wallet's own logo, sent by the extension as a data address
    return <img className="wmark" data-testid="wallet-mark" data-fallback="no" src={icon} alt="" style={px} onError={() => setFailed(true)} />;
  }
  return <span className={`wmark wmark-fallback ${kind === "evm" ? "evm" : "sol"}`} data-testid="wallet-mark" data-fallback="yes" style={px} aria-hidden="true"><IconWallet size={Math.round(size * 0.55)} /></span>;
}

export function WalletChooser({ wallets, onClose, onConnectEVM, onConnectSolana, onDisconnectEVM, onDisconnectSolana, connectingWalletId, connectedEvmWalletId, connectedSolanaWalletId, modalView }: {
  wallets: WalletInfo[];
  onClose: () => void;
  onConnectEVM: (walletId: string) => Promise<void>;
  onConnectSolana: (walletId: string) => Promise<void>;
  onDisconnectEVM: () => void;
  onDisconnectSolana: () => void;
  connectingWalletId: string | null;
  connectedEvmWalletId: string | null;
  connectedSolanaWalletId: string | null;
  modalView: WalletModalView;
}) {
  const isConnected = (w: WalletInfo) => (w.type === "evm" ? connectedEvmWalletId === w.id : connectedSolanaWalletId === w.id);
  const onTap = async (w: WalletInfo) => {
    if (isConnected(w)) { if (w.type === "evm") onDisconnectEVM(); else onDisconnectSolana(); return; }
    // Not installed: the wallet's download page. After the install and a refresh the row becomes Connect.
    if (!w.installed && w.installUrl) { window.open(w.installUrl, "_blank", "noopener,noreferrer"); return; }
    try {
      if (w.type === "evm") await onConnectEVM(w.id); else await onConnectSolana(w.id);
    } catch (error) { logger.error("Wallet connection error:", error); }
  };
  const groups: { kind: Kind; heading: string; empty: string }[] = [
    { kind: "evm", heading: "EVM wallets", empty: "No EVM wallet found in this browser. Install one, unlock it and refresh." },
    { kind: "solana", heading: "Solana wallets", empty: "No Solana wallet found in this browser." },
  ];
  return (
    <Dialog title="Connect a wallet" onClose={onClose} testid="wallet-chooser" closeTestid="wallet-chooser-close">
      {groups.filter((g) => modalView === "all" || modalView === g.kind).map((g) => {
        const list = wallets.filter((w) => w.type === g.kind);
        return (
          <div key={g.kind} className="chooser-group">
            <div className="eyebrow">{g.heading}</div>
            {list.length === 0 ? <p className="sub" style={{ margin: "6px 0 0" }}>{g.empty}</p> : list.map((w) => {
              const connecting = connectingWalletId === w.id;
              const connected = isConnected(w);
              const sub = connecting ? "Connecting…" : connected ? "Connected" : !w.installed ? `${g.kind === "evm" ? "EVM wallet" : "Solana wallet"} · not installed` : "Detected in this browser";
              return (
                <button key={`${w.type}:${w.id}`} type="button" className="chooser-item" data-testid={`wallet-option-${w.type}-${w.id}`} disabled={connectingWalletId !== null} onClick={() => void onTap(w)}>
                  <WalletMark icon={w.icon} kind={w.type} />
                  <span className="ci-text"><span className="ci-name">{w.name}</span><span className="ci-sub">{sub}</span></span>
                  {connected ? <span className="ci-act ci-out">Disconnect</span>
                    : !w.installed && w.installUrl ? <span className="ci-act">Install <IconExternal size={13} /></span>
                    : <IconChevronRight size={16} className="ci-chev" />}
                </button>
              );
            })}
            {g.kind === "solana" ? <NetworkSetupHelp /> : null}
          </div>
        );
      })}
    </Dialog>
  );
}
