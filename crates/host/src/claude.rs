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

pub(crate) const RUNNER: &str = "claude";
const QUALIFICATION: &str = "deck2-claude-agent-sdk-text-v1";
const SDK_VERSION: &str = "0.3.328";
const BRIDGE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/claude-sdk.mjs"));
const MAX_FRAME: usize = 1024 * 1024;
const MAX_TEXT: usize = 2 * MAX_FRAME;

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
    launch.verify_policy().map_err(|s| s.message())?;
    let script = bridge_script()?;
    let mut command = launch.command(&node);
    command
        .args([script.path(), &binary])
        .args(["", operation, launch.sources(), SETTINGS]);
    let bytes = crate::native::claude_catalog_probe(command)
        .await
        .map_err(|reason| {
            if operation == "quota" {
                "Claude Code could not read subscription quota."
            } else if reason == "Native command probe timed out" {
                "Claude Code model discovery timed out. Reopen the dialog to retry."
            } else {
                "Claude Code could not load its model catalog. Reopen the dialog to retry."
            }
        })?;
    launch.verify_policy().map_err(|s| s.message())?;
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

fn is_receipt(receipt: &Receipt) -> bool {
    receipt.mode == Mode::SessionV1 && receipt.configuration.as_ref().is_some_and(admitted)
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
        r.phase = Phase::Failed;
        approval::settle(&mut r);
        r.detail = "The previous Claude Code process stopped without a confirmed result. Context is retained and the input will not replay.".into();
        store.save(&mut r)?;
    }
    Ok(retry)
}

fn spawn_sdk(
    launch: &Launch,
    script: &Path,
    binary: &Path,
    thread: &str,
    operation: &str,
    assignment: &MemberAssignment,
) -> Result<Child, String> {
    let node = node_runtime()?;
    let mut command = launch.command(&node);
    command
        .arg(script)
        .arg(binary)
        .arg(thread)
        .arg(operation)
        .arg(launch.sources())
        .arg(SETTINGS)
        .arg(&assignment.model_id)
        .arg(assignment.thinking.as_deref().unwrap_or(""))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    crate::native::own_child(&mut command)?;
    command.spawn().map_err(|_| "Could not start the Claude Agent SDK bridge".into())
}

