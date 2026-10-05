# Dependencies and version policy

Keep committed package-lock.json and rust/Cargo.lock. Use npm ci and Cargo --locked
in CI and reproducible local runs. Direct npm dependencies are:

| Package | Purpose | Declared range | Locked version | License |
|---|---|---:|---:|---|
| `@modelcontextprotocol/server` | Local MCP stdio server and protocol handling | `^2.3.1` | `2.3.1` | Apache-2.0 |
| `zod` | MCP tool input schemas and runtime validation | `^4.6.5` | `4.6.5` | MIT |
| `typescript` | Browser bundle type checking | `7.0.2` exact | `7.0.2` | Apache-2.0 |

The MCP SDK requires Node 20 or newer; the project targets Node 22+. MCP uses the
official SDK rather than a handwritten protocol loop. Tool orchestration stays in
the MCP host, while the bridge validates tool inputs and calls the local HTTP API.
No renderer or animation packages are needed for the site; the current canvas/CSS
driver is dependency-free. The lockfile is the source of exact npm transitive versions.
Cargo intentionally uses semver ranges for serde/serde_json, sha2 0.11,
ed25519-dalek 3, getrandom 0.4 and bs58 0.5; Cargo.lock pins exact resolved versions.
Do not describe those manifest ranges as exact pins.

Run `npm audit --audit-level=low` and `cargo audit --file rust/Cargo.lock` after an
upgrade. cargo-audit is an external developer tool, not a project dependency.
Audits require current registries/advisory data and network access. A zero-advisory
result is time-specific, not evidence that application/custody logic is secure.
The October 3 hardening report records actual validation evidence separately.

Dependabot schedules npm/Cargo/GitHub Actions review (see .github/dependabot.yml).
Review updates regularly and promptly triage security alerts; no support SLA is
promised. Commit manifest and lock changes together, inspect transitive diffs and
licenses, then run offline tests/build/schema checks. Avoid automatic broad upgrades
inside a behavioral hardening pass.

Add dependencies only for a demonstrated need the platform/standard library cannot
reasonably meet. Consider size, maintenance, license, install scripts and attack
surface. Crypto, signing, RPC, storage and serialization changes need extra review
of format compatibility, randomness, verification APIs and migration/recovery.
Never implement a replacement cryptographic primitive to avoid a reviewed dependency.
CI actions use immutable commit SHAs; update their SHA and version comment together.

Version scopes are intentionally distinct: npm package 1.0.0 is private; Rust crate
0.1.0 is publish=false; default simulation rules are last-seat-v6; economy event
schema and journal envelope format are 1. They do not need matching numbers.
Rules/history compatibility and transport schema changes need independent decisions.
No tagged release process or new version series is established by this pass.
