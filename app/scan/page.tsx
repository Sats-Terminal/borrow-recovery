"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { getChainConfig, SUPPORTED_CHAINS, type SupportedChainId } from "@/lib/chains";
import { deriveKernelAddressV3_3FromEOA } from "@/lib/kernel/deriveKernelAddress";

import { useWallet } from "../providers";

type Address = `0x${string}`;

type ScanRow = {
  index: number;
  kernelAddress: Address;
  deployedByChainId: Partial<Record<SupportedChainId, boolean>>;
};

const MAX_SCAN_RANGE_SIZE = 2_000;

export default function ScanPage() {
  const router = useRouter();
  const { address, chainId, request, switchChain } = useWallet();

  const [startIndex, setStartIndex] = useState(0);
  const [endIndex, setEndIndex] = useState(100);
  const [selectedChains, setSelectedChains] = useState<SupportedChainId[]>([1, 8453, 42161, 56]);
  const [rows, setRows] = useState<ScanRow[] | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyDeployed, setOnlyDeployed] = useState(false);
  const cancelRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cancelRef.current = true;
    };
  }, []);

  const supportedChain = useMemo(() => getChainConfig(chainId), [chainId]);

  const readChainId = async () => {
    const chainIdHex = (await request("eth_chainId")) as string;
    if (typeof chainIdHex !== "string" || !chainIdHex.startsWith("0x")) return null;
    return Number.parseInt(chainIdHex.slice(2), 16);
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Scan for wallets</h1>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Discover your per-loan ZeroDev Kernel smart accounts by scanning sequential indices.
        </p>
      </header>

      {!address ? (
        <section className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-100/50 p-5 dark:border-zinc-700 dark:bg-zinc-900/50">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connect your wallet using the button in the top right to start scanning.
          </p>
        </section>
      ) : (
          <>
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                Settings
              </h2>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">Start index</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
                    inputMode="numeric"
                    value={startIndex}
                    onChange={(e) => setStartIndex(Number(e.target.value))}
                    disabled={isScanning}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">End index</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
                    inputMode="numeric"
                    value={endIndex}
                    onChange={(e) => setEndIndex(Number(e.target.value))}
                    disabled={isScanning}
                  />
                </label>
              </div>

              <div className="mt-6">
                <div className="text-sm text-zinc-700 dark:text-zinc-300">Chains</div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SUPPORTED_CHAINS.map((c) => {
                    const checked = selectedChains.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isScanning}
                          onChange={() => {
                            setSelectedChains((prev) =>
                              checked ? prev.filter((id) => id !== c.id) : [...prev, c.id],
                            );
                          }}
                        />
                        <span>{c.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  disabled={isScanning || selectedChains.length === 0}
                  onClick={async () => {
                    setError(null);
                    setStatus(null);
                    cancelRef.current = false;

                    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) {
                      setError("Invalid range.");
                      return;
                    }
                    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
                      setError("Range must use whole numbers.");
                      return;
                    }
                    if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
                      setError("Range must be non-negative and end ≥ start.");
                      return;
                    }
                    if (endIndex - startIndex + 1 > MAX_SCAN_RANGE_SIZE) {
                      setError(`Range too large. Max ${MAX_SCAN_RANGE_SIZE} indices per scan.`);
                      return;
                    }

                    setIsScanning(true);
                    try {
                      const baseRows: ScanRow[] = [];
                      for (let i = startIndex; i <= endIndex; i++) {
                        baseRows.push({
                          index: i,
                          kernelAddress: deriveKernelAddressV3_3FromEOA(address, BigInt(i)),
                          deployedByChainId: {},
                        });
                      }
                      if (!mountedRef.current) return;
                      setRows(baseRows);

                      for (const targetChainId of selectedChains) {
                        if (cancelRef.current || !mountedRef.current) break;

                        if (!mountedRef.current) return;
                        setStatus(`Switch to ${targetChainId} to scan…`);
                        const current = await readChainId();
                        if (cancelRef.current || !mountedRef.current) break;
                        if (current !== targetChainId) {
                          await switchChain(targetChainId);
                          if (cancelRef.current || !mountedRef.current) break;
                        }

                        if (!mountedRef.current) return;
                        setStatus(`Scanning chain ${targetChainId}…`);
                        const batchSize = 12;
                        for (let offset = 0; offset < baseRows.length; offset += batchSize) {
                          if (cancelRef.current || !mountedRef.current) break;

                          const batch = baseRows.slice(offset, offset + batchSize);
                          const codes = (await Promise.all(
                            batch.map(async (r) => {
                              try {
                                return (await request("eth_getCode", [
                                  r.kernelAddress,
                                  "latest",
                                ])) as string;
                              } catch {
                                return "0x";
                              }
                            }),
                          )) as string[];
                          if (cancelRef.current || !mountedRef.current) break;

                          for (let i = 0; i < batch.length; i++) {
                            const row = batch[i];
                            row.deployedByChainId[targetChainId] = codes[i] !== "0x";
                          }

                          // Re-render occasionally, not for every single RPC call
                          if (!mountedRef.current) return;
                          setRows([...baseRows]);
                          if (!mountedRef.current) return;
                          setStatus(
                            `Scanning chain ${targetChainId}: ${Math.min(
                              offset + batch.length,
                              baseRows.length,
                            )}/${baseRows.length}`,
                          );
                        }
                      }
                      if (mountedRef.current) {
                        setStatus(cancelRef.current ? "Scan cancelled." : "Scan complete.");
                      }
                    } catch (e) {
                      if (mountedRef.current) {
                        setError(e instanceof Error ? e.message : "Scan failed.");
                      }
                    } finally {
                      if (mountedRef.current) {
                        setIsScanning(false);
                      }
                    }
                  }}
                >
                  Start scan
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:hover:bg-zinc-900"
                  disabled={!isScanning}
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  Cancel
                </button>

                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  Connected chain: {supportedChain?.name ?? chainId ?? "unknown"}
                </div>
              </div>

              {status ? (
                <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{status}</p>
              ) : null}
              {error ? (
                <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
              ) : null}
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                Results
              </h2>

              {!rows ? (
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                  Run a scan to populate results.
                </p>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">
                    Showing {onlyDeployed ? "deployed-only" : "all"} wallets.
                  </div>

                  <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={onlyDeployed}
                      onChange={() => setOnlyDeployed((v) => !v)}
                    />
                    Show only deployed wallets
                  </label>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-separate border-spacing-y-2 text-sm">
                      <thead>
                        <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                          <th className="px-3">Index</th>
                          <th className="px-3">Kernel address</th>
                          {selectedChains.map((cid) => (
                            <th key={cid} className="px-3">
                              {SUPPORTED_CHAINS.find((c) => c.id === cid)?.name ?? cid}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows
                          .filter((r) => {
                            if (!onlyDeployed) return true;
                            return selectedChains.some((cid) => r.deployedByChainId[cid]);
                          })
                          .map((r) => (
                            <tr
                              key={r.index}
                              className="cursor-pointer rounded-xl bg-zinc-50 text-zinc-900 transition-colors hover:bg-zinc-100 dark:bg-black dark:text-zinc-50 dark:hover:bg-zinc-900"
                              onClick={() => router.push(`/wallet/${r.index}`)}
                            >
                              <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-400">
                                {r.index}
                              </td>
                              <td className="px-3 py-2 font-mono">
                                {r.kernelAddress.slice(0, 10)}…{r.kernelAddress.slice(-8)}
                              </td>
                              {selectedChains.map((cid) => {
                                const deployed = r.deployedByChainId[cid];
                                return (
                                  <td key={cid} className="px-3 py-2">
                                    {deployed ? (
                                      <span className="inline-flex items-center rounded-full bg-green-600/10 px-2 py-1 text-xs font-semibold text-green-700 dark:text-green-400">
                                        deployed
                                      </span>
                                    ) : (
                                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                        —
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
    </main>
  );
}
