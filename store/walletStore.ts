import { create } from 'zustand';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import type { Connector } from '@wagmi/core';
import { Connection, Transaction } from '@solana/web3.js';
import { toast } from 'react-toastify';
import { useEffect, useRef } from 'react';
import { useChainStore } from './chainStore';
import { getErrorText, sanitizeError, logger } from '@/utils/errorHandler';
import { sessionManager } from '@/utils/sessionManager';
import { resolveKnownEvmWallet, KNOWN_EVM_WALLETS } from '@/utils/wallet';
import { beginChainSwitch, endChainSwitch } from '@/utils/chainSwitchGuard';
import { requestEvmChainSwitch } from '@/utils/evmChainSwitch';

export interface WalletInfo {
  id: string;
  name: string;
  icon: string;
  type: 'evm' | 'solana';
  installed: boolean;
  installUrl?: string;
}

// Solana wallet support matrix for the connect modal.
//
// `installUrl` present → we've verified the wallet works end-to-end against
// Rome's Solana flows (connect, sign, bridge). The modal promotes it with an
// "Install" row even when the extension isn't detected.
//
// `installUrl` absent → we accept it if detected as Installed (via the
// wallet-adapter + Wallet Standard registry), but don't promote it because
// we haven't verified the wallet works with Rome's flows. Solflare and
// Backpack are widely-used Solana wallets but haven't been tested against
// Rome's Solana devnet bridge flows yet — they'll surface for users who
// already have them without sending users into potentially broken install
// journeys. Trust and Coinbase Wallet Solana sides have known limitations.
interface SolanaWalletSupport {
  name: string;
  installUrl?: string;
}

const SOLANA_WALLET_SUPPORT: SolanaWalletSupport[] = [
  { name: 'Phantom', installUrl: 'https://phantom.app/download' },
  { name: 'Solflare' },
  { name: 'Backpack' },
  { name: 'Trust' },
  { name: 'Coinbase Wallet' },
];

export type WalletModalView = 'all' | 'evm' | 'solana';

interface WalletState {
  isModalOpen: boolean;
  modalView: WalletModalView;
  connecting: string | null;
  
  openModal: (view?: WalletModalView) => void;
  closeModal: () => void;
  resetModalView: () => void;
  setConnecting: (walletName: string | null) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  isModalOpen: false,
  modalView: 'all',
  connecting: null,
  
  openModal: (view = 'all') => set({ isModalOpen: true, modalView: view }),
  closeModal: () => set({ isModalOpen: false, connecting: null }),
  resetModalView: () => set({ modalView: 'all' }),
  setConnecting: (walletName: string | null) => set({ connecting: walletName }),
}));

const isUserCancellation = (error: Error & { code?: number }): boolean => {
  const message = getErrorText(error);
  const code = error.code;
  
  return (
    message.includes('User rejected') ||
    message.includes('User cancelled') ||
    message.includes('User denied') ||
    message.includes('cancelled by user') ||
    message.includes('User canceled') ||
    message.includes('rejected the request') ||
    message.includes('user rejected') ||
    message.includes('user cancelled') ||
    message.includes('user denied') ||
    message.includes('Connection request cancelled') ||
    message.includes('Connection cancelled') ||
    code === 4001 || // Standard rejection code
    code === -32603 || // Internal error (often user rejection)
    code === 4100 || // Unauthorized - user rejected
    error.name === 'WalletConnectionError' ||
    error.name === 'WalletNotConnectedError'
  );
};

const isPendingChainRequest = (error: Error & { code?: number }): boolean => {
  const message = getErrorText(error);
  return (
    error.code === -32002 ||
    message.includes('already pending') ||
    message.includes('request is already pending') ||
    message.includes('PUBLIC_addEthereumChain') ||
    message.includes('wallet_addEthereumChain') ||
    message.includes('wallet_switchEthereumChain')
  );
};

