//! Dedicated Antigravity processes for delegated work.
use super::sandbox;
use super::*;
use crate::session_tasks::{handoff, update, validate_authority, validate_original_task};
use deck2_shared::{Task, TaskAttempt, TaskReport};
use futures_util::{
    future::{AbortHandle, Abortable, BoxFuture},
    stream::{FuturesUnordered, StreamExt},
};

const MEMBER_QUALIFICATION: &str = "deck2-antigravity-acp-member-v1";

pub(crate) fn bind(
    snapshot: &mut AdmissionSnapshot,
    assignment: &MemberAssignment,
    role: &str,
    trusted: bool,
) -> Result<NativeProvenance, String> {
    let instructions = instructions(role)?;
    let storage = digest(
        &serde_json::to_vec(&(profile_key()?, &snapshot.project, trusted))
            .map_err(|_| "Invalid Antigravity member profile")?,
    );
    let native = native_binding(
        assignment,
        MEMBER_QUALIFICATION,
        storage,
        digest(instructions.as_bytes()),
    )?;
    let provenance = provenance(&native);
    snapshot.runner = Some(native.executable.clone());
    snapshot.native = Some(native);
    snapshot.cbm = None;
    snapshot.helper = None;
    snapshot.investigator = None;
    snapshot.exclusions = vec![
        "Antigravity members use workspace-bounded ACP and cannot receive live steering.".into(),
    ];
    Ok(provenance)
}

fn instructions(role: &str) -> Result<String, String> {
    Ok(format!(
        "{}\n\n{}",
        crate::session_roles::Role::packaged_instructions(role)?,
        crate::member_guidance::MEMBER_POLICY
    ))
}

fn provenance(native: &NativeBinding) -> NativeProvenance {
    NativeProvenance {
        runner: RUNNER.into(),
        integration: MEMBER_QUALIFICATION.into(),
        executable: native.executable.executable.clone(),
        storage: native.storage.clone(),
        content: native.role.clone(),
    }
}

pub(crate) fn admitted(snapshot: &AdmissionSnapshot, role: &str) -> bool {
    role != "lead"
        && snapshot
            .session_contract
            .as_ref()
            .and_then(|c| c.members.get(role))
            .is_some_and(|a| {
                a.runner_id == RUNNER
                    && snapshot.native.as_ref().is_some_and(|n| {
                        n.runner == NativeRunner::Agy
                            && n.protocol == "acp"
                            && n.version == "1"
                            && n.executable.qualification == MEMBER_QUALIFICATION
                            && n.executable.model.as_ref() == Some(&a.model_id)
                            && snapshot.runner.as_ref() == Some(&n.executable)
                    })
            })
}

pub(crate) fn matches_attempt(
    snapshot: &AdmissionSnapshot,
    role: &str,
    saved: &NativeProvenance,
) -> bool {
    admitted(snapshot, role)
        && snapshot
            .native
            .as_ref()
            .is_some_and(|n| provenance(n) == *saved)
}

pub(crate) fn compatible_predecessor(task: &Task, prior: &TaskAttempt, next: &TaskAttempt) -> bool {
    let (Some(old), Some(new)) = (&prior.configuration, &next.configuration) else {
        return false;
    };
    let assignment = |s: &AdmissionSnapshot| {
        s.session_contract
            .as_ref()
            .and_then(|c| c.members.get(&task.owner))
            .cloned()
    };
    matches_attempt(old, &task.owner, &prior.provenance)
        && matches_attempt(new, &task.owner, &next.provenance)
        && old.project == new.project
        && old.native == new.native
        && assignment(old) == assignment(new)
        && prior
            .native_session
            .as_deref()
            .is_some_and(|id| valid_id(id, 200))
}

fn state_owner(task: &Task, attempt: &TaskAttempt) -> String {
    digest(
        format!(
            "{}:{}:{}:{}:{}",
            task.id,
            task.session,
            task.owner,
            attempt.provenance.executable,
            attempt.provenance.storage
        )
        .as_bytes(),
    )
}

