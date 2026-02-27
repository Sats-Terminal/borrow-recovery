import { decodeEntryPointGetNonce, encodeEntryPointGetNonce, ENTRYPOINT_V07_ADDRESS } from "@/lib/protocols/entryPoint";
import { parseHexQuantity, toHexQuantity } from "@/lib/eth/quantity";
import type { Address, Hex } from "@/lib/eth/types";
import { getUserOperationHashV07, type UserOperationV07 } from "@/lib/accountAbstraction/userOpHashV07";
import { ECDSA_VALIDATOR_ADDRESS } from "@/lib/kernel/deriveKernelAddress";
import { jsonRpcFetch } from "@/lib/rpc/jsonRpc";
import { concatHex, pad, toHex } from "viem";

const DUMMY_ECDSA_SIG: Hex =
  "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c";

type EstimateGasResult = {
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
};

type RpcRequest = (method: string, params?: unknown[] | object) => Promise<unknown>;
type UserOpGasPrice = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

const KERNEL_V07_NONCE_KEY_MODE_DEFAULT: Hex = "0x00";
const KERNEL_V07_NONCE_KEY_TYPE_SUDO: Hex = "0x00";
const MAX_KERNEL_NONCE_SUBKEY = 0xffffn;

const FALLBACK_CALL_GAS_LIMIT = 80_000n;
const FALLBACK_VERIFICATION_GAS_LIMIT = 250_000n;
const FALLBACK_PRE_VERIFICATION_GAS = 40_000n;

