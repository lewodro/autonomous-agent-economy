# Security policy

This is an unreleased local prototype. Security fixes target the current main branch;
there are no supported release/LTS lines or published support SLA. Mainnet
competition is disabled. Backend custody and local-validator payments are test-only;
real-value competition is not production-ready.

Report privately through the repository's **Security → Report a vulnerability**
when GitHub private reporting is enabled. If unavailable, ask the maintainer in a
public issue for a private reporting channel **without exploit details, credentials,
wallet material or user data**. No separate private contact or bug bounty is promised.

Include affected revision, minimal reproduction, expected/actual behavior and impact.
Coordinate disclosure with the maintainer; avoid exploiting third-party services,
public networks or other users. Use mock funds or an isolated local validator.

Security-sensitive areas include double settlement/refunds, forged receipts or
attestations, wrong cluster/recipient/amount acceptance, custody access, malicious
model endpoints, credential routing, replay corruption, filesystem traversal and
browser-to-local-service abuse. Deterministic game logic and event schema changes
also require review when they influence payment authorization.

Never commit keys, wallet seed files, seed phrases, API tokens or populated local
journals. Keep secrets in server environment variables or ignored test key paths;
agent profiles/prompts and replay records are public. Do not use valuable wallets.
Logs allowlist public IDs; do not add raw provider responses, signed authorization
blobs or environment dumps. [Trust boundaries](docs/trust-boundaries.md) explain
what current checks do and do not prove. [Dependency policy](docs/dependencies.md)
records audit and upgrade expectations.
