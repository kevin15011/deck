//! Shared managed graph maintenance. Only stable source/identity evidence admits queries.
use crate::{
    cbm_runtime::Client,
    session_source::{Observer, canonical},
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak, mpsc},
    time::Duration,
};
use tokio::sync::oneshot;
const READS: &[&str] = &[
    "search_graph",
    "trace_path",
    "get_code_snippet",
    "check_index_coverage",
    "query_graph",
    "get_architecture",
    "search_code",
    "index_status",
    "list_projects",
    "get_file_outline",
    "get_graph_schema",
    "detect_changes",
];
struct Request {
    name: String,
    args: Value,
    reply: oneshot::Sender<Result<Value, String>>,
    authority: Option<Arc<dyn Fn() -> bool + Send + Sync>>,
}
struct View {
    evidence: Value,
    catalog: Option<Value>,
    ready: bool,
}
pub(crate) struct Guard {
    closing: std::sync::atomic::AtomicBool,
    finished: std::sync::atomic::AtomicBool,
    launch: String,
    pub root: PathBuf,
    pub project: String,
    view: Arc<Mutex<View>>,
    send: mpsc::SyncSender<Request>,
    #[cfg(test)]
    pub(crate) mutation_queued: tokio::sync::Notify,
}
type Registry = Mutex<BTreeMap<String, Weak<Guard>>>;
static REGISTRY: OnceLock<Registry> = OnceLock::new();
static UNCERTAIN: OnceLock<Mutex<Vec<Arc<Guard>>>> = OnceLock::new();
fn fallback(evidence: &Value, reason: &str) -> Value {
    let mut evidence = evidence.clone();
    evidence["reason"] = json!(reason);
    json!({"isError":true,"content":[{"type":"text","text":format!("Codebase graph withheld ({reason}). Read exact source and use rg while reconciliation runs. This is not an empty search result.")}],"structuredContent":{"code":"codebase-source-fallback","sourceFallback":true,"freshness":evidence}})
}
fn data(v: Value) -> Result<Value, String> {
    if v["isError"] == true {
        return Err("backend-rejected".into());
    }
    if v["structuredContent"].is_object() {
        return Ok(v["structuredContent"].clone());
    }
    let text = v["content"]
        .as_array()
        .and_then(|a| {
            a.iter().find_map(|c| {
                if c["type"] == "text" {
                    c["text"].as_str()
                } else {
                    None
                }
            })
        })
        .ok_or("backend-response-unverified")?;
    let v: Value = serde_json::from_str(text).map_err(|_| "backend-response-unverified")?;
    if !v.is_object() {
        return Err("backend-response-unverified".into());
    }
    Ok(v)
}
pub(crate) fn project_name(root: &str) -> String {
    let mut out = String::new();
    for b in root.replace('\\', "/").bytes() {
        if b.is_ascii_alphanumeric() || b"._-".contains(&b) {
            out.push(b as char)
        } else if b >= 128 {
            out.push_str(&format!("{b:02x}"))
        } else {
            out.push('-')
        }
    }
    let mut collapsed = String::new();
    for c in out.chars() {
        if (c == '-' || c == '.') && collapsed.ends_with(c) {
            continue;
        }
        collapsed.push(c)
    }
    let out = collapsed
        .trim_start_matches(['-', '.'])
        .trim_end_matches('-');
    let out = if out.is_empty() { "root" } else { out };
    if out.len() <= 200 {
        return out.into();
    }
    let hash = out.bytes().fold(2166136261u32, |h, b| {
        (h ^ u32::from(b)).wrapping_mul(16777619)
    });
    format!("{}-{hash:08x}", &out[..191])
}
// CBM 0.12.1 platform.c:595-618, including its home fallback and byte bounds.
// Reject unsupported encoding rather than claim identity for a different physical store.
fn cache_path(environment: &crate::cbm_runtime::Environment) -> Result<PathBuf, String> {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let configured = environment.get(OsStr::new("CBM_CACHE_DIR"));
    if configured.is_some_and(|p| p.as_bytes().len() >= 4096) {
        return Err("CBM cache path exceeds backend bound; source fallback".into());
    }
    let configured =
        configured.filter(|p| !p.is_empty() && p.as_bytes() != b"\x1fCBM_CACHE_DIR_MISSING\x1f");
    let path = if let Some(path) = configured {
        path.as_os_str()
    } else {
        ["HOME", "USERPROFILE"]
            .into_iter()
            .filter_map(|key| environment.get(OsStr::new(key)))
            .find(|p| !p.is_empty() && p.as_bytes().len() < 256)
            .ok_or("CBM home unavailable; source fallback")?
            .as_os_str()
    };
    let mut path = path
        .to_str()
        .filter(|p| !p.contains('\0'))
        .ok_or("CBM path encoding unsupported; source fallback")?
        .replace('\\', "/");
    let bytes = path.as_bytes();
    if bytes.len() >= 2
        && bytes[0].is_ascii_lowercase()
        && bytes[1] == b':'
        && (bytes.len() == 2 || bytes[2] == b'/')
    {
        path.replace_range(..1, &path[..1].to_ascii_uppercase());
    }
    if configured.is_none() {
        path.push_str("/.cache/codebase-memory-mcp");
    }
    Ok(PathBuf::from(path))
}
impl Guard {
    pub fn bind(
        project: &Path,
        spec: &Value,
        selection: crate::session_codebase::Selection,
    ) -> Result<Arc<Self>, String> {
        let root = canonical(project)?;
        // Native cwd is retained, but every project selector is derived from the actual session root.
        let cwd = Path::new(spec["cwd"].as_str().ok_or("CBM cwd missing")?);
        let mut environment = crate::cbm_runtime::native_environment(spec)?;
        let storage = cache_path(&environment)?;
        let storage = if storage.is_absolute() {
            storage
        } else {
            cwd.join(storage)
        };
        // Missing storage is not permission to initialize an index or manufacture identity.
        let storage_path = storage.clone();
        let storage = storage
            .canonicalize()
            .map_err(|_| "CBM storage unavailable; source fallback")?;
        use std::os::unix::fs::MetadataExt;
        let m = std::fs::metadata(&storage).map_err(|_| "CBM storage unavailable")?;
        let key = crate::tasks::digest(
            json!([root, storage, m.dev(), m.ino()])
                .to_string()
                .as_bytes(),
        );
        let mut registry = REGISTRY.get_or_init(Default::default).lock().unwrap();
        environment.remove(std::ffi::OsStr::new("CBM_RUNTIME_DIR"));
        // Include all inherited values in the identity without emitting credentials or lossy OS strings.
        use std::os::unix::ffi::OsStrExt;
        let environment_identity: Vec<_> = environment
            .iter()
            .map(|(k, v)| (k.as_bytes(), v.as_bytes()))
            .collect();
        let launch_identity = crate::tasks::digest(
            json!([
                selection.generation(),
                spec["command"],
                spec["args"],
                spec["cwd"],
                spec["env_vars"],
                environment_identity
            ])
            .to_string()
            .as_bytes(),
        );
        if let Some(g) = registry.get(&key).and_then(Weak::upgrade) {
            if g.launch != launch_identity {
                if Arc::strong_count(&g) == 2 {
                    g.closing.store(true, std::sync::atomic::Ordering::SeqCst);
                }
                return Err("Managed backend launch changed while storage is leased".into());
            }
            return Ok(g);
        }
        registry.retain(|_, g| g.strong_count() > 0);
        // Deck1 retains at most two warm connections per project. Active operations
        // keep their leases; idle superseded launch/storage generations can drain.
        let mut warm = 0;
        for old in registry.values().filter_map(Weak::upgrade) {
            if old.root == root && Arc::strong_count(&old) == 2 {
                warm += 1;
                if warm >= 2 {
                    old.closing.store(true, std::sync::atomic::Ordering::SeqCst);
                }
            }
        }
        if registry.len() >= 64 {
            return Err("Managed connection budget reached; source fallback".into());
        }

        let runtime = tempfile::Builder::new()
            .prefix("d2fresh-")
            .tempdir_in("/tmp")
            .map_err(|_| "CBM runtime unavailable")?;
        let launch = spec.clone();
        environment.insert(
            "CBM_RUNTIME_DIR".into(),
            runtime.path().as_os_str().to_owned(),
        );
        let project = project_name(root.to_str().ok_or("CBM root encoding unsupported")?);
        let view = Arc::new(Mutex::new(View {
            evidence: json!({"state":"unknown","reason":"reconciliation-required","root":root,"project":project,"storage":storage,"connectionEpoch":runtime.path(),"scope":"git-tracked-and-nonignored-untracked"}),
            catalog: None,
            ready: false,
        }));
        let (send, receive) = mpsc::sync_channel(64);
        let guard = Arc::new(Self {
            closing: std::sync::atomic::AtomicBool::new(false),
            finished: std::sync::atomic::AtomicBool::new(false),
            launch: launch_identity,
            root: root.clone(),
            project: project.clone(),
            view: view.clone(),
            send,
            #[cfg(test)]
            mutation_queued: tokio::sync::Notify::new(),
        });
        let weak = Arc::downgrade(&guard);
        let lease = guard.clone();
        let registry_key = key.clone();
        std::thread::Builder::new()
            .name("deck-cbm-freshness".into())
            .spawn(move || {
                let mut worker = Worker {
                    selection,
                    storage_path,
                    storage: storage.clone(),
                    storage_identity: (m.dev(), m.ino()),
                    clients: weak,
                    root,
                    project,
                    view,
                    observer: Observer::default(),
                    source: None,
                    uncertain: false,
                };
                let confirmed = Arc::new(std::sync::atomic::AtomicBool::new(true));
                let run = (|| -> Result<(), String> {
                    let mut client =
                        Client::native_tracked(&launch, &environment, confirmed.clone())?;
                    let catalog = client.rpc("tools/list", json!({}), Duration::from_secs(15))?;
                    if !catalog["tools"].is_array() {
                        return Err("CBM inventory unavailable".into());
                    }
                    worker.view.lock().unwrap().catalog = Some(catalog);
                    worker.refresh(&mut client);
                    let mut polled = std::time::Instant::now();
                    loop {
                        // Serialize final process settlement against a new binding to this store.
                        if (Arc::strong_count(&lease) == 1 && !lease.root.exists())
                            || lease.closing.load(std::sync::atomic::Ordering::SeqCst)
                        {
                            let mut registry = REGISTRY.get().unwrap().lock().unwrap();
                            if (Arc::strong_count(&lease) == 1 && !lease.root.exists())
                                || lease.closing.load(std::sync::atomic::Ordering::SeqCst)
                            {
                                // Holding the registry prevents a new binding racing final settlement.
                                drop(client);
                                if confirmed.load(std::sync::atomic::Ordering::SeqCst) {
                                    registry.remove(&registry_key);
                                }
                                return Ok(());
                            }
                        }
                        match receive.recv_timeout(Duration::from_millis(250)) {
                            Ok(request) => {
                                let result = if request.reply.is_closed() {
                                    Err("Consumer cancelled".into())
                                } else {
                                    worker.call(
                                        &mut client,
                                        &request.name,
                                        request.args,
                                        request.authority,
                                    )
                                };
                                let _ = request.reply.send(result);
                                if !worker.view.lock().unwrap().ready {
                                    worker.refresh(&mut client);
                                }
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => {}
                            Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        }
                        if polled.elapsed() >= Duration::from_secs(5)
                            && Arc::strong_count(&lease) > 1
                        {
                            worker.refresh(&mut client);
                            polled = std::time::Instant::now();
                        }
                    }
                    // Client cleanup drains/kills only this private group, after any maintenance settles.
                    drop(client);
                    Ok(())
                })();
                if run.is_err() {
                    worker.set("failed", "backend-unavailable");
                }
                // Every exit, including setup, initialize, inventory and channel closure, passes here
                // after Process::drop. Unconfirmed ownership blocks reuse and retains runtime evidence.
                if !confirmed.load(std::sync::atomic::Ordering::SeqCst) {
                    worker.set("failed", "private-group-settlement-unconfirmed");
                    UNCERTAIN
                        .get_or_init(Default::default)
                        .lock()
                        .unwrap()
                        .push(lease.clone());
                    let _ = runtime.keep();
                } else {
                    let mut registry = REGISTRY.get().unwrap().lock().unwrap();
                    // Do not remove a later replacement registered after normal close settled.
                    if registry
                        .get(&registry_key)
                        .is_some_and(|g| g.ptr_eq(&Arc::downgrade(&lease)))
                    {
                        registry.remove(&registry_key);
                    }
                    drop(runtime);
                }
                lease
                    .finished
                    .store(true, std::sync::atomic::Ordering::SeqCst);
            })
            .map_err(|_| "CBM worker unavailable")?;
        registry.insert(key, Arc::downgrade(&guard));
        Ok(guard)
    }
    #[cfg(test)]
    pub async fn close(&self) {
        self.closing
            .store(true, std::sync::atomic::Ordering::SeqCst);
        while !self.finished.load(std::sync::atomic::Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }
    pub fn fallback(&self, reason: &str) -> Value {
        fallback(&self.view.lock().unwrap().evidence, reason)
    }
    pub async fn list(&self) -> Result<Value, String> {
        for _ in 0..6000 {
            if let Some(c) = self.view.lock().unwrap().catalog.clone() {
                return Ok(c);
            }
            if self.finished.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        Err("CBM inventory unavailable".into())
    }
    #[cfg(test)]
    pub async fn call(&self, name: &str, args: Value) -> Result<Value, String> {
        self.call_authorized(name, args, None).await
    }
    async fn call_authorized(
        &self,
        name: &str,
        args: Value,
        authority: Option<Arc<dyn Fn() -> bool + Send + Sync>>,
    ) -> Result<Value, String> {
        for key in ["repo_path", "project_root", "root_path", "root"] {
            if let Some(v) = args.get(key)
                && v != &json!(self.root)
            {
                return Ok(self.fallback("project-root-mismatch"));
            }
        }
        if args.get("project").is_some_and(|p| p != &self.project) {
            return Ok(self.fallback("project-mismatch"));
        }
        if !args.is_object() {
            return Err("Codebase arguments must be an object".into());
        }
        let mutation = matches!(
            name,
            "index_repository" | "delete_project" | "manage_adr" | "ingest_traces"
        );
        if !READS.contains(&name) && !mutation {
            return Ok(self.fallback("unsupported-project-scope"));
        }
        if name == "index_repository"
            && (args.get("name").is_some_and(|n| n != &self.project)
                || args["async"] == true
                || args["mode"] == "cross-repo-intelligence")
        {
            return Ok(self.fallback("mutation-scope-mismatch"));
        }
        if name == "list_projects" {
            let evidence = self.view.lock().unwrap().evidence.clone();
            return Ok(
                json!({"content":[{"type":"text","text":json!({"project":self.project,"root_path":self.root,"freshness":evidence,"qualifiedDiagnostic":true}).to_string()}],"structuredContent":{"projects":[{"name":self.project,"root_path":self.root}],"freshness":evidence,"qualifiedDiagnostic":true}}),
            );
        }
        if !self.view.lock().unwrap().ready {
            return Ok(self.fallback("reconciliation-required"));
        }
        let (reply, wait) = oneshot::channel();
        if self
            .send
            .try_send(Request {
                name: name.into(),
                args,
                reply,
                authority,
            })
            .is_err()
        {
            return Ok(self.fallback("backend-busy-or-unavailable"));
        }
        #[cfg(test)]
        if mutation { self.mutation_queued.notify_one(); }
        wait.await
            .map_err(|_| "CBM worker unavailable".to_string())?
    }
}
struct Worker {
    selection: crate::session_codebase::Selection,
    storage_path: PathBuf,
    storage: PathBuf,
    storage_identity: (u64, u64),
    clients: Weak<Guard>,
    root: PathBuf,
    project: String,
    view: Arc<Mutex<View>>,
    observer: Observer,
    source: Option<String>,
    uncertain: bool,
}
impl Worker {
    fn set(&self, state: &str, reason: &str) {
        let mut v = self.view.lock().unwrap();
        v.ready = state == "verified";
        v.evidence["state"] = json!(state);
        v.evidence["reason"] = json!(reason);
        v.evidence["observedAt"] = json!(crate::now());
    }
    fn tool(&self, client: &mut Client, name: &str, args: Value) -> Result<Value, String> {
        use std::os::unix::fs::MetadataExt;
        self.selection.verify()?;
        let m = std::fs::metadata(&self.storage_path).map_err(|_| "storage-identity-changed")?;
        if !m.is_dir()
            || self.storage_path.canonicalize().ok().as_ref() != Some(&self.storage)
            || (m.dev(), m.ino()) != self.storage_identity
        {
            return Err("storage-identity-changed".into());
        }
        client.rpc(
            "tools/call",
            json!({"name":name,"arguments":args}),
            Duration::from_secs(if name == "index_repository" { 120 } else { 15 }),
        )
    }
    fn status(&self, client: &mut Client) -> Result<Value, String> {
        let status = data(self.tool(
            client,
            "index_status",
            json!({"project":self.project,"format":"json"}),
        )?)?;
        if status["project"] != self.project
            || status["root_path"] != json!(self.root)
            || !matches!(status["status"].as_str(), Some("ready" | "empty"))
        {
            return Err("project-identity-unverified".into());
        }
        Ok(status)
    }
    fn refresh(&mut self, client: &mut Client) {
        let result = (|| -> Result<(), String> {
            let before = self.observer.snapshot(&self.root)?;
            if self.view.lock().unwrap().ready && self.source.as_ref() == Some(&before) {
                return Ok(());
            }
            self.set("updating", "reconciling");
            self.status(client)?;
            if self.uncertain {
                let job = data(self.tool(
                    client,
                    "index_repository",
                    json!({"name":self.project,"status":true}),
                )?)?;
                if job["project"] != self.project
                    || !matches!(
                        job["state"].as_str(),
                        Some("succeeded" | "failed" | "cancelled" | "idle")
                    )
                {
                    return Err("refresh-completion-uncertain".into());
                }
                self.uncertain = false;
            }
            if self.clients.strong_count() <= 1 {
                return Err("consumers-released".into());
            }
            let _maintenance_lease = self.clients.upgrade().ok_or("consumers-released")?;
            self.uncertain = true;
            let refreshed = self.tool(
                client,
                "index_repository",
                json!({"repo_path":self.root,"name":self.project,"mode":"full","async":false}),
            )?;
            if refreshed["isError"] == true
                || !refreshed["content"].as_array().is_some_and(|a| {
                    a.iter().any(|c| {
                        c["type"] == "text" && c["text"].as_str().is_some_and(|s| !s.is_empty())
                    })
                })
            {
                return Err("refresh-response-unverified".into());
            }
            self.uncertain = false;
            let after_status = self.status(client)?;
            let after = self.observer.snapshot(&self.root)?;
            if before != after {
                return Err("changed-during-refresh".into());
            }
            if !after_status["indexed_at"].is_string() {
                return Err("generation-unverified".into());
            }
            self.source = Some(after.clone());
            {
                let mut v = self.view.lock().unwrap();
                v.evidence["sourceDigest"] = json!(after);
                v.evidence["generation"] = after_status["indexed_at"].clone();
            }
            self.set("verified", "stable-source-reconciled");
            Ok(())
        })();
        if let Err(reason) = result {
            self.set(
                "failed",
                if self.uncertain {
                    "refresh-completion-uncertain"
                } else {
                    &reason
                },
            );
        }
    }
    fn call(
        &mut self,
        client: &mut Client,
        name: &str,
        mut args: Value,
        authority: Option<Arc<dyn Fn() -> bool + Send + Sync>>,
    ) -> Result<Value, String> {
        let before = match self.observer.snapshot(&self.root) {
            Ok(v) => v,
            Err(e) => {
                self.set("unknown", &e);
                return Ok(fallback(&self.view.lock().unwrap().evidence, &e));
            }
        };
        if !self.view.lock().unwrap().ready || self.source.as_ref() != Some(&before) {
            self.set("stale", "source-changed");
            return Ok(fallback(
                &self.view.lock().unwrap().evidence,
                "source-changed",
            ));
        }
        args["project"] = json!(self.project);
        let mutation = matches!(name, "delete_project" | "ingest_traces")
            || name == "manage_adr" && args["action"] != "get"
            || name == "index_repository" && args["status"] != true;
        if mutation {
            self.status(client)?;
            if name == "index_repository" {
                args["repo_path"] = json!(self.root);
                args["name"] = json!(self.project);
                args["async"] = json!(false);
            }
            if authority.as_ref().is_none_or(|a| !a()) {
                return Err("Codebase mutation authority revoked".into());
            }
            self.set("updating", "explicit-project-mutation");
            self.uncertain = true;
            let result = self.tool(client, name, args);
            if result.is_ok() {
                self.uncertain = false;
            }
            self.set("stale", "mutation-requires-reconciliation");
            return result;
        }
        if authority.as_ref().is_some_and(|a| !a()) {
            return Err("Codebase authority revoked".into());
        }
        let result = self.tool(client, name, args)?;
        let identity = self.status(client);
        if !identity
            .as_ref()
            .is_ok_and(|v| v["indexed_at"] == self.view.lock().unwrap().evidence["generation"])
        {
            self.set("unknown", "graph-identity-or-generation-changed");
            return Ok(fallback(
                &self.view.lock().unwrap().evidence,
                "graph-identity-or-generation-changed",
            ));
        }

        let after = self.observer.snapshot(&self.root);
        if after.as_ref() != Ok(&before) {
            self.set("stale", "changed-during-query");
            return Ok(fallback(
                &self.view.lock().unwrap().evidence,
                "changed-during-query",
            ));
        }
        let mut result = result;
        result["_meta"]["deckCodebaseFreshness"] = self.view.lock().unwrap().evidence.clone();
        Ok(result)
    }
}
pub(crate) type Slot = Arc<Mutex<Option<Binding>>>;
#[derive(Clone)]
pub(crate) struct Binding {
    pub guard: Arc<Guard>,
    pub selection: crate::session_codebase::Selection,
    pub policy: Value,
    pub read_only: bool,
}
impl Binding {
    fn allowed(&self, name: &str) -> bool {
        (!self.read_only || READS[..9].contains(&name))
            && self.policy["enabled_tools"]
                .as_array()
                .is_none_or(|v| v.iter().any(|n| n == name))
            && !self.policy["disabled_tools"]
                .as_array()
                .is_some_and(|v| v.iter().any(|n| n == name))
    }
    #[cfg(test)]
    pub async fn request(&self, v: &Value) -> Result<Value, String> {
        self.request_authorized(v, None).await
    }
    pub async fn request_authorized(
        &self,
        v: &Value,
        authority: Option<Arc<dyn Fn() -> bool + Send + Sync>>,
    ) -> Result<Value, String> {
        self.selection.verify()?;
        match v["method"].as_str().unwrap_or("") {
            "initialize" => Ok(
                json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"deck-managed-codebase","version":"1"}}),
            ),
            "ping" => Ok(json!({})),
            "tools/list" => {
                let mut list = self.guard.list().await?;
                list["tools"]
                    .as_array_mut()
                    .ok_or("Invalid CBM inventory")?
                    .retain(|t| t["name"].as_str().is_some_and(|n| self.allowed(n)));
                Ok(list)
            }
            "tools/call" => {
                let name = v["params"]["name"].as_str().ok_or("Missing CBM tool")?;
                if !self.allowed(name) {
                    return Err("Tool policy denied".into());
                }
                let result = self
                    .guard
                    .call_authorized(name, v["params"]["arguments"].clone(), authority)
                    .await?;
                self.selection.verify()?;
                Ok(result)
            }
            _ => Err("Unknown MCP method".into()),
        }
    }
}

