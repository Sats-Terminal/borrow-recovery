import type { Address, Hex } from "../eth/types";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

const morphoBlueAbi = parseAbi([
  "function position(bytes32 marketId, address user) view returns (uint256 supplyShares, uint256 borrowShares, uint256 collateral)",
]);

export type MorphoBluePosition = {
  supplyShares: bigint;
  borrowShares: bigint;
  collateral: bigint;
};

export function encodeMorphoBluePosition(marketId: Hex, user: Address): Hex {
  return encodeFunctionData({
    abi: morphoBlueAbi,
    functionName: "position",
    args: [marketId, user],
  });
}

export function decodeMorphoBluePosition(result: Hex): MorphoBluePosition {
  const [supplyShares, borrowShares, collateral] = decodeFunctionResult({
    abi: morphoBlueAbi,
    functionName: "position",
    data: result,
  });

  return { supplyShares, borrowShares, collateral };
}
