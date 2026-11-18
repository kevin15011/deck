//! Durable restart commands and last verified MCP inventory.
//! Compatible Lead runtimes retain a timestamped observation; plugins may refresh natively.
use crate::{Store, server::App};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Epoch {
    pub epoch: u64,
    pub opened: bool,
    pub catalog: Vec<Value>,
    #[serde(default)]
    pub catalog_scoped: bool,
    #[serde(default)]
    pub observed_ms: Option<u64>,
    command: Option<String>,
}
impl Default for Epoch {
    fn default() -> Self {
        Self {
            epoch: 1,
            opened: false,
            catalog: vec![],
            catalog_scoped: false,
            observed_ms: None,
            command: None,
        }
    }
}
impl Store {
    pub(crate) fn init_session_epochs(&self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS session_epochs(session TEXT PRIMARY KEY,body TEXT NOT NULL)")
            .map_err(|_| "Cannot initialize session epochs".into())
    }
    pub(crate) fn session_epoch(&self, session: &str) -> Result<Epoch, String> {
        self.session_by_id(session)?;
        let body: Option<String> = self
            .conn
            .query_row(
                "SELECT body FROM session_epochs WHERE session=?1",
                [session],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Cannot read session epoch")?;
        body.map(|b| serde_json::from_str(&b).map_err(|_| "Invalid session epoch".into()))
            .unwrap_or(Ok(Epoch::default()))
    }
    fn save_epoch(&self, session: &str, epoch: &Epoch) -> Result<(), String> {
        self.conn.execute("INSERT INTO session_epochs VALUES(?1,?2) ON CONFLICT(session) DO UPDATE SET body=excluded.body",params![session,serde_json::to_string(epoch).map_err(|_|"Cannot encode session epoch")?]).map_err(|_|"Cannot persist session epoch")?;
        Ok(())
    }
    pub(crate) fn record_catalog(
        &self, session: &str, expected: u64, catalog: Vec<Value>, scoped: bool,
    ) -> Result<(), String> {
        let mut e = self.session_epoch(session)?;
        if e.epoch != expected {
            return Err("Session epoch changed during discovery".into());
        }
        e.opened = true;
        e.catalog = catalog;
        e.catalog_scoped = scoped;
        e.observed_ms = Some(crate::now());
        self.save_epoch(session, &e)
    }
    fn restart_ready(&self, session: &str) -> Result<(), String> {
        self.execution_project(session)?;
        if self.all()?.iter().any(|r| {
            r.session == session
                && (r.phase.active()
                    || matches!(
                        r.phase,
                        deck2_shared::Phase::Queued | deck2_shared::Phase::Uncertain
                    ))
        }) || self.tasks()?.iter().any(|t| {
            t.session == session
                && t.attempts.iter().any(|a| {
                    a.phase.active()
                        || matches!(
                            a.phase,
                            deck2_shared::Phase::Queued | deck2_shared::Phase::Uncertain
                        )
                })
        }) {
            return Err(
                "Settle active, queued or uncertain work before restarting the session".into(),
            );
        }
        Ok(())
    }
    fn restart_epoch(&self, session: &str, c: &Restart) -> Result<Epoch, String> {
        let e = self.session_epoch(session)?;
        if e.command.as_deref() == Some(&c.command_id)
            && c.expected_epoch.checked_add(1) == Some(e.epoch)
        {
            return Ok(e);
        }
        if e.epoch != c.expected_epoch {
            return Err("Session epoch changed. Refresh before restarting.".into());
        }
        self.restart_ready(session)?;
        let next = Epoch {
            epoch: e.epoch.checked_add(1).ok_or("Session epoch exhausted")?,
            command: Some(c.command_id.clone()),
            ..Default::default()
        };
        self.save_epoch(session, &next)?;
        Ok(next)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Restart {
    api: u32,
    command_id: String,
    expected_epoch: u64,
}
fn error(e: impl Into<String>) -> Response {
    crate::server::problem(StatusCode::CONFLICT, "session_runtime", e)
}
fn view(app: &App, session: &str) -> Result<Value, String> {
    let (e, running, retained) = {
        let store = app.store.lock().unwrap();
        (
            store.session_epoch(session)?,
            store
                .all()?
                .iter()
                .any(|r| r.session == session && r.phase.active() && r.dispatch_ms.is_some()),
            store.session_by_id(session)?.contract.as_ref().and_then(|c|c.members.get("lead")).and_then(|a|crate::member_integration::Integration::select(&a.runner_id).ok()).is_some_and(|i|i.concurrent_lead()),
        )
    };
    // Inventory is evidence of the last completed discovery, never cached authority.
    // Plugin refresh is native-owned; warm checks do not refresh this observation.
    let loaded = running || app.native_reuse.loaded_session(session);
    Ok(
        json!({"api":deck2_shared::API,"session":session,"epoch":e.epoch,
        "state":if !retained {"unsupported"} else if loaded {"loaded"}else{"not_started"},
        "capabilities":{"retained_runtime":retained,"target_restart":retained,"simultaneous_retained_turns":retained},
        "resources":if retained {app.native_reuse.resource_view(session)} else {Value::Null},
        "catalog_policy":if retained {"retained_lead"}else{"unavailable"}, "catalog_verified":e.opened, "catalog_observed_ms":e.observed_ms,
        "catalog":e.catalog,"catalog_scoped":e.catalog_scoped,"retained_thread_limit":crate::native::reuse::MAX_THREADS,"retained_process_limit":crate::native::reuse::MAX_GROUPS,"idle_timeout_seconds":crate::native::reuse::IDLE_TIMEOUT.as_secs(),
        "message":"Plugin MCP support is preserved. Retained Lead connections verify the Deck session bridge before dispatch. Personal and plugin MCP servers remain native-owned; Deck verifies their sources when they request approval. Restart settles this retained thread and reconnects on your next message. Idle expiry after 30 minutes, capacity eviction or a crash reconnects on the next explicit message; history is preserved and earlier inputs are never replayed. Compatible sessions retain distinct threads in a shared process; restarting this session preserves idle siblings. Retention is bounded to 8 threads and 4 process groups."}),
    )
}
async fn runtime(State(app): State<App>, Path(session): Path<String>) -> Response {
    match view(&app, &session) {
        Ok(v) => Json(v).into_response(),
        Err(e) => error(e),
    }
}
async fn restart(
    State(app): State<App>,
    Path(session): Path<String>,
    Json(c): Json<Restart>,
) -> Response {
    if c.api != deck2_shared::API
        || !(8..=80).contains(&c.command_id.len())
        || !c
            .command_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return error("Invalid restart command");
    }
    let app = match app.for_session(&session) {
        Ok(a) => a,
        Err(e) => return error(e),
    };
    if let Err(e) = app.check_original_context(&session) {
        return error(e);
    }
    let marker = format!("session-restart:{session}");
    {
        // Same active -> Store serialization order as browser admission. Reserve
        // throughout asynchronous settlement so a concurrent input cannot launch.
        let mut active = app.active.lock().unwrap();
        let store = app.store.lock().unwrap();
        let e = match store.session_epoch(&session) {
            Ok(e) => e,
            Err(e) => return error(e),
        };
        if e.command.as_deref() == Some(&c.command_id)
            && c.expected_epoch.checked_add(1) == Some(e.epoch)
        {
            drop(store);
            drop(active);
            return match view(&app, &session) {
                Ok(v) => Json(v).into_response(),
                Err(e) => error(e),
            };
        }
        let target_owned=active.keys().any(|key| {
            if let Some(attempt)=key.strip_prefix("child:") {
                return store.tasks().map(|tasks|tasks.iter().any(|t|t.session==session && t.attempts.iter().any(|a|a.id==attempt))).unwrap_or(true);
            }
            if let Some(target)=key.strip_prefix("session-restart:") {return target==session;}
            store.get(key).ok().flatten().is_none_or(|r|r.session==session)
        });
        if target_owned { return error("This session's native ownership is active; wait for settlement before restarting"); }
        if let Err(e) = store.restart_ready(&session) {
            return error(e);
        }
        if e.epoch != c.expected_epoch {
            return error("Session epoch changed. Refresh before restarting.");
        }
        if let Some(r) = crate::web_identity::effect_denied() {
            return r;
        }
        let (tx, _) = tokio::sync::watch::channel(false);
        active.insert(marker.clone(), tx);
    }
    // Acceptance owns the operation. Disconnecting the HTTP client must not
    // release admission while process settlement is still in progress.
    let worker_app = app.clone();
    let worker_session = session.clone();
    let result = tokio::spawn(async move {
        struct Reservation(App, String);
        impl Drop for Reservation {
            fn drop(&mut self) {
                self.0.clear_active(&self.1);
            }
        }
        let _reservation = Reservation(worker_app.clone(), marker);
        worker_app.retire_native_session(&worker_session).await?;
        let store = worker_app.store.lock().unwrap();
        store.restart_epoch(&worker_session, &c)?;
        Ok::<_, String>(())
    })
    .await
    .unwrap_or_else(|_| {
        Err("Session restart did not settle; refresh state before retrying".into())
    });
    match result {
        Ok(()) => match view(&app, &session) {
            Ok(v) => Json(v).into_response(),
            Err(e) => error(e),
        },
        Err(e) => error(e),
    }
}
pub(crate) fn routes() -> Router<App> {
    Router::new()
        .route("/api/sessions/{session}/runtime", get(runtime))
        .route("/api/sessions/{session}/restart", post(restart))
}

#[cfg(test)]
mod tests {
    use super::*;
    // Restart changes only execution/catalog identity. It cannot delete history,
    // replay inputs or turn unresolved effects into completed work.
    #[test]
    fn restart_is_durable_idempotent_and_preserves_history() {
        let d = tempfile::tempdir().unwrap();
        let state = d.path().join("epoch.db");
        let s = Store::open(&state, d.path().to_str().unwrap()).unwrap();
        let id = s.session.clone();
        s.record_catalog(&id, 1, vec![json!({"name":"one","tools":["read"]})], false)
            .unwrap();
        let before = s.session_by_id(&id).unwrap();
        let c = Restart {
            api: deck2_shared::API,
            command_id: "restart-once".into(),
            expected_epoch: 1,
        };
        assert_eq!(s.restart_epoch(&id, &c).unwrap().epoch, 2);
        drop(s);
        let s = Store::open(&state, d.path().to_str().unwrap()).unwrap();
        s.record_catalog(&id, 2, vec![], false).unwrap();
        assert_eq!(s.restart_epoch(&id, &c).unwrap().epoch, 2);
        assert!(s.session_epoch(&id).unwrap().opened);
        assert_eq!(
            serde_json::to_value(s.session_by_id(&id).unwrap()).unwrap(),
            serde_json::to_value(before).unwrap()
        );
        assert!(
            s.restart_epoch(
                &id,
                &Restart {
                    command_id: "restart-conflict".into(),
                    ..c
                }
            )
            .is_err()
        );
    }
    // Protect the actual default router composition, including browser authority.
    #[tokio::test]
    async fn runtime_and_restart_are_authenticated_and_do_not_replay_history() {
        use axum::{
            body::{Body, to_bytes},
            http::Request,
        };
        use tower::ServiceExt;
        let d = tempfile::tempdir().unwrap();
        let app = App::new(
            Store::open_memory(d.path().to_str().unwrap()).unwrap(),
            "127.0.0.1:32123".into(),
            "/missing".into(),
            None,
            "admin".into(),
            "recover".into(),
        );
        let session = app.store.lock().unwrap().session.clone();
        let router = crate::server::router(app.clone());
        let url = format!("/api/sessions/{session}/runtime");
        let request = |method: &str, uri: &str, cookie: Option<&str>, origin: &str, body: Value| {
            let mut r = Request::builder()
                .method(method)
                .uri(uri)
                .header("host", &app.host)
                .header("origin", origin)
                .header("content-type", "application/json");
            if let Some(cookie) = cookie {
                r = r.header("cookie", cookie);
            }
            r.body(Body::from(body.to_string())).unwrap()
        };
        let origin = format!("http://{}", app.host);
        let denied = router
            .clone()
            .oneshot(request("GET", &url, None, &origin, Value::Null))
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        let auth = router
            .clone()
            .oneshot(
                Request::post("/auth")
                    .header("host", &app.host)
                    .header("origin", &origin)
                    .body(Body::from(app.issue_launch()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let cookie = auth.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap();
        let response = router
            .clone()
            .oneshot(request("GET", &url, Some(cookie), &origin, Value::Null))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let v: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(v["session"], session);
        assert_eq!(v["epoch"], 1);
        assert_eq!(v["catalog_policy"], "unavailable");
        assert_eq!(v["state"], "unsupported");
        assert_eq!(v["capabilities"]["retained_runtime"], false);
        let connected="supported-runtime-session";
        app.store.lock().unwrap().create_session(&serde_json::from_value(json!({"api":deck2_shared::API,"id":connected,"title":"Connected","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap()).unwrap();
        let supported=view(&app,connected).unwrap();
        assert_eq!(supported["catalog_policy"],"retained_lead");
        assert_eq!(supported["capabilities"]["retained_runtime"],true);
        assert_eq!(supported["state"],"not_started");
        let before = app.store.lock().unwrap().all().unwrap();
        let restart = format!("/api/sessions/{session}/restart");
        let command =
            json!({"api":deck2_shared::API,"command_id":"restart-boundary","expected_epoch":1});
        assert_eq!(
            router
                .clone()
                .oneshot(request(
                    "POST",
                    &restart,
                    Some(cookie),
                    "http://foreign",
                    command.clone()
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        for _ in 0..2 {
            let response = router
                .clone()
                .oneshot(request(
                    "POST",
                    &restart,
                    Some(cookie),
                    &origin,
                    command.clone(),
                ))
                .await
                .unwrap();
            let status = response.status();
            let v: Value =
                serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                    .unwrap();
            assert_eq!(status, StatusCode::OK, "{v}");
            assert_eq!(v["epoch"], 2);
        }
        assert_eq!(
            serde_json::to_value(before).unwrap(),
            serde_json::to_value(app.store.lock().unwrap().all().unwrap()).unwrap()
        );
        let stale =
            json!({"api":deck2_shared::API,"command_id":"different-restart","expected_epoch":1});
        assert_eq!(
            router
                .clone()
                .oneshot(request("POST", &restart, Some(cookie), &origin, stale))
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
        assert!(app.active.lock().unwrap().is_empty());
    }
    #[test]
    fn restart_rejects_active_queued_and_uncertain_work() {
        use deck2_shared::Phase;
        let d = tempfile::tempdir().unwrap();
        let mut store = Store::open_memory(d.path().to_str().unwrap()).unwrap();
        let session = store.session.clone();
        let submit=serde_json::from_value(json!({"api":deck2_shared::API,"id":"pending-work","session":session,"prompt":"Never replay this input"})).unwrap();
        let mut receipt = store.admit(&submit).unwrap();
        for phase in [
            Phase::Accepted,
            Phase::Preparing,
            Phase::Running,
            Phase::Cancelling,
            Phase::Queued,
            Phase::Uncertain,
        ] {
            receipt.phase = phase;
            store.save(&mut receipt).unwrap();
            assert!(
                store
                    .restart_epoch(
                        &session,
                        &Restart {
                            api: deck2_shared::API,
                            command_id: "restart-pending".into(),
                            expected_epoch: 1
                        }
                    )
                    .is_err()
            );
            assert_eq!(store.session_epoch(&session).unwrap().epoch, 1);
        }
    }
}
