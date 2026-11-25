//! Antigravity Lead turns and shared ACP session setup.
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::atomic::Ordering,
    time::Duration,
};

use deck2_shared::{
    AdmissionSnapshot, MemberAssignment, Mode, NativeBinding, NativeContext, NativeProvenance,
    NativeRunner, Phase, ProjectBinding, Receipt, RunnerBinding,
};
use serde_json::{Value, json};
use tokio::{
    sync::watch,
    time::{Instant, timeout},
};

use crate::{
    Store,
    agy_acp::{Client, Error, STARTUP_TIMEOUT, response},
    agy_approval::{self as approval, Permission},
    now,
    server::App,
    session_mcp::Bridge,
    tasks::{digest, file_digest},
};

#[path = "agy_member.rs"]
pub(crate) mod member;
#[path = "agy_sandbox.rs"]
mod sandbox;

pub(crate) const RUNNER: &str = "agy";
const QUALIFICATION: &str = "deck2-antigravity-acp-lead-v1";
const MAX_TEXT: usize = 2 * 1024 * 1024;
const MAX_PERMISSION_IDS: usize = 4096;
pub(super) const CANCEL_GRACE: Duration = Duration::from_millis(500);

/// Agy validates tool schemas with Go's regexp engine, which rejects
/// lookahead. Keep the advertised text constraints in a portable form.
/// Deck still validates the actual arguments when dispatching a tool.
pub(crate) fn adapt_mcp_schemas(schema: &mut Value) {
    const LOOKAHEAD: &str = r"^(?![\s\S]*[\u0000-\u0008\u000b-\u001f\u007f])[\s\S]*\S[\s\S]*$";
    // Go's \s is ASCII-only. Spell out whitespace and C1 controls so
    // neither can satisfy the requirement for a substantive character.
    const NONBLANK: &str = concat!(
        r"^[^\x00-\x08\x0b-\x1f\x7f]*[^\x00-\x20\x7f-\x9f",
        "\u{00a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}",
        r"][^\x00-\x08\x0b-\x1f\x7f]*$"
    );
    match schema {
        Value::Object(fields) => {
            if let Some(pattern) = fields.get_mut("pattern")
                && pattern.as_str() == Some(LOOKAHEAD)
            {
                *pattern = json!(NONBLANK);
            }
            fields.values_mut().for_each(adapt_mcp_schemas);
        }
        Value::Array(values) => values.iter_mut().for_each(adapt_mcp_schemas),
        _ => {}
    }
}

pub(crate) fn executable() -> Result<PathBuf, String> {
    crate::runner_management::path_tool(RUNNER)
        .and_then(|path| {
            path.canonicalize()
                .map_err(|_| "Cannot resolve Antigravity executable".into())
        })
        .map_err(|_| "Install Antigravity on the Deck host and add agy to PATH.".into())
}

pub(super) fn binary_key(path: &Path) -> Result<String, String> {
    let hash = file_digest(path).map_err(|_| "Antigravity executable unavailable")?;
    Ok(digest(format!("{path:?}:{hash}").as_bytes()))
}

pub(crate) fn selection_key() -> Result<String, String> {
    binary_key(&executable()?)
}

fn profile_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .filter(|home| Path::new(home).is_absolute())
        .ok_or("Antigravity home directory unavailable")?;
    let home = std::fs::canonicalize(home).map_err(|_| "Antigravity home directory unavailable")?;
    let storage = home.join(".gemini/antigravity-cli");
    let storage = match storage.canonicalize() {
        Ok(storage) => storage,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => storage,
        Err(_) => return Err("Antigravity session storage unavailable".into()),
    };
    Ok(storage)
}

fn profile_key() -> Result<String, String> {
    Ok(digest(profile_path()?.as_os_str().as_encoded_bytes()))
}

pub(crate) fn bind(snapshot: &mut AdmissionSnapshot) -> Result<(), String> {
    let assignment = snapshot
        .session_contract
        .as_ref()
        .and_then(|c| c.members.get("lead"))
        .ok_or("Invalid Antigravity Lead model or thinking level")?;
    let native = native_binding(
        assignment,
        QUALIFICATION,
        profile_key()?,
        digest(include_bytes!("../assets/session-roles.json")),
    )?;
    snapshot.runner = Some(native.executable.clone());
    snapshot.native = Some(native);
    snapshot.cbm = None;
    snapshot.helper = None;
    snapshot.investigator = None;
    snapshot.exclusions = vec!["Antigravity uses ACP and the Deck session MCP.".into()];
    Ok(())
}

