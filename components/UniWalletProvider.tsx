import { ReactNode, useEffect, useRef } from 'react';
import { useWalletStore, useWallets, useWalletConnectionHandler } from '@/store/walletStore';
import { WalletChooser } from './WalletChooser';
import { sessionManager } from '@/utils/sessionManager';
import { useActiveLane } from '@/hooks/useActiveLane';
import { useLaneStore } from '@/store/laneStore';

interface UniWalletProviderProps {
  children: ReactNode;
}

export const UniWalletProvider = ({ children }: UniWalletProviderProps) => {
  const { isModalOpen, closeModal, resetModalView } = useWalletStore();
  const wallets = useWallets();
  const checked = useRef(false);

  useWalletConnectionHandler();


  // `useWallets()` returns a fresh object every render, so the activity
  // listeners + session-check interval are installed once on mount and reach
  // current connection state through this ref. Keying the effect on `wallets`
  // instead tore down and reinstalled the interval + four document listeners
  // on every render.
  const walletsRef = useRef(wallets);

  // One identity at a time: the lane decision is applied HERE, at the provider,
  // so no consumer can act as a wallet the visitor did not choose. Eviction
  // drops the losing wallet's live session, not merely our view of it.
  const { evict } = useActiveLane();
  const { preferred, setPreferred } = useLaneStore();
  useEffect(() => {
    walletsRef.current = wallets;
  });

  useEffect(() => {
    if (evict === 'evm') walletsRef.current.disconnectEVM();
    if (evict === 'solana') walletsRef.current.disconnectSolana();
  }, [evict]);

  useEffect(() => {
    if (!checked.current) {
      checked.current = true;
      if (!sessionManager.isValid()) {
        sessionManager.clearMetadataOnly();
      }
    }

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const handler = () => sessionManager.updateActivity();
    for (const e of events) document.addEventListener(e, handler);

    // Expire only a LIVE session. The isAnyConnected guard stops the prior
    // behavior where an idle/disconnected tab (isValid() is false whenever
    // there's no session) fired disconnectAll() — and its toast — every
    // CHECK_INTERVAL, stacking "All disconnected" toasts in the background.
    const interval = setInterval(() => {
      if (!sessionManager.isValid() && walletsRef.current.isAnyConnected) {
        walletsRef.current.disconnectAll();
      }
    }, sessionManager.CHECK_INTERVAL);

    return () => {
      for (const e of events) document.removeEventListener(e, handler);
      clearInterval(interval);
    };
  }, []);

  // After a refresh the wallet comes back on its own: give it a fresh session
  // (the mount check above may just have cleared an expired one) so the idle
  // check does not disconnect it again.
  useEffect(() => {
    if (wallets.isAnyConnected) sessionManager.ensureSession();
  }, [wallets.isAnyConnected]);

  return (
    <>
      {children}
      {isModalOpen ? <WalletChooser
        onClose={() => { closeModal(); resetModalView(); }}
        wallets={wallets.getAvailableWallets()}
        onConnectEVM={async (id) => { setPreferred('evm'); await wallets.connectEVM(id); }}
        onConnectSolana={async (id) => { setPreferred('solana'); await wallets.connectSolana(id); }}
        onDisconnectEVM={() => { if (preferred === 'evm') setPreferred(null); wallets.disconnectEVM(); }}
        onDisconnectSolana={() => { if (preferred === 'solana') setPreferred(null); wallets.disconnectSolana(); }}
        connectingWalletId={wallets.connectingWalletId}
        connectedEvmWalletId={wallets.connectedEvmWalletId}
        connectedSolanaWalletId={wallets.connectedSolanaWalletId}
        modalView={wallets.modalView}
      /> : null}
    </>
  );
};

// Для обратной совместимости
export const useUniWalletContext = () => useWallets();
