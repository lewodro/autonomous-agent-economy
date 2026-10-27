# World gathering, profiles, and reward receipts

The public world contains six small resource nodes on reachable natural terrain: three ore nodes and three harvest plants. A connected visitor must stand within interaction range and press **E**. The server checks the visitor's live presence capability and position, consumes that node generation, starts its respawn cooldown, and records one idempotent reward receipt. The browser only renders the node and a short pixel-particle burst.

Gathering awards **TEST CREDITS** by default. These credits are not SOL, cannot be wagered, and do not imply a claim on project funds. The Bazaar's EXCHANGE terminal shows the local profile, balance, and recent receipts. Profiles are scoped to the signed visitor cookie and contain only a public nickname, optional public Solana address, link status, and test-credit balance. The app never requests or stores a seed phrase, private key, or signing credential. A saved address is labeled `self_declared` until a future authentication/wallet-signature adapter verifies ownership.

Each receipt contains a reward ID, public user ID, source action, resource node and generation, credit amount, timestamp, status, and idempotency key. A node generation cannot reward twice. State is persisted under `MATCHES_DIR/world-economy/world-economy.json`; movement frames and wallet secrets are not persisted.

## Optional treasury boundary

Real payout intent generation is off by default. An operator must explicitly set all three values:

```text
WORLD_TREASURY_ADDRESS=<public Solana address>
WORLD_SOL_PAYOUTS_ENABLED=1
WORLD_LAMPORTS_PER_CREDIT=<positive integer>
```

Only a linked public recipient address then changes a new receipt from `test_credited` to `payable` and adds the treasury address, integer lamport amount, and an empty transaction-signature field. The application still does not sign or submit a transaction. A separate controlled treasury signer must review, pay, reconcile the exact signature, and enforce its own caps and reserve policy. Publishing a treasury address is not authorization to spend it.

Local/free development needs no login provider or wallet. The current signed visitor session is the identity foundation; production account login and proof-of-wallet ownership remain explicit future adapters rather than a home-grown OAuth implementation.
