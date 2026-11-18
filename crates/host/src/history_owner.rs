//! Deck1's atomic hard-link reservation. Unknown owners fail closed; sockets
//! never establish release. The runner-mutation role also fences older Deck1s.
use super::{Result, at, bytes, error, names, private, root, value};
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};
pub(super) struct Owner {
    dir: File,
    nonce: String,
    guard: super::guard::Guard,
}
fn path(dir: &File) -> PathBuf {
    use std::os::fd::AsRawFd;
    PathBuf::from(format!("/proc/self/fd/{}", dir.as_raw_fd()))
}
fn absent(pid: u64) -> bool {
    pid > 0
        && pid <= i32::MAX as u64
        && unsafe { libc::kill(pid as i32, 0) } < 0
        && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
}
impl Owner {
    pub(super) fn acquire(source: &Path) -> Result<Self> {
        let socket = if source.join("daemon/daemon.sock").as_os_str().len() < 108 {
            source.join("daemon/daemon.sock")
        } else {
            PathBuf::from(format!("/tmp/deck-{}/daemon.sock", unsafe {
                libc::geteuid()
            }))
        };
        let source = root(source)?;
        let p = path(&source).join("daemon");
        match fs::create_dir(&p) {
            Ok(()) => fs::set_permissions(&p, fs::Permissions::from_mode(0o700))
                .map_err(|_| error("cannot protect reservation"))?,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(error("cannot reserve original owner")),
        }
        let dir = at(&source, "daemon", true)?;
        let p = path(&dir);
        if names(&dir, 1000)?.iter().any(|n| n == "daemon.lock") {
            let h = value(&dir, "daemon.lock", 8192)?;
            if !h["pid"].as_u64().is_some_and(absent) {
                return Err(error("original owner is active or unknown"));
            }
        }
        // Serialize stale reclamation with the original gate. Never reclaim an
        // unknown/interrupted gate based on age.
        fs::create_dir(p.join("daemon.lock.gate"))
            .map_err(|_| error("original ownership is contended"))?;
        struct Gate(PathBuf);
        impl Drop for Gate {
            fn drop(&mut self) {
                let _ = fs::remove_dir(&self.0);
            }
        }
        let _gate = Gate(p.join("daemon.lock.gate"));
        let entries = names(&dir, 1000)?;
        if entries
            .iter()
            .any(|n| n == "runner-mutation.json" || n == "runner-mutation.json.gate")
        {
            return Err(error("original runner maintenance is active or unknown"));
        }
        if entries.iter().any(|n| n == "daemon.lock") {
            let h = value(&dir, "daemon.lock", 8192)?;
            if h["v"] != 1 || !h["nonce"].is_string() || !h["pid"].as_u64().is_some_and(absent) {
                return Err(error("original owner is active or unknown"));
            }
            // Re-read under the same gate before touching exactly this dead owner.
            if value(&dir, "daemon.lock", 8192)? != h {
                return Err(error("original owner changed"));
            }
            fs::remove_file(p.join("daemon.lock"))
                .map_err(|_| error("cannot reserve dead owner"))?;
        }
        // An orphan socket or discovery record with an alive/unknown process is
        // not evidence that containment was released. Do not unlink either.

        if fs::symlink_metadata(&socket).is_ok() {
            return Err(error("original control socket ownership is unknown"));
        }
        if entries.iter().any(|n| n == "daemon.json") {
            let h = value(&dir, "daemon.json", 8192)?;
            if !h["pid"].as_u64().is_some_and(absent) {
                return Err(error("original discovery owner is active or unknown"));
            }
        }
        let nonce = uuid::Uuid::new_v4().to_string();
        let guard = super::guard::Guard::start(&dir, &nonce)?;
        let tmp = p.join(format!("daemon.lock.{}.tmp", nonce));
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|_| error("cannot create reservation"))?;
        let result = (|| {
            f.write_all(json!({"v":1,"pid":guard.pid,"nonce":nonce,"startedAt":crate::now(),"role":"runner-mutation"}).to_string().as_bytes()).and_then(|_|f.sync_all()).map_err(|_|error("cannot persist reservation"))?;
            fs::hard_link(&tmp, p.join("daemon.lock"))
                .map_err(|_| error("another original owner started"))?;
            dir.sync_all().map_err(|_| error("cannot sync reservation"))
        })();
        let _ = fs::remove_file(&tmp);
        result?;
        Ok(Self { dir, nonce, guard })
    }
    pub(super) fn track(&self, pid: u32) -> Result<()> {
        self.valid()?;
        self.guard.track(pid)
    }
    pub(super) fn valid(&self) -> Result<()> {
        let holder = value(&self.dir, "daemon.lock", 8192)?;
        if holder["nonce"] != self.nonce
            || holder["pid"] != self.guard.pid
            || unsafe { libc::kill(self.guard.pid, 0) } != 0
        {
            return Err(error("original ownership lost"));
        }
        Ok(())
    }
}

