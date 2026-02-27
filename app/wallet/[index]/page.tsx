"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CHAIN_ASSETS } from "@/lib/assets";
import { getChainConfig, SUPPORTED_CHAINS, type SupportedChainId } from "@/lib/chains";
import type { Address, Hex } from "@/lib/eth/types";
import { deriveKernelAddressV3_3FromEOA } from "@/lib/kernel/deriveKernelAddress";
import { fetchAaveUserSummaryWithBackendLogic } from "@/lib/protocols/aaveBackendParity";
import { encodeAaveGetUserAccountData, decodeAaveGetUserAccountData } from "@/lib/protocols/aave";
import { decodeErc20BalanceOf, encodeErc20BalanceOf } from "@/lib/protocols/erc20";
import {
  fetchMorphoSummaryWithBackendLogic,
  MORPHO_BASE_CBBTC_USDC_MARKET,
} from "@/lib/protocols/morphoBackendParity";
import { encodeMorphoBluePosition, decodeMorphoBluePosition } from "@/lib/protocols/morpho";
import { MORPHO_BASE_MARKETS } from "@/lib/protocols/morphoMarkets";

import { buildZeroDevBundlerUrl } from "@/lib/zerodev/bundlerUrl";

import { AaveRescueActions } from "./_components/AaveRescueActions";
import { MorphoRescueActions } from "./_components/MorphoRescueActions";
import { TransferOutAction } from "./_components/TransferOutAction";

import { useWallet } from "../../providers";

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

