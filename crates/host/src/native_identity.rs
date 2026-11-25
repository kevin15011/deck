//! Schema18 native namespace and transport compatibility. This module never
//! discovers credentials, reconstructs executable authority or replays work.
use crate::Store;
use deck2_shared::{AdmissionSnapshot, NativeBinding, NativeRunner, NativeTransport};
use rusqlite::{Connection, params};
use serde_json::{Value, json};

impl Store {
    pub(crate) fn migrate_native_identity(&mut self) -> Result<(), String> {
        // Every pre18 production NativeContext was created by the Codex driver.
        // Add only that discriminator; preserve provenance, unknown admissions,
        // original generations and all task/result/observation records.
        self.conn.execute("UPDATE sessions SET body=json_set(body,'$.native.runner','codex') WHERE json_type(body,'$.native')='object' AND json_type(body,'$.native.runner') IS NULL", []).map_err(|_| "Cannot migrate native namespace")?;
        let mut q = self
            .conn
            .prepare("SELECT id,body FROM receipts")
            .map_err(|_| "Cannot read legacy decision transports")?;
        let rows = q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|_| "Cannot read legacy decisions")?;
        let mut updates = vec![];
        for row in rows {
            let (id, raw) = row.map_err(|_| "Cannot read legacy decision")?;
            let mut body: Value =
                serde_json::from_str(&raw).map_err(|_| "Invalid legacy receipt")?;
            let mut changed = false;
            if let Some(ds) = body["decisions"].as_array_mut() {
                for d in ds {
                    let Some(native) = d.get_mut("native").filter(|n| n.is_object()) else {
                        continue;
                    };
                    if native.get("transport").is_some() {
                        continue;
                    }
                    let method = native["method"].as_str().unwrap_or("");
                    let transport = if method == "deck/approve" {
                        Some(NativeTransport::DeckMcp)
                    } else if crate::codex_protocol::native_method(method) {
                        Some(NativeTransport::CodexJsonRpc)
                    } else {
                        None
                    };
                    if let Some(transport) = transport {
                        native["transport"] = json!(transport);
                        changed = true;
                    }
                }
            }
            if changed {
                updates.push((id, body.to_string()));
            }
        }
        drop(q);
        for (id, body) in updates {
            self.conn
                .execute("UPDATE receipts SET body=?1 WHERE id=?2", params![body, id])
                .map_err(|_| "Cannot migrate decision transport")?;
        }
        Ok(())
    }
}
fn digest(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}
pub(crate) fn validate_binding(b: &NativeBinding) -> Result<(), String> {
    let protocol = match b.runner {
        NativeRunner::Codex => "app-server",
        NativeRunner::Opencode => "http-sse",
        NativeRunner::Claude => "stream-json",
        NativeRunner::Agy => "acp",
    };
    if b.protocol != protocol
        || b.version.is_empty()
        || b.version.len() > 128
        || !std::path::Path::new(&b.executable.path).is_absolute()
        || !digest(&b.executable.executable)
        || !digest(&b.storage)
        || !digest(&b.configuration)
        || !digest(&b.role)
    {
        return Err("Invalid native admission identity".into());
    }
    Ok(())
}
fn snapshot(s: Option<&AdmissionSnapshot>) -> Result<(), String> {
    if let Some(b) = s.and_then(|s| s.native.as_ref()) {
        validate_binding(b)?;
        if s.and_then(|s| s.runner.as_ref()) != Some(&b.executable) {
            return Err("Native executable admission mismatch".into());
        }
    }
    Ok(())
}
pub(crate) fn inspect(conn: &Connection) -> Result<(), String> {
    let decode = |table: &str| -> Result<Vec<Value>, String> {
        let mut q = conn
            .prepare(&format!("SELECT body FROM {table}"))
            .map_err(|_| "Cannot inspect native identities")?;
        q.query_map([], |r| r.get::<_, String>(0))
            .map_err(|_| "Cannot inspect native identities")?
            .map(|r| {
                serde_json::from_str(&r.map_err(|_| "Cannot read native identity")?)
                    .map_err(|_| "Corrupt native identity".into())
            })
            .collect()
    };
    for v in decode("sessions")? {
        let s: deck2_shared::Session =
            serde_json::from_value(v).map_err(|_| "Invalid session namespace")?;
        if let Some(n) = s.native {
            let runner = n.runner.ok_or("Native context namespace missing")?;
            // Codex's historic IDs were not all UUIDs. Do not retroactively
            // reinterpret them or validate OpenCode IDs through that namespace.
            if n.thread.is_empty() || n.thread.len() > 256 {
                return Err("Invalid native context ID".into());
            }
            if runner == NativeRunner::Opencode
                && (!n
                    .thread
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
                    || n.provenance
                        .as_ref()
                        .is_none_or(|p| !p.runner.starts_with("opencode ") || !digest(&p.storage)))
            {
                return Err("OpenCode storage identity missing or invalid".into());
            }
            if runner == NativeRunner::Agy
                && (n.mode != deck2_shared::Mode::SessionV1 || !crate::agy::valid_id(&n.thread, 200)
                    || n.provenance.as_ref().is_none_or(|p| p.runner != crate::agy::RUNNER
                        || !digest(&p.executable) || !digest(&p.storage) || !digest(&p.content)))
            {
                return Err("Antigravity context identity missing or invalid".into());
            }
            if s.original.is_some()
                && s.original_generation == s.contract.as_ref().map(|c| c.generation)
                && runner != NativeRunner::Codex
            {
                return Err("Original context namespace mismatch".into());
            }
        }
    }
    for v in decode("receipts")? {
        let r: deck2_shared::Receipt =
            serde_json::from_value(v).map_err(|_| "Invalid native receipt")?;
        snapshot(r.configuration.as_ref())?;
        for d in r.decisions {
            if let Some(n) = &d.native {
                match n.transport {
                    Some(NativeTransport::CodexJsonRpc)
                        if crate::codex_protocol::native_method(&n.method) => {}
                    Some(NativeTransport::DeckMcp) if n.method == "deck/approve" => {}
                    Some(NativeTransport::ClaudeSdk)
                        if n.method == crate::claude::approval::METHOD => {}
                    Some(NativeTransport::AgyAcp) if n.method == crate::agy_approval::METHOD => {}
                    Some(NativeTransport::OpencodeHttp)
                        if matches!(n.method.as_str(), "permission.asked" | "question.asked") => {}
                    // Unknown legacy methods stay unknown, never acquire a transport.
                    None if !crate::codex_protocol::native_method(&n.method)
                        && n.method != "deck/approve"
                        && n.method != crate::claude::approval::METHOD
                        && n.method != crate::agy_approval::METHOD => {}
                    _ => return Err("Native decision transport mismatch".into()),
                }
            }
        }
    }
    for v in decode("tasks")? {
        let t: deck2_shared::Task = serde_json::from_value(v).map_err(|_| "Invalid native task")?;
        for a in t.attempts {
            snapshot(a.configuration.as_ref())?;
        }
    }
    Ok(())
}

