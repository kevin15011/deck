//! Codex approval and usage wire translation. Native evidence is correlation,
//! never launch or grant authority; canonical ownership checks remain at effects.
use crate::native_approval::validate_native;
use deck2_shared::{Decision, DecisionResponse, DecisionState, NativeApproval, Phase, Receipt};
use serde_json::{Value, json};

pub(crate) fn record_decision(
    app: &crate::server::App,
    decision: Decision,
) -> Result<Option<&'static str>, String> {
    // Other native callers can append to this receipt after the draft was built.
    let result = (|| {
        let mut store = crate::latency::locked_checked(&app.store).map_err(|_| "State lock failed")?;
        let mut receipt = store.get(&decision.command)?.ok_or("Receipt missing")?;
        if receipt.cancel_requested {
            return Ok(Some("Deck cancelled this permission request"));
        }
        if crate::native_approval::at_capacity(&receipt) {
            return Ok(Some(crate::native_approval::CAPACITY_DENIAL));
        }
        if decision.task.is_none() {
            receipt.detail = "Waiting for native permission".into();
        }
        if !receipt.phase.active() {
            receipt.context.compacting = None;
        }
        receipt.decisions.push(decision);
        store.save(&mut receipt)?;
        Ok(None)
    })();
    if result.is_err() {
        app.storage_failed();
    }
    result
}

