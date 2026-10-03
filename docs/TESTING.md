# Local verification

Offline checks require Node 22+ and Rust/Cargo for the Rust demo. The project has no npm or Cargo dependencies.

```bash
npm test
npm run check
cargo test --manifest-path rust/Cargo.toml
cargo run --manifest-path rust/Cargo.toml
npm run demo:crypto
npm run demo:solana
```

## Browser smoke test

Start the game in one terminal:

```bash
npm start
```

Start a **dedicated** headless Chrome session in another terminal. On macOS:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-first-run --no-default-browser-check \
  --remote-debugging-port=9322 --user-data-dir=/tmp/agent-arena-browser about:blank
```

On Linux, use `google-chrome` or `chromium` with the same flags. Never point this debug session at a personal browser profile. The test controls only that session's local game tab and replaces its local saved simulation.

```bash
npm run test:browser
```

The test checks 20 sprite images, standings, a complete match, proof inspection, emergency pause, two-agent survival, round-robin tournament, reload/reconciliation, treasury receipt deduplication, allocation, and a 390px mobile viewport. It captures a screenshot to the OS temporary directory. No npm browser automation package is needed; it uses Node's built-in WebSocket and Chrome's DevTools Protocol.

## Devnet integration

```bash
npm run demo:solana -- --devnet
# Optional: request devnet faucet funds for an ephemeral key before simulation.
npm run demo:solana -- --devnet --airdrop
```

These are separate from offline tests. RPC and faucet outages/rate limits are reported as errors. Without the faucet, the zero-balance payer is expected to fail transaction simulation. A signed transaction is simulated but never broadcast. Do not interpret that expected failure as a funded settlement or production integration.
