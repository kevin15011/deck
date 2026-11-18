//! Fixed snapshot transformation with bounded pipes, write confinement and settlement.
use crate::{
    Store,
    managed_tools::{Artifacts, Directory},
    tasks::digest,
};
use deck2_shared::HelperSelection;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::{
    os::fd::AsRawFd,
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{io::AsyncReadExt, process::Command};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Snapshot {
    pub id: String,
    pub host: String,
    pub project: String,
    pub root: String,
    pub task: String,
    pub attempt: String,
    pub call: String,
    pub path: String,
    pub sha256: String,
    pub text: String,
    pub artifact: HelperSelection,
}
// Schema 5 may be genuine S5a (no snapshot tables) or a pre-boundary S5b
// store. Schema 6 promises all tables; never silently recreate missing evidence.
pub(crate) fn inspect_snapshots(
    conn: &rusqlite::Connection,
    project: &str,
    required: bool,
) -> Result<(), String> {
    let invalid = "Unsupported or corrupt snapshot state; preserve it for inspection";
    let count: u32 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE name IN ('read_snapshots','snapshot_views','snapshot_accesses') AND type='table'",
        [], |r| r.get(0),
    ).map_err(|_| invalid)?;
    if !required && count == 0 {
        return Ok(());
    }
    if count != 3 {
        return Err(invalid.into());
    }
    let host: String = conn
        .query_row("SELECT value FROM meta WHERE key='host'", [], |r| r.get(0))
        .map_err(|_| invalid)?;
    let mut stmt = conn
        .prepare("SELECT id,attempt,call,body FROM read_snapshots")
        .map_err(|_| invalid)?;
    for row in stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|_| invalid)?
    {
        let (id, attempt, call, body) = row.map_err(|_| invalid)?;
        let s: Snapshot = serde_json::from_str(&body).map_err(|_| invalid)?;
        if s.id != id
            || s.attempt != attempt
            || s.call != call
            || s.host != host
            || (s.project != project && conn.query_row("SELECT json_extract(s.body,'$.project.root') FROM receipts r JOIN sessions s ON s.id=json_extract(r.body,'$.session') WHERE r.id=?1",[&s.root],|r|r.get::<_,String>(0)).ok().as_ref()!=Some(&s.project))
            || s.text.len() > 65536
            || digest(s.text.as_bytes()) != s.sha256
        {
            return Err(invalid.into());
        }
    }
    for table in ["snapshot_views", "snapshot_accesses"] {
        let mut stmt = conn
            .prepare(&format!("SELECT id,body FROM {table}"))
            .map_err(|_| invalid)?;
        for row in stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|_| invalid)?
        {
            let (_, body) = row.map_err(|_| invalid)?;
            serde_json::from_str::<serde_json::Value>(&body).map_err(|_| invalid)?;
        }
    }
    Ok(())
}
impl Store {
    pub(crate) fn init_snapshots(&self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS read_snapshots(id TEXT PRIMARY KEY, attempt TEXT NOT NULL, call TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(attempt,call)); CREATE TABLE IF NOT EXISTS snapshot_views(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS snapshot_accesses(id TEXT PRIMARY KEY,body TEXT NOT NULL);").map_err(|_|"Cannot initialize snapshots".into())
    }
    // Exact authority/provenance fields are explicit at this boundary.
    #[allow(clippy::too_many_arguments)]
    pub fn capture_snapshot(
        &self,
        root: &str,
        task: &str,
        attempt: &str,
        call: &str,
        path: &str,
        text: String,
        artifact: HelperSelection,
    ) -> Result<Snapshot, String> {
        let count: u32 = self
            .conn
            .query_row(
                "SELECT count(*) FROM read_snapshots WHERE attempt=?1",
                [attempt],
                |r| r.get(0),
            )
            .map_err(|_| "Cannot inspect snapshot budget")?;
        if count >= 32 {
            return Err("Snapshot budget exhausted".into());
        }
        let snap = Snapshot {
            id: uuid::Uuid::new_v4().to_string(),
            host: self.host_id()?,
            project: self.session_project(&self.get(root)?.ok_or("Snapshot root missing")?.session)?.root,
            root: root.into(),
            task: task.into(),
            attempt: attempt.into(),
            call: call.into(),
            path: path.into(),
            sha256: digest(text.as_bytes()),
            text,
            artifact,
        };
        self.conn
            .execute(
                "INSERT INTO read_snapshots VALUES(?1,?2,?3,?4)",
                rusqlite::params![
                    snap.id,
                    snap.attempt,
                    snap.call,
                    serde_json::to_string(&snap).unwrap()
                ],
            )
            .map_err(|_| "Cannot retain exact source snapshot")?;
        Ok(snap)
    }
    pub fn snapshot_view(&self, view: &View) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO snapshot_views VALUES(?1,?2)",
                rusqlite::params![view.snapshot.id, serde_json::to_string(view).unwrap()],
            )
            .map_err(|_| "Cannot retain helper result evidence")?;
        Ok(())
    }
    pub fn snapshot_access(&self, snapshot: &str, attempt: &str, call: &str) -> Result<(), String> {
        let body = serde_json::json!({"snapshot":snapshot,"attempt":attempt,"call":call,"method":"read_snapshot"});
        self.conn
            .execute(
                "INSERT INTO snapshot_accesses VALUES(?1,?2)",
                rusqlite::params![uuid::Uuid::new_v4().to_string(), body.to_string()],
            )
            .map_err(|_| "Cannot record exact retrieval")?;
        Ok(())
    }
    pub fn root_snapshots(&self, root: &str) -> Result<Vec<serde_json::Value>, String> {
        let mut q = self
            .conn
            .prepare("SELECT body FROM read_snapshots")
            .map_err(|_| "Cannot read snapshots")?;
        let rows = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|_| "Cannot list snapshots")?;
        let mut result = vec![];
        for row in rows {
            let s: Snapshot = serde_json::from_str(&row.map_err(|_| "Cannot read snapshot")?)
                .map_err(|_| "Corrupt snapshot")?;
            if s.root == root {
                let view: Option<String> = self
                    .conn
                    .query_row(
                        "SELECT body FROM snapshot_views WHERE id=?1",
                        [&s.id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|_| "Cannot read helper result")?;
                result.push(serde_json::json!({"id":s.id,"path":s.path,"sha256":s.sha256,"artifact":s.artifact,"attempt":s.attempt,"view":view.map(|v|serde_json::from_str::<serde_json::Value>(&v)).transpose().map_err(|_|"Invalid helper evidence")?}));
            }
        }
        Ok(result)
    }
    pub fn read_snapshot(&self, id: &str, attempt: Option<&str>) -> Result<Snapshot, String> {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err("Invalid snapshot identity".into());
        }
        let body: String = self
            .conn
            .query_row("SELECT body FROM read_snapshots WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(|_| "Snapshot unavailable")?;
        let s: Snapshot = serde_json::from_str(&body).map_err(|_| "Invalid retained snapshot")?;
        if s.id != id
            || s.host != self.host_id()?
            || s.project != self.session_project(&self.get(&s.root)?.ok_or("Snapshot root missing")?.session)?.root
            || attempt.is_some_and(|a| a != s.attempt)
            || digest(s.text.as_bytes()) != s.sha256
            || s.text.len() > 65536
        {
            return Err("Snapshot ownership/hash mismatch".into());
        }
        Ok(s)
    }
}
#[derive(Default)]
pub struct Helpers {
    pub stopping: AtomicBool,
    pub uncertain: AtomicBool,
    pids: Mutex<std::collections::HashSet<u32>>,
    pub active: std::sync::atomic::AtomicU32,
}
impl Helpers {
    pub fn cancel(&self) {
        let pids = self.pids.lock().unwrap();
        self.stopping.store(true, Ordering::SeqCst);
        for pid in pids.iter() {
            unsafe {
                libc::kill(-(*pid as i32), libc::SIGKILL);
            }
        }
    }
    pub async fn settle(&self) -> Result<(), String> {
        self.cancel();
        let wait = async {
            while self.active.load(Ordering::SeqCst) > 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        if tokio::time::timeout(Duration::from_secs(5), wait)
            .await
            .is_err()
            || self.uncertain.load(Ordering::SeqCst)
        {
            Err("Helper cleanup unknown; retain attempt ownership".into())
        } else {
            Ok(())
        }
    }
}
impl Drop for Helpers {
    fn drop(&mut self) {
        self.cancel();
    }
}
struct OwnedCall {
    helpers: Arc<Helpers>,
    pid: Option<u32>,
    settled: bool,
}
impl Drop for OwnedCall {
    fn drop(&mut self) {
        if let Some(pid) = self.pid {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
            self.helpers.pids.lock().unwrap().remove(&pid);
        }
        if !self.settled {
            self.helpers.uncertain.store(true, Ordering::SeqCst);
        }
        self.helpers.active.fetch_sub(1, Ordering::SeqCst);
    }
}
#[derive(Serialize)]
pub struct View {
    pub snapshot: Snapshot,
    pub outcome: String,
    pub reason: Option<String>,
    pub text: String,
    pub helper_ms: u64,
}
pub fn delivery(view: &View) -> serde_json::Value {
    let mut payload = serde_json::to_value(view).expect("serializable snapshot view");
    payload["snapshot"].as_object_mut().unwrap().remove("text");
    payload
}
pub async fn compact(
    s: Snapshot,
    artifacts: Result<Artifacts, String>,
    helpers: Arc<Helpers>,
    live: impl Fn() -> bool,
) -> Result<View, String> {
    let start = std::time::Instant::now();
    let mut fallback = None;
    if !live() || helpers.stopping.load(Ordering::SeqCst) {
        return Err("Snapshot call cancelled".into());
    }
    let result = match artifacts {
        Ok(a) => match prepare(&a, &s) {
            Ok((file, d)) => execute(file, d, helpers.clone(), &live).await,
            Err(e) => Ok(Err(e)),
        },
        Err(e) => Ok(Err(e)),
    }?;
    if !live() || helpers.stopping.load(Ordering::SeqCst) {
        return Err("Snapshot call cancelled; no successful result".into());
    }
    let text = match result {
        Ok(t) => t,
        Err(e) => {
            fallback = Some(e);
            s.text.clone()
        }
    };
    Ok(View {
        outcome: if fallback.is_some() {
            "exact_fallback"
        } else {
            "lossy"
        }
        .into(),
        reason: fallback,
        text,
        snapshot: s,
        helper_ms: start.elapsed().as_millis() as u64,
    })
}
fn prepare(a: &Artifacts, s: &Snapshot) -> Result<(std::fs::File, Directory), String> {
    let f = a.pin(&s.artifact)?;
    let d = a.invocation(&s.artifact, &s.host, &s.attempt, &s.call)?;
    d.write("snapshot.rs", s.text.as_bytes())?;
    for name in ["config", "data", "cache", "tmp"] {
        d.directory(name, true)?;
    }
    Ok((f, d))
}
async fn pipe(mut stream: impl tokio::io::AsyncRead + Unpin) -> Result<Vec<u8>, String> {
    let mut b = vec![];
    stream
        .read_buf(&mut b)
        .await
        .map_err(|_| "Helper pipe fault")?;
    loop {
        if b.len() > 16384 {
            return Err("Helper output exceeded 16 KiB".into());
        }
        let mut block = [0u8; 2048];
        let n = stream
            .read(&mut block)
            .await
            .map_err(|_| "Helper pipe fault")?;
        if n == 0 {
            break;
        }
        b.extend_from_slice(&block[..n]);
    }
    Ok(b)
}
async fn execute(
    file: std::fs::File,
    d: Directory,
    helpers: Arc<Helpers>,
    live: &impl Fn() -> bool,
) -> Result<Result<String, String>, String> {
    let fd = file.as_raw_fd();
    let dirfd = d.0.as_raw_fd();
    let path = d.path();
    let guard = std::ffi::CString::new(path.as_os_str().as_encoded_bytes())
        .map_err(|_| "Invalid helper scratch")?;
    let mut cmd = Command::new(format!("/proc/self/fd/{fd}"));
    cmd.args(["read", "--level", "minimal"])
        .arg(path.join("snapshot.rs"))
        .current_dir(&path)
        .env_clear();
    if let Some(home) = std::env::var_os("HOME") {
        cmd.env("HOME", home);
    }
    for (key, value) in [
        ("XDG_CONFIG_HOME", path.join("config")),
        ("XDG_DATA_HOME", path.join("data")),
        ("XDG_CACHE_HOME", path.join("cache")),
        ("TMPDIR", path.join("tmp")),
    ] {
        cmd.env(key, value);
    }
    cmd.env("PATH", "/usr/bin:/bin")
        .env("LANG", "C.UTF-8")
        .env("NO_COLOR", "1")
        .env("RTK_TELEMETRY_DISABLED", "1")
        .env("RTK_RECALL", "0")
        .env("RTK_TEE", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    unsafe {
        cmd.pre_exec(move || {
            libc::setpgid(0, 0);
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
            if libc::fcntl(fd, libc::F_SETFD, 0) < 0 || libc::fcntl(dirfd, libc::F_SETFD, 0) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            crate::opencode::restrict_writes(std::slice::from_ref(&guard))
        });
    }
    let (mut child, mut owner, pid) = {
        let mut pids = helpers.pids.lock().unwrap();
        if helpers.stopping.load(Ordering::SeqCst) {
            return Err("Helper dispatch cancelled".into());
        }
        helpers.active.fetch_add(1, Ordering::SeqCst);
        let mut owner = OwnedCall {
            helpers: helpers.clone(),
            pid: None,
            settled: true,
        };
        let child = match cmd.spawn() {
            Ok(c) => c,
            Err(_) => {
                drop(pids);
                return Ok(Err("Helper spawn/write confinement unavailable".into()));
            }
        };
        let pid = child.id().ok_or("Helper process identity unavailable")?;
        owner.pid = Some(pid);
        owner.settled = false;
        pids.insert(pid);
        (child, owner, pid)
    };
    let stdout = child.stdout.take().ok_or("Helper stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("Helper stderr unavailable")?;
    let result = {
        let run = async {
            let (status, out, err) = tokio::try_join!(
                async {
                    child
                        .wait()
                        .await
                        .map_err(|_| "Helper wait failed".to_string())
                },
                pipe(stdout),
                pipe(stderr)
            )?;
            let _ = err;
            if !status.success() {
                return Err("Helper nonzero exit".into());
            }
            let text = String::from_utf8(out).map_err(|_| "Helper output is not UTF-8")?;
            if text.trim().is_empty() {
                return Err("Helper output is empty".into());
            }
            Ok(text)
        };
        tokio::pin!(run);
        let deadline = tokio::time::sleep(Duration::from_secs(3));
        tokio::pin!(deadline);
        loop {
            tokio::select! {r=&mut run=>break Some(r),_=&mut deadline=>break Some(Err("Helper exceeded 3 second deadline".into())),_=tokio::time::sleep(Duration::from_millis(15))=>{if !live()||helpers.stopping.load(Ordering::SeqCst){break None}}}
        }
    };
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .map_err(|_| "Helper reap timeout; ownership unknown")?
        .map_err(|_| "Helper reap failed; ownership unknown")?;
    crate::native::reap_group(pid).await?;
    owner.settled = true;
    if !live() || helpers.stopping.load(Ordering::SeqCst) || result.is_none() {
        return Err("Helper cancelled; no successful result".into());
    }
    Ok(result.unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    // Protects exact retained bytes despite later project changes and foreign IDs.
    #[test]
    fn exact_snapshot_retrieval_is_attempt_scoped_and_hash_checked() {
        let s = snapshot_store("/fixture");
        let artifact = crate::managed_tools::release("0.50.0").unwrap().selection;
        let snap = s
            .capture_snapshot(
                "snapshot-root",
                "task",
                "attempt",
                "call",
                "src/file.rs",
                "original".into(),
                artifact,
            )
            .unwrap();
        assert_eq!(
            s.read_snapshot(&snap.id, Some("attempt")).unwrap().text,
            "original"
        );
        assert!(s.read_snapshot(&snap.id, Some("foreign")).is_err());
        s.conn
            .execute(
                "UPDATE read_snapshots SET body=replace(body,'original','modified')",
                [],
            )
            .unwrap();
        assert!(s.read_snapshot(&snap.id, None).is_err());
    }
    fn helper(script: &str) -> (tempfile::TempDir, File, Directory) {
        let tmp = tempfile::tempdir().unwrap();
        let d = Directory::open_root(&tmp.path().join("owned")).unwrap();
        let path = tmp.path().join("helper");
        std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o500)).unwrap();
        let f = File::open(&path).unwrap();
        d.write("snapshot.rs", b"original source").unwrap();
        for name in ["config", "data", "cache", "tmp"] {
            d.directory(name, true).unwrap();
        }
        (tmp, f, d)
    }
    use std::fs::File;
    // External fake process only; same Rust supervision/confinement used in production.
    #[tokio::test]
    async fn bounded_helper_success_faults_and_cancellation_settle() {
        for (script, ok) in [
            ("printf 'useful output'", true),
            ("exit 2", false),
            ("printf '\\377'", false),
            ("head -c 20000 /dev/zero", false),
            ("sleep 5", false),
        ] {
            let (_tmp, f, d) = helper(script);
            let h = Arc::new(Helpers::default());
            let result = execute(f, d, h.clone(), &|| true).await.unwrap();
            assert_eq!(result.is_ok(), ok, "{script}: {result:?}");
            assert_eq!(h.active.load(Ordering::SeqCst), 0);
            assert!(!h.uncertain.load(Ordering::SeqCst));
        }
        let (_tmp, f, d) = helper("printf started; sleep 5");
        let h = Arc::new(Helpers::default());
        let start = std::time::Instant::now();
        let result = execute(f, d, h.clone(), &|| {
            start.elapsed() < Duration::from_millis(80)
        })
        .await;
        assert!(result.is_err());
        h.settle().await.unwrap();
    }
    // Lossy delivery must not silently include the full source payload; the exact
    // source is available only through the explicit retained snapshot route.
    #[test]
    fn lossy_delivery_retains_identity_without_repeating_exact_source() {
        let store = snapshot_store("/fixture");
        let snap = store
            .capture_snapshot(
                "snapshot-root",
                "task",
                "attempt",
                "call",
                "file.rs",
                "UNIQUE_RAW_SOURCE_SENTINEL".into(),
                crate::managed_tools::release("0.50.0").unwrap().selection,
            )
            .unwrap();
        let view = View {
            snapshot: snap.clone(),
            outcome: "lossy".into(),
            reason: None,
            text: "pub fn compacted() {}".into(),
            helper_ms: 1,
        };
        let payload = delivery(&view);
        assert_eq!(payload["text"], "pub fn compacted() {}");
        assert_eq!(payload["snapshot"]["sha256"], snap.sha256);
        assert!(!payload.to_string().contains("UNIQUE_RAW_SOURCE_SENTINEL"));
        assert_eq!(
            store.read_snapshot(&snap.id, Some("attempt")).unwrap().text,
            "UNIQUE_RAW_SOURCE_SENTINEL"
        );
    }
    // A dropped request cannot silently release helper/process ownership.
    #[tokio::test]
    async fn interrupted_helper_future_retains_cleanup_uncertainty() {
        let (_tmp, file, directory) = helper("printf started; sleep 5");
        let helpers = Arc::new(Helpers::default());
        let running = helpers.clone();
        let handle = tokio::spawn(async move { execute(file, directory, running, &|| true).await });
        tokio::time::timeout(Duration::from_secs(2), async {
            while helpers.active.load(Ordering::SeqCst) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        handle.abort();
        assert!(handle.await.is_err());
        assert!(helpers.uncertain.load(Ordering::SeqCst));
        assert!(helpers.settle().await.is_err());
    }
    #[tokio::test]
    async fn absent_helper_fallback_keeps_captured_bytes_and_cancellation_has_no_success() {
        let s = snapshot_store("/fixture");
        let snap = s
            .capture_snapshot(
                "snapshot-root",
                "task",
                "attempt",
                "call",
                "file.rs",
                "original".into(),
                crate::managed_tools::release("0.50.0").unwrap().selection,
            )
            .unwrap();
        let h = Arc::new(Helpers::default());
        let view = compact(
            snap.clone(),
            Err("missing artifact".into()),
            h.clone(),
            || true,
        )
        .await
        .unwrap();
        assert_eq!(view.text, "original");
        assert_eq!(view.snapshot, snap);
        assert_eq!(view.outcome, "exact_fallback");
        assert!(
            compact(snap, Err("missing".into()), h, || false)
                .await
                .is_err()
        );
    }
}

#[cfg(test)]
mod source_boundaries {
    #[test]
    fn captured_source_survives_project_change_and_rejects_non_source_targets() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("file.rs");
        std::fs::write(&source, "original").unwrap();
        std::fs::write(tmp.path().join("bad.rs"), [255]).unwrap();
        std::fs::write(tmp.path().join("huge.rs"), vec![b'a'; 65537]).unwrap();
        std::fs::create_dir(tmp.path().join("directory.rs")).unwrap();
        std::os::unix::fs::symlink(&source, tmp.path().join("link.rs")).unwrap();
        let scope = vec![
            "file.rs".into(),
            "bad.rs".into(),
            "huge.rs".into(),
            "directory.rs".into(),
            "link.rs".into(),
        ];
        let original = crate::opencode::scoped_file(tmp.path(), &scope, "file.rs").unwrap();
        let s = super::snapshot_store(tmp.path().to_str().unwrap());
        let snap = s
            .capture_snapshot(
                "snapshot-root",
                "task",
                "attempt",
                "call",
                "file.rs",
                original,
                crate::managed_tools::release("0.50.0").unwrap().selection,
            )
            .unwrap();
        std::fs::write(&source, "changed later").unwrap();
        assert_eq!(
            s.read_snapshot(&snap.id, Some("attempt")).unwrap().text,
            "original"
        );
        for path in [
            "bad.rs",
            "huge.rs",
            "directory.rs",
            "link.rs",
            "../file.rs",
            "/etc/passwd",
            "outside.rs",
        ] {
            assert!(
                crate::opencode::scoped_file(tmp.path(), &scope, path).is_err(),
                "{path}"
            );
        }
    }
}

#[cfg(test)]
fn snapshot_store(project:&str)->Store {
    let mut s=Store::open_memory(project).unwrap();
    s.accept(&deck2_shared::Submit{api:deck2_shared::API,id:"snapshot-root".into(),prompt:"Fixture captured source".into(),mode:deck2_shared::Mode::ReadOnly,attachments:vec![]}).unwrap();s
}
