// The two signatures a SIMD-0385 v1 send needs from a Solana wallet, over two
// DIFFERENT byte strings, through two DIFFERENT wallet seams:
//
//   1. the AUTH signature — over the readable envelope "Rome authorization\n0x<hash>"
//      (the hash = keccak256(0x02‖rlp)); the proxy verifies it and embeds those
//      bytes in an Ed25519 verifier instruction the program checks.
//      Seam: `solana:signMessage` (bytes in, 64-byte signature out).
//   2. the TRANSACTION signature — over the composed v1 wire (`message ‖ one
//      64-byte zero slot`). Seam: `solana:signTransaction` on raw bytes; the
//      wallet-adapter `signTransaction(Transaction)` cannot carry a v1 wire.
//
// A wallet missing either feature cannot use the lane: fail closed, no fallback.
// Nothing here branches on a wallet's brand — Wallet Standard features only.

import { PublicKey } from "@solana/web3.js";
import { isAuthMessage } from "@/lib/solana/submit";

export interface LaneSigner {
  payer: PublicKey;
  /** Sign the readable authorisation envelope (`Rome authorization\n0x<hash hex>`, 85 bytes) via solana:signMessage; return the 64-byte ed25519 signature. */
  signAuthMessage: (message: Uint8Array) => Promise<Uint8Array>;
  /** Sign a full unsigned v1 wire; return the 64-byte TRANSACTION signature for its one slot. */
  signV1Wire: (unsignedWire: Uint8Array) => Promise<Uint8Array>;
  /** Sign several unsigned v1 wires in ONE wallet prompt (Wallet Standard signTransaction with several inputs); one 64-byte signature per wire, same order. Absent = the wallet cannot. */
  signV1Wires?: (unsignedWires: Uint8Array[]) => Promise<Uint8Array[]>;
}

export interface StandardAccount {
  address: string;
  chains?: readonly string[];
}

interface SignTransactionFeature {
  signTransaction(
    ...inputs: { account?: StandardAccount; transaction: Uint8Array; chain?: string }[]
  ): Promise<readonly { signedTransaction: Uint8Array }[]>;
}

interface SignMessageFeature {
  signMessage(
    ...inputs: { account?: StandardAccount; message: Uint8Array }[]
  ): Promise<readonly { signature: Uint8Array }[]>;
}

/** The subset of a Wallet Standard wallet this seam reads. */
export interface StandardWalletLike {
  readonly name?: string;
  readonly accounts?: readonly StandardAccount[];
  readonly features: Record<string, unknown>;
}

export const SIGN_TRANSACTION = "solana:signTransaction";
export const SIGN_MESSAGE = "solana:signMessage";

/**
 * Reach the Wallet Standard wallet behind a wallet-adapter adapter. Modern
 * Phantom / Solflare register through Wallet Standard, and wallet-adapter
 * wraps them in a `StandardWalletAdapter` whose `wallet` getter is the
 * standard object. A legacy adapter has no such property → null.
 */
export function standardWalletOf(adapter: unknown): StandardWalletLike | null {
  const w = (adapter as { wallet?: unknown } | null | undefined)?.wallet as StandardWalletLike | undefined;
  return w && typeof w === "object" && w.features && typeof w.features === "object" ? w : null;
}

export const FLAGGED_BY_MISTAKE_NOTE = "Your wallet flagged the first request by mistake — approve this one.";
// A wallet that says "rejected / denied / declined" is final. Solflare answers "Transaction cancelled"
// both for its Reject button and for the Close button on a false "Network mismatch" flag, so that
// message cannot be told apart and gets the one re-ask too.
const isDeliberateReject = (e: unknown) => /reject|denied|declin/i.test(e instanceof Error ? e.message : String(e));

/**
 * Some wallets occasionally refuse a perfectly good v1 request on the first ask
 * (e.g. a spurious "Network mismatch" flag) and accept the identical second one.
 * Ask once more, with a note to the user, unless the wallet says the user rejected it.
 */
async function askWalletTwice<T>(ask: () => Promise<T>, onNote?: (note: string) => void): Promise<T> {
  try {
    return await ask();
  } catch (e) {
    if (isDeliberateReject(e)) throw e;
    onNote?.(FLAGGED_BY_MISTAKE_NOTE);
    return await ask();
  }
}

/**
 * Build the lane signer from a Wallet Standard wallet + the connected account.
 * `chain` is the Wallet Standard chain id the wire is for (`solana:<cluster>`).
 * `onNote` receives the one-line note shown when the wallet is asked a second time.
 */
