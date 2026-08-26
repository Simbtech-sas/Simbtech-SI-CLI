//! The cloud-sync client.
//!
//! The SaaS side of this protocol shipped complete — handshake, pull, push,
//! presigned files, conflicts — and this side did not exist: `Mode::CloudSync`
//! set an enum and nothing more. This is the other half.
//!
//! **Neither HTTP nor the database is a dependency.** Both are traits, for two
//! reasons that turned out to matter: the Tauri app crate cannot be compiled
//! without GTK/WebKit headers, and a protocol whose tests need a network is a
//! protocol nobody tests. Everything here runs against fakes in milliseconds.

pub mod wire;

#[cfg(feature = "http")]
pub mod http;

use std::collections::HashMap;
use thiserror::Error;
use wire::{ChangeRecord, Escalated, Handshake, PullResult, PushResult, Rejected};

#[derive(Debug, Error)]
pub enum SyncError {
    #[error("transport: {0}")]
    Transport(String),
    #[error("server returned {status}: {body}")]
    Status { status: u16, body: String },
    #[error("could not read the server's reply: {0}")]
    Decode(String),
    #[error("local store: {0}")]
    Store(String),
}

pub type Result<T> = std::result::Result<T, SyncError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
}

/// One HTTP round trip. The app crate implements this with `reqwest`.
pub trait Transport {
    /// `path` is relative to the sync base, e.g. `/pull?since=12`.
    ///
    /// Returns the status and the raw body rather than a parsed value, so a 5xx
    /// with an HTML error page is a `Status`, not a confusing decode failure.
    fn send(
        &self,
        method: Method,
        path: &str,
        headers: &[(&str, &str)],
        body: Option<String>,
    ) -> Result<(u16, String)>;
}

/// What the client must remember between runs.
///
/// The versions matter as much as the cursor: without the version this install
/// last saw for a record, every push claims `baseVersion: 0` — "I believe this
/// is new" — and the server treats a genuine edit as a create.
pub trait SyncStore {
    fn cursor(&self) -> Result<i64>;
    fn set_cursor(&mut self, cursor: i64) -> Result<()>;

    /// Local changes waiting to go up, oldest first.
    fn outbox(&self, limit: usize) -> Result<Vec<OutboxEntry>>;
    /// Called only after the server has confirmed the batch.
    fn clear_outbox(&mut self, ids: &[i64]) -> Result<()>;

    /// Apply a change the server sent, and record its version. One transaction
    /// with `set_cursor`, or a crash between them replays or loses a change.
    fn apply_remote(&mut self, change: &wire::PulledChange) -> Result<()>;

    /// The version this install last saw, or 0 when it has never seen one.
    fn version_of(&self, entity: &str, entity_id: &str) -> Result<i64>;

    /// Overwrite a local record with the server's, after a rejection.
    fn converge(&mut self, rejected: &Rejected) -> Result<()>;

    /// Park a conflict for a person. A queue nobody reads is deletion, slower.
    fn record_conflict(&mut self, conflict: &Escalated) -> Result<()>;
}

/// A queued local change, with the idempotency key of the batch it belongs to.
#[derive(Debug, Clone)]
pub struct OutboxEntry {
    pub id: i64,
    pub change: ChangeRecord,
    /// Generated when the entry is queued, NOT when it is sent.
    ///
    /// That is the whole point: a push that times out is retried with the same
    /// key, and the server returns the original result instead of applying the
    /// batch twice. A key made at send time turns every timeout into a double
    /// application — which for financial records is the failure this mechanism
    /// exists to survive.
    pub batch_key: String,
}

/// Batches are capped by the server at 500; stay under it.
pub const MAX_BATCH: usize = 250;

pub struct SyncEngine<T: Transport, S: SyncStore> {
    transport: T,
    store: S,
    sync_key: String,
}

#[derive(Debug, Default, Clone)]
pub struct CycleReport {
    pub pulled: usize,
    pub pushed: usize,
    pub rejected: usize,
    pub escalated: usize,
    pub cursor: i64,
}

