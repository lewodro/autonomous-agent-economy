use agent_arena_demo::wallet::*;
use ed25519_dalek::SigningKey;
use serde_json::json;
use std::{fs::OpenOptions, io::Write};
fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--devnet" | "--fund" | "--transfer" => {}
            "--load-test-wallet" | "--save-test-wallet" => {
                index += 1;
                if args.get(index).is_none_or(|path| path.starts_with("--")) {
                    return Err("Wallet file flag requires a path".into());
                }
            }
            other => return Err(format!("Unknown wallet demo option: {other}")),
        }
        index += 1;
    }
    let devnet = args.iter().any(|a| a == "--devnet");
    let fund = args.iter().any(|a| a == "--fund");
    let transfer = args.iter().any(|a| a == "--transfer");
    let path_flag = |flag: &str| {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
    };
    if (fund || transfer) && !devnet {
        return Err("--fund/--transfer require --devnet".into());
    }
    let signer = if let Some(path) = path_flag("--load-test-wallet") {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        let seed: [u8; 32] = bytes
            .try_into()
            .map_err(|_| "Use a 32-byte TEST wallet file")?;
        SigningKey::from_bytes(&seed)
    } else if devnet {
        key()?
    } else {
        SigningKey::from_bytes(&[42u8; 32])
    };
    if let Some(path) = path_flag("--save-test-wallet") {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(path)
            .map_err(|e| e.to_string())?
            .write_all(&signer.to_bytes())
            .map_err(|e| e.to_string())?;
    }
    let recipient = if devnet {
        key()?
    } else {
        SigningKey::from_bytes(&[43u8; 32])
    };
    let payer = address(&signer);
    let destination = address(&recipient);
    let mut events = vec![];
    let mut event = |kind: &str, amount: u64, reason: &str, signature: Option<String>| {
        events.push(WalletEvent {
            seq: events.len(),
            turn: 0,
            kind: kind.into(),
            address: payer.clone(),
            amount,
            reason: reason.into(),
            signature,
        });
    };
    event(
        "WalletCreated",
        0,
        if devnet {
            "Ephemeral or loaded TEST wallet; devnet only"
        } else {
            "Mock capability; no network"
        },
        None,
    );
    event(
        "WalletMessageSigned",
        0,
        "Signed and verified last-seat demo message",
        Some(message_signature(&signer, b"last-seat-wallet-demo-v1")?),
    );
    let balance;
    if devnet {
        if rpc("getGenesisHash", json!([]))?.as_str() != Some(DEVNET_GENESIS) {
            return Err("Unexpected network; refusing wallet activity".into());
        }
        if fund {
            let signature = rpc(
                "requestAirdrop",
                json!([payer,1_000_000_000,{"commitment":"confirmed"}]),
            )?
            .as_str()
            .ok_or("Invalid faucet signature")?
            .to_string();
            confirm(&signature)?;
            event(
                "WalletFundsReceived",
                1_000_000_000,
                "Confirmed devnet faucet test funds",
                Some(signature),
            );
        }
        let before = rpc("getBalance", json!([payer,{"commitment":"confirmed"}]))?["value"]
            .as_u64()
            .ok_or("Invalid balance")?;
        event(
            "WalletBalanceRead",
            before,
            "Confirmed devnet SOL balance, in lamports",
            None,
        );
        if transfer {
            let blockhash = rpc("getLatestBlockhash", json!([{"commitment":"confirmed"}]))?
                ["value"]["blockhash"]
                .as_str()
                .ok_or("Invalid blockhash")?
                .to_string();
            let message = transfer_message(&payer, &destination, &blockhash, 1_000_000)?;
            let fee = rpc(
                "getFeeForMessage",
                json!([base64(&message),{"commitment":"confirmed"}]),
            )?["value"]
                .as_u64()
                .ok_or("Expired fee estimate")?;
            if before < 1_000_000 + fee + 890_880 {
                return Err("Need faucet funds plus fee and reserve before transfer".into());
            }
            let transaction = signed_transaction(&signer, &message);
            let simulation = rpc(
                "simulateTransaction",
                json!([base64(&transaction),{"encoding":"base64","commitment":"confirmed","sigVerify":true}]),
            )?;
            if !simulation["value"]["err"].is_null() {
                return Err(format!(
                    "Simulation rejected: {}",
                    simulation["value"]["err"]
                ));
            }
            event(
                "WalletTransferRequested",
                1_000_000,
                "Approved generated recipient; 0.001 SOL cap; simulated before sending",
                None,
            );
            let signature=rpc("sendTransaction",json!([base64(&transaction),{"encoding":"base64","preflightCommitment":"confirmed","maxRetries":2}]))?.as_str().ok_or("Invalid transfer signature")?.to_string();
            confirm(&signature)?;
            event(
                "WalletTransferConfirmed",
                1_000_000,
                "Confirmed tiny devnet transfer",
                Some(signature),
            );
            event(
                "WalletNetworkFee",
                fee,
                "Network fee recorded separately from transfer",
                None,
            );
        }
        balance = rpc("getBalance", json!([payer,{"commitment":"confirmed"}]))?["value"]
            .as_u64()
            .ok_or("Invalid final balance")?;
    } else {
        let mut wallet = MockWallet {
            wallet: AgentWallet {
                address: payer.clone(),
                balance: 2_000_000_000,
                spending_limit: 1_000_000,
            },
            allowed_destination: destination.clone(),
        };
        wallet.transfer(&destination, 1_000_000)?;
        balance = wallet.view().balance;
        event(
            "WalletTransferConfirmed",
            1_000_000,
            "Mock authorized transfer; no network or real funds",
            None,
        );
    }
    println!("{}",serde_json::to_string_pretty(&json!({"mode":if devnet{"solana-devnet"}else{"mock"},"wallet":AgentWallet{address:payer,balance,spending_limit:1_000_000},"recipient":destination,"events":events,"note":"Wallet funds are separate from survival credits. Test keys only; never put wallet files into agent prompts or git."})).unwrap());
    Ok(())
}
fn confirm(signature: &str) -> Result<(), String> {
    for _ in 0..20 {
        let result = rpc(
            "getSignatureStatuses",
            json!([[signature],{"searchTransactionHistory":true}]),
        )?;
        let status = &result["value"][0];
        if !status["err"].is_null() {
            return Err(format!("Transaction failed: {}", status["err"]));
        }
        if matches!(
            status["confirmationStatus"].as_str(),
            Some("confirmed" | "finalized")
        ) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    Err("Confirmation timed out; check the public signature before retrying".into())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
