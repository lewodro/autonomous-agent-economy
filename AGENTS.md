# AGENTS.md

## Purpose

This file provides instructions for AI coding agents working in this repository.

The project is an **autonomous agent economy framework**. Its first application is a competitive environment where approximately 20 persistent AI agents can receive bounded funding, evaluate opportunities, pay verifiable entry fees, play simple games, receive settlements, learn from results, and continue operating.

Games are the MVP, not the final product. Preserve the architecture so the same primitives can later support agent-to-agent services, APIs, compute, data, tasks, tournaments, and other economic activity.

## Core Objective

Build the smallest reliable system that demonstrates:

**DISCOVER → EVALUATE → TRANSACT → EXECUTE → VERIFY → SETTLE → LEARN**

Agents should have persistent identity, capital, strategy, memory, permissions, reputation, and communication capabilities.

## Economic Model

- Initial target game stake: **0.03 SOL per participating agent**.
- The stake must be configurable; do not hard-code 0.03 SOL as a permanent maximum or universal amount.
- The architecture should support increasing stakes as agent funding grows.
- The planned Agent Treasury may receive **30% of designated creator-fee revenue from the associated token/ecosystem**.
- Never assume treasury revenue exists. Only confirmed funds may be allocated or spent.
- Keep network fees, game stakes, and protocol/game fees as separate accounting concepts.

## Agent Model

The initial system should support roughly 20 agents with separate persistent state.

Each agent may have:

- unique ID
- display name
- wallet/public address
- bankroll
- strategy profile
- personality/social profile
- risk parameters
- memory
- game history
- opponent history
- wins/losses/draws
- P&L
- ROI
- drawdown
- reputation/statistics

Agents should begin with different strategic priors but must not be reduced to scripted characters. Design state and interfaces so strategies can adapt from observed results.

## Orchestration

Prefer an **event-driven orchestrator** over 20 continuously running LLM processes.

Agents should wake when they have a meaningful decision to make.

Important event types may include:

```text
FUNDS_RECEIVED
GAME_AVAILABLE
CHALLENGE_RECEIVED
TOURNAMENT_OPENED
PAYMENT_CONFIRMED
ACTION_REQUIRED
GAME_FINISHED
PAYOUT_RECEIVED
TREASURY_UPDATED
SOCIAL_EVENT
```

Keep orchestration, game logic, wallet enforcement, storage, and social publishing modular.

## Critical Architecture Rule

**LLMs propose actions. Deterministic systems authorize and execute economic actions.**

Never let model output directly become an unrestricted blockchain transaction.

Preferred flow:

```text
Agent reasoning
    ↓
Structured intent
    ↓
Policy validation
    ↓
Wallet/signing service
    ↓
Blockchain / settlement layer
```

Example structured intent:

```text
ENTER_GAME(game_8392, 0.05 SOL)
```

## Wallet and Secret Safety

Never:

- put private keys or seed phrases in prompts
- log private keys
- return private keys through APIs
- commit secrets to the repository
- give an LLM unrestricted signing authority
- let agent-generated arbitrary destinations bypass policy checks

The wallet/signing service must remain separate from model reasoning.

Support configurable controls such as:

- maximum transaction/game size
- maximum bankroll exposure
- minimum reserve balance
- approved programs/contracts/destinations
- maximum loss limits
- emergency pause
- transaction logging
- transaction simulation where available

## Games

Start with **Rock Paper Scissors**.

RPS should use commit-reveal or an equivalent cryptographic mechanism so one agent cannot select its move after observing the other agent's move.

Additional games may include blackjack-style games, probability games, card games, simple strategy games, and tournaments.

For chance-based games:

- document the exact rules
- make probabilities/rules inspectable
- use appropriate verifiable randomness
- do not allow either agent or the game server to secretly control random outcomes
- do not misrepresent random outcomes as deterministic skill

## Settlement and Verification

The system should independently verify facts whenever possible.

```text
payments       → blockchain
balances       → blockchain/accounting layer
game entries   → escrow/state
moves          → commitments/proofs where appropriate
randomness     → verifiable randomness
results        → deterministic game engine
payouts        → settlement records/blockchain
statistics     → indexed game history
treasury funds → confirmed accounting/transactions
```

Do not rely on an agent saying that it won, paid, or received funds.

## Bankroll and Competition

Agents may reason about probability, expected value, variance, opponent tendencies, bankroll, and risk.

Economic limits must exist outside the LLM and cannot be overridden by prompting.

Do not implement strategies that automatically chase losses or bypass configured loss/exposure limits.

Keep performance metrics separately observable. At minimum prefer:

- bankroll
- realized P&L
- ROI
- drawdown
- win rate
- games played
- average stake
- performance by game
- tournament performance
- opponent history

Do not define "best agent" solely as the agent that takes the largest risks.

## Social Layer

Agents may eventually maintain social identities and generate posts based on real ecosystem activity.

Use a centralized Social Gateway for credentials, rate limits, permissions, duplicate prevention, and publishing.

Never fabricate:

- transactions
- games
- opponents
- balances
- winnings
- statistics
- treasury activity

Public economic claims must be derived from actual recorded events.

## Development Priorities

Unless the repository has progressed beyond these stages, prefer work in this order:

1. simulated balances
2. deterministic RPS
3. two-agent autonomous loop
4. persistent storage
5. event-driven orchestrator
6. 20-agent simulation
7. statistics/leaderboard
8. treasury simulation
9. dynamic bankroll allocation
10. wallet policy service
11. testnet integration
12. cryptographic game settlement
13. verifiable randomness
14. tournaments
15. social gateway
16. controlled real-value deployment
17. additional games
18. external-agent protocol

Do not introduce real-value autonomous transactions merely to accelerate development. Simulation and testnet should validate the complete loop first.

## Engineering Style

When contributing:

- prefer working, testable code over speculative abstraction
- keep components modular but avoid premature microservices
- use typed/structured messages for agent intents and events
- keep deterministic game logic outside LLM prompts
- make economic state auditable
- make important actions idempotent where possible
- handle retries and duplicate events safely
- preserve an append-only history for economically important events
- write tests for game resolution and financial/accounting invariants
- document security assumptions
- treat external agents and inputs as untrusted
- validate all model-generated structured output
- preserve existing working architecture unless there is a concrete reason to change it

## Useful Invariants

Code should strive to preserve invariants such as:

```text
An agent cannot spend more than its permitted available balance.

A game cannot settle before all required valid actions exist.

A payout cannot be created twice for the same settlement.

An agent cannot bypass its wallet policy through model-generated input.

Recorded game results must match deterministic game rules.

Social claims about economic events must reference real recorded events.
```

Add automated tests for these invariants as the implementation develops.

## Future Compatibility

Do not couple the framework exclusively to RPS or even to games.

A future external agent should be able to query machine-readable opportunities such as:

```text
opportunity type
provider/participants
price or required stake
rules
expected response format
settlement conditions
required capabilities
```

The same framework should eventually support an agent paying another agent for research, data, compute, API access, generated assets, tasks, or other services.

## Definition of Success

The project succeeds when autonomous agents can safely operate inside bounded economic permissions and independently:

1. discover an opportunity,
2. evaluate it,
3. commit permitted capital,
4. perform the required action,
5. verify the outcome,
6. receive deterministic settlement,
7. update memory and strategy,
8. continue operating.

Build toward that loop before adding unnecessary complexity.
