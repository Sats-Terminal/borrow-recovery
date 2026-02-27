"use client";

import { providers } from "ethers";
import { useMemo, useState } from "react";

import { submitKernelUserOperationV07 } from "@/lib/accountAbstraction/submitUserOpV07";
import { getChainConfig, type SupportedChainId } from "@/lib/chains";
import type { Address, Hex } from "@/lib/eth/types";
import { encodeKernelExecuteCalls } from "@/lib/protocols/kernel";
import {
  buildMorphoRepayTxsWithBackendLogic,
  buildMorphoWithdrawTxsWithBackendLogic,
  type MorphoParityMarketConfig,
} from "@/lib/protocols/morphoBackendParity";
type MorphoAction = "withdraw" | "repay";

function parseUnits(value: string, decimals: number): bigint {
  const s = value.trim();
  if (!s) throw new Error("Amount is required");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Invalid amount");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`Too many decimal places (max ${decimals}).`);
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

type Asset = {
  symbol: string;
  decimals: number;
};

export function MorphoRescueActions(props: {
  chainId: SupportedChainId;
  owner: Address;
  kernelAddress: Address;
  market: MorphoParityMarketConfig;
  collateralAsset: Asset;
  loanAsset: Asset;
  bundlerUrl: string;
  getProvider: () => Promise<{
    request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  }>;
  request: (method: string, params?: unknown[] | object) => Promise<unknown>;
  switchChain: (chainId: number) => Promise<void>;
}) {
  const { chainId, owner, kernelAddress, market, collateralAsset, loanAsset, bundlerUrl, getProvider, request, switchChain } = props;
  const [action, setAction] = useState<MorphoAction>("withdraw");
  const [useMax, setUseMax] = useState(true);
  const [amountInput, setAmountInput] = useState("0");

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUserOpHash, setLastUserOpHash] = useState<Hex | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedDecimals = action === "withdraw" ? collateralAsset.decimals : loanAsset.decimals;
  const amountLabel =
    action === "withdraw"
      ? `Amount (${collateralAsset.symbol})`
      : `Amount (${loanAsset.symbol})`;
  const maxLabel = action === "withdraw" ? "Withdraw all collateral" : "Repay all debt";

  const amountForProtocol = useMemo(() => {
    if (useMax) return "-1";
    try {
      const parsed = parseUnits(amountInput, selectedDecimals);
      if (parsed <= 0n) return null;
      return amountInput;
    } catch {
      return null;
    }
  }, [amountInput, selectedDecimals, useMax]);

  return (
    <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
        Rescue actions
      </h3>

      <div className="mt-3 space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          Withdraw collateral or repay debt on your ZeroDev Kernel wallet via Morpho Blue.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-sm">Action</span>
            <select
              className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
              value={action}
              onChange={(e) => {
                setAction(e.target.value as MorphoAction);
                setUseMax(true);
              }}
            >
              <option value="withdraw">Withdraw collateral</option>
              <option value="repay">Repay debt</option>
            </select>
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useMax} onChange={() => setUseMax((v) => !v)} />
            {maxLabel}
          </label>

          {!useMax ? (
            <label className="flex items-center gap-2">
              <span className="text-sm">{amountLabel}</span>
              <input
                className="h-11 w-40 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0.01"
              />
            </label>
          ) : null}
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-fit items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          disabled={!bundlerUrl || amountForProtocol === null || isSubmitting}
          onClick={async () => {
            if (isSubmitting) return;
            setIsSubmitting(true);
            setError(null);
            setStatus(null);
            setLastUserOpHash(null);

            try {
              if (amountForProtocol === null) throw new Error("Invalid amount.");

              setStatus("Switching network (if needed)…");
              await switchChain(chainId);

              setStatus("Building Morpho calls…");
              const connectedProvider = await getProvider();
              const ethersProvider = new providers.Web3Provider(
                connectedProvider as providers.ExternalProvider,
              );

              const protocolTxs = action === "withdraw"
                ? await buildMorphoWithdrawTxsWithBackendLogic({
                    provider: ethersProvider,
                    market,
                    userAddress: kernelAddress,
                    amount: amountForProtocol,
                  })
                : await buildMorphoRepayTxsWithBackendLogic({
                    provider: ethersProvider,
                    market,
                    userAddress: kernelAddress,
                    amount: amountForProtocol,
                  });

              const kernelCallData = await encodeKernelExecuteCalls(
                protocolTxs.map((call) => ({
                  target: call.to as Address,
                  callData: call.data as Hex,
                  value: BigInt(call.value),
                })),
              );

              const chainConfig = getChainConfig(chainId);
              const sentHash = await submitKernelUserOperationV07({
                bundlerUrl,
                chainRpcUrl: chainConfig?.rpcUrl ?? "https://mainnet.base.org",
                owner,
                kernelAddress,
                chainId,
                kernelCallData,
                request,
                onStatus: setStatus,
              });

              setLastUserOpHash(sentHash);
              setStatus("Submitted.");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Rescue action failed.");
              setStatus(null);
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          {isSubmitting ? "Submitting…" : "Execute Morpho action via Kernel"}
        </button>

        {status ? <p className="text-sm text-zinc-600 dark:text-zinc-400">{status}</p> : null}
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        {lastUserOpHash ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            UserOp hash: <span className="font-mono">{lastUserOpHash}</span>
          </p>
        ) : null}
      </div>
    </section>
  );
}
