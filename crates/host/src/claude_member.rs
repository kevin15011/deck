use super::*;
use crate::session_tasks::{handoff, update, validate_authority, validate_original_task};
use deck2_shared::{MemberAssignment, Task, TaskAttempt, TaskReport};

pub(super) const QUALIFICATION: &str = "deck2-claude-agent-sdk-member-v1";

fn role_key(role: &str) -> Result<String, String> {
    Ok(digest(
        crate::session_roles::Role::packaged_instructions(role)?.as_bytes(),
    ))
}

pub(crate) fn bind(
    snapshot: &mut AdmissionSnapshot,
    assignment: &MemberAssignment,
    role: &str,
    trusted: bool,
) -> Result<NativeProvenance, String> {
    let launch =
        Launch::new(trusted.then(|| Path::new(&snapshot.project.root))).map_err(|s| s.message())?;
    let storage = launch.storage().map_err(|s| s.message())?;
    // Keep the existing trust discriminator so stored native continuations survive.
    let trust_key = if trusted { "project" } else { "" };
    let context = digest(
        &serde_json::to_vec(&(storage, trust_key, &snapshot.project))
            .map_err(|_| "Invalid Claude member storage")?,
    );
    let role = role_key(role)?;
    let native = super::binding(assignment, QUALIFICATION, context, role)?;
    let provenance = provenance(&native);
    snapshot.runner = Some(native.executable.clone());
    snapshot.native = Some(native);
    snapshot.cbm = None;
    snapshot.helper = None;
    snapshot.investigator = None;
    snapshot.exclusions = vec!["Trusted Claude Code Apply members use native Bash with session permissions. Attachments are unavailable. Live Lead guidance reaches the same native session.".into()];
    Ok(provenance)
}

