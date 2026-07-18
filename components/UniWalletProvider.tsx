import { ReactNode, useEffect, useRef } from 'react';
import { useWalletStore, useWallets, useWalletConnectionHandler } from '@/store/walletStore';
import { WalletModal } from './WalletModal';
import { sessionManager } from '@/utils/sessionManager';

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
  useEffect(() => {
    walletsRef.current = wallets;
  });

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
  
  return (
    <>
      {children}
      <WalletModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onAfterLeave={resetModalView}
        wallets={wallets.getAvailableWallets()}
        onConnectEVM={wallets.connectEVM}
        onConnectSolana={wallets.connectSolana}
        onDisconnectEVM={() => wallets.disconnectEVM()}
        onDisconnectSolana={() => wallets.disconnectSolana()}
        connectingWalletId={wallets.connectingWalletId}
        connectedEvmWalletId={wallets.connectedEvmWalletId}
        connectedSolanaWalletId={wallets.connectedSolanaWalletId}
        modalView={wallets.modalView}
      />
    </>
  );
};

// Для обратной совместимости
export const useUniWalletContext = () => useWallets();
