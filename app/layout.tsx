import type { Metadata } from "next";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { AppProviders } from "./providers";
import { Header } from "./_components/Header";

export const metadata: Metadata = {
  title: "satsterminal Recovery UI",
  description:
    "Self-serve recovery UI to discover and manage ZeroDev Kernel loan wallets if satsterminal ceases to exist.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-black dark:text-zinc-50">
        <AppProviders>
          <Header />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
