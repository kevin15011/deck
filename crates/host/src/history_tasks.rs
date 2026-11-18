//! Passive task presentation. Recorded identities never become executable Tasks.
use super::{MAX_LINE, Result, error};
use serde_json::{Value, json};
use std::collections::BTreeMap;
#[derive(Default)]
pub(super) struct Index {
    tasks: BTreeMap<String, Value>,
    refs: BTreeMap<String, Vec<usize>>,
    // Lifecycle boundaries provide identity when a native message omits attempt.
    starts: BTreeMap<String, Vec<(usize, u64)>>,
}
impl Index {
    pub(super) fn observe(&mut self, e: &Value) -> Result<()> {
        let kind = e["kind"].as_str().unwrap_or("");
        let d = &e["data"];
        let source = &e["source"];
        let Some(id) = d["taskId"].as_str().or(source["taskId"].as_str()) else {
            return Ok(());
        };
        if id == "lead"
            || source["memberId"] == "lead"
            || d["memberId"] == "lead"
            || d["internal"] == true
        {
            return Ok(());
        }
        if !kind.starts_with("task.") && !kind.starts_with("message.") {
            return Ok(());
        }
        if [d.get("attempt"), source.get("attempt")]
            .into_iter()
            .flatten()
            .any(|v| !(v.is_null() || v.as_u64().is_some_and(|n| n > 0)))
        {
            return Err(error("invalid recorded task attempt"));
        }
        let seq = e["seq"].as_u64().unwrap_or(0) as usize;
        self.refs.entry(id.into()).or_default().push(seq);
        let task = self
            .tasks
            .entry(id.into())
            .or_insert_with(|| json!({"id":id,"member":null,"order":seq,"attempts":[]}));
        if let Some(member) = d["memberId"].as_str().or(source["memberId"].as_str()) {
            task["member"] = json!(member);
        }
        if matches!(kind, "task.created" | "task.continued") {
            task["order"] = json!(seq);
        }
        let attempts = task["attempts"].as_array_mut().unwrap();
        let explicit = d["attempt"]
            .as_u64()
            .or(source["attempt"].as_u64())
            .filter(|a| *a > 0);
        let previous = attempts.last().cloned();
        let number = explicit.or_else(|| match kind {
            "task.created" => Some(1),
            "task.continued" => previous
                .as_ref()
                .and_then(|a| a["number"].as_u64())
                .map(|a| a + 1),
            _ => previous.as_ref().and_then(|a| a["number"].as_u64()),
        });
        let at = attempts.iter().position(|a| a["number"].as_u64() == number);
        let at = at.unwrap_or_else(|| {
            let inherited = if kind == "task.continued" { previous.as_ref() } else { None };
            attempts.push(json!({"number":number,"state":null,"runner":inherited.map(|a|&a["runner"]),"model":inherited.map(|a|&a["model"]),"result":null}));
            self.starts.entry(id.into()).or_default().push((seq,number.unwrap_or(0)));
            attempts.len()-1
        });
        let a = &mut attempts[at];
        // Source modelId is a recorded observation, never current configuration.
        for (field, key) in [("runner", "runnerId"), ("model", "modelId")] {
            if let Some(v) = d[key].as_str().or(source[key].as_str()) {
                a[field] = json!(v);
            }
        }
        if kind == "task.created" || kind == "task.continued" {
            a["state"] = json!(d["state"].as_str().unwrap_or("created"));
        }
        if kind == "task.state"
            && let Some(state) = d["state"].as_str()
        {
            a["state"] = json!(state);
            if let Some(stop) = d.get("stopOrigin").or_else(||d.get("stop").and_then(|v|v.get("origin"))) { a["stopOrigin"] = stop.clone(); }

        }
        if kind == "task.result" && d["summary"].is_string() {
            a["result"] = json!({"seq":seq});
        }
        Ok(())
    }
    pub(super) fn attempt(&self, task: &str, seq: usize) -> Option<u64> {
        self.starts
            .get(task)?
            .iter()
            .rev()
            .find(|(start, _)| *start <= seq)
            .and_then(|(_, a)| (*a > 0).then_some(*a))
    }
    pub(super) fn refs(&self, id: &str) -> &[usize] {
        self.refs.get(id).map(Vec::as_slice).unwrap_or_default()
    }
    pub(super) fn values(&self) -> impl Iterator<Item = &Value> {
        self.tasks.values()
    }
}
/// Byte and item bounded; the cursor is used only within the pinned snapshot.
pub(super) fn page(
    values: impl Iterator<Item = Value>,
    after: Option<&str>,
) -> Result<(Vec<Value>, Option<String>)> {
    let mut rows = Vec::new();
    let mut size = 0;
    let mut more = false;
    for t in values.filter(|t| after.is_none_or(|id| t["id"].as_str().unwrap_or("") > id)) {
        let n = t.to_string().len();
        if n > MAX_LINE {
            return Err(error("recorded task exceeds presentation bound"));
        }
        if rows.len() == 20 || size + n > MAX_LINE {
            more = true;
            break;
        }
        size += n;
        rows.push(t);
    }
    let next = rows
        .last()
        .filter(|_| more)
        .and_then(|t| t["id"].as_str())
        .map(str::to_string);
    Ok((rows, next))
}

