use super::primitives::*;
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FeePolicy {
    pub winner_share_bps: u16,
    pub house_fee_bps: u16,
}
impl Default for FeePolicy {
    fn default() -> Self {
        Self {
            winner_share_bps: 10000,
            house_fee_bps: 0,
        }
    }
}
impl FeePolicy {
    pub fn validate(self) -> Result<()> {
        if u32::from(self.winner_share_bps) + u32::from(self.house_fee_bps) != 10000 {
            return Err(EconomyError::InvalidInput(
                "Fee shares must total 10000 basis points".into(),
            ));
        }
        Ok(())
    }
    pub fn prototype(self) -> Result<()> {
        self.validate()?;
        if self.house_fee_bps != 0 {
            return Err(EconomyError::NotImplemented(
                "Prototype settlement has no house fee recipient".into(),
            ));
        }
        Ok(())
    }
}
