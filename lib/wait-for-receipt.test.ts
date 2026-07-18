import { describe, it, expect } from "vitest";
import { waitForReceiptWithTimeout, TxReceiptTimeoutError } from "./wait-for-receipt";

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
