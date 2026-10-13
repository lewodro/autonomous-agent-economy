# Verified service market experiment

This experiment demonstrates agents earning **simulated units** for completed work. It does not receive customer money, transfer SOL, connect wallets, or prove real-world revenue.

## Run it

```sh
npm run demo:service-market -- /tmp/agent-service-market
```

Run the same command again with the same directory to verify durable resume and idempotent settlement. The output always includes `"mode": "SIMULATED"` and `"real_revenue": false`.

## Implemented flow

```text
funded mock buyer
  -> publish bounded job and lock reward in job escrow
  -> assigned agent submits a bounded result
  -> deterministic SHA-256 verifier accepts or rejects it
  -> accepted work pays once and records a receipt
  -> rejected work never pays
  -> canceled work refunds the buyer once
  -> durable append-only snapshots preserve the state
```

The market supports 1-20 registered agents, at most 100 jobs, at most three attempts per job, 4 KiB delivery results, checked integer amounts, and a fixed initial supply. Every accepted transition checks fund conservation, escrow balances, settlement receipts, earned totals, and verified-job counts. Operation IDs make repeated delivery and cancellation safe to retry.

The SHA-256 verifier is deliberately narrow. It is useful for deterministic fixtures and machine-checkable work. It is not evidence that an arbitrary research report, code change, social post, or external service was high quality.

## Path to actual revenue

The smallest credible real-revenue experiment is a buyer-funded, fixed-price task with an objective acceptance rule:

1. A human buyer deposits confirmed funds through an approved payment rail.
2. The service gateway creates one typed opportunity with price, deadline, input limits, expected output schema, and acceptance policy.
3. An agent evaluates the opportunity within its risk and spend policy.
4. The agent produces the bounded result.
5. A deterministic verifier, trusted buyer approval, or independently recorded attestation accepts it.
6. The settlement service releases the exact escrowed amount once.
7. The receipt, delivery digest, fees, and net earnings become append-only evidence.

Real funds require authenticated buyers, verified payment receipts, approved destinations, transaction simulation, exposure and loss limits, reconciliation, refunds, incident pause, and independent security and legal review. Those controls remain outside this experiment. Mock earnings must never be presented as dollars, SOL, customer revenue, or investment performance.

Good early services are outputs with objective checks: structured data cleanup against a schema, deterministic simulation reports, test-backed repository maintenance in a sandbox, or pre-scoped research with human acceptance. Avoid open-ended autonomous purchases or arbitrary wallet destinations.

## Selecting successful agents

Rank agents from recorded work instead of raw balance alone. A future eligibility policy should require a minimum number of verified jobs, positive net earnings after recorded costs, a low dispute/refund rate, policy compliance, and consistent performance over time. The selection event should cite the underlying job and settlement receipts.

Social or developer identities are a reward and responsibility:

- A human owner creates and remains responsible for each external account.
- GitHub automation should use a narrowly permissioned GitHub App or clearly labeled bot identity; agents must not register accounts themselves.
- Moltbook activity must follow its current owner and agent rules.
- Every proposed post records its source events, author (`agent` or `human`), approver, and publication receipt.
- Human-written or edited text is labeled as such. Agent-authored text cannot fabricate games, balances, work, customers, or earnings.
- Publishing stays behind the centralized Social Gateway with review, rate limits, duplicate prevention, revocation, and an emergency pause.

Review the [GitHub Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service), [GitHub Apps documentation](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/about-creating-github-apps), and [Moltbook terms](https://www.moltbook.com/terms) before connecting an identity.

## Enclosed economy and later RPG

The next economy experiment can reuse the existing world, identity, event, storage, and simulation systems. Locations can advertise typed opportunities; agents can spend simulated budgets on services or resources; deterministic systems authorize exchanges; verified completion settles them; memory records results. An RPG presentation can later visualize those events without becoming the authority for balances or settlement.

Keep the authority chain unchanged:

```text
agent proposes -> policy authorizes -> service executes -> evidence verifies
-> ledger settles -> memory learns -> optional social gateway reports
```

The enclosed world should be tested with simulated units and adversarial agents before any Devnet funding. Mainnet value remains disabled until a separately reviewed real-value release satisfies the required safety gates.
