use super::{primitives::*, signing::*};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier};
use sha2::{Digest, Sha256};
/// Deterministic TEST keys. Never use these known derivations for funded wallets.
pub struct MockSigner {
    identity: WalletIdentity,
    key: SigningKey,
}
fn payload(domain: SigningDomain, message: &[u8]) -> Vec<u8> {
    let prefix: &[u8] = match domain {
        SigningDomain::PublicMessage => b"last-seat/public-message/v1\0",
        SigningDomain::MockTransaction => b"last-seat/mock-transaction/v1\0",
    };
    [prefix, message].concat()
}
impl MockSigner {
    pub fn new(agent: AgentId, seed: u32) -> Result<Self> {
        let bytes: [u8; 32] = Sha256::digest(
            [
                b"last-seat/test-signer/v1:".as_slice(),
                &seed.to_le_bytes(),
                agent.as_str().as_bytes(),
            ]
            .concat(),
        )
        .into();
        let key = SigningKey::from_bytes(&bytes);
        let identity = WalletIdentity {
            agent_id: agent,
            address: PublicAddress::new(
                bs58::encode(key.verifying_key().to_bytes()).into_string(),
            )?,
        };
        Ok(Self { identity, key })
    }
    fn sign(&self, domain: SigningDomain, message: &[u8]) -> Result<SignedArtifact> {
        if message.len() > 16_384 {
            return Err(EconomyError::InvalidInput(
                "Signing payload exceeds 16 KB".into(),
            ));
        }
        let signature = self.key.sign(&payload(domain, message));
        Ok(SignedArtifact {
            signer: self.identity.address.clone(),
            domain,
            signature: bs58::encode(signature.to_bytes()).into_string(),
        })
    }
    pub fn verify(
        &self,
        domain: SigningDomain,
        message: &[u8],
        artifact: &SignedArtifact,
    ) -> Result<()> {
        if artifact.signer != self.identity.address
            || artifact.domain != domain
            || message.len() > 16_384
            || artifact.signature.len() > 128
        {
            return Err(EconomyError::UnverifiedPayment);
        }
        let bytes = bs58::decode(&artifact.signature)
            .into_vec()
            .map_err(|_| EconomyError::UnverifiedPayment)?;
        let signature =
            Signature::from_slice(&bytes).map_err(|_| EconomyError::UnverifiedPayment)?;
        self.key
            .verifying_key()
            .verify(&payload(domain, message), &signature)
            .map_err(|_| EconomyError::UnverifiedPayment)
    }
}
impl SigningBackend for MockSigner {
    fn identity(&self) -> WalletIdentity {
        self.identity.clone()
    }
    fn sign_message(&self, message: &[u8]) -> Result<SignedArtifact> {
        self.sign(SigningDomain::PublicMessage, message)
    }
    fn sign_transaction(&self, message: &[u8]) -> Result<SignedArtifact> {
        self.sign(SigningDomain::MockTransaction, message)
    }
}
