use super::{
    backend_escrow::TrustedBackendEscrow,
    backend_rail::BackendRail,
    binding::SimulationBinding,
    config::PaymentMode,
    coordinator::EconomyCoordinator,
    durable_rail::{now, DurableMockRail},
    host::{FundedHost, HostSnapshot},
    host_config::FundedMatchConfig,
    local_rail::LocalPaymentRail,
    mock_rail::MockPaymentRail,
    primitives::*,
    repository::*,
    treasury::TreasuryLedger,
};
use std::path::Path;
impl FundedHost {
    pub fn create(root: &Path, session: &str, config: FundedMatchConfig) -> Result<Self> {
        config.validate()?;
        let parsed = config.economy.validate()?;
        if parsed.entry.units() > 50_000_000 || parsed.starting_balance.units() > 2_000_000_000 {
            return Err(EconomyError::InvalidInput(
                "Prototype entry cap 0.05 SOL / starting balance cap 2 SOL".into(),
            ));
        }
        let id = OperationId::new(session)?;
        let directory = root.join("sessions").join(id.as_str());
        let repository = JsonRepository::open(&directory)?;
        if repository.read::<HostSnapshot>("host")?.is_some() {
            return Err(EconomyError::Conflict);
        }
        let simulation =
            crate::engine::start(config.simulation.clone()).map_err(EconomyError::InvalidInput)?;
        let binding = SimulationBinding::from_initial(&simulation)?;
        let run = binding.run_id(&id)?;
        let escrow = AccountId::new(format!("escrow-{}", run.as_str()))?;
        let rail = match parsed.mode {
            PaymentMode::Mock => {
                let mut ledger = TreasuryLedger::default();
                ledger.open(escrow, Amount::ZERO)?;
                for a in &simulation.config.agents {
                    ledger.open(AccountId::new(&a.id)?, parsed.starting_balance)?;
                }
                BackendRail::Mock(DurableMockRail::create(
                    directory.join("rail"),
                    MockPaymentRail::new(
                        ledger,
                        if parsed.enabled {
                            parsed.minimum_reserve
                        } else {
                            Amount::ZERO
                        },
                    ),
                )?)
            }
            PaymentMode::Local => {
                let genesis = std::env::var("LOCAL_GENESIS_HASH")
                    .ok()
                    .or_else(|| {
                        std::fs::read(root.join("local-validator.json"))
                            .ok()
                            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                            .filter(|v| v["rpc"] == "http://127.0.0.1:8899")
                            .and_then(|v| v["genesis"].as_str().map(String::from))
                    })
                    .ok_or_else(|| {
                        EconomyError::InvalidInput(
                            "Run npm run solana:local or pin LOCAL_GENESIS_HASH".into(),
                        )
                    })?;
                let accounts = simulation
                    .config
                    .agents
                    .iter()
                    .map(|a| AccountId::new(&a.id))
                    .chain(std::iter::once(Ok(escrow)))
                    .collect::<Result<Vec<_>>>()?;
                let rail = LocalPaymentRail::create(
                    directory.join("rail"),
                    directory.join("keys"),
                    genesis,
                    accounts,
                    parsed.minimum_reserve,
                )?;
                for a in &simulation.config.agents {
                    rail.provision(&AccountId::new(&a.id)?, parsed.starting_balance)?;
                }
                rail.provision(&AccountId::new("fee-sponsor")?, Amount::new(2_000_000_000))?;
                BackendRail::Local(rail)
            }
            _ => {
                return Err(EconomyError::NotImplemented(
                    "Funded rail unavailable".into(),
                ))
            }
        };
        let mut economy = EconomyCoordinator::<BackendRail, TrustedBackendEscrow>::new(
            &simulation,
            &parsed,
            &id,
            rail,
        )?;
        economy.open_funding()?;
        let funding_deadline = now()
            .checked_add(config.funding_timeout_seconds)
            .ok_or(EconomyError::Overflow)?;
        let mut host = Self {
            root: root.into(),
            repository,
            snapshot: HostSnapshot {
                format: 1,
                session: id,
                config,
                simulation,
                economy,
                funding_deadline,
                attestation: None,
                settlement: None,
                cancellation: None,
            },
        };
        host.save()?;
        Ok(host)
    }
}
