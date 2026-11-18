//! Scoped Investigator execution via OpenCode MCP or Codex dynamic tools.
use crate::{
    server::App,
    tasks::{INVESTIGATOR, digest, validate_relative},
};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
};
use deck2_shared::{NativeProvenance, Phase};
use serde_json::{Value, json};
use std::{
    os::fd::{AsRawFd, FromRawFd},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
};

pub struct Runner {
    child: Mutex<Option<Child>>,
    claimed: std::sync::atomic::AtomicBool,
    binary: PathBuf,
    state: PathBuf,
    mcp: tokio::task::JoinHandle<()>,
    client: reqwest::Client,
    url: String,
    password: String,
    scope: Arc<ReadScope>,
    pub model: String,
    pub provenance: NativeProvenance,
    pub preparation_ms: u64,
    pub tool_connection_ms: u64,
}
impl Drop for Runner {
    fn drop(&mut self) {
        self.scope
            .enabled
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.scope.helpers.cancel();
        self.mcp.abort();
        if let Ok(c) = self.child.lock()
            && let Some(pid) = c.as_ref().and_then(|c| c.id())
        {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
    }
}
struct ReadOwner {
    app: std::sync::Weak<crate::server::Inner>,
    task: String,
    attempt: String,
}
struct ReadScope {
    tools: Value,
    helper: Option<deck2_shared::HelperSelection>,
    helpers: Arc<crate::rtk::Helpers>,
    project: PathBuf,
    token: String,
    paths: Mutex<Vec<String>>,
    enabled: std::sync::atomic::AtomicBool,
    owner: Mutex<Option<ReadOwner>>,
    calls: std::sync::atomic::AtomicU32,
}

// Anchor each component to an open directory descriptor. Reject symlinks even
// under concurrent renames; never canonicalize then reopen a model-supplied path.
pub fn scoped_read(project: &Path, scope: &[String], path: &str) -> Result<String, String> {
    scoped_target(project, scope, path, true)
}
pub fn scoped_source(project: &Path, scope: &[String], path: &str) -> Result<String, String> {
    scoped_target(project, scope, path, false)
}
pub fn scoped_file(project: &Path, scope: &[String], path: &str) -> Result<String, String> {
    if Path::new(path).extension().and_then(|s| s.to_str()) != Some("rs") {
        return Err("Compact snapshots require ordinary UTF-8 .rs files".into());
    }
    scoped_target(project, scope, path, false)
}
fn scoped_target(
    project: &Path,
    scope: &[String],
    path: &str,
    directories: bool,
) -> Result<String, String> {
    use std::io::Read;
    validate_relative(path)?;
    if !scope.iter().any(|s| Path::new(path).starts_with(s)) {
        return Err("Path outside assigned scope".into());
    }
    use std::os::unix::fs::OpenOptionsExt;
    let root = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY | libc::O_CLOEXEC)
        .open(project)
        .map_err(|_| "Project unavailable or root symlink; read denied")?;
    let mut file = root;
    let parts: Vec<_> = Path::new(path).components().collect();
    for (i, p) in parts.iter().enumerate() {
        let name =
            std::ffi::CString::new(p.as_os_str().as_encoded_bytes()).map_err(|_| "Invalid path")?;
        let flags = libc::O_RDONLY
            | libc::O_CLOEXEC
            | libc::O_NOFOLLOW
            | libc::O_NONBLOCK
            | if i + 1 < parts.len() {
                libc::O_DIRECTORY
            } else {
                0
            };
        let fd = unsafe { libc::openat(file.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err("Path inaccessible or symlink; read denied".into());
        }
        file = unsafe { std::fs::File::from_raw_fd(fd) };
    }
    let meta = file.metadata().map_err(|_| "Cannot inspect target")?;
    if meta.is_dir() {
        if !directories {
            return Err("Directory is not a source snapshot".into());
        }
        let mut names = Vec::new();
        for item in std::fs::read_dir(format!("/proc/self/fd/{}", file.as_raw_fd()))
            .map_err(|_| "Cannot list directory")?
            .take(201)
        {
            let item = item.map_err(|_| "Cannot list entry")?;
            if item
                .file_type()
                .map_err(|_| "Cannot inspect entry")?
                .is_symlink()
            {
                continue;
            }
            names.push(item.file_name().to_string_lossy().into_owned());
        }
        names.sort();
        return Ok(json!({"entries":names,"limit":200}).to_string());
    }
    if !meta.is_file() || meta.len() > 65536 {
        return Err("Only ordinary UTF-8 files up to 64 KiB may be read".into());
    }
    let mut text = String::new();
    file.take(65537)
        .read_to_string(&mut text)
        .map_err(|_| "Not a readable UTF-8 file")?;
    if text.len() > 65536 {
        return Err("File grew beyond read limit".into());
    }
    Ok(text)
}
async fn mcp(
    State(s): State<Arc<ReadScope>>,
    headers: HeaderMap,
    Json(v): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if headers.get("authorization").and_then(|h| h.to_str().ok())
        != Some(&format!("Bearer {}", s.token))
    {
        return (StatusCode::UNAUTHORIZED, Json(json!({})));
    }
    let id = v.get("id").cloned().unwrap_or(Value::Null);
    if id.is_null() {
        return (StatusCode::ACCEPTED, Json(json!({})));
    }
    if v["method"] == "tools/call" && !s.enabled.load(std::sync::atomic::Ordering::SeqCst) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Attempt read authority is inactive"})),
        );
    }
    if v["method"] == "tools/call" {
        // Admission check only: durable revocation denies new calls. IO already
        // admitted below may finish; immediate in-flight revocation is unqualified.
        let owner = s.owner.lock().unwrap();
        let live = owner
            .as_ref()
            .and_then(|o| o.app.upgrade().map(|app| (App::from_inner(app), o)))
            .is_some_and(|(app, o)| {
                if !app.persistence_available()
                    || app
                        .shutdown_requested
                        .load(std::sync::atomic::Ordering::SeqCst)
                {
                    return false;
                }
                let store = app.store.lock().unwrap();
                store.task(&o.task).ok().is_some_and(|t| {
                    store.execution_project(&t.session).is_ok_and(|p|Path::new(&p.root)==s.project.as_path()) && t.attempts
                        .iter()
                        .any(|a| a.id == o.attempt && a.phase.active() && !a.cancel_requested)
                        && store
                            .get(&t.root)
                            .ok()
                            .flatten()
                            .is_some_and(|r| r.phase == Phase::Running && !r.cancel_requested)
                })
            });
        if s.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) >= 32 {
            return (
                StatusCode::FORBIDDEN,
                Json(
                    json!({"error":"32-call read budget exhausted; report evidence and limitations without more tools"}),
                ),
            );
        }
        if !live {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error":"Task/root authority is no longer live"})),
            );
        }
    }
    if v["method"] == "tools/call"
        && !s
            .tools
            .as_array()
            .is_some_and(|tools| tools.iter().any(|t| t["name"] == v["params"]["name"]))
    {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Tool was not admitted"})),
        );
    }
    let result = match v["method"].as_str().unwrap_or("") {
        "initialize" => {
            json!({"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"deck-project-reads","version":"1"}})
        }
        "tools/list" => {
            json!({"tools":s.tools})
        }
        "tools/call" => {
            let args = &v["params"]["arguments"];
            let path = args["path"].as_str().unwrap_or("");
            let name = v["params"]["name"].as_str().unwrap_or("");
            if matches!(name, "graph_search" | "graph_trace" | "graph_coverage") {
                let result = graph_call(&s, &id, args, name).await;
                let body = match result {
                    Ok(text) => json!({"content":[{"type":"text","text":text}],"isError":false}),
                    Err(e) => {
                        json!({"content":[{"type":"text","text":format!("{e}. Use admitted exact scoped read/search fallback; no graph completeness claim.")}],"isError":true})
                    }
                };
                return (
                    StatusCode::OK,
                    Json(json!({"jsonrpc":"2.0","id":id,"result":body})),
                );
            }
            if matches!(name, "compact_read" | "read_snapshot") {
                let result = snapshot_call(&s, &id, args, name).await;
                let body = match result {
                    Ok(text) => json!({"content":[{"type":"text","text":text}],"isError":false}),
                    Err(e) => json!({"content":[{"type":"text","text":e}],"isError":true}),
                };
                return (
                    StatusCode::OK,
                    Json(json!({"jsonrpc":"2.0","id":id,"result":body})),
                );
            }
            let read = if matches!(name, "read" | "search") {
                scoped_read(&s.project, &s.paths.lock().unwrap(), path)
            } else {
                Err("Unknown tool denied".into())
            };
            match read {
                Ok(text) => {
                    let text = if name == "search" {
                        let q = args["query"].as_str().unwrap_or("");
                        if q.is_empty() || q.len() > 256 {
                            return (
                                StatusCode::OK,
                                Json(
                                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32602,"message":"Bounded literal query required"}}),
                                ),
                            );
                        }
                        text.lines()
                            .enumerate()
                            .filter(|(_, l)| l.contains(q))
                            .take(100)
                            .map(|(i, l)| format!("{}: {l}", i + 1))
                            .collect::<Vec<_>>()
                            .join("\n")
                    } else {
                        text
                    };
                    if let Err(reason) = record_graph_read(&s, &id, name, path, &text) {
                        return (
                            StatusCode::OK,
                            Json(
                                json!({"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":reason}],"isError":true}}),
                            ),
                        );
                    }
                    json!({"content":[{"type":"text","text":text}],"isError":false})
                }
                Err(e) => {
                    json!({"content":[{"type":"text","text":format!("{e}. This is a fixed read boundary: do not guess alternate prefixes or paths; report the limitation.")}],"isError":true})
                }
            }
        }
        _ => {
            return (
                StatusCode::OK,
                Json(
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method unavailable"}}),
                ),
            );
        }
    };
    (
        StatusCode::OK,
        Json(json!({"jsonrpc":"2.0","id":id,"result":result})),
    )
}
// Persist actual exact-read use when graph evidence is selected. Source bytes stay
// in the scoped response, while the audit record contains only path and digest.
fn record_graph_read(
    s: &ReadScope,
    id: &Value,
    name: &str,
    path: &str,
    text: &str,
) -> Result<(), String> {
    let owner = s.owner.lock().unwrap();
    let o = owner.as_ref().ok_or("Read owner unavailable")?;
    let app = App::from_inner(o.app.upgrade().ok_or("Read host unavailable")?);
    let store = app.store.lock().unwrap();
    let task = store.task(&o.task)?;
    let root = store.get(&task.root)?.ok_or("Read root unavailable")?;
    if root.configuration.and_then(|c| c.cbm).is_none() {
        return Ok(());
    }
    let fallback: bool = store.conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM cbm_queries WHERE task=?1 AND attempt=?2 AND json_extract(body,'$.phase')='unavailable')",
        rusqlite::params![o.task,o.attempt], |r|r.get(0),
    ).map_err(|_|"Cannot inspect graph fallback evidence")?;
    store.record_graph_query(
        &o.task,
        &o.attempt,
        &id.to_string(),
        &json!({"phase":"accepted","tool":name,"path":path}),
    )?;
    store.record_graph_query(&o.task,&o.attempt,&id.to_string(),&json!({"phase":"completed","tool":name,"path":path,"source_digest":digest(text.as_bytes()),"graph_fallback_used":fallback}))
}
async fn graph_call(s: &ReadScope, id: &Value, args: &Value, name: &str) -> Result<String, String> {
    let (app, task, attempt) = {
        let owner = s.owner.lock().unwrap();
        let o = owner.as_ref().ok_or("Graph attempt missing")?;
        (
            App::from_inner(o.app.upgrade().ok_or("Graph host unavailable")?),
            o.task.clone(),
            o.attempt.clone(),
        )
    };
    if !read_live(s) {
        return Err("Graph authority revoked".into());
    }
    let (binding, root, host) = {
        let store = app.store.lock().unwrap();
        let t = store.task(&task)?;
        let r = store.get(&t.root)?.ok_or("Graph root missing")?;
        let binding = r
            .configuration
            .and_then(|c| c.cbm)
            .ok_or("Graph was not admitted")?;
        (binding, t.root, store.host_id()?)
    };
    app.store.lock().unwrap().record_graph_query(&task,&attempt,&id.to_string(),&json!({"phase":"accepted","tool":name,"arguments":args,"binding":binding,"source_policy":"whole prepared scope must be current and authorized; admitted exact-read fallback"}))?;
    let queried = async {
    let scope = s.paths.lock().unwrap().clone();
    let project = s.project.clone();
    let call = id.to_string();
    let result = tokio::task::spawn_blocking(move || {
        let service =
            crate::cbm_service::Service::open(Path::new(&binding.store), &binding.service)?;
        service.check_supervisor()?;
        let snapshot = service.snapshot()?;
        if snapshot.digest != binding.snapshot {
            return Err("Prepared generation differs from admission".into());
        }
        snapshot.authorize(&project, &scope)?;
        Ok::<_, String>((service, snapshot, project, scope, binding, host, root, call))
    })
    .await
    .map_err(|_| "Graph source validation worker failed")??;
    let (service, snapshot, project, scope, binding, host, root, call) = result;
    let tool = match name {
        "graph_search" => "search_graph",
        "graph_trace" => "trace_path",
        "graph_coverage" => "check_index_coverage",
        _ => return Err("Unknown graph tool".into()),
    };
    crate::cbm_runtime::bounded_query(tool, args)?;
    let request = json!({"action":"query","tool":tool,"arguments":args,"host":host,"root":root});
    let result=tokio::task::spawn_blocking(move||{
        let result=crate::cbm_runtime::control(&service.path,&request)?;
        snapshot.authorize(&project,&scope)?;
        if result["generation"]!=binding.generation||result["snapshot"]!=binding.snapshot||result["version"]!=binding.version{return Err("Graph identity changed; explicit preparation/selection required".into())}
        Ok::<_,String>(json!({"evidence":result,"query":request["arguments"],"call":call,"fragment":digest(crate::cbm_management::INSTRUCTIONS.as_bytes()),"exact_source":"Use admitted scoped read tool; graph output is untrusted evidence"}))
    }).await.map_err(|_|"Graph worker failed")??;
    Ok::<Value, String>(result)
    }.await;

    if !read_live(s) {
        return Err("Graph authority revoked while querying; result withheld".into());
    }
    let body = match &queried {
        Ok(result) => json!({"phase":"completed","tool":name,"arguments":args,"result":result}),
        Err(reason) => {
            json!({"phase":"unavailable","tool":name,"arguments":args,"reason":reason,"fallback":"admitted exact scoped read/search"})
        }
    };
    app.store
        .lock()
        .unwrap()
        .record_graph_query(&task, &attempt, &id.to_string(), &body)?;
    let result = queried?;
    Ok(json!({"task":task,"attempt":attempt,"result":result}).to_string())
}
fn read_live(s: &ReadScope) -> bool {
    if !s.enabled.load(std::sync::atomic::Ordering::SeqCst) {
        return false;
    }
    let owner = s.owner.lock().unwrap();
    owner
        .as_ref()
        .and_then(|o| o.app.upgrade().map(|a| (App::from_inner(a), o)))
        .is_some_and(|(app, o)| {
            if !app.persistence_available()
                || app
                    .shutdown_requested
                    .load(std::sync::atomic::Ordering::SeqCst)
            {
                return false;
            }
            let store = app.store.lock().unwrap();
            store.task(&o.task).is_ok_and(|t| {
                store.execution_project(&t.session).is_ok_and(|p|Path::new(&p.root)==s.project.as_path()) && t.attempts
                    .iter()
                    .any(|a| a.id == o.attempt && a.phase.active() && !a.cancel_requested)
                    && store
                        .get(&t.root)
                        .ok()
                        .flatten()
                        .is_some_and(|r| r.phase == Phase::Running && !r.cancel_requested)
            })
        })
}
async fn snapshot_call(
    s: &ReadScope,
    id: &Value,
    args: &Value,
    name: &str,
) -> Result<String, String> {
    let helper = s.helper.clone().ok_or("Snapshot tool was not admitted")?;
    if !read_live(s) {
        return Err("Attempt/root authority inactive".into());
    }
    let (app, task, attempt) = {
        let owner = s.owner.lock().unwrap();
        let o = owner.as_ref().ok_or("Attempt unavailable")?;
        (
            App::from_inner(o.app.upgrade().ok_or("Host unavailable")?),
            o.task.clone(),
            o.attempt.clone(),
        )
    };
    if name == "read_snapshot" {
        let snap = app
            .store
            .lock()
            .unwrap()
            .read_snapshot(args["snapshot_id"].as_str().unwrap_or(""), Some(&attempt))?;
        app.store
            .lock()
            .unwrap()
            .snapshot_access(&snap.id, &attempt, &id.to_string())?;
        return serde_json::to_string(&snap).map_err(|_| "Cannot encode snapshot".into());
    }
    let path = args["path"].as_str().ok_or("Source path required")?;
    let text = scoped_file(&s.project, &s.paths.lock().unwrap(), path)?;
    if !read_live(s) {
        return Err("Snapshot capture cancelled".into());
    }
    let snap = {
        let store = app.store.lock().unwrap();
        let t = store.task(&task)?;
        store.capture_snapshot(
            &t.root,
            &task,
            &attempt,
            &id.to_string(),
            path,
            text,
            helper,
        )?
    };
    let artifacts = match app.artifact_root() {
        Ok(root) => {
            tokio::task::spawn_blocking(move || crate::managed_tools::Artifacts::open(&root))
                .await
                .map_err(|_| "Helper store inspection interrupted")?
        }
        Err(e) => Err(e),
    };
    let view = crate::rtk::compact(snap, artifacts, s.helpers.clone(), || read_live(s)).await?;
    app.store.lock().unwrap().snapshot_view(&view)?;
    serde_json::to_string(&crate::rtk::delivery(&view))
        .map_err(|_| "Cannot encode snapshot view".into())
}
fn codex_tools(tools: &Value) -> Result<Value, String> {
    let tools = tools.as_array().ok_or("Invalid admitted tools")?;
    if tools.len() > 8 {
        return Err("Too many admitted tools".into());
    }
    tools.iter().map(|t| {
        let name=t["name"].as_str().ok_or("Tool name missing")?;
        if !["read","search","compact_read","read_snapshot","graph_search","graph_trace","graph_coverage"].contains(&name) {return Err("Unqualified Codex tool".into());}
        Ok(json!({"type":"function","name":name,"description":t["description"],"inputSchema":t["inputSchema"]}))
    }).collect::<Result<Vec<_>,String>>().map(Value::Array)
}
impl Runner {
    pub async fn prepare(
        binary: &Path,
        model: &str,
        state: &Path,
        project: &Path,
    ) -> Result<Arc<Self>, String> {
        Self::prepare_selected(binary, model, state, project, read_tools(), None).await
    }
    async fn prepare_selected(
        binary: &Path,
        model: &str,
        state: &Path,
        project: &Path,
        tools: Value,
        helper: Option<deck2_shared::HelperSelection>,
    ) -> Result<Arc<Self>, String> {
        let start = std::time::Instant::now();
        if model == "gpt-6.1-sol" {
            return Self::prepare_codex(binary, state, project, tools, helper).await;
        }
        if model != "minimax-coding-plan/MiniMax-M2.7" {
            return Err("S4 currently qualifies only minimax-coding-plan/MiniMax-M2.7; select it explicitly with --investigator-model".into());
        }
        let binary = std::fs::canonicalize(binary)
            .map_err(|_| "OpenCode executable unavailable; provide --opencode absolute path")?;
        let metadata =
            std::fs::metadata(&binary).map_err(|_| "Cannot inspect native executable")?;
        if !metadata.is_file() || metadata.len() > 512 * 1024 * 1024 {
            return Err("Invalid native executable".into());
        }
        let bytes = std::fs::read(&binary).map_err(|_| "Cannot inspect OpenCode executable")?;
        if digest(&bytes) != "541bb0aa88d0b317967efbc947aa54506606c257d3b6ed1dee644756879fb4be" {
            return Err("OpenCode executable is not the qualified 1.19.1 artifact; team unavailable until requalified".into());
        }
        if Path::new("/etc/opencode").exists() {
            return Err(
                "Managed OpenCode configuration requires separate qualification; team unavailable"
                    .into(),
            );
        }
        let home = std::env::var_os("HOME").ok_or("Native home unavailable")?;
        let data = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(&home).join(".local/share"));
        let auth: Value =
            serde_json::from_slice(&std::fs::read(data.join("opencode/auth.json")).map_err(
                |_| "OpenCode native authentication missing; authenticate in its own CLI",
            )?)
            .map_err(|_| "Native authentication cannot be inspected safely")?;
        if auth
            .as_object()
            .is_none_or(|v| v.values().any(|x| x["type"] == "wellknown"))
        {
            return Err("Well-known/unknown native authentication configuration requires separate qualification".into());
        }
        let provider = model.split_once('/').unwrap().0;
        if auth[provider].is_null() {
            return Err(
                "Selected OpenCode provider lacks native authentication; no fallback selected"
                    .into(),
            );
        }
        drop(auth);
        let owned = state.join(format!("opencode-{}", uuid::Uuid::new_v4()));
        for p in ["home", "config", "cache", "state", "tmp", "npm", "work"] {
            std::fs::create_dir_all(owned.join(p))
                .map_err(|_| "Cannot prepare isolated runner resources")?;
        }
        let scope = Arc::new(ReadScope {
            tools,
            helper,
            helpers: Arc::new(crate::rtk::Helpers::default()),
            project: project.into(),
            token: crate::server::secret(),
            paths: Mutex::new(vec![]),
            enabled: std::sync::atomic::AtomicBool::new(false),
            calls: std::sync::atomic::AtomicU32::new(0),
            owner: Mutex::new(None),
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "Cannot bind scoped read endpoint")?;
        let endpoint = format!(
            "http://{}/mcp",
            listener
                .local_addr()
                .map_err(|_| "Cannot inspect read endpoint")?
        );
        let router = Router::new()
            .route("/mcp", post(mcp))
            .layer(axum::extract::DefaultBodyLimit::max(16384))
            .with_state(scope.clone());
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        let config = json!({"plugin":[],"mcp":{"deck_project":{"type":"remote","url":endpoint,"headers":{"Authorization":format!("Bearer {}",scope.token)}}},"permission":{"*":"deny","deck_project_*":"allow"},"agent":{"investigator":{"mode":"primary","steps":12,"prompt":INVESTIGATOR,"permission":{"*":"deny","deck_project_*":"allow"}}}});
        let mut cmd = Command::new(&binary);
        cmd.args([
            "serve",
            "--pure",
            "--print-logs",
            "--log-level",
            "ERROR",
            "--hostname",
            "127.0.0.1",
            "--port",
            "0",
        ])
        .current_dir(owned.join("work"))
        .env_clear();
        for (k, v) in [
            ("PATH", PathBuf::from("/usr/bin:/bin")),
            ("HOME", PathBuf::from(home)),
            ("XDG_DATA_HOME", data.clone()),
            ("OPENCODE_TEST_HOME", owned.join("home")),
            ("XDG_CONFIG_HOME", owned.join("config")),
            ("XDG_CACHE_HOME", owned.join("cache")),
            ("XDG_STATE_HOME", owned.join("state")),
            ("TMPDIR", owned.join("tmp")),
            ("OPENCODE_DB", owned.join("opencode.db")),
            ("NPM_CONFIG_USERCONFIG", owned.join("npm/userrc")),
            ("NPM_CONFIG_GLOBALCONFIG", owned.join("npm/globalrc")),
            ("NPM_CONFIG_CACHE", owned.join("npm/cache")),
        ] {
            cmd.env(k, v);
        }
        let password = crate::server::secret();
        for (k, v) in [
            ("OPENCODE_SERVER_PASSWORD", password.as_str()),
            ("OPENCODE_DISABLE_PROJECT_CONFIG", "true"),
            ("OPENCODE_DISABLE_EXTERNAL_SKILLS", "true"),
            ("OPENCODE_DISABLE_MODELS_FETCH", "true"),
            ("OPENCODE_DISABLE_AUTOUPDATE", "true"),
        ] {
            cmd.env(k, v);
        }
        cmd.env("OPENCODE_CONFIG_CONTENT", config.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let native_log = data.join("opencode/log");
        // Allocate path strings before fork. The pre-exec hook uses syscalls only.
        let guard_paths = [
            std::ffi::CString::new(owned.as_os_str().as_encoded_bytes())
                .map_err(|_| "Invalid owned guard path")?,
            std::ffi::CString::new(native_log.as_os_str().as_encoded_bytes())
                .map_err(|_| "Invalid native log path")?,
        ];
        unsafe {
            cmd.pre_exec(move || {
                libc::setpgid(0, 0);
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                restrict_writes(&guard_paths)
            });
        }
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(_) => {
                handle.abort();
                return Err("Guarded OpenCode startup unavailable".into());
            }
        };
        let result=async{
            let mut reader=BufReader::new(child.stdout.take().ok_or("Native stdout unavailable")?);
            let mut line=String::new();let mut total=0;
            let url=tokio::time::timeout(Duration::from_secs(15),async{loop{line.clear();if reader.read_line(&mut line).await.map_err(|_|"OpenCode startup transport failed")?==0{return Err("OpenCode exited during guarded preparation; inspect native CLI authentication/log permissions".to_string())}total+=line.len();if total>65536{return Err("OpenCode startup output exceeded bound".into())}
 if let Some((_,rest))=line.split_once("http://127.0.0.1:"){let port: u16=rest.trim().parse().map_err(|_|"Invalid native endpoint")?;return Ok(format!("http://127.0.0.1:{port}"))}}}).await.map_err(|_|"OpenCode startup timed out")??;
            // Drain startup stdout to prevent a pipe becoming an accidental lifecycle lock.
            tokio::spawn(async move{use tokio::io::AsyncReadExt;let mut bytes=[0u8;4096];while reader.read(&mut bytes).await.is_ok_and(|n|n>0){}});
            let client=reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|"Cannot prepare native HTTP")?;
            let health:Value=client.get(format!("{url}/global/health")).basic_auth("opencode",Some(&password)).send().await.map_err(|_|"Native health unavailable")?.json().await.map_err(|_|"Invalid native health")?;
            if health["version"]!="1.19.1"||health["healthy"]!=true{return Err("OpenCode must be exactly 1.19.1 and healthy".into())}
            Ok((client,url))
        }.await;
        let (client, url) = match result {
            Ok(v) => v,
            Err(e) => {
                handle.abort();
                if let Some(pid) = child.id() {
                    unsafe {
                        libc::kill(-(pid as i32), libc::SIGKILL);
                    }
                }
                let _ = child.wait().await;
                return Err(e);
            }
        };
        let mut r = Arc::new(Self {
            child: Mutex::new(Some(child)),
            claimed: std::sync::atomic::AtomicBool::new(false),
            binary: binary.clone(),
            state: state.into(),
            mcp: handle,
            client,
            url,
            password,
            scope,
            model: model.into(),
            provenance: NativeProvenance {
                runner: "opencode 1.19.1".into(),
                integration: "http-sse/scoped-mcp-v1".into(),
                executable: digest(&bytes),
                storage: owned.display().to_string(),
                content: digest(INVESTIGATOR.as_bytes()),
            },
            preparation_ms: start.elapsed().as_millis() as u64,
            tool_connection_ms: 0,
        });
        let effective = r.request("GET", "/config", None).await?;
        if effective["plugin"] != json!([])
            || effective["mcp"]
                .as_object()
                .is_none_or(|v| v.len() != 1 || !v.contains_key("deck_project"))
        {
            return Err("Unexpected native plugin/MCP inventory; dispatch blocked".into());
        }
        if effective["agent"]["investigator"]["steps"] != 12
            || effective["agent"]["investigator"]["prompt"] != INVESTIGATOR
            || effective["permission"] != json!({"*":"deny","deck_project_*":"allow"})
        {
            return Err(
                "Investigator policy was not acknowledged exactly; dispatch blocked".into(),
            );
        }
        let inventory = r.request("GET", "/mcp", None).await?;
        if inventory["deck_project"]["status"] != "connected" {
            return Err("Scoped project read tool failed to connect; team unavailable".into());
        }
        let connected_ms = start.elapsed().as_millis() as u64;
        let providers = r.request("GET", "/provider", None).await?;
        let (provider, model) = model.split_once('/').unwrap();
        if providers["connected"]
            .as_array()
            .is_none_or(|a| !a.contains(&json!(provider)))
            || providers["all"].as_array().is_none_or(|a| {
                !a.iter()
                    .any(|p| p["id"] == provider && !p["models"][model].is_null())
            })
        {
            return Err("Explicit investigator model unavailable; select an existing authenticated provider/model. No fallback.".into());
        }
        let completed = Arc::get_mut(&mut r).ok_or("Native preparation ownership conflict")?;
        completed.preparation_ms = start.elapsed().as_millis() as u64;
        completed.tool_connection_ms = connected_ms;
        Ok(r)
    }
    async fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let mut req = self
            .client
            .request(
                method.parse().map_err(|_| "Invalid method")?,
                format!("{}{path}", self.url),
            )
            .basic_auth("opencode", Some(&self.password));
        if let Some(v) = body {
            req = req.json(&v)
        }
        let mut response = req
            .send()
            .await
            .map_err(|_| "OpenCode connection lost; delivery may be uncertain")?;
        if !response.status().is_success() {
            return Err(format!(
                "OpenCode HTTP {}. Inspect native authentication; no fallback/replay.",
                response.status().as_u16()
            ));
        }
        if response.status() == reqwest::StatusCode::NO_CONTENT {
            return Ok(Value::Null);
        }
        let limit = if path == "/provider" {
            32 * 1024 * 1024
        } else {
            4 * 1024 * 1024
        };
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "Native response lost")? {
            if bytes.len() + chunk.len() > limit {
                return Err("Native response exceeded bound".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| "Malformed native response".into())
    }
    pub async fn run(self: Arc<Self>, app: App, task: String, attempt: String) {
        // Each native process/MCP connection is consumed by exactly one attempt.
        // A completed attempt can never acquire a later attempt's read scope.
        let selection = (|| {
            let store = app.store.lock().unwrap();
            let t = store.task(&task)?;
            let root = store.get(&t.root)?.ok_or("Root unavailable")?;
            let snap = root.configuration.ok_or("Admission missing")?;
            Ok::<_, String>((store.execution_tools(&snap)?, snap.helper))
        })();
        let execution = match selection {
            Err(e) => Err(e),
            Ok((tools, helper)) => {
                let first = !self.claimed.swap(true, std::sync::atomic::Ordering::SeqCst);
                if first && tools == self.scope.tools && helper == self.scope.helper {
                    Ok(self.clone())
                } else {
                    if first && let Err(e) = self.stop().await {
                        finish_run(&app, &task, &attempt, Err(e.clone()), Err(e));
                        app.clear_active(&format!("child:{attempt}"));
                        return;
                    }
                    Self::prepare_selected(
                        &self.binary,
                        &self.model,
                        &self.state,
                        &self.scope.project,
                        tools,
                        helper,
                    )
                    .await
                }
            }
        };
        match execution {
            Ok(r) => {
                r.claimed.store(true, std::sync::atomic::Ordering::SeqCst);
                let result = if r.provenance.runner == "codex 0.166.0" {
                    r.run_codex(&app, &task, &attempt).await
                } else {
                    r.run_inner(&app, &task, &attempt).await
                };
                let cleanup = r.stop().await;
                let cleanup = if result
                    .as_ref()
                    .is_err_and(|e| e == "Codex Investigator cleanup uncertain")
                {
                    Err("Codex Investigator cleanup uncertain".into())
                } else {
                    cleanup
                };
                finish_run(&app, &task, &attempt, result, cleanup);
            }
            Err(e) => {
                let cleanup = if e == "Codex Investigator cleanup uncertain" {
                    Err(e.clone())
                } else {
                    Ok(())
                };
                finish_run(&app, &task, &attempt, Err(e), cleanup);
            }
        }

        app.clear_active(&format!("child:{attempt}"));
    }
    pub fn matches_project(&self,project:&str)->bool {self.scope.project==Path::new(project)}
    pub fn matches_selection(
        &self,
        tools: &Value,
        helper: Option<&deck2_shared::HelperSelection>,
    ) -> bool {
        &self.scope.tools == tools && self.scope.helper.as_ref() == helper
    }
    pub async fn prepare_codex(
        binary: &Path,
        state: &Path,
        project: &Path,
        tools: Value,
        helper: Option<deck2_shared::HelperSelection>,
    ) -> Result<Arc<Self>, String> {
        let start = std::time::Instant::now();
        crate::native::version(binary).await.map_err(|e| {
            if e.contains("reap")
                || e.contains("descendants")
                || e.contains("uncertain probe cleanup")
            {
                format!("Codex Investigator cleanup uncertain: {e}")
            } else {
                e
            }
        })?;
        let binary = std::fs::canonicalize(binary)
            .map_err(|_| "Codex Investigator executable unavailable")?;
        let executable =
            digest(&std::fs::read(&binary).map_err(|_| "Cannot inspect Codex Investigator")?);
        let dynamic = codex_tools(&tools)?;
        let mut native = crate::native::Native::start_scoped(&binary, Some(dynamic)).await?;
        let inspected = native
            .management(project.to_str().ok_or("Project is not UTF-8")?)
            .await;
        native
            .terminate()
            .await
            .map_err(|_| "Codex Investigator cleanup uncertain".to_string())?;
        if !inspected?.0 {
            return Err("Codex Investigator requires native authentication".into());
        }
        Ok(Arc::new(Self {
            child: Mutex::new(None),
            claimed: std::sync::atomic::AtomicBool::new(false),
            binary,
            state: state.into(),
            mcp: tokio::spawn(async {}),
            client: reqwest::Client::new(),
            url: String::new(),
            password: String::new(),
            scope: Arc::new(ReadScope {
                tools,
                helper,
                helpers: Arc::new(crate::rtk::Helpers::default()),
                project: project.into(),
                token: crate::server::secret(),
                paths: Mutex::new(vec![]),
                enabled: std::sync::atomic::AtomicBool::new(false),
                owner: Mutex::new(None),
                calls: std::sync::atomic::AtomicU32::new(0),
            }),
            model: "gpt-6.1-sol".into(),
            provenance: NativeProvenance {
                runner: "codex 0.166.0".into(),
                integration: "app-server/scoped-dynamic-v1".into(),
                executable,
                content: digest(
                    format!(
                        "{}{:?}shell_tool=false;unified_exec=false;view_image=false;scoped-dynamic-v1",
                        crate::native::scoped_instructions(),
                        crate::native::DISABLED
                    )
                    .as_bytes(),
                ),
                storage: "Native Codex-owned authentication/cache; no credential copies".into(),
            },
            preparation_ms: start.elapsed().as_millis() as u64,
            tool_connection_ms: 0,
        }))
    }
    async fn run_codex(
        &self,
        app: &App,
        task: &str,
        attempt: &str,
    ) -> Result<Option<Phase>, String> {
        let t = app.store.lock().unwrap().task(task)?;
        if digest(&std::fs::read(&self.binary).map_err(|_| "Investigator executable missing")?)
            != self.provenance.executable
        {
            return Err("Investigator executable changed; no fallback".into());
        }
        *self.scope.owner.lock().unwrap() = Some(ReadOwner {
            app: Arc::downgrade(&app.inner),
            task: task.into(),
            attempt: attempt.into(),
        });
        *self.scope.paths.lock().unwrap() = t.scope.clone();
        self.scope
            .enabled
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let mut native = crate::native::Native::start_scoped(
            &self.binary,
            Some(codex_tools(&self.scope.tools)?),
        )
        .await?;
        let result = tokio::time::timeout(Duration::from_secs(600), async {
            let (thread, _, model) = native.prepare(app.project.as_str()).await?;
            {
                let s = app.store.lock().unwrap();
                if !s.task_dispatch_ready(task, attempt)? { return Err("Investigator authority revoked before dispatch".into()); }
                let mut t = s.task(task)?;
                let a = t.attempts.iter_mut().find(|a| a.id == attempt).ok_or("Missing attempt")?;
                if a.provenance.executable != self.provenance.executable || a.provenance.content != self.provenance.content { return Err("Investigator differs from admission".into()); }
                a.provenance=self.provenance.clone();a.native_session=Some(thread.clone());a.phase=Phase::Dispatching;a.dispatch_ms=Some(crate::now());a.observed_model=Some(model);a.preparation_ms=Some(self.preparation_ms);s.save_task(&t)?;
            }
            let admitted = t.attempts.iter().find(|a| a.id==attempt).ok_or("Missing attempt")?;
            let authority = t.authority_root(admitted);
            let prompt = &admitted.prompt;
            let ack = native.request("turn/start",json!({"threadId":thread,"input":[{"type":"text","text":format!("Scope: {}\nAcceptance: {}\nTask: {}",t.scope.join(", "),t.acceptance,prompt)}],"permissions":":read-only","approvalPolicy":"never","approvalsReviewer":"user"})).await?;
            let turn = ack["turn"]["id"].as_str().ok_or("Missing Codex turn identity")?.to_string();
            { let s=app.store.lock().unwrap();let mut t=s.task(task)?;let a=t.attempts.iter_mut().find(|a|a.id==attempt).ok_or("Missing attempt")?;a.native_message=Some(turn.clone());a.acknowledgment_ms=Some(crate::now());a.phase=Phase::Running;s.save_task(&t)?; }
            let mut report = String::new();
            let mut calls = std::collections::BTreeSet::new();
            loop {
                if !read_live(&self.scope) { return Ok(None); }
                let v = tokio::select! {v=native.read()=>v?,_=tokio::time::sleep(Duration::from_millis(100))=>continue};
                let p=&v["params"];
                if v.get("id").is_some() && v.get("method").is_some() {
                    if v["method"] != "item/tool/call" || p["threadId"]!=thread || p["turnId"]!=turn || !p["namespace"].is_null() { return Err("Foreign or unsupported Investigator tool identity".into()); }
                    let call=p["callId"].as_str().filter(|id| !id.is_empty()&&id.len()<=256).ok_or("Invalid call identity")?;
                    if !calls.insert(call.to_string()) { return Err("Repeated native call identity".into()); }
                    let mut headers=HeaderMap::new();headers.insert("authorization",format!("Bearer {}",self.scope.token).parse().map_err(|_|"Read authorization invalid")?);
                    let mut event = json!({"method":"item/started","params":{"threadId":thread,"turnId":turn,"item":{
                        "id":call,"type":"dynamicToolCall","tool":p["tool"],"arguments":p["arguments"]
                    }}});
                    app.record_activity(authority, task, attempt, &thread, &turn, &event);
                    let (status, Json(body))=mcp(State(self.scope.clone()),headers,Json(json!({"id":call,"method":"tools/call","params":{"name":p["tool"],"arguments":p["arguments"]}}))).await;
                    let success=status==StatusCode::OK && body["result"]["isError"]==false;
                    event["method"] = json!("item/completed");
                    event["params"]["item"]["isError"] = json!(!success);
                    event["params"]["item"]["result"] = body.clone();
                    app.record_activity(authority, task, attempt, &thread, &turn, &event);
                    native.write(json!({"id":v["id"],"result":{"success":success,"contentItems":[{"type":"inputText","text":body.to_string()}]}})).await?;
                    continue;
                }
                if v["method"] == "item/agentMessage/delta" {
                    if p["threadId"]!=thread || p["turnId"]!=turn { return Err("Foreign Investigator output".into()); }
                    report.push_str(p["delta"].as_str().ok_or("Missing report delta")?);
                    { let s=app.store.lock().unwrap();let mut current=s.task(task)?;let a=current.attempts.iter_mut().find(|a|a.id==attempt).ok_or("Missing attempt")?;a.first_output_ms.get_or_insert(crate::now());s.save_task(&current)?; }
                    if report.len()>1024*1024 {return Err("Investigator report bound exceeded".into());}
                }
                if v["method"] == "turn/completed" {
                    if p["threadId"]!=thread || p["turn"]["id"]!=turn {return Err("Foreign Investigator completion".into());}
                    if p["turn"]["status"]!="completed" { return Err("Codex Investigator did not complete".into()); }
                    app.store.lock().unwrap().record_task_report(task,attempt,&report)?;
                    return Ok(Some(if report.trim().is_empty(){Phase::Failed}else{Phase::Completed}));
                }
            }
        }).await.unwrap_or_else(|_|Err("Codex Investigator deadline exceeded".into()));
        self.scope
            .enabled
            .store(false, std::sync::atomic::Ordering::SeqCst);
        native
            .terminate()
            .await
            .map_err(|_| "Codex Investigator cleanup uncertain".to_string())?;
        result
    }
    async fn stop(&self) -> Result<(), String> {
        self.scope
            .enabled
            .store(false, std::sync::atomic::Ordering::SeqCst);
        let helper_cleanup = self.scope.helpers.settle().await;
        self.mcp.abort();
        let child = self.child.lock().unwrap().take();
        if let Some(mut child) = child
            && let Some(pid) = child.id()
        {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
            child.wait().await.map_err(
                |_| "Cannot observe investigator process termination; ownership retained",
            )?;
            crate::native::reap_group(pid).await?;
        }
        helper_cleanup
    }
    async fn run_inner(
        &self,
        app: &App,
        task: &str,
        attempt: &str,
    ) -> Result<Option<Phase>, String> {
        let t = app.store.lock().unwrap().task(task)?;
        let a = t
            .attempts
            .iter()
            .find(|a| a.id == attempt)
            .ok_or("Unknown attempt")?;
        if !a.phase.active() || a.cancel_requested {
            return Ok(None);
        }
        *self.scope.owner.lock().unwrap() = Some(ReadOwner {
            app: Arc::downgrade(&app.inner),
            task: task.into(),
            attempt: attempt.into(),
        });
        *self.scope.paths.lock().unwrap() = t.scope.clone();
        self.scope
            .enabled
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let session=self.request("POST","/session",Some(json!({"title":"Deck investigator","permission":[{"permission":"*","pattern":"*","action":"deny"},{"permission":"deck_project_*","pattern":"*","action":"allow"}]}))).await?;
        let session = session["id"]
            .as_str()
            .filter(|v| {
                v.starts_with("ses_") && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
            })
            .ok_or("Native session identity missing")?
            .to_string();
        let mut events = self
            .client
            .get(format!("{}/event", self.url))
            .basic_auth("opencode", Some(&self.password))
            .timeout(Duration::from_secs(660))
            .send()
            .await
            .map_err(|_| "Native event connection unavailable before dispatch")?;
        if !events.status().is_success()
            || !events
                .headers()
                .get("content-type")
                .is_some_and(|v| v.to_str().is_ok_and(|v| v.starts_with("text/event-stream")))
        {
            return Err("Native event stream unavailable; dispatch blocked".into());
        }
        let mut event_buffer = Vec::new();
        let message = format!("msg_{}", uuid::Uuid::new_v4().simple());
        {
            let s = app.store.lock().unwrap();
            let mut t = s.task(task)?;
            let a = t
                .attempts
                .iter_mut()
                .find(|a| a.id == attempt)
                .ok_or("Missing attempt")?;
            let root = s.get(&t.root)?.ok_or("Root missing")?;
            if a.cancel_requested
                || !a.phase.active()
                || root.cancel_requested
                || root.phase != Phase::Running
            {
                return Ok(None);
            }
            if !s.task_dispatch_ready(task, attempt)? {
                return Err(
                    "Conflicting or revoked project ownership; child dispatch blocked".into(),
                );
            }
            if self.provenance.executable != a.provenance.executable
                || self.provenance.content != a.provenance.content
            {
                return Err("Prepared investigator identity changed; dispatch blocked".into());
            }
            a.provenance = self.provenance.clone();
            a.preparation_ms = Some(self.preparation_ms);
            a.tool_connection_ms = Some(self.tool_connection_ms);
            a.native_session = Some(session.clone());
            a.native_message = Some(message.clone());
            a.phase = Phase::Dispatching;
            a.dispatch_ms = Some(crate::now());
            a.detail = "Dispatch intent persisted before native HTTP".into();
            s.save_task(&t)?;
        }
        let graph_fragment = if self
            .scope
            .tools
            .as_array()
            .is_some_and(|tools| tools.iter().any(|t| t["name"] == "graph_search"))
        {
            crate::cbm_management::INSTRUCTIONS
        } else {
            ""
        };
        let (provider, model) = self.model.split_once('/').unwrap();
        self.request("POST",&format!("/session/{session}/prompt_async"),Some(json!({"messageID":message,"agent":"investigator","model":{"providerID":provider,"modelID":model},"parts":[{"type":"text","text":format!("Scope: {}\nAcceptance: {}\nTask: {}\nManaged graph fragment SHA256 {}: {}",t.scope.join(", "),t.acceptance,a.prompt,digest(graph_fragment.as_bytes()),graph_fragment)}]}))).await?;
        {
            let s = app.store.lock().unwrap();
            let mut t = s.task(task)?;
            let a = t
                .attempts
                .iter_mut()
                .find(|a| a.id == attempt)
                .ok_or("Missing attempt")?;
            a.acknowledgment_ms = Some(crate::now());
            s.save_task(&t)?;
        }
        let start = std::time::Instant::now();
        let mut cancellation = None;
        loop {
            let mut t = app.store.lock().unwrap().task(task)?;
            let a = t
                .attempts
                .iter_mut()
                .find(|a| a.id == attempt)
                .ok_or("Missing attempt")?;
            let budget_exhausted = self.scope.calls.load(std::sync::atomic::Ordering::SeqCst) > 32;
            if (a.cancel_requested || budget_exhausted) && cancellation.is_none() {
                self.request(
                    "POST",
                    &format!("/session/{session}/abort"),
                    Some(json!({})),
                )
                .await?;
                cancellation = Some(std::time::Instant::now());
            }
            if start.elapsed() > Duration::from_secs(600)
                || cancellation.is_some_and(|s| s.elapsed() > Duration::from_secs(10))
            {
                return Err(
                    "Native settlement timed out; specialist ownership remains uncertain".into(),
                );
            }
            let messages = self
                .request("GET", &format!("/session/{session}/message"), None)
                .await?;
            let mut text = String::new();
            let mut finished = false;
            let mut observed = None;
            let mut native_error = false;
            if let Some(messages) = messages.as_array() {
                for m in messages {
                    let info = &m["info"];
                    if info["role"] != "assistant" || info["parentID"] != message {
                        continue;
                    }
                    if info["sessionID"] != session {
                        return Err("Foreign native message identity".into());
                    }
                    if info["providerID"] != provider || info["modelID"] != model {
                        return Err("Observed native model differs from assignment".into());
                    }
                    observed = Some(format!("{provider}/{model}"));
                    native_error |= !info["error"].is_null();
                    finished |= info["time"]["completed"].is_number()
                        && info["finish"]
                            .as_str()
                            .is_some_and(|v| v != "tool-calls" && v != "unknown");
                    if let Some(parts) = m["parts"].as_array() {
                        for p in parts {
                            if p["type"] == "text" {
                                text.push_str(p["text"].as_str().unwrap_or(""));
                                text.push('\n');
                            }
                        }
                    }
                }
            }
            if text.len() > 1024 * 1024 {
                return Err("Specialist report exceeds limit".into());
            }
            {
                let s = app.store.lock().unwrap();
                let mut current = s.task(task)?;
                let a = current
                    .attempts
                    .iter_mut()
                    .find(|a| a.id == attempt)
                    .ok_or("Missing attempt")?;
                a.acknowledgment_ms.get_or_insert(crate::now());
                if a.phase == Phase::Dispatching {
                    a.phase = Phase::Running;
                }
                a.observed_model = observed;
                if !text.is_empty() {
                    a.first_output_ms.get_or_insert(crate::now());
                }
                s.save_task(&current)?;
            }
            let statuses = self.request("GET", "/session/status", None).await?;
            let idle = statuses.get(&session).is_none_or(|v| v["type"] == "idle");
            if idle && (finished || native_error || cancellation.is_some()) {
                let phase = if budget_exhausted {
                    Phase::Failed
                } else if cancellation.is_some() {
                    Phase::Cancelled
                } else if native_error || text.trim().is_empty() {
                    Phase::Failed
                } else {
                    Phase::Completed
                };
                app.store
                    .lock()
                    .unwrap()
                    .record_task_report(task, attempt, &text)?;
                return Ok(Some(phase));
            }
            tokio::select! {
                _=tokio::time::sleep(Duration::from_millis(150))=>{},
                chunk=events.chunk()=>{
                    let chunk=chunk.map_err(|_|"Native event stream disconnected; inspect ownership")?.ok_or("Native event stream closed before settlement")?;
                    event_buffer.extend_from_slice(&chunk);
                    if event_buffer.len()>1024*1024{return Err("Native event frame exceeded limit".into())}
                    // Events wake polling. Message/session identity, model and terminal
                    // state are independently checked through bounded HTTP snapshots.
                    if let Some(at)=event_buffer.windows(2).rposition(|w|w==b"\n\n"){event_buffer.drain(..at+2);}
                }
            }
        }
    }
}
// Called only after cleanup resolves. No Store lock spans native waits.
fn finish_run(
    app: &App,
    task: &str,
    attempt: &str,
    model: Result<Option<Phase>, String>,
    cleanup: Result<(), String>,
) {
    let result = (|| {
        let mut store = app.store.lock().unwrap();
        if let Err(e) = cleanup {
            return store.retain_task_uncertainty(task, attempt, &e);
        }
        let t = store.task(task)?;
        let a = t
            .attempts
            .iter()
            .find(|a| a.id == attempt)
            .ok_or("Unknown attempt")?;
        if !a.phase.active() {
            return Ok(());
        }
        let (phase, detail) = match model {
            Ok(phase) => (
                if a.cancel_requested {
                    Phase::Cancelled
                } else {
                    phase.unwrap_or(Phase::Cancelled)
                },
                "Native model and process settled. Report is evidence, not independently verified."
                    .to_string(),
            ),
            Err(e) => (
                if a.dispatch_ms.is_some() {
                    Phase::Uncertain
                } else {
                    Phase::Failed
                },
                e,
            ),
        };
        store.settle_task(task, attempt, phase, "", &detail)
    })();
    if result.is_err() {
        app.storage_failed();
    }
}

