//! Additive presentation contract. Native envelopes remain exact private evidence;
//! callers render these bounded projections without decoding native protocols.
use deck2_shared::{Decision, NativeTransport, Receipt};
use serde_json::{Value, json};
pub(crate) fn bounded(value: &Value, depth: usize) -> Value {
    if depth > 6 {
        return json!("[Display depth limit]");
    }
    match value {
        Value::String(s) => {
            let lower = s.to_lowercase();
            if [
                "bearer ",
                "basic ",
                "authorization",
                "token=",
                "token:",
                "api_key",
                "apikey",
                "password",
                "passwd",
                "secret",
                "sk-",
            ]
            .iter()
            .any(|p| lower.contains(p))
            {
                return json!("[Sensitive display value withheld]");
            }
            json!(
                s.chars()
                    .filter(|c| !c.is_control()
                        && !matches!(*c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}'))
                    .take(1024)
                    .collect::<String>()
            )
        }
        Value::Array(a) => Value::Array(a.iter().take(32).map(|v| bounded(v, depth + 1)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .take(32)
                .map(|(k, v)| {
                    let name = k.to_lowercase();
                    let secret = [
                        "token",
                        "password",
                        "passwd",
                        "secret",
                        "authorization",
                        "api_key",
                        "apikey",
                    ]
                    .iter()
                    .any(|s| name.contains(s));
                    (
                        k.chars().take(128).collect(),
                        if secret {
                            json!("[Redacted]")
                        } else {
                            bounded(v, depth + 1)
                        },
                    )
                })
                .collect(),
        ),
        _ => value.clone(),
    }
}
pub(crate) fn decision(d: &Decision) -> Value {
    let Some(n) = &d.native else {
        return json!({"version":1,"kind":if d.file.is_some(){"file_edit"}else{"question"},"validated":true,"details":Value::Null});
    };
    if crate::native_approval::validate_native(d).is_err() {
        return json!({"version":1,"kind":"unavailable","validated":false,"details":Value::Null});
    }
    if n.transport == Some(NativeTransport::ClaudeSdk) && d.file.is_some() {
        return json!({"version":1,"kind":"file_edit","validated":true,"details":Value::Null,"responses":["allow_once","deny"]});
    }
    let projected = match n.transport {
        Some(NativeTransport::CodexJsonRpc) => {
            crate::codex_protocol::action_view(&n.method, &n.parameters)
        }
        Some(NativeTransport::OpencodeHttp) => {
            crate::connected_opencode::execution::action_view(&n.method, &n.parameters)
        }
        Some(NativeTransport::DeckMcp) => crate::session_mcp::action_view(&n.parameters),
        Some(NativeTransport::ClaudeSdk) => crate::claude::approval::action_view(n),
        None => None,
    };
    let Some((kind, details)) = projected else {
        return json!({"version":1,"kind":"unavailable","validated":false,"details":Value::Null});
    };
    let details = bounded(&details, 0);
    let details = if details.to_string().len() <= 4096 {
        details
    } else {
        json!({"display":"Action exceeds the bounded display; inspect exact recorded action"})
    };
    let persistent_grant = crate::codex_protocol::persistent_grant(d);
    let permission_policy = crate::permission_policy::view(d);
    let responses = if !d.questions.is_empty() {
        vec!["answers", "dismiss"]
    } else {
        let mut responses=vec!["allow_once"];
        if permission_policy.is_some() || n.transport==Some(NativeTransport::OpencodeHttp) && n.identity.is_some() {responses.push("allow_session");}
        if persistent_grant.is_some() {responses.push("allow_always");}
        responses.push("deny");
        responses
    };
    let mut view = json!({"version":1,"kind":kind,"validated":true,"details":details,"responses":responses,"authority":"display capabilities only; current exact decision checks still apply"});
    if let Some(provenance) = &n.resolution_provenance { view["resolution_provenance"] = json!(provenance); }
    if let Some(policy) = permission_policy { view["permission_policy"] = policy; }
    if let Some(grant) = persistent_grant { view["persistent_grant"] = grant; }
    if let Some(grant) = crate::codex_protocol::session_grant_view(d) { view["session_grant"] = grant; }
    view
}
pub(crate) fn receipt(r: &Receipt) -> Value {
    let integration = crate::member_integration::Integration::for_receipt(r).ok();
    let recorded = r
        .configuration
        .as_ref()
        .and_then(|s| s.session_contract.as_ref())
        .and_then(|c| c.members.get("lead"))
        .map(|a| a.runner_id.as_str());
    let reasoning = match integration {
        Some(crate::member_integration::Integration::Codex) => {
            crate::codex_protocol::reasoning_view(
                r.reasoning
                    .as_ref()
                    .filter(|v| r.model.as_deref() == Some(&v.model)),
            )
        }
        Some(crate::member_integration::Integration::OpenCode | crate::member_integration::Integration::Claude) | None => Value::Null,
    };
    json!({"version":1,"recorded_runner":recorded,"integration_available":integration.is_some(),"reasoning":reasoning,"retained_runtime_supported":integration.is_some_and(|i|i.supports_retained_lead()) && r.mode==deck2_shared::Mode::SessionV1})
}
pub(crate) fn project_receipt(receipt_value: &Receipt, value: &mut Value) {
    value["presentation"] = receipt(receipt_value);
    if let Some(decisions) = value["decisions"].as_array_mut() {
        for (value, decision_value) in decisions.iter_mut().zip(&receipt_value.decisions) {
            value["presentation"] = decision(decision_value);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn action_projection_is_bounded_and_redacts_nested_credentials() {
        let input = json!({"command":"curl -H 'Authorization: Bearer secret-value'","input":{"api_key":"private-value","safe":"visible"},"large":"x".repeat(8000)});
        let output = bounded(&input, 0);
        assert!(!output.to_string().contains("private-value"));
        assert!(!output.to_string().contains("secret-value"));
        assert_eq!(output["input"]["safe"], "visible");
        assert_eq!(output["large"].as_str().unwrap().len(), 1024);
    }
}
