// Re-export logger for convenience
export { logger } from './logger';

// Generic/uninformative message strings that wallets and JSON-RPC
// clients use to wrap a more specific cause. We unwrap them to expose
// the inner reason ("execution reverted: INSUFFICIENT_A_AMOUNT") so
// the user sees something actionable instead of "Internal JSON-RPC
// error".
const GENERIC_ERROR_PHRASES = [
  'internal json-rpc error',
  'execution reverted',
  'request failed',
  'rpc error',
  'transaction failed',
  'unknown error',
  'invalid params',
];

function isGenericPhrase(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return GENERIC_ERROR_PHRASES.some((p) => lower === p || lower === `${p}.`);
}

export function getErrorText(error: unknown): string {
  // Walk the error tree and collect every candidate message string;
  // prefer the deepest non-generic one. MetaMask wraps reverts as
  // `{ message: "Internal JSON-RPC error", data: { message: "execution reverted: <reason>" } }` —
  // returning the top-level .message hides the reason.
  const candidates: string[] = [];

  const walk = (value: unknown, depth = 0): void => {
    if (!value || depth > 6) return;
    if (typeof value === 'string') {
      if (value.trim()) candidates.push(value);
      return;
    }
    if (typeof value !== 'object') {
      candidates.push(String(value));
      return;
    }

    const record = value as Record<string, unknown>;
    const fieldOrder = [
      'shortMessage',
      'reason',
      'data',
      'cause',
      'error',
      'details',
      'message',
    ];
    for (const field of fieldOrder) {
      const next = record[field];
      if (next !== undefined && next !== value) {
        walk(next, depth + 1);
      }
    }
  };

  walk(error);

  if (candidates.length === 0) {
    return String(error ?? '');
  }

  // Prefer the deepest specific message. We collect in DFS order so
  // later items in the array are typically deeper. Find the last
  // non-generic one.
  for (let i = candidates.length - 1; i >= 0; i--) {
    if (!isGenericPhrase(candidates[i])) {
      // If it's just "execution reverted: <reason>", strip the prefix
      // so the surfaced message is the bare reason.
      const m = candidates[i].match(/execution reverted:?\s*(.+)/i);
      if (m && m[1].trim() && !isGenericPhrase(m[1])) {
        return m[1].trim();
      }
      return candidates[i];
    }
  }

  // All candidates are generic — return the first one as fallback.
  return candidates[0];
}

