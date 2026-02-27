"use client";

import { useMemo, useState } from "react";

import { submitKernelUserOperationV07 } from "@/lib/accountAbstraction/submitUserOpV07";
import type { SupportedChainId } from "@/lib/chains";
import { getChainConfig } from "@/lib/chains";
import type { Address, Hex } from "@/lib/eth/types";
import { encodeAaveRepay, encodeAaveWithdraw, MAX_UINT256 } from "@/lib/protocols/aave";
import { encodeErc20Approve } from "@/lib/protocols/erc20";
import { encodeKernelExecuteCalls } from "@/lib/protocols/kernel";

type ProtocolAction = "withdraw" | "repay";

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
  address: Address;
  decimals: number;
};

export function AaveRescueActions(props: {
  chainId: SupportedChainId;
  owner: Address;
  kernelAddress: Address;
  collateralAsset: Asset;
  repayAsset: Asset;
  bundlerUrl: string;
  request: (method: string, params?: unknown[] | object) => Promise<unknown>;
  switchChain: (chainId: number) => Promise<void>;
}) {
  const { chainId, owner, kernelAddress, collateralAsset, repayAsset, bundlerUrl, request, switchChain } = props;
  const [action, setAction] = useState<ProtocolAction>("withdraw");
  const [useMax, setUseMax] = useState(true);
  const [amountInput, setAmountInput] = useState("0");

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUserOpHash, setLastUserOpHash] = useState<Hex | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedAsset = action === "withdraw" ? collateralAsset : repayAsset;
  const maxLabel = action === "withdraw" ? "Withdraw all" : "Repay all";
  const amountLabel = action === "withdraw" ? `Amount (${collateralAsset.symbol})` : `Amount (${repayAsset.symbol})`;

  const amountForProtocol = useMemo(() => {
    if (useMax) return "-1";
    try {
      const parsed = parseUnits(amountInput, selectedAsset.decimals);
      if (parsed <= 0n) return null;
      return amountInput;
    } catch {
      return null;
    }
  }, [amountInput, selectedAsset.decimals, useMax]);

  const executeAction = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setStatus(null);
    setLastUserOpHash(null);

    try {
      if (amountForProtocol === null) throw new Error("Invalid amount.");

      setStatus("Switching network (if needed)…");
      await switchChain(chainId);

      const chain = getChainConfig(chainId);
      if (!chain) throw new Error(`Unsupported chain ${chainId}`);
      if (!chain.aaveV3PoolAddress) throw new Error("Aave pool not configured for this chain.");

      const poolAddress = chain.aaveV3PoolAddress;
      const rawAmount = amountForProtocol === "-1"
        ? MAX_UINT256
        : parseUnits(amountForProtocol, selectedAsset.decimals);

      if (action === "repay") {
        // Step 1: Approve USDC to Aave Pool (separate UserOp).
        setStatus("Step 1/2: Approving repay token to Aave Pool…");
        const approveCallData = encodeErc20Approve(poolAddress, MAX_UINT256);

        const approveKernelCallData = await encodeKernelExecuteCalls([
          { target: repayAsset.address, callData: approveCallData, value: 0n },
        ]);

        const approveHash = await submitKernelUserOperationV07({
          bundlerUrl,
          chainRpcUrl: chain.rpcUrl,
          owner,
          kernelAddress,
          chainId,
          kernelCallData: approveKernelCallData,
          request,
          onStatus: (s) => setStatus(`Step 1/2: ${s}`),
        });
        setStatus("Step 1/2: Approve submitted. Waiting for confirmation…");

        // Wait for approve to be mined — poll the bundler for receipt
        await waitForUserOp(bundlerUrl, approveHash);

        // Step 2: Repay debt
        setStatus("Step 2/2: Repaying debt to Aave Pool…");
        const repayCallData = encodeAaveRepay({
          asset: repayAsset.address,
          amount: rawAmount,
          interestRateMode: 2n, // Variable
          onBehalfOf: kernelAddress,
        });

        const repayKernelCallData = await encodeKernelExecuteCalls([
          { target: poolAddress, callData: repayCallData, value: 0n },
        ]);

        const repayHash = await submitKernelUserOperationV07({
          bundlerUrl,
          chainRpcUrl: chain.rpcUrl,
          owner,
          kernelAddress,
          chainId,
          kernelCallData: repayKernelCallData,
          request,
          onStatus: (s) => setStatus(`Step 2/2: ${s}`),
        });

        setLastUserOpHash(repayHash);
        setStatus("Repay submitted.");
      } else {
        // Withdraw: single UserOp
        setStatus("Withdrawing collateral from Aave Pool…");
        const withdrawCallData = encodeAaveWithdraw({
          asset: collateralAsset.address,
          amount: rawAmount,
          to: owner,
        });

        const withdrawKernelCallData = await encodeKernelExecuteCalls([
          { target: poolAddress, callData: withdrawCallData, value: 0n },
        ]);

        const withdrawHash = await submitKernelUserOperationV07({
          bundlerUrl,
          chainRpcUrl: chain.rpcUrl,
          owner,
          kernelAddress,
          chainId,
          kernelCallData: withdrawKernelCallData,
          request,
          onStatus: setStatus,
        });

        setLastUserOpHash(withdrawHash);
        setStatus("Withdraw submitted.");
      }
    } catch (e: unknown) {
      let msg = "Rescue action failed.";
      if (e instanceof Error) {
        const inner = (e as unknown as Record<string, unknown>).data ?? (e as unknown as Record<string, unknown>).error;
        const detail = inner && typeof inner === "object" && "message" in inner
          ? (inner as { message: string }).message
          : null;
        msg = detail ? `${e.message} — ${detail}` : e.message;
      }
      setError(msg);
      setStatus(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
        Rescue actions
      </h3>

      <div className="mt-3 space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          Withdraw collateral or repay debt on your ZeroDev Kernel wallet via Aave.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-sm">Action</span>
            <select
              className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
              value={action}
              onChange={(e) => {
                setAction(e.target.value as ProtocolAction);
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
          onClick={executeAction}
        >
          {isSubmitting ? "Submitting…" : "Execute Aave action via Kernel"}
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

/** Poll the bundler for UserOp receipt until mined+successful (timeout 60s). */
async function waitForUserOp(bundlerUrl: string, userOpHash: Hex): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(bundlerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getUserOperationReceipt",
          params: [userOpHash],
        }),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { result?: UserOperationReceiptResult | null };
      const result = json?.result;
      if (result) {
        const receipt = result.receipt;
        const blockNumber = receipt?.blockNumber ?? result.blockNumber;
        const txHash = receipt?.transactionHash ?? result.transactionHash;
        const statusRaw = typeof receipt?.status === "string" ? receipt.status.toLowerCase() : null;
        const hasExplicitFailure = result.success === false || statusRaw === "0x0" || statusRaw === "0";
        const hasExplicitSuccess = result.success === true || statusRaw === "0x1" || statusRaw === "1";

        // Some bundlers return intermediate objects. Continue until mined + explicit success.
        if (blockNumber && txHash) {
          if (hasExplicitFailure) {
            throw new Error(`Approve UserOp reverted${result.reason ? `: ${result.reason}` : "."}`);
          }
          if (hasExplicitSuccess) return;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Approve UserOp reverted")) {
        throw error;
      }
      // ignore transient fetch/parser errors, just retry
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Timed out waiting for approve UserOp to be mined.");
}
