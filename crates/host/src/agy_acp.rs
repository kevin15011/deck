//! Antigravity's bounded JSON-RPC stdio transport.
use std::{path::Path, process::Stdio, time::Duration};

use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::timeout,
};

const MAX_FRAME: usize = 1024 * 1024;
// Shared admission caps the raw images at 20 MiB. Base64 and JSON add overhead.
const MAX_PROMPT_FRAME: usize = 28 * 1024 * 1024;
pub(super) const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug)]
pub(super) enum Error {
    Transport,
    Protocol,
    Authentication,
    Rejected,
    Timeout,
}

pub(super) struct Client {
    group: ProcessGroup,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    partial: Vec<u8>,
    next: u64,
}

impl Client {
    pub(super) fn spawn(binary: &Path, cwd: &Path, sandbox: bool) -> Result<Self, Error> {
        let mut command = Self::command(binary, cwd, sandbox)?;
        Self::start(&mut command).map_err(|_| Error::Transport)
    }

    pub(super) fn spawn_member(
        binary: &Path,
        configure: impl FnOnce(&mut Command),
    ) -> Result<Self, String> {
        let mut command = Self::command(binary, Path::new("/"), true)?;
        configure(&mut command);
        Self::start(&mut command).map_err(|error| {
            format!(
                "Cannot launch Antigravity in the required member filesystem namespace: {error}"
            )
        })
    }

    fn command(binary: &Path, cwd: &Path, sandbox: bool) -> Result<Command, Error> {
        let mut command = Command::new(binary);
        command
            .args(["acp", "--stdio", "--disable-telemetry"])
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if sandbox {
            command.arg("--sandbox");
        }
        crate::native::own_child(&mut command).map_err(|_| Error::Transport)?;
        Ok(command)
    }

    fn start(command: &mut Command) -> std::io::Result<Self> {
        let mut child = command.spawn()?;
        // A freshly spawned Tokio child with these Stdio settings owns all three handles.
        let pid = child.id().expect("spawned process PID");
        let stdin = child.stdin.take().expect("piped process stdin");
        let stdout = BufReader::new(child.stdout.take().expect("piped process stdout"));
        Ok(Self {
            group: ProcessGroup::new(child, pid),
            stdin,
            stdout,
            partial: Vec::new(),
            next: 0,
        })
    }

    pub(super) fn pid(&self) -> u32 {
        self.group.pid
    }

    pub(super) fn hold_cleanup(&mut self, owner: impl Send + Sync + 'static) {
        self.group.hold_cleanup(owner);
    }

    async fn send(&mut self, message: Value) -> Result<(), Error> {
        let mut bytes = serde_json::to_vec(&message).map_err(|_| Error::Protocol)?;
        let limit = if message["method"] == "session/prompt" {
            MAX_PROMPT_FRAME
        } else {
            MAX_FRAME
        };
        if bytes.len() >= limit {
            return Err(Error::Protocol);
        }
        bytes.push(b'\n');
        let budget = Duration::from_secs(2 + (bytes.len() / MAX_FRAME) as u64);
        timeout(budget, self.stdin.write_all(&bytes))
            .await
            .map_err(|_| Error::Timeout)?
            .map_err(|_| Error::Transport)
    }

    pub(super) async fn read(&mut self) -> Result<Value, Error> {
        // Retain partial frames when a select branch interrupts this future.
        loop {
            let bytes = self.stdout.fill_buf().await.map_err(|_| Error::Transport)?;
            if bytes.is_empty() {
                return Err(Error::Transport);
            }
            let end = bytes.iter().position(|byte| *byte == b'\n');
            let count = end.map_or(bytes.len(), |end| end + 1);
            if self.partial.len() + count > MAX_FRAME {
                return Err(Error::Protocol);
            }
            self.partial.extend_from_slice(&bytes[..count]);
            self.stdout.consume(count);
            if end.is_some() {
                let parsed: Value =
                    serde_json::from_slice(&self.partial).map_err(|_| Error::Protocol)?;
                self.partial.clear();
                return if parsed["jsonrpc"] == "2.0" {
                    Ok(parsed)
                } else {
                    Err(Error::Protocol)
                };
            }
        }
    }

    pub(super) async fn request(&mut self, method: &str, params: Value) -> Result<u64, Error> {
        self.next += 1;
        let id = self.next;
        self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .await?;
        Ok(id)
    }

    pub(super) async fn reply(&mut self, id: Value, result: Value) -> Result<(), Error> {
        self.send(json!({"jsonrpc":"2.0","id":id,"result":result}))
            .await
    }

