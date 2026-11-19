//! Public exact-attempt panel operations, separate from model integration authority.
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
use deck2_shared::{Phase, Task};
use rusqlite::{OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Dismiss {
    api: u32,
    command_id: String,
    expected_revision: u32,
}
impl Store {
    fn dismiss_failure(
        &self,
        session: &str,
        task: &str,
        attempt: &str,
        c: &Dismiss,
    ) -> Result<Value, String> {
        if c.api != deck2_shared::API
            || !(8..=128).contains(&c.command_id.len())
            || !c
                .command_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            return Err("Invalid API or dismissal command identity".into());
        }
        let mut t = self.task(task)?;
        if t.session != session {
            return Err("Task unavailable in this session".into());
        }
        let kind = format!("panel.dismiss:{}", c.command_id);
        let previous: Option<(String, String, String)> = self
            .conn
            .query_row(
                "SELECT task,attempt,body FROM session_events WHERE session=?1 AND kind=?2",
                params![session, kind],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|_| "Cannot read dismissal command")?;
        if let Some((old_task, old_attempt, body)) = previous {
            let v: Value = serde_json::from_str(&body).map_err(|_| "Corrupt dismissal receipt")?;
            return if old_task == task
                && old_attempt == attempt
                && v["expectedRevision"] == c.expected_revision
            {
                Ok(v["result"].clone())
            } else {
                Err("Dismissal command identity conflict".into())
            };
        }
        if t.revision != c.expected_revision {
            return Err("Task revision is stale".into());
        }
        let a = t
            .attempts
            .last()
            .filter(|a| a.id == attempt)
            .ok_or("Dismissal requires the latest exact attempt")?;
        if a.phase != Phase::Failed
            || a.settled_ms.is_none()
            || a.failure_dismissal.is_some()
            || self.all()?.iter().any(|r| {
                r.decisions.iter().any(|d| {
                    d.task.as_deref() == Some(task)
                        && d.attempt == attempt
                        && matches!(
                            d.state,
                            deck2_shared::DecisionState::Pending
                                | deck2_shared::DecisionState::Responded
                                | deck2_shared::DecisionState::Delivered
                                | deck2_shared::DecisionState::Uncertain
                        )
                })
            })
        {
            return Err(
                "Task failure is not dismissible while ownership or effects are unsettled".into(),
            );
        }
        t.revision = t.revision.checked_add(1).ok_or("Task revision exhausted")?;
        let dismissal = deck2_shared::FailureDismissal {
            command_id: c.command_id.clone(),
            at_ms: crate::now(),
            revision: t.revision,
        };
        t.attempts.last_mut().unwrap().failure_dismissal = Some(dismissal.clone());
        let result = json!({"session":session,"task":task,"attempt":attempt,"dismissal":dismissal});
        let body = json!({"expectedRevision":c.expected_revision,"result":result});
        self.conn
            .execute_batch("SAVEPOINT panel_dismiss")
            .map_err(|_| "Cannot begin dismissal")?;
        let saved = (|| {
            self.save_task(&t)?;
            self.conn.execute("INSERT INTO session_events(session,task,attempt,kind,body) VALUES (?1,?2,?3,?4,?5)",params![session,task,attempt,kind,body.to_string()]).map_err(|_|"Cannot persist dismissal receipt")?;
            self.conn
                .execute_batch("RELEASE panel_dismiss")
                .map_err(|_| "Cannot commit dismissal")?;
            Ok::<_, String>(result)
        })();
        if saved.is_err() {
            let _ = self
                .conn
                .execute_batch("ROLLBACK TO panel_dismiss; RELEASE panel_dismiss");
        }
        saved
    }
}
pub(crate) async fn dismiss(
    State(app): State<App>,
    Path((session, task, attempt)): Path<(String, String, String)>,
    Json(c): Json<Dismiss>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }
    // Same lock order as admission; a terminal phase alone does not release a worker lease.
    let active = app.active.lock().unwrap();
    if active.contains_key(&format!("child:{attempt}")) {
        return problem(
            StatusCode::CONFLICT,
            "task-not-dismissible",
            "Member cleanup is still running",
        );
    }
    match app
        .store
        .lock()
        .unwrap()
        .dismiss_failure(&session, &task, &attempt, &c)
    {
        Ok(v) => Json(v).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, "task-not-dismissible", e),
    }
}

