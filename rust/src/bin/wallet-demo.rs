fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match agent_arena_demo::wallet_demo::execute(&args) {
        Ok(value) => {
            println!("{}", serde_json::to_string_pretty(&value).unwrap());
            if value["success"] == false {
                std::process::exit(1);
            }
        }
        Err(error) => {
            println!(
                "{}",
                serde_json::json!({"success":false,"error":error,"events":[{"seq":0,"type":"WalletOperationFailed","reason":error}]})
            );
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
