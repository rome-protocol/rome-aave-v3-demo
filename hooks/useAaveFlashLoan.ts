"use client";

// Phase-machine hook for Pool.flashLoanSimple. Unlike supply/repay there
// is no caller-side approve to do here — repayment + premium are pulled
// from the *receiver* during the executeOperation callback. The caller's
// responsibility is purely to launch the tx with a receiver that
// implements IFlashLoanSimpleReceiver correctly.
//
// The receiver address comes from the user-facing input; we don't ship
// a bundled receiver because the smoke receiver in rome-aave-v3 needs
// caller-side pre-funding of the premium and so can't double as a
// permanent on-chain fixture.

import { useCallback, useMemo, useState } from "react";
import {
  usePublicClient,
} from "wagmi";
import { useActiveAddress } from "@/hooks/useActiveLane";
import { useSendAaveCall } from "@/hooks/useSendAaveCall";
import { isAddress, isHex, parseUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { PoolAbi } from "@/lib/abi";
import { hadrian } from "@/lib/wagmi";
import { decodeAaveError } from "@/lib/decode-aave-error";
import { confirmTx } from "@/lib/wait-for-receipt";
import { markFresh } from "@/lib/fresh";

export type FlashLoanPhase = "editing" | "executing" | "success" | "error";

export interface UseAaveFlashLoanInput {
  asset: `0x${string}` | undefined;
  pool: `0x${string}` | undefined;
  decimals: number;
  amount: string;
  receiver: string;
  paramsHex: string;
}

export interface UseAaveFlashLoanResult {
  phase: FlashLoanPhase;
  amountRaw: bigint;
  executeHash: `0x${string}` | null;
  error: string | null;
  submit: () => Promise<void>;
  reset: () => void;
}

export function useAaveFlashLoan({
  asset,
  pool,
  decimals,
  amount,
  receiver,
  paramsHex,
}: UseAaveFlashLoanInput): UseAaveFlashLoanResult {
  const { address: user } = useActiveAddress();
  const { sendCall, ensureWrapperGrant, wasRelayed } = useSendAaveCall();
  const publicClient = usePublicClient({ chainId: hadrian.id });
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<FlashLoanPhase>("editing");
  const [executeHash, setExecuteHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amountRaw = useMemo<bigint>(() => {
    if (!amount) return 0n;
    try {
      const parsed = parseUnits(amount, decimals);
      return parsed > 0n ? parsed : 0n;
    } catch {
      return 0n;
    }
  }, [amount, decimals]);

  const submit = useCallback(async () => {
    // A new attempt starts clean: a link from an earlier attempt must not show in this one's error phase.
    setExecuteHash(null);
    if (!user || !asset || !pool || !publicClient) {
      setError("Wallet or chain not ready");
      setPhase("error");
      return;
    }
    if (amountRaw === 0n) {
      setError("Amount must be > 0");
      setPhase("error");
      return;
    }
    if (!isAddress(receiver)) {
      setError("Receiver must be a valid 0x… address");
      setPhase("error");
      return;
    }
    const params = paramsHex && paramsHex !== "" ? paramsHex : "0x";
    if (!isHex(params)) {
      setError("Calldata must be 0x-prefixed hex (or empty / 0x)");
      setPhase("error");
      return;
    }
    setError(null);

    try {
      setPhase("executing");
      const args = [
        receiver as `0x${string}`,
        asset,
        amountRaw,
        params as `0x${string}`,
        0,
      ] as const;
      const xHash = await sendCall({ address: pool, abi: PoolAbi, functionName: "flashLoanSimple", args });
      setExecuteHash(xHash);
      await confirmTx(publicClient, xHash, wasRelayed(xHash));

      setPhase("success");

      // Refresh history + market totals so the event lands on /history
      // and supply/borrow numbers reflect the round-trip.
      markFresh();
      void queryClient.invalidateQueries({ queryKey: ["history"] });
      void queryClient.invalidateQueries({ queryKey: ["aave-config"] });
    } catch (e: unknown) {
      setError(decodeAaveError(e));
      setPhase("error");
    }
  }, [user, asset, pool, publicClient, amountRaw, receiver, paramsHex, sendCall,
    ensureWrapperGrant,
    wasRelayed, queryClient]);

  const reset = useCallback(() => {
    setPhase("editing");
    setExecuteHash(null);
    setError(null);
  }, []);

  return { phase, amountRaw, executeHash, error, submit, reset };
}
