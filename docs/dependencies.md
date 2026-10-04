# Dependencies and version policy

Keep committed package-lock.json and rust/Cargo.lock. Use npm ci and Cargo --locked
in CI and reproducible local runs. The only direct npm dependency is the dev compiler
TypeScript, pinned to 7.0.2 in package.json. There are no npm runtime dependencies.
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
