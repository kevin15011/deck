use clap::{Parser, Subcommand};
use deck2::{
    Store, launcher, native,
    server::{self, App},
};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::PathBuf,
};
#[derive(Parser)]
#[command(
    name = "deck2",
    version,
    about = "Deck local workspace and canonical development team. Native authentication/cache remain runner-owned."
)]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}
#[derive(Subcommand)]
enum Cmd {
    #[command(hide = true)]
    CodebaseBridge,
    #[command(hide = true)]
    CbmSupervisor {
        #[arg(long)]
        store: PathBuf,
        #[arg(long)]
        service: String,
        #[arg(long,hide=true,value_parser=["intent","draining","prepared","migrated","restored-cache","candidate-selected","recovered","diagnostics"])]
        verification_pause_after: Option<String>,
    },
    /// Start the local host in the background.
    Serve {
        /// Keep the host attached to this terminal.
        #[arg(long)]
        foreground: bool,
        #[arg(long, hide = true)]
        background_child: bool,
        #[arg(long, hide = true)]
        restart_child: bool,
        #[arg(long)]
        project: Option<PathBuf>,
        #[arg(long)]
        state_dir: Option<PathBuf>,
        #[arg(long, default_value = "codex")]
        codex: PathBuf,
        #[arg(long)]
        no_open: bool,
        #[arg(long)]
        opencode: Option<PathBuf>,
        /// Compatibility option for legacy scoped read-only investigation. Canonical team roles use session assignments.
        #[arg(long, requires = "project", conflicts_with_all = ["opencode", "investigator_model"])]
        investigator_codex: bool,
        /// Private shared Deck-owned helper store, independent of project state.
        #[arg(long)]
        artifact_store: Option<PathBuf>,
        /// Read-only original Deck state root. Defaults to XDG_STATE_HOME/deck.
        #[arg(long, conflicts_with = "no_history")]
        history_root: Option<PathBuf>,
        /// Disable discovery of original Deck history for an isolated host.
        #[arg(long)]
        no_history: bool,
        #[arg(long, requires = "project")]
        investigator_model: Option<String>,
        #[arg(long, hide = true)]
        verification_cbm_claims: Option<PathBuf>,
    },
    /// Ask the running host to shut down gracefully.
    Stop {
        #[arg(long)]
        state_dir: Option<PathBuf>,
    },
    /// Manage the original browser identity through this host's private launcher.
    Web {
        #[arg(long)] state_dir: Option<PathBuf>,
        #[command(subcommand)] command: WebCommand,
    },
    /// Open the current host with a fresh, one-use browser capability.
    Open {
        #[arg(long)]
        state_dir: Option<PathBuf>,
        /// Print a one-use private launch URL instead of using the desktop opener.
        #[arg(long)]
        print_url: bool,
    },
    /// Show launcher address without exposing credentials.
    Status {
        #[arg(long)]
        state_dir: Option<PathBuf>,
    },
    /// After inspecting native processes, acknowledge they are stopped. Never replay.
    Recover {
        #[arg(long)]
        state_dir: Option<PathBuf>,
        #[arg(long)]
        confirm_native_stopped: bool,
    },
}
#[derive(Subcommand)]
enum WebCommand {
    Devices,
    Pair,
    Revoke { device_id: String },
}
#[derive(Serialize, Deserialize)]
struct Launch {
    host: String,
    admin: String,
    project: String,
}
fn default_state() -> PathBuf {
    std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".local/state")
        })
        .join("deck2")
}
fn directory(path: Option<PathBuf>) -> Result<PathBuf, String> {
    let p = path.unwrap_or_else(default_state);
    if !p.exists() {
        fs::create_dir_all(&p).map_err(|_| "Cannot create state directory")?;
        fs::set_permissions(&p, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot protect state directory")?;
    }
    let m = fs::symlink_metadata(&p).map_err(|_| "Cannot inspect state directory")?;
    if !m.is_dir() || m.permissions().mode() & 0o077 != 0 {
        return Err("State directory must be a private directory (chmod 700); refusing shared or symlink state".into());
    }
    fs::canonicalize(p).map_err(|_| "Cannot resolve state directory".into())
}
fn lock(p: &std::path::Path) -> Result<std::fs::File, String> {
    let f = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(p.join("host.lock"))
        .map_err(|_| "Cannot open host lock")?;
    f.try_lock_exclusive()
        .map_err(|_| "Deck already owns this state directory; use deck2 open/status")?;
    Ok(f)
}
fn read_launch(p: &std::path::Path) -> Result<Launch, String> {
    serde_json::from_slice(
        &fs::read(p.join("launcher.json"))
            .map_err(|_| "No launcher found. Start deck2 serve")?,
    )
    .map_err(|_| "Invalid launcher record; inspect state before restart".into())
}
fn launch_url(p: &std::path::Path) -> Result<String, String> {
    let l = read_launch(p)?;
    if !l.host.starts_with("127.0.0.1:") {
        return Err("Invalid launcher address".into());
    }
    let mut stream = std::net::TcpStream::connect(&l.host).map_err(
        |_| "Host is not running. Restart deck2 serve with the same state directory.",
    )?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(5)))
        .map_err(|_| "Launcher timeout setup failed")?;
    write!(stream,"POST /launch HTTP/1.1\r\nHost: {}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",l.host,l.admin.len(),l.admin).map_err(|_|"Launcher request failed")?;
    let mut raw = String::new();
    stream
        .take(8192)
        .read_to_string(&mut raw)
        .map_err(|_| "Launcher response failed")?;
    if !raw.starts_with("HTTP/1.1 200") {
        return Err("Launcher rejected. Restart Deck to revoke stale launch records.".into());
    }
    let body = raw
        .split_once("\r\n\r\n")
        .ok_or("Invalid launcher response")?
        .1;
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "Invalid launcher response")?;
    let url = v["url"].as_str().ok_or("Missing launch link")?;
    Ok(url.to_string())
}
fn open_browser(p: &std::path::Path) -> Result<(), String> {
    let url = launch_url(p).map_err(|e| format!("{e}\n{}", launcher::guidance(p)))?;
    launcher::open(&url)
        .map_err(|e| format!("{e}. Host remains running.\n{}", launcher::guidance(p)))?;
    eprintln!("Browser opener completed; browser authentication is not yet confirmed.");
    Ok(())
}
// Keep the launch path across atomic installs, including a symlink to a versioned binary.
fn installed_executable() -> Result<PathBuf, String> {
    let running = std::env::current_exe().map_err(|e| e.to_string())?;
    if let Some(name) = std::env::args_os().next() {
        let name = PathBuf::from(name);
        let paths: Vec<_> = if name.components().count() == 1 {
            std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).map(|dir| dir.join(&name)).collect()
        } else {
            vec![name]
        };
        for candidate in paths {
            if let Ok(path) = std::path::absolute(candidate)
                && path.canonicalize().is_ok_and(|resolved| resolved == running) {
                return Ok(path);
            }
        }
    }
    Ok(running)
}
fn start_background(state: Option<PathBuf>) -> Result<(), String> {
    use std::os::unix::{net::UnixStream, process::CommandExt};
    use std::os::fd::OwnedFd;
    use std::process::{Command, Stdio};

    let state = directory(state)?;
    let log_path = state.join("host.log");
    let log = OpenOptions::new().append(true).create(true).mode(0o600)
        .custom_flags(libc::O_NOFOLLOW).open(&log_path).map_err(|e| e.to_string())?;
    let (mut receiver, sender) = UnixStream::pair().map_err(|e| e.to_string())?;
    let mut command = Command::new(installed_executable()?);
    command.args(std::env::args_os().skip(1)).arg("--background-child")
        .stdin(Stdio::from(OwnedFd::from(sender)))
        .stdout(log.try_clone().map_err(|e| e.to_string())?).stderr(log);
    // setsid is async-signal-safe between fork and exec.
    unsafe { command.pre_exec(|| {
        if libc::setsid() < 0 { return Err(std::io::Error::last_os_error()); }
        Ok(())
    }); }
    let mut child = command.spawn().map_err(|e| format!("Cannot start host: {e}"))?;
    drop(command);
    let mut ready = [0];
    if receiver.read_exact(&mut ready).is_err() || ready != [1] {
        let _ = child.wait();
        return Err(format!("Host failed to start. See {}", log_path.display()));
    }
    println!("Deck is running in the background. Use deck2 open, deck2 status or deck2 stop.");
    Ok(())
}

