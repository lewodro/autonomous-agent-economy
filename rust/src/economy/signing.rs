use super::primitives::*;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct PublicAddress(String);
impl PublicAddress {
    pub fn new(address: impl Into<String>) -> Result<Self> {
        let address = address.into();
        if address.is_empty()
            || address.len() > 128
            || !address
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b":-_.".contains(&b))
        {
            return Err(EconomyError::InvalidInput(
                "Public address required; secrets are not identities".into(),
            ));
        }
        Ok(Self(address))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl TryFrom<String> for PublicAddress {
    type Error = EconomyError;
    fn try_from(value: String) -> Result<Self> {
        Self::new(value)
    }
}
impl From<PublicAddress> for String {
    fn from(value: PublicAddress) -> String {
        value.0
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WalletIdentity {
    pub agent_id: AgentId,
    pub address: PublicAddress,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SigningDomain {
    PublicMessage,
    MockTransaction,
    SolanaTransaction,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedArtifact {
    pub signer: PublicAddress,
    pub domain: SigningDomain,
    pub signature: String,
}
/// Secrets and backend handles never implement Serialize or enter an agent observation.
pub trait SigningBackend {
    fn identity(&self) -> WalletIdentity;
    fn sign_message(&self, message: &[u8]) -> Result<SignedArtifact>;
    fn sign_transaction(&self, _native_message: &[u8]) -> Result<SignedArtifact> {
        Err(EconomyError::NotImplemented(
            "Native transaction signing requires a chain-specific policy backend".into(),
        ))
    }
}
