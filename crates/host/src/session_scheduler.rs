//! One admission pump; durable rows are the queue and the ownership ledger.
//! Active workers supplement (never replace) persisted execution reservations.
use crate::{Store, server::App};
use deck2_shared::{Mode, Phase, Task, TaskAttempt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::Ordering;

fn four() -> usize {
    4
}
fn two() -> usize {
    2
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutionBudget {
    #[serde(default = "two")]
    pub lead: usize,
    #[serde(default = "four")]
    pub delegated: usize,
}
impl Default for ExecutionBudget {
    fn default() -> Self {
        Self {
            lead: 2,
            delegated: 4,
        }
    }
}
impl ExecutionBudget {
    pub fn validate(&self, local: usize) -> Result<(), String> {
        // Slice A's dedicated-process envelope is four. Higher values require
        // a reviewed envelope, rather than silently exceeding process bounds.
        if !(1..=2).contains(&self.lead)
            || !(1..=4).contains(&self.delegated)
            || !(1..=4).contains(&local)
        {
            return Err("Delegated budgets must be between 1 and 4 in this runtime".into());
        }
        Ok(())
    }
}
fn limits(
    base: &crate::configuration::Configuration,
    raw: &Value,
) -> Result<(usize, Option<usize>), String> {
    let budget = raw
        .get("executionBudget")
        .map(|value| {
            serde_json::from_value::<ExecutionBudget>(value.clone())
                .map_err(|_| "Invalid canonical execution budget")
        })
        .transpose()?
        .unwrap_or_else(|| base.execution_budget.clone());
    let local = raw
        .get("maxConcurrentTasks")
        .map(|value| {
            value
                .as_u64()
                .and_then(|v| usize::try_from(v).ok())
                .ok_or("Invalid canonical session capacity")
        })
        .transpose()?;
    budget.validate(local.unwrap_or(base.max_concurrent_tasks))?;
    Ok((budget.delegated, local))
}
pub(crate) fn lead_limit(base: &crate::configuration::Configuration, raw: &Value) -> Result<usize, String> {
    limits(base, raw)?;
    let budget = raw.get("executionBudget").map(|v| serde_json::from_value::<ExecutionBudget>(v.clone()).map_err(|_| "Invalid canonical execution budget")).transpose()?.unwrap_or_else(|| base.execution_budget.clone());
    Ok(budget.lead)
}
impl Store {
    pub(crate) fn root_available(&self, mode: &Mode, session: &str, live: &HashSet<String>, cap: usize) -> Result<bool, String> {
        if !(1..=2).contains(&cap) { return Err("Lead budget exceeds the qualified process envelope".into()); }
        let parallel = *mode == Mode::SessionV1 && self.session_by_id(session)?.contract.as_ref().and_then(|c| c.members.get("lead")).and_then(|a| crate::member_integration::Integration::select(&a.runner_id).ok()).is_some_and(|i| i.concurrent_lead());
        let all = self.all()?;
        if live.iter().any(|id| !all.iter().any(|r| &r.id == id)) { return Ok(false); }
        let occupied: Vec<_> = all.iter().filter(|r| r.phase.active() || r.phase == Phase::Uncertain || live.contains(&r.id)).collect();
        if occupied.is_empty() { return Ok(true); }
        if !parallel || occupied.len() >= cap || occupied.iter().any(|r| r.session == session || r.mode != Mode::SessionV1 || !crate::member_integration::Integration::for_receipt(r).is_ok_and(|i| i.concurrent_lead())) {
            return Ok(false);
        }
        Ok(true)
    }
}
impl App {
    // The caller holds admission then Store. Live worker keys extend durable
    // ownership through process drain; unknown/legacy workers remain exclusive.
    pub(crate) fn live_roots(&self, active: &std::collections::HashMap<String, tokio::sync::watch::Sender<bool>>, store: &Store, session: &str) -> Result<HashSet<String>, String> {
        let mut roots = HashSet::new();
        for key in active.keys() {
            if let Some(attempt) = key.strip_prefix("child:") {
                if !store.independent_member_worker(attempt)? { return Err("Exclusive member ownership is still active".into()); }
            } else if let Some(target) = key.strip_prefix("session-restart:") {
                if target == session || session.is_empty() { return Err("Session restart is still settling".into()); }
            } else { roots.insert(key.clone()); }
        }
        Ok(roots)
    }
}
fn connected(t: &Task) -> bool {
    t.attempts
        .last()
        .and_then(|a| a.configuration.as_ref())
        .and_then(|c| c.session_contract.as_ref())
        .is_some()
}
fn serial(t:&Task,a:&TaskAttempt)->bool {
    !matches!(crate::member_integration::profile(t,a),Ok(crate::member_integration::ExecutionProfile::IndependentDedicated))
}

fn occupied(a: &TaskAttempt) -> bool {
    a.settled_ms.is_none()
        && matches!(
            a.phase,
            Phase::Preparing
                | Phase::Dispatching
                | Phase::Running
                | Phase::Cancelling
                | Phase::Uncertain
        )
}
fn sequence(a: &TaskAttempt) -> (u64, u64, &str) {
    let seq = a
        .structured
        .as_deref()
        .and_then(|v| serde_json::from_str::<Value>(v).ok())
        .and_then(|v| v["acceptedSeq"].as_u64());
    // Legacy pending admissions have no sequence. They remain ahead of newly
    // accepted work and are ordered deterministically by time and immutable ID.
    (seq.unwrap_or(0), a.accepted_ms, &a.id)
}
impl Store {
    pub(crate) fn independent_member_worker(&self, attempt: &str) -> Result<bool, String> {
        for t in self.tasks()? {
            if let Some(a) = t.attempts.iter().find(|a| a.id == attempt) {
                return Ok(connected(&t)
                    && !serial(&t,a)
                    && (occupied(a) || a.settled_ms.is_some())
                    && self
                        .get(t.authority_root(a))?
                        .is_some_and(|r| r.mode == Mode::SessionV1));
            }
        }
        Ok(false)
    }
    pub(crate) fn member_blocks_root(&self, mode: &Mode, session: &str) -> Result<bool, String> {
        if self.lifecycle_unsettled()? {
            return Ok(true);
        }
        for t in self.tasks()? {
            for a in &t.attempts {
                if !(a.phase.active() || a.phase == Phase::Uncertain) {
                    continue;
                }
                if *mode != Mode::SessionV1
                    || !connected(&t)
                    || serial(&t,a)
                    || (t.session == session && a.phase == Phase::Uncertain)
                {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
    #[cfg(test)]
    fn claim_member(
        &mut self,
        cursor: &str,
        live: &HashSet<String>,
    ) -> Result<Option<Task>, String> {
        let (cap, local) = limits(&self.configuration()?, &json!({}))?;
        self.claim_configured_member(cursor, live, cap, local)
    }
    fn claim_configured_member(
        &mut self,
        cursor: &str,
        live: &HashSet<String>,
        cap: usize,
        local_override: Option<usize>,
    ) -> Result<Option<Task>, String> {
        let tasks = self.tasks()?;
        let mut used = 0;
        let mut per_session = BTreeMap::<String, usize>::new();
        let mut exclusive = false;
        for t in &tasks {
            for a in &t.attempts {
                if occupied(a) || live.contains(&a.id) {
                    used += 1;
                    *per_session.entry(t.session.clone()).or_default() += 1;
                    exclusive |= !connected(t) || serial(t,a);
                }
            }
        }
        // Unknown worker identity is never permission to reuse capacity.
        if live
            .iter()
            .any(|id| !tasks.iter().any(|t| t.attempts.iter().any(|a| &a.id == id)))
        {
            return Ok(None);
        }
        if used >= cap || exclusive || self.lifecycle_unsettled()? {
            return Ok(None);
        }
        let mut sessions = BTreeMap::<String, Vec<(Task, usize)>>::new();
        for t in &tasks {
            if !connected(t) {
                continue;
            }
            if t.attempts
                .iter()
                .any(|a| occupied(a) || live.contains(&a.id))
            {
                continue;
            }
            if tasks
                .iter()
                .filter(|other| other.session == t.session)
                .any(|other| other.attempts.iter().any(|a| a.phase == Phase::Uncertain))
            {
                continue;
            }
            let project = self.session_project(&t.session)?;
            let local = local_override
                .unwrap_or(self.configuration_for(&project.root)?.max_concurrent_tasks);
            if !(1..=4).contains(&local) {
                return Err("Invalid session delegated capacity".into());
            }
            if per_session.get(&t.session).copied().unwrap_or(0) >= local {
                continue;
            }
            for (i, a) in t.attempts.iter().enumerate() {
                if a.phase == Phase::Accepted && !a.cancel_requested && (!serial(t,a) || used == 0) {
                    sessions
                        .entry(t.session.clone())
                        .or_default()
                        .push((t.clone(), i));
                }
            }
        }
        let mut order = sessions.keys().cloned().collect::<Vec<_>>();
        order.sort_by_key(|session| (session.as_str() <= cursor, session.clone()));
        for session in order {
            let candidates = sessions.get_mut(&session).unwrap();
            candidates.sort_by(|(t, i), (u, j)| {
                sequence(&t.attempts[*i]).cmp(&sequence(&u.attempts[*j]))
            });
            for (mut t, i) in candidates.drain(..) {
                let validation = (|| {
                    crate::member_integration::profile(&t,&t.attempts[i])?;
                    crate::session_tasks::validate_authority(self, &t, &t.attempts[i])?;
                    if let Some(state) = &t.structured {
                        let state: Value =
                            serde_json::from_str(state).map_err(|_| "Corrupt task dependencies")?;
                        crate::session_decisions::dependencies(
                            self,
                            &t.session,
                            state.get("dependsOn").unwrap_or(&json!([])),
                            &state["action"],
                        )?;
                    }
                    Ok::<_, String>(())
                })();
                if let Err(error) = validation {
                    let a = &mut t.attempts[i];
                    a.phase = Phase::Cancelled;
                    a.cancel_requested = true;
                    a.settled_ms = Some(crate::now());
                    a.detail = format!("Launch rejected before effects: {error}");
                    self.save_normal_task(&t)?;
                    self.enqueue_task_outcome(&t.id, &t.attempts[i].id)?;
                    continue;
                }
                let approvals = self
                    .session_by_id(&session)?
                    .contract
                    .ok_or("Session contract missing")?
                    .approvals;
                let a = &mut t.attempts[i];
                a.configuration
                    .as_mut()
                    .and_then(|s| s.session_contract.as_mut())
                    .ok_or("Attempt contract missing")?
                    .approvals = approvals;
                a.phase = Phase::Preparing;
                a.detail = "Delegated execution slot claimed; dedicated native preparation".into();
                self.conn
                    .execute_batch("SAVEPOINT member_claim")
                    .map_err(|_| "Cannot begin member claim")?;
                let result = self
                    .save_task(&t)
                    .and_then(|_| self.record_member_overlap(&t, i, &tasks));
                if let Err(error) = result {
                    let _ = self
                        .conn
                        .execute_batch("ROLLBACK TO member_claim; RELEASE member_claim");
                    return Err(error);
                }
                self.conn
                    .execute_batch("RELEASE member_claim")
                    .map_err(|_| "Cannot commit member claim")?;
                return Ok(Some(t));
            }
        }
        Ok(None)
    }
    pub(crate) fn record_root_overlaps(&self, root: &deck2_shared::Receipt) -> Result<(), String> {
        if root.mode != Mode::SessionV1 {
            return Ok(());
        }
        let project = self.session_project(&root.session)?.id;
        for other in self.all()?.into_iter().filter(|r|r.id!=root.id && r.mode==Mode::SessionV1 && (r.phase.active() || r.phase==Phase::Uncertain)) {
            if self.session_project(&other.session)?.id!=project {continue;}
            for (own,sibling) in [(root,&other),(&other,root)] {
                let lead=own.configuration.as_ref().and_then(|s|s.session_contract.as_ref()).ok_or("Overlap Lead contract missing")?;
                let sibling_lead=sibling.configuration.as_ref().and_then(|s|s.session_contract.as_ref()).ok_or("Overlap sibling contract missing")?;
                let body=json!({"receiptId":own.id,"revision":own.revision,"potentiallyMixed":true,"overlap":{"session":sibling.session,"task":sibling_lead.lead_task,"receipt":sibling.id,"attempt":sibling.attempt,"generation":if sibling.generation.is_empty(){Value::Null}else{json!(sibling.generation)}}});
                self.conn.execute("INSERT INTO session_events(session,task,attempt,kind,body) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(task,attempt,kind) DO NOTHING",rusqlite::params![own.session,lead.lead_task,own.attempt,format!("receipt:overlap:{}",sibling.id),body.to_string()]).map_err(|_|"Cannot persist concurrent Lead overlap")?;
            }
        }
        let tasks = self.tasks()?;
        for t in &tasks {
            if self.session_project(&t.session)?.id == project {
                for (i, _) in t.attempts.iter().enumerate().filter(|(_, a)| occupied(a)) {
                    self.record_member_overlap(t, i, &tasks)?;
                }
            }
        }
        Ok(())
    }
    fn record_member_overlap(
        &self,
        target: &Task,
        index: usize,
        tasks: &[Task],
    ) -> Result<(), String> {
        let project = self.session_project(&target.session)?.id;
        for sibling in tasks {
            if sibling.id == target.id || self.session_project(&sibling.session)?.id != project {
                continue;
            }
            for a in sibling.attempts.iter().filter(|a| occupied(a)) {
                for (id, attempt, other, other_attempt) in [
                    (&target.id, &target.attempts[index].id, sibling, a),
                    (&sibling.id, &a.id, target, &target.attempts[index]),
                ] {
                    let mut current = self.task(id)?;
                    let own = current
                        .attempts
                        .iter_mut()
                        .find(|a| &a.id == attempt)
                        .ok_or("Overlap owner missing")?;
                    let mut state: Value =
                        serde_json::from_str(own.structured.as_deref().unwrap_or("{}"))
                            .map_err(|_| "Invalid overlap state")?;
                    let reference = json!({"session":other.session,"task":other.id,"attempt":other_attempt.id,"generation":other_attempt.generation});
                    let list = state
                        .as_object_mut()
                        .ok_or("Invalid overlap state")?
                        .entry("overlaps")
                        .or_insert(json!([]))
                        .as_array_mut()
                        .ok_or("Invalid overlap state")?;
                    if !list.contains(&reference) {
                        if list.len() < 256 {
                            list.push(reference);
                        } else {
                            state["overlapRecordsTruncated"] = json!(true);
                        }
                    }
                    state["potentiallyMixed"] = json!(true);
                    own.structured = Some(state.to_string());
                    self.save_task(&current)?;
                }
            }
        }
        for root in self.all()?.into_iter().filter(|r| r.phase.active() || r.phase==Phase::Uncertain) {
            if self.session_project(&root.session)?.id != project {
                continue;
            }
            let lead = root
                .configuration
                .as_ref()
                .and_then(|s| s.session_contract.as_ref())
                .ok_or("Overlap root contract missing")?
                .lead_task
                .clone();
            let mut current = self.task(&target.id)?;
            let own = &mut current.attempts[index];
            let mut state: Value = serde_json::from_str(own.structured.as_deref().unwrap_or("{}"))
                .map_err(|_| "Invalid overlap state")?;
            let reference = json!({"session":root.session,"task":lead,"receipt":root.id,"attempt":root.attempt,"generation":root.generation});
            let list = state
                .as_object_mut()
                .ok_or("Invalid overlap state")?
                .entry("overlaps")
                .or_insert(json!([]))
                .as_array_mut()
                .ok_or("Invalid overlap state")?;
            if !list.contains(&reference) {
                if list.len() < 256 {
                    list.push(reference);
                } else {
                    state["overlapRecordsTruncated"] = json!(true);
                }
            }
            state["potentiallyMixed"] = json!(true);
            own.structured = Some(state.to_string());
            self.save_task(&current)?;
            let body = json!({"receiptId":root.id,"revision":root.revision,"potentiallyMixed":true,"overlap":{"session":target.session,"task":target.id,"attempt":target.attempts[index].id,"generation":target.attempts[index].generation}});
            self.conn.execute("INSERT INTO session_events(session,task,attempt,kind,body) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(task,attempt,kind) DO NOTHING",rusqlite::params![root.session,lead,root.attempt,format!("receipt:overlap:{}",target.attempts[index].id),body.to_string()]).map_err(|_|"Cannot persist Lead overlap")?;
        }
        Ok(())
    }
}
impl App {
    pub(crate) fn pump_members(&self) -> Result<(), String> {
        if !self.persistence_available() || self.shutdown_requested.load(Ordering::SeqCst) {
            return Ok(());
        }
        let configured = self
            .web_identity
            .lock()
            .map_err(|_| "Execution configuration lock failed")?
            .identity
            .scheduler_config();
        let mut active = self.active.lock().map_err(|_| "Admission lock failed")?;
        if self.shutdown_requested.load(Ordering::SeqCst) {
            return Ok(());
        }
        let mut cursor = self
            .delegated_cursor
            .lock()
            .map_err(|_| "Admission cursor failed")?;
        let base = self
            .store
            .lock()
            .map_err(|_| "State lock failed")?
            .configuration()?;
        let configured = configured.and_then(|value| limits(&base, &value));
        let (cap, local) = match configured {
            Ok(value) => value,
            Err(error) => {
                let mut store = self.store.lock().map_err(|_| "State lock failed")?;
                for mut t in store.tasks()? {
                    for i in 0..t.attempts.len() {
                        if t.attempts[i].phase == Phase::Accepted {
                            let a = &mut t.attempts[i];
                            a.phase = Phase::Failed;
                            a.settled_ms = Some(crate::now());
                            a.detail =
                                format!("Execution configuration rejected before launch: {error}");
                            store.save_normal_task(&t)?;
                            store.enqueue_task_outcome(&t.id, &t.attempts[i].id)?;
                        }
                    }
                }
                return Ok(());
            }
        };
        loop {
            let live = active
                .keys()
                .filter_map(|key| key.strip_prefix("child:").map(str::to_string))
                .collect();
            let next = self
                .store
                .lock()
                .map_err(|_| "State lock failed")?
                .claim_configured_member(&cursor, &live, cap, local)?;
            let Some(t) = next else {
                break;
            };
            let a = t
                .attempts
                .iter()
                .find(|a| a.phase == Phase::Preparing)
                .ok_or("Claimed attempt missing")?;
            let (sender, _) = tokio::sync::watch::channel(false);
            active.insert(format!("child:{}", a.id), sender);
            *cursor = t.session.clone();
            crate::session_tasks::start(self.clone(), t.id.clone(), a.id.clone());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session(s: &mut Store, id: &str, root: &str) {
        s.create_session(&serde_json::from_value(json!({"api":deck2_shared::API,"id":id,"title":id,"members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"},"apply-deep":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap()).unwrap();
        let mut r=s.admit(&serde_json::from_value(json!({"api":deck2_shared::API,"id":root,"session":id,"prompt":"Coordinate","mode":"session_v1"})).unwrap()).unwrap();
        r.phase = Phase::Running;
        r.generation = "fixture-generation".into();
        r.thread = Some(root.into());
        r.turn = Some(root.into());
        s.save(&mut r).unwrap();
    }
    fn delegate(s: &mut Store, root: &str, key: &str) -> Task {
        let r = crate::session_tasks::tool(
            s,
            root,
            "deck_delegate",
            &json!({"agent":"apply-deep","task":key}),
            key,
        )
        .unwrap();
        s.task(r["taskId"].as_str().unwrap()).unwrap()
    }
    fn complete_root(s: &mut Store, id: &str) {
        let mut r = s.get(id).unwrap().unwrap();
        r.phase = Phase::Completed;
        s.save(&mut r).unwrap();
    }
    fn store() -> Store {
        let mut s = Store::open_memory("/fixture").unwrap();
        s.register_codex("a".repeat(64)).unwrap();
        s
    }
    // Oracle: canonical default two Lead slots, one turn per session, with
    // independent delegated capacity and no implicit replay.
    #[test]
    fn two_connected_leads_share_only_the_configured_root_budget() {
        let mut s = store();
        session(&mut s, "lead-session-a", "lead-root-alpha");
        session(&mut s, "lead-session-b", "lead-root-beta");
        let overlaps:i64=s.conn.query_row("SELECT COUNT(*) FROM session_events WHERE kind LIKE 'receipt:overlap:%'",[],|row|row.get(0)).unwrap();
        assert_eq!(overlaps,2,"same-project Lead overlap is recorded for both immutable attempts");
        s.create_session(&serde_json::from_value(json!({"api":deck2_shared::API,"id":"lead-session-c","title":"C","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap()).unwrap();
        let submit = |id: &str, session: &str, queue: bool| serde_json::from_value(json!({"api":deck2_shared::API,"id":id,"session":session,"prompt":"Continue once","mode":"session_v1","queue":queue})).unwrap();
        assert!(s.admit(&submit("lead-third", "lead-session-c", false)).is_err());
        assert!(s.admit(&submit("lead-duplicate", "lead-session-a", false)).is_err());
        let waiting=s.admit(&submit("lead-queued", "lead-session-c", true)).unwrap();
        assert_eq!(waiting.phase, Phase::Queued);
        assert!(s.claim_next().unwrap().is_none());
        complete_root(&mut s, "lead-root-alpha");
        assert_eq!(s.claim_next().unwrap().unwrap().id, waiting.id);
        assert!(s.claim_next().unwrap().is_none());
        let mut uncertain=s.get("lead-root-beta").unwrap().unwrap();
        uncertain.phase=Phase::Uncertain;s.save(&mut uncertain).unwrap();
        complete_root(&mut s,&waiting.id);
        session(&mut s,"lead-session-d","lead-root-delta");
        let recorded:bool=s.conn.query_row("SELECT EXISTS(SELECT 1 FROM session_events WHERE session='lead-session-b' AND kind='receipt:overlap:lead-root-delta')",[],|row|row.get(0)).unwrap();
        assert!(recorded,"Uncertain owners must retain same-project overlap attribution");
    }
    #[test]
    fn unsupported_member_binding_is_rejected_before_native_reservation() {
        let mut s=store();session(&mut s,"session-a","root-alpha");
        let mut t=delegate(&mut s,"root-alpha","unsupported");
        t.attempts[0].configuration.as_mut().unwrap().session_contract.as_mut().unwrap().members.get_mut("apply-deep").unwrap().runner_id="unavailable-runner".into();
        s.save_task(&t).unwrap();
        assert!(s.claim_member("",&HashSet::new()).unwrap().is_none(),"Unknown integration must never claim a Codex preparation lease");
        let t=s.task(&t.id).unwrap();assert_eq!(t.attempts[0].phase,Phase::Cancelled);assert!(t.attempts[0].dispatch_ms.is_none());
    }
    // Oracle: separate global/local quotas; round robin sessions, not task row order.
    #[test]
    fn capacity_fairness_drain_and_scoped_uncertainty() {
        let mut s = store();
        session(&mut s, "session-a", "root-alpha");
        let a = delegate(&mut s, "root-alpha", "a1");
        delegate(&mut s, "root-alpha", "a2");
        delegate(&mut s, "root-alpha", "a3");
        complete_root(&mut s, "root-alpha");
        session(&mut s, "session-b", "root-beta");
        let b = delegate(&mut s, "root-beta", "b1");
        delegate(&mut s, "root-beta", "b2");
        let empty = HashSet::new();
        let first = s.claim_member("", &empty).unwrap().unwrap();
        assert_eq!(first.id, a.id);
        let second = s.claim_member(&first.session, &empty).unwrap().unwrap();
        assert_eq!(second.id, b.id);
        let third = s.claim_member(&second.session, &empty).unwrap().unwrap();
        assert_eq!(third.session, "session-a");
        let fourth = s.claim_member(&third.session, &empty).unwrap().unwrap();
        assert_eq!(fourth.session, "session-b");
        assert!(s.claim_member(&fourth.session, &empty).unwrap().is_none());
        let mut pending = s.task(&a.id).unwrap();
        pending.attempts[0].phase = Phase::Cancelling;
        pending.attempts[0].cancel_requested = true;
        s.save_task(&pending).unwrap();
        assert!(
            s.claim_member("", &empty).unwrap().is_none(),
            "cancel intent cannot free a native slot"
        );
        pending.attempts[0].phase = Phase::Uncertain;
        s.save_task(&pending).unwrap();
        assert!(s.claim_member("", &empty).unwrap().is_none());
        pending.attempts[0].settled_ms = Some(crate::now());
        s.save_task(&pending).unwrap();
        // A is logically fenced; B remains eligible after its own slot drains.
        assert!(s.member_blocks_root(&Mode::SessionV1, "session-a").unwrap());
        assert!(!s.member_blocks_root(&Mode::SessionV1, "session-b").unwrap());
        let mut b = s.task(&b.id).unwrap();
        b.attempts[0].phase = Phase::Completed;
        b.attempts[0].settled_ms = Some(crate::now());
        s.save_normal_task(&b).unwrap();
        let b3 = delegate(&mut s, "root-beta", "b3");
        assert_eq!(
            s.claim_member("session-b", &empty).unwrap().unwrap().id,
            b3.id
        );
        // Overlap attribution is reciprocal and binds immutable attempt identity.
        let first = s.task(&a.id).unwrap();
        let state: Value =
            serde_json::from_str(first.attempts[0].structured.as_deref().unwrap()).unwrap();
        assert_eq!(state["potentiallyMixed"], true);
        assert!(
            state["overlaps"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v["task"] == b.id)
        );
    }
    #[test]
    fn local_budget_and_live_drain_survive_terminal_rows() {
        let mut s = store();
        let mut config = s.configuration().unwrap();
        config.revision += 1;
        config.max_concurrent_tasks = 1;
        s.save_configuration(&config).unwrap();
        session(&mut s, "session-a", "root-alpha");
        let a = delegate(&mut s, "root-alpha", "a1");
        delegate(&mut s, "root-alpha", "a2");
        s.claim_member("", &HashSet::new()).unwrap().unwrap();
        assert!(s.claim_member("", &HashSet::new()).unwrap().is_none());
        let mut t = s.task(&a.id).unwrap();
        t.attempts[0].phase = Phase::Cancelled;
        t.attempts[0].settled_ms = Some(crate::now());
        s.save_task(&t).unwrap();
        let live = HashSet::from([t.attempts[0].id.clone()]);
        assert!(
            s.claim_member("", &live).unwrap().is_none(),
            "worker cleanup retains local capacity"
        );
        assert!(s.claim_member("", &HashSet::new()).unwrap().is_some());
    }
    #[test]
    fn outcome_wakes_lead_while_sibling_runs_and_deduplicates() {
        let mut s = store();
        session(&mut s, "session-a", "root-alpha");
        delegate(&mut s, "root-alpha", "a1");
        let b = delegate(&mut s, "root-alpha", "a2");
        let mut a = s.claim_member("", &HashSet::new()).unwrap().unwrap();
        s.claim_member("", &HashSet::new()).unwrap().unwrap();
        complete_root(&mut s, "root-alpha");
        a.attempts[0].phase = Phase::Completed;
        a.attempts[0].settled_ms = Some(crate::now());
        s.save_normal_task(&a).unwrap();
        s.enqueue_task_outcome(&a.id, &a.attempts[0].id).unwrap();
        s.enqueue_task_outcome(&a.id, &a.attempts[0].id).unwrap();
        let next = s
            .claim_next()
            .unwrap()
            .expect("independent member cannot block Lead continuation");
        assert!(next.continuation.is_some());
        let sibling = s.task(&b.id).unwrap();
        let state: Value =
            serde_json::from_str(sibling.attempts[0].structured.as_deref().unwrap()).unwrap();
        assert!(
            state["overlaps"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v["receipt"] == next.id)
        );
        assert_eq!(s.task(&b.id).unwrap().attempts[0].phase, Phase::Preparing);
        assert!(s.claim_next().unwrap().is_none());
        assert_eq!(
            s.all()
                .unwrap()
                .iter()
                .filter(|r| r.continuation.is_some())
                .count(),
            1
        );
    }
    // Protects spawn-before-dispatch recovery: Preparing is an ownership claim,
    // even without an acknowledged turn or PID publication. Never auto-replay.
    #[test]
    fn recovery_retains_preparing_claim_without_dispatch() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("state.db");
        let mut s = Store::open(&db, "/fixture").unwrap();
        s.register_codex("a".repeat(64)).unwrap();
        session(&mut s, "session-a", "root-alpha");
        let t = delegate(&mut s, "root-alpha", "a1");
        s.claim_member("", &HashSet::new()).unwrap().unwrap();
        complete_root(&mut s, "root-alpha");
        drop(s);
        let mut recovered = Store::open(&db, "/fixture").unwrap();
        let t = recovered.task(&t.id).unwrap();
        let a = &t.attempts[0];
        assert_eq!(a.phase, Phase::Uncertain);
        assert!(a.cancel_requested);
        assert!(a.dispatch_ms.is_none());
        assert!(a.settled_ms.is_none());
        assert!(
            recovered
                .claim_member("", &HashSet::new())
                .unwrap()
                .is_none()
        );
        session(&mut recovered, "session-b", "root-beta");
        let b = delegate(&mut recovered, "root-beta", "b1");
        assert_eq!(
            recovered
                .claim_member("", &HashSet::new())
                .unwrap()
                .unwrap()
                .id,
            b.id
        );
    }
    #[test]
    fn canonical_configuration_controls_admission_without_killing_live_owners() {
        let mut s = store();
        session(&mut s, "session-a", "root-alpha");
        delegate(&mut s, "root-alpha", "a1");
        delegate(&mut s, "root-alpha", "a2");
        delegate(&mut s, "root-alpha", "a3");
        let raw = json!({"executionBudget":{"lead":2,"delegated":2},"maxConcurrentTasks":2});
        let (cap, local) = limits(&s.configuration().unwrap(), &raw).unwrap();
        assert!(
            s.claim_configured_member("", &HashSet::new(), cap, local)
                .unwrap()
                .is_some()
        );
        assert!(
            s.claim_configured_member("", &HashSet::new(), cap, local)
                .unwrap()
                .is_some()
        );
        assert!(
            s.claim_configured_member("", &HashSet::new(), cap, local)
                .unwrap()
                .is_none()
        );
        let (cap, local) = limits(
            &s.configuration().unwrap(),
            &json!({"executionBudget":{"delegated":1}}),
        )
        .unwrap();
        assert!(
            s.claim_configured_member("", &HashSet::new(), cap, local)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            s.tasks()
                .unwrap()
                .iter()
                .filter(|t| t.attempts[0].phase == Phase::Preparing)
                .count(),
            2
        );
        for invalid in [
            json!({"executionBudget":{"delegated":0}}),
            json!({"executionBudget":{"delegated":5}}),
            json!({"maxConcurrentTasks":0}),
            json!({"maxConcurrentTasks":1.5}),
        ] {
            assert!(limits(&s.configuration().unwrap(), &invalid).is_err());
        }
    }
    // protects: persisted per-session FIFO despite clock rollback, idempotence,
    // restart visibility, cancellation, uncertainty and single-turn ownership.
    #[test]
    fn queued_input_uses_durable_arrival_order_after_reopen() {
        let mut s=store();session(&mut s,"queue-session","queue-root");
        let input=|id:&str| serde_json::from_value(json!({"api":deck2_shared::API,"id":id,"session":"queue-session","prompt":id,"mode":"session_v1","queue":true})).unwrap();
        for id in ["queue-first","queue-cancel","queue-last"] {s.admit(&input(id)).unwrap();}
        let mut first=s.get("queue-first").unwrap().unwrap();first.accepted_ms=crate::now()+60_000;s.save(&mut first).unwrap();
        let mut last=s.get("queue-last").unwrap().unwrap();last.accepted_ms=1;s.save(&mut last).unwrap();
        s.request_cancel("queue-cancel").unwrap();
        let mut root=s.get("queue-root").unwrap().unwrap();root.phase=Phase::Uncertain;s.save(&mut root).unwrap();
        let d=tempfile::tempdir().unwrap();let db=d.path().join("state.sqlite");
        s.conn.backup("main",&db,None).unwrap();drop(s);
        let mut s=Store::open(&db,"/fixture").unwrap();
        assert_eq!(s.admit(&input("queue-first")).unwrap().id,"queue-first");
        assert_eq!(s.all().unwrap().len(),4);
        assert!(s.claim_next().unwrap().is_none(),"uncertain previous turn must fence dispatch after restart");
        complete_root(&mut s,"queue-root");
        assert_eq!(s.claim_next().unwrap().unwrap().id,"queue-first","wall time must not reorder durable input");
        assert!(s.claim_next().unwrap().is_none(),"claimed turn owns the native thread");
        complete_root(&mut s,"queue-first");
        assert_eq!(s.claim_next().unwrap().unwrap().id,"queue-last");
        assert!(s.claim_next().unwrap().is_none());
        assert_eq!(s.get("queue-cancel").unwrap().unwrap().phase,Phase::Cancelled);
    }

}
