fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match agent_arena_demo::wallet_demo::execute(&args) {
        Ok(value) => println!("{}", serde_json::to_string_pretty(&value).unwrap()),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
