//! Direct Rust port of core/session/task-handoff.ts: structured Lead claims are
//! bounded evidence; neither prose nor a member report changes their authority.
use crate::Store;
use serde_json::{Value, json};
fn text(v: &Value, max: usize) -> bool {
    v.as_str()
        .is_some_and(|s| !s.trim().is_empty() && s.encode_utf16().count() <= max)
}
fn id(v: &Value) -> bool {
    text(v, 64)
        && v.as_str().is_some_and(|s| {
            s.bytes()
                .enumerate()
                .all(|(i, b)| b.is_ascii_alphanumeric() || (i > 0 && b"._:-".contains(&b)))
        })
}
fn keys(v: &Value, allowed: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|v| v.keys().all(|k| allowed.contains(&k.as_str())))
}
fn seqs(v: &Value) -> bool {
    v.as_array().is_some_and(|v| {
        !v.is_empty()
            && v.len() <= 16
            && unique(v)
            && v.iter().all(|n| {
                n.as_u64()
                    .is_some_and(|n| n > 0 && n <= 9_007_199_254_740_991)
            })
    })
}
fn unique(v: &[Value]) -> bool {
    let mut seen = std::collections::BTreeSet::new();
    v.iter().all(|v| seen.insert(v.to_string()))
}
fn relative(v: &Value) -> bool {
    text(v, 512)
        && v.as_str().is_some_and(|s| {
            !s.starts_with('/')
                && !s.contains(['\\', ':'])
                && !s.split('/').any(|s| s.is_empty() || s == "." || s == "..")
                && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        })
}
fn active(v: &Value) -> bool {
    v == "open" || v == "blocker"
}
fn source(store: &Store, session: &str, v: &Value, records:&[Value]) -> bool {
    if !text(&v["taskId"], 128) || v["attempt"].as_u64().is_none_or(|n| n == 0) {
        return false;
    }
    let current=store.logical_task(session,v["taskId"].as_str().unwrap()).is_ok_and(|t| {
        t.session == session
            && v["attempt"]
                .as_u64()
                .and_then(|n| t.attempt_index(n).map(|i|&t.attempts[i]))
                .is_some_and(|a| {
                    !a.phase.active()
                        && a.phase != deck2_shared::Phase::Uncertain
                        && a.report.is_some()
                })
    });
    current || records.iter().any(|t|t["id"]==v["taskId"] && t["attempts"].as_array().is_some_and(|items|items.iter().any(|a|a["number"]==v["attempt"] && a["result"].is_object() && ["completed","failed","cancelled","interrupted"].contains(&a["state"].as_str().unwrap_or("")))))
}
fn event(store: &Store, session: &str, v: &Value) -> bool {
    v.as_i64().is_some_and(|seq| {
        store
            .conn
            .query_row(
                "SELECT session FROM session_events WHERE seq=?1",
                [seq],
                |r| r.get::<_, String>(0),
            )
            .is_ok_and(|s| s == session)
    })
}
pub fn merge(
    store: &Store,
    session: &str,
    prior: Option<&str>,
    update: &Value,
) -> Result<Value, String> {
    merge_with_history(store,session,prior,update,&[])
}
pub(crate) fn merge_with_history(store:&Store,session:&str,prior:Option<&str>,update:&Value,records:&[Value])->Result<Value,String> {
    let invalid = "Invalid structured task claims or foreign evidence";
    let mut next = match prior {
        Some(s) => serde_json::from_str::<Value>(s).map_err(|_| invalid)?,
        None => json!({}),
    };
    if !next.is_object() || !update.is_object() {
        return Err(invalid.into());
    }
    if let Some(a) = update.get("acceptance") {
        if !keys(a, &["items", "refs"]) || a.to_string().len() > 8192 {
            return Err(invalid.into());
        }
        let items = a["items"]
            .as_array()
            .filter(|v| v.len() <= 32)
            .ok_or(invalid)?;
        if !unique(&items.iter().map(|i| i["id"].clone()).collect::<Vec<_>>())
            || items
                .iter()
                .any(|i| !keys(i, &["id", "text"]) || !id(&i["id"]) || !text(&i["text"], 1024))
        {
            return Err(invalid.into());
        }
        if let Some(refs) = a.get("refs")
            && !refs.as_array().is_some_and(|v| {
                v.len() <= 16
                    && v.iter().all(|r| {
                        keys(r, &["path", "anchor"])
                            && relative(&r["path"])
                            && r.get("anchor").is_none_or(|v| text(v, 128))
                    })
            })
        {
            return Err(invalid.into());
        }
        next["acceptance"] = a.clone();
    }
    if let Some(refs) = update.get("sourceTasks") {
        if !refs.as_array().is_some_and(|v| {
            v.len() <= 8
                && unique(v)
                && v.iter()
                    .all(|r| keys(r, &["taskId", "attempt"]) && source(store, session, r,records))
        }) {
            return Err(invalid.into());
        }
        next["sourceTasks"] = refs.clone();
        next["historicalSources"]=json!(records.iter().filter(|t|refs.as_array().unwrap().iter().any(|r|r["taskId"]==t["id"])).map(|t|json!({"taskId":t["id"],"source":t["evidenceSource"]})).collect::<Vec<_>>());
    }
    if let Some(f) = update.get("findings") {
        if !keys(f, &["mode", "items"])
            || f.get("mode")
                .is_some_and(|v| v != "merge" && v != "replace")
        {
            return Err(invalid.into());
        }
        let items = f["items"]
            .as_array()
            .filter(|v| v.len() <= 128)
            .ok_or(invalid)?;
        if !unique(&items.iter().map(|i| i["id"].clone()).collect::<Vec<_>>()) {
            return Err(invalid.into());
        }
        let prior = next["findings"].as_array().cloned().unwrap_or_default();
        if f["mode"] == "replace"
            && prior
                .iter()
                .any(|old| !items.iter().any(|i| i["id"] == old["id"]))
        {
            return Err("Findings replacement would drop an unresolved finding".into());
        }
        let mut findings = prior;
        let mut states = next["findingStates"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        for item in items {
            if !keys(
                item,
                &[
                    "id",
                    "state",
                    "severity",
                    "text",
                    "resolution",
                    "evidenceSeqs",
                    "source",
                ],
            ) || !id(&item["id"])
                || !["open", "blocker", "resolved", "wontfix"]
                    .iter()
                    .any(|s| item["state"] == *s)
                || !text(&item["text"], 1024)
                || item
                    .get("severity")
                    .is_some_and(|v| !["blocker", "major", "minor", "info"].iter().any(|s| v == s))
                || item.get("resolution").is_some_and(|v| !text(v, 512))
                || item.get("evidenceSeqs").is_some_and(|v| {
                    !seqs(v)
                        || !v
                            .as_array()
                            .unwrap()
                            .iter()
                            .all(|v| event(store, session, v))
                })
                || item.get("source").is_some_and(|v| {
                    !keys(v, &["taskId", "attempt", "findingId"])
                        || !source(store, session, v,records)
                        || v.get("findingId").is_some_and(|v| !id(v))
                })
            {
                return Err(invalid.into());
            }
            let key = item["id"].as_str().unwrap();
            let old = states.get(key).map(|s| &s["state"]);
            let reopening = old.is_some_and(|v| !active(v)) && active(&item["state"]);
            if (!active(&item["state"]) || reopening)
                && (!text(&item["resolution"], 512) || !seqs(&item["evidenceSeqs"]))
            {
                return Err(
                    "Finding transition requires explicit reason and recorded evidence".into(),
                );
            }
            findings.retain(|i| i["id"] != item["id"]);
            if active(&item["state"]) {
                findings.push(item.clone());
            }
            states.insert(key.into(), json!({"state":item["state"],"seq":0}));
        }
        if findings.len() > 64
            || serde_json::to_string(&findings).map_err(|_| invalid)?.len() > 8192
            || states.len() > 1024
        {
            return Err("Structured task state exceeds original bounds".into());
        }
        next["findings"] = json!(findings);
        next["findingStates"] = json!(states);
    }
    Ok(next)
}

/// Apply only explicit scoped Lead resolutions. Integration by itself leaves
/// every finding untouched; evidence must refer to this session's ledger.
pub fn resolutions(
    store: &Store,
    session: &str,
    target: &mut deck2_shared::Task,
    input: &Value,
) -> Result<Vec<deck2_shared::Task>, String> {
    let Some(input) = input.get("findingResolutions") else {
        return Ok(vec![]);
    };
    let items = input
        .as_array()
        .filter(|v| v.len() <= 64 && unique(v))
        .ok_or("Invalid finding resolutions")?;
    let mut tasks = std::collections::BTreeMap::new();
    tasks.insert(target.logical_id().to_string(), target.clone());
    let mut seen = std::collections::BTreeSet::new();
    for item in items {
        if !keys(
            item,
            &["taskId", "findingId", "state", "reason", "evidenceSeqs"],
        ) || !text(&item["taskId"], 128)
            || !id(&item["findingId"])
            || !text(&item["reason"], 512)
            || !seqs(&item["evidenceSeqs"])
            || !item["evidenceSeqs"]
                .as_array()
                .unwrap()
                .iter()
                .all(|v| event(store, session, v))
            || !["resolved", "wontfix", "open", "blocker"]
                .iter()
                .any(|s| item["state"] == *s)
        {
            return Err("Invalid finding resolution or foreign evidence".into());
        }
        let tid = item["taskId"].as_str().unwrap();
        let fid = item["findingId"].as_str().unwrap();
        if !seen.insert((tid.to_string(), fid.to_string())) {
            return Err("Duplicate finding resolution".into());
        }
        if !tasks.contains_key(tid) {
            let t = store.logical_task(session,tid)?;
            if t.session != session {
                return Err("Foreign finding task".into());
            }
            tasks.insert(tid.into(), t);
        }
        let t = tasks.get_mut(tid).unwrap();
        let prior = t.structured.as_deref().ok_or("Unknown finding")?;
        let state: Value = serde_json::from_str(prior).map_err(|_| "Corrupt findings")?;
        let mut finding = state["findings"]
            .as_array()
            .and_then(|v| v.iter().find(|f| f["id"] == fid))
            .cloned()
            .or_else(|| t.original.as_ref().and_then(|o|o.claims["historicalFindingDefinitions"].get(fid)).cloned())
            .or_else(|| historical_finding(store, tid, fid).ok().flatten())
            .ok_or("Unknown finding history")?;
        finding.as_object_mut().ok_or("Corrupt historical finding")?.remove("source");
        finding["state"] = item["state"].clone();
        finding["resolution"] = item["reason"].clone();
        finding["evidenceSeqs"] = item["evidenceSeqs"].clone();
        t.structured = Some(
            merge(
                store,
                session,
                Some(prior),
                &json!({"findings":{"items":[finding]}}),
            )?
            .to_string(),
        );
    }
    *target = tasks.remove(target.logical_id()).unwrap();
    Ok(tasks.into_values().collect())
}

fn historical_finding(store: &Store, task: &str, id: &str) -> Result<Option<Value>, String> {
    let mut q=store.conn.prepare("SELECT payload FROM task_calls WHERE json_extract(result,'$.taskId')=?1 ORDER BY rowid DESC").map_err(|_|"Cannot read finding history")?;
    for row in q
        .query_map([task], |r| r.get::<_, String>(0))
        .map_err(|_| "Cannot read finding history")?
    {
        let (_, operation): (String, crate::tasks::Operation) =
            serde_json::from_str(&row.map_err(|_| "Cannot read finding history")?)
                .map_err(|_| "Corrupt finding history")?;
        let (_, args): (String, Value) =
            serde_json::from_str(&operation.prompt).map_err(|_| "Corrupt finding history")?;
        if let Some(f) = args["findings"]["items"]
            .as_array()
            .and_then(|v| v.iter().find(|f| f["id"] == id))
        {
            return Ok(Some(f.clone()));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn omitted_claims_inherit_and_unresolved_findings_cannot_disappear() {
        let store = Store::open_memory("/fixture").unwrap();
        let first=merge(&store,"session",None,&json!({"acceptance":{"items":[{"id":"A1","text":"Preserve original behavior"}]},"findings":{"items":[{"id":"F1","state":"open","text":"Unresolved behavior"}]}})).unwrap();
        let prior = first.to_string();
        assert_eq!(
            merge(&store, "session", Some(&prior), &json!({})).unwrap(),
            first
        );
        assert!(
            merge(
                &store,
                "session",
                Some(&prior),
                &json!({"findings":{"mode":"replace","items":[]}})
            )
            .is_err()
        );
        assert!(merge(&store,"session",Some(&prior),&json!({"findings":{"items":[{"id":"F1","state":"resolved","text":"Unresolved behavior","resolution":"Claimed fixed","evidenceSeqs":[999]}]}})).is_err());
        let cleared = merge(
            &store,
            "session",
            Some(&prior),
            &json!({"acceptance":{"items":[]}}),
        )
        .unwrap();
        assert_eq!(cleared["acceptance"]["items"], json!([]));
        assert_eq!(cleared["findings"], first["findings"]);
    }
    #[test]
    fn foreign_sources_invalid_refs_and_unknown_severities_are_rejected() {
        let store = Store::open_memory("/fixture").unwrap();
        for update in [
            json!({"sourceTasks":[{"taskId":"foreign-task","attempt":1}]}),
            json!({"acceptance":{"items":[],"refs":[{"path":"../outside"}]}}),
            json!({"findings":{"items":[{"id":"F1","state":"open","severity":"medium","text":"Unsupported severity"}]}}),
        ] {
            assert!(merge(&store, "session", None, &update).is_err());
        }
    }
}
