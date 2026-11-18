//! Linux-only, packaged supervisor. No shell, interpreter, user daemon or runner profile.
use crate::{
    cbm_artifacts::{Artifacts, release},
    cbm_service::Service,
};
use serde_json::{Value, json};
use std::{
    fs::{self, File},
    io::{Read, Write},
    os::{
        fd::{AsRawFd, RawFd},
        unix::{
            fs::PermissionsExt,
            net::{UnixListener, UnixStream},
        },
    },
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio},
    time::{Duration, Instant},
};
const FRAME: usize = 1024 * 1024;
fn io(e: std::io::Error) -> String {
    format!("CBM runtime IO: {e}")
}
fn c(p: &Path) -> Result<std::ffi::CString, String> {
    std::ffi::CString::new(p.as_os_str().as_encoded_bytes())
        .map_err(|_| "Invalid runtime path".into())
}
fn syscall(n: i32) -> Result<(), String> {
    if n < 0 {
        Err(io(std::io::Error::last_os_error()))
    } else {
        Ok(())
    }
}
fn mount(
    source: Option<&Path>,
    target: &Path,
    kind: Option<&str>,
    flags: libc::c_ulong,
    data: Option<&str>,
) -> Result<(), String> {
    let s = source.map(c).transpose()?;
    let t = c(target)?;
    let k = kind.map(|s| std::ffi::CString::new(s).unwrap());
    let d = data.map(|s| std::ffi::CString::new(s).unwrap());
    syscall(unsafe {
        libc::mount(
            s.as_ref().map_or(std::ptr::null(), |s| s.as_ptr()),
            t.as_ptr(),
            k.as_ref().map_or(std::ptr::null(), |s| s.as_ptr()),
            flags,
            d.as_ref().map_or(std::ptr::null(), |s| s.as_ptr().cast()),
        )
    })
    .map_err(|e| {
        format!(
            "Mount {:?} -> {} flags {flags}: {e}",
            source,
            target.display()
        )
    })
}
fn bind(source: &Path, target: &Path, readonly: bool) -> Result<(), String> {
    mount(Some(source), target, None, libc::MS_BIND, None)?;
    if readonly {
        mount(
            None,
            target,
            None,
            libc::MS_BIND | libc::MS_REMOUNT | libc::MS_RDONLY | libc::MS_NOSUID,
            None,
        )?
    }
    Ok(())
}
fn mkdir(p: &Path) -> Result<(), String> {
    fs::create_dir_all(p).map_err(io)
}
fn timeout_poll(fd: RawFd, events: i16, until: Instant) -> Result<i16, String> {
    let left = until
        .checked_duration_since(Instant::now())
        .ok_or("CBM protocol deadline")?;
    let mut p = libc::pollfd {
        fd,
        events,
        revents: 0,
    };
    let result = unsafe { libc::poll(&mut p, 1, left.as_millis().min(100) as i32) };
    if result < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
        return Err(io(std::io::Error::last_os_error()));
    }
    Ok(p.revents)
}
fn line(stream: &mut impl Read, cap: usize) -> Result<Vec<u8>, String> {
    let mut b = vec![];
    loop {
        let mut x = [0];
        if stream.read(&mut x).map_err(io)? == 0 {
            return Err("CBM endpoint EOF before frame".into());
        }
        if x[0] == b'\n' {
            return Ok(b);
        }
        b.push(x[0]);
        if b.len() > cap {
            return Err("CBM frame overflow".into());
        }
    }
}
pub fn control(path: &Path, request: &Value) -> Result<Value, String> {
    let directory = crate::managed_tools::Directory::open_root(path)?;
    let mut s = UnixStream::connect(directory.path().join("control.sock"))
        .map_err(|_| "Managed supervisor unavailable; reconcile and explicitly reprepare")?;
    s.set_read_timeout(Some(Duration::from_secs(120)))
        .map_err(io)?;
    s.set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(io)?;
    let mut b = serde_json::to_vec(request).map_err(|_| "Cannot encode control request")?;
    if b.len() > 65536 {
        return Err("Control request exceeds bound".into());
    }
    b.push(b'\n');
    s.write_all(&b).map_err(io)?;
    let v: Value =
        serde_json::from_slice(&line(&mut s, FRAME)?).map_err(|_| "Invalid supervisor response")?;
    if let Some(e) = v["error"].as_str() {
        return Err(e.into());
    }
    Ok(v)
}
// All descriptors except stdio, the singleton lock and the control listener are closed.
fn close_others(keep: &[RawFd]) -> Result<(), String> {
    let entries = fs::read_dir("/proc/self/fd")
        .map_err(io)?
        .filter_map(Result::ok)
        .filter_map(|e| e.file_name().to_str()?.parse::<i32>().ok())
        .collect::<Vec<_>>();
    for fd in entries {
        if fd > 2 && !keep.contains(&fd) {
            unsafe {
                libc::close(fd);
            }
        }
    }
    Ok(())
}
fn identity() -> Result<String, String> {
    let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id").map_err(io)?;
    let stat = fs::read_to_string("/proc/self/stat").map_err(io)?;
    let start = stat
        .rsplit_once(')')
        .ok_or("Invalid process identity")?
        .1
        .split_whitespace()
        .nth(19)
        .ok_or("Missing process identity")?;
    Ok(format!("{}:{}:{}", boot.trim(), std::process::id(), start))
}
/// Must be invoked before starting the multithreaded host runtime.
// Explicit CLI-only fixture scheduling. Normal web launches never set this.
// It pauses only after a real durable phase; external tests perform actual process death.
static VERIFICATION_PAUSE: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
static PAUSED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
// Private opt-in qualification evidence only. Web launches never enable this;
// native stderr is bounded and never returned through model/browser responses.
static VERIFICATION_STDERR: std::sync::OnceLock<std::sync::Mutex<File>> =
    std::sync::OnceLock::new();
