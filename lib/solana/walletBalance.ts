// What a Solana wallet can put to work, per asset: its own token account for
// the wrapper's mint, plus (native SOL only) its plain SOL minus a fee reserve.
// The synthetic's own holdings are added by the caller.
import { PublicKey } from "@solana/web3.js";
import { associatedTokenAddress } from "./pdas";

export const NATIVE_MINT = new PublicKey("So11111111111111111111111111111111111111112");
/** Plain SOL the wallet keeps for fees: 0.02 SOL. */
export const SOL_FEE_RESERVE_LAMPORTS = 20_000_000n;

export function isNativeMint(mint: PublicKey): boolean {
  return mint.equals(NATIVE_MINT);
}

/** The u64 amount of an SPL token account's data (offset 64); 0 when the account does not exist. */
export function tokenAmountOf(data: Uint8Array | null | undefined): bigint {
  if (!data || data.length < 72) return 0n;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
}

/** Wallet-side base units for one mint: token account + (native mint) spendable SOL. */
export function walletSideBalance(p: { mint: PublicKey; ataTokens: bigint; lamports: bigint }): bigint {
  if (!isNativeMint(p.mint)) return p.ataTokens;
  const spendable = p.lamports > SOL_FEE_RESERVE_LAMPORTS ? p.lamports - SOL_FEE_RESERVE_LAMPORTS : 0n;
  return p.ataTokens + spendable;
}

interface ReadConnection {
  getMultipleAccountsInfo(keys: PublicKey[], commitment?: "confirmed"): Promise<({ data: Uint8Array } | null)[]>;
  getBalance(key: PublicKey, commitment?: "confirmed"): Promise<number>;
}

/** Wallet-side base units for each mint, in one round trip. A read error throws; it is never read as 0. */
export async function readWalletSide(connection: ReadConnection, wallet: PublicKey, mints: PublicKey[]): Promise<bigint[]> {
  const atas = mints.map((m) => associatedTokenAddress(m, wallet));
  const [infos, lamports] = await Promise.all([
    atas.length ? connection.getMultipleAccountsInfo(atas, "confirmed") : Promise.resolve([]),
    mints.some(isNativeMint) ? connection.getBalance(wallet, "confirmed") : Promise.resolve(0),
  ]);
  return mints.map((mint, i) => walletSideBalance({ mint, ataTokens: tokenAmountOf(infos[i]?.data), lamports: BigInt(lamports) }));
}