fn main() {
    let cli = Cli::parse();
    let result = if let Cmd::Serve { foreground: false, background_child: false, restart_child: false, state_dir, .. } = &cli.command {
        start_background(state_dir.clone())
    } else if let Cmd::CbmSupervisor {
        store,
        service,
        verification_pause_after,
    } = &cli.command
    {
        deck2::cbm_runtime::supervisor(store, service, verification_pause_after.as_deref())
    } else {
        tokio::runtime::Runtime::new()
            .expect("host runtime")
            .block_on(run(cli))
    };
    if let Err(e) = result {
        eprintln!("deck2: {e}");
        std::process::exit(1)
    }
}
async fn run(cli: Cli) -> Result<(), String> {
    match cli.command {
        Cmd::CbmSupervisor { .. } => unreachable!(),
        Cmd::CodebaseBridge => codebase_bridge().await,
        Cmd::Stop { state_dir } => {
            let p = directory(state_dir)?;
            let launch = read_launch(&p)?;
            let addr = launch.host.parse::<std::net::SocketAddr>().map_err(|_| "Invalid launcher address")?;
            if !addr.ip().is_loopback() { return Err("Invalid launcher address".into()); }
            let response = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(5)).build().map_err(|e| e.to_string())?
                .post(format!("http://{addr}/web-control"))
                .json(&serde_json::json!({"admin":launch.admin,"command":"stop"}))
                .send().await.map_err(|_| "Host is not reachable")?;
            if !response.status().is_success() { return Err("Host rejected shutdown".into()); }
            println!("Deck shutdown requested.");
            Ok(())
        }
        Cmd::Web {state_dir,command} => {
            let p=directory(state_dir)?; let l=read_launch(&p)?;
            let (name,id)=match command {WebCommand::Devices=>("devices",None),WebCommand::Pair=>("pair",None),WebCommand::Revoke{device_id}=>("revoke",Some(device_id))};
            let result=reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).build().map_err(|_|"Cannot create local client")?
                .post(format!("http://{}/web-control",l.host)).json(&serde_json::json!({"admin":l.admin,"command":name,"deviceId":id})).send().await.map_err(|_|"Local host unavailable")?;
            let success=result.status().is_success(); let body:serde_json::Value=result.json().await.map_err(|_|"Invalid local response")?;
            if !success {return Err(body["code"].as_str().unwrap_or("Device operation unavailable").to_string());}
            println!("{}",serde_json::to_string_pretty(&body).unwrap());Ok(())
        },
        Cmd::Open {
            state_dir,
            print_url,
        } => {
            let p = directory(state_dir)?;
            if print_url {
                println!(
                    "{}",
                    launch_url(&p).map_err(|e| format!("{e}\n{}", launcher::guidance(&p)))?
                );
                Ok(())
            } else {
                open_browser(&p)
            }
        }
        Cmd::Status { state_dir } => {
            let p = directory(state_dir)?;
            let l = read_launch(&p)?;
            let live = std::net::TcpStream::connect(&l.host).is_ok();
            println!(
                "Deck {} · {} · {}",
                if live {
                    "endpoint reachable (identity not verified)"
                } else {
                    "not reachable"
                },
                l.host,
                l.project
            );
            let db = rusqlite::Connection::open_with_flags(
                p.join("state.db"),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .map_err(|_| "Cannot inspect state database")?;
            let mut stmt = db
                .prepare("SELECT body FROM receipts ORDER BY rowid")
                .map_err(|_| "Cannot inspect receipts")?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|_| "Cannot inspect receipts")?;
            for row in rows {
                let r: deck2_shared::Receipt =
                    serde_json::from_str(&row.map_err(|_| "Receipt read failed")?)
                        .map_err(|_| "Corrupt receipt; preserve state for inspection")?;
                println!(
                    "{} · recorded {:?} · native process group {:?} · thread {}",
                    r.id,
                    r.phase,
                    r.native_pid,
                    r.thread.as_deref().unwrap_or("not created")
                );
            }
            let mut diagnostics = db
                .prepare("SELECT id,code,status FROM diagnostics ORDER BY rowid DESC LIMIT 8")
                .map_err(|_| "Cannot inspect bounded diagnostics")?;
            let rows = diagnostics
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, u16>(2)?,
                    ))
                })
                .map_err(|_| "Cannot inspect diagnostics")?;
            for row in rows {
                let (id, code, status) = row.map_err(|_| "Cannot read diagnostic")?;
                println!("Reference {id} · {code} · HTTP {status}");
            }
            Ok(())
        }
        Cmd::Recover {
            state_dir,
            confirm_native_stopped,
        } => {
            if !confirm_native_stopped {
                return Err("Inspect prior Codex processes first; then pass --confirm-native-stopped. This acknowledges unknown outcomes without replaying commands.".into());
            }
            let p = directory(state_dir)?;
            let _lock = lock(&p)?;
            let l = read_launch(&p)?;
            let mut s = Store::open(&p.join("state.db"), &l.project)?;
            println!(
                "Acknowledged {} uncertain receipts; no commands replayed",
                s.recover()?
            );
            Ok(())
        }
        Cmd::Serve {
            foreground: _, background_child, restart_child,
            project,
            state_dir,
            codex,
            no_open,
            opencode,
            investigator_codex,
            artifact_store,
            history_root,
            no_history,
            investigator_model,
            verification_cbm_claims,
        } => {
            let launcher_path = installed_executable()?;
            let browser_cookie = if restart_child {
                let mut bytes = [0u8; 64];
                std::io::stdin().read_exact(&mut bytes).map_err(|_| "Missing restart handoff")?;
                if !bytes.iter().all(u8::is_ascii_hexdigit) { return Err("Invalid restart handoff".into()); }
                String::from_utf8(bytes.to_vec()).map_err(|_| "Invalid restart handoff")?
            } else { server::secret() };
            let startup_signal = if background_child {
                use std::os::fd::{AsFd, AsRawFd};
                let fd = std::io::stdin().as_fd().try_clone_to_owned().map_err(|e| e.to_string())?;
                let null = std::fs::File::open("/dev/null").map_err(|e| e.to_string())?;
                if unsafe { libc::dup2(null.as_raw_fd(), 0) } < 0 { return Err("Cannot detach stdin".into()); }
                Some(std::fs::File::from(fd))
            } else { None };
            if let Some(path) = verification_cbm_claims.as_deref() {
                deck2::cbm_management::verification_claims(path)?;
            }
            let p = directory(state_dir)?;
            let existing_state=p.join("state.db").is_file();
            let project = project.map(|path| -> Result<String, String> {
                let root = match fs::canonicalize(&path) {
                    Ok(root) => root,
                    Err(_) if existing_state && path.is_absolute() => path,
                    Err(_) => return Err("Project does not exist".into()),
                };
                if !root.is_dir() && !existing_state {
                    return Err("Project must be a directory".into());
                }
                root.into_os_string().into_string().map_err(|_| "Project path must be UTF-8".into())
            }).transpose()?;
            let _lock = lock(&p)?;
            let mut store = Store::open(&p.join("state.db"), project.as_deref().unwrap_or(""))?;
            store.init_runner_compaction()?;
            if let Some(root) = &project && std::path::Path::new(root).is_dir() {
                store.select_project_folder(root)?;
            }
            let project = project.unwrap_or_else(|| store.project.clone());
            let launcher = (codex == std::path::Path::new("codex")).then(|| {
                std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
                    .filter(|p| p.is_absolute()).map(|p| p.join("codex"))
                    .find(|p| p.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0))
            }).flatten();
            let codex = launcher.clone().unwrap_or(codex);
            let availability = native::version(&codex).await.err();
            // Reuse this state's browser origin so scoped drafts survive restart.
            // Never silently move to another port if it is occupied.
            let address = if p.join("launcher.json").exists() {
                let previous = read_launch(&p)?;
                let addr: std::net::SocketAddr = previous
                    .host
                    .parse()
                    .map_err(|_| "Invalid saved loopback address")?;
                if addr.ip() != std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
                    || addr.port() == 0
                {
                    return Err("Saved host does not match this project/loopback boundary".into());
                }
                previous.host
            } else {
                "127.0.0.1:0".into()
            };
            let listener = tokio::net::TcpListener::bind(&address)
                .await
                .map_err(|_| "Cannot bind this state's loopback address. Another process may own it; stop that process before reopening. Saved browser drafts remain at this address.")?;
            let host = listener
                .local_addr()
                .map_err(|_| "Cannot read local address")?
                .to_string();
            let admin = server::secret();
            let l = Launch {
                host: host.clone(),
                admin: admin.clone(),
                project: project.clone(),
            };
            let mut f = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(p.join("launcher.json"))
                .map_err(|_| "Cannot write private launcher")?;
            f.write_all(&serde_json::to_vec(&l).unwrap())
                .and_then(|_| f.sync_all())
                .map_err(|_| "Cannot persist launcher")?;
            let app = App::with_browser_cookie(
                store,
                host.clone(),
                codex,
                availability,
                admin,
                launcher::recovery(&p),
                browser_cookie,
            );
            app.restart.enable(launcher_path.clone());
            if let Some(launcher) = launcher {
                let mut previous = None;
                if let Err(e) = deck2::runner_management::follow_codex_launcher(&app, &launcher, &mut previous).await {
                    eprintln!("Codex launcher discovery: {e}");
                }
                let host = app.clone();
                tokio::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                        let _ = deck2::runner_management::follow_codex_launcher(&host, &launcher, &mut previous).await;
                    }
                });
            }
            let app=app.project_context(&deck2::projects::id(&project)).unwrap_or(app);
            app.history_root(if no_history {
                None
            } else {
                history_root.or_else(|| {
                    if artifact_store.is_none() {
                        deck2::history::default_root()
                    } else {
                        None
                    }
                })
            });
            let original = app.history_source();
            let mut identity = deck2::web_identity::Identity::discover(original, no_history || artifact_store.is_some())?;
            identity.local_state = Some(p.clone());
            app.browser_identity(identity);
            app.adopt_history(p.join("original-history.db")).await;
            deck2::web_push::start(app.clone(),p.clone());
            deck2::native::start_zombie_reaper(app.clone());
            println!(
                "Deck host ready on {host}\nRead-only project execution; Codex may refresh its own auth/cache.\n{}\nStop host: deck2 stop (use the same state directory). Browser closure keeps it running.",
                launcher::guidance(&p)
            );
            *app.artifact_store.lock().unwrap() = artifact_store;
            if investigator_codex {
                match deck2::opencode::Runner::prepare_codex(
                    &app.selected_binary()?,
                    &p,
                    std::path::Path::new(&project),
                    deck2::opencode::read_tools(),
                    None,
                )
                .await
                {
                    Ok(r) => {
                        app.store.lock().unwrap().register_assignment_for(&app.project,
                            deck2::configuration::assignment_from_runner(&r),
                        )?;
                        *app.team.lock().unwrap() = Some(r);
                        eprintln!("Codex Investigator prepared with scoped dynamic tools");
                    }
                    Err(e) => {
                        eprintln!("Codex Investigator unavailable: {e}");
                        *app.team_unavailable.lock().unwrap() = e;
                    }
                }
            }
            if let (Some(binary), Some(model)) =
                (opencode.as_deref(), investigator_model.as_deref())
            {
                match deck2::opencode::Runner::prepare(
                    binary,
                    model,
                    &p,
                    std::path::Path::new(&project),
                )
                .await
                {
                    Ok(r) => {
                        eprintln!(
                            "Investigator prepared in {} ms. Native authentication/logging remain runner-owned.",
                            r.preparation_ms
                        );
                        app.store.lock().unwrap().register_assignment_for(&app.project,
                            deck2::configuration::assignment_from_runner(&r),
                        )?;
                        *app.team.lock().unwrap() = Some(r);
                    }
                    Err(e) => {
                        eprintln!("Investigator unavailable: {e}");
                        *app.team_unavailable.lock().unwrap() = e;
                    }
                }
            }
            let cloned = app.clone();
            let server =
                axum::serve(listener, server::router(app.clone()).into_make_service_with_connect_info::<std::net::SocketAddr>()).with_graceful_shutdown(async move {
                    tokio::select! {
                        _ = tokio::signal::ctrl_c() => {},
                        _ = cloned.stop_request.notified() => {},
                    }
                    cloned.close_workspace_updates();
                    if !cloned.restart.pending() { cloned.shutdown(); }
                    deck2::dictation::close(&cloned).await;
                });
            if !no_open && !restart_child {
                let path = p.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    let _ = tokio::task::spawn_blocking(move || {
                        if let Err(e) = open_browser(&path) {
                            eprintln!("deck2: {e}")
                        }
                    })
                    .await;
                });
            }
            if let Some(mut ready) = startup_signal {
                ready.write_all(&[1]).map_err(|_| "Startup client disconnected")?;
            }
            app.pump_queue();
            let result = server
                .await
                .map_err(|_| "Local host transport failed".to_string());
            if app.shutdown_requested.load(std::sync::atomic::Ordering::SeqCst) && !app.restart.pending() {
                app.drain_shutdown().await;
            }
            deck2::session_mcp::close_codebase().await;
            result?;
            if let Some(candidate) = app.restart.take() {
                app.retire_native().await?;
                use std::os::{fd::{AsRawFd, OwnedFd}, unix::{net::UnixStream, process::CommandExt}};
                let (reader, mut writer) = UnixStream::pair().map_err(|e| e.to_string())?;
                app.write_restart_cookie(&mut writer).map_err(|e| e.to_string())?;
                drop(writer);
                let args = std::env::args_os().skip(1).filter(|v| v != "--background-child" && v != "--restart-child");
                let err = std::process::Command::new(format!("/proc/self/fd/{}", candidate.as_raw_fd()))
                    .arg0(launcher_path).args(args).arg("--restart-child")
                    .stdin(std::process::Stdio::from(OwnedFd::from(reader))).exec();
                return Err(format!("Cannot restart Deck: {err}"));
            }
            Ok(())
        }
    }
}

