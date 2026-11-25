//! Deck owns receipt and process lifecycle. The SDK bridge owns the native
//! wire protocol and projects bounded text, session and permission events to Deck.
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use deck2_shared::{
    AdmissionSnapshot, DecisionResponse, DecisionState, MemberAssignment, Mode, NativeBinding, NativeContext,
    NativeProvenance, NativeRunner, Phase, ProjectBinding, Receipt, RunnerBinding, SteeringState,
};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin},
    sync::watch,
    time::{Instant, timeout},
};
use uuid::Uuid;

use crate::{
    Store,
    claude_readiness::{Launch, SETTINGS, Status},
    now,
    server::App,
    steering,
    tasks::{digest, file_digest},
};

#[path = "claude_approval.rs"]
pub(crate) mod approval;
#[path = "claude_bash.rs"]
mod bash;
#[path = "claude_member.rs"]
pub(crate) mod member;
#[path = "claude_reuse.rs"]
pub(crate) mod reuse;

pub(crate) const RUNNER: &str = "claude";
const QUALIFICATION: &str = "deck2-claude-agent-sdk-text-v1";
const SDK_VERSION: &str = "0.3.328";
const BRIDGE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/claude-sdk.mjs"));
const MAX_FRAME: usize = 1024 * 1024;
const MAX_TEXT: usize = 2 * MAX_FRAME;
pub(crate) const DELTA_BATCH_WINDOW: Duration = Duration::from_millis(50);
pub(crate) const DELTA_BATCH_BYTES: usize = 16 * 1024;

fn finalize_claude_text(r: &mut Receipt, text: &str) {
    finalize_segments(&mut r.text, &mut r.message_times, text);
}
fn finalize_segments(output: &mut String, times: &mut Vec<deck2_shared::MessageTime>, text: &str) {
    use deck2_shared::{MessageKind, MessageTime};
    if times.is_empty() || times.iter().any(|m| m.kind.is_none()) {
        *output = text.to_owned();
        return;
    }
    if text.is_empty() { return; }
    let normalized = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let target = normalized(text);
    for i in (0..times.len()).rev() {
        let start = times[i].start;
        let byte = output.char_indices().scan(0usize, |units, (byte, ch)| {
            let before = *units; *units += ch.len_utf16(); Some((before, byte))
        }).find(|(units, _)| *units == start).map(|(_, byte)| byte);
        if let Some(byte) = byte && normalized(&output[byte..]) == target {
            for m in &mut times[i..] { m.kind = Some(MessageKind::Answer); }
            return;
        }
    }
    if !output.is_empty() { output.push_str("\n\n"); }
    times.push(MessageTime { start: output.encode_utf16().count(), at_ms: now(), kind: Some(MessageKind::Answer) });
    output.push_str(text);
}

pub(crate) fn executable() -> Result<PathBuf, String> {
    crate::runner_management::path_tool(RUNNER).map_err(|_| Status::NotInstalled.message().into())
}

pub(crate) fn node_runtime() -> Result<PathBuf, String> {
    if BRIDGE.is_empty() {
        return Err("This Deck build is missing the Claude Agent SDK bridge.".into());
    }
    crate::runner_management::path_tool("node")
        .map_err(|_| Status::RuntimeUnavailable.message().into())
}

pub(crate) async fn inventory(app: &App) -> Result<Value, String> {
    let trusted = app.store.lock().unwrap().trusted_project(&app.project)?;
    let launch = Launch::new(trusted.then(|| Path::new(&app.project))).map_err(|s| s.message())?;
    let frame = account_read(launch, "catalog").await?;
    let mut ids = HashSet::new();
    let models = frame["models"]
        .as_array()
        .filter(|models| {
            frame["type"] == "models"
                && !models.is_empty()
                && models.len() <= 256
                && models.iter().all(|row| {
                    row["modelId"]
                        .as_str()
                        .is_some_and(|id| valid_model(id) && ids.insert(id.to_owned()))
                        && row["label"].as_str().is_some_and(|label| {
                            !label.trim().is_empty()
                                && label.len() <= 256
                                && !label.chars().any(char::is_control)
                        })
                        && row["thinkingLevels"].as_array().is_some_and(|levels| {
                            levels
                                .iter()
                                .all(|value| value.as_str().is_some_and(valid_effort))
                        })
                })
        })
        .ok_or("Invalid Claude Code model catalog")?;
    Ok(Value::Array(models.clone()))
}

pub(crate) async fn read_quota() -> Result<Value, String> {
    let launch = Launch::new(None).map_err(|s| s.message())?;
    let frame = account_read(launch, "quota").await?;
    if frame["type"] == "quota" && frame["quota"].is_object() {
        return Ok(frame["quota"].clone());
    }
    Err("Claude Code did not report subscription quota.".into())
}

async fn account_read(launch: Launch, operation: &str) -> Result<Value, String> {
    let binary = executable()?;
    let node = node_runtime()?;
    let (version, status) = tokio::join!(
        crate::native::command_probe(&node, &["--version"]),
        launch.status(&binary)
    );
    let version = version.map_err(|_| Status::RuntimeUnavailable.message())?;
    let major = std::str::from_utf8(&version).ok().and_then(|value| {
        value
            .strip_prefix('v')?
            .split('.')
            .next()?
            .parse::<u32>()
            .ok()
    });
    if !major.is_some_and(|v| v >= 22) {
        return Err(Status::RuntimeUnavailable.message().into());
    }
    if status != Status::SubscriptionSignedIn {
        return Err(status.message().into());
    }
    let script = bridge_script()?;
    let mut command = launch.command(&node);
    command
        .args([script.path(), &binary])
        .args(["", operation, launch.sources(), SETTINGS]);
    let bytes = if operation == "quota" {
        crate::native::claude_quota_probe(command).await
    } else {
        crate::native::claude_catalog_probe(command).await
    }
    .map_err(|reason| {
        if operation == "quota" {
            "Claude Code could not read subscription quota."
        } else if reason == crate::native::PROBE_TIMED_OUT {
            "Claude Code model discovery timed out. Reopen the dialog to retry."
        } else {
            "Claude Code could not load its model catalog. Reopen the dialog to retry."
        }
    })?;
    let frame: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid Claude Code account metadata")?;
    if frame["type"] == "unqualified" {
        return Err("Claude Code SDK did not confirm subscription authentication.".into());
    }
    Ok(frame)
}

fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 160
        && !model.starts_with('-')
        && model.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'[' | b']' | b':')
        })
}

fn valid_effort(effort: &str) -> bool {
    matches!(effort, "low" | "medium" | "high" | "xhigh" | "max")
}

fn bridge_script() -> Result<tempfile::NamedTempFile, String> {
    let script = tempfile::Builder::new()
        .suffix(".mjs")
        .tempfile()
        .map_err(|_| "Cannot prepare the Claude SDK bridge")?;
    std::io::Write::write_all(&mut script.as_file(), BRIDGE)
        .map_err(|_| "Cannot materialize the Claude SDK bridge")?;
    Ok(script)
}

pub(crate) fn selection_key() -> Result<String, String> {
    let path = executable()?;
    Ok(digest(
        format!(
            "{path:?}:{}",
            file_digest(&path).map_err(|_| "Claude Code executable unavailable")?
        )
        .as_bytes(),
    ))
}

