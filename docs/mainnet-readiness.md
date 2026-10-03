# Mainnet readiness — disabled

`PaymentMode::Mainnet` always returns `MainnetNotImplemented`. Funded matches support
durable mock payments and a **local-validator-only** native transfer rail. Public devnet
funded admission is unavailable; its standalone economy rail only reads balances.
The separate wallet demo retains its tiny test-transfer cap and is not funded escrow.
See the [2026 audit](crypto-audit-2026.md) for current implementation and evidence.

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

1. Run the implemented local rail against an isolated pinned validator; verify native
   signatures, fee sponsorship, exact deposit receipts and spend caps from chain data.
2. Exercise the durable intent/receipt journal and signed host completion across
   actual network submission/restart, ambiguous deposit, wrong winner, duplicate
   settlement and partial-refund recovery. Mock recovery tests already exist.
3. Fund fresh disposable validator wallets. Verify 2×0.05, 4×0.02, 4×0.05 and 8×0.02
   entries, exact pot, winner payout, fee accounting and refunds from chain data.
4. Repeat that controlled test on pinned devnet with fresh test wallets and bounded
   faucet funding. Keep public API admission disabled until its authorization exists.

Implemented prerequisites include funded host admission, local signing, a durable
JSON operation journal, host attestations, exact-pot bookkeeping and restart tests.
Production signer/custody, public funded rails, participant authorization and an
audited on-chain escrow are still absent. The actual local-chain test is ignored in
normal CI and needs a separately installed validator. Neither offline checks nor a
public devnet balance read establishes mainnet readiness.
