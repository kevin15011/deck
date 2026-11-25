//! Durable original decision semantics. A question, a reply and authorization
//! are separate records. Only the active Lead's admitted user input is evidence.
use crate::Store;
use deck2_shared::{Mode, Phase, Receipt};
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};

pub(crate) fn text(v: &Value, max: usize) -> bool {
    stored_text(v, max)
        && v.as_str().is_some_and(|s| {
            !s.contains('\r')
                && s.chars()
                    .any(|c| !c.is_whitespace() && !c.is_control() && c != '\u{feff}')
        })
}

// Durable Decisions and tasks may contain text written under the original rules.
fn stored_text(v: &Value, max: usize) -> bool {
    v.as_str().is_some_and(|s| {
        !s.trim().is_empty()
            && s.encode_utf16().count() <= max
            && !s
                .chars()
                .any(|c| (c < ' ' && c != '\n' && c != '\t' && c != '\r') || c == '\u{7f}')
    })
}
pub(crate) fn keys(v: &Value, allowed: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|o| o.keys().all(|k| allowed.contains(&k.as_str())))
}
fn ids(v: &Value, valid_text: fn(&Value, usize) -> bool) -> bool {
    v.as_array().is_some_and(|a| {
        a.len() <= 16
            && a.iter().all(|v| valid_text(v, 128))
            && a.iter().enumerate().all(|(i, v)| !a[..i].contains(v))
    })
}
fn unresolved(d: &Value) -> bool {
    d["state"] == "pending" || d["state"] == "deferred"
}
pub(crate) fn has_unresolved(store: &Store, session: &str) -> Result<bool, String> {
    store
        .conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM session_decisions WHERE session=?1
            AND json_extract(body,'$.state') IN ('pending','deferred'))",
            [session],
            |row| row.get(0),
        )
        .map_err(|_| "Cannot inspect outstanding decisions".into())
}

