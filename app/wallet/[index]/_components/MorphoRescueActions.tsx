"use client";

import { providers } from "ethers";
import { useEffect, useMemo, useRef, useState } from "react";

import { submitKernelUserOperationV07 } from "@/lib/accountAbstraction/submitUserOpV07";
import type { SupportedChainId } from "@/lib/chains";
import type { Address, Hex } from "@/lib/eth/types";
import { encodeKernelExecuteCalls } from "@/lib/protocols/kernel";
import {
  buildMorphoRepayTxsWithBackendLogic,
  buildMorphoWithdrawTxsWithBackendLogic,
  type MorphoParityMarketConfig,
} from "@/lib/protocols/morphoBackendParity";

import { ButtonSpinner } from "./ButtonSpinner";
import { waitForUserOpReceipt } from "./waitForUserOpReceipt";
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
  chainRpcUrl: string;
  owner: Address;
  kernelAddress: Address;
  market: MorphoParityMarketConfig;
  collateralAsset: Asset;
  loanAsset: Asset;
  bundlerUrl: string;
  ensureActionReady: () => boolean;
  getProvider: () => Promise<{
    request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  }>;
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
    market,
    collateralAsset,
    loanAsset,
    bundlerUrl,
    ensureActionReady,
    getProvider,
    notify,
    onSuccess,
    request,
    switchChain,
  } = props;
  const [action, setAction] = useState<MorphoAction>("withdraw");
  const [useMax, setUseMax] = useState(true);
  const [amountInput, setAmountInput] = useState("0");

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
    <section className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--panel-subtle)] p-5">
      <h3 className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
        Rescue actions
      </h3>

      <div className="mt-3 space-y-3 text-sm text-zinc-700">
        <p>
          Withdraw collateral or repay debt on your ZeroDev Kernel wallet via Morpho Blue.
        </p>

        {action === "withdraw" ? (
          <p className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-xs text-[var(--muted)]">
            Withdraw returns collateral to the <strong>loan wallet</strong>. Use <strong>Transfer out</strong> afterward to move it to your connected wallet.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-sm">Action</span>
            <select
              className="h-11 rounded-lg border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-zinc-900"
              value={action}
              disabled={isSubmitting}
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
            <input
              type="checkbox"
              checked={useMax}
              disabled={isSubmitting}
              onChange={() => setUseMax((v) => !v)}
            />
            {maxLabel}
          </label>

          {!useMax ? (
            <label className="flex items-center gap-2">
              <span className="text-sm">{amountLabel}</span>
              <input
                className="h-11 w-40 rounded-lg border border-[var(--line)] bg-white px-3 text-sm outline-none focus:border-zinc-900"
                value={amountInput}
                disabled={isSubmitting}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0.01"
              />
            </label>
          ) : null}
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-fit items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
          disabled={isSubmitting}
          onClick={async () => {
            if (isSubmitting) return;

            setErrorSafe(null);
            setStatusSafe(null);
            setLastUserOpHashSafe(null);

            if (!ensureActionReady()) return;
            if (amountForProtocol === null) {
              const message = `Enter a valid ${action === "withdraw" ? collateralAsset.symbol : loanAsset.symbol} amount before continuing.`;
              notify({
                title: "Enter a valid amount",
                description: message,
              });
              setErrorSafe(message);
              return;
            }

            setIsSubmittingSafe(true);

            try {
              setStatusSafe("Switching network (if needed)…");
              await switchChain(chainId);

              setStatusSafe("Building Morpho calls…");
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
              setStatusSafe("Submitted. Waiting for confirmation…");
              await waitForUserOpReceipt({
                bundlerUrl,
                userOpHash: sentHash,
                operationLabel: `Morpho ${action} UserOperation`,
              });
              setStatusSafe("Confirmed. Refreshing positions…");
              await onSuccess?.();
              setStatusSafe("Confirmed.");
            } catch (e) {
              setErrorSafe(e instanceof Error ? e.message : "Rescue action failed.");
              setStatusSafe(null);
            } finally {
              setIsSubmittingSafe(false);
            }
          }}
        >
          {isSubmitting ? <ButtonSpinner /> : null}
          <span>{isSubmitting ? "Submitting…" : "Execute Morpho action via Kernel"}</span>
        </button>

        {action === "repay" && useMax ? (
          <p className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-xs text-[var(--muted)]">
            Tip: keep a little extra {loanAsset.symbol} in the loan/kernel wallet when using
            &nbsp;<strong>Repay all</strong>. Interest accrues in real time, so debt can increase
            slightly before execution.
          </p>
        ) : null}

        {status ? <p className="text-sm text-[var(--muted)]">{status}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {lastUserOpHash ? (
          <p className="text-sm text-[var(--muted)]">
            UserOp hash: <span className="font-mono">{lastUserOpHash}</span>
          </p>
        ) : null}
      </div>
    </section>
  );
}