    pub(super) async fn reject(&mut self, id: Value) -> Result<(), Error> {
        self.send(json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not supported"}})).await
    }

    pub(super) async fn call(&mut self, method: &str, params: Value) -> Result<Value, Error> {
        let id = self.request(method, params).await?;
        loop {
            let message = self.read().await?;
            if let Some(method) = message["method"].as_str() {
                if let Some(id) = message.get("id") {
                    if method == "session/request_permission" {
                        self.reply(id.clone(), json!({"outcome":{"outcome":"cancelled"}}))
                            .await?;
                    } else {
                        self.reject(id.clone()).await?;
                    }
                }
            } else {
                return response(&message, id);
            }
        }
    }

    pub(super) async fn initialize(&mut self) -> Result<Value, Error> {
        let result = self.call("initialize", json!({
            "protocolVersion":1,
            "clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}
        })).await?;
        if result["protocolVersion"] != 1 {
            return Err(Error::Protocol);
        }
        Ok(result)
    }

    pub(super) async fn cancel(&mut self, session: &str) -> Result<(), Error> {
        self.send(json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":session}}))
            .await
    }

    pub(super) async fn stop(self) -> Result<(), String> {
        self.group.stop().await
    }
}

// Both ACP and PTY probes use the same settlement rule. The detached task
// keeps the Child and its reservation even if the HTTP observer is dropped.
pub(super) struct ProcessGroup {
    pub(super) child: Option<Child>,
    pid: u32,
    reservation: Option<std::sync::Arc<dyn Send + Sync>>,
    owner: Option<Box<dyn Send + Sync>>,
    #[cfg(test)]
    fault: Option<std::sync::Arc<crate::native::ProbeCleanupFault>>,
}

impl ProcessGroup {
    pub(super) fn new(child: Child, pid: u32) -> Self {
        Self {
            child: Some(child),
            pid,
            reservation: crate::native::PROBE_RESERVATION.try_with(Clone::clone).ok(),
            owner: None,
            #[cfg(test)]
            fault: crate::native::PROBE_CLEANUP_FAULT
                .try_with(Clone::clone)
                .ok(),
        }
    }

    pub(super) fn hold_cleanup(&mut self, owner: impl Send + Sync + 'static) {
        self.owner = Some(Box::new(owner));
    }

    pub(super) async fn stop(mut self) -> Result<(), String> {
        self.start_reaper()
            .expect("owned Antigravity process")
            .await
            .map_err(|_| "Antigravity process cleanup worker exited".into())
    }

    fn start_reaper(&mut self) -> Option<tokio::task::JoinHandle<()>> {
        let mut child = self.child.take()?;
        let pid = self.pid;
        let mut signalled = kill_group(pid, libc::SIGKILL);
        let reservation = self.reservation.take();
        let owner = self.owner.take();
        #[cfg(test)]
        let fault = self.fault.take();
        Some(tokio::spawn(async move {
            let mut reported_error = false;
            loop {
                let settled = async {
                    signalled?;
                    let waited = timeout(Duration::from_secs(1), child.wait())
                        .await
                        .map_err(|_| "Antigravity process did not stop")?;
                    // The daemon's zombie reaper can independently reap a
                    // stopped child. In that case keep checking its group.
                    if let Err(error) = waited
                        && error.raw_os_error() != Some(libc::ECHILD)
                    {
                        return Err("Antigravity process could not be reaped".into());
                    }
                    #[cfg(test)]
                    if let Some(fault) = &fault {
                        fault.reached.notify_one();
                        if fault.unsettled.load(std::sync::atomic::Ordering::SeqCst) {
                            return Err("Injected uncertain Antigravity cleanup".into());
                        }
                    }
                    crate::native::reap_group(pid).await?;
                    if group_exists(pid)? {
                        return Err("Antigravity process group is still present".into());
                    }
                    Ok::<(), String>(())
                }
                .await;
                match settled {
                    Ok(()) => break,
                    Err(error) if !reported_error => {
                        eprintln!("Antigravity process group {pid}: {error}. Retrying cleanup.");
                        reported_error = true;
                    }
                    Err(_) => {}
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
                if signalled.is_err() {
                    signalled = kill_group(pid, libc::SIGKILL);
                }
            }
            drop(owner);
            drop(reservation);
        }))
    }
}

impl Drop for ProcessGroup {
    fn drop(&mut self) {
        if self.child.is_none() {
            return;
        }
        if tokio::runtime::Handle::try_current().is_ok() {
            // Dropping a JoinHandle leaves this cleanup running.
            drop(self.start_reaper());
        } else {
            let _ = kill_group(self.pid, libc::SIGKILL);
            // No executor can confirm settlement. Keep ownership until the
            // host exits rather than make the reservation available.
            std::mem::forget(self.reservation.take());
            std::mem::forget(self.owner.take());
        }
    }
}

fn signal_group(pid: u32, signal: i32) -> std::io::Result<bool> {
    if unsafe { libc::kill(-(pid as i32), signal) } == 0 {
        return Ok(true);
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(false)
    } else {
        Err(error)
    }
}

fn kill_group(pid: u32, signal: i32) -> Result<(), &'static str> {
    signal_group(pid, signal)
        .map(|_| ())
        .map_err(|_| "Cannot signal Antigravity process group")
}

fn group_exists(pid: u32) -> Result<bool, &'static str> {
    signal_group(pid, 0).map_err(|_| "Cannot verify Antigravity process group")
}

pub(super) fn response(message: &Value, id: u64) -> Result<Value, Error> {
    if message["id"] != id || message.get("method").is_some() {
        return Err(Error::Protocol);
    }
    if let Some(error) = message.get("error") {
        let code = error["code"].as_i64();
        let message = error["message"].as_str().unwrap_or("").to_ascii_lowercase();
        return Err(
            if code == Some(-32000)
                || message.contains("authenticat")
                || message.contains("sign in")
                || message.contains("log in")
            {
                // ACP reserves -32000 for authentication required.
                Error::Authentication
            } else {
                Error::Rejected
            },
        );
    }
    message.get("result").cloned().ok_or(Error::Protocol)
}