async fn codebase_bridge() -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
    let endpoint = std::env::var("DECK_CBM_ENDPOINT").map_err(|_| "Codebase endpoint missing")?;
    let auth =
        std::env::var("DECK2_SESSION_AUTHORIZATION").map_err(|_| "Codebase credential missing")?;
    if !endpoint.starts_with("http://127.0.0.1:") || !endpoint.ends_with("/codebase") {
        return Err("Invalid codebase endpoint".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(140))
        .build()
        .map_err(|_| "Codebase client unavailable")?;
    let mut input = tokio::io::BufReader::new(tokio::io::stdin());
    let mut output = tokio::io::stdout();
    loop {
        let mut line = Vec::new();
        let n = (&mut input)
            .take(65537)
            .read_until(b'\n', &mut line)
            .await
            .map_err(|_| "Codebase input failed")?;
        if n == 0 {
            return Ok(());
        }
        if n > 65536 {
            return Err("Codebase input overflow".into());
        }
        let v: serde_json::Value =
            serde_json::from_slice(&line).map_err(|_| "Invalid codebase request")?;
        if v.get("id").is_none() {
            continue;
        }
        let response = client
            .post(&endpoint)
            .header("authorization", &auth)
            // Preserve the wire object so the retained transport can reject
            // duplicate metadata before serde normalization could erase it.
            .header("content-type", "application/json")
            .body(line)
            .send()
            .await
            .map_err(|_| "Codebase transport unavailable")?;
        if !response.status().is_success() {
            return Err("Codebase authority unavailable".into());
        }
        let response: serde_json::Value = response
            .json()
            .await
            .map_err(|_| "Codebase response invalid")?;
        let mut bytes = serde_json::to_vec(&response).map_err(|_| "Codebase response invalid")?;
        bytes.push(b'\n');
        output
            .write_all(&bytes)
            .await
            .map_err(|_| "Codebase output failed")?;
        output.flush().await.map_err(|_| "Codebase output failed")?;
    }
}
