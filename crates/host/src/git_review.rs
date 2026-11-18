//! Read-only working-tree review. Git runs only against private metadata with no
//! repository configuration, hooks, attributes, alternates, or inherited environment.
use crate::server::{App, problem};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::ffi::OsStrExt,
    },
    path::Path as FsPath,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
const FILES: usize = 256;
const SCANNED: usize = 4096;
const WORK_SCANNED: usize = 16384;
const CONTENT: usize = 256 * 1024;
const TOTAL: usize = 8 * 1024 * 1024;
const METADATA: usize = 256 * 1024 * 1024;
pub struct Runtime {
    pub auto_gate: Arc<Semaphore>,
    pub(crate) automatic: Mutex<std::collections::HashMap<String,crate::cbm_automatic::Job>>,
    #[cfg(test)]
    pub(crate) native_starts: Mutex<Option<tokio::sync::mpsc::UnboundedSender<tokio::sync::mpsc::Sender<()>>>>,
    pub gate: Arc<Semaphore>,
    #[cfg(test)]
    pub scan_pause: Mutex<Option<(tokio::sync::oneshot::Sender<()>, std::sync::mpsc::Receiver<()>)>>,
    snapshot: Mutex<std::collections::HashMap<String, Snapshot>>,
}
struct Work {
    temp: tempfile::TempDir,
    _permit: Option<Arc<OwnedSemaphorePermit>>,
    #[cfg(test)]
    unknown: Arc<std::sync::atomic::AtomicBool>,
}
impl Work {
    fn new(permit: Option<Arc<OwnedSemaphorePermit>>) -> Result<Arc<Self>, String> {
        let temp = tempfile::tempdir().map_err(|_| error("Cannot prepare private Git review"))?;
        let empty = temp.path().join("empty.git");
        fs::create_dir_all(empty.join("objects"))
            .map_err(|_| error("Cannot prepare isolated Git metadata"))?;
        fs::create_dir(empty.join("refs"))
            .map_err(|_| error("Cannot prepare isolated Git refs"))?;
        fs::write(empty.join("HEAD"), "ref: refs/heads/main\n")
            .map_err(|_| error("Cannot prepare isolated Git HEAD"))?;
        Ok(Arc::new(Self {
            temp,
            _permit: permit,
            #[cfg(test)]
            unknown: Default::default(),
        }))
    }
    fn path(&self) -> &FsPath {
        self.temp.path()
    }
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            gate: Arc::new(Semaphore::new(1)),
            automatic: Mutex::new(Default::default()),
            #[cfg(test)]
            native_starts: Mutex::new(None),
            // Unit API fixtures park background native effects at admission.
            // Lifecycle tests explicitly admit their worker; production has one slot.
            auto_gate: Arc::new(Semaphore::new(if cfg!(test) {0} else {1})),
            #[cfg(test)]
            scan_pause: Mutex::new(None),
            snapshot: Mutex::new(Default::default()),
        }
    }
}
#[derive(Clone, Serialize)]
pub struct Entry {
    id: String,
    section: String,
    path: String,
    status: String,
    message: String,
}
struct Data {
    entry: Entry,
    old: Vec<u8>,
    new: Vec<u8>,
}
struct Snapshot {
    revision: String,
    files: Vec<Data>,
    captured_ms: u64,
}
#[derive(Serialize)]
struct Catalog {
    revision: String,
    captured_ms: u64,
    files: Vec<Entry>,
    note: &'static str,
}
#[derive(Serialize)]
struct Document {
    revision: String,
    file: Entry,
    kind: &'static str,
    patch: String,
    message: String,
}
fn error(message: &str) -> String {
    message.into()
}
fn check(deadline: Instant) -> Result<(), String> {
    if Instant::now() > deadline {
        Err(error("Git review time limit reached; refresh to retry"))
    } else {
        Ok(())
    }
}
// Open every component relative to an already-owned descriptor, with no symlink
// following. Directory replacement cannot redirect a read outside the selected root.
fn open(root: &File, path: &FsPath, directory: bool) -> Result<File, String> {
    let mut parent = root
        .try_clone()
        .map_err(|_| error("Cannot duplicate review directory"))?;
    let components: Vec<_> = path.components().collect();
    if components.is_empty() {
        return Err(error("Invalid empty review path"));
    }
    for (i, part) in components.iter().enumerate() {
        let std::path::Component::Normal(name) = part else {
            return Err(error("Unsupported path outside selected project"));
        };
        let name =
            std::ffi::CString::new(name.as_bytes()).map_err(|_| error("Invalid Git path"))?;
        let flags = libc::O_RDONLY
            | libc::O_CLOEXEC
            | libc::O_NOFOLLOW
            | libc::O_NONBLOCK
            | if directory || i + 1 < components.len() {
                libc::O_DIRECTORY
            } else {
                0
            };
        let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(error(
                "File unavailable or unsupported link/metadata layout; refresh to retry",
            ));
        }
        parent = unsafe { File::from_raw_fd(fd) };
    }
    Ok(parent)
}
fn read(root: &File, path: &FsPath, max: usize) -> Result<Vec<u8>, String> {
    let f = open(root, path, false)?;
    if !f
        .metadata()
        .map_err(|_| error("Cannot inspect file"))?
        .is_file()
    {
        return Err(error("Only regular files are supported"));
    }
    let mut bytes = Vec::new();
    f.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| error("Cannot read review file"))?;
    if bytes.len() > max {
        return Err(error("File exceeds review content limit (256 KiB)"));
    }
    Ok(bytes)
}
fn directory(root: &FsPath) -> Result<File, String> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY | libc::O_CLOEXEC)
        .open(root)
        .map_err(|_| error("Selected project directory is unavailable"))
}
// Missing is distinct from permission failures, links and special files.
fn is_missing(root: &File, path: &FsPath) -> bool {
    let Ok(mut parent) = root.try_clone() else {
        return false;
    };
    let components: Vec<_> = path.components().collect();
    for (i, part) in components.iter().enumerate() {
        let std::path::Component::Normal(name) = part else {
            return false;
        };
        let Ok(name) = std::ffi::CString::new(name.as_bytes()) else {
            return false;
        };
        if i + 1 == components.len() {
            let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            let result = unsafe {
                libc::fstatat(
                    parent.as_raw_fd(),
                    name.as_ptr(),
                    stat.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            };
            return result < 0
                && std::io::Error::last_os_error().raw_os_error() == Some(libc::ENOENT);
        }
        let fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_DIRECTORY,
            )
        };
        if fd < 0 {
            return std::io::Error::last_os_error().raw_os_error() == Some(libc::ENOENT);
        }
        parent = unsafe { File::from_raw_fd(fd) };
    }
    false
}
fn optional_read(root: &File, path: &FsPath, max: usize) -> Result<Option<Vec<u8>>, String> {
    if is_missing(root, path) {
        Ok(None)
    } else {
        read(root, path, max).map(Some)
    }
}
// Reuse the confined private Git namespace and local ignore rules for code maps.
// No repository config, hooks, symlinks or external excludes are consulted.
pub(crate) fn project_source_paths(project: &FsPath, permit: Arc<OwnedSemaphorePermit>) -> Result<Vec<String>, String> {
    project_source_paths_checked(project, permit, &|| Ok(()))
}
pub(crate) fn project_source_paths_checked(project: &FsPath, permit: Arc<OwnedSemaphorePermit>, check_authority: &dyn Fn()->Result<(),String>) -> Result<Vec<String>,String> {
    check_authority()?;
    let root = directory(project)?;
    let work = Work::new(Some(permit))?;
    let mirror = work.path().join("sources");
    fs::create_dir(&mirror).map_err(|_| error("Cannot prepare source inventory"))?;
    let deadline = Instant::now() + Duration::from_secs(30);
    let metadata = work.path().join("empty.git");
    mirror_names(&root, &mirror, &mut 0, deadline, 0, &mut (1024 * 1024),
        &Mirror { authority: Some(check_authority), code_index: true, work: &work, metadata: &metadata, root: &mirror, tracked: &BTreeMap::new() })?;
    let worktree = format!("--work-tree={}", mirror.display());
    let inventory = git(&work, Some(&metadata), &[&worktree, "ls-files", "--others", "--exclude-standard", "-z"], deadline, 16 * 1024 * 1024)?;
    let mut paths = Vec::new();
    for name in inventory.split(|b| *b == 0).filter(|b| !b.is_empty()) {
        check(deadline)?;
        check_authority()?;
        let path = std::str::from_utf8(name).map_err(|_| error("Source path is not UTF-8"))?.to_string();
        // scoped_source uses descriptor-relative O_NOFOLLOW reads and a 64 KiB limit.
        if let Ok(text) = crate::opencode::scoped_source(project, std::slice::from_ref(&path), &path)
            && !text.contains('\0') {
            paths.push(path);
            if paths.len() > 50_000 { return Err(format!("Too large for automatic indexing ({} files)", paths.len())); }
        }
    }
    paths.sort();
    Ok(paths)
}
struct Mirror<'a> {
    authority: Option<&'a dyn Fn()->Result<(),String>>,
    code_index: bool,
    work: &'a Arc<Work>,
    metadata: &'a FsPath,
    root: &'a FsPath,
    tracked: &'a BTreeMap<String, Tracked>,
}
fn mirror_names(
    source: &File,
    dest: &FsPath,
    count: &mut usize,
    deadline: Instant,
    depth: usize,
    rules: &mut usize,
    context: &Mirror<'_>,
) -> Result<(), String> {
    if depth > 64 {
        return Err(error("Worktree directory depth exceeds 64"));
    }
    let mut directories = Vec::new();
    for item in names(source)? {
        if let Some(check) = context.authority { check()?; }
        let name = item
            .map_err(|_| error("Cannot enumerate review directory"))?
            .file_name();
        check(deadline)?;
        if name == ".git" || (context.code_index && ["node_modules", "target", "dist"].iter().any(|n| name == *n)) {
            continue;
        }
        *count += 1;
        if *count > if context.code_index { 100_000 } else { WORK_SCANNED } {
            return Err(if context.code_index {"Too large for automatic indexing (over 100,000 entries)".into()} else {error("Working-tree scan limit reached (16,384 entries)")});
        }
        if open(source, FsPath::new(&name), true).is_ok() {
            fs::create_dir(dest.join(&name))
                .map_err(|_| error("Cannot prepare private file list"))?;
            directories.push(name);
        } else if name == ".gitignore" {
            let bytes = read(source, FsPath::new(&name), CONTENT)?;
            *rules = rules
                .checked_sub(bytes.len())
                .ok_or("Ignore rules exceed 1 MiB limit")?;
            fs::write(dest.join(&name), bytes)
                .map_err(|_| error("Cannot prepare private ignore rules"))?;
        } else {
            let path = dest.join(&name);
            let relative = path
                .strip_prefix(context.root)
                .map_err(|_| error("Invalid private file path"))?;
            // The private index already excludes tracked names from --others.
            // Their raw content is read independently through confined handles.
            if relative
                .to_str()
                .is_none_or(|p| !context.tracked.contains_key(p))
            {
                File::create(path).map_err(|_| error("Cannot prepare private file list"))?;
            }
        }
    }
    // All parent ignore files exist before asking Git about any child. Git sees
    // only this private namespace, so ignored dependency/build trees are pruned
    // without following a real worktree path or parsing an ignore DSL ourselves.
    for name in directories {
        let next = dest.join(&name);
        let relative = next
            .strip_prefix(context.root)
            .map_err(|_| error("Invalid private review path"))?
            .to_str()
            .ok_or("Non-UTF-8 directory paths are unsupported")?;
        let query = format!("{relative}/");
        let worktree = format!("--work-tree={}", context.root.display());
        let (_, ignored) = git_output(
            context.work,
            Some(context.metadata),
            &[
                &worktree,
                "check-ignore",
                "--no-index",
                "--quiet",
                "--",
                &query,
            ],
            deadline,
            0,
        )?;
        if !ignored {
            let dir = open(source, FsPath::new(&name), true)?;
            mirror_names(&dir, &next, count, deadline, depth + 1, rules, context)?;
        }
    }
    Ok(())
}
fn namespace(dir: &FsPath) -> Result<Vec<(std::path::PathBuf, Vec<u8>)>, String> {
    fn visit(
        root: &FsPath,
        path: &FsPath,
        out: &mut Vec<(std::path::PathBuf, Vec<u8>)>,
    ) -> std::io::Result<()> {
        for item in fs::read_dir(path)? {
            let item = item?;
            let p = item.path();
            if item.file_type()?.is_dir() {
                out.push((p.strip_prefix(root).unwrap().to_path_buf(), vec![0]));
                visit(root, &p, out)?;
            } else {
                out.push((p.strip_prefix(root).unwrap().to_path_buf(), fs::read(p)?));
            }
        }
        Ok(())
    }
    let mut result = Vec::new();
    visit(dir, dir, &mut result).map_err(|_| error("Cannot inspect private names"))?;
    result.sort();
    Ok(result)
}
fn names(dir: &File) -> Result<fs::ReadDir, String> {
    // /proc references an owned descriptor. Iterate lazily so a wide directory
    // cannot allocate names beyond the caller's entry and deadline bounds.
    fs::read_dir(format!("/proc/self/fd/{}", dir.as_raw_fd()))
        .map_err(|_| error("Cannot enumerate Git metadata"))
}
fn copy_tree(
    source: &File,
    dest: &FsPath,
    budget: &mut usize,
    count: &mut usize,
    deadline: Instant,
    depth: usize,
) -> Result<(), String> {
    if depth > 64 {
        return Err(error("Git metadata directory depth exceeds 64"));
    }
    for item in names(source)? {
        let name = item
            .map_err(|_| error("Cannot enumerate review directory"))?
            .file_name();
        check(deadline)?;
        *count += 1;
        if *count > 20000 {
            return Err(error("Git metadata exceeds 20,000 entries"));
        }
        if depth == 0 && dest.file_name().is_some_and(|v| v == "objects") && name == "info" {
            // alternates, grafts and exclude files are deliberately not imported.
            continue;
        }
        let path = FsPath::new(&name);
        if let Ok(dir) = open(source, path, true) {
            fs::create_dir(dest.join(&name))
                .map_err(|_| error("Cannot prepare private Git metadata"))?;
            copy_tree(&dir, &dest.join(&name), budget, count, deadline, depth + 1)?;
        } else {
            let input = open(source, path, false)?;
            if !input
                .metadata()
                .map_err(|_| error("Cannot inspect Git metadata"))?
                .is_file()
            {
                return Err(error("Only regular Git metadata files are supported"));
            }
            let mut output = File::create(dest.join(name))
                .map_err(|_| error("Cannot prepare private Git metadata file"))?;
            // std::io::copy uses the platform file-copy path where available;
            // Take preserves the hard byte budget even if a source grows.
            let copied = std::io::copy(&mut input.take(*budget as u64 + 1), &mut output)
                .map_err(|_| error("Cannot copy private Git metadata"))?;
            *budget = budget
                .checked_sub(copied as usize)
                .ok_or("Git metadata exceeds 256 MiB")?;
        }
    }
    Ok(())
}
fn git(
    work: &Arc<Work>,
    gitdir: Option<&FsPath>,
    args: &[&str],
    deadline: Instant,
    limit: usize,
) -> Result<Vec<u8>, String> {
    git_output(work, gitdir, args, deadline, limit).map(|v| v.0)
}
fn git_output(
    work: &Arc<Work>,
    gitdir: Option<&FsPath>,
    args: &[&str],
    deadline: Instant,
    limit: usize,
) -> Result<(Vec<u8>, bool), String> {
    check(deadline)?;
    // Fixed system executable; PATH, GIT_*, HOME and loader overrides are not inherited.
    let mut cmd = Command::new("/usr/bin/git");
    cmd.current_dir(work.path())
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LC_ALL", "C")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .env("GIT_NO_LAZY_FETCH", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    cmd.arg("--no-pager").arg("--git-dir").arg(
        gitdir
            .map(FsPath::to_path_buf)
            .unwrap_or_else(|| work.path().join("empty.git")),
    );
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.pre_exec(|| {
            if libc::setpgid(0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            let limit = libc::rlimit {
                rlim_cur: 512 * 1024 * 1024,
                rlim_max: 512 * 1024 * 1024,
            };
            if libc::setrlimit(libc::RLIMIT_AS, &limit) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    if matches!(
        args,
        ["cat-file", "--batch"] | ["cat-file", "--batch-check"]
    ) {
        cmd.stdin(
            File::open(work.path().join("object-requests"))
                .map_err(|_| error("Object request file unavailable"))?,
        );
    }
    cmd.args(args);
    let mut child = cmd
        .spawn()
        .map_err(|_| error("Git unavailable: /usr/bin/git is required"))?;
    let pipe = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        pipe.take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let outcome = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {
                if Instant::now() > deadline {
                    break Err(error("Git review process deadline exceeded"));
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(_) => break Err(error("Git process inspection failed")),
        }
    };
    // Private files and admission remain owned until process cleanup is observed.
    let pid = child.id();
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    if !settled(&mut child, pid, work) {
        let work = work.clone();
        std::thread::spawn(move || {
            while !settled(&mut child, pid, &work) {
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGKILL);
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = reader.join();
            drop(work);
        });
        return Err(error(
            "Git cleanup pending; exclusion retained until settlement. Retry later",
        ));
    }
    let bytes = reader
        .join()
        .map_err(|_| error("Git output reader failed"))?
        .map_err(|_| error("Git output failed"))?;
    let status = outcome?;
    if bytes.len() > limit {
        return Err(error("Git review output limit reached"));
    }
    if !(status.success()
        || (args.first() == Some(&"diff")
            || args.get(1) == Some(&"check-ignore")
            || args == ["symbolic-ref", "--quiet", "--short", "HEAD"])
            && status.code() == Some(1))
    {
        return Err(error(
            "Git metadata unsupported or changed; refresh to retry",
        ));
    }
    Ok((bytes, status.success()))
}
fn settled(child: &mut std::process::Child, pid: u32, _work: &Work) -> bool {
    #[cfg(test)]
    if _work.unknown.load(std::sync::atomic::Ordering::SeqCst) {
        return false;
    }
    match child.try_wait() {
        Ok(Some(_)) => {}
        Ok(None) => return false,
        Err(e) if e.raw_os_error() == Some(libc::ECHILD) => {}
        Err(_) => return false,
    }
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        let result = unsafe { libc::waitpid(-(pid as i32), std::ptr::null_mut(), libc::WNOHANG) };
        if result < 0 {
            return std::io::Error::last_os_error().raw_os_error() == Some(libc::ECHILD);
        }
        if Instant::now() > deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
#[derive(Clone)]
struct Tracked {
    mode: String,
    oid: String,
}
fn tracked(bytes: &[u8], tree: bool) -> Result<BTreeMap<String, Tracked>, String> {
    let mut out = BTreeMap::new();
    for row in bytes.split(|b| *b == 0).filter(|v| !v.is_empty()) {
        let tab = row
            .iter()
            .position(|b| *b == b'\t')
            .ok_or("Invalid Git entry")?;
        let path = std::str::from_utf8(&row[tab + 1..])
            .map_err(|_| error("Non-UTF-8 Git paths are unsupported"))?
            .to_string();
        if path
            .split('/')
            .any(|p| p == ".git" || p == ".." || p == "." || p.is_empty())
            || path.len() > 4096
        {
            return Err(error("Unsupported Git path"));
        }
        let fields: Vec<_> = std::str::from_utf8(&row[..tab])
            .map_err(|_| error("Invalid Git entry"))?
            .split(' ')
            .collect();
        if fields.len() != 3 {
            return Err(error("Invalid Git entry"));
        }
        if !tree && fields[2] != "0" {
            return Err(error(
                "Conflicted index is unsupported; settle conflicts and refresh",
            ));
        }
        let oid = fields[if tree { 2 } else { 1 }];
        if oid.len() != 40 || !oid.bytes().all(|v| v.is_ascii_hexdigit()) {
            return Err(error("Only SHA-1 repositories are currently supported"));
        }
        out.insert(
            path,
            Tracked {
                mode: fields[0].into(),
                oid: oid.into(),
            },
        );
        if out.len() > SCANNED {
            return Err(error("Tracked file limit reached (4,096)"));
        }
    }
    Ok(out)
}
type Blobs = BTreeMap<String, Result<Vec<u8>, String>>;
// Two bounded Git batches avoid one subprocess for every unchanged tracked file.
// Size inspection precedes content delivery; oversized objects stay unavailable.
fn load_blobs(
    work: &Arc<Work>,
    gitdir: &FsPath,
    files: impl Iterator<Item = Tracked>,
    deadline: Instant,
) -> Result<Blobs, String> {
    let ids: BTreeSet<String> = files
        .filter(|f| f.mode == "100644" || f.mode == "100755")
        .map(|f| f.oid)
        .collect();
    if ids.is_empty() {
        return Ok(BTreeMap::new());
    }
    let request = work.path().join("object-requests");
    fs::write(
        &request,
        ids.iter().cloned().collect::<Vec<_>>().join("\n") + "\n",
    )
    .map_err(|_| error("Cannot prepare object requests"))?;
    let inspection = git(
        work,
        Some(gitdir),
        &["cat-file", "--batch-check"],
        deadline,
        1024 * 1024,
    )?;
    let inspection =
        std::str::from_utf8(&inspection).map_err(|_| error("Invalid object inspection"))?;
    let mut out = BTreeMap::new();
    let mut sizes = BTreeMap::new();
    let mut total = 0usize;
    let mut seen = BTreeSet::new();
    for row in inspection.lines() {
        let fields: Vec<_> = row.split(' ').collect();
        if fields.len() != 3
            || fields[1] != "blob"
            || !ids.contains(fields[0])
            || !seen.insert(fields[0])
        {
            return Err(error("Missing or invalid Git blob metadata"));
        }
        let size = fields[2]
            .parse::<usize>()
            .map_err(|_| error("Invalid object size"))?;
        if size > CONTENT {
            out.insert(
                fields[0].to_string(),
                Err(error("File exceeds review content limit (256 KiB)")),
            );
        } else {
            total = total
                .checked_add(size)
                .ok_or("Object content limit exceeded")?;
            if total > 64 * 1024 * 1024 {
                return Err(error(
                    "Tracked baseline content exceeds 64 MiB review limit",
                ));
            }
            sizes.insert(fields[0].to_string(), size);
        }
    }
    if seen.len() != ids.len() {
        return Err(error("Incomplete Git object inspection"));
    }
    if sizes.is_empty() {
        return Ok(out);
    }
    fs::write(
        &request,
        sizes.keys().cloned().collect::<Vec<_>>().join("\n") + "\n",
    )
    .map_err(|_| error("Cannot prepare bounded object requests"))?;
    let bytes = git(
        work,
        Some(gitdir),
        &["cat-file", "--batch"],
        deadline,
        65 * 1024 * 1024,
    )?;
    let mut cursor = 0;
    for (oid, size) in sizes {
        let end = bytes[cursor..]
            .iter()
            .position(|v| *v == b'\n')
            .map(|v| v + cursor)
            .ok_or("Missing Git object header")?;
        let expected = format!("{oid} blob {size}");
        if bytes[cursor..end] != *expected.as_bytes() {
            return Err(error("Git object identity/size changed while reading"));
        }
        cursor = end + 1;
        let content = bytes
            .get(cursor..cursor + size)
            .ok_or("Truncated Git object")?
            .to_vec();
        cursor += size;
        if bytes.get(cursor) != Some(&b'\n') {
            return Err(error("Invalid Git object delimiter"));
        }
        cursor += 1;
        out.insert(oid, Ok(content));
    }
    if cursor != bytes.len() {
        return Err(error("Unexpected trailing Git object data"));
    }
    Ok(out)
}
fn blob(blobs: &Blobs, file: Option<&Tracked>) -> Result<Vec<u8>, String> {
    match file {
        None => Ok(Vec::new()),
        Some(f) if f.mode != "100644" && f.mode != "100755" => Err(error(
            "Symlinks, submodules and special index modes are unsupported",
        )),
        Some(f) => blobs
            .get(&f.oid)
            .cloned()
            .unwrap_or_else(|| Err(error("Git object unavailable"))),
    }
}
fn capture(project: &str, permit: Option<Arc<OwnedSemaphorePermit>>) -> Result<Snapshot, String> {
    let deadline = Instant::now() + Duration::from_secs(30);
    let root = directory(FsPath::new(project))?;
    let metadata=open(&root,FsPath::new(".git"),true).map_err(|_|error("Not a supported Git repository: requires a local .git directory (linked worktrees and symlinks are unsupported)"))?;
    for forbidden in ["commondir", "shallow"] {
        if open(&metadata, FsPath::new(forbidden), false).is_ok() {
            return Err(error(
                "Shared, linked or shallow Git metadata is unsupported",
            ));
        }
    }
    // Read only recognized metadata. Config, hooks and attributes never reach Git.
    let temp = Work::new(permit)?;
    let private = temp.path().join("repository");
    fs::create_dir(&private).map_err(|_| error("Cannot prepare private Git review"))?;
    fs::create_dir(private.join("objects"))
        .map_err(|_| error("Cannot prepare private Git objects"))?;
    fs::create_dir(private.join("refs")).map_err(|_| error("Cannot prepare private Git refs"))?;
    let mut original = Vec::new();
    for name in ["HEAD", "index", "packed-refs"] {
        let bytes = optional_read(&metadata, FsPath::new(name), 4 * 1024 * 1024)?;
        if name == "HEAD" && bytes.is_none() {
            return Err(error("Git HEAD is unavailable"));
        }
        if let Some(bytes) = &bytes {
            fs::write(private.join(name), bytes).map_err(|_| error("Cannot copy Git metadata"))?;
        }
        original.push((name.to_string(), bytes));
    }
    let mut budget = METADATA
        - original
            .iter()
            .filter_map(|(_, b)| b.as_ref())
            .map(Vec::len)
            .sum::<usize>();
    let mut count = 0;
    for name in ["objects", "refs"] {
        let dir = open(&metadata, FsPath::new(name), true)?;
        copy_tree(
            &dir,
            &private.join(name),
            &mut budget,
            &mut count,
            deadline,
            0,
        )?;
    }
    let headbytes =
        fs::read(private.join("HEAD")).map_err(|_| error("Private HEAD unavailable"))?;
    if headbytes.len() > 4096 {
        return Err(error("Unsupported Git HEAD length"));
    }
    let headtext = std::str::from_utf8(&headbytes)
        .map_err(|_| error("Invalid Git HEAD"))?
        .trim();
    // An unborn HEAD has no tree; malformed/existing invalid refs are errors.
    let unborn = if let Some(r) = headtext.strip_prefix("ref: ") {
        if !r.starts_with("refs/")
            || r.split('/').any(|p| p.is_empty() || p == "." || p == "..")
            || r.contains(['\\', '\0'])
            || r.bytes()
                .any(|v| v.is_ascii_control() || v.is_ascii_whitespace())
            || r.contains("..")
        {
            return Err(error("Unsupported HEAD reference"));
        }
        let bytes = optional_read(&metadata, FsPath::new(r), 4096)?;
        if bytes.as_deref() != fs::read(private.join(r)).ok().as_deref() {
            return Err(error(
                "Git reference changed while reading; refresh to retry",
            ));
        }
        let missing = bytes.is_none() && !private.join("packed-refs").exists();
        original.push((r.to_string(), bytes));
        missing
    } else {
        if headtext.len() != 40 || !headtext.bytes().all(|v| v.is_ascii_hexdigit()) {
            return Err(error("Unsupported Git HEAD identity"));
        }
        false
    };
    let index = tracked(
        &git(
            &temp,
            Some(&private),
            &["ls-files", "--stage", "-z"],
            deadline,
            2 * 1024 * 1024,
        )?,
        false,
    )?;
    let head = if unborn {
        BTreeMap::new()
    } else {
        tracked(
            &git(
                &temp,
                Some(&private),
                &["ls-tree", "-r", "-z", "HEAD"],
                deadline,
                2 * 1024 * 1024,
            )?,
            true,
        )?
    };
    let blobs = load_blobs(
        &temp,
        &private,
        index.values().chain(head.values()).cloned(),
        deadline,
    )?;
    let mut files = Vec::new();
    let mut used = 0;
    let mut observed = Vec::new();
    let paths: BTreeSet<_> = index.keys().chain(head.keys()).cloned().collect();
    for path in paths {
        check(deadline)?;
        let before = head.get(&path);
        let staged = index.get(&path);
        if before.map(|v| (&v.oid, &v.mode)) != staged.map(|v| (&v.oid, &v.mode)) {
            let (old, new, message) = match (blob(&blobs, before), blob(&blobs, staged)) {
                (Ok(a), Ok(b)) => (a, b, String::new()),
                (a, b) => (Vec::new(), Vec::new(), a.err().or(b.err()).unwrap()),
            };
            add(
                &mut files,
                &mut used,
                "staged",
                &path,
                if before.is_none() {
                    "A"
                } else if staged.is_none() {
                    "D"
                } else {
                    "M"
                },
                old,
                new,
                message,
            )?;
        }
        if let Some(entry) = staged {
            let base = blob(&blobs, Some(entry));
            let current = read(&root, FsPath::new(&path), CONTENT);
            let missing = is_missing(&root, FsPath::new(&path));
            match (base, current) {
                (Ok(a), Ok(b)) => {
                    observed.push((path.clone(), crate::tasks::digest(&b)));
                    if a != b {
                        add(
                            &mut files,
                            &mut used,
                            "unstaged",
                            &path,
                            "M",
                            a,
                            b,
                            String::new(),
                        )?;
                    }
                }
                (Ok(a), Err(_)) if missing => {
                    observed.push((path.clone(), String::new()));
                    add(
                        &mut files,
                        &mut used,
                        "unstaged",
                        &path,
                        "D",
                        a,
                        Vec::new(),
                        String::new(),
                    )?;
                }
                (a, b) => add(
                    &mut files,
                    &mut used,
                    "unstaged",
                    &path,
                    "?",
                    Vec::new(),
                    Vec::new(),
                    a.err().or(b.err()).unwrap(),
                )?,
            }
        }
    }
    // ls-files --others never hashes/cleans worktree data. Its configuration and
    // metadata are private; only ordinary .gitignore rules are read from worktree.
    let mirror = temp.path().join("worktree");
    fs::create_dir(&mirror).map_err(|_| error("Cannot prepare private file list"))?;
    mirror_names(
        &root,
        &mirror,
        &mut 0,
        deadline,
        0,
        &mut (1024 * 1024),
        &Mirror {
            authority: None,
            code_index: false,
            work: &temp,
            metadata: &private,
            root: &mirror,
            tracked: &index,
        },
    )?;
    let worktree = format!("--work-tree={}", mirror.display());
    let others = git(
        &temp,
        Some(&private),
        &[
            &worktree,
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        deadline,
        512 * 1024,
    )?;
    for (n, path) in others
        .split(|b| *b == 0)
        .filter(|v| !v.is_empty())
        .enumerate()
    {
        if n >= SCANNED {
            return Err(error("Untracked file scan limit reached"));
        }
        let path =
            std::str::from_utf8(path).map_err(|_| error("Non-UTF-8 paths are unsupported"))?;
        match read(&root, FsPath::new(path), CONTENT) {
            Ok(bytes) => {
                observed.push((path.into(), crate::tasks::digest(&bytes)));
                add(
                    &mut files,
                    &mut used,
                    "untracked",
                    path,
                    "A",
                    Vec::new(),
                    bytes,
                    String::new(),
                )?;
            }
            Err(message) => add(
                &mut files,
                &mut used,
                "untracked",
                path,
                "?",
                Vec::new(),
                Vec::new(),
                message,
            )?,
        }
    }
    let second = temp.path().join("worktree-check");
    fs::create_dir(&second).map_err(|_| error("Cannot verify file list"))?;
    mirror_names(
        &root,
        &second,
        &mut 0,
        deadline,
        0,
        &mut (1024 * 1024),
        &Mirror {
            authority: None,
            code_index: false,
            work: &temp,
            metadata: &private,
            root: &second,
            tracked: &index,
        },
    )?;
    if namespace(&mirror)? != namespace(&second)? {
        return Err(error(
            "Working-tree names/ignore rules changed while reading; refresh to retry",
        ));
    }
    for (name, bytes) in original {
        if optional_read(&metadata, FsPath::new(&name), 4 * 1024 * 1024)? != bytes {
            return Err(error(
                "Git index/HEAD changed while reading; refresh to retry",
            ));
        }
    }
    for (path, digest) in observed {
        check(deadline)?;
        let current = read(&root, FsPath::new(&path), CONTENT);
        if (digest.is_empty() && current.is_ok())
            || (!digest.is_empty()
                && current.map(|v| crate::tasks::digest(&v)).ok() != Some(digest))
        {
            return Err(error("Worktree changed while reading; refresh to retry"));
        }
    }
    let captured_ms = crate::now();
    let revision = uuid::Uuid::new_v4().to_string();
    Ok(Snapshot {
        revision,
        files,
        captured_ms,
    })
}
#[allow(clippy::too_many_arguments)]
fn add(
    files: &mut Vec<Data>,
    used: &mut usize,
    section: &str,
    path: &str,
    status: &str,
    old: Vec<u8>,
    new: Vec<u8>,
    message: String,
) -> Result<(), String> {
    *used += old.len() + new.len();
    if files.len() >= FILES || *used > TOTAL {
        return Err(error(
            "Review limit reached (256 changed entries / 8 MiB text); narrow the repository and refresh",
        ));
    }
    files.push(Data {
        entry: Entry {
            id: crate::tasks::digest(format!("{section}\0{path}").as_bytes()),
            section: section.into(),
            path: path.into(),
            status: status.into(),
            message,
        },
        old,
        new,
    });
    Ok(())
}
fn document(
    revision: String,
    data: &Data,
    permit: Option<Arc<OwnedSemaphorePermit>>,
) -> Result<Document, String> {
    let mut doc = Document {
        revision,
        file: data.entry.clone(),
        kind: "unavailable",
        patch: String::new(),
        message: data.entry.message.clone(),
    };
    if !doc.message.is_empty() {
        return Ok(doc);
    }
    if data.old.contains(&0)
        || data.new.contains(&0)
        || std::str::from_utf8(&data.old).is_err()
        || std::str::from_utf8(&data.new).is_err()
    {
        doc.kind = "binary";
        doc.message = "Binary or non-UTF-8 content; text comparison unavailable".into();
        return Ok(doc);
    }
    let temp = Work::new(permit)?;
    for (name, bytes) in [("before", &data.old), ("after", &data.new)] {
        let mut f =
            File::create(temp.path().join(name)).map_err(|_| error("Cannot prepare comparison"))?;
        f.write_all(bytes)
            .map_err(|_| error("Cannot write private comparison"))?;
    }
    let patch = git(
        &temp,
        None,
        &[
            "diff",
            "--no-index",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--no-renames",
            "--unified=3",
            "--",
            "before",
            "after",
        ],
        Instant::now() + Duration::from_secs(3),
        512 * 1024,
    )?;
    let text = String::from_utf8(patch).map_err(|_| error("Invalid diff encoding"))?;
    let text = text
        .lines()
        .skip_while(|line| !line.starts_with("@@"))
        .collect::<Vec<_>>();
    if text.len() > 2000 {
        doc.message = "Diff exceeds 2,000 rendered lines; text comparison unavailable".into();
        return Ok(doc);
    }
    doc.kind = "text";
    doc.patch = text.join("\n");
    if doc.patch.is_empty() {
        doc.message = "Content unchanged; index mode or metadata changed".into();
    }
    Ok(doc)
}
fn session(app: &App, id: &str) -> bool {
    app.store.lock().unwrap().session_by_id(id).is_ok()
}
/// Read only HEAD, using the existing confined reader and bounded private Git process.
/// No index, objects, configuration or working-tree traversal is needed.
fn branch_identity(
    project: &FsPath,
    permit: Option<Arc<OwnedSemaphorePermit>>,
) -> Result<Option<String>, String> {
    let root = directory(project)?;
    let metadata = match open(&root, FsPath::new(".git"), true) {
        Ok(dir) => dir,
        Err(_) => {
            let pointer = read(&root, FsPath::new(".git"), 4096)?;
            let pointer = std::str::from_utf8(&pointer)
                .map_err(|_| error("Invalid Git directory pointer"))?;
            let path = pointer
                .trim_end()
                .strip_prefix("gitdir: ")
                .filter(|v| !v.is_empty())
                .ok_or("Unsupported Git directory pointer")?;
            let path = project
                .join(path)
                .canonicalize()
                .map_err(|_| error("Git directory unavailable"))?;
            directory(&path)?
        }
    };
    let head = read(&metadata, FsPath::new("HEAD"), 4096)?;
    let work = Work::new(permit)?;
    fs::write(work.path().join("empty.git/HEAD"), head)
        .map_err(|_| error("Cannot prepare private HEAD"))?;
    let (name, success) = git_output(
        &work,
        None,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
        Instant::now() + Duration::from_secs(3),
        4096,
    )?;
    if !success {
        return Ok(None);
    }
    let name = String::from_utf8(name).map_err(|_| error("Invalid branch encoding"))?;
    let name = name.trim();
    Ok((!name.is_empty()).then(|| name.to_string()))
}
pub async fn identity(State(app): State<App>, Path(id): Path<String>) -> Response {
    if !session(&app, &id) {
        return problem(StatusCode::NOT_FOUND, "session", "Conversation unavailable");
    }
    let app=match app.for_session(&id){Ok(a)=>a,Err(e)=>return problem(StatusCode::CONFLICT,"project",e)};
    let Ok(permit) = app.git_review.gate.clone().try_acquire_owned() else {
        return problem(StatusCode::TOO_MANY_REQUESTS, "git_busy", "Git read busy");
    };
    match tokio::task::spawn_blocking(move || {
        branch_identity(FsPath::new(&app.project), Some(Arc::new(permit)))
    })
    .await
    {
        Ok(Ok(branch)) => Json(serde_json::json!({"currentBranch":branch})).into_response(),
        _ => Json(serde_json::json!({"currentBranch":null})).into_response(),
    }
}
pub async fn catalog(State(app): State<App>, Path(id): Path<String>) -> Response {
    if !session(&app, &id) {
        return problem(StatusCode::NOT_FOUND, "session", "Conversation unavailable");
    }
    // The blocking worker retains the permit even if HTTP delivery is cancelled.
    let app=match app.for_session(&id){Ok(a)=>a,Err(e)=>return problem(StatusCode::CONFLICT,"project",e)};
    let Ok(permit) = app.git_review.gate.clone().try_acquire_owned() else {
        return problem(
            StatusCode::TOO_MANY_REQUESTS,
            "git_busy",
            "Git review busy; retry after the current read settles",
        );
    };
    let app2 = app.clone();
    match tokio::task::spawn_blocking(move || {
        let permit=Arc::new(permit);
        let snapshot=capture(&app2.project,Some(permit.clone()))?;
        let result=Catalog{revision:snapshot.revision.clone(),captured_ms:snapshot.captured_ms,files:snapshot.files.iter().map(|f|f.entry.clone()).collect(),note:"Live working-tree snapshot · Refresh to observe later edits. Raw index bytes versus raw working-tree bytes (filters and line-ending conversion are not applied). Renames appear as add/delete; conflicts, links, submodules, linked worktrees and non-SHA-1 metadata are unsupported. Capture deadline 30 seconds; comparisons 3 seconds. Tracked baseline text limit 64 MiB. Metadata limit 256 MiB / 20,000 entries; worktree scan 16,384 entries / tracked scan 4,096 files, 64 directory levels, 256 changed entries / 8 MiB combined text, 256 KiB per file, 2,000 rendered lines. Only local .gitignore rules (1 MiB combined) are applied; global/info excludes are not imported. Recorded edit evidence is separate."};
        let mut cache=app2.git_review.snapshot.lock().unwrap();
        if !cache.contains_key(&id)&&cache.len()>=8 && let Some(old)=cache.iter().min_by_key(|(_,s)|s.captured_ms).map(|(k,_)|k.clone()){cache.remove(&old);}
        cache.insert(id,snapshot);Ok::<_,String>(result)
    }).await {Ok(Ok(result))=>Json(result).into_response(),Ok(Err(message))=>problem(StatusCode::UNPROCESSABLE_ENTITY,"git_unavailable",message),Err(_)=>problem(StatusCode::INTERNAL_SERVER_ERROR,"git_failed","Git review failed; refresh to retry")}
}
pub async fn diff(
    State(app): State<App>,
    Path((id, revision, file)): Path<(String, String, String)>,
) -> Response {
    if !session(&app, &id) {
        return problem(StatusCode::NOT_FOUND, "session", "Conversation unavailable");
    }
    let app=match app.for_session(&id){Ok(a)=>a,Err(e)=>return problem(StatusCode::CONFLICT,"project",e)};
    let Ok(permit) = app.git_review.gate.clone().try_acquire_owned() else {
        return problem(
            StatusCode::TOO_MANY_REQUESTS,
            "git_busy",
            "Git review busy; retry after the current read settles",
        );
    };
    match tokio::task::spawn_blocking(move || {
        let lock = app.git_review.snapshot.lock().unwrap();
        let snapshot = lock
            .get(&id)
            .filter(|s| s.revision == revision)
            .ok_or("Stale Git snapshot; refresh to retry")?;
        let data = snapshot
            .files
            .iter()
            .find(|f| f.entry.id == file)
            .ok_or("File selection is unavailable; refresh to retry")?;
        document(revision, data, Some(Arc::new(permit)))
    })
    .await
    {
        Ok(Ok(result)) => Json(result).into_response(),
        Ok(Err(message)) => problem(StatusCode::CONFLICT, "git_stale", message),
        Err(_) => problem(
            StatusCode::INTERNAL_SERVER_ERROR,
            "git_failed",
            "Git comparison failed; refresh to retry",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        run(dir.path(), &["init", "-q"]);
        fs::write(dir.path().join("normal.txt"), "first\n").unwrap();
        fs::create_dir(dir.path().join("nested")).unwrap();
        fs::write(dir.path().join("nested/deleted.txt"), "gone\n").unwrap();
        run(dir.path(), &["add", "."]);
        run(
            dir.path(),
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "-qm",
                "base",
            ],
        );
        dir
    }
    fn run(root: &FsPath, args: &[&str]) {
        assert!(
            Command::new("/usr/bin/git")
                .current_dir(root)
                .env_clear()
                .env("PATH", "/usr/bin:/bin")
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .args(args)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    // Original reader: unborn branch visible, detached HEAD hidden; no diff or object scan.
    #[test]
    fn header_identity_unborn_detached_and_linked_worktree() {
        let d = tempfile::tempdir().unwrap();
        run(d.path(), &["init", "-q", "-b", "unborn-header"]);
        assert_eq!(
            branch_identity(d.path(), None).unwrap().as_deref(),
            Some("unborn-header")
        );
        fs::write(d.path().join(".git/config"), "not valid git config\n").unwrap();
        assert_eq!(
            branch_identity(d.path(), None).unwrap().as_deref(),
            Some("unborn-header")
        );
        let repo = fixture();
        run(repo.path(), &["checkout", "--detach", "-q"]);
        assert_eq!(branch_identity(repo.path(), None).unwrap(), None);
        let linked = repo.path().join("linked");
        run(
            repo.path(),
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "linked-header",
                linked.to_str().unwrap(),
            ],
        );
        assert_eq!(
            branch_identity(&linked, None).unwrap().as_deref(),
            Some("linked-header")
        );
        let before = fs::read(repo.path().join(".git/index")).unwrap();
        branch_identity(&linked, None).unwrap();
        assert_eq!(fs::read(repo.path().join(".git/index")).unwrap(), before);
        let absent = tempfile::tempdir().unwrap();
        assert!(branch_identity(absent.path(), None).is_err());
        std::os::unix::fs::symlink(repo.path().join(".git/HEAD"), absent.path().join(".git"))
            .unwrap();
        assert!(branch_identity(absent.path(), None).is_err());
    }
    fn entry<'a>(snap: &'a Snapshot, section: &str, path: &str) -> &'a Data {
        snap.files
            .iter()
            .find(|f| f.entry.section == section && f.entry.path == path)
            .unwrap_or_else(|| panic!("Missing {section} {path}"))
    }
    // Protects cancellation/error cleanup ownership: permit and private metadata
    // cannot be released while termination observation is uncertain. Deterministic
    // seam delays observation only; no unkillable process is created.
    #[test]
    fn git_uncertain_cleanup_retains_exclusion_and_private_files() {
        use std::sync::atomic::Ordering;
        let gate = Arc::new(Semaphore::new(1));
        let permit = gate.clone().try_acquire_owned().unwrap();
        let work = Work::new(Some(Arc::new(permit))).unwrap();
        let path = work.path().to_path_buf();
        let unknown = work.unknown.clone();
        unknown.store(true, Ordering::SeqCst);
        let err = git(
            &work,
            None,
            &["--version"],
            Instant::now() + Duration::from_secs(2),
            100,
        )
        .unwrap_err();
        assert!(err.contains("cleanup pending"));
        drop(work);
        assert!(path.exists());
        assert!(gate.clone().try_acquire_owned().is_err());
        unknown.store(false, Ordering::SeqCst);
        for _ in 0..100 {
            if !path.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!path.exists());
        assert!(gate.try_acquire_owned().is_ok());
    }
    #[tokio::test]
    async fn git_routes_auth_scope_stale_and_busy() {
        use axum::{body::Body, http::Request};
        use http_body_util::BodyExt;
        use tower::ServiceExt;
        let d = fixture();
        fs::write(d.path().join("new"), "new\n").unwrap();
        let store = crate::Store::open_memory(d.path().to_str().unwrap()).unwrap();
        let session = store.session.clone();
        let app = App::new(
            store,
            "127.0.0.1:12345".into(),
            "/missing".into(),
            None,
            "admin".into(),
            "recovery".into(),
        );
        let call = |url: String, cookie: Option<String>, origin: &str| {
            let mut req = Request::builder()
                .uri(url)
                .header("host", &app.host)
                .header("origin", origin);
            if let Some(cookie) = cookie {
                req = req.header("cookie", cookie);
            }
            crate::server::router(app.clone()).oneshot(req.body(Body::empty()).unwrap())
        };
        let url = format!("/api/sessions/{session}/git");
        assert_eq!(
            call(url.clone(), None, "http://127.0.0.1:12345")
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        let auth = crate::server::router(app.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/auth")
                    .header("host", &app.host)
                    .header("origin", "http://127.0.0.1:12345")
                    .body(Body::from(app.issue_launch()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let cookie = auth.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        assert_eq!(
            call(url.clone(), Some(cookie.clone()), "http://evil.invalid")
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert!(app.git_review.snapshot.lock().unwrap().is_empty());
        assert_eq!(
            call(
                "/api/sessions/missing/git".into(),
                Some(cookie.clone()),
                "http://127.0.0.1:12345"
            )
            .await
            .unwrap()
            .status(),
            StatusCode::NOT_FOUND
        );
        let permit = app.git_review.gate.clone().try_acquire_owned().unwrap();
        assert_eq!(
            call(url.clone(), Some(cookie.clone()), "http://127.0.0.1:12345")
                .await
                .unwrap()
                .status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        drop(permit);
        let res = call(url.clone(), Some(cookie.clone()), "http://127.0.0.1:12345")
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let first: serde_json::Value =
            serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
        let file = first["files"][0]["id"].as_str().unwrap();
        let rev = first["revision"].as_str().unwrap();
        assert_eq!(
            call(
                format!("{url}/{rev}/{file}"),
                Some(cookie.clone()),
                "http://127.0.0.1:12345"
            )
            .await
            .unwrap()
            .status(),
            StatusCode::OK
        );
        assert_eq!(
            call(url.clone(), Some(cookie.clone()), "http://127.0.0.1:12345")
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            call(
                format!("{url}/{rev}/{file}"),
                Some(cookie.clone()),
                "http://127.0.0.1:12345"
            )
            .await
            .unwrap()
            .status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            call(
                format!("{url}/bad/%2E%2E%2Fsecret"),
                Some(cookie),
                "http://127.0.0.1:12345"
            )
            .await
            .unwrap()
            .status(),
            StatusCode::CONFLICT
        );
    }
    // Protects explicit HEAD/index/worktree bases, inert unusual paths and no index writes.
    // Oracle: staged text differs from both HEAD and the current working copy.
    #[test]
    fn git_sections_raw_bases_and_nonmutation() {
        let d = fixture();
        let root = d.path();
        fs::write(root.join("normal.txt"), "staged\n").unwrap();
        run(root, &["add", "normal.txt"]);
        fs::write(root.join("normal.txt"), "working\n").unwrap();
        fs::remove_file(root.join("nested/deleted.txt")).unwrap();
        fs::remove_dir(root.join("nested")).unwrap();
        fs::write(root.join("- ü space.txt"), "<script>alert(1)</script>\n").unwrap();
        fs::write(root.join("binary"), [0, 1, 2]).unwrap();
        fs::write(root.join(".gitignore"), "ignored\n").unwrap();
        fs::write(root.join("ignored"), "secret").unwrap();
        let before = fs::read(root.join(".git/index")).unwrap();
        let snap = capture(root.to_str().unwrap(), None).unwrap();
        let staged = entry(&snap, "staged", "normal.txt");
        assert_eq!(staged.old, b"first\n");
        assert_eq!(staged.new, b"staged\n");
        let unstaged = entry(&snap, "unstaged", "normal.txt");
        assert_eq!(unstaged.old, b"staged\n");
        assert_eq!(unstaged.new, b"working\n");
        assert_eq!(
            entry(&snap, "unstaged", "nested/deleted.txt").entry.status,
            "D"
        );
        assert!(
            entry(&snap, "untracked", "- ü space.txt")
                .new
                .starts_with(b"<script>")
        );
        assert!(!snap.files.iter().any(|f| f.entry.path == "ignored"));
        assert_eq!(
            document(
                snap.revision.clone(),
                entry(&snap, "untracked", "binary"),
                None
            )
            .unwrap()
            .kind,
            "binary"
        );
        let patch = document(snap.revision.clone(), unstaged, None).unwrap();
        assert!(patch.patch.contains("-staged"));
        assert!(patch.patch.contains("+working"));
        assert_eq!(fs::read(root.join(".git/index")).unwrap(), before);
        assert_eq!(fs::read(root.join("normal.txt")).unwrap(), b"working\n");
    }
    // Protects metadata/path confinement and helper exclusion. Sentinel must never execute.
    #[test]
    fn git_helpers_and_links_are_not_followed() {
        use std::os::unix::fs::symlink;
        let d = fixture();
        let root = d.path();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("private"), "outside sentinel").unwrap();
        let helper = root.join("helper.sh");
        fs::write(
            &helper,
            format!(
                "#!/bin/sh\ntouch '{}'\n",
                outside.path().join("executed").display()
            ),
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        for key in [
            "core.fsmonitor",
            "diff.external",
            "diff.evil.textconv",
            "filter.evil.clean",
            "filter.evil.smudge",
            "core.hooksPath",
        ] {
            run(root, &["config", key, helper.to_str().unwrap()]);
        }
        fs::write(root.join(".gitattributes"), "* filter=evil diff=evil\n").unwrap();
        fs::write(root.join("normal.txt"), "new\n").unwrap();
        symlink(outside.path(), root.join("linked-directory")).unwrap();
        symlink(outside.path().join("private"), root.join("linked-file")).unwrap();
        let snap = capture(root.to_str().unwrap(), None).unwrap();
        assert!(
            !snap
                .files
                .iter()
                .any(|f| f.new.windows(16).any(|b| b == b"outside sentinel"))
        );
        assert!(
            !entry(&snap, "untracked", "linked-file")
                .entry
                .message
                .is_empty()
        );
        assert!(!outside.path().join("executed").exists());
        symlink(outside.path(), root.join(".git/objects/escape")).unwrap();
        assert!(capture(root.to_str().unwrap(), None).is_err());
    }
    // Protects bounded text, rendering, and explicit unsupported layouts without writes.
    #[test]
    fn git_limits_and_unsupported_layouts() {
        let d = fixture();
        let root = d.path();
        fs::write(root.join("large"), vec![b'x'; CONTENT + 1]).unwrap();
        let snap = capture(root.to_str().unwrap(), None).unwrap();
        assert!(
            entry(&snap, "untracked", "large")
                .entry
                .message
                .contains("limit")
        );
        let data = Data {
            entry: Entry {
                id: "x".into(),
                section: "untracked".into(),
                path: "many".into(),
                status: "A".into(),
                message: String::new(),
            },
            old: vec![],
            new: "line\n".repeat(2100).into_bytes(),
        };
        assert_eq!(
            document("r".into(), &data, None).unwrap().kind,
            "unavailable"
        );
        fs::write(root.join(".git/commondir"), "/outside").unwrap();
        assert!(
            capture(root.to_str().unwrap(), None)
                .err()
                .unwrap()
                .contains("unsupported")
        );
    }
    #[test]
    fn git_unborn_and_rename_as_add_delete() {
        let d = tempfile::tempdir().unwrap();
        run(d.path(), &["init", "-q"]);
        assert!(
            capture(d.path().to_str().unwrap(), None)
                .unwrap()
                .files
                .is_empty()
        );
        let d = fixture();
        run(d.path(), &["mv", "normal.txt", "renamed.txt"]);
        let s = capture(d.path().to_str().unwrap(), None).unwrap();
        assert_eq!(entry(&s, "staged", "normal.txt").entry.status, "D");
        assert_eq!(entry(&s, "staged", "renamed.txt").entry.status, "A");
    }
    #[test]
    fn git_conflicts_and_catalog_budget_are_explicit() {
        let d = fixture();
        let root = d.path();
        let oid = Command::new("/usr/bin/git")
            .current_dir(root)
            .args(["rev-parse", "HEAD:normal.txt"])
            .output()
            .unwrap();
        let oid = String::from_utf8(oid.stdout).unwrap();
        let oid = oid.trim();
        let mut child = Command::new("/usr/bin/git")
            .current_dir(root)
            .args(["update-index", "--index-info"])
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(format!("0 {}\tnormal.txt\n100644 {oid} 1\tnormal.txt\n100644 {oid} 2\tnormal.txt\n100644 {oid} 3\tnormal.txt\n","0".repeat(40)).as_bytes()).unwrap();
        assert!(child.wait().unwrap().success());
        let before = fs::read(root.join(".git/index")).unwrap();
        assert!(
            capture(root.to_str().unwrap(), None)
                .err()
                .unwrap()
                .contains("Conflicted")
        );
        assert_eq!(fs::read(root.join(".git/index")).unwrap(), before);
        let d = fixture();
        for n in 0..257 {
            fs::write(d.path().join(format!("new-{n}")), "").unwrap();
        }
        assert!(
            capture(d.path().to_str().unwrap(), None)
                .err()
                .unwrap()
                .contains("256")
        );
        let d = fixture();
        for n in 0..5 {
            let dir = d.path().join(format!("rules-{n}"));
            fs::create_dir(&dir).unwrap();
            fs::write(dir.join(".gitignore"), vec![b'#'; CONTENT]).unwrap();
        }
        assert!(
            capture(d.path().to_str().unwrap(), None)
                .err()
                .unwrap()
                .contains("Ignore rules")
        );
        let d = fixture();
        fs::write(d.path().join(".git/HEAD"), "ref: ../../outside\n").unwrap();
        assert!(capture(d.path().to_str().unwrap(), None).is_err());
    }
    #[test]
    fn ignored_dependency_directories_do_not_consume_walk_budget() {
        let d = fixture();
        let root = d.path();
        fs::write(root.join(".gitignore"), "node_modules/\n").unwrap();
        fs::create_dir(root.join("node_modules")).unwrap();
        for n in 0..WORK_SCANNED + 1 {
            fs::write(root.join(format!("node_modules/{n}")), "").unwrap();
        }
        fs::write(root.join("normal.txt"), "changed\n").unwrap();
        let snap = capture(root.to_str().unwrap(), None).unwrap();
        assert_eq!(entry(&snap, "unstaged", "normal.txt").new, b"changed\n");
        assert!(
            !snap
                .files
                .iter()
                .any(|f| f.entry.path.starts_with("node_modules/"))
        );
    }
    #[test]
    fn ordinary_large_tracked_tree_uses_bounded_git_batches() {
        let d = fixture();
        let root = d.path();
        for n in 0..1600 {
            fs::write(
                root.join(format!("file-{n}.txt")),
                format!("original {n}\n"),
            )
            .unwrap();
        }
        run(root, &["add", "."]);
        run(
            root,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "-qm",
                "many",
            ],
        );
        fs::write(root.join("file-1599.txt"), "changed\n").unwrap();
        let snap = capture(root.to_str().unwrap(), None).unwrap();
        assert_eq!(
            entry(&snap, "unstaged", "file-1599.txt").old,
            b"original 1599\n"
        );
        assert_eq!(entry(&snap, "unstaged", "file-1599.txt").new, b"changed\n");
    }
    #[test]
    fn git_process_output_and_deadline_are_bounded() {
        let work = Work::new(None).unwrap();
        fs::write(work.path().join("before"), "a\n").unwrap();
        fs::write(work.path().join("after"), "b\n").unwrap();
        assert!(
            git(
                &work,
                None,
                &["diff", "--no-index", "--", "before", "after"],
                Instant::now() + Duration::from_secs(2),
                10
            )
            .unwrap_err()
            .contains("limit")
        );
        assert!(
            git(
                &work,
                None,
                &["--version"],
                Instant::now() - Duration::from_secs(1),
                100
            )
            .unwrap_err()
            .contains("limit")
        );
    }
}

#[cfg(test)]
mod indexing_limits_tests {
    use super::*;
    // Protects code-index limits and exclusion of build, ignored and linked data.
    // Oracle: decision 10/11: index >256 files and exclude build/ignored/linked data.
    #[test]
    fn settings_model_code_index_uses_own_limits() {
        let d=tempfile::tempdir().unwrap();
        for name in ["node_modules","target","dist",".git","ignored"] {
            fs::create_dir(d.path().join(name)).unwrap();
            fs::write(d.path().join(name).join("hidden.rs"),"fn hidden() {}\n").unwrap();
        }
        fs::write(d.path().join(".gitignore"),"ignored/\n").unwrap();
        for n in 0..300 {fs::write(d.path().join(format!("file{n}.rs")),"fn main() {}\n").unwrap();}
        std::os::unix::fs::symlink("/etc/passwd",d.path().join("linked.rs")).unwrap();
        fs::write(d.path().join("binary"),[0,1,2]).unwrap();
        let runtime=tokio::runtime::Runtime::new().unwrap();
        let permit=runtime.block_on(Runtime::default().gate.clone().acquire_owned()).unwrap();
        let paths=project_source_paths(d.path(),Arc::new(permit)).unwrap();
        assert_eq!(paths.iter().filter(|p|p.ends_with(".rs")).count(),300);
        assert!(!paths.iter().any(|p|p=="binary"||p.contains("hidden")||p=="linked.rs"));
        assert!(crate::cbm_service::Snapshot::capture(d.path(),&paths).unwrap().files.len()>256);
    }
}
