mod message_times;
pub(crate) mod latency;
use deck2_shared::{API, POLICY, Phase, Receipt, Submit};
use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
pub mod external_tools;
pub mod cbm_automatic;
pub mod cbm_artifacts;
pub mod cbm_management;
pub mod cbm_runtime;
pub mod cbm_service;
pub mod configuration;
pub mod decisions;
pub mod dictation;
pub mod git_review;
pub mod history;
pub mod images;
pub mod launcher;
pub mod lifecycle;
pub mod managed_tools;
mod directories;
pub mod native;
mod observations;
mod activity;
pub mod application;
mod task_panel;
mod member_integration;
mod codex_member;
mod codex_protocol;
mod native_approval;
mod permission_policy;
mod permission_rejection;
mod permission_bounds;
pub mod opencode;
pub mod connected_opencode;
mod native_identity;
pub mod ordinary;
mod quota;
pub mod rtk;
pub mod runner_management;
mod runner_compaction;
mod claude;
mod claude_readiness;
#[cfg(test)]
mod claude_fixture;
pub mod server;
mod workspace_events;
mod steering;
mod member_guidance;
pub mod web_identity;
pub mod web_push;
mod notification_store;
mod session_codebase;
pub mod session_contract;
pub mod session_decisions;
mod session_freshness;
pub mod session_mcp;
mod session_epoch;
pub mod session_roles;
mod session_skills;
mod execution_view;
mod session_transition;
mod session_source;
pub mod session_structured;
pub mod session_tasks;
mod session_scheduler;
mod session_continuity;
pub mod sessions;
mod sidebar;
pub mod projects;
pub mod tasks;
pub fn now() -> u64 {
    #[cfg(test)]
    if let Some(now) = test_clock::now() {
        return now;
    }
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn admit_http(
    expected: &str,
    host: Option<&str>,
    origin: Option<&str>,
    authenticated: bool,
    mutation: bool,
) -> bool {
    host == Some(expected)
        && authenticated
        && match origin {
            Some(s) => s == format!("http://{expected}"),
            None => !mutation,
        }
}
#[derive(Debug)]
pub struct AdmissionError {
    pub storage: bool,
    pub message: String,
}
impl From<&str> for AdmissionError {
    fn from(v: &str) -> Self {
        Self {
            storage: false,
            message: v.into(),
        }
    }
}
impl From<String> for AdmissionError {
    fn from(v: String) -> Self {
        Self {
            storage: false,
            message: v,
        }
    }
}
impl std::fmt::Display for AdmissionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.message.fmt(f)
    }
}
fn storage_error(message: String) -> AdmissionError {
    AdmissionError {
        storage: true,
        message,
    }
}
pub struct Store {
    conn: Connection,
    pub session: String,
    pub project: String,
    workspace_updates: workspace_events::Updates,
}
impl Store {
    pub fn open(path: &Path, project: &str) -> Result<Self, String> {
        // Compatibility inspection must not open a writable connection: even WAL
        // configuration or schema repair would mutate an unsupported store.
        let existing = match std::fs::metadata(path) {
            Ok(m) => m.len() != 0,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => return Err("Cannot inspect state database".into()),
        };
        if existing {
            let read =
                Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .map_err(|_| "Cannot inspect state database read-only")?;
            Self::inspect(&read, project)?;
        }
        Self::init(
            Connection::open(path).map_err(|_| "Cannot open state database")?,
            project,
            !existing,
        )
    }
    pub fn open_memory(project: &str) -> Result<Self, String> {
        Self::init(
            Connection::open_in_memory().map_err(|_| "Cannot open state")?,
            project,
            true,
        )
    }
    fn inspect(conn: &Connection, _project: &str) -> Result<(), String> {
        let invalid =
            "Unsupported or corrupt state; preserve it and use its original deck2 version";
        let integrity: String = conn
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(|_| invalid)?;
        if integrity != "ok" {
            return Err(invalid.into());
        }
        let meta = |key: &str| -> Result<String, String> {
            conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))
                .optional()
                .map_err(|_| invalid.to_string())?
                .ok_or_else(|| invalid.to_string())
        };
        if ![
            "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18",
        ]
        .contains(&meta("schema")?.as_str())
        {
            return Err(invalid.into());
        }
        if meta("schema")? != "1" && !["true", "false"].contains(&meta("trusted")?.as_str()) {
            return Err(invalid.into());
        }
        let default_session = meta("session")?;
        let project = meta("project")?;
        let unbound_workspace = project.is_empty() && default_session.is_empty();
        if default_session.is_empty() && !unbound_workspace {
            return Err(invalid.into());
        }
        let project = project.as_str();
        if ["15", "16", "17", "18"].contains(&meta("schema")?.as_str()) { crate::projects::inspect(conn)?; }
        let mut normal_attempts = std::collections::HashMap::new();
        if [
            "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18",
        ]
        .contains(&meta("schema")?.as_str())
        {
            if meta("host")?.is_empty()
                || !["true", "false"].contains(&meta("queue_paused")?.as_str())
            {
                return Err(invalid.into());
            }
            let mut stmt = conn
                .prepare("SELECT id,body FROM sessions")
                .map_err(|_| invalid)?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|_| invalid)?;
            let mut ids = std::collections::HashSet::new();
            for row in rows {
                let (id, body) = row.map_err(|_| invalid)?;
                let session: deck2_shared::Session =
                    serde_json::from_str(&body).map_err(|_| invalid)?;
                crate::native_identity::validate_legacy_session(&session, &meta("schema")?)
                    .map_err(|_| invalid)?;
                if session.id != id
                    || (!["12", "13", "14", "15", "16", "17", "18"].contains(&meta("schema")?.as_str())
                        && session.contract.is_some())
                    || session
                        .contract
                        .as_ref()
                        .is_some_and(|c| crate::session_contract::validate(c).is_err())
                {
                    return Err(invalid.into());
                }
                ids.insert(id);
            }
            if !unbound_workspace && !ids.contains(&default_session) {
                return Err(invalid.into());
            }
            let mut stmt = conn
                .prepare("SELECT body FROM receipts")
                .map_err(|_| invalid)?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|_| invalid)?;
            for row in rows {
                let r: Receipt =
                    serde_json::from_str(&row.map_err(|_| invalid)?).map_err(|_| invalid)?;
                if r.mode == deck2_shared::Mode::SessionV1 {
                    if !["12", "13", "14", "15", "16", "17", "18"].contains(&meta("schema")?.as_str()) {
                        return Err(invalid.into());
                    }
                    let c = r
                        .configuration
                        .as_ref()
                        .and_then(|s| s.session_contract.as_ref())
                        .ok_or(invalid)?;
                    if normal_attempts
                        .insert(r.attempt.clone(), (r.session.clone(), c.lead_task.clone()))
                        .is_some()
                    {
                        return Err(invalid.into());
                    }
                }
                if !ids.contains(&r.session)
                    || r.decisions
                        .iter()
                        .any(|d| d.session != r.session || d.command != r.id)
                {
                    return Err(invalid.into());
                }
            }
        }
        if ["4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18"]
            .contains(&meta("schema")?.as_str())
        {
            let mut stmt = conn
                .prepare("SELECT id,body FROM tasks")
                .map_err(|_| invalid)?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|_| invalid)?;
            for row in rows {
                let (id, body) = row.map_err(|_| invalid)?;
                let t: deck2_shared::Task = serde_json::from_str(&body).map_err(|_| invalid)?;
                let root: String = conn
                    .query_row("SELECT body FROM receipts WHERE id=?1", [&t.root], |r| {
                        r.get(0)
                    })
                    .map_err(|_| invalid)?;
                let r: Receipt = serde_json::from_str(&root).map_err(|_| invalid)?;
                if id != t.id
                    || t.session != r.session
                    || t.parent_attempt != r.attempt
                    || if r.mode == deck2_shared::Mode::SessionV1 {
                        !crate::session_contract::MEMBERS.contains(&t.owner.as_str())
                            || t.owner == "lead"
                    } else {
                        t.owner != "investigator"
                    }
                    || !(r.mode == deck2_shared::Mode::Team
                        || r.mode.ordinary()
                        || r.mode == deck2_shared::Mode::SessionV1)
                    || (r.mode != deck2_shared::Mode::SessionV1 && t.scope.is_empty())
                    || t.scope.len() > 16
                    || t.scope
                        .iter()
                        .any(|p| crate::tasks::validate_relative(p).is_err())
                    || t.acceptance.trim().is_empty()
                    || t.acceptance.len()
                        > if r.mode == deck2_shared::Mode::SessionV1 {
                            8192
                        } else {
                            2048
                        }
                    || t.attempts.is_empty()
                    || t.attempts
                        .iter()
                        .map(|a| &a.id)
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                        != t.attempts.len()
                    || t.attempts.iter().any(|a| {
                        (r.mode != deck2_shared::Mode::SessionV1 && a.configuration
                            .as_ref()
                            .is_some_and(|selected| Some(selected) != r.configuration.as_ref()))
                            || a.report.as_ref().is_some_and(|v| {
                                v.attempt != a.id
                                    || v.text.len() > 1024 * 1024
                                    || v.digest != crate::tasks::digest(v.text.as_bytes())
                            })
                            || a.treatments.iter().any(|treatment| {
                                (if r.mode == deck2_shared::Mode::SessionV1 {
                                    normal_attempts.get(&treatment.lead_attempt).is_none_or(
                                        |(session, lead)| {
                                            session != &r.session
                                                || r.configuration
                                                    .as_ref()
                                                    .and_then(|s| s.session_contract.as_ref())
                                                    .is_none_or(|c| &c.lead_task != lead)
                                        },
                                    )
                                } else {
                                    treatment.lead_attempt != r.attempt
                                }) || {
                                    let matches_outcome = match &a.report {
                                        Some(report) => treatment.report.as_deref() == Some(report.digest.as_str()),
                                        None => r.mode == deck2_shared::Mode::SessionV1
                                            && treatment.report.is_none()
                                            && treatment.disposition == "followup_required"
                                            && matches!(a.phase, deck2_shared::Phase::Completed | deck2_shared::Phase::Failed | deck2_shared::Phase::Cancelled),
                                    };
                                    !matches_outcome || !matches!(
                                            treatment.disposition.as_str(),
                                            "adopted" | "rejected" | "followup_required"
                                        )
                                }
                            })
                    })
                {
                    return Err(invalid.into());
                }
            }
            let mut stmt = conn
                .prepare("SELECT root,call,payload,result FROM task_calls")
                .map_err(|_| invalid)?;
            let calls = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })
                .map_err(|_| invalid)?;
            for call in calls {
                let (root, call, payload, result) = call.map_err(|_| invalid)?;
                if call.is_empty()
                    || call.len() > 256
                    || serde_json::from_str::<(String, crate::tasks::Operation)>(&payload).is_err()
                    || serde_json::from_str::<serde_json::Value>(&result).is_err()
                {
                    return Err(invalid.into());
                }
                conn.query_row("SELECT id FROM receipts WHERE id=?1", [root], |r| {
                    r.get::<_, String>(0)
                })
                .map_err(|_| invalid)?;
            }
        }
        if ["5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18"]
            .contains(&meta("schema")?.as_str())
        {
            crate::configuration::inspect(conn, project)?;
            crate::rtk::inspect_snapshots(
                conn,
                project,
                ["6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18"]
                    .contains(&meta("schema")?.as_str()),
            )?;
        }
        if ["8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18"].contains(&meta("schema")?.as_str()) {
            crate::runner_management::inspect_state(conn)?;
        }
        if ["7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18"].contains(&meta("schema")?.as_str()) {
            crate::lifecycle::inspect(conn)?;
        }
        if ["9", "10", "11", "12", "13", "14", "15", "16", "17", "18"].contains(&meta("schema")?.as_str()) {
            crate::cbm_management::inspect_state(conn, project)?;
        }
        if ["10", "11", "12", "13", "14", "15", "16", "17", "18"].contains(&meta("schema")?.as_str()) {
            crate::images::inspect(conn)?;
        }
        if ["11", "12", "13", "14", "15", "16", "17", "18"].contains(&meta("schema")?.as_str()) {
            crate::ordinary::inspect_store(conn)?;
        }
        if ["12", "13", "14", "15", "16", "17", "18"].contains(&meta("schema")?.as_str()) {
            crate::session_tasks::inspect_events(conn)?;
        }
        if ["13", "14", "15", "16", "17", "18"].contains(&meta("schema")?.as_str()) {
            crate::session_decisions::inspect(conn)?;
        }
        // Validate all persisted receipts and required columns before any write.
        let mut stmt = conn
            .prepare("SELECT id, body FROM receipts")
            .map_err(|_| invalid)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|_| invalid)?;
        for row in rows {
            let (id, body) = row.map_err(|_| invalid)?;
            let receipt: Receipt = serde_json::from_str(&body).map_err(|_| invalid)?;
            if receipt.id != id
                || (![
                    "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18",
                ]
                .contains(&meta("schema")?.as_str())
                    && receipt.decisions.iter().any(|d| {
                        d.session != meta("session").unwrap_or_default() || d.command != receipt.id
                    }))
            {
                return Err(invalid.into());
            }
        }
        if meta("schema")? == "18" { crate::native_identity::inspect(conn)?; }
        conn.prepare("SELECT id, code, status, at_ms FROM diagnostics")
            .map_err(|_| invalid)?;
        Ok(())
    }
    fn init(conn: Connection, project: &str, new: bool) -> Result<Self, String> {
        if !new {
            Self::inspect(&conn, project)?;
        }
        // One transaction publishes the incompatible version only after all
        // recognized legacy migrations and snapshot initialization succeed.
        // On any error the owned connection closes and rolls back this transaction.
        conn.execute_batch("BEGIN IMMEDIATE")
            .map_err(|_| "Cannot begin state migration")?;
        if new {
            conn.execute_batch("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE receipts (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE diagnostics (id TEXT PRIMARY KEY, code TEXT NOT NULL, status INTEGER NOT NULL, at_ms INTEGER NOT NULL);").map_err(|_| "Cannot initialize new state")?;
            for (key, value) in [
                ("schema", "1".to_string()),
                ("project", project.to_string()),
                ("session", if project.is_empty() { String::new() } else { uuid::Uuid::new_v4().to_string() }),
            ] {
                conn.execute("INSERT INTO meta VALUES (?1,?2)", params![key, value])
                    .map_err(|_| "State write failed")?;
            }
        }
        let schema: String = conn
            .query_row("SELECT value FROM meta WHERE key='schema'", [], |r| {
                r.get(0)
            })
            .map_err(|_| "Schema read failed")?;
        if ![
            "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18",
        ]
        .contains(&schema.as_str())
        {
            // Both recognized schemas migrate in one transaction, including receipts.
            let result = (|| -> Result<(), String> {
                conn.execute_batch(
                    "CREATE TABLE sessions (id TEXT PRIMARY KEY, body TEXT NOT NULL);",
                )
                .map_err(|_| "Cannot begin session migration")?;
                if schema == "1" {
                    conn.execute("INSERT INTO meta VALUES ('trusted','false')", [])
                        .map_err(|_| "Cannot migrate trust")?;
                }
                let id: String = conn
                    .query_row("SELECT value FROM meta WHERE key='session'", [], |r| {
                        r.get(0)
                    })
                    .map_err(|_| "Cannot migrate session")?;
                let session = deck2_shared::Session {
                    original_generation: None,
                    project: Default::default(),
                    original: None,
                    contract: None,
                    id: id.clone(),
                    title: "Project conversation".into(),
                    native: None,
                };
                if !id.is_empty() {
                    conn.execute(
                        "INSERT INTO sessions VALUES (?1,?2)",
                        params![
                            id,
                            serde_json::to_string(&session).map_err(|_| "Cannot encode session")?
                        ],
                    )
                    .map_err(|_| "Cannot migrate session")?;
                }
                let mut stmt = conn
                    .prepare("SELECT body FROM receipts")
                    .map_err(|_| "Cannot read legacy receipts")?;
                let rows = stmt
                    .query_map([], |r| r.get::<_, String>(0))
                    .map_err(|_| "Cannot read legacy receipts")?;
                let mut receipts = Vec::new();
                for row in rows {
                    let mut r: Receipt =
                        serde_json::from_str(&row.map_err(|_| "Cannot read receipt")?)
                            .map_err(|_| "Invalid receipt")?;
                    r.session = id.clone();
                    for d in &r.decisions {
                        if d.session != id || d.command != r.id {
                            return Err("Invalid legacy decision ownership".into());
                        }
                    }
                    receipts.push(r);
                }
                drop(stmt);
                for r in receipts {
                    conn.execute(
                        "UPDATE receipts SET body=?1 WHERE id=?2",
                        params![
                            serde_json::to_string(&r).map_err(|_| "Cannot encode receipt")?,
                            r.id
                        ],
                    )
                    .map_err(|_| "Cannot migrate receipt")?;
                }
                for (key, value) in [
                    ("host", uuid::Uuid::new_v4().to_string()),
                    ("queue_paused", "true".into()),
                ] {
                    conn.execute("INSERT INTO meta VALUES (?1,?2)", params![key, value])
                        .map_err(|_| "Cannot migrate identity")?;
                }
                conn.execute_batch("CREATE TABLE tasks (id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE task_calls (root TEXT NOT NULL,call TEXT NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(root,call)); UPDATE meta SET value='4' WHERE key='schema';")
                    .map_err(|_| "Cannot commit migration")?;
                Ok(())
            })();
            if result.is_err() {
                let _ = conn.execute_batch("ROLLBACK");
                return Err("State migration failed; transaction rolled back".into());
            }
        }
        if schema == "3" && conn.execute_batch("CREATE TABLE tasks (id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE task_calls (root TEXT NOT NULL,call TEXT NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(root,call)); UPDATE meta SET value='4' WHERE key='schema';").is_err() {
                let _=conn.execute_batch("ROLLBACK"); return Err("Task migration failed; transaction rolled back".into());
        }
        conn.execute("UPDATE meta SET value='true' WHERE key='queue_paused'", [])
            .map_err(|_| "Cannot pause recovered queue")?;
        let session = conn
            .query_row("SELECT value FROM meta WHERE key='session'", [], |r| {
                r.get(0)
            })
            .map_err(|_| "Session read failed")?;
        let mut store = Self {
            session,
            project: conn.query_row("SELECT value FROM meta WHERE key='project'", [], |r| r.get(0)).map_err(|_| "Recorded project missing")?,
            conn,
            workspace_updates: Default::default(),
        };
        store.init_configuration()?;
        store.init_snapshots()?;
        store.init_lifecycle()?;
        store.init_runner_management()?;
        store.init_cbm()?;
        store.init_images()?;
        store.init_session_epochs()?;
        store.ordinary_schema()?;
        if !["12", "13", "14", "15", "16", "17", "18"].contains(&schema.as_str()) {
            store.conn.execute_batch("CREATE TABLE session_events (seq INTEGER PRIMARY KEY AUTOINCREMENT,session TEXT NOT NULL,task TEXT NOT NULL,attempt TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(task,attempt,kind));").map_err(|_|"Cannot initialize connected session event ledger")?;
        }
        if !["13", "14", "15", "16", "17", "18"].contains(&schema.as_str()) {
            store.conn.execute_batch("CREATE TABLE decision_replies(session TEXT NOT NULL,prompt TEXT PRIMARY KEY,decision TEXT NOT NULL,revision INTEGER NOT NULL,question_revision INTEGER NOT NULL); CREATE TABLE session_decisions(session TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(session,id)); CREATE TABLE decision_commands(session TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(session,id));").map_err(|_|"Cannot initialize durable decisions")?;
        }
        store.init_permission_rejections()?;
        store.init_projects(&schema)?;
        store.init_settings_model()?;
        store.init_external_tools()?;
        store.init_activity()?;
        store.refresh_compiled_selections()?;
        message_times::backfill(&store.conn).map_err(|e| format!("Cannot recover message timestamps: {e}"))?;
        if !["17", "18"].contains(&schema.as_str()) {
            for mut session in store.sessions()? {
                session.original_generation = session.original.as_ref().map(|_| session.contract.as_ref().unwrap().generation);
                store.save_session(&session)?;
            }
        }
        if schema != "18" { store.migrate_native_identity()?; }
        store
            .conn
            .execute("UPDATE meta SET value='18' WHERE key='schema'", [])
            .map_err(|_| "Cannot publish helper-compatible schema")?;
        Self::inspect(&store.conn, project)?;
        store.conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS receipts_pending ON receipts(id)
                 WHERE (json_extract(body, '$.phase') IN ('completed', 'cancelled', 'failed')) IS NOT TRUE;
             CREATE INDEX IF NOT EXISTS receipts_thread ON receipts(
                 json_extract(body, '$.session'), json_extract(body, '$.thread'));
             CREATE INDEX IF NOT EXISTS session_events_session_attempt_kind ON session_events(
                 session, attempt, kind, seq);
             CREATE INDEX IF NOT EXISTS session_events_session_seq ON session_events(
                 session, seq);
             CREATE INDEX IF NOT EXISTS session_events_notification_message ON session_events(
                 session, json_extract(body, '$.receiptId'), seq)
                 WHERE kind >= 'notification:message:' AND kind < 'notification:message;';
             CREATE TABLE IF NOT EXISTS recovered_steering_queue(
                 id TEXT PRIMARY KEY, before_id TEXT NOT NULL);",
        ).map_err(|_| "Cannot prepare receipt lookup indexes")?;
        store
            .conn
            .execute_batch("COMMIT")
            .map_err(|_| "Cannot commit state migration")?;
        store
            .conn
            .execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
            .map_err(|_| "State configuration failed")?;
        store.recover_lifecycle()?;
        for mut r in store.all()? {
            if r.phase.active() {
                let claude_undispatched = crate::claude::is_receipt(&r)
                    && r.dispatch_ms.is_none() && !r.cancel_requested;
                r.phase = Phase::Uncertain;
                if claude_undispatched {
                    r.claude_startup_retry.get_or_insert(deck2_shared::StartupRetry {
                        retries: 0, after_ms: 0,
                    });
                } else {
                    r.cancel_requested = true;
                }
                for d in &mut r.decisions {
                    // Delivered consent survives restart; its old RPC is never
                    // replayed because the owning receipt is cancelled/uncertain.
                    if matches!(d.state, deck2_shared::DecisionState::Delivered | deck2_shared::DecisionState::Settled) { continue; }
                    d.state = if d.dispatch_ms.is_some() {
                        deck2_shared::DecisionState::Uncertain
                    } else {
                        deck2_shared::DecisionState::Invalidated
                    };
                    d.detail = "Host restarted; old native request will never replay".into();
                }
                r.detail = if claude_undispatched {
                    "Host restarted during Claude startup. Waiting for process teardown before retrying the undispatched input."
                } else {
                    "Host restarted. Native ownership/outcome is unproven. Inspect the previous process before deck2 recover; this command will never replay."
                }.into();
                store.save(&mut r)?;
            }
        }
        for mut t in store.tasks()? {
            let mut repaired = false;
            for a in &mut t.attempts {
                // Older Codex workers recorded successful process teardown and
                // then classified the same attempt as uncertain after dispatch.
                if a.phase == Phase::Uncertain && a.settled_ms.is_some()
                    && a.provenance.integration == "app-server/session-mcp-member-v1"
                    && !a.detail.starts_with("member_cleanup_uncertain:") {
                    a.phase = if a.cancel_requested { Phase::Cancelled } else { Phase::Failed };
                    repaired = true;
                } else if a.phase.active() {
                    a.phase = if a.dispatch_ms.is_some() || a.native_pid.is_some() || a.phase != Phase::Accepted {
                        Phase::Uncertain
                    } else {
                        Phase::Cancelled
                    };
                    a.cancel_requested = true;
                    a.detail="Host restarted. No replay; dispatched ownership is uncertain. Undispatched work was stopped.".into();
                }
            }
            if repaired { store.save_normal_task(&t)?; } else { store.save_task(&t)?; }
        }
        Ok(store)
    }
    pub fn all(&self) -> Result<Vec<Receipt>, String> {
        self.read_receipts("SELECT body FROM receipts ORDER BY rowid")
    }

    // Admission and recovery need current ownership, including queued and
    // uncertain work. Keep the durable arrival order without decoding settled transcripts.
    pub(crate) fn pending_receipts(&self) -> Result<Vec<Receipt>, String> {
        self.read_receipts(
            "SELECT receipts.body FROM receipts INDEXED BY receipts_pending
             LEFT JOIN recovered_steering_queue recovered ON recovered.id=receipts.id
             LEFT JOIN receipts anchor ON anchor.id=recovered.before_id
             WHERE (json_extract(receipts.body, '$.phase') IN ('completed', 'cancelled', 'failed')) IS NOT TRUE
             ORDER BY COALESCE(anchor.rowid, receipts.rowid), anchor.rowid IS NULL, receipts.rowid",
        )
    }

    fn read_receipts(&self, sql: &str) -> Result<Vec<Receipt>, String> {
        let mut stmt = self.conn.prepare_cached(sql).map_err(|_| "State read failed")?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|_| "State read failed")?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|_| "State read failed")?)
                .map_err(|_| "Corrupt receipt; preserve state for inspection".into())
        })
        .collect()
    }

    fn last_in_thread(&self, session: &str, thread: &str) -> Result<Option<Receipt>, String> {
        let body: Option<String> = self.conn.query_row(
            "SELECT body FROM receipts
             WHERE json_extract(body, '$.session')=?1 AND json_extract(body, '$.thread')=?2
             ORDER BY rowid DESC LIMIT 1",
            params![session, thread],
            |row| row.get(0),
        ).optional().map_err(|_| "Cannot read previous receipt")?;
        body.map(|body| serde_json::from_str(&body).map_err(|_| "Corrupt prior receipt".into()))
            .transpose()
    }
    pub fn get(&self, id: &str) -> Result<Option<Receipt>, String> {
        let body: Option<String> = self
            .conn
            .query_row("SELECT body FROM receipts WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(|_| "Receipt read failed")?;
        body.map(|b| {
            serde_json::from_str(&b)
                .map_err(|_| "Corrupt receipt; preserve state for inspection".into())
        })
        .transpose()
    }
    pub fn save(&mut self, r: &mut Receipt) -> Result<(), String> {
        steering::settle_owned_input(r);
        if r.recalled_ms.is_some() && (!r.cancel_requested || r.dispatch_ms.is_some()) {
            return Err("Recalled input cannot acquire native dispatch authority".into());
        }
        if r.steered_to.is_some() && (r.phase != Phase::Cancelled || r.dispatch_ms.is_some() || r.recalled_ms.is_some()) {
            return Err("Queued live source cannot acquire next-turn dispatch authority".into());
        }
        if r.configuration.as_ref().is_some_and(|c|self.session_project(&r.session).as_ref()!=Ok(&c.project)) {return Err("Admission project binding mismatch".into());}
        let prior = if r.mode == deck2_shared::Mode::SessionV1 {
            self.get(&r.id)?
        } else {
            None
        };
        // A native envelope is immutable for a decision identity. Changed scope
        // requires a fresh decision; an old revision can never consent to it.
        if let Some(prior) = &prior {
            for d in &r.decisions {
                if let Some(old) = prior.decisions.iter().find(|old| old.id == d.id) {
                    let envelope = |v: &deck2_shared::Decision| v.native.as_ref().map(|n| (n.transport, n.method.clone(), n.parameters.clone()));
                    if envelope(old) != envelope(d) {
                        return Err("Native decision scope changed; invalidate and request a fresh decision".into());
                    }
                }
            }
        }
        r.revision += 1;
        let body = serde_json::to_string(r).map_err(|_| "Receipt serialization failed")?;
        if r.mode == deck2_shared::Mode::SessionV1 {
            let contract = r
                .configuration
                .as_ref()
                .and_then(|s| s.session_contract.as_ref())
                .ok_or("Normal receipt admission missing")?;
            // The previous event already owns the attempt number. The ledger's
            // unique (task, attempt, kind) index also serves reopened sessions.
            let recorded: Option<i64> = if let Some(previous) = &prior {
                self.conn.query_row(
                    "SELECT json_extract(body,'$.attemptNumber') FROM session_events WHERE task=?1 AND attempt=?2 AND kind=?3",
                    params![contract.lead_task, r.attempt, format!("receipt:{}", previous.revision)],
                    |row| row.get::<_, Option<i64>>(0),
                ).optional().map_err(|_| "Cannot read receipt ordinal")?.flatten()
            } else { None };
            let ordinal = match recorded {
                Some(number) => number,
                None => self.conn.query_row(
                    "SELECT 1+count(*) FROM receipts WHERE json_extract(body,'$.session')=?1 AND rowid<coalesce((SELECT rowid FROM receipts WHERE id=?2),9223372036854775807)",
                    params![r.session,r.id], |row| row.get::<_, i64>(0),
                ).map_err(|_| "Cannot assign receipt ordinal")?,
            };
            let event = serde_json::json!({"type":"receipt.updated","receiptId":r.id,"taskId":contract.lead_task,"attempt":r.attempt,"attemptNumber":ordinal,"revision":r.revision,"phase":r.phase,"at_ms":now(),"prompt":if prior.is_none(){Some(&r.prompt)}else{None},"delta":r.text.strip_prefix(prior.as_ref().map(|p|p.text.as_str()).unwrap_or("")).unwrap_or(&r.text),"detail":r.detail});
            self.conn
                .execute_batch("SAVEPOINT normal_receipt_event")
                .map_err(|_| "Cannot begin receipt event")?;
            let result = (|| -> Result<(), String> {
                self.conn.execute("INSERT INTO receipts VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![r.id,body]).map_err(|_|"Durable receipt write failed; dispatch is blocked")?;
                self.conn.execute("INSERT INTO session_events(session,task,attempt,kind,body) VALUES (?1,?2,?3,?4,?5)",params![r.session,contract.lead_task,r.attempt,format!("receipt:{}",r.revision),event.to_string()]).map_err(|_|"Durable session event write failed; dispatch is blocked")?;
                steering::sync_queued_sources(self, r, prior.as_ref())?;
                for input in r.steering.iter().filter(|input| {
                    input.state == deck2_shared::SteeringState::Accepted
                        && !prior.as_ref().is_some_and(|previous| previous.steering.iter().any(|record| {
                            record.command.id == input.command.id && record.state == input.state
                        }))
                }) {
                    let message = steering::accepted_event(r, input);
                    self.conn.execute(
                        "INSERT INTO session_events(session,task,attempt,kind,body) VALUES (?1,?2,?3,?4,?5)",
                        params![r.session,contract.lead_task,r.attempt,format!("steering:{}",input.command.id),message.to_string()],
                    ).map_err(|_| "Cannot commit acknowledged live message history")?;
                }
                for d in r.decisions.iter().filter(|d|d.state==deck2_shared::DecisionState::Pending && !prior.as_ref().is_some_and(|p|p.decisions.iter().any(|old|old.id==d.id&&old.revision==d.revision&&old.state==deck2_shared::DecisionState::Pending))) {
                    let occurrence=serde_json::json!({"decisionId":d.id,"revision":d.revision,"at_ms":now()});
                    self.conn.execute("INSERT OR IGNORE INTO session_events(session,task,attempt,kind,body) VALUES (?1,?2,?3,?4,?5)",params![r.session,contract.lead_task,r.attempt,format!("notification:attention:{}:{}",d.id,d.revision),occurrence.to_string()]).map_err(|_|"Durable attention event write failed; dispatch is blocked")?;
                }
                self.conn
                    .execute_batch("RELEASE normal_receipt_event")
                    .map_err(|_| "Cannot commit receipt event")?;
                Ok(())
            })();
            if result.is_err() {
                let _ = self.conn.execute_batch(
                    "ROLLBACK TO normal_receipt_event; RELEASE normal_receipt_event",
                );
            }
            result?;
        } else {
            self.conn.execute("INSERT INTO receipts (id,body) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![r.id,body]).map_err(|_|"Durable receipt write failed; dispatch is blocked")?;
        }
        Ok(())
    }
    pub fn accept(&mut self, c: &Submit) -> Result<Receipt, AdmissionError> {
        self.accept_in(c, &self.session.clone(), false, true)
    }
    fn accept_in(
        &mut self,
        c: &Submit,
        session: &str,
        queued: bool,
        fresh: bool,
    ) -> Result<Receipt, AdmissionError> {
        self.session_by_id(session).map_err(AdmissionError::from)?;
        if c.api != API {
            return Err("Incompatible API; reload Deck. Your draft is retained.".into());
        }
        if c.id.len() < 8
            || c.id.len() > 80
            || !c.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("Invalid command identity".into());
        }
        if (c.prompt.trim().is_empty() && c.attachments.is_empty()) || c.prompt.len() > 16384 {
            return Err("Enter a prompt of at most 16 KiB".into());
        }
        if let Some(r) = self.get(&c.id).map_err(storage_error)? {
            return if r.prompt == c.prompt
                && r.mode == c.mode
                && r.session == session
                && r.fresh == fresh
                && r.attachments.iter().map(|a| &a.id).eq(c.attachments.iter())
            {
                Ok(r)
            } else {
                Err("Command identity conflicts with previously accepted input".into())
            };
        }
        // A native context carries its original execution policy. Changing mode
        // requires an explicit fresh execution, including for waiting inputs.
        // Check after immutable retries, before reservations or durable effects.
        if !fresh
            && self
                .session_by_id(session)?
                .native
                .is_some_and(|n| n.mode != c.mode)
        {
            return Err("Native context belongs to another execution mode. Choose Start new execution explicitly.".into());
        }
        let project = self.session_project(session)?;
        let attachments = self.command_images(session, &c.attachments)?;
        if !attachments.is_empty()
            && c.mode != deck2_shared::Mode::ReadOnly
            && c.mode != deck2_shared::Mode::SessionV1
            && !c.mode.ordinary()
        {
            return Err(
                "Images are qualified only for Codex read-only mode; change mode or remove images"
                    .into(),
            );
        }
        if self.runner_busy().map_err(storage_error)? {
            return Err("Native sign-in is active; settle it before admitting work".into());
        }
        if !queued && self.member_blocks_root(&c.mode, session).map_err(storage_error)? {
            return Err("Unsettled specialist ownership blocks project dispatch".into());
        }
        if (c.mode == deck2_shared::Mode::Team || c.mode.ordinary()) && !fresh {
            return Err("Team mode requires explicit Start new execution; dynamic-tool resume is unqualified".into());
        }
        if !queued && !self.root_available(&c.mode, session, &std::collections::HashSet::new(), self.configuration().map_err(storage_error)?.execution_budget.lead).map_err(storage_error)? {
            return Err("An active or uncertain task must settle before new dispatch".into());
        }
        if !queued && c.mode.editing() && !self.trusted_project(&project.root).map_err(storage_error)? {
            return Err("Trust this project for reviewed editing before submitting. Trust grants no file effect.".into());
        }
        if c.mode == deck2_shared::Mode::Developer {
            let mut change = self.change_for(session)?;
            if change.completion == "completed" || !fresh {
                return Err("Developer work requires an incomplete scoped change and fresh native authority".into());
            }
            change.roots.push(c.id.clone());
            self.save_change(&change).map_err(storage_error)?;
        }
        let mut snapshot = if c.mode.ordinary() {
            let selected = self
                .ordinary_selection(session)?
                .ok_or("Configure this developer session before submitting")?;
            if selected.mode != c.mode {
                return Err("Permission differs from saved session selection".into());
            }
            selected.snapshot
        } else {
            self.admission_snapshot_for(&project.root, &c.mode)
                .map_err(AdmissionError::from)?
        };
        if c.mode == deck2_shared::Mode::SessionV1 {
            let contract = self
                .session_by_id(session)?
                .contract
                .ok_or("Historical restricted sessions cannot use connected authority")?;
            crate::session_contract::validate(&contract)?;
            let assignment=contract.members.get("lead").ok_or("Lead assignment missing")?.clone();
            snapshot.session_contract = Some(contract);
            match assignment.runner_id.as_str() {
                "codex" | "opencode" => crate::connected_opencode::source::bind(&mut snapshot,&assignment,"lead",self.trusted_project(&project.root)?)?,
                #[cfg(test)]
                crate::claude_fixture::RUNNER if std::env::var_os("DECK2_CLAUDE_FIXTURE_CHILD").is_some() => crate::claude_fixture::bind(&mut snapshot),
                crate::claude::RUNNER => {
                    crate::claude::bind(&mut snapshot)?;
                }
                _ => return Err("Selected Lead runner is unavailable".into()),
            }
        }
        let mut continued_model = None;
        if !fresh
            && let Some(context) = self.session_by_id(session)?.native
            && let Some(previous) = self.last_in_thread(session, &context.thread).map_err(storage_error)?
        {
            if previous.mode != c.mode {
                return Err("Historical context mode differs; choose Start new execution".into());
            }
            // Continuation retains policy and the last acknowledged native model.
            continued_model = previous.model.clone();
            if c.mode != deck2_shared::Mode::SessionV1 {
                snapshot = previous
                    .configuration
                    .clone()
                    .ok_or("Historical binding missing; choose fresh execution")?;
            }
        }
        let requested_model = if c.mode == deck2_shared::Mode::SessionV1 {
            snapshot
                .session_contract
                .as_ref()
                .and_then(|c| c.members.get("lead"))
                .map(|a| a.model_id.clone())
        } else if c.mode.ordinary()
            || matches!(
                c.mode,
                deck2_shared::Mode::Developer | deck2_shared::Mode::Team
            )
        {
            Some("gpt-6.1-sol".into())
        } else {
            snapshot
                .runner
                .as_ref()
                .and_then(|b| b.model.clone())
                .or(continued_model)
        };
        if let Some(binding) = &snapshot.cbm {
            let reservation = (|| -> Result<(), String> {
                let service =
                    crate::cbm_service::Service::open(Path::new(&binding.store), &binding.service)?;
                service.check_supervisor()?;
                let record = service.record()?;
                if record.generation != binding.generation || record.version != binding.version {
                    return Err(
                        "Selected graph generation changed; review selection before graph use"
                            .into(),
                    );
                }
                service.reserve(
                    &self.host_id()?,
                    &c.id,
                    &binding.snapshot,
                    binding.generation,
                    &binding.version,
                )
            })();
            if let Err(reason) = reservation {
                // Keep the admitted tool/content policy, including its explicit read fallback.
                // No discovery, hashing, startup, indexing or service mutation occurs here.
                snapshot.exclusions.push(format!(
                    "Graph unavailable: {reason}; use admitted exact scoped reads"
                ));
            }
        }
        let mut r = Self::admitted_receipt(c, session, queued, fresh, snapshot, attachments, requested_model);
        self.save(&mut r).map_err(storage_error)?;
        if !queued { self.record_root_overlaps(&r).map_err(storage_error)?; }
        Ok(r)
    }

    fn admitted_receipt(
        c: &Submit,
        session: &str,
        queued: bool,
        fresh: bool,
        snapshot: deck2_shared::AdmissionSnapshot,
        attachments: Vec<deck2_shared::ImageAttachment>,
        requested_model: Option<String>,
    ) -> Receipt {
        let runner = snapshot.native.as_ref().map(|n| format!("{} {} / {}", match n.runner { deck2_shared::NativeRunner::Codex => "codex", deck2_shared::NativeRunner::Opencode => "opencode", deck2_shared::NativeRunner::Claude => "claude" }, n.version, n.protocol)).unwrap_or_else(|| "codex / app-server stdio".into());
        Receipt {
            context: Default::default(),
            can_steer: false,
            steering: Vec::new(),
            continuation: None,
            attachments,
            configuration: Some(snapshot),
            session: session.into(),
            fresh,
            mode: c.mode.clone(),
            attempt: uuid::Uuid::new_v4().to_string(),
            generation: String::new(),
            cancel_requested: false,
            recalled_ms: None,
            steered_to: None,
            decisions: Vec::new(),
            id: c.id.clone(),
            prompt: c.prompt.clone(),
            phase: if queued {
                Phase::Queued
            } else {
                Phase::Accepted
            },
            text: String::new(),
            detail: if queued {
                "Waiting in the durable queue; definitely undispatched"
            } else {
                "Durably accepted; native preparation pending"
            }
            .into(),
            native_pid: None,
            requested_model,
            model: None,
            reasoning: None,
            local_tool_calls: 0,
            thread: None,
            turn: None,
            accepted_ms: now(),
            handshake_ms: None,
            startup_timing: None,
            claude_startup_retry: None,
            dispatch_ms: None,
            acknowledgment_ms: None,
            first_output_ms: None,
            message_times: Vec::new(),
            revision: 0,
            policy: if c.mode == deck2_shared::Mode::SessionV1 {
                "deck-session-v1"
            } else if c.mode.ordinary() {
                "deck2-ordinary-v1"
            } else if c.mode == deck2_shared::Mode::Developer {
                "deck2-developer-v1"
            } else if c.mode.editing() {
                "deck2-reviewed-v1"
            } else {
                POLICY
            }
            .into(),
            runner,
            delivery: "Selected deck2-readonly-v1; native delivery not yet observed".into(),
        }
    }
    // Best-effort bounded diagnostics never replace durable execution receipts.
    pub fn diagnostic(&self, id: &str, code: &str, status: u16) {
        if self
            .conn
            .execute(
                "INSERT INTO diagnostics VALUES (?1,?2,?3,?4)",
                params![id, code, status, now() as i64],
            )
            .is_ok()
        {
            let _=self.conn.execute("DELETE FROM diagnostics WHERE rowid NOT IN (SELECT rowid FROM diagnostics ORDER BY rowid DESC LIMIT 128)",[]);
        }
    }
    pub fn recover(&mut self) -> Result<usize, String> {
        let mut count = self.operator_recover_lifecycle()?;
        for mut t in self.tasks()? {
            for a in &mut t.attempts {
                if a.phase == Phase::Uncertain {
                    a.phase = Phase::Failed;
                    a.detail=task_panel::STOPPED_UNKNOWN.into();
                    count += 1;
                }
            }
            self.save_task(&t)?;
        }
        for mut r in self.all()? {
            if r.phase == Phase::Uncertain {
                // An interrupted rollout is not a qualified continuation source:
                // acknowledging process death never authorizes replay of its turn.
                self.forget_native(&r.session)?;
                r.phase = Phase::Failed;
                r.detail="Operator acknowledged previous native processes are stopped. Previous outcome remains unknown; no replay occurred. Native continuation reference released; explicitly start a new execution.".into();
                self.save(&mut r)?;
                count += 1;
            }
        }
        Ok(count)
    }
}

#[cfg(test)]
mod persistence_tests;

// Notification integration fixtures need an internally consistent timeline even
// when the host wall clock steps backwards. Production time remains unchanged.
#[cfg(test)]
pub(crate) mod test_clock {
    use std::{cell::Cell, marker::PhantomData, rc::Rc, time::Instant};
    thread_local! {
        static CLOCK: Cell<Option<(u64, Instant)>> = const { Cell::new(None) };
    }
    pub(crate) struct Guard {
        prior: Option<(u64, Instant)>,
        _thread: PhantomData<Rc<()>>,
    }
    pub(crate) fn scoped() -> Guard {
        let base = crate::now();
        let prior = CLOCK.with(|clock| clock.replace(Some((base, Instant::now()))));
        Guard { prior, _thread: PhantomData }
    }
    pub(super) fn now() -> Option<u64> {
        CLOCK.with(|clock| clock.get().map(|(base, start)| {
            base.saturating_add(start.elapsed().as_millis() as u64)
        }))
    }
    impl Drop for Guard {
        fn drop(&mut self) {
            CLOCK.with(|clock| clock.set(self.prior));
        }
    }
}