pub(crate) fn bind(snapshot: &mut AdmissionSnapshot) -> Result<(), String> {
    let assignment = snapshot
        .session_contract
        .as_ref()
        .and_then(|c| c.members.get("lead"))
        .ok_or("Invalid Claude Code Lead assignment")?;
    let launch = Launch::new(None).map_err(|s| s.message())?;
    let root = launch.storage().map_err(|s| s.message())?;
    let native = binding(
        assignment,
        QUALIFICATION,
        digest(root.as_os_str().as_encoded_bytes()),
        digest(QUALIFICATION.as_bytes()),
    )?;
    snapshot.runner = Some(native.executable.clone());
    snapshot.native = Some(native);
    snapshot.cbm = None;
    snapshot.helper = None;
    snapshot.investigator = None;
    snapshot.exclusions = vec![
        "Trusted Claude Code Lead turns support workspace edits, reviewed reads and searches, and native Bash with session permissions. Attachments are unavailable.".into(),
    ];
    Ok(())
}

fn binding(
    assignment: &MemberAssignment,
    qualification: &str,
    storage: String,
    role: String,
) -> Result<NativeBinding, String> {
    if assignment.runner_id != RUNNER || !valid_model(&assignment.model_id)
        || !assignment.thinking.as_deref().is_none_or(valid_effort)
    {
        return Err("Invalid Claude Code model or effort".into());
    }
    let path = executable()?;
    let executable = RunnerBinding {
        executable: file_digest(&path).map_err(|_| "Claude Code executable unavailable")?,
        path: path.into_os_string().into_string().map_err(|_| "Invalid Claude Code executable path")?,
        ownership: "external_unknown".into(),
        model: Some(assignment.model_id.clone()),
        qualification: qualification.into(),
        catalog: None,
    };
    Ok(NativeBinding {
        runner: NativeRunner::Claude,
        protocol: "stream-json".into(),
        version: SDK_VERSION.into(),
        executable,
        storage,
        configuration: digest(BRIDGE),
        role,
    })
}

fn matches_binding(snapshot: &AdmissionSnapshot, assignment: &MemberAssignment, qualification: &str) -> bool {
    assignment.runner_id == RUNNER
        && valid_model(&assignment.model_id)
        && assignment.thinking.as_deref().is_none_or(valid_effort)
        && snapshot.native.as_ref().is_some_and(|native| {
            native.runner == NativeRunner::Claude
                && native.executable.qualification == qualification
                && native.executable.model.as_deref() == Some(assignment.model_id.as_str())
                && snapshot.runner.as_ref() == Some(&native.executable)
        })
}

pub(crate) fn admitted(snapshot: &AdmissionSnapshot) -> bool {
    snapshot.session_contract.as_ref().and_then(|c| c.members.get("lead"))
        .is_some_and(|assignment| matches_binding(snapshot, assignment, QUALIFICATION))
}

pub(crate) fn is_receipt(receipt: &Receipt) -> bool {
    receipt.mode == Mode::SessionV1 && receipt.configuration.as_ref().is_some_and(admitted)
}

pub(crate) fn compatible_live_input(root: &AdmissionSnapshot, source: &AdmissionSnapshot) -> bool {
    if !admitted(root) || !admitted(source) {
        return false;
    }
    let root = root.native.as_ref().unwrap();
    let source = source.native.as_ref().unwrap();
    // Launch already checked the running bridge and executable. Use that
    // identity here, even if the CLI on disk changed after the turn started.
    // As with queued launch, an older Deck-owned bridge digest can be refreshed.
    source.version == SDK_VERSION
        && source.version == root.version
        && source.executable == root.executable
        && source.storage == root.storage
        && source.protocol == root.protocol
        && source.role == root.role
}

pub(crate) fn refresh_queued_bridge(receipt: &mut Receipt) {
    // The embedded bridge is Deck-owned. A queued turn can cross a Deck
    // update without replacing its admitted CLI, assignment or profile.
    if receipt.phase != Phase::Queued || receipt.dispatch_ms.is_some()
        || receipt.native_pid.is_some() || BRIDGE.is_empty() || !is_receipt(receipt)
    {
        return;
    }
    let binding = receipt.configuration.as_mut().unwrap().native.as_mut().unwrap();
    if binding.version == SDK_VERSION {
        binding.configuration = digest(BRIDGE);
    }
}

fn absent(pid: i32) -> bool {
    (unsafe { libc::kill(pid, 0) == -1 })
        && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
}

// kill(0) also reports unreaped zombies. After a daemon crash the
// supervisor may retain those PIDs, but a zombie cannot own a native turn.
// An unreadable procfs or a live member leaves ownership unresolved.
pub(crate) fn process_group_stopped(pid: i32) -> bool {
    if absent(pid) && absent(-pid) {
        return true;
    }
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return false;
    };
    for entry in entries {
        let Ok(entry) = entry else {
            return false;
        };
        let Ok(process) = entry.file_name().to_string_lossy().parse::<i32>() else {
            continue;
        };
        let stat = match std::fs::read_to_string(entry.path().join("stat")) {
            Ok(stat) => stat,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return false,
        };
        let Some((_, fields)) = stat.rsplit_once(") ") else {
            return false;
        };
        let mut fields = fields.split_whitespace();
        let Some(state) = fields.next() else {
            return false;
        };
        let Some(group) = fields.nth(1).and_then(|v| v.parse::<i32>().ok()) else {
            return false;
        };
        if (pid == process || pid == group) && !matches!(state, "Z" | "X") {
            return false;
        }
    }
    true
}

pub(crate) fn settle_recovered(store: &mut Store, live: &HashSet<String>) -> Result<bool, String> {
    let rows = store.pending_receipts()?;
    let mut retry = false;
    for mut r in rows
        .into_iter()
        .filter(|r| r.phase == Phase::Uncertain && is_receipt(r) && !live.contains(&r.id))
    {
        if let Some(pid) = r
            .native_pid
            .and_then(|p| i32::try_from(p).ok())
            .filter(|p| *p > 1)
        {
            if !process_group_stopped(pid) {
                retry = true;
                continue;
            }
        } else if r.dispatch_ms.is_some() {
            continue;
        }
        if r.dispatch_ms.is_none() && !r.cancel_requested && r.claude_startup_retry.is_some() {
            retry_startup(&mut r, "The Claude startup process stopped before dispatch");
            store.save(&mut r)?;
            continue;
        }
        r.phase = Phase::Failed;
        approval::settle(&mut r);
        r.detail = "The previous Claude Code process stopped without a confirmed result. Context is retained and the input will not replay.".into();
        store.save(&mut r)?;
    }
    Ok(retry)
}

fn startup_detail(r: &Receipt, detail: &str) -> String {
    let stages = r.startup_timing.as_ref().map(|timing| &timing.claude_stages_ms);
    let Some(stages) = stages.filter(|stages| !stages.is_empty()) else {
        return detail.into();
    };
    let timings = [
        ("sdk", "SDK"),
        ("selection", "model selection"),
        ("usage", "plan usage"),
        ("deck_registration", "Deck registration"),
        ("deck_inventory", "Deck inventory"),
    ].iter().filter_map(|(stage, label)| stages.get(*stage).map(|ms| format!("{label} {ms} ms")))
        .collect::<Vec<_>>().join(", ");
    format!("{detail} Claude readiness: {timings}.")
}

