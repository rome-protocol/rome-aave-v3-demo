import { describe, it, expect } from "vitest";
import { createPublicClient, custom, RpcRequestError, parseAbi } from "viem";
import { balanceOrZero, isContractRevert, readOrOnRevert } from "./balance-read";

const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const addr = "0x0000000000000000000000000000000000000001" as const;

// A real viem client, so the error chain is the one the app sees.
const readVia = (error: { code: number; message: string }) => {
  let calls = 0;
  const client = createPublicClient({
    transport: custom({ request: async ({ method }) => { calls++; throw new RpcRequestError({ body: { method }, error, url: "http://x" }); } }, { retryCount: 0 }),
  });
  return { calls: () => calls, read: () => client.readContract({ address: addr, abi, functionName: "balanceOf", args: [addr] }) };
};

describe("balanceOrZero", () => {
  it("reads a real revert (code 3, execution reverted) as 0", async () => {
    const { read } = readVia({ code: 3, message: "execution reverted" });
    await read().catch((e) => expect(isContractRevert(e)).toBe(true));
    expect(await balanceOrZero(read)).toBe(0n);
  });

  it("reads a call with no data as 0", async () => {
    const e = Object.assign(new Error("x"), { name: "ContractFunctionExecutionError", cause: { name: "ContractFunctionZeroDataError" } });
    expect(await balanceOrZero(async () => { throw e; })).toBe(0n);
  });

  it("does not turn the proxy's code-3 'upstream request failed' into 0: retried, then thrown", async () => {
    const { read, calls } = readVia({ code: 3, message: "upstream request failed" });
    await read().catch((e) => expect(isContractRevert(e)).toBe(false));
    const before = calls();
    await expect(balanceOrZero(read, 1)).rejects.toBeTruthy();
    expect(calls() - before).toBe(2);
  });

  it("does not turn a transport error into 0", async () => {
    const e = Object.assign(new Error("outer"), { name: "ContractFunctionExecutionError", cause: { name: "HttpRequestError" } });
    expect(isContractRevert(e)).toBe(false);
    let calls = 0;
    await expect(balanceOrZero(async () => { calls++; throw e; }, 1)).rejects.toBe(e);
    expect(calls).toBe(2);
  });

  it("retries a transient error and returns the balance", async () => {
    let calls = 0;
    const v = await balanceOrZero(async () => { if (calls++ === 0) throw new Error("boom"); return 7n; });
    expect(v).toBe(7n);
  });
});

describe("readOrOnRevert (mint_id)", () => {
  it("null on a real revert, throws on a temporary failure", async () => {
    expect(await readOrOnRevert<string | null>(readVia({ code: 3, message: "execution reverted" }).read as never, null)).toBeNull();
    await expect(readOrOnRevert<string | null>(readVia({ code: 3, message: "upstream request failed" }).read as never, null, 0)).rejects.toBeTruthy();
  });
});