fn native_binding(
    assignment: &MemberAssignment,
    qualification: &str,
    storage: String,
    role: String,
) -> Result<NativeBinding, String> {
    if assignment.runner_id != RUNNER
        || !valid_id(&assignment.model_id, 160)
        || !assignment
            .thinking
            .as_deref()
            .is_none_or(|level| matches!(level, "low" | "medium" | "high" | "xhigh"))
    {
        return Err("Invalid Antigravity model or thinking level".into());
    }
    let binary = executable()?;
    let binding = RunnerBinding {
        executable: file_digest(&binary).map_err(|_| "Antigravity executable unavailable")?,
        path: binary
            .into_os_string()
            .into_string()
            .map_err(|_| "Invalid Antigravity executable path")?,
        ownership: "external_unknown".into(),
        model: Some(assignment.model_id.clone()),
        qualification: qualification.into(),
        catalog: None,
    };
    Ok(NativeBinding {
        runner: NativeRunner::Agy,
        protocol: "acp".into(),
        version: "1".into(),
        executable: binding,
        storage,
        configuration: digest(qualification.as_bytes()),
        role,
    })
}

pub(crate) fn admitted(snapshot: &AdmissionSnapshot) -> bool {
    snapshot
        .session_contract
        .as_ref()
        .and_then(|c| c.members.get("lead"))
        .is_some_and(|assignment| {
            assignment.runner_id == RUNNER
                && snapshot.native.as_ref().is_some_and(|binding| {
                    binding.runner == NativeRunner::Agy
                        && binding.protocol == "acp"
                        && binding.version == "1"
                        && binding.executable.qualification == QUALIFICATION
                        && binding.executable.model.as_ref() == Some(&assignment.model_id)
                        && snapshot.runner.as_ref() == Some(&binding.executable)
                })
        })
}

fn is_receipt(receipt: &Receipt) -> bool {
    receipt.mode == Mode::SessionV1 && receipt.configuration.as_ref().is_some_and(admitted)
}

pub(super) fn lead_yolo(receipt: &Receipt) -> bool {
    is_receipt(receipt)
        && receipt
            .configuration
            .as_ref()
            .and_then(|snapshot| snapshot.session_contract.as_ref())
            .is_some_and(|contract| contract.approvals == "yolo")
}

pub(crate) fn settle_recovered(store: &mut Store, live: &HashSet<String>) -> Result<bool, String> {
    let mut retry = false;
    for mut receipt in store
        .pending_receipts()?
        .into_iter()
        .filter(|r| r.phase == Phase::Uncertain && is_receipt(r) && !live.contains(&r.id))
    {
        if let Some(pid) = receipt
            .native_pid
            .and_then(|pid| i32::try_from(pid).ok())
            .filter(|pid| *pid > 1)
        {
            if !crate::claude::process_group_stopped(pid) {
                retry = true;
                continue;
            }
        } else if receipt.dispatch_ms.is_some() {
            continue;
        }
        approval::settle(&mut receipt);
        receipt.phase = Phase::Failed;
        receipt.detail = "The previous Antigravity process stopped without a confirmed result. Context is retained and the input will not replay.".into();
        store.save(&mut receipt)?;
    }
    Ok(retry)
}

pub(super) fn valid_id(id: &str, limit: usize) -> bool {
    !id.is_empty()
        && id.len() <= limit
        && id.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'/')
        })
}

pub(super) fn session_id(session: &Value) -> Option<&str> {
    session["sessionId"].as_str().filter(|id| valid_id(id, 200))
}

fn remember_permission_id(seen: &mut HashSet<String>, id: &str) -> bool {
    // Fail closed at the limit. Evicting IDs would make old requests replayable.
    seen.len() < MAX_PERMISSION_IDS && seen.insert(id.to_owned())
}

impl From<Error> for String {
    fn from(error: Error) -> Self {
        match error {
            Error::Transport => "Antigravity disconnected.",
            Error::Protocol => "Antigravity returned an incompatible ACP message.",
            Error::Authentication => {
                "Sign in with agy acp --login on the Deck host, then try again."
            }
            Error::Rejected => "Antigravity rejected the ACP request.",
            Error::Timeout => "Antigravity did not respond before the deadline.",
        }
        .into()
    }
}

