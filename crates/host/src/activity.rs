//! Bounded public native step projection. It carries no execution authority.
use crate::{
    Store,
    server::{App, problem},
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use deck2_shared::Phase;
use rusqlite::{OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashMap, io::Write, sync::atomic::Ordering};

const EXECUTED_STEP: &str = "json_extract(body, '$.kind') <> 'reasoning'";

impl App {
    /// Record display evidence after the caller's native ownership checks.
    pub(crate) fn record_activity(
        &self,
        command: &str,
        task: &str,
        attempt: &str,
        thread: &str,
        turn: &str,
        event: &Value,
    ) {
        let failed = self.store.lock().map_or(true, |store| {
            store
                .observe_activity(command, task, attempt, thread, turn, event)
                .is_err()
        });
        if failed
            && !self
                .activity_recording_warning
                .swap(true, Ordering::Relaxed)
        {
            // Log at most once per host and never include runner or store payloads.
            let _ = writeln!(std::io::stderr(), "Activity projection skipped a step");
        }
    }
}

impl Store {
    pub(crate) fn init_activity(&self) -> Result<(), String> {
        // Additive, disposable projection: older schema-18 stores have no steps.
        // Existing receipts, tasks, ledgers and admission snapshots are untouched.
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS activity_steps(seq INTEGER PRIMARY KEY AUTOINCREMENT,session TEXT NOT NULL,command TEXT NOT NULL,task TEXT NOT NULL,attempt TEXT NOT NULL,item TEXT NOT NULL,body TEXT NOT NULL,output TEXT NOT NULL,UNIQUE(session,command,task,attempt,item)); CREATE INDEX IF NOT EXISTS activity_session_seq ON activity_steps(session,seq);").map_err(|_|"Cannot initialize activity projection".to_string())?;
        // Index persisted steps as-is, including sessions recorded by earlier builds.
        self.conn
            .execute_batch(&format!(
                "CREATE INDEX IF NOT EXISTS activity_execution_seq ON activity_steps(session,seq) WHERE {EXECUTED_STEP};"
            ))
            .map_err(|_| "Cannot index tool activity".into())
    }
    pub(crate) fn observe_activity(
        &self,
        command: &str,
        task: &str,
        attempt: &str,
        thread: &str,
        turn: &str,
        event: &Value,
    ) -> Result<(), String> {
        let p = &event["params"];
        let item = &p["item"];
        if event.get("id").is_some()
            || p["threadId"] != thread
            || p["turnId"] != turn
            || thread.is_empty()
            || turn.is_empty()
        {
            return Ok(());
        }
        let completed = match event["method"].as_str() {
            Some("item/started") => false,
            Some("item/completed") => true,
            _ => return Ok(()),
        };
        let kind = item["type"].as_str().unwrap_or("");
        if ![
            "commandExecution",
            "mcpToolCall",
            "fileChange",
            "reasoning",
            "dynamicToolCall",
            "webSearch",
        ]
        .contains(&kind)
        {
            return Ok(());
        }
        let Some(id) = item["id"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control))
        else {
            return Ok(());
        };
        let r = self.get(command)?.ok_or("Activity receipt unavailable")?;
        let (owner, runner) = if task.is_empty() {
            if r.attempt != attempt
                || r.thread.as_deref() != Some(thread)
                || r.turn.as_deref() != Some(turn)
            {
                return Err("Activity receipt identity mismatch".into());
            }
            ("lead".to_string(), r.runner.clone())
        } else {
            let t = self.task(task)?;
            let a = t
                .attempts
                .iter()
                .find(|a| a.id == attempt)
                .ok_or("Activity attempt unavailable")?;
            if t.session != r.session
                || t.authority_root(a) != command
                || a.authority
                    .as_ref()
                    .is_some_and(|owner| owner.attempt != r.attempt)
                || a.native_session.as_deref() != Some(thread)
                || a.native_message.as_deref() != Some(turn)
            {
                return Err("Activity task identity mismatch".into());
            }
            (t.owner, a.provenance.runner.clone())
        };
        let old:Option<String>=self.conn.query_row("SELECT body FROM activity_steps WHERE session=?1 AND command=?2 AND task=?3 AND attempt=?4 AND item=?5",params![r.session,command,task,attempt,id],|row|row.get(0)).optional().map_err(|_|"Cannot read activity step")?;
        let old: Option<Value> = old
            .map(|s| serde_json::from_str(&s))
            .transpose()
            .map_err(|_| "Invalid activity step")?;
        // Duplicate starts/completions cannot reset timing or revive settled work.
        if old.as_ref().is_some_and(|v| v["status"] != "running") || !completed && old.is_some() {
            return Ok(());
        }
        let now = crate::now();
        let started = old
            .as_ref()
            .and_then(|v| v["startedMs"].as_u64())
            .unwrap_or(now);
        let short = |v: &Value, cap: usize| -> String {
            if let Some(s) = v.as_str() {
                s.chars().take(cap).collect()
            } else if v.is_null() {
                String::new()
            } else {
                v.to_string().chars().take(cap).collect()
            }
        };
        let args = match kind {
            "commandExecution" => short(&item["command"], 700),
            "mcpToolCall" | "dynamicToolCall" => short(&item["arguments"], 700),
            "fileChange" => short(
                &item["changes"]
                    .as_array()
                    .map(|a| a.iter().map(|v| v["path"].clone()).collect::<Vec<_>>())
                    .map(|a| json!(a))
                    .unwrap_or(Value::Null),
                700,
            ),
            "webSearch" => short(&item["query"], 700),
            _ => String::new(),
        };
        let status = if !completed {
            "running"
        } else if matches!(item["status"].as_str(), Some("cancelled" | "interrupted")) {
            "cancelled"
        } else if matches!(item["status"].as_str(), Some("failed" | "declined"))
            || !item["error"].is_null()
            || item["isError"] == true
            || item["exitCode"].as_i64().is_some_and(|c| c != 0)
        {
            "failed"
        } else {
            "done"
        };
        let duration = item["durationMs"]
            .as_u64()
            .or_else(|| completed.then_some(now.saturating_sub(started)));
        let body = json!({"command":command,"task":task,"attempt":attempt,"item":id,"kind":kind,"server":short(&item["server"],256),"tool":short(&item["tool"],128),"args":args,"owner":owner,"runner":runner,"startedMs":started,"durationMs":duration,"status":status});
        let output = if kind == "reasoning" {
            String::new()
        } else {
            ["aggregatedOutput", "result", "error", "output", "content"]
                .iter()
                .find_map(|k| {
                    item.get(*k)
                        .filter(|v| !v.is_null())
                        .map(|v| short(v, 16384))
                })
                .unwrap_or_default()
        };
        self.conn.execute("INSERT INTO activity_steps(session,command,task,attempt,item,body,output) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(session,command,task,attempt,item) DO UPDATE SET body=excluded.body,output=excluded.output",params![r.session,command,task,attempt,id,body.to_string(),output]).map_err(|_|"Cannot record activity step")?;
        Ok(())
    }
    fn activity_page(&self, session: &str, q: &Page) -> Result<Value, String> {
        self.session_by_id(session)
            .map_err(|_| "Activity session unavailable")?;
        if q.before.is_some() && q.after.is_some()
            || q.before
                .into_iter()
                .chain(q.after)
                .any(|n| n > i64::MAX as u64)
        {
            return Err("Invalid activity cursor".into());
        }
        let (cmp, order, cursor) = if let Some(n) = q.before {
            ("<", "DESC", n)
        } else if let Some(n) = q.after {
            (">", "ASC", n)
        } else {
            ("<", "DESC", i64::MAX as u64)
        };
        if cursor != i64::MAX as u64
            && !self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM activity_steps WHERE session=?1 AND seq=?2)",
                    params![session, cursor],
                    |r| r.get::<_, bool>(0),
                )
                .map_err(|_| "Cannot validate activity cursor")?
        {
            return Err("Activity cursor belongs to another session".into());
        }
        let mut receipts = HashMap::new();
        let mut tasks = HashMap::new();
        let mut project = |seq: u64, body: String| -> Result<Value, String> {
            let mut v: Value = serde_json::from_str(&body).map_err(|_| "Invalid activity data")?;
            if v["status"] == "running" {
                let id = v["command"].as_str().ok_or("Invalid activity receipt")?;
                let phase = if v["task"] == "" {
                    if !receipts.contains_key(id) {
                        let r = self.get(id)?.ok_or("Activity receipt missing")?;
                        receipts.insert(id.to_owned(), (r.attempt, r.phase));
                    }
                    let (attempt, phase) = &receipts[id];
                    (v["attempt"] == *attempt).then_some(phase)
                } else {
                    let id = v["task"].as_str().ok_or("Invalid activity task")?;
                    if !tasks.contains_key(id) {
                        tasks.insert(id.to_owned(), self.task(id)?);
                    }
                    tasks[id]
                        .attempts
                        .iter()
                        .find(|a| v["attempt"] == a.id)
                        .map(|a| &a.phase)
                };
                v["status"] = json!(match phase {
                    Some(p) if p.active() => "running",
                    Some(Phase::Completed) => "done",
                    Some(Phase::Failed) => "failed",
                    Some(Phase::Cancelled) => "cancelled",
                    _ => "uncertain",
                });
            }
            v["seq"] = json!(seq);
            Ok(v)
        };
        let load = |sql: &str, cursor: u64| -> Result<Vec<(u64, String)>, String> {
            let mut stmt = self.conn.prepare(sql).map_err(|_| "Cannot read activity")?;
            let rows = stmt
                .query_map(params![session, cursor], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|_| "Cannot read activity")?;
            rows.collect::<Result<_, _>>()
                .map_err(|_| "Cannot read steps".into())
        };
        let sql = format!(
            "SELECT seq,body FROM activity_steps WHERE session=?1 AND seq {cmp} ?2 AND {EXECUTED_STEP} ORDER BY seq {order} LIMIT 200"
        );
        let mut rows = load(&sql, cursor)?
            .into_iter()
            .map(|(s, b)| project(s, b))
            .collect::<Result<Vec<_>, _>>()?;
        if order == "DESC" {
            rows.reverse();
        }
        let first = rows.first().and_then(|v| v["seq"].as_u64()).unwrap_or(0);
        let last = rows.last().and_then(|v| v["seq"].as_u64()).unwrap_or(0);
        let exists = |cmp: &str, n: u64| {
            self.conn.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM activity_steps WHERE session=?1 AND seq {cmp} ?2 AND {EXECUTED_STEP})"),
            params![session,n], |r|r.get::<_,bool>(0),
        ).map_err(|_|"Cannot read activity boundary")
        };
        // A short-lived call can finish between polls. Keep the latest observed
        // labels available to the active chat turn even when browsing older steps.
        // Reasoning belongs to the transient chat line, including when the
        // inspector is showing a page of historical tool executions.
        let live = load(
            "SELECT seq,body FROM activity_steps WHERE session=?1 AND seq<?2 ORDER BY seq DESC LIMIT 32",
            i64::MAX as u64,
        )?
        .into_iter()
        .map(|(s, b)| project(s, b))
        .collect::<Result<Vec<_>, _>>()?;
        Ok(
            json!({"session":session,"steps":rows,"older":first>0&&exists("<",first)?,"newer":last>0&&exists(">",last)?,"live":live}),
        )
    }
}
/// Normalize only a tool part already accepted by OpenCode's exact-turn filter.
pub(crate) fn opencode_step(event: &Value, thread: &str, turn: &str) -> Option<Value> {
    if event["type"] != "message.part.updated" {
        return None;
    }
    let part = &event["properties"]["part"];
    if part["type"] != "tool" {
        return None;
    }
    let name = part["tool"].as_str()?;
    let state = &part["state"];
    let input = &state["input"];
    let complete = matches!(
        state["status"].as_str(),
        Some("completed" | "error" | "cancelled")
    );
    let mut item = json!({"id":part["callID"].as_str().or_else(||part["id"].as_str())?,"type":"dynamicToolCall","tool":name,"arguments":input,"status":if state["status"]=="error"{"failed"}else if state["status"]=="cancelled"{"cancelled"}else if complete{"completed"}else{"running"},"output":state["output"],"error":state["error"]});
    if name == "bash" {
        item["type"] = json!("commandExecution");
        item["command"] = input["command"].clone();
    } else if ["edit", "write", "apply_patch"].contains(&name) {
        item["type"] = json!("fileChange");
        item["changes"] = json!([{"path":input["filePath"]}]);
    } else {
        for server in ["deck-codebase-memory", "deck-context7", "deck-session"] {
            if let Some(tool) = name.strip_prefix(&format!("{server}_")) {
                item["type"] = json!("mcpToolCall");
                item["server"] = json!(server);
                item["tool"] = json!(tool);
                break;
            }
        }
    }
    if let (Some(start), Some(end)) = (
        state["time"]["start"].as_u64(),
        state["time"]["end"].as_u64(),
    ) {
        item["durationMs"] = json!(end.saturating_sub(start));
    }
    Some(
        json!({"method":if complete{"item/completed"}else{"item/started"},"params":{"threadId":thread,"turnId":turn,"item":item}}),
    )
}
#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub(crate) struct Page {
    before: Option<u64>,
    after: Option<u64>,
}
pub(crate) async fn page(
    State(app): State<App>,
    Path(session): Path<String>,
    Query(q): Query<Page>,
) -> Response {
    match app.store.lock().unwrap().activity_page(&session, &q) {
        Ok(v) => Json(v).into_response(),
        Err(e) => problem(StatusCode::BAD_REQUEST, "activity-unavailable", e),
    }
}
pub(crate) async fn output(
    State(app): State<App>,
    Path((session, seq)): Path<(String, u64)>,
) -> Response {
    let s = app.store.lock().unwrap();
    match s
        .conn
        .query_row(
            "SELECT output FROM activity_steps WHERE session=?1 AND seq=?2",
            params![session, seq],
            |r| r.get::<_, String>(0),
        )
        .optional()
    {
        Ok(Some(output)) => {
            Json(json!({"session":session,"seq":seq,"output":output})).into_response()
        }
        _ => problem(
            StatusCode::NOT_FOUND,
            "activity-output-unavailable",
            "Step output unavailable in this session",
        ),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Store, deck2_shared::Receipt) {
        let mut s = Store::open_memory("/fixture").unwrap();
        s.register_codex("a".repeat(64)).unwrap();
        let id = s.session.clone();
        let mut r=s.admit(&serde_json::from_value(json!({"api":deck2_shared::API,"id":"activity-command","session":id,"prompt":"Inspect the project","mode":"read_only"})).unwrap()).unwrap();
        r.phase = deck2_shared::Phase::Running;
        r.thread = Some("thread".into());
        r.turn = Some("turn".into());
        s.save(&mut r).unwrap();
        (s, r)
    }
    fn event(method: &str, id: &str) -> Value {
        json!({"method":method,"params":{"threadId":"thread","turnId":"turn","item":{"id":id,"type":"commandExecution","command":"rtk git status","status":"completed","durationMs":12,"exitCode":0,"aggregatedOutput":"output excerpt"}}})
    }
    fn record(s: &Store, r: &deck2_shared::Receipt, v: &Value) {
        s.observe_activity(&r.id, "", &r.attempt, "thread", "turn", v)
            .unwrap();
    }
    // Protects exact-owner capture, durable idempotence and lazy output; oracle: decision 20.
    #[test]
    fn activity_capture_is_scoped_idempotent_and_excludes_output_from_pages() {
        let (s, r) = fixture();
        let mut foreign = event("item/started", "one");
        foreign["params"]["turnId"] = json!("foreign");
        record(&s, &r, &foreign);
        assert!(
            s.activity_page(&r.session, &Page::default()).unwrap()["steps"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        record(&s, &r, &event("item/started", "one"));
        record(&s, &r, &event("item/completed", "one"));
        record(&s, &r, &event("item/started", "one"));
        let page = s.activity_page(&r.session, &Page::default()).unwrap();
        let steps = page["steps"].as_array().unwrap();
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0]["status"], "done");
        assert_eq!(steps[0]["durationMs"], 12);
        assert!(!page.to_string().contains("output excerpt"));
        assert_eq!(
            s.conn
                .query_row("SELECT output FROM activity_steps", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "output excerpt"
        );
        assert!(
            s.observe_activity(
                &r.id,
                "",
                "other-attempt",
                "thread",
                "turn",
                &event("item/started", "bad")
            )
            .is_err()
        );
    }
    // An OpenCode cancellation keeps its terminal status and diagnostic output.
    #[test]
    fn activity_opencode_cancelled_step_with_error_stays_cancelled() {
        let (s, r) = fixture();
        let raw = json!({"type":"message.part.updated","properties":{"part":{
            "type":"tool","tool":"bash","callID":"tool-1",
            "state":{"status":"cancelled","input":{"command":"sleep 1"},"error":"aborted"}
        }}});
        record(&s, &r, &opencode_step(&raw, "thread", "turn").unwrap());
        let page = s.activity_page(&r.session, &Page::default()).unwrap();
        assert_eq!(page["steps"][0]["status"], "cancelled");
    }
    // Protects bounded pagination and foreign-cursor refusal across large sessions.
    #[test]
    fn activity_pages_are_bounded_ordered_and_cursor_scoped() {
        let (s, r) = fixture();
        for n in 0..10000 {
            record(&s, &r, &event("item/completed", &n.to_string()));
        }
        let page = s.activity_page(&r.session, &Page::default()).unwrap();
        let rows = page["steps"].as_array().unwrap();
        assert_eq!(rows.len(), 200);
        assert_eq!(rows[0]["seq"], 9801);
        assert_eq!(page["older"], true);
        assert_eq!(page["newer"], false);
        let old = s
            .activity_page(
                &r.session,
                &Page {
                    before: Some(9801),
                    after: None,
                },
            )
            .unwrap();
        assert_eq!(old["steps"][199]["seq"], 9800);
        assert_eq!(old["newer"], true);
        assert!(s.activity_page("foreign", &Page::default()).is_err());
        assert!(
            s.activity_page(
                &r.session,
                &Page {
                    before: Some(999999),
                    after: None
                }
            )
            .is_err()
        );
    }
    // Historical reasoning can span several raw pages without blocking navigation.
    #[test]
    fn activity_pages_skip_historical_reasoning_but_live_keeps_it() {
        let (s, r) = fixture();
        record(&s, &r, &event("item/completed", "older-tool"));
        for i in 0..401 {
            let mut reasoning = event("item/started", &format!("reasoning-{i}"));
            reasoning["params"]["item"]["type"] = json!("reasoning");
            record(&s, &r, &reasoning);
        }
        record(&s, &r, &event("item/completed", "newer-tool"));
        let mut reasoning = event("item/started", "live-reasoning");
        reasoning["params"]["item"]["type"] = json!("reasoning");
        record(&s, &r, &reasoning);

        let latest = s.activity_page(&r.session, &Page::default()).unwrap();
        let items = |p: &Value| {
            p["steps"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s["item"].clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(items(&latest), [json!("older-tool"), json!("newer-tool")]);
        assert_eq!(latest["live"][0]["item"], "live-reasoning");
        assert_eq!(latest["older"], false);
        assert_eq!(latest["newer"], false);

        let older = s
            .activity_page(
                &r.session,
                &Page {
                    before: Some(403),
                    after: None,
                },
            )
            .unwrap();
        assert_eq!(items(&older), [json!("older-tool")]);
        assert_eq!(older["newer"], true);
        let newer = s
            .activity_page(
                &r.session,
                &Page {
                    before: None,
                    after: Some(1),
                },
            )
            .unwrap();
        assert_eq!(items(&newer), [json!("newer-tool")]);
        assert_eq!(newer["older"], true);
    }
    // Protects existing schema-18 data and restart recovery; no receipt shape change.
    #[test]
    fn activity_additive_upgrade_preserves_existing_receipts_and_reopens_steps() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        let (source, r) = fixture();
        let mut s = Store::open(&path, "/fixture").unwrap();
        s.register_codex("a".repeat(64)).unwrap();
        let mut saved=s.admit(&serde_json::from_value(json!({"api":deck2_shared::API,"id":r.id,"session":s.session,"prompt":r.prompt,"mode":"read_only"})).unwrap()).unwrap();
        saved.thread = r.thread.clone();
        saved.turn = r.turn.clone();
        s.save(&mut saved).unwrap();
        s.conn.execute_batch("DROP TABLE activity_steps").unwrap();
        drop(s);
        drop(source);
        let mut s = Store::open(&path, "/fixture").unwrap();
        let mut restored = s.get(&r.id).unwrap().unwrap();
        assert_eq!(restored.prompt, r.prompt);
        assert_eq!(restored.text, r.text);
        restored.phase = deck2_shared::Phase::Running;
        s.save(&mut restored).unwrap();
        record(&s, &restored, &event("item/completed", "persisted"));
        drop(s);
        let s = Store::open(&path, "/fixture").unwrap();
        assert_eq!(
            s.activity_page(&restored.session, &Page::default())
                .unwrap()["steps"][0]["status"],
            "done"
        );
    }
    #[test]
    fn activity_opencode_labels_come_from_accepted_native_tool_parts() {
        let raw = json!({"type":"message.part.updated","properties":{"part":{"type":"tool","callID":"call","tool":"deck-codebase-memory_search_graph","state":{"status":"completed","input":{"query":"App"},"output":"found","time":{"start":10,"end":25}}}}});
        let v = opencode_step(&raw, "thread", "turn").unwrap();
        assert_eq!(v["params"]["item"]["server"], "deck-codebase-memory");
        assert_eq!(v["params"]["item"]["tool"], "search_graph");
        assert_eq!(v["params"]["item"]["durationMs"], 15);
        assert!(opencode_step(&json!({"type":"message.part.delta"}), "thread", "turn").is_none());
    }
    #[tokio::test]
    async fn activity_default_router_enforces_auth_and_output_session() {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        let (s, r) = fixture();
        record(&s, &r, &event("item/completed", "one"));
        let app = App::new(
            s,
            "127.0.0.1:32123".into(),
            "/missing".into(),
            None,
            "admin".into(),
            "recover".into(),
        );
        for (path, auth, status) in [
            (
                format!("/api/sessions/{}/activity", r.session),
                false,
                StatusCode::FORBIDDEN,
            ),
            (
                format!("/api/sessions/{}/activity", r.session),
                true,
                StatusCode::OK,
            ),
            (
                format!("/api/sessions/{}/activity/1/output", r.session),
                true,
                StatusCode::OK,
            ),
            (
                "/api/sessions/foreign/activity/1/output".into(),
                true,
                StatusCode::NOT_FOUND,
            ),
        ] {
            let mut req = Request::builder().uri(path).header("host", &app.host);
            if auth {
                let login = crate::server::router(app.clone())
                    .oneshot(
                        Request::builder()
                            .method("POST")
                            .uri("/auth")
                            .header("host", &app.host)
                            .header("origin", format!("http://{}", app.host))
                            .body(Body::from(app.issue_launch()))
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                req = req.header(
                    "cookie",
                    login.headers()["set-cookie"]
                        .to_str()
                        .unwrap()
                        .split(';')
                        .next()
                        .unwrap(),
                );
            }
            let response = crate::server::router(app.clone())
                .oneshot(req.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), status);
        }
    }
}
