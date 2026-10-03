# Overnight architecture handoff

Baseline `040` / `ab742b4`; 28 logical changes, numbered **041–068**.
The Rust V6 rules, existing live table, RPS and wallet/tool-payment demos are retained.
No mainnet, custody deployment or live paid match admission was enabled.

## Validation recorded on 2026-10-03

| Check | Result |
|---|---|
| Node tests | 72 passing, including Rust-to-TypeScript projection and opt-in lab HTTP integration |
| Rust tests | 53 passing; separate release-only replay stress test also passed |
| TypeScript / syntax / formatting | `npm run lint` passed |
| Production compile | `npm run build` passed |
| Mock economy | Free, 0.02 and 0.05 examples; 0.03/20-agent funding also covered |
| Settlement/refund safety | Duplicate payment, lost payout response, lost partial-refund response, verified draw and wrong-run tests passed |
| Wallet signing | Deterministic Ed25519 message verification and tamper/domain tests passed |
| Devnet balance | Real fixed-RPC/genesis balance read succeeded; economy payment submission disabled |
| Game browser | Desktop + 360/390/430px mobile; host/viewer, pause, share, 20 agents and reduced motion passed |
| Economy lab browser | Fund, lock, authoritative winner, repeated settlement and mobile layout passed |
| Balance smoke | 120 fresh V6 matches; raw data and measured strategy limitations in balance report |

Integration server tests require permission to bind localhost in restricted sandboxes.
Chrome smoke scripts require a page on debugging port 9322; the lab also requires
`ECONOMY_LAB=1`. They are explicit local checks, not a claim of browser CI coverage.

## Next implementation boundary

Start with durable operation/receipt storage and trusted host completion attestation.
Then implement native local-validator payment/escrow/signing adapters and verify
0.02–0.05 test SOL entries, refunds, fees and interrupted settlement. Only afterward
repeat on devnet and consider host runtime admission. See
[mainnet readiness](mainnet-readiness.md) for the exact sequence and blockers.

Keep economy events separate from game resource events. Public reasons expose a
brief summary and selected observable facts; wiring that structure into the normal
spectator inspector is still a next pass. Mock treasury, signer and lab are ephemeral.
The frontend economy effect port exists but the normal board does not receive paid
funding events yet. See [architecture](economy-architecture.md),
[threat model](threat-model.md), [transport](live-economy-transport.md) and
[animation migration](animation-stack.md).

## Commits

Each entry contains a real implementation or documentation change. Exact subjects:

- `041_update_architecture_economy_boundary_audit`
- `042_update_economy_checked_amounts_and_typed_identifiers`
- `043_update_economy_validated_lifecycle_transitions`
- `044_update_economy_config_exact_decimal_policy_mainnet_guard`
- `045_update_economy_match_projection_and_semantic_event_family`
- `046_update_economy_atomic_mock_treasury_accounts`
- `047_update_payment_rail_intents_receipts_and_capability_contract`
- `048_update_mock_payment_rail_verified_idempotent_transfers`
- `049_update_match_escrow_contract_and_public_status`
- `050_update_mock_escrow_verified_deposits_lock_and_terminal_retries`
- `051_update_economy_stable_run_binding_and_verified_result_authorization`
- `052_update_economy_coordinator_mock_funding_lock_and_run_gate`
- `053_update_verified_winner_settlement_and_idempotent_payouts`
- `054_update_explicit_refund_policy_and_prelock_failure_recovery`
- `055_update_public_wallet_identity_and_signing_backend_ports`
- `056_update_deterministic_mock_signer_and_signature_domain_tests`
- `057_update_readonly_solana_devnet_rail_and_mainnet_rejection`
- `058_update_economy_scenario_schema_and_free_funded_examples`
- `059_update_executable_mock_economy_demo_and_devnet_balance_probe`
- `060_update_typed_frontend_economy_event_projection`
- `061_update_replaceable_economy_animation_adapter`
- `062_update_mock_only_developer_economy_lab`
- `063_update_public_rationale_and_provider_boundary_contracts`
- `064_document_economy_threat_model_and_funded_match_readiness`
- `065_fix_uncertain_settlement_draw_refunds_and_stream_contract`
- `066_document_economy_diagrams_modes_and_developer_workflows`
- `067_document_animation_candidates_and_live_economy_transport_seams`
- `068_update_economy_integration_ci_and_overnight_validation`