fn external_tools(
    store: &Store,
    project: &ProjectBinding,
    trusted: bool,
    read_only: bool,
) -> Result<Value, String> {
    Ok(crate::external_tools::servers(
        &store.external_settings()?,
        &crate::external_tools::home()?,
        Path::new(&project.root),
        trusted,
        read_only,
    ))
}

struct Mcp {
    servers: Vec<Value>,
    session_name: String,
    external_permissions: HashSet<String>,
    external_namespaces: Vec<String>,
    _cbm_runtime: Option<tempfile::TempDir>,
}

impl Mcp {
    fn new(
        config: &Value,
        auth: &Value,
        external: &Value,
        scratch: Option<&Path>,
    ) -> Result<Self, String> {
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        // Agy flattens names without exposing a separate server identity.
        // The nonce and underscore-free server name prevent alias collisions.
        let session_name = format!("deck{nonce}");
        let mut servers = vec![json!({
            "type":"http","name":session_name,"url":config["url"],
            "headers":[{"name":"Authorization","value":auth}]
        })];
        let cbm_runtime =
            if scratch.is_none() && external["deck-codebase-memory"]["enabled"] == true {
                Some(
                    tempfile::Builder::new()
                        .prefix("d2tool-")
                        .tempdir_in("/tmp")
                        .map_err(|_| "Codebase Memory runtime unavailable")?,
                )
            } else {
                None
            };
        let mut external_permissions = HashSet::new();
        let mut external_namespaces = Vec::new();
        for (label, spec) in external.as_object().into_iter().flatten() {
            if spec["enabled"] != true {
                continue;
            }
            // Gemini's function-name limit also applies after ACP flattens the alias.
            let name = format!("{}{}", label.replace('-', ""), &nonce[12..]);
            let mut env = spec["env"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(name, value)| json!({"name":name,"value":value}))
                .collect::<Vec<_>>();
            if label == "deck-codebase-memory"
                && let Some(path) =
                    scratch.or_else(|| cbm_runtime.as_ref().map(tempfile::TempDir::path))
            {
                env.push(json!({"name":"CBM_RUNTIME_DIR","value":path}));
            }
            servers
                .push(json!({"name":name,"command":spec["command"],"args":spec["args"],"env":env}));
            // ACP has no enabled_tools setting for stdio transports. Enforce
            // the read-only allowlist before releasing a native permission.
            if let Some(tools) = spec["enabled_tools"].as_array() {
                external_permissions.extend(
                    tools
                        .iter()
                        .filter_map(Value::as_str)
                        .map(|tool| format!("mcp_{name}_{tool}")),
                );
            } else {
                external_namespaces.push(format!("mcp_{name}_"));
            }
        }
        Ok(Self {
            servers,
            session_name,
            external_permissions,
            external_namespaces,
            _cbm_runtime: cbm_runtime,
        })
    }

    fn tools(&self, bridge: &Bridge) -> TrustedTools {
        let inventory = bridge.inventory();
        let session = inventory
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|tool| tool["name"].as_str())
            .map(|tool| format!("mcp_{}_{tool}", self.session_name))
            .collect();
        TrustedTools {
            session,
            external: self.external_permissions.clone(),
            external_namespaces: self.external_namespaces.clone(),
        }
    }
}

struct TrustedTools {
    session: HashSet<String>,
    external: HashSet<String>,
    external_namespaces: Vec<String>,
}

impl TrustedTools {
    fn identity(&self, tool: &Value) -> approval::ToolIdentity {
        let name = tool["name"].as_str().unwrap_or_default();
        if tool["kind"] == "other" && self.session.contains(name) {
            approval::ToolIdentity::Session
        } else if tool["kind"] == "other"
            && (self.external.contains(name)
                || self.external_namespaces.iter().any(|namespace| {
                    name.strip_prefix(namespace)
                        .is_some_and(|tool| valid_id(tool, 64))
                }))
        {
            approval::ToolIdentity::External
        } else {
            approval::ToolIdentity::Native
        }
    }
}