/// Materialize only a bounded candidate page; the index retains source references.
pub(super) fn materialize(
    mut task: Value,
    mut event: impl FnMut(usize) -> Result<Value>,
) -> Result<Value> {
    let mut bytes = task.to_string().len();
    for a in task["attempts"]
        .as_array_mut()
        .ok_or_else(|| error("invalid recorded attempts"))?
    {
        if let Some(seq) = a["result"]["seq"].as_u64() {
            let e = event(seq as usize)?;
            let text = e["data"]["summary"]
                .as_str()
                .ok_or_else(|| error("recorded result unavailable"))?;
            bytes += text.len();
            if bytes > MAX_LINE {
                return Err(error("recorded task exceeds presentation bound"));
            }
            a["result"] =
                json!({"seq":seq,"text":text,"digest":crate::tasks::digest(text.as_bytes()),"reportArtifact":e["data"]["reportArtifact"],"reportArtifactUnavailable":e["data"]["reportArtifactUnavailable"]});
        }
    }
    Ok(task)
}

#[cfg(test)]
mod tests {
    use super::*;
    // Protects bounded listing and unknown fields without inventing current authority.
    #[test]
    fn passive_projection_pages_unknown_attempts_and_recorded_assignments() {
        let mut index = Index::default();
        for n in 1..=45 {
            index.observe(&json!({"seq":n,"kind":"message.completed","source":{"taskId":format!("worker-{n:03}")},"data":{"text":"unattributed"}})).unwrap();
        }
        let (first, cursor) = page(index.values().cloned(), None).unwrap();
        assert_eq!(first.len(), 20);
        assert_eq!(first[0]["attempts"][0]["number"], Value::Null);
        assert_eq!(first[0]["attempts"][0]["runner"], Value::Null);
        assert_eq!(first[0]["attempts"][0]["state"], Value::Null);
        let (second, next) = page(index.values().cloned(), cursor.as_deref()).unwrap();
        let (third, end) = page(index.values().cloned(), next.as_deref()).unwrap();
        assert_eq!(second.len(), 20);
        assert_eq!(third.len(), 5);
        assert!(end.is_none());
        let ids: std::collections::BTreeSet<_> = first
            .iter()
            .chain(second.iter())
            .chain(third.iter())
            .map(|t| t["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids.len(), 45);
        assert!(index.observe(&json!({"seq":46,"kind":"task.result","source":{"taskId":"worker-001","attempt":0},"data":{"summary":"must not attach to another attempt"}})).is_err());
    }
}
