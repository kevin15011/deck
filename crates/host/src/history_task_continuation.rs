//! Lifecycle evidence for explicit original-task binding. Display projections
//! intentionally cannot supply execution identity or authorization.
use super::*;
use deck2_shared::{OriginalTaskBinding, Session};
use rusqlite::params;
impl Reader {
    pub(crate) fn task_records(&self, s: &Session) -> Result<Vec<Value>> {
        let Some(original) = &s.original else {
            return Ok(vec![]);
        };
        let db = self
            .database
            .as_ref()
            .ok_or_else(|| error("adoption incomplete"))?;
        db.verify_snapshot(&s.id, &original.fingerprint)?;
        let mut q = db
            .conn
            .prepare("SELECT body FROM original_task_views WHERE session=?1 ORDER BY id")
            .map_err(|_| error("task history unavailable"))?;
        q.query_map([&s.id],|r|r.get::<_,String>(0)).map_err(|_|error("task history unavailable"))?.map(|row| {
            let t:Value=serde_json::from_str(&row.map_err(|_|error("task history unavailable"))?).map_err(|_|error("corrupt task history"))?;
            let mut value=task_history::materialize(t,|seq| {
                let raw:Vec<u8>=db.conn.query_row("SELECT raw FROM original_events WHERE session=?1 AND seq=?2",params![s.id,seq as i64],|r|r.get(0)).map_err(|_|error("task evidence unavailable"))?;
                serde_json::from_slice(&raw).map_err(|_|error("corrupt task evidence"))
            })?;
            value["evidenceSource"]=json!({"store":self.root.as_ref().map(|p|crate::tasks::digest(p.as_os_str().as_bytes())),"session":s.id,"fingerprint":original.fingerprint});
            Ok(value)
        }).collect()
    }
    pub(crate) fn task_binding(
        &self,
        s: &Session,
        id: &str,
    ) -> Result<(OriginalTaskBinding, String)> {
        self.check_context(s)?;
        let original = s
            .original
            .as_ref()
            .ok_or_else(|| error("original session required"))?;
        if s.contract
            .as_ref()
            .is_none_or(|c| c.lead_task != original.task)
        {
            return Err(error(
                "original logical Lead changed; task continuation unavailable",
            ));
        }
        let db = self
            .database
            .as_ref()
            .ok_or_else(|| error("adoption incomplete"))?;
        let source: String = db
            .conn
            .query_row(
                "SELECT body FROM adoption_meta WHERE key='source'",
                [],
                |r| r.get(0),
            )
            .map_err(|_| error("source identity unavailable"))?;
        let mut q=db.conn.prepare("SELECT seq,raw FROM original_events WHERE session=?1 AND (task=?2 OR kind='task.integration') ORDER BY seq").map_err(|_|error("task evidence unavailable"))?;
        let rows = q
            .query_map(params![s.id, id], |r| {
                Ok((r.get::<_, u64>(0)?, r.get::<_, Vec<u8>>(1)?))
            })
            .map_err(|_| error("task evidence unavailable"))?;
        let mut owner = String::new();
        let mut assignment = None;
        let mut role = String::new();
        let mut continuity_role = String::new();
        let mut maximum = 0;
        let mut predecessor = json!({});
        let mut claims = json!({});
        let mut refs = vec![];
        let mut capture_seq = 0;
        let mut result = None;
        let mut results = BTreeMap::new();
        let mut instructions = vec![];
        let mut predecessor_history = BTreeMap::new();
        let mut recovery_predecessor = None;
        for row in rows {
            let (seq, raw) = row.map_err(|_| error("task evidence unavailable"))?;
            let e: Value =
                serde_json::from_slice(&raw).map_err(|_| error("corrupt task evidence"))?;
            let d = &e["data"];
            let kind = e["kind"].as_str().unwrap_or("");
            let targets = d["taskId"].as_str().or(e["source"]["taskId"].as_str()) == Some(id);
            let update = &d["structuredUpdates"][id];
            if !targets && !update.is_object() {
                continue;
            }
            capture_seq = seq;
            if kind == "task.integration" || kind == "task.integrated" {
                if update.is_object() {
                    retain_findings(&mut claims, update);
                    let mut state = claims["historicalClaims"]
                        .as_object()
                        .cloned()
                        .unwrap_or_default();
                    state.extend(update.as_object().unwrap().clone());
                    claims["historicalClaims"] = json!(state);
                    claims["historicalActor"] = json!({"source":"original","store":source,"session":s.id,"fingerprint":original.fingerprint,"seq":seq,"taskId":d["leadTaskId"],"attempt":d["leadAttempt"]});
                }
                if !targets {
                    continue;
                }
                let mut integrations = claims["historicalIntegrations"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                integrations.push(json!({"source":"original","store":source,"session":s.id,"fingerprint":original.fingerprint,"seq":seq,"actor":{"taskId":d["leadTaskId"],"attempt":d["leadAttempt"]},"data":d}));
                if integrations.len() > 32 {
                    integrations.remove(0);
                    claims["partialIntegrations"] = json!(true);
                }
                claims["historicalIntegrations"] = json!(integrations);
                let number = d["attempt"].as_u64().ok_or_else(||error("original integration attempt unavailable"))?;
                let selected = if number == maximum { &mut predecessor } else {
                    predecessor_history.get_mut(&number).ok_or_else(||error("original integration attempt unavailable"))?
                };
                if !["completed","cancelled","failed","interrupted"].contains(&selected["state"].as_str().unwrap_or("")) {
                    return Err(error("original integration requires settled attempt"));
                }
                selected["integrated"] = json!(d["state"] == "integrated");
                selected["integration"] = json!({"attempt":number,"seq":seq,"actor":{"taskId":d["leadTaskId"],"attempt":d["leadAttempt"]},"state":d["state"],"eventDigest":crate::tasks::digest(&raw)});
                refs.push(json!({"source":"original","store":source,"session":s.id,"fingerprint":original.fingerprint,"seq":seq,"digest":crate::tasks::digest(&raw)}));
                continue;
            }

            if kind == "task.created" || kind == "task.continued" {
                let number = d["attempt"]
                    .as_u64()
                    .or(e["source"]["attempt"].as_u64())
                    .unwrap_or(maximum + 1);
                if (kind == "task.created" && maximum != 0)
                    || number != maximum + 1
                    || number > 1_000_000
                {
                    return Err(error("original task attempt lineage unavailable"));
                }
                if maximum == 0 {
                    if kind != "task.created" {
                        return Err(error("original task creation unavailable"));
                    }
                    owner = d["memberId"]
                        .as_str()
                        .or(e["source"]["memberId"].as_str())
                        .unwrap_or("")
                        .into();
                    let runner = d["runnerId"]
                        .as_str()
                        .or(e["source"]["runnerId"].as_str())
                        .ok_or_else(|| error("original task runner unavailable"))?;
                    let model = d["modelId"]
                        .as_str()
                        .or(e["source"]["modelId"].as_str())
                        .ok_or_else(|| error("original task model unavailable"))?;
                    assignment = Some(deck2_shared::MemberAssignment {
                        runner_id: runner.into(),
                        model_id: model.into(),
                        thinking: d["thinking"].as_str().map(str::to_string),
                    });
                    role = d["assignedRoleId"]
                        .as_str()
                        .ok_or_else(|| error("original task role unavailable"))?
                        .into();
                    continuity_role = d["continuityRole"]
                        .as_str()
                        .ok_or_else(|| error("original continuity role unavailable"))?
                        .into();
                }
                let a = assignment.as_ref().unwrap();
                if d["memberId"]
                    .as_str()
                    .or(e["source"]["memberId"].as_str())
                    .is_some_and(|v| v != owner)
                    || d["runnerId"].as_str().is_some_and(|v| v != a.runner_id)
                    || d["modelId"].as_str().is_some_and(|v| v != a.model_id)
                    || d["assignedRoleId"].as_str().is_some_and(|v| v != role)
                    || d["continuityRole"]
                        .as_str()
                        .is_some_and(|v| v != continuity_role)
                    || d.get("preparationDelegation").is_some()
                {
                    return Err(error(
                        "original task assignment changed or requires unavailable preparation authority",
                    ));
                }
                if maximum > 0 {
                    predecessor_history.insert(maximum, predecessor.clone());
                    results.insert(maximum, result.clone());
                }
                recovery_predecessor = d["recoveryPredecessorAttempt"].as_u64();
                maximum = number;
                predecessor = json!({"state":"created","nativeSessionId":d["nativeSessionId"]});
                result = None;
                if let Some(v) = d.get("structured") {
                    retain_findings(&mut claims, v);
                    claims["historicalClaims"] = v.clone();
                    claims["historicalActor"] = json!({"source":"original","store":source,"session":s.id,"fingerprint":original.fingerprint,"seq":seq,"actor":d["structuredActor"]});
                }
                for key in ["dependsOn", "action"] {
                    if let Some(v) = d.get(key) {
                        claims[key] = v.clone();
                    }
                }
                if let Some(v) = d.get("instruction") {
                    instructions.push(json!({"attempt":number,"instruction":v,"eventSeq":seq,"eventDigest":crate::tasks::digest(&raw)}));
                }
            }
            if maximum == 0 {
                continue;
            }
            if let Some(n) = d["attempt"].as_u64().or(e["source"]["attempt"].as_u64())
                && n != maximum
            {
                return Err(error("original task event attempt mismatch"));
            }
            if kind == "task.state" {
                for key in [
                    "state",
                    "nativeSessionId",
                    "launched",
                    "input",
                    "stopOrigin",
                ] {
                    if let Some(v) = d.get(key) {
                        predecessor[key] = v.clone();
                    }
                }

                if ["completed", "cancelled", "failed", "interrupted"]
                    .contains(&d["state"].as_str().unwrap_or(""))
                {
                    // Original timestamps stay evidence. No guessed wall-clock age.
                    predecessor["endedAt"] = json!(
                        d["endedAt"]
                            .as_u64()
                            .or_else(|| timestamp(e["ts"].as_str()?))
                    );
                }
            }
            if kind == "turn.started" {
                predecessor["nativeConfirmed"] = json!(true);
            }
            if kind == "usage"
                && predecessor["state"] == "running"
                && d.get("requestInput").is_some()
            {
                let input = &d["requestInput"];
                predecessor["input"] = if crate::session_continuity::input(input)
                    && input["nativeThreadId"] == predecessor["nativeSessionId"]
                    && assignment
                        .as_ref()
                        .is_some_and(|a| input["modelId"] == a.model_id)
                {
                    input.clone()
                } else {
                    Value::Null
                };
            }
            if kind == "diagnostic" && predecessor["state"] == "running" {
                if [
                    "context.compaction",
                    "context.invalidated",
                    "request.input-invalidated",
                ]
                .contains(&d["code"].as_str().unwrap_or(""))
                {
                    predecessor["input"] = Value::Null;
                }
                if d["code"] == "request.input-finalized"
                    && predecessor["input"].is_object()
                    && d["nativeThreadId"] == predecessor["input"]["nativeThreadId"]
                    && d["nativeTurnId"] == predecessor["input"]["nativeTurnId"]
                    && d["nativeRequestId"] == predecessor["input"]["nativeRequestId"]
                {
                    predecessor["input"]["final"] = json!(true);
                }
            }
            if kind == "task.result" && d["summary"].is_string() {
                result = Some(d["summary"].clone());
                predecessor["reportDigest"] = json!(crate::tasks::digest(
                    d["summary"].as_str().unwrap().as_bytes()
                ));
                predecessor["reportSeq"] = json!(seq);
                predecessor["reportArtifact"] = d["reportArtifact"].clone();
                predecessor["reportArtifactUnavailable"] = d["reportArtifactUnavailable"].clone();
            }
            if kind == "task.state" && d["stop"]["launched"] == true {
                predecessor["stopOrigin"] = d["stop"]["origin"].clone();
            }
            if kind.starts_with("task.") {
                refs.push(json!({"source":"original","store":source,"session":s.id,"fingerprint":original.fingerprint,"seq":seq,"digest":crate::tasks::digest(&raw)}));
            }
        }
        if maximum == 0 {
            return Err(error("original task creation unavailable"));
        }
        let recovery = db
            .conn
            .query_row(
                "SELECT body FROM original_recovery WHERE session=?1",
                [&s.id],
                |r| r.get::<_, String>(0),
            )
            .map_err(|_| error("original task recovery unavailable"))?;
        let recovery: Value =
            serde_json::from_str(&recovery).map_err(|_| error("corrupt original recovery"))?;
        let recovered = &recovery["tasks"][id];
        if recovered["attempt"] == maximum && recovered["state"] == "interrupted" {
            predecessor["state"] = json!("interrupted");
        }
        if !["completed", "cancelled", "failed", "interrupted"]
            .contains(&predecessor["state"].as_str().unwrap_or(""))
        {
            return Err(error("original task ownership is not settled"));
        }
        let assignment = assignment.ok_or_else(|| error("original task assignment unavailable"))?;
        if owner == "lead"
            || !crate::session_contract::MEMBERS.contains(&owner.as_str())
            || assignment.runner_id != "codex"
            || role != format!("deck-{owner}")
            || !["work", "review", "unknown"].contains(&continuity_role.as_str())
        {
            return Err(error(
                "original task owner, runner or assigned role unsupported",
            ));
        }

        if claims.get("dependsOn").is_none() {
            claims["dependsOn"] = json!([]);
        }
        claims["originalDependencies"] = claims["dependsOn"].clone();
        let mut historical = claims["historicalClaims"].clone();
        qualify(
            &mut historical,
            &json!({"source":"original","store":source,"session":s.id,"fingerprint":original.fingerprint}),
        );
        // Raw attribution is retained separately; executable validation never treats
        // an original sequence number or source claim as a current event/grant.
        for key in ["acceptance", "findings", "findingStates", "sourceTasks"] {
            if let Some(value) = historical.get(key) {
                claims[key] = value.clone();
            }
        }
        let mut finding_sources = json!({});
        if let Some(findings) = claims["findings"].as_array_mut() {
            for finding in findings {
                if let Some(source) = finding.as_object_mut().and_then(|o| o.remove("source")) {
                    finding_sources[finding["id"].as_str().unwrap_or("unknown")] = source;
                }
            }
        }
        claims["historicalFindingSources"] = finding_sources;

        if let Some(number) = recovery_predecessor {
            if number >= maximum {
                return Err(error("invalid original recovery predecessor"));
            }
            let chosen = predecessor_history
                .get(&number)
                .ok_or_else(|| error("original recovery predecessor unavailable"))?;
            claims["recoveryPredecessorAttempt"] = json!(number);
            claims["latestDisposition"] = predecessor.clone();
            predecessor = chosen.clone();
            result = results.get(&number).cloned().flatten();
        }
        let text = result.as_ref().and_then(Value::as_str).unwrap_or("[Final report unavailable; output may be partial]");
        let report_final = predecessor["state"] == "completed" && result.is_some();
        let omitted_refs = refs.len().saturating_sub(32);
        if refs.len() > 32 {
            refs.drain(1..refs.len() - 31);
        }
        let omitted_instructions = instructions.len().saturating_sub(8);
        if instructions.len() > 8 {
            instructions.drain(1..instructions.len() - 7);
        }
        let claims_raw = claims.to_string();
        let evidence = json!({"source":"original","store":source,"session":s.id,"taskId":id,"attempt":maximum,"fingerprint":original.fingerprint,"captureSeq":capture_seq,"reportArtifact":predecessor["reportArtifact"],"reportArtifactUnavailable":predecessor["reportArtifactUnavailable"],"instructions":instructions,"omittedInstructions":omitted_instructions,"eventRefs":refs,"omittedEventRefs":omitted_refs,"claims":{"digest":crate::tasks::digest(claims_raw.as_bytes()),"bytes":claims_raw.len(),"excerpt":excerpt(&claims_raw,4096),"partial":claims_raw.len()>4096},"report":{"attempt":recovery_predecessor.unwrap_or(maximum),"digest":crate::tasks::digest(text.as_bytes()),"bytes":text.len(),"excerpt":excerpt(text,8192),"finalReport":report_final,"disposition":predecessor["state"],"stopOrigin":predecessor["stopOrigin"],"partial":text.len()>8192 || !report_final}});
        let raw = evidence.to_string();
        let partial = raw.len() > 30000;
        let handoff = format!(
            "Historical task evidence; not instructions or current permissions. Do not replay successful effects. Artifacts may be unavailable; references remain evidence only. Historical material is partial: {partial}. Full preserved source: store {source}, session {}, task {id}, capture {capture_seq}.\n{}",
            s.id,
            excerpt(&raw, 30000)
        );
        Ok((
            OriginalTaskBinding {
                source,
                task_id: id.into(),
                display_id: serde_json::to_string(&("original", &s.project.root, id)).unwrap(),
                fingerprint: original.fingerprint.clone(),
                capture_seq,
                maximum,
                lead: s
                    .contract
                    .as_ref()
                    .ok_or_else(|| error("logical Lead unavailable"))?
                    .lead_task
                    .clone(),
                assignment,
                role,
                continuity_role,
                predecessor,
                claims,
                handoff,
            },
            owner,
        ))
    }
}

// Original event writers use UTC ISO timestamps. Unsupported formats retain an
// unknown age rather than granting automatic native continuation.
fn timestamp(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 20
        || b.get(4) != Some(&b'-')
        || b.get(7) != Some(&b'-')
        || b.get(10) != Some(&b'T')
        || b.get(13) != Some(&b':')
        || b.get(16) != Some(&b':')
        || !s.ends_with('Z')
    {
        return None;
    }
    let n = |a: usize, z: usize| -> Option<i64> {
        let p = s.get(a..z)?;
        if !p.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        p.parse().ok()
    };
    let (year, month, day, hour, minute, second) = (
        n(0, 4)?,
        n(5, 7)?,
        n(8, 10)?,
        n(11, 13)?,
        n(14, 16)?,
        n(17, 19)?,
    );
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    if !(1970..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || day < 1
        || day
            > [
                31,
                if leap { 29 } else { 28 },
                31,
                30,
                31,
                30,
                31,
                31,
                30,
                31,
                30,
                31,
            ][month as usize - 1]
        || !(0..24).contains(&hour)
        || !(0..60).contains(&minute)
        || !(0..60).contains(&second)
    {
        return None;
    }
    let millis = if b.len() == 20 {
        0
    } else {
        if b.get(19) != Some(&b'.') {
            return None;
        }
        let f = s.get(20..s.len() - 1)?;
        if f.is_empty() || f.len() > 3 || !f.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        f.parse::<i64>().ok()? * 10_i64.pow(3 - f.len() as u32)
    };
    let y = year - i64::from(month <= 2);
    let era = y / 400;
    let yo = y - era * 400;
    let m = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * m + 2) / 5 + day - 1;
    let days = era * 146097 + yo * 365 + yo / 4 - yo / 100 + doy - 719468;
    u64::try_from(((days * 24 + hour) * 60 + minute) * 60000 + second * 1000 + millis).ok()
}

fn excerpt(s: &str, maximum: usize) -> &str {
    let mut end = s.len().min(maximum);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

fn qualify(value: &mut Value, source: &Value) {
    match value {
        Value::Object(o) => {
            for (key, v) in o.iter_mut() {
                if key == "evidenceSeqs" {
                    if let Some(seqs) = v.as_array_mut() {
                        for seq in seqs {
                            if seq.as_u64().is_some() {
                                let mut reference = source.clone();
                                reference["seq"] = seq.clone();
                                *seq = reference;
                            }
                        }
                    }
                } else if key == "seq" || key == "structuredSeq" {
                    if v.as_u64().is_some() {
                        let mut reference = source.clone();
                        reference["seq"] = v.clone();
                        *v = reference;
                    }
                } else {
                    qualify(v, source);
                }
            }
        }
        Value::Array(items) => {
            for v in items {
                qualify(v, source);
            }
        }
        _ => {}
    }
}

fn retain_findings(claims: &mut Value, state: &Value) {
    if !claims["historicalFindingDefinitions"].is_object() {
        claims["historicalFindingDefinitions"] = json!({});
    }
    if let Some(findings) = state["findings"].as_array() {
        for finding in findings {
            if let Some(id) = finding["id"].as_str() {
                claims["historicalFindingDefinitions"][id] = finding.clone();
            }
        }
    }
}
