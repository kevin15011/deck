//! Additive presentation contract. Native envelopes remain exact private evidence;
//! callers render these bounded projections without decoding native protocols.
use deck2_shared::{Decision, NativeTransport, ProjectBinding, Receipt};
use serde_json::{Value, json};

const SENSITIVE_DISPLAY_VALUE: &str = "[Sensitive display value withheld]";

pub(crate) fn sensitive_text(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let boundary = |ch: char| !ch.is_alphanumeric();
    for marker in ["authorization", "api_key", "api-key", "apikey", "access_key", "access-key", "accesskey", "password", "passwd", "secret", "sk-", "ghp_", "github_pat_", "token", "bearer", "basic"] {
        let credential_key = !matches!(marker, "sk-" | "ghp_" | "github_pat_" | "bearer" | "basic");
        for (at, _) in lower.match_indices(marker) {
            let tail = &lower[at + marker.len()..];
            let flag_tail = tail.trim_start_matches(['\'', '"']);
            if credential_key
                && flag_tail.starts_with([' ', '\t'])
                && lower[..at]
                    .rsplit(|ch: char| !(ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.')))
                    .next()
                    .is_some_and(|prefix| prefix.starts_with("--"))
            {
                return true;
            }
            if !lower[..at].chars().next_back().is_none_or(boundary) {
                // A credential suffix can occur inside an assignment key,
                // for example clientSecret or accessToken.
                if credential_key
                    && tail.trim_start_matches([' ', '\t', '\'', '"']).starts_with(['=', ':'])
                {
                    return true;
                }
                continue;
            }
            let sensitive = match marker {
                "sk-" | "ghp_" | "github_pat_" => true,
                "token" => tail.trim_start_matches([' ', '\t', '\'', '"']).starts_with(['=', ':'])
                    || lower[..at].ends_with("--") && tail.starts_with(char::is_whitespace),
                "bearer" | "basic" => tail.starts_with(char::is_whitespace),
                _ => tail.chars().next().is_none_or(boundary),
            };
            if sensitive {
                return true;
            }
        }
    }
    lower.split("://").skip(1).any(|url| {
        let host = url.split(['/', '?', '#', '\'', '"', ' ', '\r', '\n', '\t']).next().unwrap_or_default();
        host.contains('@') || url.split_ascii_whitespace().next().is_some_and(|url| {
            url.split_once('?').is_some_and(|(_, query)| query.contains('%') || query.starts_with("key=")
                || query.contains("&key=") || query.starts_with("auth=") || query.contains("&auth=")
                || query.starts_with("signature=") || query.contains("&signature=")
                || query.starts_with("sig=") || query.contains("&sig="))
        })
    })
}

pub(crate) fn sensitive_bash(command: &str) -> bool {
    sensitive_text(command)
        || (command.contains("\\\n") && sensitive_text(&command.replace("\\\n", "")))
}

/// The review displays one quoted Bash string. Control and directional
/// characters are represented visibly, including a literal backslash.
pub(crate) fn bash_display(command: &str) -> String {
    format!("{command:?}")
}

pub(crate) fn bounded(value: &Value, depth: usize) -> Value {
    if depth > 6 {
        return json!("[Display depth limit]");
    }
    match value {
        Value::String(s) => {
            if sensitive_text(s) {
                return json!(SENSITIVE_DISPLAY_VALUE);
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
    decision_in_project(d, None)
}

fn decision_in_project(d: &Decision, project: Option<&ProjectBinding>) -> Value {
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
        Some(NativeTransport::AgyAcp) => crate::agy_approval::action_view(n, project),
        None => None,
    };
    let Some((kind, mut details)) = projected else {
        return json!({"version":1,"kind":"unavailable","validated":false,"details":Value::Null});
    };
    // Scan the raw command while shell continuations are still intact.
    if n.transport == Some(NativeTransport::CodexJsonRpc)
        && kind == "command"
        && details["command"].as_str().is_some_and(sensitive_bash)
    {
        details["command"] = json!(SENSITIVE_DISPLAY_VALUE);
    }
    let details = if kind == "bash" {
        details
    } else {
        let mut display = bounded(&details, 0);
        if n.transport == Some(NativeTransport::AgyAcp)
            && let Some(origin) = details["input"]["Url"].as_str()
        {
            // The adapter already reduced this to a parsed HTTP(S) origin.
            display["input"]["Url"] = json!(origin);
        }
        if n.transport == Some(NativeTransport::DeckMcp)
            && details["tool"].as_str().is_some_and(crate::permission_bounds::claude_mcp_tool)
        {
            display["tool"] = details["tool"].clone();
        }
        display
    };
    let details = if kind == "bash" || details.to_string().len() <= 4096 {
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
        Some(crate::member_integration::Integration::OpenCode | crate::member_integration::Integration::Claude | crate::member_integration::Integration::Agy) | None => Value::Null,
    };
    json!({"version":1,"recorded_runner":recorded,"integration_available":integration.is_some(),"reasoning":reasoning,"retained_runtime_supported":integration.is_some_and(|i|i.supports_retained_lead()) && r.mode==deck2_shared::Mode::SessionV1})
}
pub(crate) fn project_receipt(receipt_value: &Receipt, value: &mut Value) {
    value["presentation"] = receipt(receipt_value);
    let project = receipt_value
        .configuration
        .as_ref()
        .map(|snapshot| &snapshot.project);
    if let Some(decisions) = value["decisions"].as_array_mut() {
        for (value, decision_value) in decisions.iter_mut().zip(&receipt_value.decisions) {
            project_decision(decision_value, value, project);
        }
    }
}

pub(crate) fn agy_approval(d: &Decision) -> bool {
    d.native
        .as_ref()
        .is_some_and(|native| native.transport == Some(NativeTransport::AgyAcp))
}

fn project_decision(d: &Decision, value: &mut Value, project: Option<&ProjectBinding>) {
    if agy_approval(d) {
        value["presentation"] = decision_in_project(d, project);
        value.as_object_mut().unwrap().remove("native");
    } else {
        value["presentation"] = decision(d);
    }
}

pub(crate) fn approval_response(d: &Decision, project: Option<&ProjectBinding>) -> Value {
    let mut value = json!(d);
    if agy_approval(d) {
        project_decision(d, &mut value, project);
    }
    value
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
        let params = json!({"toolName":"Bash","_meta":{"tool_params":{"command":"clientSecret=FIXTURE_SENTINEL echo ready"}}});
        assert!(crate::session_mcp::action_view(&params.to_string()).is_none());
        let params = json!({"toolName":"Bash","_meta":{"tool_params":{"command":"fixture --clientSecret FIXTURE_PUBLIC_SENTINEL"}}});
        assert!(crate::session_mcp::action_view(&params.to_string()).is_none());
        let params = json!({"toolName":"Bash","_meta":{"tool_params":{"command":"fixture --clientSecret\\\n   FIXTURE_CONTINUED_SENTINEL"}}});
        assert!(crate::session_mcp::action_view(&params.to_string()).is_none());
    }
}
