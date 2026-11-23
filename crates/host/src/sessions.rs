//! Project-local conversations and definitely-undispatched input. The Store lock
//! serializes queue cancellation, claim, and the single project execution slot.
use crate::{AdmissionError, Store};
use deck2_shared::{
    API, DecisionState, Mode, NativeContext, Phase, Receipt, ScopedSubmit, Session, SessionCommand, Submit,
};
use rusqlite::{OptionalExtension, params};
pub(crate) struct RemovalPreview {
    next: String,
    receipts: Vec<(String, u64)>,
    tasks: Vec<(String, u32)>,
    attempts: Vec<String>,
}

impl RemovalPreview {
    pub(crate) fn ensure_unchanged(&self, current: &Self) -> Result<(), String> {
        if self.receipts != current.receipts || self.tasks != current.tasks {
            return Err(
                "Session work changed while removal was waiting. Review the session and try again."
                    .into(),
            );
        }
        Ok(())
    }

    pub(crate) fn owns_worker(&self, key: &str) -> bool {
        if let Some(attempt) = key.strip_prefix("child:") {
            self.attempts.iter().any(|id| id == attempt)
        } else {
            self.receipts.iter().any(|(id, _)| id == key)
        }
    }
}

impl Store {
    pub fn host_id(&self) -> Result<String, String> {
        self.conn
            .query_row("SELECT value FROM meta WHERE key='host'", [], |r| r.get(0))
            .map_err(|_| "Cannot read host identity".into())
    }
    pub fn sessions(&self) -> Result<Vec<Session>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT body FROM sessions ORDER BY rowid")
            .map_err(|_| "Cannot read conversations")?;
        stmt.query_map([], |r| r.get::<_, String>(0))
            .map_err(|_| "Cannot read conversations")?
            .map(|r| {
                serde_json::from_str(&r.map_err(|_| "Cannot read conversation")?)
                    .map_err(|_| "Corrupt conversation".into())
            })
            .collect()
    }
    pub fn session_by_id(&self, id: &str) -> Result<Session, String> {
        let body: Option<String> = self
            .conn
            .query_row("SELECT body FROM sessions WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(|_| "Cannot read conversation")?;
        serde_json::from_str(&body.ok_or("Unknown conversation; input not admitted")?)
            .map_err(|_| "Corrupt conversation".into())
    }
    pub fn create_session(&mut self, c: &SessionCommand) -> Result<Session, String> {
        if c.api != API
            || !(8..=80).contains(&c.id.len())
            || !c.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || c.title.trim().is_empty()
            || c.title.len() > 160
        {
            return Err("Invalid conversation identity or title".into());
        }
        if let Ok(s) = self.session_by_id(&c.id) {
            return if c.project_id.as_ref().is_none_or(|id| id == &s.project.id) && s.title == c.title
                && s.contract.as_ref().map(|s| &s.members) == c.members.as_ref()
                && c.approvals
                    .as_ref()
                    .is_none_or(|a| s.contract.as_ref().is_some_and(|s| &s.approvals == a))
            {
                Ok(s)
            } else {
                Err("Conversation identity conflict".into())
            };
        }
        let contract = c
            .members
            .as_ref()
            .map(|members| {
                let contract = deck2_shared::SessionContract {
                    grants_revoked_at: 0,
                    version: 1,
                    revision: 1,
                    members: members.clone(),
                    approvals: c.approvals.clone().unwrap_or_else(|| "relay".into()),
                    generation: 1,
                    lead_task: uuid::Uuid::new_v4().to_string(),
                };
                crate::session_contract::validate(&contract)?;
                Ok::<_, String>(contract)
            })
            .transpose()?;
        if c.members.is_none() && c.approvals.is_some() {
            return Err("Legacy sessions cannot gain connected permissions implicitly".into());
        }
        let project = self.project_by_id(c.project_id.as_deref().unwrap_or(&crate::projects::id(&self.project)))?;
        if c.project_id.is_some() {crate::projects::validate(&project)?;}
        let s = Session {
            original_generation: None,
            project,
            original: None,
            contract,
            id: c.id.clone(),
            title: c.title.clone(),
            native: None,
        };
        self.save_session(&s)?;
        Ok(s)
    }
    pub(crate) fn save_session(&mut self, s: &Session) -> Result<(), String> {
        if self.project_by_id(&s.project.id)? != s.project { return Err("Session project mismatch".into()); }
        if let Ok(old) = self.session_by_id(&s.id) && old.project != s.project {return Err("Session project is immutable".into());}
        self.conn.execute("INSERT INTO sessions VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![s.id,serde_json::to_string(s).map_err(|_|"Cannot encode conversation")?]).map_err(|_|"Cannot persist conversation")?;
        Ok(())
    }
    pub fn bind_native(&mut self, id: &str, thread: &str, mode: Mode, runner: deck2_shared::NativeRunner) -> Result<(), String> {
        let mut s = self.session_by_id(id)?;
        s.native = Some(NativeContext {
            runner: Some(runner),
            thread: thread.into(),
            mode,
            provenance: None,
        });
        self.save_session(&s)
    }
    pub fn bind_provenance(
        &mut self,
        id: &str,
        p: deck2_shared::NativeProvenance,
    ) -> Result<(), String> {
        let mut s = self.session_by_id(id)?;
        s.native
            .as_mut()
            .ok_or("Native context missing")?
            .provenance = Some(p);
        self.save_session(&s)
    }
    pub fn queue_paused(&self) -> Result<bool, String> {
        self.conn
            .query_row("SELECT value FROM meta WHERE key='queue_paused'", [], |r| {
                r.get::<_, String>(0)
            })
            .map(|v| v == "true")
            .map_err(|_| "Cannot inspect queue".into())
    }
    pub fn pause_queue(&mut self, pause: bool) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE meta SET value=?1 WHERE key='queue_paused'",
                [if pause { "true" } else { "false" }],
            )
            .map_err(|_| "Cannot persist queue state")?;
        Ok(())
    }
    pub fn admit(&mut self, c: &ScopedSubmit) -> Result<Receipt, AdmissionError> {
        if c.queue
            && self
                .pending_receipts()
                .map_err(super::storage_error)?
                .iter()
                .filter(|r| r.phase == Phase::Queued)
                .count()
                >= 32
            && self.get(&c.id).map_err(super::storage_error)?.is_none()
        {
            return Err("Queue full; cancel waiting input first".into());
        }
        let submit = Submit {
            attachments: c.attachments.clone(),
            api: c.api,
            id: c.id.clone(),
            prompt: c.prompt.clone(),
            mode: c.mode.clone(),
        };
        self.accept_in(&submit, &c.session, c.queue, c.fresh)
    }
    pub fn claim_next(&mut self) -> Result<Option<Receipt>, String> {
        self.claim_next_with_limit(&std::collections::HashSet::new(), self.configuration()?.execution_budget.lead)
    }
    pub(crate) fn claim_next_with_limit(&mut self, live: &std::collections::HashSet<String>, cap: usize) -> Result<Option<Receipt>, String> {
        let paused = self.queue_paused()?;
        let cursor: String = self.conn.query_row("SELECT value FROM meta WHERE key='lead_cursor'", [], |row| row.get(0)).optional().map_err(|_| "Cannot read Lead cursor")?.unwrap_or_default();
        let pending = self.pending_receipts()?;
        let Some(occupied) = self.occupied_roots(&pending, live)? else { return Ok(None) };
        let mut eligible = Vec::new();
        for r in pending.into_iter().filter(|r| r.phase == Phase::Queued && (!paused || r.mode == Mode::SessionV1)) {
            if self.root_available_with_occupied(&r.mode, &r.session, &occupied, cap)?
                && !self.member_blocks_root(&r.mode, &r.session)?
            {
                eligible.push(r);
            }
        }
        // Round robin across sessions, with durable receipt rowid order
        // within each session even when wall-clock timestamps go backward.
        eligible.sort_by(|a, b| {
            (a.session <= cursor)
                .cmp(&(b.session <= cursor))
                .then_with(|| a.session.cmp(&b.session))
        });
        let mut selected = None;
        for candidates in eligible.chunk_by(|a, b| a.session == b.session) {
            let mut first_outcome = None;
            for candidate in candidates {
                if candidate.continuation.is_none() || candidate.dispatch_ms.is_some() {
                    selected = Some(candidate);
                    break;
                }
                if first_outcome.is_some() {
                    continue;
                }
                // Settle redundant outcomes under the same Store lock as admission.
                // Keep the earliest needed outcome queued when user input takes priority.
                if self.outcome_already_integrated(candidate)? {
                    let mut skipped = candidate.clone();
                    skipped.phase = Phase::Completed;
                    skipped.detail = "Task result already integrated by the Lead. No additional turn needed.".into();
                    self.save(&mut skipped)?;
                } else {
                    first_outcome = Some(candidate);
                }
            }
            selected = selected.or(first_outcome);
            if selected.is_some() {
                break;
            }
        }
        let Some(mut r) = selected.cloned() else {
            return Ok(None);
        };
        let session = self.session_by_id(&r.session)?;
        if r.mode.editing() && !self.trusted_project(&session.project.root)? {
            self.pause_queue(true)?;
            r.detail="Queued edit needs current project trust. Queue paused; restore trust then explicitly resume.".into();
            self.save(&mut r)?;
            return Ok(None);
        }
        // Queue -> Accepted is launch admission. The Store lock serializes this
        // lookup and single receipt write with mode updates; assignments stay frozen.
        if r.mode == Mode::SessionV1 {
            r.configuration
                .as_mut()
                .and_then(|s| s.session_contract.as_mut())
                .ok_or("Admitted session contract missing")?
                .approvals = session
                .contract
                .ok_or("Session contract missing")?
                .approvals;
        }
        r.phase = Phase::Accepted;
        r.detail =
            "Queued input claimed; rechecking native context and capabilities before dispatch"
                .into();
        self.save(&mut r)?;
        self.record_root_overlaps(&r)?;
        self.conn.execute("INSERT INTO meta(key,value) VALUES('lead_cursor',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [&r.session]).map_err(|_| "Cannot persist Lead cursor")?;
        Ok(Some(r))
    }
    pub(crate) fn forget_native(&mut self, id: &str) -> Result<(), String> {
        let mut s = self.session_by_id(id)?;
        s.native = None;
        self.save_session(&s)
    }
    pub fn release_session(&mut self, id: &str) -> Result<Session, String> {
        let mut s = self.session_by_id(id)?;
        if self.tasks()?.iter().any(|t| t.session == id) {
            return Err(
                "Task evidence is retained; this conversation cannot be released or removed in S4"
                    .into(),
            );
        }
        if self.all()?.iter().any(|r| {
            r.session == id
                && (r.phase.active() || r.phase == Phase::Uncertain || r.phase == Phase::Queued)
        }) {
            return Err("Stop or cancel pending work and resolve uncertain ownership before releasing context".into());
        }
        // No native child survives a settled attempt. Retain receipts; relinquish
        // only Deck's continuation reference. Never delete the native rollout.
        s.native = None;
        self.save_session(&s)?;
        Ok(s)
    }
    pub(crate) fn removal_preview(&self, id: &str) -> Result<RemovalPreview, String> {
        if self.session_by_id(id)?.original.is_some() {
            return Err("Original history is retained. Removing adopted sessions is not available in this migration increment.".into());
        }
        let next = self
            .sessions()?
            .into_iter()
            .find(|s| s.id != id)
            .ok_or("Keep at least one conversation. Create another before removing this one.")?
            .id;
        if self.changes()?.iter().any(|c| c.request.session == id) {
            return Err("This session contains developer lifecycle evidence. Keep it to inspect or continue the change.".into());
        }
        if self.ordinary_preparing()? {
            return Err(
                "Wait for session preparation to settle before removing local history.".into(),
            );
        }
        let receipts: Vec<_> = self
            .all()?
            .into_iter()
            .filter(|r| r.session == id)
            .collect();
        let tasks: Vec<_> = self
            .tasks()?
            .into_iter()
            .filter(|t| t.session == id)
            .collect();
        let phases = || {
            receipts.iter().map(|r| &r.phase).chain(
                tasks
                    .iter()
                    .flat_map(|t| t.attempts.iter().map(|a| &a.phase)),
            )
        };
        if phases().any(|phase| *phase == Phase::Uncertain) {
            return Err("Resolve uncertain process ownership before removing this session.".into());
        }
        if receipts
            .iter()
            .any(|r| r.continuation.is_some() && r.phase == Phase::Queued)
        {
            return Err(
                "Finish or cancel the queued subagent follow-up before removing this session."
                    .into(),
            );
        }
        if phases().any(|phase| phase.active() || *phase == Phase::Queued) {
            return Err(
                "Finish or cancel active and queued work before removing this session.".into(),
            );
        }
        if receipts.iter().flat_map(|r| &r.decisions).any(|d| {
            matches!(
                d.state,
                DecisionState::Pending | DecisionState::Responded | DecisionState::Dispatching
            )
        }) || crate::session_decisions::has_unresolved(self, id)?
        {
            return Err(
                "Resolve or cancel outstanding decisions before removing this session.".into(),
            );
        }
        if tasks.iter().any(|t| {
            t.attempts.last().is_some_and(|a| {
                a.treatments
                    .last()
                    .is_some_and(|v| v.disposition == "followup_required")
                    && receipts.iter().any(|r| {
                        r.id == t.authority_root(a)
                            && !r.cancel_requested
                            && r.phase != Phase::Cancelled
                    })
            })
        }) {
            return Err("Finish the requested subagent follow-up or cancel its originating input before removing this session.".into());
        }
        Ok(RemovalPreview {
            next,
            receipts: receipts.into_iter().map(|r| (r.id, r.revision)).collect(),
            attempts: tasks
                .iter()
                .flat_map(|t| t.attempts.iter().map(|a| a.id.clone()))
                .collect(),
            tasks: tasks.into_iter().map(|t| (t.id, t.revision)).collect(),
        })
    }

    pub fn remove_session(&mut self, id: &str) -> Result<(), String> {
        self.remove_session_checked(id, None)
    }

    pub(crate) fn remove_session_checked(
        &mut self,
        id: &str,
        before_retirement: Option<&RemovalPreview>,
    ) -> Result<(), String> {
        let tx = rusqlite::Transaction::new_unchecked(
            &self.conn,
            rusqlite::TransactionBehavior::Immediate,
        )
        .map_err(|_| "Cannot begin local session removal")?;
        let current = self.removal_preview(id)?;
        if let Some(before) = before_retirement {
            before.ensure_unchanged(&current)?;
        }
        let remove_default = id == self.session;

        // Capture dependents while their owning receipt/snapshot rows still exist.
        for sql in [
            "DELETE FROM snapshot_accesses WHERE json_extract(body,'$.snapshot') IN
                (SELECT id FROM read_snapshots WHERE json_extract(body,'$.root') IN
                    (SELECT id FROM receipts WHERE json_extract(body,'$.session')=?1))",
            "DELETE FROM snapshot_views WHERE id IN
                (SELECT id FROM read_snapshots WHERE json_extract(body,'$.root') IN
                    (SELECT id FROM receipts WHERE json_extract(body,'$.session')=?1))",
            "DELETE FROM read_snapshots WHERE json_extract(body,'$.root') IN
                (SELECT id FROM receipts WHERE json_extract(body,'$.session')=?1)",
            "DELETE FROM permission_rejections WHERE decision_id IN
                (SELECT json_extract(d.value,'$.id') FROM receipts r, json_each(r.body,'$.decisions') d
                    WHERE json_extract(r.body,'$.session')=?1)",
            "DELETE FROM task_calls WHERE root IN
                (SELECT id FROM receipts WHERE json_extract(body,'$.session')=?1)",
            "DELETE FROM tasks WHERE json_extract(body,'$.session')=?1",
            "DELETE FROM receipts WHERE json_extract(body,'$.session')=?1",
        ] {
            tx.execute(sql, [id]).map_err(|_| "Cannot remove local execution history")?;
        }
        for table in [
            "image_cancellations",
            "images",
            "session_selections",
            "session_epochs",
            "session_decisions",
            "decision_commands",
            "decision_replies",
            "activity_steps",
            "session_events",
        ] {
            tx.execute(&format!("DELETE FROM {table} WHERE session=?1"), [id])
                .map_err(|_| "Cannot remove local session records")?;
        }
        let session = self.session_by_id(id)?;
        let mut navigation = self.navigation()?;
        if let Some(order) = navigation.session_order.get_mut(&session.project.id) {
            let key = serde_json::json!(["local", session.project.id, id]).to_string();
            let count = order.len();
            order.retain(|entry| entry != &key);
            if order.len() != count {
                navigation.order_revision = navigation
                    .order_revision
                    .checked_add(1)
                    .ok_or("Navigation order revision exhausted")?;
                self.save_navigation(&navigation)?;
            }
        }
        tx.execute(
            "DELETE FROM meta WHERE key='lead_cursor' AND value=?1",
            [id],
        )
        .map_err(|_| "Cannot remove saved queue position")?;
        tx.execute("DELETE FROM sessions WHERE id=?1", [id])
            .map_err(|_| "Cannot remove local session")?;
        if remove_default {
            tx.execute(
                "UPDATE meta SET value=?1 WHERE key='session'",
                [&current.next],
            )
            .map_err(|_| "Cannot persist default session")?;
        }
        // Surviving evidence must satisfy the same ownership and link checks as restart.
        Self::inspect(&tx, &self.project)?;
        tx.commit()
            .map_err(|_| "Cannot commit local session removal")?;
        if remove_default {
            self.session = current.next;
        }
        Ok(())
    }


}
