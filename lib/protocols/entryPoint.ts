import type { Address, Hex } from "../eth/types";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

export const ENTRYPOINT_V07_ADDRESS: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const entryPointAbi = parseAbi([
  "function getNonce(address sender, uint192 key) view returns (uint256 nonce)",
]);

export function encodeEntryPointGetNonce(parameters: { sender: Address; key: bigint }): Hex {
  const { sender, key } = parameters;
  return encodeFunctionData({
    abi: entryPointAbi,
    functionName: "getNonce",
    args: [sender, key],
  });
}

export function decodeEntryPointGetNonce(result: Hex): bigint {
  return decodeFunctionResult({
    abi: entryPointAbi,
    functionName: "getNonce",
    data: result,
  });
}
