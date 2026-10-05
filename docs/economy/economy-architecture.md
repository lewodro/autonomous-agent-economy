# Economy sidecar architecture

The existing V6 simulation remains unchanged. `rust/src/economy` owns an independent
match funding lifecycle. Rust validates authoritative results; the UI only projects
semantic events. The normal live table remains free. Opt-in funded matches use a durable Rust host
for admission, mock or pinned local backend custody, and completion attestation.

```mermaid
flowchart TD
 Request[Match request] --> Host[FundedHost / economy coordinator]
 Host --> Store[Append-only intent, receipt and host journals]
 Host --> Escrow[TrustedBackendEscrow]
 Escrow --> Rail[PaymentRail]
 Rail --> Mock[DurableMockRail]
 Rail --> Local[LocalPaymentRail / isolated Solana validator]
 Host --> Gate[Verified entries, exact pot, server deadline]
 Gate --> Engine[Authoritative Rust simulation]
 Engine --> Attestation[Signed completion / verified final hashes]
 Attestation --> Settlement[Canonical one-match payout or draw refund]
 Settlement --> Rail
 Rail --> Receipt[Verified receipt and durable settlement record]
 Receipt --> Store
 Host --> SSE[Existing HTTP / SSE economy projection]
 SSE --> HUD[Compact spectator pot HUD]
```

The local branch uses trusted backend test wallets and a separate fee sponsor.
It is not smart-contract escrow. Signed bytes/reference persist before broadcast;
reconciliation verifies known operations without creating transactions.

```mermaid
flowchart LR
  Agents --> Strategy
  Strategy --> Engine[Authoritative Rust engine]
  HTTP[HTTP model adapters] -->|bounded decisions| Engine
  Engine --> GameEvents[Game semantic events]
  GameEvents --> Transport[Node HTTP and SSE]
  Transport --> Browser[Browser projection]
  Browser --> Animation[AnimationDriver]
  Browser --> Renderer[Canvas renderer]
  Engine -->|verified finished tape| Coordinator[EconomyCoordinator]
  Coordinator --> EconomyEvents[EconomyEvent + public projection]
```

```mermaid
flowchart TD
  Match[Initial history + explicit instance] --> Binding[SimulationBinding / RunId]
  Binding --> Coordinator[EconomyCoordinator]
  Coordinator --> Escrow[MatchEscrow]
  Coordinator --> Rail[PaymentRail]
  Escrow -->|verify exact receipts / lock / payout / refund| Rail
  Rail --> Mock[DurableMockRail / TreasuryLedger]
  Rail --> Local[LocalPaymentRail: pinned validator]
  Coordinator --> Journal[Append-only host and rail journals]
  Rail --> Devnet[SolanaDevnetRail: read-only]
  Coordinator --> Events[Ordered economy events]
  Events --> View[TypeScript projection / lab]
  View --> Effects[EconomyAnimationDriver: cosmetic]
```

```mermaid
stateDiagram-v2
  [*] --> Unfunded
  Unfunded --> Funding
  Funding --> Funded
  Funded --> Locked
  Locked --> Running
  Running --> SettlementPending: verified winner
  SettlementPending --> Settled: verified payout
  Funding --> RefundPending: funding failure / cancellation
  Funded --> RefundPending: cancellation
  Locked --> RefundPending: before start only
  Running --> RefundPending: verified finished draw
  RefundPending --> Refunded
  Funding --> Failed: pre-lock failure
  Failed --> RefundPending: retained pre-lock phase
```

The diagram shows operational paths, not every enum edge. `lifecycle.rs` defines
structural transitions; `refund.rs` and `settlement.rs` additionally enforce authority.
An ambiguous payout remains `SettlementPending` and can only retry its original intent.

```mermaid
flowchart LR
  Identity[WalletIdentity: public address] --> Backend[SigningBackend port]
  Backend --> MockSigner[MockSigner: deterministic test Ed25519]
  MockSigner --> Artifact[Public signed artifact]
  Rail[PaymentRail port] --> Ledger[Mock ledger receipts]
  Rail --> RPC[Devnet balance read]
  Backend --> LocalSigner[LocalDevSigner: ignored backend test keys]
  LocalSigner --> Transaction[Two-signature native transfer and memo]
  Transaction --> Rail
```

The mock signing and payment ports remain independent. LocalPaymentRail uses
LocalDevSigner for persisted native signed transactions. The mock rail does
not pretend to submit signed Solana transactions. The separate `wallet-demo` remains
the existing native Solana wire demonstration.

| Concern | Module / authority |
|---|---|
| Amounts and identity | `primitives`: checked integer units, validated IDs, string JSON amounts |
| Configuration | `config`, `scenario`: exact decimal SOL strings, entry cap/reserve, mainnet rejection |
| Payments | `rail`, `durable_rail`, `local_rail`: exact intents, persisted signed bytes, verified receipts |
| Host / storage | `host`, `attestation`, `repository`, `recovery`: admission, signed completion, atomic journals |
| Escrow | `escrow`, `mock_escrow`: verified deposits, exact pot, lock, retry/refund accounting |
| Lifecycle | `coordinator`, `settlement`, `refund`: binding, funding, verified winner, explicit policy |
| Wallet boundary | `signing`, `mock_signer`: address-only identity, secret-free artifacts |
| Testnet boundary | `devnet`: fixed endpoint/genesis, bounded public keys, integer balance reads |
| Demonstrations | `demo`, `lab`: zero-paid-inference mock matches and public projections |
| Frontend | `economy.ts`, `economy-animation.ts`: parse/reduce events, optional cosmetic effects |

`RunId` remains stable throughout economy events. Game history IDs change with the
decision tape; the binding records the starting history and settlement records the
finished history. Explicit instance IDs distinguish two runs of the same configuration.
Events start at sequence **0**. Cross-run streams and missing sequence numbers fail;
clients fetch a complete snapshot rather than calculating replacement balances.

`replay::verify` proves rule consistency, not that an untrusted tape came from the
host. FundedHost implements trusted completion and durable journals, under test-only
backend custody. Production gaps are described
in [mainnet-readiness](../security/mainnet-readiness.md) and [threat model](../security/threat-model.md).

See [API](../architecture/api.md), [event schemas](../architecture/events.md), [recovery diagrams](./failure-recovery.md),
and [trust boundary diagram](../security/trust-boundaries.md).
