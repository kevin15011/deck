use std::{
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    path::Path,
    process::Stdio,
    sync::{Arc, LazyLock},
    time::Duration,
};

use axum::Json;
use serde_json::{Value, json};
use tokio::{
    process::Command,
    sync::{Mutex, watch},
    time::{Instant, timeout},
};

use crate::agy_acp::{Client, Error, ProcessGroup, STARTUP_TIMEOUT};

const QUOTA_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_QUOTA_BYTES: usize = 256 * 1024;
const QUOTA_CAPTURE_COMMAND: &str = r#"tmp="${DECK_AGY_QUOTA_OUT}.tmp.$$"; head -c 262144 > "$tmp" && mv -f "$tmp" "$DECK_AGY_QUOTA_OUT""#;

type Probe = Result<Value, &'static str>;
struct Entry {
    identity: String,
    expires: Instant,
    state: Probe,
}
static PROBE_SLOT: LazyLock<Arc<Mutex<()>>> = LazyLock::new(Default::default);
static CACHE: LazyLock<Mutex<Option<Entry>>> = LazyLock::new(Default::default);

pub(crate) async fn inventory() -> Value {
    let state = async {
        let binary = crate::agy::executable().map_err(|_| "not_installed")?;
        let hash_path = binary.clone();
        let identity = tokio::task::spawn_blocking(move || crate::agy::binary_key(&hash_path))
            .await
            .map_err(|_| "executable_unavailable")?
            .map_err(|_| "executable_unavailable")?;
        let mut cache = CACHE.lock().await;
        if let Some(entry) = cache
            .as_ref()
            .filter(|entry| entry.identity == identity && entry.expires > Instant::now())
        {
            return entry.state.clone();
        }
        let state = probe(&binary).await;
        let ttl = if state.is_ok() {
            Duration::from_secs(300)
        } else {
            Duration::from_secs(15)
        };
        *cache = Some(Entry {
            identity,
            expires: Instant::now() + ttl,
            state: state.clone(),
        });
        state
    }
    .await;
    let mut view =
        json!({"runnerId":"agy","label":"Antigravity","available":state.is_ok(),"models":[]});
    match state {
        Ok(state) => {
            view["version"] = state["version"].clone();
            view["models"] = state["models"].clone();
        }
        Err(code) => {
            view["reasonCode"] = json!(format!("agy_{code}"));
            view["reason"] = json!(match code {
                "not_installed" => "Install Antigravity on the Deck host and add agy to PATH.",
                "signed_out" => "Sign in with agy acp --login on the Deck host, then try again.",
                "catalog_unavailable" => "Check that the Antigravity account offers ACP models.",
                "incompatible" =>
                    "Update Antigravity to a version that supports ACP sessions and model discovery.",
                _ =>
                    "Run agy acp on the Deck host to check startup and connectivity, then try again.",
            });
        }
    }
    view
}

pub(crate) async fn readiness() -> Json<Value> {
    Json(inventory().await)
}

pub(super) async fn probe(binary: &Path) -> Probe {
    let slot = PROBE_SLOT.clone().lock_owned().await;
    let dir = tempfile::tempdir().map_err(|_| "probe_unavailable")?;
    let cwd = dir.path().to_owned();
    let mut client = Client::spawn(binary, &cwd, false).map_err(|_| "probe_unavailable")?;
    client.hold_cleanup((dir, slot));
    let result = timeout(STARTUP_TIMEOUT, async {
        let initialized = client.initialize().await?;
        let version = initialized["agentInfo"]["version"]
            .as_str()
            .filter(|s| {
                !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_digit() || b == b'.')
            })
            .ok_or(Error::Protocol)?;
        let session = client
            .call("session/new", json!({"cwd":cwd,"mcpServers":[]}))
            .await?;
        let id = super::agy::session_id(&session).ok_or(Error::Protocol)?;
        if initialized["agentCapabilities"]["sessionCapabilities"]["close"].is_object() {
            let _ = timeout(
                Duration::from_secs(1),
                client.call("session/close", json!({"sessionId":id})),
            )
            .await;
        }
        Ok::<_, Error>((version.to_owned(), catalog(&session)))
    })
    .await;
    client.stop().await.map_err(|_| "probe_unavailable")?;
    let (version, models) = match result {
        Ok(Ok(data)) => data,
        Ok(Err(Error::Authentication)) => return Err("signed_out"),
        Ok(Err(Error::Protocol)) => return Err("incompatible"),
        _ => return Err("probe_unavailable"),
    };
    if models.is_empty() {
        return Err("catalog_unavailable");
    }
    // Opening a native session confirms auth and tier eligibility. Keep the
    // account and provider's raw tier metadata private.
    Ok(json!({"version":version,"models":models}))
}