fn bootstrap(bridge: &crate::session_mcp::Bridge, mut instructions: String, trusted: bool, can_write: bool, allow_bash: bool, approvals: &str) -> Value {
    let inventory = bridge.inventory();
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
        "server": {"type": "http", "url": bridge.config["url"], "headers": bridge.config["http_headers"], "alwaysLoad": true},
        "toolNames": tool_names,
        "workspaceTools": workspace_tools,
        "autoAllowBash": allow_bash && approvals == "yolo",
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

    let status_started = Instant::now();
    let status = tokio::select! {
        biased;
        _ = cancel.wait_for(|active| *active) => return cancelled(app, id, false),
        status = launch.status(binary) => status,
    };
    let status_ms = status_started.elapsed().as_millis() as u64;
    if status != Status::SubscriptionSignedIn {
        return Err(status.message().into());
    }
    launch.verify_policy().map_err(|s| s.message())?;
    let script = bridge_script()?;
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
    let assignment = &contract.members["lead"];
    let spawn_started = Instant::now();
    let mut child = spawn_sdk(
        &launch, script.path(), binary, &thread,
        if resume.is_some() { "resume" } else { "new" }, assignment,
    )?;
    let spawn_ms = spawn_started.elapsed().as_millis() as u64;
    let pid = child
        .id()
        .ok_or("Claude bridge process identity unavailable")?;
    let mut stdin = child.stdin.take().expect("configured Claude bridge stdin");
    let mut stdout = BufReader::new(
        child
            .stdout
            .take()
            .expect("configured Claude bridge stdout"),
    );
    let run = async {
        app.change(id, |r| r.native_pid = Some(pid))?;
        let ready_started = Instant::now();
        send(&mut stdin, bootstrap(&bridge, instructions, trusted, trusted, trusted, &contract.approvals)).await?;
        let mut ready_frame = Vec::new();
        let ready = tokio::select! {
            biased;
            _ = cancel.wait_for(|active| *active) => return Ok(None),
            ready = timeout(Duration::from_secs(20), frame(&mut stdout, &mut ready_frame)) =>
                ready.map_err(|_| "Claude SDK subscription initialization timed out")??,
        };
        check_ready(app, &ready, "Lead")?;
        launch.verify_policy().map_err(|s| s.message())?;
        let ready_ms = ready_started.elapsed().as_millis() as u64;
        let prompt = {
            let mut store = crate::latency::locked(&app.store);
            let mut r = store.get(id)?.ok_or("Claude receipt missing")?;
            let current = store.execution_project(&r.session)?;
            if current != project || store.trusted_project(&current.root)? != trusted {
                return Err("Project trust or ownership changed. Submit a new message.".into());
            }
            store.validate_snapshot(snapshot)?;
            if r.cancel_requested || *cancel.borrow() {
                return Ok(None);
            }
            let prompt = store.outcome_prompt(&r)?.unwrap_or_else(|| r.prompt.clone());
            r.phase = Phase::Dispatching;
            let handshake_ms = started.elapsed().as_millis() as u64;
            // Claude has no thread/MCP inventory: `version_ms` is the CLI
            // subscription status probe, `initialization_ms` is SDK readiness.
            let mut timing = deck2_shared::StartupTiming {
                admission_ms,
                version_ms: status_ms,
                bridge_start_ms,
                process_spawn_ms: spawn_ms,
                initialization_ms: ready_ms,
                ..Default::default()
            };
            (timing.run_lock_wait_us, timing.run_lock_acquisitions) = crate::latency::run_waits();
            if let Some(waits) = crate::latency::take_submit(id) {
                waits.apply(&mut timing);
            }
            timing.other_ms = handshake_ms.saturating_sub(status_ms + bridge_start_ms + spawn_ms + ready_ms);
            r.startup_timing = Some(timing);
            r.handshake_ms = Some(handshake_ms);
            r.dispatch_ms = Some(now());
            r.thread = Some(thread.clone());
            r.generation = Uuid::new_v4().to_string();
            r.detail = "Claude SDK subscription verified. Delivering the input once.".into();
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
            &mut stdin,
            cancel,
            trusted.then_some(&project),
            trusted.then_some((&bridge, &project)),
        )
        .await
    }
    .await;

    drop(bridge);
    drop(stdin);
    let clean = drain_sdk(&mut child, pid).await?;

    let dispatched = app.receipt(id)?.dispatch_ms.is_some();
    match run {
        Ok(Some((phase, text, detail))) if clean => app.change(id, |r| {
            approval::settle(r);
            if let Some(text) = text {
                r.first_output_ms.get_or_insert_with(now);
                r.text = text;
            }
            r.detail = detail.into();
            r.phase = phase;
        }),
        _ if *cancel.borrow() => cancelled(app, id, dispatched),
        Err(message) if !dispatched => Err(message),
        _ => app.change(id, |r| {
            approval::settle(r);
            r.phase = Phase::Failed;
            r.detail =
                "Claude Code stopped without a confirmed result. The input will not replay.".into();
        }),
    }
}

