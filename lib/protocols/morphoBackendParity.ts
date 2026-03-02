import { ORACLE_PRICE_SCALE, type MarketId } from "@morpho-org/blue-sdk";
import { blueAbi, blueOracleAbi, fetchAccrualPosition } from "@morpho-org/blue-sdk-viem";
import { BigNumber, Contract, ethers, providers } from "ethers";
import { createPublicClient, custom, http, type Address } from "viem";
import { erc20Abi as ERC20_ABI } from "viem";

import { CHAIN_ASSETS } from "../assets";
import type { SupportedChainId } from "../chains";
import type { Hex } from "../eth/types";

export type MorphoParityMarketConfig = {
  label: string;
  marketId: Hex;
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
};

export const MORPHO_BASE_CBBTC_USDC_MARKET: MorphoParityMarketConfig = {
  label: "cbBTC/USDC",
  marketId: "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836",
  loanToken: CHAIN_ASSETS[8453].usdc.address,
  collateralToken: CHAIN_ASSETS[8453].btcCollateral.address,
  oracle: "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9",
  irm: "0x46415998764C29aB2a25CbeA6254146D50D22687",
  lltv: 860000000000000000n,
};

export type MorphoParityPosition = {
  supplyShares: bigint;
  borrowShares: bigint;
  borrowAssets: bigint;
  collateral: bigint;
};

export type MorphoParitySummary = {
  collateralUsd: string;
  borrowAssetsUsd: string;
  healthFactor: string;
  ltv: string;
  availableBorrowsUsd: string;
  liquidationPrice: string;
};

const MORPHO_BLUE_ADDRESS = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as Address;
const MORPHO_BLUE_ABI = blueAbi as ethers.ContractInterface;

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
};

type BasePublicClient = {
  readContract: (parameters: {
    address: Address;
    abi: unknown;
    functionName: string;
    args?: readonly unknown[];
  }) => Promise<unknown>;
};

function createBasePublicClient(parameters: {
  rpcUrl?: string;
  provider?: Eip1193Provider;
}): BasePublicClient {
  const { rpcUrl, provider } = parameters;
  if (provider) {
    return createPublicClient({
      transport: custom(provider),
    }) as unknown as BasePublicClient;
  }
  if (!rpcUrl) {
    throw new Error("Morpho summary fetch requires either rpcUrl or wallet provider");
  }
  return createPublicClient({
    transport: http(rpcUrl),
  }) as unknown as BasePublicClient;
}

function getBaseClientCandidates(parameters: {
  rpcUrl?: string;
  provider?: Eip1193Provider;
}): Array<{ label: string; client: BasePublicClient }> {
  const { rpcUrl, provider } = parameters;
  const candidates: Array<{ label: string; client: BasePublicClient }> = [];

  // Prefer public RPC first to mirror backend reads.
  if (rpcUrl) {
    candidates.push({
      label: `rpc:${rpcUrl}`,
      client: createBasePublicClient({ rpcUrl }),
    });
  }
  if (provider) {
    candidates.push({
      label: "wallet-provider",
      client: createBasePublicClient({ provider }),
    });
  }
  if (candidates.length === 0) {
    throw new Error("Morpho summary fetch requires either rpcUrl or wallet provider");
  }
  return candidates;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function mulDivUp(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) return 0n;
  if (a === 0n || b === 0n) return 0n;
  return ((a * b) + c - 1n) / c;
}

function buildMorphoSummary(parameters: {
  chainId: SupportedChainId;
  collateral: bigint;
  borrowAssets: bigint;
  price: bigint;
  lltv: bigint;
}): MorphoParitySummary {
  const { chainId, collateral, borrowAssets, price, lltv } = parameters;
  const collateralDecimals = CHAIN_ASSETS[chainId].btcCollateral.decimals;
  const loanDecimals = CHAIN_ASSETS[chainId].usdc.decimals;

  const collateralValueInLoanRaw = (collateral * price) / ORACLE_PRICE_SCALE;
  const collateralUsd = Number(ethers.utils.formatUnits(collateralValueInLoanRaw, loanDecimals));
  const borrowUsd = Number(ethers.utils.formatUnits(borrowAssets, loanDecimals));
  const lltvAsDecimal = Number(ethers.utils.formatUnits(lltv, 18));

  let healthFactor = "999";
  let ltvRatio = "0";
  let liquidationPrice = "0";

  if (borrowUsd > 0 && collateralUsd > 0 && lltvAsDecimal > 0) {
    const maxBorrowable = collateralUsd * lltvAsDecimal;
    healthFactor = (maxBorrowable / borrowUsd).toString();
    ltvRatio = (borrowUsd / collateralUsd).toString();

    const collateralHuman = Number(ethers.utils.formatUnits(collateral, collateralDecimals));
    if (collateralHuman > 0) {
      liquidationPrice = ((borrowUsd / collateralHuman) / lltvAsDecimal).toString();
    }
  }

  const availableBorrowsUsd = Math.max(0, collateralUsd * lltvAsDecimal - borrowUsd).toString();

  return {
    collateralUsd: collateralUsd.toString(),
    borrowAssetsUsd: borrowUsd.toString(),
    healthFactor,
    ltv: ltvRatio,
    availableBorrowsUsd,
    liquidationPrice,
  };
}

