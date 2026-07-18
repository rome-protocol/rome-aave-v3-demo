import { Fragment } from "react";
import { Dialog, DialogTitle, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/20/solid";
import { logger } from "@/utils/errorHandler";
import { WalletInfo } from "@/hooks/useUniWallet";
import type { WalletModalView } from "@/store/walletStore";
import { NetworkSetupHelp } from "@/components/NetworkSetupHelp";

// Styled with the demo's CSS-variable tokens (var(--bg-surface), var(--fg1),
// …) so the modal flips with data-theme exactly like every other surface.
// (The original lift used the Rome web app's Tailwind tokens — bg-surface/text-gray-900
// — which the demo doesn't define, so the panel rendered transparent with
// dark text that vanished in dark mode and never followed the theme.)

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAfterLeave: () => void;
  wallets: WalletInfo[];
  onConnectEVM: (walletId: string) => Promise<void>;
  onConnectSolana: (walletId: string) => Promise<void>;
  onDisconnectEVM: () => void;
  onDisconnectSolana: () => void;
  connectingWalletId: string | null;
  connectedEvmWalletId: string | null;
  connectedSolanaWalletId: string | null;
  modalView: WalletModalView;
}

export const WalletModal = ({
  isOpen,
  onClose,
  onAfterLeave,
  wallets,
  onConnectEVM,
  onConnectSolana,
  onDisconnectEVM,
  onDisconnectSolana,
  connectingWalletId,
  connectedEvmWalletId,
  connectedSolanaWalletId,
  modalView,
}: WalletModalProps) => {
  const handleWalletClick = async (wallet: WalletInfo) => {
    if (isWalletConnected(wallet)) {
      if (wallet.type === "evm") onDisconnectEVM();
      else onDisconnectSolana();
      return;
    }
    // Not installed → open the wallet's download page. After install + refresh,
    // EIP-6963 (EVM) / the wallet adapter (Solana) flips the row to Connect.
    if (!wallet.installed && wallet.installUrl) {
      window.open(wallet.installUrl, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      if (wallet.type === "evm") await onConnectEVM(wallet.id);
      else await onConnectSolana(wallet.id);
    } catch (error) {
      logger.error("Wallet connection error:", error);
    }
  };

  const isWalletConnecting = (w: WalletInfo) => connectingWalletId === w.id;
  const isWalletConnected = (w: WalletInfo) =>
    w.type === "evm" ? connectedEvmWalletId === w.id : connectedSolanaWalletId === w.id;

  const evmWallets = wallets.filter((w) => w.type === "evm");
  const solanaWallets = wallets.filter((w) => w.type === "solana");
  const showEvmWallets = modalView === "all" || modalView === "evm";
  const showSolanaWallets = modalView === "all" || modalView === "solana";
  const modalTitle =
    modalView === "evm" ? "Connect EVM Wallet" : modalView === "solana" ? "Connect Solana Wallet" : "Connect Wallet";
  const modalFooterText =
    modalView === "all"
      ? "Connect a wallet to supply, borrow, and manage positions"
      : modalView === "evm"
        ? "Choose an EVM wallet provider"
        : "Choose a Solana wallet provider";

  return (
    <Transition appear show={isOpen} as={Fragment} afterLeave={onAfterLeave}>
      <Dialog as="div" style={{ position: "relative", zIndex: 50 }} onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }} />
        </TransitionChild>

        <div style={{ position: "fixed", inset: 0, overflowY: "auto" }}>
          <div style={{ display: "flex", minHeight: "100%", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <DialogPanel
                style={{
                  width: "100%",
                  maxWidth: 440,
                  maxHeight: "90vh",
                  overflowY: "auto",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--r-lg, 16px)",
                  padding: 24,
                  textAlign: "left",
                  boxShadow: "0 24px 48px -12px rgba(0,0,0,0.5)",
                  fontFamily: "var(--font-sans)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                  <DialogTitle as="h3" style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: 20, fontWeight: 400, color: "var(--fg1)" }}>
                    {modalTitle}
                  </DialogTitle>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    style={{ background: "transparent", border: "none", color: "var(--fg2)", cursor: "pointer", padding: 4, display: "inline-flex" }}
                  >
                    <XMarkIcon style={{ width: 22, height: 22 }} />
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                  {showEvmWallets ? (
                    <div>
                      <WalletSection
                        title="EVM Wallets"
                        wallets={evmWallets}
                        emptyMessage="No EVM wallet detected. Install MetaMask, unlock it, and refresh."
                        onWalletClick={handleWalletClick}
                        isWalletConnecting={isWalletConnecting}
                        isWalletConnected={isWalletConnected}
                      />
                      <NetworkSetupHelp kind="evm" />
                    </div>
                  ) : null}

                  {showSolanaWallets ? (
                    <div>
                      <WalletSection
                        title="Solana Wallets"
                        wallets={solanaWallets}
                        emptyMessage="No Solana wallet detected."
                        onWalletClick={handleWalletClick}
                        isWalletConnecting={isWalletConnecting}
                        isWalletConnected={isWalletConnected}
                      />
                      <NetworkSetupHelp kind="solana" />
                    </div>
                  ) : null}
                </div>

                <div style={{ marginTop: 20, fontSize: 12, color: "var(--fg2)", textAlign: "center" }}>
                  {modalFooterText}
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

interface WalletSectionProps {
  title: string;
  wallets: WalletInfo[];
  emptyMessage: string;
  onWalletClick: (wallet: WalletInfo) => void;
  isWalletConnecting: (wallet: WalletInfo) => boolean;
  isWalletConnected: (wallet: WalletInfo) => boolean;
}

const WalletSection = ({ title, wallets, emptyMessage, onWalletClick, isWalletConnecting, isWalletConnected }: WalletSectionProps) => (
  <div>
    <h4 style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg2)", fontFamily: "var(--font-mono)" }}>
      {title}
    </h4>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {wallets.length === 0 ? (
        <div style={{ borderRadius: "var(--r-md)", border: "1px dashed var(--border-default)", padding: "12px 14px", fontSize: 13, color: "var(--fg2)" }}>
          {emptyMessage}
        </div>
      ) : (
        wallets.map((wallet) => (
          <WalletButton
            key={wallet.id}
            wallet={wallet}
            onClick={() => onWalletClick(wallet)}
            isConnecting={isWalletConnecting(wallet)}
            isConnected={isWalletConnected(wallet)}
          />
        ))
      )}
    </div>
  </div>
);

interface WalletButtonProps {
  wallet: WalletInfo;
  onClick: () => void;
  isConnecting: boolean;
  isConnected: boolean;
}

const WalletButton = ({ wallet, onClick, isConnecting, isConnected }: WalletButtonProps) => {
  const isNotInstalled = !wallet.installed;

  const border = isConnected ? "var(--hf-safe)" : "var(--border-default)";
  const bg = isConnected ? "var(--hf-safe-bg, var(--bg-surface-2))" : "var(--bg-surface-2)";

  const status = () => {
    if (isConnecting) return null;
    if (isConnected)
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: 7, background: "var(--hf-safe)" }} />
          <span style={{ fontSize: 12, color: "var(--hf-danger)", fontWeight: 500 }}>Disconnect</span>
        </span>
      );
    if (isNotInstalled) return <span style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-brand, var(--rome-purple))" }}>Install ↗</span>;
    return <span style={{ fontSize: 12, color: "var(--fg2)" }}>Connect</span>;
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isConnecting}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: 12,
        borderRadius: "var(--r-md)",
        border: `1px solid ${border}`,
        background: bg,
        color: "var(--fg1)",
        cursor: isConnecting ? "not-allowed" : "pointer",
        opacity: isConnecting ? 0.5 : 1,
        fontFamily: "var(--font-sans)",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ position: "relative" }}>
          <img
            src={wallet.icon}
            alt={wallet.name}
            style={{ width: 30, height: 30, borderRadius: "50%", opacity: isNotInstalled ? 0.6 : 1 }}
            onError={(e) => {
              e.currentTarget.src = "/images/ic_wallet.svg";
            }}
          />
          {isConnected ? (
            <span style={{ position: "absolute", top: -3, right: -3, width: 14, height: 14, background: "var(--hf-safe)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CheckCircleIcon style={{ width: 11, height: 11, color: "var(--on-safe)" }} />
            </span>
          ) : null}
        </div>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontWeight: 500, fontSize: 14, color: "var(--fg1)" }}>{wallet.name}</div>
          <div style={{ fontSize: 11, color: "var(--fg2)" }}>
            {wallet.type === "evm" ? "EVM" : "Solana"}
            {isConnected ? " · Connected" : null}
            {isNotInstalled ? " · Not installed" : null}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center" }}>
        {isConnecting ? (
          <span style={{ width: 16, height: 16, border: "2px solid var(--border-default)", borderTopColor: "var(--fg1)", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }} />
        ) : (
          status()
        )}
      </div>
    </button>
  );
};
