import { AccrualPosition, Market, ORACLE_PRICE_SCALE, type MarketId } from "@morpho-org/blue-sdk";
import { blueAbi } from "@morpho-org/blue-sdk-viem";
import { BigNumber, Contract, ethers, providers } from "ethers";
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { erc20Abi as ERC20_ABI } from "viem";

import { CHAIN_ASSETS } from "../assets";
import type { Hex } from "../eth/types";

import "@morpho-org/blue-sdk-viem/lib/augment/Market";
import "@morpho-org/blue-sdk-viem/lib/augment/Position";

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

function createBasePublicClient(rpcUrl: string): unknown {
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
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
  rpcUrl: string;
  market: MorphoParityMarketConfig;
  userAddress: Address;
}): Promise<MorphoParitySummary | null> {
  const { rpcUrl, market, userAddress } = parameters;
  const publicClient = createBasePublicClient(rpcUrl);
  const marketId = market.marketId as MarketId;

  const [marketState, position] = await Promise.all([
    Market.fetch(marketId, publicClient as never),
    AccrualPosition.fetch(userAddress, marketId, publicClient as never),
  ]);

  if (position.collateral === 0n && position.borrowShares === 0n) return null;
  if (!marketState.price || marketState.price === 0n) {
    throw new Error("Morpho oracle price unavailable");
  }

  const collateralDecimals = CHAIN_ASSETS[8453].btcCollateral.decimals;
  const loanDecimals = CHAIN_ASSETS[8453].usdc.decimals;

  const collateralValueInLoanRaw =
    (position.collateral * marketState.price) / ORACLE_PRICE_SCALE;
  const collateralUsd = Number(ethers.utils.formatUnits(collateralValueInLoanRaw, loanDecimals));
  const borrowUsd = Number(ethers.utils.formatUnits(position.borrowAssets, loanDecimals));
  const lltv = Number(ethers.utils.formatUnits(market.lltv, 18));

  let healthFactor = "999";
  let ltv = "0";
  let liquidationPrice = "0";

  if (borrowUsd > 0 && collateralUsd > 0 && lltv > 0) {
    const maxBorrowable = collateralUsd * lltv;
    healthFactor = (maxBorrowable / borrowUsd).toString();
    ltv = (borrowUsd / collateralUsd).toString();

    const collateralHuman = Number(ethers.utils.formatUnits(position.collateral, collateralDecimals));
    if (collateralHuman > 0) {
      liquidationPrice = ((borrowUsd / collateralHuman) / lltv).toString();
    }
  }

  const availableBorrowsUsd = Math.max(0, collateralUsd * lltv - borrowUsd).toString();

  return {
    collateralUsd: collateralUsd.toString(),
    borrowAssetsUsd: borrowUsd.toString(),
    healthFactor,
    ltv,
    availableBorrowsUsd,
    liquidationPrice,
  };
}
