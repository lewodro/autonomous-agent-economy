# World gathering, profiles, and reward receipts

The public world contains eleven small resource nodes on reachable natural terrain: six ore nodes and five harvest plants. The ore nodes are copper, iron, silver, gold, obsidian, and crystal, spread across the west, northwest, east, south, and remote perimeter outcrops. A connected visitor must stand within interaction range and press **E**. The server checks the visitor's live presence capability and position, consumes that node generation, starts its respawn cooldown, and records one idempotent reward receipt. Every ore node respawns on a short fifteen to twenty minute cycle, while harvest plants keep their longer eighteen to twenty-six minute cycles. The browser only renders the node and a short pixel-particle burst.

Gathering awards **TEST CREDITS**. These credits are not SOL, cannot be wagered, and do not imply a claim on project funds. The Bazaar's EXCHANGE terminal shows the local profile, balance, and recent receipts. Resource profiles contain a public nickname and test-credit balance only. Solana wallets are linked separately under the signed-in Last Seat account using a short-lived signed challenge. The app never requests or stores a seed phrase, private key, or signing credential.

Each receipt contains a reward ID, public user ID, source action, resource node and generation, credit amount, timestamp, status, and idempotency key. A node generation cannot reward twice. With `DATABASE_URL`, state is persisted in the `world-economy` Postgres document; local development falls back to `MATCHES_DIR/world-economy/world-economy.json`. Movement frames and wallet secrets are not persisted.

## Treasury boundary

Gathering receipts always remain `test_credited`; earning internal credits does not
create a real-asset liability. The separate Treasury House ledger and public endpoint
may display a configured public address, allocation and payout events, but they never
derive values from gathering counters. `WORLD_SOL_PAYOUTS_ENABLED=0` remains the safe
default and no executor or signer is implemented in this phase.

Local/free development needs no login provider or wallet. Clerk accounts and verified
wallet links are optional ownership layers; anonymous visitors can keep exploring.
