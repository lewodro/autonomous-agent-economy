# World gathering, profiles, and reward receipts

The public world contains six small resource nodes on reachable natural terrain: three ore nodes and three harvest plants. A connected visitor must stand within interaction range and press **E**. The server checks the visitor's live presence capability and position, consumes that node generation, starts its respawn cooldown, and records one idempotent reward receipt. The browser only renders the node and a short pixel-particle burst.

Gathering awards **TEST CREDITS** by default. These credits are not SOL, cannot be wagered, and do not imply a claim on project funds. The Bazaar's EXCHANGE terminal shows the local profile, balance, and recent receipts. Profiles contain a public nickname, optional public Solana address, link status, and test-credit balance. The app never requests or stores a seed phrase, private key, or signing credential.

Each receipt contains a reward ID, public user ID, source action, resource node and generation, credit amount, timestamp, status, and idempotency key. A node generation cannot reward twice. State is persisted under `MATCHES_DIR/world-economy/world-economy.json`; movement frames and wallet secrets are not persisted.

## Wallet ownership

Entering an address creates only a `self_declared` link and cannot produce a real payout. The client requests a short-lived challenge from `/api/world/economy/profile/challenge`, asks the wallet to sign the exact displayed message, then sends the detached base58 signature to `/api/world/economy/profile/verify`. The server verifies Ed25519 ownership against the address and records `verified` without receiving a key or transaction authority. Changing the address invalidates the proof.

This proof establishes control of the payout address at link time. It is not authentication for the rest of the account and does not authorize the application to debit that wallet.

## Settlement lifecycle

When real payouts are explicitly enabled, only new rewards for a verified wallet become `payable`:

```text
payable -> submitting -> submitted -> confirmed
                    \-> retryable -> submitting
                    \-> failed
          \-> held (cap exceeded)
```

The durable ledger claims one receipt with a lease before external work. The stable reward ID is also the executor idempotency key, so a crash after broadcast cannot intentionally create a second transfer. Attempts are bounded. Per-receipt and daily lamport caps are checked before submission. A submitted transaction remains unconfirmed until the worker observes a successful `finalized` status through Solana `getSignatureStatuses`.

The public web process does **not** hold a treasury key. It sends a strict intent—recipient, treasury, integer lamports, cluster, genesis hash, memo, and idempotency key—to a separately deployed HTTPS executor. That executor must independently enforce the same treasury, cluster, caps and idempotency rules. Publishing a treasury address is not authorization to spend it.

The current free Render demo deliberately sets `WORLD_SOL_PAYOUTS_ENABLED=0`. It uses ephemeral storage and is not eligible for real payouts. See [Solana payout operations](operations/solana-payouts.md) for the guarded rollout.
