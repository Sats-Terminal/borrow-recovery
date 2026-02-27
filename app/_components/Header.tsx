"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/scan", label: "Scan wallets" },
] as const;

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur-lg dark:border-zinc-800 dark:bg-black/80">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-base font-bold tracking-tight">
              satsterminal
            </span>
            <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Recovery
            </span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {NAV_ITEMS.map(({ href, label }) => {
              const isActive =
                href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </div>
    </header>
  );
}
