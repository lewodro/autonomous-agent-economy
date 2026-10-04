//! Observed durable payment facts, on the existing ordered economy stream.
//! Recovery may observe submission and confirmation together; these are not network timestamps.
use super::{
    events::EconomyEventKind as K, host::FundedHost, primitives::*, rail::PaymentPurpose,
    records::OperationStatus,
};
impl FundedHost {
    pub(super) fn observe_payment_events(&mut self) -> Result<()> {
        let mut facts = vec![];
        if let Some(record) = &self.snapshot.settlement {
            facts.push(K::SettlementPending {
                winner: record.winner_id.clone(),
                amount: record.payout_amount,
                operation_id: record.settlement_id.clone(),
            });
        }
        for record in self.snapshot.economy.rail.records().values() {
            let id = record.intent.operation_id.clone();
            let amount = record.intent.amount;
            let submitted = matches!(
                record.status,
                OperationStatus::Submitted | OperationStatus::Confirmed
            );
            let confirmed = record.status == OperationStatus::Confirmed;
            match record.intent.purpose {
                PaymentPurpose::Entry => {
                    let agent_id = AgentId::new(record.intent.payer.as_str())?;
                    facts.push(K::EntryPaymentCreated {
                        agent_id: agent_id.clone(),
                        amount,
                        operation_id: id.clone(),
                    });
                    if submitted {
                        facts.push(K::EntryPaymentSubmitted {
                            agent_id: agent_id.clone(),
                            amount,
                            operation_id: id.clone(),
                        });
                    }
                    if confirmed {
                        facts.push(K::EntryPaymentConfirmed {
                            agent_id,
                            amount,
                            operation_id: id,
                        });
                    }
                }
                PaymentPurpose::Payout => {
                    let winner = AgentId::new(record.intent.payee.as_str())?;
                    if submitted {
                        facts.push(K::SettlementSubmitted {
                            winner: winner.clone(),
                            amount,
                            operation_id: id.clone(),
                        });
                    }
                    if confirmed {
                        facts.push(K::SettlementConfirmed {
                            winner,
                            amount,
                            operation_id: id,
                        });
                    }
                }
                PaymentPurpose::Refund => {
                    let agent_id = AgentId::new(record.intent.payee.as_str())?;
                    if submitted {
                        facts.push(K::RefundSubmitted {
                            agent_id: agent_id.clone(),
                            amount,
                            operation_id: id.clone(),
                        });
                    }
                    if confirmed {
                        facts.push(K::RefundConfirmed {
                            agent_id,
                            amount,
                            operation_id: id,
                        });
                    }
                }
            }
        }
        for kind in facts {
            if !self
                .snapshot
                .economy
                .events()
                .iter()
                .any(|e| e.kind == kind)
            {
                self.snapshot.economy.emit(kind);
            }
        }
        Ok(())
    }
}