async fn open_session(
    client: &mut Client,
    cwd: &Path,
    mcp: &Mcp,
    resume: Option<&str>,
    instructions: &str,
    assignment: &MemberAssignment,
    thread: &mut Option<String>,
) -> Result<bool, Error> {
    let capabilities = client.initialize().await?;
    let mut params = json!({"cwd":cwd,"mcpServers":mcp.servers});
    let method = if let Some(thread) = resume {
        params["sessionId"] = json!(thread);
        "session/resume"
    } else {
        params["_meta"] = json!({"antigravity":{"systemPrompt":{"append":instructions}}});
        "session/new"
    };
    let session = client.call(method, params).await?;
    let id = session_id(&session)
        .filter(|id| resume.is_none_or(|saved| *id == saved))
        .ok_or(Error::Protocol)?;
    *thread = Some(id.to_owned());
    for (config, value) in [
        ("mode", Some("default")),
        ("model", Some(assignment.model_id.as_str())),
        ("thought_level", assignment.thinking.as_deref()),
    ] {
        if let Some(value) = value {
            let result = client
                .call(
                    "session/set_config_option",
                    json!({"sessionId":id,"configId":config,"value":value}),
                )
                .await?;
            if !result["configOptions"].as_array().is_some_and(|options| {
                options
                    .iter()
                    .any(|option| option["id"] == config && option["currentValue"] == value)
            }) {
                return Err(Error::Protocol);
            }
        }
    }
    Ok(capabilities["agentCapabilities"]["promptCapabilities"]["image"] == true)
}

async fn cancel_session(client: &mut Client, thread: &str) {
    let _ = timeout(CANCEL_GRACE, async {
        client.cancel(thread).await?;
        loop {
            let event = client.read().await?;
            if event["result"]["stopReason"] == "cancelled" {
                return Ok::<_, Error>(());
            }
        }
    })
    .await;
}

fn prompt_images(app: &App, root: &Receipt) -> Result<Vec<Value>, String> {
    use base64::{Engine, engine::general_purpose::STANDARD};

    let store = app.store.lock().map_err(|_| "State lock failed")?;
    root.attachments
        .iter()
        .map(|expected| {
            let (stored, bytes) = store.image(&root.session, &expected.id)?;
            if &stored != expected {
                return Err("Admitted image integrity changed. Submit a new message.".into());
            }
            Ok(json!({"type":"image","mimeType":stored.mime,"data":STANDARD.encode(bytes)}))
        })
        .collect()
}

struct Turn<'a> {
    app: &'a App,
    root: &'a Receipt,
    project: &'a ProjectBinding,
    generation: String,
    bearer: &'a str,
    tools: TrustedTools,
}