pub(crate) async fn close() {
    let guards: Vec<_> = REGISTRY
        .get()
        .map(|r| {
            r.lock()
                .unwrap()
                .values()
                .filter_map(Weak::upgrade)
                .collect()
        })
        .unwrap_or_default();
    for g in &guards {
        g.closing.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    // Maintenance holds its own lease. Shutdown waits for its bounded RPC and private-group settlement.
    for g in guards {
        while !g.finished.load(std::sync::atomic::Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}

#[cfg(test)]
mod storage_tests {
    use super::*;
    #[test]
    fn supported_backend_cache_paths() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        let mut env = crate::cbm_runtime::Environment::new();
        env.insert("HOME".into(), "/home/fixture".into());
        let default = PathBuf::from("/home/fixture/.cache/codebase-memory-mcp");
        assert_eq!(cache_path(&env).unwrap(), default);
        env.insert("CBM_CACHE_DIR".into(), "".into());
        assert_eq!(cache_path(&env).unwrap(), default);
        env.insert("USERPROFILE".into(), "relative\\profile".into());
        env.insert("HOME".into(), "".into());
        assert_eq!(
            cache_path(&env).unwrap(),
            PathBuf::from("relative/profile/.cache/codebase-memory-mcp")
        );
        env.insert("HOME".into(), "x".repeat(256).into());
        assert_eq!(
            cache_path(&env).unwrap(),
            PathBuf::from("relative/profile/.cache/codebase-memory-mcp")
        );
        env.insert("HOME".into(), "x".repeat(255).into());
        assert_eq!(
            cache_path(&env).unwrap(),
            PathBuf::from(format!("{}/.cache/codebase-memory-mcp", "x".repeat(255)))
        );
        env.insert("CBM_CACHE_DIR".into(), "c:\\cache".into());
        assert_eq!(cache_path(&env).unwrap(), PathBuf::from("C:/cache"));
        env.insert("CBM_CACHE_DIR".into(), "x".repeat(4095).into());
        assert_eq!(cache_path(&env).unwrap(), PathBuf::from("x".repeat(4095)));
        env.insert("CBM_CACHE_DIR".into(), "x".repeat(4096).into());
        assert!(cache_path(&env).is_err());
        env.insert("CBM_CACHE_DIR".into(), OsString::from_vec(vec![0xff]));
        assert!(cache_path(&env).is_err());
        env.remove(std::ffi::OsStr::new("CBM_CACHE_DIR"));
        env.remove(std::ffi::OsStr::new("HOME"));
        env.remove(std::ffi::OsStr::new("USERPROFILE"));
        assert!(cache_path(&env).is_err());
    }
}
