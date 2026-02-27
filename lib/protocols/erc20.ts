import type { Address, Hex } from "../eth/types";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export function encodeErc20BalanceOf(owner: Address): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

export function decodeErc20BalanceOf(result: Hex): bigint {
  return decodeFunctionResult({
    abi: erc20Abi,
    functionName: "balanceOf",
    data: result,
  });
}

export function encodeErc20Transfer(to: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
}

export function encodeErc20Approve(spender: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
}