pub(crate) async fn lead(
    app: &App,
    id: &str,
    binary: &Path,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let root = app.receipt(id)?;
    if !is_receipt(&root) || root.phase != Phase::Accepted {
        return Err("Antigravity requires an admitted Lead turn.".into());
    }
    app.check_original_context(&root.session)?;
    let snapshot = root.configuration.as_ref().unwrap();
    let binding = snapshot.native.as_ref().unwrap();
    if binding.storage != profile_key()? {
        return Err("Antigravity profile changed after admission.".into());
    }
    let (session, project, trusted, external, prior_tokens) = {
        let store = app.store.lock().map_err(|_| "State lock failed")?;
        let project = store.execution_project(&root.session)?;
        let trusted = store.trusted_project(&project.root)?;
        let external = external_tools(&store, &project, trusted, false)?;
        let session = store.session_by_id(&root.session)?;
        let prior_tokens = session
            .native
            .as_ref()
            .filter(|_| !root.fresh)
            .and_then(|native| latest_agy_tokens(&store, &root.session, id, &native.thread));
        (session, project, trusted, external, prior_tokens)
    };
    if snapshot.project != project {
        return Err("Antigravity project binding changed after admission.".into());
    }
    // Keep untrusted project settings and instructions out of the native runtime.
    let cwd = if trusted {
        Path::new(&project.root)
    } else {
        Path::new("/")
    };
    let provenance = NativeProvenance {
        runner: RUNNER.into(),
        integration: QUALIFICATION.into(),
        executable: binding.executable.executable.clone(),
        storage: digest(format!("{}:{cwd:?}", binding.storage).as_bytes()),
        content: binding.role.clone(),
    };
    let resume = session.native.filter(|_| !root.fresh);
    if root.continuation.is_some() && resume.is_none() {
        return Err("Antigravity context for this task outcome is unavailable.".into());
    }
    if resume.as_ref().is_some_and(|context| {
        context.runner != Some(NativeRunner::Agy)
            || context.mode != Mode::SessionV1
            || context.provenance.as_ref() != Some(&provenance)
            || !valid_id(&context.thread, 200)
    }) {
        return Err("Antigravity context belongs to a different native profile. Choose Start new execution.".into());
    }

    let contract = snapshot.session_contract.as_ref().unwrap();
    let instructions = format!(
        "{}\n\nFor all turns, use the role IDs advertised by the current Deck MCP tool definition. The role list above reflects the assignments when this native session was created.",
        crate::claude::lead_instructions(contract)?,
    );
    let images = prompt_images(app, &root)?;
    let bridge = Bridge::start(app, id).await?;
    let sandbox = !(trusted && lead_yolo(&root));
    let auth = &bridge.config["http_headers"]["Authorization"];
    let bearer = auth
        .as_str()
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or("Antigravity MCP credential missing")?;
    let mcp = Mcp::new(&bridge.config, auth, &external, None)?;
    let tools = mcp.tools(&bridge);
    let mut client = Client::spawn(binary, cwd, sandbox)?;
    let mut thread = None;
    let run = async {
        let pid = client.pid();
        app.change(id, |receipt| receipt.native_pid = Some(pid))?;
        app.history
            .lock()
            .map_err(|_| "Original ownership unavailable")?
            .track_process(pid)?;
        let startup = open_session(
            &mut client,
            cwd,
            &mcp,
            resume.as_ref().map(|context| context.thread.as_str()),
            &instructions,
            &contract.members["lead"],
            &mut thread,
        );
        let supports_images = tokio::select! {
            biased;
            _ = cancel.wait_for(|stop| *stop) => return Ok(None),
            result = timeout(STARTUP_TIMEOUT, startup) => result.map_err(|_| Error::Timeout)??,
        };
        if !images.is_empty() && !supports_images {
            return Err("This Antigravity instance does not advertise image input.".into());
        }
        let turn = Turn {
            app,
            root: &root,
            project: &project,
            generation: uuid::Uuid::new_v4().to_string(),
            bearer,
            tools,
        };
        let session = thread.as_deref().ok_or(Error::Protocol)?;
        let Some(prompt) = turn.confirm_context(session, provenance, trusted)? else {
            return Ok(None);
        };
        if resume.is_some()
            && crate::runner_compaction::agy_should_compact(
                crate::runner_compaction::agy_enabled(),
                prior_tokens,
            )
        {
            if let Some(stopped) = turn.compact(&mut client, session, cancel).await? {
                return Ok(Some(stopped));
            }
        }
        let mut blocks = vec![json!({"type":"text","text":prompt})];
        blocks.extend(images);
        let request = client
            .request(
                "session/prompt",
                json!({"sessionId":session,"prompt":blocks}),
            )
            .await?;
        turn.stream(&mut client, session, request, cancel).await
    }
    .await;

    drop(bridge);
    if *cancel.borrow()
        && let Some(thread) = &thread
    {
        cancel_session(&mut client, thread).await;
    }
    let stopped = client.stop().await;
    let shutdown = app.shutdown_requested.load(Ordering::Acquire);
    app.change(id, |receipt| {
        approval::settle(receipt);
        let (phase, detail) = match (stopped, run) {
            (Err(detail), _) => (Phase::Uncertain, detail),
            (Ok(()), Ok(Some(reason))) if !*cancel.borrow() && reason == "end_turn" => {
                (Phase::Completed, "Antigravity finished.".into())
            }
            (Ok(()), Ok(Some(reason))) if !*cancel.borrow() && reason == "max_tokens" => (
                Phase::Completed,
                "Antigravity reached its output limit.".into(),
            ),
            (Ok(()), Ok(Some(reason))) if !shutdown && reason == "cancelled" => (
                Phase::Cancelled,
                "Antigravity acknowledged the interruption.".into(),
            ),
            (Ok(()), _) if *cancel.borrow() && !shutdown => {
                (Phase::Cancelled, "Antigravity stopped.".into())
            }
            (Ok(()), Err(detail)) if receipt.dispatch_ms.is_none() => (Phase::Failed, detail),
            (Ok(()), _) => (
                Phase::Failed,
                "Antigravity stopped without a confirmed result. The input will not replay.".into(),
            ),
        };
        receipt.phase = phase;
        receipt.detail = detail;
    })
}

