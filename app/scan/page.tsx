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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-8 sm:px-7 sm:py-10">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
          Scanner
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Scan for wallets</h1>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Discover your per-loan ZeroDev Kernel smart accounts by scanning sequential indices.
        </p>
      </header>

      {!address ? (
        <section className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-subtle)] p-5">
          <p className="text-sm text-[var(--muted)]">
            Connect your wallet using the button in the top right to start scanning.
          </p>
        </section>
      ) : (
          <>
            <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_1px_0_rgba(15,15,15,0.04)]">
              <h2 className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
                Settings
              </h2>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className="text-sm text-zinc-700">Start index</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="h-11 rounded-lg border border-[var(--line)] bg-[var(--panel-subtle)] px-3 text-sm outline-none focus:border-zinc-900 focus:bg-white"
                    inputMode="numeric"
                    value={startIndex}
                    onChange={(e) => setStartIndex(Number(e.target.value))}
                    disabled={isScanning}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm text-zinc-700">End index</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className="h-11 rounded-lg border border-[var(--line)] bg-[var(--panel-subtle)] px-3 text-sm outline-none focus:border-zinc-900 focus:bg-white"
                    inputMode="numeric"
                    value={endIndex}
                    onChange={(e) => setEndIndex(Number(e.target.value))}
                    disabled={isScanning}
                  />
                </label>
              </div>

              <div className="mt-6">
                <div className="text-sm text-zinc-700">Chains</div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SUPPORTED_CHAINS.map((c) => {
                    const checked = selectedChains.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel-subtle)] px-3 py-2 text-sm"
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
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
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
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--panel)] px-5 text-sm font-semibold text-zinc-900 hover:bg-[var(--panel-subtle)] disabled:opacity-50"
                  disabled={!isScanning}
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  Cancel
                </button>

                <div className="text-sm text-[var(--muted)]">
                  Connected chain: {supportedChain?.name ?? chainId ?? "unknown"}
                </div>
              </div>

              {status ? (
                <p className="mt-4 text-sm text-[var(--muted)]">{status}</p>
              ) : null}
              {error ? (
                <p className="mt-4 text-sm text-red-600">{error}</p>
              ) : null}
            </section>

            <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_1px_0_rgba(15,15,15,0.04)]">
              <h2 className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
                Results
              </h2>

              {!rows ? (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  Run a scan to populate results.
                </p>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="text-xs text-[var(--muted)]">
                    Showing {onlyDeployed ? "deployed-only" : "all"} wallets.
                  </div>

                  <label className="flex items-center gap-2 text-sm text-zinc-700">
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
                        <tr className="text-left text-xs text-[var(--muted)]">
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
                              className="cursor-pointer rounded-xl border border-[var(--line)] bg-[var(--panel-subtle)] text-zinc-900 transition-colors hover:bg-zinc-100"
                              onClick={() => router.push(`/wallet/${r.index}`)}
                            >
                              <td className="px-3 py-2 font-mono">
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
                                      <span className="inline-flex items-center rounded-full border border-zinc-900 bg-zinc-900 px-2 py-1 text-xs font-semibold text-white">
                                        deployed
                                      </span>
                                    ) : (
                                      <span className="text-xs text-[var(--muted)]">
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
