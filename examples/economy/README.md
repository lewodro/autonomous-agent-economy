# Internal-credit match economy configurations

| File | Risk per agent | Starting capital | Pool (four agents) |
|---|---:|---:|---:|
| `free.json` | 0 | 0 | 0 |
| `mock-0.02.json` | 2 credits | 100 credits | 8 credits |
| `mock-0.05.json` | 5 credits | 100 credits | 20 credits |

Amounts are decimal **strings**, parsed into integer base units. No floating-point
accounting. The schema retains legacy field names such as `maximum_entry_sol`
and `minimum_reserve_sol`, but mock mode interprets their values only as internal
base units. They are explicit policy, not game rules or wallet balances. Edit
`agents`, `seed`, `max_turns` and `instance` for a new run. The instance nonce
distinguishes identical simulation setups; retrying one run must reuse its ID.
These configurations do not enable on-chain entry payments.

The simulation retains its usual mock strategies and survival credits. The
funded treasury is a separate sidecar. Mainnet is explicitly rejected. Devnet
balance reading exists, but the devnet match payment rail remains read-only.
