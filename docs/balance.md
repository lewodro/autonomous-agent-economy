# Balance report

Measured 120 four-seat matches before tuning and 120 after tuning, seeds 1–120, one of each built-in strategy, equal 12-credit starts, seat order rotated by seed modulo four. The baseline was captured before public targeting memory and rule tuning. Raw observations are committed in [baseline.json](balance/baseline.json) and [current.json](balance/current.json). These are algorithm comparisons, not LLM benchmarks.

| Metric | Baseline | Current v5 |
|---|---:|---:|
| Mean turns | 15.42 | 16.08 |
| Minimum turns | 14.00 | 11.00 |
| Maximum turns | 17.00 | 24.00 |
| Alliances created | 120.00 | 110.00 |
| Betrayals | 0.00 | 61.00 |
| Draws | 0.00 | 20.00 |
| Eliminations | 360.00 | 380.00 |
| Mean elimination turn | 14.67 | 14.01 |

| Strategy | Baseline wins / 120 | Current wins / 120 | Current win rate |
|---|---:|---:|---:|
| aggressive | 120 | 12 | 10.0% |
| conservative | 0 | 82 | 68.3% |
| opportunist | 0 | 6 | 5.0% |
| cooperative | 0 | 0 | 0.0% |

| Action | Uses | Share |
|---|---:|---:|
| Challenge | 1161 | 16.8% |
| Cooperate | 1950 | 28.2% |
| Guard | 569 | 8.2% |
| Work | 3241 | 46.8% |

## Changes supported by the measurements

The original aggressive policy won every match and guard was never selected. V5 charges two credits for challenges, caps transfers at four from workers / three otherwise, and pays two for guard. Strategies see previous public decisions: defense reacts to actual targets, aggression works to preserve a lead, and the opportunist can betray a weaker ally as upkeep rises. No private strategy data is used to choose an action. Alliances and betrayal now produce visible stories instead of a guaranteed attacker win.

Conservative remains favored and cooperative won zero matches in this cohort. This is a useful limitation, not evidence of perfect balance. Cooperation helps partners survive but can be exploited. Future tuning should compare multiple starting allocations, populations and personality policies with separate held-out seeds.

## Reproduce current report

```bash
npm run balance -- 120 last-seat-v5
```

Baseline describes a captured earlier implementation; switching only the replay version does not restore old strategy code. Archived decisions still verify against their original rules. Rule versions 1–4 remain immutable; v5 is the new default. No unrecorded balance correction occurs in the browser.
