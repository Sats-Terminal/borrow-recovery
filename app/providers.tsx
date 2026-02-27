"use client";

import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { createContext, useCallback, useMemo } from "react";
import { WagmiProvider, createConfig, http, useAccount, useConnect, useSwitchChain } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { arbitrum, base, bsc, mainnet } from "wagmi/chains";

type Address = `0x${string}`;

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function getEthereum(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const anyWindow = window as unknown as { ethereum?: Eip1193Provider };
  return anyWindow.ethereum ?? null;
}

function isEip1193Provider(value: unknown): value is Eip1193Provider {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { request?: unknown };
  return typeof maybe.request === "function";
}

const supportedChains = [mainnet, base, arbitrum, bsc] as const;
const transports = {
  [mainnet.id]: http(),
  [base.id]: http(),
  [arbitrum.id]: http(),
  [bsc.id]: http(),
};
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

const wagmiConfig = createConfig({
  chains: supportedChains,
  connectors: walletConnectProjectId
    ? [
        injected({ shimDisconnect: true }),
        walletConnect({
          projectId: walletConnectProjectId,
          showQrModal: true,
        }),
      ]
    : [injected({ shimDisconnect: true })],
  transports,
  ssr: true,
});

const queryClient = new QueryClient();

type WalletState = {
  isReady: boolean;
  hasInjectedProvider: boolean;
  walletConnectEnabled: boolean;
  address: Address | null;
  chainId: number | null;
  getProvider: () => Promise<Eip1193Provider>;
  request: (method: string, params?: unknown[] | object) => Promise<unknown>;
  connect: () => Promise<void>;
  switchChain: (chainId: number) => Promise<void>;
};

const WalletContext = createContext<WalletState | null>(null);

function WalletBridgeProvider({ children }: { children: React.ReactNode }) {
  const { address, chainId, connector } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const isReady = true;
  const hasInjectedProvider = useMemo(() => Boolean(getEthereum()), []);

  const connect = useCallback(async () => {
    const candidateConnector =
      (hasInjectedProvider
        ? connectors.find((item) => item.type === "injected")
        : undefined) ?? connectors[0];
    if (!candidateConnector) throw new Error("No wallet connector available.");
    await connectAsync({ connector: candidateConnector });
  }, [connectAsync, connectors, hasInjectedProvider]);

  const getProvider = useCallback(async () => {
    const providerFromConnector = connector
      ? await connector.getProvider({ chainId: chainId ?? undefined })
      : null;
    const provider = providerFromConnector ?? getEthereum();
    if (!isEip1193Provider(provider)) {
      throw new Error("No connected wallet provider found.");
    }
    return provider;
  }, [chainId, connector]);

  const request = useCallback(
    async (method: string, params?: unknown[] | object) => {
      const provider = await getProvider();
      return provider.request({ method, params });
    },
    [getProvider],
  );

  const switchChain = useCallback(async (targetChainId: number) => {
    await switchChainAsync({ chainId: targetChainId });
  }, [switchChainAsync]);

  const value: WalletState = useMemo(
    () => ({
      isReady,
      hasInjectedProvider,
      walletConnectEnabled: Boolean(walletConnectProjectId),
      address: (address as Address | undefined) ?? null,
      chainId: chainId ?? null,
      getProvider,
      request,
      connect,
      switchChain,
    }),
    [address, chainId, connect, getProvider, hasInjectedProvider, isReady, request, switchChain],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <WalletBridgeProvider>{children}</WalletBridgeProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function useWallet() {
  const ctx = React.useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <AppProviders />");
  return ctx;
}
