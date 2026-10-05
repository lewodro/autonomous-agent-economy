# Balance report

V6 changes one rule: **guard blocks challenges but earns no income**. Work,
challenge and cooperation keep their V5 effects. Protection consumes an earning
opportunity. Versions 1–5 remain immutable; recorded decisions verify against
original rules. Mock strategy policies remain unchanged.

Matching V5/V6 cohorts use equal 12-credit starts and rotated seats. Four-agent
cohorts contain one of each strategy; eight-agent cohorts contain two of each.
These are scripted policy comparisons, not paid model benchmarks. Rates include draws.

| Cohort | Matches | Seeds | Conservative wins V5 → V6 | Draws V5 → V6 | Mean turns V5 → V6 |
|---|---:|---|---:|---:|---:|
| Four-agent tuning | 120 | 1–120 | 82 → 67 | 20 → 23 | 16.08 → 15.18 |
| Eight-agent tuning | 100 | 4001–4100 | 90 → 69 | 10 → 24 | 18.92 → 16.71 |
| Four-agent validation | 120 | 3001–3120 | 87 → 61 | 18 → 29 | 15.79 → 14.94 |
| Eight-agent validation | 100 | 5001–5100 | 84 → 68 | 15 → 28 | 18.53 → 16.33 |

Validation seeds were run after choosing zero-income guard, without further
changes. These four paired cohorts total **880 measured matches**. Additional
exploratory runs informed the change. Raw JSON is in [balance/](./balance).

| Strategy | V5 tuning wins / 120 | V6 tuning wins / 120 | V6 validation wins / 120 |
|---|---:|---:|---:|
| Aggressive | 12 | 12 | 17 |
| Conservative | 82 | 67 | 61 |
| Opportunist | 6 | 18 | 13 |
| Cooperative | 0 | 0 | 0 |

| V6 four-agent metric | Tuning | Validation |
|---|---:|---:|
| Mean turns | 15.18 | 14.94 |
| Turn range | 10–19 | 10–18 |
| Alliances created | 103 | 101 |
| Betrayals | 75 | 76 |
| Eliminations | 383 | 389 |
| Mean elimination turn | 13.18 | 13.04 |

| Action | V6 tuning uses | V6 validation uses |
|---|---:|---:|
| Challenge | 1213 | 1246 |
| Cooperate | 1683 | 1624 |
| Guard | 477 | 499 |
| Work | 3119 | 3039 |

Defensive dominance falls in both validation populations, but remains strong at
8 seats. The tuning cohort retains almost one alliance per match and adds more
betrayals. Draws increase. Cooperative still wins zero in these four-agent cohorts:
cooperation is exploitable and needs better invitation/reciprocity memory. This
is an improvement, not balanced competition or evidence about real model quality.

## Rejected experiments

A cooperative policy that guarded its lead and worked whenever income exceeded
the mutual bonus looked useful on seeds 1–120: conservative won 67, cooperative
26. In exploratory seeds 1001–1120, conservative still won 86/120 and cooperative
14. Alliances fell to 11 and 7 respectively. We rejected the policy rather than
remove observable interaction to optimize one cohort. Captured raw results:
[training](./balance/rejected-policy-training.json),
[exploratory validation](./balance/rejected-policy-validation.json).
These experiments are not reproducible with the released strategy policy.

One-credit guard and cheaper challenges were also evaluated. The final rule
keeps challenge pricing and makes guard's opportunity cost explicit.

## Reproduce

```bash
# Arguments: matches, rules version, first seed, seats
npm run balance -- 120 last-seat-v6 1 4
npm run balance -- 120 last-seat-v6 3001 4
npm run balance -- 100 last-seat-v6 5001 8
# Matched control: identical agents and seeds, immutable V5 rules
npm run balance -- 100 last-seat-v5 5001 8
```

Invalid counts, seat counts, seed zero and overflowing ranges are rejected. The
maximum unsigned seed is supported. Metrics remain finite with zero eliminations.
[baseline.json](./balance/baseline.json) retains the original pre-tuning 120-match
experiment where aggression won every match; changing only a replay version does
not restore that historical strategy implementation.

## Overnight architecture smoke sample — 2026-10-03

No rule or strategy tuning in this pass. A fresh four-agent cohort uses equal
12-credit starts and rotated seats: **120 matches, seeds 6001–6120, V6**.

| Strategy/result | Count | Share of all matches |
|---|---:|---:|
| aggressive | 12 | 10.00% |
| conservative | 71 | 59.17% |
| opportunist | 10 | 8.33% |
| cooperative | 0 | 0.00% |
| Draw | 27 | 22.50% |

Mean turns: **15.175**, range 10–21.
Alliances: 109; betrayals: 77; eliminations: 387;
mean elimination turn: 13.220.

| Action | Uses |
|---|---:|
| Challenge | 1241 |
| Cooperate | 1712 |
| Guard | 486 |
| Work | 3051 |

Conservative remains dominant and cooperative wins none; this foundation pass
intentionally leaves V6 rules and recorded replay behavior unchanged. It confirms
that balance remains a high-value next gameplay task, not that the game is balanced.

[Raw sample](./balance/overnight-v6-smoke.json). Reproduce with:

```sh
npm run balance -- 120 last-seat-v6 6001 4
```