pub(crate) fn has_native_state(app: &App, task: &Task, attempt: &TaskAttempt) -> bool {
    app.artifact_root()
        .and_then(|path| crate::managed_tools::Directory::existing_root(&path))
        .and_then(|root| root.existing_dir("agy-members"))
        .and_then(|root| root.existing_dir(&state_owner(task, attempt)))
        .and_then(|owner| owner.existing_dir("profile"))
        .is_ok()
}

struct ShellReview {
    item: String,
    options: Value,
    abort: AbortHandle,
}

struct Member<'a> {
    app: &'a App,
    task: &'a Task,
    attempt: &'a TaskAttempt,
    project: &'a ProjectBinding,
    trusted: bool,
}

impl Member<'_> {
    fn current(&self, store: &Store, task: &Task, attempt: &TaskAttempt) -> Result<(), String> {
        validate_authority(store, task, attempt)?;
        let admitted = self
            .attempt
            .configuration
            .as_ref()
            .and_then(|s| s.session_contract.as_ref());
        let session = store.session_by_id(&task.session)?;
        if attempt.cancel_requested
            || !attempt.phase.active()
            || session
                .contract
                .as_ref()
                .zip(admitted)
                .is_none_or(|(current, then)| current.revision != then.revision)
            || store.execution_project(&task.session)? != *self.project
            || store.trusted_project(&self.project.root)? != self.trusted
            || !self.app.persistence_available()
            || self.app.shutdown_requested.load(Ordering::Acquire)
        {
            return Err("Antigravity member authority ended.".into());
        }
        Ok(())
    }

    fn dispatch(&self, thread: &str, fresh: bool, started: Instant) -> Result<String, String> {
        self.app.check_original_context(&self.task.session)?;
        validate_original_task(self.app, self.task)?;
        let store = self.app.store.lock().map_err(|_| "State lock failed")?;
        let mut task = store.task(&self.task.id)?;
        let index = task
            .attempts
            .iter()
            .position(|a| a.id == self.attempt.id)
            .ok_or("Member attempt missing")?;
        let attempt = &task.attempts[index];
        self.current(&store, &task, attempt)?;
        store.validate_snapshot(self.attempt.configuration.as_ref().unwrap())?;
        if attempt.phase != Phase::Preparing {
            return Err("Antigravity member preparation lease revoked.".into());
        }
        let prompt = handoff(&task, attempt, fresh)?;
        let attempt = &mut task.attempts[index];
        attempt.phase = Phase::Dispatching;
        attempt.dispatch_ms = Some(now());
        attempt.preparation_ms = Some(started.elapsed().as_millis() as u64);
        attempt.native_session = Some(thread.into());
        attempt.native_message = Some(attempt.id.clone());
        attempt.detail = "Delivering the Antigravity assignment once.".into();
        store.save_normal_task(&task)?;
        Ok(prompt)
    }

    fn check_live(&self) -> Result<(), String> {
        let store = self.app.store.lock().map_err(|_| "State lock failed")?;
        let task = store.task(&self.task.id)?;
        let attempt = task
            .attempts
            .iter()
            .find(|a| a.id == self.attempt.id)
            .ok_or("Member attempt missing")?;
        self.current(&store, &task, attempt)
    }

    fn stream_delta(&self, batch: &mut String) -> Result<(), String> {
        if !batch.is_empty() {
            update(self.app, &self.task.id, &self.attempt.id, |a| {
                a.first_output_ms.get_or_insert_with(now);
                a.text.push_str(batch);
            })?;
            batch.clear();
        }
        Ok(())
    }

    async fn stream(
        &self,
        client: &mut Client,
        thread: &str,
        request: u64,
        tools: &TrustedTools,
        bridge: &Bridge,
    ) -> Result<(), String> {
        let mut batch = String::new();
        let mut bytes = 0usize;
        let mut request_ids = HashSet::new();
        let mut tool_ids = HashSet::new();
        let mut tool_names = HashMap::new();
        let mut tick = tokio::time::interval(crate::claude::DELTA_BATCH_WINDOW);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let can_write = !matches!(self.task.owner.as_str(), "investigate" | "quality");
        let can_shell =
            self.trusted && matches!(self.task.owner.as_str(), "apply-fast" | "apply-deep");
        let bearer = bridge.config["http_headers"]["Authorization"]
            .as_str()
            .and_then(|value| value.strip_prefix("Bearer "))
            .ok_or("Member bridge credential missing")?;
        let mut pending = HashMap::<String, ShellReview>::new();
        let mut replies = FuturesUnordered::<BoxFuture<'_, (String, bool)>>::new();
        let result = async {
            loop {
                let message = tokio::select! {
                    biased;
                    _ = tick.tick() => {
                        self.stream_delta(&mut batch)?;
                        self.check_live()?;
                        continue;
                    }
                    message = client.read() => message?,
                    Some((wire, allow)) = replies.next(), if !replies.is_empty() => {
                        if let Some(review) = pending.remove(&wire) {
                            let allow = allow && self.check_live().is_ok();
                            client.reply(json!(wire), approval::outcome(&review.options, allow)).await?;
                        }
                        continue;
                    }
                };
                let Some(method) = message["method"].as_str() else {
                    return match response(&message, request)?["stopReason"].as_str() {
                        Some("end_turn" | "max_tokens") => Ok(()),
                        _ => Err("Antigravity stopped without a confirmed member report.".into()),
                    };
                };
                let params = &message["params"];
                if let Some(id) = message.get("id") {
                    let wire = id.as_str().filter(|id| valid_id(id, 128));
                    let fresh_wire = wire.is_some_and(|id| remember_permission_id(&mut request_ids, id));
                    if !fresh_wire && let Some(review) = wire.and_then(|wire| pending.remove(wire)) {
                        review.abort.abort();
                    }
                    if method != approval::METHOD {
                        client.reject(id.clone()).await?;
                        continue;
                    }
                    let tool = &params["toolCall"];
                    let item = tool["toolCallId"].as_str().filter(|id| valid_id(id, 200));
                    let fresh_tool = item.is_some_and(|id| remember_permission_id(&mut tool_ids, id));
                    if !fresh_tool && let Some(prior) = pending.iter().find(|(_, r)| Some(r.item.as_str()) == item).map(|(wire, _)| wire.clone()) {
                        pending.remove(&prior).unwrap().abort.abort();
                        client.reply(json!(prior), approval::outcome(&Value::Null, false)).await?;
                    }
                    if !fresh_wire || !fresh_tool {
                        client.reply(id.clone(), approval::outcome(&Value::Null, false)).await?;
                        continue;
                    }
                    let authorized = params["sessionId"] == thread && self.check_live().is_ok();
                    let identity = tools.identity(tool);
                    let options = &params["options"];
                    if authorized && can_shell && identity == approval::ToolIdentity::Native
                        && approval::outcome(options, true)["outcome"]["outcome"] == "selected"
                        && let Some((wire, item)) = wire.zip(item)
                        && let Some(args) = approval::member_shell_args(tool, self.project, item, bearer)
                    {
                        let (abort, registration) = AbortHandle::new_pair();
                        pending.insert(wire.into(), ShellReview { item: item.into(), options: options.clone(), abort });
                        let wire = wire.to_owned();
                        replies.push(Box::pin(async move {
                            let review = bridge.approve_claude_bash(self.app, self.project, &args);
                            let allow = Abortable::new(review, registration).await.is_ok_and(|result| result.is_ok());
                            (wire, allow)
                        }));
                        continue;
                    }
                    let allow = authorized && (identity == approval::ToolIdentity::Session
                        || self.trusted && (identity == approval::ToolIdentity::External
                            || approval::member_workspace_permission(tool, self.project, can_write)));
                    client.reply(id.clone(), approval::outcome(options, allow)).await?;
                } else if method == "session/update" && params["sessionId"] == thread {
                    let event = &params["update"];
                    match event["sessionUpdate"].as_str() {
                        Some("agent_message_chunk") if event["content"]["type"] == "text" => {
                            if let Some(text) = event["content"]["text"].as_str() {
                                let end =
                                    text.floor_char_boundary((MAX_TEXT - bytes).min(text.len()));
                                bytes += end;
                                batch.push_str(&text[..end]);
                                if batch.len() >= crate::claude::DELTA_BATCH_BYTES {
                                    self.stream_delta(&mut batch)?;
                                }
                            }
                        }
                        Some("tool_call" | "tool_call_update") => {
                            self.stream_delta(&mut batch)?;
                            if let Some(event) =
                                activity(&mut tool_names, thread, &self.attempt.id, event)
                            {
                                self.app.record_activity(
                                    self.task.authority_root(self.attempt),
                                    &self.task.id,
                                    &self.attempt.id,
                                    thread,
                                    &self.attempt.id,
                                    &event,
                                );
                            }
                        }
                        Some("usage_update") => {
                            update(self.app, &self.task.id, &self.attempt.id, |a| {
                                crate::observations::observe_agy(
                                    &mut a.context,
                                    &message,
                                    thread,
                                    &a.id,
                                    &a.id,
                                    a.observed_model.as_deref(),
                                );
                            })?
                        }
                        _ => {}
                    }
                }
            }
        }
        .await;
        self.stream_delta(&mut batch)?;
        result
    }
}

