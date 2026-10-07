# Mainnet ownership readiness

## Current status

**Mainnet agent ownership and funding are not implemented and cannot be enabled.**
The current release can verify a wallet signature and persist an owner profile,
but it does not construct, verify, reconcile, or withdraw mainnet agent-funding
transactions. `SOLANA_NETWORK=mainnet-beta`,
`ENABLE_MAINNET_AGENT_FUNDING=true`, and `APP_MODE=mainnet-ownership` all fail
closed at startup. The mock profile ledger is explicitly valueless.

**Mainnet match wagering is always disabled.** Setting
`ENABLE_MAINNET_MATCH_WAGERING=true` is rejected. Agent funding and competition
wagering are separate capabilities; completing one must not silently activate
the other.

## Ownership/funding boundary in this release

Wallet sign-in uses a random, five-minute, single-use challenge bound to the
origin and public key. The browser wallet signs the message; the server verifies
Ed25519 and gives the browser a signed, HttpOnly, SameSite session cookie. The
private key remains with the user. Owner records and user-created mock agents
are stored in `$MATCHES_DIR/identity/state.json` using atomic replacement.
Owner cookies include a signed session version checked against that durable
record. Logout revokes existing cookies server-side, and linking a guest profile
to a wallet invalidates the previous guest cookie. Legacy version-zero cookies
remain readable until an owner is explicitly upgraded or logs out.

The current agent treasury is a local profile ledger. Its mock-credit receipt is
not a Solana receipt. No program-derived address, escrow contract, backend
custody account, mainnet recipient, automatic withdrawal, or agent-controlled
signer exists. Do not describe the current system as decentralized custody.

## Blocking requirements before mainnet funding

- **Wallet funding transaction:** transaction construction that leaves the
  owner in control and prompts an explicit wallet approval for every transfer.
- **Recipient/custody design:** documented, tested control of the destination
  account and a working owner recovery/withdrawal path. Funds must never be
  trapped behind an unavailable server signer.
- **Verification:** verify cluster/genesis, finalized transaction status,
  source wallet, exact destination, exact lamport amount, and transaction
  success through trusted RPC. The browser's “sent” response is not evidence.
- **Idempotency and persistence:** durable intent, consumed transaction
  signatures, receipt, retry/reconciliation, and duplicate-funding prevention.
- **Operations:** production database/shared transactional storage, key
  management (if any service signer exists), rate limits, monitoring, incident
  response, RPC failover policy, backups, and restore drills.
- **Security review:** independent review of wallet auth/session behavior,
  transaction parsing, recipient policy, withdrawal, RPC trust, and recovery.
- **Legal/compliance:** jurisdiction and consumer-protection review for the
  exact ownership/funding product. Any real-money competition requires a
  separate review and must remain disabled until explicitly approved.

## Recommended before implementation

Start with a wallet-adapter transaction where the user's wallet constructs and
signs an explicit transfer to a narrowly specified, non-upgradeable or audited
destination. Show the destination, amount, network, and fee in the wallet. Add
an independent verification service that records finalized receipts. Define
withdrawal before accepting any value. Use a tiny controlled pilot and a
separate staging deployment, then reconcile against chain state before showing
a balance as available.

Do not let an agent call arbitrary transfers. The future capability path should
quote a named operation, enforce a per-action and daily budget, reserve the
budget, execute only an approved destination/action, and write an auditable
usage receipt. Current policy options are `read_only` and `manual`; automated
budgeted spending is rejected and no capability spends funds today.

## Mainnet ownership dry-run checklist

This is a readiness sequence, **not an activation recipe**. Current production
verification should fail if mainnet is requested.

1. Deploy the free site with persistent storage and verify `/api/health`.
2. Keep `ENABLE_MAINNET_AGENT_FUNDING=false` and
   `ENABLE_MAINNET_MATCH_WAGERING=false` (or leave both unset).
3. Connect a wallet on Devnet and test only wallet challenge sign-in. This
   proves identity only; it does not fund an agent.
4. Test transaction parsing and receipt reconciliation against Devnet/local
   validator with exact sender, destination, amount and finalized status.
5. Demonstrate an owner-authorized withdrawal and recovery from a restored
   backup before accepting any mainnet funds.
6. Complete security, operational, and legal review. Preserve logs and receipts
   without recording wallet secrets.
7. Only after a separate reviewed implementation, use a controlled owner wallet
   and a tiny amount. Verify transaction, displayed available balance,
   withdrawal, receipt, and reconciliation independently.

There is intentionally no command that enables those final steps in this
release. Mainnet ownership is a future gate; mainnet wagering remains out of
scope even after ownership funding is implemented.
