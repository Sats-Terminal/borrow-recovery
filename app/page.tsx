"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useWallet } from "./providers";

export default function Home() {
  const { address } = useWallet();
  const [walletIndex, setWalletIndex] = useState("");

  const shortAddress = useMemo(() => {
    if (!address) return null;
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }, [address]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
      {/* Hero */}
      <section>
        <h1 className="text-balance text-3xl font-semibold tracking-tight">
          Recovery
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Self-serve recovery UI to discover and manage your per-loan ZeroDev
          Kernel smart accounts if satsterminal ceases to exist.
        </p>
      </section>

      {/* Quick actions grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Scan card */}
        <Link
          href="/scan"
          className="group flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Scan for wallets</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              Discover deployed Kernel wallets across Ethereum, Base, Arbitrum
              and BNB by scanning sequential indices.
            </p>
          </div>
          <span className="mt-auto text-xs font-medium text-blue-600 group-hover:underline dark:text-blue-400">
            Start scanning &rarr;
          </span>
        </Link>

        {/* Direct wallet lookup */}
        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Loan details & repay</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              Enter a wallet index to view Aave/Morpho positions, balances,
              health factor and execute repay or withdraw.
            </p>
          </div>
          <div className="mt-auto flex items-center gap-2">
            <input
              className="h-9 w-24 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
              placeholder="Index"
              inputMode="numeric"
              value={walletIndex}
              onChange={(e) => setWalletIndex(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && walletIndex) {
                  window.location.href = `/wallet/${walletIndex}`;
                }
              }}
            />
            <Link
              href={walletIndex ? `/wallet/${walletIndex}` : "#"}
              className={`inline-flex h-9 items-center rounded-lg px-3 text-xs font-semibold transition-colors ${
                walletIndex
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "cursor-not-allowed bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
              }`}
              onClick={(e) => !walletIndex && e.preventDefault()}
            >
              View
            </Link>
          </div>
        </div>

        {/* Safety card */}
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200/60 bg-amber-50/50 p-5 shadow-sm dark:border-amber-900/30 dark:bg-amber-950/20">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-300">Safety notes</h3>
            <ul className="mt-2 space-y-1.5 text-xs leading-5 text-amber-800 dark:text-amber-400/80">
              <li>Never paste a private key here. Import into MetaMask first.</li>
              <li>No database, no paymaster. You fund gas for rescue ops.</li>
              <li>All signing happens in your wallet extension.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Connected status */}
      {address ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Connected as <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{shortAddress}</span>
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Use &ldquo;Scan for wallets&rdquo; to discover your deployed Kernel wallets, or enter a known index above to jump directly to loan details.
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-100/50 p-5 dark:border-zinc-700 dark:bg-zinc-900/50">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connect your wallet using the button in the top right to get started.
          </p>
        </section>
      )}
    </main>
  );
}
