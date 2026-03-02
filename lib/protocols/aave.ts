import type { Address, Hex } from "../eth/types";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

const aavePoolAbi = parseAbi([
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "function getReserveTokensAddresses(address asset) view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)",
]);

export type AaveUserAccountData = {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: bigint;
};

export function encodeAaveGetUserAccountData(user: Address): Hex {
  return encodeFunctionData({
    abi: aavePoolAbi,
    functionName: "getUserAccountData",
    args: [user],
  });
}

export function encodeAaveGetReserveTokensAddresses(asset: Address): Hex {
  return encodeFunctionData({
    abi: aavePoolAbi,
    functionName: "getReserveTokensAddresses",
    args: [asset],
  });
}

export function decodeAaveGetReserveTokensAddresses(result: Hex): {
  aTokenAddress: Address;
  stableDebtTokenAddress: Address;
  variableDebtTokenAddress: Address;
} {
  const [aTokenAddress, stableDebtTokenAddress, variableDebtTokenAddress] = decodeFunctionResult({
    abi: aavePoolAbi,
    functionName: "getReserveTokensAddresses",
    data: result,
  });
  return { aTokenAddress, stableDebtTokenAddress, variableDebtTokenAddress };
}

const MAX_UINT256 = 2n ** 256n - 1n;

/** Encode Pool.repay(asset, amount, interestRateMode, onBehalfOf) calldata directly. */
export function encodeAaveRepay(params: {
  asset: Address;
  amount: bigint;
  interestRateMode: bigint;
  onBehalfOf: Address;
}): Hex {
  return encodeFunctionData({
    abi: aavePoolAbi,
    functionName: "repay",
    args: [params.asset, params.amount, params.interestRateMode, params.onBehalfOf],
  });
}

/** Encode Pool.withdraw(asset, amount, to) calldata directly. */
export function encodeAaveWithdraw(params: {
  asset: Address;
  amount: bigint;
  to: Address;
}): Hex {
  return encodeFunctionData({
    abi: aavePoolAbi,
    functionName: "withdraw",
    args: [params.asset, params.amount, params.to],
  });
}

export { MAX_UINT256 };

export function decodeAaveGetUserAccountData(result: Hex): AaveUserAccountData {
  const words = decodeFunctionResult({
    abi: aavePoolAbi,
    functionName: "getUserAccountData",
    data: result,
  });

  const [
    totalCollateralBase,
    totalDebtBase,
    availableBorrowsBase,
    currentLiquidationThreshold,
    ltv,
    healthFactor,
  ] = words;
  return {
    totalCollateralBase,
    totalDebtBase,
    availableBorrowsBase,
    currentLiquidationThreshold,
    ltv,
    healthFactor,
  };
}
