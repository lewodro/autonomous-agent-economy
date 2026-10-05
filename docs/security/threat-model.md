# Economy threat model

Scope: mock sidecar, durable funded host, local-validator native payment rail,
read-only devnet adapter and loopback lab. The [2026 audit](./crypto-audit-2026.md)
records implemented controls and unresolved risks. This is a prototype boundary
review, not an independent custody audit. Game credits are unrelated
to payment units. The browser and custom agents are untrusted.

| Threat | Current control | Remaining production requirement |
|---|---|---|
| Double payout | Canonical operation ID; durable journal; escrow/coordinator retry guards | Validate actual-chain crash/expiry/reorg recovery |
| Fake funding | Escrow verifies exact recorded intent, account, amount, run and confirmed receipt | Independently verified chain receipt, finality and transaction ownership |
| Receipt replay | Run/purpose/payer/payee bound operation; mismatched intent rejected | Persistent spent-receipt index across instances/restarts |
| Frontend tampering | UI projects Rust events; lab accepts commands, never balances/receipts/winner | Authentication, authorization, per-match ownership and rate limits |
| Fake winner | Funded host signs verified version/configuration/participant-bound completion | Production authority isolation; rule-valid alternate decisions are NOT host authorization |
| Malicious agent | Adapters propose only four game actions; wallet/rail not exposed | Sandbox custom code; separate tool/payment capabilities and explicit limits |
| Bad RPC data | Fixed devnet endpoint and genesis; integer balance and slot validation | Independent RPC checks, finalized receipt verification and reorg policy |
| Secret leakage | Public identity separate from non-serializable signing backend; no keys in events | Production secret store, rotation and restricted signer service |
| Duplicate match | Economy ID includes initial configuration/version and explicit instance | Durable registry and admission transaction; mock reset intentionally discards history |
| Lost settlement response | Durable signed bytes before local network I/O; original signature lookup; refund/payee change blocked | Safe proven-expiry replacement and public-network finality recovery |
| Timeout / server failure | Typed errors; pre-lock failures have explicit refund policy | Persistent partial-refund recovery, deadlines, operator escalation |
| Invalid state / overflow | Checked integer amounts; validated lifecycle, reserves and cap | Fuzz/property tests; bounded persistent event storage |

Mock signatures are deterministic Ed25519 test artifacts. Their seed is public and
recoverable; they are not production credentials or native Solana transaction signatures.
Mock receipts prove an operation inside one ledger instance, not a blockchain transfer.
The lab is disabled unless `ECONOMY_LAB=1`; it has one ephemeral mock instance and
must not be exposed as a public funded service. Existing Host/Origin checks still apply.

An ambiguous payout remains pending. Do not replace it with a fresh operation,
change its recipient or automatically refund. Inspect/reconcile the existing operation.
