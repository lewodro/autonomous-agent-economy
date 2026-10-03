//! Restricted two-signer System transfer + operation memo. Fee sponsor is outside the pot.
use super::{
    devnet::SolanaPublicKey, local_signer::LocalDevSigner, primitives::*, rail::*,
    signing::SigningBackend,
};
use serde::{Deserialize, Serialize};
pub const MEMO_PROGRAM: &str = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedLocalTransfer {
    pub reference: String,
    pub wire: String,
    pub sender: String,
    pub recipient: String,
    pub fee_payer: String,
    pub amount: Amount,
    pub operation_id: OperationId,
}
pub fn prepare(
    sender: &LocalDevSigner,
    sponsor: &LocalDevSigner,
    to: &str,
    blockhash: &str,
    intent: &PaymentIntent,
) -> Result<SignedLocalTransfer> {
    let from = sender.identity().address.as_str().to_string();
    let fee = sponsor.identity().address.as_str().to_string();
    if from == to
        || fee == from
        || fee == to
        || intent.amount == Amount::ZERO
        || intent.amount.units() > 1_000_000_000
    {
        return Err(EconomyError::InvalidInput(
            "Restricted local transfer accounts/amount".into(),
        ));
    }
    let decode = |s: &str| -> Result<Vec<u8>> {
        let key = SolanaPublicKey::parse(s)?;
        bs58::decode(key.address())
            .into_vec()
            .map_err(|_| EconomyError::UnverifiedPayment)
    };
    let mut message = vec![2, 0, 2, 5];
    for key in [
        &fee,
        &from,
        to,
        "11111111111111111111111111111111",
        MEMO_PROGRAM,
    ] {
        message.extend(decode(key)?);
    }
    message.extend(decode(blockhash)?);
    message.extend([2, 3, 2, 1, 2, 12]);
    message.extend(2u32.to_le_bytes());
    message.extend(intent.amount.units().to_le_bytes());
    let memo = intent.operation_id.as_str().as_bytes();
    message.extend([4, 1, 1, memo.len() as u8]);
    message.extend(memo);
    let fee_signature = sponsor.signature(&message);
    let from_signature = sender.signature(&message);
    let mut wire = vec![2];
    wire.extend(fee_signature);
    wire.extend(from_signature);
    wire.extend(message);
    Ok(SignedLocalTransfer {
        reference: bs58::encode(fee_signature).into_string(),
        wire: crate::wallet::base64(&wire),
        sender: from,
        recipient: to.into(),
        fee_payer: fee,
        amount: intent.amount,
        operation_id: intent.operation_id.clone(),
    })
}