pub fn native_method(method: &str) -> bool {
    matches!(
        method,
        "item/commandExecution/requestApproval"
            | "item/fileChange/requestApproval"
            | "item/permissions/requestApproval"
            | "mcpServer/elicitation/request"
    )
}
/// Read-only predecessor inspection only. Runtime delivery always requires tags.
pub(crate) fn validate_legacy_native(d: &Decision) -> Result<(), String> {
    let n = d.native.as_ref().ok_or("Native action missing")?;
    if n.transport.is_some() {
        let expected = if n.method == "deck/approve" {
            deck2_shared::NativeTransport::DeckMcp
        } else {
            deck2_shared::NativeTransport::CodexJsonRpc
        };
        if n.transport != Some(expected) {
            return Err("Native approval transport mismatch".into());
        }
    }
    if (!native_method(&n.method) && n.method != "deck/approve") || n.parameters.len() > 65536 {
        return Err("Native action invalid".into());
    }
    let p: Value = serde_json::from_str(&n.parameters).map_err(|_| "Native action corrupt")?;
    if p["threadId"] != d.thread || p["turnId"] != d.turn || d.request.is_empty() {
        return Err("Native action identity mismatch".into());
    }
    Ok(())
}
pub fn native_decision(
    r: &Receipt,
    generation: &str,
    thread: &str,
    turn: &str,
    v: &Value,
) -> Result<Decision, String> {
    let method = v["method"]
        .as_str()
        .filter(|m| native_method(m))
        .ok_or("Unsupported native approval")?;
    let p = &v["params"];
    let request = v["id"].to_string();
    if p["threadId"] != thread
        || p["turnId"] != turn
        || r.thread.as_deref() != Some(thread)
        || r.turn.as_deref() != Some(turn)
        || r.generation != generation
        || r.cancel_requested
        || r.phase != Phase::Running
        || r.mode != deck2_shared::Mode::SessionV1
        || r.decisions
            .iter()
            .any(|d| d.request == request && d.generation == generation)
    {
        return Err("Stale native approval".into());
    }
    let item = p["itemId"].as_str().unwrap_or("").to_string();
    let mcp = method == "mcpServer/elicitation/request";
    if mcp
        && (!p["serverName"].is_string()
            || p["mode"] != "form"
            || p["_meta"]["codex_approval_kind"] != "mcp_tool_call"
            || p["requestedSchema"]["type"] != "object"
            || !p["requestedSchema"]["properties"]
                .as_object()
                .is_some_and(|p| p.is_empty())
            || p["requestedSchema"]
                .as_object()
                .is_none_or(|p| p.keys().any(|k| k != "type" && k != "properties")))
    {
        return Err("General elicitation is not a tool approval".into());
    }
    let parameters = p.to_string();
    if parameters.len() > 65536 {
        return Err("Oversized native action".into());
    }
    let native_tool = native_tool_name(p);
    let action = delegation_action(r, method, p).or_else(|| match method {
        "item/commandExecution/requestApproval" => {
            if p["command"].is_string() {
                Some(json!({"command":p["command"],"cwd":p["cwd"]}))
            } else {
                None
            }
        }
        "item/fileChange/requestApproval" => {
            if p["changes"].is_array() || p["paths"].is_array() {
                Some(json!({"changes":p["changes"],"paths":p["paths"],"grantRoot":p["grantRoot"]}))
            } else {
                None
            }
        }
        "item/permissions/requestApproval" => {
            Some(json!({"permissions":p["permissions"],"cwd":p["cwd"]}))
        }
        _ => native_tool.filter(|_|p["_meta"].get("tool_params").is_some()).map(|tool|json!({"server":p["serverName"],"tool":tool,"input":p["_meta"]["tool_params"]})),
    });
    let identity = action
        .map(|a| json!({"method":method,"action":a}).to_string())
        .filter(|s| s.len() <= 16384);
    let amendment = command_prefix(method, p);
    let native=NativeApproval{file_proposal:None,resolution_provenance:None,permission:None,transport:Some(deck2_shared::NativeTransport::CodexJsonRpc),method:method.into(),parameters,summary:if let Some(command)=p["command"].as_str(){command.chars().take(4096).collect()}else{p["message"].as_str().or_else(||p["reason"].as_str()).unwrap_or(method).chars().take(4096).collect()},identity,always_note:amendment.as_ref().map(|a|format!("Codex stores this command prefix on this machine for future sessions. Deck cannot revoke it: {}",json!(a)))};
    let d = Decision {
        task: None,
        native: Some(native),
        id: uuid::Uuid::new_v4().to_string(),
        session: r.session.clone(),
        command: r.id.clone(),
        attempt: r.attempt.clone(),
        generation: generation.into(),
        thread: thread.into(),
        turn: turn.into(),
        item,
        request,
        revision: 1,
        state: DecisionState::Pending,
        file: None,
        questions: vec![],
        resolution: None,
        dispatch_ms: None,
        delivered_ms: None,
        grant_consumed: false,
        detail: "Native permission request; review before allowing this action".into(),
    };
    validate_native(&d)?;
    Ok(d)
}
pub fn native_reply(d: &Decision) -> Result<Value, String> {
    validate_native(d)?;
    let n = d.native.as_ref().ok_or("Native action missing")?;
    if n.transport != Some(deck2_shared::NativeTransport::CodexJsonRpc) {
        return Err("Codex reply transport mismatch".into());
    }
    let p: Value = serde_json::from_str(&n.parameters).map_err(|_| "Corrupt action")?;
    let response = &d.resolution.as_ref().ok_or("Response missing")?.response;
    let allowed = matches!(
        response,
        DecisionResponse::AllowOnce
            | DecisionResponse::AllowSession
            | DecisionResponse::AllowAlways
    );
    let persistent = if *response == DecisionResponse::AllowAlways {
        Some(persistent_grant(d).ok_or("Native persistent grant unsupported for this action")?)
    } else { None };
    Ok(match n.method.as_str() {
        "item/permissions/requestApproval" => {
            if allowed {
                json!({"permissions":p["permissions"],"scope":"turn"})
            } else {
                json!({"permissions":{}})
            }
        }
        "mcpServer/elicitation/request" => {
            json!({"action":if allowed{"accept"}else{"decline"},"content":if allowed{json!({})}else{Value::Null},"_meta":null})
        }
        _ => {
            if let Some(grant) = persistent {
                json!({"decision":{"acceptWithExecpolicyAmendment":{"execpolicy_amendment":grant["prefix"]}}})
            } else {
                json!({"decision":if allowed{"accept"}else{"decline"}})
            }
        }
    })
}
pub fn revoked_reply(d: &Decision) -> Result<Option<Value>, String> {
    if d.native.as_ref().is_none_or(|n| n.method == "deck/approve")
        || d.state != DecisionState::Invalidated
        || !d.detail.starts_with("Session grants revoked;")
    {
        return Ok(None);
    }
    // Revocation sends only a denial. Preserve the original recorded response.
    let mut denied = d.clone();
    denied.resolution = Some(deck2_shared::Resolve {
        api: deck2_shared::API,
        command_id: "revocation-denial".into(),
        expected_revision: d.revision,
        response: DecisionResponse::Deny,
    });
    native_reply(&denied).map(Some)
}