function parseGasPriceQuantity(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}: ${value}`);
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string") {
    if (value.startsWith("0x")) return parseHexQuantity(value, label);
    if (/^\d+$/.test(value)) return BigInt(value);
  }
  throw new Error(`Invalid ${label}: unsupported value`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseBundlerUserOpGasPrice(result: unknown): UserOpGasPrice {
  if (!isRecord(result)) throw new Error("Bundler gas price response is not an object.");

  const pick = (...paths: string[]): unknown => {
    for (const path of paths) {
      const [head, tail] = path.split(".");
      const headValue = result[head];
      if (tail && isRecord(headValue) && tail in headValue) return headValue[tail];
      if (!tail && head in result) return headValue;
    }
    return undefined;
  };

  const tier = ["standard", "fast", "slow"]
    .map((name) => result[name])
    .find((candidate) => isRecord(candidate)) as Record<string, unknown> | undefined;

  const maxFeeRaw = tier?.maxFeePerGas ?? pick(
    "standard.maxFeePerGas",
    "fast.maxFeePerGas",
    "slow.maxFeePerGas",
    "maxFeePerGas",
  );
  const maxPriorityRaw = tier?.maxPriorityFeePerGas ?? pick(
    "standard.maxPriorityFeePerGas",
    "fast.maxPriorityFeePerGas",
    "slow.maxPriorityFeePerGas",
    "maxPriorityFeePerGas",
  );

  if (maxFeeRaw === undefined || maxPriorityRaw === undefined) {
    throw new Error("Bundler gas price response is missing maxFeePerGas/maxPriorityFeePerGas.");
  }

  let maxFeePerGas = parseGasPriceQuantity(maxFeeRaw, "bundler.maxFeePerGas");
  const maxPriorityFeePerGas = parseGasPriceQuantity(maxPriorityRaw, "bundler.maxPriorityFeePerGas");
  if (maxFeePerGas < maxPriorityFeePerGas) maxFeePerGas = maxPriorityFeePerGas;

  return {
    maxFeePerGas: (maxFeePerGas * 110n) / 100n,
    maxPriorityFeePerGas: (maxPriorityFeePerGas * 110n) / 100n,
  };
}

async function getBundlerUserOpGasPrice(bundlerUrl: string): Promise<UserOpGasPrice | null> {
  try {
    const response = await jsonRpcFetch<unknown>(bundlerUrl, "zd_getUserOperationGasPrice", []);
    return parseBundlerUserOpGasPrice(response);
  } catch {
    try {
      const response = await jsonRpcFetch<unknown>(bundlerUrl, "pimlico_getUserOperationGasPrice", []);
      return parseBundlerUserOpGasPrice(response);
    } catch {
      return null;
    }
  }
}

function extractMinRequiredMaxFeePerGas(error: unknown): bigint | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/maxFeePerGas must be at least (\d+)/i);
  if (!match) return null;
  try {
    return BigInt(match[1]);
  } catch {
    return null;
  }
}

function extractErrorCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function isUserRejectedError(error: unknown): boolean {
  const code = extractErrorCode(error);
  if (code === 4001) return true;
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("user rejected") || msg.includes("user denied") || msg.includes("rejected request");
}

function isSignatureMethodCompatibilityError(error: unknown): boolean {
  const code = extractErrorCode(error);
  if (code === -32601 || code === -32602) return true;
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes("method not found") || msg.includes("unsupported") || msg.includes("invalid params");
}

function isInvalidAccountNonceError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("aa25") || message.includes("invalid account nonce") || message.includes("i account nonce");
}

function encodeKernelV07NonceKey(validatorAddress: Address, nonceSubKey: bigint = 0n): bigint {
  if (nonceSubKey < 0n || nonceSubKey > MAX_KERNEL_NONCE_SUBKEY) {
    throw new Error("Kernel nonce sub-key must fit in uint16 for EntryPoint v0.7.");
  }
  const encoded = pad(
    concatHex([
      KERNEL_V07_NONCE_KEY_MODE_DEFAULT,
      KERNEL_V07_NONCE_KEY_TYPE_SUDO,
      validatorAddress,
      toHex(nonceSubKey, { size: 2 }),
    ]),
    { size: 24 },
  );
  return BigInt(encoded);
}

async function readKernelNonce(parameters: {
  chainRpcUrl: string;
  request: RpcRequest;
  kernelAddress: Address;
  nonceKey: bigint;
}): Promise<bigint> {
  const { chainRpcUrl, request, kernelAddress, nonceKey } = parameters;
  const data = encodeEntryPointGetNonce({ sender: kernelAddress, key: nonceKey });
  const targets = ["latest", "pending"] as const;
  const observed: bigint[] = [];

  for (const blockTag of targets) {
    try {
      const res = await jsonRpcFetch<Hex>(chainRpcUrl, "eth_call", [
        { to: ENTRYPOINT_V07_ADDRESS, data },
        blockTag,
      ]);
      observed.push(decodeEntryPointGetNonce(res));
    } catch {
      // ignore and fall through to other providers/tags
    }
  }

  if (observed.length === 0) {
    const res = (await request("eth_call", [
      { to: ENTRYPOINT_V07_ADDRESS, data },
      "latest",
    ])) as Hex;
    observed.push(decodeEntryPointGetNonce(res));
  }

  return observed.reduce((max, value) => (value > max ? value : max), observed[0]);
}

async function signUserOperationHash(parameters: {
  request: RpcRequest;
  owner: Address;
  userOpHash: Hex;
}): Promise<Hex> {
  const { request, owner, userOpHash } = parameters;
  const signingAttempts: Array<{ method: string; params: [Hex, Address] | [Address, Hex] }> = [
    { method: "personal_sign", params: [userOpHash, owner] },
    { method: "personal_sign", params: [owner, userOpHash] },
    { method: "eth_sign", params: [owner, userOpHash] },
  ];

  let lastError: unknown;
  for (const attempt of signingAttempts) {
    try {
      return (await request(attempt.method, attempt.params)) as Hex;
    } catch (error) {
      if (isUserRejectedError(error)) throw error;
      lastError = error;
      if (!isSignatureMethodCompatibilityError(error)) throw error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("Failed to sign UserOperation hash.");
}

export async function submitKernelUserOperationV07(parameters: {
  bundlerUrl: string;
  chainRpcUrl: string;
  owner: Address;
  kernelAddress: Address;
  chainId: number;
  kernelCallData: Hex;
  request: RpcRequest;
  onStatus?: ((status: string) => void) | undefined;
}): Promise<Hex> {
  const { bundlerUrl, chainRpcUrl, owner, kernelAddress, chainId, kernelCallData, request, onStatus } = parameters;

  onStatus?.("Checking loan wallet deployment…");
  const kernelCode = (await request("eth_getCode", [kernelAddress, "latest"])) as Hex;
  if (kernelCode === "0x") {
    throw new Error("Kernel wallet is not deployed on this chain.");
  }

  onStatus?.("Reading Kernel nonce…");
  const kernelNonceKey = encodeKernelV07NonceKey(ECDSA_VALIDATOR_ADDRESS);
  let nonce = await readKernelNonce({
    chainRpcUrl,
    request,
    kernelAddress,
    nonceKey: kernelNonceKey,
  });

  onStatus?.("Reading UserOperation gas price…");
  const bundlerGas = await getBundlerUserOpGasPrice(bundlerUrl);

  let maxFeePerGas: bigint;
  let maxPriorityFeePerGas: bigint;
  if (bundlerGas) {
    maxFeePerGas = bundlerGas.maxFeePerGas;
    maxPriorityFeePerGas = bundlerGas.maxPriorityFeePerGas;
  } else {
    // Fallback to chain RPC when bundler quote methods are unavailable.
    const gasPriceHex = await jsonRpcFetch<Hex>(chainRpcUrl, "eth_gasPrice");
    maxFeePerGas = parseHexQuantity(gasPriceHex, "gasPrice");
    maxPriorityFeePerGas = 0n;
    try {
      const tipHex = await jsonRpcFetch<Hex>(chainRpcUrl, "eth_maxPriorityFeePerGas");
      maxPriorityFeePerGas = parseHexQuantity(tipHex, "maxPriorityFeePerGas");
    } catch {
      maxPriorityFeePerGas = maxFeePerGas;
    }
    if (maxFeePerGas < maxPriorityFeePerGas) maxFeePerGas = maxPriorityFeePerGas;
    // Add 20% buffer to gas price to handle price increases between estimation and inclusion.
    maxFeePerGas = (maxFeePerGas * 120n) / 100n;
  }

  const buildOpBase = (nonceValue: bigint): UserOperationV07 => ({
    sender: kernelAddress,
    nonce: nonceValue,
    callData: kernelCallData,
    callGasLimit: 0n,
    verificationGasLimit: 0n,
    preVerificationGas: 0n,
    maxFeePerGas,
    maxPriorityFeePerGas,
    signature: DUMMY_ECDSA_SIG,
  });
  const toRpcOp = (op: UserOperationV07) => ({
    sender: op.sender,
    nonce: toHexQuantity(op.nonce),
    callData: op.callData,
    callGasLimit: toHexQuantity(op.callGasLimit),
    verificationGasLimit: toHexQuantity(op.verificationGasLimit),
    preVerificationGas: toHexQuantity(op.preVerificationGas),
    maxFeePerGas: toHexQuantity(op.maxFeePerGas),
    maxPriorityFeePerGas: toHexQuantity(op.maxPriorityFeePerGas),
    signature: op.signature,
  });

  let opBase = buildOpBase(nonce);
  let opBaseRpc = toRpcOp(opBase);

  onStatus?.("Estimating UserOperation gas…");
  let estimate: EstimateGasResult;
  try {
    estimate = await jsonRpcFetch<EstimateGasResult>(bundlerUrl, "eth_estimateUserOperationGas", [
      opBaseRpc,
      ENTRYPOINT_V07_ADDRESS,
    ]);
  } catch (error) {
    if (!isInvalidAccountNonceError(error)) throw error;

    onStatus?.("Refreshing nonce and retrying estimate…");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    nonce = await readKernelNonce({
      chainRpcUrl,
      request,
      kernelAddress,
      nonceKey: kernelNonceKey,
    });
    opBase = buildOpBase(nonce);
    opBaseRpc = toRpcOp(opBase);
    estimate = await jsonRpcFetch<EstimateGasResult>(bundlerUrl, "eth_estimateUserOperationGas", [
      opBaseRpc,
      ENTRYPOINT_V07_ADDRESS,
    ]);
  }

  // Add 50% buffer to gas limits — bundler estimates can be tight, and state
  // may change between estimation and submission (interest accrual, gas price shifts).
  const addBuffer = (value: bigint): bigint => (value * 150n) / 100n;

  const rawCallGas = parseHexQuantity(estimate.callGasLimit, "callGasLimit");
  const rawVerificationGas = parseHexQuantity(estimate.verificationGasLimit, "verificationGasLimit");
  const rawPreVerificationGas = parseHexQuantity(estimate.preVerificationGas, "preVerificationGas");

  onStatus?.(`Gas estimates: call=${rawCallGas} verification=${rawVerificationGas} preVerification=${rawPreVerificationGas}`);

  const bufferedCallGas = addBuffer(rawCallGas);
  const bufferedVerificationGas = addBuffer(rawVerificationGas);
  const bufferedPreVerificationGas = addBuffer(rawPreVerificationGas);

  const callGasLimit = bufferedCallGas > 0n ? bufferedCallGas : FALLBACK_CALL_GAS_LIMIT;
  const verificationGasLimit = bufferedVerificationGas > 0n
    ? bufferedVerificationGas
    : FALLBACK_VERIFICATION_GAS_LIMIT;
  const preVerificationGas = bufferedPreVerificationGas > 0n
    ? bufferedPreVerificationGas
    : FALLBACK_PRE_VERIFICATION_GAS;

  const opFinal: UserOperationV07 = {
    ...opBase,
    callGasLimit,
    verificationGasLimit,
    preVerificationGas,
  };

  const userOpHash = getUserOperationHashV07({
    userOperation: { ...opFinal, signature: "0x" },
    entryPointAddress: ENTRYPOINT_V07_ADDRESS,
    chainId,
  });

  onStatus?.("Signing UserOperation hash…");
  const signature = await signUserOperationHash({ request, owner, userOpHash });

  const opFinalRpc = {
    sender: opFinal.sender,
    nonce: toHexQuantity(opFinal.nonce),
    callData: opFinal.callData,
    callGasLimit: toHexQuantity(opFinal.callGasLimit),
    verificationGasLimit: toHexQuantity(opFinal.verificationGasLimit),
    preVerificationGas: toHexQuantity(opFinal.preVerificationGas),
    maxFeePerGas: toHexQuantity(opFinal.maxFeePerGas),
    maxPriorityFeePerGas: toHexQuantity(opFinal.maxPriorityFeePerGas),
    signature,
  };

  onStatus?.("Sending UserOperation…");
  try {
    return await jsonRpcFetch<Hex>(bundlerUrl, "eth_sendUserOperation", [
      opFinalRpc,
      ENTRYPOINT_V07_ADDRESS,
    ]);
  } catch (sendError) {
    const minRequiredMaxFeePerGas = extractMinRequiredMaxFeePerGas(sendError);
    if (minRequiredMaxFeePerGas !== null) {
      const bumpedMaxFeePerGas = (minRequiredMaxFeePerGas * 110n) / 100n;
      const bumpedMaxPriorityFeePerGas = opFinal.maxPriorityFeePerGas > bumpedMaxFeePerGas
        ? bumpedMaxFeePerGas
        : opFinal.maxPriorityFeePerGas;
      const retryRpc = {
        ...opFinalRpc,
        maxFeePerGas: toHexQuantity(bumpedMaxFeePerGas),
        maxPriorityFeePerGas: toHexQuantity(bumpedMaxPriorityFeePerGas),
      };
      onStatus?.("Retrying with higher gas price…");
      return await jsonRpcFetch<Hex>(bundlerUrl, "eth_sendUserOperation", [
        retryRpc,
        ENTRYPOINT_V07_ADDRESS,
      ]);
    }

    throw sendError;
  }
}