pub(crate) async fn run(app: &App, task: &str, attempt: &str) -> Result<(), String> {
    let started = Instant::now();
    let (task, project, trusted, external) = {
        let store = app.store.lock().map_err(|_| "State lock failed")?;
        let task = store.task(task)?;
        let project = store.execution_project(&task.session)?;
        let trusted = store.trusted_project(&project.root)?;
        let read_only = matches!(task.owner.as_str(), "investigate" | "quality");
        let external = external_tools(&store, &project, trusted, read_only)?;
        (task, project, trusted, external)
    };
    app.check_original_context(&task.session)?;
    let attempt = task
        .attempts
        .iter()
        .find(|a| a.id == attempt)
        .ok_or("Member attempt missing")?;
    let snapshot = attempt
        .configuration
        .as_ref()
        .ok_or("Member admission missing")?;
    let assignment = &snapshot
        .session_contract
        .as_ref()
        .ok_or("Member contract missing")?
        .members[&task.owner];
    let binding = snapshot
        .native
        .as_ref()
        .ok_or("Antigravity member binding missing")?;
    let mut checked = snapshot.clone();
    if bind(&mut checked, assignment, &task.owner, trusted)? != attempt.provenance
        || checked.native.as_ref() != Some(binding)
        || snapshot.project != project
    {
        return Err("Antigravity member binding changed after delegation.".into());
    }
    let selection = crate::session_continuity::launch(app, &task, attempt)?;
    let mut state: Value = serde_json::from_str(attempt.structured.as_deref().unwrap_or("{}"))
        .map_err(|_| "Invalid member continuity state")?;
    state["selection"] = selection.clone();
    update(app, &task.id, &attempt.id, |a| {
        a.structured = Some(state.to_string())
    })?;
    let predecessor = crate::session_continuity::predecessor(&task, attempt);
    let resume = if selection["continuity"] == "native" {
        Some(
            predecessor["nativeSessionId"]
                .as_str()
                .filter(|id| valid_id(id, 200))
                .ok_or("Antigravity predecessor session unavailable")?,
        )
    } else {
        if state["continuity"] == "native" {
            return Err(format!(
                "Native override refused: {}",
                selection["reason"].as_str().unwrap_or("unqualified")
            ));
        }
        None
    };
    let member = Member {
        app,
        task: &task,
        attempt,
        project: &project,
        trusted,
    };
    member.check_live()?;
    let bridge = Bridge::start_member(app, &task.id, &attempt.id).await?;
    let binary = Path::new(&binding.executable.path);
    let cwd = if trusted {
        Path::new(&project.root)
    } else {
        Path::new("/")
    };
    let instructions = instructions(&task.owner)?;
    let root = Path::new(&project.root);
    let read_only = matches!(task.owner.as_str(), "investigate" | "quality");
    let project_mount = if trusted {
        let identity = sandbox::parse_identity(project.identity.as_deref())?;
        Some((root, identity, read_only))
    } else {
        None
    };
    let sandbox = sandbox::Sandbox::prepare(
        &sandbox::Sandbox::state_root(app)?,
        &state_owner(&task, attempt),
        &profile_path()?,
        binary,
        cwd,
        project_mount,
        &external,
    )?;
    let mcp = Mcp::new(
        &bridge.config,
        &bridge.config["http_headers"]["Authorization"],
        &external,
        Some(Path::new(sandbox::SCRATCH)),
    )?;
    let tools = mcp.tools(&bridge);
    let mut client = Client::spawn_member(binary, |command| sandbox.apply(command))?;
    client.hold_cleanup(sandbox);
    let pid = client.pid();
    let mut thread = None;
    let result = async {
        update(app, &task.id, &attempt.id, |a| a.native_pid = Some(pid))?;
        app.history.lock().map_err(|_| "Original ownership unavailable")?.track_process(pid)?;
        tokio::select! {
            biased;
            _ = crate::session_tasks::cancelled(app, &task.id, &attempt.id) => return Err("Antigravity member stopped during initialization.".into()),
            result = timeout(STARTUP_TIMEOUT, open_session(&mut client, cwd, &mcp, resume, &instructions, assignment, &mut thread, None)) => result.map_err(|_| Error::Timeout)??,
        };
        let thread = thread.as_deref().ok_or(Error::Protocol)?;
        if file_digest(binary).map_err(|_| "Antigravity executable unavailable")? != binding.executable.executable {
            return Err("Antigravity member executable changed before dispatch.".into());
        }
        let text = member.dispatch(thread, resume.is_none(), started)?;
        let request = client.request("session/prompt", json!({"sessionId":thread,"prompt":[{"type":"text","text":text}]})).await?;
        update(app, &task.id, &attempt.id, |a| {
            a.phase = Phase::Running;
            a.acknowledgment_ms = Some(now());
            a.observed_model = Some(assignment.model_id.clone());
        })?;
        member.stream(&mut client, thread, request, &tools, &bridge).await
    }.await;
    drop(bridge);
    if result.is_err()
        && let Some(thread) = &thread
    {
        cancel_session(&mut client, thread).await;
    }
    client
        .stop()
        .await
        .map_err(|e| format!("member_cleanup_uncertain:{e}"))?;
    let mut store = app.store.lock().map_err(|_| "State lock failed")?;
    let mut settled = store.task(&task.id)?;
    let index = settled
        .attempts
        .iter()
        .position(|a| a.id == attempt.id)
        .ok_or("Member attempt missing")?;
    let authorized = member.current(&store, &settled, &settled.attempts[index]);
    let a = &mut settled.attempts[index];
    a.settled_ms = Some(now());
    match (a.cancel_requested, result.and(authorized)) {
        (true, _) => {
            a.phase = Phase::Cancelled;
            a.detail = "Antigravity member stopped and its native process settled.".into();
        }
        (false, Ok(())) => {
            a.phase = Phase::Completed;
            a.report = Some(TaskReport {
                attempt: a.id.clone(),
                digest: digest(a.text.as_bytes()),
                text: a.text.clone(),
            });
            a.detail = "Antigravity member settled. Report available for Lead review.".into();
        }
        (false, Err(error)) => {
            a.phase = Phase::Failed;
            a.detail = error;
        }
    }
    crate::session_tasks::save_member_settlement(&mut store, &settled, &attempt.id)
}

pub(crate) fn settle_recovered(store: &mut Store, live: &HashSet<String>) -> Result<bool, String> {
    let mut retry = false;
    for mut task in store.tasks()? {
        for index in 0..task.attempts.len() {
            let a = &mut task.attempts[index];
            if a.phase != Phase::Uncertain
                || a.provenance.integration != MEMBER_QUALIFICATION
                || live.contains(&a.id)
            {
                continue;
            }
            match a
                .native_pid
                .and_then(|pid| i32::try_from(pid).ok())
                .filter(|pid| *pid > 1)
            {
                Some(pid) if !crate::claude::process_group_stopped(pid) => {
                    retry = true;
                    continue;
                }
                None if a.dispatch_ms.is_some() => continue,
                _ => {}
            }
            a.phase = Phase::Failed;
            a.settled_ms = Some(now());
            a.detail = "The previous Antigravity member stopped without a confirmed result. Its assignment will not replay.".into();
            let attempt = a.id.clone();
            crate::session_tasks::save_member_settlement(store, &task, &attempt)?;
        }
    }
    Ok(retry)
}