fn latest_agy_tokens(store: &Store, session: &str, current_id: &str, thread: &str) -> Option<u64> {
    let receipts = store.all().ok()?;
    receipts
        .into_iter()
        .filter(|r| r.session == session && r.id != current_id)
        .filter_map(|r| {
            let obs = r.context.observation?;
            (obs.native_thread_id == thread && obs.basis == "agy-acp-usage")
                .then_some((obs.observed_ms, obs.tokens?))
        })
        .max_by_key(|(ms, _)| *ms)
        .map(|(_, tokens)| tokens)
}

impl Turn<'_> {
    async fn compact(
        &self,
        client: &mut Client,
        session: &str,
        cancel: &mut watch::Receiver<bool>,
    ) -> Result<Option<String>, String> {
        self.app.change(&self.root.id, |r| {
            r.context.compacting = Some("agy-auto-compact".into());
        })?;
        let request = client
            .request(
                "session/prompt",
                json!({"sessionId": session, "prompt": [{"type": "text", "text": "/compact"}]}),
            )
            .await?;
        let mut saw_usage = false;
        let outcome = loop {
            let message = tokio::select! {
                biased;
                _ = cancel.wait_for(|stop| *stop) => {
                    break Ok(Some("cancelled".to_owned()));
                }
                frame = client.read() => match frame {
                    Ok(message) => message,
                    Err(error) => break Err(error.into()),
                },
            };
            if message.get("id") == Some(&json!(request)) {
                if message.get("error").is_some() {
                    break Ok(None);
                }
                let reason = message["result"]["stopReason"]
                    .as_str()
                    .unwrap_or("end_turn");
                if reason == "cancelled" {
                    break Ok(Some("cancelled".to_owned()));
                }
                break Ok(None);
            }
            if message["method"] == "session/update"
                && message["params"]["sessionId"] == session
                && message["params"]["update"]["sessionUpdate"] == "usage_update"
            {
                saw_usage = true;
                self.app.change(&self.root.id, |r| {
                    crate::observations::observe_agy(
                        &mut r.context,
                        &message,
                        session,
                        &self.generation,
                        &r.attempt,
                        r.model.as_deref(),
                    );
                })?;
            }
        };
        let _ = self.app.change(&self.root.id, |r| {
            r.context.compacting = None;
            if !saw_usage {
                r.context.compacted = true;
            }
        });
        outcome
    }

    fn confirm_context(
        &self,
        thread: &str,
        provenance: NativeProvenance,
        trusted: bool,
    ) -> Result<Option<String>, String> {
        let mut store = self.app.store.lock().map_err(|_| "State lock failed")?;
        let mut receipt = store
            .get(&self.root.id)?
            .ok_or("Antigravity receipt missing")?;
        if receipt.phase != Phase::Accepted
            || receipt.cancel_requested
            || self.app.shutdown_requested.load(Ordering::Acquire)
        {
            return Ok(None);
        }
        if store.execution_project(&receipt.session)? != *self.project
            || store.trusted_project(&self.project.root)? != trusted
        {
            return Err(
                "Antigravity project trust or ownership changed. Submit a new message.".into(),
            );
        }
        let snapshot = receipt
            .configuration
            .as_ref()
            .ok_or("Antigravity admission missing")?;
        store.validate_snapshot(snapshot)?;
        let model = snapshot
            .runner
            .as_ref()
            .and_then(|runner| runner.model.clone());
        let prompt = store
            .outcome_prompt(&receipt)?
            .unwrap_or_else(|| receipt.prompt.clone());
        let mut session = store.session_by_id(&receipt.session)?;
        session.native = Some(NativeContext {
            runner: Some(NativeRunner::Agy),
            thread: thread.into(),
            mode: Mode::SessionV1,
            provenance: Some(provenance),
        });
        receipt.thread = Some(thread.into());
        receipt.turn = Some(self.generation.clone());
        receipt.generation.clone_from(&self.generation);
        receipt.phase = Phase::Running;
        receipt.dispatch_ms = Some(now());
        receipt.acknowledgment_ms = receipt.dispatch_ms;
        receipt.model = model;
        store
            .conn
            .execute_batch("SAVEPOINT agy_context")
            .map_err(|_| "Cannot begin Antigravity context update")?;
        if let Err(error) = store
            .save_session(&session)
            .and_then(|()| store.save(&mut receipt))
        {
            let _ = store
                .conn
                .execute_batch("ROLLBACK TO agy_context; RELEASE agy_context");
            return Err(error);
        }
        store
            .conn
            .execute_batch("RELEASE agy_context")
            .map_err(|_| "Cannot confirm Antigravity context")?;
        Ok(Some(prompt))
    }

    async fn stream(
        &self,
        client: &mut Client,
        session: &str,
        request: u64,
        cancel: &mut watch::Receiver<bool>,
    ) -> Result<Option<String>, String> {
        let mut ticker = tokio::time::interval(crate::claude::DELTA_BATCH_WINDOW);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut pending = HashMap::<String, (String, Value, Instant)>::new();
        // Tool-call ID of each pending review, so a reuse on a fresh wire can
        // invalidate the original request as well.
        let mut pending_items = HashMap::<String, String>::new();
        let mut request_ids = HashSet::new();
        let mut tool_call_ids = HashSet::new();
        let mut tools = HashMap::new();
        let mut batch = String::new();
        let mut new_segment = true;
        let mut bytes = 0;
        let result = async {
            loop {
                let message = tokio::select! {
                    biased;
                    _ = async { let _ = cancel.wait_for(|stop| *stop).await; } => return Ok(None),
                    _ = ticker.tick() => {
                        self.flush(&mut batch, &mut new_segment)?;
                        while !pending.is_empty() {
                            if *cancel.borrow() { return Ok(None); }
                            let Some((wire, allow)) = self.permission_reply(&pending)? else { break; };
                            let (id, options, _) = pending.remove(&wire).unwrap();
                            let result = approval::outcome(&options, allow);
                            let released = allow && result["outcome"]["outcome"] == "selected";
                            client.reply(json!(wire), result).await?;
                            self.app.change(&self.root.id, |receipt| approval::delivered(receipt, &id, released))?;
                        }
                        continue;
                    }
                    frame = client.read() => frame?,
                };
                let Some(method) = message["method"].as_str() else {
                    let result = response(&message, request)?;
                    let reason = result["stopReason"].as_str().ok_or("Missing Antigravity stop reason")?;
                    return Ok(Some(reason.to_owned()));
                };
                let params = &message["params"];
                if let Some(id) = message.get("id") {
                    let wire = id.as_str().filter(|wire| valid_id(wire, 128));
                    let fresh_wire = wire.filter(|wire| remember_permission_id(&mut request_ids, wire));
                    if fresh_wire.is_none()
                        && let Some((decision, _, _)) = wire.and_then(|wire| pending.remove(wire))
                    {
                        // The wire ID is now ambiguous. Never send a later allow on it.
                        self.app.change(&self.root.id, |receipt| {
                            approval::invalidate(receipt, &decision, "Antigravity reused a pending permission request ID.");
                        })?;
                    }
                    if method != approval::METHOD {
                        client.reject(id.clone()).await?;
                        continue;
                    }
                    self.flush(&mut batch, &mut new_segment)?;
                    new_segment = true;
                    let tool = &params["toolCall"];
                    let item = tool["toolCallId"].as_str().filter(|item| valid_id(item, 200));
                    let fresh_item = item.filter(|item| remember_permission_id(&mut tool_call_ids, item));
                    if fresh_item.is_none()
                        && let Some(original) = item.and_then(|item| pending_items.remove(item))
                        && let Some((decision, _, _)) = pending.remove(&original)
                    {
                        // The tool call is now ambiguous. Withdraw its review and
                        // answer the original request without selecting an option.
                        self.app.change(&self.root.id, |receipt| {
                            approval::invalidate(receipt, &decision, "Antigravity reused a pending tool call ID.");
                        })?;
                        client.reply(json!(original), approval::outcome(&Value::Null, false)).await?;
                    }
                    let permission = if params["sessionId"] != session || *cancel.borrow()
                        || !self.app.persistence_available() || self.app.shutdown_requested.load(Ordering::Acquire)
                    {
                        Permission::Deny
                    } else if let Some(ids) = fresh_wire.zip(fresh_item) {
                        approval::record(self.app, self.root, self.project, ids, tool, self.tools.identity(tool), Some(self.bearer))?
                    } else {
                        Permission::Deny
                    };
                    if let Permission::Review(decision) = permission {
                        let wire: String = id.as_str().unwrap().into();
                        if let Some(item) = fresh_item {
                            pending_items.insert(item.to_owned(), wire.clone());
                        }
                        pending.insert(wire, (decision, params["options"].clone(), Instant::now() + Duration::from_secs(15 * 60)));
                    } else {
                        let outcome = if fresh_wire.is_some() && fresh_item.is_some() {
                            approval::outcome(&params["options"], matches!(permission, Permission::Allow))
                        } else {
                            // A reused wire or tool-call ID may carry conflicting options. Cancel without selecting one.
                            approval::outcome(&Value::Null, false)
                        };
                        client.reply(id.clone(), outcome).await?;
                    }
                    continue;
                }
                if method != "session/update" || params["sessionId"] != session {
                    continue;
                }
                let update = &params["update"];
                match update["sessionUpdate"].as_str() {
                    Some("agent_message_chunk") if update["content"]["type"] == "text" => {
                        if let Some(delta) = update["content"]["text"].as_str() {
                            let remaining = MAX_TEXT.saturating_sub(bytes).min(delta.len());
                            let delta = &delta[..delta.floor_char_boundary(remaining)];
                            bytes += delta.len();
                            batch.push_str(delta);
                            if batch.len() >= crate::claude::DELTA_BATCH_BYTES {
                                self.flush(&mut batch, &mut new_segment)?;
                            }
                        }
                    }
                    Some("usage_update") => {
                        self.app.change(&self.root.id, |r| {
                            crate::observations::observe_agy(&mut r.context, &message, session, &self.generation, &r.attempt, r.model.as_deref());
                        })?;
                    }
                    Some("tool_call" | "tool_call_update") => {
                        self.flush(&mut batch, &mut new_segment)?;
                        new_segment = true;
                        if let Some(event) = activity(&mut tools, session, &self.generation, update) {
                            self.app.record_activity(&self.root.id, "", &self.root.attempt, session, &self.generation, &event);
                        }
                    }
                    _ => {}
                }
            }
        }.await;
        self.flush(&mut batch, &mut new_segment)?;
        if matches!(
            result.as_ref(),
            Ok(Some(reason)) if matches!(reason.as_str(), "end_turn" | "max_tokens")
        ) {
            self.app.change(&self.root.id, |receipt| {
                if receipt.message_times.iter().all(|m| m.kind.is_some())
                    && let Some(last) = receipt.message_times.last_mut()
                {
                    last.kind = Some(deck2_shared::MessageKind::Answer);
                }
            })?;
        }
        result
    }

    fn flush(&self, batch: &mut String, new_segment: &mut bool) -> Result<(), String> {
        if !batch.is_empty() {
            self.app
                .append_claude_delta(&self.root.id, batch, None, *new_segment)?;
            *new_segment = false;
            batch.clear();
        }
        Ok(())
    }

    fn permission_reply(
        &self,
        pending: &HashMap<String, (String, Value, Instant)>,
    ) -> Result<Option<(String, bool)>, String> {
        let mut store = self.app.store.lock().map_err(|_| "State lock failed")?;
        let mut receipt = store
            .get(&self.root.id)?
            .ok_or("Antigravity receipt missing")?;
        for (wire, (decision, _, deadline)) in pending {
            if Instant::now() >= *deadline {
                return Err("Antigravity permission request timed out.".into());
            }
            if let Some(allow) = approval::claim(&mut store, &mut receipt, self.project, decision)?
            {
                return Ok(Some((wire.clone(), allow)));
            }
        }
        Ok(None)
    }
}

fn activity(
    tools: &mut HashMap<String, String>,
    session: &str,
    turn: &str,
    update: &Value,
) -> Option<Value> {
    let id = update["toolCallId"]
        .as_str()
        .filter(|id| valid_id(id, 200))?;
    let status = match update["status"].as_str() {
        Some("completed") => "completed",
        Some("failed") => "failed",
        _ => "running",
    };
    let (method, name) = if update["sessionUpdate"] == "tool_call" {
        let name: String = update["name"]
            .as_str()
            .unwrap_or("Antigravity tool")
            .chars()
            .take(128)
            .collect();
        if status == "running" && tools.len() < 128 {
            tools.insert(id.into(), name.clone());
        }
        (
            if status == "running" {
                "item/started"
            } else {
                "item/completed"
            },
            name,
        )
    } else if status != "running" {
        (
            "item/completed",
            tools
                .remove(id)
                .unwrap_or_else(|| "Antigravity tool".into()),
        )
    } else {
        return None;
    };
    Some(json!({
        "method":method, "params":{"threadId":session,"turnId":turn,
        "item":{"id":id,"type":"dynamicToolCall","tool":name,"status":status}}
    }))
}

#[cfg(test)]
#[path = "agy_tests.rs"]
mod tests;
