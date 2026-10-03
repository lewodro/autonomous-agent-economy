# Mainnet readiness — disabled

`PaymentMode::Mainnet` always returns `MainnetNotImplemented`. The economy sidecar
submits no Solana entry, refund or payout transactions. Its devnet rail only reads
balances. The separate existing wallet demo retains its tiny-transfer cap; raising
that cap is not a funded-match implementation.

| Area | Required before any real funded service |
|---|---|
| Custody | Decide who controls escrow and which actors can move funds; document trust and loss boundaries |
| Escrow | Specify/audit on-chain escrow or tightly scoped test custody; freeze deposits and payout authorization |
| Key management | Separate production signer from identity; secret storage, rotation, least privilege, backups |
| Durable accounting | Persist intent before submit, receipts, deposits, state and instance IDs atomically |
| Settlement | Trusted host result attestation, chain receipt reconciliation, exact pot conservation, crash recovery |
| Refund rules | Publish funding deadline, cancellation window, draws, fees, partial refunds and ambiguous outcomes |
| RPC | Pinned cluster/genesis, timeouts, independent verification, confirmation/finality and reorg behavior |
| Security audit | Review escrow, signer, API access, replay authorization, idempotency and adversarial tests |
| Monitoring | Reconcile escrow liabilities, alert on stuck operations, provide pause and operator recovery |
| Product/legal questions | Obtain qualified review of custody, entry/reward rules, jurisdiction and user obligations before launch |

## Exact next step for 0.02–0.05 SOL test matches

1. Implement a **local-validator-only** payment rail and escrow adapter with explicit
   fee reserve, native transaction signer, deposit receipt verification and spend caps.
2. Persist operation intents/receipts and bind settlement to the authoritative host's
   signed completion. Test restart between submission and receipt recording, fake
   deposit, wrong winner, duplicate settlement and partial-refund recovery.
3. Fund fresh disposable validator wallets. Verify 2×0.05, 4×0.02, 4×0.05 and 8×0.02
   entries, exact pot, winner payout, fee accounting and refunds from chain data.
4. Repeat that controlled test on pinned devnet with fresh test wallets and bounded
   faucet funding. Keep public API admission disabled until its authorization exists.

Current prerequisites: a local validator is separately installed; funded adapters,
production signer, durable economy store and host attestation are absent. Public devnet
balance reading was verified on 2026-10-03. Faucet reliability still limits the separate
wallet transfer demo. None of these observations establish mainnet readiness.