pub(super) fn catalog(session: &Value) -> Vec<Value> {
    let variants = session["models"]["availableModels"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| model["modelId"].as_str())
        .collect::<std::collections::HashSet<_>>();
    let options = session["configOptions"].as_array().into_iter().flatten();
    let mut seen = std::collections::HashSet::new();
    options
        .filter(|item| item["id"] == "model")
        .flat_map(|item| item["options"].as_array().into_iter().flatten())
        .filter_map(|item| {
            let id = item["value"]
                .as_str()
                .filter(|id| crate::agy::valid_id(id, 160))?;
            let name = item["name"].as_str().filter(|name| {
                !name.is_empty() && name.len() <= 160 && !name.chars().any(char::is_control)
            })?;
            if !seen.insert(id) {
                return None;
            }
            let levels = ["low", "medium", "high", "xhigh"]
                .into_iter()
                .filter(|level| variants.contains(format!("{id}-{level}").as_str()))
                .collect::<Vec<_>>();
            Some(json!({"modelId":id,"label":name,"thinkingLevels":levels}))
        })
        .collect()
}

pub(crate) async fn read_quota(cancel: watch::Receiver<bool>) -> Result<Value, String> {
    let binary = crate::agy::executable()?;
    read_quota_from(&binary, cancel).await
}

pub(crate) async fn read_quota_from(
    binary: &Path,
    mut cancel: watch::Receiver<bool>,
) -> Result<Value, String> {
    if *cancel.borrow() {
        return Err("Antigravity quota refresh stopped.".into());
    }
    let dir = tempfile::tempdir().map_err(|_| "Antigravity quota directory unavailable")?;
    let out_path = dir.path().join("quota.json");
    let settings_path = dir.path().join("settings.json");
    let settings = json!({
        "statusLine": {
            "type": "command",
            "command": QUOTA_CAPTURE_COMMAND,
            "enabled": true,
        }
    });
    std::fs::write(&settings_path, settings.to_string())
        .map_err(|_| "Could not write Antigravity quota settings.")?;
    let (master, slave) = open_pty()?;
    let stdin = Stdio::from(
        slave
            .try_clone()
            .map_err(|_| "Could not prepare terminal stdin for Antigravity quota.")?,
    );
    let stdout = Stdio::from(
        slave
            .try_clone()
            .map_err(|_| "Could not prepare terminal stdout for Antigravity quota.")?,
    );
    let stderr = Stdio::from(slave);

    if unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1) } != 0 {
        return Err("Cannot establish native process ownership".into());
    }
    let parent = std::process::id() as i32;
    let mut command = Command::new(binary);
    command
        .arg("--settings")
        .arg(&settings_path)
        .current_dir(dir.path())
        .env("TERM", "xterm-256color")
        .env("DECK_AGY_QUOTA_OUT", &out_path)
        .stdin(stdin)
        .stdout(stdout)
        .stderr(stderr)
        .kill_on_drop(true);
    unsafe {
        command.pre_exec(move || {
            if libc::setsid() < 0 || libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            let _ = libc::ioctl(0, libc::TIOCSCTTY as _, 0);
            if libc::getppid() != parent {
                return Err(std::io::Error::other("Native process parent exited"));
            }
            Ok(())
        });
    }
    let child = command
        .spawn()
        .map_err(|_| "Could not start Antigravity to check subscription quota.")?;
    let pid = child
        .id()
        .ok_or("Antigravity quota process PID unavailable")?;
    let mut guard = ProcessGroup::new(child, pid);
    guard.hold_cleanup(dir);

    let mut result = Err("Antigravity did not report subscription quota.".into());
    let deadline = Instant::now() + QUOTA_TIMEOUT;
    let mut scratch = [0u8; 4096];
    loop {
        // Keep the PTY master drained so interactive rendering never blocks on a full buffer.
        for _ in 0..16 {
            let n = unsafe {
                libc::read(
                    master.as_raw_fd(),
                    scratch.as_mut_ptr().cast(),
                    scratch.len(),
                )
            };
            if n <= 0 {
                break;
            }
        }
        if let Some(payload) = read_quota_payload(&out_path) {
            result = Ok(payload);
            break;
        }
        let exited = guard
            .child
            .as_mut()
            .and_then(|c| c.try_wait().ok().flatten())
            .is_some();
        if exited {
            if let Some(payload) = read_quota_payload(&out_path) {
                result = Ok(payload);
            }
            break;
        }
        if Instant::now() >= deadline {
            result = Err("Antigravity quota refresh timed out.".into());
            break;
        }
        tokio::select! {
            _ = cancel.wait_for(|stop| *stop) => {
                result = Err("Antigravity quota refresh stopped.".into());
                break;
            }
            _ = tokio::time::sleep(Duration::from_millis(50)) => {}
        }
    }

    drop(master);
    guard.stop().await?;
    result
}

