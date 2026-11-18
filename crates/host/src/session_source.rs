//! Incremental Git scope observations; watcher labels never certify source bytes.
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{File, Metadata},
    io::Read,
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::fs::MetadataExt,
    },
    path::{Component, Path},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
#[derive(Default)]
pub(crate) struct Observer {
    #[cfg(test)]
    read_bytes: u64,
    files: BTreeMap<Vec<u8>, (String, String)>,
}
pub(crate) fn git(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut c = Command::new("git");
    c.args([
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
    ])
    .arg("-C")
    .arg(root)
    .args(args)
    .env("GIT_OPTIONAL_LOCKS", "0")
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    for (k, _) in std::env::vars_os() {
        if k.as_encoded_bytes().starts_with(b"GIT_") {
            c.env_remove(k);
        }
    }
    c.env("GIT_OPTIONAL_LOCKS", "0");
    let mut child = c.spawn().map_err(|_| "source-git-unavailable")?;
    let stdout = child.stdout.take().ok_or("source-git-unavailable")?;
    let reader = std::thread::spawn(move || {
        let mut b = Vec::new();
        stdout
            .take(32 * 1024 * 1024 + 1)
            .read_to_end(&mut b)
            .map(|_| b)
    });
    let until = Instant::now() + Duration::from_secs(15);
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(2)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| "source-git-unavailable")?
        .map_err(|_| "source-git-unavailable")?;
    if !status.is_some_and(|s| s.success()) || bytes.len() > 32 * 1024 * 1024 {
        return Err("source-git-unavailable".into());
    }
    Ok(bytes)
}
pub(crate) fn canonical(root: &Path) -> Result<std::path::PathBuf, String> {
    let root = root.canonicalize().map_err(|_| "source-root-unavailable")?;
    match git(&root, &["rev-parse", "--show-toplevel"]) {
        Ok(bytes) => Path::new(
            std::str::from_utf8(&bytes)
                .map_err(|_| "source-root-encoding")?
                .trim_end_matches('\n'),
        )
        .canonicalize()
        .map_err(|_| "source-root-unavailable".into()),
        Err(_) => Ok(root),
    }
}
fn stamp(m: &Metadata) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}:{}:{}",
        m.dev(),
        m.ino(),
        m.mode(),
        m.len(),
        m.mtime(),
        m.mtime_nsec(),
        m.ctime(),
        m.ctime_nsec()
    )
}
fn scoped(root: &File, path: &Path) -> Result<File, String> {
    let mut current = root.try_clone().map_err(|_| "source-unavailable")?;
    let parts = path.components().collect::<Vec<_>>();
    for (i, part) in parts.iter().enumerate() {
        let Component::Normal(name) = part else {
            return Err("source-path-invalid".into());
        };
        let name =
            std::ffi::CString::new(name.as_encoded_bytes()).map_err(|_| "source-path-invalid")?;
        let flags = libc::O_RDONLY
            | libc::O_NOFOLLOW
            | libc::O_NONBLOCK
            | libc::O_CLOEXEC
            | if i + 1 < parts.len() {
                libc::O_DIRECTORY
            } else {
                0
            };
        let fd = unsafe { libc::openat(current.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(
                if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound {
                    "source-deleted"
                } else {
                    "source-link-or-kind-unverified"
                }
                .into(),
            );
        }
        current = unsafe { File::from_raw_fd(fd) };
    }
    Ok(current)
}
impl Observer {
    pub fn snapshot(&mut self, root: &Path) -> Result<String, String> {
        use std::os::unix::ffi::OsStrExt;
        if root.canonicalize().ok().as_deref() != Some(root) {
            return Err("source-root-changed".into());
        }
        let directory = File::open(root).map_err(|_| "source-root-unavailable")?;
        let root_stamp = directory
            .metadata()
            .map_err(|_| "source-root-unavailable")?;
        let head =
            git(root, &["rev-parse", "--verify", "HEAD"]).unwrap_or_else(|_| b"unborn".to_vec());
        let inventory = git(
            root,
            &[
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
            ],
        )?;
        let names = inventory
            .split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .collect::<std::collections::BTreeSet<_>>();
        if names.len() > 100_000 {
            return Err("source-snapshot-limit".into());
        }
        let mut hash = Sha256::new();
        hash.update(&head);
        let mut next = BTreeMap::new();
        let mut bytes = 0u64;
        for name in names {
            hash.update((name.len() as u64).to_le_bytes());
            hash.update(name);
            let path = Path::new(std::ffi::OsStr::from_bytes(name));
            let mut f = match scoped(&directory, path) {
                Ok(f) => f,
                Err(e) if e == "source-deleted" => {
                    hash.update(b"deleted");
                    continue;
                }
                Err(e) => return Err(e),
            };
            let m = f.metadata().map_err(|_| "source-unavailable")?;
            if !m.is_file() {
                return Err("source-submodule-or-kind-unverified".into());
            }
            bytes = bytes.checked_add(m.len()).ok_or("source-snapshot-limit")?;
            if bytes > 1024 * 1024 * 1024 {
                return Err("source-snapshot-limit".into());
            }
            let identity = stamp(&m);
            let content = if let Some((old, digest)) =
                self.files.get(name).filter(|(old, _)| old == &identity)
            {
                let _ = old;
                digest.clone()
            } else {
                let mut content = Sha256::new();
                let mut chunk = [0; 65536];
                let mut read = 0u64;
                loop {
                    let n = f.read(&mut chunk).map_err(|_| "source-unavailable")?;
                    if n == 0 {
                        break;
                    }
                    read += n as u64;
                    #[cfg(test)]
                    {
                        self.read_bytes += n as u64;
                    }
                    if read > m.len() {
                        return Err("source-changing".into());
                    }
                    content.update(&chunk[..n]);
                }
                if identity != stamp(&f.metadata().map_err(|_| "source-unavailable")?) {
                    return Err("source-changing".into());
                }
                format!("{:x}", content.finalize())
            };
            // Also detect replacement/rename between opening and recording evidence.
            if identity
                != stamp(
                    &scoped(&directory, path)?
                        .metadata()
                        .map_err(|_| "source-changing")?,
                )
            {
                return Err("source-changing".into());
            }
            hash.update(m.mode().to_le_bytes());
            hash.update(content.as_bytes());
            next.insert(name.to_vec(), (identity, content));
        }
        if head
            != git(root, &["rev-parse", "--verify", "HEAD"]).unwrap_or_else(|_| b"unborn".to_vec())
        {
            return Err("source-changing".into());
        }
        let after = std::fs::metadata(root).map_err(|_| "source-root-changed")?;
        if root.canonicalize().ok().as_deref() != Some(root)
            || (root_stamp.dev(), root_stamp.ino()) != (after.dev(), after.ino())
        {
            return Err("source-root-changed".into());
        }
        self.files = next;
        Ok(format!("{:x}", hash.finalize()))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn git(root: &Path, args: &[&str]) {
        assert!(
            Command::new("git")
                .arg("-C")
                .arg(root)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
    // Oracle: Deck1 Git-tracked/nonignored scope, including offline clean commits.
    #[test]
    fn edits_rename_delete_and_offline_clean_commit_change_observation() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        git(r, &["init", "-q"]);
        git(r, &["config", "user.email", "fixture@example.invalid"]);
        git(r, &["config", "user.name", "Fixture"]);
        std::fs::write(r.join("old.rs"), "fn old_symbol() {}\n").unwrap();
        git(r, &["add", "."]);
        git(r, &["commit", "-qm", "initial"]);
        let mut o = Observer::default();
        let first = o.snapshot(r).unwrap();
        let bytes = o.read_bytes;
        assert_eq!(first, o.snapshot(r).unwrap());
        assert_eq!(
            bytes, o.read_bytes,
            "Warm observations must reuse unchanged content hashes"
        );
        std::fs::write(r.join("old.rs"), "fn new_symbol() {}\n").unwrap();
        let edited = o.snapshot(r).unwrap();
        assert_ne!(first, edited, "Source edit must invalidate graph evidence");
        std::fs::rename(r.join("old.rs"), r.join("new.rs")).unwrap();
        let renamed = o.snapshot(r).unwrap();
        assert_ne!(edited, renamed);
        std::fs::remove_file(r.join("new.rs")).unwrap();
        assert_ne!(renamed, o.snapshot(r).unwrap());
        std::fs::write(r.join("offline.rs"), "fn offline_symbol() {}\n").unwrap();
        git(r, &["add", "-A"]);
        git(r, &["commit", "-qm", "offline"]);
        assert_ne!(first, Observer::default().snapshot(r).unwrap());
    }
    #[test]
    fn unsupported_link_and_submodule_scope_is_not_certified() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        git(r, &["init", "-q"]);
        std::fs::write(r.join("source.rs"), "fn source() {}\n").unwrap();
        std::os::unix::fs::symlink(r.join("source.rs"), r.join("linked.rs")).unwrap();
        assert!(Observer::default().snapshot(r).is_err());
        std::fs::remove_file(r.join("linked.rs")).unwrap();
        git(r, &["config", "user.email", "fixture@example.invalid"]);
        git(r, &["config", "user.name", "Fixture"]);
        git(r, &["add", "."]);
        git(r, &["commit", "-qm", "initial"]);
        let head = String::from_utf8(super::git(r, &["rev-parse", "HEAD"]).unwrap()).unwrap();
        std::fs::create_dir(r.join("vendor")).unwrap();
        git(
            r,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("160000,{},vendor", head.trim()),
            ],
        );
        assert!(Observer::default().snapshot(r).is_err());
    }
}
