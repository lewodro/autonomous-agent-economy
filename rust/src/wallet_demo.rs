use crate::solana_wallet::{confirm, SolanaWallet};
use crate::wallet::*;
use ed25519_dalek::SigningKey;
use serde_json::json;
use std::{fs::OpenOptions, io::Write};
pub fn execute(args: &[String]) -> Result<serde_json::Value, String> {
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--devnet" | "--local" | "--fund" | "--transfer" => {}
            "--load-test-wallet" | "--save-test-wallet" | "--match" => {
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
    let local = args.iter().any(|a| a == "--local");
    if devnet && local {
        return Err("Choose one test network".into());
    }
    let network = if local {
        Network::Local
    } else {
        Network::Devnet
    };
    let networked = devnet || local;
    if local && std::env::var("LOCAL_GENESIS_HASH").ok().is_none_or(|hash| hash.trim().is_empty()) {
        return Err("--local requires an explicit LOCAL_GENESIS_HASH before wallet activity".into());
    }
    let mode = if local {
        WalletMode::Local
    } else if devnet {
        WalletMode::Devnet
    } else {
        WalletMode::Mock
    };
    let rpc = |method: &str, params| rpc_on(&network, method, params);
    let fund = args.iter().any(|a| a == "--fund");
    let transfer = args.iter().any(|a| a == "--transfer");
    let path_flag = |flag: &str| {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
    };
    if (fund || transfer) && !networked {
        return Err("--fund/--transfer require --devnet or --local".into());
    }
    let associated = if let Some(path) = path_flag("--match") {
        let input: crate::model::Replay =
            serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let checked = crate::replay::verify(&input)?;
        if !checked.final_state.ended || checked.winner.is_none() {
            return Err("Reward demo requires a verified completed match with a winner".into());
        }
        Some(checked)
    } else {
        None
    };
    let signer = if let Some(path) = path_flag("--load-test-wallet") {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        let seed: [u8; 32] = bytes
            .try_into()
            .map_err(|_| "Use a 32-byte TEST wallet file")?;
        SigningKey::from_bytes(&seed)
    } else if networked {
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
    let recipient = if networked {
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
        if networked {
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
    if networked {
        let mut capability =
            SolanaWallet::new(signer.clone(), network.clone(), destination.clone())?;
        if fund {
            let signature = rpc(
                "requestAirdrop",
                json!([payer,1_000_000_000,{"commitment":"confirmed"}]),
            )?
            .as_str()
            .ok_or("Invalid faucet signature")?
            .to_string();
            confirm(&network, &signature)?;
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
            capability.transfer(&destination, 1_000_000)?;
            events.extend(capability.activity.clone());
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
                mode: WalletMode::Mock,
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
    for (i, e) in events.iter_mut().enumerate() {
        e.seq = i;
        if let Some(run) = &associated {
            e.turn = run.final_state.turn;
        }
    }
    Ok(
        json!({"mode":mode,"wallet":AgentWallet{address:payer,balance,spending_limit:if transfer||!networked {0}else{1_000_000},mode:mode.clone()},"recipient":destination,"events":events,"match_id":associated.as_ref().map(|r|r.match_id.clone()),"agent_id":associated.as_ref().and_then(|r|r.winner.clone()),"purpose":if associated.is_some(){"Winner reward capability demo"}else{"Wallet capability demo"},"note":"Wallet funds are separate from survival credits. Test keys only."}),
    )
}
