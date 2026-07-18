import { createCustomChain, type RomeChain } from '@/constants/chains';

type RequestProvider = {
  request?: (args: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
} | null;

const isMissingChainError = (error: unknown): boolean => {
  const record = error as {
    code?: number;
    message?: string;
    data?: { originalError?: { code?: number } };
  };
  const message = record?.message || '';
  const originalCode = record?.data?.originalError?.code;

  return (
    record?.code === 4902 ||
    originalCode === 4902 ||
    message.includes('4902') ||
    message.includes('Unrecognized chain') ||
    message.includes('not been added') ||
    message.includes('Unknown chain')
  );
};

export const requestEvmChainSwitch = async ({
  provider,
  chain,
}: {
  provider: RequestProvider;
  chain: RomeChain;
}): Promise<void> => {
  if (!provider?.request) {
    throw new Error('EVM wallet provider not available');
  }

  const hexChainId = `0x${Number(chain.chainId).toString(16)}`;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
    return;
  } catch (error) {
    if (!isMissingChainError(error)) {
      throw error;
    }
  }

  const walletChain = createCustomChain(
    chain.chainId,
    chain.rpcUrl,
    chain.name,
    chain.explorerUrl,
    chain.nativeCurrency,
    chain.contracts.multicall,
  );

  await provider.request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: hexChainId,
        chainName: walletChain.name,
        nativeCurrency: walletChain.nativeCurrency,
        rpcUrls: walletChain.rpcUrls.default.http,
        blockExplorerUrls: walletChain.blockExplorers?.default?.url
          ? [walletChain.blockExplorers.default.url]
          : [],
      },
    ],
  });
};
