//! Native observations are scoped by the already admitted execution, never by model names.
use deck2_shared::ContextState;
use serde_json::Value;

pub(crate) fn handles(value: &Value) -> bool {
    value.get("id").is_none()
        && (value["method"] == "thread/tokenUsage/updated"
            || matches!(
                value["method"].as_str(),
                Some("item/started" | "item/completed")
            ) && value["params"]["item"]["type"] == "contextCompaction")
}

pub(crate) fn advances(value: &Value) -> bool {
    (matches!(
        value["method"].as_str(),
        Some(
            "item/agentMessage/delta"
                | "item/reasoning/textDelta"
                | "item/reasoning/summaryTextDelta"
        )
    ) && value["params"]["delta"]
        .as_str()
        .is_some_and(|s| !s.trim().is_empty()))
        || matches!(
            value["method"].as_str(),
            Some("item/started" | "item/completed")
        ) && value["params"]["item"]["type"] != "contextCompaction"
}

pub(crate) fn observe(
    state: &mut ContextState,
    value: &Value,
    thread: &str,
    turn: &str,
    attempt: &str,
    model: Option<&str>,
) {
    let p = &value["params"];
    if value.get("id").is_some()
        || p["threadId"] != thread
        || p["turnId"] != turn
        || thread.is_empty()
        || turn.is_empty()
        || thread.len() > 256
        || turn.len() > 256
        || thread.chars().chain(turn.chars()).any(char::is_control)
    {
        return;
    }
    if value["method"] == "item/started"
        && p["item"]["type"] == "contextCompaction"
        && p["item"]["id"]
            .as_str()
            .is_some_and(|s| !s.is_empty() && s.len() <= 256)
    {
        state.observation = None;
        state.compacted = true;
        state.compacting = p["item"]["id"].as_str().map(str::to_owned);
        return;
    }
    if advances(value)
        || value["method"] == "item/completed"
            && p["item"]["type"] == "contextCompaction"
            && state
                .compacting
                .as_deref()
                .is_some_and(|id| p["item"]["id"] == id)
    {
        state.compacting = None;
    }
    if value["method"] != "thread/tokenUsage/updated" || state.compacted {
        return;
    }
    let count = |v: &Value| v.as_u64().filter(|n| *n <= 9_007_199_254_740_991);
    let usage = &p["tokenUsage"];
    state.observation = Some(deck2_shared::ContextReading {
        basis: "codex-last-total".into(),
        tokens: count(&usage["last"]["totalTokens"]),
        capacity: count(&usage["modelContextWindow"]).filter(|n| *n > 0),
        native_thread_id: thread.into(),
        native_turn_id: turn.into(),
        attempt: attempt.into(),
        model_id: model
            .filter(|s| !s.is_empty() && s.len() <= 256)
            .map(str::to_owned),
        observed_ms: crate::now(),
    });
}

/// Progressive transcript reads are exact session/task/attempt reads, never report retrieval/integration.
pub(crate) async fn transcript(
    axum::extract::State(app): axum::extract::State<crate::server::App>,
    axum::extract::Path((session, task, attempt)): axum::extract::Path<(String, String, String)>,
    axum::extract::Query(query): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let store = app.store.lock().unwrap();
    let task = match store.task(&task) {
        Ok(t) if t.session == session => t,
        _ => {
            return crate::server::problem(
                axum::http::StatusCode::NOT_FOUND,
                "transcript-unavailable",
                "Task is unavailable in this session.",
            );
        }
    };
    let a = match task.attempts.iter().find(|a| a.id == attempt) {
        Some(a) => a,
        None => {
            return crate::server::problem(
                axum::http::StatusCode::NOT_FOUND,
                "transcript-unavailable",
                "Attempt is unavailable.",
            );
        }
    };
    let offset = query
        .get("offset")
        .map(|v| v.parse::<usize>())
        .unwrap_or(Ok(0));
    let text = if a.text.is_empty() {
        a.report.as_ref().map(|r| r.text.as_str()).unwrap_or("")
    } else {
        &a.text
    };
    let offset = match offset {
        Ok(o) if o <= text.len() && text.is_char_boundary(o) => o,
        _ => {
            return crate::server::problem(
                axum::http::StatusCode::BAD_REQUEST,
                "transcript-cursor",
                "Invalid transcript cursor.",
            );
        }
    };
    let mut end = (offset + 32768).min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    axum::Json(serde_json::json!({"session":session,"task":task.id,"attempt":attempt,"prompt":if offset==0 {Some(&a.prompt)}else{None},"text":&text[offset..end],"offset":offset,"nextOffset":end,"more":end<text.len(),"settled":!a.phase.active()})).into_response()
}

