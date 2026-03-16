"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CHAIN_ASSETS } from "@/lib/assets";
import { defaultRpcProvider, getChainConfig, SUPPORTED_CHAINS, type SupportedChainId } from "@/lib/chains";
import type { Address, Hex } from "@/lib/eth/types";
import { deriveKernelAddressV3_3FromEOA } from "@/lib/kernel/deriveKernelAddress";
import { fetchAaveUserSummaryWithBackendLogic } from "@/lib/protocols/aaveBackendParity";
import {
  decodeAaveGetReserveTokensAddresses,
  decodeAaveGetUserAccountData,
  encodeAaveGetReserveTokensAddresses,
  encodeAaveGetUserAccountData,
  MAX_UINT256,
} from "@/lib/protocols/aave";
import { decodeErc20BalanceOf, encodeErc20BalanceOf } from "@/lib/protocols/erc20";
import {
  fetchMorphoSummaryWithBackendLogic,
  MORPHO_BASE_CBBTC_USDC_MARKET,
} from "@/lib/protocols/morphoBackendParity";
import { encodeMorphoBluePosition, decodeMorphoBluePosition } from "@/lib/protocols/morpho";
import { MORPHO_BASE_MARKETS } from "@/lib/protocols/morphoMarkets";

import { buildZeroDevBundlerUrl } from "@/lib/zerodev/bundlerUrl";

import { ActionToastViewport, type ActionToast } from "./_components/ActionToastViewport";
import { AaveRescueActions } from "./_components/AaveRescueActions";
import { ButtonSpinner } from "./_components/ButtonSpinner";
import { MorphoRescueActions } from "./_components/MorphoRescueActions";
import { NativeTransferOutAction } from "./_components/NativeTransferOutAction";
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const INFINITE_HEALTH_FACTOR_THRESHOLD = 999;

function formatRoundedNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveChainRpcUrl(
  chainId: SupportedChainId,
  customRpcUrls: Partial<Record<SupportedChainId, string>>,
): string {
  const chain = getChainConfig(chainId);
  if (!chain) return "";

  const override = customRpcUrls[chainId]?.trim();
  return override && isValidHttpUrl(override) ? override : chain.rpcUrl;
}

function getDefaultRpcLabel(): string {
  switch (defaultRpcProvider) {
    case "thirdweb":
      return "thirdweb RPC";
    case "alchemy":
      return "Alchemy RPC";
    default:
      return "default RPC";
  }
}

function getDefaultRpcUnavailableMessage(message?: string | null): string {
  const nextStep =
    defaultRpcProvider === "thirdweb"
      ? "Paste an Alchemy RPC URL to continue."
      : "Paste a custom RPC URL to continue.";

  return message
    ? `The ${getDefaultRpcLabel()} is not responding: ${message} ${nextStep}`
    : `The ${getDefaultRpcLabel()} is not responding. ${nextStep}`;
}

function getRpcInputPlaceholder(chainId: SupportedChainId): string {
  switch (chainId) {
    case 1:
      return "https://eth-mainnet.g.alchemy.com/v2/your-key";
    case 8453:
      return "https://base-mainnet.g.alchemy.com/v2/your-key";
    case 42161:
      return "https://arb-mainnet.g.alchemy.com/v2/your-key";
    case 56:
      return "https://bnb-mainnet.g.alchemy.com/v2/your-key";
    default:
      return "https://your-rpc-provider.example";
  }
}

type RpcHealthState = {
  status: "checking" | "healthy" | "unhealthy";
  message: string | null;
};

async function probeRpcHealth(parameters: {
  rpcUrl: string;
  expectedChainId: SupportedChainId;
  signal: AbortSignal;
}): Promise<RpcHealthState> {
  const { rpcUrl, expectedChainId, signal } = parameters;

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    }),
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    return {
      status: "unhealthy",
      message: `RPC returned HTTP ${response.status}.`,
    };
  }

  const payload = (await response.json()) as {
    result?: string;
    error?: { message?: string };
  };
  if (payload.error?.message) {
    return {
      status: "unhealthy",
      message: payload.error.message,
    };
  }
  if (typeof payload.result !== "string" || !payload.result.startsWith("0x")) {
    return {
      status: "unhealthy",
      message: "RPC did not return a chain ID.",
    };
  }

  const actualChainId = Number.parseInt(payload.result.slice(2), 16);
  if (!Number.isFinite(actualChainId)) {
    return {
      status: "unhealthy",
      message: "RPC returned an invalid chain ID.",
    };
  }
  if (actualChainId !== expectedChainId) {
    return {
      status: "unhealthy",
      message: `RPC responded for chain ${actualChainId}, not ${expectedChainId}.`,
    };
  }

  return {
    status: "healthy",
    message: null,
  };
}

