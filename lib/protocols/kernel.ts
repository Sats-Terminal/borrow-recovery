import { encodeCallDataEpV07 } from "@zerodev/sdk";

import type { Address, Hex } from "../eth/types";

type KernelCall = {
  target: Address;
  value?: bigint | undefined;
  callData?: Hex | undefined;
};

/**
 * Encodes Kernel v3 `execute(bytes32 execMode, bytes executionCalldata)` using
 * the exact ZeroDev SDK EP0.7 calldata encoder for single/batched call bundles.
 */
export async function encodeKernelExecuteCalls(calls: readonly KernelCall[]): Promise<Hex> {
  if (calls.length === 0) throw new Error("No calls to encode.");
  return encodeCallDataEpV07(
    calls.map((call) => ({
      to: call.target,
      value: call.value ?? 0n,
      data: call.callData ?? "0x",
    })),
  );
}
