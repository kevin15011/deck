//! Versioned conversation selections; historical project configurations are immutable.
#[cfg(test)]
mod tests {
    use crate::Store;
    use deck2_shared::{API, Mode, SessionCommand};
    #[test]
    fn selections_are_independent_revisioned_and_frozen() {
        let mut s = Store::open_memory("/fixture").unwrap();
        let other = s
            .create_session(&SessionCommand {
            project_id: None,
                members: None,
                approvals: None,
                api: API,
                id: "other-session".into(),
                title: "Other".into(),
            })
            .unwrap();
        let first = s.session.clone();
        let c = s.configuration().unwrap();
        let a = s
            .save_ordinary_selection(&first, 0, Mode::OrdinaryReadOnlyV1, c.clone(), None)
            .unwrap();
        assert!(s.ordinary_selection(&other.id).unwrap().is_none());
        assert!(
            s.save_ordinary_selection(&first, 0, Mode::OrdinaryReviewedV1, c.clone(), None)
                .is_err()
        );
        let snapshot = a.snapshot.clone();
        s.save_ordinary_selection(&first, 1, Mode::OrdinaryReviewedV1, c, None)
            .unwrap();
        s.validate_snapshot(&snapshot).unwrap();
        assert_eq!(s.ordinary_selection(&first).unwrap().unwrap().revision, 2);
        assert_eq!(snapshot.selection.unwrap().revision, 1);
    }
    #[test]
    fn recorded_permission_cannot_be_reinterpreted_on_reopen() {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("state.db");
        let mut s = Store::open(&db, "/fixture").unwrap();
        let session = s.session.clone();
        let c = s.configuration().unwrap();
        s.save_ordinary_selection(&session, 0, Mode::OrdinaryReadOnlyV1, c, None)
            .unwrap();
        let mut r = s
            .admit(&deck2_shared::ScopedSubmit {
                api: API,
                id: "ordinary-command".into(),
                session,
                prompt: "Inspect".into(),
                mode: Mode::OrdinaryReadOnlyV1,
                attachments: vec![],
                fresh: true,
                queue: false,
            })
            .unwrap();
        r.phase = deck2_shared::Phase::Completed;
        s.save(&mut r).unwrap();
        drop(s);
        let mut s = Store::open(&db, "/fixture").unwrap();
        let mut r = s.get(&r.id).unwrap().unwrap();
        r.mode = Mode::OrdinaryReviewedV1;
        s.save(&mut r).unwrap();
        drop(s);
        let before = std::fs::read(&db).unwrap();
        assert!(Store::open(&db, "/fixture").is_err());
        assert_eq!(std::fs::read(&db).unwrap(), before);
    }