async function fetchMorphoSummaryViaAccrualPosition(parameters: {
  chainId: SupportedChainId;
  client: BasePublicClient;
  marketId: MarketId;
  userAddress: Address;
  lltv: bigint;
}): Promise<MorphoParitySummary | null> {
  const { chainId, client, marketId, userAddress, lltv } = parameters;
  const position = await fetchAccrualPosition(
    userAddress,
    marketId,
    client as never,
    { chainId, deployless: false },
  );

  if (position.collateral === 0n && position.borrowShares === 0n) return null;

  const price = position.market.price;
  if (!price || price === 0n) {
    throw new Error("Morpho oracle price unavailable");
  }

  return buildMorphoSummary({
    chainId,
    collateral: position.collateral,
    borrowAssets: position.borrowAssets,
    price,
    lltv,
  });
}

async function fetchMorphoSummaryViaRawContractReads(parameters: {
  chainId: SupportedChainId;
  client: BasePublicClient;
  marketId: MarketId;
  userAddress: Address;
  lltv: bigint;
}): Promise<MorphoParitySummary | null> {
  const { chainId, client, marketId, userAddress, lltv } = parameters;

  const [positionResult, marketResult, marketParamsResult] = await Promise.all([
    client.readContract({
      address: MORPHO_BLUE_ADDRESS,
      abi: blueAbi,
      functionName: "position",
      args: [marketId, userAddress],
    }),
    client.readContract({
      address: MORPHO_BLUE_ADDRESS,
      abi: blueAbi,
      functionName: "market",
      args: [marketId],
    }),
    client.readContract({
      address: MORPHO_BLUE_ADDRESS,
      abi: blueAbi,
      functionName: "idToMarketParams",
      args: [marketId],
    }),
  ]);

  const [, borrowShares, collateral] = positionResult as readonly [bigint, bigint, bigint];
  if (collateral === 0n && borrowShares === 0n) return null;

  const [, , totalBorrowAssets, totalBorrowShares] = marketResult as readonly [
    bigint, bigint, bigint, bigint, bigint, bigint
  ];
  const [, , oracleAddress] = marketParamsResult as readonly [Address, Address, Address, Address, bigint];

  const price = (await client.readContract({
    address: oracleAddress,
    abi: blueOracleAbi,
    functionName: "price",
  })) as bigint;

  if (price === 0n) throw new Error("Morpho oracle price unavailable");

  const borrowAssets = mulDivUp(borrowShares, totalBorrowAssets, totalBorrowShares);
  return buildMorphoSummary({
    chainId,
    collateral,
    borrowAssets,
    price,
    lltv,
  });
}

class MorphoBlueParityClient {
  private provider: providers.Provider;
  private morphoContract: Contract;

  constructor(provider: providers.Provider) {
    this.provider = provider;
    this.morphoContract = new Contract(
      MORPHO_BLUE_ADDRESS,
      MORPHO_BLUE_ABI,
      provider,
    );
  }

  async getApprovalTx(
    tokenAddress: Address,
    amount: string,
    ownerAddress: Address,
  ): Promise<{ to: Address; data: Hex; value: string } | null> {
    const tokenContract = new Contract(
      tokenAddress,
      ERC20_ABI as unknown as ethers.ContractInterface,
      this.provider,
    );
    const currentAllowance = await tokenContract.allowance(
      ownerAddress,
      MORPHO_BLUE_ADDRESS,
    );

    if (currentAllowance.gte(BigNumber.from(amount))) return null;

    const data = tokenContract.interface.encodeFunctionData("approve", [
      MORPHO_BLUE_ADDRESS,
      ethers.constants.MaxUint256,
    ]) as Hex;

    return { to: tokenAddress, data, value: "0" };
  }

  async getPosition(
    market: MorphoParityMarketConfig,
    userAddress: Address,
  ): Promise<MorphoParityPosition> {
    const position = await this.morphoContract.position(market.marketId, userAddress);
    return {
      supplyShares: BigInt((position.supplyShares ?? position[0] ?? 0).toString()),
      borrowShares: BigInt((position.borrowShares ?? position[1] ?? 0).toString()),
      collateral: BigInt((position.collateral ?? position[2] ?? 0).toString()),
      // borrowAssets not returned by raw position call
      borrowAssets: 0n,
    };
  }

  async getRepayTx(parameters: {
    market: MorphoParityMarketConfig;
    assets: string;
    shares: string;
    onBehalf: Address;
  }): Promise<Array<{ to: Address; data: Hex; value: string }>> {
    const { market, assets, shares, onBehalf } = parameters;
    const txs: Array<{ to: Address; data: Hex; value: string }> = [];

    const isSharesBasedRepay = assets === "0" && shares !== "0";
    const approvalAmount = isSharesBasedRepay
      ? ethers.constants.MaxUint256.toString()
      : assets;

    const approvalTx = await this.getApprovalTx(
      market.loanToken,
      approvalAmount,
      onBehalf,
    );
    if (approvalTx) txs.push(approvalTx);

    const data = this.morphoContract.interface.encodeFunctionData("repay", [
      [
        market.loanToken,
        market.collateralToken,
        market.oracle,
        market.irm,
        market.lltv.toString(),
      ],
      assets,
      shares,
      onBehalf,
      "0x",
    ]) as Hex;

    txs.push({ to: MORPHO_BLUE_ADDRESS, data, value: "0" });
    return txs;
  }

