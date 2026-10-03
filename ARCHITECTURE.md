# Architecture review and implementation boundary

## Review

The existing README and AGENTS.md provide a coherent simulation-first direction. The landing page describes that direction but does not implement an economic loop. The supplied 20 PNG sprites map directly to persistent agent identities.

The missing executable boundaries are:

1. **Accounting:** use integer lamports, keep escrow and treasury separate, and conserve capital across every settlement. Funding is a recorded simulation input, never assumed creator revenue.
2. **Authorization:** validate structured intents outside strategy code. Enforce stake caps, exposure, reserve, loss limits, approved destinations, and emergency pause before debiting either player.
3. **Game verification:** bind SHA-256 commitments to match ID, agent ID, move, and nonce. Both commitments must exist before either reveal is accepted. Resolve all nine RPS combinations deterministically.
4. **Settlement:** require two verified reveals; consume escrow once; record payouts and update statistics once. Duplicate settlement must return the recorded outcome without creating money.
5. **Orchestration:** wake strategy functions for a game opportunity; serialize economic changes; update opponent memory from settled matches. Strategies use different priors and learn from observed moves, rather than fixed character scripts.
6. **Persistence:** save only completed economic transitions. Validate saved state and reconcile the ledger before resuming; retain an append-only event history and exportable commitment proofs.

## Modules

```text
Browser controls and sprite arena
        ↓ game opportunity
Event orchestrator → strategy → structured ENTER_GAME intent
        ↓
Policy validator → integer ledger / escrow
        ↓
RPS commitment → reveal verification → deterministic settlement
        ↓
Agent memory / analytics → validated browser storage
```

The game engine, strategies, policy, storage, and renderer stay separate. Opportunity descriptors include type, participants, stake, rules, response schema, and settlement conditions so a future service marketplace can reuse these boundaries.

## Simulation assumptions

- SOL amounts in this app are simulated units. No wallet connection, private keys, signing, real payments, blockchain verification, or public social publishing is implemented.
- Initial capital is explicitly seeded in the simulation ledger. Treasury starts at zero. A creator-revenue input records a simulated receipt and allocates 30% to treasury.
- RPS has zero network and protocol fees; these are separate fields rather than concealed deductions. Draws refund both stakes. A winner receives both stakes.
- Browser cryptography supplies strategy randomness and commitment nonces. Commit-reveal proves the recorded moves were committed before reveal within this process. A single browser controls both agents; this is not a trustless multiplayer or blockchain settlement protocol.
- Strategy functions are local adaptive algorithms, not connected LLMs. Future models may propose intents but cannot bypass policy.
- Browser storage is local and user-editable. Validation catches corruption and inconsistent records; it does not authenticate against a malicious operator. Exported records provide reproducible checks, not independent evidence of real-world funds.

## Before testnet or real-value deployment

Implement isolated signing, confirmed-chain accounting, durable server transactions, signed identities, independent commitment deadlines and forfeits, authenticated external-agent interfaces, and chain-backed escrow. Reconcile network/protocol fees and settlement retries against receipts. Add verifiable randomness before chance-based games. Real-value deployment remains a later milestone, as required by AGENTS.md.

## Five-commit delivery

1. `update_fix_architecture_simulation_foundation` — review, preserve the supplied assets and landing page, local server and project commands.
2. `update_fix_economy_policy_commit_reveal` — deterministic engine, policy and accounting invariant tests.
3. `update_fix_apparel_agent_sprites_arena` — playable sprite arena, adaptive orchestration and analytics.
4. `update_fix_treasury_storage_tournaments` — confirmed simulated treasury inputs, bounded allocation, validated persistence and tournaments.
5. `update_fix_validation_docs_game_release` — integration checks, usage documentation and final fixes.
