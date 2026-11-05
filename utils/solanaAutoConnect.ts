// Decides which Solana wallet the wallet-adapter may reconnect silently on load.
//
// With a plain `autoConnect`, a click in the modal (select()) also goes down
// the adapter's autoConnect path, which starts adapter.connect() before the
// modal's own connect() runs. The modal's connect() then returns at once, so it
// shows "connected" while the wallet popup is still open. This gate lets only
// the wallet that was stored at page load reconnect, once; a click never does.

const STORAGE_KEY = "walletName"; // wallet-adapter's default localStorageKey

/** The wallet name wallet-adapter stored on the last visit (JSON string), or null. */
export function readStoredSolanaWallet(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const name = JSON.parse(raw);
    return typeof name === "string" && name ? name : null;
  } catch {
    return null;
  }
}

/** autoConnect callback: true once, only for the wallet stored at load. */
export function createAutoConnectOnce(storedName: string | null) {
  let armed = storedName !== null;
  return async (adapter: { name: string }): Promise<boolean> => {
    if (!armed || adapter.name !== storedName) return false;
    armed = false;
    return true;
  };
}
