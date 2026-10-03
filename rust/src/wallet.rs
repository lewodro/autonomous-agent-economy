//! Optional wallet capability. Survival credits never become wallet funds.
use ed25519_dalek::{Signer, SigningKey, Verifier};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    process::{Command, Stdio},
};
pub const DEVNET: &str = "https://api.devnet.solana.com";
pub const DEVNET_GENESIS: &str = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum WalletMode {
    #[default]
    Mock,
    Devnet,
    Local,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Network {
    Devnet,
    Local,
}
impl Network {
    pub fn endpoint(&self) -> &str {
        match self {
            Self::Devnet => DEVNET,
            Self::Local => "http://127.0.0.1:8899",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentWallet {
    pub address: String,
    pub balance: u64,
    pub spending_limit: u64,
    #[serde(default)]
    pub mode: WalletMode,
}
#[derive(Clone, Debug, Serialize)]
pub struct WalletEvent {
    pub seq: usize,
    pub turn: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub address: String,
    pub amount: u64,
    pub reason: String,
    pub signature: Option<String>,
}
pub trait WalletCapability {
    fn view(&self) -> AgentWallet;
    fn transfer(&mut self, destination: &str, amount: u64) -> Result<WalletEvent, String>;
}
pub struct MockWallet {
    pub wallet: AgentWallet,
    pub allowed_destination: String,
}
impl WalletCapability for MockWallet {
    fn view(&self) -> AgentWallet {
        self.wallet.clone()
    }
    fn transfer(&mut self, destination: &str, amount: u64) -> Result<WalletEvent, String> {
        if destination != self.allowed_destination
            || amount == 0
            || amount > self.wallet.spending_limit
            || amount > self.wallet.balance
        {
            return Err("Wallet policy denied destination, limit, or balance".into());
        }
        self.wallet.balance -= amount;
        self.wallet.spending_limit -= amount;
        Ok(WalletEvent {
            seq: 0,
            turn: 0,
            kind: "WalletTransferConfirmed".into(),
            address: self.wallet.address.clone(),
            amount,
            reason: "Mock transfer authorized; no blockchain activity".into(),
            signature: None,
        })
    }
}
pub fn mock_view(seed: u32, id: &str) -> AgentWallet {
    let bytes = Sha256::digest(format!("last-seat-mock-wallet:{seed}:{id}"));
    AgentWallet {
        address: bs58::encode(bytes).into_string(),
        balance: 2_000_000_000,
        spending_limit: 1_000_000,
        mode: WalletMode::Mock,
    }
}
pub fn key() -> Result<SigningKey, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(SigningKey::from_bytes(&bytes))
}
pub fn address(key: &SigningKey) -> String {
    bs58::encode(key.verifying_key().to_bytes()).into_string()
}
pub fn message_signature(key: &SigningKey, message: &[u8]) -> Result<String, String> {
    let signature = key.sign(message);
    key.verifying_key()
        .verify(message, &signature)
        .map_err(|e| e.to_string())?;
    Ok(bs58::encode(signature.to_bytes()).into_string())
}
pub fn rpc(method: &str, params: Value) -> Result<Value, String> {
    rpc_on(&Network::Devnet, method, params)
}
pub fn rpc_on(network: &Network, method: &str, params: Value) -> Result<Value, String> {
    let body = json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string();
    let mut child = Command::new("curl")
        .args([
            "--silent",
            "--show-error",
            "--fail",
            "--max-time",
            "15",
            network.endpoint(),
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(body.as_bytes())
        .map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Devnet RPC transport failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let value: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    if !value["error"].is_null() {
        return Err(format!("Devnet RPC error: {}", value["error"]));
    }
    Ok(value["result"].clone())
}
pub fn transfer_message(
    payer: &str,
    destination: &str,
    blockhash: &str,
    amount: u64,
) -> Result<Vec<u8>, String> {
    if amount == 0 || amount > 1_000_000 {
        return Err("Demo transfer capped at 0.001 devnet SOL".into());
    }
    let decode = |text: &str| -> Result<Vec<u8>, String> {
        let bytes = bs58::decode(text).into_vec().map_err(|e| e.to_string())?;
        if bytes.len() != 32 {
            return Err("Expected a 32-byte key or blockhash".into());
        }
        Ok(bytes)
    };
    if payer == destination {
        return Err("Use a separate approved recipient".into());
    }
    let mut message = vec![1, 0, 1, 3];
    message.extend(decode(payer)?);
    message.extend(decode(destination)?);
    message.extend([0u8; 32]);
    message.extend(decode(blockhash)?);
    message.extend([1, 2, 2, 0, 1, 12]);
    message.extend(2u32.to_le_bytes());
    message.extend(amount.to_le_bytes());
    Ok(message)
}
pub fn signed_transaction(key: &SigningKey, message: &[u8]) -> Vec<u8> {
    let mut bytes = vec![1];
    bytes.extend(key.sign(message).to_bytes());
    bytes.extend(message);
    bytes
}
pub fn base64(bytes: &[u8]) -> String {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = ((c[0] as u32) << 16)
            | ((c.get(1).copied().unwrap_or(0) as u32) << 8)
            | (c.get(2).copied().unwrap_or(0) as u32);
        out.push(alphabet[((n >> 18) & 63) as usize] as char);
        out.push(alphabet[((n >> 12) & 63) as usize] as char);
        out.push(if c.len() > 1 {
            alphabet[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            alphabet[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mock_policy() {
        let mut wallet = MockWallet {
            wallet: mock_view(42, "a"),
            allowed_destination: "b".into(),
        };
        assert!(wallet.transfer("other", 1).is_err());
        assert!(wallet.transfer("b", 1_000_001).is_err());
        wallet.transfer("b", 1_000_000).unwrap();
        assert_eq!(wallet.view().balance, 1_999_000_000);
    }
    #[test]
    fn sign_verify_tamper() {
        let key = key().unwrap();
        let sig = key.sign(b"last-seat");
        assert!(key.verifying_key().verify(b"last-seat", &sig).is_ok());
        assert!(key.verifying_key().verify(b"other", &sig).is_err());
    }
    #[test]
    fn wire_and_base64() {
        let a = key().unwrap();
        let b = key().unwrap();
        let hash = bs58::encode([5u8; 32]).into_string();
        let message = transfer_message(&address(&a), &address(&b), &hash, 1_000_000).unwrap();
        assert_eq!(signed_transaction(&a, &message).len(), 215);
        assert_eq!(base64(b"hello"), "aGVsbG8=");
        assert!(transfer_message(&address(&a), &address(&b), &hash, 1_000_001).is_err());
    }
}