impl<T: Transport, S: SyncStore> SyncEngine<T, S> {
    pub fn new(transport: T, store: S, sync_key: String) -> Self {
        Self { transport, store, sync_key }
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    fn call(&self, method: Method, path: &str, body: Option<String>, idem: Option<&str>) -> Result<String> {
        let mut headers: Vec<(&str, &str)> = vec![
            // A MACHINE credential, not a user token: different audience,
            // different revocation story. The server reads the tenant from the
            // install this key identifies — a machine that could name its own
            // tenant could name someone else's.
            ("x-sync-key", self.sync_key.as_str()),
        ];
        if body.is_some() {
            headers.push(("content-type", "application/json"));
        }
        if let Some(key) = idem {
            headers.push(("idempotency-key", key));
        }

        let (status, text) = self.transport.send(method, path, &headers, body)?;
        if !(200..300).contains(&status) {
            return Err(SyncError::Status { status, body: text });
        }
        Ok(text)
    }

    pub fn handshake(&self) -> Result<Handshake> {
        let body = self.call(Method::Get, "/handshake", None, None)?;
        serde_json::from_str(&body).map_err(|e| SyncError::Decode(e.to_string()))
    }

    /// Pull once. Returns the batch; the caller decides whether to loop.
    fn pull_once(&mut self) -> Result<PullResult> {
        let since = self.store.cursor()?;
        let body = self.call(Method::Get, &format!("/pull?since={since}"), None, None)?;
        let result: PullResult =
            serde_json::from_str(&body).map_err(|e| SyncError::Decode(e.to_string()))?;

        for change in &result.changes {
            self.store.apply_remote(change)?;
        }
        // Advanced from the SERVER's cursor, never by counting locally: the
        // server skips this install's own writes, so the sequence has holes and
        // `since + len` would silently step over other machines' changes.
        self.store.set_cursor(result.cursor)?;
        Ok(result)
    }

    /// Pull until the server says there is no more.
    ///
    /// Bounded: a server that always answers `more: true` is a bug, and an
    /// unbounded loop turns it into a hang with no log line.
    pub fn pull_all(&mut self, max_rounds: usize) -> Result<usize> {
        let mut total = 0;
        for _ in 0..max_rounds {
            let batch = self.pull_once()?;
            total += batch.changes.len();
            if !batch.more {
                return Ok(total);
            }
        }
        Ok(total)
    }

    /// Send one batch of queued local changes.
    ///
    /// The batch's idempotency key comes from the OUTBOX, so a retry after a
    /// timeout replays the same key and the server returns the original result.
    pub fn push_batch(&mut self) -> Result<Option<PushResult>> {
        let entries = self.store.outbox(MAX_BATCH)?;
        if entries.is_empty() {
            return Ok(None);
        }

        // One key per batch. Entries queued together share it; a partially sent
        // outbox keeps its key on the next attempt.
        let batch_key = entries[0].batch_key.clone();
        let batch: Vec<&OutboxEntry> =
            entries.iter().filter(|e| e.batch_key == batch_key).collect();

        let mut changes = Vec::with_capacity(batch.len());
        for entry in &batch {
            let mut change = entry.change.clone();
            // Filled in HERE, not when the change was queued: the record may
            // have been pulled and updated while this entry sat in the outbox,
            // and sending the stale version would report a conflict that is not
            // one.
            change.base_version = self.store.version_of(&change.entity, &change.entity_id)?;
            changes.push(change);
        }

        let payload = serde_json::json!({ "changes": changes });
        let body = self.call(
            Method::Post,
            "/push",
            Some(payload.to_string()),
            Some(&batch_key),
        )?;
        let result: PushResult =
            serde_json::from_str(&body).map_err(|e| SyncError::Decode(e.to_string()))?;

        // Converge on anything the server refused, so the next push is not the
        // same argument again.
        for rejected in &result.rejected {
            self.store.converge(rejected)?;
        }
        // Park escalations. Retrying one is how a conflict becomes a loop.
        for escalated in &result.escalated {
            self.store.record_conflict(escalated)?;
        }

        // Cleared only now. If the process dies before this line the batch is
        // re-sent with the same key and the server deduplicates it — which is
        // the correct outcome, and the reason the key is stored rather than
        // generated.
        let ids: Vec<i64> = batch.iter().map(|e| e.id).collect();
        self.store.clear_outbox(&ids)?;
        self.store.set_cursor(result.cursor)?;
        Ok(Some(result))
    }

    /// One full cycle: send what we have, then take what we are missing.
    ///
    /// Push first on purpose. Pulling first would apply a remote edit over a
    /// local one that has not been offered yet, and the local change would then
    /// push as a conflict against a version it never saw.
    pub fn sync_cycle(&mut self) -> Result<CycleReport> {
        let mut report = CycleReport::default();

        while let Some(result) = self.push_batch()? {
            report.pushed += result.applied as usize;
            report.rejected += result.rejected.len();
            report.escalated += result.escalated.len();
            if result.applied == 0 && result.skipped == 0 && result.rejected.is_empty() {
                break;
            }
        }

        report.pulled = self.pull_all(64)?;
        report.cursor = self.store.cursor()?;
        Ok(report)
    }

    /// Conflicts the server is holding for a person.
    pub fn conflicts(&self) -> Result<serde_json::Value> {
        let body = self.call(Method::Get, "/conflicts", None, None)?;
        serde_json::from_str(&body).map_err(|e| SyncError::Decode(e.to_string()))
    }

    pub fn resolve_conflict(
        &self,
        conflict_id: &str,
        choice: &str,
        merged: Option<serde_json::Value>,
    ) -> Result<()> {
        let mut payload = serde_json::json!({ "conflictId": conflict_id, "choice": choice });
        if let Some(merged) = merged {
            payload["mergedPayload"] = merged;
        }
        self.call(Method::Post, "/conflicts/resolve", Some(payload.to_string()), None)?;
        Ok(())
    }

    /// A presigned URL to PUT a file to. The file never passes through the API.
    pub fn upload_url(&self, filename: &str, content_type: &str) -> Result<String> {
        let payload =
            serde_json::json!({ "filename": filename, "contentType": content_type });
        let body =
            self.call(Method::Post, "/files/upload-url", Some(payload.to_string()), None)?;
        let parsed: HashMap<String, serde_json::Value> =
            serde_json::from_str(&body).map_err(|e| SyncError::Decode(e.to_string()))?;
        parsed
            .get("url")
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .ok_or_else(|| SyncError::Decode(format!("no url in {body}")))
    }
}

#[cfg(test)]
mod tests;
