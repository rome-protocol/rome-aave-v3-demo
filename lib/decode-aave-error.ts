// Turns a viem/wagmi revert into a human, actionable message.
//
// Aave V3.6 reverts with 4-byte custom-error selectors; Solidity 0.8 checked
// math reverts with Panic(uint256). viem surfaces these raw — users were
// seeing "0x6679996d" and "arithmetic operation resulted in underflow or
// overflow" with no idea what to do. This maps the common ones to plain
// English + a next step, and falls back to viem's shortMessage otherwise.

import { TxReceiptTimeoutError } from "./wait-for-receipt";

// Selector → user-facing message. Selectors generated via keccak256(signature)[:4].
// Verified live on Hadrian: 0x6679996d (HF) + 0x2c5211c6 (InvalidAmount).
const AAVE_ERROR_MESSAGES: Record<string, string> = {
  "0x6679996d":
    "This would push your health factor below 1. Repay some debt or add collateral before withdrawing.",
  "0xe43ec917":
    "You have no collateral in this reserve to act on.",
  "0x911ceb81":
    "Your collateral can't cover this borrow. Supply more collateral or borrow less.",
  "0x979b5ce8":
    "This position can't be liquidated — its collateral isn't eligible.",
  "0x930bb771":
    "This position is healthy (health factor ≥ 1), so it can't be liquidated.",
  "0x3653732b":
    "You haven't borrowed this asset, so there's nothing to repay.",
  "0x47bc4b2c":
    "Not enough available balance. The pool may be borrowed down — try a smaller amount or wait for liquidity.",
  "0xf58f733a":
    "This reserve's supply cap is reached. Try a smaller amount.",
  "0x77a6a896":
    "This reserve's borrow cap is reached. Try a smaller amount.",
  "0x6d305815":
    "This reserve is frozen — new supplies and borrows are paused.",
  "0xd37f5f1c":
    "This reserve is paused. Try again later.",
  "0x90cd6f24":
    "This reserve is inactive.",
  "0x53587745":
    "Borrowing isn't enabled for this reserve.",
  "0x2c5211c6":
    "Invalid amount. Enter an amount greater than zero.",
  "0x5e85ae73":
    "Amount must be greater than zero.",
  "0xf0788fb2":
    "You have no debt of this type to repay.",
  "0xf2f0a860":
    "You have no outstanding debt to repay.",
  "0x5fe10377":
    "Your supplied balance here is zero.",
  "0x17c5a78e":
    "Invalid interest-rate mode.",
  "0x29a270f5":
    "This operation isn't supported on this reserve.",
  "0x91037009":
    "The price-oracle sentinel blocked this action (recent oracle outage). Try again shortly.",
  "0x5b263df7":
    "This withdrawal/borrow fails Aave's loan-to-value check. Repay debt or keep more collateral.",
  "0x580f2f14":
    "Flash loans are disabled for this reserve.",
  "0xe24734c2":
    "This reserve's isolation-mode debt ceiling is reached.",
  "0x0cafc072":
    "This collateral is in isolation mode or has zero LTV and can't back this borrow.",
  "0xb629b0e4":
    "This partial liquidation would leave a dust position. Liquidate the full debt instead — when health factor is below 0.95, Aave allows a 100% close.",
};

// Solidity Panic(uint256) codes — the runtime-arithmetic family.
const PANIC_SELECTOR = "0x4e487b71";
const PANIC_MESSAGES: Record<string, string> = {
  "0x11":
    "The amount exceeds what's available — usually withdrawing/borrowing more than the pool currently holds. Try a smaller amount or wait for liquidity.",
  "0x12": "Division by zero in the contract math.",
  "0x32": "An index was out of bounds in the contract.",
};
const ERROR_STRING_SELECTOR = "0x08c379a0";

// viem's shortMessage for a Panic(0x11) reads like this — catch it even when
// the raw selector isn't surfaced.
const UNDERFLOW_TEXT = /underflow|overflow/i;

function pluck(obj: unknown, path: string[]): unknown {
  let cur: any = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Find the first 0x-prefixed revert data blob hiding in a viem error tree. */
function findRevertData(err: unknown): string | undefined {
  const candidates = [
    pluck(err, ["data"]),
    pluck(err, ["cause", "data"]),
    pluck(err, ["cause", "cause", "data"]),
    pluck(err, ["cause", "cause", "cause", "data"]),
    pluck(err, ["cause", "reason"]),
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^0x[0-9a-fA-F]{8}/.test(c)) return c;
  }
  return undefined;
}

/**
 * Decode a wallet/RPC revert into a human message.
 * Order: explicit revert data → selector in the message text → panic/underflow
 * text → viem shortMessage → raw message.
 */
export function decodeAaveError(err: unknown): string {
  // The receipt-wait timeout helper rewraps viem's timeout into a friendly
  // TxReceiptTimeoutError carrying the hash — surface its message verbatim.
  if (err instanceof TxReceiptTimeoutError) return err.message;
  const e = err as { shortMessage?: string; message?: string; details?: string } | undefined;
  const text = `${e?.shortMessage ?? ""} ${e?.message ?? ""} ${e?.details ?? ""}`;

  // 1. Structured revert data, if viem preserved it.
  const data = findRevertData(err);
  const selectorFromData = data ? data.slice(0, 10).toLowerCase() : undefined;

  // 2. Otherwise scrape a 4-byte selector out of the message text.
  const selectorFromText = text.match(/0x[0-9a-fA-F]{8}\b/)?.[0]?.toLowerCase();

  const selector = selectorFromData ?? selectorFromText;

  if (selector) {
    if (AAVE_ERROR_MESSAGES[selector]) return AAVE_ERROR_MESSAGES[selector];
    if (selector === PANIC_SELECTOR && data) {
      // panic code is the last 32-byte word
      const code = "0x" + parseInt(data.slice(-2), 16).toString(16);
      if (PANIC_MESSAGES[code]) return PANIC_MESSAGES[code];
    }
    if (selector === ERROR_STRING_SELECTOR) {
      // fall through to the text — viem already decoded the string into the message
    }
  }

  // 3. Panic surfaced only as text ("...underflow or overflow").
  if (UNDERFLOW_TEXT.test(text)) return PANIC_MESSAGES["0x11"];

  // 4. User-rejected — keep it short + recognizable.
  if (/user rejected|user denied|rejected the request/i.test(text)) {
    return "You rejected the transaction in your wallet.";
  }

  // 5. Fall back to whatever viem gave us, trimmed.
  const fallback = e?.shortMessage ?? e?.message ?? String(err ?? "Unknown error");
  return fallback.length > 200 ? fallback.slice(0, 200) + "…" : fallback;
}
