//! Drives the real transport against a live server. Not a unit test: it needs
//! something listening, so it lives as an example the CI job runs explicitly.
use sync::wire::*;
use sync::{http::HttpTransport, OutboxEntry, SyncEngine, SyncStore};

#[derive(Default)]
struct Mem {
    cursor: i64,
    outbox: Vec<OutboxEntry>,
}
impl SyncStore for Mem {
    fn cursor(&self) -> sync::Result<i64> { Ok(self.cursor) }
    fn set_cursor(&mut self, c: i64) -> sync::Result<()> { self.cursor = c; Ok(()) }
    fn outbox(&self, n: usize) -> sync::Result<Vec<OutboxEntry>> { Ok(self.outbox.iter().take(n).cloned().collect()) }
    fn clear_outbox(&mut self, ids: &[i64]) -> sync::Result<()> { self.outbox.retain(|e| !ids.contains(&e.id)); Ok(()) }
    fn apply_remote(&mut self, _c: &PulledChange) -> sync::Result<()> { Ok(()) }
    fn version_of(&self, _e: &str, _i: &str) -> sync::Result<i64> { Ok(0) }
    fn converge(&mut self, _r: &Rejected) -> sync::Result<()> { Ok(()) }
    fn record_conflict(&mut self, _c: &Escalated) -> sync::Result<()> { Ok(()) }
}

fn main() {
    let api = std::env::args().nth(1).expect("usage: smoke <api-url>");
    let mut store = Mem::default();
    store.outbox.push(OutboxEntry {
        id: 1,
        batch_key: "batch-smoke".into(),
        change: ChangeRecord {
            entity: "widgets".into(), entity_id: "w1".into(),
            operation: Operation::Upsert,
            payload: Some(serde_json::json!({"name": "from the install"})),
            base_version: 0,
            updated_at: "2026-08-28T10:00:00.000Z".into(),
        },
    });

    let mut engine = SyncEngine::new(HttpTransport::new(&api), store, "k".repeat(40));
    let hs = engine.handshake().expect("handshake");
    println!("handshake: install={} cursor={} interval={:?}", hs.install_id, hs.cursor, hs.schedule.interval_seconds);
    let report = engine.sync_cycle().expect("cycle");
    println!("cycle: pushed={} pulled={} cursor={}", report.pushed, report.pulled, report.cursor);
}