pub fn native_tool_name(p: &Value) -> Option<&str> {
    let canonical = p["message"].as_str()
        .and_then(|message| message.strip_prefix("Allow the "))
        .and_then(|message| message.split_once(" MCP server to run tool \""));
    let message_tool = match canonical {
        Some((server, message)) if p["serverName"].as_str() == Some(server) => {
            Some(message.strip_suffix("\"?")?)
        }
        Some(_) => return None,
        None => None,
    };
    let mut tool = message_tool;
    for field in [
        p.get("toolName"),
        p.get("tool_name"),
        p["_meta"].get("toolName"),
        p["_meta"].get("tool_name"),
    ].into_iter().flatten() {
        let candidate = field.as_str()?;
        if tool.is_some_and(|known| known != candidate) {
            return None;
        }
        tool = Some(candidate);
    }
    tool.filter(|s| {
        !s.is_empty()
            && s.len() <= 128
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
    })
}

/// Decode only exact-owner Codex request-input evidence. Tool completion and
/// compaction invalidate it; cumulative/total counters cannot certify input.
pub(crate) fn observe_input(a: &mut deck2_shared::TaskAttempt, v: &Value) {
    use crate::session_continuity::InputObservation;
    let observation = if v["params"]["threadId"] != a.native_session.as_deref().unwrap_or("")
        || v["params"]["turnId"] != a.native_message.as_deref().unwrap_or("")
    {
        InputObservation::Unchanged
    } else if a.context.compacted
        || (v["method"] == "item/completed"
            && [
                "commandExecution",
                "fileChange",
                "mcpToolCall",
                "webSearch",
                "dynamicToolCall",
            ]
            .contains(&v["params"]["item"]["type"].as_str().unwrap_or("")))
        || (v["method"] == "item/started" && v["params"]["item"]["type"] == "contextCompaction")
    {
        InputObservation::Invalidated
    } else if v["method"] != "thread/tokenUsage/updated" {
        InputObservation::Unchanged
    } else if let Some(tokens) = v["params"]["tokenUsage"]["last"]["inputTokens"]
        .as_u64()
        .filter(|n| *n <= 9_007_199_254_740_991)
    {
        InputObservation::Exact {
            tokens,
            basis: "codex-last-input",
        }
    } else {
        InputObservation::Invalidated
    };
    crate::session_continuity::observe(a, observation);
}

/// Resolve only a verified Codex inventory into native model/effort identifiers.
pub(crate) fn resolve_model(
    models: &Value,
    a: &deck2_shared::MemberAssignment,
    fallback: Option<&str>,
) -> Result<(String, Option<String>), String> {
    let raw = a
        .model_id
        .strip_prefix("openai-codex/")
        .unwrap_or(&a.model_id);
    if a.runner_id != "codex"
        || raw.is_empty()
        || raw.len() > 160
        || !raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
    {
        return Err("Unsupported Codex model identity".into());
    }
    let model = models
        .as_array()
        .and_then(|ms| ms.iter().find(|m| m["modelId"] == raw))
        .ok_or("Assigned model is unavailable")?;
    let effort = a.thinking.as_deref().or(fallback);
    if effort.is_some_and(|t| {
        model["thinkingLevels"]
            .as_array()
            .is_none_or(|v| !v.contains(&json!(t)))
    }) {
        return Err(
            "Assigned reasoning level is unavailable; choose a supported explicit reasoning level"
                .into(),
        );
    }
    Ok((raw.into(), effort.map(str::to_owned)))
}

