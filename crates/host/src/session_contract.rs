//! Versioned connected-session authority. Legacy sessions remain restricted.
use deck2_shared::SessionContract;
pub const POLICY: &str = include_str!("../assets/session-continuity.txt");
pub const MEMBERS: &[&str] = &[
    "lead",
    "investigate",
    "architect",
    "apply-fast",
    "apply-deep",
    "quality",
    "setup",
];
pub(crate) fn configured_member_ids(contract: &SessionContract) -> impl Iterator<Item = &str> {
    MEMBERS
        .iter()
        .copied()
        .filter(|&id| id != "lead" && contract.members.contains_key(id))
}

pub fn validate(c: &SessionContract) -> Result<(), String> {
    if c.version != 1
        || c.revision == 0
        || c.generation == 0
        || c.lead_task.is_empty()
        || !matches!(c.approvals.as_str(), "relay" | "yolo")
        || !c.members.contains_key("lead")
        || c.members.iter().any(|(id, a)| {
            !MEMBERS.contains(&id.as_str())
                || a.runner_id.is_empty() || a.runner_id.len()>64
                || a.model_id.trim().is_empty()
                || a.model_id.len() > 160
                || a.thinking
                    .as_ref()
                    .is_some_and(|v| v.is_empty() || v.len() > 64)
        })
    {
        return Err("Invalid connected session assignment or unsupported approval contract".into());
    }
    Ok(())
}

use crate::Store;
use deck2_shared::{MemberAssignment, Phase};
impl Store {
    pub fn set_approvals(
        &mut self,
        session: &str,
        mode: &str,
    ) -> Result<deck2_shared::Session, String> {
        if !matches!(mode, "relay" | "yolo") {
            return Err("Unsupported approval mode".into());
        }
        let mut s = self.session_by_id(session)?;
        let c = s
            .contract
            .as_mut()
            .ok_or("Historical restricted session has no connected approval contract")?;
        c.approvals = mode.into();
        validate(c)?;
        // No assignment revision, native history, grants or admitted snapshot changes.
        self.save_session(&s)?;
        Ok(s)
    }
    fn assignment_ready(&self, session: &str, member: &str, expected: u64) -> Result<(), String> {
        let s = self.session_by_id(session)?;
        let c = s.contract.ok_or("Historical restricted session has no connected assignment contract")?;
        if c.revision != expected { return Err("assignment-revision-stale".into()); }
        // Only the Lead assignment replaces the session's native context and generation.
        if member != "lead" {
            return Ok(());
        }
        if self.all()?.iter().any(|r| r.session == session && (r.phase.active() || matches!(r.phase, Phase::Queued | Phase::Uncertain)))
            || self.tasks()?.iter().any(|t| t.session == session && t.attempts.iter().any(|a| a.phase.active() || matches!(a.phase, Phase::Queued | Phase::Uncertain))) {
            return Err("session-busy".into());
        }
        Ok(())
    }
    pub fn assign_member(
        &mut self,
        session: &str,
        member: &str,
        assignment: MemberAssignment,
        expected: u64,
    ) -> Result<deck2_shared::Session, String> {
        let mut s = self.session_by_id(session)?;
        let c = s
            .contract
            .as_mut()
            .ok_or("Historical restricted session has no connected assignment contract")?;
        self.assignment_ready(session, member, expected)?;
        if c.members.get(member) == Some(&assignment) {
            return Ok(s);
        }
        c.members.insert(member.into(), assignment);
        c.revision = c
            .revision
            .checked_add(1)
            .ok_or("Assignment revision exhausted")?;
        if member == "lead" {
            c.generation = c
                .generation
                .checked_add(1)
                .ok_or("Context generation exhausted")?;
            s.native = None;
        }
        validate(c)?;
        // Assignment is a single SQLite row update. Historical receipts and task
        // observations belong to their admitted assignments and remain intact.
        self.save_session(&s)?;
        Ok(s)
    }
}

use deck2_shared::{Decision, DecisionResponse, DecisionState, Receipt};
use serde_json::{Value, json};
// Compatibility exports for existing readers; the selected protocol owns wire translation.
pub use crate::codex_protocol::{native_method, native_decision, native_reply, revoked_reply, native_tool_name};
pub use crate::native_approval::validate_native;
pub(crate) use crate::native_approval::validate_legacy_native;

