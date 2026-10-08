# Mainnet boundaries

**Public free mode is the release path.** It needs no wallet. Optional Devnet uses valueless TEST SOL and must be labeled **DEVNET · TEST SOL · NO REAL VALUE**. Neither mainnet agent funding nor mainnet match wagering is enabled by this release.

## Mainnet agent ownership and funding

This is distinct from wagering. Before allowing real owner deposits or autonomous spend, the product needs independently reviewed wallet authentication, ownership transfer/revocation, persistent owner and receipt ledgers, clear custody terms, transaction simulation, approved destinations and programs, loss/exposure/reserve limits, monitored reconciliation, incident pause, backups and a production threat model. The `224-add-ownership-mode-safety-gates` branch contains an experimental implementation under audit; it is **not** merged into main by this release. Do not infer readiness from its commit count.

## Mainnet match wagering

This needs a separate protocol/security/legal review: verified entry deposits, fair and inspectable rules, independently verifiable result authority, escrow and payout proofs, duplicate-safe finality and refund handling, loss limits, dispute handling, operational monitoring and jurisdiction review. The application explicitly rejects mainnet paid entry. A Devnet test run or a mock journal does not establish real-value safety.

See [mainnet readiness](security/mainnet-readiness.md), [trust boundaries](security/trust-boundaries.md) and [public Devnet](economy/public-devnet.md) for the current evidence and remaining work.
