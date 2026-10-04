use agent_arena_demo::economy::config::EconomyConfig;
#[test]
fn monetary_configuration_errors_identify_the_field_and_required_remedy() {
    let valid = serde_json::json!({"enabled":true,"mode":"mock","entry_amount_sol":"0.02","starting_balance_sol":"1","maximum_entry_sol":"0.05","minimum_reserve_sol":"0.005"});
    for field in [
        "entry_amount_sol",
        "starting_balance_sol",
        "maximum_entry_sol",
        "minimum_reserve_sol",
    ] {
        let mut value = valid.clone();
        value[field] = serde_json::json!("-1");
        let error = serde_json::from_value::<EconomyConfig>(value)
            .unwrap()
            .validate()
            .unwrap_err();
        assert!(error.to_string().contains(field));
    }
    for (field, value) in [
        ("entry_amount_sol", serde_json::json!("0.06")),
        ("starting_balance_sol", serde_json::json!("0.001")),
        ("enabled", serde_json::json!(false)),
    ] {
        let mut bad = valid.clone();
        bad[field] = value;
        assert!(serde_json::from_value::<EconomyConfig>(bad)
            .unwrap()
            .validate()
            .is_err());
    }
}