function normalizeHealthFactor(value: string | bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "bigint") {
    if (value === MAX_UINT256) return Number.POSITIVE_INFINITY;
    return Number(formatUnits(value, 18));
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed) && trimmed.length >= 18) {
    const raw = BigInt(trimmed);
    if (raw === MAX_UINT256) return Number.POSITIVE_INFINITY;
    return Number(formatUnits(raw, 18));
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= INFINITE_HEALTH_FACTOR_THRESHOLD) return Number.POSITIVE_INFINITY;
  return numeric;
}

function formatHealthFactor(value: string | bigint | null | undefined): string {
  const normalized = normalizeHealthFactor(value);
  if (normalized === null) return "—";
  if (!Number.isFinite(normalized)) return "∞";
  return formatRoundedNumber(normalized, normalized >= 10 ? 2 : 3);
}

function getHealthFactorTone(value: string | bigint | null | undefined): string {
  const normalized = normalizeHealthFactor(value);
  if (normalized === null || normalized > 2) return "bg-zinc-900 text-white";
  if (normalized > 1.2) return "bg-zinc-200 text-zinc-900";
  return "bg-red-500/10 text-red-700";
}

export default function WalletDetailPage() {
  const {
    address: owner,
    chainId: connectedChainId,
    getProvider,
    request,
    switchChain,
  } = useWallet();

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
  const [aaveCollateralSupplied, setAaveCollateralSupplied] = useState<bigint | null>(null);
  const [aaveDebtAmount, setAaveDebtAmount] = useState<bigint | null>(null);
  const [aaveSummary, setAaveSummary] = useState<Awaited<
    ReturnType<typeof fetchAaveUserSummaryWithBackendLogic>
  > | null>(null);
  const [morphoPosition, setMorphoPosition] = useState<ReturnType<typeof decodeMorphoBluePosition> | null>(null);
  const [morphoSummary, setMorphoSummary] = useState<Awaited<
    ReturnType<typeof fetchMorphoSummaryWithBackendLogic>
  > | null>(null);

  const [copied, setCopied] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [zerodevInput, setZerodevInput] = useState("");
  const [customRpcUrls, setCustomRpcUrls] = useState<Partial<Record<SupportedChainId, string>>>({});
  const [selectedRpcHealth, setSelectedRpcHealth] = useState<RpcHealthState>({
    status: "checking",
    message: null,
  });
  const [toasts, setToasts] = useState<ActionToast[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshRequestIdRef = useRef(0);
  const manualChainSelectionRef = useRef(false);
  const selectedChainIdRef = useRef<SupportedChainId>(selectedChainId);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zeroDevInputRef = useRef<HTMLInputElement | null>(null);
  const rpcInputRef = useRef<HTMLInputElement | null>(null);
  const toastIdRef = useRef(0);
  const toastTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const chain = useMemo(() => {
    const selectedChain = getChainConfig(selectedChainId);
    if (!selectedChain) return null;
    return {
      ...selectedChain,
      rpcUrl: resolveChainRpcUrl(selectedChainId, customRpcUrls),
    };
  }, [customRpcUrls, selectedChainId]);

  const kernelAddress = useMemo(() => {
    if (!owner) return null;
    if (indexBigInt === null) return null;
    return deriveKernelAddressV3_3FromEOA(owner, indexBigInt);
  }, [indexBigInt, owner]);

  const assets = useMemo(() => CHAIN_ASSETS[selectedChainId], [selectedChainId]);
  const zeroDevInputTrimmed = zerodevInput.trim();
  const selectedRpcInput = customRpcUrls[selectedChainId] ?? "";
  const hasCustomRpcInput = selectedRpcInput.trim().length > 0;
  const selectedRpcError = useMemo(() => {
    const trimmed = selectedRpcInput.trim();
    if (!trimmed) return null;
    return isValidHttpUrl(trimmed) ? null : "Enter a valid http(s) RPC URL.";
  }, [selectedRpcInput]);
  const showRpcInput =
    hasCustomRpcInput || Boolean(selectedRpcError) || selectedRpcHealth.status === "unhealthy";
  const zeroDevValidationError = useMemo(() => {
    if (!zeroDevInputTrimmed) return null;
    try {
      buildZeroDevBundlerUrl(zeroDevInputTrimmed, selectedChainId);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid ZeroDev Project ID or RPC URL.";
    }
  }, [selectedChainId, zeroDevInputTrimmed]);
  const hasNoGas = nativeBalance !== null && nativeBalance === 0n;
  const aaveHealthFactor = aaveSummary?.healthFactor ?? aaveAccountData?.healthFactor ?? null;
  const morphoHealthFactor = morphoSummary?.healthFactor ?? null;
  const readinessIssues = useMemo(() => {
    const issues: string[] = [];

    if (!zeroDevInputTrimmed) {
      issues.push("Add a ZeroDev Project ID or full ZeroDev RPC URL.");
    } else if (zeroDevValidationError) {
      issues.push("Fix the ZeroDev Project ID / RPC URL before submitting actions.");
    }

    if (selectedRpcError) {
      issues.push("Fix the custom RPC URL before submitting actions.");
    } else if (selectedRpcHealth.status === "unhealthy") {
      issues.push(
        hasCustomRpcInput
          ? "Fix or replace the custom RPC URL before submitting actions."
          : `Default ${chain?.name ?? "chain"} RPC is not responding. Add a custom RPC URL.`,
      );
    }

    if (hasNoGas) {
      issues.push(`Fund the loan wallet with ${chain?.nativeSymbol ?? "native token"} gas.`);
    }

    return issues;
  }, [
    chain?.name,
    chain?.nativeSymbol,
    hasCustomRpcInput,
    hasNoGas,
    selectedRpcError,
    selectedRpcHealth.status,
    zeroDevInputTrimmed,
    zeroDevValidationError,
  ]);

  const bundlerUrl = useMemo(() => {
    if (!zeroDevInputTrimmed || zeroDevValidationError) return "";
    return buildZeroDevBundlerUrl(zeroDevInputTrimmed, selectedChainId);
  }, [selectedChainId, zeroDevInputTrimmed, zeroDevValidationError]);

  // Auto-detect which chain has the kernel deployed and select it
  useEffect(() => {
    if (!kernelAddress) return;
    let cancelled = false;
    setAutoDetecting(true);

    (async () => {
      const checks = SUPPORTED_CHAINS.map(async (c) => {
        try {
          const res = await fetch(resolveChainRpcUrl(c.id, customRpcUrls), {
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
  }, [customRpcUrls, kernelAddress]);

  useEffect(() => {
    manualChainSelectionRef.current = false;
  }, [kernelAddress]);

  useEffect(() => {
    selectedChainIdRef.current = selectedChainId;
  }, [selectedChainId]);

  useEffect(() => {
    if (!chain?.rpcUrl) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    setSelectedRpcHealth({
      status: "checking",
      message: null,
    });

    probeRpcHealth({
      rpcUrl: chain.rpcUrl,
      expectedChainId: selectedChainId,
      signal: controller.signal,
    })
      .then((nextState) => {
        if (!cancelled) {
          setSelectedRpcHealth(nextState);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          setSelectedRpcHealth({
            status: "unhealthy",
            message: "RPC health check timed out.",
          });
          return;
        }

        setSelectedRpcHealth({
          status: "unhealthy",
          message: error instanceof Error ? error.message : "RPC health check failed.",
        });
      })
      .finally(() => {
        clearTimeout(timeout);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [chain?.rpcUrl, selectedChainId]);

  // Keep wallet network aligned with the selected chain dropdown.
  useEffect(() => {
    if (!owner) return;
    if (connectedChainId === null) return;
    if (connectedChainId === selectedChainId) return;

    let cancelled = false;
    (async () => {
      try {
        await switchChain(selectedChainId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to switch chain.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectedChainId, owner, selectedChainId, switchChain]);

  useEffect(() => {
    const toastTimeouts = toastTimeoutsRef.current;
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        clearTimeout(copyResetTimeoutRef.current);
      }
      for (const timeout of toastTimeouts.values()) {
        clearTimeout(timeout);
      }
      toastTimeouts.clear();
    };
  }, []);

  const dismissToast = useCallback((id: number) => {
    const timeout = toastTimeoutsRef.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      toastTimeoutsRef.current.delete(id);
    }

    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notifyToast = useCallback((toast: Omit<ActionToast, "id">) => {
    const id = ++toastIdRef.current;
    const nextToast: ActionToast = {
      tone: "error",
      ...toast,
      id,
    };

    setToasts((current) => [...current.slice(-2), nextToast]);

    const timeout = setTimeout(() => {
      toastTimeoutsRef.current.delete(id);
      setToasts((current) => current.filter((toastItem) => toastItem.id !== id));
    }, 4500);
    toastTimeoutsRef.current.set(id, timeout);
  }, []);

  const ensureActionReady = useCallback(() => {
    if (!zeroDevInputTrimmed) {
      notifyToast({
        title: "ZeroDev Project ID required",
        description: "Paste a ZeroDev Project ID or full bundler RPC URL before executing rescue actions.",
      });
      zeroDevInputRef.current?.focus();
      return false;
    }

    if (zeroDevValidationError) {
      notifyToast({
        title: "Fix your ZeroDev configuration",
        description: zeroDevValidationError,
      });
      zeroDevInputRef.current?.focus();
      return false;
    }

    if (selectedRpcError) {
      notifyToast({
        title: "Fix your RPC URL",
        description: selectedRpcError,
      });
      rpcInputRef.current?.focus();
      return false;
    }

    if (selectedRpcHealth.status === "unhealthy") {
      notifyToast({
        title: hasCustomRpcInput ? "RPC URL unavailable" : `${chain?.name ?? "Chain"} RPC unavailable`,
        description: hasCustomRpcInput
          ? (selectedRpcHealth.message ?? "The custom RPC URL is not responding. Fix it or replace it before continuing.")
          : getDefaultRpcUnavailableMessage(selectedRpcHealth.message),
      });
      rpcInputRef.current?.focus();
      return false;
    }

    if (hasNoGas) {
      notifyToast({
        title: `Fund the loan wallet with ${chain?.nativeSymbol ?? "native token"}`,
        description: `User operations need gas. Send ${chain?.nativeSymbol ?? "native token"} to the loan wallet address above, then try again.`,
      });
      return false;
    }

    return true;
  }, [
    chain?.name,
    chain?.nativeSymbol,
    hasCustomRpcInput,
    hasNoGas,
    notifyToast,
    selectedRpcError,
    selectedRpcHealth.message,
    selectedRpcHealth.status,
    zeroDevInputTrimmed,
    zeroDevValidationError,
  ]);

  const copyAddress = useCallback(() => {
    if (!kernelAddress || isCopying) return;
    setIsCopying(true);
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
      })
      .finally(() => {
        setIsCopying(false);
      });
  }, [isCopying, kernelAddress]);

  const refresh = async () => {
    if (isRefreshing) return;
    setError(null);
    setStatus(null);
    setAaveAccountData(null);
    setAaveCollateralSupplied(null);
    setAaveDebtAmount(null);
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
    const refreshChainBase = getChainConfig(refreshChainId);
    const refreshChain = refreshChainBase
      ? {
          ...refreshChainBase,
          rpcUrl: resolveChainRpcUrl(refreshChainId, customRpcUrls),
        }
      : null;
    const refreshAssets = CHAIN_ASSETS[refreshChainId];
    if (!refreshChain) {
      setError("Unsupported chain.");
      return;
    }
    const isRequestStale = () => refreshRequestIdRef.current !== requestId;
    const isStale = () => isRequestStale() || selectedChainIdRef.current !== refreshChainId;
    setIsRefreshing(true);
    try {
      const chainIdHex = (await request("eth_chainId")) as string;
      let current = typeof chainIdHex === "string" && chainIdHex.startsWith("0x") ? Number.parseInt(chainIdHex.slice(2), 16) : null;
      if (current !== refreshChainId) {
        if (isStale()) return;
        setStatus(`Switching wallet to ${refreshChain.name}...`);
        try {
          await switchChain(refreshChainId);
        } catch (switchError) {
          if (!isStale()) {
            setError(
              switchError instanceof Error
                ? switchError.message
                : `Switch your wallet to ${refreshChain.name} (chainId ${refreshChainId}) to read positions.`,
            );
          }
          return;
        }

        const refreshedChainIdHex = (await request("eth_chainId")) as string;
        current =
          typeof refreshedChainIdHex === "string" && refreshedChainIdHex.startsWith("0x")
            ? Number.parseInt(refreshedChainIdHex.slice(2), 16)
            : null;
        if (current !== refreshChainId) {
          if (!isStale()) {
            setError(`Switch your wallet to ${refreshChain.name} (chainId ${refreshChainId}) to read positions.`);
          }
          return;
        }
      }

      if (isStale()) return;
      setStatus("Reading onchain data…");

      const nativeBalHex = (await request("eth_getBalance", [kernelAddress, "latest"])) as string;
      if (isStale()) return;
      setNativeBalance(BigInt(nativeBalHex));

      const [usdcBalRes, btcBalRes] = (await Promise.all([
        request("eth_call", [{ to: refreshAssets.usdc.address, data: encodeErc20BalanceOf(kernelAddress) }, "latest"]),
        request("eth_call", [{ to: refreshAssets.btcCollateral.address, data: encodeErc20BalanceOf(kernelAddress) }, "latest"]),
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

        if (refreshChain.aaveV3ProtocolDataProviderAddress) {
          try {
            const [collateralReserveTokensRes, debtReserveTokensRes] = (await Promise.all([
              request("eth_call", [{
                to: refreshChain.aaveV3ProtocolDataProviderAddress,
                data: encodeAaveGetReserveTokensAddresses(refreshAssets.btcCollateral.address),
              }, "latest"]),
              request("eth_call", [{
                to: refreshChain.aaveV3ProtocolDataProviderAddress,
                data: encodeAaveGetReserveTokensAddresses(refreshAssets.usdc.address),
              }, "latest"]),
            ])) as [Hex, Hex];
            if (isStale()) return;

            const collateralReserveTokens = decodeAaveGetReserveTokensAddresses(collateralReserveTokensRes);
            const debtReserveTokens = decodeAaveGetReserveTokensAddresses(debtReserveTokensRes);

            const [aTokenBalRes, variableDebtBalRes] = (await Promise.all([
              request("eth_call", [{ to: collateralReserveTokens.aTokenAddress, data: encodeErc20BalanceOf(kernelAddress) }, "latest"]),
              request("eth_call", [{ to: debtReserveTokens.variableDebtTokenAddress, data: encodeErc20BalanceOf(kernelAddress) }, "latest"]),
            ])) as [Hex, Hex];
            if (isStale()) return;

            let stableDebtBalance = 0n;
            if (debtReserveTokens.stableDebtTokenAddress.toLowerCase() !== ZERO_ADDRESS) {
              const stableDebtBalRes = (await request("eth_call", [{
                to: debtReserveTokens.stableDebtTokenAddress,
                data: encodeErc20BalanceOf(kernelAddress),
              }, "latest"])) as Hex;
              if (isStale()) return;
              stableDebtBalance = decodeErc20BalanceOf(stableDebtBalRes);
            }

            setAaveCollateralSupplied(decodeErc20BalanceOf(aTokenBalRes));
            setAaveDebtAmount(stableDebtBalance + decodeErc20BalanceOf(variableDebtBalRes));
          } catch {
            setAaveCollateralSupplied(null);
            setAaveDebtAmount(null);
          }
        }
      }

      if (refreshChainId === 8453 && refreshChain.morphoBlueAddress) {
        try {
          const connectedProvider = await getProvider();
          if (isStale()) return;
          const summary = await fetchMorphoSummaryWithBackendLogic({
            chainId: refreshChainId,
            rpcUrl: refreshChain.rpcUrl,
            provider: connectedProvider,
            market: MORPHO_BASE_CBBTC_USDC_MARKET,
            userAddress: kernelAddress,
          });
          if (isStale()) return;
          setMorphoSummary(summary);
        } catch (e) {
          console.error("Morpho summary fetch failed", e);
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-8 sm:px-7 sm:py-10">
      <ActionToastViewport toasts={toasts} onDismiss={dismissToast} />

      {/* Page header with breadcrumb */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
          <Link href="/scan" className="hover:text-zinc-900">
            Scan
          </Link>
          <span>/</span>
          <span className="text-zinc-900">Wallet #{indexParam}</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Kernel wallet #{indexParam}</h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          View loan positions, balances, and execute repay or withdraw operations.
        </p>
      </header>

      {!owner ? (
        <section className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-subtle)] p-5">
          <p className="text-sm text-[var(--muted)]">
            Connect your wallet using the button in the top right to view positions.
          </p>
        </section>
      ) : !kernelAddress ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm text-red-700">Invalid wallet index.</p>
        </section>
      ) : (
        <>
          {/* Wallet info + chain selector bar */}
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_1px_0_rgba(15,15,15,0.04)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2 text-[var(--muted)]">
                  <span>Connected wallet</span>
                  <span className="font-mono text-zinc-900">{shortAddress(owner)}</span>
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-subtle)] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">
                      Loan wallet
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-zinc-900 break-all">{kernelAddress}</span>
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-zinc-900 bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isCopying}
                      onClick={copyAddress}
                    >
                      <span className="inline-flex items-center gap-2">
                        {isCopying ? <ButtonSpinner /> : null}
                        <span>{copied ? "Copied!" : isCopying ? "Copying..." : "Copy address"}</span>
                      </span>
                    </button>
                  </div>
                  <div className="mt-1.5">
                    {nativeBalance !== null ? (
                      nativeBalance === 0n ? (
                        <span className="text-xs font-semibold text-red-600">
                          No gas &mdash; fund this wallet with {chain?.nativeSymbol ?? "native token"}
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-zinc-900">
                          Gas balance: {formatUnits(nativeBalance, 18)} {chain?.nativeSymbol ?? ""}
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-[var(--muted)]">
                        Gas balance: load positions to check
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    This is the smart wallet that holds your loan. Send gas ({chain?.nativeSymbol ?? "native token"}) and repay tokens to this address before executing rescue actions.
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 self-start">
                {autoDetecting ? (
                  <span className="text-xs text-[var(--muted)]">Detecting chain…</span>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-9 rounded-lg border border-[var(--line)] bg-[var(--panel-subtle)] px-3 text-sm outline-none focus:border-zinc-900 focus:bg-white"
                  value={selectedChainId}
                  disabled={isRefreshing}
                  onChange={(e) => {
                    const newChainId = Number(e.target.value) as SupportedChainId;
                    setError(null);
                    manualChainSelectionRef.current = true;
                    setSelectedChainId(newChainId);
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
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-700"
                  disabled={isRefreshing}
                  onClick={refresh}
                >
                  {isRefreshing ? <ButtonSpinner /> : null}
                  <span>{isRefreshing ? "Loading…" : "Load positions"}</span>
                </button>
                </div>
              </div>
            </div>

            {status ? (
              <p className="mt-3 text-xs text-[var(--muted)]">{status}</p>
            ) : null}
            {error ? (
              <p className="mt-3 text-xs text-red-600">{error}</p>
            ) : null}
          </section>

          {/* ZeroDev bundler config (page-level, shared) */}
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_1px_0_rgba(15,15,15,0.04)]">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
                  ZeroDev Project ID or RPC URL
                </span>
                <input
                  ref={zeroDevInputRef}
                  className={`h-11 rounded-lg border px-3 text-sm outline-none focus:bg-white ${
                    zeroDevValidationError
                      ? "border-red-300 bg-red-50 focus:border-red-500"
                      : "border-[var(--line)] bg-[var(--panel-subtle)] focus:border-zinc-900"
                  }`}
                  value={zerodevInput}
                  onChange={(e) => setZerodevInput(e.target.value)}
                  placeholder="paste project ID or full RPC URL"
                />
                {zeroDevValidationError ? (
                  <span className="text-xs text-red-600">{zeroDevValidationError}</span>
                ) : zeroDevInputTrimmed ? (
                  <span className="text-xs text-emerald-700">
                    ZeroDev bundler is ready for {chain?.name ?? "this chain"}.
                  </span>
                ) : (
                  <span className="text-xs text-[var(--muted)]">
                    Required before any rescue action can be submitted.
                  </span>
                )}
                <span className="text-xs text-[var(--muted)]">
                  Go to{" "}
                  <a
                    href="https://dashboard.zerodev.app/projects/general"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-zinc-900 underline underline-offset-2"
                  >
                    dashboard.zerodev.app
                  </a>
                  {" "}&rarr; sign in, open your project (or create one), then copy the <strong>Project ID</strong> from the top-right.
                  This is shared across all rescue actions below.
                </span>
              </label>

              <div className="flex flex-col gap-2">
                <span className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
                  {chain?.name ?? "Selected chain"} RPC URL
                </span>
                {showRpcInput ? (
                  <>
                    <input
                      ref={rpcInputRef}
                      className={`h-11 rounded-lg border px-3 text-sm outline-none focus:bg-white ${
                        selectedRpcError || selectedRpcHealth.status === "unhealthy"
                          ? "border-red-300 bg-red-50 focus:border-red-500"
                          : "border-[var(--line)] bg-[var(--panel-subtle)] focus:border-zinc-900"
                      }`}
                      value={selectedRpcInput}
                      onChange={(e) =>
                        setCustomRpcUrls((current) => ({
                          ...current,
                          [selectedChainId]: e.target.value,
                        }))
                      }
                      placeholder={getRpcInputPlaceholder(selectedChainId)}
                    />
                    {selectedRpcError ? (
                      <span className="text-xs text-red-600">
                        {selectedRpcError} Rescue actions will stay blocked until this is fixed.
                      </span>
                    ) : hasCustomRpcInput ? (
                      selectedRpcHealth.status === "healthy" ? (
                        <span className="text-xs text-emerald-700">
                          Custom RPC is ready for {chain?.name ?? "this chain"}.
                        </span>
                      ) : selectedRpcHealth.status === "checking" ? (
                        <span className="text-xs text-[var(--muted)]">Checking custom RPC…</span>
                      ) : (
                        <span className="text-xs text-red-600">
                          {selectedRpcHealth.message
                            ? `This RPC is not responding: ${selectedRpcHealth.message}`
                            : "This RPC is not responding."}
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-red-600">
                        {getDefaultRpcUnavailableMessage(selectedRpcHealth.message)}
                      </span>
                    )}
                    <span className="text-xs text-[var(--muted)]">
                      {defaultRpcProvider === "thirdweb" ? "If thirdweb keeps failing, go to " : "Need a replacement endpoint? Go to "}
                      <a
                        href="https://www.alchemy.com/dashboard"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-zinc-900 underline underline-offset-2"
                      >
                        Alchemy Dashboard
                      </a>
                      {" "}&rarr; sign in, open <strong>Apps</strong>, create a new app (or open an existing one),
                      choose {chain?.name ?? "your chain"}, then open the <strong>Endpoints</strong> tab and copy the <strong>HTTPS</strong> URL here. Any healthy HTTPS RPC URL also works.
                    </span>
                  </>
                ) : (
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-subtle)] px-3 py-3">
                    <div className="text-sm font-medium text-zinc-900">
                      {selectedRpcHealth.status === "checking" ? "Checking default RPC…" : "Default RPC is ready"}
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {selectedRpcHealth.status === "checking"
                        ? "The manual RPC field stays hidden unless this endpoint fails."
                        : defaultRpcProvider === "thirdweb"
                          ? `Using the thirdweb RPC from .env for ${chain?.name ?? "this chain"}. If it stops responding, the manual RPC field will appear so you can paste an Alchemy HTTPS endpoint.`
                          : defaultRpcProvider === "alchemy"
                            ? `Using the Alchemy RPC from .env for ${chain?.name ?? "this chain"}. The manual RPC field will appear automatically if it stops responding.`
                          : `Using the default ${chain?.name ?? "chain"} RPC configured for this app. The manual RPC field will appear automatically if it stops responding.`}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Rescue flow steps */}
          <nav className="flex flex-wrap gap-3 text-xs font-medium text-[var(--muted)]">
            <span className="rounded-full border border-[var(--line)] bg-[var(--panel-subtle)] px-3 py-1">
              1. Fund loan wallet
            </span>
            <span className="rounded-full border border-[var(--line)] bg-[var(--panel-subtle)] px-3 py-1">
              2. Repay debt
            </span>
            <span className="rounded-full border border-[var(--line)] bg-[var(--panel-subtle)] px-3 py-1">
              3. Withdraw collateral
            </span>
            <span className="rounded-full border border-[var(--line)] bg-[var(--panel-subtle)] px-3 py-1">
              4. Transfer out
            </span>
          </nav>

          {readinessIssues.length > 0 ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-medium text-amber-950">
                Rescue actions will prompt until these are fixed.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {readinessIssues.map((issue) => (
                  <span
                    key={issue}
                    className="rounded-full border border-amber-300 bg-white/80 px-3 py-1 text-xs font-medium text-amber-900"
                  >
                    {issue}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {/* Wallet balances */}
          <section>
            <h2 className="mb-3 font-mono text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
              Wallet balances
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
                <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                  {chain?.nativeSymbol ?? "Native"} (gas)
                </div>
                <div className="mt-1.5 text-lg font-semibold">
                  {nativeBalance === null ? (
                    <span className="text-zinc-300">&mdash;</span>
                  ) : (
                    formatUnits(nativeBalance, 18)
                  )}
                </div>
                {nativeBalance !== null && nativeBalance === 0n ? (
                  <p className="mt-1 text-xs text-red-600">
                    No gas &mdash; send {chain?.nativeSymbol ?? "native token"} to the loan wallet address above.
                  </p>
                ) : null}
                {nativeBalance !== null && nativeBalance > 0n ? (
                  <NativeTransferOutAction
                    chainId={selectedChainId}
                    chainRpcUrl={chain?.rpcUrl ?? ""}
                    owner={owner}
                    kernelAddress={kernelAddress}
                    nativeSymbol={chain?.nativeSymbol ?? "ETH"}
                    balance={nativeBalance}
                    bundlerUrl={bundlerUrl}
                    ensureActionReady={ensureActionReady}
                    notify={notifyToast}
                    onSuccess={refresh}
                    request={request}
                    switchChain={switchChain}
                  />
                ) : null}
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
                <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">{assets.usdc.symbol}</div>
                <div className="mt-1.5 text-lg font-semibold">
                  {usdcBalance === null ? (
                    <span className="text-zinc-300">&mdash;</span>
                  ) : (
                    formatUnits(usdcBalance, assets.usdc.decimals)
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
                <TransferOutAction
                  chainId={selectedChainId}
                  chainRpcUrl={chain?.rpcUrl ?? ""}
                  owner={owner}
                  kernelAddress={kernelAddress}
                  asset={assets.btcCollateral}
                  balance={btcBalance}
                  bundlerUrl={bundlerUrl}
                  ensureActionReady={ensureActionReady}
                  notify={notifyToast}
                  onSuccess={refresh}
                  request={request}
                  switchChain={switchChain}
                />
              </div>
            </div>
          </section>

          {/* Aave V3 position */}
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_1px_0_rgba(15,15,15,0.04)]">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
                Aave V3 — Loan details (debt asset: {assets.usdc.symbol})
              </h2>
              {aaveHealthFactor !== null ? (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getHealthFactorTone(aaveHealthFactor)}`}>
                  HF: {formatHealthFactor(aaveHealthFactor)}
                </span>
              ) : null}
            </div>

            {!aaveSummary && !aaveAccountData ? (
              <p className="mt-3 text-sm text-[var(--muted)]">
                Click &ldquo;Load positions&rdquo; above to fetch Aave data.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-subtle)] p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Collateral supplied ({assets.btcCollateral.symbol})
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {aaveCollateralSupplied !== null
                      ? formatUnits(aaveCollateralSupplied, assets.btcCollateral.decimals)
                      : "—"}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-subtle)] p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                    Debt ({assets.usdc.symbol})
                  </div>
                  <div className="mt-1 text-base font-semibold text-red-600">
                    {aaveDebtAmount !== null
                      ? formatUnits(aaveDebtAmount, assets.usdc.decimals)
                      : "—"}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-subtle)] p-3">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Health factor</div>
                  <div className="mt-1 text-base font-semibold">
                    {formatHealthFactor(aaveHealthFactor)}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-subtle)] p-3">
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
                chainRpcUrl={chain?.rpcUrl ?? ""}
                owner={owner}
                kernelAddress={kernelAddress}
                collateralAsset={assets.btcCollateral}
                repayAsset={assets.usdc}
                bundlerUrl={bundlerUrl}
                ensureActionReady={ensureActionReady}
                notify={notifyToast}
                onSuccess={refresh}
                request={request}
                switchChain={switchChain}
              />
            ) : null}
          </section>

          {/* Morpho Blue (Base only) */}
          {selectedChainId === 8453 ? (
            <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_1px_0_rgba(15,15,15,0.04)]">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
                  Morpho Blue — Loan details (debt asset: {assets.usdc.symbol})
                </h2>
                {morphoHealthFactor !== null ? (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getHealthFactorTone(morphoHealthFactor)}`}>
                    HF: {formatHealthFactor(morphoHealthFactor)}
                  </span>
                ) : null}
              </div>

              {!morphoPosition && !morphoSummary ? (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  Click &ldquo;Load positions&rdquo; above to fetch Morpho data for {MORPHO_BASE_MARKETS.cbBTC_USDC.label}.
                </p>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-subtle)] p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Supply shares</div>
                    <div className="mt-1 text-base font-semibold">{morphoPosition?.supplyShares.toString() ?? "—"}</div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-subtle)] p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Borrow shares</div>
                    <div className="mt-1 text-base font-semibold">{morphoPosition?.borrowShares.toString() ?? "—"}</div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-subtle)] p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                      Collateral supplied ({assets.btcCollateral.symbol})
                    </div>
                    <div className="mt-1 text-base font-semibold">
                      {morphoSummary?.collateralAmount ??
                        (morphoPosition
                          ? formatUnits(morphoPosition.collateral, CHAIN_ASSETS[8453].btcCollateral.decimals)
                          : "—")}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-subtle)] p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                      Borrow ({assets.usdc.symbol})
                    </div>
                    <div className="mt-1 text-base font-semibold text-red-600">
                      {morphoSummary?.borrowAmount ?? "—"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-subtle)] p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">LTV</div>
                    <div className="mt-1 text-base font-semibold">
                      {morphoSummary?.ltv ?? "—"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-subtle)] p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Health factor</div>
                    <div className="mt-1 text-base font-semibold">{formatHealthFactor(morphoHealthFactor)}</div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-subtle)] p-3">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Liquidation price</div>
                    <div className="mt-1 text-base font-semibold">
                      {morphoSummary?.liquidationPrice ?? "—"}
                    </div>
                  </div>
                </div>
              )}

              {chain?.morphoBlueAddress ? (
                <MorphoRescueActions
                  chainId={selectedChainId}
                  chainRpcUrl={chain?.rpcUrl ?? ""}
                  owner={owner}
                  kernelAddress={kernelAddress}
                  market={MORPHO_BASE_CBBTC_USDC_MARKET}
                  collateralAsset={assets.btcCollateral}
                  loanAsset={assets.usdc}
                  bundlerUrl={bundlerUrl}
                  ensureActionReady={ensureActionReady}
                  getProvider={getProvider}
                  notify={notifyToast}
                  onSuccess={refresh}
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