/// Compatibility validation for historical producer formats. These constraints
/// inspect evidence; they never mint executable/configuration/permission identity.
pub(crate) fn validate_legacy_session(
    session: &deck2_shared::Session,
    schema: &str,
) -> Result<(), String> {
    if schema != "18"
        && session
            .native
            .as_ref()
            .is_some_and(|n| n.runner.is_some_and(|r| r != NativeRunner::Codex))
    {
        return Err("Historical native namespace mismatch".into());
    }
    if session.original.as_ref().is_some_and(|o| {
        !["14", "15", "16", "17", "18"].contains(&schema)
            || !digest(&o.fingerprint)
            || o.attempt == 0
            || uuid::Uuid::parse_str(&o.thread).is_err()
            || session.contract.as_ref().is_none_or(|c| {
                c.lead_task != o.task
                    || (session.original_generation.unwrap_or(c.generation) == c.generation
                        && c.members
                            .get("lead")
                            .is_none_or(|a| a.runner_id != "codex" || a.model_id != o.model))
                    || (["17", "18"].contains(&schema)
                        && session
                            .original_generation
                            .is_none_or(|g| g == 0 || g > c.generation))
            })
    }) || (session.original_generation.is_some()
        && (session.original.is_none() || !["17", "18"].contains(&schema)))
    {
        return Err("Historical original context invalid".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    // OPENCODE-04 oracle: identical request IDs are not interchangeable across
    // transport namespaces. A Codex writer must never deliver an HTTP approval.
    #[test]
    fn codex_reply_refuses_foreign_or_unknown_transport() {
        let mut d: deck2_shared::Decision = serde_json::from_value(json!({
            "id":"decision", "session":"session", "command":"command", "attempt":"attempt", "generation":"generation",
            "thread":"native", "turn":"turn", "item":"item", "request":"1", "revision":1, "state":"responded",
            "file":null, "questions":[], "dispatch_ms":null, "delivered_ms":null, "grant_consumed":false, "detail":"fixture",
            "native":{"transport":"codex_json_rpc", "method":"item/commandExecution/requestApproval", "parameters":"{\"threadId\":\"native\",\"turnId\":\"turn\"}", "summary":"fixture", "identity":null,"always_note":null},
            "resolution":{"api":deck2_shared::API,"command_id":"reply", "expected_revision":1,"response":{"type":"allow_once"}}
        })).unwrap();
        assert_eq!(
            crate::codex_protocol::native_reply(&d).unwrap(),
            json!({"decision":"accept"})
        );
        for transport in [
            None,
            Some(NativeTransport::OpencodeHttp),
            Some(NativeTransport::DeckMcp),
        ] {
            d.native.as_mut().unwrap().transport = transport;
            assert!(
                crate::codex_protocol::native_reply(&d).is_err(),
                "foreign transport {transport:?} acquired Codex delivery"
            );
        }
    }
}

