export { useWallets as useUniWallet, type WalletInfo } from '@/store/walletStore';

export type UniWallet = ReturnType<typeof import('@/store/walletStore').useWallets>;