//! Ordinary native process owner. The caller retains the bridge and reservation
//! until this process group is drained; HTTP failures never retry an input.
use super::*;
use std::{path::Path, process::Stdio};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::{Child, Command},
};

pub const HELPER_LIMITS: &str = "Deck-managed CBM freshness and RTK automatic rewriting are not qualified on this OpenCode route. Use exact native source tools and ordinary commands. Personal native integrations remain under their native policy; do not claim managed helper availability.";

pub struct Process {
    child: Child,
    pid: u32,
    pub client: Client,
    pub events: tokio::sync::mpsc::Receiver<Result<Value, String>>,
    reader: tokio::task::JoinHandle<()>,
    output: tokio::task::JoinHandle<()>,
    drained: bool,
    pub permissions: Vec<Value>,
    reservation: Option<std::fs::File>,
    tool_runtime: Option<tempfile::TempDir>,
}
impl Drop for Process {
    fn drop(&mut self) {
        if !self.drained {
            // If settlement is uncertain, keep the rendezvous with the storage
            // reservation instead of deleting files a descendant may still use.
            if let Some(dir)=self.tool_runtime.take(){let _=dir.keep();}
            unsafe {
                libc::kill(-(self.pid as i32), libc::SIGKILL);
            }
        }
        self.reader.abort();
        self.output.abort();
    }
}
fn fail(_: Failure) -> String {
    "OpenCode native transport failed; dispatch acknowledgment/effect may be uncertain".into()
}
impl Process {
    pub async fn start(
        binary: &Path,
        project: &str,
        config: Value,
        trusted: bool,
        storage: &str,
        tool_runtime: tempfile::TempDir,
        track: impl FnOnce(u32) -> Result<(), String>,
    ) -> Result<Self, String> {
        let version = crate::native::command_probe(binary, &["--version"]).await?;
        if String::from_utf8_lossy(&version).trim() != "1.19.1" {
            return Err("Unsupported ordinary OpenCode version; requires 1.19.1".into());
        }
        let scope = std::env::temp_dir().join(format!("deck2-opencode-scopes-{}", unsafe {
            libc::geteuid()
        }));
        let reservation = crate::managed_tools::Directory::open_root(&scope)?
            .lock_mode(storage, false)
            .map_err(|_| "Another Deck attempt owns this OpenCode storage")?;
        if unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1) } != 0 {
            return Err("Cannot establish native ownership".into());
        }
        let password = crate::server::secret();
        let mut cmd = Command::new(binary);
        cmd.args(["serve", "--hostname", "127.0.0.1", "--port", "0"])
            .current_dir(project)
            .env("OPENCODE_CONFIG_CONTENT", config.to_string())
            .env("OPENCODE_SERVER_PASSWORD", &password)
            .env("OPENCODE_SERVER_USERNAME", "opencode")
            .env("OPENCODE_DISABLE_AUTOUPDATE", "true")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if !trusted {
            cmd.env("OPENCODE_DISABLE_PROJECT_CONFIG", "true")
                .env("OPENCODE_DISABLE_EXTERNAL_SKILLS", "true");
        }
        for (k, _) in std::env::vars_os() {
            if k.to_string_lossy().starts_with("DECK_SESSION_START_") {
                cmd.env_remove(k);
            }
        }
        unsafe {
            cmd.pre_exec(|| {
                if libc::setpgid(0, 0) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                Ok(())
            });
        }
        let mut child = cmd.spawn().map_err(|_| "Cannot start OpenCode")?;
        let pid = child.id().ok_or("Native process identity unavailable")?;
        // Own cleanup before any fallible handshake, including source tracking.
        let (tx, events) = tokio::sync::mpsc::channel(128);
        let mut lines = BufReader::new(
            child
                .stdout
                .take()
                .ok_or("Native stdout unavailable")?
                .take(65537),
        )
        .lines();
        let empty = Client::new(
            std::net::SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, 1),
            password.clone(),
        )
        .map_err(fail)?;
        let mut process = Self {
            child,
            pid,
            client: empty,
            events,
            reader: tokio::spawn(async {}),
            output: tokio::spawn(async {}),
            drained: false,
            permissions: vec![],
            reservation: Some(reservation),
            tool_runtime: Some(tool_runtime),
        };
        let prepared: Result<(), String> = async {
            track(pid)?;
            let endpoint = tokio::time::timeout(Duration::from_secs(15), async {
                let mut bytes = 0;
                loop {
                    let line = lines
                        .next_line()
                        .await
                        .map_err(|_| "Native startup pipe failed")?
                        .ok_or("Native startup ended")?;
                    bytes += line.len();
                    if bytes > 65536 {
                        return Err("Native startup output limit".to_string());
                    }
                    if let Some(url) = line
                        .split_whitespace()
                        .find(|s| s.starts_with("http://127.0.0.1:"))
                    {
                        return url
                            .trim_end_matches('/')
                            .strip_prefix("http://")
                            .ok_or("Native endpoint invalid".to_string())?
                            .parse::<std::net::SocketAddrV4>()
                            .map_err(|_| "Native endpoint invalid".into());
                    }
                }
            })
            .await
            .map_err(|_| "Native startup timed out")??;
            process.client = Client::new(endpoint, password).map_err(fail)?;
            let health = process
                .client
                .request(reqwest::Method::GET, "/global/health", None)
                .await
                .map_err(fail)?;
            if health["healthy"] != true {
                return Err("OpenCode health attestation failed".into());
            }
            process.output = tokio::spawn(async move {
                let mut output = lines.into_inner().into_inner().into_inner();
                let _ = tokio::io::copy(&mut output, &mut tokio::io::sink()).await;
            });
            let response = process
                .client
                .client
                .get(format!("{}/event", process.client.base))
                .basic_auth("opencode", Some(&process.client.password))
                .send()
                .await
                .map_err(|_| "Native events unavailable")?;
            if !response.status().is_success() {
                return Err("Native event authentication failed".into());
            }
            process.reader = tokio::spawn(async move {
                use futures_util::StreamExt;
                let mut stream = response.bytes_stream();
                let mut buffer = Vec::new();
                let mut data = String::new();
                while let Some(chunk) = stream.next().await {
                    let chunk = match chunk {
                        Ok(c) => c,
                        Err(_) => {
                            let _ = tx.send(Err("Native event connection ended".into())).await;
                            return;
                        }
                    };
                    buffer.extend_from_slice(&chunk);
                    if buffer.len() > 2 * MAX_EVENT {
                        let _ = tx.send(Err("Native event buffer limit".into())).await;
                        return;
                    }
                    while let Some(at) = buffer.iter().position(|b| *b == b'\n') {
                        let line = buffer.drain(..=at).collect::<Vec<_>>();
                        let line = match std::str::from_utf8(&line) {
                            Ok(s) => s.trim_end_matches(['\r', '\n']),
                            Err(_) => {
                                let _ = tx.send(Err("Native event encoding invalid".into())).await;
                                return;
                            }
                        };
                        if line.is_empty() {
                            if !data.is_empty() {
                                let event = serde_json::from_str(&data)
                                    .map_err(|_| "Native event JSON invalid".into());
                                if tx.send(event).await.is_err() {
                                    return;
                                }
                                data.clear();
                            }
                        } else if let Some(value) = line.strip_prefix("data:") {
                            if !data.is_empty() {
                                data.push('\n');
                            }
                            data.push_str(value.strip_prefix(' ').unwrap_or(value));
                            if data.len() > MAX_EVENT {
                                let _ = tx.send(Err("Native event size limit".into())).await;
                                return;
                            }
                        }
                    }
                }
                let _ = tx.send(Err("Native event stream ended".into())).await;
            });
            Ok(())
        }
        .await;
        if let Err(e) = prepared {
            process.stop().await?;
            return Err(e);
        }
        Ok(process)
    }
    pub async fn stop(&mut self) -> Result<(), String> {
        unsafe {
            libc::kill(-(self.pid as i32), libc::SIGKILL);
        }
        let result = async {
            tokio::time::timeout(Duration::from_secs(3), self.child.wait())
                .await
                .map_err(|_| "Native process drain timed out")?
                .map_err(|_| "Native wait failed")?;
            crate::native::reap_group(self.pid).await?;
            if unsafe { libc::kill(-(self.pid as i32), 0) } == 0 {
                return Err("Native descendants remain".into());
            }
            Ok(())
        }
        .await;
        if result.is_err() {
            // Retain the storage lock until host exit when cleanup is uncertain.
            if let Some(file) = self.reservation.take() {
                std::mem::forget(file);
            }
        } else {
            self.drained = true;
            self.reservation.take();
            if let Some(dir)=self.tool_runtime.take(){dir.close().map_err(|_|"Tool runtime cleanup failed")?;}
        }
        self.reader.abort();
        self.output.abort();
        result
    }
    pub async fn attest(&mut self, config: &Value, agent: &str, yolo: bool) -> Result<(), String> {
        let actual = self
            .client
            .request(reqwest::Method::GET, "/config", None)
            .await
            .map_err(fail)?;
        if actual["mcp"]["deck"] != config["mcp"]["deck"]
            || actual["share"] != "disabled"
            || actual["autoupdate"] != false
        {
            return Err("OpenCode effective configuration mismatch".into());
        }
        for plugin in config["plugin"].as_array().into_iter().flatten() {
            if !actual["plugin"]
                .as_array()
                .is_some_and(|a| a.contains(plugin))
            {
                return Err("OpenCode native plugin attestation failed".into());
            }
        }
        for path in config["skills"]["paths"].as_array().into_iter().flatten() {
            if !actual["skills"]["paths"]
                .as_array()
                .is_some_and(|a| a.contains(path))
            {
                return Err("Native global skills unavailable".into());
            }
        }
        let status = self
            .client
            .request(reqwest::Method::GET, "/mcp", None)
            .await
            .map_err(fail)?;
        if status["deck"]["status"] != "connected" {
            return Err("OpenCode Deck MCP is not connected".into());
        }
        let agents = self
            .client
            .request(reqwest::Method::GET, "/agent", None)
            .await
            .map_err(fail)?;
        let selected = agents
            .as_array()
            .and_then(|a| a.iter().find(|v| v["name"] == agent))
            .ok_or("OpenCode selected agent missing")?;
        if selected["prompt"] != config["agent"][agent]["prompt"] {
            return Err("OpenCode selected agent policy mismatch".into());
        }
        let rules = selected["permission"]
            .as_array()
            .ok_or("Native agent permission inventory missing")?;
        if rules.len() > 4096
            || rules.iter().any(|r| {
                !r["permission"].is_string()
                    || !r["pattern"].is_string()
                    || !matches!(r["action"].as_str(), Some("allow" | "deny" | "ask"))
            })
        {
            return Err("Native permission inventory invalid".into());
        }
        self.permissions =
            vec![json!({"permission":"*","pattern":"*","action":if yolo{"allow"}else{"ask"}})];
        self.permissions.extend(rules.iter().map(|r| {
            let mut r = r.clone();
            if !yolo && r["action"] == "allow" {
                r["action"] = json!("ask");
            }
            r
        }));
        if matches!(agent, "investigate" | "quality") {
            let mut allowed = vec![
                "read".to_string(),
                "glob".into(),
                "grep".into(),
                "list".into(),
            ];
            allowed.extend(
                crate::session_mcp::tools(true)
                    .as_array()
                    .ok_or("Member tools missing")?
                    .iter()
                    .filter_map(|t| t["name"].as_str().map(|name| format!("deck_{name}"))),
            );
            let native = std::mem::take(&mut self.permissions);
            self.permissions = vec![json!({"permission":"*","pattern":"*","action":"deny"})];
            for tool in allowed {
                for r in &native {
                    if super::execution::glob(r["permission"].as_str().unwrap_or(""), &tool) {
                        let mut r = r.clone();
                        r["permission"] = json!(tool);
                        self.permissions.push(r);
                    }
                }
            }
        }
        self.permissions
            .push(json!({"permission":"task","pattern":"*","action":"deny"}));
        Ok(())
    }
    pub async fn session(&self, resume: Option<&str>, project: &str) -> Result<String, String> {
        if let Some(id) = resume {
            let v = self.client.lookup(id).await.map_err(|e| {
                if e == Failure::MissingSession {
                    "native-session-not-found".into()
                } else {
                    fail(e)
                }
            })?;
            if v["directory"] != project {
                return Err("OpenCode native session belongs to another project".into());
            }
            self.client
                .request(
                    reqwest::Method::PATCH,
                    &format!("/session/{id}"),
                    Some(json!({"permission":self.permissions})),
                )
                .await
                .map_err(fail)?;
            return Ok(id.into());
        }
        let v = self
            .client
            .request(
                reqwest::Method::POST,
                "/session",
                Some(json!({"title":"Deck","permission":self.permissions})),
            )
            .await
            .map_err(fail)?;
        let id = v["id"].as_str().ok_or("Native session identity missing")?;
        Invocation {
            session: id.into(),
            message: "validation".into(),
            agent: "validation".into(),
        }
        .validate()?;
        if v["directory"] != project {
            return Err("OpenCode native session project mismatch".into());
        }
        Ok(id.into())
    }
    pub async fn abort(&self, session: &str) {
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            self.client.request(
                reqwest::Method::POST,
                &format!("/session/{session}/abort"),
                Some(json!({})),
            ),
        )
        .await;
    }
}
pub fn launch_config(
    role: &crate::session_roles::Role,
    member: &str,
    bridge: &Value,
    trusted: bool,
    yolo: bool,
) -> Result<Value, String> {
    let mut config = match std::env::var("OPENCODE_CONFIG_CONTENT") {
        Ok(s) => source::jsonc(&s)?,
        Err(_) => json!({}),
    };
    if !config.is_object() || !config["mcp"]["deck"].is_null() {
        return Err("Native Deck MCP configuration conflict".into());
    }
    let remote = json!({"type":"remote","url":bridge["url"],"headers":bridge["http_headers"],"oauth":false,"enabled":true});
    let readonly = matches!(member, "investigate" | "quality");
    let mut permissions = json!({"task":"deny"});
    let _ = yolo;
    if readonly {
        permissions =
            json!({"*":"deny","read":"allow","glob":"allow","grep":"allow","list":"allow"});
    }
    if !role.hooks.is_empty() {
        let mut plugins = config["plugin"].as_array().cloned().unwrap_or_default();
        for (_, path) in &role.hooks {
            let url = reqwest::Url::from_file_path(path)
                .map_err(|_| "Native plugin path invalid")?
                .to_string();
            if !plugins.contains(&json!(url)) {
                plugins.push(json!(url));
            }
        }
        config["plugin"] = json!(plugins);
    }
    let instructions = format!(
        "{}\n\n{}\n\n{HELPER_LIMITS}",
        role.instructions,
        crate::session_contract::POLICY
    );
    source::merge(
        &mut config,
        json!({"share":"disabled","autoupdate":false,"mcp":{"deck":remote},"agent":{member:{"mode":"primary","prompt":instructions,"permission":permissions}},"permission":{"task":"deny"}}),
    );
    if !trusted {
        let home = std::env::var_os("HOME").ok_or("Native home unavailable")?;
        let paths = [
            Path::new(&home).join(".agents/skills"),
            Path::new(&home).join(".claude/skills"),
        ]
        .into_iter()
        .filter(|p| p.is_dir())
        .map(|p| p.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
        source::merge(&mut config, json!({"skills":{"paths":paths}}));
    }
    Ok(config)
}

#[cfg(test)]
mod cleanup_tests {
    use super::*;
    // Protects pre-spawn cleanup, complementing the composed failed-handshake
    // test. Oracle: an executable refusal leaves no owned tool rendezvous.
    #[tokio::test]
    async fn opencode_failed_start_before_spawn_releases_tool_runtime(){
        let fixture=tempfile::tempdir().unwrap();
        let runtime=tempfile::Builder::new().prefix("d2oc-tool-").tempdir_in("/tmp").unwrap();
        let path=runtime.path().to_owned();
        let result=Process::start(&fixture.path().join("missing"),fixture.path().to_str().unwrap(),json!({}),false,"unused",runtime,|_|Ok(())).await;
        assert!(result.is_err());
        assert!(!path.exists(),"pre-spawn refusal leaked {}",path.display());
    }
}
