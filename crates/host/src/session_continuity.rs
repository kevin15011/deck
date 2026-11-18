//! Source-equivalent core/session/task-continuity.ts policy. A context capacity
//! observation cannot produce a compaction bound. Production has no qualified
//! bound producer yet; tests inject evidence at the same launch boundary.
use deck2_shared::{Task, TaskAttempt};
use serde_json::{Value, json};
fn identity(v: &Value) -> bool {
    v.as_str()
        .is_some_and(|s| !s.trim().is_empty() && s.len() <= 256)
}
fn integer(v: &Value) -> Option<u64> {
    v.as_u64().filter(|n| *n <= 9_007_199_254_740_991)
}
pub(crate) fn input(v: &Value) -> bool {
    integer(&v["tokens"]).is_some()
        && [
            "codex-last-input",
            "claude-message-input",
            "opencode-verified-input",
        ]
        .contains(&v["basis"].as_str().unwrap_or(""))
        && ["nativeThreadId", "nativeTurnId", "modelId"]
            .iter()
            .all(|k| identity(&v[k]))
        && v["final"].is_boolean()
        && ["cachedReadTokens", "cacheWriteTokens"].iter().all(|k| {
            v.get(k).is_none_or(|n| {
                integer(n)
                    .zip(integer(&v["tokens"]))
                    .is_some_and(|(a, b)| a <= b)
            })
        })
}
pub(crate) fn select(x: &Value) -> Value {
    let request = x["request"].as_str().unwrap_or("auto");
    let mut v = json!({"selectedAt":x["now"],"policy":{"mode":"policy","autoNativeMaxAgeMs":300000,"autoNativeMaxInputTokens":80000,"nativeHardCapInputTokens":160000,"handoffMaxBytes":32768},"override":if request=="native" {"refused"} else {"none"},"continuity":"reseeded"});
    if let Some(p) = x.get("policy").and_then(Value::as_object) {
        for (k, b) in p {
            v["policy"][k] = b.clone();
        }
    }
    let p = &x["predecessor"];
    let b = &x["bound"];
    let i = &p["input"];
    if input(i) {
        v["input"] = i.clone();
    }
    if !b.is_null() {
        v["bound"] = b.clone();
    }
    let reason = if x["role"] != "work" {
        if x["role"] == "review" {
            "assigned-review-role"
        } else {
            "unknown-assigned-role"
        }
    } else if request == "fresh" || v["policy"]["mode"] == "fresh" {
        "forced-fresh"
    } else if p.is_null() {
        "initial-attempt"
    } else if p["launched"] != true
        || p["nativeConfirmed"] != true
        || !identity(&p["nativeSessionId"])
        || !["completed", "cancelled", "interrupted", "failed"]
            .contains(&p["state"].as_str().unwrap_or(""))
    {
        "native-ownership-unproven"
    } else if p["state"] == "failed" {
        "failed-predecessor"
    } else if !input(i)
        || i["final"] != true
        || i["nativeThreadId"] != p["nativeSessionId"]
        || i["modelId"] != x["modelId"]
    {
        "last-request-input-unknown"
    } else if b["runnerId"] != x["runnerId"]
        || b["modelId"] != x["modelId"]
        || !["version", "configKey", "evidenceRef"]
            .iter()
            .all(|k| identity(&b[k]))
        || !["input", "input-equivalent"].contains(&b["basis"].as_str().unwrap_or(""))
        || integer(&b["inputSafeExclusiveCap"])
            .is_none_or(|n| n == 0 || integer(&b["triggerTokens"]).is_none_or(|t| n >= t))
    {
        "native-compaction-bound-unknown"
    } else {
        let cap = v["policy"]["nativeHardCapInputTokens"]
            .as_u64()
            .unwrap_or(0)
            .min(b["inputSafeExclusiveCap"].as_u64().unwrap());
        v["effectiveCap"] = json!(cap);
        if i["tokens"].as_u64().unwrap() >= cap {
            "effective-native-cap"
        } else if request == "native" {
            if !x["justification"]
                .as_str()
                .is_some_and(|s| !s.trim().is_empty() && s.len() <= 512)
            {
                "native-justification-required"
            } else {
                v["continuity"] = json!("native");
                v["override"] = json!("granted");
                "justified-native-override"
            }
        } else if p["state"] != "completed"
            && p["stopOrigin"] != "user"
            && p["stopOrigin"] != "lead"
        {
            "non-operator-predecessor"
        } else if p["integrated"] == true {
            "latest-attempt-integrated"
        } else if p["endedAt"]
            .as_u64()
            .zip(x["now"].as_u64())
            .is_none_or(|(at, now)| {
                now < at || now - at >= v["policy"]["autoNativeMaxAgeMs"].as_u64().unwrap_or(0)
            })
        {
            "predecessor-age"
        } else if i["tokens"].as_u64().unwrap()
            >= v["policy"]["autoNativeMaxInputTokens"]
                .as_u64()
                .unwrap_or(0)
        {
            "automatic-input-cap"
        } else {
            v["continuity"] = json!("native");
            "eligible-automatic-native"
        }
    };
    v["reason"] = json!(reason);
    v
}
pub(crate) fn predecessor(t: &Task, a: &TaskAttempt) -> Value {
    if let Some(p) = t.attempts.iter().take_while(|p| p.id != a.id).last() {
        let state: Value = p
            .structured
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(json!({}));
        json!({"state":p.phase,"endedAt":p.settled_ms,"launched":p.dispatch_ms.is_some(),"nativeConfirmed":p.acknowledgment_ms.is_some(),"nativeSessionId":p.native_session,"input":state["requestInput"],"integrated":p.treatments.last().is_some_and(|t|t.disposition=="adopted"),"stopOrigin":state["stopOrigin"]})
    } else {
        t.original
            .as_ref()
            .map(|o| o.predecessor.clone())
            .unwrap_or(Value::Null)
    }
}
pub(crate) fn config_key(a: &TaskAttempt) -> String {
    crate::tasks::digest(
        serde_json::to_string(&(&a.configuration, &a.provenance))
            .unwrap()
            .as_bytes(),
    )
}
pub(crate) fn launch(app: &crate::server::App, t: &Task, a: &TaskAttempt) -> Result<Value, String> {
    let state: Value = a
        .structured
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| "Corrupt continuity state")?
        .unwrap_or(json!({}));
    let role = if t.owner == "quality" {
        "review"
    } else {
        t.original
            .as_ref()
            .map(|o| o.continuity_role.as_str())
            .unwrap_or("work")
    };
    let bound: Option<Value> = {
        #[cfg(test)]
        {
            app.continuity_bound.lock().unwrap().clone()
        }
        #[cfg(not(test))]
        {
            let _ = app;
            None
        }
    };
    let runner=a.configuration.as_ref().and_then(|s|s.session_contract.as_ref()).and_then(|c|c.members.get(&t.owner)).map(|a|a.runner_id.as_str()).unwrap_or("codex");
    let version=a.configuration.as_ref().and_then(|s|s.native.as_ref()).map(|n|n.version.as_str()).unwrap_or("0.166.0");
    let bound = bound.filter(|b| b["version"] == version && b["configKey"] == config_key(a));
    let selection = select(
        &json!({"now":crate::now(),"role":role,"request":state["continuity"],"justification":state["continuityJustification"],"runnerId":runner,"modelId":a.requested_model,"bound":bound,"predecessor":predecessor(t,a)}),
    );
    Ok(selection)
}
/// Integration-normalized input evidence; no wire methods or native defaults.
pub(crate) enum InputObservation {
    Unchanged,
    Invalidated,
    Exact { tokens: u64, basis: &'static str },
}
/// Retain only exact request-input counters; finality is added after settlement.
pub(crate) fn observe(a: &mut TaskAttempt, observation: InputObservation) {
    let request_input = match observation {
        InputObservation::Unchanged => return,
        InputObservation::Invalidated => Value::Null,
        InputObservation::Exact { tokens, basis } => json!({"tokens":tokens,"basis":basis,"nativeThreadId":a.native_session,"nativeTurnId":a.native_message,"modelId":a.observed_model,"final":false}),
    };
    let mut state: Value = a.structured.as_deref()
        .and_then(|s| serde_json::from_str(s).ok()).unwrap_or(json!({}));
    state["requestInput"] = request_input;
    a.structured = Some(state.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;
    // Oracle: exact Deck1 selector order, including exclusive caps and override.
    #[test]
    fn original_selector_table() {
        let base = json!({"now":1000000,"role":"work","request":"auto","runnerId":"codex","modelId":"model","predecessor":{"state":"completed","endedAt":999999,"launched":true,"nativeConfirmed":true,"nativeSessionId":"thread","input":{"tokens":100,"basis":"codex-last-input","nativeThreadId":"thread","nativeTurnId":"turn","modelId":"model","final":true}},"bound":{"runnerId":"codex","modelId":"model","version":"0.166.0","configKey":"verified-config","inputSafeExclusiveCap":150000,"triggerTokens":160000,"basis":"input","evidenceRef":"fixture-qualified-bound"}});
        let cases: Vec<(&str, Value, &str, &str)> = vec![
            (
                "review",
                json!({"role":"review","request":"native"}),
                "assigned-review-role",
                "reseeded",
            ),
            (
                "unknown role",
                json!({"role":"unknown"}),
                "unknown-assigned-role",
                "reseeded",
            ),
            (
                "fresh",
                json!({"request":"fresh"}),
                "forced-fresh",
                "reseeded",
            ),
            (
                "initial",
                json!({"predecessor":null}),
                "initial-attempt",
                "reseeded",
            ),
            (
                "ownership",
                json!({"predecessor":{"nativeConfirmed":false}}),
                "native-ownership-unproven",
                "reseeded",
            ),
            (
                "failed",
                json!({"predecessor":{"state":"failed"}}),
                "failed-predecessor",
                "reseeded",
            ),
            (
                "nonfinal",
                json!({"predecessor":{"input":{"final":false}}}),
                "last-request-input-unknown",
                "reseeded",
            ),
            (
                "wrong thread",
                json!({"predecessor":{"input":{"nativeThreadId":"foreign"}}}),
                "last-request-input-unknown",
                "reseeded",
            ),
            (
                "wrong model",
                json!({"predecessor":{"input":{"modelId":"foreign"}}}),
                "last-request-input-unknown",
                "reseeded",
            ),
            (
                "no bound",
                json!({"bound":null}),
                "native-compaction-bound-unknown",
                "reseeded",
            ),
            (
                "wrong runner",
                json!({"bound":{"runnerId":"other"}}),
                "native-compaction-bound-unknown",
                "reseeded",
            ),
            (
                "exclusive cap",
                json!({"predecessor":{"input":{"tokens":150000}}}),
                "effective-native-cap",
                "reseeded",
            ),
            (
                "justification",
                json!({"request":"native"}),
                "native-justification-required",
                "reseeded",
            ),
            (
                "override",
                json!({"request":"native","justification":"Current work needs retained context"}),
                "justified-native-override",
                "native",
            ),
            (
                "system stop",
                json!({"predecessor":{"state":"interrupted","stopOrigin":"system"}}),
                "non-operator-predecessor",
                "reseeded",
            ),
            (
                "integrated",
                json!({"predecessor":{"integrated":true}}),
                "latest-attempt-integrated",
                "reseeded",
            ),
            (
                "age",
                json!({"predecessor":{"endedAt":700000}}),
                "predecessor-age",
                "reseeded",
            ),
            (
                "future",
                json!({"predecessor":{"endedAt":1000001}}),
                "predecessor-age",
                "reseeded",
            ),
            (
                "automatic cap",
                json!({"predecessor":{"input":{"tokens":80000}}}),
                "automatic-input-cap",
                "reseeded",
            ),
            ("eligible", json!({}), "eligible-automatic-native", "native"),
        ];
        fn merge(to: &mut Value, from: Value) {
            if let Value::Object(o) = from {
                for (k, v) in o {
                    if v.is_object() && to[&k].is_object() {
                        merge(&mut to[&k], v)
                    } else {
                        to[&k] = v;
                    }
                }
            } else {
                *to = from;
            }
        }
        for (label, delta, reason, continuity) in cases {
            let mut x = base.clone();
            merge(&mut x, delta);
            let s = select(&x);
            assert_eq!(s["reason"], reason, "{label}");
            assert_eq!(s["continuity"], continuity, "{label}");
        }
    }
}
