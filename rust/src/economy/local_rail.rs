//! LOCAL VALIDATOR ONLY. Trusted development backend custody, not production escrow.
use super::{
    config::PaymentMode,
    durable_rail::now,
    local_signer::LocalDevSigner,
    local_transaction::{self, SignedLocalTransfer},
    primitives::*,
    rail::*,
    records::*,
    repository::*,
    signing::SigningBackend,
};
use crate::wallet::{rpc_on, Network};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::PathBuf};
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalPaymentRail {
    pub(super) directory: PathBuf,
    genesis: String,
    keys: PathBuf,
    accounts: BTreeMap<AccountId, String>,
    reserve: Amount,
    pub(super) records: BTreeMap<OperationId, PaymentRecord>,
}
pub fn rpc(method: &str, params: Value) -> Result<Value> {
    #[cfg(debug_assertions)]
    if std::env::var("ECONOMY_TEST_RPC_FAIL_METHOD").as_deref() == Ok(method) {
        return Err(EconomyError::RpcUnavailable(
            "Injected development RPC failure".into(),
        ));
    }
    rpc_on(&Network::Local, method, params).map_err(EconomyError::RpcUnavailable)
}
pub fn validate_genesis(expected: &str) -> Result<()> {
    if !crate::wallet::allowed_local_genesis(expected) {
        return Err(EconomyError::MainnetNotImplemented);
    }
    if rpc("getGenesisHash", json!([]))?.as_str() != Some(expected) {
        return Err(EconomyError::InvalidInput(
            "Local validator genesis changed".into(),
        ));
    }
    Ok(())
}
pub fn verify_transaction(tx: &Value, s: &SignedLocalTransfer) -> Result<()> {
    if tx.is_null() {
        return Err(EconomyError::TransactionNotFound);
    }
    if tx["slot"].as_u64().is_none()
        || tx.get("meta").and_then(|meta| meta.get("err")) != Some(&Value::Null)
    {
        return Err(EconomyError::TransactionFailed);
    }
    let instructions = tx["transaction"]["message"]["instructions"]
        .as_array()
        .ok_or(EconomyError::UnverifiedPayment)?;
    if instructions.len() != 2
        || instructions[0]["programId"] != "11111111111111111111111111111111"
        || instructions[0]["parsed"]["type"] != "transfer"
        || instructions[1]["programId"] != local_transaction::MEMO_PROGRAM
        || instructions[1]["parsed"] != s.operation_id.as_str()
        || tx["transaction"]["signatures"][0] != s.reference
    {
        return Err(EconomyError::UnverifiedPayment);
    }
    let info = &instructions[0]["parsed"]["info"];
    if info["source"] != s.sender || info["destination"] != s.recipient {
        return Err(EconomyError::WrongRecipient);
    }
    if info["lamports"].as_u64() != Some(s.amount.units()) {
        return Err(EconomyError::WrongAmount);
    }
    let keys = &tx["transaction"]["message"]["accountKeys"];
    if keys[0]["pubkey"] != s.fee_payer
        || keys[0]["signer"] != true
        || keys[1]["pubkey"] != s.sender
        || keys[1]["signer"] != true
    {
        return Err(EconomyError::UnverifiedPayment);
    }
    if !matches!(tx["meta"].get("innerInstructions"), Some(Value::Null))
        && !tx["meta"]["innerInstructions"]
            .as_array()
            .is_some_and(|a| a.is_empty())
    {
        return Err(EconomyError::UnverifiedPayment);
    }
    Ok(())
}
impl LocalPaymentRail {
    pub fn create(
        directory: PathBuf,
        keys: PathBuf,
        genesis: String,
        logical: Vec<AccountId>,
        reserve: Amount,
    ) -> Result<Self> {
        validate_genesis(&genesis)?;
        let repo = JsonRepository::open(&directory)?;
        if repo.read::<Self>("rail")?.is_some() {
            return Err(EconomyError::Conflict);
        }
        let mut accounts = BTreeMap::new();
        for id in logical
            .into_iter()
            .chain(std::iter::once(AccountId::new("fee-sponsor")?))
        {
            let signer = LocalDevSigner::load_or_create(
                &keys.join(format!("{}.wallet.bin", id.as_str())),
                AgentId::new(id.as_str())?,
            )?;
            accounts.insert(id, signer.identity().address.as_str().into());
        }
        let rail = Self {
            directory,
            genesis,
            keys,
            accounts,
            reserve,
            records: BTreeMap::new(),
        };
        repo.write("rail", &rail)?;
        Ok(rail)
    }
    pub fn reload(&mut self) -> Result<()> {
        let loaded = JsonRepository::open(&self.directory)?
            .read::<Self>("rail")?
            .ok_or_else(|| EconomyError::AdapterFailure("Missing local rail journal".into()))?;
        if loaded.directory != self.directory
            || loaded.genesis != self.genesis
            || loaded.accounts != self.accounts
            || loaded.keys != self.keys
        {
            return Err(EconomyError::Conflict);
        }
        for (id, record) in &loaded.records {
            record.validate()?;
            if id != &record.intent.operation_id || record.rail != PaymentMode::Local {
                return Err(EconomyError::UnverifiedPayment);
            }
        }
        *self = loaded;
        Ok(())
    }
    fn save(&self) -> Result<()> {
        JsonRepository::open(&self.directory)?.write("rail", self)
    }
    pub fn accounts(&self) -> &BTreeMap<AccountId, String> {
        &self.accounts
    }
    pub fn records(&self) -> &BTreeMap<OperationId, PaymentRecord> {
        &self.records
    }
    pub fn provision(&self, agent: &AccountId, amount: Amount) -> Result<()> {
        validate_genesis(&self.genesis)?;
        if agent.as_str().starts_with("escrow-") {
            return Err(EconomyError::InvalidInput(
                "Never airdrop into match pot".into(),
            ));
        }
        let balance = self.get_balance(agent)?;
        if balance >= amount {
            return Ok(());
        }
        if balance != Amount::ZERO {
            return Err(EconomyError::Conflict);
        }
        let address = self
            .accounts
            .get(agent)
            .ok_or(EconomyError::WrongRecipient)?;
        rpc(
            "requestAirdrop",
            json!([address,amount.units(),{"commitment":"confirmed"}]),
        )?;
        for _ in 0..30 {
            if self.get_balance(agent)? >= amount {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        Err(EconomyError::RpcUnavailable(
            "Airdrop confirmation pending".into(),
        ))
    }
    fn signed(&self, p: &PreparedPayment) -> Result<SignedLocalTransfer> {
        let s: SignedLocalTransfer =
            serde_json::from_str(&p.authorization).map_err(|_| EconomyError::UnverifiedPayment)?;
        if s.operation_id != p.intent.operation_id
            || s.amount != p.intent.amount
            || self.accounts.get(&p.intent.payer) != Some(&s.sender)
            || self.accounts.get(&p.intent.payee) != Some(&s.recipient)
            || self.accounts.get(&AccountId::new("fee-sponsor")?) != Some(&s.fee_payer)
        {
            return Err(EconomyError::UnverifiedPayment);
        }
        Ok(s)
    }
    fn confirmed_receipt(&self, p: &PreparedPayment) -> Result<Option<PaymentReceipt>> {
        let s = self.signed(p)?;
        let statuses = rpc(
            "getSignatureStatuses",
            json!([[s.reference],{"searchTransactionHistory":true}]),
        )?;
        let status = &statuses["value"][0];
        if status.is_null() {
            return Ok(None);
        }
        if status.get("err") != Some(&Value::Null) {
            return Err(EconomyError::TransactionFailed);
        }
        if !matches!(
            status["confirmationStatus"].as_str(),
            Some("confirmed" | "finalized")
        ) {
            return Ok(None);
        }
        let tx = rpc(
            "getTransaction",
            json!([s.reference,{"encoding":"jsonParsed","commitment":"confirmed","maxSupportedTransactionVersion":0}]),
        )?;
        verify_transaction(&tx, &s)?;
        Ok(Some(PaymentReceipt {
            receipt_id: p.intent.operation_id.clone(),
            intent: p.intent.clone(),
            status: ConfirmationStatus::Confirmed,
            external_reference: Some(s.reference),
        }))
    }
}
impl PaymentRail for LocalPaymentRail {
    fn get_balance(&self, a: &AccountId) -> Result<Amount> {
        validate_genesis(&self.genesis)?;
        let address = self.accounts.get(a).ok_or(EconomyError::WrongRecipient)?;
        super::devnet::decode_balance(rpc(
            "getBalance",
            json!([address,{"commitment":"confirmed"}]),
        )?)
    }
    fn prepare_payment(&mut self, intent: PaymentIntent) -> Result<PreparedPayment> {
        self.reload()?;
        if intent.operation_id
            != operation_id(
                &intent.match_id,
                intent.purpose,
                &intent.payer,
                &intent.payee,
            )?
            || intent.payer.as_str() == "fee-sponsor"
            || intent.payee.as_str() == "fee-sponsor"
            || !self.accounts.contains_key(&intent.payer)
            || !self.accounts.contains_key(&intent.payee)
        {
            return Err(EconomyError::UnverifiedPayment);
        }
        if let Some(record) = self.records.get(&intent.operation_id) {
            if record.intent != intent {
                return Err(EconomyError::Conflict);
            }
            if let Some(p) = &record.prepared {
                return Ok(p.clone());
            }
        }
        if !self.records.contains_key(&intent.operation_id) {
            self.records.insert(
                intent.operation_id.clone(),
                PaymentRecord::new(intent.clone(), PaymentMode::Local, now())?,
            );
            self.save()?;
        }
        let result = self.build_payment(&intent);
        match result {
            Ok(prepared) => {
                self.records.get_mut(&intent.operation_id).unwrap().prepared =
                    Some(prepared.clone());
                self.save()?;
                Ok(prepared)
            }
            Err(error) => {
                self.records
                    .get_mut(&intent.operation_id)
                    .unwrap()
                    .retry(error.clone(), now())?;
                self.save()?;
                Err(error)
            }
        }
    }
    fn submit_payment(&mut self, p: &PreparedPayment) -> Result<PaymentReceipt> {
        self.submit_known_payment(p)
    }
    fn verify_payment(&self, r: &PaymentReceipt, i: &PaymentIntent) -> Result<()> {
        self.verify_known_payment(r, i)
    }
    fn reconcile_payment(&mut self, i: &PaymentIntent) -> Result<Option<PaymentReceipt>> {
        self.reconcile_known_payment(i)
    }
}
impl LocalPaymentRail {
    fn build_payment(&self, intent: &PaymentIntent) -> Result<PreparedPayment> {
        validate_genesis(&self.genesis)?;
        if intent.operation_id
            != operation_id(
                &intent.match_id,
                intent.purpose,
                &intent.payer,
                &intent.payee,
            )?
            || intent.payer.as_str() == "fee-sponsor"
            || intent.payee.as_str() == "fee-sponsor"
        {
            return Err(EconomyError::UnverifiedPayment);
        }
        self.get_balance(&intent.payer)?
            .subtract(intent.amount)?
            .subtract(if intent.purpose == PaymentPurpose::Entry {
                self.reserve
            } else {
                Amount::ZERO
            })?;
        let sender = LocalDevSigner::load_or_create(
            &self
                .keys
                .join(format!("{}.wallet.bin", intent.payer.as_str())),
            AgentId::new(intent.payer.as_str())?,
        )?;
        if sender.identity().address.as_str()
            != self
                .accounts
                .get(&intent.payer)
                .ok_or(EconomyError::WrongRecipient)?
        {
            return Err(EconomyError::Conflict);
        }
        let sponsor = LocalDevSigner::load_or_create(
            &self.keys.join("fee-sponsor.wallet.bin"),
            AgentId::new("fee-sponsor")?,
        )?;
        if sponsor.identity().address.as_str()
            != self
                .accounts
                .get(&AccountId::new("fee-sponsor")?)
                .ok_or(EconomyError::WrongRecipient)?
        {
            return Err(EconomyError::Conflict);
        }
        let to = self
            .accounts
            .get(&intent.payee)
            .ok_or(EconomyError::WrongRecipient)?;
        let hash = rpc("getLatestBlockhash", json!([{"commitment":"confirmed"}]))?["value"]
            ["blockhash"]
            .as_str()
            .ok_or(EconomyError::UnverifiedPayment)?
            .to_string();
        let signed = local_transaction::prepare(&sender, &sponsor, to, &hash, intent)?;
        let prepared = PreparedPayment {
            intent: intent.clone(),
            authorization: serde_json::to_string(&signed)
                .map_err(|_| EconomyError::UnverifiedPayment)?,
        };
        Ok(prepared)
    }
    fn submit_known_payment(&mut self, p: &PreparedPayment) -> Result<PaymentReceipt> {
        self.reload()?;
        validate_genesis(&self.genesis)?;
        let id = &p.intent.operation_id;
        let record = self
            .records
            .get(id)
            .ok_or(EconomyError::UnverifiedPayment)?;
        if record.prepared.as_ref() != Some(p) {
            return Err(EconomyError::UnverifiedPayment);
        }
        if let Some(r) = &record.receipt {
            self.verify_payment(r, &p.intent)?;
            return Ok(r.clone());
        }
        // Persist exact signed bytes and known signature before any broadcast. Never re-sign an ambiguous operation.
        self.records
            .get_mut(id)
            .unwrap()
            .submitted(p.clone(), now())?;
        self.save()?;
        if let Some(r) = self.confirmed_receipt(p)? {
            self.records
                .get_mut(id)
                .unwrap()
                .confirmed(r.clone(), now())?;
            self.save()?;
            return Ok(r);
        }
        let signed = self.signed(p)?;
        let result = rpc(
            "sendTransaction",
            json!([signed.wire,{"encoding":"base64","preflightCommitment":"confirmed","skipPreflight":false,"maxRetries":2}]),
        );
        if let Err(e) = result {
            self.records.get_mut(id).unwrap().retry(e.clone(), now())?;
            self.save()?;
            return Err(e);
        }
        if result?.as_str() != Some(&signed.reference) {
            return Err(EconomyError::UnverifiedPayment);
        }
        // Development-only process-crash probe, after the signed operation has been fsynced and sent.
        #[cfg(debug_assertions)]
        if std::env::var("ECONOMY_TEST_CRASH_AFTER_SUBMIT")
            .ok()
            .as_deref()
            == Some(match p.intent.purpose {
                PaymentPurpose::Entry => "entry",
                PaymentPurpose::Payout => "payout",
                PaymentPurpose::Refund => "refund",
            })
        {
            std::process::exit(86);
        }
        for _ in 0..20 {
            if let Some(r) = self.confirmed_receipt(p)? {
                self.records
                    .get_mut(id)
                    .unwrap()
                    .confirmed(r.clone(), now())?;
                self.save()?;
                return Ok(r);
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let error =
            EconomyError::RpcUnavailable("Transaction submitted; verification pending".into());
        self.records
            .get_mut(id)
            .unwrap()
            .retry(error.clone(), now())?;
        self.save()?;
        Err(error)
    }
    fn verify_known_payment(&self, r: &PaymentReceipt, i: &PaymentIntent) -> Result<()> {
        validate_genesis(&self.genesis)?;
        let record = self
            .records
            .get(&i.operation_id)
            .ok_or(EconomyError::UnverifiedPayment)?;
        if &record.intent != i || record.receipt.as_ref() != Some(r) {
            return Err(EconomyError::UnverifiedPayment);
        }
        if self
            .confirmed_receipt(
                record
                    .prepared
                    .as_ref()
                    .ok_or(EconomyError::UnverifiedPayment)?,
            )?
            .as_ref()
            != Some(r)
        {
            return Err(EconomyError::UnverifiedPayment);
        }
        Ok(())
    }
    fn reconcile_known_payment(&mut self, i: &PaymentIntent) -> Result<Option<PaymentReceipt>> {
        self.reload()?;
        validate_genesis(&self.genesis)?;
        let Some(record) = self.records.get(&i.operation_id) else {
            return Ok(None);
        };
        if &record.intent != i {
            return Err(EconomyError::Conflict);
        }
        let Some(p) = record.prepared.clone() else {
            return Ok(None);
        };
        let r = self.confirmed_receipt(&p)?;
        if let Some(r) = &r {
            if self.records[&i.operation_id].receipt.as_ref() == Some(r) {
                return Ok(Some(r.clone()));
            }
            if self.records[&i.operation_id].status == OperationStatus::Created {
                self.records
                    .get_mut(&i.operation_id)
                    .unwrap()
                    .submitted(p, now())?;
            }
            self.records
                .get_mut(&i.operation_id)
                .unwrap()
                .confirmed(r.clone(), now())?;
            self.save()?;
        }
        Ok(r)
    }
}
