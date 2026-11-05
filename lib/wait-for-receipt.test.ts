import { describe, it, expect, vi } from "vitest";
import { waitForReceiptWithTimeout, TxReceiptTimeoutError, requireSuccess, confirmTx, TxRevertedError, TxNotConfirmedError } from "./wait-for-receipt";

describe("requireSuccess", () => {
  const h = "0x01" as const;
  const client = (status: string) => ({
    waitForTransactionReceipt: async () => ({ status }),
    getTransactionReceipt: async () => ({ status }),
  });
  const missing = { waitForTransactionReceipt: async () => ({ status: "success" }), getTransactionReceipt: async () => { throw new Error("not found"); } };

  it("passes on a successful receipt and fails on a revert", async () => {
    await expect(requireSuccess(client("success"), h)).resolves.toBeUndefined();
    await expect(requireSuccess(client("reverted"), h)).rejects.toThrow(/reverted/);
  });

  it("fails a relayed hash whose receipt is a revert", async () => {
    await expect(requireSuccess(client("reverted"), h, true)).rejects.toThrow(/reverted/);
    await expect(requireSuccess(client("success"), h, true)).resolves.toBeUndefined();
  });

  it("polls a relayed hash until its receipt appears", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const late = { waitForTransactionReceipt: async () => ({}), getTransactionReceipt: async () => { if (++calls < 4) throw new Error("not found"); return { status: "success" }; } };
    const p = requireSuccess(late, h, true);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(p).resolves.toBeUndefined();
    expect(calls).toBe(4);
    vi.useRealTimers();
  });

  it("reports a relayed send with no receipt after the deadline as not yet confirmed", async () => {
    vi.useFakeTimers();
    const p = requireSuccess(missing, h, true);
    const assertion = expect(p).rejects.toBeInstanceOf(TxNotConfirmedError);
    await vi.advanceTimersByTimeAsync(46_000);
    await assertion;
    vi.useRealTimers();
  });

  it("puts the explorer link in the text only when asked", () => {
    expect(new TxNotConfirmedError(h).message).toBe("Submitted, not yet confirmed.");
    expect(new TxNotConfirmedError(h, true).message).toMatch(/^Submitted, not yet confirmed\. Check the transaction/);
  });
});

const hash = "0xabc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd" as `0x${string}`;
const stubClient = (impl: () => Promise<unknown>) => ({ waitForTransactionReceipt: () => impl() }) as any;

describe("waitForReceiptWithTimeout", () => {
  it("rewraps a viem-named timeout into a friendly TxReceiptTimeoutError carrying the hash", async () => {
    const e = Object.assign(new Error("Timed out while waiting for transaction with hash …"), {
      name: "WaitForTransactionReceiptTimeoutError",
    });
    const client = stubClient(async () => {
      throw e;
    });
    const promise = waitForReceiptWithTimeout(client, hash);
    await expect(promise).rejects.toBeInstanceOf(TxReceiptTimeoutError);
    await expect(waitForReceiptWithTimeout(client, hash)).rejects.toThrow(/may still land/);
    await expect(waitForReceiptWithTimeout(client, hash)).rejects.toThrow(hash);
  });

  it("rewraps message-text timeouts too (defensive against viem class renames)", async () => {
    const client = stubClient(async () => {
      throw new Error("operation timed out after 90000ms");
    });
    await expect(waitForReceiptWithTimeout(client, hash)).rejects.toBeInstanceOf(TxReceiptTimeoutError);
  });

  it("passes through non-timeout errors unchanged (revert reason intact)", async () => {
    const client = stubClient(async () => {
      throw new Error("reverted: HF below threshold");
    });
    await expect(waitForReceiptWithTimeout(client, hash)).rejects.toThrow(/HF below threshold/);
    await expect(waitForReceiptWithTimeout(client, hash)).rejects.not.toBeInstanceOf(TxReceiptTimeoutError);
  });

  it("returns the receipt on success", async () => {
    const receipt = { status: "success", blockNumber: 42n };
    const client = stubClient(async () => receipt);
    await expect(waitForReceiptWithTimeout(client, hash)).resolves.toBe(receipt);
  });
});

describe("confirmTx", () => {
  const client = (status: string | null, wait = true) =>
    ({
      waitForTransactionReceipt: async () => ({ status }),
      getTransactionReceipt: async () => {
        if (status === null) throw new Error("not found");
        return { status };
      },
    }) as any;

  it("resolves on a successful receipt", async () => {
    await expect(confirmTx(client("success"), hash)).resolves.toBeUndefined();
  });

  it("throws TxRevertedError on a reverted receipt", async () => {
    await expect(confirmTx(client("reverted"), hash)).rejects.toBeInstanceOf(TxRevertedError);
  });

  it("checks a relayed hash's receipt", async () => {
    await expect(confirmTx(client("reverted"), hash, true)).rejects.toBeInstanceOf(TxRevertedError);
  });
});
