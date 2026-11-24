use crate::server::{App, project_workspace};
use axum::{
    body::{Body, Bytes},
    extract::{Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use deck2_shared::{Phase, Task};
use futures_util::{StreamExt, stream};
use rusqlite::{Connection, OptionalExtension, ffi};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    convert::Infallible,
    ffi::{CStr, c_char, c_int, c_void},
    io::Write,
    sync::{
        Arc, Mutex, Weak,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::sync::watch;

const COLLECTIONS: [&str; 3] = ["sessions", "receipts", "tasks"];
const REPLAY_FRAMES: usize = 32;
const REPLAY_BYTES: usize = 4 * 1024 * 1024;
const TASK_BATCH_LIMIT: usize = 64;

#[derive(Default)]
enum Scope {
    #[default]
    Clean,
    Tasks(HashSet<i64>),
    Full,
}

impl Scope {
    fn merge(&mut self, other: Self) {
        match (&mut *self, other) {
            (_, Self::Clean) | (Self::Full, _) => {}
            (Self::Tasks(rows), Self::Tasks(more)) => {
                rows.extend(more);
                if rows.len() > TASK_BATCH_LIMIT {
                    *self = Self::Full;
                }
            }
            (_, other) => *self = other,
        }
    }
}

#[derive(Clone)]
pub(crate) struct Updates(Arc<Runtime>);

struct Runtime {
    epoch: String,
    dirty: watch::Sender<u64>,
    changed: watch::Sender<Option<u64>>,
    snapshot: Mutex<Option<Arc<Value>>>,
    pending: Mutex<Scope>,
    state: Mutex<Projection>,
    started: AtomicBool,
    closed: AtomicBool,
    transaction: Mutex<Scope>,
    claude_timing: Option<Mutex<VecDeque<ClaudeAppend>>>,
}

struct ClaudeAppend {
    receipt: String,
    revision: u64,
    sdk_received_ms: u64,
    durable_append_ms: u64,
    start: usize,
    end: usize,
    text_digest: String,
}

#[derive(Default)]
struct Projection {
    revision: u64,
    frames: VecDeque<(u64, Bytes)>,
    bytes: usize,
}

impl Default for Updates {
    fn default() -> Self {
        Self(Arc::new(Runtime {
            epoch: uuid::Uuid::new_v4().simple().to_string(),
            dirty: watch::channel(0).0,
            changed: watch::channel(None).0,
            snapshot: Mutex::default(),
            pending: Mutex::default(),
            state: Mutex::default(),
            started: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            transaction: Mutex::default(),
            claude_timing: std::env::var_os("DECK2_CLAUDE_STREAM_TIMING")
                .is_some_and(|value| value == "1")
                .then(Mutex::default),
        }))
    }
}

impl Updates {
    pub(crate) fn notify(&self) {
        self.0.invalidate(Scope::Full);
    }

    pub(crate) fn close(&self) {
        self.0.closed.store(true, Ordering::Release);
        self.0.changed.send_modify(|_| {});
    }

    pub(crate) fn record_claude_append(
        &self,
        receipt: &str,
        revision: u64,
        sdk_received_ms: u64,
        start: usize,
        text: &str,
    ) {
        let Some(samples) = &self.0.claude_timing else {
            return;
        };
        if text.is_empty() || self.0.changed.receiver_count() == 0 {
            return;
        }
        let mut samples = samples.lock().unwrap();
        if samples.len() >= 256 {
            samples.pop_front();
        }
        samples.push_back(ClaudeAppend {
            receipt: receipt.into(),
            revision,
            sdk_received_ms,
            durable_append_ms: crate::now(),
            start,
            end: start + text.len(),
            text_digest: crate::tasks::digest(text.as_bytes()),
        });
    }

    // Store retains this Updates instance until after the connection closes.
    pub(crate) fn observe(&self, conn: &Connection) {
        let context = Arc::as_ptr(&self.0).cast_mut().cast::<c_void>();
        unsafe {
            let db = conn.handle();
            ffi::sqlite3_update_hook(db, Some(updated), context);
            ffi::sqlite3_rollback_hook(db, Some(rolled_back), context);
            ffi::sqlite3_wal_hook(db, Some(committed), context);
        }
    }

    fn start(&self, app: &App) {
        if self.0.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let mut dirty = self.0.dirty.subscribe();
        let inner = Arc::downgrade(&app.inner);
        let project = app.project.clone();
        tokio::spawn(async move {
            while dirty.changed().await.is_ok() {
                // Bound work while output and multiple members are committing.
                tokio::time::sleep(Duration::from_millis(180)).await;
                let Some(inner) = Weak::upgrade(&inner) else {
                    break;
                };
                if inner.workspace_updates.0.changed.receiver_count() == 0 {
                    continue;
                }
                let app = App {
                    inner,
                    project: project.clone(),
                };
                let _ = tokio::task::spawn_blocking(move || {
                    app.workspace_updates.refresh(&app, false).ok();
                })
                .await;
            }
        });
    }

    fn refresh(
        &self,
        app: &App,
        bootstrap: bool,
    ) -> Result<Option<(Arc<Value>, String)>, Response> {
        let runtime = &self.0;
        let mut snapshot = runtime.snapshot.lock().unwrap();
        if bootstrap {
            // Any later commit remains pending even if the full read also sees it.
            std::mem::take(&mut *runtime.pending.lock().unwrap());
        } else {
            match self.read_task_update(app, snapshot.as_deref()) {
                TaskUpdate::Clean => return Ok(None),
                TaskUpdate::Scoped(tasks, process_active) => {
                    let snapshot = Arc::make_mut(snapshot.as_mut().unwrap());
                    let payload = patch_tasks(snapshot, tasks, process_active);
                    runtime.publish(payload);
                    return Ok(None);
                }
                TaskUpdate::Full => {}
            }
        }

        let next = match project_workspace(app) {
            Ok(next) => Arc::new(next),
            Err(error) => {
                *snapshot = None;
                let mut state = runtime.state.lock().unwrap();
                state.frames.clear();
                state.bytes = 0;
                state.revision += 1;
                runtime.changed.send_replace(None);
                return Err(error);
            }
        };
        let payload = snapshot.as_ref().and_then(|previous| diff(previous, &next));
        let published = payload.is_some();
        *snapshot = Some(next.clone());
        let revision = runtime.publish(payload);
        if published {
            runtime.trace_claude_publication(&next, revision);
        }
        Ok(bootstrap.then(|| (next, runtime.cursor(revision))))
    }

    fn read_task_update(&self, app: &App, snapshot: Option<&Value>) -> TaskUpdate {
        use TaskUpdate::*;
        // Drain invalidations under the same store lock as the row reads.
        // A receipt/session write cannot slip into a task-only projection.
        let mut trace = crate::latency::Trace::new("workspace_tasks");
        let active = trace.lock(&app.active, crate::latency::Lock::Active);
        let store = trace.lock(&app.store, crate::latency::Lock::Store);
        let scope = std::mem::take(&mut *self.0.pending.lock().unwrap());
        let rows = match scope {
            Scope::Clean => return Clean,
            Scope::Tasks(rows) if snapshot.is_some() => rows,
            _ => return Full,
        };
        let previous = snapshot.unwrap()["tasks"].as_array().unwrap();
        let read = || -> Option<_> {
            let mut stmt = store
                .conn
                .prepare_cached("SELECT body FROM tasks WHERE rowid=?1")
                .ok()?;
            rows.into_iter()
                .map(|row| {
                    let body: String = stmt.query_row([row], |r| r.get(0)).optional().ok()??;
                    let task: Task = serde_json::from_str(&body).ok()?;
                    let index = previous.iter().position(|value| value["id"] == task.id)?;
                    // Failure blockers depend on receipt decisions and worker ownership.
                    if task
                        .attempts
                        .last()
                        .is_some_and(|a| a.phase == Phase::Failed)
                    {
                        return None;
                    }
                    Some((index, task))
                })
                .collect::<Option<Vec<_>>>()
        };
        let Some(tasks) = read() else { return Full };
        let Ok(sessions) = store.sessions() else {
            return Full;
        };
        let process_active = !active.is_empty();
        trace.release();
        drop(store);
        drop(active);
        Scoped(
            tasks
                .into_iter()
                .map(|(index, mut task)| {
                    crate::observations::project(
                        &mut [],
                        std::slice::from_mut(&mut task),
                        &sessions,
                    );
                    (index, serde_json::to_value(task).unwrap())
                })
                .collect(),
            process_active,
        )
    }
}

enum TaskUpdate {
    Clean,
    Scoped(Vec<(usize, Value)>, bool),
    Full,
}

fn patch_tasks(
    snapshot: &mut Value,
    mut tasks: Vec<(usize, Value)>,
    process_active: bool,
) -> Option<String> {
    let mut fields = Map::new();
    if snapshot["process_active"] != process_active {
        snapshot["process_active"] = json!(process_active);
        fields.insert("process_active".into(), json!(process_active));
    }
    let mut collections = Map::new();
    let previous = snapshot["tasks"].as_array_mut().unwrap();
    tasks.sort_unstable_by_key(|(index, _)| *index);
    let changed: Vec<_> = tasks
        .into_iter()
        .filter_map(|(index, task)| {
            if previous[index] == task {
                return None;
            }
            previous[index] = task;
            Some(index)
        })
        .collect();
    let changed: Vec<_> = changed.into_iter().map(|index| &previous[index]).collect();
    if !changed.is_empty() {
        collections.insert("tasks".into(), json!({ "changed": changed, "removed": [] }));
    }
    if fields.is_empty() && collections.is_empty() {
        return None;
    }
    Some(json!({ "fields": fields, "removed": [], "collections": collections }).to_string())
}

impl Runtime {
    fn invalidate(&self, scope: Scope) {
        if matches!(scope, Scope::Clean) {
            return;
        }
        let mut pending = self.pending.lock().unwrap();
        pending.merge(scope);
        self.dirty
            .send_modify(|revision| *revision = revision.wrapping_add(1));
    }

    fn publish(&self, payload: Option<String>) -> u64 {
        let mut state = self.state.lock().unwrap();
        if let Some(payload) = payload {
            state.revision += 1;
            let revision = state.revision;
            let cursor = self.cursor(revision);
            let frame = Bytes::from(format!("id: {cursor}\nevent: delta\ndata: {payload}\n\n"));
            state.bytes += frame.len();
            state.frames.push_back((revision, frame));
            while state.frames.len() > REPLAY_FRAMES || state.bytes > REPLAY_BYTES {
                state.bytes -= state.frames.pop_front().unwrap().1.len();
            }
        }
        let revision = Some(state.revision);
        self.changed.send_if_modified(|published| {
            if *published == revision {
                return false;
            }
            *published = revision;
            true
        });
        state.revision
    }

    fn trace_claude_publication(&self, snapshot: &Value, workspace_revision: u64) {
        let Some(samples) = &self.claude_timing else {
            return;
        };
        let sse_published_ms = crate::now();
        let published = snapshot["receipts"].as_array().unwrap();
        let mut samples = samples.lock().unwrap();
        if samples.is_empty() {
            return;
        }
        let by_id = by_id(published);
        let mut ready = Vec::new();
        samples.retain(|sample| {
            let Some(receipt) = by_id.get(sample.receipt.as_str()).filter(|receipt| {
                receipt["revision"].as_u64().is_some_and(|revision| revision >= sample.revision)
            }) else {
                return true;
            };
            // A terminal result can supersede text before the coalescer publishes
            // it. Only measure deltas that are part of the published snapshot.
            if receipt["text"].as_str().and_then(|text| text.get(sample.start..sample.end))
                .is_some_and(|text| crate::tasks::digest(text.as_bytes()) == sample.text_digest)
            {
                ready.push(json!({
                    "receipt": sample.receipt,
                    "receipt_revision": sample.revision,
                    "workspace_revision": workspace_revision,
                    "sdk_received_ms": sample.sdk_received_ms,
                    "durable_append_ms": sample.durable_append_ms,
                    "sse_published_ms": sse_published_ms,
                }));
            }
            false
        });
        drop(samples);
        for sample in ready {
            let _ = writeln!(std::io::stderr(), "Claude Lead stream {sample}");
        }
    }

    fn cursor(&self, revision: u64) -> String {
        format!("{}:{revision}", self.epoch)
    }

    fn parse_cursor(&self, value: &str) -> Option<u64> {
        let (epoch, revision) = value.split_once(':')?;
        (epoch == self.epoch).then_some(())?;
        revision.parse().ok()
    }
}

unsafe extern "C" fn updated(
    context: *mut c_void,
    action: c_int,
    _: *const c_char,
    table: *const c_char,
    row: i64,
) {
    let table = unsafe { CStr::from_ptr(table) }.to_bytes();
    let mut transaction = unsafe { &*context.cast::<Runtime>() }
        .transaction
        .lock()
        .unwrap();
    match table {
        b"tasks" if action == ffi::SQLITE_UPDATE => match &mut *transaction {
            Scope::Clean => *transaction = Scope::Tasks(HashSet::from([row])),
            Scope::Tasks(rows) => {
                rows.insert(row);
                if rows.len() > TASK_BATCH_LIMIT {
                    *transaction = Scope::Full;
                }
            }
            Scope::Full => {}
        },
        b"receipts" | b"sessions" | b"tasks" | b"meta" | b"projects" | b"decision_commands"
        | b"session_decisions" | b"decision_replies" | b"configurations" => {
            *transaction = Scope::Full;
        }
        _ => {}
    }
}

unsafe extern "C" fn rolled_back(context: *mut c_void) {
    let runtime = unsafe { &*context.cast::<Runtime>() };
    *runtime.transaction.lock().unwrap() = Scope::Clean;
}

unsafe extern "C" fn committed(
    context: *mut c_void,
    db: *mut ffi::sqlite3,
    name: *const c_char,
    pages: c_int,
) -> c_int {
    let runtime = unsafe { &*context.cast::<Runtime>() };
    let scope = std::mem::take(&mut *runtime.transaction.lock().unwrap());
    runtime.invalidate(scope);
    // Registering the WAL hook replaces SQLite's default passive checkpoint.
    if pages >= 1000 {
        unsafe { ffi::sqlite3_wal_checkpoint(db, name) };
    }
    ffi::SQLITE_OK
}

fn by_id(items: &[Value]) -> HashMap<&str, &Value> {
    items
        .iter()
        .filter_map(|item| Some((item["id"].as_str()?, item)))
        .collect()
}

fn diff(before: &Value, after: &Value) -> Option<String> {
    let before = before.as_object().unwrap();
    let after = after.as_object().unwrap();
    let mut fields = Map::new();
    let mut collections = Map::new();
    for (key, next) in after {
        if before.get(key) == Some(next) {
            continue;
        }
        if COLLECTIONS.contains(&key.as_str()) {
            let old = before[key].as_array().unwrap();
            let next = next.as_array().unwrap();
            let by_old = by_id(old);
            let by_next = by_id(next);
            let changed: Vec<_> = next
                .iter()
                .filter(|item| by_old.get(item["id"].as_str().unwrap()).copied() != Some(*item))
                .collect();
            let removed: Vec<_> = old
                .iter()
                .map(|item| item["id"].as_str().unwrap())
                .filter(|id| !by_next.contains_key(id))
                .collect();
            let old_ids = old.iter().map(|item| &item["id"]);
            let next_ids = || next.iter().map(|item| &item["id"]);
            let mut delta = json!({ "changed": changed, "removed": removed });
            if !old_ids.eq(next_ids()) {
                delta["order"] = json!(next_ids().collect::<Vec<_>>());
            }
            collections.insert(key.clone(), delta);
        } else {
            fields.insert(key.clone(), next.clone());
        }
    }
    let removed: Vec<_> = before
        .keys()
        .filter(|key| !after.contains_key(*key))
        .collect();
    if fields.is_empty() && collections.is_empty() && removed.is_empty() {
        return None;
    }
    Some(json!({ "fields": fields, "removed": removed, "collections": collections }).to_string())
}

pub(crate) async fn bootstrap(app: App) -> Response {
    app.workspace_updates.start(&app);
    match tokio::task::spawn_blocking(move || {
        app.workspace_updates
            .refresh(&app, true)
            .map(|snapshot| snapshot.map(|(value, cursor)| (value.to_string(), cursor)))
    })
    .await
    {
        Ok(Ok(Some((snapshot, cursor)))) => (
            [("x-deck-workspace-cursor", cursor)],
            ([("content-type", "application/json")], snapshot),
        )
            .into_response(),
        Ok(Err(error)) => error,
        _ => axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

#[derive(Deserialize)]
pub(crate) struct Cursor {
    after: Option<String>,
}

pub(crate) async fn events(
    State(app): State<App>,
    Query(cursor): Query<Cursor>,
    headers: HeaderMap,
) -> impl IntoResponse {
    app.workspace_updates.start(&app);
    let runtime = app.workspace_updates.0.clone();
    let cursor = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .or(cursor.after.as_deref())
        .and_then(|value| runtime.parse_cursor(value));
    let changed = runtime.changed.subscribe();
    // A commit can land after bootstrap and before any SSE receiver exists.
    runtime.dirty.send_modify(|_| {});
    let first = stream::once(async { Ok::<_, Infallible>(Bytes::from_static(b": ready\n\n")) });
    let heartbeat = || Bytes::from_static(b"event: heartbeat\ndata: {}\n\n");
    let events = stream::unfold(
        (Some(cursor), changed, runtime, true),
        move |(cursor, mut changed, runtime, announce)| async move {
            let cursor = cursor?;
            loop {
                let published = *changed.borrow_and_update();
                if runtime.closed.load(Ordering::Acquire) {
                    return None;
                }
                let event = match (cursor, published) {
                    (Some(cursor), Some(latest)) if cursor == latest => {
                        announce.then(|| (Some(Some(cursor)), heartbeat()))
                    }
                    (Some(cursor), Some(latest)) if cursor < latest => runtime
                        .state
                        .lock()
                        .unwrap()
                        .frames
                        .iter()
                        .find(|frame| frame.0 == cursor + 1)
                        .map(|(revision, frame)| (Some(Some(*revision)), frame.clone()))
                        .or_else(|| Some(resync())),
                    _ => Some(resync()),
                };
                if let Some((next, frame)) = event {
                    let announce = announce && cursor != next.flatten();
                    // Announce once after the replay reaches the head.
                    return Some((
                        Ok::<_, Infallible>(frame),
                        (next, changed, runtime, announce),
                    ));
                }
                match tokio::time::timeout(Duration::from_secs(10), changed.changed()).await {
                    Ok(Ok(())) => {}
                    Ok(Err(_)) => return None,
                    Err(_) => {
                        return Some((Ok(heartbeat()), (Some(cursor), changed, runtime, false)));
                    }
                }
            }
        },
    );
    (
        [
            ("x-accel-buffering", "no"),
            ("content-type", "text/event-stream"),
        ],
        Body::from_stream(first.chain(events)),
    )
}

fn resync() -> (Option<Option<u64>>, Bytes) {
    (None, Bytes::from_static(b"event: resync\ndata: {}\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_commit_signal_follows_the_wal_commit() {
        let dir = tempfile::tempdir().unwrap();
        let updates = Updates::default();
        let conn = Connection::open(dir.path().join("state.db")).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
            CREATE TABLE receipts(id TEXT PRIMARY KEY);
            CREATE TABLE diagnostics(id TEXT PRIMARY KEY);
            CREATE TABLE tasks(id TEXT PRIMARY KEY, body TEXT);
            INSERT INTO tasks VALUES ('first', '{}'), ('second', '{}');",
        )
        .unwrap();
        let mut dirty = updates.0.dirty.subscribe();
        updates.observe(&conn);

        conn.execute_batch("BEGIN; INSERT INTO receipts VALUES ('rolled-back');")
            .unwrap();
        assert!(!dirty.has_changed().unwrap());
        conn.execute_batch("ROLLBACK; INSERT INTO diagnostics VALUES ('unrelated');")
            .unwrap();
        assert!(!dirty.has_changed().unwrap());

        conn.execute_batch("BEGIN; INSERT INTO receipts VALUES ('committed');")
            .unwrap();
        assert!(!dirty.has_changed().unwrap());
        conn.execute_batch("COMMIT;").unwrap();
        assert_eq!(*dirty.borrow_and_update(), 1);
        let observed = Connection::open(dir.path().join("state.db")).unwrap();
        assert_eq!(
            observed
                .query_row("SELECT id FROM receipts", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "committed"
        );
        assert!(matches!(
            std::mem::take(&mut *updates.0.pending.lock().unwrap()),
            Scope::Full
        ));

        conn.execute_batch(
            "BEGIN;
            UPDATE tasks SET body='changed';
            COMMIT;",
        )
        .unwrap();
        assert_eq!(*dirty.borrow_and_update(), 2);
        let scope = std::mem::take(&mut *updates.0.pending.lock().unwrap());
        assert!(matches!(scope, Scope::Tasks(rows) if rows == HashSet::from([1, 2])));

        conn.execute_batch(
            "BEGIN;
            UPDATE tasks SET body='mixed';
            INSERT INTO receipts VALUES ('cross-session');
            COMMIT;",
        )
        .unwrap();
        assert_eq!(*dirty.borrow_and_update(), 3);
        assert!(matches!(
            std::mem::take(&mut *updates.0.pending.lock().unwrap()),
            Scope::Full
        ));
    }

    #[test]
    fn task_patches_match_full_projection_delta() {
        let old = json!({
            "process_active": true,
            "receipts": [{"id": "long-history"}],
            "tasks": [{"id": "first", "revision": 1}, {"id": "second", "revision": 1}],
        });
        let mut patched = old.clone();
        let a = json!({"id": "first", "revision": 2});
        let b = json!({"id": "second", "revision": 2});
        let mut expected = old.clone();
        expected["tasks"] = json!([a, b]);
        expected["process_active"] = json!(false);
        assert_eq!(
            patch_tasks(&mut patched, vec![(1, b.clone()), (0, a)], false),
            diff(&old, &expected)
        );
        assert_eq!(patched, expected);
        assert_eq!(patch_tasks(&mut patched, vec![(1, b)], false), None);
    }

    #[test]
    fn workspace_delta_preserves_order_and_omits_settled_history() {
        let old = json!({"sessions": [{"id": "a"}, {"id": "b"}],
            "tasks": [{"id": "t", "revision": 1}], "receipts": [{"id": "settled"}, {"id": "r", "revision": 1}]});
        let next = json!({"sessions": [{"id": "c"}, {"id": "b"}],
            "tasks": [{"id": "t", "revision": 2}], "receipts": [{"id": "settled"}, {"id": "r", "revision": 2}]});
        assert!(diff(&old, &old).is_none());
        let patch: Value = serde_json::from_str(&diff(&old, &next).unwrap()).unwrap();
        assert_eq!(patch["collections"]["sessions"]["order"], json!(["c", "b"]));
        assert_eq!(patch["collections"]["sessions"]["removed"], json!(["a"]));
        assert_eq!(
            patch["collections"]["receipts"]["changed"],
            json!([{"id": "r", "revision": 2}])
        );
        assert_eq!(
            patch["collections"]["tasks"]["changed"],
            json!([{"id": "t", "revision": 2}])
        );
    }
}
