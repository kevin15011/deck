//! Tagged approval-envelope dispatch. No missing/unknown transport defaults to a decoder.
use deck2_shared::{Decision, NativeTransport};
use serde_json::Value;

pub fn validate_native(d: &Decision) -> Result<(), String> {
    let n = d.native.as_ref().ok_or("Native action missing")?;
    match n.transport {
        Some(NativeTransport::CodexJsonRpc) => crate::codex_protocol::validate_legacy_native(d),
        Some(NativeTransport::OpencodeHttp) => {
            crate::connected_opencode::execution::validate_approval(d)
        }
        Some(NativeTransport::DeckMcp) => {
            if n.method != "deck/approve" || n.parameters.len() > 65536 {
                return Err("Native action invalid".into());
            }
            let p: Value =
                serde_json::from_str(&n.parameters).map_err(|_| "Native action corrupt")?;
            if p["threadId"] != d.thread || p["turnId"] != d.turn || d.request.is_empty() {
                return Err("Native action identity mismatch".into());
            }
            Ok(())
        }
        None => Err("Native approval transport mismatch".into()),
    }
}
/// Explicit pre-schema18 inspection; cannot authorize runtime delivery.
pub(crate) fn validate_legacy_native(d: &Decision) -> Result<(), String> {
    crate::codex_protocol::validate_legacy_native(d)
}

/// Preserve explicit transport support; Codex requires the exact validated scope.
/// OpenCode's existing backend contract stays isolated and gains no UI projection.
pub(crate) fn supports_persistent(d: &Decision) -> bool {
    if validate_native(d).is_err() { return false; }
    let Some(n) = &d.native else { return false; };
    match n.transport {
        Some(deck2_shared::NativeTransport::CodexJsonRpc) => crate::codex_protocol::persistent_grant(d).is_some(),
        Some(deck2_shared::NativeTransport::OpencodeHttp) if n.method == "permission.asked" && n.always_note.is_some() && n.identity.is_some() => {
            serde_json::from_str::<Value>(&n.parameters).ok().is_some_and(|p| {
                p["event"]["properties"]["always"].as_array().is_some_and(|a| !a.is_empty() && a.iter().all(|s| s.as_str().is_some_and(|s| !s.is_empty())))
            })
        }
        _ => false,
    }
}

/// Adapter-specific extraction stays outside the host matcher.
pub(crate) fn permission_material(d:&Decision)->Option<Value> {
    let n=d.native.as_ref()?;
    match n.transport? {
        deck2_shared::NativeTransport::CodexJsonRpc => crate::codex_protocol::permission_material(d),
        deck2_shared::NativeTransport::DeckMcp => {
            let mut p:Value=serde_json::from_str(&n.parameters).ok()?;
            if n.method!="deck/approve" || !p["_meta"]["tool_params"].is_object() || crate::codex_protocol::native_tool_name(&p)?=="AskUserQuestion" {return None;}
            let o=p.as_object_mut()?;
            for k in ["threadId","turnId","toolUseId"] {o.remove(k);}
            Some(serde_json::json!({"category":"relay","request":p}))
        }
        _=>None,
    }
}