fn retry_startup(r: &mut Receipt, cause: &str) {
    debug_assert!(r.dispatch_ms.is_none() && !r.cancel_requested);
    r.native_pid = None;
    let retries = r.claude_startup_retry.as_ref().map_or(0, |retry| retry.retries);
    if retries >= 2 {
        r.phase = Phase::Failed;
        r.detail = startup_detail(r, &format!("{cause}. Claude startup failed after two retries. Check Claude Code sign-in and Deck session tool availability, then send the message again. No input was sent."));
        return;
    }
    let delay_ms = 1_000 << retries;
    r.claude_startup_retry = Some(deck2_shared::StartupRetry {
        retries: retries + 1,
        after_ms: now().saturating_add(delay_ms),
    });
    r.phase = Phase::Queued;
    r.detail = startup_detail(r, &format!("{cause}. No input was sent. Queued for retry {} of 2 in {} s.", retries + 1, delay_ms / 1_000));
}

fn readiness_progress(timing: &mut deck2_shared::StartupTiming, event: &Value) -> Result<String, String> {
    let stage = event["stage"].as_str().ok_or("Claude startup stage missing")?;
    let label = match stage {
        "sdk" => "Initializing Claude SDK and checking subscription identity",
        "selection" => "Validating Claude model and effort",
        "usage" => "Checking Claude plan usage",
        "deck_registration" => "Registering Deck session tools",
        "deck_inventory" => "Verifying Deck session tools",
        _ => return Err("Unknown Claude startup stage".into()),
    };
    if let Some(ms) = event["elapsed_ms"].as_u64().filter(|ms| *ms <= 60_000) {
        timing.claude_stages_ms.insert(stage.into(), ms);
    }
    Ok(format!("{label}…"))
}

fn spawn_sdk(
    launch: &Launch,
    node: &Path,
    script: &Path,
    binary: &Path,
    thread: &str,
    operation: &str,
    assignment: &MemberAssignment,
) -> Result<Child, String> {
    let mut command = launch.command(node);
    command
        .arg(script)
        .arg(binary)
        .arg(thread)
        .arg(operation)
        .arg(launch.sources())
        .arg(crate::runner_compaction::claude_launch_settings())
        .arg(&assignment.model_id)
        .arg(assignment.thinking.as_deref().unwrap_or(""))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    crate::native::own_child(&mut command)?;
    command.spawn().map_err(|_| "Could not start the Claude Agent SDK bridge".into())
}

fn bootstrap(bridge: &crate::session_mcp::Bridge, instructions: String, trusted: bool, can_write: bool, allow_bash: bool) -> Value {
    let server = json!({"type": "http", "url": bridge.config["url"], "headers": bridge.config["http_headers"], "alwaysLoad": true});
    bootstrap_with_server(server, &bridge.inventory(), instructions, trusted, can_write, allow_bash)
}

fn bootstrap_with_server(server: Value, inventory: &Value, mut instructions: String, trusted: bool, can_write: bool, allow_bash: bool) -> Value {
    let tool_names: Vec<_> = inventory.as_array().unwrap().iter().map(|tool| &tool["name"]).collect();
    let mut workspace_tools = if !trusted { vec![] } else if can_write {
        vec!["Read", "Glob", "Grep", "Edit", "Write"]
    } else { vec!["Read", "Glob", "Grep"] };
    if allow_bash {
        workspace_tools.push("Bash");
        instructions.push_str("\n\nUse Bash for project builds and tests. Keep the command in the foreground. Protected Git operations still require separate informed confirmation of the exact command before requesting execution.");
    } else if can_write {
        instructions.push_str("\n\nBash is unavailable for this role.");
    }
    json!({
        "type": "bootstrap",
        "instructions": instructions,
        "server": server,
        "toolNames": tool_names,
        "workspaceTools": workspace_tools,
    })
}

fn check_ready(app: &App, ready: &Value, assignment: &str) -> Result<(), String> {
    if ready["quota"].is_object() {
        let _ = app.observe_claude_quota(&ready["quota"]);
    }
    let message = match ready["type"].as_str() {
        Some("ready") => return Ok(()),
        Some("selection_unavailable") => return Err(format!("Claude Code no longer offers the selected model or effort. Update the {assignment} assignment. No input was sent.")),
        Some("credits_enabled") => "Claude usage credits are enabled. Disable them in Claude account settings to use the included plan in Deck.",
        Some("plan_limit") => "Claude's included plan limit has been reached. Try again after it resets.",
        Some("usage_unverified") => "Claude did not confirm that paid usage credits are disabled. Try again when plan usage is available.",
        Some("coordination_unavailable") => "Claude Code could not verify its scoped Deck session tools. No input was sent.",
        _ => "Claude SDK did not attest the subscription profile. No input was sent.",
    };
    Err(message.into())
}

async fn drain_sdk(child: &mut Child, pid: u32) -> Result<bool, String> {
    let wait = timeout(Duration::from_secs(2), child.wait()).await;
    let clean = matches!(wait, Ok(Ok(status)) if status.success());
    // The bridge and its CLI share a process group. Keep the slot through teardown.
    unsafe { libc::kill(-(pid as i32), libc::SIGKILL); }
    child.wait().await.map_err(|_| "Cannot verify Claude SDK bridge stopped")?;
    crate::native::reap_group(pid).await?;
    if !process_group_stopped(pid as i32) {
        return Err("Claude Code process group still owns this attempt.".into());
    }
    Ok(clean)
}

