//! Disposable conversation index matching Deck1 ChatHistory. Rows retain source
//! sequence references, never executable state or an all-history browser payload.
use super::{Result, Snapshot, error};
use serde_json::{Value, json};
use std::collections::BTreeMap;
#[derive(Default)]
pub(super) struct Index {
    rows: Vec<Row>,
    pending: BTreeMap<String, usize>,
    requests: BTreeMap<String, usize>,
    queued: BTreeMap<String, usize>,
    steered: BTreeMap<String, usize>,
}
struct Row {
    id: usize,
    task: String,
    lead: bool,
    seqs: Vec<usize>,
    request: Option<usize>,
    steering: Option<(usize, usize, usize)>,
}
fn text(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
impl Index {
    fn add(&mut self, e: &Value, request: Option<usize>) -> usize {
        let task = e["source"]["taskId"].as_str().unwrap_or("lead").to_string();
        let lead = e["source"]["memberId"]
            .as_str()
            .map_or(task == "lead", |m| m == "lead");
        let seq = e["seq"].as_u64().unwrap() as usize;
        let index = self.rows.len();
        self.rows.push(Row {
            id: seq,
            task,
            lead,
            seqs: vec![seq],
            request,
            steering: None,
        });
        index
    }
    pub(super) fn apply(&mut self, original: &Value, s: &Snapshot) -> Result<()> {
        let mut e = original.clone();
        let kind = text(&e["kind"]).to_string();
        let seq = e["seq"].as_u64().unwrap() as usize;
        let prompt = text(&e["data"]["promptId"]).to_string();
        if matches!(kind.as_str(), "prompt.queued" | "prompt.requeued") {
            self.queued.insert(prompt.clone(), seq);
        }
        if matches!(kind.as_str(), "prompt.dispatched" | "prompt.state") {
            self.queued.remove(&prompt);
        }
        if kind == "prompt.steered"
            && e["data"]["state"] == "accepted"
            && e["source"]["runnerId"].is_null()
            && !self.steered.contains_key(&prompt)
        {
            if let (Some(fence), Some(queued)) = (
                e["data"]["steeringSeq"].as_u64(),
                self.queued.get(&prompt).copied(),
            ) {
                let fence = fence as usize;
                if fence > 0 && fence <= s.records.len() {
                    let f = s.event(fence)?;
                    if f["kind"] == "prompt.steering"
                        && f["source"]["runnerId"].is_null()
                        && f["data"]["promptId"] == prompt
                    {
                        let at = self.add(&e, None);
                        let row = &mut self.rows[at];
                        row.id = fence;
                        row.task = text(&f["data"]["taskId"]).to_string();
                        row.lead = true;
                        row.steering = Some((queued, fence, seq));
                        self.steered.insert(prompt.clone(), at);
                        self.queued.remove(&prompt);
                    }
                }
            }
            return Ok(());
        }
        let key = if kind.starts_with("question.") {
            format!("q:{}", text(&e["data"]["questionId"]))
        } else {
            format!("a:{}", text(&e["data"]["approvalId"]))
        };
        if matches!(kind.as_str(), "question.requested" | "approval.requested") {
            self.requests.insert(key.clone(), seq);
        }
        let request = self.requests.get(&key).copied();
        if matches!(kind.as_str(), "question.resolved" | "approval.resolved") {
            self.requests.remove(&key);
        }
        if let Some(request) = request {
            let origin = s.event(request)?;
            let mut source = origin["source"].as_object().unwrap().clone();
            source.extend(e["source"].as_object().unwrap().clone());
            e["source"] = Value::Object(source);
            if origin["data"]["internal"] == true {
                e["data"]["internal"] = json!(true);
            }
        }
        if kind == "session.ended" {
            self.pending.clear();
        }
        if e["data"]["internal"] == true || e["data"]["role"] == "system" {
            return Ok(());
        }
        let task = e["source"]["taskId"].as_str().unwrap_or("lead").to_string();
        if matches!(
            kind.as_str(),
            "turn.started" | "turn.completed" | "task.continued" | "question.resolved"
        ) {
            self.pending.remove(&task);
        }
        match kind.as_str() {
            "message.delta" => {
                if let Some(at) = self.pending.get(&task) {
                    self.rows[*at].seqs.push(seq);
                } else {
                    let at = self.add(&e, None);
                    self.pending.insert(task, at);
                }
            }
            "message.completed" => {
                if let Some(at) = self.steered.get(&prompt) {
                    let row = &mut self.rows[*at];
                    if e["data"]["role"] == "user"
                        && e["data"]["steering"] == true
                        && e["source"]["runnerId"].is_null()
                        && e["data"]["steeringSeq"].as_u64() == Some(row.id as u64)
                    {
                        row.seqs = vec![seq];
                        return Ok(());
                    }
                }
                if e["data"]["role"] != "user"
                    && let Some(at) = self.pending.remove(&task)
                {
                    self.rows[at].seqs = vec![seq];
                } else {
                    self.add(&e, None);
                }
            }
            "question.resolved" => {
                self.add(&e, request);
            }
            "approval.resolved"
                if e["data"]["auto"] == true
                    && text(&e["data"]["by"]).starts_with("session-grant:") =>
            {
                self.add(&e, request);
            }
            "turn.completed" if e["data"]["status"] == "failed" => {
                self.add(&e, request);
            }
            _ => {}
        }
        Ok(())
    }
    fn materialize(&self, row: &Row, s: &Snapshot) -> Result<Value> {
        let mut first = s.event(row.seqs[0])?;
        if let Some((prompt, fence, receipt)) = row.steering {
            let prompt = s.event(prompt)?;
            let fence = s.event(fence)?;
            let receipt = s.event(receipt)?;
            first["kind"] = json!("message.completed");
            first["source"] = json!({"taskId":row.task,"memberId":"lead"});
            first["ts"] = fence["ts"].clone();
            first["data"] = json!({"role":"user","text":prompt["data"]["text"],"promptId":prompt["data"]["promptId"],"steering":true,"steeringSeq":row.id,"steeringRunnerId":fence["data"]["runnerId"],"historical":receipt["data"]["eligible"]!=true});
            if receipt["data"]["stale"] == true {
                first["data"]["decisionReply"] = json!({"stale":true});
            }
        } else {
            if first["kind"] == "message.delta" {
                let mut joined = String::new();
                for seq in &row.seqs {
                    let e = s.event(*seq)?;
                    joined.push_str(
                        e["data"]["text"]
                            .as_str()
                            .or_else(|| e["data"]["delta"].as_str())
                            .unwrap_or(""),
                    );
                    if joined.len() > super::MAX_LINE {
                        return Err(error("conversation message exceeds bound"));
                    }
                }
                first["data"]["text"] = json!(joined);
            }
            if let Some(request) = row.request {
                first["request"] = s.event(request)?;
            }
            first["seq"] = json!(row.seqs.last());
        }
        first["historyId"] = json!(row.id);
        first["historyAttempt"] = first["source"]["attempt"].as_u64().or_else(||s.task_history.attempt(&row.task,row.id)).map_or(Value::Null,|a|json!(a));
        Ok(first)
    }
    pub(super) fn visit(
        &self,
        s: &Snapshot,
        mut effect: impl FnMut(usize, &str, bool, Value) -> Result<()>,
    ) -> Result<()> {
        for row in &self.rows {
            effect(row.id, &row.task, row.lead, self.materialize(row, s)?)?;
        }
        Ok(())
    }
    pub(super) fn page(
        &self,
        s: &Snapshot,
        task: Option<&str>,
        attempt: Option<u64>,
        before: Option<usize>,
        after: Option<usize>,
        limit: usize,
    ) -> Result<Value> {
        let mut rows = Vec::new();
        for row in self.rows.iter().filter(|r| task.map_or(r.lead, |t|r.task == t)) {
            if let Some(attempt) = attempt {
                let e = s.event(row.seqs[0])?;
                if e["source"]["attempt"].as_u64().or_else(||s.task_history.attempt(&row.task,row.id)) != (attempt>0).then_some(attempt) {continue;}
            }
            rows.push(row);
        }
        rows.sort_by_key(|r| r.id);
        let end = before.map_or(rows.len(), |id| rows.partition_point(|r| r.id < id));
        let start = after.map_or(end.saturating_sub(limit), |id| {
            rows.partition_point(|r| r.id <= id)
        });
        let end = if after.is_some() {
            rows.len().min(start + limit)
        } else {
            end
        };
        if start > end {
            return Err(error("invalid conversation cursor"));
        }
        let mut messages = Vec::new();
        let mut size = 0;
        let mut first_index = end;
        let mut last_index = start;
        let indices: Box<dyn Iterator<Item = usize>> = if after.is_some() {
            Box::new(start..end)
        } else {
            Box::new((start..end).rev())
        };
        for i in indices {
            let message = self.materialize(rows[i], s)?;
            let n = message.to_string().len();
            if size + n > super::MAX_LINE {
                if messages.is_empty() {
                    return Err(error("conversation message exceeds page bound"));
                }
                break;
            }
            size += n;
            messages.push(message);
            first_index = first_index.min(i);
            last_index = last_index.max(i + 1);
        }
        if after.is_none() {
            messages.reverse();
        }
        let before = if first_index > 0 && !messages.is_empty() {
            Some(rows[first_index].id)
        } else {
            None
        };
        let after = if last_index < rows.len() && !messages.is_empty() {
            Some(rows[last_index - 1].id)
        } else {
            None
        };
        let tasks: Vec<_> = self
            .rows
            .iter()
            .map(|r| r.task.clone())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        Ok(
            json!({"metadata":s.metadata,"summary":s.summary,"snapshot":s.id,"boundary":s.records.len(),"messages":messages,"before":before,"after":after,"tasks":tasks,"issue":s.issue}),
        )
    }
}