/// Presentation decoding is selected by transport before canonical UI sees it.
pub(crate) fn action_view(method:&str, parameters:&str)->Option<(&'static str,Value)> {
    let p:Value=serde_json::from_str(parameters).ok()?;
    Some(match method {
        "item/commandExecution/requestApproval"=>("command",json!({"command":p["command"],"cwd":p["cwd"]})),
        "item/fileChange/requestApproval"=>("file_changes",json!({"changes":p["changes"],"paths":p["paths"],"grant_root":p["grantRoot"]})),
        "item/permissions/requestApproval"=>("permissions",json!({"permissions":p["permissions"],"cwd":p["cwd"]})),
        "mcpServer/elicitation/request"=>("tool",json!({"server":p["serverName"],"tool":native_tool_name(&p),"input":p["_meta"]["tool_params"]})),
        _=>return None,
    })
}
pub(crate) fn reasoning_view(value:Option<&deck2_shared::EffectiveReasoning>)->Value {
    let Some(r)=value.filter(|r| matches!(r.source.as_str(),"thread/start"|"thread/resume") && !r.model.is_empty() && r.model.len()<=256 && !r.effort.is_empty() && r.effort.len()<=64 && !r.model.chars().chain(r.effort.chars()).any(char::is_control)) else {return Value::Null;};
    json!({"model":r.model,"effort":r.effort,"validated":true,"basis":"native_acknowledgement"})
}

