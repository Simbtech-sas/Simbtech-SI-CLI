//! The protocol, against fakes. No network, no database, no GUI toolkit.

use super::*;
use std::cell::RefCell;
use std::collections::HashMap;
use wire::{Operation, PulledChange};

/// method, path, body, idempotency-key — named because clippy is right that the
/// bare tuple is unreadable at the call site.
type SeenCall = (Method, String, Option<String>, Option<String>);

#[derive(Default)]
struct FakeTransport {
    /// path -> queued replies, popped in order so a test can script a sequence.
    replies: RefCell<HashMap<String, Vec<(u16, String)>>>,
    pub seen: RefCell<Vec<SeenCall>>,
}

impl FakeTransport {
    fn reply(&self, path: &str, status: u16, body: &str) {
        self.replies
            .borrow_mut()
            .entry(path.to_string())
            .or_default()
            .push((status, body.to_string()));
    }
    /// Idempotency keys the client actually sent, in order.
    fn idempotency_keys(&self) -> Vec<String> {
        self.seen
            .borrow()
            .iter()
            .filter_map(|(_, _, _, k)| k.clone())
            .collect()
    }
}

impl Transport for FakeTransport {
    fn send(
        &self,
        method: Method,
        path: &str,
        headers: &[(&str, &str)],
        body: Option<String>,
    ) -> Result<(u16, String)> {
        let idem = headers
            .iter()
            .find(|(k, _)| *k == "idempotency-key")
            .map(|(_, v)| v.to_string());
        self.seen
            .borrow_mut()
            .push((method, path.to_string(), body.clone(), idem));

        // The sync key must be on every request; forgetting it on one is a 401
        // that looks like an expired credential.
        assert!(
            headers.iter().any(|(k, _)| *k == "x-sync-key"),
            "every request carries the machine credential"
        );

        let mut replies = self.replies.borrow_mut();
        let queue = replies
            .get_mut(path)
            .unwrap_or_else(|| panic!("no scripted reply for {path}"));
        if queue.len() > 1 {
            Ok(queue.remove(0))
        } else {
            Ok(queue[0].clone())
        }
    }
}

#[derive(Default)]
struct FakeStore {
    cursor: i64,
    outbox: Vec<OutboxEntry>,
    versions: HashMap<(String, String), i64>,
    pub applied: Vec<PulledChange>,
    pub converged: Vec<String>,
    pub conflicts: Vec<String>,
    pub cleared: Vec<i64>,
}

impl SyncStore for FakeStore {
    fn cursor(&self) -> Result<i64> {
        Ok(self.cursor)
    }
    fn set_cursor(&mut self, cursor: i64) -> Result<()> {
        self.cursor = cursor;
        Ok(())
    }
    fn outbox(&self, limit: usize) -> Result<Vec<OutboxEntry>> {
        Ok(self.outbox.iter().take(limit).cloned().collect())
    }
    fn clear_outbox(&mut self, ids: &[i64]) -> Result<()> {
        self.cleared.extend_from_slice(ids);
        self.outbox.retain(|e| !ids.contains(&e.id));
        Ok(())
    }
    fn apply_remote(&mut self, change: &PulledChange) -> Result<()> {
        self.versions.insert(
            (change.entity.clone(), change.entity_id.clone()),
            change.version,
        );
        self.applied.push(change.clone());
        Ok(())
    }
    fn version_of(&self, entity: &str, entity_id: &str) -> Result<i64> {
        Ok(*self
            .versions
            .get(&(entity.to_string(), entity_id.to_string()))
            .unwrap_or(&0))
    }
    fn converge(&mut self, rejected: &Rejected) -> Result<()> {
        self.converged.push(rejected.entity_id.clone());
        Ok(())
    }
    fn record_conflict(&mut self, conflict: &Escalated) -> Result<()> {
        self.conflicts.push(conflict.conflict_id.clone());
        Ok(())
    }
}

fn entry(id: i64, entity_id: &str, key: &str) -> OutboxEntry {
    OutboxEntry {
        id,
        batch_key: key.to_string(),
        change: ChangeRecord {
            entity: "widgets".into(),
            entity_id: entity_id.into(),
            operation: Operation::Upsert,
            payload: Some(serde_json::json!({ "name": "local" })),
            base_version: 0,
            updated_at: "2026-08-28T10:00:00.000Z".into(),
        },
    }
}

const EMPTY_PUSH: &str = r#"{"applied":0,"skipped":0,"reconciled":[],"escalated":[],"rejected":[],"cursor":0}"#;

