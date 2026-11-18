//! Per-attempt MCP transport. A fresh secret and listener are owned by one live
//! native attempt; history can neither mint nor reactivate its authority.
use crate::server::App;
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
};
use deck2_shared::{Mode, Phase};
use serde_json::{Value, json};
use std::sync::{Arc, Weak};
struct Scope {
    app: Weak<crate::server::Inner>,
    token: String,
    root: String,
    attempt: String,
    session: String,
    member_task: Option<String>,
    role: std::sync::Mutex<Option<crate::session_roles::Role>>,
    codebase: crate::session_freshness::Slot,
}
pub struct Bridge {
    pub config: Value,
    scope: Arc<Scope>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Bridge {
    fn drop(&mut self) {
        if let Some(app) = self.scope.app.upgrade() {
            let mut credentials = app.session_credentials.lock().unwrap();
            let key = self.scope.key();
            if credentials.get(&key) == Some(&self.scope.token) {
                credentials.remove(&key);
            }
        }
        self.task.abort();
    }
}
impl Scope {
    fn key(&self) -> String {
        match &self.member_task {
            Some(task) => format!("member:{task}:{}", self.attempt),
            None => format!("lead:{}", self.root),
        }
    }
}
impl Bridge {
    pub(crate) fn codebase(&self) -> crate::session_freshness::Slot {
        self.scope.codebase.clone()
    }
    /// Only the live host-owned bridge can qualify a redundant native prompt.
    /// This does not authorize an operation: handlers recheck authority and
    /// validate targets, dependencies, limits and idempotency at the effect.
    pub(crate) fn coordination_permitted(&self, name: &str, args: &Value) -> bool {
        if !coordination_tool(self.scope.member_task.is_some(), name) { return false; }
        let Some(inner) = self.scope.app.upgrade() else { return false; };
        let app = App::from_inner(inner);
        let store = app.store.lock().unwrap();
        if !app.persistence_available() || app.shutdown_requested.load(std::sync::atomic::Ordering::SeqCst)
            || !live(&self.scope, &store) { return false; }
        if name == "deck_delegate" {
            let Some(role) = args["agent"].as_str() else { return false; };
            let role = role.trim_start_matches("deck-");
            if role == "lead" || !crate::session_contract::MEMBERS.contains(&role) { return false; }
            return store.get(&self.scope.root).ok().flatten()
                .and_then(|r| r.configuration).and_then(|c| c.session_contract)
                .is_some_and(|c| c.members.contains_key(role));
        }
        true
    }
    pub fn set_role(&self, role: crate::session_roles::Role) {
        *self.scope.role.lock().unwrap() = Some(role);
    }
    pub async fn start(app: &App, root: &str) -> Result<Self, String> {
        let receipt = app.receipt(root)?;
        if receipt.mode != Mode::SessionV1 {
            return Err("Session MCP requires connected admission".into());
        }
        let scope = Arc::new(Scope {
            app: Arc::downgrade(&app.inner),
            token: crate::server::secret(),
            root: root.into(),
            attempt: receipt.attempt,
            session: receipt.session,
            member_task: None,
            role: std::sync::Mutex::new(None),
            codebase: Default::default(),
        });
        Self::bind(scope).await
    }
    pub async fn start_member(app: &App, task: &str, attempt: &str) -> Result<Self, String> {
        let t = app.store.lock().unwrap().task(task)?;
        let scope = Arc::new(Scope {
            app: Arc::downgrade(&app.inner),
            token: crate::server::secret(),
            root: t.authority_root(t.attempts.iter().find(|a|a.id==attempt).ok_or("Member attempt missing")?).into(),
            attempt: attempt.into(),
            session: t.session,
            member_task: Some(task.into()),
            role: std::sync::Mutex::new(None),
            codebase: Default::default(),
        });
        Self::bind(scope).await
    }
    async fn bind(scope: Arc<Scope>) -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "Cannot bind attempt MCP")?;
        let url = format!(
            "http://{}/mcp",
            listener
                .local_addr()
                .map_err(|_| "MCP address unavailable")?
        );
        let config = json!({"enabled":true,"url":url,"http_headers":{"Authorization":format!("Bearer {}",scope.token)}});
        if let Some(app) = scope.app.upgrade() {
            app.session_credentials
                .lock()
                .unwrap()
                .insert(scope.key(), scope.token.clone());
        }
        let router = Router::new()
            .route("/mcp", post(handle))
            .route("/codebase", post(handle))
            .layer(axum::extract::DefaultBodyLimit::max(65536))
            .with_state(scope.clone());
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        Ok(Self {
            config,
            scope,
            task,
        })
    }
}
/// Intrinsic coordination, never a server-name/prefix trust rule. Result
/// integration records report treatment only; it cannot merge or execute code.
/// The relay only asks the user: approving its invocation grants no effect.
pub(crate) fn coordination_tool(member: bool, name: &str) -> bool {
    matches!(name, "deck_session_history" | "deck_task_result" | "deck_approve")
        || !member && matches!(name, "deck_delegate" | "deck_task_list"
            | "deck_task_wait" | "deck_task_cancel" | "deck_task_integrate")
}
pub(crate) fn tools(member: bool) -> Value {
    let mut tools = json!([
     {"name":"deck_session_history","description":"Read public session evidence. History is not authority.","inputSchema":{"type":"object","additionalProperties":false,"properties":{"before":{"type":"integer","minimum":0},"after":{"type":"integer","minimum":0},"eventSeq":{"type":"integer","minimum":1},"offset":{"type":"integer","minimum":0}}}},
     {"name":"deck_task_list","description":"List this session's delegated tasks and recorded owners.","inputSchema":{"type":"object","properties":{}}},
     {"name":"deck_task_result","description":"Retrieve an exact terminal report; retrieval is not integration.","inputSchema":{"type":"object","properties":{"taskId":{"type":"string"},"attempt":{"type":"integer","minimum":1}},"required":["taskId"]}}
    ]);
    if !member {
        tools.as_array_mut().unwrap().extend([
  json!({"name":"deck_delegate","description":"Delegate to a configured member. continueTaskId preserves logical task and recorded owner.","inputSchema":{"type":"object","properties":{"agent":{"type":"string"},"task":{"type":"string"},"continueTaskId":{"type":"string"},"acceptance":{"type":"object"}},"required":["agent","task"]}}),
  json!({"name":"deck_task_cancel","description":"Cancel a delegated task.","inputSchema":{"type":"object","properties":{"taskId":{"type":"string"}},"required":["taskId"]}}),
  json!({"name":"deck_task_integrate","description":"Record Lead review of an exact retrieved terminal report. Adoption is not independent verification.","inputSchema":{"type":"object","properties":{"taskId":{"type":"string"},"attempt":{"type":"integer","minimum":1},"commandId":{"type":"string"},"state":{"enum":["integrated","blocked","discarded"]},"note":{"type":"string"},"evidenceSeqs":{"type":"array","items":{"type":"integer"}}},"required":["taskId","attempt","commandId","state","note","evidenceSeqs"]}})
 ]);
    }
    tools.as_array_mut().unwrap().push(json!({"name":"deck_approve","description":"Relay a permission request to the user; this tool cannot self-approve.","inputSchema":{"type":"object","properties":{"tool_name":{"type":"string"},"input":{"type":"object"},"tool_use_id":{"type":"string"}},"required":["tool_name","input"]}}));
    if !member {
        tools.as_array_mut().unwrap().extend(
            serde_json::from_str::<Vec<Value>>(include_str!(
                "../assets/session-decision-tools.json"
            ))
            .unwrap(),
        );
        tools.as_array_mut().unwrap().push(json!({"name":"deck_task_wait","description":"Wait for requested tasks for at most 50 seconds.","inputSchema":{"type":"object","properties":{"taskIds":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":100},"timeoutSec":{"type":"number","minimum":0,"maximum":50}},"required":["taskIds"]}}));
        let dependencies: Value =
            serde_json::from_str(include_str!("../assets/session-dependency-schema.json")).unwrap();
        let delegate = tools
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|t| t["name"] == "deck_delegate")
            .unwrap();
        delegate["inputSchema"]["properties"]
            .as_object_mut()
            .unwrap()
            .extend(dependencies.as_object().unwrap().clone());
    }
    if !member {
        let properties: Value =
            serde_json::from_str(include_str!("../assets/session-task-schemas.json"))
                .expect("embedded source-derived task schemas");
        if let Some(delegate) = tools
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|t| t["name"] == "deck_delegate")
        {
            delegate["inputSchema"]["properties"]
                .as_object_mut()
                .unwrap()
                .extend(properties.as_object().unwrap().clone());
        }
    }
    if !member {
        let integrate = tools
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|t| t["name"] == "deck_task_integrate")
            .unwrap();
        integrate["inputSchema"]["properties"]["evidenceSeqs"]["items"]=json!({"anyOf":[{"type":"integer","minimum":1},{"type":"object","additionalProperties":false,"required":["source","store","session","fingerprint","seq"],"properties":{"source":{"const":"original"},"store":{"type":"string","pattern":"^[a-f0-9]{64}$"},"session":{"type":"string"},"fingerprint":{"type":"string","pattern":"^[a-f0-9]{64}$"},"seq":{"type":"integer","minimum":1}}}]});
        integrate["inputSchema"]["properties"]["findingResolutions"] = serde_json::from_str(
            include_str!("../assets/session-finding-resolution-schema.json"),
        )
        .unwrap();
    }
    if member {
        tools
            .as_array_mut()
            .unwrap()
            .retain(|t| t["name"] == "deck_session_history" || t["name"] == "deck_approve" || t["name"] == "deck_task_result");
        let result=tools.as_array_mut().unwrap().iter_mut().find(|t|t["name"]=="deck_task_result").unwrap();
        result["inputSchema"]["required"]=json!(["taskId","attempt"]);
        result["description"]=json!("Read an exact assigned source report or an earlier attempt of your own task. This read cannot authorize integration.");

    }
    tools.as_array_mut().unwrap().extend(crate::session_skills::tools());
    for tool in tools.as_array_mut().unwrap() {
        if matches!(tool["name"].as_str(),Some("deck_session_history"|"deck_task_result"|"deck_skill_search"|"deck_skill_load")) {
            tool["annotations"]=json!({"readOnlyHint":true,"destructiveHint":false,"openWorldHint":false});
        }
    }
    tools
}
fn live(s: &Scope, store: &crate::Store) -> bool {
    if store.execution_project(&s.session).is_err() {return false;}
    if s.role
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|r| r.verify().is_err())
    {
        return false;
    }
    if s.app
        .upgrade()
        .is_none_or(|app| app.session_credentials.lock().unwrap().get(&s.key()) != Some(&s.token))
    {
        return false;
    }

    let Some(r)=store.get(&s.root).ok().flatten() else {return false;};
    let current=store.session_by_id(&s.session).ok().and_then(|s|s.contract);
    let admitted=r.configuration.as_ref().and_then(|s|s.session_contract.as_ref());
    if r.session!=s.session || r.cancel_requested || current.as_ref().zip(admitted).is_none_or(|(now,then)|now.lead_task!=then.lead_task || now.generation!=then.generation || now.grants_revoked_at>then.grants_revoked_at) {return false;}
    if let Some(task)=&s.member_task {
        store.task(task).is_ok_and(|t|t.session==s.session && t.attempts.iter().any(|a|a.id==s.attempt && a.phase.active() && !a.cancel_requested && t.authority_root(a)==s.root))
    } else {r.attempt==s.attempt && r.phase.active()}

}

async fn handle(
    State(s): State<Arc<Scope>>,
    headers: HeaderMap,
    uri: axum::http::Uri,
    Json(v): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if headers.get("authorization").and_then(|v| v.to_str().ok())
        != Some(format!("Bearer {}", s.token).as_str())
    {
        return (StatusCode::UNAUTHORIZED, Json(json!({})));
    }
    let id = v.get("id").cloned().unwrap_or(Value::Null);
    let Some(inner) = s.app.upgrade() else {
        return (StatusCode::FORBIDDEN, Json(json!({})));
    };
    let app = App::from_inner(inner);
    let active = app.persistence_available()
        && !app
            .shutdown_requested
            .load(std::sync::atomic::Ordering::SeqCst)
        && live(&s, &app.store.lock().unwrap());
    if !active {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Attempt authority revoked"})),
        );
    }
    if id.is_null() {
        return (StatusCode::ACCEPTED, Json(json!({})));
    }
    if uri.path() == "/codebase" {
        let binding = s.codebase.lock().unwrap().clone();
        let result = match binding {
            Some(b) => {
                let scope = s.clone();
                b.request_authorized(
                    &v,
                    Some(Arc::new(move || {
                        scope.app.upgrade().is_some_and(|inner| {
                            let app = App::from_inner(inner);
                            app.persistence_available()
                                && !app
                                    .shutdown_requested
                                    .load(std::sync::atomic::Ordering::SeqCst)
                                && live(&scope, &app.store.lock().unwrap())
                        })
                    })),
                )
                .await
            }
            None => Err("Managed codebase binding unavailable".into()),
        };
        if !live(&s, &app.store.lock().unwrap()) {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error":"Attempt authority revoked"})),
            );
        }
        return (
            StatusCode::OK,
            Json(match result {
                Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
                Err(_) => {
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":"Managed codebase unavailable; use exact source fallback"}})
                }
            }),
        );
    }
    let result: Result<Value, String> = match v["method"].as_str().unwrap_or("") {
        "initialize" => Ok(
            json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"deck-session","version":"1"}}),
        ),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools":tools(s.member_task.is_some())})),
        "tools/call" => {
            let name = v["params"]["name"].as_str().unwrap_or("");
            if !tools(s.member_task.is_some())
                .as_array()
                .unwrap()
                .iter()
                .any(|t| t["name"] == name)
            {
                Err("Unknown or unadvertised session tool".into())
            } else {
                let args = &v["params"]["arguments"];
                let result = if name == "deck_task_wait" {
                    wait(&s, &app, args).await
                } else if name == "deck_approve" {
                    approve(&s, &app, args).await
                } else {
                    (|| -> Result<Value, String> {
                        let original_history = app.history.lock().map_err(|_| "Original history unavailable")?;
                        let mut store = app.store.lock().map_err(|_| "State lock failed")?;
                        // Recheck inside the serialization boundary, including for read-only tools.
                        if !live(&s, &store) {
                            return Err("Attempt revoked".into());
                        }
                        match name {
                            "deck_skill_search" | "deck_skill_load" => {
                                let value=crate::session_skills::call(name,args)?;
                                if name=="deck_skill_load" {
                                    let task=s.member_task.clone().unwrap_or_else(|| s.root.clone());
                                    let kind=crate::session_skills::delivery_key(value["skill"].as_str().unwrap(),value["resource"].as_str().unwrap(),value["sha256"].as_str().unwrap());
                                    let evidence=json!({"skill":value["skill"],"resource":value["resource"],"source":value["source"],"sha256":value["sha256"],"bytes":value["bytes"],"version":value["version"],"delivery":"live scoped tool result; compliance unproven"});
                                    store.conn.execute("INSERT INTO session_events(session,task,attempt,kind,body) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(task,attempt,kind) DO NOTHING",rusqlite::params![s.session,task,s.attempt,kind,evidence.to_string()]).map_err(|_| "Cannot persist instruction delivery")?;
                                }
                                Ok(value)
                            }
                            "deck_session_history" => history(&store, &s.session, args),
                            "deck_task_result" if s.member_task.is_some() => {
                                let session=store.session_by_id(&s.session)?;
                                let records=original_history.task_records(&session)?;
                                crate::session_tasks::member_result(&store,s.member_task.as_deref().unwrap(),&s.attempt,args,&records)
                            }
                            _ if name.starts_with("deck_decision_") && s.member_task.is_none() => {
                                crate::session_decisions::tool(&mut store, &s.root, name, args)
                            }
                            _ if s.member_task.is_none() => {
                                let session=store.session_by_id(&s.session)?;
                                let records=original_history.task_records(&session)?;
                                let binding=if name=="deck_delegate" {
                                    store.execution_project(&s.session)?;
                                    original_history.check_context(&session)?;
                                    if let Some(id)=args["continueTaskId"].as_str() {
                                        if records.iter().any(|t|t["id"]==id) {Some(original_history.task_binding(&session,id)?)} else {None}
                                    } else {None}
                                } else {None};
                                let call = if name == "deck_task_integrate" || args.get("replan").is_some() {
                                    args["commandId"].as_str().ok_or("Stable commandId required")?.to_string()
                                } else {
                                    // Identity is host connection/caller + native invocation. Payload
                                    // is checked separately: changed arguments cannot mint a retry.
                                    format!("mcp:{}:{}",s.attempt,id)
                                };
                                crate::session_tasks::tool_with_original(&mut store, &s.root, name, args, &call, binding, &records)

                            }
                            _ => Err("Tool unavailable".into()),
                        }
                    })()
                };
                if name == "deck_delegate"
                    && let Ok(value) = &result
                    && let (Some(task), Some(index)) =
                        (value["internalTaskId"].as_str().or(value["taskId"].as_str()), value["attempt"].as_u64())
                {
                    let start = {
                        let store = app.store.lock().unwrap();
                        store
                            .task(task)
                            .ok()
                            .and_then(|t| t.attempt_index(index).map(|i|t.attempts[i].clone()))
                            .filter(|a| a.phase == Phase::Accepted)
                    };
                    if let Some(attempt) = start
                        && app.start_task(task, &attempt.id).is_err()
                    {
                        app.storage_failed();
                    }
                }
                if name == "deck_task_cancel" { app.pump_queue(); }
                Ok(match result {
                    Ok(value) => {
                        json!({"content":[{"type":"text","text":value.to_string()}],"isError":false})
                    }
                    Err(e) => json!({"content":[{"type":"text","text":e}],"isError":true}),
                })
            }
        }
        _ => Err("Unsupported MCP method".into()),
    };
    let body = match result {
        Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
        Err(e) => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":e}}),
    };
    (StatusCode::OK, Json(body))
}

