"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/scan", label: "Scan wallets" },
] as const;

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[color:rgba(247,247,246,0.92)] backdrop-blur">
      <div className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-5 sm:px-7">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/satsterminal-logo.svg"
              alt="Sats Terminal"
              width={184}
              height={23}
              priority
            />
            <span className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
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
                  className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "border border-zinc-900 bg-zinc-900 text-white"
                      : "text-[var(--muted)] hover:bg-[var(--panel-subtle)] hover:text-zinc-900"
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
