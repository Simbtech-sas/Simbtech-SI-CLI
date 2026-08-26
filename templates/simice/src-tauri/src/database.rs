//! Local persistence, on SQLite or Postgres.
//!
//! Which one is a deployment question, not a code question:
//!
//! - **SQLite** — one machine, one process, zero administration. The right
//!   default for `standalone` and for the local half of `cloud-sync`.
//! - **Postgres** — several machines on a LAN sharing one dataset. `lan-server`
//!   needs a real server: SQLite over a network share corrupts, because its
//!   locking assumes a local filesystem.
//!
//! Both are ACID. The difference is concurrency, not correctness.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Sqlite,
    Postgres,
}

impl Engine {
    pub fn from_env() -> Self {
        match option_env!("SIMBKIT_DATABASE") {
            Some("postgres") => Engine::Postgres,
            _ => Engine::Sqlite,
        }
    }

    /// Migrations are per-engine: the DDL dialects differ enough that one file
    /// cannot serve both without becoming a lowest common denominator.
    pub fn migrations_dir(self) -> &'static str {
        match self {
            Engine::Sqlite => "migrations/sqlite",
            Engine::Postgres => "migrations/postgres",
        }
    }
}

/// Connection string for the chosen engine.
///
/// For Postgres this comes from the environment at runtime, because it names a
/// host and a credential that differ per install. For SQLite it is a file inside
/// the app's own data directory.
pub fn connection_string(engine: Engine) -> String {
    match engine {
        Engine::Sqlite => "sqlite:simbkit.db".to_string(),
        Engine::Postgres => std::env::var("SIMBKIT_DATABASE_URL").unwrap_or_else(|_| {
            // Fail loudly at first use rather than silently opening the wrong
            // database: a LAN deployment pointing at localhost is a split dataset.
            "postgres://simbkit@localhost:5432/simbkit".to_string()
        }),
    }
}