fn history(store: &crate::Store, session: &str, args: &Value) -> Result<Value, String> {
    if !args.as_object().is_some_and(|v| {
        v.keys()
            .all(|k| ["before", "after", "eventSeq", "offset"].contains(&k.as_str()))
    }) {
        return Err("Invalid history cursor".into());
    }
    let number = |key: &str, default: i64| -> Result<i64, String> {
        match args.get(key) {
            None => Ok(default),
            Some(v) => v
                .as_i64()
                .filter(|n| *n >= 0)
                .ok_or("Invalid history cursor".into()),
        }
    };
    let before = number("before", i64::MAX)?;
    let after = number("after", 0)?;
    let exact = number("eventSeq", 0)?;
    let offset = number("offset", 0)? as usize;
    let through: i64 = store
        .conn
        .query_row(
            "SELECT COALESCE(MAX(seq),0) FROM session_events WHERE session=?1",
            [session],
            |r| r.get(0),
        )
        .map_err(|_| "Cannot read session history")?;
    let mut stmt=store.conn.prepare("SELECT seq,kind,body FROM session_events WHERE session=?1 AND seq<?2 AND seq>?3 AND (?4=0 OR seq=?4) ORDER BY seq DESC LIMIT 41").map_err(|_|"Cannot read session history")?;
    let mut records = vec![];
    for row in stmt
        .query_map(rusqlite::params![session, before, after, exact], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| "Cannot read session history")?
    {
        let (seq, kind, body) = row.map_err(|_| "Cannot read session history")?;
        if offset > body.len() || !body.is_char_boundary(offset) {
            return Err("Invalid history record byte offset".into());
        }
        let mut end = (offset + 16384).min(body.len());
        while !body.is_char_boundary(end) {
            end -= 1;
        }
        let content = &body[offset..end];
        let total = body.len();
        records.push(json!({"v":1,"seq":seq,"kind":kind,"content":content,"offset":offset,"totalBytes":total,"nextOffset":if end<total{Some(end)}else{None}}));
    }
    let more = records.len() > 40;
    if more {
        records.pop();
    }
    records.reverse();
    if exact > 0 && records.is_empty() {
        return Err("Unknown or foreign history event".into());
    }
    Ok(
        json!({"sessionId":session,"through":through,"resumeAfter":records.last().and_then(|r|r["seq"].as_i64()).unwrap_or(after),"records":records,"before":records.first().and_then(|r|r["seq"].as_i64()).unwrap_or(through+1),"hasMore":more,"availability":"Ordered local public Rust session evidence; native omissions and private history are not read. Offsets are UTF-8 bytes."}),
    )
}