pub(crate) async fn lead(
    app: &App,
    id: &str,
    binary: &Path,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let started = Instant::now();
    let receipt = app.receipt(id)?;
    let admission_ms = now().saturating_sub(receipt.accepted_ms);
    app.check_original_context(&receipt.session)?;
    let (session, project, trusted) = {
        let store = app.store.lock().unwrap();
        let project = store.execution_project(&receipt.session)?;
        let trusted = store.trusted_project(&project.root)?;
        (store.session_by_id(&receipt.session)?, project, trusted)
    };
    if !is_receipt(&receipt) || receipt.phase != Phase::Accepted {
        return Err("Claude Code Lead input is not admitted for this attempt.".into());
    }
    let initial_images = {
        let store = app.store.lock().unwrap();
        receipt
            .attachments
            .iter()
            .map(|expected| {
                let (stored, bytes) = store.image(&receipt.session, &expected.id)?;
                if &stored != expected {
                    return Err("Admitted image integrity changed. Submit a new message.".to_string());
                }
                Ok((stored, bytes))
            })
            .collect::<Result<Vec<_>, _>>()?
    };
    let snapshot = receipt.configuration.as_ref().unwrap();
    let binding = snapshot.native.as_ref().unwrap();
    let launch = Launch::new(trusted.then(|| Path::new(&project.root))).map_err(|s| s.message())?;
    let storage = launch.storage().map_err(|s| s.message())?;
    if binding.storage != digest(storage.as_os_str().as_encoded_bytes())
        || binding.version != SDK_VERSION
        || binding.configuration != digest(BRIDGE)
    {
        return Err(
            "Claude Code launch profile changed after input was queued. Submit a new message."
                .into(),
        );
    }
    // Cwd affects Claude's native transcript namespace. Keep it bound across
    // resume even if the project's trust state changes.
    let namespace = if trusted { project.root.as_str() } else { "/" };
    let provenance = NativeProvenance {
        runner: RUNNER.into(),
        integration: QUALIFICATION.into(),
        executable: binding.executable.executable.clone(),
        storage: digest(format!("{}:{namespace}", binding.storage).as_bytes()),
        content: binding.role.clone(),
    };
    let resume = session.native.filter(|_| !receipt.fresh);
    if receipt.continuation.is_some() && resume.is_none() {
        return Err("The Claude Code context for this task outcome is unavailable.".into());
    }
    // Admission pins the executable for this turn. Across turns, Claude's
    // transcript is scoped to the profile, cwd and qualified integration.
    // A CLI update can resume that transcript without carrying old grants
    // forward, since grants remain bound to the full admission identity.
    if resume.as_ref().is_some_and(|c| {
        c.mode != Mode::SessionV1
            || c.runner != Some(NativeRunner::Claude)
            || c.provenance.as_ref().is_none_or(|saved| {
                saved.runner != provenance.runner
                    || saved.integration != provenance.integration
                    || saved.storage != provenance.storage
                    || saved.content != provenance.content
                    || saved.executable.len() != 64
                    || !saved.executable.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
            || Uuid::parse_str(&c.thread).is_err()
    }) {
        return Err("Claude Code continuation belongs to a different native profile. Choose Start new execution.".into());
    }
    let thread = resume
        .as_ref()
        .map(|context| context.thread.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let reuse_epoch = app.claude_reuse.epoch();
    let contract = snapshot.session_contract.as_ref().unwrap();
    let members: Vec<_> = crate::session_contract::configured_member_ids(contract).collect();
    let instructions = format!(
        "{}\n\n{}\n\nUse native Edit and Write for ordinary workspace changes. Deck may ask the user to approve native reads and searches. Use Deck's session tools for task coordination. For a new task, call deck_delegate directly with agent set to a configured role ID below and task set to the instruction. This list is sufficient to choose an ID. Use commandId only with a dependency replan. An empty list means this session has no members assigned for new tasks.\nConfigured member role IDs: {}",
        crate::session_roles::Role::packaged_instructions("lead")?,
        crate::session_contract::POLICY,
        json!(members),
    );
    let bridge_started = Instant::now();
    let bridge = crate::session_mcp::Bridge::start(app, id).await?;
    let bridge_start_ms = bridge_started.elapsed().as_millis() as u64;
    let inventory = bridge.inventory();
    let tool_names: Vec<_> = inventory.as_array().unwrap().iter().map(|tool| &tool["name"]).collect();
    let assignment = &contract.members["lead"];
    let reuse_key = reuse::reuse_key(
        binary,
        &receipt,
        &launch,
        &storage,
        &project,
        trusted,
        &thread,
        assignment,
        &instructions,
        &tool_names,
    )?;

    // Attempt to reuse a parked Claude Lead process for this exact session,
    // thread and launch profile. Fresh executions retire any parked process.
    let mut warm_parts: Option<(reuse::ParkedParts, deck2_shared::StartupTiming, u64)> = None;
    if let Some(parked) = app
        .claude_reuse
        .take(&receipt.session, &thread, &reuse_key, receipt.fresh || resume.is_none())
        .await?
    {
        let mut parts = parked.into_parts();
        parts.mcp_proxy.activate(&bridge.config)?;
        let mut warm_timing = deck2_shared::StartupTiming {
            admission_ms,
            bridge_start_ms,
            process_reused: true,
            thread_reused: true,
            ..Default::default()
        };
        let ready_started = Instant::now();
        let deadline = ready_started + Duration::from_secs(30);
        let warm_result = tokio::select! {
            biased;
            _ = cancel.wait_for(|active| *active) => Ok(None),
            ready = tokio::time::timeout_at(deadline, async {
                send(&mut parts.stdin, json!({"type": "prepare_turn"})).await?;
                loop {
                    let event = frame(&mut parts.stdout, &mut parts.partial).await?;
                    if event["type"] != "readiness" {
                        break Ok::<_, String>(event);
                    }
                    // Warm prepare_turn takes ~250 ms and sends no input; accumulate
                    // stage timings in memory instead of fsyncing per sub-stage.
                    let _ = readiness_progress(&mut warm_timing, &event)?;
                }
            }) => ready.map_err(|_| "Reused Claude SDK readiness timed out".to_string()).and_then(|r| r).map(Some),
        };
        match warm_result {
            Ok(None) => {
                drop(bridge);
                let _ = reuse::retire_process(reuse::Parked::new(parts)).await;
                return if app.shutdown_requested.load(std::sync::atomic::Ordering::Acquire) {
                    requeue_startup(app, id, "Deck restarted during Claude startup")
                } else {
                    cancelled(app, id, false)
                };
            }
            Ok(Some(ready)) if ready["type"] == "ready" => {
                check_ready(app, &ready, "Lead")?;
                let ready_ms = ready_started.elapsed().as_millis() as u64;
                warm_parts = Some((parts, warm_timing, ready_ms));
            }
            Ok(Some(ready))
                if matches!(
                    ready["type"].as_str(),
                    Some("credits_enabled" | "plan_limit" | "selection_unavailable")
                ) =>
            {
                drop(bridge);
                let _ = reuse::retire_process(reuse::Parked::new(parts)).await;
                let message = check_ready(app, &ready, "Lead").unwrap_err();
                return app.change(id, |r| {
                    r.native_pid = None;
                    r.startup_timing = Some(warm_timing.clone());
                    r.phase = Phase::Failed;
                    r.detail = startup_detail(r, &message);
                });
            }
            Ok(Some(ready)) if ready["type"] == "usage_unverified" => {
                drop(bridge);
                let _ = reuse::retire_process(reuse::Parked::new(parts)).await;
                let message = check_ready(app, &ready, "Lead").unwrap_err();
                app.change(id, |r| r.startup_timing = Some(warm_timing.clone()))?;
                return requeue_startup(app, id, &message);
            }
            _ => {
                // Stale, disconnected or exited idle process: retire cleanly and fall back to cold start.
                let _ = reuse::retire_process(reuse::Parked::new(parts)).await;
            }
        }
    }

    let (mut child, mut stdin, mut stdout, mut partial, pid, script, mcp_proxy, mut timing, status_ms, spawn_ms, ready_ms_prefilled) =
        if let Some((parts, warm_timing, ready_ms)) = warm_parts {
            (
                parts.child,
                parts.stdin,
                parts.stdout,
                parts.partial,
                parts.pid,
                parts.script,
                parts.mcp_proxy,
                warm_timing,
                0u64,
                0u64,
                Some(ready_ms),
            )
        } else {
            app.change(id, |r| r.detail = "Checking Claude Code sign-in…".into())?;
            let status_started = Instant::now();
            // The auth probe owns a bounded child process. Let it settle before moving
            // an undispatched receipt even if Stop or shutdown arrived during the probe.
            let status = launch.status(binary).await;
            if *cancel.borrow() {
                return if app.shutdown_requested.load(std::sync::atomic::Ordering::Acquire) {
                    requeue_startup(app, id, "Deck restarted during Claude sign-in verification")
                } else {
                    cancelled(app, id, false)
                };
            }
            let status_ms = status_started.elapsed().as_millis() as u64;
            if status == Status::ProbeTimedOut {
                return requeue_startup(app, id, status.message());
            }
            if status != Status::SubscriptionSignedIn {
                return Err(status.message().into());
            }
            let script = bridge_script()?;
            let node = node_runtime()?;
            let mcp_proxy = reuse::ClaudeMcpProxy::start().await?;
            mcp_proxy.activate(&bridge.config)?;
            let spawn_started = Instant::now();
            let mut child = match spawn_sdk(
                &launch, &node, script.path(), binary, &thread,
                if resume.is_some() { "resume" } else { "new" }, assignment,
            ) {
                Ok(child) => child,
                Err(message) => return requeue_startup(app, id, &message),
            };
            let spawn_ms = spawn_started.elapsed().as_millis() as u64;
            let pid = child
                .id()
                .ok_or("Claude bridge process identity unavailable")?;
            let stdin = child.stdin.take().expect("configured Claude bridge stdin");
            let stdout = BufReader::new(
                child
                    .stdout
                    .take()
                    .expect("configured Claude bridge stdout"),
            );
            let timing = deck2_shared::StartupTiming {
                admission_ms,
                version_ms: status_ms,
                bridge_start_ms,
                process_spawn_ms: spawn_ms,
                ..Default::default()
            };
            (
                child,
                stdin,
                stdout,
                Vec::new(),
                pid,
                script,
                mcp_proxy,
                timing,
                status_ms,
                spawn_ms,
                None,
            )
        };
    let mut retryable = true;
    let run = async {
        let ready_ms = if let Some(ready_ms) = ready_ms_prefilled {
            ready_ms
        } else {
            app.change(id, |r| {
                r.native_pid = Some(pid);
                r.startup_timing = Some(timing.clone());
                r.detail = "Starting Claude SDK…".into();
            })?;
            let ready_started = Instant::now();
            let deadline = ready_started + Duration::from_secs(60);
            let ready = tokio::select! {
                biased;
                _ = cancel.wait_for(|active| *active) => return Ok(None),
                ready = tokio::time::timeout_at(deadline, async {
                    send(
                        &mut stdin,
                        bootstrap_with_server(
                            mcp_proxy.config.clone(),
                            &inventory,
                            instructions.clone(),
                            trusted,
                            trusted,
                            trusted,
                        ),
                    )
                    .await?;
                    loop {
                        let event = frame(&mut stdout, &mut partial).await?;
                        if event["type"] != "readiness" {
                            break Ok::<_, String>(event);
                        }
                        let detail = readiness_progress(&mut timing, &event)?;
                        // Persist only when a stage begins; elapsed_ms completions accumulate
                        // in memory and commit with the next stage transition or dispatch.
                        if event["elapsed_ms"].is_null() {
                            app.change(id, |r| {
                                r.detail = detail;
                                r.startup_timing = Some(timing.clone());
                            })?;
                        }
                    }
                }) => ready.map_err(|_| "Claude SDK readiness timed out after 60 s")??,
            };
            retryable = matches!(ready["type"].as_str(), Some("transport_error" | "usage_unverified"));
            if ready["type"] == "transport_error" {
                return Err("Claude SDK stopped during readiness".into());
            }
            check_ready(app, &ready, "Lead")?;
            ready_started.elapsed().as_millis() as u64
        };
        let prompt = {
            let mut store = crate::latency::locked(&app.store);
            let mut r = store.get(id)?.ok_or("Claude receipt missing")?;
            let current = store.execution_project(&r.session)?;
            if current != project || store.trusted_project(&current.root)? != trusted {
                return Err("Project trust or ownership changed. Submit a new message.".into());
            }
            store.validate_snapshot(snapshot)?;
            if r.cancel_requested || *cancel.borrow() || app.shutdown_requested.load(std::sync::atomic::Ordering::Acquire) {
                return Ok(None);
            }
            let prompt = store.outcome_prompt(&r)?.unwrap_or_else(|| r.prompt.clone());
            r.native_pid = Some(pid);
            r.phase = Phase::Dispatching;
            let handshake_ms = started.elapsed().as_millis() as u64;
            timing.initialization_ms = ready_ms;
            (timing.run_lock_wait_us, timing.run_lock_acquisitions) = crate::latency::run_waits();
            if let Some(waits) = crate::latency::take_submit(id) {
                waits.apply(&mut timing);
            }
            timing.other_ms = handshake_ms.saturating_sub(status_ms + bridge_start_ms + spawn_ms + ready_ms);
            r.startup_timing = Some(timing.clone());
            r.claude_startup_retry = None;
            r.handshake_ms = Some(handshake_ms);
            r.dispatch_ms = Some(now());
            r.thread = Some(thread.clone());
            r.generation = Uuid::new_v4().to_string();
            r.detail = startup_detail(&r, "Claude SDK subscription verified. Delivering the input once.");
            store.save(&mut r)?;
            prompt
        };
        let mut request = json!({"type":"send", "text":prompt});
        if !initial_images.is_empty() {
            request["images"] = json!(image_parts(&initial_images));
        }
        send(&mut stdin, request).await?;
        stream(
            app,
            id,
            &thread,
            provenance,
            &mut stdout,
            &mut partial,
            &mut stdin,
            cancel,
            trusted.then_some(&project),
            &bridge,
        )
        .await
    }
    .await;

    // Close attempt authority immediately before parking or retiring the bridge.
    mcp_proxy.deactivate();
    drop(bridge);

    let can_park = matches!(&run, Ok(Some((Phase::Completed, _, _))))
        && !*cancel.borrow()
        && !app.shutdown_requested.load(std::sync::atomic::Ordering::Acquire)
        && child.try_wait().ok().flatten().is_none()
        && reuse::reuse_key(
            binary,
            &receipt,
            &launch,
            &storage,
            &project,
            trusted,
            &thread,
            assignment,
            &instructions,
            &tool_names,
        )
        .as_ref()
            == Ok(&reuse_key);

    if can_park {
        let Ok(Some((phase, text, detail))) = run else {
            unreachable!();
        };
        app.change(id, |r| {
            approval::settle(r);
            if let Some(text) = text {
                r.first_output_ms.get_or_insert_with(now);
                finalize_claude_text(r, &text);
            }
            r.detail = startup_detail(r, detail);
            r.phase = phase;
        })?;
        let parked = reuse::Parked::new(reuse::ParkedParts {
            session: receipt.session.clone(),
            thread,
            key: reuse_key,
            epoch: reuse_epoch,
            expires: Instant::now() + reuse::IDLE_TIMEOUT,
            pid,
            child,
            stdin,
            stdout,
            partial,
            script,
            mcp_proxy,
        });
        if let Err(unparked) = app.claude_reuse.park(app, parked) {
            let _ = reuse::retire_process(unparked).await;
        }
        return Ok(());
    }

    drop(stdin);
    let settlement = drain_sdk(&mut child, pid).await;
    drop(script);
    drop(mcp_proxy);
    let dispatched = app.receipt(id)?.dispatch_ms.is_some();
    let clean = match settlement {
        Ok(clean) => clean,
        Err(message) => return app.change(id, |r| {
            approval::settle(r);
            r.phase = Phase::Uncertain;
            if !dispatched && !r.cancel_requested && (retryable || run.is_ok()) {
                r.claude_startup_retry.get_or_insert(deck2_shared::StartupRetry {
                    retries: 0, after_ms: 0,
                });
            } else if !dispatched {
                r.claude_startup_retry = None;
            }
            r.detail = message;
        }),
    };

    match run {
        Ok(Some((phase, text, detail))) if clean => app.change(id, |r| {
            approval::settle(r);
            if let Some(text) = text {
                r.first_output_ms.get_or_insert_with(now);
                finalize_claude_text(r, &text);
            }
            r.detail = startup_detail(r, detail);
            r.phase = phase;
        }),
        Ok(None) if !dispatched && app.shutdown_requested.load(std::sync::atomic::Ordering::Acquire) =>
            requeue_startup(app, id, "Deck restarted during Claude startup"),
        _ if *cancel.borrow() => cancelled(app, id, dispatched),
        Err(message) if !dispatched && retryable => requeue_startup(app, id, &message),
        Err(message) if !dispatched => app.change(id, |r| {
            r.native_pid = None;
            r.phase = Phase::Failed;
            r.detail = startup_detail(r, &message);
        }),
        _ => app.change(id, |r| {
            approval::settle(r);
            r.phase = Phase::Failed;
            r.detail =
                "Claude Code stopped without a confirmed result. The input will not replay.".into();
        }),
    }
}

fn requeue_startup(app: &App, id: &str, cause: &str) -> Result<(), String> {
    app.change(id, |r| {
        if r.cancel_requested {
            r.phase = Phase::Cancelled;
            r.native_pid = None;
            r.detail = "Stopped before sending input to Claude Code.".into();
        } else {
            retry_startup(r, cause);
        }
    })
}

fn cancelled(app: &App, id: &str, dispatched: bool) -> Result<(), String> {
    app.change(id, |r| {
        approval::settle(r);
        r.phase = Phase::Cancelled;
        if !dispatched {
            r.native_pid = None;
        }
        r.detail = if dispatched {
            "Claude Code stopped without confirming the turn outcome. The input will not replay."
        } else {
            "Stopped before sending input to Claude Code."
        }
        .into();
    })
}

/// Messages API image parts. The bridge validates them again before the SDK.
fn image_parts(images: &[(deck2_shared::ImageAttachment, Vec<u8>)]) -> Vec<Value> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    images
        .iter()
        .map(|(image, bytes)| json!({"mime": image.mime, "data": STANDARD.encode(bytes)}))
        .collect()
}

async fn send(stdin: &mut ChildStdin, message: Value) -> Result<(), String> {
    let mut bytes =
        serde_json::to_vec(&message).map_err(|_| "Cannot encode Claude bridge request")?;
    bytes.push(b'\n');
    // Image requests are large; allow a second per MiB beyond the base budget.
    let budget = Duration::from_secs(3 + (bytes.len() / (1024 * 1024)) as u64);
    timeout(budget, stdin.write_all(&bytes))
        .await
        .map_err(|_| "Claude bridge request timed out")?
        .map_err(|_| "Claude bridge could not receive input".into())
}

async fn frame(
    reader: &mut (impl tokio::io::AsyncBufRead + Unpin),
    partial: &mut Vec<u8>,
) -> Result<Value, String> {
    let remaining = MAX_FRAME.saturating_sub(partial.len());
    let bytes = reader
        .take(remaining as u64)
        .read_until(b'\n', partial)
        .await
        .map_err(|_| "Cannot read Claude bridge output")?;
    if bytes == 0 || partial.last() != Some(&b'\n') {
        return Err("Claude bridge closed or exceeded its event limit.".into());
    }
    serde_json::from_slice(&std::mem::take(partial))
        .map_err(|_| "Malformed Claude bridge event".into())
}

async fn stream(
    app: &App,
    id: &str,
    thread: &str,
    provenance: NativeProvenance,
    stdout: &mut BufReader<tokio::process::ChildStdout>,
    partial: &mut Vec<u8>,
    stdin: &mut ChildStdin,
    cancel: &mut watch::Receiver<bool>,
    project: Option<&ProjectBinding>,
    bridge: &crate::session_mcp::Bridge,
) -> Result<Option<(Phase, Option<String>, &'static str)>, String> {
    let mut initialized = false;
    let mut confirmed_attempt = String::new();
    let mut confirmed_turn: Option<String> = None;
    let mut first_delta = true;
    let mut new_segment = true;
    let mut deferred: Option<Result<Value, String>> = None;
    let mut stop = None;
    let mut write_failure_deadline = None;
    let mut total = 0;
    let mut pending = HashMap::<String, (String, Instant)>::new();
    let mut relay_decisions = bash::Decisions::default();
    // At most one live message is in flight; the bridge acknowledges it only
    // from the CLI's own echo. An unconfirmed one stays upgradeable while the
    // attempt runs, and is never written again.
    let mut live: Option<(String, Instant)> = None;
    let mut approvals = tokio::time::interval(Duration::from_millis(100));
    approvals.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        let event = if let Some(next) = deferred.take() {
            next?
        } else {
            tokio::select! {
                biased;
                _ = async { let _ = cancel.wait_for(|requested| *requested).await; }, if stop.is_none() => {
                    send(stdin, json!({"type":"stop"})).await?;
                    relay_decisions = bash::Decisions::default();
                    stop = Some(Instant::now() + Duration::from_secs(3));
                    continue;
                }
                _ = async { tokio::time::sleep_until(stop.unwrap()).await; }, if stop.is_some() => return Ok(None),
                _ = async { tokio::time::sleep_until(write_failure_deadline.unwrap()).await; }, if write_failure_deadline.is_some() =>
                    return Err("Claude bridge could not accept live input or confirm its outcome.".into()),
                _ = approvals.tick(), if stop.is_none() && write_failure_deadline.is_none() => {
                    let receipt = app.receipt(id)?;
                    if receipt.cancel_requested {
                        send(stdin, json!({"type":"stop"})).await?;
                        relay_decisions = bash::Decisions::default();
                        stop = Some(Instant::now() + Duration::from_secs(3));
                        continue;
                    }
                    if let Some((id_, deadline)) = &live && Instant::now() >= *deadline {
                        steering::settle(app, id, id_, SteeringState::Uncertain)?;
                        live = None;
                    }
                    if live.is_none()
                        && initialized
                        && receipt.can_steer
                        && receipt.steering.iter().any(|input| input.state == SteeringState::Pending)
                    {
                        app.check_original_context(&receipt.session)?;
                        let turn = receipt.turn.clone().unwrap_or_default();
                        if let Some(input) = steering::claim_input(app, id, thread, &turn)? {
                            let command = &input.command;
                            match steering::queued_images(app, &input) {
                                Ok(images) => {
                                    let mut request = json!({"type":"steer", "id":command.id, "text":command.text});
                                    if !images.is_empty() {
                                        request["images"] = json!(image_parts(&images));
                                    }
                                    if send(stdin, request).await.is_ok() {
                                        live = Some((command.id.clone(), Instant::now() + Duration::from_secs(60)));
                                    } else {
                                        // A close can race the write. Read the bridge's
                                        // terminal evidence before classifying delivery.
                                        write_failure_deadline = Some(Instant::now() + Duration::from_secs(3));
                                    }
                                }
                                // Nothing was written, so this is a definite non-delivery.
                                Err(_) => steering::settle(app, id, &command.id, SteeringState::Rejected)?,
                            }
                        }
                    }
                    if pending.is_empty() || write_failure_deadline.is_some() {
                        continue;
                    }
                    let project = project.ok_or("Claude permission project missing")?;
                    let replies = {
                        if !app.persistence_available() || app.shutdown_requested.load(std::sync::atomic::Ordering::SeqCst) {
                            return Err("Deck approval authority unavailable".into());
                        }
                        let mut store = app.store.lock().map_err(|_| "State lock failed")?;
                        let receipt = store.get(id)?.ok_or("Claude receipt missing")?;
                        if !approval::project_current(&store, &receipt, project)? {
                            return Err("Claude project authority changed".into());
                        }
                        let mut replies = Vec::new();
                        for (request, (decision, deadline)) in &pending {
                            if Instant::now() >= *deadline {
                                return Err("Claude permission request timed out".into());
                            }
                            match receipt.decisions.iter().find(|d| d.id == *decision).map(|d| &d.state) {
                                Some(DecisionState::Responded) => {
                                    if let Some(d) = store.authorize_response(id, decision, &receipt.generation)? {
                                        let session_grant = d.resolution.as_ref()
                                            .is_some_and(|r| r.response == DecisionResponse::AllowSession);
                                        replies.push((request.clone(), Some(d.id.clone()), approval::release(&d, project), session_grant));
                                    }
                                }
                                Some(DecisionState::Invalidated) => {
                                    replies.push((request.clone(), None, None, false));
                                }
                                _ => {}
                            }
                        }
                        replies
                    };
                    for (request, decision, permit, session_grant) in replies {
                        if *cancel.borrow() { break; }
                        let allowed = permit.is_some();
                        send(stdin, json!({"type": "permission_reply", "request": request, "allowed": allowed, "permit": permit})).await?;
                        if let Some(decision) = decision {
                            app.change(id, |receipt| approval::delivered(receipt, &decision, allowed))?;
                        }
                        pending.remove(&request);
                        if allowed && session_grant && !pending.is_empty() {
                            let mut store = app.store.lock().map_err(|_| "State lock failed")?;
                            for (waiting, _) in pending.values() {
                                store.reconsider_permission(id, waiting)?;
                            }
                        }
                    }
                    continue;
                }
                (request, result) = relay_decisions.next(), if stop.is_none() && write_failure_deadline.is_none() => {
                    let result = if *cancel.borrow() { Err("Permission request was cancelled".into()) } else { result };
                    send(stdin, bash::reply(request, result)).await?;
                    continue;
                }
                event = frame(stdout, partial) => event?,
            }
        };
        if event["session_id"].as_str() != Some(thread) {
            return Err("Claude bridge did not confirm the requested native session ID.".into());
        }
        match event["type"].as_str() {
            Some("init") if !initialized => {
                // The bridge acknowledges live messages from the CLI's echo of
                // their uuid, so confirm_context marks can_steer in the same save.
                let (attempt, turn) = confirm_context(
                    app,
                    id,
                    thread,
                    provenance.clone(),
                    event["model"].as_str(),
                    true,
                )?;
                confirmed_attempt = attempt;
                confirmed_turn = turn;
                initialized = true;
            }
            Some("context" | "context_reset") if initialized => {
                app.change(id, |r| {
                    let turn = r.turn.clone().unwrap_or_default();
                    crate::observations::observe_claude(&mut r.context, &event, thread, &turn, &r.attempt, r.model.as_deref());
                })?;
            }
            Some("steer_terminal") => {
                let yielded = event["yielded"].as_array().filter(|ids| ids.len() <= 32)
                    .ok_or("Invalid Claude terminal live input inventory")?
                    .iter().map(|id| id.as_str().and_then(|id| Uuid::parse_str(id).ok())
                        .ok_or_else(|| "Invalid Claude live message ID".to_string()))
                    .collect::<Result<HashSet<_>, _>>()?;
                app.change(id, |r| {
                    r.can_steer = false;
                    for input in &mut r.steering {
                        if matches!(input.state, SteeringState::Pending | SteeringState::Dispatching | SteeringState::Uncertain)
                            && Uuid::parse_str(&input.command.id).is_ok_and(|id| !yielded.contains(&id))
                        {
                            input.state = SteeringState::Rejected;
                        }
                    }
                })?;
                live = None;
            }
            Some(kind @ ("steer_ack" | "steer_rejected")) if initialized => {
                let steer = event["id"].as_str().filter(|id| Uuid::parse_str(id).is_ok())
                    .ok_or("Invalid Claude live message ID")?;
                let state = if kind == "steer_ack" { SteeringState::Accepted } else { SteeringState::Rejected };
                steering::settle(app, id, steer, state)?;
                if live.as_ref().is_some_and(|(open, _)| open == steer) {
                    live = None;
                }
            }
            Some("activity") if initialized => {
                if let Some(turn) = confirmed_turn.as_deref()
                    && let Some(value) = activity_event(&event, thread, turn)
                {
                    app.record_activity(id, "", &confirmed_attempt, thread, turn, &value);
                }
            }
            Some("text_start") if initialized => { new_segment = true; }
            Some("delta") if initialized => {
                let text = event["text"].as_str().ok_or("Missing Claude text delta")?;
                if total + text.len() > MAX_TEXT {
                    return Err("Claude output exceeded the text limit".into());
                }
                let mut batch = text.to_owned();
                let mut sdk_received_ms = event["sdk_received_ms"].as_u64();
                // Flush the first delta immediately for time-to-first-token, then coalesce
                // consecutive deltas like Codex (50 ms / 16 KiB) so slow fsyncs never build lag.
                if !first_delta {
                    let deadline = Instant::now() + DELTA_BATCH_WINDOW;
                    while batch.len() < DELTA_BATCH_BYTES && Instant::now() < deadline {
                        let next = tokio::select! {
                            biased;
                            _ = async { let _ = cancel.wait_for(|requested| *requested).await; }, if stop.is_none() => break,
                            next = tokio::time::timeout_at(deadline, frame(stdout, partial)) => match next {
                                Ok(result) => result,
                                Err(_) => break,
                            },
                        };
                        if let Ok(next_event) = &next
                            && next_event["session_id"].as_str() == Some(thread)
                            && next_event["type"].as_str() == Some("delta")
                            && let Some(more) = next_event["text"].as_str()
                            && total + batch.len() + more.len() <= MAX_TEXT
                        {
                            if sdk_received_ms.is_none() {
                                sdk_received_ms = next_event["sdk_received_ms"].as_u64();
                            }
                            batch.push_str(more);
                        } else {
                            deferred = Some(next);
                            break;
                        }
                    }
                }
                first_delta = false;
                total += batch.len();
                app.append_claude_delta(id, &batch, sdk_received_ms, new_segment)?;
                if !batch.is_empty() { new_segment = false; }
            }
            Some("permission") if initialized => {
                let request = event["request"]
                    .as_str()
                    .filter(|id| Uuid::parse_str(id).is_ok())
                    .ok_or("Invalid Claude permission request ID")?;
                if stop.is_some() || *cancel.borrow() {
                    continue;
                }
                let permission = if let Some(project) = project
                    && app.persistence_available()
                    && !app.shutdown_requested.load(std::sync::atomic::Ordering::SeqCst)
                {
                    let mut store = app.store.lock().map_err(|_| "State lock failed")?;
                    let mut r = store.get(id)?.ok_or("Claude receipt missing")?;
                    approval::record(&mut store, &mut r, project, &event, request)?
                } else {
                    approval::Permission::Denied
                };
                if let approval::Permission::Review(decision) = permission {
                    pending.insert(
                        request.into(),
                        (decision, Instant::now() + Duration::from_secs(15 * 60)),
                    );
                } else {
                    let permit = match permission {
                        approval::Permission::Allowed(permit) if !*cancel.borrow() => Some(permit),
                        _ => None,
                    };
                    send(
                        stdin,
                        json!({"type":"permission_reply","request":request,"allowed":permit.is_some(),"permit":permit}),
                    )
                    .await?;
                }
            }
            Some("workspace_bash" | "mcp_permission") if initialized => {
                if stop.is_none() && !*cancel.borrow() {
                    relay_decisions.request(&event, app, bridge, project)?;
                }
            }
            Some("workspace_bash_closed" | "mcp_permission_closed") if initialized => relay_decisions.withdraw(&event),
            Some("workspace_write") if initialized => {
                let request = event["request"]
                    .as_str()
                    .filter(|id| Uuid::parse_str(id).is_ok())
                    .ok_or("Invalid Claude write request ID")?;
                let allowed = if let Some(project) = project
                    && stop.is_none()
                    && !*cancel.borrow()
                    && app.persistence_available()
                    && !app
                        .shutdown_requested
                        .load(std::sync::atomic::Ordering::SeqCst)
                {
                    let store = app.store.lock().map_err(|_| "State lock failed")?;
                    let receipt = store.get(id)?.ok_or("Claude receipt missing")?;
                    receipt.phase == Phase::Running
                        && !receipt.cancel_requested
                        && approval::project_current(&store, &receipt, project)?
                        && approval::workspace_write_target(&event, project)
                } else {
                    false
                };
                let allowed = allowed && !*cancel.borrow();
                send(
                    stdin,
                    json!({
                        "type": "permission_reply", "request": request, "allowed": allowed,
                        "permit": allowed.then(|| json!({})),
                    }),
                )
                .await?;
            }
            Some("permission_closed") if initialized => {
                let request = event["request"]
                    .as_str()
                    .ok_or("Missing Claude permission request ID")?;
                if let Some((decision, _)) = pending.remove(request) {
                    app.change(id, |r| approval::invalidate(r, &decision))?;
                }
            }
            Some("result") => {
                return Ok(Some(match event["outcome"].as_str() {
                    Some("completed") if initialized && stop.is_none() && !*cancel.borrow() => (
                        Phase::Completed,
                        Some(
                            event["text"]
                                .as_str()
                                .ok_or("Missing Claude final text")?
                                .into(),
                        ),
                        "Claude Code finished.",
                    ),
                    Some("cancelled") if stop.is_some() => (
                        Phase::Cancelled,
                        None,
                        "Claude Code acknowledged the interruption and stopped.",
                    ),
                    Some("limited") => (
                        Phase::Failed,
                        None,
                        "Claude declined the turn at its included usage limit. Try again after it resets.",
                    ),
                    Some("failed") => (
                        Phase::Failed,
                        None,
                        "Claude Code reported a failed turn. No input was retried.",
                    ),
                    _ => return Err("Unknown Claude bridge result".into()),
                }));
            }
            _ => return Err("Unexpected Claude bridge event".into()),
        }
    }
}

fn activity_event(event: &Value, thread: &str, turn: &str) -> Option<Value> {
    let item = activity_item(event)?;
    let method = if event["phase"] == "completed" { "item/completed" } else { "item/started" };
    Some(json!({"method":method,"params":{"threadId":thread,"turnId":turn,"item":item}}))
}

fn activity_item(event: &Value) -> Option<Value> {
    let id = event["id"].as_str().filter(|s| !s.is_empty() && s.len() <= 200)?;
    let cap = |key: &str, n: usize| -> String { event[key].as_str().unwrap_or("").chars().take(n).collect() };
    let status = match event["status"].as_str() {
        Some("cancelled") => "cancelled",
        Some("failed") => "failed",
        _ => "completed",
    };
    let mut item = match event["kind"].as_str()? {
        "reasoning" => json!({"id":id,"type":"reasoning"}),
        "command" => json!({"id":id,"type":"commandExecution","tool":cap("tool", 64),"command":cap("command", 240)}),
        "file" => json!({"id":id,"type":"fileChange","changes":[{"path":cap("path", 240)}]}),
        "tool" => json!({"id":id,"type":"dynamicToolCall","tool":cap("tool", 64),"arguments":cap("summary", 160)}),
        _ => return None,
    };
    item["status"] = json!(if event["phase"] == "completed" { status } else { "running" });
    Some(item)
}

pub(crate) fn confirm_context(
    app: &App,
    id: &str,
    thread: &str,
    provenance: NativeProvenance,
    model: Option<&str>,
    can_steer: bool,
) -> Result<(String, Option<String>), String> {
    let mut store = app.store.lock().unwrap();
    let mut r = store.get(id)?.ok_or("Claude receipt missing")?;
    let mut session = store.session_by_id(&r.session)?;
    session.native = Some(NativeContext {
        runner: Some(NativeRunner::Claude),
        thread: thread.into(),
        mode: Mode::SessionV1,
        provenance: Some(provenance),
    });
    if !r.cancel_requested {
        r.phase = Phase::Running;
        r.turn = Some(r.generation.clone());
    }
    if can_steer {
        r.can_steer = r.phase == Phase::Running && !r.cancel_requested;
    }
    r.acknowledgment_ms = Some(now());
    r.model = model
        .filter(|v| v.len() < 160 && !v.chars().any(char::is_control))
        .map(str::to_owned);
    let attempt = r.attempt.clone();
    let turn = r.turn.clone();
    store
        .conn
        .execute_batch("SAVEPOINT claude_context")
        .map_err(|_| "Cannot begin Claude context update")?;
    let result = store
        .save_session(&session)
        .and_then(|()| store.save(&mut r));
    if result.is_err() {
        let _ = store
            .conn
            .execute_batch("ROLLBACK TO claude_context; RELEASE claude_context");
        return result.map(|()| (attempt, turn));
    }
    store
        .conn
        .execute_batch("RELEASE claude_context")
        .map_err(|_| "Cannot confirm Claude context".to_string())?;
    Ok((attempt, turn))
}

#[cfg(test)]
#[path = "claude_tests.rs"]
mod tests;
