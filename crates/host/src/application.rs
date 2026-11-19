//! Browser-initiated restart of the installed host, serialized with work admission.
use crate::server::{App, problem};
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use deck2_shared::API;
use serde_json::json;
use std::{
    fs::File,
    os::fd::AsRawFd,
    path::PathBuf,
    sync::{Mutex, OnceLock, atomic::Ordering},
};

#[derive(Default)]
pub struct Restart {
    launcher: OnceLock<PathBuf>,
    generation: uuid::Uuid,
    candidate: Mutex<Option<File>>,
    pub(crate) admission: tokio::sync::RwLock<()>,
}

impl Restart {
    pub fn new() -> Self {
        Self {
            generation: uuid::Uuid::new_v4(),
            ..Self::default()
        }
    }
    pub fn enable(&self, launcher: PathBuf) {
        let _ = self.launcher.set(launcher);
    }
    pub fn pending(&self) -> bool {
        self.candidate.lock().unwrap().is_some()
    }
    pub fn take(&self) -> Option<File> {
        self.candidate.lock().unwrap().take()
    }
}

fn busy(app: &App, store: &crate::Store) -> Result<bool, String> {
    if app.dictation.get().is_some_and(|s| s.downloading())
        || store.ordinary_preparing()?
        || store
            .runner_operations()?
            .iter()
            .any(|o| o.phase != "uncertain" && !crate::runner_management::terminal(&o.phase))
    {
        return Ok(true);
    }
    store.conn.query_row(
        "WITH work(phase) AS (
            SELECT json_extract(body,'$.phase') FROM receipts
            UNION ALL SELECT json_extract(a.value,'$.phase') FROM tasks, json_each(tasks.body,'$.attempts') a
         )
         SELECT EXISTS(SELECT 1 FROM work WHERE phase IN ('queued','accepted','preparing','dispatching','running','cancelling'))
             OR EXISTS(SELECT 1 FROM changes, json_each(changes.body,'$.reviews') r WHERE json_extract(r.value,'$.phase')='checking')
             OR EXISTS(SELECT 1 FROM cbm_operations WHERE json_extract(body,'$.phase')='accepted')
             OR EXISTS(SELECT 1 FROM management_operations WHERE json_extract(body,'$.phase') IN ('accepted','downloading','validating','published_not_selected'))",
        [], |r| r.get(0),
    ).map_err(|_| "Cannot inspect work before restart".into())
}

pub(crate) async fn status(State(app): State<App>) -> Response {
    let active = app.active.lock().unwrap();
    let busy = match busy(&app, &app.store.lock().unwrap()) {
        Ok(busy) => busy || !active.is_empty(),
        Err(e) => return problem(StatusCode::SERVICE_UNAVAILABLE, "restart_status", e),
    };
    Json(json!({"generation":app.restart.generation.to_string(),"available":app.restart.launcher.get().is_some(),"busy":busy})).into_response()
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Request {
    api: u32,
    generation: String,
}

pub(crate) async fn restart(State(app): State<App>, Json(body): Json<Request>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }
    if body.api != API || body.generation != app.restart.generation.to_string() {
        return problem(
            StatusCode::CONFLICT,
            "restart_stale",
            "Deck has changed. Refresh settings.",
        );
    }
    let Some(path) = app.restart.launcher.get() else {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "restart_unavailable",
            "Restart unavailable for this host.",
        );
    };
    let candidate = match File::open(path) {
        Ok(file) => file,
        Err(e) => {
            return problem(
                StatusCode::CONFLICT,
                "restart_binary",
                format!("Cannot open installed Deck binary: {e}"),
            );
        }
    };
    // Pin the tested inode even if another update replaces its pathname before exec.
    let probe = tokio::process::Command::new(format!("/proc/self/fd/{}", candidate.as_raw_fd()))
        .arg("--version")
        .kill_on_drop(true)
        .output();
    if !tokio::time::timeout(std::time::Duration::from_secs(5), probe)
        .await
        .is_ok_and(|r| r.is_ok_and(|o| o.status.success() && o.stdout.starts_with(b"deck2 ")))
    {
        return problem(
            StatusCode::CONFLICT,
            "restart_binary",
            "The installed Deck binary could not start.",
        );
    }
    let Ok(_admission) = app.restart.admission.try_write() else {
        return problem(
            StatusCode::CONFLICT,
            "restart_busy",
            "Another Deck operation is in progress. Try again when it finishes.",
        );
    };
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }
    let active = app.active.lock().unwrap();
    let store = app.store.lock().unwrap();
    match busy(&app, &store) {
        Ok(false) if active.is_empty() => (),
        Ok(_) => {
            return problem(
                StatusCode::CONFLICT,
                "restart_busy",
                "Deck is working. Restart after all running and queued work finishes.",
            );
        }
        Err(e) => return problem(StatusCode::SERVICE_UNAVAILABLE, "restart_status", e),
    }
    if app.shutdown_requested.swap(true, Ordering::SeqCst) {
        return problem(
            StatusCode::CONFLICT,
            "shutting_down",
            "Deck is already shutting down.",
        );
    }
    *app.restart.candidate.lock().unwrap() = Some(candidate);
    app.stop_request.notify_one();
    (StatusCode::ACCEPTED, Json(json!({"restarting":true}))).into_response()
}
