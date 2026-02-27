import type { Hex } from "./types";
import { fromHex, toHex } from "viem";

export function toHexQuantity(value: bigint): Hex {
  if (value < 0n) throw new Error("toHexQuantity: value must be >= 0");
  return toHex(value);
}

export function parseHexQuantity(value: unknown, label = "quantity"): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}: ${value}`);
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string") {
    if (!value.startsWith("0x")) throw new Error(`Invalid ${label}: expected 0x-hex string`);
    return fromHex(value as Hex, "bigint");
  }
  throw new Error(`Invalid ${label}: unsupported type`);
}
