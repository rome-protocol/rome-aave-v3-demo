import { test } from "vitest";
import assert from "node:assert/strict";
import { solanaRpcUpstream } from "./solanaRpcUpstream.mjs";

const chain = { solana: { rpc: "https://default.example/" } };

test("the Solana RPC upstream is the environment's, else the chain config's", () => {
  assert.equal(solanaRpcUpstream({}, chain), "https://default.example/");
  assert.equal(solanaRpcUpstream({ SOLANA_RPC_UPSTREAM: "" }, chain), "https://default.example/");
  assert.equal(solanaRpcUpstream({ SOLANA_RPC_UPSTREAM: "https://own.example/" }, chain), "https://own.example/");
});