export function walletLaneSigner(wallet: StandardWalletLike, signer: string, chain: string, onNote?: (note: string) => void): LaneSigner {
  const signTx = wallet.features[SIGN_TRANSACTION] as SignTransactionFeature | undefined;
  const signMsg = wallet.features[SIGN_MESSAGE] as SignMessageFeature | undefined;
  const account = wallet.accounts?.find((a) => a.address === signer) ?? wallet.accounts?.[0];
  if (account && account.address !== signer) {
    throw new Error("The wallet's active account is not the connected one. Switch accounts in the wallet and retry.");
  }
  return {
    payer: new PublicKey(signer),
    signAuthMessage: async (message) => {
      if (!isAuthMessage(message)) throw new Error("signAuthMessage: only the readable 'Rome authorization' envelope is ever offered to the wallet.");
      if (!signMsg?.signMessage) {
        throw new Error("This wallet cannot sign a raw message (solana:signMessage), which the Solana lane needs.");
      }
      const [answer] = await signMsg.signMessage({ account, message });
      if (!answer?.signature || answer.signature.length !== 64) {
        throw new Error("The wallet did not return a 64-byte signature for the authorisation message.");
      }
      return answer.signature;
    },
    signV1Wire: async (unsignedWire) => {
      if (!signTx?.signTransaction) {
        throw new Error("This wallet cannot sign a Solana transaction over Wallet Standard (solana:signTransaction).");
      }
      if (unsignedWire.length < 65 || unsignedWire[0] !== 0x81) {
        throw new Error("signV1Wire: not a SIMD-0385 v1 wire (expected version byte 0x81).");
      }
      let answer: { signedTransaction: Uint8Array } | undefined;
      try {
        [answer] = await askWalletTwice(() => signTx.signTransaction({ account, transaction: unsignedWire, chain }), onNote);
      } catch (e) {
        throw new Error(`The wallet did not sign the transaction: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!answer?.signedTransaction || answer.signedTransaction.length !== unsignedWire.length) {
        throw new Error("The wallet returned a signed transaction of an unexpected length.");
      }
      const messageLen = unsignedWire.length - 64;
      for (let i = 0; i < messageLen; i++) {
        if (answer.signedTransaction[i] !== unsignedWire[i]) {
          throw new Error("The wallet altered the transaction message while signing; refusing to send it.");
        }
      }
      return answer.signedTransaction.subarray(messageLen);
    },
    signV1Wires: async (unsignedWires) => {
      if (!signTx?.signTransaction) throw new Error("This wallet cannot sign a Solana transaction over Wallet Standard (solana:signTransaction).");
      for (const [i, w] of unsignedWires.entries()) if (w.length < 65 || w[0] !== 0x81) throw new Error(`signV1Wires: input ${i + 1} is not a SIMD-0385 v1 wire.`);
      const answers = await askWalletTwice(() => signTx.signTransaction(...unsignedWires.map((transaction) => ({ account, transaction, chain }))), onNote);
      if (answers.length !== unsignedWires.length) throw new Error(`The wallet returned ${answers.length} signed transactions for ${unsignedWires.length}.`);
      return answers.map((a, i) => {
        const w = unsignedWires[i]!;
        if (!a?.signedTransaction || a.signedTransaction.length !== w.length) throw new Error(`The wallet returned step ${i + 1} at an unexpected length.`);
        const messageLen = w.length - 64;
        for (let k = 0; k < messageLen; k++) if (a.signedTransaction[k] !== w[k]) throw new Error(`The wallet altered step ${i + 1}'s message while signing; refusing to send it.`);
        return a.signedTransaction.subarray(messageLen);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Discovery: wallets announce themselves through the `wallet-standard:*` events.
// Used when the connected adapter is a legacy one (no `.wallet`) but the same
// extension also registered a Wallet Standard interface under the same name.
// ---------------------------------------------------------------------------
const registered: StandardWalletLike[] = [];
let listening = false;

export function discoverStandardWallets(): readonly StandardWalletLike[] {
  if (typeof window === "undefined") return registered;
  if (!listening) {
    listening = true;
    interface Api { register(...ws: StandardWalletLike[]): () => void }
    const api: Api = {
      register: (...ws) => { for (const w of ws) if (!registered.includes(w)) registered.push(w); return () => {}; },
    };
    window.addEventListener("wallet-standard:register-wallet", ((e: CustomEvent<(api: Api) => void>) => {
      try { e.detail(api); } catch { /* a wallet that dislikes our api object is simply not usable */ }
    }) as EventListener);
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
  }
  return registered;
}

export function findStandardWallet(name: string): StandardWalletLike | null {
  return discoverStandardWallets().find((w) => w.name === name) ?? null;
}
