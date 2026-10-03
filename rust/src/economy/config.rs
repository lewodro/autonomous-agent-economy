use super::primitives::*;
use serde::{Deserialize, Serialize};
pub const UNITS_PER_SOL: u64 = 1_000_000_000;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentMode {
    Mock,
    Local,
    Devnet,
    Mainnet,
}
impl PaymentMode {
    pub fn validate(self) -> Result<()> {
        if self == Self::Mainnet {
            Err(EconomyError::MainnetNotImplemented)
        } else {
            Ok(())
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EconomyConfig {
    pub enabled: bool,
    pub mode: PaymentMode,
    pub entry_amount_sol: String,
    pub starting_balance_sol: String,
    pub maximum_entry_sol: String,
    pub minimum_reserve_sol: String,
}
#[derive(Clone, Debug)]
pub struct ValidatedConfig {
    pub enabled: bool,
    pub mode: PaymentMode,
    pub entry: Amount,
    pub starting_balance: Amount,
    pub minimum_reserve: Amount,
}
pub fn parse_sol(value: &str) -> Result<Amount> {
    let invalid = || {
        EconomyError::InvalidInput(
            "SOL amounts must be unsigned decimal strings with at most nine fractional digits"
                .into(),
        )
    };
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() > 2
        || parts[0].is_empty()
        || parts[0].len() > 20
        || !parts[0].bytes().all(|b| b.is_ascii_digit())
        || (parts[0].len() > 1 && parts[0].starts_with('0'))
    {
        return Err(invalid());
    }
    let whole = parts[0].parse::<u64>().map_err(|_| invalid())?;
    let fraction = if parts.len() == 2 {
        let f = parts[1];
        if f.is_empty() || f.len() > 9 || !f.bytes().all(|b| b.is_ascii_digit()) {
            return Err(invalid());
        }
        f.parse::<u64>()
            .map_err(|_| invalid())?
            .checked_mul(10u64.pow(9 - f.len() as u32))
            .ok_or(EconomyError::Overflow)?
    } else {
        0
    };
    whole
        .checked_mul(UNITS_PER_SOL)
        .and_then(|v| v.checked_add(fraction))
        .map(Amount::new)
        .ok_or(EconomyError::Overflow)
}
impl EconomyConfig {
    pub fn validate(&self) -> Result<ValidatedConfig> {
        self.mode.validate()?;
        let entry = parse_sol(&self.entry_amount_sol)?;
        let starting_balance = parse_sol(&self.starting_balance_sol)?;
        let maximum = parse_sol(&self.maximum_entry_sol)?;
        let reserve = parse_sol(&self.minimum_reserve_sol)?;
        if entry > maximum || (!self.enabled && entry != Amount::ZERO) {
            return Err(EconomyError::InvalidInput(
                "Entry exceeds policy or disabled economy must be free".into(),
            ));
        }
        if self.enabled {
            starting_balance.subtract(entry)?.subtract(reserve)?;
        }
        Ok(ValidatedConfig {
            enabled: self.enabled,
            mode: self.mode,
            entry,
            starting_balance,
            minimum_reserve: reserve,
        })
    }
}