fn provenance(native: &NativeBinding) -> NativeProvenance {
    NativeProvenance {
        runner: RUNNER.into(),
        integration: QUALIFICATION.into(),
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
            .is_some_and(|assignment| super::matches_binding(snapshot, assignment, QUALIFICATION))
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
            .is_some_and(|native| provenance(native) == *saved)
}

pub(crate) fn compatible_predecessor(task: &Task, prior: &TaskAttempt, next: &TaskAttempt) -> bool {
    let (Some(old), Some(new)) = (&prior.configuration, &next.configuration) else {
        return false;
    };
    let (Some(old_native), Some(new_native)) = (&old.native, &new.native) else {
        return false;
    };
    let old_assignment = old.session_contract.as_ref().and_then(|c| c.members.get(&task.owner));
    let new_assignment = new.session_contract.as_ref().and_then(|c| c.members.get(&task.owner));
    matches_attempt(old, &task.owner, &prior.provenance)
        && matches_attempt(new, &task.owner, &next.provenance)
        && old.project == new.project
        && old_native.protocol == new_native.protocol
        && old_native.version == new_native.version
        && old_native.executable == new_native.executable
        && prior.provenance == next.provenance
        && old_assignment == new_assignment
        && prior
            .native_session
            .as_ref()
            .is_some_and(|id| Uuid::parse_str(id).is_ok())
}

fn current(
    store: &Store,
    task: &Task,
    attempt: &TaskAttempt,
    project: &ProjectBinding,
    trusted: bool,
) -> Result<(), String> {
    if attempt.cancel_requested || !attempt.phase.active() {
        return Err("Claude member execution was stopped".into());
    }
    validate_authority(store, task, attempt)?;
    if store.execution_project(&task.session)? != *project
        || store.trusted_project(&project.root)? != trusted
    {
        return Err("Claude member project ownership or trust changed".into());
    }
    Ok(())
}

pub(crate) async fn run(app: &App, task: &str, attempt: &str) -> Result<(), String> {
    let (t, project, trusted) = {
        let store = app.store.lock().unwrap();
        let t = store.task(task)?;
        let project = store.execution_project(&t.session)?;
        let trusted = store.trusted_project(&project.root)?;
        (t, project, trusted)
    };
    app.check_original_context(&t.session)?;
    let a = t
        .attempts
        .iter()
        .find(|a| a.id == attempt)
        .ok_or("Member attempt missing")?;
    let snapshot = a.configuration.as_ref().ok_or("Member admission missing")?;
    let contract = snapshot
        .session_contract
        .as_ref()
        .ok_or("Member contract missing")?;
    let assignment = &contract.members[&t.owner];
    let bound = snapshot
        .native
        .as_ref()
        .ok_or("Claude member binding missing")?;
    let mut checked = snapshot.clone();
    bind(&mut checked, assignment, &t.owner, trusted)?;
    if checked.native.as_ref() != Some(bound) || snapshot.project != project {
        return Err(
            "Claude member executable, role or workspace profile changed since delegation".into(),
        );
    }
    let mut selection = crate::session_continuity::launch(app, &t, a)?;
    let state: Value = serde_json::from_str(a.structured.as_deref().unwrap_or("{}"))
        .map_err(|_| "Invalid member continuity state")?;
    let explicit_native = state["continuity"] == "native";
    let predecessor = crate::session_continuity::predecessor(&t, a);
    let resume = selection["continuity"] == "native";
    let mut thread = if resume {
        predecessor["nativeSessionId"]
            .as_str()
            .filter(|id| Uuid::parse_str(id).is_ok())
            .ok_or("Claude member native session identity unavailable")?
            .to_owned()
    } else {
        Uuid::new_v4().to_string()
    };
    let instructions = format!(
        "{}\n\n{}",
        crate::session_roles::Role::packaged_instructions(&t.owner)?,
        crate::member_guidance::MEMBER_POLICY
    );
    let save_selection = |selection: &Value| {
        update(app, task, attempt, |a| {
            let mut state = state.clone();
            state["selection"] = selection.clone();
            a.structured = Some(state.to_string());
        })
    };
    save_selection(&selection)?;
    if explicit_native && !resume {
        return Err(format!(
            "Native override refused: {}",
            selection["reason"].as_str().unwrap_or("unqualified")
        ));
    }
    let started = Instant::now();
    let launch = Launch::new(trusted.then(|| Path::new(&project.root))).map_err(|s| s.message())?;
    let binary = Path::new(&bound.executable.path);
    let status = tokio::select! {
        biased;
        _ = crate::session_tasks::cancelled(app, task, attempt) => return Err("Claude member stopped during authentication".into()),
        status = launch.status(binary) => status,
    };
    if status != Status::SubscriptionSignedIn {
        return Err(status.message().into());
    }
    let bridge = crate::session_mcp::Bridge::start_member(app, task, attempt).await?;
    let can_write = trusted && !matches!(t.owner.as_str(), "investigate" | "quality");
    let allow_bash = can_write && matches!(t.owner.as_str(), "apply-fast" | "apply-deep");
    let script = bridge_script()?;
    let mut child = super::spawn_sdk(
        &launch,
        &super::node_runtime()?,
        script.path(),
        binary,
        &thread,
        if resume { "member-resume" } else { "member" },
        assignment,
    )?;
    let pid = child
        .id()
        .ok_or("Claude member process identity unavailable")?;
    let mut stdin = child.stdin.take().expect("configured Claude SDK stdin");
    let mut stdout = BufReader::new(child.stdout.take().expect("configured Claude SDK stdout"));
    let result = async {
        update(app, task, attempt, |a| a.native_pid = Some(pid))?;
        app.history.lock().map_err(|_| "Original ownership unavailable")?.track_process(pid)?;
        let mut config = bootstrap(&bridge, instructions, trusted, can_write, allow_bash);
        if resume {
            let storage = launch.storage().map_err(|s| s.message())?;
            config["transcriptStorage"] = json!(storage.to_str().ok_or("Claude transcript storage path is invalid")?);
        }
        send(&mut stdin, config).await?;
        let mut partial = Vec::new();
        let mut use_native = resume;
        let ready = timeout(Duration::from_secs(20), async {
            let event = frame(&mut stdout, &mut partial).await?;
            if use_native && event["type"] == "transcript_unavailable" {
                selection["reason"] = json!("native-transcript-unavailable");
                save_selection(&selection)?;
                return Err("Claude could not verify the member transcript. No correction was sent. Choose fresh continuity to continue.".into());
            }
            if use_native && event["type"] == "transcript_missing" {
                selection["reason"] = json!("native-session-not-found");
                selection["continuity"] = json!("reseeded");
                if explicit_native {
                    selection["override"] = json!("refused");
                    save_selection(&selection)?;
                    return Err("The Claude member transcript is missing. No correction was sent. Choose fresh continuity to continue.".into());
                }
                save_selection(&selection)?;
                use_native = false;
                thread = Uuid::new_v4().to_string();
                send(&mut stdin, json!({"type":"start_fresh", "session_id":thread})).await?;
                return frame(&mut stdout, &mut partial).await;
            }
            Ok::<_, String>(event)
        });
        let ready = tokio::select! {
            biased;
            _ = crate::session_tasks::cancelled(app, task, attempt) => return Err("Claude member stopped during SDK initialization".into()),
            ready = ready => ready.map_err(|_| "Claude member SDK initialization timed out")??,
        };
        check_ready(app, &ready, "member")?;
        let current_task = app.store.lock().unwrap().task(task)?;
        let current_attempt = current_task.attempts.iter().find(|a| a.id == attempt).ok_or("Member attempt missing")?;
        let prompt = handoff(&current_task, current_attempt, !use_native)?;
        if file_digest(binary).map_err(|_| "Claude member executable unavailable")? != bound.executable.executable {
            return Err("Claude member executable changed before dispatch".into());
        }
        app.check_original_context(&t.session)?;
        validate_original_task(app, &t)?;
        {
            let store = app.store.lock().unwrap();
            let mut t = store.task(task)?;
            let index = t.attempts.iter().position(|a| a.id == attempt).ok_or("Member attempt missing")?;
            current(&store, &t, &t.attempts[index], &project, trusted)?;
            store.validate_snapshot(snapshot)?;
            let a = &mut t.attempts[index];
            if a.phase != Phase::Preparing {
                return Err("Claude member preparation lease revoked".into());
            }
            a.phase = Phase::Dispatching;
            a.preparation_ms = Some(started.elapsed().as_millis() as u64);
            a.dispatch_ms = Some(now());
            a.detail = "Claude member subscription verified. Delivering the assignment once.".into();
            store.save_normal_task(&t)?;
        }
        send(&mut stdin, json!({"type":"send", "text":prompt, "message_id":a.id})).await?;

        let mut text = String::new();
        let mut initialized = false;
        let mut relay_decisions = bash::Decisions::default();
        let bash_project = allow_bash.then_some(&project);
        let mut controls = tokio::time::interval(Duration::from_millis(100));
        controls.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        // At most one live Lead input is outstanding; its id is the SDK message uuid.
        let mut steering: Option<(deck2_shared::SteeringCommand, Instant)> = None;
        // Inputs recorded as unconfirmed whose native receipt may still arrive.
        let mut unconfirmed: Vec<deck2_shared::SteeringCommand> = Vec::new();
        loop {
            let event = tokio::select! {
                biased;
                _ = controls.tick() => {
                    if app.shutdown_requested.load(std::sync::atomic::Ordering::SeqCst)
                        || !app.persistence_available() {
                        return Err("Claude member host authority ended".into());
                    }
                    let pending = {
                        let store = app.store.lock().unwrap();
                        let t = store.task(task)?;
                        let a = t.attempts.iter().find(|a| a.id == attempt).ok_or("Member attempt missing")?;
                        current(&store, &t, a, &project, trusted)?;
                        a.guidance_open && a.guidance.iter().any(|g| g.input.state == deck2_shared::SteeringState::Pending)
                    };
                    if steering.as_ref().is_some_and(|(_, deadline)| Instant::now() >= *deadline)
                        && let Some((command, _)) = steering.take() {
                        // The bridge wrote it but the SDK has not confirmed consumption yet.
                        // Record it as unconfirmed; an exact later receipt still reconciles it.
                        crate::member_guidance::resolve(app, task, attempt, &command, None)?;
                        unconfirmed.push(command);
                    }
                    if pending && initialized && steering.is_none()
                        && let Some(command) = crate::member_guidance::claim(app, task, attempt, &thread, attempt)? {
                        send(&mut stdin, json!({"type":"steer","id":command.id,"text":crate::member_guidance::framed(&command)})).await?;
                        steering = Some((command, Instant::now() + crate::member_guidance::confirm_window()));
                    }
                    continue;
                }
                (request, result) = relay_decisions.next() => {
                    send(&mut stdin, bash::reply(request, result)).await?;
                    continue;
                }
                event = frame(&mut stdout, &mut partial) => event.map_err(|error|
                    format!("{error} Claude did not confirm the member turn. The input will not replay.")
                )?,
            };
            if matches!(event["type"].as_str(), Some("session_mismatch" | "transport_error")) {
                return Err("Claude did not confirm the member turn in the expected session. The input will not replay.".into());
            }
            if event["session_id"] != thread {
                return Err("Claude member bridge returned a foreign session ID".into());
            }
            match event["type"].as_str() {
                Some("init") if !initialized => {
                    update(app, task, attempt, |a| {
                        if !a.cancel_requested {
                            a.phase = Phase::Running;
                            a.native_session = Some(thread.clone());
                            a.native_message = Some(a.id.clone());
                            a.guidance_open = true;
                            a.acknowledgment_ms = Some(now());
                            a.observed_model = event["model"].as_str().filter(|m| valid_model(m)).map(str::to_owned);
                            a.detail = "Claude member is working on its assignment.".into();
                        }
                    })?;
                    initialized = true;
                }
                Some(kind @ ("steer_ack" | "steer_rejected" | "steer_unconsumed")) if initialized => {
                    // Only the outstanding input can be answered; anything else is stale.
                    let state = match kind {
                        "steer_ack" => deck2_shared::SteeringState::Accepted,
                        "steer_rejected" => deck2_shared::SteeringState::Rejected,
                        _ => deck2_shared::SteeringState::Uncertain,
                    };
                    if let Some((command, _)) = steering.take_if(|(c, _)| event["id"] == c.id.as_str()) {
                        crate::member_guidance::settle_dispatched(app, task, attempt, &command, state)?;
                    } else if let Some(index) = unconfirmed.iter().position(|c| event["id"] == c.id.as_str()) {
                        let command = unconfirmed.remove(index);
                        crate::member_guidance::reconcile_late(app, task, attempt, &command, state)?;
                    }
                }
                Some("context" | "context_reset") if initialized => {
                    update(app, task, attempt, |a| {
                        crate::observations::observe_claude(&mut a.context, &event, &thread, attempt, attempt, a.observed_model.as_deref());
                    })?;
                }
                Some("delta") if initialized => {
                    let delta = event["text"].as_str().ok_or("Missing Claude member text delta")?;
                    if text.len() + delta.len() > MAX_TEXT {
                        return Err("Claude member output exceeded the text limit".into());
                    }
                    text.push_str(delta);
                    update(app, task, attempt, |a| {
                        a.first_output_ms.get_or_insert_with(now);
                        a.text.clone_from(&text);
                    })?;
                }
                Some("activity") if initialized => {
                    if let Some(value) = super::activity_event(&event, &thread, attempt) {
                        let root = {
                            let store = app.store.lock().unwrap();
                            let t = store.task(task)?;
                            t.attempts.iter().find(|a| a.id == attempt).map(|a| t.authority_root(a).to_owned())
                        };
                        if let Some(root) = root {
                            app.record_activity(&root, task, attempt, &thread, attempt, &value);
                        }
                    }
                }
                Some("permission" | "workspace_write") if initialized => {
                    let request = event["request"].as_str().filter(|id| Uuid::parse_str(id).is_ok())
                        .ok_or("Invalid Claude member request ID")?;
                    let permit = {
                        let store = app.store.lock().unwrap();
                        let t = store.task(task)?;
                        let a = t.attempts.iter().find(|a| a.id == attempt).ok_or("Member attempt missing")?;
                        current(&store, &t, a, &project, trusted)?;
                        if !trusted {
                            None
                        } else if event["type"] == "permission" {
                            approval::workspace_read_permit(&event, &project)
                        } else {
                            (can_write && approval::workspace_write_target(&event, &project)).then(|| json!({}))
                        }
                    };
                    send(&mut stdin, json!({"type":"permission_reply","request":request,"allowed":permit.is_some(),"permit":permit})).await?;
                }
                Some("permission_closed") if initialized => {}
                Some("workspace_bash" | "mcp_permission") if initialized => {
                    relay_decisions.request(&event, app, &bridge, bash_project)?;
                }
                Some("workspace_bash_closed" | "mcp_permission_closed") if initialized => relay_decisions.withdraw(&event),
                Some("result") if event["outcome"] == "completed" && initialized => {
                    let report = event["text"].as_str().filter(|s| s.len() <= MAX_TEXT)
                        .ok_or("Invalid Claude member final report")?;
                    return Ok(report.to_owned());
                }
                Some("result") if event["outcome"] == "limited" =>
                    return Err("Claude declined the member turn at its included usage limit".into()),
                Some("result") => return Err("Claude stopped without a confirmed member report".into()),
                _ => return Err("Unexpected Claude member bridge event".into()),
            }
        }
    }.await;

    // Close at the observed protocol boundary, before process cleanup can block.
    let _ = update(app, task, attempt, crate::member_guidance::close);
    drop(bridge);
    if result.is_err() {
        let _ = timeout(
            Duration::from_millis(200),
            send(&mut stdin, json!({"type":"stop"})),
        )
        .await;
    }
    drop(stdin);
    let clean = super::drain_sdk(&mut child, pid)
        .await
        .map_err(|e| format!("member_cleanup_uncertain:{e}"))?;
    settle(
        app,
        task,
        attempt,
        result.and_then(|text| {
            clean
                .then_some(text)
                .ok_or("Claude member SDK exited without confirmed settlement".into())
        }),
    )
}

/// Map one bridge lifecycle signal onto the shared, already-bounded step shape.
/// Only an id, a coarse kind, a short summary and a status are accepted.

fn settle(
    app: &App,
    task: &str,
    attempt: &str,
    result: Result<String, String>,
) -> Result<(), String> {
    let mut store = app.store.lock().unwrap();
    let mut t = store.task(task)?;
    let index = t
        .attempts
        .iter()
        .position(|a| a.id == attempt)
        .ok_or("Member attempt missing")?;
    let authorized = validate_authority(&store, &t, &t.attempts[index]);
    let a = &mut t.attempts[index];
    a.settled_ms = Some(now());
    match (a.cancel_requested, authorized.and(result)) {
        (true, _) => {
            a.phase = Phase::Cancelled;
            a.detail = "Claude member stopped and its native process settled.".into();
        }
        (false, Ok(text)) => {
            a.phase = Phase::Completed;
            // Claude's result may cover only the final assistant message.
            // The public exchange stream is append-only.
            if text.starts_with(&a.text) {
                a.text.clone_from(&text);
            }
            a.report = Some(TaskReport {
                attempt: attempt.into(),
                digest: digest(text.as_bytes()),
                text,
            });
            a.detail =
                "Claude member and native process settled. Report available for Lead review."
                    .into();
        }
        (false, Err(error)) => {
            a.phase = Phase::Failed;
            a.detail = error;
        }
    }
    save_settlement(&mut store, &t, attempt)
}

// The report and the deterministic outcome receipt commit together so a host
// loss cannot strand a published report between settlement and notification.
fn save_settlement(store: &mut Store, task: &Task, attempt: &str) -> Result<(), String> {
    store
        .conn
        .execute_batch("SAVEPOINT claude_member_settlement")
        .map_err(|_| "Cannot begin Claude member settlement")?;
    let result = (|| {
        store.save_normal_task(task)?;
        if let Err(error) = store.enqueue_task_outcome(&task.id, attempt) {
            let mut task = task.clone();
            let a = task
                .attempts
                .iter_mut()
                .find(|a| a.id == attempt)
                .ok_or("Member attempt missing")?;
            a.detail
                .push_str(&format!(" Lead continuation unavailable: {error}"));
            store.save_normal_task(&task)?;
        }
        store
            .conn
            .execute_batch("RELEASE claude_member_settlement")
            .map_err(|_| "Cannot commit Claude member settlement".into())
    })();
    if result.is_err() {
        let _ = store.conn.execute_batch(
            "ROLLBACK TO claude_member_settlement; RELEASE claude_member_settlement",
        );
    }
    result
}

pub(crate) fn settle_recovered(store: &mut Store, live: &HashSet<String>) -> Result<bool, String> {
    let mut retry = false;
    for mut task in store.tasks()? {
        for index in 0..task.attempts.len() {
            let a = &mut task.attempts[index];
            if a.phase != Phase::Uncertain
                || a.provenance.integration != QUALIFICATION
                || live.contains(&a.id)
            {
                continue;
            }
            match a
                .native_pid
                .and_then(|pid| i32::try_from(pid).ok())
                .filter(|pid| *pid > 1)
            {
                Some(pid) if !process_group_stopped(pid) => {
                    retry = true;
                    continue;
                }
                None if a.dispatch_ms.is_some() => continue,
                _ => {}
            }
            a.phase = Phase::Failed;
            a.settled_ms = Some(now());
            a.detail = "The previous Claude member process stopped without a confirmed result. Its assignment will never replay.".into();
            let attempt = a.id.clone();
            save_settlement(store, &task, &attempt)?;
        }
    }
    Ok(retry)
}
