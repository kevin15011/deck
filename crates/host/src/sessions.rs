//! Project-local conversations and definitely-undispatched input. The Store lock
//! serializes queue cancellation, claim, and the single project execution slot.
use crate::{AdmissionError, Store};
use deck2_shared::{
    API, Mode, NativeContext, Phase, Receipt, ScopedSubmit, Session, SessionCommand, Submit,
};
use rusqlite::{OptionalExtension, params};
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
        if self.sessions()?.len() >= 64 {
            return Err("Conversation limit reached".into());
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
                .all()
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
        let all = self.all()?;
        let mut eligible = Vec::new();
        for r in all.into_iter().filter(|r| r.phase == Phase::Queued && (!paused || r.mode == Mode::SessionV1)) {
            if self.root_available(&r.mode, &r.session, live, cap)? && !self.member_blocks_root(&r.mode, &r.session)? { eligible.push(r); }
        }
        // Stable receipt arrival order within each session, round robin across
        // sessions. Stable sorting preserves receipts rowid order within a session,
        // including tied timestamps and wall-clock rollback. The durable cursor
        // survives disconnects and host restart.
        eligible.sort_by(|a,b| (a.session <= cursor).cmp(&(b.session <= cursor)).then(a.session.cmp(&b.session)));
        let Some(mut r) = eligible.into_iter().next() else { return Ok(None); };
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
    pub fn remove_session(&mut self, id: &str) -> Result<(), String> {
        if self.session_by_id(id)?.original.is_some() {
            return Err("Original history is retained. Removing adopted sessions is not available in this migration increment.".into());
        }
        let next = self
            .sessions()?
            .into_iter()
            .find(|s| s.id != id)
            .ok_or("Keep at least one conversation; create another before removing this one")?
            .id;
        if self.changes()?.iter().any(|c| c.request.session == id) {
            return Err("Developer lifecycle evidence is retained; keep this conversation to inspect or continue the change. Release native context instead after work settles.".into());
        }
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
            return Err("Active, queued or uncertain evidence cannot be removed".into());
        }
        let ids: Vec<_> = self
            .all()?
            .into_iter()
            .filter(|r| r.session == id)
            .map(|r| r.id)
            .collect();
        let tx = self
            .conn
            .transaction()
            .map_err(|_| "Cannot begin removal")?;
        for id in ids {
            tx.execute("DELETE FROM receipts WHERE id=?1", [id])
                .map_err(|_| "Cannot remove local receipt")?;
        }
        tx.execute("DELETE FROM image_cancellations WHERE session=?1", [id])
            .map_err(|_| "Cannot remove upload identities")?;
        tx.execute("DELETE FROM images WHERE session=?1", [id])
            .map_err(|_| "Cannot remove conversation images")?;
        tx.execute("DELETE FROM session_selections WHERE session=?1", [id])
            .map_err(|_| "Cannot remove local selection")?;
        for table in ["session_decisions", "decision_commands", "decision_replies"] {
            tx.execute(&format!("DELETE FROM {table} WHERE session=?1"), [id])
                .map_err(|_| "Cannot remove durable decisions")?;
        }
        tx.execute("DELETE FROM activity_steps WHERE session=?1", [id])
            .map_err(|_| "Cannot remove local activity")?;
        tx.execute("DELETE FROM session_events WHERE session=?1", [id])
            .map_err(|_| "Cannot remove local session events")?;
        tx.execute("DELETE FROM sessions WHERE id=?1", [id])
            .map_err(|_| "Cannot remove local conversation")?;
        if id == self.session {
            tx.execute("UPDATE meta SET value=?1 WHERE key='session'", [&next])
                .map_err(|_| "Cannot persist default conversation")?;
        }
        tx.commit().map_err(|_| "Cannot commit local removal")?;
        if id == self.session {
            self.session = next;
        }
        Ok(())
    }
}
