// Drop-in replacement for `publicClient.waitForTransactionReceipt({ hash })`
// that imposes a 90-second deadline. The default has no timeout, so a dropped
// tx (mempool replacement, RPC blip, validator outage) leaves the UI stranded
// on "Submitting…" with no way out. With a timeout viem throws into the hook's
// existing catch, which sets phase="error" + offers reset(), so the user can
// retry — and the message tells them the tx may still land.
//
// 90s is well above Rome's heaviest single-action observed cost (Aave V3.6 on
// Hadrian: liquidationCall ≈ 39 iterative sigs / ~10.2M Solana CU, ~25-40s
// wall-clock per gamut metrics in Aave v3 CLAUDE.md). Anything slower
// than 90s is almost certainly a real failure, and the user can confirm via
// the explorer link.

import type { Hash } from "viem";

const RECEIPT_TIMEOUT_MS = 90_000;

export class TxReceiptTimeoutError extends Error {
  hash: Hash;
  constructor(hash: Hash) {
    super(
      `Transaction not yet confirmed after ${RECEIPT_TIMEOUT_MS / 1000}s — ` +
        `it may still land. Check the explorer for ${hash}.`,
    );
    this.name = "TxReceiptTimeoutError";
    this.hash = hash;
  }
}

type ReceiptClient = {
  waitForTransactionReceipt: (args: { hash: Hash; timeout?: number }) => Promise<unknown>;
};

export async function waitForReceiptWithTimeout<T extends ReceiptClient>(
  client: T,
  hash: Hash,
): Promise<Awaited<ReturnType<T["waitForTransactionReceipt"]>>> {
  try {
    return (await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS })) as Awaited<
      ReturnType<T["waitForTransactionReceipt"]>
    >;
  } catch (e) {
    // Match both viem's named error class and a message-text fallback, so a
    // future viem rename of the error class still degrades to the friendly
    // message rather than a raw timeout string.
    const err = e as { name?: string; message?: string };
    const isTimeout =
      err?.name === "WaitForTransactionReceiptTimeoutError" || /timed? ?out/i.test(err?.message ?? "");
    if (isTimeout) throw new TxReceiptTimeoutError(hash);
    throw e;
  }
}