export const useWallets = () => {
  const { isModalOpen, modalView, connecting, openModal, closeModal, setConnecting } =
    useWalletStore();
  const {
    chainId: selectedChainId,
    isChainReady,
    isSwitchingChain,
    setIsSwitchingChain,
    setChainReady,
  } = useChainStore();
  
  const solana = useWallet();
  // Always holds the latest solana hook value so async callbacks can call
  // connect() on the fresh instance (with the correct adapter in its closure).
  // The assignment runs in an effect (post-commit) so render itself stays pure;
  // user-triggered async callbacks fire later, so they see the up-to-date ref.
  const solanaRef = useRef(solana);
  useEffect(() => {
    solanaRef.current = solana;
  });
  const evm = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect: evmDisconnect } = useDisconnect();
  const isSolanaSessionConnected = solana.connected || Boolean(solana.publicKey);
  const rawConnectedEvmWalletId = evm.connector?.id || null;
  const connectedEvmWalletId = evm.isConnected && isChainReady ? rawConnectedEvmWalletId : null;
  const connectedSolanaWalletId = isSolanaSessionConnected && solana.wallet?.adapter.name
    ? `solana:${solana.wallet.adapter.name}`
    : null;

  const getNormalizedConnectorWallet = (connector: Connector): WalletInfo => {
    const knownWallet = resolveKnownEvmWallet({
      id: connector.id,
      name: connector.name,
    });

    return {
      id: knownWallet?.id || connector.id,
      name: knownWallet?.name || connector.name,
      icon: knownWallet?.icon || connector.icon || '/images/ic_wallet.svg',
      type: 'evm' as const,
      installed: true,
    };
  };
  
  const getAvailableWallets = (): WalletInfo[] => {
    // EVM: start with installed connectors (wagmi + EIP-6963), then tack on
    // any known wallet that's *not* installed so the modal can show an
    // "Install" row for it.
    const installedEvmWallets: WalletInfo[] = connectors
      .map((connector: Connector) => getNormalizedConnectorWallet(connector))
      .filter(
        (wallet, index, wallets) =>
          wallets.findIndex((candidate) => candidate.id === wallet.id) === index
      );

    const installedEvmIds = new Set(installedEvmWallets.map((w) => w.id));
    const uninstalledEvmWallets: WalletInfo[] = KNOWN_EVM_WALLETS
      .filter((known) => known.installUrl && !installedEvmIds.has(known.id))
      .map((known) => ({
        id: known.id,
        name: known.name,
        icon: known.icon,
        type: 'evm' as const,
        installed: false,
        installUrl: known.installUrl,
      }));

    const evmWallets = [...installedEvmWallets, ...uninstalledEvmWallets];

    // Solana: verified wallets always render (with Install link if missing).
    // Opportunistic wallets render only when the adapter reports them
    // Installed — we recognize them but don't promote via install link.
    const adapterByName = new Map(
      solana.wallets.map((w: { adapter: { name: string; icon?: string }; readyState: string }) => [
        w.adapter.name,
        w,
      ])
    );

    const solanaWallets: WalletInfo[] = SOLANA_WALLET_SUPPORT.flatMap((entry) => {
      const registered = adapterByName.get(entry.name);
      const isInstalled = registered?.readyState === 'Installed';
      const verified = Boolean(entry.installUrl);

      if (!isInstalled && !verified) {
        return [];
      }

      const fallbackIcon = '/images/ic_wallet.svg';
      return [{
        id: `solana:${entry.name}`,
        name: entry.name,
        icon: registered?.adapter.icon || fallbackIcon,
        type: 'solana' as const,
        installed: isInstalled,
        installUrl: isInstalled ? undefined : entry.installUrl,
      }];
    });

    return [...evmWallets, ...solanaWallets];
  };

  const getWalletsForView = (view: WalletModalView): WalletInfo[] => {
    const wallets = getAvailableWallets();

    if (view === 'evm') {
      return wallets.filter((wallet) => wallet.type === 'evm');
    }

    if (view === 'solana') {
      return wallets.filter((wallet) => wallet.type === 'solana');
    }

    return wallets;
  };
  
  const connectEVM = async (walletId: string) => {
    try {
      setConnecting(walletId);
      
      logger.log('🔍 Available connectors:', connectors.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
      })));
      
      const connector = connectors.find((c: Connector) => {
        if (c.id === walletId) {
          return true;
        }

        const knownWallet = resolveKnownEvmWallet({
          id: c.id,
          name: c.name,
        });

        return knownWallet?.id === walletId;
      });
      
      logger.log('🔍 Selected connector:', connector ? {
        id: connector.id,
        name: connector.name,
        type: connector.type,
      } : 'NOT FOUND');
      
      if (!connector) {
        throw new Error(`Wallet connector not found for ${walletId}. Available: ${connectors.map(c => c.id).join(', ')}`);
      }

      const connectedWallet = evm.connector
        ? getNormalizedConnectorWallet(evm.connector)
        : null;
      const isAlreadyConnectedToRequestedWallet =
        evm.isConnected && connectedWallet?.id === walletId;

      let activeConnector = connector;
      let connectedChainId: number | null = null;

      if (isAlreadyConnectedToRequestedWallet && evm.connector) {
        activeConnector = evm.connector;
        connectedChainId =
          typeof evm.chainId === 'number'
            ? evm.chainId
            : null;
      } else {
        if (evm.isConnected) {
          setChainReady(false);
          setIsSwitchingChain(false);
          evmDisconnect();
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const connectionResult = await connectAsync({ connector });
        connectedChainId =
          typeof connectionResult.chainId === 'number'
            ? connectionResult.chainId
            : null;
      }

      sessionManager.setConnection();
      setConnecting(null);
      closeModal();

      const targetChainId = Number(selectedChainId);
      logger.log(`🔄 Switching to selected chain ${targetChainId} after connection...`);

      if (Number.isFinite(targetChainId) && connectedChainId !== targetChainId) {
        setChainReady(false);
        setIsSwitchingChain(true);

        try {
          if (!beginChainSwitch(targetChainId)) {
            toast.info(
              'A network add/switch request is already pending in your wallet. Finish it there and try again if needed.'
            );
            return;
          }

          const evmProvider = await activeConnector.getProvider();
          const selectedChain =
            useChainStore.getState().chains.find(
              (chain) => Number(chain.chainId) === targetChainId
            ) ?? null;

          if (!selectedChain) {
            throw new Error(`Selected chain ${targetChainId} is not configured`);
          }

          await requestEvmChainSwitch({
            provider: evmProvider as {
              request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
            } | null,
            chain: selectedChain,
          });
          logger.log('✅ Successfully switched to selected chain after connection');
        } catch (switchError) {
          const err = switchError as Error & { code?: number };
          logger.warn('⚠️ Could not switch chain after connection:', err);

          if (isPendingChainRequest(err)) {
            toast.info(
              'A network add/switch request is already pending in your wallet. Finish it in the wallet and try again if needed.'
            );
          } else if (!isUserCancellation(err)) {
            toast.warning(
              `Switch the EVM wallet to the selected chain if it was not added automatically: ${sanitizeError(err)}`
            );
          }
        } finally {
          endChainSwitch(targetChainId);
          setIsSwitchingChain(false);
        }
      } else if (connectedChainId === targetChainId) {
        logger.log('✅ Connected wallet is already on the selected chain');
        setChainReady(true);
      }
      
      toast.success(
        isAlreadyConnectedToRequestedWallet
          ? `${activeConnector.name} ready`
          : `${activeConnector.name} connected`
      );
      
    } catch (error: unknown) {
      setConnecting(null);
      const err = error as Error & { code?: number };
      
      if (!isUserCancellation(err)) {
        toast.error(`Failed to connect wallet: ${sanitizeError(err)}`);
      }
    }
  };
  
  const connectSolana = async (walletId: string) => {
    const adapterName = walletId.replace(/^solana:/, '');

    try {
      setConnecting(walletId);

      const walletAdapter = solana.wallets.find((w: { adapter: { name: string; connect: () => Promise<void> }; readyState: string }) =>
        w.adapter.name === adapterName
      );

      if (!walletAdapter || walletAdapter.readyState !== 'Installed') {
        throw new Error(`${adapterName} not available`);
      }

      // Already connected to the same wallet — just confirm session
      if (isSolanaSessionConnected && solana.wallet?.adapter.name === adapterName) {
        sessionManager.setConnection();
        toast.success(`${adapterName} connected!`);
        setConnecting(null);
        closeModal();
        return;
      }

      // Disconnect existing Solana wallet before switching
      if (isSolanaSessionConnected) {
        await solana.disconnect();
        // Let the WalletProvider process the disconnect event before selecting
        // a new wallet, so intermediate state changes don't trigger the fallback
        // handler's "wrong wallet" guard and clear the spinner prematurely.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // select() tells the WalletProvider which adapter to track and triggers
      // a React re-render after which the WalletProvider's useEffect([adapter])
      // subscribes to the adapter's 'connect'/'disconnect' events.
      solana.select(walletAdapter.adapter.name);

      // Wait one macrotask so React commits the select() state update and the
      // WalletProvider effect runs to subscribe to the new adapter's events.
      // Calling connect() before that subscription is set up means the
      // 'connect' event fires into the void and solana.connected never updates.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Call connect() through the hook ref so it goes through WalletProvider's
      // handleConnect, which ensures the 'connect' event is received and
      // solana.connected / solana.publicKey update in the React context.
      await solanaRef.current.connect();

      sessionManager.setConnection();
      toast.success(`${adapterName} connected!`);
      setConnecting(null);
      closeModal();

    } catch (error: unknown) {
      setConnecting(null);
      const err = error as Error & { code?: number };

      if (!isUserCancellation(err)) {
        toast.error(`Failed to connect ${adapterName}: ${sanitizeError(err)}`);
      }
    }
  };
  
  const signSolanaTransaction = async (tx: Transaction) => {
    if (!solana.signTransaction) {
      throw new Error('Solana wallet not connected');
    }
    return await solana.signTransaction(tx);
  };

  // Use signAndSendTransaction for Phantom compatibility (avoids spam warning)
  const sendSolanaTransaction = async (tx: Transaction, connection: Connection) => {
    if (!solana.sendTransaction) {
      throw new Error('Solana wallet not connected');
    }

    try {
      return await solana.sendTransaction(tx, connection, {
        maxRetries: 3,
        preflightCommitment: 'confirmed',
        skipPreflight: false,
      });
    } catch (error) {
      logger.error('Solana sendTransaction failed:', error);

      const details = error instanceof Error ? error.message : String(error);
      throw new Error(`Solana transaction failed: ${details}`);
    }
  };

  const openModalForView = async (view: WalletModalView = 'all') => {
    // With install-link rows, eligibleWallets always has many entries. Only
    // skip the modal when exactly one *installed* wallet is eligible and
    // the user isn't already connected to it — mirrors the old "just click
    // connect, you only have MetaMask" UX without hiding the install list.
    const installedEligible = getWalletsForView(view).filter((w) => w.installed);

    if (installedEligible.length === 1) {
      const [wallet] = installedEligible;
      const isAlreadyConnected = wallet.type === 'evm'
        ? connectedEvmWalletId === wallet.id
        : connectedSolanaWalletId === wallet.id;

      if (!isAlreadyConnected) {
        if (wallet.type === 'evm') {
          await connectEVM(wallet.id);
        } else {
          await connectSolana(wallet.id);
        }
        return;
      }
    }

    openModal(view);
  };
  
  return {
    isModalOpen,
    modalView,
    connecting,
    connectingWalletId: connecting,
    openWalletModal: () => void openModalForView('all'),
    openFilteredWalletModal: (view: WalletModalView) => void openModalForView(view),
    closeWalletModal: closeModal,
    
    evmAddress: evm.address || null,
    evmConnected: evm.isConnected && isChainReady,
    evmConnectedRaw: evm.isConnected && Boolean(evm.address),
    evmConnecting: evm.isConnecting || Boolean(connecting?.startsWith('evm-')),
    connectedEvmWalletId,
    evmWalletChainId:
      evm.isConnected && evm.address && typeof evm.chainId === 'number'
        ? String(evm.chainId)
        : null,
    evmWalletMatchesSelectedChain:
      Boolean(
        typeof evm.chainId === 'number' &&
          String(evm.chainId) === selectedChainId
      ),
    evmWalletSwitchPending:
      Boolean(evm.isConnected) && isSwitchingChain,
    
    solanaAddress: solana.publicKey?.toBase58() || null,
    solanaConnected: isSolanaSessionConnected,
    solanaConnecting: Boolean(connecting?.startsWith('solana:')),
    connectedSolanaWalletId,
    
    isAnyConnected: (evm.isConnected && isChainReady) || !!solana.publicKey,
    isBothConnected: evm.isConnected && isChainReady && !!solana.publicKey,
    
    connectEVM,
    connectSolana,
    disconnectEVM: () => { 
      const wasConnected = Boolean(evm.isConnected && evm.address);
      setChainReady(false);
      setIsSwitchingChain(false);
      setConnecting(null);
      evmDisconnect(); 
      if (!solana.publicKey) sessionManager.clear();
      if (wasConnected) {
        toast.info('EVM disconnected');
      }
    },
    disconnectSolana: () => {
      const wasConnected = Boolean(solana.publicKey);
      solana.disconnect();
      if (!evm.isConnected) sessionManager.clear();
      if (wasConnected) toast.info('Solana disconnected');
    },
    disconnectAll: () => {
      const wasConnected = Boolean(evm.isConnected && evm.address) || Boolean(solana.publicKey);
      evmDisconnect();
      solana.disconnect();
      sessionManager.clear();
      if (wasConnected) toast.info('All disconnected');
    },
    signSolanaTransaction,
    sendSolanaTransaction,
    getAvailableWallets,
  };
};

