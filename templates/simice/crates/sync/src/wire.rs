//! The wire format, mirroring the SiSAAS `sync` module exactly.
//!
//! These structs are the contract between two codebases in two languages, and
//! the last time they were written independently the mobile clients and the API
//! disagreed about where a refresh token lived. So every field here is named
//! after the server's, and a rename on either side breaks deserialisation
//! loudly rather than silently producing `None`.
//!
//! Server: `apps/server/src/modules/sync/` in the SaaS this install syncs with.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Upsert,
    Delete,
}

/// A change the server has that this install has not seen.
#[derive(Debug, Clone, Deserialize)]
pub struct PulledChange {
    pub seq: i64,
    pub entity: String,
    #[serde(rename = "entityId")]
    pub entity_id: String,
    pub operation: Operation,
    pub payload: Option<serde_json::Value>,
    /// Store this. It becomes `base_version` when this install edits the record.
    pub version: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PullResult {
    pub changes: Vec<PulledChange>,
    pub cursor: i64,
    /// The batch was capped. Pull again immediately rather than waiting.
    pub more: bool,
}

/// A local change on its way up.
#[derive(Debug, Clone, Serialize)]
pub struct ChangeRecord {
    pub entity: String,
    #[serde(rename = "entityId")]
    pub entity_id: String,
    pub operation: Operation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    /// The version this install last saw. 0 means "I believe this is new".
    ///
    /// This is the entire conflict mechanism: if the server has moved past it,
    /// somebody else edited the record while this machine was offline.
    #[serde(rename = "baseVersion")]
    pub base_version: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Reconciled {
    pub entity: String,
    #[serde(rename = "entityId")]
    pub entity_id: String,
    pub outcome: String,
}

/// A conflict a person has to settle. Surface it; do not retry it.
#[derive(Debug, Clone, Deserialize)]
pub struct Escalated {
    #[serde(rename = "conflictId")]
    pub conflict_id: String,
    pub entity: String,
    #[serde(rename = "entityId")]
    pub entity_id: String,
    pub reason: String,
}

/// Refused, with the authoritative record attached so the client can converge.
#[derive(Debug, Clone, Deserialize)]
pub struct Rejected {
    pub entity: String,
    #[serde(rename = "entityId")]
    pub entity_id: String,
    pub remote: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PushResult {
    pub applied: i64,
    pub skipped: i64,
    #[serde(default)]
    pub reconciled: Vec<Reconciled>,
    #[serde(default)]
    pub escalated: Vec<Escalated>,
    #[serde(default)]
    pub rejected: Vec<Rejected>,
    pub cursor: i64,
}

/// The cadence, owned by the SERVER.
///
/// Deliberately not a local setting: changing how often a site syncs must not
/// require touching a machine that may sit behind a customer's firewall and be
/// reachable only by someone driving there.
#[derive(Debug, Clone, Deserialize)]
pub struct Schedule {
    #[serde(rename = "intervalSeconds")]
    pub interval_seconds: Option<i64>,
    #[serde(rename = "windowStart")]
    pub window_start: Option<String>,
    #[serde(rename = "windowEnd")]
    pub window_end: Option<String>,
    pub timezone: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Handshake {
    #[serde(rename = "installId")]
    pub install_id: String,
    pub label: Option<String>,
    pub cursor: i64,
    pub schedule: Schedule,
    /// Lets this install measure its own clock skew, which decides every
    /// last-write-wins outcome.
    #[serde(rename = "serverTime")]
    pub server_time: String,
}
