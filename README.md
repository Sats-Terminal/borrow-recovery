# satsterminal Recovery

Recovery UI for discovering and operating EVM ZeroDev Kernel loan wallets if satsterminal ceases to exist or the hosted service is unavailable.

Scope: EVM loans only. Solana loans are not supported.

This app is frontend-only:
- No backend signer
- No database
- No paymaster abstraction
- All signatures happen in your connected wallet

## What It Does

- Scans deterministic Kernel wallet indices for your EOA across supported chains
- Shows wallet balances and onchain loan health data
- Executes rescue actions through ERC-4337 UserOperations (EntryPoint v0.7)

## Supported

- Scope: EVM loans only (no Solana support)
- Smart account: ZeroDev Kernel v3.3
- Chains: Ethereum (`1`), Base (`8453`), Arbitrum (`42161`), BNB Chain (`56`)
- Protocol reads:
  - Aave v3 (all supported chains)
  - Morpho Blue (Base, `cbBTC/USDC` market)
- Rescue actions:
  - Aave: repay / withdraw
  - Morpho Blue (Base): repay / withdraw
  - Transfer out collateral token balance to connected wallet

## Safety Notes

- Never paste or type private keys into this app.
- Fund the loan wallet with native gas token before rescue actions.
- Fund the loan wallet with required repay token before repay actions.
- Validate addresses, chain, and amounts before signing.

## Quick Start

### Prerequisites

- Node.js 20+
- EIP-1193 wallet (MetaMask, Rabby, etc.)
- Optional: WalletConnect Project ID (for WalletConnect support)

### Install

```bash
npm install
cp .env.example .env.local
```

If using WalletConnect, set:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
```

### Run

```bash
npm run dev
```

Open `http://localhost:3000`.

## Usage

1. Connect your wallet.
2. Go to `/scan` and scan index ranges to find deployed Kernel wallets.
3. Open `/wallet/12` (replace `12` with your index) for a specific loan wallet.
4. Click **Load positions** to fetch balances and protocol data.
5. Enter a ZeroDev Project ID or bundler RPC URL in the wallet page.
6. Run rescue actions (repay/withdraw/transfer out) after funding gas and repay assets as needed.

## Bundler Input

The wallet page accepts either:
- ZeroDev project ID, or
- Full URL like `https://rpc.zerodev.app/api/v3/<project-id>/chain/<chain-id>`

The app derives the chain-specific bundler URL automatically.

## Project Layout

- `app/`: Next.js routes and UI
- `lib/kernel/`: deterministic Kernel address derivation
- `lib/accountAbstraction/`: UserOperation construction and submission
- `lib/protocols/`: Aave, Morpho, ERC-20, Kernel calldata helpers
- `lib/chains.ts`, `lib/assets.ts`: chain and token configuration

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Disclaimer

This software is provided as-is, without warranties. You are responsible for validating transactions and operational safety before signing.

## License

MIT
