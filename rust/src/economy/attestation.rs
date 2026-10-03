//! Prototype trusted-host authority. A rule-valid browser tape is not host authorization.
use super::{
    binding::SettlementResult, coordinator::EconomyCoordinator, escrow::MatchEscrow, primitives::*,
    rail::PaymentRail,
};
use crate::{model::Replay, replay};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompletionClaims {
    pub match_id: RunId,
    pub engine_version: String,
    pub final_history_id: String,
    pub final_state_hash: String,
    pub event_log_hash: String,
    pub winner_id: Option<String>,
    pub completed_at: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompletionAttestation {
    pub claims: CompletionClaims,
    pub signature: String,
}
pub struct HostAuthority {
    key: SigningKey,
}
fn digest(value: &impl Serialize) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).map_err(|_| EconomyError::InvalidAttestation)?)
    ))
}
fn claims(id: RunId, run: &Replay, time: u64) -> Result<CompletionClaims> {
    replay::verify(run).map_err(|_| EconomyError::InvalidAttestation)?;
    if !run.final_state.ended {
        return Err(EconomyError::InvalidAttestation);
    }
    Ok(CompletionClaims {
        match_id: id,
        engine_version: run.simulation_version.clone(),
        final_history_id: run.match_id.clone(),
        final_state_hash: digest(&run.final_state)?,
        event_log_hash: digest(&run.events)?,
        winner_id: run.winner.clone(),
        completed_at: time,
    })
}
fn message(c: &CompletionClaims) -> Result<Vec<u8>> {
    Ok([
        b"last-seat/host-completion/v1:".as_slice(),
        &serde_json::to_vec(c).map_err(|_| EconomyError::InvalidAttestation)?,
    ]
    .concat())
}
impl HostAuthority {
    pub fn new(key: SigningKey) -> Self {
        Self { key }
    }
    pub fn public_address(&self) -> String {
        crate::wallet::address(&self.key)
    }
    pub fn attest(&self, id: RunId, run: &Replay, time: u64) -> Result<CompletionAttestation> {
        let claims = claims(id, run, time)?;
        let signature = bs58::encode(self.key.sign(&message(&claims)?).to_bytes()).into_string();
        Ok(CompletionAttestation { claims, signature })
    }
    pub fn verify(&self, id: &RunId, run: &Replay, a: &CompletionAttestation) -> Result<()> {
        if &a.claims.match_id != id
            || a.claims != claims(id.clone(), run, a.claims.completed_at)?
            || a.signature.len() > 90
        {
            return Err(EconomyError::InvalidAttestation);
        }
        let bytes = bs58::decode(&a.signature)
            .into_vec()
            .map_err(|_| EconomyError::InvalidAttestation)?;
        let signature =
            Signature::from_slice(&bytes).map_err(|_| EconomyError::InvalidAttestation)?;
        self.key
            .verifying_key()
            .verify(&message(&a.claims)?, &signature)
            .map_err(|_| EconomyError::InvalidAttestation)
    }
}
impl<R: PaymentRail, E: MatchEscrow> EconomyCoordinator<R, E> {
    pub fn settle_attested(
        &mut self,
        run: &Replay,
        attestation: &CompletionAttestation,
        authority: &HostAuthority,
    ) -> Result<SettlementResult> {
        authority.verify(&self.view().match_id, run, attestation)?;
        self.settle(run)
    }
}
