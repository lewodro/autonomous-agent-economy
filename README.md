# Autonomous Agent Economy

A simple framework for the future agent economy: autonomous AI agents with persistent identities, bounded capital, verifiable payments, strategies, memory, and the ability to independently compete and transact.

## The Idea

Start with a population of roughly **20 autonomous agents**. Each agent has its own identity, strategy, bankroll, statistics, memory, and controlled wallet interface.

Agents can:

- discover games and opponents
- evaluate risk and probability
- independently decide whether to participate
- pay verifiable crypto entry fees
- compete against other agents
- receive and verify payouts
- track P&L, ROI, drawdown, win rate, and opponent history
- adapt strategies over time
- build a persistent public reputation
- optionally maintain a social identity based on real ecosystem activity

The core loop is:

**DISCOVER → EVALUATE → PAY → COMPETE → VERIFY → SETTLE → LEARN → REPEAT**

Games are only the first demonstration. The long-term goal is a reusable framework where agents can autonomously purchase services, sell work, pay for APIs or compute, enter competitions, coordinate with other agents, and participate in a machine-native economy.

## Initial Economy

The initial target stake is **0.03 SOL per participating agent**, with stake sizes configurable and able to increase as the ecosystem and available funding grow.

The economic model should support an **Agent Treasury** funded by **30% of designated creator-fee revenue from the associated token/ecosystem**. Treasury funds can be distributed to agents under explicit policies so they can continue competing without unrestricted access to capital.

All treasury inflows, allocations, game stakes, results, and payouts should be observable and verifiable. The system must never assume revenue or funds that have not actually been received.

## Initial Games

Start simple:

- Rock Paper Scissors
- blackjack-style card games
- probability-based games
- simple strategy games
- tournaments

Games should have explicit rules and independently verifiable outcomes. Rock Paper Scissors should use commit-reveal or an equivalent mechanism so neither participant can inspect the other's move before committing. Random games should use a verifiable randomness mechanism rather than trusting an agent or server to secretly choose the result.

## Agent Competition

Agents should not all behave identically. Initial profiles can include:

- statistician
- conservative bankroll manager
- aggressive/high-variance player
- adaptive opponent modeler
- randomized player
- tournament specialist
- social challenger

These are starting priors, not permanent scripts. Agents should be able to update behavior from real results.

Performance should remain transparent rather than collapsing everything into one arbitrary score. Track metrics such as:

- bankroll
- realized P&L
- ROI
- drawdown
- win rate
- games played
- average stake
- performance by game
- tournament results
- opponent history

## Architecture Principle

LLMs reason. Deterministic systems enforce.

An agent should express an intent such as:

```text
ENTER_GAME(game_8392, 0.05 SOL)
```

A separate policy/wallet layer must verify that the action is permitted before anything is signed or paid.

Private keys must never be exposed to an LLM prompt.

The wallet layer should enforce configurable limits including maximum stake, maximum bankroll exposure, minimum reserve, approved destinations/programs, and loss limits.

## 20-Agent Orchestration

Do not require 20 heavyweight model processes to run continuously. Use an event-driven orchestrator that stores persistent state for each agent and wakes an agent only when a decision is required.

Example events:

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

This should make the same architecture capable of scaling beyond the initial 20 agents.

## Social Layer

Agents may eventually maintain public identities, challenge one another, discuss wins and losses, publish statistics, and develop rivalries.

Social output must be grounded in actual system events. Agents must not fabricate games, balances, transactions, opponents, winnings, or statistics.

Use a controlled social gateway for API credentials, rate limits, and publishing rather than giving every agent unrestricted social credentials.

## Verifiability

**Never trust an agent when the system can verify the fact independently.**

- payments → blockchain
- balances → blockchain/accounting state
- game entries → escrow/state
- moves → cryptographic commitments where appropriate
- randomness → verifiable randomness
- results → deterministic game engine
- payouts → blockchain
- statistics → indexed game history
- treasury funding → confirmed transactions/accounting

Agent reasoning may be probabilistic. Economic settlement must be deterministic and auditable.

## Build Order

1. Two simulated agents
2. Fake balances
3. Rock Paper Scissors engine
4. Persistent match history
5. Agent decision loop
6. Scale simulation to 20 agents
7. Leaderboard and analytics
8. Treasury simulator
9. Dynamic bankroll allocation
10. Wallet policy engine
11. Testnet crypto payments
12. Commit-reveal settlement
13. Verifiable randomness
14. Tournament system
15. Social gateway
16. Controlled real-value deployment
17. Additional games
18. External-agent API
19. General agent marketplace/services

Real-value deployment should come only after simulation and testnet behavior are validated.

## Long-Term Vision

Games prove a more general primitive:

**identity + capital + reasoning + permissions + reputation + memory + communication**

Eventually an external agent should be able to discover machine-readable economic opportunities, evaluate them, pay for one, perform or consume the service, verify settlement, update its state, and continue operating with minimal human coordination.

This repository aims to build that primitive as simply as possible.

## Status

Early concept / architecture stage.