pub fn list(store: &Store, session: &str) -> Result<Value, String> {
    let mut q = store
        .conn
        .prepare("SELECT body FROM session_decisions WHERE session=?1 ORDER BY rowid")
        .map_err(|_| "Cannot read decisions")?;
    let all = q
        .query_map([session], |r| r.get::<_, String>(0))
        .map_err(|_| "Cannot read decisions")?
        .map(|r| {
            serde_json::from_str::<Value>(&r.map_err(|_| "Cannot read decision")?)
                .map_err(|_| "Corrupt decision".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let terminal = all.iter().filter(|d| !unresolved(d)).count();
    let mut out = all
        .iter()
        .filter(|d| unresolved(d))
        .cloned()
        .collect::<Vec<_>>();
    out.extend(
        all.into_iter()
            .filter(|d| !unresolved(d))
            .skip(terminal.saturating_sub(32)),
    );
    for d in &mut out {
        let mut q=store.conn.prepare("SELECT prompt,revision,question_revision FROM decision_replies WHERE session=?1 AND decision=?2 ORDER BY rowid").map_err(|_|"Cannot read decision replies")?;
        let replies = q
            .query_map(params![session, d["decisionId"].as_str()], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(|_| "Cannot read decision replies")?;
        let mut admitted = vec![];
        let mut queued = vec![];
        for row in replies {
            let (prompt, revision, question) = row.map_err(|_| "Cannot read decision reply")?;
            let r = store.get(&prompt)?.ok_or("Decision reply input missing")?;
            if r.phase == Phase::Queued {
                queued.push(json!({"promptId":prompt,"revision":revision}));
            } else if r.dispatch_ms.is_some() {
                admitted.push(json!({"promptId":prompt,"taskId":r.configuration.as_ref().and_then(|c|c.session_contract.as_ref()).map(|c|&c.lead_task),"attempt":r.attempt,"revision":revision,"questionRevision":question,"stale":revision<question || d["questionRevision"]!=question}));
            }
        }
        d["omittedReplies"] = json!(admitted.len().saturating_sub(8));
        d["replies"] = json!(
            admitted
                .into_iter()
                .rev()
                .take(8)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
        );
        d["queuedReplies"] = json!(queued);
    }
    Ok(json!({"sessionId":session,"decisions":out,"omittedTerminal":terminal.saturating_sub(32)}))
}
fn get(store: &Store, session: &str, id: &str) -> Result<Value, String> {
    let body: String = store
        .conn
        .query_row(
            "SELECT body FROM session_decisions WHERE session=?1 AND id=?2",
            params![session, id],
            |r| r.get(0),
        )
        .map_err(|_| "Unknown decision")?;
    serde_json::from_str(&body).map_err(|_| "Corrupt decision".into())
}
pub fn evidence(store: &Store, r: &Receipt, prompt: &Value, after: i64) -> bool {
    // Current implementation admits one genuine browser input per Lead attempt.
    // Queued/uncertain/synthetic task wakes can never supply current authority.
    reply_current(store,r) && r.dispatch_ms.is_some() && prompt.as_str()==Some(r.id.as_str()) && r.continuation.is_none() && r.phase==Phase::Running && !r.cancel_requested &&
    store.conn.query_row("SELECT MIN(seq) FROM session_events WHERE session=?1 AND task=?2 AND attempt=?3 AND kind LIKE 'receipt:%'",params![r.session,r.configuration.as_ref().and_then(|s|s.session_contract.as_ref()).map(|c|&c.lead_task),r.attempt],|row|row.get::<_,i64>(0)).is_ok_and(|seq|seq>after)
}
pub(crate) fn stored_dependencies(
    store: &Store,
    session: &str,
    links: &Value,
    action: &Value,
) -> Result<(), String> {
    let needs_action = links.as_array().is_some_and(|ids| !ids.is_empty());
    if !ids(links, stored_text)
        || ((needs_action || !action.is_null()) && !stored_text(action, 160))
    {
        return Err("Invalid decision dependencies/action".into());
    }
    for id in links.as_array().unwrap() {
        let d = get(store, session, id.as_str().unwrap())?;
        if d["state"] != "answered"
            || d["resolution"]["disposition"] != "allow"
            || d["resolution"]["action"] != *action
        {
            return Err("Decision dependency blocked".into());
        }
    }
    Ok(())
}
pub fn delegation(
    store: &Store,
    r: &Receipt,
    prior: Option<&str>,
    args: &Value,
) -> Result<Value, String> {
    if args.get("action").is_some_and(|v| !text(v, 160)) {
        return Err("Invalid dependency action".into());
    }
    if args.get("dependsOn").is_some_and(|v| !ids(v, text)) {
        return Err("Invalid decision dependencies/action".into());
    }
    let mut state: Value = prior
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| "Corrupt dependencies")?
        .unwrap_or(json!({}));
    let old = state.get("dependsOn").cloned().unwrap_or(json!([]));
    let action = args
        .get("action")
        .cloned()
        .unwrap_or(state["action"].clone());
    let links = args.get("dependsOn").cloned().unwrap_or(old.clone());
    let historical=state["originalDependencies"].as_array().is_some_and(|v|!v.is_empty());
    let changed = old != links || (!state["action"].is_null() && state["action"] != action);
    if args.get("replan").is_some() || (prior.is_some() && changed) || historical {
        let replan = &args["replan"];
        if prior.is_none()
            || !keys(replan, &["promptId", "note"])
            || !text(&replan["note"], 512)
            || !text(&args["commandId"], 128)
        {
            return Err("Explicit dependency replan required".into());
        }
        let mut after = 0;
        for id in old.as_array().ok_or("Corrupt dependencies")?.iter().filter(|_|!historical) {
            after = after.max(
                get(store, &r.session, id.as_str().ok_or("Corrupt dependency")?)?["updatedSeq"]
                    .as_i64()
                    .ok_or("Corrupt dependency sequence")?,
            );
        }
        if !evidence(store, r, &replan["promptId"], after) {
            return Err("Invalid current user replan evidence".into());
        }
    } else if args.get("commandId").is_some() {
        return Err("Omit commandId for ordinary delegation. It is required only with replan.".into());
    }
    stored_dependencies(store, &r.session, &links, &action)?;
    state.as_object_mut().unwrap().remove("originalDependencies");
    state["dependsOn"] = links;
    state["action"] = action;
    Ok(state)
}
pub fn tool(store: &mut Store, root: &str, name: &str, args: &Value) -> Result<Value, String> {
    let r = store.get(root)?.ok_or("Unknown caller")?;
    if r.mode != Mode::SessionV1 || r.phase != Phase::Running || r.cancel_requested {
        return Err("Inactive Lead authority".into());
    }
    if name == "deck_decision_list" {
        if !keys(args, &[]) {
            return Err("Invalid list arguments".into());
        }
        return list(store, &r.session);
    }
    let schema: Value =
        serde_json::from_str(include_str!("../assets/session-decision-tools.json")).unwrap();
    let allowed = schema
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == name)
        .ok_or("Unknown decision tool")?;
    if !args.as_object().is_some_and(|a| {
        a.keys()
            .all(|k| allowed["inputSchema"]["properties"].get(k).is_some())
    }) || !text(&args["commandId"], 128)
    {
        return Err("Invalid decision arguments".into());
    }
    let command = args["commandId"].as_str().unwrap();
    let fingerprint = json!([name, args]).to_string();
    if let Some((old, result)) = store
        .conn
        .query_row(
            "SELECT fingerprint,result FROM decision_commands WHERE session=?1 AND id=?2",
            params![r.session, command],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|_| "Cannot read decision receipt")?
    {
        return if old == fingerprint {
            serde_json::from_str(&result).map_err(|_| "Corrupt decision receipt".into())
        } else {
            Err("Command identity reused".into())
        };
    }
    if store.get(command)?.is_some()
        || store
            .conn
            .query_row(
                "SELECT count(*) FROM task_calls WHERE call=?1",
                [command],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|_| "Cannot inspect identity")?
            > 0
    {
        return Err("Command identity reused".into());
    }
    let next: i64 = store
        .conn
        .query_row(
            "SELECT MAX(COALESCE((SELECT MAX(seq) FROM session_events),0),COALESCE((SELECT seq FROM sqlite_sequence WHERE name='session_events'),0))+1",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Cannot read sequence")?;
    let lead = &r
        .configuration
        .as_ref()
        .and_then(|s| s.session_contract.as_ref())
        .ok_or("Missing Lead contract")?
        .lead_task;
    let mut related = vec![];
    let mut d = if name == "deck_decision_open" {
        if !text(&args["key"], 128) || !text(&args["question"], 2000) {
            return Err("Invalid question/key".into());
        }
        let source = &args["source"];
        if keys(source, &["promptId"]) && text(&source["promptId"], 128) {
            let p = store
                .get(source["promptId"].as_str().unwrap())?
                .ok_or("Unknown source prompt")?;
            if p.session != r.session || p.continuation.is_some() || p.dispatch_ms.is_none() {
                return Err("Invalid source prompt".into());
            }
        } else if keys(source, &["taskId", "attempt"]) {
            let t = store.task(source["taskId"].as_str().ok_or("Missing source task")?)?;
            if t.session != r.session
                || source["attempt"]
                    .as_u64()
                    .and_then(|n| n.checked_sub(1))
                    .and_then(|n| t.attempts.get(n as usize))
                    .is_none_or(|a| a.phase.active() || a.phase == Phase::Uncertain)
            {
                return Err("Invalid source task".into());
            }
        } else {
            return Err("Invalid source".into());
        }
        if args.get("openSpecRef").is_some() {
            return Err("No active change binding for OpenSpec reference".into());
        }
        if let Some(previous) = args.get("previousDecisionId") {
            get(
                store,
                &r.session,
                previous.as_str().ok_or("Invalid previous decision")?,
            )?;
        }
        let links = args.get("relatedTaskIds").cloned().unwrap_or(json!([]));
        if !ids(&links, text) {
            return Err("Invalid related tasks".into());
        }
        for id in links.as_array().unwrap() {
            let t = store.task(id.as_str().unwrap())?;
            if t.session != r.session {
                return Err("Foreign related task".into());
            }
            related.push(t);
        }
        let id = format!(
            "decision-{}",
            &crate::tasks::digest(
                format!("{}:{lead}:{}:{}", r.session, r.attempt, args["key"]).as_bytes()
            )[..32]
        );
        let opening = crate::tasks::digest(
            json!([
                args["key"],
                args["question"],
                source,
                links,
                args["previousDecisionId"]
            ])
            .to_string()
            .as_bytes(),
        );
        if let Ok(old) = get(store, &r.session, &id) {
            if old["openingFingerprint"] != opening {
                return Err("Decision key reused".into());
            }
            let result = json!({"decisionId":id,"revision":1,"state":"pending"});
            store
                .conn
                .execute(
                    "INSERT INTO decision_commands VALUES (?1,?2,?3,?4)",
                    params![r.session, command, fingerprint, result.to_string()],
                )
                .map_err(|_| "Cannot record opening alias")?;
            return Ok(result);
        } else {
            if list(store, &r.session)?["decisions"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|d| unresolved(d))
                .count()
                >= 16
            {
                return Err("Unresolved decision capacity reached".into());
            }
            json!({"decisionId":id,"revision":1,"questionRevision":1,"questionSeq":next,"createdSeq":next,"updatedSeq":next,"question":args["question"],"state":"pending","origin":{"taskId":lead,"attempt":r.attempt,"promptId":r.id},"source":source,"key":args["key"],"openingFingerprint":opening,"relatedTaskIds":links,"previousDecisionId":args["previousDecisionId"],"replies":[],"queuedReplies":[],"omittedReplies":0})
        }
    } else {
        if !text(&args["decisionId"], 128) || !text(&args["note"], 512) {
            return Err("Invalid decision mutation".into());
        }
        let mut d = get(store, &r.session, args["decisionId"].as_str().unwrap())?;
        if d["revision"] != args["expectedRevision"] || !unresolved(&d) {
            return Err("Stale revision or terminal decision".into());
        }
        let current_prompt = json!(r.id);
        if !evidence(
            store,
            &r,
            if name == "deck_decision_resolve" {
                &args["promptId"]
            } else {
                &current_prompt
            },
            d["questionSeq"]
                .as_i64()
                .ok_or("Corrupt question sequence")?,
        ) {
            return Err("Invalid current admitted user evidence".into());
        }
        d["revision"] = json!(d["revision"].as_u64().ok_or("Corrupt revision")? + 1);
        d["updatedSeq"] = json!(next);
        d["note"] = args["note"].clone();
        if name == "deck_decision_resolve" {
            if !["allow", "deny", "informational"]
                .iter()
                .any(|s| args["disposition"] == *s)
                || args.get("action").is_some_and(|a| !text(a, 160))
                || (args["disposition"] == "allow" && !text(&args["action"], 160))
            {
                return Err("Invalid resolution action".into());
            }
            d["state"] = json!("answered");
            d["resolution"] =
                json!({"promptId":r.id,"disposition":args["disposition"],"action":args["action"]});
        } else if args["state"] == "superseded" {
            if args.get("question").is_some()
                || args.get("replacementDecisionId").is_some()
                    == args.get("scopePromptId").is_some()
            {
                return Err("Invalid supersession".into());
            }
            if let Some(id) = args["replacementDecisionId"].as_str() {
                let replacement = get(store, &r.session, id)?;
                if !unresolved(&replacement) || replacement["decisionId"] == d["decisionId"] {
                    return Err("Invalid replacement".into());
                }
                d["replacementDecisionId"] = json!(id);
            } else if args["scopePromptId"] != r.id {
                return Err("Foreign scope prompt".into());
            }
            d["scopePromptId"] = json!(r.id);
            d["state"] = json!("superseded");
        } else {
            if !text(&args["question"], 2000)
                || args.get("state").is_some()
                || args.get("replacementDecisionId").is_some()
                || args.get("scopePromptId").is_some()
            {
                return Err("Invalid question revision".into());
            }
            if d["question"] != args["question"] {
                d["question"] = args["question"].clone();
                d["questionRevision"] = d["revision"].clone();
                d["questionSeq"] = json!(next);
            }
        }
        d
    };
    d["updatedSeq"] = json!(next);
    for task in &mut related {
        let mut s: Value = task
            .structured
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(|_| "Corrupt task dependencies")?
            .unwrap_or(json!({}));
        let links = s
            .as_object_mut()
            .ok_or("Corrupt task dependencies")?
            .entry("dependsOn")
            .or_insert(json!([]))
            .as_array_mut()
            .ok_or("Corrupt dependency links")?;
        if !links.contains(&d["decisionId"]) {
            if links.len() >= 16 {
                return Err("Dependency capacity".into());
            }
            links.push(d["decisionId"].clone());
        }
        task.structured = Some(s.to_string());
    }
    let result = json!({"decisionId":d["decisionId"],"revision":d["revision"],"state":d["state"]});
    let tx = store
        .conn
        .transaction()
        .map_err(|_| "Cannot begin decision")?;
    tx.execute("INSERT INTO session_decisions(session,id,body) VALUES (?1,?2,?3) ON CONFLICT(session,id) DO UPDATE SET body=excluded.body",params![r.session,d["decisionId"].as_str(),d.to_string()]).map_err(|_|"Cannot persist decision")?;
    for t in related {
        tx.execute(
            "UPDATE tasks SET body=?1 WHERE id=?2",
            params![
                serde_json::to_string(&t).map_err(|_| "Cannot encode dependencies")?,
                t.id
            ],
        )
        .map_err(|_| "Cannot link dependencies")?;
    }
    tx.execute(
        "INSERT INTO decision_commands VALUES (?1,?2,?3,?4)",
        params![r.session, command, fingerprint, result.to_string()],
    )
    .map_err(|_| "Cannot persist decision command")?;
    tx.execute(
        "INSERT INTO session_events(session,task,attempt,kind,body) VALUES (?1,?2,?3,?4,?5)",
        params![
            r.session,
            lead,
            r.attempt,
            format!("decision:{command}"),
            json!({"decision":d,"commandId":command,"at_ms":crate::now()}).to_string()
        ],
    )
    .map_err(|_| "Cannot persist decision event")?;
    tx.commit().map_err(|_| "Cannot commit decision")?;
    Ok(result)
}

pub fn inspect(conn: &rusqlite::Connection) -> Result<(), String> {
    let invalid = "Unsupported or corrupt durable decisions; preserve state";
    // Required tables are read before migration writes. Validate all records and
    // their owning connected session and ledger revision.
    let mut q = conn
        .prepare("SELECT session,id,body FROM session_decisions")
        .map_err(|_| invalid)?;
    for row in q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| invalid)?
    {
        let (session, id, body) = row.map_err(|_| invalid)?;
        let d: Value = serde_json::from_str(&body).map_err(|_| invalid)?;
        if d["decisionId"] != id
            || !stored_text(&d["question"], 2000)
            || d["revision"]
                .as_u64()
                .is_none_or(|n| n == 0 || n > 9_007_199_254_740_991)
            || d["questionRevision"]
                .as_u64()
                .is_none_or(|n| n == 0 || n > d["revision"].as_u64().unwrap_or(0))
            || !["pending", "deferred", "answered", "cancelled", "superseded"]
                .iter()
                .any(|s| d["state"] == *s)
            || !ids(&d["relatedTaskIds"], stored_text)
        {
            return Err(invalid.into());
        }
        let latest:String=conn.query_row("SELECT body FROM session_events WHERE session=?1 AND kind LIKE 'decision:%' AND json_extract(body,'$.decision.decisionId')=?2 ORDER BY seq DESC LIMIT 1",params![session,id],|r|r.get(0)).map_err(|_|invalid)?;
        if serde_json::from_str::<Value>(&latest).map_err(|_| invalid)?["decision"] != d {
            return Err(invalid.into());
        }
        let origin: String = conn
            .query_row(
                "SELECT body FROM receipts WHERE id=?1",
                [d["origin"]["promptId"].as_str().ok_or(invalid)?],
                |r| r.get(0),
            )
            .map_err(|_| invalid)?;
        let r: Receipt = serde_json::from_str(&origin).map_err(|_| invalid)?;
        if d["createdSeq"].as_i64().is_none_or(|n| n <= 0)
            || d["questionSeq"]
                .as_i64()
                .is_none_or(|n| n < d["createdSeq"].as_i64().unwrap_or(0))
            || d["updatedSeq"]
                .as_i64()
                .is_none_or(|n| n < d["questionSeq"].as_i64().unwrap_or(0))
            || !stored_text(&d["key"], 128)
            || d["origin"]["attempt"] != r.attempt
            || r.configuration
                .as_ref()
                .and_then(|s| s.session_contract.as_ref())
                .is_none_or(|c| d["origin"]["taskId"] != c.lead_task)
        {
            return Err(invalid.into());
        }
        if d["state"] == "answered" {
            let resolution = &d["resolution"];
            let prompt: String = conn
                .query_row(
                    "SELECT body FROM receipts WHERE id=?1",
                    [resolution["promptId"].as_str().ok_or(invalid)?],
                    |r| r.get(0),
                )
                .map_err(|_| invalid)?;
            let prompt: Receipt = serde_json::from_str(&prompt).map_err(|_| invalid)?;
            let seq:i64=conn.query_row("SELECT MIN(seq) FROM session_events WHERE session=?1 AND attempt=?2 AND kind LIKE 'receipt:%'",params![session,prompt.attempt],|r|r.get(0)).map_err(|_|invalid)?;
            if prompt.session != session
                || prompt.continuation.is_some()
                || prompt.dispatch_ms.is_none()
                || seq <= d["questionSeq"].as_i64().ok_or(invalid)?
                || !stored_text(&d["note"], 512)
                || !["allow", "deny", "informational"]
                    .iter()
                    .any(|s| resolution["disposition"] == *s)
                || (resolution["disposition"] == "allow"
                    && !stored_text(&resolution["action"], 160))
            {
                return Err(invalid.into());
            }
        }
        if r.session != session || r.mode != Mode::SessionV1 {
            return Err(invalid.into());
        }
    }
    let mut q = conn
        .prepare("SELECT session,id,fingerprint,result FROM decision_commands")
        .map_err(|_| invalid)?;
    for row in q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|_| invalid)?
    {
        let (_, id, f, result) = row.map_err(|_| invalid)?;
        let f: Value = serde_json::from_str(&f).map_err(|_| invalid)?;
        let result: Value = serde_json::from_str(&result).map_err(|_| invalid)?;
        if f[1]["commandId"] != id || !stored_text(&result["decisionId"], 128) {
            return Err(invalid.into());
        }
    }
    let mut q = conn
        .prepare("SELECT session,prompt,decision,revision,question_revision FROM decision_replies")
        .map_err(|_| invalid)?;
    for row in q
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })
        .map_err(|_| invalid)?
    {
        let (session, prompt, decision, revision, question) = row.map_err(|_| invalid)?;
        let body: String = conn
            .query_row("SELECT body FROM receipts WHERE id=?1", [prompt], |r| {
                r.get(0)
            })
            .map_err(|_| invalid)?;
        let r: Receipt = serde_json::from_str(&body).map_err(|_| invalid)?;
        let body: String = conn
            .query_row(
                "SELECT body FROM session_decisions WHERE session=?1 AND id=?2",
                params![session, decision],
                |r| r.get(0),
            )
            .map_err(|_| invalid)?;
        let d: Value = serde_json::from_str(&body).map_err(|_| invalid)?;
        if r.session != session
            || r.mode != Mode::SessionV1
            || r.continuation.is_some()
            || revision < 1
            || question < 1
            || d["revision"].as_i64().is_none_or(|n| question > n)
        {
            return Err(invalid.into());
        }
    }
    Ok(())
}

