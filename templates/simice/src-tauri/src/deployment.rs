//! How this install talks to the rest of the world.
//!
//! Chosen at scaffold time and readable at runtime, because the three modes need
//! genuinely different behaviour and a single binary that guesses gets it wrong.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    /// One machine, one database, no network. The default.
    Standalone,
    /// One machine runs an embedded API; other machines on the LAN connect to it.
    /// Only the server holds the database.
    LanServer,
    /// Local database plus an outbox that syncs to a cloud API when reachable.
    CloudSync,
}

impl Mode {
    pub fn from_env() -> Self {
        match option_env!("SIMBKIT_MODE") {
            Some("lan-server") => Mode::LanServer,
            Some("cloud-sync") => Mode::CloudSync,
            _ => Mode::Standalone,
        }
    }

    /// Whether this build ever opens a socket. Standalone must not.
    pub fn is_networked(self) -> bool {
        !matches!(self, Mode::Standalone)
    }
}
