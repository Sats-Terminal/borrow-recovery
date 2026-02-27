"use client";

import { useEffect, useRef, useState } from "react";

import { submitKernelUserOperationV07 } from "@/lib/accountAbstraction/submitUserOpV07";
import { getChainConfig, type SupportedChainId } from "@/lib/chains";
import type { Address, Hex } from "@/lib/eth/types";
import { encodeErc20Transfer } from "@/lib/protocols/erc20";
import { encodeKernelExecuteCalls } from "@/lib/protocols/kernel";

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
  owner: Address;
  kernelAddress: Address;
  asset: Asset;
  balance: bigint | null;
  bundlerUrl: string;
  request: (method: string, params?: unknown[] | object) => Promise<unknown>;
  switchChain: (chainId: number) => Promise<void>;
}) {
  const { chainId, owner, kernelAddress, asset, balance, bundlerUrl, request, switchChain } = props;

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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            {asset.symbol}
          </div>
          <div className="mt-1 text-lg font-semibold">
            {balance === null ? (
              <span className="text-zinc-300 dark:text-zinc-600">&mdash;</span>
            ) : (
              formatUnits(balance, asset.decimals)
            )}
          </div>
        </div>
        {hasBalance ? (
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-400"
            disabled={!bundlerUrl || isSubmitting}
            onClick={async () => {
              if (isSubmitting) return;
              setIsSubmittingSafe(true);
              setErrorSafe(null);
              setStatusSafe(null);
              setLastUserOpHashSafe(null);

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

                const chain = getChainConfig(chainId);
                const sentHash = await submitKernelUserOperationV07({
                  bundlerUrl,
                  chainRpcUrl: chain?.rpcUrl ?? "",
                  owner,
                  kernelAddress,
                  chainId,
                  kernelCallData,
                  request,
                  onStatus: setStatusSafe,
                });

                setLastUserOpHashSafe(sentHash);
                setStatusSafe("Transfer submitted.");
              } catch (e) {
                setErrorSafe(e instanceof Error ? e.message : "Transfer failed.");
                setStatusSafe(null);
              } finally {
                setIsSubmittingSafe(false);
              }
            }}
          >
            {isSubmitting ? "Submitting…" : "Transfer all to connected wallet"}
          </button>
        ) : null}
      </div>
      {status ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{status}</p> : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {lastUserOpHash ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          UserOp: <span className="font-mono">{lastUserOpHash}</span>
        </p>
      ) : null}
    </div>
  );
}
