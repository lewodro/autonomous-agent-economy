# Changelog

## Unreleased

### Hardening

- Add cohort conservation/terminal invariants and persisted receipt roundtrips.
- Reject inconsistent recovered settlement/participant/proof records and malformed
  local transaction evidence; cover stale refund and payout recovery.
- Add actionable config diagnostics, canonical JSON validation and mode-aware doctor.
- Add safe economy health counters, opt-in transition logs and typed storage errors.
- Freeze semantic game outcomes, settlement and refunds across Rust/TypeScript.
- Document API/events, backend custody boundaries, recovery, validator setup,
  contributor workflow, security reporting and dependency/version policy.
- Validate documentation links and canonical configs in CI.

### Existing milestones

- Rust seeded 2–20-agent Last Seat simulation, alliances/eliminations, explicit
  winner/draw and versioned replay verification (current default last-seat-v6).
- Live TypeScript browser, replaceable effects, read-only SSE spectators, active
  checkpoint recovery and bounded optional model adapters.
- Mock funded economy with exact lamport accounting, durable operation journal,
  attested settlement and authorized refund recovery.
- Pinned local-validator backend-custody funding foundation and native signed
  transfer verification; devnet funded admission unavailable, mainnet disabled.
- Capped test-wallet demo and separate experimental mock HTTP 402 tool payments.
- Recent dependency/advisory and CI action updates recorded in the
  [October 3 audit](docs/audit-2026-10-03.md).

There are no invented releases here. Git history is authoritative for chronology;
package, crate, rules and event schemas use separate version scopes.
