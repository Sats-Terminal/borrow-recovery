"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { submitKernelUserOperationV07 } from "@/lib/accountAbstraction/submitUserOpV07";
import type { SupportedChainId } from "@/lib/chains";
import type { Address, Hex } from "@/lib/eth/types";
import { encodeErc20Transfer } from "@/lib/protocols/erc20";
import { encodeKernelExecuteCalls } from "@/lib/protocols/kernel";

import { ButtonSpinner, getPendingButtonLabel } from "./ButtonSpinner";
import { reportActionError } from "./actionError";
import { waitForUserOpReceipt } from "./waitForUserOpReceipt";

function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const v = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const int = v / base;
  const frac = v % base;
  if (decimals === 0) return `${negative ? "-" : ""}${int.toString()}`;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${int.toString()}${fracStr ? `.${fracStr}` : ""}`;
}

type Asset = {
  symbol: string;
  address: Address;
  decimals: number;
};

export function TransferOutAction(props: {
  chainId: SupportedChainId;
  chainRpcUrl: string;
  owner: Address;
  kernelAddress: Address;
  asset: Asset;
  balance: bigint | null;
  bundlerUrl: string;
  ensureActionReady: () => boolean;
  notify: (toast: { title: string; description?: string; tone?: "error" | "info" }) => void;
  onSuccess?: (() => Promise<void> | void) | undefined;
  request: (method: string, params?: unknown[] | object) => Promise<unknown>;
  switchChain: (chainId: number) => Promise<void>;
}) {
  const { chainId, chainRpcUrl, owner, kernelAddress, asset, balance, bundlerUrl, ensureActionReady, notify, onSuccess, request, switchChain } = props;

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
    if (!isSubmitting) return "Transfer all to connected wallet";

    return getPendingButtonLabel(status, {
      preparing: "Preparing transfer…",
      waitingForWallet: "Confirm transfer in wallet…",
      submitting: "Submitting transfer…",
      confirming: "Confirming transfer…",
      refreshing: "Refreshing positions…",
    });
  }, [isSubmitting, status]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            {asset.symbol}
          </div>
          <div className="mt-1 text-lg font-semibold">
            {balance === null ? (
              <span className="text-zinc-300">&mdash;</span>
            ) : (
              formatUnits(balance, asset.decimals)
            )}
          </div>
        </div>
        {hasBalance ? (
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
                  description: "Add a ZeroDev Project ID or full bundler RPC URL before transferring funds out.",
                });
                return;
              }

              setIsSubmittingSafe(true);

              try {
                if (!balance || balance <= 0n) throw new Error("No balance to transfer.");

                setStatusSafe("Switching network (if needed)...");
                await switchChain(chainId);

                setStatusSafe("Building transfer call...");
                const transferCallData = encodeErc20Transfer(owner, balance);

                const kernelCallData = await encodeKernelExecuteCalls([
                  {
                    target: asset.address,
                    callData: transferCallData,
                    value: 0n,
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
                setStatusSafe("Transfer submitted. Waiting for confirmation…");
                await waitForUserOpReceipt({
                  bundlerUrl,
                  userOpHash: sentHash,
                  operationLabel: `${asset.symbol} transfer UserOperation`,
                });
                setStatusSafe("Transfer confirmed. Refreshing positions…");
                await onSuccess?.();
                setStatusSafe("Transfer confirmed.");
              } catch (e) {
                const message = reportActionError({
                  context: `${asset.symbol} transfer`,
                  error: e,
                  fallbackMessage: `${asset.symbol} transfer failed.`,
                  toastTitle: `${asset.symbol} transfer failed`,
                  notify,
                });
                setErrorSafe(message);
                setStatusSafe(null);
              } finally {
                setIsSubmittingSafe(false);
              }
            }}
          >
            {isSubmitting ? <ButtonSpinner /> : null}
            <span>{buttonLabel}</span>
          </button>
        ) : null}
      </div>
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
