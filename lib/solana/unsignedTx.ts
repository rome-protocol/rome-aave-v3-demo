// The bare unsigned EIP-1559 body the Solana lane sends: viem's serialisation
// with the leading 0x02 type byte removed. There is NO signature — the sender
// is the synthetic address rome-evm derives from the Solana signer of the
// enclosing transaction. Byte-locked against a real proxy capture in the test.
import { serializeTransaction, type Hex } from "viem";

export interface UnsignedEip1559 {
  chainId: number | bigint;
  nonce: number | bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  /** undefined = contract creation */
  to?: `0x${string}`;
  value?: bigint;
  /** call data, default '0x' */
  data?: `0x${string}`;
}

export function buildUnsignedEip1559Rlp(tx: UnsignedEip1559): Hex {
  const serialized = serializeTransaction({
    type: "eip1559",
    chainId: Number(tx.chainId),
    nonce: Number(tx.nonce),
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    maxFeePerGas: tx.maxFeePerGas,
    gas: tx.gasLimit,
    to: tx.to,
    value: tx.value ?? 0n,
    data: tx.data ?? "0x",
    accessList: [],
  });
  return `0x${serialized.slice(4)}`;
}
