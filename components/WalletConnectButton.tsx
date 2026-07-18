"use client";

// Drop-in replacement for RainbowKit's `ConnectButton.Custom` render prop.
// Wraps the the Rome web app-style UniWallet hook + wagmi's useAccount + useDisconnect
// so the existing JSX in PageHeader / MarketsContent / app/faucet/page.tsx
// doesn't need rewriting.
//
// Surface match:
//   <ConnectButtonCustom>
//     {({ account, chain, openConnectModal, openChainModal, openAccountModal, mounted }) => ...}
//   </ConnectButtonCustom>
//
// What the children render prop receives (subset of RainbowKit's API — we
// only expose what the demo callers actually use):
//   - account: { address, displayName } | undefined
//   - chain:   { id, unsupported, name } | undefined
//   - openConnectModal: () => void       — opens UniWallet modal (EVM filter)
//   - openChainModal:   () => void       — currently same as openConnectModal
//     (single-chain demo; if wallet is on wrong chain the user re-connects)
//   - openAccountModal: () => void       — opens UniWallet modal (sees connected wallet, lets them disconnect)
//   - mounted: boolean                    — false during SSR/hydration

import { useEffect, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { useUniWallet } from "@/hooks/useUniWallet";
import { hadrian } from "@/lib/wagmi";

interface ConnectButtonChildrenArgs {
  account?: {
    address: `0x${string}`;
    displayName: string;
  };
  chain?: {
    id: number;
    unsupported: boolean;
    name: string;
  };
  openConnectModal: () => void;
  openChainModal: () => void;
  openAccountModal: () => void;
  mounted: boolean;
}

interface Props {
  children: (args: ConnectButtonChildrenArgs) => ReactNode;
}

export function ConnectButtonCustom({ children }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const evm = useAccount();
  const wallet = useUniWallet();

  const openModal = () => wallet.openFilteredWalletModal("evm");
  const openAll = () => wallet.openFilteredWalletModal("all");

  const account = evm.isConnected && evm.address
    ? {
        address: evm.address,
        displayName: `${evm.address.slice(0, 6)}…${evm.address.slice(-4)}`,
      }
    : undefined;

  const chain = evm.chainId
    ? {
        id: evm.chainId,
        unsupported: evm.chainId !== hadrian.id,
        name: evm.chainId === hadrian.id ? hadrian.name : `Chain ${evm.chainId}`,
      }
    : undefined;

  return (
    <>
      {children({
        account,
        chain,
        openConnectModal: openModal,
        openChainModal: openModal,
        openAccountModal: openAll,
        mounted,
      })}
    </>
  );
}

// Default rendering — matches `<ConnectButton showBalance={false} />` from
// RainbowKit (a chunky pill that toggles between "Connect wallet" and the
// shortened address). `showBalance` is accepted but ignored — the demo
// never surfaced balance in the default pill.
interface DefaultProps {
  showBalance?: boolean;
}

function ConnectButtonDefault({ showBalance: _ }: DefaultProps = {}) {
  const evm = useAccount();
  const wallet = useUniWallet();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const baseStyle: React.CSSProperties = {
    background: "var(--rome-purple, #5E0A60)",
    color: "var(--on-rome-purple)",
    border: "none",
    borderRadius: "999px",
    padding: "10px 20px",
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  };

  if (!evm.isConnected || !evm.address) {
    return (
      <button
        type="button"
        style={baseStyle}
        onClick={() => wallet.openFilteredWalletModal("evm")}
      >
        Connect wallet
      </button>
    );
  }

  return (
    <button
      type="button"
      style={baseStyle}
      onClick={() => wallet.openFilteredWalletModal("all")}
    >
      {`${evm.address.slice(0, 6)}…${evm.address.slice(-4)}`}
    </button>
  );
}

// Convenience namespace so call sites that read `<ConnectButton showBalance={false} />`
// AND `<ConnectButton.Custom>{children}</ConnectButton.Custom>` keep working.
export const ConnectButton = Object.assign(ConnectButtonDefault, {
  Custom: ConnectButtonCustom,
});
