import {
  createStore as createMipdStore,
  type EIP6963ProviderDetail,
  type Store as MipdStore,
} from 'mipd';

export type InjectedProvider = {
  request: (...args: unknown[]) => Promise<unknown>;
  on: (...args: unknown[]) => void;
  removeListener: (...args: unknown[]) => void;
  isMetaMask?: boolean;
  isPhantom?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isBackpack?: boolean;
  providers?: InjectedProvider[];
};

type EthereumWindow = Window & {
  ethereum?: InjectedProvider;
  phantom?: {
    ethereum?: InjectedProvider;
  };
};

export type InjectedEvmWallet = {
  id: string;
  name: string;
  icon: string;
  provider: InjectedProvider;
  rdns?: string;
};

export interface KnownEvmWallet {
  id: string;
  name: string;
  icon: string;
  rdns?: string[];
  installUrl?: string;
  matches: (provider: InjectedProvider) => boolean;
  matchesProviderDetail: (providerDetail: EIP6963ProviderDetail) => boolean;
}

export const KNOWN_EVM_WALLETS: KnownEvmWallet[] = [
  {
    id: 'evm-metamask',
    name: 'MetaMask',
    icon: '/images/ic_metamask.png',
    rdns: ['io.metamask'],
    installUrl: 'https://metamask.io/download/',
    matches: (provider) => Boolean(provider.isMetaMask && !provider.isPhantom),
    matchesProviderDetail: (providerDetail) =>
      providerDetail.info.rdns === 'io.metamask' ||
      providerDetail.info.name.toLowerCase().includes('metamask'),
  },
  {
    // Rabby: recognized if the extension is installed (EIP-6963), but no
    // install promotion until we've tested a full Rome bridge flow.
    id: 'evm-rabby',
    name: 'Rabby',
    icon: '/images/ic_wallet.svg',
    rdns: ['io.rabby'],
    matches: (provider) => Boolean(provider.isRabby),
    matchesProviderDetail: (providerDetail) =>
      providerDetail.info.rdns === 'io.rabby' ||
      providerDetail.info.name.toLowerCase().includes('rabby'),
  },
  {
    // Coinbase Wallet (EVM): recognized via EIP-6963 if installed, no
    // install promotion until tested end-to-end.
    id: 'evm-coinbase',
    name: 'Coinbase Wallet',
    icon: '/images/ic_wallet.svg',
    rdns: ['com.coinbase.wallet'],
    matches: (provider) => Boolean(provider.isCoinbaseWallet),
    matchesProviderDetail: (providerDetail) =>
      providerDetail.info.rdns === 'com.coinbase.wallet' ||
      providerDetail.info.name.toLowerCase().includes('coinbase'),
  },
  {
    // OKX: detected + connectable via EIP-6963 if the extension is already
    // installed, but we don't promote via install link — the OKX extension
    // has a proprietary custom-chain add path that sometimes rejects
    // wallet_addEthereumChain for chains it doesn't recognize, so a
    // freshly-installed OKX may look stuck when adding Rome.
    id: 'evm-okx',
    name: 'OKX Wallet',
    icon: '/images/ic_wallet.svg',
    rdns: ['com.okex.wallet'],
    matches: (provider) => Boolean(provider.isOkxWallet || provider.isOKExWallet),
    matchesProviderDetail: (providerDetail) => {
      const rdns = providerDetail.info.rdns.toLowerCase();
      const name = providerDetail.info.name.toLowerCase();
      return (
        rdns.includes('okx') ||
        rdns.includes('okex') ||
        name.includes('okx')
      );
    },
  },
  {
    // Trust (EVM extension): same rule — recognize if installed, don't
    // promote. Trust's extension EVM side works fine for standard
    // transactions, but their recent focus is Trust Wallet mobile via
    // WalletConnect. Users who specifically want Trust should come in
    // through the WalletConnect QR row.
    id: 'evm-trust',
    name: 'Trust Wallet',
    icon: '/images/ic_wallet.svg',
    rdns: ['com.trustwallet.app'],
    matches: (provider) => Boolean(provider.isTrust || provider.isTrustWallet),
    matchesProviderDetail: (providerDetail) => {
      const rdns = providerDetail.info.rdns.toLowerCase();
      const name = providerDetail.info.name.toLowerCase();
      return (
        rdns.includes('trustwallet') ||
        name.includes('trust wallet')
      );
    },
  },
  {
    // Backpack (EVM): recognized via EIP-6963 if installed, no install
    // promotion until tested end-to-end on Rome.
    id: 'evm-backpack',
    name: 'Backpack',
    icon: '/images/ic_wallet.svg',
    rdns: ['com.backpack.app'],
    matches: (provider) => Boolean(provider.isBackpack),
    matchesProviderDetail: (providerDetail) => {
      const rdns = providerDetail.info.rdns.toLowerCase();
      const name = providerDetail.info.name.toLowerCase();
      return rdns.includes('backpack') || name.includes('backpack');
    },
  },
  {
    // WalletConnect isn't an injected provider, but the name-haystack branch
    // of resolveKnownEvmWallet lets us give the wagmi walletConnect connector
    // a proper label + icon instead of the generic fallback.
    id: 'walletConnect',
    name: 'WalletConnect',
    icon: '/images/ic_walletconnect.png',
    matches: () => false,
    matchesProviderDetail: () => false,
  },
];

let mipdStore: MipdStore | undefined;

const getMipdStore = (): MipdStore | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  // We keep this utility separate from raw wagmi connector lists so bootstrap
  // and wallet selection can reason about wallet-specific injected providers.
  mipdStore ??= createMipdStore();
  return mipdStore;
};

const getMipdProviders = (): readonly EIP6963ProviderDetail[] => {
  const store = getMipdStore();
  return store?.getProviders() ?? [];
};

const resolveKnownWalletFromProvider = (provider: InjectedProvider) =>
  KNOWN_EVM_WALLETS.find((candidate) => candidate.matches(provider));

const resolveKnownWalletFromProviderDetail = (
  providerDetail: EIP6963ProviderDetail
) =>
  KNOWN_EVM_WALLETS.find((candidate) =>
    candidate.matchesProviderDetail(providerDetail)
  );

export const resolveKnownEvmWallet = (input: {
  id?: string;
  name?: string;
}) => {
  const haystack = `${input.id ?? ''} ${input.name ?? ''}`.toLowerCase();

  return (
    KNOWN_EVM_WALLETS.find((candidate) => {
      const rdnsMatch = candidate.rdns?.some((rdns) =>
        haystack.includes(rdns.toLowerCase())
      );

      return (
        haystack.includes(candidate.id.replace(/^evm-/, '')) ||
        haystack.includes(candidate.name.toLowerCase()) ||
        Boolean(rdnsMatch)
      );
    }) ?? null
  );
};

const getInjectedProviders = (win?: EthereumWindow): InjectedProvider[] => {
  const targetWindow = win ?? (typeof window !== 'undefined' ? (window as EthereumWindow) : undefined);

  if (!targetWindow) {
    return [];
  }

  const detectedProviders = new Set<InjectedProvider>();

  const rootEthereum = targetWindow.ethereum;
  if (rootEthereum?.providers?.length) {
    rootEthereum.providers.forEach((provider: InjectedProvider) => detectedProviders.add(provider));
  } else if (rootEthereum) {
    detectedProviders.add(rootEthereum);
  }

  if (targetWindow.phantom?.ethereum) {
    detectedProviders.add(targetWindow.phantom.ethereum);
  }

  return Array.from(detectedProviders);
};