    #[tokio::test]
    async fn failed_preparation_preserves_selection_and_unknown_cleanup_excludes_work() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let binary = d.path().join("codex");
        std::fs::write(&binary, include_str!("../tests/fake_native.py")).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(d.path().join("mode"), "auth").unwrap();
        let db = d.path().join("state.db");
        let project = d.path().to_str().unwrap();
        let store = Store::open(&db, project).unwrap();
        let session = store.session.clone();
        let app = crate::server::App::new(
            store,
            "127.0.0.1:1234".into(),
            binary,
            None,
            "admin".into(),
            "recovery".into(),
        );
        *app.scope_root.lock().unwrap() = Some(d.path().join("scopes"));
        *app.artifact_store.lock().unwrap() = Some(d.path().join("artifacts"));
        let body = |revision, investigator| super::Save {
            api: API,
            expected_revision: revision,
            permission: "read_only".into(),
            investigator,
            fresh: true,
        };
        super::prepare(app.clone(), session.clone(), body(0, false))
            .await
            .unwrap();
        let config = app.store.lock().unwrap().configuration().unwrap();
        assert!(
            super::prepare(app.clone(), session.clone(), body(1, true))
                .await
                .unwrap_err()
                .contains("authentication")
        );
        {
            let s = app.store.lock().unwrap();
            assert_eq!(s.ordinary_selection(&session).unwrap().unwrap().revision, 1);
            assert_eq!(s.configuration().unwrap(), config);
            assert!(!s.runner_busy().unwrap());
        }
        let fault = std::sync::Arc::new(crate::native::ProbeCleanupFault {
            unsettled: std::sync::atomic::AtomicBool::new(true),
            reached: tokio::sync::Notify::new(),
            pause: false,
            help_only: false,
        });
        // This fault exercises a cold qualification probe, not a memoized success.
        crate::native::invalidate_qualifications();
        let result = crate::native::PROBE_CLEANUP_FAULT
            .scope(
                fault,
                super::prepare(app.clone(), session.clone(), body(1, true)),
            )
            .await;
        assert!(result.unwrap_err().contains("cleanup uncertain"));
        assert!(app.store.lock().unwrap().runner_busy().unwrap());
        assert!(
            super::prepare(app.clone(), session.clone(), body(1, false))
                .await
                .is_err()
        );
        drop(app);
        let recovered = Store::open(&db, project).unwrap();
        assert!(recovered.runner_busy().unwrap());
        assert_eq!(
            recovered
                .ordinary_selection(&session)
                .unwrap()
                .unwrap()
                .revision,
            1
        );
    }
}
use crate::{Store, configuration::Configuration};
use deck2_shared::{API, AdmissionSnapshot, Assignment, Definition, Mode, SelectionIdentity};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
pub const INSTRUCTIONS: &str = "Deck ordinary developer session, profile deck2-ordinary-v1. Native shell, network, arbitrary extensions and destructive Git are forbidden. Images are delivered only to Lead. Use only the admitted depth-one read-only Investigator task tools when present. Retrieve the exact task report with deck_task_result and record its disposition with deck_task_treat; a completion notification is not a report. Before proposing an edit, wait for all specialist/helper ownership to settle. For reviewed editing, use native apply_patch on ONE existing canonical UTF-8 project file, at most 64 KiB; no creation/deletion/rename, symlinks or binaries. Each file effect requires the user's Allow once decision and current project trust. Read-only permission never grants edits. Code Economy: necessary code, correctness and accessibility before size; no hard code-size limits. Native turn completion is not independent verification. History is evidence; never silently replay it. Tool/graph evidence retains its recorded generation and snapshot after edits. Missing tools require exact scoped-source fallback, never unrestricted shell.";
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Selection {
    pub revision: u64,
    pub mode: Mode,
    pub snapshot: AdmissionSnapshot,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Save {
    pub api: u32,
    pub expected_revision: u64,
    pub permission: String,
    pub investigator: bool,
    pub fresh: bool,
}
pub fn definitions() -> Vec<Definition> {
    let d = vec![Definition {
        digest: crate::tasks::digest(INSTRUCTIONS.as_bytes()),
        name: "Ordinary developer session v1".into(),
        body: INSTRUCTIONS.into(),
        kind: "managed_policy".into(),
        source: "crates/host/src/ordinary.rs::INSTRUCTIONS".into(),
        owner: "Deck managed finite profile".into(),
        roles: vec!["lead".into()],
        modes: vec!["ordinary_v1".into()],
        required_resources: vec!["Codex 0.166.0 / gpt-6.1-sol; fresh execution".into()],
    }];
    d
}
pub fn definition_ids(investigator: bool) -> Vec<String> {
    definitions()
        .into_iter()
        .chain(crate::configuration::definitions().into_iter().filter(|d| {
            (investigator || d.name == "Codex disabled extensions")
                && matches!(
                    d.name.as_str(),
                    "Lead dynamic tools"
                        | "Investigator"
                        | "Scoped project tools"
                        | "Codex disabled extensions"
                )
        }))
        .map(|d| d.digest)
        .collect()
}
impl Store {
    pub(crate) fn ordinary_schema(&self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS session_selections(session TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(session,revision));").map_err(|_|"Cannot initialize session selections".into())
    }
    pub fn ordinary_selection(&self, session: &str) -> Result<Option<Selection>, String> {
        self.session_by_id(session)?;

        let body:Option<String>=self.conn.query_row("SELECT body FROM session_selections WHERE session=?1 ORDER BY revision DESC LIMIT 1",[session],|r|r.get(0)).optional().map_err(|_|"Cannot read session selection")?;
        body.map(|s| serde_json::from_str(&s).map_err(|_| "Invalid session selection".into()))
            .transpose()
    }
    pub fn selection_ready(&self, session: &str, revision: u64) -> Result<(), String> {
        if self.ordinary_selection(session)?.map_or(0, |s| s.revision) != revision {
            return Err("Session selection changed; refresh before saving".into());
        }
        if self.affected_work()? {
            return Err(
                "Settle queued, active and uncertain ownership before configuring a session".into(),
            );
        }
        Ok(())
    }
    pub fn save_ordinary_selection(
        &mut self,
        session: &str,
        revision: u64,
        mode: Mode,
        c: Configuration,
        investigator: Option<Assignment>,
    ) -> Result<Selection, String> {
        self.selection_ready(session, revision)?;
        if !mode.ordinary() || c != self.configuration_for(&self.session_project(session)?.root)? {
            return Err("Unsupported profile or changed project selection".into());
        }
        let mut snapshot = self.admission_snapshot_for(&self.session_project(session)?.root, &Mode::ReadOnly)?;
        snapshot.selection = Some(SelectionIdentity {
            session: session.into(),
            revision: revision + 1,
        });
        snapshot.definitions = definition_ids(investigator.is_some());
        if let Some(r) = snapshot.runner.as_mut() {
            r.model = Some("gpt-6.1-sol".into());
        }
        snapshot.investigator = investigator;
        if snapshot.investigator.is_some() {
            snapshot.helper = c.helper;
            snapshot.cbm = c.cbm;
            if snapshot.helper.is_some() {
                snapshot.definitions.retain(|id| {
                    self.definition(id)
                        .is_ok_and(|d| d.name != "Scoped project tools")
                });
                snapshot.definitions.extend(
                    crate::configuration::compact_definitions()
                        .into_iter()
                        .map(|d| d.digest),
                );
            }
            if snapshot.cbm.is_some() {
                snapshot.definitions.extend(
                    crate::cbm_management::definitions()
                        .into_iter()
                        .map(|d| d.digest),
                );
            }
        }
        let selection = Selection {
            revision: revision + 1,
            mode,
            snapshot,
        };
        self.conn
            .execute(
                "INSERT INTO session_selections VALUES(?1,?2,?3)",
                params![
                    session,
                    selection.revision as i64,
                    serde_json::to_string(&selection).map_err(|_| "Cannot encode selection")?
                ],
            )
            .map_err(|_| "Cannot save session selection")?;
        Ok(selection)
    }
    pub fn validate_ordinary_snapshot(&self, snapshot: &AdmissionSnapshot) -> Result<(), String> {
        let id = snapshot
            .selection
            .as_ref()
            .ok_or("Missing session binding")?;
        let body: String = self
            .conn
            .query_row(
                "SELECT body FROM session_selections WHERE session=?1 AND revision=?2",
                params![id.session, id.revision as i64],
                |r| r.get(0),
            )
            .map_err(|_| "Historical session selection unavailable")?;
        let s: Selection =
            serde_json::from_str(&body).map_err(|_| "Invalid historical selection")?;
        let mut actual = snapshot.clone();
        actual.delivery_observed = false;
        actual.exclusions = s.snapshot.exclusions.clone();
        if actual != s.snapshot {
            return Err("Admission differs from frozen session selection".into());
        }
        for d in &snapshot.definitions {
            self.definition(d)?;
        }
        Ok(())
    }
}
pub fn inspect_snapshot(
    conn: &rusqlite::Connection,
    snapshot: &AdmissionSnapshot,
    session: &str,
    mode: &Mode,
) -> Result<(), String> {
    let id = snapshot
        .selection
        .as_ref()
        .ok_or("Ordinary selection missing")?;
    if id.session != session {
        return Err("Foreign session selection".into());
    }
    let body: String = conn
        .query_row(
            "SELECT body FROM session_selections WHERE session=?1 AND revision=?2",
            params![id.session, id.revision as i64],
            |r| r.get(0),
        )
        .map_err(|_| "Missing session selection")?;
    let s: Selection = serde_json::from_str(&body).map_err(|_| "Invalid session selection")?;
    let mut actual = snapshot.clone();
    actual.delivery_observed = false;
    actual.exclusions = s.snapshot.exclusions.clone();
    if actual != s.snapshot || !s.mode.ordinary() || &s.mode != mode || s.revision != id.revision {
        return Err("Invalid frozen session admission".into());
    }
    Ok(())
}
use crate::server::{App, problem};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
async fn inspect(State(app): State<App>, Path(session): Path<String>) -> Response {
    let s = app.store.lock().unwrap();
    match s.ordinary_selection(&session) {
        Ok(selected)=>Json(serde_json::json!({"api":API,"session":session,"selected":selected,"preparing":s.ordinary_preparing().unwrap_or(true),"limits":"Codex 0.166.0 / gpt-6.1-sol only; explicit fresh execution each input. Images to Lead only. Depth-one read-only Investigator; scoped CBM/RTK when selected in project Configuration, exact read fallback. Existing UTF-8 files only, 64 KiB, one decision per edit. YOLO and specialist image forwarding unavailable."})).into_response(),
        Err(e)=>problem(StatusCode::CONFLICT,"session_selection",e)
    }
}
impl Store {
    pub fn ordinary_preparing(&self) -> Result<bool, String> {
        let value: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key='ordinary_preparing'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Cannot inspect preparation")?;
        Ok(value.is_some_and(|s| s != "settled"))
    }
    fn set_ordinary_preparing(&self, value: &str) -> Result<(), String> {
        self.conn.execute("INSERT INTO meta VALUES('ordinary_preparing',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[value]).map_err(|_|"Cannot persist preparation ownership")?;
        Ok(())
    }
}
async fn save(
    State(app): State<App>,
    Path(session): Path<String>,
    Json(body): Json<Save>,
) -> Response {
    if body.api != API
        || !body.fresh
        || !["read_only", "review_each_edit"].contains(&body.permission.as_str())
    {
        return problem(
            StatusCode::CONFLICT,
            "session_selection",
            "Select a supported permission and explicitly start a fresh execution",
        );
    }
    // Detached worker owns cleanup even if HTTP disconnects. The durable marker is
    // conservatively retained on crash or unknown cleanup, including across restart.
    let worker = tokio::spawn(crate::web_identity::inherit(async move { prepare(app, session, body).await }));
    match worker.await {
        Ok(Ok(s)) => Json(s).into_response(),
        Ok(Err(e)) => problem(StatusCode::CONFLICT, "session_selection", e),
        Err(_) => problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "session_selection",
            "Preparation ownership uncertain; preserve state and inspect before recovery",
        ),
    }
}
async fn prepare(app: App, session: String, body: Save) -> Result<Selection, String> {
    let app=app.for_session(&session)?;
    crate::web_identity::authorize()?;
    let key = format!("ordinary:{}", uuid::Uuid::new_v4());
    let config = {
        let mut active = app.active.lock().unwrap();
        let s = app.store.lock().unwrap();
        if !app.persistence_available() || !active.is_empty() || s.runner_busy()? {
            return Err(
                "Settle process or maintenance ownership before session configuration".into(),
            );
        }
        s.selection_ready(&session, body.expected_revision)?;
        let c = s.configuration_for(&app.project)?;
        let binding = c
            .runner
            .as_ref()
            .ok_or("Select an installed Codex runner in Configuration")?;
        crate::runner_management::validate_binding(binding)?;
        app.retain_auth_scope()?;
        s.set_ordinary_preparing(&key)?;
        active.insert(key.clone(), tokio::sync::watch::channel(false).0);
        c
    };
    let result = async {
        let binding = config.runner.as_ref().ok_or("Missing runner")?;
        if crate::tasks::digest(
            &std::fs::read(&binding.path).map_err(|_| "Selected executable unavailable")?,
        ) != binding.executable
        {
            return Err("Selected executable changed; review runner selection".into());
        }
        let runner = if body.investigator {
            let mut tools = if config.helper.is_some() {
                crate::opencode::compact_tools()
            } else {
                crate::opencode::read_tools()
            };
            if config.cbm.is_some() {
                tools = crate::cbm_management::tools(tools);
            }
            Some(
                crate::opencode::Runner::prepare_codex(
                    std::path::Path::new(&binding.path),
                    &app.artifact_root()?,
                    std::path::Path::new(&app.project),
                    tools,
                    config.helper.clone(),
                )
                .await?,
            )
        } else {
            None
        };
        if crate::tasks::digest(
            &std::fs::read(&binding.path).map_err(|_| "Selected executable unavailable")?,
        ) != binding.executable
        {
            return Err("Executable changed during preparation".into());
        }
        let active = app.active.lock().unwrap();
        if active.keys().any(|k| k != &key) {
            return Err("Process ownership changed during preparation".into());
        }
        let mut s = app.store.lock().unwrap();
        crate::web_identity::admit()?;
        let selected = s.save_ordinary_selection(
            &session,
            body.expected_revision,
            if body.permission == "read_only" {
                Mode::OrdinaryReadOnlyV1
            } else {
                Mode::OrdinaryReviewedV1
            },
            config.clone(),
            runner
                .as_ref()
                .map(|r| crate::configuration::assignment_from_runner(r)),
        )?;
        // Publish resource under the same locks as the durable selection. Dispatch
        // compares every resource identity to the frozen admission before use.
        if let Some(runner) = runner {
            *app.team.lock().unwrap() = Some(runner);
        }
        Ok(selected)
    }
    .await;
    if result
        .as_ref()
        .is_err_and(|e: &String| e.contains("cleanup uncertain"))
    {
        return result;
    }
    app.store
        .lock()
        .unwrap()
        .set_ordinary_preparing("settled")?;
    app.clear_active(&key);
    result
}
pub fn routes() -> axum::Router<App> {
    axum::Router::new().route(
        "/api/sessions/{session}/selection",
        axum::routing::get(inspect).post(save),
    )
}
pub fn inspect_store(conn: &rusqlite::Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT session,revision,body FROM session_selections ORDER BY session,revision")
        .map_err(|_| "Invalid session selection schema")?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| "Cannot inspect session selections")?;
    let mut previous = std::collections::HashMap::new();
    for row in rows {
        let (session, revision, body) = row.map_err(|_| "Invalid session selection row")?;
        let revision = u64::try_from(revision).map_err(|_| "Invalid session selection revision")?;
        let selected: Selection =
            serde_json::from_str(&body).map_err(|_| "Invalid session selection record")?;
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)",
                [&session],
                |r| r.get(0),
            )
            .map_err(|_| "Cannot inspect session ownership")?;
        if !exists
            || previous.get(&session).copied().unwrap_or(0) + 1 != revision
            || selected.revision != revision
            || selected.snapshot.delivery_observed
            || selected.snapshot.selection
                != Some(SelectionIdentity {
                    session: session.clone(),
                    revision,
                })
        {
            return Err("Invalid session selection ownership/revision".into());
        }
        inspect_snapshot(conn, &selected.snapshot, &session, &selected.mode)?;
        previous.insert(session, revision);
    }
    Ok(())
}
