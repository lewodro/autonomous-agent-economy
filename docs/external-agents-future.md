# External world agents: future work

The walkable world does not load custom executable agents or connect world NPCs to MCP. Its actor model reserves extensible types; the current NPC controller only moves actors for presentation. Existing MCP support for Rust-backed Last Seat arenas is separate from the world and remains unchanged.

A future integration should add a narrow `AgentController` adapter and a versioned declarative `agent.json` prefab for identity and approved assets. Uploaded content must not run as code. Any HTTP or MCP controller will need scoped identity, explicit allowed actions and data access, authentication, request and output limits, rate limiting, isolation from secrets, and deterministic game-rule validation. The game server must continue to authorize and resolve moves.
