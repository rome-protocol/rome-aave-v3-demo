const IDLE_TIMEOUT = 30 * 60 * 1000;
const ABSOLUTE_TIMEOUT = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL = 60 * 5 * 1000;


export const sessionManager = {
  CHECK_INTERVAL,
  setConnection: () => {
    if (globalThis.window === undefined) return;
    const now = Date.now().toString();
    localStorage.setItem('wallet_connected_at', now);
    localStorage.setItem('wallet_last_activity', now);
  },

  updateActivity: () => {
    if (globalThis.window === undefined) return;
    localStorage.setItem('wallet_last_activity', Date.now().toString());
  },

  clear: () => {
    if (globalThis.window === undefined) return;
    localStorage.removeItem('wallet_connected_at');
    localStorage.removeItem('wallet_last_activity');
  },

  clearMetadataOnly: () => {
    if (globalThis.window === undefined) return;
    localStorage.removeItem('wallet_connected_at');
    localStorage.removeItem('wallet_last_activity');
  },

  isValid: (): boolean => {
    if (globalThis.window === undefined) return false;
    
    const connectedAt = localStorage.getItem('wallet_connected_at');
    const lastActivity = localStorage.getItem('wallet_last_activity');
    
    if (!connectedAt || !lastActivity) return false;
    
    const now = Date.now();
    const idle = now - Number.parseInt(lastActivity, 10);
    const total = now - Number.parseInt(connectedAt, 10);
    
    return idle <= IDLE_TIMEOUT && total <= ABSOLUTE_TIMEOUT;
  },
};
