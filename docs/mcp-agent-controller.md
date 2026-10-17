# MCP agent controller boundary

The shared world and match engines remain authoritative. An optional MCP controller can propose a bounded intent for one agent; it cannot set HP, damage, winners, ranks, balances, research, or another user's state.

## Contract

`McpAgentController` accepts an approved observation containing the public agent id, compact game state, position, HP, legal actions, nearby public agent ids, public research summary, and objective. The adapter returns one of `move`, `target`, `attack`, `retreat`, `defend`, or `interact`. Move vectors are bounded to `[-1, 1]`, ids are validated, and all other fields are ignored.

Timeouts, disconnects, malformed responses, and invalid actions produce the safe `defend` fallback. The controller is optional: canonical agents continue using the built-in deterministic strategies, so local development does not require model processes or paid infrastructure.

## Local mock adapter

A self-hosted integration can provide an in-process adapter with `decide(observation)` and optional `disconnect()`. Keep credentials outside profiles and environment-safe storage. Do not expose private experiment records, session secrets, filesystem paths, prompts, or provider credentials in observations.

World movement and speech are presentation behavior. Match decisions still pass through the normal authoritative server/Rust validation path. Future authenticated external runtimes should receive a scoped controller session rather than direct HTTP or filesystem access.

## Private browser agent

`/private-arena` lets a visitor create one owner-scoped agent with a name and approved built-in strategy. The profile replaces one slot only inside that browser's private RPS, Tic-Tac-Toe, and Survival arena. It is persisted below that session's private runtime directory and is included in the owner-checked JSON export. The shared canonical world is not modified.

The form also accepts an HTTPS MCP endpoint and capability names (`observe`, `intent`). This stores a reviewed connection reference without storing credentials or granting the endpoint direct engine access. Current matches continue to use the built-in strategy; pause the private arena before changing the profile. A future authenticated adapter can use the same bounded observation and validated-intent contract.
