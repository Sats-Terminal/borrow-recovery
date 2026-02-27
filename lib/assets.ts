import type { SupportedChainId } from "./chains";

export type TokenConfig = {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
};

export type ChainAssets = {
  usdc: TokenConfig;
  btcCollateral: TokenConfig;
};

export const CHAIN_ASSETS: Record<SupportedChainId, ChainAssets> = {
  1: {
    usdc: { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    btcCollateral: {
      symbol: "WBTC",
      address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      decimals: 8,
    },
  },
  8453: {
    usdc: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    btcCollateral: {
      symbol: "cbBTC",
      address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      decimals: 8,
    },
  },
  42161: {
    usdc: { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    btcCollateral: {
      symbol: "WBTC",
      address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
      decimals: 8,
    },
  },
  56: {
    usdc: { symbol: "USDC", address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", decimals: 18 },
    btcCollateral: {
      symbol: "BTCB",
      address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      decimals: 18,
    },
  },
};

