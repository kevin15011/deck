//! Host-wide automatic context compaction per runner.
//!
//! The window is fixed by Deck; users only choose whether each runner applies it.
//! Both runners default to enabled. When disabled, the runner keeps its native
//! compaction policy. Launch sites read the cached intent, so a change applies to
//! the next runner process; reuse keys include it so retained processes rotate.
use crate::{
    Store,
    server::{App, problem},
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};

/// Tokens at which each runner compacts its own conversation.
pub(crate) const WINDOW: u64 = 500_000;
const KEY: &str = "runner_auto_compact_v1";

static CLAUDE: AtomicBool = AtomicBool::new(true);
static CODEX: AtomicBool = AtomicBool::new(true);

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Settings {
    pub claude: bool,
    pub codex: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { claude: true, codex: true }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Runner {
    Claude,
    Codex,
}

impl Store {
    pub fn init_runner_compaction(&self) -> Result<(), String> {
        publish(self.runner_compaction()?);
        Ok(())
    }
    pub(crate) fn runner_compaction(&self) -> Result<Settings, String> {
        let value = self
            .conn
            .query_row("SELECT value FROM meta WHERE key=?1", [KEY], |r| r.get::<_, String>(0))
            .optional()
            .map_err(|_| "Cannot read automatic compaction settings")?;
        match value {
            Some(v) => serde_json::from_str(&v).map_err(|_| "Invalid automatic compaction settings".into()),
            None => Ok(Settings::default()),
        }
    }
    fn set_runner_compaction(&self, settings: &Settings) -> Result<(), String> {
        let value = serde_json::to_string(settings).map_err(|_| "Cannot encode automatic compaction settings")?;
        self.conn
            .execute(
                "INSERT INTO meta VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [KEY, value.as_str()],
            )
            .map_err(|_| "Cannot save automatic compaction settings")?;
        Ok(())
    }
}

fn publish(settings: Settings) {
    CLAUDE.store(settings.claude, Ordering::SeqCst);
    CODEX.store(settings.codex, Ordering::SeqCst);
}

pub(crate) fn claude_enabled() -> bool {
    CLAUDE.load(Ordering::SeqCst)
}

pub(crate) fn codex_enabled() -> bool {
    CODEX.load(Ordering::SeqCst)
}

/// Flag settings passed to the Claude Agent SDK bridge.
pub(crate) fn claude_settings(base: &str, enabled: bool) -> String {
    if !enabled {
        return base.to_owned();
    }
    let mut value: Value = serde_json::from_str(base).expect("static Claude settings are valid JSON");
    value["autoCompactWindow"] = json!(WINDOW);
    value.to_string()
}

/// Settings for the next Claude bridge launch and its reuse fingerprint.
pub(crate) fn claude_launch_settings() -> String {
    claude_settings(crate::claude_readiness::SETTINGS, claude_enabled())
}

/// Codex `-c` override, when enabled.
pub(crate) fn codex_override(enabled: bool) -> Option<String> {
    enabled.then(|| format!("model_auto_compact_token_limit={WINDOW}"))
}

fn body(settings: Settings) -> Value {
    json!({"api": deck2_shared::API, "window": WINDOW, "claude": settings.claude, "codex": settings.codex})
}

pub(crate) async fn inspect(State(app): State<App>) -> Response {
    match app.store.lock().unwrap().runner_compaction() {
        Ok(s) => Json(body(s)).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "auto_compact_settings", e),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Request {
    api: u32,
    enabled: bool,
}

pub(crate) async fn change(State(app): State<App>, Path(runner): Path<Runner>, Json(r): Json<Request>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }
    if r.api != deck2_shared::API {
        return problem(StatusCode::BAD_REQUEST, "api", "Unsupported API");
    }
    if !app.persistence_available() {
        return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", "Runner settings are unavailable");
    }
    let store = app.store.lock().unwrap();
    let result = store.runner_compaction().and_then(|mut s| {
        match runner {
            Runner::Claude => s.claude = r.enabled,
            Runner::Codex => s.codex = r.enabled,
        }
        store.set_runner_compaction(&s)?;
        Ok(s)
    });
    match result {
        Ok(s) => {
            publish(s);
            Json(body(s)).into_response()
        }
        Err(e) => problem(StatusCode::CONFLICT, "auto_compact_settings", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_window_is_added_only_when_enabled() {
        let base = crate::claude_readiness::SETTINGS;
        let on: Value = serde_json::from_str(&claude_settings(base, true)).unwrap();
        assert_eq!(on["autoCompactWindow"], json!(500_000));
        // Existing launch policy is preserved.
        let original: Value = serde_json::from_str(base).unwrap();
        for (k, v) in original.as_object().unwrap() {
            assert_eq!(&on[k], v);
        }
        assert_eq!(claude_settings(base, false), base);
    }

    #[test]
    fn codex_limit_is_added_only_when_enabled() {
        assert_eq!(codex_override(true).as_deref(), Some("model_auto_compact_token_limit=500000"));
        assert_eq!(codex_override(false), None);
    }

    #[test]
    fn settings_default_enabled_and_persist_per_runner() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        let project = dir.path().to_str().unwrap();
        let store = Store::open(&path, project).unwrap();
        assert_eq!(store.runner_compaction().unwrap(), Settings { claude: true, codex: true });
        store.set_runner_compaction(&Settings { claude: false, codex: true }).unwrap();
        drop(store);
        let store = Store::open(&path, project).unwrap();
        assert_eq!(store.runner_compaction().unwrap(), Settings { claude: false, codex: true });
    }
}
