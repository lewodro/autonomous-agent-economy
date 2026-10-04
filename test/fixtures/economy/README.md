# Economy event fixtures

`settlement-v1.json` freezes the complete emitted event stream for
`examples/economy/mock-0.02.json`, including exact lamport strings and projections.
Rust generates and compares the stream; TypeScript parses and reduces the same file.

Schema version 1 is independent of game rules and package versions. Renaming an
event, changing required fields, or changing units needs an explicit compatibility
review and schema/version strategy. Additive optional fields need consumer tests.
Do not regenerate fixtures merely to make a failed check pass: review the diff and
explain the intended contract change. There is no automatic update in CI.

`refund-v1.json` freezes cancellation after one verified entry in a two-agent,
seed-42 match. `game-outcome-v6.json` freezes MatchStarted and WinnerDeclared for
the existing four-agent seed-42 game. The integration test constructs those flows
through the real coordinator and engine; no alternate economy is used.
