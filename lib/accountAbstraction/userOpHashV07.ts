import { getUserOperationHash } from "viem/account-abstraction";

import type { Address, Hex } from "../eth/types";

export type UserOperationV07 = {
  sender: Address;
  nonce: bigint;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  signature: Hex;
  factory?: Address | undefined;
  factoryData?: Hex | undefined;
  paymaster?: Address | undefined;
  paymasterData?: Hex | undefined;
  paymasterVerificationGasLimit?: bigint | undefined;
  paymasterPostOpGasLimit?: bigint | undefined;
};

export function getUserOperationHashV07(parameters: {
  userOperation: UserOperationV07;
  entryPointAddress: Address;
  chainId: number;
}): Hex {
  const { userOperation, entryPointAddress, chainId } = parameters;
  return getUserOperationHash({
    chainId,
    entryPointAddress,
    entryPointVersion: "0.7",
    userOperation,
  });
}