fn read_quota_payload(path: &Path) -> Option<Value> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.is_empty() || bytes.len() > MAX_QUOTA_BYTES {
        return None;
    }
    let parsed: Value = serde_json::from_slice(&bytes).ok()?;
    let quota = parsed.get("quota")?.as_object()?;
    if quota.contains_key("gemini-5h") || quota.contains_key("gemini-weekly") {
        Some(parsed)
    } else {
        None
    }
}

fn open_pty() -> Result<(OwnedFd, OwnedFd), String> {
    let master = unsafe { libc::posix_openpt(libc::O_RDWR | libc::O_NOCTTY | libc::O_CLOEXEC) };
    if master < 0 {
        return Err("Could not allocate terminal for Antigravity quota check.".into());
    }
    let master = unsafe { OwnedFd::from_raw_fd(master) };
    if unsafe { libc::grantpt(master.as_raw_fd()) } != 0
        || unsafe { libc::unlockpt(master.as_raw_fd()) } != 0
    {
        return Err("Could not prepare terminal for Antigravity quota check.".into());
    }
    let mut name = [0 as libc::c_char; 128];
    if unsafe { libc::ptsname_r(master.as_raw_fd(), name.as_mut_ptr(), name.len()) } != 0 {
        return Err("Could not resolve terminal for Antigravity quota check.".into());
    }
    let slave = unsafe {
        libc::open(
            name.as_ptr(),
            libc::O_RDWR | libc::O_NOCTTY | libc::O_CLOEXEC,
        )
    };
    if slave < 0 {
        return Err("Could not open terminal for Antigravity quota check.".into());
    }
    let slave = unsafe { OwnedFd::from_raw_fd(slave) };
    let winsize = libc::winsize {
        ws_row: 40,
        ws_col: 120,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    let _ = unsafe { libc::ioctl(slave.as_raw_fd(), libc::TIOCSWINSZ, &winsize) };
    let flags = unsafe { libc::fcntl(master.as_raw_fd(), libc::F_GETFL) };
    if flags >= 0 {
        let _ = unsafe { libc::fcntl(master.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) };
    }
    Ok((master, slave))
}