#[test]
fn the_cursor_comes_from_the_server_not_from_counting() {
    // The server never echoes an install's own writes, so the sequence has holes.
    // `since + changes.len()` would step straight over another machine's change.
    let t = FakeTransport::default();
    t.reply(
        "/pull?since=0",
        200,
        r#"{"changes":[{"seq":7,"entity":"widgets","entityId":"w1","operation":"upsert","payload":{},"version":3,"updatedAt":"2026-08-28T10:00:00.000Z"}],"cursor":9,"more":false}"#,
    );
    let mut engine = SyncEngine::new(t, FakeStore::default(), "k".repeat(32));
    assert_eq!(engine.pull_all(4).unwrap(), 1);
    assert_eq!(engine.store().cursor, 9, "cursor is the server's, not 0 + 1");
}

#[test]
fn more_means_come_straight_back() {
    let t = FakeTransport::default();
    t.reply("/pull?since=0", 200, r#"{"changes":[],"cursor":5,"more":true}"#);
    t.reply("/pull?since=5", 200, r#"{"changes":[],"cursor":8,"more":false}"#);
    let mut engine = SyncEngine::new(t, FakeStore::default(), "k".repeat(32));
    engine.pull_all(8).unwrap();
    assert_eq!(engine.store().cursor, 8);
}

#[test]
fn a_server_stuck_on_more_cannot_hang_the_client() {
    // A bug on the far side must not become a spin with no log line.
    let t = FakeTransport::default();
    t.reply("/pull?since=0", 200, r#"{"changes":[],"cursor":0,"more":true}"#);
    let mut engine = SyncEngine::new(t, FakeStore::default(), "k".repeat(32));
    assert_eq!(engine.pull_all(3).unwrap(), 0);
    // Stopped at the bound rather than spinning.
    assert_eq!(engine.transport.seen.borrow().len(), 3);
}

#[test]
fn base_version_is_read_at_send_time_not_at_queue_time() {
    // The record can be pulled and updated while the entry waits in the outbox.
    // Sending the stale 0 would report a conflict that does not exist.
    let t = FakeTransport::default();
    t.reply("/push", 200, EMPTY_PUSH);
    t.reply("/pull?since=0", 200, r#"{"changes":[],"cursor":0,"more":false}"#);

    let mut store = FakeStore::default();
    store.versions.insert(("widgets".into(), "w1".into()), 4);
    store.outbox.push(entry(1, "w1", "batch-a"));

    let mut engine = SyncEngine::new(t, store, "k".repeat(32));
    engine.push_batch().unwrap();

    let seen = engine.transport.seen.borrow();
    let (_, _, body, _) = seen.iter().find(|(_, p, _, _)| p == "/push").unwrap();
    assert!(
        body.as_ref().unwrap().contains("\"baseVersion\":4"),
        "sent {body:?}"
    );
}

#[test]
fn a_retried_batch_reuses_its_idempotency_key() {
    // The single most important property here. A key generated at send time
    // turns every timeout into a second application of the batch — which for
    // financial records is the exact failure this mechanism exists to survive.
    let t = FakeTransport::default();
    t.reply("/push", 200, EMPTY_PUSH);

    let mut store = FakeStore::default();
    store.outbox.push(entry(1, "w1", "batch-fixed"));
    let mut engine = SyncEngine::new(t, store, "k".repeat(32));

    engine.push_batch().unwrap();
    // Simulate a lost response: the entry is still queued on the next attempt.
    engine.store.outbox.push(entry(1, "w1", "batch-fixed"));
    engine.push_batch().unwrap();

    let keys = engine.transport.idempotency_keys();
    assert_eq!(keys, vec!["batch-fixed", "batch-fixed"]);
}

#[test]
fn the_outbox_is_cleared_only_after_the_server_confirms() {
    let t = FakeTransport::default();
    t.reply("/push", 500, "gateway exploded");
    let mut store = FakeStore::default();
    store.outbox.push(entry(1, "w1", "b"));

    let mut engine = SyncEngine::new(t, store, "k".repeat(32));
    assert!(engine.push_batch().is_err());
    assert_eq!(engine.store().outbox.len(), 1, "a failed push keeps the change");
    assert!(engine.store().cleared.is_empty());
}

#[test]
fn a_rejection_makes_the_client_converge() {
    // Otherwise the next push is the same argument again, forever.
    let t = FakeTransport::default();
    t.reply(
        "/push",
        200,
        r#"{"applied":0,"skipped":1,"reconciled":[],"escalated":[],"rejected":[{"entity":"widgets","entityId":"w1","remote":{"name":"theirs"}}],"cursor":12}"#,
    );
    let mut store = FakeStore::default();
    store.outbox.push(entry(1, "w1", "b"));
    let mut engine = SyncEngine::new(t, store, "k".repeat(32));
    engine.push_batch().unwrap();

    assert_eq!(engine.store().converged, vec!["w1"]);
    assert!(engine.store().outbox.is_empty(), "a rejected change is not retried");
}

#[test]
fn an_escalation_is_parked_for_a_person_not_retried() {
    let t = FakeTransport::default();
    t.reply(
        "/push",
        200,
        r#"{"applied":0,"skipped":1,"reconciled":[],"escalated":[{"conflictId":"c-1","entity":"widgets","entityId":"w1","reason":"both edited"}],"rejected":[],"cursor":3}"#,
    );
    let mut store = FakeStore::default();
    store.outbox.push(entry(1, "w1", "b"));
    let mut engine = SyncEngine::new(t, store, "k".repeat(32));
    engine.push_batch().unwrap();

    assert_eq!(engine.store().conflicts, vec!["c-1"]);
    assert!(engine.store().outbox.is_empty(), "retrying a conflict is a loop");
}

#[test]
fn a_cycle_pushes_before_it_pulls() {
    // Pulling first applies a remote edit over a local one that was never
    // offered, and the local change then pushes as a conflict against a version
    // it never saw.
    let t = FakeTransport::default();
    t.reply("/push", 200, EMPTY_PUSH);
    t.reply("/pull?since=0", 200, r#"{"changes":[],"cursor":0,"more":false}"#);

    let mut store = FakeStore::default();
    store.outbox.push(entry(1, "w1", "b"));
    let mut engine = SyncEngine::new(t, store, "k".repeat(32));
    engine.sync_cycle().unwrap();

    let seen = engine.transport.seen.borrow();
    let order: Vec<&str> = seen.iter().map(|(_, p, _, _)| p.as_str()).collect();
    let push_at = order.iter().position(|p| *p == "/push").unwrap();
    let pull_at = order.iter().position(|p| p.starts_with("/pull")).unwrap();
    assert!(push_at < pull_at, "order was {order:?}");
}

#[test]
fn an_http_error_is_an_error_not_a_decode_failure() {
    // A 502 with an HTML error page must read as "the server said 502", not as
    // "expected value at line 1 column 1".
    let t = FakeTransport::default();
    t.reply("/handshake", 502, "<html>bad gateway</html>");
    let engine = SyncEngine::new(t, FakeStore::default(), "k".repeat(32));
    match engine.handshake() {
        Err(SyncError::Status { status, .. }) => assert_eq!(status, 502),
        other => panic!("expected a status error, got {other:?}"),
    }
}

#[test]
fn the_handshake_decodes_the_server_owned_schedule() {
    let t = FakeTransport::default();
    t.reply(
        "/handshake",
        200,
        r#"{"installId":"i-1","label":"Clinic","cursor":42,"schedule":{"intervalSeconds":900,"windowStart":null,"windowEnd":null,"timezone":"Africa/Douala"},"serverTime":"2026-08-28T10:00:00.000Z"}"#,
    );
    let engine = SyncEngine::new(t, FakeStore::default(), "k".repeat(32));
    let hs = engine.handshake().unwrap();
    assert_eq!(hs.cursor, 42);
    assert_eq!(hs.schedule.interval_seconds, Some(900));
    assert_eq!(hs.schedule.timezone.as_deref(), Some("Africa/Douala"));
}

#[test]
fn wire_names_match_the_server_exactly() {
    // These structs are one contract in two languages. A rename on either side
    // must break here, not silently produce None in production.
    let change = ChangeRecord {
        entity: "widgets".into(),
        entity_id: "w1".into(),
        operation: Operation::Delete,
        payload: None,
        base_version: 3,
        updated_at: "2026-08-28T10:00:00.000Z".into(),
    };
    let json = serde_json::to_string(&change).unwrap();
    assert!(json.contains("\"entityId\":\"w1\""), "{json}");
    assert!(json.contains("\"baseVersion\":3"), "{json}");
    assert!(json.contains("\"updatedAt\""), "{json}");
    assert!(json.contains("\"operation\":\"delete\""), "{json}");
    // An absent payload is omitted, not sent as null: the server's zod schema
    // accepts nullish, but omitting keeps a delete's body honest.
    assert!(!json.contains("payload"), "{json}");
}