// Bounded lifecycle metadata only: never source, arguments, protocol bodies or stderr.
static DIAGNOSTICS: std::sync::OnceLock<std::sync::Mutex<File>> = std::sync::OnceLock::new();
fn diagnostic(event: Value) {
    if let Some(log) = DIAGNOSTICS.get()
        && let Ok(mut log) = log.lock()
        && log.metadata().is_ok_and(|m| m.len() < 65536)
    {
        let _ = writeln!(log, "{}", json!({"at_ms":crate::now(),"event":event}));
        let _ = log.sync_data();
    }
}
pub fn supervisor(
    root: &Path,
    id: &str,
    verification_pause_after: Option<&str>,
) -> Result<(), String> {
    let _ = VERIFICATION_PAUSE.set(verification_pause_after.map(str::to_owned));
    let service = Service::open(root, id)?;
    let singleton = service.directory.lock("supervisor.lock")?;
    service.record()?;
    let artifacts = Artifacts::open(root)?;
    // Stable aliases always identify the same immutable release across restarts.
    // Runtime state/leases must never observe a path retargeted by selection.
    let old = artifacts.verify(&release("0.12.0")?)?;
    let new = artifacts.verify(&release("0.12.1")?).ok();
    let socket = service.path.join("control.sock");
    if socket.symlink_metadata().is_ok() {
        let m = socket.symlink_metadata().map_err(io)?;
        use std::os::unix::fs::{FileTypeExt, MetadataExt};
        if !m.file_type().is_socket() || m.uid() != unsafe { libc::geteuid() } {
            return Err("Foreign control endpoint preserved".into());
        }
        fs::remove_file(&socket).map_err(io)?;
    }
    let listener = UnixListener::bind(service.directory.path().join("control.sock")).map_err(io)?;
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600)).map_err(io)?;
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("Inherited home unavailable")?;
    if !home.starts_with("/home") || home == Path::new("/home") {
        return Err("Unsupported home identity for managed namespace".into());
    }
    let outer_identity = identity()?;
    {
        let _g = service.gate()?;
        let mut r = service.record()?;
        r.supervisor = Some(outer_identity);
        service.save(&r)?;
    }
    let uid = unsafe { libc::getuid() };
    let gid = unsafe { libc::getgid() };
    syscall(unsafe { libc::unshare(libc::CLONE_NEWUSER) })
        .map_err(|e| format!("User namespace: {e}"))?;
    fs::write("/proc/self/setgroups", "deny").map_err(io)?;
    fs::write("/proc/self/uid_map", format!("0 {uid} 1\n")).map_err(io)?;
    fs::write("/proc/self/gid_map", format!("0 {gid} 1\n")).map_err(io)?;
    syscall(unsafe {
        libc::unshare(
            libc::CLONE_NEWNS | libc::CLONE_NEWNET | libc::CLONE_NEWIPC | libc::CLONE_NEWPID,
        )
    })
    .map_err(|e| format!("Private namespaces: {e}"))?;
    for (resource, bound) in [
        (libc::RLIMIT_CORE, 0),
        (libc::RLIMIT_NOFILE, 256),
        (libc::RLIMIT_FSIZE, 256 * 1024 * 1024),
        (libc::RLIMIT_AS, 8 * 1024 * 1024 * 1024),
    ] {
        let limit = libc::rlimit {
            rlim_cur: bound,
            rlim_max: bound,
        };
        syscall(unsafe { libc::setrlimit(resource, &limit) })?;
    }
    let parent = unsafe { libc::getpid() };
    let parent_fd = unsafe { libc::syscall(libc::SYS_pidfd_open, parent, 0) } as i32;
    if parent_fd < 0 {
        return Err("Cannot bind supervisor parent lifetime".into());
    }
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        return Err(io(std::io::Error::last_os_error()));
    }
    if pid > 0 {
        let mut status = 0;
        loop {
            let n = unsafe { libc::waitpid(pid, &mut status, 0) };
            if n == pid {
                break;
            }
            if n < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
                return Err("Supervisor wait failed".into());
            }
        }
        if status != 0 {
            return Err("Managed namespace exited; reconcile service before reuse".into());
        }
        return Ok(());
    }
    // PID1 belongs to this supervisor only; its death kills even setsid/stopped descendants.
    let result = (|| {
        syscall(unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) })?;
        let mut parent_poll = libc::pollfd {
            fd: parent_fd,
            events: libc::POLLIN,
            revents: 0,
        };
        if unsafe { libc::poll(&mut parent_poll, 1, 0) } != 0 {
            return Err("Supervisor parent lost".into());
        }
        let sandbox = service.path.join("sandbox");
        mkdir(&sandbox)?;
        mount(
            None,
            Path::new("/"),
            None,
            libc::MS_REC | libc::MS_PRIVATE,
            None,
        )?;
        mount(
            Some(Path::new("tmpfs")),
            &sandbox,
            Some("tmpfs"),
            libc::MS_NOSUID,
            Some("mode=0755,size=32m"),
        )?;
        for d in ["proc", "tmp", "scope/repo", "state", "runtime", "dev"] {
            mkdir(&sandbox.join(d))?;
        }
        mkdir(&sandbox.join(home.strip_prefix("/").unwrap()))?;
        for name in ["null", "urandom"] {
            let p = sandbox.join("dev").join(name);
            File::create(&p).map_err(io)?;
            bind(&Path::new("/dev").join(name), &p, false)?;
        }
        for (v, name) in [Some((&old, "cbm")), new.as_ref().map(|v| (v, "cbm-other"))]
            .into_iter()
            .flatten()
        {
            v.check()?;
            let p = sandbox.join(name);
            File::create(&p).map_err(io)?;
            let source =
                fs::canonicalize(format!("/proc/self/fd/{}", v.file.as_raw_fd())).map_err(io)?;
            bind(&source, &p, true)?;
            use std::os::unix::fs::MetadataExt;
            let mounted = fs::metadata(&p).map_err(io)?;
            let pinned = v.file.metadata().map_err(io)?;
            if mounted.dev() != pinned.dev() || mounted.ino() != pinned.ino() {
                return Err("Mounted CBM differs from verified handle".into());
            }
            v.check()?;
        }
        let snap = service.snapshot()?;
        bind(
            &service.path.join(&snap.digest).join("source"),
            &sandbox.join("scope/repo"),
            true,
        )?;
        // The private service journal is owned writable data, never the host or project.
        // Journal stays behind a supervisor-only descriptor; it is never mounted for CBM.
        bind(&service.path.join("state"), &sandbox.join("state"), false)?;
        bind(
            &service.path.join("runtime"),
            &sandbox.join("runtime"),
            false,
        )?;
        mount(
            Some(Path::new("tmpfs")),
            &sandbox.join("tmp"),
            Some("tmpfs"),
            libc::MS_NOSUID | libc::MS_NODEV,
            Some("mode=1777,size=64m"),
        )?;
        mount(
            Some(Path::new("proc")),
            &sandbox.join("proc"),
            Some("proc"),
            libc::MS_NOSUID | libc::MS_NODEV | libc::MS_NOEXEC,
            None,
        )?;
        syscall(unsafe { libc::chdir(c(&sandbox)?.as_ptr()) })?;
        syscall(unsafe { libc::chroot(c".".as_ptr()) })?;
        syscall(unsafe { libc::chdir(c"/".as_ptr()) })?;
        snap.verify_materialized(Path::new("/scope/repo"))?;
        let local_fd = service.directory.0.try_clone().map_err(io)?;
        let local = Service {
            store_identity: service.store_identity.clone(),
            id: id.into(),
            path: PathBuf::from(format!("/proc/self/fd/{}", local_fd.as_raw_fd())),
            directory: crate::managed_tools::Directory(local_fd),
        };
        syscall(unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0) })?;
        let mut retained = vec![
            listener.as_raw_fd(),
            singleton.as_raw_fd(),
            local.directory.0.as_raw_fd(),
            old.file.as_raw_fd(),
        ];
        if let Some(pin) = &new {
            retained.push(pin.file.as_raw_fd());
        }
        close_others(&retained)?;
        // Do not drop pre-chroot descriptor wrappers after closing them: an FD number
        // could be reused by later native processes. This process exits via _exit.
        std::mem::forget(artifacts);
        std::mem::forget(service);

        let mut pins = vec![&old];
        if let Some(pin) = &new {
            pins.push(pin);
        }
        let result = serve(listener, &local, &home, &pins);
        cleanup();
        result
    })();
    if let Err(e) = &result {
        eprintln!("{e}")
    }
    unsafe { libc::_exit(if result.is_ok() { 0 } else { 1 }) }
}
fn cleanup() {
    unsafe {
        libc::kill(-1, libc::SIGCONT);
        libc::kill(-1, libc::SIGKILL);
    }
    let end = Instant::now() + Duration::from_secs(3);
    while Instant::now() < end {
        let n = unsafe { libc::waitpid(-1, std::ptr::null_mut(), libc::WNOHANG) };
        if n < 0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
// Created immediately after spawn, before descriptor setup or protocol validation can fail.
// A failed settlement retains the Child handle; callers retain the matching launch/runtime lease.
struct Process {
    child: Option<Child>,
    owned_group: bool,
    confirmed: std::sync::Arc<std::sync::atomic::AtomicBool>,
}
static UNSETTLED_CHILDREN: std::sync::OnceLock<std::sync::Mutex<Vec<Child>>> =
    std::sync::OnceLock::new();
impl std::ops::Deref for Process {
    type Target = Child;
    fn deref(&self) -> &Child {
        self.child.as_ref().unwrap()
    }
}
impl std::ops::DerefMut for Process {
    fn deref_mut(&mut self) -> &mut Child {
        self.child.as_mut().unwrap()
    }
}
impl Process {
    fn new(
        child: Child,
        owned_group: bool,
        confirmed: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) -> Self {
        confirmed.store(false, std::sync::atomic::Ordering::SeqCst);
        Self {
            child: Some(child),
            owned_group,
            confirmed,
        }
    }
    fn settle(&mut self) -> Result<(), String> {
        use std::sync::atomic::Ordering;
        if self.confirmed.load(Ordering::SeqCst) {
            return Ok(());
        }
        let group = self.id() as i32;
        if self.owned_group {
            unsafe {
                libc::kill(-group, libc::SIGKILL);
            }
        } else {
            let _ = self.kill();
        }
        let until = Instant::now() + Duration::from_secs(2);
        loop {
            let exited = self.try_wait().map_err(io)?.is_some();
            if exited && self.owned_group {
                // Subreaper adoption can lag the direct child's exit. Reap only our private group.
                while unsafe { libc::waitpid(-group, std::ptr::null_mut(), libc::WNOHANG) } > 0 {}
            }
            let group_gone = !self.owned_group
                || (unsafe { libc::kill(-group, 0) } < 0
                    && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH));
            if exited && group_gone {
                self.confirmed.store(true, Ordering::SeqCst);
                return Ok(());
            }
            if Instant::now() >= until {
                return Err("CBM group settlement unconfirmed".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        if self.settle().is_err() {
            diagnostic(
                json!({"client_pid":self.id(),"stage":"private-group-settlement-unconfirmed"}),
            );
            UNSETTLED_CHILDREN
                .get_or_init(Default::default)
                .lock()
                .unwrap()
                .push(self.child.take().unwrap());
        }
    }
}
pub(crate) type Environment = std::collections::BTreeMap<std::ffi::OsString, std::ffi::OsString>;
pub(crate) fn native_environment(spec: &Value) -> Result<Environment, String> {
    let mut environment: Environment = std::env::vars_os().collect();
    if let Some(env) = spec["env"].as_object() {
        for (key, value) in env {
            environment.insert(
                key.into(),
                value.as_str().ok_or("CBM environment invalid")?.into(),
            );
        }
    }
    Ok(environment)
}
pub(crate) struct Client {
    child: Process,
    input: Option<ChildStdin>,
    out: ChildStdout,
    err: ChildStderr,
    buffer: Vec<u8>,
    next: u64,
    version: String,
}
impl Client {
    fn start(exe: &str, home: &Path) -> Result<Self, String> {
        Self::from_command(
            command(exe, home),
            false,
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
        )
    }
    #[cfg(test)]
    pub(crate) fn native(spec: &Value) -> Result<Self, String> {
        Self::native_tracked(
            spec,
            &native_environment(spec)?,
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
        )
    }
    pub(crate) fn native_tracked(
        spec: &Value,
        environment: &Environment,
        confirmed: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<Self, String> {
        use std::os::unix::process::CommandExt;
        if unsafe { libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1) } != 0 {
            return Err("CBM ownership unavailable".into());
        }
        let mut c = Command::new(spec["command"].as_str().ok_or("CBM command missing")?);
        if let Some(args) = spec["args"].as_array() {
            for a in args {
                c.arg(a.as_str().ok_or("CBM argument invalid")?);
            }
        }
        c.current_dir(spec["cwd"].as_str().ok_or("CBM cwd missing")?)
            .process_group(0);
        c.env_clear().envs(environment);
        unsafe {
            c.pre_exec(|| {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        Self::from_command(c, true, confirmed)
    }
    fn from_command(
        mut command: Command,
        owned_group: bool,
        confirmed: std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<Self, String> {
        let exe = command.get_program().to_string_lossy().into_owned();
        let child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(io)?;
        let mut child = Process::new(child, owned_group, confirmed);
        let input = child.stdin.take();
        if let Some(input) = &input {
            syscall(unsafe { libc::fcntl(input.as_raw_fd(), libc::F_SETFL, libc::O_NONBLOCK) })?;
        }
        let out = child.stdout.take().ok_or("Missing CBM stdout")?;
        let err = child.stderr.take().ok_or("Missing CBM stderr")?;
        for fd in [out.as_raw_fd(), err.as_raw_fd()] {
            syscall(unsafe { libc::fcntl(fd, libc::F_SETFL, libc::O_NONBLOCK) })?;
        }
        let mut s = Self {
            child,
            input,
            out,
            err,
            buffer: vec![],
            next: 0,
            version: String::new(),
        };
        diagnostic(json!({"client_pid":s.child.id(),"stage":"spawned","exe":exe}));
        let started = Instant::now();
        let init=s.rpc("initialize",json!({"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"deck-managed-scope","version":"1"}}),Duration::from_secs(30));
        diagnostic(
            json!({"client_pid":s.child.id(),"stage":"initialize","elapsed_ms":started.elapsed().as_millis(),"ok":init.is_ok(),"exit":s.child.try_wait().ok().flatten().map(|v|v.to_string())}),
        );
        let v = init?;
        s.version = v["serverInfo"]["version"]
            .as_str()
            .ok_or("CBM build version missing")?
            .into();
        if v["protocolVersion"] != "2025-11-25" {
            return Err("Unexpected CBM protocol".into());
        }
        s.send(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))?;
        Ok(s)
    }
    fn send(&mut self, v: &Value) -> Result<(), String> {
        let mut b = serde_json::to_vec(v).map_err(|_| "Cannot encode MCP request")?;
        if b.len() > 65536 {
            return Err("CBM request overflow".into());
        }
        b.push(b'\n');
        self.input
            .as_mut()
            .ok_or("Closed CBM input")?
            .write_all(&b)
            .map_err(io)
    }
    pub(crate) fn rpc(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        self.rpc_checked(method,params,timeout,||Ok(()))
    }
    pub(crate) fn rpc_checked(&mut self,method:&str,params:Value,timeout:Duration,check:impl Fn()->Result<(),String>)->Result<Value,String>{
        check()?;
        self.next += 1;
        let id = self.next;
        self.send(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))?;
        let until = Instant::now() + timeout;
        let mut total = 0;
        loop {
            check()?;
            while let Some(n) = self.buffer.iter().position(|b| *b == b'\n') {
                if n > FRAME {
                    return Err("CBM frame overflow".into());
                }
                let row: Vec<_> = self.buffer.drain(..=n).collect();
                let v: Value = serde_json::from_slice(&row).map_err(|_| "Malformed CBM frame")?;
                if v["id"] == id {
                    if v.get("error").is_some() {
                        return Err("CBM protocol error".into());
                    }
                    return Ok(v["result"].clone());
                }
            }
            if self.buffer.len() > FRAME {
                return Err("CBM frame overflow".into());
            }
            if Instant::now() >= until {
                return Err("CBM response deadline".into());
            }
            timeout_poll(self.out.as_raw_fd(), libc::POLLIN, until)?;
            for fd in [self.err.as_raw_fd(), self.out.as_raw_fd()] {
                let mut b = [0; 16384];
                let n = unsafe { libc::read(fd, b.as_mut_ptr().cast(), b.len()) };
                if n > 0 {
                    total += n as usize;
                    if total > 16 * FRAME {
                        return Err("CBM output overflow".into());
                    }
                    if fd == self.out.as_raw_fd() {
                        self.buffer.extend_from_slice(&b[..n as usize]);
                    } else {
                        let stderr = String::from_utf8_lossy(&b[..n as usize]);
                        if stderr.contains("could not accept this client within")
                            || stderr.contains("daemon could not start within")
                        {
                            diagnostic(
                                json!({"client_pid":self.child.id(),"stage":"native-startup-deadline"}),
                            );
                        }
                        if let Some(log) = VERIFICATION_STDERR.get() {
                            let mut log = log
                                .lock()
                                .map_err(|_| "Qualification diagnostic lock failed")?;
                            let left = 65536_u64.saturating_sub(log.metadata().map_err(io)?.len());
                            log.write_all(&b[..(n as usize).min(left as usize)])
                                .map_err(io)?;
                            log.sync_data().map_err(io)?;
                        }
                    }
                } else if n == 0 && fd == self.out.as_raw_fd() {
                    return Err("CBM EOF before response; exit/cleanup unconfirmed".into());
                } else if n < 0 {
                    let e = std::io::Error::last_os_error();
                    if e.kind() != std::io::ErrorKind::WouldBlock
                        && e.kind() != std::io::ErrorKind::Interrupted
                    {
                        return Err(io(e));
                    }
                }
            }
            if self.child.try_wait().map_err(io)?.is_some() {
                return Err("CBM exited before response".into());
            }
        }
    }
    fn tool(&mut self, name: &str, args: Value) -> Result<Value, String> {
        let v = self.rpc(
            "tools/call",
            json!({"name":name,"arguments":args}),
            Duration::from_secs(if name == "index_repository" { 90 } else { 15 }),
        )?;
        if v["isError"] == true {
            return Err(format!("CBM {name} failed"));
        }
        Ok(v)
    }
    fn close(&mut self) -> Result<(), String> {
        self.input.take();
        let until = Instant::now() + Duration::from_secs(15);
        loop {
            for fd in [self.out.as_raw_fd(), self.err.as_raw_fd()] {
                let mut b = [0; 16384];
                unsafe {
                    libc::read(fd, b.as_mut_ptr().cast(), b.len());
                }
            }
            if let Some(s) = self.child.try_wait().map_err(io)? {
                return if s.success() {
                    Ok(())
                } else {
                    Err("CBM client exit unsuccessful".into())
                };
            }
            if Instant::now() >= until {
                return Err("CBM exit deadline; ownership retained".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        self.input.take();
        diagnostic(
            json!({"client_pid":self.child.id(),"stage":"drop","exit":self.child.try_wait().ok().flatten().map(|v|v.to_string())}),
        );
        // Process::drop confirms group settlement even on partial construction/handshake errors.
    }
}
fn command(exe: &str, home: &Path) -> Command {
    use std::os::unix::process::CommandExt;
    let mut c = Command::new(exe);
    unsafe {
        c.pre_exec(|| {
            #[repr(C)]
            struct Header {
                version: u32,
                pid: i32,
            }
            #[repr(C)]
            #[derive(Clone, Copy)]
            struct Data {
                effective: u32,
                permitted: u32,
                inheritable: u32,
            }
            let header = Header {
                version: 0x20080522,
                pid: 0,
            };
            let data = [Data {
                effective: 0,
                permitted: 0,
                inheritable: 0,
            }; 2];
            for cap in 0..64 {
                libc::prctl(libc::PR_CAPBSET_DROP, cap, 0, 0, 0);
            }
            if libc::syscall(libc::SYS_capset, &header, data.as_ptr()) < 0
                || libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0
            {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    c.current_dir("/scope/repo")
        .env_clear()
        .env("HOME", home)
        .env("PATH", "/nonexistent")
        .env("LANG", "C")
        .env("CBM_RUNTIME_DIR", "/runtime")
        .env("CBM_CACHE_DIR", "/state/cache")
        .env("XDG_CONFIG_HOME", "/state/config")
        // Keep the pinned native MCP bootstrap contract (30 s). The prototype's
        // 1.5 s fault-probe override races cold daemon startup and must not ship.
        .env("TMPDIR", "/tmp");
    c
}
fn configure(home: &Path, version: &str) -> Result<(), String> {
    mkdir(Path::new("/state/cache"))?;
    mkdir(Path::new("/state/config"))?;
    for key in ["auto_index", "auto_watch"] {
        let mut c = command(exe_for(version), home)
            .args(["config", "set", key, "false"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(io)?;
        let started = Instant::now();
        diagnostic(json!({"stage":"configure-start","client_pid":c.id(),"key":key}));
        let until = started + Duration::from_secs(15);
        loop {
            if let Some(s) = c.try_wait().map_err(io)? {
                diagnostic(
                    json!({"stage":"configure-exit","client_pid":c.id(),"key":key,"elapsed_ms":started.elapsed().as_millis(),"exit":s.to_string()}),
                );
                if !s.success() {
                    return Err("Cannot disable owned auto indexing/watch".into());
                }
                break;
            }
            if Instant::now() > until {
                let _ = c.kill();
                let exit = c.wait().ok().map(|v| v.to_string());
                diagnostic(
                    json!({"stage":"configure-deadline","client_pid":c.id(),"key":key,"elapsed_ms":started.elapsed().as_millis(),"exit":exit}),
                );
                return Err("CBM config deadline".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    Ok(())
}
fn serve(
    listener: UnixListener,
    s: &Service,
    home: &Path,
    pins: &[&crate::cbm_artifacts::Verified],
) -> Result<(), String> {
    if VERIFICATION_PAUSE.get().is_some_and(|v| v.is_some()) {
        let file = s
            .directory
            .existing_dir("evidence")?
            .file(&format!("native-stderr-{}", uuid::Uuid::new_v4()), true)?;
        let _ = VERIFICATION_STDERR.set(std::sync::Mutex::new(file));
    }
    if let Ok(dir) = s.directory.existing_dir("evidence")
        && let Ok(file) = dir.file(&format!("client-events-{}", uuid::Uuid::new_v4()), true)
    {
        let _ = DIAGNOSTICS.set(std::sync::Mutex::new(file));
    }
    let mut client: Option<Client> = None;
    for conn in listener.incoming() {
        let mut conn = conn.map_err(io)?;
        conn.set_read_timeout(Some(Duration::from_secs(5)))
            .map_err(io)?;
        conn.set_write_timeout(Some(Duration::from_secs(5)))
            .map_err(io)?;
        let request: Result<Value, String> = line(&mut conn, 65536)
            .and_then(|b| serde_json::from_slice(&b).map_err(|_| "Invalid control request".into()));
        let result = request.and_then(|v| {
            if let Some(action) = v["action"]
                .as_str()
                .filter(|a| ["prepare", "update", "recover"].contains(a))
            {
                diagnostic(json!({"control":action}));
            }
            // Metadata checks on retained, fully verified handles are cheap. A
            // changed executable never triggers a warm hash/restart or stale result.
            for pin in pins {
                pin.check()?;
            }
            let result = handle(s, home, &mut client, &v);
            for pin in pins {
                pin.check()?;
            }
            result
        });
        let body = match result {
            Ok(v) => v,
            Err(e) => {
                json!({"error":e,"service":s.id,"recovery":"preserve service state; reconcile before explicit preparation"})
            }
        };
        let mut b = serde_json::to_vec(&body).map_err(|_| "Cannot encode supervisor response")?;
        if b.len() > FRAME {
            b = serde_json::to_vec(&json!({"error":"CBM response overflow"})).unwrap()
        }
        b.push(b'\n');
        let retiring=body["retired"]==true;
        let _ = conn.write_all(&b);
        if retiring {return Ok(());}
    }
    Ok(())
}
fn handle(
    s: &Service,
    home: &Path,
    client: &mut Option<Client>,
    v: &Value,
) -> Result<Value, String> {
    match v["action"].as_str().unwrap_or("") {
        "prepare" => {
            let r = {
                let _gate = s.gate()?;
                let mut r = s.record()?;
                if !["unprepared", "preparing", "ready"].contains(&r.phase.as_str())
                    || !r.reservations.is_empty()
                {
                    return Err("Explicit preparation phase changed".into());
                }
                r.phase = "preparing".into();
                r.admission_open = false;
                s.save(&r)?;
                r
            };
            // Preparation and admissions share the same durable gate. Keep it
            // closed across index work without holding the file lock over IO.
            if let Some(mut prior) = client.take() {
                prior.close()?;
            }
            configure(home, &r.version)?;
            configuration()?;
            let mut c = Client::start(exe_for(&r.version), home)?;
            let index = c.tool("index_repository", json!({"repo_path":"/scope/repo"}))?;
            if c.version != r.version {
                return Err("CBM prepared build differs from selected artifact".into());
            }
            let health = known_graph_health(&mut c, &s.snapshot()?)?;
            configuration()?;
            *client = Some(c);
            s.mark_ready()?;
            Ok(json!({"service":s.id,"generation":r.generation,"index":index,"health":health}))
        }
        "query" => {
            let r = s.record()?;
            if !["ready", "deferred"].contains(&r.phase.as_str()) {
                return Err("CBM maintenance gate closed".into());
            }
            let host = v["host"].as_str().ok_or("Missing reservation host")?;
            let root = v["root"].as_str().ok_or("Missing reservation root")?;
            if !r
                .reservations
                .iter()
                .any(|x| x.host == host && x.root == root && x.snapshot == r.snapshot)
            {
                return Err("CBM reservation unavailable".into());
            }
            let name = v["tool"].as_str().ok_or("Missing graph tool")?;
            let mut args = bounded_query(name, &v["arguments"])?;
            if name == "check_index_coverage" {
                // This native tool requires concrete evidence paths. They come
                // only from the prepared manifest, never from model arguments.
                args["paths"] = json!(s.snapshot()?.files.keys().cloned().collect::<Vec<_>>());
                args["path_limit"] = json!(128);
            }
            let result = client
                .as_mut()
                .ok_or("Supervisor client unavailable; explicit recovery required")?
                .tool(name, args)?;
            Ok(
                json!({"service":s.id,"generation":r.generation,"snapshot":r.snapshot,"version":r.version,"result":result,"coverage":"Recorded graph evidence only; no exhaustive or negative completeness claim"}),
            )
        }
        "update" => maintenance(s, home, client, v, false),
        "recover" => maintenance(s, home, client, v, true),
        "retire" => {
            let _gate=s.gate()?;let mut r=s.record()?;
            if r.admission_open || !r.reservations.is_empty() || r.operation.is_some(){return Err("Service still admits or retains work".into());}
            if let Some(mut c)=client.take(){c.close()?;}
            r.phase="retired".into();s.save(&r)?;
            Ok(json!({"retired":true}))
        }
        "status" => {
            Ok(serde_json::to_value(s.record()?).map_err(|_| "Cannot encode service status")?)
        }
        _ => Err("Unknown managed supervisor action".into()),
    }
}
/// Model arguments can never select a project, file root, query language or admin action.
pub fn bounded_query(name: &str, v: &Value) -> Result<Value, String> {
    let a = v.as_object().ok_or("Graph arguments must be an object")?;
    let allowed: &[&str] = match name {
        "search_graph" => &["name_pattern", "offset", "limit"],
        "trace_path" => &["function_name", "direction"],
        "check_index_coverage" => &[],
        _ => return Err("Graph tool not exposed".into()),
    };
    if a.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err("Foreign graph argument denied".into());
    }
    let mut result = json!({"project":"scope-repo"});
    for (k, v) in a {
        match k.as_str() {
            "name_pattern" | "function_name" => {
                if v.as_str().is_none_or(|s| s.is_empty() || s.len() > 128) {
                    return Err("Bounded graph symbol required".into());
                }
            }
            "direction" => {
                if !matches!(v.as_str(), Some("inbound" | "outbound")) {
                    return Err("Direct trace direction required".into());
                }
            }
            "offset" => {
                if v.as_u64().is_none_or(|n| n > 1000) {
                    return Err("Graph offset exceeds bound".into());
                }
            }
            "limit" => {
                if v.as_u64().is_none_or(|n| n == 0 || n > 20) {
                    return Err("Graph page exceeds bound".into());
                }
            }
            _ => {}
        }
        result[k] = v.clone();
    }
    if name == "search_graph" {
        result["limit"] = v.get("limit").cloned().unwrap_or(json!(20));
    }
    if name == "trace_path" {
        result["depth"] = json!(1);
        result["limit"] = json!(20);
        result["max_output_tokens"] = json!(4000);
    }
    Ok(result)
}

use crate::cbm_service::Maintenance;
fn durable(s: &Service, name: &str, value: &Maintenance) -> Result<(), String> {
    // The record is authoritative. A mirror failure cannot erase intent or
    // regress recovery to an earlier phase after effects have begun.
    {
        let _gate = s.gate()?;
        let mut r = s.record()?;
        if r.operation.as_deref() != Some(value.id.as_str()) {
            return Err("Maintenance journal authority changed".into());
        }
        r.maintenance = Some(value.clone());
        s.save(&r)?;
    }
    let dir = &s.directory;
    let tmp = format!(".journal-{}", uuid::Uuid::new_v4());
    dir.write(
        &tmp,
        &serde_json::to_vec(value).map_err(|_| "Cannot encode maintenance journal")?,
    )?;
    fs::rename(dir.path().join(&tmp), dir.path().join(name)).map_err(io)?;
    dir.0.sync_all().map_err(io)?;
    checkpoint(s, value)
}
fn checkpoint(s: &Service, value: &Maintenance) -> Result<(), String> {
    let dir = &s.directory;
    if let Some(Some(phase)) = VERIFICATION_PAUSE.get()
        && serde_json::to_value(value).map_err(|_| "Cannot inspect durable phase")?["phase"]
            == phase.as_str()
        && !PAUSED.swap(true, std::sync::atomic::Ordering::SeqCst)
    {
        let value =
            serde_json::to_value(value).map_err(|_| "Cannot encode verification checkpoint")?;
        let operation = value["id"]
            .as_str()
            .ok_or("Verification operation identity missing")?;
        dir.write(
            &format!("verification-paused-{operation}-{phase}"),
            b"paused",
        )?;
        dir.0.sync_all().map_err(io)?;
        let until = Instant::now() + Duration::from_secs(100);
        while dir
            .bytes(&format!("verification-resume-{operation}"), 16)
            .ok()
            .as_deref()
            != Some(b"resume")
        {
            if Instant::now() > until {
                return Err(
                    "Explicit verification checkpoint deadline; preserve interrupted operation"
                        .into(),
                );
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    Ok(())
}
fn inventory(path: &Path) -> Result<std::collections::BTreeMap<String, String>, String> {
    fn visit(
        root: &Path,
        path: &Path,
        out: &mut std::collections::BTreeMap<String, String>,
    ) -> Result<(), String> {
        use sha2::{Digest, Sha256};
        for e in fs::read_dir(path).map_err(io)? {
            let e = e.map_err(io)?;
            let m = e.path().symlink_metadata().map_err(io)?;
            if m.is_dir() {
                visit(root, &e.path(), out)?
            } else if m.is_file() {
                let mut f = File::open(e.path()).map_err(io)?;
                let mut hash = Sha256::new();
                let mut b = [0; 65536];
                loop {
                    let n = f.read(&mut b).map_err(io)?;
                    if n == 0 {
                        break;
                    }
                    hash.update(&b[..n]);
                }
                out.insert(
                    e.path()
                        .strip_prefix(root)
                        .map_err(|_| "State inventory path")?
                        .to_str()
                        .ok_or("State path not UTF-8")?
                        .into(),
                    format!("{}:{:x}", m.len(), hash.finalize()),
                );
            } else {
                return Err("Linked or special file in managed state".into());
            }
        }
        Ok(())
    }
    let mut out = std::collections::BTreeMap::new();
    visit(path, path, &mut out)?;
    Ok(out)
}
fn copy_tree(source: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir(dest).map_err(io)?;
    fs::set_permissions(dest, fs::Permissions::from_mode(0o700)).map_err(io)?;
    for e in fs::read_dir(source).map_err(io)? {
        let e = e.map_err(io)?;
        let m = e.path().symlink_metadata().map_err(io)?;
        let target = dest.join(e.file_name());
        if m.is_dir() {
            copy_tree(&e.path(), &target)?
        } else if m.is_file() {
            use std::os::unix::fs::OpenOptionsExt;
            let mut input = fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW)
                .open(e.path())
                .map_err(io)?;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(target)
                .map_err(io)?;
            std::io::copy(&mut input, &mut output).map_err(io)?;
            output.sync_all().map_err(io)?;
        } else {
            return Err("Linked or special file in state backup".into());
        }
    }
    File::open(dest).map_err(io)?.sync_all().map_err(io)?;
    File::open(dest.parent().ok_or("Missing state parent")?)
        .map_err(io)?
        .sync_all()
        .map_err(io)
}
fn settled() -> Result<(), String> {
    let until = Instant::now() + Duration::from_secs(15);
    loop {
        while unsafe { libc::waitpid(-1, std::ptr::null_mut(), libc::WNOHANG) } > 0 {}
        let others = fs::read_dir("/proc")
            .map_err(io)?
            .filter_map(Result::ok)
            .filter_map(|e| e.file_name().to_str()?.parse::<u32>().ok())
            .filter(|p| *p != 1)
            .count();
        if others == 0 {
            return Ok(());
        }
        if Instant::now() > until {
            return Err("Unknown or retained namespace consumers defer maintenance; no processes terminated".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn upstream() -> Result<Vec<File>, String> {
    use fs2::FileExt;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    let base = Path::new("/runtime/cbm-daemon-0");
    let mut held = vec![];
    for name in [
        "cbm-version-cohort-maintenance-v1.lock",
        "cbm-version-cohort-admission-v1.lock",
        "cbm-version-cohort-lifetime-v1.lock",
        "cbm-version-cohort-daemon-v1.lock",
    ] {
        let f = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(base.join(name))
            .map_err(io)?;
        let m = f.metadata().map_err(io)?;
        if !m.is_file() || m.nlink() != 1 || m.mode() & 0o777 != 0o600 || m.uid() != 0 {
            return Err("Unexpected upstream lock ownership".into());
        }
        f.try_lock_exclusive()
            .map_err(|_| "Unknown upstream consumer; maintenance deferred")?;
        held.push(f);
    }
    Ok(held)
}
fn database_health(format: i64) -> Result<(), String> {
    let mut seen = 0;
    for e in fs::read_dir("/state/cache").map_err(io)? {
        let e = e.map_err(io)?;
        if e.path().extension().and_then(|x| x.to_str()) != Some("db") {
            continue;
        }
        let conn = rusqlite::Connection::open_with_flags(
            e.path(),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|_| "CBM health database unavailable")?;
        let integrity: String = conn
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .map_err(|_| "CBM database integrity check failed")?;
        let actual: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|_| "CBM database format unavailable")?;
        let graph = e.file_name() == "scope-repo.db";
        if integrity != "ok" || graph && actual != format {
            return Err("CBM state format/integrity health failed".into());
        }
        if graph {
            seen += 1;
        }
    }
    if seen == 0 {
        return Err("CBM health found no prepared graph database".into());
    }
    Ok(())
}
fn exe_for(version: &str) -> &'static str {
    if version == "0.12.0" {
        "/cbm"
    } else {
        "/cbm-other"
    }
}
fn health(version: &str, home: &Path, rebuild: bool) -> Result<Client, String> {
    // An altered policy must fail before starting third-party watch/index work.
    configuration()?;
    let mut c = Client::start(exe_for(version), home)?;
    if c.version != version {
        return Err("CBM native build identity differs from selected release".into());
    }
    let native = c.rpc("tools/list", json!({}), Duration::from_secs(10))?;
    if !native.to_string().contains("search_graph") {
        return Err("CBM health tools missing".into());
    }
    if rebuild {
        c.tool("index_repository", json!({"repo_path":"/scope/repo"}))?;
    }
    c.tool(
        "search_graph",
        json!({"project":"scope-repo","name_pattern":".*","limit":1}),
    )?;
    Ok(c)
}
fn maintenance(
    s: &Service,
    home: &Path,
    client: &mut Option<Client>,
    v: &Value,
    recover: bool,
) -> Result<Value, String> {
    let operation = v["operation"]
        .as_str()
        .filter(|v| {
            !v.is_empty()
                && v.len() <= 80
                && v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
        .ok_or("Invalid maintenance operation")?;
    let journal_name = format!("maintenance-{operation}.json");
    let r = s.record()?;
    let prior = if let Some(j) = r.maintenance.as_ref().filter(|j| j.id == operation) {
        Some(j.clone())
    } else {
        // Read-only compatibility for previously published service journals.
        match fs::symlink_metadata(s.directory.path().join(&journal_name)) {
            Ok(_) => Some(
                serde_json::from_slice::<Maintenance>(
                    &s.directory.bytes(&journal_name, 1024 * 1024)?,
                )
                .map_err(|_| "Recovery journal unavailable")?,
            ),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(io(e)),
        }
    };
    if let Some(j) = &prior {
        if j.id != operation {
            return Err("Recovery operation identity mismatch".into());
        }
        let restored = recover || j.phase == "recovered";
        let desired = if restored { "recovered" } else { "committed" };
        let version = if restored { &j.old } else { &j.target };
        if j.phase == desired
            && r.phase == "ready"
            && r.admission_open
            && r.operation.is_none()
            && r.version == *version
        {
            return Ok(
                json!({"operation":operation,"phase":desired,"version":version,"generation":r.generation}),
            );
        }
    }
    if v.get("expected_generation")
        .is_some_and(|g| g.as_u64() != Some(r.generation))
        || v.get("snapshot")
            .is_some_and(|g| g.as_str() != Some(r.snapshot.as_str()))
    {
        if prior.is_some() {
            return Err(
                "Existing operation requires reconciliation against its native journal".into(),
            );
        }
        return Ok(
            json!({"operation":operation,"phase":"not_applied","detail":"Reviewed service generation changed; no maintenance admitted. Review the current generation."}),
        );
    }
    if recover && prior.is_none() {
        return Err("Recovery journal unavailable; no recovery admitted".into());
    }
    if recover {
        let _g = s.gate()?;
        let mut r = s.record()?;
        if !r.reservations.is_empty() {
            return Ok(
                json!({"operation":operation,"phase":"deferred","reason":"Retained reservations block restoration"}),
            );
        }
        if r.operation.as_deref().is_some_and(|id| id != operation) {
            return Err("Another operation owns recovery".into());
        }
        r.operation = Some(operation.into());
        r.admission_open = false;
        r.phase = "recovery".into();
        s.save(&r)?;
    }
    let mut j = if recover {
        prior.ok_or("Recovery journal unavailable")?
    } else {
        let target = v["version"].as_str().ok_or("Missing target release")?;
        release(target)?;
        if r.version != "0.12.0" || target != "0.12.1" {
            return Err("Only qualified 0.12.0 to 0.12.1 maintenance is available".into());
        }
        if !s.begin_maintenance(operation)? {
            return Ok(
                json!({"phase":"deferred","operation":operation,"reason":"Retained or unknown Deck reservations; no upstream maintenance invoked"}),
            );
        }
        let r = s.record()?;
        checkpoint(
            s,
            r.maintenance
                .as_ref()
                .ok_or("Maintenance intent unavailable")?,
        )?;
        Maintenance {
            id: operation.into(),
            old: r.version,
            target: target.into(),
            phase: "draining".into(),
            manifest: Default::default(),
            configuration: configuration()?,
            adr: if let Some(c) = client.as_mut() {
                c.rpc(
                    "tools/call",
                    json!({"name":"manage_adr","arguments":{"project":"scope-repo","mode":"get"}}),
                    Duration::from_secs(15),
                )?
            } else {
                return Err("Old pair health unavailable before maintenance".into());
            },
        }
    };
    if j.id != operation {
        return Err("Recovery operation identity mismatch".into());
    }
    if recover && j.phase == "intent" {
        // No state mutation is permitted before this intent gains a captured
        // baseline. Re-establish the old client after supervisor death; never
        // configure/rebuild or open admissions to obtain that baseline.
        j.configuration = configuration()?;
        // A failed metadata RPC may have left the old client at EOF. Settle
        // this owned client and verify that no unknown namespace consumers
        // remain before starting a replacement; failed clients are not reused.
        drop(client.take());
        settled()?;
        let held = upstream()?;
        drop(held);
        *client = Some(health(&j.old, home, false)?);
        j.adr = client.as_mut().ok_or("Old pair unavailable")?.rpc(
            "tools/call",
            json!({"name":"manage_adr","arguments":{"project":"scope-repo","mode":"get"}}),
            Duration::from_secs(15),
        )?;
        j.phase = "draining".into();
    }
    durable(s, &journal_name, &j)?;
    if let Some(mut c) = client.take() {
        c.close()?;
    }
    // Never acquire cooperative upstream maintenance while any retained/unknown process exists.
    settled()?;
    let held = upstream()?;
    let backup = s.path.join(format!("backup-{operation}"));
    if recover
        && j.manifest.is_empty()
        && !["draining", "recovered-health", "recovered", "health-failed"]
            .contains(&j.phase.as_str())
    {
        return Err("Recovery snapshot manifest missing; admission remains closed".into());
    }
    if !recover {
        copy_tree(Path::new("/state"), &backup)?;
        j.manifest = inventory(&backup)?;
        j.phase = "prepared".into();
        durable(s, &journal_name, &j)?;
        let stage = s.path.join(format!("candidate-{operation}"));
        copy_tree(&backup, &stage)?;
        j.phase = "candidate-staged".into();
        durable(s, &journal_name, &j)?;
        // /state is a bind mount of this stable directory. Move only its owned contents.
        for name in ["cache", "config"] {
            fs::rename(
                s.path.join("state").join(name),
                s.path.join(format!("original-{operation}-{name}")),
            )
            .map_err(io)?;
            File::open("/state").map_err(io)?.sync_all().map_err(io)?;
            fs::rename(stage.join(name), s.path.join("state").join(name)).map_err(io)?;
            File::open("/state").map_err(io)?.sync_all().map_err(io)?;
        }
        j.phase = "candidate-selected".into();
        durable(s, &journal_name, &j)?;
    } else if !j.manifest.is_empty() {
        if inventory(&backup)? != j.manifest {
            return Err("Restoration backup identity failed; preserve all evidence".into());
        }
        let attempt = uuid::Uuid::new_v4().to_string();
        let failed = s.path.join(format!("failed-{operation}-{attempt}"));
        copy_tree(Path::new("/state"), &failed)?;
        let stage = s.path.join(format!("restore-{operation}-{attempt}"));
        copy_tree(&backup, &stage)?;
        if inventory(&stage)? != j.manifest {
            return Err("Restoration stage identity mismatch".into());
        }
        j.phase = "restore-staged".into();
        durable(s, &journal_name, &j)?;
        for name in ["cache", "config"] {
            let p = s.path.join("state").join(name);
            if p.exists() {
                fs::rename(
                    &p,
                    s.path
                        .join(format!("displaced-{operation}-{attempt}-{name}")),
                )
                .map_err(io)?;
                File::open("/state").map_err(io)?.sync_all().map_err(io)?;
            }
            fs::rename(stage.join(name), p).map_err(io)?;
            File::open("/state").map_err(io)?.sync_all().map_err(io)?;
            j.phase = format!("restored-{name}");
            durable(s, &journal_name, &j)?;
        }
        j.phase = "restored-pair".into();
        durable(s, &journal_name, &j)?;
    }
    drop(held); // designated native health must run without upstream EX locks
    let version = if recover {
        j.old.clone()
    } else {
        j.target.clone()
    };
    let activated = (|| {
        let mut c = health(&version, home, !recover)?;
        j.phase = if recover {
            "recovered-health"
        } else {
            "migrated"
        }
        .into();
        durable(s, &journal_name, &j)?;
        known_graph_health(&mut c, &s.snapshot()?)?;
        let actual_adr = c.rpc(
            "tools/call",
            json!({"name":"manage_adr","arguments":{"project":"scope-repo","mode":"get"}}),
            Duration::from_secs(15),
        )?;
        if actual_adr != j.adr || configuration()? != j.configuration {
            return Err("CBM configuration/ADR changed during activation".into());
        }
        if !recover {
            let repeat = c.tool("index_repository", json!({"repo_path":"/scope/repo"}))?;
            if repeat.to_string().contains("format_migration") {
                return Err("CBM format migration repeated during health".into());
            }
        }
        c.close()?;
        settled()?;
        database_health(if version == "0.12.0" { 2 } else { 3 })?;
        health(&version, home, false)
    })();
    match activated {
        Ok(c) => {
            let _g = s.gate()?;
            let mut r = s.record()?;
            if r.operation.as_deref() != Some(operation) || !r.reservations.is_empty() {
                return Err("Maintenance authority changed; gate stays closed".into());
            }
            r.version = version.clone();
            let release = release(&version)?;
            r.executable = release.executable;
            r.catalog = release.catalog;
            r.state_format = if version == "0.12.0" { 2 } else { 3 };
            r.generation += 1;
            r.phase = "healthy".into();
            r.admission_open = false;
            s.save(&r)?;
            drop(_g);
            j.phase = if recover { "recovered" } else { "committed" }.into();
            durable(s, &journal_name, &j)?;
            let _g = s.gate()?;
            let mut r = s.record()?;
            if r.operation.as_deref() != Some(operation) || !r.reservations.is_empty() {
                return Err("Maintenance authority changed; gate stays closed".into());
            }
            r.phase = "ready".into();
            r.operation = None;
            r.admission_open = true;
            s.save(&r)?;
            *client = Some(c);
            Ok(
                json!({"operation":operation,"phase":j.phase,"version":version,"generation":r.generation}),
            )
        }
        Err(e) => {
            j.phase = "health-failed".into();
            durable(s, &journal_name, &j)?;
            if !recover {
                let mut restored = maintenance(s, home, client, v, true)?;
                restored["activation"] = json!("failed");
                restored["detail"] = json!(format!(
                    "{e}; compatible old executable/state pair restored and verified"
                ));
                Ok(restored)
            } else {
                Err(format!("{e}; paired recovery required for {operation}"))
            }
        }
    }
}

fn configuration() -> Result<std::collections::BTreeMap<String, String>, String> {
    let c = rusqlite::Connection::open_with_flags(
        "/state/cache/_config.db",
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|_| "Owned CBM configuration unavailable")?;
    let mut stmt = c
        .prepare("SELECT key,value FROM config ORDER BY key")
        .map_err(|_| "CBM configuration schema unavailable")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|_| "CBM configuration read failed")?;
    let map = rows
        .collect::<Result<std::collections::BTreeMap<_, _>, _>>()
        .map_err(|_| "CBM configuration row invalid")?;
    if map.get("auto_index").map(String::as_str) != Some("false")
        || map.get("auto_watch").map(String::as_str) != Some("false")
    {
        return Err("Managed auto indexing/watch policy changed".into());
    }
    Ok(map)
}

fn known_graph_health(
    c: &mut Client,
    snapshot: &crate::cbm_service::Snapshot,
) -> Result<Value, String> {
    let coverage = c.tool("check_index_coverage", json!({"project":"scope-repo","paths":snapshot.files.keys().take(128).cloned().collect::<Vec<_>>(),"path_limit":128}))?;
    for path in snapshot.files.keys() {
        let v = c.tool(
            "search_graph",
            json!({"project":"scope-repo","file_pattern":path,"limit":1}),
        )?;
        if v.to_string().contains(path) {
            return Ok(json!({"known_source":v,"coverage":coverage}));
        }
    }
    Err("Native graph health found no independently captured source path".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fake(code: &str) -> Client {
        let mut child = Command::new("/usr/bin/python3")
            .args(["-I", "-S", "-u", "-c", code])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let out = child.stdout.take().unwrap();
        let err = child.stderr.take().unwrap();
        for fd in [out.as_raw_fd(), err.as_raw_fd()] {
            assert!(unsafe { libc::fcntl(fd, libc::F_SETFL, libc::O_NONBLOCK) } >= 0)
        }
        Client {
            input: child.stdin.take(),
            out,
            err,
            child: Process::new(
                child,
                false,
                std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
            ),
            buffer: vec![],
            next: 0,
            version: "fixture".into(),
        }
    }
    // Protects protocol bounds and EOF-before-exit: pipe closure must never enter
    // an unbounded wait. Oracle S5C-RECOVERY/DELIVERY, fake only the process edge.
    #[test]
    fn overflow_and_eof_before_exit_are_bounded_and_reaped() {
        for (code, reason) in [
            (
                "import os,sys,time;sys.stdin.readline();os.write(1,b'x'*1100000);time.sleep(10)",
                "overflow",
            ),
            (
                "import os,sys,time;sys.stdin.readline();os.close(1);time.sleep(10)",
                "EOF",
            ),
        ] {
            let start = Instant::now();
            let mut c = fake(code);
            let error = c
                .rpc("fixture", json!({}), Duration::from_secs(2))
                .unwrap_err();
            assert!(error.contains(reason), "{error}");
            drop(c);
            assert!(start.elapsed() < Duration::from_secs(4));
        }
    }
    // Executes the production settlement check in a private PID/mount namespace.
    // A real stopped foreign consumer must survive refusal; only this fixture
    // subsequently stops its own child. No account daemon or host mount is used.
    #[test]
    #[ignore = "explicit Linux namespace process qualification"]
    fn stopped_unknown_consumer_defers_without_termination() {
        if std::env::var("DECK2_CBM_NAMESPACE_PROBE").as_deref() == Ok("inner") {
            let mut consumer = Command::new("/usr/bin/sleep").arg("60").spawn().unwrap();
            assert_eq!(
                unsafe { libc::kill(consumer.id() as i32, libc::SIGSTOP) },
                0
            );
            assert!(
                settled().is_err(),
                "Unknown consumers must close the maintenance boundary"
            );
            assert!(
                consumer.try_wait().unwrap().is_none(),
                "Maintenance must not terminate an unknown consumer"
            );
            let status = fs::read_to_string(format!("/proc/{}/status", consumer.id())).unwrap();
            assert!(
                status
                    .lines()
                    .any(|line| line.starts_with("State:") && line.contains("T (stopped)"))
            );
            assert_eq!(
                unsafe { libc::kill(consumer.id() as i32, libc::SIGCONT) },
                0
            );
            consumer.kill().unwrap();
            consumer.wait().unwrap();
            settled().unwrap();
            return;
        }
        let output = Command::new("/usr/bin/unshare")
            .args([
                "--user",
                "--map-root-user",
                "--mount",
                "--pid",
                "--fork",
                "--kill-child=SIGKILL",
                "--mount-proc",
            ])
            .arg(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "cbm_runtime::tests::stopped_unknown_consumer_defers_without_termination",
                "--ignored",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("DECK2_CBM_NAMESPACE_PROBE", "inner")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    fn ready_service(version: &str) -> (tempfile::TempDir, tempfile::TempDir, Service) {
        let project = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        fs::set_permissions(store.path(), fs::Permissions::from_mode(0o700)).unwrap();
        fs::write(project.path().join("handler.rs"), "fn handler(){}\n").unwrap();
        let snapshot =
            crate::cbm_service::Snapshot::capture(project.path(), &["handler.rs".into()]).unwrap();
        let service = Service::create(store.path(), &snapshot, version).unwrap();
        service.mark_ready().unwrap();
        (project, store, service)
    }
    #[test]
    fn predecessor_service_schema_is_refused_without_rewriting_evidence() {
        let (_project, _store, service) = ready_service("0.12.0");
        let mut r = service.record().unwrap();
        r.schema = 2;
        service.save(&r).unwrap();
        let before = fs::read(service.path.join("record.json")).unwrap();
        assert!(service.record().is_err());
        assert_eq!(before, fs::read(service.path.join("record.json")).unwrap());
    }
    #[test]
    fn first_gate_transition_contains_recovery_intent() {
        let (_project, _store, service) = ready_service("0.12.0");
        assert!(service.begin_maintenance("early-death").unwrap());
        let record = serde_json::to_value(service.record().unwrap()).unwrap();
        assert_eq!(record["maintenance"]["id"], "early-death");
        assert_eq!(record["maintenance"]["phase"], "intent");
        assert!(!service.path.join("maintenance-early-death.json").exists());
    }
    #[test]
    fn journal_mirror_failure_preserves_authoritative_phase() {
        let (_project, _store, service) = ready_service("0.12.0");
        service.begin_maintenance("mirror-failure").unwrap();
        let mut j = service.record().unwrap().maintenance.unwrap();
        j.phase = "prepared".into();
        j.manifest
            .insert("cache/graph.db".into(), "retained".into());
        std::fs::create_dir(service.path.join("maintenance-mirror-failure.json")).unwrap();
        assert!(durable(&service, "maintenance-mirror-failure.json", &j).is_err());
        let r = service.record().unwrap();
        assert!(!r.admission_open);
        assert_eq!(r.maintenance.unwrap().phase, "prepared");
    }
    #[test]
    fn stale_shared_generation_has_terminal_nonapplication_proof() {
        let (_project, _store, service) = ready_service("0.12.0");
        let mut client = None;
        let reply = maintenance(
            &service,
            Path::new("/unused"),
            &mut client,
            &json!({"operation":"stale-shared-plan","version":"0.12.1","expected_generation":0}),
            false,
        )
        .unwrap();
        assert_eq!(reply["phase"], "not_applied");
        assert_eq!(reply["operation"], "stale-shared-plan");
        assert!(service.record().unwrap().admission_open);
        assert!(service.record().unwrap().operation.is_none());
    }
    #[test]
    fn another_hosts_recovery_reconciles_original_update_history() {
        let (_project, _store, service) = ready_service("0.12.0");
        let mut client = None;
        let journal = Maintenance {
            id: "recovered-elsewhere".into(),
            old: "0.12.0".into(),
            target: "0.12.1".into(),
            phase: "recovered".into(),
            manifest: Default::default(),
            configuration: Default::default(),
            adr: Value::Null,
        };
        service
            .directory
            .write(
                "maintenance-recovered-elsewhere.json",
                &serde_json::to_vec(&journal).unwrap(),
            )
            .unwrap();
        let reply = maintenance(
            &service,
            Path::new("/unused"),
            &mut client,
            &json!({"operation":"recovered-elsewhere","version":"0.12.1","expected_generation":0}),
            false,
        )
        .unwrap();
        assert_eq!(reply["phase"], "recovered");
        assert!(service.record().unwrap().admission_open);
    }
    #[test]
    fn unsupported_update_range_does_not_close_healthy_admissions() {
        let (_project, _store, service) = ready_service("0.12.1");
        let mut client = None;
        assert!(
            maintenance(
                &service,
                Path::new("/unused"),
                &mut client,
                &json!({"operation":"unsupported-update","version":"0.12.1"}),
                false
            )
            .is_err()
        );
        let record = service.record().unwrap();
        assert!(
            record.admission_open,
            "Rejected range must leave the healthy service available"
        );
        assert_eq!(record.phase, "ready");
        assert!(record.operation.is_none());
        assert!(
            maintenance(
                &service,
                Path::new("/unused"),
                &mut client,
                &json!({"operation":"unknown-recovery"}),
                true
            )
            .is_err()
        );
        assert!(
            service.record().unwrap().admission_open,
            "Unknown recovery must not close healthy admissions"
        );
        assert!(service.record().unwrap().operation.is_none());
    }
    #[test]
    fn graph_arguments_cannot_select_foreign_projects_or_admin_operations() {
        assert!(
            bounded_query(
                "search_graph",
                &json!({"project":"foreign","name_pattern":"secret"})
            )
            .is_err()
        );
        assert!(bounded_query("query_graph", &json!({"query":"MATCH (n) RETURN n"})).is_err());
        assert!(
            bounded_query("trace_path", &json!({"function_name":"handler","depth":10})).is_err()
        );
        assert!(
            bounded_query(
                "search_graph",
                &json!({"name_pattern":"handler","limit":21})
            )
            .is_err()
        );
        let q = bounded_query(
            "trace_path",
            &json!({"function_name":"handler","direction":"inbound"}),
        )
        .unwrap();
        assert_eq!(q["project"], "scope-repo");
        assert_eq!(q["depth"], 1);
    }
}

#[cfg(test)]
mod retirement_contract_tests {
    use super::*;
    // The production control handler refuses live admission/reservations and
    // confirms retirement only after closing its owned native client.
    // Protects admission and reservation refusal in the production retirement handler.
    #[test]
    fn settings_model_retire_control_preserves_active_reservations(){
        let d=tempfile::tempdir().unwrap();let project=d.path().join("project");fs::create_dir(&project).unwrap();
        fs::write(project.join("a.rs"),"fn a(){}\n").unwrap();
        let service=Service::create(&d.path().join("store"),&crate::cbm_service::Snapshot::capture(&project,&["a.rs".into()]).unwrap(),"0.12.0").unwrap();
        service.mark_ready().unwrap();let mut client=None;
        assert!(handle(&service,d.path(),&mut client,&json!({"action":"retire"})).is_err());
        let r=service.record().unwrap();service.reserve("host","root",&r.snapshot,r.generation,&r.version).unwrap();
        {let _gate=service.gate().unwrap();let mut r=service.record().unwrap();r.admission_open=false;service.save(&r).unwrap();}
        assert!(handle(&service,d.path(),&mut client,&json!({"action":"retire"})).is_err());
        assert_eq!(service.record().unwrap().reservations.len(),1);
        service.release("host","root").unwrap();
        assert_eq!(handle(&service,d.path(),&mut client,&json!({"action":"retire"})).unwrap()["retired"],true);
        assert_eq!(service.record().unwrap().phase,"retired");
    }
}

#[cfg(test)]
mod native_tool_cancellation_tests {
    use super::*;
    // Protects trust revocation during an in-flight native index. Oracle: the
    // public MCP wait checks authority between poll slices and drains its group.
    #[test]
    fn external_tools_revocation_stops_native_index(){
        use std::os::unix::fs::PermissionsExt;
        let d=tempfile::tempdir().unwrap();let exe=d.path().join("cbm");
        std::fs::write(&exe,r#"#!/usr/bin/python3
import json,sys,time
for line in sys.stdin:
 r=json.loads(line)
 if r.get('method')=='initialize':
  print(json.dumps({'jsonrpc':'2.0','id':r['id'],'result':{'protocolVersion':'2025-11-25','serverInfo':{'version':'fixture'}}}),flush=True)
 elif 'id' in r:
  time.sleep(30)
"#).unwrap();std::fs::set_permissions(&exe,std::fs::Permissions::from_mode(0o700)).unwrap();
        let spec=json!({"command":exe,"cwd":d.path()});
        let mut client=Client::native_tracked(&spec,&native_environment(&spec).unwrap(),std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false))).unwrap();
        let checks=std::cell::Cell::new(0);let start=Instant::now();
        let error=client.rpc_checked("tools/call",json!({"name":"index_repository","arguments":{}}),Duration::from_secs(30),||{checks.set(checks.get()+1);if checks.get()>=3{Err("Project trust changed".into())}else{Ok(())}}).unwrap_err();
        assert_eq!(error,"Project trust changed");assert!(start.elapsed()<Duration::from_secs(3));drop(client);
    }
}
