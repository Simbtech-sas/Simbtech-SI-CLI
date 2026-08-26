//! Bridges the pure `licence` crate to the running app: where the token lives,
//! what this machine's fingerprint is, and the high-water clock mark that makes
//! rollback detection possible.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use licence::{public_key_from_hex, verify, Licence, LicenceError, Status};
use serde::Serialize;

/// The issuing public key, baked in at build time.
///
/// Set `SIMBKIT_LICENCE_PUBLIC_KEY` when building a release. The private half
/// never leaves your signing machine — if it leaks, every licence ever issued
/// becomes forgeable and the only fix is shipping a new binary.
pub const PUBLIC_KEY_HEX: &str = match option_env!("SIMBKIT_LICENCE_PUBLIC_KEY") {
    Some(key) => key,
    // Development default. A release build with this key installed is a build
    // anyone can mint licences for; CI should fail if it survives to production.
    None => "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29",
};

#[derive(Debug, Serialize)]
pub struct LicenceReport {
    pub state: &'static str,
    pub customer: Option<String>,
    pub expires_at: Option<i64>,
    pub days_remaining: Option<i64>,
    pub features: Vec<String>,
    pub message: String,
}

impl LicenceReport {
    fn denied(message: String) -> Self {
        Self {
            state: "denied",
            customer: None,
            expires_at: None,
            days_remaining: None,
            features: Vec::new(),
            message,
        }
    }
}

pub struct LicenceStore {
    dir: PathBuf,
    cached: Mutex<Option<Licence>>,
}

impl LicenceStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            cached: Mutex::new(None),
        }
    }

    fn token_path(&self) -> PathBuf {
        self.dir.join("licence.key")
    }

    /// Highest timestamp ever observed. Persisted so winding the clock back
    /// between runs is still detected.
    fn clock_mark_path(&self) -> PathBuf {
        self.dir.join("clock.mark")
    }

    fn read_clock_mark(&self) -> Option<i64> {
        fs::read_to_string(self.clock_mark_path())
            .ok()
            .and_then(|s| s.trim().parse().ok())
    }

    fn write_clock_mark(&self, now: i64) {
        let highest = self.read_clock_mark().map_or(now, |seen| seen.max(now));
        let _ = fs::create_dir_all(&self.dir);
        let _ = fs::write(self.clock_mark_path(), highest.to_string());
    }

    pub fn install(&self, token: &str) -> Result<(), String> {
        // Verify before storing: an invalid token must never reach disk and get
        // trusted on the next start.
        self.evaluate_token(token).map_err(|e| e.to_string())?;
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        fs::write(self.token_path(), token.trim()).map_err(|e| e.to_string())
    }

    fn evaluate_token(&self, token: &str) -> Result<(Licence, Status), LicenceError> {
        let key = public_key_from_hex(PUBLIC_KEY_HEX)?;
        let now = chrono::Utc::now().timestamp();
        let machine = machine_fingerprint();
        let result = verify(token, &key, now, self.read_clock_mark(), machine.as_deref());
        if result.is_ok() {
            self.write_clock_mark(now);
        }
        result
    }

    /// Called at startup and on a timer. A licence that expires while the app is
    /// open must eventually stop it, or a long-running install never expires.
    pub fn report(&self) -> LicenceReport {
        let token = match fs::read_to_string(self.token_path()) {
            Ok(t) => t,
            Err(_) => return LicenceReport::denied("No licence installed.".into()),
        };

        match self.evaluate_token(&token) {
            Ok((licence, status)) => {
                *self.cached.lock().unwrap() = Some(licence.clone());
                let (state, days, message) = match status {
                    Status::Valid { expires_in_days } => (
                        "valid",
                        Some(expires_in_days),
                        format!("Licensed to {}.", licence.customer),
                    ),
                    Status::Grace { days_remaining } => (
                        "grace",
                        Some(days_remaining),
                        format!(
                            "Licence expired. {days_remaining} day(s) of grace left — renew now."
                        ),
                    ),
                };
                LicenceReport {
                    state,
                    customer: Some(licence.customer),
                    expires_at: Some(licence.expires_at),
                    days_remaining: days,
                    features: licence.features,
                    message,
                }
            }
            Err(err) => {
                *self.cached.lock().unwrap() = None;
                LicenceReport::denied(err.to_string())
            }
        }
    }

    pub fn has_feature(&self, feature: &str) -> bool {
        self.cached
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|l| l.has_feature(feature))
    }
}

/// Stable per-machine id. `None` when it cannot be read, which makes a
/// machine-bound licence fail closed rather than open.
pub fn machine_fingerprint() -> Option<String> {
    machine_uid::get().ok()
}
