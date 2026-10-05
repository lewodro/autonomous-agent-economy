# Overnight economy architecture pass

Baseline: commit `040`, Rust rules V6. The live game remains authoritative and
separate from wallet funds. Existing HTTP host / SSE viewer transport, checkpoint
storage, model budgets, renderer and animation ports are retained.

## Inspection findings

| Boundary | Current state | Work in this pass |
|---|---|---|
| Game rules | Rust; versioned semantic projections | Preserve |
| Strategies / providers | Rust mocks, Node HTTP adapters | Public rationale and adapter contract checks |
| Wallet capability | Test wallet, fixed test networks, capped transfer | Public identity and signing ports |
| Payments | Local tool-payment demo; separate RPS economy | Add match economy without replacing either |
| Economy / escrow | No typed Last Seat pot coordinator | Deterministic mock funding, lock, settle and refund |
| UI | Presentation state and replaceable animation driver | Add economy types/projection/effects, no rules |
| Live transport | Host HTTP, read-only SSE with reconnect | Document economy sidecar boundary |
| Persistence | Verified game checkpoints + inference reservations | Keep economy in memory for this pass |

## Implementation sequence

1. Define integer amounts, stable run identifiers, lifecycle, configuration and events.
2. Implement checked mock treasury/payment/escrow contracts and transaction receipts.
3. Coordinate funding, verified match completion, idempotent settlement and refunds.
4. Separate identity/signing, add a read-only devnet rail foundation and mainnet rejection.
5. Add frontend economy projection/effect ports and a small isolated developer lab.
6. Add executable demos, contract/integration tests, diagrams and readiness/threat docs.

Each coherent change is committed after targeted validation. Full suites run at
phase boundaries. No custody, deployed escrow, mainnet or production payout claim.

## Critical invariants

- Game credits are never wallet balances.
- No frontend, provider response or caller-supplied winner authorizes payout.
- Funding receipts are matched to the run, payer, destination and exact amount.
- Escrow pot equals accepted deposits; terminal operations conserve mock funds.
- A repeated operation cannot debit or pay twice; conflicting retries fail.
- Failed funding may refund confirmed entries; ambiguous settlement never auto-refunds.
- Run identity is stable while a simulation's content-addressed history ID changes.