fn public_text(a: &deck2_shared::TaskAttempt) -> &str {
    if a.text.is_empty() {
        a.report.as_ref().map(|r| r.text.as_str()).unwrap_or("")
    } else {
        &a.text
    }
}
fn guidance_exchange(
    a: &deck2_shared::TaskAttempt,
    g: &deck2_shared::MemberGuidance,
) -> Option<Value> {
    let delivery = crate::member_guidance::delivery(g.input.state)?;
    Some(json!({
        "id":format!("guidance:{}",g.input.command.id),"role":"lead","source":"lead-guidance",
        "at_ms":g.input.admitted_ms,"text":g.input.command.text,"delivery":delivery,
        "provenance":{"runner":a.provenance.runner,"integration":a.provenance.integration,"content":a.provenance.content},
    }))
}

/// Called inside the same persistence transaction as the task. No wire payload,
/// approval parameters, private reasoning or process credential enters this projection.
pub(crate) fn record(
    conn: &rusqlite::Connection,
    t: &Task,
    prior: Option<&Task>,
) -> Result<(), String> {
    for a in &t.attempts {
        if a.configuration
            .as_ref()
            .and_then(|s| s.session_contract.as_ref())
            .is_none()
        {
            continue;
        }
        let old = prior.and_then(|t| t.attempts.iter().find(|old| old.id == a.id));
        let append = |source: &str, role: &str, text: &str, offset: usize| -> Result<(), String> {
            let mut start = 0;
            while start < text.len() {
                let mut end = (start + 16384).min(text.len());
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                let id = uuid::Uuid::new_v4().to_string();
                let body = json!({"id":id,"role":role,"source":source,"at_ms":crate::now(),"text":&text[start..end],"offset":offset+start,"provenance":{"runner":a.provenance.runner,"integration":a.provenance.integration,"content":a.provenance.content}});
                conn.execute("INSERT INTO session_events(session,task,attempt,kind,body) VALUES (?1,?2,?3,?4,?5)",params![t.session,t.id,a.id,format!("public:{id}"),body.to_string()]).map_err(|_|"Cannot persist public exchange")?;
                start = end;
            }
            Ok(())
        };
        if old.is_none() {
            append("lead-delegation", "lead", &a.prompt, 0)?;
        }
        for guidance in &a.guidance {
            let recorded = old.is_some_and(|prior| prior.guidance.iter().any(|old|
                old.input.command.id == guidance.input.command.id
                    && crate::member_guidance::delivery(old.input.state).is_some()));
            if !recorded && let Some(body) = guidance_exchange(a, guidance) {
                conn.execute(
                    "INSERT INTO session_events(session,task,attempt,kind,body) VALUES (?1,?2,?3,?4,?5)",
                    params![t.session,t.id,a.id,format!("public:guidance:{}",guidance.input.command.id),body.to_string()],
                ).map_err(|_| "Cannot persist public guidance")?;
            }
        }
        let text = public_text(a);
        let previous = old.map(public_text).unwrap_or("");
        if text != previous {
            let delta = text
                .strip_prefix(previous)
                .ok_or("Public member text cannot rewrite recorded exchange history")?;
            append("member-output", &t.owner, delta, previous.len())?;
        }
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Page {
    #[serde(default)]
    cursor: u64,
    #[serde(default = "page_limit")]
    limit: usize,
}
fn page_limit() -> usize {
    32
}
pub(crate) async fn exchanges(
    State(app): State<App>,
    Path((session, task, attempt)): Path<(String, String, String)>,
    Query(q): Query<Page>,
) -> Response {
    let store = app.store.lock().unwrap();
    let t = match store.task(&task) {
        Ok(t) if t.session == session => t,
        _ => {
            return problem(
                StatusCode::NOT_FOUND,
                "exchanges-unavailable",
                "Task unavailable in this session",
            );
        }
    };
    let Some(a) = t.attempts.iter().find(|a| a.id == attempt) else {
        return problem(
            StatusCode::NOT_FOUND,
            "exchanges-unavailable",
            "Attempt unavailable",
        );
    };
    let read = (|| -> Result<Value, String> {
        if !(1..=32).contains(&q.limit) || q.cursor > i64::MAX as u64 {
            return Err("Invalid exchange cursor or page limit".into());
        }
        if q.cursor>0 && !store.conn.query_row("SELECT EXISTS(SELECT 1 FROM session_events WHERE seq=?1 AND session=?2 AND task=?3 AND attempt=?4 AND kind LIKE 'public:%')",params![q.cursor,session,task,attempt],|r|r.get::<_,bool>(0)).map_err(|_|"Cannot validate exchange cursor")? {return Err("Cursor belongs to another ledger".into());}
        let mut stmt=store.conn.prepare("SELECT seq,body FROM session_events WHERE session=?1 AND task=?2 AND attempt=?3 AND kind LIKE 'public:%' AND seq>?4 ORDER BY seq LIMIT ?5").map_err(|_|"Cannot read exchanges")?;
        let mut messages = stmt
            .query_map(
                params![session, task, attempt, q.cursor, q.limit + 1],
                |r| Ok((r.get::<_, u64>(0)?, r.get::<_, String>(1)?)),
            )
            .map_err(|_| "Cannot read exchanges")?
            .map(|r| {
                let (seq, body) = r.map_err(|_| "Cannot read exchange")?;
                let mut v: Value =
                    serde_json::from_str(&body).map_err(|_| "Corrupt public exchange")?;
                v["sequence"] = json!(seq);
                Ok::<_, String>(v)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let more = messages.len() > q.limit;
        messages.truncate(q.limit);
        let next = messages
            .last()
            .and_then(|v| v["sequence"].as_u64())
            .unwrap_or(q.cursor);
        let recorded=store.conn.query_row("SELECT EXISTS(SELECT 1 FROM session_events WHERE session=?1 AND task=?2 AND attempt=?3 AND kind LIKE 'public:%')",params![session,task,attempt],|r|r.get::<_,bool>(0)).map_err(|_|"Cannot inspect exchange availability")?;
        Ok(
            json!({"session":session,"task":task,"attempt":attempt,"messages":messages,"nextCursor":next,"more":more,"settled":!a.phase.active() && !matches!(a.phase,Phase::Queued|Phase::Uncertain) && a.settled_ms.is_some(),"recording":if recorded{"recorded"}else{"unavailable"}}),
        )
    })();
    match read {
        Ok(v) => Json(v).into_response(),
        Err(e) => problem(StatusCode::BAD_REQUEST, "exchange-cursor", e),
    }
}
/// Startup validates projection provenance against the immutable admitted attempt.
pub(crate) fn inspect(
    conn: &rusqlite::Connection,
    session: &str,
    task: &str,
    attempt: &str,
    kind: &str,
    body: &str,
) -> Result<(), String> {
    let invalid = "Invalid public panel evidence";
    let raw: String = conn
        .query_row("SELECT body FROM tasks WHERE id=?1", [task], |r| r.get(0))
        .map_err(|_| invalid)?;
    let t: Task = serde_json::from_str(&raw).map_err(|_| invalid)?;
    let a = t.attempts.iter().find(|a| a.id == attempt).ok_or(invalid)?;
    let v: Value = serde_json::from_str(body).map_err(|_| invalid)?;
    if t.session != session {
        return Err(invalid.into());
    }
    if kind.starts_with("public:") {
        let source = v["source"].as_str().ok_or(invalid)?;
        if source == "lead-guidance" {
            let valid = a.guidance.iter().any(|g| {
                kind == format!("public:guidance:{}", g.input.command.id)
                    && guidance_exchange(a, g).as_ref() == Some(&v)
            });
            return if valid { Ok(()) } else { Err(invalid.into()) };
        }
        let text = v["text"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 16384)
            .ok_or(invalid)?;
        let offset = v["offset"]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or(invalid)?;
        let (expected, role) = match source {
            "lead-delegation" => (a.prompt.as_str(), "lead"),
            "member-output" => (public_text(a), t.owner.as_str()),
            _ => return Err(invalid.into()),
        };
        if kind != format!("public:{}", v["id"].as_str().ok_or(invalid)?)
            || v["role"] != role
            || !v["at_ms"].is_u64()
            || offset
                .checked_add(text.len())
                .and_then(|end| expected.get(offset..end))
                != Some(text)
            || v["provenance"]
                != json!({"runner":a.provenance.runner,"integration":a.provenance.integration,"content":a.provenance.content})
        {
            return Err(invalid.into());
        }
    } else {
        let d = a.failure_dismissal.as_ref().ok_or(invalid)?;
        if kind != format!("panel.dismiss:{}", d.command_id)
            || v["result"] != json!({"session":session,"task":task,"attempt":attempt,"dismissal":d})
            || v["expectedRevision"]
                .as_u64()
                .and_then(|n| n.checked_add(1))
                != Some(d.revision as u64)
            || t.revision < d.revision
            || a.phase != Phase::Failed
            || a.settled_ms.is_none()
        {
            return Err(invalid.into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::{
        Store,
        server::{App, router},
    };
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use serde_json::{Value, json};
    use tower::ServiceExt;
    fn fixture() -> (App, String, String) {
        let mut s = Store::open_memory("/fixture").unwrap();
        s.register_codex("a".repeat(64)).unwrap();
        s.create_session(&serde_json::from_value(json!({"api":deck2_shared::API,"id":"panel-session","title":"Panel","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"},"investigate":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap()).unwrap();
        let mut r=s.admit(&serde_json::from_value(json!({"api":deck2_shared::API,"id":"panel-command","session":"panel-session","prompt":"Coordinate","mode":"session_v1"})).unwrap()).unwrap();
        r.phase = deck2_shared::Phase::Running;
        r.thread = Some("lead-thread".into());
        r.turn = Some("lead-turn".into());
        s.save(&mut r).unwrap();
        let v = crate::session_tasks::tool(
            &mut s,
            &r.id,
            "deck_delegate",
            &json!({"agent":"investigate","task":"Public delegation"}),
            "delegate",
        )
        .unwrap();
        let t = s.task(v["taskId"].as_str().unwrap()).unwrap();
        let task = t.id.clone();
        let attempt = t.attempts[0].id.clone();
        (
            App::new(
                s,
                "127.0.0.1:32123".into(),
                "/missing".into(),
                None,
                "admin".into(),
                "recover".into(),
            ),
            task,
            attempt,
        )
    }
    async fn call(
        app: &App,
        path: &str,
        body: Option<Value>,
        auth: bool,
        origin: bool,
    ) -> (StatusCode, Value) {
        let mut b = Request::builder()
            .method(if body.is_some() { "POST" } else { "GET" })
            .uri(path)
            .header("host", &app.host)
            .header("content-type", "application/json");
        if auth {
            let r = router(app.clone())
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
            b = b.header(
                "cookie",
                r.headers()["set-cookie"]
                    .to_str()
                    .unwrap()
                    .split(';')
                    .next()
                    .unwrap(),
            );
        }
        if origin {
            b = b.header("origin", format!("http://{}", app.host));
        }
        let r = router(app.clone())
            .oneshot(
                b.body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = r.status();
        let bytes = axum::body::to_bytes(r.into_body(), 1024 * 1024)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }
    #[tokio::test]
    async fn dismissal_is_durable_exact_idempotent_and_not_integration() {
        let (app, task, attempt) = fixture();
        {
            let s = app.store.lock().unwrap();
            let mut t = s.task(&task).unwrap();
            t.attempts[0].phase = deck2_shared::Phase::Failed;
            t.attempts[0].settled_ms = Some(crate::now());
            s.save_normal_task(&t).unwrap();
        }
        let path =
            format!("/api/sessions/panel-session/tasks/{task}/attempts/{attempt}/dismiss-failure");
        let revision = app.store.lock().unwrap().task(&task).unwrap().revision;
        let body = json!({"api":deck2_shared::API,"commandId":"dismiss-command","expectedRevision":revision});
        assert_eq!(
            call(&app, &path, Some(body.clone()), false, true).await.0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(&app, &path, Some(body.clone()), true, false).await.0,
            StatusCode::FORBIDDEN
        );
        let first = call(&app, &path, Some(body.clone()), true, true).await;
        assert_eq!(first.0, StatusCode::OK, "{first:?}");
        assert_eq!(first, call(&app, &path, Some(body), true, true).await);
        let s = app.store.lock().unwrap();
        let t = s.task(&task).unwrap();
        assert!(t.attempts[0].treatments.is_empty());
        assert_eq!(t.revision, revision + 1);
        crate::session_tasks::inspect_events(&s.conn).unwrap();
    }
    #[tokio::test]
    async fn public_exchange_cursor_is_ordered_scoped_and_contains_only_public_text() {
        let (app, task, attempt) = fixture();
        {
            let s = app.store.lock().unwrap();
            let mut t = s.task(&task).unwrap();
            t.attempts[0].text = "Public reply α".into();
            s.save_normal_task(&t).unwrap();
            t.attempts[0].text.push_str(" final");
            s.save_normal_task(&t).unwrap();
        }
        let path = format!(
            "/api/sessions/panel-session/tasks/{task}/attempts/{attempt}/exchanges?limit=1"
        );
        let first = call(&app, &path, None, true, false).await;
        assert_eq!(first.0, StatusCode::OK, "{first:?}");
        assert_eq!(first.1["messages"][0]["text"], "Public delegation");
        assert_eq!(first.1["messages"][0]["source"], "lead-delegation");
        let next = first.1["nextCursor"].as_u64().unwrap();
        let second = call(&app, &format!("{path}&cursor={next}"), None, true, false).await;
        assert_eq!(second.1["messages"][0]["text"], "Public reply α");
        assert!(second.1["messages"][0]["sequence"].as_u64().unwrap() > next);
        assert_eq!(
            call(
                &app,
                &path.replace("panel-session", "foreign-session"),
                None,
                true,
                false
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
        crate::session_tasks::inspect_events(&app.store.lock().unwrap().conn).unwrap();
    }
    #[tokio::test]
    async fn dismissal_rejects_stale_foreign_unsettled_and_rolls_back_storage_failure() {
        let (app, task, attempt) = fixture();
        let path =
            format!("/api/sessions/panel-session/tasks/{task}/attempts/{attempt}/dismiss-failure");
        let revision = app.store.lock().unwrap().task(&task).unwrap().revision;
        let body = json!({"api":deck2_shared::API,"commandId":"reject-command","expectedRevision":revision});
        assert_eq!(
            call(&app, &path, Some(body.clone()), true, true).await.0,
            StatusCode::CONFLICT
        );
        {
            let s = app.store.lock().unwrap();
            let mut t = s.task(&task).unwrap();
            t.attempts[0].phase = deck2_shared::Phase::Failed;
            t.attempts[0].settled_ms = Some(crate::now());
            s.save_normal_task(&t).unwrap();
        }
        assert_eq!(
            call(
                &app,
                &path.replace("panel-session", "foreign-session"),
                Some(body.clone()),
                true,
                true
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
        let mut stale = body.clone();
        stale["expectedRevision"] = json!(revision + 1);
        assert_eq!(
            call(&app, &path, Some(stale), true, true).await.0,
            StatusCode::CONFLICT
        );
        {
            let s = app.store.lock().unwrap();
            s.conn.execute_batch("CREATE TRIGGER reject_dismiss BEFORE INSERT ON session_events WHEN NEW.kind LIKE 'panel.dismiss:%' BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        }
        assert_eq!(
            call(&app, &path, Some(body.clone()), true, true).await.0,
            StatusCode::CONFLICT
        );
        {
            let s = app.store.lock().unwrap();
            let t = s.task(&task).unwrap();
            assert!(t.attempts[0].failure_dismissal.is_none());
            assert_eq!(t.revision, revision);
            s.conn.execute_batch("DROP TRIGGER reject_dismiss").unwrap();
        }
        assert_eq!(
            call(&app, &path, Some(body), true, true).await.0,
            StatusCode::OK
        );
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("state.db");
        app.store
            .lock()
            .unwrap()
            .conn
            .backup("main", &path, None)
            .unwrap();
        let reopened = Store::open(&path, "/fixture").unwrap();
        let t = reopened.task(&task).unwrap();
        assert!(t.attempts[0].failure_dismissal.is_some());
        assert!(t.attempts[0].treatments.is_empty());
    }
    #[tokio::test]
    async fn exchange_pages_validate_cursor_provenance_and_atomic_append() {
        let (app, task, attempt) = fixture();
        let path = format!("/api/sessions/panel-session/tasks/{task}/attempts/{attempt}/exchanges");
        assert_eq!(
            call(&app, &format!("{path}?cursor=99999"), None, true, false)
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            call(&app, &format!("{path}?limit=0"), None, true, false)
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        let s = app.store.lock().unwrap();
        let mut t = s.task(&task).unwrap();
        t.attempts[0].text = "α".repeat(20000);
        s.save_normal_task(&t).unwrap();
        crate::session_tasks::inspect_events(&s.conn).unwrap();
        let count: i64 = s
            .conn
            .query_row(
                "SELECT count(*) FROM session_events WHERE kind LIKE 'public:%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        s.conn.execute_batch("CREATE TRIGGER reject_exchange BEFORE INSERT ON session_events WHEN NEW.kind LIKE 'public:%' BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        t.attempts[0].text.push_str("later");
        assert!(s.save_normal_task(&t).is_err());
        assert!(!s.task(&task).unwrap().attempts[0].text.ends_with("later"));
        assert_eq!(
            s.conn
                .query_row(
                    "SELECT count(*) FROM session_events WHERE kind LIKE 'public:%'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            count
        );
        s.conn.execute_batch("DROP TRIGGER reject_exchange; UPDATE session_events SET body=json_set(body,'$.text','forged') WHERE kind LIKE 'public:%';").unwrap();
        assert!(crate::session_tasks::inspect_events(&s.conn).is_err());
    }
}