#[repr(C)]
struct Rules {
    handled: u64,
}
#[repr(C)]
struct Beneath {
    allowed: u64,
    parent: i32,
}
pub(crate) fn restrict_writes(paths: &[std::ffi::CString]) -> std::io::Result<()> {
    // ABI3 write boundary; provider HTTP remains native. No write access to project,
    // personal database/config or credentials. Native logging is an explicit exception.
    let check = |n: libc::c_long| {
        if n < 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(n as i32)
        }
    };
    let abi = check(unsafe { libc::syscall(libc::SYS_landlock_create_ruleset, 0, 0, 1) })?;
    if abi < 3 {
        return Err(std::io::Error::from_raw_os_error(libc::ENOSYS));
    }
    let mask = [1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
        .iter()
        .fold(0, |m, i| m | (1 << i));
    let rules = Rules { handled: mask };
    let fd = check(unsafe {
        libc::syscall(
            libc::SYS_landlock_create_ruleset,
            &rules,
            std::mem::size_of::<Rules>(),
            0,
        )
    })?;
    let result = (|| {
        for path in paths {
            let parent = check(unsafe {
                libc::open(path.as_ptr(), libc::O_PATH | libc::O_CLOEXEC) as libc::c_long
            })?;
            let rule = Beneath {
                allowed: mask,
                parent,
            };
            let r = check(unsafe { libc::syscall(libc::SYS_landlock_add_rule, fd, 1, &rule, 0) });
            unsafe {
                libc::close(parent);
            }
            r?;
        }
        check(unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) as libc::c_long })?;
        check(unsafe { libc::syscall(libc::SYS_landlock_restrict_self, fd, 0) })?;
        Ok(())
    })();
    unsafe {
        libc::close(fd);
    }
    result
}

