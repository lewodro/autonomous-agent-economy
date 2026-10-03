use super::primitives::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentTreasury {
    pub agent_id: AgentId,
    pub balance: Amount,
}
/// In-memory mock accounting. All balance changes are checked before mutation.
#[derive(Clone, Debug, Default)]
pub struct TreasuryLedger {
    accounts: BTreeMap<AccountId, Amount>,
}
impl TreasuryLedger {
    pub fn open(&mut self, id: AccountId, balance: Amount) -> Result<()> {
        if self.accounts.contains_key(&id) {
            return Err(EconomyError::Conflict);
        }
        self.total()?.add(balance)?;
        self.accounts.insert(id, balance);
        Ok(())
    }
    pub fn balance(&self, id: &AccountId) -> Result<Amount> {
        self.accounts
            .get(id)
            .copied()
            .ok_or_else(|| EconomyError::InvalidInput("Unknown account".into()))
    }
    pub fn transfer(&mut self, from: &AccountId, to: &AccountId, amount: Amount) -> Result<()> {
        if from == to {
            return Err(EconomyError::InvalidInput(
                "Distinct accounts required".into(),
            ));
        }
        let debit = self.balance(from)?.subtract(amount)?;
        let credit = self.balance(to)?.add(amount)?;
        self.accounts.insert(from.clone(), debit);
        self.accounts.insert(to.clone(), credit);
        Ok(())
    }
    pub fn total(&self) -> Result<Amount> {
        self.accounts
            .values()
            .try_fold(Amount::ZERO, |sum, v| sum.add(*v))
    }
    pub fn agent(&self, id: &AgentId) -> Result<AgentTreasury> {
        Ok(AgentTreasury {
            agent_id: id.clone(),
            balance: self.balance(&AccountId::new(id.as_str())?)?,
        })
    }
}
