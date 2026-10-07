# Validation

From the repository root:

```bash
npm test
npm run check
npm run typecheck
cargo test --manifest-path rust/Cargo.toml --locked
npm run demo:wallet
```

`npm test` builds Rust and TypeScript first, so service tests cannot silently skip on a clean clone. The Rust engine tests replay every default 2/4/8/20-agent match, compare serialized bytes, test invalid decisions and atomicity, and reject changed events/winners. Existing JS economy tests remain active.

## Browser check

Run `npm start`. In another terminal start a dedicated Chrome process (macOS example; use your platform's Chrome executable elsewhere):

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --remote-debugging-port=9322 \
  --user-data-dir=/tmp/last-seat-browser about:blank
```

```bash
npm run test:browser
# If the game uses a different port:
GAME_URL=http://localhost:3001 npm run test:browser
```

The smoke script clears only Last Seat's replay storage in that dedicated profile. It exercises a full four-agent match, pause/resume, inspector/favorite, replay without another engine step, turn seek, verified shared links, mobile width, two-agent remix and restart. It records desktop/mobile PNGs in your OS temp directory and fails on browser exceptions.

## Network demo

`npm run demo:wallet -- --devnet` checks the fixed devnet genesis and reads a fresh test wallet's balance. `--fund --transfer` additionally requests faucet funds, checks fees/reserve, simulates a capped transfer, sends and confirms it. Network and faucet failures are separate from offline correctness. Never use production keys in demo files.

## Final visual/performance pass

The browser test now compares the default match with `docs/architecture/example-match.json`, verifies 20 seats at 360/390/430px widths, exercises reduced motion, captures a live screenshot and records active-scene RAF timing. See `docs/frontend/performance.md`; temporary captures include `last-seat-live.png`, `last-seat-mobile.png` and `last-seat-twenty.png`.

## Full-size history check

```bash
cargo test --release --manifest-path rust/Cargo.toml --locked --test table_rules maximum_size_match_is_replayable_within_transport_limits -- --ignored
```

This deliberately expensive 20-agent/200-turn case also runs in CI. All other Rust tests run normally without `--ignored`.

## Live spectator and persistence checks

Integration tests restart the service and compare the same session/history, subscribe to SSE, advance host turns, and reconnect. Browser checks verify independent viewer pause, zero viewer step requests, reconnect/reload and a separate remix. Store tests cover queued writes, corrupt checkpoints, restored inference budgets and preventing paid requests when reservation persistence fails. Stream tests cover connection limits, slow readers and socket-write failures.

## Isolated debug port

If another dedicated Chrome already uses :9322, start your own profile on :9337
and run `CHROME_DEBUG_URL=http://127.0.0.1:9337 GAME_URL=http://localhost:3017 npm run test:browser`.
The world journey covers character selection, keyboard movement, NPC profile/research, Survival combat and inspection, shared RPS/Tic-Tac-Toe rooms, return navigation, touch joystick movement/release, and a 390px layout:

```sh
CHROME_DEBUG_URL=http://127.0.0.1:9322 GAME_URL=http://localhost:3000 npm run test:browser:world
```

Set `WORLD_SCREENSHOTS=1` to retain journey screenshots in the OS temp folder.
For the opt-in lab use `ECONOMY_URL=http://localhost:3017 npm run test:browser:economy`
with the same CHROME_DEBUG_URL. These scripts clear replay/favorite storage in the
selected profile, so always use an isolated test profile. They never require a
project browser automation dependency.
