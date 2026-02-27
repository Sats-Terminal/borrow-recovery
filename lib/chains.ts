import {
  AaveV3Arbitrum,
  AaveV3Base,
  AaveV3BNB,
  AaveV3Ethereum,
} from "@bgd-labs/aave-address-book";

export type SupportedChainId = 1 | 8453 | 42161 | 56;

export type ChainConfig = {
  id: SupportedChainId;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  explorerBaseUrl: string;
  aaveV3PoolAddress: `0x${string}` | null;
  aaveV3WethGatewayAddress: `0x${string}` | null;
  aaveV3ProtocolDataProviderAddress: `0x${string}` | null;
  aaveV3PoolAddressesProvider: `0x${string}` | null;
  aaveV3UiPoolDataProviderAddress: `0x${string}` | null;
  aaveV3UiIncentiveDataProviderAddress: `0x${string}` | null;
  morphoBlueAddress: `0x${string}` | null;
};

export const SUPPORTED_CHAINS: readonly ChainConfig[] = [
  {
    id: 1,
    name: "Ethereum",
    nativeSymbol: "ETH",
    rpcUrl: "https://rpc.ankr.com/eth",
    explorerBaseUrl: "https://etherscan.io",
    aaveV3PoolAddress: AaveV3Ethereum.POOL as `0x${string}`,
    aaveV3WethGatewayAddress: AaveV3Ethereum.WETH_GATEWAY as `0x${string}`,
    aaveV3ProtocolDataProviderAddress:
      AaveV3Ethereum.AAVE_PROTOCOL_DATA_PROVIDER as `0x${string}`,
    aaveV3PoolAddressesProvider: AaveV3Ethereum.POOL_ADDRESSES_PROVIDER as `0x${string}`,
    aaveV3UiPoolDataProviderAddress: AaveV3Ethereum.UI_POOL_DATA_PROVIDER as `0x${string}`,
    aaveV3UiIncentiveDataProviderAddress:
      AaveV3Ethereum.UI_INCENTIVE_DATA_PROVIDER as `0x${string}`,
    morphoBlueAddress: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  },
  {
    id: 8453,
    name: "Base",
    nativeSymbol: "ETH",
    rpcUrl: "https://mainnet.base.org",
    explorerBaseUrl: "https://basescan.org",
    aaveV3PoolAddress: AaveV3Base.POOL as `0x${string}`,
    aaveV3WethGatewayAddress: AaveV3Base.WETH_GATEWAY as `0x${string}`,
    aaveV3ProtocolDataProviderAddress:
      AaveV3Base.AAVE_PROTOCOL_DATA_PROVIDER as `0x${string}`,
    aaveV3PoolAddressesProvider: AaveV3Base.POOL_ADDRESSES_PROVIDER as `0x${string}`,
    aaveV3UiPoolDataProviderAddress: AaveV3Base.UI_POOL_DATA_PROVIDER as `0x${string}`,
    aaveV3UiIncentiveDataProviderAddress:
      AaveV3Base.UI_INCENTIVE_DATA_PROVIDER as `0x${string}`,
    morphoBlueAddress: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  },
  {
    id: 42161,
    name: "Arbitrum",
    nativeSymbol: "ETH",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerBaseUrl: "https://arbiscan.io",
    aaveV3PoolAddress: AaveV3Arbitrum.POOL as `0x${string}`,
    aaveV3WethGatewayAddress: AaveV3Arbitrum.WETH_GATEWAY as `0x${string}`,
    aaveV3ProtocolDataProviderAddress:
      AaveV3Arbitrum.AAVE_PROTOCOL_DATA_PROVIDER as `0x${string}`,
    aaveV3PoolAddressesProvider:
      AaveV3Arbitrum.POOL_ADDRESSES_PROVIDER as `0x${string}`,
    aaveV3UiPoolDataProviderAddress:
      AaveV3Arbitrum.UI_POOL_DATA_PROVIDER as `0x${string}`,
    aaveV3UiIncentiveDataProviderAddress:
      AaveV3Arbitrum.UI_INCENTIVE_DATA_PROVIDER as `0x${string}`,
    morphoBlueAddress: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  },
  {
    id: 56,
    name: "BNB Chain",
    nativeSymbol: "BNB",
    rpcUrl: "https://bsc-dataseed.binance.org",
    explorerBaseUrl: "https://bscscan.com",
    aaveV3PoolAddress: AaveV3BNB.POOL as `0x${string}`,
    aaveV3WethGatewayAddress: AaveV3BNB.WETH_GATEWAY as `0x${string}`,
    aaveV3ProtocolDataProviderAddress: AaveV3BNB.AAVE_PROTOCOL_DATA_PROVIDER as `0x${string}`,
    aaveV3PoolAddressesProvider: AaveV3BNB.POOL_ADDRESSES_PROVIDER as `0x${string}`,
    aaveV3UiPoolDataProviderAddress: AaveV3BNB.UI_POOL_DATA_PROVIDER as `0x${string}`,
    aaveV3UiIncentiveDataProviderAddress:
      AaveV3BNB.UI_INCENTIVE_DATA_PROVIDER as `0x${string}`,
    morphoBlueAddress: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  },
] as const;

export function getChainConfig(chainId: number | null | undefined): ChainConfig | null {
  if (!chainId) return null;
  return (SUPPORTED_CHAINS.find((c) => c.id === chainId) as ChainConfig | undefined) ?? null;
}