// Translate common low-level revert codes / wallet error wrappers into
// a sentence the user can act on. Matches on substrings rather than
// full messages so we still hit when wallet wrappers truncate the
// original.
const FRIENDLY_ERROR_PATTERNS: Array<[RegExp, string]> = [
  [/INSUFFICIENT_A_AMOUNT/i, "Slippage too tight — pool moved against you. Try increasing slippage tolerance and retrying."],
  [/INSUFFICIENT_B_AMOUNT/i, "Slippage too tight — pool moved against you. Try increasing slippage tolerance and retrying."],
  [/INSUFFICIENT_OUTPUT_AMOUNT/i, "Slippage too tight — output dropped below your minimum. Try increasing slippage tolerance."],
  [/INSUFFICIENT_LIQUIDITY/i, "Pool has insufficient liquidity for this size. Try a smaller amount or pick a different pool."],
  [/EXPIRED/i, "Transaction expired before it could be mined. Submit again."],
  [/TRANSFER_FROM_FAILED/i, "Token transfer failed — your approval may be too low or your balance changed. Re-approve and retry."],
  [/INVALID_PATH/i, "Swap path is invalid. Pick different tokens."],
  // Rome-specific: pools that hold an ERC20-SPL wrapper require the
  // manual-split path (one tx per hop) because the router's atomic
  // transferFrom triggers an SPL CPI that Rome's tx model can't roll
  // back if a downstream step fails. The Create Pool flow does the
  // split automatically; Add Liquidity to an existing wrapper pool
  // hits this revert today.
  [/Cannot revert (cross[- ]program invocation|CPI)/i, "This pool holds an SPL-backed token (e.g. wUSDC). The standard router can't atomically transfer an SPL wrapper on Rome — use the Create Pool flow instead; it routes through the manual-split path and works for both creating and adding to wrapper-backed pools."],
  [/CpiProhibitedInNonAtomicTx|CpiOnly|WritableAccountsProhibited/i, "This action requires an atomic Rome transaction that the current path can't deliver. Try a smaller amount or use the Create Pool flow."],
  // Rome-specific: SDK now Mollusk-emulates SBF before submission (rome-sdk #321)
  // and rejects when the actual CU consumption exceeds Solana's 1.4M atomic budget.
  // Common causes: an action that touches multiple SPL_ERC20 wrappers in one tx
  // (each transfer_checked CPI is ~6k CU, plus dispatch overhead). Mitigations
  // depend on flow: split approve from action; unwrap a wrapper to native gas
  // first when the chain's gas mint is the wrapper's underlying SPL; or use the
  // Create Pool flow's manual-split path for wrapper-backed pools.
  [/TooManyComputeUnitsInAtomicTx|too many compute units|exceeds.*compute.*unit/i, "This transaction is too large for a single Rome atomic step. Try a smaller amount, split it into separate approve + action steps, or unwrap one side back to native gas first if you're moving the gas-mint wrapper."],
  // Rome-specific: Solana System Program `ResultWithNegativeLamports`
  // surfaces in viem as `Custom(1)` / `mollusk Failure(Custom(1))`,
  // or as the bare phrase via other paths. Means the user's unified
  // Rome PDA on Solana ran out of SOL mid-CPI (typically ATA-init
  // rent) and the runtime aborted the sub-instruction. BridgePage
  // detects this locally and renders UserPdaTopUpPrompt; every other
  // flow (swap, add-liq, create-pool, wrap, unwrap) used to dump the
  // raw error onto the user. Map to a single actionable sentence.
  [/Custom\(1\)|ResultWithNegativeLamports|insufficient lamports/i, "Your unified Rome account (PDA on Solana) ran out of SOL mid-operation. Top up the PDA with a small amount of SOL and retry."],
  [/insufficient funds/i, "Not enough native gas to cover this transaction. Top up your balance."],
  [/nonce too low|nonce has already been used/i, "Wallet nonce out of sync. Reset the account in your wallet's advanced settings, then retry."],
  [/replacement transaction underpriced/i, "Another transaction is in flight from this wallet. Wait for it to confirm, then retry."],
  [/^internal json-rpc error\.?$/i, "Wallet's RPC returned a generic error. Check your wallet's network / RPC settings, then retry."],
  // Last-resort: a bare hex-bytes payload made it all the way to the
  // user (no decoded selector, no sibling message). Historically we
  // surfaced "0x000…e8d4a51000" raw, which means nothing to a user.
  // Replace with a generic actionable sentence. Earlier patterns
  // (INSUFFICIENT_*, Custom(1), etc.) match first, so this only
  // catches the genuinely undecoded case.
  [/^0x[0-9a-f]{40,}$/i, "Transaction reverted with an undecoded payload. Common causes: a token decimal/precision mismatch, a missing allowance, or a stale price/pool state. Check the token decimals and allowances for the contracts involved, then retry."],
];

/**
 * Sanitize error message for user display
 * Removes technical details, stack traces, paths
 */
export function sanitizeError(error: unknown): string {
  if (!error) return 'An error occurred';
  const errorMessage = getErrorText(error) || 'Operation failed. Please try again.';

  // Map well-known revert / wallet-error patterns to actionable copy.
  for (const [pattern, friendly] of FRIENDLY_ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) return friendly;
  }

  // List of patterns to clean
  const patternsToRemove = [
    /at\s+.*\(.*:\d+:\d+\)/g,  // Stack trace lines
    /\[.*?:\d+:\d+\]/g,        // File paths with line numbers
    /Error:.*?at\s/g,           // Error prefix with "at"
    /\(code=\d+.*?\)/g,         // Error codes in parentheses
    /version=[\d.]+/g,          // Version info
    /node_modules.*?\)/g,       // Node modules paths
    /webpack.*?\)/g,            // Webpack paths
    /\bat\b.*$/gm,              // Stack trace "at" lines
  ];

  let cleaned = errorMessage;

  // Remove all patterns
  for (const pattern of patternsToRemove) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Remove multiple spaces and newlines
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // If result is too technical or empty, return generic message
  if (!cleaned || cleaned.length < 5) {
    return 'Operation failed. Please try again.';
  }

  // Truncate if too long (prevent info leak)
  if (cleaned.length > 240) {
    cleaned = cleaned.substring(0, 240) + '...';
  }

  return cleaned;
}

/**
 * Check if error is user cancellation
 */
export function isUserCancellation(error: unknown): boolean {
  if (!error) return false;
  
  const message = getErrorText(error);
  const code = (error as { code?: number })?.code;
  
  return (
    code === 4001 ||
    message.includes('User rejected') ||
    message.includes('user rejected') ||
    message.includes('User denied') ||
    message.includes('cancelled by user') ||
    message.includes('USER_CANCELLED')
  );
}
