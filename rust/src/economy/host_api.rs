//! Thin worker transport. Never accepts a proposed winner, receipt or attestation from the browser.
use super::{host::FundedHost, primitives::*, refund::RefundReason};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
pub fn root() -> PathBuf {
    std::env::var_os("ECONOMY_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("matches/economy"))
}
pub fn exists(root: &Path, session: &str) -> bool {
    if OperationId::new(session).is_err() {
        return false;
    }
    std::fs::read_dir(root.join("sessions").join(session))
        .ok()
        .is_some_and(|mut entries| {
            entries.any(|e| {
                e.ok().is_some_and(|e| {
                    e.file_name().to_string_lossy().starts_with("host--")
                        && e.path().extension().is_some_and(|x| x == "json")
                })
            })
        })
}
pub fn request(v: &Value) -> Result<Value> {
    let root = root();
    let action = v["action"]
        .as_str()
        .ok_or_else(|| EconomyError::InvalidInput("action required".into()))?;
    if action == "list" {
        return Ok(json!({"sessions":FundedHost::list(&root)?}));
    }
    let session = v["session"]
        .as_str()
        .ok_or_else(|| EconomyError::InvalidInput("session required".into()))?;
    if action == "discard-unfunded" {
        return Ok(json!({"removed":FundedHost::discard_unfunded(&root, session)?}));
    }
    if action == "create" {
        let config = serde_json::from_value(v["config"].clone())
            .map_err(|e| EconomyError::InvalidInput(e.to_string()))?;
        let h = FundedHost::create(&root, session, config)?;
        return Ok(json!({"session":session,"replay":h.replay(),"economy":h.view()}));
    }
    let mut h = FundedHost::load(&root, session)?;
    let value = match action {
        "get" => h.view(),
        "prepare" => {
            h.prepare_entry(v["agent_id"].as_str().ok_or(EconomyError::WrongRecipient)?)?
        }
        "fund" => h.fund(v["agent_id"].as_str().ok_or(EconomyError::WrongRecipient)?)?,
        "cancel" => h.cancel(RefundReason::CancelledBeforeStart)?,
        "expire" => h.expire()?,
        "settle" => h.finalize()?,
        "reconcile" => h.reconcile()?,
        _ => {
            return Err(EconomyError::InvalidInput(
                "Unknown funded host action".into(),
            ))
        }
    };
    Ok(json!({"session":session,"replay":h.replay(),"economy":value}))
}
pub fn game(v: &Value) -> Result<Value> {
    let session = v["session"].as_str().ok_or(EconomyError::WrongRecipient)?;
    let mut h = FundedHost::load(&root(), session)?;
    match v["command"].as_str().unwrap_or("") {
        "get" | "import" => Ok(json!({"replay":h.replay(),"economy":h.view()})),
        "observe" => Ok(
            json!({"observation":crate::engine::observe(h.replay()),"config":h.replay().config,"ended":h.replay().final_state.ended}),
        ),
        "decide" => {
            let r = h.replay();
            let o = crate::engine::observe(r);
            let decisions: Vec<_> = r
                .final_state
                .agents
                .iter()
                .enumerate()
                .filter(|(_, a)| a.alive)
                .map(|(i, _)| crate::strategy::choose(&r.config, &o, i))
                .collect();
            Ok(json!({"decisions":decisions}))
        }
        "step" => {
            let expected = v["expected_turn"]
                .as_u64()
                .unwrap_or(h.replay().final_state.turn as u64)
                .try_into()
                .map_err(|_| EconomyError::Conflict)?;
            let decisions = if v["decisions"].is_null() {
                None
            } else {
                Some(
                    serde_json::from_value(v["decisions"].clone())
                        .map_err(|_| EconomyError::InvalidInput("Bad decisions".into()))?,
                )
            };
            h.step(expected, decisions)
        }
        _ => Err(EconomyError::InvalidInput(
            "Unsupported funded session command".into(),
        )),
    }
}
