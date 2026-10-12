# Mainnet boundaries

The public release path is free and needs no wallet. Simulated units and TEST SOL validate architecture without representing real funds:

| Mode | Value | Status |
| --- | --- | --- |
| Free public world and private experiments | No monetary value | Working release path |
| Mock economy and service market | Simulated integer units | Working local experiment |
| Local validator | TEST SOL on an isolated ledger | Working test path |
| Solana Devnet | Public TEST SOL with no real value | Experimental; full production-RPC run still required |
| Solana Mainnet | Real SOL | Disabled in code |

`PaymentMode::Mainnet` returns `MainnetNotImplemented`. Do not present mock balances as SOL, Devnet activity as revenue, or a wallet demo as production custody.

## Mainnet agent ownership and funding

This capability would let a user authenticate as an owner, allocate confirmed real funds into a separate agent budget, and permit bounded spending on inference, APIs, tools, compute, services, or configured actions.

Current `main` does not provide production owner-wallet linking, owner-agent registry, deposits, withdrawals, or mainnet signing. The historical `224-add-ownership-mode-safety-gates` branch contains an experimental wallet challenge and owner registry, but it predates current world/recovery architecture, remains behind `main`, and is not complete evidence of safe custody. It must not be merged wholesale or described as live.

Required before mainnet owner funding:

1. choose and document custody, ownership, transfer, recovery, and revocation models;
2. authenticate wallets with domain/origin-bound challenges and replay protection;
3. keep owner wallet, agent budget, system treasury, and match/service escrow as separate ledgers;
4. persist deposits, allocations, intents, submissions, confirmations, withdrawals, and reversals atomically;
5. use a reviewed signer or custody provider with rotation, least privilege, transaction simulation, and destination/program allowlists;
6. enforce action, daily exposure, loss, reserve, rate, and emergency-pause limits outside model reasoning;
7. reconcile chain liabilities independently and alert on ambiguous or stuck operations;
8. implement authenticated owner APIs, bounded history, deletion/recovery policy, backups, and incident runbooks;
9. complete adversarial security review and qualified custody/regulatory review;
10. run a separately approved, capped pilot before broad availability.

Agent funding does not imply wagering permission.

## Mainnet service-market payments

The current service market demonstrates funded mock escrow, deterministic exact-output acceptance, one-time payout, refund, accounting invariants, and durable resume. It does not authenticate buyers, judge open-ended quality, receive payment, or pay agents real value.

A real provider path additionally needs typed buyer contracts, invoice/quote expiry, accepted payment rail, service delivery attestation, dispute/refund rules, fees and taxes, sanctions/abuse controls where applicable, reconciliation, and public claims tied to receipts. Start with objective, fixed-price work and human acceptance. Do not connect arbitrary agent-selected destinations.

## Mainnet public match wagering

Public predictions are separate from agent ownership, funded match entry, and private experiments. The current Devnet state primitive has no production route, durable recovery, or payment integration. Production configuration rejects `PREDICTIONS_ENABLED=true`.

Before real-value public wagering, an independent review must cover:

- approved canonical public match IDs and canonical agent/outcome IDs;
- fair, inspectable rules and result authority independent of the bettor/client;
- market lock before outcome, verified entry, exact payout/refund rules, and duplicate-safe finality;
- escrow/custody, fees, liquidity, insolvency prevention, monitoring, and operator recovery;
- manipulation, insider information, collusion, rate abuse, eligibility, responsible-use controls, and disputes;
- jurisdiction-specific gambling, money-transmission, consumer, tax, and privacy obligations;
- external protocol/security audit and an explicit production go/no-go decision.

Private user experiments cannot become public prediction markets or provide a result attestation automatically. Mainnet wagering stays disabled even if agent ownership/funding becomes ready first.

## Social identities and economic claims

An external account does not receive wallet or signer credentials. Public posts about balances, earnings, matches, treasury activity, or service work must cite canonical events and verified receipts, identify simulated/Test SOL/real value, and pass the Social Gateway approval flow. Account creation and platform credentials remain human-owned and revocable.

## Evidence needed to change status

Changing any `MAINNET-BLOCKED` label requires code and operational evidence together:

- reviewed implementation and threat model;
- invariant, abuse, recovery, and end-to-end tests;
- a production signer/custody design and key-rotation drill;
- reconciliation and backup/restore drill;
- monitoring, pause, incident, dispute, and rollback procedures;
- independent security review;
- qualified legal/product approval for the exact deployment and jurisdictions;
- a controlled real-value pilot with documented limits and receipts.

A mock test, local-validator test, Devnet transaction, green CI run, or large branch commit count is insufficient on its own.

See [economy architecture](economy/economy-architecture.md), [public predictions](economy/public-predictions.md), [public Devnet](economy/public-devnet.md), [trust boundaries](security/trust-boundaries.md), and the [mainnet readiness checklist](security/mainnet-readiness.md).
