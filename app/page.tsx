"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useWallet } from "./providers";

export default function Home() {
  const router = useRouter();
  const { address } = useWallet();
  const [walletIndex, setWalletIndex] = useState("");

  const shortAddress = useMemo(() => {
    if (!address) return null;
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }, [address]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-8 sm:px-7 sm:py-10">
      <section>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
          Recovery Dashboard
        </p>
        <h1 className="mt-2 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Recover and manage loan wallets fast.
        </h1>
        <p className="mt-4 max-w-3xl text-pretty text-base leading-7 text-[var(--muted)]">
          Scan deployed ZeroDev Kernel wallets, load protocol positions, and run rescue actions from one minimal control panel.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-[0_1px_0_rgba(15,15,15,0.04)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
              Available Actions
            </p>
            <span className="rounded-md bg-[var(--panel-subtle)] px-2 py-1 font-mono text-[11px] text-zinc-600">
              Kernel Recovery
            </span>
          </div>

          <div className="space-y-5 px-5 py-6">
            <h2 className="text-balance text-3xl font-semibold leading-tight sm:text-[2.2rem]">
              Scan wallets and open live loan positions.
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Discover deployed wallets across Ethereum, Base, Arbitrum, and BNB. Then open a wallet id to inspect balances, health factors, and rescue controls.
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-[var(--line)] px-5 py-4">
            <Link
              href="/scan"
              className="inline-flex h-10 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
            >
              Scan Wallets
            </Link>
            <span className="font-mono text-xs text-[var(--muted)]">
              No backend dependency
            </span>
          </div>
        </section>

        <div className="flex flex-col gap-6">
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-[0_1px_0_rgba(15,15,15,0.04)]">
            <div className="border-b border-[var(--line)] px-5 py-4">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                Open Wallet
              </p>
            </div>
            <div className="space-y-4 px-5 py-5">
              <p className="text-sm leading-6 text-[var(--muted)]">
                Enter a recovery wallet index to view Aave and Morpho details immediately.
              </p>
              <div className="flex items-center gap-2">
                <input
                  className="h-10 flex-1 rounded-lg border border-[var(--line)] bg-[var(--panel-subtle)] px-3 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-900 focus:bg-white"
                  placeholder="Wallet index"
                  inputMode="numeric"
                  value={walletIndex}
                  onChange={(e) => setWalletIndex(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && walletIndex) {
                      router.push(`/wallet/${walletIndex}`);
                    }
                  }}
                />
                <Link
                  href={walletIndex ? `/wallet/${walletIndex}` : "#"}
                  className={`inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium transition-colors ${
                    walletIndex
                      ? "bg-zinc-900 text-white hover:bg-zinc-700"
                      : "cursor-not-allowed bg-zinc-200 text-zinc-500"
                  }`}
                  onClick={(e) => !walletIndex && e.preventDefault()}
                >
                  View
                </Link>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_1px_0_rgba(15,15,15,0.04)]">
            {address ? (
              <>
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  Connected
                </p>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Wallet:{" "}
                  <span className="font-mono font-medium text-zinc-900">{shortAddress}</span>
                </p>
              </>
            ) : (
              <>
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
                  Status
                </p>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Connect your wallet from the top-right button to begin scanning.
                </p>
              </>
            )}
          </section>
        </div>
      </div>

      <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_1px_0_rgba(15,15,15,0.04)]">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Safety Notes
        </p>
        <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
          <li>Never paste private keys in this app. Use your wallet extension only.</li>
          <li>Gas is required for rescue operations and must be funded by you.</li>
          <li>Signing and transaction approval happen in your connected wallet.</li>
        </ul>
      </section>
    </main>
  );
}
