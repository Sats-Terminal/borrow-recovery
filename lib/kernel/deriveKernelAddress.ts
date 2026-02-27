import { getValidatorAddress } from "@zerodev/ecdsa-validator";
import { KernelV3_1AccountAbi } from "@zerodev/sdk";
import {
  KERNEL_V3_3 as ZERODEV_KERNEL_V3_3,
  KernelVersionToAddressesMap,
  VALIDATOR_TYPE,
  getEntryPoint,
} from "@zerodev/sdk/constants";
import { concatHex, encodeFunctionData, getContractAddress, keccak256, toHex, zeroAddress } from "viem";

import type { Address, Hex } from "../eth/types";

const ENTRYPOINT_V07 = getEntryPoint("0.7");

// Locked v1 decisions
export const KERNEL_V3_3 = ZERODEV_KERNEL_V3_3;

const kernelV33Addresses = KernelVersionToAddressesMap[KERNEL_V3_3];

export const KERNEL_V3_3_FACTORY_ADDRESS = kernelV33Addresses.factoryAddress as Address;
export const KERNEL_V3_3_IMPLEMENTATION_ADDRESS =
  kernelV33Addresses.accountImplementationAddress as Address;
export const KERNEL_V3_3_INIT_CODE_HASH = kernelV33Addresses.initCodeHash as Hex;

export const ECDSA_VALIDATOR_ADDRESS = getValidatorAddress(
  ENTRYPOINT_V07,
  KERNEL_V3_3,
) as Address;

function kernelV33Salt(owner: Address, index: bigint): Hex {
  const initData = encodeFunctionData({
    abi: KernelV3_1AccountAbi,
    functionName: "initialize",
    args: [
      concatHex([VALIDATOR_TYPE.SECONDARY, ECDSA_VALIDATOR_ADDRESS]),
      zeroAddress,
      owner,
      "0x",
      [],
    ],
  });

  const encodedIndex = toHex(index, { size: 32 });
  return keccak256(concatHex([initData, encodedIndex]));
}

export function deriveKernelAddressV3_3FromEOA(owner: Address, index: bigint): Address {
  if (!KERNEL_V3_3_INIT_CODE_HASH) {
    throw new Error("Missing Kernel v3.3 init code hash in ZeroDev constants");
  }

  const salt = kernelV33Salt(owner, index);
  return getContractAddress({
    bytecodeHash: KERNEL_V3_3_INIT_CODE_HASH,
    opcode: "CREATE2",
    from: KERNEL_V3_3_FACTORY_ADDRESS,
    salt,
  }) as Address;
}