  async getWithdrawCollateralTx(parameters: {
    market: MorphoParityMarketConfig;
    assets: string;
    onBehalf: Address;
    receiver: Address;
  }): Promise<Array<{ to: Address; data: Hex; value: string }>> {
    const { market, assets, onBehalf, receiver } = parameters;
    const data = this.morphoContract.interface.encodeFunctionData(
      "withdrawCollateral",
      [
        [
          market.loanToken,
          market.collateralToken,
          market.oracle,
          market.irm,
          market.lltv.toString(),
        ],
        assets,
        onBehalf,
        receiver,
      ],
    ) as Hex;

    return [{ to: MORPHO_BLUE_ADDRESS, data, value: "0" }];
  }
}

async function getTokenDecimals(
  tokenAddress: Address,
  provider: providers.Provider,
): Promise<number> {
  const tokenContract = new Contract(
    tokenAddress,
    ERC20_ABI as unknown as ethers.ContractInterface,
    provider,
  );
  return Number(await tokenContract.decimals());
}

export async function buildMorphoRepayTxsWithBackendLogic(parameters: {
  provider: providers.Provider;
  market: MorphoParityMarketConfig;
  userAddress: Address;
  amount: string; // human-readable, "-1" for full repay
}): Promise<Array<{ to: Address; data: Hex; value: string }>> {
  const { provider, market, userAddress, amount } = parameters;
  const client = new MorphoBlueParityClient(provider);
  const isFullRepay = amount === "-1";

  if (isFullRepay) {
    const position = await client.getPosition(market, userAddress);
    return client.getRepayTx({
      market,
      assets: "0",
      shares: position.borrowShares.toString(),
      onBehalf: userAddress,
    });
  }

  const loanDecimals = await getTokenDecimals(market.loanToken, provider);
  const assetsInUnits = ethers.utils.parseUnits(amount, loanDecimals).toString();
  return client.getRepayTx({
    market,
    assets: assetsInUnits,
    shares: "0",
    onBehalf: userAddress,
  });
}

export async function buildMorphoWithdrawTxsWithBackendLogic(parameters: {
  provider: providers.Provider;
  market: MorphoParityMarketConfig;
  userAddress: Address;
  amount: string; // human-readable, "-1" for full withdraw
}): Promise<Array<{ to: Address; data: Hex; value: string }>> {
  const { provider, market, userAddress, amount } = parameters;
  const client = new MorphoBlueParityClient(provider);
  const isFullWithdraw = amount === "-1";

  if (isFullWithdraw) {
    const position = await client.getPosition(market, userAddress);
    return client.getWithdrawCollateralTx({
      market,
      assets: position.collateral.toString(),
      onBehalf: userAddress,
      receiver: userAddress,
    });
  }

  const collateralDecimals = await getTokenDecimals(market.collateralToken, provider);
  const assetsInUnits = ethers.utils.parseUnits(amount, collateralDecimals).toString();
  return client.getWithdrawCollateralTx({
    market,
    assets: assetsInUnits,
    onBehalf: userAddress,
    receiver: userAddress,
  });
}

export async function fetchMorphoSummaryWithBackendLogic(parameters: {
  chainId: SupportedChainId;
  rpcUrl?: string;
  provider?: Eip1193Provider;
  market: MorphoParityMarketConfig;
  userAddress: Address;
}): Promise<MorphoParitySummary | null> {
  const { chainId, rpcUrl, provider, market, userAddress } = parameters;
  const clients = getBaseClientCandidates({ rpcUrl, provider });
  const marketId = market.marketId as MarketId;
  const failures: string[] = [];
  let sawEmptyPosition = false;
  let successfulChecks = 0;

  for (const candidate of clients) {
    try {
      const summary = await fetchMorphoSummaryViaAccrualPosition({
        chainId,
        client: candidate.client,
        marketId,
        userAddress,
        lltv: market.lltv,
      });
      successfulChecks += 1;
      if (summary) return summary;
      sawEmptyPosition = true;
    } catch (error) {
      failures.push(`${candidate.label} accrual fetch failed: ${getErrorMessage(error)}`);
    }
  }

  for (const candidate of clients) {
    try {
      const summary = await fetchMorphoSummaryViaRawContractReads({
        chainId,
        client: candidate.client,
        marketId,
        userAddress,
        lltv: market.lltv,
      });
      successfulChecks += 1;
      if (summary) return summary;
      sawEmptyPosition = true;
    } catch (error) {
      failures.push(`${candidate.label} raw reads failed: ${getErrorMessage(error)}`);
    }
  }

  if (successfulChecks > 0 && sawEmptyPosition) return null;
  throw new Error(`Morpho summary unavailable: ${failures.join(" | ")}`);
}