fn cancelled(app: &App, id: &str, dispatched: bool) -> Result<(), String> {
    app.change(id, |r| {
        approval::settle(r);
        r.phase = Phase::Cancelled;
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
    stdin: &mut ChildStdin,
    cancel: &mut watch::Receiver<bool>,
    project: Option<&ProjectBinding>,
    bash_scope: Option<(&crate::session_mcp::Bridge, &ProjectBinding)>,
) -> Result<Option<(Phase, Option<String>, &'static str)>, String> {
    let mut initialized = false;
    let mut stop = None;
    let mut partial = Vec::new();
    let mut total = 0;
    let mut pending = HashMap::<String, (String, Instant)>::new();
    let mut bash_decisions = bash::Decisions::default();
    // At most one live message is in flight; the bridge acknowledges it only
    // from the CLI's own echo. An unconfirmed one stays upgradeable while the
    // attempt runs, and is never written again.
    let mut live: Option<(String, Instant)> = None;
    let mut approvals = tokio::time::interval(Duration::from_millis(100));
    approvals.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        let event = tokio::select! {
            biased;
            _ = async { let _ = cancel.wait_for(|requested| *requested).await; }, if stop.is_none() => {
                send(stdin, json!({"type":"stop"})).await?;
                bash_decisions = bash::Decisions::default();
                stop = Some(Instant::now() + Duration::from_secs(3));
                continue;
            }
            _ = async { tokio::time::sleep_until(stop.unwrap()).await; }, if stop.is_some() => return Ok(None),
            _ = approvals.tick(), if stop.is_none() => {
                if app.receipt(id)?.cancel_requested {
                    send(stdin, json!({"type":"stop"})).await?;
                    bash_decisions = bash::Decisions::default();
                    stop = Some(Instant::now() + Duration::from_secs(3));
                    continue;
                }
                if let Some((id_, deadline)) = &live && Instant::now() >= *deadline {
                    steering::settle(app, id, id_, SteeringState::Uncertain)?;
                    live = None;
                }
                if live.is_none() && initialized {
                    let receipt = app.receipt(id)?;
                    if receipt.can_steer
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
                                    send(stdin, request).await?;
                                    live = Some((command.id.clone(), Instant::now() + Duration::from_secs(60)));
                                }
                                // Nothing was written, so this is a definite non-delivery.
                                Err(_) => steering::settle(app, id, &command.id, SteeringState::Rejected)?,
                            }
                        }
                    }
                }
                if pending.is_empty() {
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
            (request, allowed) = bash_decisions.next(), if stop.is_none() => {
                let allowed = allowed && !*cancel.borrow();
                send(stdin, json!({"type":"permission_reply","request":request,"allowed":allowed,"permit":allowed.then(|| json!({}))})).await?;
                continue;
            }
            event = frame(stdout, &mut partial) => event?,
        };
        if event["session_id"].as_str() != Some(thread) {
            return Err("Claude bridge did not confirm the requested native session ID.".into());
        }
        match event["type"].as_str() {
            Some("init") if !initialized => {
                confirm_context(app, id, thread, provenance.clone(), event["model"].as_str())?;
                // The bridge acknowledges live messages from the CLI's echo of
                // their uuid, so this attempt can take them mid-turn.
                app.change(id, |r| r.can_steer = r.phase == Phase::Running && !r.cancel_requested)?;
                initialized = true;
            }
            Some(kind @ ("steer_ack" | "steer_rejected" | "steer_unconsumed")) if initialized => {
                let steer = event["id"].as_str().filter(|id| Uuid::parse_str(id).is_ok())
                    .ok_or("Invalid Claude live message ID")?;
                let state = match kind {
                    "steer_ack" => SteeringState::Accepted,
                    "steer_rejected" => SteeringState::Rejected,
                    _ => SteeringState::Uncertain,
                };
                steering::settle(app, id, steer, state)?;
                if live.as_ref().is_some_and(|(open, _)| open == steer) {
                    live = None;
                }
            }
            Some("delta") if initialized => {
                let text = event["text"].as_str().ok_or("Missing Claude text delta")?;
                total += text.len();
                if total > MAX_TEXT {
                    return Err("Claude output exceeded the text limit".into());
                }
                app.change(id, |r| {
                    r.first_output_ms.get_or_insert_with(now);
                    r.text.push_str(text);
                })?;
            }
            Some("permission") if initialized => {
                let request = event["request"]
                    .as_str()
                    .filter(|id| Uuid::parse_str(id).is_ok())
                    .ok_or("Invalid Claude permission request ID")?;
                if stop.is_some() || *cancel.borrow() {
                    continue;
                }
                let decision = if let Some(project) = project {
                    let mut store = app.store.lock().map_err(|_| "State lock failed")?;
                    let mut r = store.get(id)?.ok_or("Claude receipt missing")?;
                    approval::record(&mut store, &mut r, project, &event, request)?
                } else {
                    None
                };
                if let Some(decision) = decision {
                    pending.insert(
                        request.into(),
                        (decision, Instant::now() + Duration::from_secs(15 * 60)),
                    );
                } else {
                    send(
                        stdin,
                        json!({"type": "permission_reply", "request": request, "allowed": false}),
                    )
                    .await?;
                }
            }
            Some("workspace_bash") if initialized => {
                if stop.is_none() && !*cancel.borrow() {
                    bash_decisions.request(&event, app, bash_scope)?;
                }
            }
            Some("workspace_bash_closed") if initialized => bash_decisions.withdraw(&event),
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

pub(crate) fn confirm_context(
    app: &App,
    id: &str,
    thread: &str,
    provenance: NativeProvenance,
    model: Option<&str>,
) -> Result<(), String> {
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
    r.acknowledgment_ms = Some(now());
    r.model = model
        .filter(|v| v.len() < 160 && !v.chars().any(char::is_control))
        .map(str::to_owned);
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
        return result;
    }
    store
        .conn
        .execute_batch("RELEASE claude_context")
        .map_err(|_| "Cannot confirm Claude context".into())
}

#[cfg(test)]
#[path = "claude_tests.rs"]
mod tests;
