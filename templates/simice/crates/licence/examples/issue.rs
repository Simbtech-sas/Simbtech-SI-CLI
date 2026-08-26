//! Licence issuing tool. Runs on YOUR machine, never ships to a customer.
//!
//!   # once, then keep the private key somewhere safe and offline
//!   cargo run -p licence --example issue -- keygen
//!
//!   cargo run -p licence --example issue -- sign \
//!       --key <private-hex> --customer "Acme Ltd" --days 365 \
//!       [--machine <fingerprint>] [--features reports,payroll] [--grace 14]
//!
//! The public half goes into the build:
//!   SIMBKIT_LICENCE_PUBLIC_KEY=<public-hex> npm run tauri build

use std::env;

use ed25519_dalek::SigningKey;
use licence::{encode, Licence};

fn arg(args: &[String], name: &str) -> Option<String> {
    let at = args.iter().position(|a| a == name)?;
    args.get(at + 1).cloned()
}

fn main() {
    let args: Vec<String> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("keygen") => {
            let signing = SigningKey::generate(&mut rand::rng());
            println!("private (KEEP SECRET): {}", hex::encode(signing.to_bytes()));
            println!("public  (bake into the build): {}", hex::encode(signing.verifying_key().to_bytes()));
        }
        Some("sign") => {
            let key_hex = arg(&args, "--key").expect("--key <private-hex> is required");
            let customer = arg(&args, "--customer").expect("--customer <name> is required");
            let days: i64 = arg(&args, "--days").unwrap_or_else(|| "365".into()).parse().expect("--days must be a number");
            let grace: u32 = arg(&args, "--grace").unwrap_or_else(|| "0".into()).parse().expect("--grace must be a number");

            let bytes: [u8; 32] = hex::decode(key_hex).expect("private key is not hex")
                .try_into().expect("private key must be 32 bytes");
            let signing = SigningKey::from_bytes(&bytes);

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;

            let lic = Licence {
                id: format!("lic_{now}"),
                product: "simbkit".into(),
                customer,
                issued_at: now,
                expires_at: now + days * 86_400,
                grace_days: grace,
                features: arg(&args, "--features")
                    .map(|f| f.split(',').map(|s| s.trim().to_string()).collect())
                    .unwrap_or_default(),
                machine: arg(&args, "--machine"),
                seats: arg(&args, "--seats").and_then(|s| s.parse().ok()).unwrap_or(1),
            };

            println!("{}", encode(&lic, &signing).expect("failed to sign"));
        }
        _ => {
            eprintln!("usage: issue keygen | issue sign --key <hex> --customer <name> [--days N] [--grace N] [--machine FP] [--features a,b] [--seats N]");
            std::process::exit(2);
        }
    }
}
