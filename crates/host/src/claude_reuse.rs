//! Bounded retained Claude Lead bridge processes and per-process loopback MCP proxy.
//! The proxy holds no attempt authority: it forwards only while an active
//! per-attempt `session_mcp::Bridge` is bound, and returns 403 whenever idle.
use std::{
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{
    Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
    routing::post,
};
use deck2_shared::{MemberAssignment, ProjectBinding, Receipt};
use serde_json::{Value, json};
use tokio::{
    io::BufReader,
    process::{Child, ChildStdin, ChildStdout},
    time::{Instant, timeout},
};

use crate::{claude_readiness::Launch, server::App, tasks::digest};

pub(crate) const MAX_IDLE: usize = 4;
pub(crate) const IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

struct ProxyState {
    token: String,
    target: Mutex<Option<(String, String)>>,
    client: reqwest::Client,
}

pub(crate) struct ClaudeMcpProxy {
    pub(crate) config: Value,
    state: Arc<ProxyState>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for ClaudeMcpProxy {
    fn drop(&mut self) {
        self.deactivate();
        self.task.abort();
    }
}

impl ClaudeMcpProxy {
    pub(crate) async fn start() -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "Cannot bind Claude session MCP proxy")?;
        let url = format!(
            "http://{}/mcp",
            listener
                .local_addr()
                .map_err(|_| "Claude session MCP proxy address unavailable")?
        );
        let token = crate::server::secret();
        let client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .map_err(|_| "Cannot initialize Claude session MCP proxy client")?;
        let state = Arc::new(ProxyState {
            token: token.clone(),
            target: Mutex::new(None),
            client,
        });
        let config = json!({
            "type": "http",
            "url": url,
            "headers": {"Authorization": format!("Bearer {token}")},
            "alwaysLoad": true,
        });
        let router = Router::new()
            .route("/mcp", post(forward))
            .layer(axum::extract::DefaultBodyLimit::max(65536))
            .with_state(state.clone());
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        Ok(Self {
            config,
            state,
            task,
        })
    }

    pub(crate) fn activate(&self, bridge_config: &Value) -> Result<(), String> {
        let url = bridge_config["url"]
            .as_str()
            .ok_or("Session MCP bridge URL missing")?;
        let auth = bridge_config["http_headers"]["Authorization"]
            .as_str()
            .ok_or("Session MCP bridge authorization missing")?;
        *self.state.target.lock().unwrap() = Some((url.to_owned(), auth.to_owned()));
        Ok(())
    }

    pub(crate) fn deactivate(&self) {
        *self.state.target.lock().unwrap() = None;
    }
}