use crate::server::App;
use axum::{
    Json, Router,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
pub(crate) async fn model_data(app: &App) -> Result<Value, String> {
    model_data_for(app, &["codex", "opencode", crate::claude::RUNNER]).await
}
async fn model_data_for(app: &App, runners: &[&str]) -> Result<Value, String> {
    {let store=app.store.lock().unwrap();crate::projects::validate(&store.project_by_id(&crate::projects::id(&app.project))?)?;}
    let codex=async {
        if !runners.contains(&"codex") { return Ok(json!({"runnerId":"codex","available":false,"models":[]})); }
        let binary=app.selected_binary()?;
        let native=crate::runner_management::inspect_native(&binary,&app.project).await?;
        let mut models=native["models"].as_array().ok_or("Native model inventory missing")?.iter().map(|m|json!({"modelId":m["model"],"label":m["model"],"thinkingLevels":m["thinkingLevels"]})).collect::<Vec<_>>();
        let aliases=models.iter().map(|m|json!({"modelId":format!("openai-codex/{}",m["modelId"].as_str().unwrap()),"label":m["label"],"thinkingLevels":m["thinkingLevels"]})).collect::<Vec<_>>();models.extend(aliases);
        Ok::<Value,String>(json!({"runnerId":"codex","label":"Codex","available":native["ready"]==true,"models":models}))
    };
    let trusted=app.store.lock().unwrap().trusted_project(&app.project)?;
    let opencode=async { if !runners.contains(&"opencode") { json!({"runnerId":"opencode","available":false,"models":[]}) } else { match crate::connected_opencode::source::inventory(&app.project,trusted).await {
        Ok(models)=>json!({"runnerId":"opencode","label":"OpenCode","available":true,"models":models.iter().map(|m|{let mut levels=m.variants.clone();levels.push("off".into());json!({"modelId":m.id(),"label":m.id(),"thinkingLevels":levels})}).collect::<Vec<_>>()}),
        Err(e)=>json!({"runnerId":"opencode","label":"OpenCode","available":false,"models":[],"reason":e}),
    }}};
    let claude = async {
        if !runners.contains(&crate::claude::RUNNER) { return None; }
        Some(match crate::claude::inventory(app).await {
            Ok(models) => json!({"runnerId":"claude","label":"Claude Code","available":true,"models":models}),
            Err(e) => json!({"runnerId":"claude","label":"Claude Code","available":false,"models":[],"reasonCode":e}),
        })
    };
    let (codex, opencode, claude) = tokio::join!(codex, opencode, claude);
    let codex = codex.unwrap_or_else(|e|json!({"runnerId":"codex","label":"Codex","available":false,"models":[],"reason":e}));
    let mut inventory = vec![codex, opencode];
    inventory.extend(claude);
    Ok(json!({"runners":inventory}))
}
async fn models(crate::server::ProjectState(app): crate::server::ProjectState<App>) -> Response {
    match model_data(&app).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => error(e),
    }
}
fn error(e: String) -> Response {
    (
        StatusCode::CONFLICT,
        Json(json!({"code":"session_contract_rejected","message":e})),
    )
        .into_response()
}
pub async fn validate_available(
    app: &App,
    members: &std::collections::BTreeMap<String, MemberAssignment>,
) -> Result<(), String> {
    let runners=members.values().map(|a|a.runner_id.as_str()).collect::<Vec<_>>();
    let data = model_data_for(app, &runners).await?;
    validate_inventory(&data, members)
}
fn validate_inventory(data: &Value, members: &std::collections::BTreeMap<String, MemberAssignment>) -> Result<(), String> {
    for (member, a) in members {
        if !MEMBERS.contains(&member.as_str()) || a.runner_id.is_empty() || a.runner_id.len()>64 { return Err("Unsupported member or runner assignment".into()); }
        let runner = data["runners"].as_array().and_then(|r| r.iter().find(|r| r["runnerId"] == a.runner_id)).ok_or("Assigned runner is unavailable")?;
        if runner["available"] != true {
            return Err(runner["reasonCode"].as_str().unwrap_or("Assigned runner is unavailable").into());
        }
        resolve_model(&runner["models"], a, None)?;
    }
    Ok(())
}
pub(crate) use crate::member_integration::resolve_model;

