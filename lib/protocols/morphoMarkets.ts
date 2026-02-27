import type { Hex } from "../eth/types";

export const MORPHO_BASE_MARKETS: { readonly cbBTC_USDC: { readonly marketId: Hex; readonly label: string } } =
  {
    cbBTC_USDC: {
      label: "cbBTC/USDC",
      marketId:
        "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836",
    },
  } as const;