async fn wait(s: &Scope, app: &App, args: &Value) -> Result<Value, String> {
    if !crate::session_decisions::keys(args, &["taskIds", "timeoutSec"]) {
        return Err("Invalid wait arguments".into());
    }
    let ids = args["taskIds"]
        .as_array()
        .filter(|v| {
            !v.is_empty()
                && v.len() <= 100
                && v.iter().all(|v| crate::session_decisions::text(v, 128))
        })
        .ok_or("Invalid task wait selection")?;
    let seconds = args
        .get("timeoutSec")
        .map(|v| {
            v.as_f64()
                .filter(|n| n.is_finite() && (0.0..=50.0).contains(n))
                .ok_or("Invalid wait timeout")
        })
        .transpose()?
        .unwrap_or(50.0);
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs_f64(seconds);
    loop {
        let ready={
            let history=app.history.lock().map_err(|_|"Original history unavailable")?;
            let mut store=app.store.lock().map_err(|_|"State lock failed")?;
            if !live(s,&store) || !app.persistence_available() || app.shutdown_requested.load(std::sync::atomic::Ordering::SeqCst) {return Err("Wait authority revoked".into());}
            let session=store.session_by_id(&s.session)?;
            let records=history.task_records(&session)?;
            let mut selections=vec![];
            for id in ids {
                let id=id.as_str().unwrap();
                let (number,settled)=match store.logical_task(&s.session,id) {
                    Ok(t)=>{let a=t.attempts.last().ok_or("Task attempt missing")?;(t.number(t.attempts.len()-1),!a.phase.active() && a.phase!=Phase::Queued && a.phase!=Phase::Uncertain)},
                    Err(e) if e=="Unknown task"=>{
                        let a=records.iter().find(|t|t["id"]==id).and_then(|t|t["attempts"].as_array()?.last()).ok_or("Unknown wait task")?;
                        (a["number"].as_u64().ok_or("Recorded attempt unavailable")?,["completed","failed","cancelled","interrupted"].contains(&a["state"].as_str().unwrap_or("")))
                    }
                    Err(e)=>return Err(e),
                };
                selections.push((id.to_string(),number,settled));
            }
            let settled=selections.iter().all(|(_,_,settled)|*settled);
            if settled || tokio::time::Instant::now()>=deadline {
                let mut reports=vec![];
                for (id,number,done) in selections {
                    if done {reports.push(crate::session_tasks::tool_with_original(&mut store,&s.root,"deck_task_result",&json!({"taskId":id,"attempt":number}),&format!("wait:{id}:{number}"),None,&records)?);}
                    else {reports.push(json!({"taskId":id,"attempt":number,"finalReport":false}));}
                }
                Some(json!({"tasks":reports,"timedOut":!settled}))
            } else {None}
        };
        if let Some(value)=ready {return Ok(value);}
        tokio::time::sleep_until(
            deadline.min(tokio::time::Instant::now() + std::time::Duration::from_millis(50)),
        )
        .await;
    }
}

