# Live architecture

## System

```mermaid
flowchart TD
 Browser[Browser: controls + spectator HUD] --> Transport[HTTP match transport]
 Transport --> Runtime[Node MatchRuntime: revision lock + inference budget]
 Runtime --> Worker[Persistent Rust NDJSON worker]
 Worker --> Core[Rust authoritative engine]
 Core --> Observation[Public observation]
 Observation --> Strategy[Rust mock strategies]
 Observation --> Models[Node model adapter registry]
 Models --> Compatible[OpenAI-compatible service]
 Models --> Custom[Custom HTTP service]
 Strategy --> Decision[Structured decision]
 Compatible --> Decision
 Custom --> Decision
 Decision --> Core
 Core --> Semantic[Ordered events + public projections]
 Semantic --> Transport
 Transport --> State[Presentation projection]
 State --> Renderer[GameRenderer]
 Renderer --> Animation[AnimationDriver]
 Runtime --> Storage[Verified JSON match files]
```

## Simulation flow

```mermaid
flowchart LR
 S[Authoritative state] --> O[Common public observation]
 O --> D[All living agents decide]
 D --> V[Validation + fallback]
 V --> R[Seeded initiative + resolution]
 R --> U[Upkeep / elimination / winner]
 U --> E[Semantic events + Rust projections]
 E --> P[Browser presentation state]
 P --> A[Animation commands]
 A --> C[Canvas driver]
 U --> S
```

## Crypto capability

```mermaid
flowchart TD
 Match[Verified completed match] --> Reward[Operator-invoked winner reward demo]
 Reward --> Policy[Approved recipient + spending cap]
 Policy --> Wallet[WalletCapability]
 Wallet --> Mock[MockWallet: signed local demo]
 Wallet --> Solana[SolanaWallet]
 Solana --> Local[Pinned local validator :8899]
 Solana --> Devnet[Fixed Solana devnet + genesis]
 Local --> Receipt[Simulation / submission / confirmation]
 Devnet --> Receipt
 Receipt --> Activity[Separate ordered wallet activity + match ID]
 Mock --> Activity
```

Wallet activity does not change credits, winner selection or seeded game history. No browser/API route can initiate a network transfer. The CLI verifies the supplied match before associating a reward with its winner. Confirmed/failed/requested transaction activity is a separate capability stream, preserving deterministic game history.

## Model adapters

```mermaid
flowchart LR
 Agent[Agent config] --> Registry[Adapter registry]
 Registry --> Mock[Rust mock policy]
 Registry --> HTTP[Custom HTTP adapter]
 Registry --> Chat[OpenAI-compatible chat adapter]
 Registry -. future .-> Other[Anthropic / other SDKs]
 HTTP --> Limits[Timeout / retries / bounded response]
 Chat --> Limits
 Budget[Server per-match + per-agent budget] --> Limits
 Limits --> Intent[Validated action / target / public reason]
 Mock --> Intent
 Intent --> Rust[Rust rule authorization]
```

A provider's explain method returns the public decision reason. It cannot read wallet keys or execute transactions. The server chooses the credential destination and environment variable; public configs cannot redirect secrets. Inference reservations count failed attempts and retries.

## Payment experiment

```mermaid
sequenceDiagram
 participant Agent
 participant Service
 participant Payment as Mock payment capability
 Agent->>Service: GET /premium-tool
 Service-->>Agent: HTTP 402 + nonce/price/resource/expiry
 Agent->>Payment: Pay quote with bounded mock credits
 Payment-->>Agent: Signed local settlement receipt
 Agent->>Service: GET + X-Demo-Payment receipt
 Service->>Payment: Verify receipt/resource/expiry
 Service-->>Agent: Tool result
```

This experiment is x402-inspired, not x402 wire compatible and not an on-chain payment. Repeated delivery is idempotent. An actual facilitator/settlement adapter is planned.