async fn forward(
    State(state): State<Arc<ProxyState>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    if headers.get_all(header::AUTHORIZATION).iter().count() != 1
        || headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            != Some(format!("Bearer {}", state.token).as_str())
    {
        return (
            StatusCode::UNAUTHORIZED,
            [(header::CONTENT_TYPE, "application/json")],
            Bytes::from_static(b"{}"),
        );
    }
    let Some((url, auth)) = state.target.lock().unwrap().clone() else {
        return (
            StatusCode::FORBIDDEN,
            [(header::CONTENT_TYPE, "application/json")],
            Bytes::from_static(br#"{"error":"No active Claude Lead attempt"}"#),
        );
    };
    let response = state
        .client
        .post(url)
        .header(header::AUTHORIZATION, auth)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body)
        .timeout(Duration::from_secs(15 * 60 + 1))
        .send()
        .await;
    match response {
        Ok(reply) => {
            let status = reply.status();
            match reply.bytes().await {
                Ok(bytes) => (
                    status,
                    [(header::CONTENT_TYPE, "application/json")],
                    bytes,
                ),
                Err(_) => (
                    StatusCode::FORBIDDEN,
                    [(header::CONTENT_TYPE, "application/json")],
                    Bytes::from_static(br#"{"error":"Active Claude Lead attempt closed"}"#),
                ),
            }
        }
        Err(_) => (
            StatusCode::FORBIDDEN,
            [(header::CONTENT_TYPE, "application/json")],
            Bytes::from_static(br#"{"error":"Active Claude Lead attempt unavailable"}"#),
        ),
    }
}

pub(crate) struct ParkedParts {
    pub(crate) session: String,
    pub(crate) thread: String,
    pub(crate) key: String,
    pub(crate) epoch: u64,
    pub(crate) expires: Instant,
    pub(crate) pid: u32,
    pub(crate) child: Child,
    pub(crate) stdin: ChildStdin,
    pub(crate) stdout: BufReader<ChildStdout>,
    pub(crate) partial: Vec<u8>,
    pub(crate) script: tempfile::NamedTempFile,
    pub(crate) mcp_proxy: ClaudeMcpProxy,
}

pub(crate) struct Parked(Option<ParkedParts>);

impl Parked {
    pub(crate) fn new(parts: ParkedParts) -> Self {
        Self(Some(parts))
    }

    pub(crate) fn into_parts(mut self) -> ParkedParts {
        self.0.take().expect("Parked Claude process already taken")
    }

    fn inner(&self) -> &ParkedParts {
        self.0.as_ref().expect("Parked Claude process missing")
    }

    fn inner_mut(&mut self) -> &mut ParkedParts {
        self.0.as_mut().expect("Parked Claude process missing")
    }

    fn alive(&mut self) -> bool {
        matches!(self.inner_mut().child.try_wait(), Ok(None))
    }
}

impl Drop for Parked {
    fn drop(&mut self) {
        if let Some(parts) = self.0.take() {
            parts.mcp_proxy.deactivate();
            if parts.pid > 1 {
                unsafe {
                    libc::kill(-(parts.pid as i32), libc::SIGKILL);
                }
            }
        }
    }
}

pub(crate) struct Slot {
    epoch: AtomicU64,
    idle: Mutex<Vec<Parked>>,
    retiring: Arc<AtomicUsize>,
    retirement: Arc<tokio::sync::Mutex<()>>,
}

impl Default for Slot {
    fn default() -> Self {
        Self {
            epoch: AtomicU64::new(0),
            idle: Mutex::new(Vec::new()),
            retiring: Arc::new(AtomicUsize::new(0)),
            retirement: Arc::new(tokio::sync::Mutex::new(())),
        }
    }
}

struct RetiringGuard(Arc<AtomicUsize>);

impl Drop for RetiringGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

impl Slot {
    pub(crate) fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Acquire)
    }

    pub(crate) fn is_retiring(&self) -> bool {
        self.retiring.load(Ordering::Acquire) > 0
    }

    pub(crate) fn owned_pids(&self) -> std::collections::HashSet<i32> {
        self.idle
            .lock()
            .unwrap()
            .iter()
            .filter_map(|p| i32::try_from(p.inner().pid).ok())
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn loaded_session(&self, session: &str) -> bool {
        self.idle
            .lock()
            .unwrap()
            .iter_mut()
            .any(|p| p.inner().session == session && p.inner().expires > Instant::now() && p.alive())
    }

    pub(crate) async fn take(
        &self,
        session: &str,
        thread: &str,
        key: &str,
        fresh: bool,
    ) -> Result<Option<Parked>, String> {
        let _guard = self.retirement.lock().await;
        let mut stale = Vec::new();
        let mut matched = None;
        {
            let mut entries = self.idle.lock().unwrap();
            let now = Instant::now();
            let mut idx = 0;
            while idx < entries.len() {
                let expired_or_dead = entries[idx].inner().expires <= now || !entries[idx].alive();
                let same_session = entries[idx].inner().session == session;
                if expired_or_dead {
                    stale.push(entries.remove(idx));
                } else if same_session {
                    let entry = entries.remove(idx);
                    if !fresh
                        && matched.is_none()
                        && entry.inner().thread == thread
                        && entry.inner().key == key
                    {
                        matched = Some(entry);
                    } else {
                        stale.push(entry);
                    }
                } else {
                    idx += 1;
                }
            }
        }
        if !stale.is_empty() {
            self.retire_entries(stale).await?;
        }
        Ok(matched)
    }

    pub(crate) fn park(&self, app: &App, mut parked: Parked) -> Result<(), Parked> {
        let evicted = {
            let mut entries = self.idle.lock().unwrap();
            if app.shutdown_requested.load(Ordering::SeqCst)
                || parked.inner().epoch != self.epoch.load(Ordering::Acquire)
            {
                return Err(parked);
            }
            let mut evicted = Vec::new();
            let mut idx = 0;
            while idx < entries.len() {
                if entries[idx].inner().session == parked.inner().session || !entries[idx].alive() {
                    evicted.push(entries.remove(idx));
                } else {
                    idx += 1;
                }
            }
            while entries.len() >= MAX_IDLE {
                if let Some((oldest, _)) = entries
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, entry)| entry.inner().expires)
                {
                    evicted.push(entries.remove(oldest));
                } else {
                    break;
                }
            }
            parked.inner_mut().expires = Instant::now() + IDLE_TIMEOUT;
            entries.push(parked);
            evicted
        };
        if !evicted.is_empty() {
            let retiring = self.retiring.clone();
            retiring.fetch_add(1, Ordering::AcqRel);
            tokio::spawn(async move {
                let _guard = RetiringGuard(retiring);
                for entry in evicted {
                    let _ = retire_process(entry).await;
                }
            });
        }
        let epoch = self.epoch.load(Ordering::Acquire);
        let weak = Arc::downgrade(&app.inner);
        tokio::spawn(async move {
            tokio::time::sleep(IDLE_TIMEOUT).await;
            if let Some(inner) = weak.upgrade() {
                inner.claude_reuse.expire(epoch).await;
            }
        });
        Ok(())
    }

    pub(crate) async fn retire_all(&self) -> Result<(), String> {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        let _guard = self.retirement.lock().await;
        let idle = std::mem::take(&mut *self.idle.lock().unwrap());
        self.retire_entries(idle).await
    }

    pub(crate) async fn retire_session(&self, session: &str) -> Result<(), String> {
        let _guard = self.retirement.lock().await;
        let removed = {
            let mut entries = self.idle.lock().unwrap();
            let mut removed = Vec::new();
            let mut idx = 0;
            while idx < entries.len() {
                if entries[idx].inner().session == session {
                    removed.push(entries.remove(idx));
                } else {
                    idx += 1;
                }
            }
            removed
        };
        self.retire_entries(removed).await
    }

    pub(crate) fn shutdown_sync(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        let idle = std::mem::take(&mut *self.idle.lock().unwrap());
        drop(idle);
    }

    async fn expire(&self, epoch: u64) {
        let _guard = self.retirement.lock().await;
        let expired = {
            let mut entries = self.idle.lock().unwrap();
            let now = Instant::now();
            let mut expired = Vec::new();
            let mut idx = 0;
            while idx < entries.len() {
                if entries[idx].inner().epoch == epoch && entries[idx].inner().expires <= now {
                    expired.push(entries.remove(idx));
                } else {
                    idx += 1;
                }
            }
            expired
        };
        let _ = self.retire_entries(expired).await;
    }

    async fn retire_entries(&self, entries: Vec<Parked>) -> Result<(), String> {
        if entries.is_empty() {
            return Ok(());
        }
        let retiring = self.retiring.clone();
        retiring.fetch_add(1, Ordering::AcqRel);
        tokio::spawn(async move {
            let _guard = RetiringGuard(retiring);
            let mut first_error = Ok(());
            for entry in entries {
                if let Err(err) = retire_process(entry).await
                    && first_error.is_ok()
                {
                    first_error = Err(err);
                }
            }
            first_error
        })
        .await
        .map_err(|_| "Claude retirement worker did not settle".to_string())?
    }
}