struct PendingRelay {
    app: App,
    root: String,
    id: String,
}
impl Drop for PendingRelay {
    fn drop(&mut self) {
        let _ = self.app.change(&self.root, |r| {
            if let Some(d) = r.decisions.iter_mut().find(|d| d.id == self.id)
                && matches!(
                    d.state,
                    deck2_shared::DecisionState::Pending | deck2_shared::DecisionState::Responded
                )
            {
                d.state = deck2_shared::DecisionState::Invalidated;
                d.detail = "Permission relay closed before release".into();
            }
        });
    }
}
async fn approve(s: &Scope, app: &App, args: &Value) -> Result<Value, String> {
    use deck2_shared::{DecisionResponse, DecisionState};
    if !crate::session_decisions::keys(args, &["tool_name", "input", "tool_use_id"])
        || !crate::session_decisions::text(&args["tool_name"], 128)
        || !args["input"].is_object()
        || args["input"].to_string().len() > 16384
        || args
            .get("tool_use_id")
            .is_some_and(|v| !crate::session_decisions::text(v, 128))
    {
        return Err("Invalid permission relay request".into());
    }
    let id = {
        let mut store = app.store.lock().map_err(|_| "State lock failed")?;
        if !live(s, &store) {
            return Err("Relay authority revoked".into());
        }
        let mut root = store.get(&s.root)?.ok_or("Origin missing")?;
        let mut caller = root.clone();
        if let Some(task) = &s.member_task {
            let t = store.task(task)?;
            let a = t
                .attempts
                .iter()
                .find(|a| a.id == s.attempt && a.phase == Phase::Running && !a.cancel_requested)
                .ok_or("Member inactive")?;
            caller.attempt = a.id.clone();
            caller.generation = a.generation.clone();
            caller.thread = a.native_session.clone();
            caller.turn = a.native_message.clone();
            caller.phase = Phase::Running;
        }
        let thread = caller.thread.as_deref().ok_or("Native thread missing")?;
        let turn = caller.turn.as_deref().ok_or("Native turn missing")?;
        let request = uuid::Uuid::new_v4().to_string();
        let value = json!({"id":request,"method":"mcpServer/elicitation/request","params":{"threadId":thread,"turnId":turn,"serverName":"deck-relay","toolName":args["tool_name"],"mode":"form","requestedSchema":{"type":"object","properties":{}},"_meta":{"codex_approval_kind":"mcp_tool_call","tool_params":args["input"]},"toolUseId":args["tool_use_id"]}});
        let mut d = crate::session_contract::native_decision(
            &caller,
            &caller.generation,
            thread,
            turn,
            &value,
        )?;
        d.task = s.member_task.clone();
        d.native.as_mut().unwrap().method = "deck/approve".into();
        d.native.as_mut().unwrap().transport = Some(deck2_shared::NativeTransport::DeckMcp);
        d.native.as_mut().unwrap().summary = format!(
            "Permission request: {}",
            args["tool_name"].as_str().unwrap()
        );
        d.native.as_mut().unwrap().identity =
            Some(json!({"relay":args["tool_name"],"input":args["input"]}).to_string());
        if args["tool_name"] == "AskUserQuestion" {
            let questions = args["input"]["questions"]
                .as_array()
                .filter(|v| !v.is_empty() && v.len() <= 8)
                .ok_or("Invalid question request")?;
            for (i, q) in questions.iter().enumerate() {
                if !crate::session_decisions::text(&q["question"], 2000)
                    || q.get("header")
                        .is_some_and(|v| v.as_str().is_none_or(|s| s.len() > 120))
                    || q.get("multiSelect").is_some_and(|v| !v.is_boolean())
                {
                    return Err("Invalid question".into());
                }
                let options = q["options"]
                    .as_array()
                    .filter(|v| v.len() <= 12)
                    .ok_or("Invalid question options")?;
                let mut parsed = vec![];
                for o in options {
                    if !crate::session_decisions::text(&o["label"], 200)
                        || o.get("description")
                            .is_some_and(|v| v.as_str().is_none_or(|s| s.len() > 1000))
                    {
                        return Err("Invalid question option".into());
                    }
                    parsed.push(deck2_shared::QuestionOption {
                        label: o["label"].as_str().unwrap().into(),
                        description: o["description"].as_str().unwrap_or("").into(),
                    });
                }
                d.questions.push(deck2_shared::Question {
                    id: format!("q{}", i + 1),
                    question: q["question"].as_str().unwrap().into(),
                    header: q["header"].as_str().unwrap_or("").into(),
                    options: parsed,
                    multiple: q["multiSelect"] == true,
                });
            }
            d.native.as_mut().unwrap().identity = None;
        }
        store.bind_permission(&mut d)?;
        if d.questions.is_empty() && store.reuse_permission(&mut d)? {
            d.state = DecisionState::Responded;
            d.resolution = Some(deck2_shared::Resolve {
                api: deck2_shared::API,
                command_id: uuid::Uuid::new_v4().to_string(),
                expected_revision: d.revision,
                response: DecisionResponse::AllowOnce,
            });
        }
        let id = d.id.clone();
        root.decisions.push(d);
        store.save(&mut root)?;
        id
    };
    let _pending = PendingRelay {
        app: app.clone(),
        root: s.root.clone(),
        id: id.clone(),
    };
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15 * 60);
    loop {
        {
            let mut store = app.store.lock().map_err(|_| "State lock failed")?;
            if !live(s, &store)
                || !app.persistence_available()
                || app
                    .shutdown_requested
                    .load(std::sync::atomic::Ordering::SeqCst)
            {
                return Ok(json!({"behavior":"deny","message":"Attempt authority revoked"}));
            }
            store.reconsider_permission(&s.root, &id)?;
            let r = store.get(&s.root)?.ok_or("Origin missing")?;
            let d = r
                .decisions
                .iter()
                .find(|d| d.id == id)
                .ok_or("Request missing")?;
            if d.state == DecisionState::Invalidated
                || (args["tool_name"] != "AskUserQuestion"
                    && tokio::time::Instant::now() >= deadline)
            {
                return Ok(json!({"behavior":"deny","message":"Request revoked or timed out"}));
            }
            if d.state == DecisionState::Responded {
                let result = if let Some(task) = &s.member_task {
                    store.authorize_member_response(&s.root, &id, task, &s.attempt)?
                } else {
                    store.authorize_response(&s.root, &id, &r.generation)?
                };
                if let Some(d) = result {
                    let allow = matches!(
                        d.resolution.as_ref().ok_or("Response missing")?.response,
                        DecisionResponse::AllowOnce | DecisionResponse::AllowSession
                    );
                    let mut r = store.get(&s.root)?.ok_or("Origin missing")?;
                    let record = r
                        .decisions
                        .iter_mut()
                        .find(|d| d.id == id)
                        .ok_or("Request missing")?;
                    record.state = DecisionState::Delivered;
                    record.delivered_ms = Some(crate::now());
                    record.grant_consumed = allow;
                    record.detail="Permission reply returned to the exact requester; effect outcome is not certified".into();
                    store.save(&mut r)?;
                    if let deck2_shared::DecisionResponse::Answers(answers) = &d
                        .resolution
                        .as_ref()
                        .ok_or("Missing question response")?
                        .response
                    {
                        let mut input = args["input"].clone();
                        let mut result = serde_json::Map::new();
                        let mut reserved = d
                            .questions
                            .iter()
                            .map(|q| q.question.clone())
                            .collect::<std::collections::BTreeSet<_>>();
                        for (i, q) in d.questions.iter().enumerate() {
                            let mut key = q.question.clone();
                            let mut suffix = 2;
                            while result.contains_key(&key) {
                                key = format!("{} ({suffix})", q.question);
                                suffix += 1;
                                if reserved.contains(&key) {
                                    key = q.question.clone();
                                }
                            }
                            reserved.insert(key.clone());
                            input["questions"][i]["question"] = json!(key);
                            result.insert(key, json!(answers[&q.id].join(", ")));
                        }
                        input["answers"] = json!(result);
                        return Ok(json!({"behavior":"allow","updatedInput":input}));
                    }
                    return Ok(if allow {
                        json!({"behavior":"allow","updatedInput":args["input"]})
                    } else {
                        json!({"behavior":"deny","message":"User denied permission"})
                    });
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

pub(crate) fn action_view(parameters:&str)->Option<(&'static str,Value)> {
    let p:Value=serde_json::from_str(parameters).ok()?;
    Some(("tool",json!({"tool":crate::codex_protocol::native_tool_name(&p),"input":p["_meta"]["tool_params"]})))
}

pub async fn close_codebase() {
    crate::session_freshness::close().await;
}
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::Store;
    #[test]
    fn original_coordination_and_request_relay_are_callable_by_their_roles() {
        let lead = tools(false);
        let member = tools(true);
        for name in [
            "deck_task_wait",
            "deck_decision_open",
            "deck_decision_list",
            "deck_decision_revise",
            "deck_decision_resolve",
            "deck_approve",
        ] {
            assert!(
                lead.as_array().unwrap().iter().any(|t| t["name"] == name),
                "missing {name}"
            );
        }
        assert!(
            member
                .as_array()
                .unwrap()
                .iter()
                .any(|t| t["name"] == "deck_approve")
        );
        assert!(
            !member
                .as_array()
                .unwrap()
                .iter()
                .any(|t| t["name"] == "deck_delegate")
        );
    }
    // Protects usable exact handoff references through the authenticated member
    // bridge, without granting unrelated reads, mutations or Lead retrieval proof.
    #[tokio::test]
    async fn member_reads_only_assigned_sources_and_own_predecessors() {
        let (_d,app,_lead)=fixture().await;
        let (source,unrelated,worker,attempt,text)={
            let mut store=app.store.lock().unwrap();
            let mut ids=Vec::new();let text="界".repeat(10000);
            for (i,prompt) in ["Source","Unrelated","Worker"].iter().enumerate() {
                let result=crate::session_tasks::tool(&mut store,"coordination-root","deck_delegate",&json!({"agent":"apply-deep","task":prompt}),&format!("read-source-{i}")).unwrap();
                let id=result["taskId"].as_str().unwrap().to_string();let mut t=store.task(&id).unwrap();
                t.attempts[0].phase=Phase::Completed;t.attempts[0].settled_ms=Some(crate::now());t.attempts[0].report=Some(deck2_shared::TaskReport {attempt:t.attempts[0].id.clone(),text:text.clone(),digest:crate::tasks::digest(text.as_bytes())});store.save_normal_task(&t).unwrap();ids.push(id);
            }
            crate::session_tasks::tool(&mut store,"coordination-root","deck_delegate",&json!({"agent":"apply-deep","continueTaskId":ids[2],"task":"Review assigned source","sourceTasks":[{"taskId":ids[0],"attempt":1}]}),"read-worker-next").unwrap();
            let t=store.task(&ids[2]).unwrap();(ids[0].clone(),ids[1].clone(),ids[2].clone(),t.attempts[1].id.clone(),text)
        };
        let member=Bridge::start_member(&app,&worker,&attempt).await.unwrap();
        let calls:i64=app.store.lock().unwrap().conn.query_row("SELECT COUNT(*) FROM task_calls",[],|r|r.get(0)).unwrap();
        for id in [&source,&worker] {
            let response=call(member.config.clone(),"deck_task_result",json!({"taskId":id,"attempt":1})).await;
            assert_eq!(response["result"]["isError"],false,"assigned report unavailable: {response}");
            let report:Value=serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();assert_eq!(report["result"]["text"],text);assert_eq!(report["attempt"],1);
        }
        for args in [json!({"taskId":unrelated,"attempt":1}),json!({"taskId":source}),json!({"taskId":source,"attempt":2}),json!({"taskId":worker,"attempt":2})] {
            let response=call(member.config.clone(),"deck_task_result",args).await;assert!(response.get("error").is_some() || response["result"]["isError"]==true,"{response}");
        }
        let denied=call(member.config.clone(),"deck_task_cancel",json!({"taskId":worker,"attempt":2})).await;assert!(denied.get("error").is_some());
        assert_eq!(app.store.lock().unwrap().conn.query_row("SELECT COUNT(*) FROM task_calls",[],|r|r.get::<_,i64>(0)).unwrap(),calls,"member read cannot create Lead retrieval receipts");
        app.store.lock().unwrap().revoke_session_grants("coordination-session").unwrap();
        let revoked=call(member.config.clone(),"deck_task_result",json!({"taskId":source,"attempt":1})).await;assert!(revoked.get("error").is_some());
    }

    pub(crate) async fn fixture() -> (tempfile::TempDir, App, Bridge) {
        let d=tempfile::tempdir().unwrap();
        let mut store = Store::open_memory(d.path().to_str().unwrap()).unwrap();
        store.register_codex("a".repeat(64)).unwrap();
        let c=serde_json::from_value(json!({"api":deck2_shared::API,"id":"coordination-session","title":"Session","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"},"apply-deep":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
        store.create_session(&c).unwrap();
        let c=serde_json::from_value(json!({"api":deck2_shared::API,"id":"coordination-root","session":"coordination-session","mode":"session_v1","prompt":"Coordinate fixture"})).unwrap();
        let mut r = store.admit(&c).unwrap();
        r.phase = Phase::Running;
        r.thread = Some("thread".into());
        r.turn = Some("turn".into());
        r.dispatch_ms = Some(crate::now());
        store.save(&mut r).unwrap();
        let app = App::new(
            store,
            "127.0.0.1:32123".into(),
            "/missing".into(),
            None,
            "admin".into(),
            "recover".into(),
        );
        let b = Bridge::start(&app, "coordination-root").await.unwrap();
        (d, app, b)
    }
    async fn call(config: Value, name: &str, args: Value) -> Value {
        reqwest::Client::new().post(config["url"].as_str().unwrap()).header("authorization",config["http_headers"]["Authorization"].as_str().unwrap()).json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":args}})).send().await.unwrap().json().await.unwrap()
    }
    // Protects live host identity, configured membership and exact policy scope.
    // Oracle: intrinsic coordination has no grant prerequisite; revoked/foreign
    // authority and member delegation cannot qualify; protected relays still wait.
    #[tokio::test]
    async fn intrinsic_coordination_keeps_host_and_member_boundaries() {
        let (_dir,app,bridge)=fixture().await;
        assert!(bridge.coordination_permitted("deck_delegate",&json!({"agent":"apply-deep","task":"First"})));
        for (name,args) in [
            ("deck_delegate",json!({"agent":"lead"})),
            ("deck_delegate",json!({"agent":"quality"})),
            ("deck_delegate",json!({"agent":"spoof"})),
            ("deck_exec",json!({})), ("deck_decision_resolve",json!({})),
            ("send_message",json!({})),
        ] { assert!(!bridge.coordination_permitted(name,&args),"{name}: {args}"); }
        for name in ["deck_task_list","deck_task_result","deck_task_integrate","deck_task_wait","deck_task_cancel","deck_session_history","deck_approve"] {
            assert!(bridge.coordination_permitted(name,&json!({})),"{name}");
        }
        let task={
            let mut store=app.store.lock().unwrap();
            crate::session_tasks::tool(&mut store,"coordination-root","deck_delegate",&json!({"agent":"apply-deep","task":"Report"}),"intrinsic-task").unwrap()["taskId"].as_str().unwrap().to_string()
        };
        let attempt=app.store.lock().unwrap().task(&task).unwrap().attempts[0].id.clone();
        let member=Bridge::start_member(&app,&task,&attempt).await.unwrap();
        assert!(!member.coordination_permitted("deck_delegate",&json!({"agent":"apply-deep"})));
        let denied=call(member.config.clone(),"deck_delegate",json!({"agent":"apply-deep","task":"Bypass"})).await;
        assert!(denied.get("error").is_some());
        // Relay invocation itself is intrinsic; its requested effect is not.
        let pending_effect=tokio::spawn(call(member.config.clone(),"deck_approve",json!({"tool_name":"command","input":{"command":"touch protected"}})));
        // The relay requires a running member with native correlation.
        // The unstarted member has no such authority and must fail closed.
        assert!(pending_effect.await.unwrap()["result"]["isError"]==true);
        let request=tokio::spawn(call(bridge.config.clone(),"deck_approve",json!({"tool_name":"command","input":{"command":"touch protected"}})));
        let d=pending(&app).await;
        assert_eq!(d.state,deck2_shared::DecisionState::Pending);
        assert_eq!(d.native.as_ref().unwrap().method,"deck/approve");
        let bad=deck2_shared::Resolve {api:deck2_shared::API,command_id:"wrong-revision".into(),expected_revision:d.revision+1,response:deck2_shared::DecisionResponse::AllowOnce};
        assert!(app.store.lock().unwrap().resolve(&d.id,&bad).is_err());
        app.store.lock().unwrap().revoke_session_grants("coordination-session").unwrap();
        assert!(!bridge.coordination_permitted("deck_task_list",&json!({})));
        assert!(!member.coordination_permitted("deck_task_result",&json!({"taskId":task,"attempt":1})));
        let denied=call(bridge.config.clone(),"deck_task_list",json!({})).await;
        assert!(denied.get("error").is_some());
        let result=request.await.unwrap();
        let body:Value=serde_json::from_str(result["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(body["behavior"],"deny");
    }

    // Protects report treatment as a ledger-only, idempotent operation. Oracle:
    // exact retrieved evidence required; one treatment on exact replay; no consent
    // records, filesystem merge or command execution implied by adoption.
    #[tokio::test]
    async fn intrinsic_result_recording_preserves_exact_once_report_contract() {
        let (_dir,app,bridge)=fixture().await;
        let (task,attempt)={
            let mut store=app.store.lock().unwrap();
            let args=json!({"agent":"apply-deep","task":"Report"});
            let value=crate::session_tasks::tool(&mut store,"coordination-root","deck_delegate",&args,"same-invocation").unwrap();
            let retry=crate::session_tasks::tool(&mut store,"coordination-root","deck_delegate",&args,"same-invocation").unwrap();assert_eq!(value,retry);
            assert!(crate::session_tasks::tool(&mut store,"coordination-root","deck_delegate",&json!({"agent":"apply-deep","task":"Changed"}),"same-invocation").is_err());
            let id=value["taskId"].as_str().unwrap().to_string();let mut t=store.task(&id).unwrap();
            let a=&mut t.attempts[0];a.phase=Phase::Completed;a.settled_ms=Some(crate::now());
            a.report=Some(deck2_shared::TaskReport{attempt:a.id.clone(),text:"Exact report".into(),digest:crate::tasks::digest(b"Exact report")});
            store.save_normal_task(&t).unwrap();(id,1)
        };
        let report=call(bridge.config.clone(),"deck_task_result",json!({"taskId":task,"attempt":attempt})).await;
        assert_eq!(report["result"]["isError"],false,"{report}");
        let report:Value=serde_json::from_str(report["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        let args=json!({"taskId":task,"attempt":attempt,"commandId":"intrinsic-integrate","state":"integrated","note":"Reviewed exact evidence","evidenceSeqs":report["evidenceSeqs"]});
        for _ in 0..2 {let r=call(bridge.config.clone(),"deck_task_integrate",args.clone()).await;assert_eq!(r["result"]["isError"],false,"{r}");}
        let store=app.store.lock().unwrap();assert_eq!(store.task(&task).unwrap().attempts[0].treatments.len(),1);
        assert!(store.get("coordination-root").unwrap().unwrap().decisions.is_empty());
    }
    // protects: authenticated attempt delivery and revocation, including ledger validation.
    // Oracle: selected resources are returned only to the live authenticated
    // attempt, with exact delivery evidence; revocation ends even read access.
    #[tokio::test]
    async fn selected_skill_delivery_is_attempt_scoped_and_revoked_live() {
        let (_dir,app,bridge)=fixture().await;
        let found=call(bridge.config.clone(),"deck_skill_search",json!({"query":"verification","limit":2})).await;
        assert!(found.get("error").is_none(),"{found}");
        let loaded=call(bridge.config.clone(),"deck_skill_load",json!({"skill":"deck-verification"})).await;
        let content=loaded["result"]["content"][0]["text"].as_str().unwrap();
        let value:Value=serde_json::from_str(content).unwrap();
        assert_eq!(value["sha256"],crate::tasks::digest(value["content"].as_str().unwrap().as_bytes()));
        let count:i64=app.store.lock().unwrap().conn.query_row("SELECT COUNT(*) FROM session_events WHERE session='coordination-session' AND task='coordination-root' AND kind LIKE 'instruction:delivery:%'",[],|r|r.get(0)).unwrap();
        assert_eq!(count,1);
        assert!(crate::session_tasks::inspect_events(&app.store.lock().unwrap().conn).is_ok(),"Delivered resource provenance must survive event-ledger validation on reopen");
        {
            let store=app.store.lock().unwrap();
            let body:String=store.conn.query_row("SELECT body FROM session_events WHERE kind LIKE 'instruction:delivery:%'",[],|r|r.get(0)).unwrap();
            store.conn.execute("UPDATE session_events SET body='{}' WHERE kind LIKE 'instruction:delivery:%'",[]).unwrap();
            assert!(crate::session_tasks::inspect_events(&store.conn).is_err(),"Unknown/corrupt delivery cannot become accepted history");
            store.conn.execute("UPDATE session_events SET body=?1 WHERE kind LIKE 'instruction:delivery:%'",[body]).unwrap();
        }
        let invalid=call(bridge.config.clone(),"deck_skill_load",json!({"skill":"deck-verification","resource":"../config.toml"})).await;
        assert!(invalid["result"]["isError"]==true || invalid.get("error").is_some());
        app.store.lock().unwrap().revoke_session_grants("coordination-session").unwrap();
        let after=call(bridge.config.clone(),"deck_skill_load",json!({"skill":"deck-verification"})).await;
        assert!(after.get("error").is_some(),"{after}");
    }
    // protects: Q91-02 distinct same-content resources retain exact attempt
    // provenance across reopen; historical delivery keys remain readable.
    // Oracle: resource identity includes its exact path, independently of bytes.
    #[tokio::test]
    async fn same_content_resource_deliveries_survive_reopen_with_legacy_ledger() {
        let (dir,app,bridge)=fixture().await;
        let paths=["examples/event-stream.dataflow.json","test/fixtures/v1-baseline/event-stream.dataflow.json"];
        let mut values=Vec::new();
        for resource in paths {
            let response=call(bridge.config.clone(),"deck_skill_load",json!({"skill":"archify","resource":resource})).await;
            let value:Value=serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
            assert_eq!(value["resource"],resource);
            values.push(value);
        }
        assert_eq!(values[0]["sha256"],values[1]["sha256"],"real packaged resources share bytes");
        // Seed a genuine pre-correction record, retaining its body and key.
        let historical=crate::session_skills::call("deck_skill_load",&json!({"skill":"deck-verification"})).unwrap();
        let legacy_kind=format!("instruction:delivery:deck-verification:{}",historical["sha256"].as_str().unwrap());
        let legacy_body=json!({"skill":historical["skill"],"resource":historical["resource"],"source":historical["source"],"sha256":historical["sha256"],"bytes":historical["bytes"],"version":historical["version"],"delivery":"live scoped tool result; compliance unproven"}).to_string();
        let db=dir.path().join("reopen.sqlite");
        {
            let attempt=app.receipt("coordination-root").unwrap().attempt;
            let store=app.store.lock().unwrap();
            store.conn.execute("INSERT INTO session_events(session,task,attempt,kind,body) VALUES(?1,?2,?3,?4,?5)",rusqlite::params!["coordination-session","coordination-root",attempt,legacy_kind,legacy_body]).unwrap();
        }
        // Repeating either exact resource must remain idempotent.
        for resource in paths {
            let r=call(bridge.config.clone(),"deck_skill_load",json!({"skill":"archify","resource":resource})).await;
            assert!(r.get("error").is_none());
        }
        app.store.lock().unwrap().conn.backup("main",&db,None).unwrap();
        drop(bridge);drop(app);
        let store=Store::open(&db,dir.path().to_str().unwrap()).unwrap();
        let mut query=store.conn.prepare("SELECT body FROM session_events WHERE kind LIKE 'instruction:delivery:%' AND json_extract(body,'$.skill')='archify' ORDER BY json_extract(body,'$.resource')").unwrap();
        let recorded=query.query_map([],|r|r.get::<_,String>(0)).unwrap().map(|r|serde_json::from_str::<Value>(&r.unwrap()).unwrap()).collect::<Vec<_>>();
        assert_eq!(recorded.len(),2,"distinct resource paths must not collapse");
        for (record,resource) in recorded.iter().zip(paths) {assert_eq!(record["resource"],resource);assert_eq!(record["sha256"],values[0]["sha256"]);}
        assert_eq!(store.conn.query_row("SELECT body FROM session_events WHERE kind=?1",[legacy_kind],|r|r.get::<_,String>(0)).unwrap(),legacy_body);
    }
    async fn pending(app: &App) -> deck2_shared::Decision {
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if let Some(d) = app
                    .receipt("coordination-root")
                    .unwrap()
                    .decisions
                    .into_iter()
                    .find(|d| d.state == deck2_shared::DecisionState::Pending)
                {
                    return d;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap()
    }
    // The retained transport supplies provenance, never grants. The ordinary
    // per-attempt bridge must still cancel pending approvals on grant revocation.
    #[tokio::test]
    async fn retained_transport_preserves_live_revocation_and_approval_cancellation() {
        let (_dir, app, bridge) = fixture().await;
        let transport = crate::native::transport::Transport::start().await.unwrap();
        transport.bind(&bridge.config);
        transport.arm("thread");
        transport.observe(&json!({"method":"turn/started","params":{"threadId":"thread","turn":{"id":"turn"}}}));
        transport.confirm("thread","turn");
        let send = |call: &str, name: &str, args: Value| {
            transport.observe(&json!({"method":"item/started","params":{"threadId":"thread","turnId":"turn","item":{"type":"mcpToolCall","id":call,"server":"deck-session","tool":name,"arguments":args}}}));
            reqwest::Client::new().post(transport.config["url"].as_str().unwrap())
                .header("authorization",transport.config["http_headers"]["Authorization"].as_str().unwrap())
                .json(&json!({"jsonrpc":"2.0","id":call,"method":"tools/call","params":{"name":name,"arguments":args,"_meta":{"threadId":"thread","sessionId":"thread","callId":call,"x-codex-turn-metadata":{"thread_id":"thread","session_id":"thread","turn_id":"turn"}}}}))
                .send()
        };
        let initial = send("history", "deck_task_list", json!({})).await.unwrap();
        assert!(initial.status().is_success());
        assert_ne!(initial.json::<Value>().await.unwrap()["result"]["isError"], true);
        let approval = send("approval", "deck_approve", json!({"tool_name":"fixture","input":{}}));
        tokio::pin!(approval);
        let decision = tokio::select! {
            d = pending(&app) => d,
            _ = &mut approval => panic!("approval completed before a user decision"),
        };
        app.store.lock().unwrap().revoke_session_grants("coordination-session").unwrap();
        let response = approval.await.unwrap().json::<Value>().await.unwrap();
        let answer = response["result"]["content"][0]["text"].as_str().unwrap();
        assert_eq!(serde_json::from_str::<Value>(answer).unwrap()["behavior"], "deny");
        assert_ne!(app.receipt("coordination-root").unwrap().decisions.iter().find(|d|d.id==decision.id).unwrap().state, deck2_shared::DecisionState::Delivered);
        assert_eq!(send("late", "deck_task_list", json!({})).await.unwrap().status(), StatusCode::FORBIDDEN);
        transport.deactivate();
    }
    #[tokio::test]
    async fn waiting_releases_store_and_retrieves_exact_report_without_self_authority() {
        let (_dir, app, bridge) = fixture().await;
        let task = crate::session_tasks::tool(
            &mut app.store.lock().unwrap(),
            "coordination-root",
            "deck_delegate",
            &json!({"agent":"apply-deep","task":"Fixture report"}),
            "wait-delegate",
        )
        .unwrap()["taskId"]
            .as_str()
            .unwrap()
            .to_string();
        let wait_config = bridge.config.clone();
        let id = task.clone();
        let waiting = tokio::spawn(async move {
            call(
                wait_config,
                "deck_task_wait",
                json!({"taskIds":[id],"timeoutSec":1}),
            )
            .await
        });
        tokio::task::yield_now().await;
        {
            let store = app.store.lock().unwrap();
            let mut task = store.task(&task).unwrap();
            let a = &mut task.attempts[0];
            a.phase = Phase::Completed;
            a.report = Some(deck2_shared::TaskReport {
                attempt: a.id.clone(),
                digest: crate::tasks::digest(b"Report"),
                text: "Report".into(),
            });
            store.save_normal_task(&task).unwrap();
        }
        let result = waiting.await.unwrap();
        assert_eq!(result["result"]["isError"], false);
        let report: Value =
            serde_json::from_str(result["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(report["tasks"][0]["result"]["text"], "Report");
        assert_eq!(
            call(
                bridge.config.clone(),
                "deck_task_wait",
                json!({"taskIds":["unknown"],"timeoutSec":0})
            )
            .await["result"]["isError"],
            true
        );
        let approval = tokio::spawn(call(
            bridge.config.clone(),
            "deck_approve",
            json!({"tool_name":"fixture","input":{"path":"one"}}),
        ));
        let d = pending(&app).await;
        let response = deck2_shared::Resolve {
            api: deck2_shared::API,
            command_id: "wrong-revision".into(),
            expected_revision: d.revision + 1,
            response: deck2_shared::DecisionResponse::AllowOnce,
        };
        assert!(app.store.lock().unwrap().resolve(&d.id, &response).is_err());
        app.store
            .lock()
            .unwrap()
            .revoke_session_grants("coordination-session")
            .unwrap();
        let denied = approval.await.unwrap();
        let denied: Value =
            serde_json::from_str(denied["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(denied["behavior"], "deny");
        assert!(!app.receipt("coordination-root").unwrap().decisions[0].grant_consumed);
    }
    #[tokio::test]
    async fn question_relay_answers_never_grant_permissions_and_preserve_duplicate_prompts() {
        let (_dir, app, bridge) = fixture().await;
        let question = |text: &str, multiple: bool| json!({"question":text,"header":"Scope","options":[{"label":"A"},{"label":"B"}],"multiSelect":multiple});
        let approval = tokio::spawn(call(
            bridge.config.clone(),
            "deck_approve",
            json!({"tool_name":"AskUserQuestion","input":{"questions":[question("Scope?",true),question("Scope?",false),question("Scope? (2)",false)]}}),
        ));
        let d = pending(&app).await;
        let mut response = deck2_shared::Resolve {
            api: deck2_shared::API,
            command_id: "question-response".into(),
            expected_revision: d.revision,
            response: deck2_shared::DecisionResponse::AllowOnce,
        };
        assert!(app.store.lock().unwrap().resolve(&d.id, &response).is_err());
        response.response =
            deck2_shared::DecisionResponse::Answers(std::collections::BTreeMap::from([
                ("q1".into(), vec!["A".into(), "B".into()]),
                ("q2".into(), vec!["Other".into()]),
                ("q3".into(), vec!["A".into()]),
            ]));
        app.store.lock().unwrap().resolve(&d.id, &response).unwrap();
        let value = approval.await.unwrap();
        assert_eq!(value["result"]["isError"], false);
        let value: Value =
            serde_json::from_str(value["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(value["behavior"], "allow");
        assert_eq!(value["updatedInput"]["answers"]["Scope?"], "A, B");
        assert_eq!(value["updatedInput"]["answers"]["Scope? (3)"], "Other");
        assert_eq!(value["updatedInput"]["answers"]["Scope? (2)"], "A");
        assert!(!app.receipt("coordination-root").unwrap().decisions[0].grant_consumed);
    }
    // A wall-clock rollback must not resurrect an already delivered session
    // grant. Exercise the real relay, then model its persisted delivery time
    // being ahead of the clock used for revocation.
    #[tokio::test]
    async fn revocation_does_not_reuse_grants_delivered_before_clock_rollback() {
        let (_dir, app, bridge) = fixture().await;
        let approval = tokio::spawn(call(
            bridge.config.clone(), "deck_approve",
            json!({"tool_name":"fixture","input":{"path":"one"}}),
        ));
        let d = pending(&app).await;
        {
            let mut store = app.store.lock().unwrap();
            store.resolve(&d.id, &deck2_shared::Resolve {
                api: deck2_shared::API, command_id: "grant-before-rollback".into(),
                expected_revision: d.revision, response: deck2_shared::DecisionResponse::AllowSession,
            }).unwrap();
        }
        let response=approval.await.unwrap();
        let response:Value=serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(response["behavior"],"allow");
        let mut store=app.store.lock().unwrap();
        let mut receipt=store.get("coordination-root").unwrap().unwrap();
        receipt.decisions[0].delivered_ms=Some(crate::now()+60_000);
        let decision=receipt.decisions[0].clone();
        store.save(&mut receipt).unwrap();
        assert!(store.session_grant(&decision).unwrap(),"initial session grant was not established");
        store.revoke_session_grants("coordination-session").unwrap();
        assert!(!store.session_grant(&decision).unwrap(),"revocation reused a grant whose delivery timestamp is ahead of wall time");
        let input=serde_json::from_value(json!({"api":deck2_shared::API,"id":"grant-after-rollback","session":"coordination-session","prompt":"Explicit next input","mode":"session_v1","queue":true})).unwrap();
        store.admit(&input).unwrap();
        let mut next=decision.clone();next.command="grant-after-rollback".into();
        assert!(!store.session_grant(&next).unwrap(),"freshly admitted authority reused a grant from before revocation");
    }
    #[tokio::test]
    async fn relay_response_is_bound_to_request_turn_and_revoked_credentials() {
        let (_dir, app, bridge) = fixture().await;
        let approval = tokio::spawn(call(
            bridge.config.clone(),
            "deck_approve",
            json!({"tool_name":"fixture","input":{"path":"one"}}),
        ));
        let d = pending(&app).await;
        let response = deck2_shared::Resolve {
            api: deck2_shared::API,
            command_id: "correct-response".into(),
            expected_revision: d.revision,
            response: deck2_shared::DecisionResponse::AllowOnce,
        };
        {
            let mut store = app.store.lock().unwrap();
            store.resolve(&d.id, &response).unwrap();
            let mut r = store.get("coordination-root").unwrap().unwrap();
            r.turn = Some("changed-turn".into());
            store.save(&mut r).unwrap();
        }
        assert_eq!(approval.await.unwrap()["result"]["isError"], true);
        app.change("coordination-root", |r| r.cancel_requested = true)
            .unwrap();
        let response = reqwest::Client::new()
            .post(bridge.config["url"].as_str().unwrap())
            .header(
                "authorization",
                bridge.config["http_headers"]["Authorization"]
                    .as_str()
                    .unwrap(),
            )
            .json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
    #[tokio::test]
    async fn credentials_are_attempt_scoped_and_revoked_at_settlement() {
        let d=tempfile::tempdir().unwrap();
        let app = App::new(
            Store::open_memory(d.path().to_str().unwrap()).unwrap(),
            "127.0.0.1:32123".into(),
            "/missing".into(),
            None,
            "admin".into(),
            "recover".into(),
        );
        let c=serde_json::from_value(json!({"api":deck2_shared::API,"id":"session-mcp-test","title":"Session","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
        app.store.lock().unwrap().create_session(&c).unwrap();
        let submit=serde_json::from_value(json!({"api":deck2_shared::API,"id":"command-mcp-test","session":"session-mcp-test","mode":"session_v1","prompt":"Inspect"})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let one = Bridge::start(&app, "command-mcp-test").await.unwrap();

        let client = reqwest::Client::new();
        let call = |spec: &Value, token: String, name: &str| {
            client
                .post(spec["url"].as_str().unwrap())
                .header("authorization", token)
                .json(&json!({"jsonrpc":"2.0","id":1,"method":name}))
                .send()
        };
        let token = one.config["http_headers"]["Authorization"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            call(&one.config, token.clone(), "tools/list")
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        let two = Bridge::start(&app, "command-mcp-test").await.unwrap();
        assert_eq!(
            call(&one.config, token.clone(), "tools/list")
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(&two.config, token.clone(), "tools/list")
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let mut codebase = two.config.clone();
        codebase["url"] = json!(
            codebase["url"]
                .as_str()
                .unwrap()
                .replace("/mcp", "/codebase")
        );
        assert_eq!(
            call(&codebase, token.clone(), "tools/list")
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let current = two.config["http_headers"]["Authorization"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            call(&codebase, current.clone(), "tools/list")
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        app.change("command-mcp-test", |r| r.phase = Phase::Completed)
            .unwrap();
        assert_eq!(
            call(&codebase, current, "tools/list")
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(&one.config, token, "tools/list")
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    // Real authenticated relay requests may overlap. Delivered explicit consent
    // releases a matching pending request, while nested material IDs remain bound.
    #[tokio::test]
    async fn general_relay_scope_reuses_delivered_consent_with_truthful_provenance() {
        let (_dir,app,bridge)=fixture().await;
        let args=json!({"tool_name":"fixture-effect","input":{"resource_id":"one","action":"read"},"tool_use_id":"first"});
        let first=tokio::spawn(call(bridge.config.clone(),"deck_approve",args.clone()));
        let d=pending(&app).await;
        let mut next=args.clone();next["tool_use_id"]=json!("second");
        let second=tokio::spawn(call(bridge.config.clone(),"deck_approve",next));
        tokio::time::timeout(std::time::Duration::from_secs(3),async {loop {
            if app.receipt("coordination-root").unwrap().decisions.len()==2 {break;}
            tokio::task::yield_now().await;
        }}).await.unwrap();
        app.store.lock().unwrap().resolve(&d.id,&deck2_shared::Resolve{api:deck2_shared::API,command_id:"relay-explicit-session".into(),expected_revision:1,response:deck2_shared::DecisionResponse::AllowSession}).unwrap();
        for running in [first,second] {
            let response=tokio::time::timeout(std::time::Duration::from_secs(3),running).await.unwrap().unwrap();
            let body:Value=serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();assert_eq!(body["behavior"],"allow");
        }
        let r=app.receipt("coordination-root").unwrap();
        assert_eq!(r.decisions[0].native.as_ref().unwrap().resolution_provenance,Some(deck2_shared::PermissionProvenance::User));
        assert_eq!(r.decisions[1].native.as_ref().unwrap().resolution_provenance,Some(deck2_shared::PermissionProvenance::ReusedGrant{source_decision:d.id}));
        let mut changed=args;changed["input"]["resource_id"]=json!("two");
        let third=tokio::spawn(call(bridge.config.clone(),"deck_approve",changed));
        let pending=pending(&app).await;
        app.store.lock().unwrap().resolve(&pending.id,&deck2_shared::Resolve{api:deck2_shared::API,command_id:"relay-changed-resource-denied".into(),expected_revision:1,response:deck2_shared::DecisionResponse::Deny}).unwrap();
        let response=third.await.unwrap();let body:Value=serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();assert_eq!(body["behavior"],"deny");
    }

}
