import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";
import { AppProviders } from "./providers";
import { Header } from "./_components/Header";

export const metadata: Metadata = {
  title: "satsterminal Recovery UI",
  description:
    "Self-serve recovery UI for EVM ZeroDev Kernel loan wallets if satsterminal ceases to exist or the hosted service is unavailable. Solana loans are not supported.",
};

const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans-custom",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono-custom",
  weight: ["400", "500", "600"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] antialiased">
        <AppProviders>
          <Header />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