/// Exact retained command-prefix authority, shared by presentation and reply.
/// Unsupported/redaction-sensitive scopes fail closed; prose never grants authority.
fn command_prefix(method: &str, p: &Value) -> Option<Value> {
    if method != "item/commandExecution/requestApproval" { return None; }
    let a = p.get("proposedExecpolicyAmendment")?.as_array()?;
    if a.is_empty() || a.len() > 128 { return None; }
    for v in a {
        let s = v.as_str()?;
        let lower = s.to_lowercase();
        // Conservative display safety: also withhold ambiguous encoded URL/query
        // scopes rather than exposing a prefix the browser may redact differently.
        if s.trim().is_empty() || s.chars().any(|c| c.is_control() || matches!(c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}'))
            || ["bearer", "basic", "authorization", "api_key", "api-key", "apikey", "access_key", "access-key", "accesskey", "token", "password", "passwd", "secret", "sk-"].iter().any(|m| lower.contains(m))
            || s.contains('%') || s.contains('?') || s.contains('&') || (s.contains("://") && s.contains('@')) { return None; }
    }
    let prefix: Vec<_> = a.iter().filter_map(Value::as_str).collect();
    if !crate::permission_bounds::codex_native_prefix_reusable(p, &prefix) { return None; }
    let value = Value::Array(a.clone());
    if value.to_string().encode_utf16().count() > 8192 { return None; }
    Some(value)
}
pub(crate) fn persistent_grant(d: &Decision) -> Option<Value> {
    if d.task.is_some() { return None; } // Preserve the member adapter's prior persistent-policy boundary.
    validate_native(d).ok()?;
    let n = d.native.as_ref()?;
    if n.transport != Some(deck2_shared::NativeTransport::CodexJsonRpc) || n.identity.is_none() { return None; }
    let p: Value = serde_json::from_str(&n.parameters).ok()?;
    let prefix = command_prefix(&n.method, &p)?;
    Some(json!({"kind":"command_prefix","validated":true,"prefix":prefix,"persistence":"across_sessions","revocation":"outside_deck"}))
}

/// Scope comes from the retained native envelope and frozen host assignment,
/// never a browser scope claim. Exact historical identities remain exact.
fn delegation_action(r: &Receipt, method: &str, p: &Value) -> Option<Value> {
    if method != "mcpServer/elicitation/request" || p["serverName"] != "deck-session"
        || native_tool_name(p) != Some("deck_delegate") { return None; }
    let input = p["_meta"]["tool_params"].as_object()?;
    let role = input.get("agent")?.as_str()?;
    let contract = r.configuration.as_ref()?.session_contract.as_ref()?;
    if role == "lead" || !crate::session_contract::MEMBERS.contains(&role) || !contract.members.contains_key(role)
        || input.get("task")?.as_str()?.trim().is_empty() { return None; }
    Some(json!({"server":"deck-session","tool":"deck_delegate","scope":"delegation_role_v1","role":role,"assignment_revision":contract.revision}))
}
/// Additive browser disclosure for the new scope; no historical consent is widened.
pub(crate) fn session_grant_view(d: &Decision) -> Option<Value> {
    if d.task.is_some() { return None; }
    let n=d.native.as_ref()?;
    if n.transport != Some(deck2_shared::NativeTransport::CodexJsonRpc) || n.method != "mcpServer/elicitation/request" {return None;}
    let identity:Value=serde_json::from_str(n.identity.as_ref()?).ok()?;
    let action=&identity["action"];
    if identity["method"]!=n.method || action["scope"]!="delegation_role_v1" {return None;}
    let p:Value=serde_json::from_str(&n.parameters).ok()?;
    let role=action["role"].as_str()?;
    if p["serverName"]!="deck-session" || native_tool_name(&p)!=Some("deck_delegate") || p["_meta"]["tool_params"]["agent"]!=role
        || !crate::session_contract::MEMBERS.contains(&role) || role=="lead" {return None;}
    Some(json!({"kind":"delegation_role","role":role,"assignment_revision":action["assignment_revision"],"lifetime":"session_generation","survives_host_restart":true,"revocation":"deck_session","description":format!("Delegate new tasks to {role} in this session with the current assignments, until revoked or session authority changes. Host reconnects and native process restarts retain this grant. Other roles and tools require their own permission.")}))
}

/// Preserve all unknown material fields. Only known top-level correlation and
/// explanatory prose are removed; nested input IDs always remain material.
pub(crate) fn permission_material(d:&Decision)->Option<Value> {
    let n=d.native.as_ref()?;
    let mut p:Value=serde_json::from_str(&n.parameters).ok()?;
    let category=match n.method.as_str() {
        "item/commandExecution/requestApproval" if p["command"].as_str().is_some_and(|s|!s.is_empty()) && p["cwd"].as_str().is_some_and(|s|!s.is_empty())=>"command",
        "item/fileChange/requestApproval" if p["changes"].as_array().is_some_and(|a|!a.is_empty())=>"files",
        "item/permissions/requestApproval" if p["permissions"].is_object()=>"permissions",
        "mcpServer/elicitation/request" if native_tool_name(&p).is_some() && p["_meta"].get("tool_params").is_some()=>"mcp",
        _=>return None,
    };
    // Preserve the already-disclosed historical delegation-role policy. It is
    // superseded by intrinsic coordination, never inferred for arbitrary tools.
    let identity:Value=serde_json::from_str(n.identity.as_ref()?).ok()?;
    if category=="mcp" && identity["action"]["scope"]=="delegation_role_v1" {
        return Some(json!({"category":"historical_delegation_role","action":identity}));
    }
    let tool=if category=="mcp" {native_tool_name(&p).map(str::to_owned)} else {None};
    let o=p.as_object_mut()?;
    for k in ["threadId","turnId","itemId","reason","message"] {o.remove(k);}
    Some(json!({"category":category,"method":n.method,"tool":tool,"request":p}))
}
