// Drop-in replacement for `publicClient.waitForTransactionReceipt({ hash })`
// that imposes a 90-second deadline. The default has no timeout, so a dropped
// tx (mempool replacement, RPC blip, validator outage) leaves the UI stranded
// on "Submitting…" with no way out. With a timeout viem throws into the hook's
// existing catch, which sets phase="error" + offers reset(), so the user can
// retry — and the message tells them the tx may still land.
//
// 90s is well above Rome's heaviest single-action observed cost (Aave V3.6 on
// Hadrian: liquidationCall ≈ 39 iterative sigs / ~10.2M Solana CU, ~25-40s
// wall-clock in our measurements). Anything slower
// than 90s is almost certainly a real failure, and the user can confirm via
// the explorer link.

import type { Hash } from "viem";
import { DEFAULT_CHAIN_ID, evmExplorerTxUrl } from "./registry-config";

const RECEIPT_TIMEOUT_MS = 90_000;
// A relayed (iterative) send's receipt is served under its hash about 13 s after the send.
const RELAYED_POLL_MS = 1_500;
const RELAYED_TIMEOUT_MS = 45_000;

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

export class TxRevertedError extends Error {
  hash: Hash;
  constructor(hash: Hash) {
    super(`The transaction reverted on chain (${hash}); nothing was changed.`);
    this.name = "TxRevertedError";
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

/** A relayed send whose receipt did not show up in time: it was submitted, but not confirmed. */
export class TxNotConfirmedError extends Error {
  hash: Hash;
  // The page shows its own link row for the main send; the other steps put the link in the text.
  constructor(hash: Hash, linkInMessage = false) {
    const link = evmExplorerTxUrl(DEFAULT_CHAIN_ID, hash);
    super(`Submitted, not yet confirmed.${linkInMessage ? ` Check the transaction${link ? `: ${link}` : ` ${hash}`}` : ""}`);
    this.name = "TxNotConfirmedError";
    this.hash = hash;
  }
}

type StatusClient = ReceiptClient & { getTransactionReceipt: (args: { hash: Hash }) => Promise<unknown> };

/**
 * Waits for the receipt and fails on a revert. A relayed (iterative) send's
 * receipt is served under its hash after about 13 s, so it is polled for; a
 * reverted one is an error, and none within the deadline is TxNotConfirmedError
 * (never reported as success).
 */
export async function requireSuccess(
  client: StatusClient,
  hash: Hash,
  relayed = false,
  opts: { pollMs?: number; timeoutMs?: number; linkInMessage?: boolean } = {},
): Promise<void> {
  let receipt: { status?: string } | null = null;
  if (!relayed) {
    receipt = (await waitForReceiptWithTimeout(client, hash)) as { status?: string };
  } else {
    const { pollMs = RELAYED_POLL_MS, timeoutMs = RELAYED_TIMEOUT_MS, linkInMessage } = opts;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        receipt = (await client.getTransactionReceipt({ hash })) as { status?: string } | null;
      } catch {
        receipt = null; // not served yet
      }
      if (receipt) break;
      if (Date.now() + pollMs > deadline) throw new TxNotConfirmedError(hash, linkInMessage);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  if (receipt.status !== "success") throw new TxRevertedError(hash);
}

/** The same check, as used by the liquidate, flash-loan and e-mode hooks. */
export const confirmTx = requireSuccess;