pub(crate) async fn retire_process(parked: Parked) -> Result<(), String> {
    let mut parts = parked.into_parts();
    parts.mcp_proxy.deactivate();
    let _ = timeout(
        Duration::from_millis(200),
        super::send(&mut parts.stdin, json!({"type": "close"})),
    )
    .await;
    let ParkedParts {
        mut child,
        stdin,
        pid,
        script,
        mcp_proxy,
        ..
    } = parts;
    drop(stdin);
    let result = super::drain_sdk(&mut child, pid).await.map(|_| ());
    drop(script);
    drop(mcp_proxy);
    result
}

pub(crate) fn reuse_key(
    binary: &Path,
    receipt: &Receipt,
    launch: &Launch,
    storage: &Path,
    project: &ProjectBinding,
    trusted: bool,
    thread: &str,
    assignment: &MemberAssignment,
    instructions: &str,
    tool_names: &[&Value],
) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;
    let binding = receipt
        .configuration
        .as_ref()
        .and_then(|s| s.native.as_ref())
        .ok_or("Claude native binding missing")?;
    let mut inputs = format!(
        "{}|{}|{}|{}|{}|{}|{}|{:?}|{}|{:?}|{}|{}|{}",
        receipt.session,
        thread,
        binary.display(),
        binding.executable.executable,
        binding.version,
        binding.configuration,
        storage.display(),
        project,
        trusted,
        assignment,
        digest(instructions.as_bytes()),
        serde_json::to_string(tool_names).map_err(|_| "Invalid Claude tool list")?,
        super::SETTINGS,
    );
    let mut paths = vec![
        binary.to_path_buf(),
        storage.join("settings.json"),
        storage.join("settings.local.json"),
    ];
    if trusted {
        let root = Path::new(&project.root);
        paths.push(root.join(".claude/settings.json"));
        paths.push(root.join(".claude/settings.local.json"));
        paths.push(root.join(".mcp.json"));
    }
    for path in paths {
        inputs.push_str(&format!("|{path:?}:"));
        match std::fs::metadata(&path) {
            Ok(meta) => inputs.push_str(&format!(
                "{:?}",
                [
                    meta.dev(),
                    meta.ino(),
                    meta.len(),
                    meta.mtime() as u64,
                    meta.mtime_nsec() as u64,
                    meta.ctime() as u64,
                    meta.ctime_nsec() as u64,
                ]
            )),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => inputs.push_str("absent"),
            Err(_) => return Err("Cannot verify Claude launch inputs".into()),
        }
    }
    let mut env: Vec<_> = launch.env().iter().collect();
    env.sort_by_key(|(k, _)| *k);
    inputs.push_str(&format!("|{env:?}"));
    Ok(digest(inputs.as_bytes()))
}