export const useWalletConnectionHandler = () => {
  const { connecting, closeModal, setConnecting } = useWalletStore();
  const solana = useWallet();
  const isSolanaSessionConnected = solana.connected || Boolean(solana.publicKey);
  const targetSolanaWalletName = connecting?.startsWith('solana:')
    ? connecting.replace(/^solana:/, '')
    : null;
  useEffect(() => {
    // Fallback: if the TARGET wallet connected (e.g. via autoConnect) while
    // connecting was still set, clear the spinner and close the modal.
    // Require the connected adapter to match targetSolanaWalletName so that
    // switching wallets (Phantom→Solflare) doesn't falsely fire this with
    // the OLD wallet still connected while connecting points to the new one.
    if (
      isSolanaSessionConnected &&
      targetSolanaWalletName &&
      solana.wallet?.adapter.name === targetSolanaWalletName
    ) {
      sessionManager.setConnection();
      setConnecting(null);
      closeModal();
      return;
    }

    // Wrong wallet ended up selected — clear the spinner
    if (
      targetSolanaWalletName &&
      !solana.publicKey &&
      !solana.connecting &&
      solana.wallet?.adapter.name &&
      solana.wallet.adapter.name !== targetSolanaWalletName
    ) {
      setConnecting(null);
      return;
    }
  }, [
    closeModal,
    connecting,
    isSolanaSessionConnected,
    setConnecting,
    solana,
    targetSolanaWalletName,
  ]);
};