pub fn read_tools() -> Value {
    json!([{"name":"read","description":"Read a bounded UTF-8 project file or list a directory within the assigned scope. Symlinks and traversal denied.","inputSchema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}},{"name":"search","description":"Literal search within one scoped UTF-8 file, at most 100 matching lines.","inputSchema":{"type":"object","properties":{"path":{"type":"string"},"query":{"type":"string"}},"required":["path","query"],"additionalProperties":false}}])
}

pub fn compact_tools() -> Value {
    let mut tools = read_tools();
    tools.as_array_mut().unwrap().extend([
        json!({"name":"compact_read","description":"Capture an authorized UTF-8 Rust file once and return an optional lossy RTK view. Exact original source remains available by snapshot identity. Report loss and hash; fallback is explicit.","inputSchema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}}),
        json!({"name":"read_snapshot","description":"Retrieve the exact originally captured bytes and provenance of a snapshot from this attempt. Does not reread the project file.","inputSchema":{"type":"object","properties":{"snapshot_id":{"type":"string"}},"required":["snapshot_id"],"additionalProperties":false}})]);
    tools
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    // Fake only the native HTTP edge: run_inner, Store admission and queue are real.
    // S4-Q01 oracle: model completion must not release process ownership.
    async fn cleanup_fixture() -> (
        App,
        Runner,
        crate::tasks::Authority,
        String,
        String,
        tokio::task::JoinHandle<()>,
    ) {
        cleanup_fixture_for("/fixture").await
    }
    async fn cleanup_fixture_for(project: &str) -> (
        App, Runner, crate::tasks::Authority, String, String, tokio::task::JoinHandle<()>,
    ) {
        let mut store = crate::Store::open_memory(project).unwrap();
        store
            .register_assignment(crate::configuration::Assignment {
                runner: "fake-edge".into(),
                model: "p/m".into(),
                executable: "hash".into(),
                content: "policy".into(),
            })
            .unwrap();
        let mut root = store
            .admit(&deck2_shared::ScopedSubmit {
                attachments: Vec::new(),
                api: deck2_shared::API,
                id: "cleanup-root-01".into(),
                session: store.session.clone(),
                prompt: "inspect".into(),
                mode: deck2_shared::Mode::Team,
                queue: false,
                fresh: true,
            })
            .unwrap();
        root.phase = Phase::Running;
        root.thread = Some("thread".into());
        root.turn = Some("turn".into());
        store.save(&mut root).unwrap();
        let authority = crate::tasks::Authority {
            root: root.id.clone(),
            attempt: root.attempt.clone(),
            generation: root.generation.clone(),
            thread: "thread".into(),
            turn: "turn".into(),
        };
        let provenance = NativeProvenance {
            runner: "fake-edge".into(),
            integration: "test".into(),
            executable: "hash".into(),
            storage: "owned".into(),
            content: "policy".into(),
        };
        let op =
            serde_json::from_value(json!({"prompt":"read", "scope":["file"], "acceptance":"cite"}))
                .unwrap();
        let child = store
            .task_operation(
                &authority,
                "delegate",
                "deck_delegate",
                &op,
                &provenance,
                "p/m",
            )
            .unwrap();
        let task = child["task"].as_str().unwrap().to_string();
        let attempt = child["attempt"].as_str().unwrap().to_string();
        let app = App::new(
            store,
            "127.0.0.1:1234".into(),
            "/missing".into(),
            None,
            "admin".into(),
            "recover".into(),
        );
        let message = Arc::new(Mutex::new(String::new()));
        let sessions = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let native = Router::new().fallback({let message=message.clone(); let sessions=sessions.clone(); move |request: Request<Body>| { let message=message.clone(); let sessions=sessions.clone(); async move {
            let path=request.uri().path().to_string();
            let value = if path == "/event" {
                return axum::response::Response::builder().header("content-type","text/event-stream").body(Body::empty()).unwrap();
            } else if path == "/session" { sessions.fetch_add(1, std::sync::atomic::Ordering::SeqCst); json!({"id":"ses_fixture"}) }
            else if path == "/stats" { json!({"sessions":sessions.load(std::sync::atomic::Ordering::SeqCst)}) }
            else if path.ends_with("/prompt_async") {
                let bytes=axum::body::to_bytes(request.into_body(), 65536).await.unwrap();
                *message.lock().unwrap()=serde_json::from_slice::<Value>(&bytes).unwrap()["messageID"].as_str().unwrap().into(); json!({})
            } else if path.ends_with("/message") {
                json!([{"info":{"role":"assistant","parentID":message.lock().unwrap().clone(),"sessionID":"ses_fixture","providerID":"p","modelID":"m","time":{"completed":1},"finish":"stop"},"parts":[{"type":"text","text":"immutable source evidence"}]}])
            } else { json!({}) };
            axum::response::IntoResponse::into_response(Json(value))
        }}});
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let http = tokio::spawn(async move { axum::serve(listener, native).await.unwrap() });
        let runner = Runner {
            child: Mutex::new(None),
            claimed: std::sync::atomic::AtomicBool::new(false),
            binary: "/missing".into(),
            state: project.into(),
            mcp: tokio::spawn(async {}),
            client: reqwest::Client::new(),
            url,
            password: "fake".into(),
            scope: Arc::new(ReadScope {
                tools: read_tools(),
                helper: None,
                helpers: Arc::new(crate::rtk::Helpers::default()),
                project: project.into(),
                token: "fake".into(),
                paths: Mutex::new(vec![]),
                enabled: std::sync::atomic::AtomicBool::new(false),
                owner: Mutex::new(None),
                calls: std::sync::atomic::AtomicU32::new(0),
            }),
            model: "p/m".into(),
            provenance,
            preparation_ms: 0,
            tool_connection_ms: 0,
        };
        (app, runner, authority, task, attempt, http)
    }
    #[tokio::test]
    async fn model_report_waits_for_process_cleanup_before_followup() {
        let (app, runner, authority, task, attempt, http) = cleanup_fixture().await;
        runner.run_inner(&app, &task, &attempt).await.unwrap();
        // Cleanup deliberately has not returned. Report retrieval/treatment is evidence only.
        let mut s = app.store.lock().unwrap();
        let t = s.task(&task).unwrap();
        let a = &t.attempts[0];
        let report = a
            .report
            .clone()
            .expect("model evidence must survive cleanup failure");
        let op=serde_json::from_value(json!({"task":task,"attempt":attempt,"report":report.digest,"disposition":"followup_required","reason":"checked","prompt":"follow up"})).unwrap();
        s.task_operation(
            &authority,
            "treat",
            "deck_task_treat",
            &op,
            &runner.provenance,
            "p/m",
        )
        .unwrap();
        let held = s.tasks_unsettled().unwrap();
        let followup = s.task_operation(
            &authority,
            "followup",
            "deck_task_followup",
            &op,
            &runner.provenance,
            "p/m",
        );
        s.retain_task_uncertainty(&task, &attempt, "injected failed cleanup")
            .unwrap();
        assert_eq!(s.task(&task).unwrap().attempts[0].report, Some(report));
        http.abort();
        assert!(
            held && followup.is_err(),
            "cleanup pending released ownership: held={held}, followup={followup:?}"
        );
    }
    #[tokio::test]
    async fn model_report_blocks_direct_root_and_queue_until_cleanup() {
        let (app, runner, authority, task, attempt, http) = cleanup_fixture().await;
        runner.run_inner(&app, &task, &attempt).await.unwrap();
        let mut s = app.store.lock().unwrap();
        let mut root = s.get(&authority.root).unwrap().unwrap();
        root.phase = Phase::Completed;
        s.save(&mut root).unwrap();
        let mut command = deck2_shared::ScopedSubmit {
            attachments: Vec::new(),
            api: deck2_shared::API,
            id: "direct-command-01".into(),
            session: s.session.clone(),
            prompt: "next".into(),
            mode: deck2_shared::Mode::ReadOnly,
            queue: false,
            fresh: true,
        };
        let direct = s.admit(&command);
        // Cancel any incorrectly accepted direct input to expose queue behavior independently.
        if let Ok(r) = &direct {
            let mut r = r.clone();
            r.phase = Phase::Cancelled;
            s.save(&mut r).unwrap();
        }
        command.id = "queued-command-01".into();
        command.queue = true;
        s.admit(&command).unwrap();
        s.pause_queue(false).unwrap();
        let queued = s.claim_next().unwrap();
        http.abort();
        assert!(
            direct.is_err() && queued.is_none(),
            "cleanup pending admitted conflicting execution: direct={direct:?}, queue={queued:?}"
        );
    }
    // Delay cleanup at the real model/process boundary, then inject its result.
    // Covers cancellation during cleanup as well as success/failure release rules.
    #[tokio::test]
    async fn delayed_cleanup_success_failure_and_cancellation_preserve_ownership() {
        for cancel in [false, true] {
            for failed in [false, true] {
                let (app, runner, authority, task, attempt, http) = cleanup_fixture().await;
                let model = runner.run_inner(&app, &task, &attempt).await;
                let report = app.store.lock().unwrap().task(&task).unwrap().attempts[0]
                    .report
                    .clone();
                {
                    let mut s = app.store.lock().unwrap();
                    if cancel {
                        s.cancel_tasks(&authority.root).unwrap();
                    }
                    assert!(s.tasks_unsettled().unwrap());
                    assert!(
                        s.record_task_report(&task, &attempt, "replacement evidence")
                            .is_err()
                    );
                    let mut root = s.get(&authority.root).unwrap().unwrap();
                    root.phase = Phase::Completed;
                    s.save(&mut root).unwrap();
                    let session = s.session.clone();
                    s.admit(&deck2_shared::ScopedSubmit {
                        attachments: Vec::new(),
                        api: deck2_shared::API,
                        id: "queued-after-cleanup".into(),
                        session,
                        prompt: "wait".into(),
                        mode: deck2_shared::Mode::ReadOnly,
                        queue: true,
                        fresh: true,
                    })
                    .unwrap();
                    s.pause_queue(false).unwrap();
                    assert!(s.claim_next().unwrap().is_none());
                }
                finish_run(
                    &app,
                    &task,
                    &attempt,
                    model,
                    if failed {
                        Err("injected cleanup failure".into())
                    } else {
                        Ok(())
                    },
                );
                let mut s = app.store.lock().unwrap();
                let t = s.task(&task).unwrap();
                let a = &t.attempts[0];
                assert_eq!(a.report, report);
                assert_eq!(
                    a.phase,
                    if failed {
                        Phase::Uncertain
                    } else if cancel {
                        Phase::Cancelled
                    } else {
                        Phase::Completed
                    }
                );
                assert_eq!(a.settled_ms.is_some(), !failed);
                assert_eq!(s.claim_next().unwrap().is_some(), !failed);
                http.abort();
            }
        }
    }
    // protects: Q87-01 eventual exactly-once legacy dispatch after worker-key cleanup.
    // Q87-01: settlement is visible before active-worker removal. The explicit
    // channel barrier forces admission in that window without relying on timing.
    // Oracle: the next legacy task starts exactly once after cleanup releases it.
    #[tokio::test]
    async fn legacy_admission_between_settlement_and_worker_removal_is_retried_once() {
        let project = tempfile::tempdir().unwrap();
        let (app, runner, authority, task, attempt, http) = cleanup_fixture_for(project.path().to_str().unwrap()).await;
        let runner = Arc::new(runner);
        *app.team.lock().unwrap() = Some(runner.clone());
        app.active.lock().unwrap().insert(format!("child:{attempt}"), tokio::sync::watch::channel(false).0);
        let (published, visible) = tokio::sync::oneshot::channel();
        let (release, released) = tokio::sync::oneshot::channel();
        let worker = {
            let app = app.clone(); let task = task.clone(); let attempt = attempt.clone();
            tokio::spawn(async move {
                finish_run(&app, &task, &attempt, Ok(Some(Phase::Completed)), Ok(()));
                published.send(()).unwrap();
                released.await.unwrap();
                app.clear_active(&format!("child:{attempt}"));
            })
        };
        visible.await.unwrap();
        let (next_task, next_attempt) = {
            let mut s = app.store.lock().unwrap();
            assert_eq!(s.task(&task).unwrap().attempts[0].phase, Phase::Completed);
            let op = serde_json::from_value(json!({"prompt":"read next", "scope":["file"], "acceptance":"cite next"})).unwrap();
            let v = s.task_operation(&authority,"next-delegation","deck_delegate",&op,&runner.provenance,"p/m").unwrap();
            (v["task"].as_str().unwrap().to_string(),v["attempt"].as_str().unwrap().to_string())
        };
        app.start_task(&next_task, &next_attempt).unwrap();
        assert_eq!(app.store.lock().unwrap().task(&next_task).unwrap().attempts[0].phase, Phase::Accepted);
        release.send(()).unwrap();
        worker.await.unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if app.store.lock().unwrap().task(&next_task).unwrap().attempts[0].settled_ms.is_some() { break; }
                tokio::task::yield_now().await;
            }
        }).await.expect("accepted legacy task must be retried after active-key removal");
        for _ in 0..3 { app.clear_active("unrelated-cleanup"); app.start_task(&next_task,&next_attempt).unwrap(); }
        let t = app.store.lock().unwrap().task(&next_task).unwrap();
        assert_eq!(t.attempts.len(), 1);
        assert_eq!(t.attempts[0].phase, Phase::Completed);
        assert_eq!(t.attempts[0].report.as_ref().unwrap().text.trim(),"immutable source evidence");
        let stats: Value = runner.client.get(format!("{}/stats",runner.url)).send().await.unwrap().json().await.unwrap();
        assert_eq!(stats["sessions"],1,"only one native execution may start");
        http.abort();
    }

    // Previously accepted follow-ups (including an old-state interleaving) must
    // fail closed at both host start and the last native dispatch boundary.
    #[tokio::test]
    async fn accepted_followup_cannot_dispatch_past_conflicting_uncertainty() {
        let (app, runner, authority, task, attempt, http) = cleanup_fixture().await;
        let next = {
            let mut s = app.store.lock().unwrap();
            s.settle_task(
                &task,
                &attempt,
                Phase::Completed,
                "legacy report",
                "model done",
            )
            .unwrap();
            let digest = s.task(&task).unwrap().attempts[0]
                .report
                .as_ref()
                .unwrap()
                .digest
                .clone();
            let op=serde_json::from_value(json!({"task":task,"attempt":attempt,"report":digest,"disposition":"followup_required","reason":"checked","prompt":"follow up"})).unwrap();
            s.task_operation(
                &authority,
                "treat",
                "deck_task_treat",
                &op,
                &runner.provenance,
                "p/m",
            )
            .unwrap();
            let v = s
                .task_operation(
                    &authority,
                    "followup",
                    "deck_task_followup",
                    &op,
                    &runner.provenance,
                    "p/m",
                )
                .unwrap();
            s.retain_task_uncertainty(&task, &attempt, "delayed cleanup failed")
                .unwrap();
            v["attempt"].as_str().unwrap().to_string()
        };
        let runner = Arc::new(runner);
        *app.team.lock().unwrap() = Some(runner.clone());
        app.clear_active(&format!("child:{attempt}")); // must not launch the accepted follow-up
        tokio::task::yield_now().await;
        assert_eq!(
            app.store.lock().unwrap().task(&task).unwrap().attempts[1].phase,
            Phase::Accepted
        );
        assert!(runner.run_inner(&app, &task, &next).await.is_err());
        let t = app.store.lock().unwrap().task(&task).unwrap();
        assert!(t.attempts[1].dispatch_ms.is_none());
        assert!(t.attempts[1].native_message.is_none());
        http.abort();
    }
    // Protects the host read boundary independently of native permission prose.
    // Oracle INV01/03/10: no caller token or inactive attempt can use tools.
    #[tokio::test]
    async fn mcp_requires_connection_secret_and_live_attempt() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("file"), "evidence").unwrap();
        let mut store = crate::Store::open_memory(root.path().to_str().unwrap()).unwrap();
        store
            .register_assignment(crate::configuration::Assignment {
                runner: "test".into(),
                model: "p/m".into(),
                executable: "hash".into(),
                content: "digest".into(),
            })
            .unwrap();
        let mut receipt = store
            .admit(&deck2_shared::ScopedSubmit {
                attachments: Vec::new(),
                api: deck2_shared::API,
                id: "test-root-01".into(),
                session: store.session.clone(),
                prompt: "inspect".into(),
                mode: deck2_shared::Mode::Team,
                queue: false,
                fresh: true,
            })
            .unwrap();
        receipt.phase = Phase::Running;
        receipt.generation = "gen".into();
        receipt.thread = Some("thread".into());
        receipt.turn = Some("turn".into());
        store.save(&mut receipt).unwrap();
        let authority = crate::tasks::Authority {
            root: receipt.id.clone(),
            attempt: receipt.attempt,
            generation: receipt.generation,
            thread: "thread".into(),
            turn: "turn".into(),
        };
        let p = NativeProvenance {
            runner: "test".into(),
            integration: "test".into(),
            executable: "hash".into(),
            storage: "owned".into(),
            content: "digest".into(),
        };
        let op =
            serde_json::from_value(json!({"prompt":"read","scope":["file"],"acceptance":"cite"}))
                .unwrap();
        let child = store
            .task_operation(&authority, "call", "deck_delegate", &op, &p, "p/m")
            .unwrap();
        let app = App::new(
            store,
            "127.0.0.1:1234".into(),
            "/missing".into(),
            None,
            "admin".into(),
            "recover".into(),
        );
        let s = Arc::new(ReadScope {
            tools: read_tools(),
            helper: None,
            helpers: Arc::new(crate::rtk::Helpers::default()),
            project: root.path().into(),
            token: "connection-secret".into(),
            paths: Mutex::new(vec!["file".into()]),
            enabled: std::sync::atomic::AtomicBool::new(false),
            calls: std::sync::atomic::AtomicU32::new(0),
            owner: Mutex::new(Some(ReadOwner {
                app: Arc::downgrade(&app.inner),
                task: child["task"].as_str().unwrap().into(),
                attempt: child["attempt"].as_str().unwrap().into(),
            })),
        });
        let router = Router::new().route("/mcp", post(mcp)).with_state(s.clone());
        let call = |token: &str| {
            Request::builder().method("POST").uri("/mcp").header("content-type","application/json").header("authorization",format!("Bearer {token}")).body(Body::from(json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read","arguments":{"path":"file"}}}).to_string())).unwrap()
        };
        assert_eq!(
            router
                .clone()
                .oneshot(call("forged"))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            router
                .clone()
                .oneshot(call("connection-secret"))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        s.enabled.store(true, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(
            router
                .clone()
                .oneshot(call("connection-secret"))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        app.store.lock().unwrap().cancel_tasks(&receipt.id).unwrap();
        // Scope remains enabled: denial must come from durable revocation.
        assert_eq!(
            router
                .oneshot(call("connection-secret"))
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    // Protects actual native dynamic-tool delivery, identity denial and exact-read
    // fallback. Oracle: S5c finite scoped consumer contract. Only native IO is fake.
    #[tokio::test]
    async fn codex_investigator_scoped_delivery_and_identity_denials() {
        use std::os::unix::fs::PermissionsExt;
        for case in [
            "ready",
            "foreign-thread",
            "foreign-turn",
            "repeat",
            "cancelled",
            "stale",
        ] {
            let d = tempfile::tempdir().unwrap();
            let binary = d.path().join("codex");
            std::fs::write(
                &binary,
                include_bytes!("../../../scripts/fixtures/codex-investigator.py"),
            )
            .unwrap();
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
            std::fs::write(d.path().join("case"), case).unwrap();
            std::fs::write(d.path().join("file"), "exact admitted source").unwrap();
            std::fs::write(d.path().join("foreign"), "PRIVATE-FOREIGN-SOURCE").unwrap();
            let tools = crate::cbm_management::tools(read_tools());
            let runner = Runner::prepare_codex(&binary, d.path(), d.path(), tools, None)
                .await
                .unwrap();
            let mut store = crate::Store::open_memory(d.path().to_str().unwrap()).unwrap();
            store
                .register_assignment(crate::configuration::assignment_from_runner(&runner))
                .unwrap();
            let mut root = store
                .admit(&deck2_shared::ScopedSubmit {
                    attachments: Vec::new(),
                    api: deck2_shared::API,
                    id: "codex-root-0001".into(),
                    session: store.session.clone(),
                    prompt: "Investigate source".into(),
                    mode: deck2_shared::Mode::Team,
                    queue: false,
                    fresh: true,
                })
                .unwrap();
            root.phase = Phase::Running;
            root.thread = Some("lead-thread".into());
            root.turn = Some("lead-turn".into());
            store.save(&mut root).unwrap();
            let authority = crate::tasks::Authority {
                root: root.id.clone(),
                attempt: root.attempt.clone(),
                generation: root.generation.clone(),
                thread: "lead-thread".into(),
                turn: "lead-turn".into(),
            };
            let op = serde_json::from_value(
                json!({"prompt":"Find handler","scope":["file"],"acceptance":"Cite exact source"}),
            )
            .unwrap();
            let child = store
                .task_operation(
                    &authority,
                    "delegate-1",
                    "deck_delegate",
                    &op,
                    &runner.provenance,
                    &runner.model,
                )
                .unwrap();
            let task = child["task"].as_str().unwrap();
            let attempt = child["attempt"].as_str().unwrap();
            let mut admitted = store.task(task).unwrap();
            admitted.attempts[0].provenance.integration =
                "Prepared integration; dispatch not observed".into();
            store.save_task(&admitted).unwrap();
            // A previously admitted service is now unavailable. The real scoped
            // dispatcher must record unavailable evidence and exact fallback.
            root.configuration.as_mut().unwrap().cbm = Some(deck2_shared::GraphBinding {
                store: d.path().join("unavailable-store").to_string_lossy().into(),
                service: "missing-service".into(),
                snapshot: "snapshot".into(),
                generation: 1,
                version: "0.12.0".into(),
            });
            store.save(&mut root).unwrap();
            if case == "cancelled" {
                store.cancel_tasks(&root.id).unwrap();
            }
            if case == "stale" {
                let mut t = store.task(task).unwrap();
                t.attempts[0].phase = Phase::Completed;
                store.save_task(&t).unwrap();
            }
            let app = App::new(
                store,
                "127.0.0.1:1234".into(),
                binary,
                None,
                "admin".into(),
                "recover".into(),
            );
            let result = runner.run_codex(&app, task, attempt).await;
            if case == "ready" {
                assert_eq!(result.unwrap(), Some(Phase::Completed));
            } else {
                assert!(result.is_err() || result.unwrap().is_none(), "{case}");
            }
            let wire = std::fs::read_to_string(d.path().join("native.jsonl")).unwrap();
            assert!(!wire.contains("PRIVATE-FOREIGN-SOURCE"));
            if case == "ready" {
                assert!(wire.contains("exact admitted source"));
                assert!(wire.contains("Path outside assigned scope"));
                assert!(wire.contains("exact scoped read/search fallback"));
                let store = app.store.lock().unwrap();
                assert_eq!(
                    store.task(task).unwrap().attempts[0].provenance.integration,
                    "app-server/scoped-dynamic-v1"
                );
                let bodies: Vec<String> = store
                    .conn
                    .prepare("SELECT body FROM cbm_queries")
                    .unwrap()
                    .query_map([], |r| r.get(0))
                    .unwrap()
                    .map(Result::unwrap)
                    .collect();
                assert!(
                    bodies
                        .iter()
                        .any(|b| b.contains("graph_fallback_used") && b.contains("true"))
                );
                assert!(bodies.iter().any(|b| b.contains("source_digest")));
                let mut stmt = store.conn.prepare("SELECT body FROM activity_steps WHERE task=?1 ORDER BY seq").unwrap();
                let steps: Vec<serde_json::Value> = stmt.query_map([task], |row| row.get::<_, String>(0)).unwrap()
                    .map(|row| serde_json::from_str(&row.unwrap()).unwrap()).collect();
                assert_eq!(steps.iter().map(|step| step["tool"].as_str().unwrap()).collect::<Vec<_>>(),
                    ["graph_search", "read", "read", "graph_trace"]);
                assert_eq!(steps[2]["status"], "failed");
                assert_eq!(steps[1]["status"], "done");
            }
        }
    }
}
