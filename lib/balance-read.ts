// An RPC read where only a real contract revert (the token is not minted /
// has no such function) is an answer. A transport or RPC error is retried,
// then thrown, so the UI shows an error instead of a false "Wallet: 0".

type Chained = { name?: string; message?: string; details?: string; shortMessage?: string; cause?: unknown };

/**
 * True only for a real revert. viem turns ANY JSON-RPC code 3 into a
 * ContractFunctionRevertedError, and the Rome proxy answers a temporary
 * failure with code 3 "upstream request failed", so the error class is not
 * enough: the RPC's own text must say "execution reverted" (or the call
 * returned no data at all).
 */
export function isContractRevert(e: unknown): boolean {
  let c = e as Chained | undefined;
  for (let i = 0; c && i < 8; i++, c = c.cause as Chained | undefined) {
    if (c.name === "ContractFunctionZeroDataError") return true;
    if (c.name === "RpcRequestError") {
      return /execution reverted/i.test(`${c.details ?? ""} ${c.shortMessage ?? ""} ${c.message ?? ""}`);
    }
  }
  return false;
}

/** Runs the read; a real revert gives `onRevert`, any other error is retried then thrown. */
export async function readOrOnRevert<T>(read: () => Promise<T>, onRevert: T, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (e) {
      if (isContractRevert(e)) return onRevert;
      if (attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
}

export const balanceOrZero = (read: () => Promise<bigint>, retries = 2) => readOrOnRevert(read, 0n, retries);
