# Mock match economy configurations

| File | Entry per agent | Starting wallet | Pot (four agents) |
|---|---:|---:|---:|
| `free.json` | 0 | 0 | 0 |
| `mock-0.02.json` | 0.02 mock SOL | 1.0 mock SOL | 0.08 mock SOL |
| `mock-0.05.json` | 0.05 mock SOL | 1.0 mock SOL | 0.20 mock SOL |

Amounts are decimal **strings**, parsed into integer base units. No floating-point
accounting. `maximum_entry_sol` and `minimum_reserve_sol` are explicit policy,
not game rules. Edit `agents`, `seed`, `max_turns` and `instance` for a new run.
The instance nonce distinguishes identical simulation setups; retrying one run
must reuse its ID. These configurations do not enable on-chain entry payments.

The simulation retains its usual mock strategies and survival credits. The
funded treasury is a separate sidecar. Mainnet is explicitly rejected. Devnet
balance reading exists, but the devnet match payment rail remains read-only.
