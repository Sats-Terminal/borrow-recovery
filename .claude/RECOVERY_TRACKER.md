# satsterminal Recovery UI Tracker

> Checklist-style tracker so we don’t lose progress after context clears.  
> Mark items `[x]` when done. Keep this file as the source of truth.

## Goal
If satsterminal ceases to exist (no DB, no Temporal, no paymaster), a user can:
1) Connect a wallet (MetaMask/Rainbow/etc) that holds their exported Privy **EOA** key.
2) Discover their per-loan ZeroDev **Kernel** smart accounts (by sequential index scan).
3) View loan positions on supported protocols.
4) Repay / withdraw collateral (user funds gas; no paymaster).

## Locked Decisions (v1)
- Runtime: **client-only Next.js** (no required backend, no DB).
- Chains: **Ethereum, Base, Arbitrum, BNB**.
- Smart account: **ZeroDev Kernel v3.3** (`KERNEL_V3_3`).
- EntryPoint: **v0.7** (`entryPoint07Address`).
- Indices: **sequential**; default scan **1..500**, user can “scan more” in +500.
- Submission: **Self-bundled `EntryPoint.handleOps`** by default + optional user-supplied bundler URL.
- Protocol scope (v1): **Aave v3 + Morpho Blue** (Morpho initially Base-only, configured markets).

## Safety Rules
- [x] NEVER ask users to paste a private key into the app.
- [x] No signing in any backend; all signing happens in the user’s wallet.
- [x] No persistent state required; optional `localStorage` only for UX (range/settings).

## Phase
- [ ] Planning
- [x] Implementing
- [ ] QA
- [ ] Release

---

## Milestones / Checklist

### M0 — Repo shape (keep this Next.js)
- [x] Remove Turborepo scaffolding (docs app, shared workspace packages, turbo scripts).
- [x] Keep a single Next.js app with optional Route Handlers (Next “native backend”).
- [x] Replace starter content (Turborepo logos/links) with recovery landing page.

### M1 — Project wiring
- [x] Add injected wallet connect UI + chain switch UX.
- [x] Optional: replace injected connect with RainbowKit/Wagmi (better multi-wallet UX).
  - [x] Requires deps: `npm i @rainbow-me/rainbowkit wagmi viem @tanstack/react-query`
  - [x] WalletConnect: set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (in `.env.local`)
- [x] Add deps: `viem`, `viem/account-abstraction`, `@zerodev/sdk`, `@zerodev/ecdsa-validator`.
- [x] Add chain config (chainIds + explorer links + native symbol).
- [x] Add token config per chain (USDC + BTC collateral token: WBTC/cbBTC/BTCB as applicable).
- [x] Add protocol address config per chain (Aave v3 pool, Morpho Blue address, markets).

### M2 — Loan wallet discovery (no DB)
- [x] Implement deterministic Kernel address derivation: `(EOA, index) -> kernelAddress`.
  - [x] `getKernelAddressFromECDSA`-compatible derivation (offline).
- [x] Implement scan engine: indices `start..end` (default 1..500) in batches + progress + cancel.
- [ ] Define “Active” signals (do NOT use tx-count):
  - [x] `getCode != 0x` (deployed) OR
  - [ ] relevant token balances > 0 OR
  - [ ] Aave position exists OR
  - [ ] Morpho position exists
- [x] UI: Scan Wizard (range + chains + progress, prompts to switch chain).
- [x] UI: Wallet list with index/address + per-chain status + filters/search.

### M3 — Positions (read-only)
- [ ] Aave v3 position reader (ETH/Base/Arb/BNB):
  - [x] user totals (collateral/debt/HF)
  - [ ] per-asset breakdown (at least for assets we support)
- [ ] Morpho Blue reader (Base, configured markets):
  - [x] collateral / borrow shares (and supply shares)
  - [x] derived borrow amount (requires market totals)
- [x] UI: Wallet detail page (positions + links).

### M4 — Rescue actions (no paymaster)
**Preflight UX (required before enabling Execute)**
- [ ] Show “Fund loan wallet with native gas token” requirement.
- [ ] Show “Repay token must be in loan wallet” requirement (EOA → loan wallet transfer).
- [ ] Show balances + best-effort gas estimate.

**Action building**
- [x] Aave repay call bundle (approve + repay).
- [x] Aave withdraw call (withdraw to EOA by default).
- [x] Morpho repay call bundle (approve + repay).
- [x] Morpho withdraw collateral (to EOA by default).

**UserOperation (EP 0.7)**
- [x] Build & sign UserOp using Kernel v3.3 in-browser.
- [ ] Submit Mode A (default): EOA sends tx to `EntryPoint.handleOps([userOp], beneficiary)`.
- [x] Submit Mode B (optional): user supplies bundler URL → `eth_sendUserOperation`.
- [ ] Error UX for AA failures:
  - [ ] prefund missing (loan wallet needs gas)
  - [ ] signature / nonce mismatch
  - [ ] inner call revert (protocol revert)

### M5 — Docs
- [ ] Threat model + safety warnings (no key pasting).
- [ ] User runbook:
  - [ ] export Privy key
  - [ ] import into MetaMask/Rainbow
  - [ ] scan + find wallet
  - [ ] fund loan wallet with gas
  - [ ] transfer repay tokens if needed
  - [ ] repay + withdraw
- [ ] Hosting docs (Vercel / static).

### M6 — QA / Release
- [ ] Add at least 1 real fixture: `(EOA, index -> kernelAddress)` from prod data (non-sensitive).
- [ ] Manual QA checklist:
  - [ ] No-loan user sees no active wallets.
  - [ ] Aave loan detected on at least one chain.
  - [ ] Self-bundled repay/withdraw works after prefunding.
  - [ ] Bundler mode works when provided.
- [ ] Tag `v1.0.0` + release notes.

---

## Work Log
- 2026-02-27: Tracker created; decisions locked (Kernel v3.3, EP 0.7, scan 1..500, client-only).
- 2026-02-27: Removed Turborepo scaffold; repo is now a single Next.js app.
- 2026-02-27: Added recovery landing page + injected wallet connect wiring.
- 2026-02-27: Implemented Kernel v3.3 address derivation + scan UI + wallet detail view + experimental Aave withdraw via bundler UserOp.
- 2026-02-27: Wired RainbowKit/Wagmi config with WalletConnect project ID env support and added `.env.example`.
- 2026-02-27: Switched Kernel v3.3 address derivation internals to ZeroDev SDK/validator constants and ABI flow.
- 2026-02-27: Replaced custom ABI/hash encoding helpers with `viem` + removed local hash/ABI vendor code.
- 2026-02-27: Added backend/temporal-parity Aave and Morpho helpers (onchain summary + tx builders) and wired Aave rescue to pool bundle tx logic.
- 2026-02-27: Added backend-parity Aave repay + Morpho repay/withdraw rescue flows; switched Kernel execute calldata encoding to ZeroDev SDK EP0.7 encoder for single/batched bundles.