/// Pure observation: no signal other than signal-0 is ever sent to disk PIDs.
/// All leases, including terminal-task leftovers, must prove containment dead.
pub(super) fn settled(dir: &File) -> Result<()> {
    if !names(dir, 100_000)?.iter().any(|n| n == "tasks") {
        return Ok(());
    }
    let tasks = at(dir, "tasks", true)?;
    for name in names(&tasks, 100_000)? {
        let task = at(&tasks, &name, true)?;
        if !names(&task, 1000)?.iter().any(|n| n == "lease.json") {
            continue;
        }
        let mut f = at(&task, "lease.json", false)?;
        private(&f, false)?;
        let lease: Value = serde_json::from_slice(&bytes(&mut f, 8192)?)
            .map_err(|_| error("invalid original process lease"))?;
        let anchor = &lease["anchor"];
        if f.metadata()
            .map_err(|_| error("cannot inspect process lease"))?
            .nlink()
            != 1
            || !lease["nonce"].is_string()
            || !lease["createdAt"].is_string()
            || lease["daemon"]["pid"]
                .as_u64()
                .is_none_or(|p| p == 0 || p > i32::MAX as u64)
            || lease["v"] != 1
            || lease["taskId"] != name
            || lease["state"] != "live"
            || anchor["platform"] != "linux"
            || lease["group"] != anchor["pid"]
        {
            return Err(error("original process containment is unsettled"));
        }
        let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id")
            .map_err(|_| error("boot identity unknown"))?;
        let mut changed = false;
        for identity in [anchor, &lease["worker"]]
            .into_iter()
            .filter(|i| !i.is_null())
        {
            let pid = identity["pid"]
                .as_u64()
                .filter(|p| *p > 0 && *p <= i32::MAX as u64)
                .ok_or_else(|| error("invalid original process identity"))?;
            let old = identity["boot"]
                .as_str()
                .filter(|b| uuid::Uuid::parse_str(b).is_ok())
                .ok_or_else(|| error("invalid original boot identity"))?;
            if identity["platform"] != "linux"
                || !identity["starttime"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
            {
                return Err(error("invalid original process identity"));
            }
            if old != boot.trim() {
                changed = true;
                continue;
            }
            match fs::read_to_string(format!("/proc/{pid}/stat")) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Ok(stat) => {
                    let fields = stat
                        .rsplit_once(')')
                        .ok_or_else(|| error("process probe unknown"))?
                        .1
                        .split_whitespace()
                        .collect::<Vec<_>>();
                    if fields.get(19).copied() != identity["starttime"].as_str()
                        || !fields.first().is_some_and(|s| matches!(*s, "Z" | "X"))
                    {
                        return Err(error("original process is alive, reused or unknown"));
                    }
                }
                _ => return Err(error("original process probe unknown")),
            }
        }
        let group = lease["group"]
            .as_u64()
            .filter(|p| *p > 0 && *p <= i32::MAX as u64)
            .ok_or_else(|| error("original group unknown"))?;
        if !(changed
            || unsafe { libc::kill(-(group as i32), 0) } < 0
                && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH))
        {
            return Err(error("original process group is alive or unknown"));
        }
    }
    Ok(())
}