function shortAddress(addr: Address) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function WalletDetailPage() {
  const { address: owner, getProvider, request, switchChain } = useWallet();

  const params = useParams();
  const indexParam = (params?.index as string | undefined) ?? "";

  const indexBigInt = useMemo(() => {
    try {
      const v = BigInt(indexParam);
      return v >= 0n ? v : null;
    } catch {
      return null;
    }
  }, [indexParam]);

  const [selectedChainId, setSelectedChainId] = useState<SupportedChainId>(1);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [nativeBalance, setNativeBalance] = useState<bigint | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [btcBalance, setBtcBalance] = useState<bigint | null>(null);

  const [aaveAccountData, setAaveAccountData] = useState<ReturnType<typeof decodeAaveGetUserAccountData> | null>(
    null,
  );
  const [aaveSummary, setAaveSummary] = useState<Awaited<
    ReturnType<typeof fetchAaveUserSummaryWithBackendLogic>
  > | null>(null);
  const [morphoPosition, setMorphoPosition] = useState<ReturnType<typeof decodeMorphoBluePosition> | null>(null);
  const [morphoSummary, setMorphoSummary] = useState<Awaited<
    ReturnType<typeof fetchMorphoSummaryWithBackendLogic>
  > | null>(null);

  const [copied, setCopied] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [zerodevInput, setZerodevInput] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshRequestIdRef = useRef(0);
  const manualChainSelectionRef = useRef(false);
  const selectedChainIdRef = useRef<SupportedChainId>(selectedChainId);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chain = useMemo(() => getChainConfig(selectedChainId), [selectedChainId]);

  const kernelAddress = useMemo(() => {
    if (!owner) return null;
    if (indexBigInt === null) return null;
    return deriveKernelAddressV3_3FromEOA(owner, indexBigInt);
  }, [indexBigInt, owner]);

  const assets = useMemo(() => CHAIN_ASSETS[selectedChainId], [selectedChainId]);

  const bundlerUrl = useMemo(() => {
    try {
      return buildZeroDevBundlerUrl(zerodevInput, selectedChainId);
    } catch {
      return "";
    }
  }, [zerodevInput, selectedChainId]);

  // Auto-detect which chain has the kernel deployed and select it
  useEffect(() => {
    if (!kernelAddress) return;
    let cancelled = false;
    setAutoDetecting(true);

    (async () => {
      const checks = SUPPORTED_CHAINS.map(async (c) => {
        try {
          const res = await fetch(c.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_getCode",
              params: [kernelAddress, "latest"],
            }),
          });
          const json = await res.json();
          const code = json?.result as string | undefined;
          return code && code !== "0x" ? c.id : null;
        } catch {
          return null;
        }
      });

      const results = await Promise.all(checks);
      if (cancelled) return;

      const deployedChain = results.find((id): id is SupportedChainId => id !== null);
      if (deployedChain && !manualChainSelectionRef.current) {
        setSelectedChainId(deployedChain);
      }
      setAutoDetecting(false);
    })();

    return () => { cancelled = true; };
  }, [kernelAddress]);

  useEffect(() => {
    manualChainSelectionRef.current = false;
  }, [kernelAddress]);

  useEffect(() => {
    selectedChainIdRef.current = selectedChainId;
  }, [selectedChainId]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const copyAddress = useCallback(() => {
    if (!kernelAddress) return;
    navigator.clipboard
      .writeText(kernelAddress)
      .then(() => {
        setCopied(true);
        if (copyResetTimeoutRef.current !== null) {
          clearTimeout(copyResetTimeoutRef.current);
        }
        copyResetTimeoutRef.current = setTimeout(() => {
          setCopied(false);
          copyResetTimeoutRef.current = null;
        }, 2000);
      })
      .catch(() => {
        setError("Could not copy address. Please copy it manually.");
      });
  }, [kernelAddress]);

  const refresh = async () => {
    if (isRefreshing) return;
    setError(null);
    setStatus(null);
    setAaveAccountData(null);
    setAaveSummary(null);
    setMorphoPosition(null);
    setMorphoSummary(null);
    setNativeBalance(null);
    setUsdcBalance(null);
    setBtcBalance(null);

    if (!owner) {
      setError("Connect your wallet first.");
      return;
    }
    if (!kernelAddress) {
      setError("Invalid index.");
      return;
    }
    const requestId = ++refreshRequestIdRef.current;
    const refreshChainId = selectedChainId;
    const refreshChain = getChainConfig(refreshChainId);
    if (!refreshChain) {
      setError("Unsupported chain.");
      return;
    }
    const isRequestStale = () => refreshRequestIdRef.current !== requestId;
    const isStale = () => isRequestStale() || selectedChainIdRef.current !== refreshChainId;
    setIsRefreshing(true);
    try {
      const chainIdHex = (await request("eth_chainId")) as string;
      const current = typeof chainIdHex === "string" && chainIdHex.startsWith("0x") ? Number.parseInt(chainIdHex.slice(2), 16) : null;
      if (current !== refreshChainId) {
        if (!isStale()) {
          setError(`Switch your wallet to ${refreshChain.name} (chainId ${refreshChainId}) to read positions.`);
        }
        return;
      }

      if (isStale()) return;
      setStatus("Reading onchain data…");

      const nativeBalHex = (await request("eth_getBalance", [kernelAddress, "latest"])) as string;
      if (isStale()) return;
      setNativeBalance(BigInt(nativeBalHex));

      const [usdcBalRes, btcBalRes] = (await Promise.all([
        request("eth_call", [{ to: assets.usdc.address, data: encodeErc20BalanceOf(kernelAddress) }, "latest"]),
        request("eth_call", [{ to: assets.btcCollateral.address, data: encodeErc20BalanceOf(kernelAddress) }, "latest"]),
      ])) as [Hex, Hex];
      if (isStale()) return;

      setUsdcBalance(decodeErc20BalanceOf(usdcBalRes));
      setBtcBalance(decodeErc20BalanceOf(btcBalRes));

      if (refreshChain.aaveV3PoolAddress) {
        try {
          const summary = await fetchAaveUserSummaryWithBackendLogic({
            chain: refreshChain,
            walletAddress: kernelAddress,
          });
          if (isStale()) return;
          setAaveSummary(summary);
        } catch {
          setAaveSummary(null);
        }

        const aaveRes = (await request("eth_call", [{ to: refreshChain.aaveV3PoolAddress, data: encodeAaveGetUserAccountData(kernelAddress) }, "latest"])) as Hex;
        if (isStale()) return;
        setAaveAccountData(decodeAaveGetUserAccountData(aaveRes));
      }

      if (refreshChainId === 8453 && refreshChain.morphoBlueAddress) {
        try {
          const summary = await fetchMorphoSummaryWithBackendLogic({
            rpcUrl: refreshChain.rpcUrl,
            market: MORPHO_BASE_CBBTC_USDC_MARKET,
            userAddress: kernelAddress,
          });
          if (isStale()) return;
          setMorphoSummary(summary);
        } catch {
          setMorphoSummary(null);
        }

        const morphoRes = (await request("eth_call", [{ to: refreshChain.morphoBlueAddress, data: encodeMorphoBluePosition(MORPHO_BASE_MARKETS.cbBTC_USDC.marketId, kernelAddress) }, "latest"])) as Hex;
        if (isStale()) return;
        setMorphoPosition(decodeMorphoBluePosition(morphoRes));
      }

      if (isStale()) return;
      setStatus("Done.");
    } catch (e) {
      if (isStale()) return;
      setError(e instanceof Error ? e.message : "Failed to read positions.");
    } finally {
      if (!isRequestStale()) setIsRefreshing(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      {/* Page header with breadcrumb */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/scan" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Scan
          </Link>
          <span>/</span>
          <span className="text-zinc-900 dark:text-zinc-100">Wallet #{indexParam}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Kernel wallet #{indexParam}</h1>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          View loan positions, balances, and execute repay or withdraw operations.
        </p>
      </header>

      {!owner ? (
        <section className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-100/50 p-5 dark:border-zinc-700 dark:bg-zinc-900/50">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connect your wallet using the button in the top right to view positions.
          </p>
        </section>
      ) : !kernelAddress ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-900/50 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-300">Invalid wallet index.</p>
        </section>
      ) : (
        <>
          {/* Wallet info + chain selector bar */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                  <span>Connected wallet</span>
                  <span className="font-mono text-zinc-900 dark:text-zinc-100">{shortAddress(owner)}</span>
                </div>
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/40">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      Loan wallet
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-amber-900 dark:text-amber-200 break-all">{kernelAddress}</span>
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-amber-400 bg-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-300 dark:border-amber-600 dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700"
                      onClick={copyAddress}
                    >
                      {copied ? "Copied!" : "Copy address"}
                    </button>
                  </div>
                  <div className="mt-1.5">
                    {nativeBalance !== null ? (
                      nativeBalance === 0n ? (
                        <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                          No gas &mdash; fund this wallet with {chain?.nativeSymbol ?? "native token"}
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-amber-900 dark:text-amber-200">
                          Gas balance: {formatUnits(nativeBalance, 18)} {chain?.nativeSymbol ?? ""}
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-amber-600 dark:text-amber-500">
                        Gas balance: load positions to check
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                    This is the smart wallet that holds your loan. Send gas ({chain?.nativeSymbol ?? "native token"}) and repay tokens to this address before executing rescue actions.
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 self-start">
                {autoDetecting ? (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">Detecting chain…</span>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-9 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
                  value={selectedChainId}
                  disabled={isRefreshing}
                  onChange={async (e) => {
                    const newChainId = Number(e.target.value) as SupportedChainId;
                    setError(null);
                    manualChainSelectionRef.current = true;
                    try {
                      await switchChain(newChainId);
                      setSelectedChainId(newChainId);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to switch chain.");
                    }
                  }}
                >
                  {SUPPORTED_CHAINS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className="inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  disabled={isRefreshing}
                  onClick={refresh}
                >
                  {isRefreshing ? "Loading…" : "Load positions"}
                </button>
                </div>
              </div>
            </div>

            {status ? (
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{status}</p>
            ) : null}
            {error ? (
              <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
            ) : null}
          </section>

          {/* ZeroDev bundler config (page-level, shared) */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                ZeroDev Project ID or RPC URL
              </span>
              <input
                className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
                value={zerodevInput}
                onChange={(e) => setZerodevInput(e.target.value)}
                placeholder="paste project ID or full RPC URL"
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Go to{" "}
                <a
                  href="https://dashboard.zerodev.app/projects/general"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  dashboard.zerodev.app
                </a>
                {" "}&rarr; copy the <strong>Project ID</strong> (top right) or any <strong>RPC URL</strong> from the Active Networks list.
                This is shared across all rescue actions below.
              </span>
            </label>
          </section>

          {/* Rescue flow steps */}
          <nav className="flex flex-wrap gap-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 dark:border-zinc-800 dark:bg-zinc-900">
              1. Fund loan wallet
            </span>
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 dark:border-zinc-800 dark:bg-zinc-900">
              2. Repay debt
            </span>
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 dark:border-zinc-800 dark:bg-zinc-900">
              3. Withdraw collateral
            </span>
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 dark:border-zinc-800 dark:bg-zinc-900">
              4. Transfer out
            </span>
          </nav>

          {/* Wallet balances */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Wallet balances
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                  {chain?.nativeSymbol ?? "Native"} (gas)
                </div>
                <div className="mt-1.5 text-lg font-semibold">
                  {nativeBalance === null ? (
                    <span className="text-zinc-300 dark:text-zinc-600">&mdash;</span>
                  ) : (
                    formatUnits(nativeBalance, 18)
                  )}
                </div>
                {nativeBalance !== null && nativeBalance === 0n ? (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    No gas &mdash; send {chain?.nativeSymbol ?? "native token"} to the loan wallet address above.
                  </p>
                ) : null}
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">{assets.usdc.symbol}</div>
                <div className="mt-1.5 text-lg font-semibold">
                  {usdcBalance === null ? (
                    <span className="text-zinc-300 dark:text-zinc-600">&mdash;</span>
                  ) : (
                    formatUnits(usdcBalance, assets.usdc.decimals)
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <TransferOutAction
                  chainId={selectedChainId}
                  owner={owner}
                  kernelAddress={kernelAddress}
                  asset={assets.btcCollateral}
                  balance={btcBalance}
                  bundlerUrl={bundlerUrl}
                  request={request}
                  switchChain={switchChain}
                />
              </div>
            </div>
          </section>

          {/* Aave V3 position */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                Aave V3 — Loan details
              </h2>
              {aaveSummary?.healthFactor ? (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  Number(aaveSummary.healthFactor) > 2
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : Number(aaveSummary.healthFactor) > 1.2
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "bg-red-500/10 text-red-700 dark:text-red-400"
                }`}>
                  HF: {aaveSummary.healthFactor}
                </span>
              ) : null}
            </div>

            {!aaveSummary && !aaveAccountData ? (
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                Click &ldquo;Load positions&rdquo; above to fetch Aave data.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Collateral (USD)</div>
                  <div className="mt-1 text-base font-semibold">
                    {aaveSummary?.totalCollateralUSD ??
                      (aaveAccountData ? formatUnits(aaveAccountData.totalCollateralBase, 8) : "—")}
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Debt (USD)</div>
                  <div className="mt-1 text-base font-semibold text-red-600 dark:text-red-400">
                    {aaveSummary?.totalBorrowsUSD ??
                      (aaveAccountData ? formatUnits(aaveAccountData.totalDebtBase, 8) : "—")}
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Available borrows</div>
                  <div className="mt-1 text-base font-semibold">
                    {aaveSummary?.availableBorrowsUSD ?? "—"}
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Health factor</div>
                  <div className="mt-1 text-base font-semibold">
                    {aaveSummary?.healthFactor ??
                      (aaveAccountData ? formatUnits(aaveAccountData.healthFactor, 18) : "—")}
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">LTV / Liq. threshold</div>
                  <div className="mt-1 text-base font-semibold">
                    {aaveSummary
                      ? `${aaveSummary.currentLoanToValue} / ${aaveSummary.currentLiquidationThreshold}`
                      : aaveAccountData
                        ? `${aaveAccountData.ltv.toString()} / ${aaveAccountData.currentLiquidationThreshold.toString()}`
                        : "—"}
                  </div>
                </div>
              </div>
            )}

            {chain?.aaveV3PoolAddress ? (
              <AaveRescueActions
                chainId={selectedChainId}
                owner={owner}
                kernelAddress={kernelAddress}
                collateralAsset={assets.btcCollateral}
                repayAsset={assets.usdc}
                bundlerUrl={bundlerUrl}
                request={request}
                switchChain={switchChain}
              />
            ) : null}
          </section>

          {/* Morpho Blue (Base only) */}
          {selectedChainId === 8453 ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                  Morpho Blue — Loan details
                </h2>
                {morphoSummary?.healthFactor ? (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    Number(morphoSummary.healthFactor) > 2
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : Number(morphoSummary.healthFactor) > 1.2
                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "bg-red-500/10 text-red-700 dark:text-red-400"
                  }`}>
                    HF: {morphoSummary.healthFactor}
                  </span>
                ) : null}
              </div>

              {!morphoPosition && !morphoSummary ? (
                <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                  Click &ldquo;Load positions&rdquo; above to fetch Morpho data for {MORPHO_BASE_MARKETS.cbBTC_USDC.label}.
                </p>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Supply shares</div>
                    <div className="mt-1 text-base font-semibold">{morphoPosition?.supplyShares.toString() ?? "—"}</div>
                  </div>
                  <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Borrow shares</div>
                    <div className="mt-1 text-base font-semibold">{morphoPosition?.borrowShares.toString() ?? "—"}</div>
                  </div>
                  <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Collateral</div>
                    <div className="mt-1 text-base font-semibold">
                      {morphoPosition
                        ? formatUnits(morphoPosition.collateral, CHAIN_ASSETS[8453].btcCollateral.decimals)
                        : "—"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Collateral (USD)</div>
                    <div className="mt-1 text-base font-semibold">{morphoSummary?.collateralUsd ?? "—"}</div>
                  </div>
                  <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Borrow (USD)</div>
                    <div className="mt-1 text-base font-semibold text-red-600 dark:text-red-400">{morphoSummary?.borrowAssetsUsd ?? "—"}</div>
                  </div>
                  <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Health factor</div>
                    <div className="mt-1 text-base font-semibold">{morphoSummary?.healthFactor ?? "—"}</div>
                  </div>
                </div>
              )}

              {chain?.morphoBlueAddress ? (
                <MorphoRescueActions
                  chainId={selectedChainId}
                  owner={owner}
                  kernelAddress={kernelAddress}
                  market={MORPHO_BASE_CBBTC_USDC_MARKET}
                  collateralAsset={assets.btcCollateral}
                  loanAsset={assets.usdc}
                  bundlerUrl={bundlerUrl}
                  getProvider={getProvider}
                  request={request}
                  switchChain={switchChain}
                />
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
