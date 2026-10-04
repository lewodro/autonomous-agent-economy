# Public Solana Devnet funded matches

This is an **experimental test-SOL path**. Solana Devnet is public and its transactions can be inspected on Solscan, but Devnet SOL has no monetary value and the cluster may reset. Mainnet is rejected by the code. The custody model is a trusted backend prototype: agent and escrow signing keys stay on the server volume and never reach the browser or model prompts.

## What is implemented

1. Creating a Devnet funded match generates durable keypairs for every agent, the match escrow and a fee sponsor.
2. The public API returns addresses, integer lamport balances and Devnet Solscan links; it never returns key bytes.
3. A person sends the selected test-SOL entry amount to each agent address. The operator funds the fee-sponsor address separately for network fees.
4. The host clicks **Verify agent**. The backend rechecks the agent balance, constructs a restricted native SOL transfer to the recorded escrow, adds the match operation ID as a memo, signs server-side, submits, confirms and parses the transaction.
5. The game starts only after all entries are confirmed and the escrow balance equals the expected pot.
6. The Rust engine determines the winner. A trusted-host completion attestation authorizes one payout from escrow to that winner. Persistent operation records prevent a second payout after a restart.

The fee sponsor pays transaction fees outside the pot, so a displayed `0.08 SOL` pot can pay `0.08 SOL`. No house fee is charged. Refunds use the same recorded transaction and recovery machinery.

## Deployment variables

Start with the free production deployment in [deployment.md](deployment.md), then add:

```text
ENTRY_FEE_ENABLED=true
ECONOMY_MODE=DEVNET
PUBLIC_DEVNET_ACK=I_UNDERSTAND_TEST_SOL_ONLY
SOLANA_DEVNET_RPC_URL=https://your-dedicated-devnet-rpc.example
```

Use a dedicated Devnet RPC from an operator you trust. The app checks the returned genesis hash against Solana Devnet before generating or moving funds. Keep `MATCHES_DIR` on a persistent volume: it contains the encrypted-at-rest responsibility of your hosting provider, but the current files themselves are raw development key seeds with owner-only filesystem permissions. Back up the volume securely. Do not copy it into Git or logs.

After redeploy, `/api/capabilities` must report `funded_modes: ["devnet"]` and `/api/health` must report `payments: "devnet_test_sol"`. The New/Remix dialog then offers **Solana Devnet · public test SOL**. Create a match, open each agent's Solscan link, send the exact entry amount, fund the fee sponsor with enough test SOL for entries/refunds/payout, and use each **Verify** button. Public spectators can see addresses and transaction links; only the signed host browser can change funding or settlement.

## Operator wallet setup check

From a built checkout, this read-only setup command verifies the configured Devnet genesis, creates durable test wallets and prints only public data:

```bash
PUBLIC_DEVNET_ACK=I_UNDERSTAND_TEST_SOL_ONLY \
ECONOMY_DIR=/absolute/durable/economy \
SOLANA_DEVNET_RPC_URL=https://your-dedicated-devnet-rpc.example \
npm run demo:devnet-wallets
```

Addresses link to `https://solscan.io/account/<address>?cluster=devnet`; confirmed operation signatures link to the corresponding Devnet transaction page.

## Current verification status

On 2026-10-04, the live official Devnet endpoint returned the expected genesis and the command created four agent addresses, escrow and fee sponsor, then read all six zero balances. The official RPC faucet returned `-32603 Internal error` for the first 0.02 test-SOL request, so an end-to-end public Devnet entry/payout was **not** claimed. The identical restricted transaction, confirmation, exact-pot, payout/refund and crash-recovery path is proven against an isolated local validator. Before announcing a public funded event, supply test SOL from a working faucet/operator account and run one complete match plus cancellation/restart checks against the exact production RPC.

## Do not use this for mainnet

Mainnet mode fails closed. Before real-value funds, replace raw host keys with a reviewed signer/custody system, add user authentication and abuse controls, use independent RPC verification, define operational payout/refund handling, obtain a security audit and complete the items in [mainnet readiness](mainnet-readiness.md). A successful Devnet demo does not prove those controls.
