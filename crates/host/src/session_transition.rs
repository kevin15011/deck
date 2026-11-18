//! Explicit new admissions beside immutable restricted history. No old grants,
//! assignments, native identities or pending inputs are converted or replayed.
use crate::{
    Store,
    server::{App, problem},
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use rusqlite::params;
use serde::Deserialize;
use serde_json::json;
impl Store {
    pub(crate) fn transition_source(&self, session: &str) -> Result<String, String> {
        let source = self.session_by_id(session)?;
        if source.contract.is_some() {
            return Err(
                "Session already has a canonical contract; use its existing assignments".into(),
            );
        }
        self.navigation_settled(&[session.to_string()])?;
        if self
            .all()?
            .iter()
            .filter(|r| r.session == session)
            .flat_map(|r| r.decisions.clone())
            .any(|d| {
                matches!(
                    d.state,
                    deck2_shared::DecisionState::Pending
                        | deck2_shared::DecisionState::Dispatching
                        | deck2_shared::DecisionState::Delivered
                        | deck2_shared::DecisionState::Uncertain
                )
            })
        {
            return Err("Settle historical decisions before creating a transition".into());
        }
        Ok(crate::tasks::digest(
            &serde_json::to_vec(&source).map_err(|_| "Historical identity unavailable")?,
        ))
    }
    pub(crate) fn create_transition(
        &mut self,
        c: &deck2_shared::SessionCommand,
        source: &str,
        expected: &str,
    ) -> Result<deck2_shared::Session, String> {
        if expected.len() != 64 || self.transition_source(source)? != expected {
            return Err("Historical source changed; refresh before transition".into());
        }
        let old = self.session_by_id(source)?;
        if source == c.id
            || c.project_id.as_deref() != Some(&old.project.id)
            || c.members.is_none()
            || c.approvals.as_deref().is_some_and(|a| a != "relay")
        {
            return Err("Transition requires a new identity in the same project with validated canonical assignments and Ask first permissions".into());
        }
        self.conn
            .execute_batch("SAVEPOINT session_transition")
            .map_err(|_| "Cannot begin historical transition")?;
        let result = (|| {
            // Normalize omitted permissions before creation and bind retries to
            // the original request, never to an unrelated current session.
            let mut command = c.clone();
            command.approvals = Some("relay".into());
            let key = format!("session-transition:{}", c.id);
            let body=json!({"source_session":source,"source_digest":expected,"target_session":c.id,"history":"source retained unchanged","authority":"new relay contract only; no historical grants or native context copied","request":{"api":command.api,"project_id":command.project_id,"id":command.id,"title":command.title,"members":command.members,"approvals":"relay"}}).to_string();
            let previous: Option<String> = self
                .conn
                .query_row("SELECT value FROM meta WHERE key=?1", [&key], |r| r.get(0))
                .optional()
                .map_err(|_| "Cannot inspect transition provenance")?;
            let exists: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)",
                [&c.id], |r| r.get(0),
            ).map_err(|_| "Cannot inspect transition target")?;
            if exists && previous.as_deref() != Some(body.as_str())
                || !exists && previous.is_some()
            {
                return Err("Transition identity conflict".into());
            }
            let session = self.create_session(&command)?;
            self.conn
                .execute(
                    "INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO NOTHING",
                    params![key, body],
                )
                .map_err(|_| "Cannot persist transition provenance")?;
            Ok(session)
        })();
        match result {
            Ok(s) => {
                self.conn
                    .execute_batch("RELEASE session_transition")
                    .map_err(|_| "Cannot commit historical transition")?;
                Ok(s)
            }
            Err(e) => {
                self.conn
                    .execute_batch("ROLLBACK TO session_transition; RELEASE session_transition")
                    .map_err(|_| "Cannot roll back historical transition")?;
                Err(e)
            }
        }
    }
}
use rusqlite::OptionalExtension;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Transition {
    api: u32,
    expected_source_digest: String,
    session: deck2_shared::SessionCommand,
}
async fn preview(State(app): State<App>, Path(session): Path<String>) -> Response {
    let store = app.store.lock().unwrap();
    match store.transition_source(&session) {
        Ok(digest)=>Json(json!({"api":deck2_shared::API,"source_session":session,"source_digest":digest,"action":"Create a new canonical session; keep this history and its recorded authority unchanged","approvals":"relay","native_context_copied":false})).into_response(),
        Err(e)=>problem(StatusCode::CONFLICT,"session_transition",e),
    }
}
async fn transition(
    State(app): State<App>,
    Path(source): Path<String>,
    Json(c): Json<Transition>,
) -> Response {
    if c.api != deck2_shared::API {
        return problem(
            StatusCode::CONFLICT,
            "session_transition",
            "Incompatible API",
        );
    }
    crate::server::create_session_command(app, c.session, Some((source, c.expected_source_digest)))
        .await
}
pub(crate) fn routes() -> Router<App> {
    Router::new().route(
        "/api/sessions/{session}/transition",
        get(preview).merge(post(transition)),
    )
}
