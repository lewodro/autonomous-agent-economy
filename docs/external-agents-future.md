# External world agents

The walkable world does not load custom executable agents or connect world NPCs to MCP. Its actor model reserves extensible types; the current NPC controller only moves actors for presentation. Existing MCP support for Rust-backed Last Seat arenas is separate from the world and remains unchanged. Rust-Based.

A future integration should add a narrow `AgentController` adapter and a versioned declarative `agent.json` prefab for identity and approved assets. `AGENT.md` can describe behavior and requirements for human review; neither manifest executes as code. Imported provider/model names and MCP capabilities must match server allowlists. Any HTTP or MCP controller needs scoped identity, explicit actions and data access, authentication, request/output limits, rate limiting, isolation from secrets, and deterministic game-rule validation. The game server continues to authorize and resolve moves.

The current `ManualExternalAgentNetworkAdapter` is an integration boundary, not live onboarding. It creates review records for profile registration, updates, interactions, and invitations; requires explicit bot/agent disclosure and declarative manifest digests; and performs no external network call. See [public agent identity](agent-public-identity.md).
