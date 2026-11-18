//! Original restart disposition, separate from immutable source events. Historical
//! inputs, questions, approvals and member results are never executable work here.
use super::*;

pub(super) fn terminal(state: &str) -> bool {
    matches!(state, "completed" | "failed" | "cancelled" | "interrupted")
}
#[derive(Default)]
pub(super) struct Recovery {
    tasks: BTreeMap<String, Value>,
    prompts: BTreeMap<String, Value>,
    guarded: bool,
}
impl Recovery {
    fn bind_prompt(&mut self, data: &Value, task: &str, attempt: u64) -> Value {
        if let Some(id) = data["promptId"].as_str()
            && let Some(p) = self.prompts.get_mut(id)
            && p["state"] == "queued"
        {
            p["taskId"] = json!(task);
            p["attempt"] = json!(attempt);
            return json!(id);
        }
        Value::Null
    }
    pub(super) fn observe(&mut self, e: &Value) -> Result<()> {
        let d = &e["data"];
        let task = d["taskId"]
            .as_str()
            .or(e["source"]["taskId"].as_str())
            .unwrap_or("");
        match e["kind"].as_str().unwrap_or("") {
            "session.state" => {
                self.guarded |=
                    d["state"] == "ended" || d["state"] == "stopping" || d["cancelPrompts"] == true
            }
            "session.ended" | "session.released" | "session.removed" => self.guarded = true,
            // Only an explicit successful original reopen clears its lifecycle fence.
            "session.reopened" if d["prepared"] == true => self.guarded = false,
            "task.created" => {
                if !safe(task) || self.tasks.contains_key(task) {
                    return Err(error("invalid original task provenance"));
                }
                let state = d["state"].as_str().unwrap_or("created");
                let prompt = self.bind_prompt(d, task, 1);
                self.tasks.insert(task.into(), json!({"attempt":1,"sourceState":state,"dispatched":state=="running","prompt":prompt}));
            }
            "task.continued" => {
                let previous = self
                    .tasks
                    .get(task)
                    .ok_or_else(|| error("unknown original task continuation"))?;
                let attempt = previous["attempt"].as_u64().unwrap() + 1;
                if !terminal(previous["sourceState"].as_str().unwrap_or(""))
                    || d["attempt"].as_u64().is_some_and(|n| n != attempt)
                {
                    return Err(error("invalid original attempt provenance"));
                }
                let prompt = self.bind_prompt(d, task, attempt);
                self.tasks.insert(task.into(),json!({"attempt":attempt,"sourceState":"created","dispatched":false,"prompt":prompt}));
            }
            "task.state" => {
                let t = self
                    .tasks
                    .get_mut(task)
                    .ok_or_else(|| error("unknown original task state"))?;
                let state = d["state"]
                    .as_str()
                    .ok_or_else(|| error("invalid original task state"))?;
                t["sourceState"] = json!(state);
                if state == "running" {
                    t["dispatched"] = json!(true);
                }
            }
            "prompt.queued"
                if d["promptId"].is_string()
                    && d["text"].is_string()
                    && d["textHash"].is_string() =>
            {
                self.prompts
                    .entry(d["promptId"].as_str().unwrap().into())
                    .or_insert(
                        json!({"state":"queued","by":d["by"],"attachments":d["attachments"]}),
                    );
            }
            "prompt.dispatched" => {
                if let Some(p) = d["promptId"]
                    .as_str()
                    .and_then(|id| self.prompts.get_mut(id))
                    && (p["state"] == "queued" || d["reseeded"] == true)
                {
                    p["state"] = json!("dispatched");
                    p["taskId"] = d["taskId"].clone();
                    p["attempt"] = d["attempt"].clone();
                    if d["handoff"] == "gated" {
                        p["handoff"] = json!("pending");
                    }
                }
            }
            "prompt.handoff" => {
                if let Some(p) = d["promptId"]
                    .as_str()
                    .and_then(|id| self.prompts.get_mut(id))
                    && (p["taskId"] == d["taskId"]
                        && p["attempt"] == d["attempt"]
                        && (p["handoff"] == "pending" && d["state"] == "sending"
                            || p["handoff"] == "sending"
                                && matches!(d["state"].as_str(), Some("delivered" | "unknown"))))
                {
                    p["handoff"] = d["state"].clone();
                }
            }
            "prompt.requeued" => {
                if let Some(p) = d["promptId"]
                    .as_str()
                    .and_then(|id| self.prompts.get_mut(id))
                    && ((p["state"] == "queued" || p["handoff"] == "pending")
                        && (d.get("taskId").is_none()
                            || p["taskId"] == d["taskId"] && p["attempt"] == d["attempt"]))
                {
                    p["state"] = json!("queued");
                    for key in ["taskId", "attempt", "handoff"] {
                        p.as_object_mut().unwrap().remove(key);
                    }
                }
            }
            "prompt.steering" => {
                if let Some(p) = d["promptId"]
                    .as_str()
                    .and_then(|id| self.prompts.get_mut(id))
                    && (p["state"] == "queued"
                        && p["by"] != "daemon"
                        && p["attachments"].as_array().is_none_or(|a| a.is_empty()))
                {
                    p["state"] = json!("steering");
                    p["taskId"] = d["taskId"].clone();
                    p["attempt"] = d["attempt"].clone();
                    p["steering"] = json!({"seq":e["seq"],"state":"pending"});
                }
            }
            "prompt.steered" => {
                if let Some(p) = d["promptId"]
                    .as_str()
                    .and_then(|id| self.prompts.get_mut(id))
                {
                    let fence = &p["steering"];
                    if fence.is_object()
                        && fence["seq"] == d["steeringSeq"]
                        && !matches!(fence["state"].as_str(), Some("accepted" | "not-accepted"))
                    {
                        let fallback = d["state"] == "not-accepted"
                            && d["queueFallback"] == true
                            && fence["state"] == "pending";
                        p["steering"]["state"] = json!(match d["state"].as_str() {
                            Some("accepted") => "accepted",
                            Some("not-accepted") => "not-accepted",
                            _ => "unknown",
                        });
                        p["state"] = json!(if fallback {
                            "queued"
                        } else {
                            "delivered-or-unknown"
                        });
                    }
                }
            }
            "prompt.state"
                if matches!(
                    d["state"].as_str(),
                    Some(
                        "completed"
                            | "failed"
                            | "interrupted"
                            | "cancelled"
                            | "ownership-unsettled"
                    )
                ) =>
            {
                if let Some(p) = d["promptId"]
                    .as_str()
                    .and_then(|id| self.prompts.get_mut(id))
                {
                    p["state"] = d["state"].clone();
                }
            }
            _ => {}
        }
        Ok(())
    }
    pub(super) fn finish(mut self, dir: &File) -> Result<Value> {
        owner::settled(dir)?;
        for (id, t) in &mut self.tasks {
            let state = t["sourceState"].as_str().unwrap_or("");
            if !terminal(state) {
                if !matches!(
                    state,
                    "created" | "queued" | "running" | "ownership-unsettled"
                ) {
                    return Err(error("unknown original task disposition"));
                }
                let lease = has_lease(dir, id)?;
                let queued = t["prompt"].as_str().is_some_and(|p| {
                    self.prompts.get(p).is_some_and(|p| {
                        p["state"] == "queued" && p["taskId"] == *id && p["attempt"] == t["attempt"]
                    })
                });
                // Missing running leases are never cleared by mere absence of a
                // socket or an unrelated queued input. Original prompt binding is required.
                let never_dispatched =
                    queued || t["dispatched"] != true && matches!(state, "created" | "queued");
                if !(lease || never_dispatched) {
                    return Err(error("dispatched original work has no containment proof"));
                }
                t["reason"] = json!(if lease {
                    "process-containment-settled"
                } else {
                    "never-dispatched"
                });
                t["state"] = json!("interrupted");
            } else {
                t["state"] = t["sourceState"].clone();
            }
            t.as_object_mut().unwrap().remove("prompt");
            t.as_object_mut().unwrap().remove("dispatched");
        }
        Ok(
            json!({"version":1,"guarded":self.guarded,"reason":"original-restart","tasks":self.tasks,"replay":"disabled"}),
        )
    }
}
fn has_lease(dir: &File, task: &str) -> Result<bool> {
    if !names(dir, 100_000)?.iter().any(|n| n == "tasks") {
        return Ok(false);
    }
    let tasks = at(dir, "tasks", true)?;
    if !names(&tasks, 100_000)?.iter().any(|n| n == task) {
        return Ok(false);
    }
    Ok(names(&at(&tasks, task, true)?, 1000)?
        .iter()
        .any(|n| n == "lease.json"))
}
/// Repeat containment observation at activation/launch, including proof that a
/// previously dispatched task's lease has not disappeared since adoption.
pub(super) fn revalidate(dir: &File, projection: &Value) -> Result<()> {
    owner::settled(dir)?;
    for (id, t) in projection["tasks"]
        .as_object()
        .ok_or_else(|| error("invalid recovery projection"))?
    {
        if t["reason"] == "process-containment-settled" && !has_lease(dir, id)? {
            return Err(error("original containment proof disappeared"));
        }
    }
    Ok(())
}

/// Saved proofs may be stronger than today's observations, never silently replaced.
pub(super) fn validate_saved(saved: &Value, derived: &Value) -> Result<()> {
    let mut normalized = saved.clone();
    if let Some(tasks) = normalized["tasks"].as_object_mut() {
        for (id, t) in tasks {
            let expected = &derived["tasks"][id];
            if expected["state"] == "interrupted"
                && !terminal(expected["sourceState"].as_str().unwrap_or(""))
            {
                if !matches!(
                    t["reason"].as_str(),
                    Some("never-dispatched" | "process-containment-settled")
                ) {
                    return Err(error("invalid saved recovery proof"));
                }
                // A weaker stored claim must still be supported by the retained events.
                if t["reason"] == "never-dispatched" && expected["reason"] != "never-dispatched" {
                    // Current lease presence can add proof, but cannot establish the old absence claim.
                    return Err(error("saved recovery proof changed"));
                }
                t["reason"] = expected["reason"].clone();
            }
        }
    }
    if normalized != *derived {
        return Err(error("saved recovery projection differs from source"));
    }
    Ok(())
}
