"use client";

import { jsonRpcFetch } from "@/lib/rpc/jsonRpc";
import type { Hex } from "@/lib/eth/types";

import { describeActionError } from "./actionError";

type UserOperationReceiptResult = {
  success?: boolean;
  reason?: string;
  receipt?: {
    status?: Hex | string;
    blockNumber?: Hex | string;
    transactionHash?: Hex | string;
  };
  blockNumber?: Hex | string;
  transactionHash?: Hex | string;
};

export async function waitForUserOpReceipt(parameters: {
  bundlerUrl: string;
  userOpHash: Hex;
  operationLabel?: string;
  timeoutMs?: number;
}): Promise<void> {
  const {
    bundlerUrl,
    userOpHash,
    operationLabel = "UserOperation",
    timeoutMs = 60_000,
  } = parameters;

  const start = Date.now();
  let lastTransientErrorMessage: string | null = null;
  let lastLoggedTransientErrorMessage: string | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await jsonRpcFetch<UserOperationReceiptResult | null>(
        bundlerUrl,
        "eth_getUserOperationReceipt",
        [userOpHash],
      );

      if (result) {
        const receipt = result.receipt;
        const blockNumber = receipt?.blockNumber ?? result.blockNumber;
        const txHash = receipt?.transactionHash ?? result.transactionHash;
        const statusRaw = typeof receipt?.status === "string" ? receipt.status.toLowerCase() : null;
        const hasExplicitFailure = result.success === false || statusRaw === "0x0" || statusRaw === "0";
        const hasExplicitSuccess = result.success === true || statusRaw === "0x1" || statusRaw === "1";

        if (blockNumber && txHash) {
          if (hasExplicitFailure) {
            throw new Error(`${operationLabel} reverted${result.reason ? `: ${result.reason}` : "."}`);
          }
          if (hasExplicitSuccess) return;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`${operationLabel} reverted`)) {
        throw error;
      }

      const errorMessage = describeActionError(error, "");
      lastTransientErrorMessage = errorMessage || null;
      if (errorMessage && errorMessage !== lastLoggedTransientErrorMessage) {
        lastLoggedTransientErrorMessage = errorMessage;
        console.warn(`[${operationLabel}] transient receipt polling error`, error);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error(
    `Timed out waiting for ${operationLabel} to be mined.${lastTransientErrorMessage ? ` Last receipt error: ${lastTransientErrorMessage}` : ""}`,
  );
}
