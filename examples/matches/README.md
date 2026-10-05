# Canonical match configs

These are existing full JSON schemas, not a new TOML format.

| File | Schema | Use |
|---|---|---|
| [free-match.json](free-match.json) | Simulation Config | `npm run match -- --config examples/matches/free-match.json --out /tmp/free-match.json` |
| [mock-funded-match.json](mock-funded-match.json) | FundedMatchConfig | Validate; submit `simulation` as API `config` and economy mode/entry as API fields |
| [local-validator-match.json](local-validator-match.json) | FundedMatchConfig | Same API mapping; requires a pinned isolated local validator |
| [custom-model-match.json](custom-model-match.json) | Simulation Config | Set server-approved MODEL_BASE_URL / MODEL_API_KEY_ENV before live use |

Run `npm run build && npm run examples:check`. The Rust checker validates the
actual schemas without contacting RPC or model services. The funded CLI currently
accepts flags, not config files: use `npm run demo:funded-local -- --mode mock`.
See [API mapping](../../docs/architecture/api.md) and [local validator setup](../../docs/economy/local-validator.md).
Never put credentials or seed material in profiles; profiles are public.
