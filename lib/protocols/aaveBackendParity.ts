import {
  InterestRate,
  Pool,
  UiIncentiveDataProvider,
  UiPoolDataProvider,
  type EthereumTransactionTypeExtended,
} from "@aave/contract-helpers";
import { formatReserves, formatUserSummaryAndIncentives } from "@aave/math-utils";
import dayjs from "dayjs";
import { Contract, providers } from "ethers";

import type { ChainConfig } from "../chains";
import type { Address } from "../eth/types";

const VARIABLE_DEBT_TOKEN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
];

const POOL_DATA_PROVIDER_ABI = [
  "function getReserveTokensAddresses(address asset) view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)",
];

const ERC20_DECIMALS_ABI = [
  "function decimals() view returns (uint8)",
];

type AaveSummary = {
  totalCollateralUSD: string;
  totalBorrowsUSD: string;
  availableBorrowsUSD: string;
  currentLoanToValue: string;
  currentLiquidationThreshold: string;
  healthFactor: string;
};

function getAavePoolClient(
  chain: ChainConfig,
  provider: providers.Provider,
) {
  if (!chain.aaveV3PoolAddress || !chain.aaveV3WethGatewayAddress) {
    throw new Error(`Aave pool or gateway config missing for chain ${chain.id}`);
  }
  return new Pool(provider, {
    POOL: chain.aaveV3PoolAddress,
    WETH_GATEWAY: chain.aaveV3WethGatewayAddress,
  });
}

/**
 * Backend-parity debt fetch used for "repay all" in temporal SDK.
 * Returns human-readable decimal string with full precision.
 */
export async function getAaveUserVariableDebt(
  provider: providers.Provider,
  protocolDataProviderAddress: Address,
  reserveAddress: Address,
  userAddress: Address,
): Promise<string> {
  const poolDataProvider = new Contract(
    protocolDataProviderAddress,
    POOL_DATA_PROVIDER_ABI,
    provider,
  );

  const [, , variableDebtTokenAddress] =
    await poolDataProvider.getReserveTokensAddresses(reserveAddress);

  const variableDebtToken = new Contract(
    variableDebtTokenAddress,
    VARIABLE_DEBT_TOKEN_ABI,
    provider,
  );
  const debtBalanceRaw = await variableDebtToken.balanceOf(userAddress);

  const reserveToken = new Contract(
    reserveAddress,
    ERC20_DECIMALS_ABI,
    provider,
  );
  const decimals: number = await reserveToken.decimals();

  const debtBalanceStr = debtBalanceRaw.toString();
  const paddedBalance = debtBalanceStr.padStart(decimals + 1, "0");
  const integerPart = paddedBalance.slice(0, -decimals) || "0";
  const decimalPart = paddedBalance.slice(-decimals);
  return `${integerPart}.${decimalPart}`;
}

export async function buildAaveRepayBundleWithBackendLogic(parameters: {
  chain: ChainConfig;
  provider: providers.Provider;
  userAddress: Address;
  reserve: Address;
  amount: string; // human-readable, "-1" for full repay
  onBehalfOf?: Address;
  interestRateMode?: InterestRate;
}): Promise<EthereumTransactionTypeExtended[]> {
  const { chain, provider, userAddress, reserve, amount, onBehalfOf, interestRateMode } = parameters;

  const pool = getAavePoolClient(chain, provider);

  // Pass "-1" directly to the Aave SDK for full repay — the SDK converts it
  // to uint256.max which lets the Pool contract repay the exact debt atomically.
  // Reading the debt first and passing the exact number loses this atomicity
  // and can cause precision issues with accrued interest.
  return pool.repay({
    user: userAddress,
    reserve,
    amount,
    onBehalfOf: onBehalfOf ?? userAddress,
    interestRateMode: interestRateMode ?? InterestRate.Variable,
  });
}

export async function buildAaveWithdrawBundleWithBackendLogic(parameters: {
  chain: ChainConfig;
  provider: providers.Provider;
  userAddress: Address;
  reserve: Address;
  amount: string; // human-readable, "-1" for full withdraw
  onBehalfOf?: Address;
}): Promise<EthereumTransactionTypeExtended[]> {
  const { chain, provider, userAddress, reserve, amount, onBehalfOf } = parameters;
  const pool = getAavePoolClient(chain, provider);

  return pool.withdraw({
    user: userAddress,
    reserve,
    amount,
    onBehalfOf: onBehalfOf ?? userAddress,
  });
}

/**
 * Backend-parity onchain status from Aave V3 controllers.
 */
export async function fetchAaveUserSummaryWithBackendLogic(parameters: {
  chain: ChainConfig;
  walletAddress: Address;
}): Promise<AaveSummary> {
  const { chain, walletAddress } = parameters;

  if (
    !chain.aaveV3PoolAddressesProvider ||
    !chain.aaveV3UiPoolDataProviderAddress ||
    !chain.aaveV3UiIncentiveDataProviderAddress
  ) {
    throw new Error(`Aave UI/provider config missing for chain ${chain.id}`);
  }

  const provider = new providers.JsonRpcProvider(chain.rpcUrl);
  const poolDataProviderContract = new UiPoolDataProvider({
    uiPoolDataProviderAddress: chain.aaveV3UiPoolDataProviderAddress,
    provider,
    chainId: chain.id,
  });
  const incentiveDataProviderContract = new UiIncentiveDataProvider({
    uiIncentiveDataProviderAddress: chain.aaveV3UiIncentiveDataProviderAddress,
    provider,
    chainId: chain.id,
  });

  const [reserves, userReserves, reserveIncentives, userIncentives] =
    await Promise.all([
      poolDataProviderContract.getReservesHumanized({
        lendingPoolAddressProvider: chain.aaveV3PoolAddressesProvider,
      }),
      poolDataProviderContract.getUserReservesHumanized({
        lendingPoolAddressProvider: chain.aaveV3PoolAddressesProvider,
        user: walletAddress,
      }),
      incentiveDataProviderContract.getReservesIncentivesDataHumanized({
        lendingPoolAddressProvider: chain.aaveV3PoolAddressesProvider,
      }),
      incentiveDataProviderContract.getUserReservesIncentivesDataHumanized({
        lendingPoolAddressProvider: chain.aaveV3PoolAddressesProvider,
        user: walletAddress,
      }),
    ]);

  const currentTimestamp = dayjs().unix();
  const formattedReserves = formatReserves({
    reserves: reserves.reservesData,
    currentTimestamp,
    marketReferenceCurrencyDecimals: reserves.baseCurrencyData.marketReferenceCurrencyDecimals,
    marketReferencePriceInUsd: reserves.baseCurrencyData.marketReferenceCurrencyPriceInUsd,
  });

  const summary = formatUserSummaryAndIncentives({
    currentTimestamp,
    marketReferencePriceInUsd: reserves.baseCurrencyData.marketReferenceCurrencyPriceInUsd,
    marketReferenceCurrencyDecimals: reserves.baseCurrencyData.marketReferenceCurrencyDecimals,
    userReserves: userReserves.userReserves,
    formattedReserves,
    userEmodeCategoryId: userReserves.userEmodeCategoryId,
    reserveIncentives,
    userIncentives,
  });

  return {
    totalCollateralUSD: summary.totalCollateralUSD,
    totalBorrowsUSD: summary.totalBorrowsUSD,
    availableBorrowsUSD: summary.availableBorrowsUSD,
    currentLoanToValue: summary.currentLoanToValue,
    currentLiquidationThreshold: summary.currentLiquidationThreshold,
    healthFactor: summary.healthFactor,
  };
}