#[derive(Default, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReplyTarget {
    pub decision_id: Option<String>,
    pub revision: Option<u64>,
}
/// Targeted reply identity is committed atomically with browser admission.
/// Admission never resolves a decision and stale queued replies stay stale.
pub fn admit(
    store: &mut Store,
    c: &deck2_shared::ScopedSubmit,
    target: &ReplyTarget,
) -> Result<Receipt, crate::AdmissionError> {
    let prior: Option<(String, i64)> = store
        .conn
        .query_row(
            "SELECT decision,revision FROM decision_replies WHERE prompt=?1",
            [&c.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|_| "Cannot read reply identity")?;
    let selected = match (&target.decision_id, target.revision) {
        (None, None) => None,
        (Some(id), Some(rev)) if (1..=9_007_199_254_740_991).contains(&rev) => {
            Some((id.clone(), rev as i64))
        }
        _ => return Err("Invalid reply target".into()),
    };
    if store.get(&c.id)?.is_some() {
        if prior != selected {
            return Err("Reply target identity changed".into());
        }
        return store.admit(c);
    }
    let decision = selected
        .as_ref()
        .map(|(id, _)| get(store, &c.session, id))
        .transpose()?;
    if selected
        .as_ref()
        .zip(decision.as_ref())
        .is_some_and(|((_, revision), d)| d["revision"].as_i64().is_none_or(|n| *revision > n))
    {
        return Err("Future decision reply revision".into());
    }
    if decision.is_some() && c.mode != Mode::SessionV1 {
        return Err("Restricted input cannot target connected decisions".into());
    }
    store
        .conn
        .execute_batch("SAVEPOINT decision_reply")
        .map_err(|_| "Cannot begin reply admission")?;
    let result = (|| {
        let r = store.admit(c)?;
        if let Some((id, revision)) = selected {
            let d = decision.as_ref().unwrap();
            store
                .conn
                .execute(
                    "INSERT INTO decision_replies VALUES (?1,?2,?3,?4,?5)",
                    params![
                        r.session,
                        r.id,
                        id,
                        revision,
                        d["questionRevision"].as_i64()
                    ],
                )
                .map_err(|_| "Cannot persist reply target")?;
        }
        store
            .conn
            .execute_batch("RELEASE decision_reply")
            .map_err(|_| "Cannot commit reply admission")?;
        Ok(r)
    })();
    if result.is_err() {
        let _ = store
            .conn
            .execute_batch("ROLLBACK TO decision_reply; RELEASE decision_reply");
    }
    result
}
pub fn reply_current(store: &Store, r: &Receipt) -> bool {
    let target=store.conn.query_row("SELECT decision,revision,question_revision FROM decision_replies WHERE prompt=?1 AND session=?2",params![r.id,r.session],|row|Ok((row.get::<_,String>(0)?,row.get::<_,i64>(1)?,row.get::<_,i64>(2)?))).optional();
    match target {
        Ok(None) => true,
        Ok(Some((id, revision, q))) => {
            get(store, &r.session, &id).is_ok_and(|d| d["questionRevision"] == q && revision >= q)
        }
        Err(_) => false,
    }
}

pub fn user(store: &mut Store, session: &str, args: &Value) -> Result<Value, String> {
    if !keys(
        args,
        &[
            "commandId",
            "decisionId",
            "expectedRevision",
            "note",
            "type",
        ],
    ) || !text(&args["commandId"], 128)
        || !text(&args["decisionId"], 128)
        || !text(&args["note"], 512)
    {
        return Err("Invalid user decision command".into());
    }
    let fingerprint = json!([args["type"], args]).to_string();
    let id = args["commandId"].as_str().unwrap();
    if let Some((old, result)) = store
        .conn
        .query_row(
            "SELECT fingerprint,result FROM decision_commands WHERE session=?1 AND id=?2",
            params![session, id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|_| "Cannot read command")?
    {
        return if old == fingerprint {
            serde_json::from_str(&result).map_err(|_| "Corrupt receipt".into())
        } else {
            Err("Command identity reused".into())
        };
    }
    if store.get(id)?.is_some()
        || store
            .conn
            .query_row("SELECT COUNT(*) FROM task_calls WHERE call=?1", [id], |r| {
                r.get::<_, i64>(0)
            })
            .map_err(|_| "Cannot inspect command identity")?
            > 0
    {
        return Err("Command identity reused".into());
    }
    let mut d = get(store, session, args["decisionId"].as_str().unwrap())?;
    if !unresolved(&d) || d["revision"] != args["expectedRevision"] {
        return Err("Decision revision changed".into());
    }
    let state = match args["type"].as_str() {
        Some("decision.defer") if d["state"] == "pending" => "deferred",
        Some("decision.reopen") if d["state"] == "deferred" => "pending",
        Some("decision.cancel") => "cancelled",
        _ => return Err("Invalid user transition".into()),
    };
    let tx = store
        .conn
        .transaction()
        .map_err(|_| "Cannot begin user decision")?;
    let seq: i64 = tx
        .query_row(
            "SELECT MAX(COALESCE((SELECT MAX(seq) FROM session_events),0),COALESCE((SELECT seq FROM sqlite_sequence WHERE name='session_events'),0))+1",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "Cannot read sequence")?;
    d["revision"] = json!(d["revision"].as_u64().ok_or("Corrupt revision")? + 1);
    d["updatedSeq"] = json!(seq);
    d["state"] = json!(state);
    d["note"] = args["note"].clone();
    let result = json!({"decisionId":d["decisionId"],"revision":d["revision"],"state":state});
    tx.execute(
        "UPDATE session_decisions SET body=?1 WHERE session=?2 AND id=?3",
        params![d.to_string(), session, d["decisionId"].as_str()],
    )
    .map_err(|_| "Cannot save decision")?;
    tx.execute(
        "INSERT INTO decision_commands VALUES (?1,?2,?3,?4)",
        params![session, id, fingerprint, result.to_string()],
    )
    .map_err(|_| "Cannot save command")?;
    tx.execute(
        "INSERT INTO session_events(session,task,attempt,kind,body) VALUES (?1,?2,?3,?4,?5)",
        params![
            session,
            d["origin"]["taskId"].as_str(),
            d["origin"]["attempt"].as_str(),
            format!("decision:{id}"),
            json!({"decision":d,"commandId":id}).to_string()
        ],
    )
    .map_err(|_| "Cannot save decision event")?;
    tx.commit().map_err(|_| "Cannot commit decision")?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session(s: &mut Store) {
        s.register_codex("a".repeat(64)).unwrap();
        s.create_session(&serde_json::from_value(json!({"api":deck2_shared::API,"id":"decision-session","title":"Decisions","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"},"investigate":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap()).unwrap();
    }
    fn input(s: &mut Store, id: &str) {
        let c=serde_json::from_value(json!({"api":deck2_shared::API,"id":id,"session":"decision-session","mode":"session_v1","prompt":"A genuine browser reply"})).unwrap();
        let mut r = s.admit(&c).unwrap();
        r.phase = Phase::Running;
        r.dispatch_ms = Some(crate::now());
        r.thread = Some("thread".into());
        r.turn = Some("turn".into());
        s.save(&mut r).unwrap();
    }
    fn settle(s: &mut Store, id: &str) {
        let mut r = s.get(id).unwrap().unwrap();
        r.phase = Phase::Completed;
        s.save(&mut r).unwrap();
    }
    #[test]
    fn agy_regression_rejects_unicode_blank_decision_questions_at_dispatch() {
        // Protects nonblank Decision questions on every runner. Fails if the
        // shared dispatcher accepts a Unicode-blank question or a forbidden control.
        let mut s = Store::open_memory("/fixture").unwrap();
        session(&mut s);
        input(&mut s, "decision-question");
        for question in [
            "\u{0085}",
            "\u{0080}",
            "\u{feff}",
            "\u{00a0}",
            "\t\u{feff}\u{3000}\n",
            "Question\r",
        ] {
            let open = json!({
                "commandId": "open-blank-question",
                "key": "scope",
                "question": question,
                "source": {"promptId": "decision-question"}
            });
            assert_eq!(
                tool(&mut s, "decision-question", "deck_decision_open", &open).unwrap_err(),
                "Invalid question/key"
            );
        }
        let question = "¿Revisión?\n確認してください 🔍";
        let d = tool(
            &mut s,
            "decision-question",
            "deck_decision_open",
            &json!({
                "commandId":"open-unicode-question",
                "key":"scope",
                "question":question,
                "source":{"promptId":"decision-question"}
            }),
        )
        .unwrap();
        assert_eq!(
            get(&s, "decision-session", d["decisionId"].as_str().unwrap()).unwrap()["question"],
            question
        );
    }

    #[test]
    fn reopens_historical_decisions_without_rewriting_text() {
        // Protects existing Decision history. Fails if startup applies the new
        // dispatch rules to a previously valid Decision or changes its text.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        let mut s = Store::open(&path, "/fixture").unwrap();
        session(&mut s);
        input(&mut s, "decision-question");
        let historical = [
            ("legacy-crlf", "First line\r\n¿Second line?\u{0085}確認"),
            ("legacy-c1", "\u{0080}"),
        ];
        for (key, question) in historical {
            let placeholder = format!("Question placeholder for {key}");
            tool(
                &mut s,
                "decision-question",
                "deck_decision_open",
                &json!({
                    "commandId":format!("open-{key}"),
                    "key":key,
                    "question":placeholder,
                    "source":{"promptId":"decision-question"}
                }),
            )
            .unwrap();
            // Seed the legacy payload in the Decision, ledger and command receipt.
            let old = json!(placeholder).to_string();
            let new = json!(question).to_string();
            for statement in [
                "UPDATE session_decisions SET body=replace(body,?1,?2)",
                "UPDATE session_events SET body=replace(body,?1,?2) WHERE kind LIKE 'decision:%'",
                "UPDATE decision_commands SET fingerprint=replace(fingerprint,?1,?2)",
            ] {
                s.conn.execute(statement, params![old, new]).unwrap();
            }
        }
        let history = list(&s, "decision-session").unwrap();
        for (index, (_, question)) in historical.iter().enumerate() {
            assert_eq!(history["decisions"][index]["question"], *question);
        }
        drop(s);
        let reopened = Store::open(&path, "/fixture").unwrap();
        assert_eq!(list(&reopened, "decision-session").unwrap(), history);
    }

    #[test]
    fn decisions_require_new_current_user_evidence_and_inherit_dependencies() {
        let mut s = Store::open_memory("/fixture").unwrap();
        session(&mut s);
        input(&mut s, "decision-question");
        let open = json!({"commandId":"open-question","key":"scope","question":"May the member inspect?","source":{"promptId":"decision-question"}});
        let d = tool(&mut s, "decision-question", "deck_decision_open", &open).unwrap();
        assert_eq!(
            tool(&mut s, "decision-question", "deck_decision_open", &open).unwrap(),
            d
        );
        let mut conflict = open.clone();
        conflict["question"] = json!("Different question");
        assert!(tool(&mut s, "decision-question", "deck_decision_open", &conflict).is_err());
        let resolve = json!({"commandId":"resolve-question","decisionId":d["decisionId"],"expectedRevision":1,"promptId":"decision-question","note":"User explicitly allowed bounded inspection","disposition":"allow","action":"inspect fixture"});
        assert!(
            tool(
                &mut s,
                "decision-question",
                "deck_decision_resolve",
                &resolve
            )
            .is_err()
        );
        let delegate = json!({"agent":"investigate","task":"Inspect fixture","dependsOn":[d["decisionId"]],"action":"inspect fixture"});
        assert!(
            crate::session_tasks::tool(
                &mut s,
                "decision-question",
                "deck_delegate",
                &delegate,
                "pending-delegate"
            )
            .is_err()
        );
        let caller = s.get("decision-question").unwrap().unwrap();
        assert!(delegation(&s, &caller, None, &json!({"action":123})).is_err());
        settle(&mut s, "decision-question");
        input(&mut s, "decision-reply");
        assert!(tool(&mut s, "decision-reply", "deck_decision_resolve", &resolve).is_err());
        let mut resolve = resolve;
        resolve["promptId"] = json!("decision-reply");
        // Synthetic outcome continuation is never genuine evidence, even with the current prompt ID.
        let mut r = s.get("decision-reply").unwrap().unwrap();
        r.continuation = Some(deck2_shared::OutcomeContinuation {
            task: "synthetic".into(),
            attempt: "synthetic".into(),
            origin: "decision-question".into(),
            source_seq: 1,
        });
        s.save(&mut r).unwrap();
        assert!(tool(&mut s, "decision-reply", "deck_decision_resolve", &resolve).is_err());
        r.continuation = None;
        s.save(&mut r).unwrap();
        tool(&mut s, "decision-reply", "deck_decision_resolve", &resolve).unwrap();
        let t = crate::session_tasks::tool(
            &mut s,
            "decision-reply",
            "deck_delegate",
            &delegate,
            "allowed-delegate",
        )
        .unwrap();
        let t = s.task(t["taskId"].as_str().unwrap()).unwrap();
        let state: Value = serde_json::from_str(t.structured.as_deref().unwrap()).unwrap();
        assert_eq!(state["dependsOn"], delegate["dependsOn"]);
        assert!(
            delegation(
                &s,
                &r,
                t.structured.as_deref(),
                &json!({"dependsOn":[],"action":"change scope"})
            )
            .is_err()
        );
        assert!(
            stored_dependencies(
                &s,
                &r.session,
                &delegate["dependsOn"],
                &json!("different action")
            )
            .is_err()
        );
        inspect(&s.conn).unwrap();
    }
    #[test]
    fn one_targeted_user_reply_can_resolve_two_current_questions() {
        let mut s = Store::open_memory("/fixture").unwrap();
        session(&mut s);
        input(&mut s, "two-questions");
        let mut opened = Vec::new();
        for key in ["a", "b"] {
            opened.push(tool(&mut s, "two-questions", "deck_decision_open", &json!({"commandId":format!("open-{key}"),"key":key,"question":format!("Allow {key}?"),"source":{"promptId":"two-questions"}})).unwrap());
        }
        settle(&mut s, "two-questions");
        let c = serde_json::from_value(json!({"api":deck2_shared::API,"id":"answer-both","session":"decision-session","mode":"session_v1","prompt":"Allow both A and B"})).unwrap();
        let mut r = admit(
            &mut s,
            &c,
            &ReplyTarget {
                decision_id: Some(opened[0]["decisionId"].as_str().unwrap().into()),
                revision: Some(1),
            },
        )
        .unwrap();
        r.phase = Phase::Running;
        r.dispatch_ms = Some(crate::now());
        s.save(&mut r).unwrap();
        for (i, d) in opened.iter().enumerate() {
            let resolved = tool(&mut s, &r.id, "deck_decision_resolve", &json!({"commandId":format!("resolve-{i}"),"decisionId":d["decisionId"],"expectedRevision":1,"promptId":r.id,"note":"User explicitly allowed both questions","disposition":"allow","action":format!("action-{i}")})).unwrap();
            assert_eq!(resolved["state"], "answered");
        }
        inspect(&s.conn).unwrap();
    }
    #[test]
    fn targeted_stale_replies_and_changed_command_targets_never_refresh_authority() {
        let mut s = Store::open_memory("/fixture").unwrap();
        session(&mut s);
        input(&mut s, "target-question");
        let d=tool(&mut s,"target-question","deck_decision_open",&json!({"commandId":"target-open","key":"scope","question":"First scope?","source":{"promptId":"target-question"}})).unwrap();
        settle(&mut s, "target-question");
        input(&mut s, "revise-question");
        tool(&mut s,"revise-question","deck_decision_revise",&json!({"commandId":"revise-command","decisionId":d["decisionId"],"expectedRevision":1,"note":"Clarified by current user","question":"Changed scope?"})).unwrap();
        settle(&mut s, "revise-question");
        let c=serde_json::from_value(json!({"api":deck2_shared::API,"id":"stale-target-reply","session":"decision-session","mode":"session_v1","prompt":"Answer to old question"})).unwrap();
        let target = ReplyTarget {
            decision_id: Some(d["decisionId"].as_str().unwrap().into()),
            revision: Some(1),
        };
        let invalid = ReplyTarget {
            decision_id: target.decision_id.clone(),
            revision: Some(u64::MAX),
        };
        assert!(admit(&mut s, &c, &invalid).is_err());
        assert!(s.get("stale-target-reply").unwrap().is_none());
        let mut r = admit(&mut s, &c, &target).unwrap();
        assert!(admit(&mut s, &c, &ReplyTarget::default()).is_err());
        r.phase = Phase::Running;
        r.dispatch_ms = Some(crate::now());
        s.save(&mut r).unwrap();
        assert!(!evidence(&s, &r, &json!(r.id), 0));
        assert!(tool(&mut s,&r.id,"deck_decision_resolve",&json!({"commandId":"stale-resolve","decisionId":d["decisionId"],"expectedRevision":2,"promptId":r.id,"note":"Old answer","disposition":"allow","action":"changed scope"})).is_err());
        assert_eq!(
            list(&s, "decision-session").unwrap()["decisions"][0]["replies"][0]["stale"],
            true
        );
        inspect(&s.conn).unwrap();
    }
    #[test]
    fn restart_preserves_questions_and_refuses_corruption_before_writes() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("state.db");
        {
            let mut s = Store::open(&p, "/fixture").unwrap();
            session(&mut s);
            input(&mut s, "persistent-question");
            tool(&mut s,"persistent-question","deck_decision_open",&json!({"commandId":"persistent-open","key":"scope","question":"Continue?","source":{"promptId":"persistent-question"}})).unwrap();
            let id = list(&s, "decision-session").unwrap()["decisions"][0]["decisionId"].clone();
            user(&mut s,"decision-session",&json!({"commandId":"persistent-defer","decisionId":id,"expectedRevision":1,"type":"decision.defer","note":"Deferred by user"})).unwrap();
            settle(&mut s, "persistent-question");
        }
        {
            let mut s = Store::open(&p, "/fixture").unwrap();
            let d = list(&s, "decision-session").unwrap()["decisions"][0].clone();
            assert_eq!(d["state"], "deferred");
            user(&mut s,"decision-session",&json!({"commandId":"persistent-reopen","decisionId":d["decisionId"],"expectedRevision":2,"type":"decision.reopen","note":"Reopened by user"})).unwrap();
            let cancel = json!({"commandId":"persistent-cancel","decisionId":d["decisionId"],"expectedRevision":3,"type":"decision.cancel","note":"Cancelled by user"});
            let result = user(&mut s, "decision-session", &cancel).unwrap();
            assert_eq!(user(&mut s, "decision-session", &cancel).unwrap(), result);
            drop(s);
            let s = Store::open(&p, "/fixture").unwrap();
            assert_eq!(
                list(&s, "decision-session").unwrap()["decisions"][0]["state"],
                "cancelled"
            );
            s.conn
                .execute("UPDATE session_decisions SET body='{}'", [])
                .unwrap();
            s.conn
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
                .unwrap();
        }
        let before = std::fs::read(&p).unwrap();
        assert!(Store::open(&p, "/fixture").is_err());
        assert_eq!(std::fs::read(&p).unwrap(), before);
    }
}