/// Assignment/release and retry boundaries also apply after restart, without rewriting history.
pub(crate) fn project(
    receipts: &mut [deck2_shared::Receipt],
    tasks: &mut [deck2_shared::Task],
    sessions: &[deck2_shared::Session],
) {
    for r in receipts {
        if !r.phase.active() {
            r.context.compacting = None;
        }
        let session = sessions.iter().find(|s| s.id == r.session);
        let admitted = r
            .configuration
            .as_ref()
            .and_then(|c| c.session_contract.as_ref());
        let changed = match (session.and_then(|s| s.contract.as_ref()), admitted) {
            (Some(now), Some(then)) => {
                now.generation != then.generation
                    || now.members.get("lead") != then.members.get("lead")
            }
            (None, None) => false,
            _ => true,
        };
        if changed
            || session
                .and_then(|s| s.native.as_ref())
                .is_none_or(|n| Some(&n.thread) != r.thread.as_ref())
        {
            r.context = Default::default();
        }
    }
    for t in tasks {
        let current = sessions
            .iter()
            .find(|s| s.id == t.session)
            .and_then(|s| s.contract.as_ref())
            .and_then(|c| c.members.get(&t.owner));
        let latest = t.attempts.last().map(|a| a.id.clone());
        for a in &mut t.attempts {
            if !a.phase.active() {
                a.context.compacting = None;
            }
            let admitted = a
                .configuration
                .as_ref()
                .and_then(|s| s.session_contract.as_ref())
                .and_then(|c| c.members.get(&t.owner));
            if Some(&a.id) != latest.as_ref() || current != admitted {
                a.context = Default::default();
            }
            // The workspace carries metadata/results; transcript text is read progressively.
            a.text.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn usage(thread: &str, turn: &str) -> Value {
        json!({"method":"thread/tokenUsage/updated","params":{"threadId":thread,"turnId":turn,"tokenUsage":{"last":{"totalTokens":34794},"total":{"totalTokens":9000000},"modelContextWindow":258400}}})
    }
    // Oracle: original mapper/projection. Cumulative totals and foreign turns never feed occupancy.
    #[test]
    fn current_identity_only_and_compaction_invalidates() {
        let mut c = ContextState::default();
        observe(
            &mut c,
            &usage("foreign", "turn"),
            "thread",
            "turn",
            "attempt",
            None,
        );
        assert!(c.observation.is_none());
        observe(
            &mut c,
            &usage("thread", "old"),
            "thread",
            "turn",
            "attempt",
            None,
        );
        assert!(c.observation.is_none());
        observe(
            &mut c,
            &usage("thread", "turn"),
            "thread",
            "turn",
            "attempt",
            Some("observed"),
        );
        let reading = c.observation.as_ref().unwrap();
        assert_eq!(reading.tokens, Some(34794));
        assert_eq!(reading.capacity, Some(258400));
        assert_eq!(reading.attempt, "attempt");
        observe(
            &mut c,
            &json!({"method":"item/started","params":{"threadId":"thread","turnId":"turn","item":{"id":"compact","type":"contextCompaction"}}}),
            "thread",
            "turn",
            "attempt",
            None,
        );
        observe(
            &mut c,
            &usage("thread", "turn"),
            "thread",
            "turn",
            "attempt",
            None,
        );
        assert!(c.observation.is_none());
    }
    #[test]
    fn release_assignment_retry_projection_survives_roundtrip() {
        let mut c = ContextState::default();
        observe(
            &mut c,
            &usage("thread", "turn"),
            "thread",
            "turn",
            "a1",
            None,
        );
        let mut receipt:deck2_shared::Receipt=serde_json::from_value(json!({"id":"r","session":"s","prompt":"p","phase":"completed","text":"result","detail":"","native_pid":null,"model":null,"thread":"thread","turn":"turn","accepted_ms":1,"handshake_ms":null,"dispatch_ms":1,"first_output_ms":1,"revision":1,"policy":"fixture","runner":"codex","delivery":"settled","context":c})).unwrap();
        let mut session: deck2_shared::Session = serde_json::from_value(
            json!({"id":"s","title":"Session","native":{"thread":"thread","mode":"read_only"}}),
        )
        .unwrap();
        let mut tasks = vec![];
        project(
            std::slice::from_mut(&mut receipt),
            &mut tasks,
            std::slice::from_ref(&session),
        );
        assert!(receipt.context.observation.is_some());
        // Snapshot/reload preserves the exact observation; release clears only its current projection.
        let historical: deck2_shared::Receipt =
            serde_json::from_str(&serde_json::to_string(&receipt).unwrap()).unwrap();
        session.native = None;
        project(
            std::slice::from_mut(&mut receipt),
            &mut tasks,
            std::slice::from_ref(&session),
        );
        assert!(receipt.context.observation.is_none());
        assert!(historical.context.observation.is_some());
        let assignment = json!({"runnerId":"codex","modelId":"fixture"});
        let contract = json!({"version":1,"revision":1,"generation":1,"members":{"lead":assignment,"quality":assignment},"approvals":"relay","leadTask":"lead"});
        let attempt = json!({"id":"a1","context":c,"text":"live text","prompt":"Delegation","source_report":null,"phase":"completed","detail":"","requested_model":"fixture","observed_model":"fixture","provenance":{"runner":"codex","integration":"fixture","executable":"hash","storage":"fixture","content":"fixture"},"native_session":"thread","native_message":"turn","generation":"g","accepted_ms":1,"dispatch_ms":1,"acknowledgment_ms":1,"first_output_ms":1,"settled_ms":1,"cancel_requested":false,"report":null,"treatments":[],"configuration":{"session_contract":contract,"revision":1,"codex_executable":null,"definitions":[],"investigator":null,"exclusions":[],"delivery_observed":true}});
        let mut task:deck2_shared::Task=serde_json::from_value(json!({"id":"task","session":"s","root":"r","parent_attempt":"lead-attempt","owner":"quality","scope":[],"acceptance":"Review","revision":1,"attempts":[attempt]})).unwrap();
        session.contract = Some(serde_json::from_value(contract).unwrap());
        let mut retry = task.attempts[0].clone();
        retry.id = "a2".into();
        retry.context.observation.as_mut().unwrap().attempt = "a2".into();
        task.attempts.push(retry);
        project(
            &mut [],
            std::slice::from_mut(&mut task),
            std::slice::from_ref(&session),
        );
        assert!(task.attempts[0].context.observation.is_none());
        assert!(task.attempts[1].context.observation.is_some());
        assert!(task.attempts[1].text.is_empty());
        session
            .contract
            .as_mut()
            .unwrap()
            .members
            .get_mut("quality")
            .unwrap()
            .model_id = "changed".into();
        project(
            &mut [],
            std::slice::from_mut(&mut task),
            std::slice::from_ref(&session),
        );
        assert!(task.attempts[1].context.observation.is_none());
    }
    // DAILY52-Q02: completion clears matching progress, never its invalidation fence.
    #[test]
    fn compaction_progress_is_keyed_and_completion_does_not_restore_reading() {
        let mut c = ContextState::default();
        let event = |method: &str, id: &str, turn: &str| json!({"method":method,"params":{"threadId":"thread","turnId":turn,"item":{"id":id,"type":"contextCompaction"}}});
        let send =
            |c: &mut ContextState, v: Value| observe(c, &v, "thread", "turn", "attempt", None);
        send(&mut c, usage("thread", "turn"));
        send(&mut c, event("item/started", "c1", "turn"));
        assert_eq!(serde_json::to_value(&c).unwrap()["compacting"], "c1");
        send(&mut c, event("item/completed", "c1", "old"));
        send(&mut c, event("item/completed", "foreign", "turn"));
        assert_eq!(serde_json::to_value(&c).unwrap()["compacting"], "c1");
        send(&mut c, event("item/completed", "c1", "turn"));
        let reload: ContextState =
            serde_json::from_value(serde_json::to_value(&c).unwrap()).unwrap();
        assert!(serde_json::to_value(&reload).unwrap()["compacting"].is_null());
        assert!(reload.compacted && reload.observation.is_none());
        send(&mut c, usage("thread", "turn"));
        assert!(c.observation.is_none());
        send(&mut c, event("item/started", "c2", "turn"));
        send(
            &mut c,
            json!({"method":"item/agentMessage/delta","params":{"threadId":"thread","turnId":"turn","delta":"later response"}}),
        );
        send(&mut c, event("item/completed", "c1", "turn"));
        assert!(
            serde_json::to_value(&c).unwrap()["compacting"].is_null(),
            "later response remains authoritative"
        );
        assert!(ContextState::default().observation.is_none());
    }
    #[test]
    fn malformed_counts_are_unknown_not_zero() {
        let mut c = ContextState::default();
        let mut v = usage("thread", "turn");
        v["params"]["tokenUsage"]["last"]["totalTokens"] = json!(3.5);
        v["params"]["tokenUsage"]["modelContextWindow"] = json!(0);
        observe(&mut c, &v, "thread", "turn", "attempt", None);
        let reading = c.observation.unwrap();
        assert_eq!(reading.tokens, None);
        assert_eq!(reading.capacity, None);
    }
}
