let pendingChainSwitchKey: string | null = null;


export const beginChainSwitch = (chainId: number | string): boolean => {
  const key = String(chainId);

  if (pendingChainSwitchKey) {
    return pendingChainSwitchKey === key;
  }

  pendingChainSwitchKey = key;
  return true;
};

export const endChainSwitch = (chainId?: number | string): void => {
  if (!pendingChainSwitchKey) {
    return;
  }

  if (chainId === undefined || pendingChainSwitchKey === String(chainId)) {
    pendingChainSwitchKey = null;
  }
};
