# Isolated local-validator quickstart

Install Node 22+, Rust/Cargo (minimum in Cargo.toml), and official Agave/Solana
CLI tooling including `solana-test-validator`. Follow the tool vendor's current
installation instructions; this repository does not pin or download validator
binaries. An existing binary can be selected with SOLANA_TEST_VALIDATOR_BINARY.
No valuable wallet or public cluster is appropriate for this guide.

```sh
npm ci --ignore-scripts
npm run build
npm run doctor -- --mode mock
solana --version
solana-test-validator --version
```

Keep a separate, ignored experiment directory. In terminal one:

```sh
export ECONOMY_DIR="$PWD/matches/local-hardening"
npm run solana:local
```

The helper starts or checks loopback RPC :8899, waits for health and pins genesis
in ECONOMY_DIR/local-validator.json. It rejects public or changed genesis and
stops its own child on preflight failure. An already-running validator stays owned
by its original terminal; this helper does not stop it. Do not run two helpers
against the same ledger. It does not reset existing validator state.

In terminal two (same directory/environment):

```sh
export ECONOMY_DIR="$PWD/matches/local-hardening"
npm run doctor -- --mode local
curl -fsS http://127.0.0.1:8899 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}'
npm run demo:funded-local -- --mode local --agents 4 --entry 0.02
npm run economy:reconcile
ECONOMY_LAB=1 npm start
# Open http://localhost:3000/labs/funded for the funded operator lab.
```

The demo creates ignored test agent/escrow/sponsor keys, provisions agent treasuries
and sponsor with validator airdrops, verifies deposits, runs the same seeded engine,
attests completion, pays, and checks restart/idempotence. Never airdrop into escrow.
The house fee remains zero; the sponsor pays network fees outside the recorded pot.
Balances and public transaction references appear in the JSON result and host view.

To inspect a public address returned by the demo:

```sh
solana balance --url http://127.0.0.1:8899 PUBLIC_ADDRESS
```

To run the opt-in Rust chain regression, pin the observed non-public genesis:

```sh
export LOCAL_GENESIS_HASH=YOUR_OBSERVED_LOCAL_GENESIS
cargo test --manifest-path rust/Cargo.toml --locked --test economy_durable \
  actual_local_transfer_verifies_chain_and_survives_rail_restart -- --ignored
```

Stop the app, then Ctrl-C the terminal that owns the validator. Preserve ledger,
keys, host authority, pin and journals for recovery. To start fresh, choose a new
ECONOMY_DIR and stop the old validator before restarting on :8899. Do not reset an
active ledger or reuse old journals against a new genesis. No automatic destructive
reset command is provided. Missing binary, connection refused, low sponsor balance,
and changed genesis are covered in [troubleshooting](troubleshooting.md).

In this hardening environment Solana tools were absent; chain tests remain opt-in.
Mock demos and local wire/evidence tests do not establish a fresh on-chain run.