pub(crate) fn selection_snapshot(app: &App, store: &Store, runners: &[&str]) -> Result<String,String> {
    if runners.iter().any(|r| !matches!(*r,"codex"|"opencode"|crate::claude::RUNNER)) { return Err("Unsupported assigned runner".into()); }
    let config=store.configuration_for(&app.project)?;
    let mut evidence=vec![serde_json::to_string(&config).map_err(|_|"Invalid selected configuration")?];
    let native_root=app.native_role_root.lock().unwrap().clone();
    evidence.push(crate::tasks::digest(include_bytes!("../assets/session-roles.json")));
    let mut files=vec![std::path::PathBuf::from(&app.project).join(".deck/config.json")];
    if runners.contains(&"codex") {
        let binary=config.runner.as_ref().map(|b|std::path::PathBuf::from(&b.path)).unwrap_or_else(||app.binary.clone());
        evidence.push(binary.to_string_lossy().into_owned());
        evidence.push(crate::tasks::file_digest(&binary).unwrap_or_else(|_|"unavailable".into()));
        evidence.push(crate::session_roles::codex_policy_key(&native_root.join("config.toml"))?);
        files.push(std::path::PathBuf::from(&app.project).join(".codex/config.toml"));
    }
    for file in files {
        evidence.push(if file.try_exists().map_err(|_|"Selected configuration unavailable")? {crate::tasks::digest(crate::session_roles::read(&file,1024*1024)?.as_bytes())}else{"absent".into()});
    }
    let trusted=store.trusted_project(&app.project)?;
    evidence.push(trusted.to_string());
    if runners.contains(&"opencode") {
        let path=crate::connected_opencode::source::executable()?;
        evidence.push(path.to_string_lossy().into_owned());
        evidence.push(crate::tasks::digest(&std::fs::read(path).map_err(|_|"OpenCode executable unavailable")?));
        evidence.push(crate::connected_opencode::source::configuration(&app.project,trusted)?);
    }
    if runners.contains(&crate::claude::RUNNER) {
        evidence.push(crate::claude::selection_key()?);
    }
    evidence.push(app.web_identity.lock().unwrap().identity.assignment_members()?.to_string());
    Ok(crate::tasks::digest(serde_json::to_string(&evidence).unwrap().as_bytes()))
}
fn assignment_snapshot(app: &App, session: &str, command: &Assign) -> Result<String,String> {
    let history=app.history.lock().map_err(|_|"Original ownership unavailable")?;
    #[cfg(test)]
    { let probe=app.assignment_probe.lock().unwrap().take(); if let Some(probe)=probe { probe(); } }
    let store=app.store.lock().map_err(|_|"State lock failed")?;
    history.check_context(&store.session_by_id(session)?)?;
    store.execution_project(session)?;
    store.assignment_ready(session, &command.member_id, command.expected_revision)?;
    selection_snapshot(app, &store, &[&command.assignment.runner_id])
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Assign {
    api: u32,
    member_id: String,
    assignment: MemberAssignment,
    expected_revision: u64,
}
async fn assign(
    crate::server::ProjectState(app): crate::server::ProjectState<App>,
    Path(session): Path<String>,
    Json(c): Json<Assign>,
) -> Response {
    let app=match app.for_session(&session){Ok(a)=>a,Err(e)=>return error(e)};
    if c.api != deck2_shared::API {
        return error("Incompatible API".into());
    }
    if crate::web_identity::authorize().is_err() { return crate::server::problem(StatusCode::FORBIDDEN,"device-required","Device access ended"); }
    let before = match assignment_snapshot(&app, &session, &c) { Ok(v)=>v, Err(e)=>return error(e) };
    if let Err(e) = validate_available(
        &app,
        &std::collections::BTreeMap::from([(c.member_id.clone(), c.assignment.clone())]),
    )
    .await
    {
        return error(e);
    }
    if let Some(r) = crate::web_identity::effect_denied() { return r; }
    let result = (|| {
        let history = app.history.lock().map_err(|_| "Original ownership unavailable")?;
        let mut store = app.store.lock().map_err(|_| "State lock failed")?;
        history.check_context(&store.session_by_id(&session)?)?;
        store.execution_project(&session)?;
        store.assignment_ready(&session, &c.member_id, c.expected_revision)?;
        if selection_snapshot(&app, &store, &[&c.assignment.runner_id])? != before { return Err("Assignment configuration or executable changed during discovery".into()); }
        crate::web_identity::admit().map_err(str::to_owned)?;
        store.assign_member(&session,&c.member_id,c.assignment,c.expected_revision)
    })();
    match result {
        Ok(s) => Json(s).into_response(),
        Err(e) => error(e),
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Approvals {
    api: u32,
    mode: String,
}
async fn approvals(
    crate::server::ProjectState(app): crate::server::ProjectState<App>,
    Path(session): Path<String>,
    Json(c): Json<Approvals>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if c.api != deck2_shared::API {
        return error("Incompatible API".into());
    }
    let result = app.store.lock().unwrap().set_approvals(&session, &c.mode);
    match result {
        Ok(s) => Json(s).into_response(),
        Err(e) => error(e),
    }
}
pub fn routes() -> Router<App> {
    Router::new()
        .route("/api/sessions/{session}/approvals", post(approvals))
        .route("/api/sessions/{session}/grants/revoke", post(revoke))
        .route("/api/models", get(models))
        .route(
            "/api/sessions/{session}/decisions",
            get(decisions).post(decision_action),
        )
        .route("/api/sessions/{session}/assignments", post(assign))
}
impl Store {
    pub fn session_grant(&self, decision: &Decision) -> Result<bool, String> {
        // OpenCode retains its own exact contract; no cross-transport matching.
        if decision.native.as_ref().is_some_and(|n| n.transport == Some(deck2_shared::NativeTransport::OpencodeHttp)) {
            return self.legacy_opencode_grant(decision);
        }
        Ok(self.grant_source(decision)?.is_some())
    }
    fn legacy_opencode_grant(&self, decision:&Decision)->Result<bool,String> {
        let Some(identity)=decision.native.as_ref().and_then(|n|n.identity.as_ref()) else{return Ok(false)};
        let c=self.session_by_id(&decision.session)?.contract.ok_or("Contract missing")?;
        let r=self.get(&decision.command)?.ok_or("Origin missing")?;
        let Some(admitted)=r.configuration.as_ref().and_then(|s|s.session_contract.as_ref()) else{return Ok(false)};
        if admitted.generation!=c.generation || admitted.grants_revoked_at!=c.grants_revoked_at {return Ok(false);}
        Ok(self.all()?.iter().filter(|r| r.session==decision.session && r.configuration.as_ref().and_then(|s|s.session_contract.as_ref()).is_some_and(|a|a.generation==c.generation && a.grants_revoked_at==c.grants_revoked_at)).flat_map(|r|&r.decisions).any(|d|d.task==decision.task && matches!(d.state,DecisionState::Delivered|DecisionState::Settled) && d.delivered_ms.is_some() && d.resolution.as_ref().is_some_and(|r|r.response==DecisionResponse::AllowSession) && d.native.as_ref().is_some_and(|n|n.transport==Some(deck2_shared::NativeTransport::OpencodeHttp) && n.identity.as_ref()==Some(identity))))
    }
    pub fn revoke_session_grants(&mut self, id: &str) -> Result<(), String> {
        let mut session = self.session_by_id(id)?;
        let contract = session
            .contract
            .as_mut()
            .ok_or("Historical session has no connected grants")?;
        // This persisted timestamp also fences admitted authority. Wall time can
        // repeat or move backwards; every revocation must still advance it.
        contract.grants_revoked_at = crate::now().max(
            contract.grants_revoked_at.checked_add(1)
                .ok_or("Session revocation fence exhausted")?
        );
        let mut tasks=self.tasks()?;
        let mut affected_members=std::collections::HashSet::new();
        let tx = self
            .conn
            .transaction()
            .map_err(|_| "Cannot begin grant revocation")?;
        tx.execute(
            "UPDATE sessions SET body=?1 WHERE id=?2",
            rusqlite::params![
                serde_json::to_string(&session).map_err(|_| "Cannot encode revocation")?,
                id
            ],
        )
        .map_err(|_| "Cannot revoke grants")?;
        let mut stmt = tx
            .prepare("SELECT body FROM receipts")
            .map_err(|_| "Cannot read active grants")?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|_| "Cannot read active grants")?;
        let mut updates = vec![];
        for row in rows {
            let mut r: Receipt = serde_json::from_str(&row.map_err(|_| "Cannot read grants")?)
                .map_err(|_| "Corrupt grants")?;
            if r.session == id {
                // A released native profile can expand the whole current turn.
                // Revocation requests interruption, never claims retroactive rollback.
                for d in &r.decisions {
                    if d.native.as_ref().is_some_and(|n|n.method=="item/permissions/requestApproval")
                        && d.dispatch_ms.is_some()
                        && matches!(d.state,DecisionState::Dispatching|DecisionState::Delivered|DecisionState::Settled)
                        && d.resolution.as_ref().is_some_and(|r|matches!(r.response,DecisionResponse::AllowOnce|DecisionResponse::AllowSession|DecisionResponse::AllowAlways)) {
                        if let Some(task)=&d.task {affected_members.insert((task.clone(),d.attempt.clone()));}
                        else if r.phase.active() && d.attempt==r.attempt && r.turn.as_deref()==Some(&d.turn) {r.cancel_requested=true;}
                    }
                }
                crate::decisions::invalidate(
                    &mut r,
                    "Session grants revoked; pending responses invalidated",
                );
                r.revision += 1;
                updates.push(r);
            }
        }
        drop(stmt);
        for r in updates {
            tx.execute(
                "UPDATE receipts SET body=?1 WHERE id=?2",
                rusqlite::params![
                    serde_json::to_string(&r).map_err(|_| "Cannot encode revocation")?,
                    r.id
                ],
            )
            .map_err(|_| "Cannot invalidate response")?;
        }
        for t in &mut tasks {
            let mut changed=false;
            for a in &mut t.attempts {
                if a.phase.active() && affected_members.contains(&(t.id.clone(),a.id.clone())) {
                    a.cancel_requested=true;
                    a.detail="Session grants revoked; native profile turn interruption requested; prior effects may have occurred".into();
                    changed=true;
                }
            }
            if changed {
                tx.execute("UPDATE tasks SET body=?1 WHERE id=?2",rusqlite::params![serde_json::to_string(t).map_err(|_|"Cannot encode affected member")?,t.id]).map_err(|_|"Cannot interrupt affected member")?;
            }
        }
        tx.commit()
            .map_err(|_| "Cannot commit grant revocation".into())
    }
}
async fn revoke(crate::server::ProjectState(app): crate::server::ProjectState<App>, Path(session): Path<String>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    let result = app.store.lock().unwrap().revoke_session_grants(&session);
    match result {
        Ok(()) => Json(json!({"revoked":true})).into_response(),
        Err(e) => error(e),
    }
}
impl Store {
    pub fn record_native_reseed(
        &mut self,
        receipt: &str,
        expected_thread: &str,
    ) -> Result<(), String> {
        let mut r = self.get(receipt)?.ok_or("Unknown reseed owner")?;
        if r.mode != deck2_shared::Mode::SessionV1
            || r.dispatch_ms.is_some()
            || r.cancel_requested
            || r.phase != Phase::Preparing
        {
            return Err("Native reseed is not definitely undispatched".into());
        }
        let mut session = self.session_by_id(&r.session)?;
        if session.native.as_ref().map(|n| n.thread.as_str()) != Some(expected_thread) {
            return Err("Native context changed before reseed".into());
        }
        let c = session
            .contract
            .as_mut()
            .ok_or("Connected contract missing")?;
        let admitted = r
            .configuration
            .as_mut()
            .and_then(|snapshot| snapshot.session_contract.as_mut())
            .ok_or("Reseed caller authority unavailable")?;
        if admitted.lead_task != c.lead_task
            || admitted.generation != c.generation
            || c.grants_revoked_at > admitted.grants_revoked_at
        {
            return Err("Reseed caller authority revoked or replaced".into());
        }
        c.generation = c
            .generation
            .checked_add(1)
            .ok_or("Context generation exhausted")?;
        // Only this definitely undispatched caller follows its recorded reseed.
        // Preserve its admitted policy; older receipts keep the old generation.
        admitted.generation = c.generation;
        session.native = None;
        r.detail="Confirmed missing native history before input dispatch; reseeding with bounded public evidence".into();
        r.revision += 1;
        let tx = self
            .conn
            .transaction()
            .map_err(|_| "Cannot begin recorded reseed")?;
        tx.execute(
            "UPDATE sessions SET body=?1 WHERE id=?2",
            rusqlite::params![
                serde_json::to_string(&session).map_err(|_| "Cannot encode reseed")?,
                session.id
            ],
        )
        .map_err(|_| "Cannot record context reseed")?;
        tx.execute(
            "UPDATE receipts SET body=?1 WHERE id=?2",
            rusqlite::params![
                serde_json::to_string(&r).map_err(|_| "Cannot encode reseed owner")?,
                r.id
            ],
        )
        .map_err(|_| "Cannot record reseed owner")?;
        tx.commit()
            .map_err(|_| "Cannot commit recorded reseed".into())
    }
}

pub async fn creation_members(
    app: &App,
    members: &std::collections::BTreeMap<String, MemberAssignment>,
) -> Result<std::collections::BTreeMap<String, MemberAssignment>, String> {
    let configured=app.web_identity.lock().unwrap().identity.assignment_members()?;
    let mut next: std::collections::BTreeMap<String,MemberAssignment> = serde_json::from_value(configured).map_err(|_|"Invalid configured member assignments")?;
    next.extend(members.clone());
    let lead=next.get("lead").cloned().ok_or("Choose a Lead assignment for the canonical team")?;
    // Only missing roles inherit the explicitly selected/recorded Lead model.
    // Configured roles, including unavailable selections, are never replaced.
    let mut selected=members.clone();selected.insert("lead".into(),lead.clone());
    let runners=selected.values().map(|a|a.runner_id.as_str()).collect::<Vec<_>>();
    let data=model_data_for(app,&runners).await?;
    validate_inventory(&data,&selected)?;
    if lead.runner_id != crate::claude::RUNNER {
        for role in MEMBERS {next.entry((*role).into()).or_insert_with(||lead.clone());}
    }
    validate(&SessionContract {version:1,revision:1,generation:1,members:next.clone(),approvals:"relay".into(),lead_task:"new-admission-validation".into(),grants_revoked_at:0})?;
    Ok(next)
}

async fn decisions(crate::server::ProjectState(app): crate::server::ProjectState<App>, Path(session): Path<String>) -> Response {
    let store = app.store.lock().unwrap();
    match store
        .session_by_id(&session)
        .and_then(|_| crate::session_decisions::list(&store, &session))
    {
        Ok(v) => Json(v).into_response(),
        Err(e) => error(e),
    }
}
async fn decision_action(
    crate::server::ProjectState(app): crate::server::ProjectState<App>,
    Path(session): Path<String>,
    Json(args): Json<Value>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    match crate::session_decisions::user(&mut app.store.lock().unwrap(), &session, &args) {
        Ok(v) => Json(v).into_response(),
        Err(e) => error(e),
    }
}

#[cfg(test)]
mod assignment_tests {
    use super::*;
    // Runner isolation at the real create/assign HTTP boundary: broken sources
    // and an executable belonging to an unselected runner have no effect.
    #[tokio::test]
    async fn codex_admission_ignores_unselected_opencode_sources() {
        use std::os::unix::fs::PermissionsExt;
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        const NAME: &str = "session_contract::assignment_tests::codex_admission_ignores_unselected_opencode_sources";
        if std::env::var_os("DECK2_RUNNER_ISOLATION_CHILD").is_none() {
            let d=tempfile::tempdir().unwrap();
            let root=d.path().join("opencode-root");std::fs::create_dir(&root).unwrap();
            std::fs::write(root.join("opencode.json"), "invalid unselected configuration").unwrap();
            let binary=d.path().join("opencode");
            std::fs::write(&binary,"#!/usr/bin/python3\nimport pathlib,sys\npathlib.Path(__file__).with_name('unexpected-opencode').touch()\nsys.exit(99)\n").unwrap();
            std::fs::set_permissions(&binary,std::fs::Permissions::from_mode(0o700)).unwrap();
            let result=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact",NAME,"--test-threads=1","--nocapture"])
                .env("DECK2_RUNNER_ISOLATION_CHILD",d.path()).env("CODEX_HOME",d.path().join("native")).env("OPENCODE_CONFIG_DIR",&root).env("DECK2_OPENCODE",&binary).output().unwrap();
            assert!(result.status.success(),"{}\n{}",String::from_utf8_lossy(&result.stdout),String::from_utf8_lossy(&result.stderr));
            assert!(!d.path().join("unexpected-opencode").exists());return;
        }
        let d=std::path::PathBuf::from(std::env::var_os("DECK2_RUNNER_ISOLATION_CHILD").unwrap());
        let binary=d.join("codex");std::fs::write(&binary,include_str!("../tests/fake_session_native.py")).unwrap();std::fs::set_permissions(&binary,std::fs::Permissions::from_mode(0o700)).unwrap();
        let app=App::new(Store::open_memory(d.to_str().unwrap()).unwrap(),"127.0.0.1:32124".into(),binary,None,"admin".into(),"recover".into());
        let auth=crate::server::router(app.clone()).oneshot(Request::builder().method("POST").uri("/auth").header("host",&app.host).header("origin",format!("http://{}",app.host)).body(Body::from(app.issue_launch())).unwrap()).await.unwrap();
        let cookie=auth.headers()["set-cookie"].to_str().unwrap().split(';').next().unwrap().to_owned();
        for (path,body) in [
            ("/api/sessions",json!({"api":deck2_shared::API,"id":"isolated-admission","title":"Isolated","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})),
            ("/api/sessions/isolated-admission/assignments",json!({"api":deck2_shared::API,"memberId":"lead","assignment":{"runnerId":"codex","modelId":"gpt-6.1-sol","thinking":"high"},"expectedRevision":1})),
        ] {
            let response=crate::server::router(app.clone()).oneshot(Request::builder().method("POST").uri(path)
                .header("host",&app.host).header("origin",format!("http://{}",app.host)).header("cookie",&cookie).header("content-type","application/json")
                .body(Body::from(body.to_string())).unwrap()).await.unwrap();
            assert_eq!(response.status(),StatusCode::OK);
        }
        assert_eq!(app.store.lock().unwrap().session_by_id("isolated-admission").unwrap().contract.unwrap().members["lead"].thinking.as_deref(),Some("high"));
    }
    // ASSIGN-02: configured selections survive inventory outages/unavailability;
    // explicit overrides win and native preparation enforces actual availability.
    #[tokio::test]
    async fn assignment_creation_merges_configured_members_without_silent_fallback() {
        use std::os::unix::fs::PermissionsExt;
        let f=tempfile::tempdir().unwrap();let path=f.path().join("codex");
        std::fs::write(&path,include_str!("../tests/fake_session_native.py")).unwrap();std::fs::set_permissions(&path,std::fs::Permissions::from_mode(0o700)).unwrap();
        let config=f.path().join("config/deck/config.json");std::fs::create_dir_all(config.parent().unwrap()).unwrap();std::fs::set_permissions(config.parent().unwrap(),std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(&config,json!({"crossRunner":{"members":{"lead":{"runnerId":"codex","modelId":"configured-unavailable"},"investigate":{"runnerId":"codex","modelId":"openai-codex/recorded-worker","thinking":"high"},"quality":{"runnerId":"codex","modelId":"unavailable-quality","thinking":"ultra"}}}}).to_string()).unwrap();std::fs::set_permissions(&config,std::fs::Permissions::from_mode(0o600)).unwrap();
        let app=App::new(Store::open_memory(f.path().to_str().unwrap()).unwrap(),"127.0.0.1:32123".into(),path,None,"admin".into(),"recover".into());
        app.web_identity.lock().unwrap().identity.assignment_config=Some(config);
        *app.native_role_root.lock().unwrap()=f.path().join("native");
        let explicit=serde_json::from_value(json!({"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol","thinking":"high"}})).unwrap();
        let members=creation_members(&app,&explicit).await.unwrap();assert_eq!(members.len(),7,"New canonical sessions provision every role");assert_eq!(members["lead"].model_id,"gpt-6.1-sol");assert_eq!(members["investigate"].model_id,"openai-codex/recorded-worker");assert_eq!(members["quality"].model_id,"unavailable-quality");assert_eq!(members["quality"].thinking.as_deref(),Some("ultra"));
        let c=serde_json::from_value(json!({"api":deck2_shared::API,"id":"configured-members","title":"Configured session","members":members})).unwrap();let session=app.store.lock().unwrap().create_session(&c).unwrap();assert_eq!(session.contract.unwrap().members,members);
        assert!(validate_available(&app,&members).await.is_err(),"unavailable inherited assignment stays visibly blocked");
    }
}

#[cfg(test)]
mod grant_scope_tests {
    use super::*;
    use deck2_shared::{DecisionResponse, DecisionState, Resolve, API};
    use serde_json::json;

    fn decision(r: &deck2_shared::Receipt, request: u64, server: &str, tool: &str, input: serde_json::Value) -> Decision {
        crate::codex_protocol::native_decision(r, &r.generation, r.thread.as_deref().unwrap(), r.turn.as_deref().unwrap(),
            &json!({"id":request,"method":"mcpServer/elicitation/request","params":{"threadId":r.thread,"turnId":r.turn,"serverName":server,"toolName":tool,"mode":"form","requestedSchema":{"type":"object","properties":{}},"_meta":{"codex_approval_kind":"mcp_tool_call","tool_params":input}}})).unwrap()
    }
    // protects: delivered role-scoped delegation consent across turns, with exact native replies,
    // unrelated authority isolation, revision/UUID binding and revocation.
    // Oracle: explicit session delegation covers subsequent work for the same configured role only.
    #[tokio::test]
    async fn session_delegation_scope_reuses_role_not_task_arguments() {
        let (_dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let mut r = s.get("coordination-root").unwrap().unwrap();
        let d = decision(&r, 1, "deck-session", "deck_delegate", json!({"agent":"apply-deep","task":"First investigation"}));
        r.decisions.push(d.clone()); s.save(&mut r).unwrap();
        let resolve = Resolve {api:API,command_id:"explicit-session-consent".into(),expected_revision:d.revision,response:DecisionResponse::AllowSession};
        let mut stale=resolve.clone();stale.expected_revision+=1;
        assert!(s.resolve(&d.id,&stale).is_err());
        s.resolve(&d.id,&resolve).unwrap();s.resolve(&d.id,&resolve).unwrap();
        assert!(!s.session_grant(&d).unwrap(), "undelivered intent grants nothing");
        let released=s.authorize_response(&r.id,&d.id,&r.generation).unwrap().unwrap();
        assert_eq!(crate::codex_protocol::native_reply(&released).unwrap(),json!({"action":"accept","content":{},"_meta":null}));
        r=s.get(&r.id).unwrap().unwrap();r.decisions[0].state=DecisionState::Delivered;r.decisions[0].delivered_ms=Some(crate::now());s.save(&mut r).unwrap();
        let next=decision(&r,2,"deck-session","deck_delegate",json!({"agent":"apply-deep","task":"Different investigation","acceptance":{"checks":["inspect"]}}));
        assert!(s.session_grant(&next).unwrap(),"changing task text must not reprompt within the consented role");
        for (server,tool,input) in [
            ("another-server","deck_delegate",json!({"agent":"apply-deep","task":"Second"})),
            ("deck-session","deck_task_cancel",json!({"taskId":"anything"})),
            ("deck-session","deck_delegate",json!({"agent":"quality","task":"Second"})),
            ("deck-session","deck_delegate",json!({"task":"No target"})),
        ] { assert!(!s.session_grant(&decision(&r,3,server,tool,input)).unwrap()); }
        let mut old=r.clone();old.configuration.as_mut().unwrap().session_contract.as_mut().unwrap().revision+=1;
        assert!(!s.session_grant(&decision(&old,4,"deck-session","deck_delegate",json!({"agent":"apply-deep","task":"Second"}))).unwrap());
        r.phase=Phase::Completed;s.save(&mut r).unwrap();
        let input=serde_json::from_value(json!({"api":API,"id":"later-session-turn","session":r.session,"prompt":"Continue","mode":"session_v1","queue":true})).unwrap();
        let mut later=s.admit(&input).unwrap();later.phase=Phase::Running;later.thread=Some("thread".into());later.turn=Some("later-turn".into());s.save(&mut later).unwrap();
        let next=decision(&later,5,"deck-session","deck_delegate",json!({"agent":"apply-deep","task":"Third"}));
        assert!(s.session_grant(&next).unwrap(),"grant lifetime is canonical session generation, not native turn");
        s.create_session(&serde_json::from_value(json!({"api":API,"id":"unrelated-session","title":"Other","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"},"apply-deep":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap()).unwrap();
        let other=s.admit(&serde_json::from_value(json!({"api":API,"id":"unrelated-input","session":"unrelated-session","prompt":"Other","mode":"session_v1","queue":true})).unwrap()).unwrap();
        let mut foreign=next.clone();foreign.session=other.session;foreign.command=other.id;
        assert!(!s.session_grant(&foreign).unwrap());
        // A host restart preserves delivered consent, but never replays the old turn.
        let db=_dir.path().join("grants.sqlite");s.conn.backup("main",&db,None).unwrap();
        let mut reopened=Store::open(&db,&s.project).unwrap();
        assert!(reopened.session_grant(&next).unwrap());
        assert!(reopened.authorize_response(&later.id,&next.id,&later.generation).unwrap().is_none());
        let mut replaced=reopened.session_by_id(&r.session).unwrap();replaced.contract.as_mut().unwrap().generation+=1;reopened.save_session(&replaced).unwrap();
        assert!(!reopened.session_grant(&next).unwrap(),"old authority cannot reuse grants after replacement");
        // Consent recorded before role-scoped disclosure stays an exact-action grant.
        let mut historical=s.get(&r.id).unwrap().unwrap();
        historical.decisions[0].native.as_mut().unwrap().identity=Some(json!({"method":"mcpServer/elicitation/request","action":{"server":"deck-session","tool":"deck_delegate","input":{"agent":"apply-deep","task":"First investigation"}}}).to_string());
        s.save(&mut historical).unwrap();
        assert!(!s.session_grant(&next).unwrap(),"historical consent must not silently widen");
        // Model revocation between automatic grant lookup and persisted response insertion.
        assert!(s.get(&later.id).unwrap().unwrap().phase.active());
        s.revoke_session_grants(&r.session).unwrap();
        let mut raced=s.get(&later.id).unwrap().unwrap();let mut automatic=next.clone();
        automatic.state=DecisionState::Responded;automatic.resolution=Some(Resolve{api:API,command_id:"automatic-grant-reply".into(),expected_revision:automatic.revision,response:DecisionResponse::AllowOnce});
        raced.decisions.push(automatic);s.save(&mut raced).unwrap();
        assert!(s.authorize_response(&later.id,&next.id,&later.generation).unwrap().is_none(),"revoked authority cannot release a late automatic reply");
        assert!(!s.session_grant(&next).unwrap());
        let mut renewed=s.admit(&serde_json::from_value(json!({"api":API,"id":"renewed-grant-input","session":r.session,"prompt":"Renew consent","mode":"session_v1","queue":true})).unwrap()).unwrap();
        renewed.phase=Phase::Running;renewed.thread=Some("new-thread".into());renewed.turn=Some("new-turn".into());s.save(&mut renewed).unwrap();
        let fresh=decision(&renewed,9,"deck-session","deck_delegate",json!({"agent":"apply-deep","task":"After revocation"}));
        renewed.decisions.push(fresh.clone());s.save(&mut renewed).unwrap();
        s.resolve(&fresh.id,&Resolve{api:API,command_id:"renew-explicit-consent".into(),expected_revision:fresh.revision,response:DecisionResponse::AllowSession}).unwrap();
        let mut renewed=s.get(&renewed.id).unwrap().unwrap();
        renewed.decisions[0].state=DecisionState::Delivered;
        renewed.decisions[0].delivered_ms=Some(renewed.configuration.as_ref().unwrap().session_contract.as_ref().unwrap().grants_revoked_at);
        s.save(&mut renewed).unwrap();
        assert!(s.session_grant(&fresh).unwrap(),"new consent must work even at an equal/rolled-back timestamp");
    }
}

#[cfg(test)]
mod general_permission_tests {
    use super::*;
    #[tokio::test]
    async fn session_consent_cannot_ignore_material_command_permissions() {
        let (_dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s=app.store.lock().unwrap();
        let mut r=s.get("coordination-root").unwrap().unwrap();
        let request=json!({"id":7001,"method":"item/commandExecution/requestApproval","params":{"threadId":r.thread,"turnId":r.turn,"itemId":"command-one","command":"cargo test","cwd":app.project,"additionalPermissions":{"network":false},"environment":{"MODE":"test"}}});
        let d=native_decision(&r,&r.generation,r.thread.as_deref().unwrap(),r.turn.as_deref().unwrap(),&request).unwrap();
        r.decisions.push(d.clone());s.save(&mut r).unwrap();
        s.resolve(&d.id,&deck2_shared::Resolve{api:deck2_shared::API,command_id:"command-explicit-consent".into(),expected_revision:1,response:DecisionResponse::AllowSession}).unwrap();
        let mut r=s.get(&r.id).unwrap().unwrap();
        r.decisions[0].state=DecisionState::Delivered;r.decisions[0].delivered_ms=Some(crate::now());s.save(&mut r).unwrap();
        let mut changed=request.clone();changed["id"]=json!(7002);changed["params"]["additionalPermissions"]["network"]=json!(true);
        let next=native_decision(&r,&r.generation,r.thread.as_deref().unwrap(),r.turn.as_deref().unwrap(),&changed).unwrap();
        assert!(!s.session_grant(&next).unwrap(),"session consent reused after network escalation");
    }
}
