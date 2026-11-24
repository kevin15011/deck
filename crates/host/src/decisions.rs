//! Action-bound decisions. The store lock is the cancellation/revocation/release
//! serialization point; dispatch intent is persisted before touching native stdin.
use crate::{Store, now};
use deck2_shared::{API, Decision, DecisionResponse, DecisionState, Mode, Receipt, Resolve};
use std::{io::Read, os::unix::fs::MetadataExt, path::Path};

pub fn text_file(project: &str, path: &str) -> Result<String, String> {
    let path = Path::new(path);
    let root = Path::new(project);
    if !path.is_absolute() || !path.starts_with(root) || path == root {
        return Err("Only an existing text file inside this project can be reviewed".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "Proposed target is unavailable")?;
    if canonical != path || !canonical.starts_with(root) {
        return Err("Symlink or noncanonical targets are unavailable".into());
    }
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Cannot inspect proposed target")?;
    let meta = file
        .metadata()
        .map_err(|_| "Cannot inspect target metadata")?;
    if !meta.is_file() || meta.nlink() != 1 || meta.len() > 65536 {
        return Err("Only ordinary unlinked text files up to 64 KiB are supported".into());
    }
    let mut bytes = Vec::new();
    file.take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read target")?;
    if bytes.len() > 65536 || bytes.contains(&0) {
        return Err("Target is binary or oversized".into());
    }
    String::from_utf8(bytes).map_err(|_| "Target must be UTF-8 text".into())
}
pub fn file_identity(project: &str, path: &str) -> Result<String, String> {
    // Validate the same confined ordinary-file boundary, then bind metadata from
    // the opened inode. Native release still rechecks bytes and trust afterward.
    text_file(project, path)?;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Target unavailable")?;
    let m = file.metadata().map_err(|_| "Target identity unavailable")?;
    if !m.is_file() || m.nlink() != 1 {
        return Err("Target identity unsupported".into());
    }
    Ok(format!(
        "{}:{}:{}:{}:{}:{}:{}",
        m.dev(),
        m.ino(),
        m.len(),
        m.mtime(),
        m.mtime_nsec(),
        m.ctime(),
        m.ctime_nsec()
    ))
}
use std::os::unix::fs::OpenOptionsExt;
pub(crate) fn valid_id(id: &str) -> bool {
    (8..=80).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
// Only this pre-persistence validation failure certifies non-acceptance.
#[derive(Debug)]
pub enum ResolveError {
    InvalidAnswers,
    InvalidScope,
    TerminalRejection,
    Other(String),
}
impl From<String> for ResolveError {
    fn from(value: String) -> Self {
        Self::Other(value)
    }
}
impl From<&str> for ResolveError {
    fn from(value: &str) -> Self {
        Self::Other(value.into())
    }
}
impl Store {
    pub fn trusted(&self) -> Result<bool, String> {
        let schema:String=self.conn.query_row("SELECT value FROM meta WHERE key='schema'",[],|r|r.get(0)).map_err(|_|"Schema unavailable")?;
        if schema == "15" {return self.trusted_project(&self.project);}

        self.conn
            .query_row("SELECT value FROM meta WHERE key='trusted'", [], |r| {
                r.get::<_, String>(0)
            })
            .map(|v| v == "true")
            .map_err(|_| "Project trust unavailable".into())
    }
    pub fn set_trust(&mut self, project: &str, trusted: bool) -> Result<(), String> {
        let binding=self.project_by_id(&crate::projects::id(project))?;
        let sessions = if trusted { Vec::new() } else { self.sessions()? };

        let tx = self
            .conn
            .transaction()
            .map_err(|_| "Cannot persist project trust")?;
        tx.execute(
            "UPDATE projects SET trusted=?1 WHERE id=?2",
            rusqlite::params![trusted, binding.id],
        )
        .map_err(|_| "Cannot persist project trust")?;
        if !trusted {
            for mut session in sessions.into_iter().filter(|s| s.project == binding) {
                let Some(contract) = session.contract.as_mut() else { continue };
                crate::session_contract::advance_grant_revocation(contract)?;
                tx.execute(
                    "UPDATE sessions SET body=?1 WHERE id=?2",
                    rusqlite::params![
                        serde_json::to_string(&session).map_err(|_| "Cannot encode revocation")?,
                        session.id
                    ],
                )
                .map_err(|_| "Cannot revoke project session grants")?;
            }
            let mut stmt = tx
                .prepare("SELECT body FROM receipts")
                .map_err(|_| "Cannot read attempts")?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|_| "Cannot read attempts")?;
            let mut changes = Vec::new();
            for row in rows {
                let mut r: Receipt = serde_json::from_str(&row.map_err(|_| "Cannot read attempt")?)
                    .map_err(|_| "Corrupt attempt")?;
                let can_write = r.mode.editing() || r.mode == deck2_shared::Mode::SessionV1
                    && r.configuration.as_ref().and_then(|s| s.session_contract.as_ref())
                        .and_then(|c| c.members.get("lead"))
                        .is_some_and(|lead| matches!(lead.runner_id.as_str(), "codex" | "claude"));
                if r.configuration.as_ref().is_some_and(|c| c.project == binding) && can_write && r.phase.active() {
                    r.cancel_requested = true;
                    invalidate(
                        &mut r,
                        "Project trust revoked; interruption requested; released effects may already have occurred",
                    );
                    r.revision += 1;
                    changes.push(r);
                }
            }
            drop(stmt);
            for r in changes {
                tx.execute(
                    "UPDATE receipts SET body=?1 WHERE id=?2",
                    rusqlite::params![
                        serde_json::to_string(&r).map_err(|_| "Cannot encode attempt")?,
                        r.id
                    ],
                )
                .map_err(|_| "Cannot invalidate attempt")?;
            }
        }
        tx.commit()
            .map_err(|_| "Cannot commit project trust".into())
    }
    /// Serialize unread-input revocation with the native dispatch-intent write.
    /// Keep worker ownership active until cleanup; only the input is revoked here.
    pub fn recall_input(
        &mut self,
        session: &str,
        command: &str,
        attempt: &str,
    ) -> Result<Receipt, String> {
        let r = self.get(command)?.ok_or("Unknown input")?;
        if r.session != session || r.attempt != attempt {
            return Err("Input ownership changed; recall not confirmed".into());
        }
        if r.steered_to.is_some() || r.dispatch_ms.is_some()
            || !(matches!(
                r.phase,
                deck2_shared::Phase::Queued
                    | deck2_shared::Phase::Accepted
                    | deck2_shared::Phase::Preparing
            ) || r.phase == deck2_shared::Phase::Cancelled && r.cancel_requested)
        {
            return Err(
                "Input already started or delivery is uncertain; recall not confirmed".into(),
            );
        }
        if r.recalled_ms.is_some() {
            return Ok(r);
        }
        let mut r = self.request_cancel(command)?;
        r.recalled_ms = Some(crate::now());
        self.save(&mut r)?;
        Ok(r)
    }
    pub fn request_cancel(&mut self, command: &str) -> Result<Receipt, String> {
        self.get(command)?.ok_or("Unknown command")?;
        let all=self.all()?;
        let mut scope=std::collections::HashSet::from([command.to_string()]);
        loop {
            let before=scope.len();
            for r in &all {if r.continuation.as_ref().is_some_and(|c|scope.contains(&c.origin)) {scope.insert(r.id.clone());}}
            if before==scope.len() {break;}
        }
        let mut original=None;
        for id in std::iter::once(command.to_string()).chain(all.iter().filter(|r|r.id!=command && scope.contains(&r.id)).map(|r|r.id.clone())) {
            let mut r=self.get(&id)?.ok_or("Cancellation owner missing")?;
            if r.steered_to.is_some() {
                if id == command { return Ok(r); }
                continue;
            }
            if r.phase==deck2_shared::Phase::Queued {
                r.phase=deck2_shared::Phase::Cancelled;
                r.detail="Cancelled while definitely undispatched; native was never launched".into();
            }
            // A completed origin can still own live independent delegates and
            // outcome turns. Revoke future authority without rewriting its result.
            r.cancel_requested=true;
            invalidate(&mut r,"Cancellation requested; prior effects may already have occurred");
            self.save(&mut r)?;
            self.cancel_tasks(&id)?;
            if id==command {original=Some(r);}
        }
        original.ok_or("Cancellation origin missing".into())
    }
    pub fn resolve(&mut self, id: &str, response: &Resolve) -> Result<Decision, ResolveError> {
        self.resolve_selected(id,response,None)
    }
    pub(crate) fn resolve_selected(&mut self, id: &str, response: &Resolve, selection: Option<&str>) -> Result<Decision, ResolveError> {
        if response.api != API || !valid_id(&response.command_id) {
            return Err("Invalid decision response identity/API".into());
        }
        if self.rejected_response_id(&response.command_id)? {
            return Err("Response command identity was terminally rejected".into());
        }
        let all = self.all()?;
        // Response command identities are global within this durable host session.
        for r in &all {
            for d in &r.decisions {
                if d.resolution
                    .as_ref()
                    .is_some_and(|v| v.command_id == response.command_id)
                {
                    // Omission and the persisted exact option are the same
                    // payload. Broader scope remains part of UUID identity.
                    let scope = d.native.as_ref().and_then(|n| n.permission.as_ref());
                    let exact = scope.map(|p| p.option_id.as_str());
                    let recorded = scope.and_then(|p| p.selected_option.as_deref())
                        .filter(|v| Some(*v) != exact);
                    let selected = selection.filter(|v| Some(*v) != exact);
                    return if d.id == id && d.resolution.as_ref() == Some(response)
                        && recorded == selected {
                        Ok(d.clone())
                    } else {
                        Err("Response command identity conflicts".into())
                    };
                }
            }
        }
        let mut r = all
            .into_iter()
            .find(|r| r.decisions.iter().any(|d| d.id == id))
            .ok_or("Unknown decision")?;
        let d = r
            .decisions
            .iter_mut()
            .find(|d| d.id == id)
            .ok_or("Unknown decision")?;
        let owned = if let Some(task) = &d.task {
            self.task(task)?.attempts.iter().any(|a| {
                a.id == d.attempt
                    && a.generation == d.generation
                    && a.phase == deck2_shared::Phase::Running
                    && !a.cancel_requested
                    && a.native_session.as_ref() == Some(&d.thread)
                    && a.native_message.as_ref() == Some(&d.turn)
            })
        } else {
            r.phase.active()
                && d.attempt == r.attempt
                && d.generation == r.generation
                && r.thread.as_ref() == Some(&d.thread)
                && r.turn.as_ref() == Some(&d.turn)
        };
        if !owned
            || r.cancel_requested
            || d.state != DecisionState::Pending
            || d.revision != response.expected_revision
            || d.session != r.session
        {
            return Err(
                "Decision is stale, cancelled or belongs to an old native connection".into(),
            );
        }
        match &response.response {
            DecisionResponse::AllowOnce
            | DecisionResponse::AllowSession
            | DecisionResponse::AllowAlways
                if r.mode == Mode::SessionV1 && d.native.is_some() && d.questions.is_empty() =>
            {
                let native = d.native.as_ref().ok_or("Native action missing")?;
                if response.response == DecisionResponse::AllowSession && native.identity.is_none()
                {
                    return Err("Action has no exact identity for a session grant".into());
                }
                if response.response == DecisionResponse::AllowAlways
                    && !crate::native_approval::supports_persistent(d)
                {
                    return Err("Native persistent grant unsupported for this action".into());
                }
            }

            DecisionResponse::AllowOnce if d.file.is_some() && self.trusted_project(&self.execution_project(&r.session)?.root)? => {}
            DecisionResponse::Deny => {}
            DecisionResponse::Answers(answers) if d.file.is_none() && !d.questions.is_empty() => {
                if answers.len() != d.questions.len()
                    || d.questions.iter().any(|q| {
                        answers.get(&q.id).is_none_or(|a| {
                            a.is_empty()
                                || a.len() > if q.multiple { 12 } else { 1 }
                                || a.iter().any(|s| s.len() > 4096 || s.trim().is_empty())
                        })
                    })
                {
                    return Err(ResolveError::InvalidAnswers);
                }
            }
            _ => return Err("This response is not allowed for this decision".into()),
        }
        if d.native.as_ref().is_some_and(|n|n.permission.is_some())
            && response.response==DecisionResponse::AllowSession
            && !self.permission_current(d)? {return Err("Session permission scope or authority changed".into());}
        if let Some(n) = &mut d.native { n.resolution_provenance = Some(deck2_shared::PermissionProvenance::User); }
        if d.native.is_some() && d.questions.is_empty() {
            self.bind_permission(d)?;
            if response.response == DecisionResponse::AllowSession
                && d.native.as_ref().is_some_and(|n| n.transport != Some(deck2_shared::NativeTransport::OpencodeHttp) && n.permission.is_none()) {
                return Err("Complete actor and material evidence required for session consent".into());
            }
        }
        if let Some(selected)=selection {
            let p=d.native.as_mut().and_then(|n|n.permission.as_mut()).ok_or("Scope unavailable")?;
            if response.response!=DecisionResponse::AllowSession || !p.options.iter().any(|o|o.id==selected) {return Err("Scope unavailable".into());}
            p.selected_option=Some(selected.into());
        }
        d.resolution = Some(response.clone());
        d.state = DecisionState::Responded;
        d.detail = "Response recorded; native permission has not been released".into();
        let result = d.clone();
        self.save(&mut r)?;
        Ok(result)
    }
    pub fn authorize_response(
        &mut self,
        command: &str,
        decision: &str,
        generation: &str,
    ) -> Result<Option<Decision>, String> {
        self.reconsider_permission(command, decision)?;
        let mut r = self.get(command)?.ok_or("Unknown attempt")?;
        if !r.phase.active() || r.cancel_requested || r.generation != generation {
            return Ok(None);
        }
        // Revocation can race native request admission after grant lookup. Recheck
        // persisted authority at the final release boundary, including automatic replies.
        if r.mode == Mode::SessionV1 {
            let current = self.session_by_id(&r.session)?.contract.ok_or("Connected contract missing")?;
            let admitted = r.configuration.as_ref().and_then(|s| s.session_contract.as_ref()).ok_or("Admitted contract missing")?;
            if admitted.generation != current.generation || admitted.grants_revoked_at != current.grants_revoked_at || admitted.lead_task != current.lead_task {
                return Ok(None);
            }
        }
        if r.mode == Mode::Developer
            && let Some(d) = r.decisions.iter().find(|d| d.id == decision)
            && let Some(f) = &d.file
        {
            self.developer_edit_allowed(&r, &f.path)?;
        }
        let Some(d) = r
            .decisions
            .iter_mut()
            .find(|d| d.id == decision && d.state == DecisionState::Responded)
        else {
            return Ok(None);
        };
        if d.command != command
            || d.attempt != r.attempt
            || d.generation != generation
            || d.session != r.session
            || r.thread.as_ref() != Some(&d.thread)
            || r.turn.as_ref() != Some(&d.turn)
        {
            return Err("Decision ownership mismatch".into());
        }
        let response = &d.resolution.as_ref().ok_or("Missing response")?.response;
        if d.native.is_some() {
            if r.mode != Mode::SessionV1 {
                return Err("Native permission is no longer admitted".into());
            }
            crate::native_approval::validate_native(d)?;
            if !self.permission_current(d)? && !matches!(response,DecisionResponse::Deny) { return Ok(None); }
            d.grant_consumed = matches!(
                response,
                DecisionResponse::AllowOnce
                    | DecisionResponse::AllowSession
                    | DecisionResponse::AllowAlways
            );
        } else if *response == DecisionResponse::AllowOnce {
            if !r.mode.editing() {
                return Err("Read-only admission cannot release a file effect".into());
            }
            if r.mode.ordinary() && self.tasks_unsettled()? {
                return Ok(None);
            }
            let project=self.execution_project(&r.session)?.root;
            let file = d.file.as_ref().ok_or("Missing effect")?;
            if !self.trusted_project(&self.execution_project(&r.session)?.root)?
                || text_file(&self.session_project(&r.session)?.root, &file.path)? != file.before
                || (r.mode.ordinary()
                    && file.identity.as_ref().is_none_or(|id| {
                        file_identity(&project, &file.path).as_ref() != Ok(id)
                    }))
            {
                d.state = DecisionState::Invalidated;
                d.detail = "Reviewed target changed or trust revoked. No permission released; cancel and request a fresh proposal.".into();
                self.save(&mut r)?;
                return Ok(None);
            }
            d.grant_consumed = true;
        }
        d.state = DecisionState::Dispatching;
        d.dispatch_ms = Some(now());
        d.detail = "Durable response intent recorded; delivery may be uncertain".into();
        let result = d.clone();
        self.save(&mut r)?;
        Ok(Some(result))
    }
}
pub fn invalidate(r: &mut Receipt, reason: &str) {
    for d in &mut r.decisions {
        if matches!(d.state, DecisionState::Pending | DecisionState::Responded) {
            d.state = DecisionState::Invalidated;
            d.detail = reason.into();
        }
    }
}
/// A completed Lead turn does not invalidate an independently owned member.
pub fn invalidate_native_attempt(r: &mut Receipt, reason: &str) {
    for d in &mut r.decisions {
        if d.task.is_none() && matches!(d.state, DecisionState::Pending | DecisionState::Responded)
        {
            d.state = DecisionState::Invalidated;
            d.detail = reason.into();
        }
    }
}
impl Store {
    pub fn authorize_member_response(
        &mut self,
        root: &str,
        decision: &str,
        task: &str,
        attempt: &str,
    ) -> Result<Option<Decision>, String> {
        self.reconsider_permission(root, decision)?;
        let mut r = self.get(root)?.ok_or("Unknown member origin")?;
        if r.cancel_requested || r.mode != Mode::SessionV1 {
            return Ok(None);
        }
        let t = self.task(task)?;
        if t.session != r.session {
            return Err("Foreign member response".into());
        }
        let a = t
            .attempts
            .iter()
            .find(|a| {
                a.id == attempt && a.phase == deck2_shared::Phase::Running && !a.cancel_requested
            })
            .ok_or("Member attempt is no longer live")?;
        if t.authority_root(a)!=root {return Err("Foreign member attempt authority".into());}
        if crate::session_tasks::validate_authority(self, &t, a).is_err() {return Ok(None);}
        let admitted=a.configuration.as_ref().and_then(|s|s.session_contract.as_ref()).ok_or("Member assignment missing")?;
        let current=self.session_by_id(&r.session)?.contract.ok_or("Session contract missing")?;
        if admitted.grants_revoked_at != current.grants_revoked_at {return Ok(None);}

        let Some(d) = r.decisions.iter_mut().find(|d| {
            d.id == decision
                && d.task.as_deref() == Some(task)
                && d.attempt == attempt
                && d.generation == a.generation
                && d.state == DecisionState::Responded
        }) else {
            return Ok(None);
        };
        if a.native_session.as_ref() != Some(&d.thread)
            || a.native_message.as_ref() != Some(&d.turn)
        {
            return Err("Member approval identity mismatch".into());
        }
        crate::native_approval::validate_native(d)?;
        if !self.permission_current(d)? && d.resolution.as_ref().is_none_or(|r|r.response!=DecisionResponse::Deny) {return Ok(None);}
        d.state = DecisionState::Dispatching;
        d.dispatch_ms = Some(now());
        let result = d.clone();
        self.save(&mut r)?;
        Ok(Some(result))
    }
}
