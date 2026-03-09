"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  estimateKernelUserOperationFeeV07,
  submitKernelUserOperationV07,
} from "@/lib/accountAbstraction/submitUserOpV07";
import type { SupportedChainId } from "@/lib/chains";
import type { Address, Hex } from "@/lib/eth/types";
import { encodeKernelExecuteCalls } from "@/lib/protocols/kernel";

import { ButtonSpinner, getPendingButtonLabel } from "./ButtonSpinner";
import { waitForUserOpReceipt } from "./waitForUserOpReceipt";

export function NativeTransferOutAction(props: {
  chainId: SupportedChainId;
  chainRpcUrl: string;
  owner: Address;
  kernelAddress: Address;
  nativeSymbol: string;
  balance: bigint | null;
  bundlerUrl: string;
  ensureActionReady: () => boolean;
  notify: (toast: { title: string; description?: string; tone?: "error" | "info" }) => void;
  onSuccess?: (() => Promise<void> | void) | undefined;
  request: (method: string, params?: unknown[] | object) => Promise<unknown>;
  switchChain: (chainId: number) => Promise<void>;
}) {
  const {
    chainId,
    chainRpcUrl,
    owner,
    kernelAddress,
    nativeSymbol,
    balance,
    bundlerUrl,
    ensureActionReady,
    notify,
    onSuccess,
    request,
    switchChain,
  } = props;

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUserOpHash, setLastUserOpHash] = useState<Hex | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setStatusSafe = (value: string | null) => {
    if (mountedRef.current) setStatus(value);
  };
  const setErrorSafe = (value: string | null) => {
    if (mountedRef.current) setError(value);
  };
  const setLastUserOpHashSafe = (value: Hex | null) => {
    if (mountedRef.current) setLastUserOpHash(value);
  };
  const setIsSubmittingSafe = (value: boolean) => {
    if (mountedRef.current) setIsSubmitting(value);
  };

  const hasBalance = balance !== null && balance > 0n;
  const buttonLabel = useMemo(() => {
    if (!isSubmitting) return `Transfer max ${nativeSymbol} to connected wallet`;

    return getPendingButtonLabel(status, {
      preparing: `Preparing ${nativeSymbol} transfer…`,
      waitingForWallet: `Confirm ${nativeSymbol} transfer in wallet…`,
      submitting: `Submitting ${nativeSymbol} transfer…`,
      confirming: `Confirming ${nativeSymbol} transfer…`,
      refreshing: "Refreshing positions…",
    });
  }, [isSubmitting, nativeSymbol, status]);

  return (
    <div className="mt-3 flex flex-col gap-2">
      {hasBalance ? (
        <>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-50"
            aria-busy={isSubmitting}
            disabled={isSubmitting}
            onClick={async () => {
              if (isSubmitting) return;

              setErrorSafe(null);
              setStatusSafe(null);
              setLastUserOpHashSafe(null);

              if (!ensureActionReady()) return;
              if (!bundlerUrl) {
                notify({
                  title: "ZeroDev configuration required",
                  description: "Add a ZeroDev Project ID or full bundler RPC URL before transferring native balance out.",
                });
                return;
              }

              setIsSubmittingSafe(true);

              try {
                if (!balance || balance <= 0n) {
                  throw new Error(`No ${nativeSymbol} balance to transfer.`);
                }

                setStatusSafe("Switching network (if needed)...");
                await switchChain(chainId);

                setStatusSafe(`Estimating max ${nativeSymbol} transfer after gas…`);
                const estimationCallData = await encodeKernelExecuteCalls([
                  {
                    target: owner,
                    callData: "0x",
                    value: 0n,
                  },
                ]);
                const estimatedFee = await estimateKernelUserOperationFeeV07({
                  bundlerUrl,
                  chainRpcUrl,
                  kernelAddress,
                  kernelCallData: estimationCallData,
                  request,
                  onStatus: setStatusSafe,
                });
                const transferAmount = balance - estimatedFee;
                if (transferAmount <= 0n) {
                  throw new Error(`Not enough ${nativeSymbol} balance to cover the estimated UserOperation fee.`);
                }

                setStatusSafe(`Building ${nativeSymbol} transfer...`);
                const kernelCallData = await encodeKernelExecuteCalls([
                  {
                    target: owner,
                    callData: "0x",
                    value: transferAmount,
                  },
                ]);

                const sentHash = await submitKernelUserOperationV07({
                  bundlerUrl,
                  chainRpcUrl,
                  owner,
                  kernelAddress,
                  chainId,
                  kernelCallData,
                  request,
                  onStatus: setStatusSafe,
                });

                setLastUserOpHashSafe(sentHash);
                setStatusSafe(`Transfer submitted. Waiting for ${nativeSymbol} confirmation…`);
                await waitForUserOpReceipt({
                  bundlerUrl,
                  userOpHash: sentHash,
                  operationLabel: `${nativeSymbol} transfer UserOperation`,
                });
                setStatusSafe("Transfer confirmed. Refreshing positions…");
                await onSuccess?.();
                setStatusSafe("Transfer confirmed.");
              } catch (e) {
                setErrorSafe(e instanceof Error ? e.message : `${nativeSymbol} transfer failed.`);
                setStatusSafe(null);
              } finally {
                setIsSubmittingSafe(false);
              }
            }}
          >
            {isSubmitting ? <ButtonSpinner /> : null}
            <span>{buttonLabel}</span>
          </button>
          <p className="text-xs text-[var(--muted)]">
            Transfers the full balance minus the estimated UserOperation gas cost at submission time.
          </p>
        </>
      ) : null}
      {status ? <p className="text-xs text-zinc-500">{status}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {lastUserOpHash ? (
        <p className="text-xs text-zinc-500">
          UserOp: <span className="font-mono">{lastUserOpHash}</span>
        </p>
      ) : null}
    </div>
  );
}
