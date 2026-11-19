//! Fixed Codex artifacts, reviewed project selection and bounded native login.
use crate::{
    Store,
    managed_tools::{Artifacts, Directory},
    now,
    server::App,
    tasks::digest,
};
use deck2_shared::{API, Phase, RunnerBinding};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::Read,
    os::{
        fd::AsRawFd,
        unix::fs::{MetadataExt, PermissionsExt},
    },
    path::{Path, PathBuf},
    time::Duration,
};

const CATALOG: &str = include_str!("../resources/codex/catalog.json");
const CANDIDATE_CATALOG: &str = include_str!("../resources/codex/0.167.1/catalog.json");
pub const QUALIFICATION: &str = "deck2-codex-0.166.0-s7a-v1";
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Member {
    pub bytes: u64,
    pub sha256: Option<String>,
    pub directory: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Release {
    pub version: String,
    pub platform: String,
    pub release: String,
    pub url: String,
    pub archive_bytes: u64,
    pub archive_sha256: String,
    pub members: BTreeMap<String, Member>,
    pub notices: Vec<Value>,
    pub qualification: String,
}
pub fn release() -> Release {
    serde_json::from_str(CATALOG).expect("embedded reviewed catalog")
}
fn catalog_bytes(reference: &str) -> Result<&'static str, String> {
    [CATALOG, CANDIDATE_CATALOG]
        .into_iter()
        .find(|c| digest(c.as_bytes()) == reference)
        .ok_or("Unknown runner release reference; no fallback".into())
}
pub fn release_for_catalog(reference: &str) -> Result<Release, String> {
    serde_json::from_str(catalog_bytes(reference)?).map_err(|_| "Invalid embedded release".into())
}
pub fn candidate_catalog() -> String {
    digest(CANDIDATE_CATALOG.as_bytes())
}
pub fn catalog() -> String {
    digest(CATALOG.as_bytes())
}
fn notices() -> [(&'static str, &'static [u8]); 2] {
    [
        ("LICENSE", include_bytes!("../resources/codex/LICENSE")),
        ("NOTICE", include_bytes!("../resources/codex/NOTICE")),
    ]
}
fn release_notices(reference: &str) -> Result<[(&'static str, &'static [u8]); 2], String> {
    catalog_bytes(reference)?;
    Ok(if reference == catalog() {
        notices()
    } else {
        [
            (
                "LICENSE",
                include_bytes!("../resources/codex/0.167.1/LICENSE"),
            ),
            (
                "NOTICE",
                include_bytes!("../resources/codex/0.167.1/NOTICE"),
            ),
        ]
    })
}
fn root(path: &Path) -> Result<Directory, String> {
    // Reuse the shared private store's ownership boundary, never an RTK selection.
    Artifacts::open(path)?;
    Directory::open_root(path)?.directory("runners", true)
}
pub fn store_identity(path: &Path) -> Result<String, String> {
    let d = root(path)?;
    let m = d.0.metadata().map_err(|_| "Cannot inspect runner store")?;
    Ok(format!("codex-store:{}:{}:{}", m.uid(), m.dev(), m.ino()))
}
fn relative_file(d: &Directory, path: &str) -> Result<std::fs::File, String> {
    let mut parts = path.split('/').collect::<Vec<_>>();
    let file = parts.pop().ok_or("Invalid member")?;
    let mut dir = Directory(d.0.try_clone().map_err(|_| "Cannot pin directory")?);
    for part in parts {
        dir = dir.existing_dir(part)?;
    }
    dir.file(file, false)
}
pub fn managed_binding(path: &Path, model: Option<String>) -> RunnerBinding {
    artifact_binding(path, &catalog(), model).expect("embedded qualified artifact")
}
fn artifact_binding(
    path: &Path,
    reference: &str,
    model: Option<String>,
) -> Result<RunnerBinding, String> {
    let release = release_for_catalog(reference)?;
    Ok(RunnerBinding {
        path: path
            .join("runners")
            .join(reference)
            .join("bin/codex")
            .to_string_lossy()
            .into_owned(),
        executable: release.members["bin/codex"].sha256.clone().unwrap(),
        ownership: "deck_owned".into(),
        model,
        qualification: release.qualification,
        catalog: Some(reference.into()),
    })
}
pub fn validate_binding(b: &RunnerBinding) -> Result<(), String> {
    if b.qualification != QUALIFICATION
        || b.model.as_deref().is_some_and(|m| m != "gpt-6.1-sol")
        || !Path::new(&b.path).is_absolute()
        || b.executable.len() != 64
        || !["deck_owned", "external_unknown"].contains(&b.ownership.as_str())
    {
        return Err("Unsupported runner binding; no fallback".into());
    }
    if b.ownership == "deck_owned"
        && (b.catalog.as_deref() != Some(catalog().as_str())
            || b.executable != release().members["bin/codex"].sha256.clone().unwrap())
    {
        return Err("Runner catalog/qualification mismatch".into());
    }
    Ok(())
}
pub fn pin_package(path: &Path) -> Result<PathBuf, String> {
    pin_release(path, &catalog())
}
pub fn pin_release(path: &Path, reference: &str) -> Result<PathBuf, String> {
    let catalog_text = catalog_bytes(reference)?;
    let release = release_for_catalog(reference)?;
    let parent = root(path)?;
    let d = parent.existing_dir(reference)?;
    if d.0.metadata().map_err(|_| "Cannot inspect package")?.mode() & 0o222 != 0
        || d.bytes("manifest.json", 100000)? != catalog_text.as_bytes()
    {
        return Err("Runner package manifest/ownership mismatch".into());
    }
    for (name, bytes) in release_notices(reference)? {
        if d.bytes(name, 100000)? != bytes {
            return Err("Runner notice mismatch".into());
        }
    }
    for (name, m) in release.members {
        if m.directory {
            continue;
        }
        let mut f = relative_file(&d, &name)?;
        let meta = f.metadata().map_err(|_| "Cannot inspect companion")?;
        if meta.len() != m.bytes || meta.mode() & 0o222 != 0 {
            return Err("Runner companion size/mode mismatch".into());
        }
        let mut bytes = vec![];
        f.by_ref()
            .take(m.bytes + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read companion")?;
        if Some(digest(&bytes)) != m.sha256 {
            return Err("Runner companion identity mismatch".into());
        }
    }
    Ok(path.join("runners").join(reference).join("bin/codex"))
}
pub fn publish(path: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    publish_release(path, &catalog(), bytes)
}
pub fn publish_release(path: &Path, reference: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let catalog_text = catalog_bytes(reference)?;
    let r = release_for_catalog(reference)?;
    if bytes.len() as u64 != r.archive_bytes || digest(bytes) != r.archive_sha256 {
        return Err("Runner archive size/hash mismatch".into());
    }
    let parent = root(path)?;
    let _lock = Directory::open_root(path)?
        .directory("locks", true)?
        .lock(&format!("codex-{reference}"))?;
    if parent.existing_dir(reference).is_ok() {
        return pin_release(path, reference);
    }
    let stage = format!(".staging-{}", uuid::Uuid::new_v4());
    let d = parent.directory(&stage, true)?;
    let cap = r.members.values().map(|m| m.bytes).sum::<u64>() + 131072;
    let decoder = flate2::read::GzDecoder::new(bytes);
    let mut tar = tar::Archive::new(decoder.take(cap));
    let mut seen = std::collections::BTreeSet::new();
    for e in tar.entries().map_err(|_| "Invalid runner archive")? {
        let mut e = e.map_err(|_| "Invalid runner archive member")?;
        let name = std::str::from_utf8(&e.path_bytes())
            .map_err(|_| "Invalid member path")?
            .to_string();
        let name = if e.header().entry_type().is_dir() {
            name.strip_suffix('/').unwrap_or(&name).to_string()
        } else {
            name
        };
        let m = r
            .members
            .get(&name)
            .ok_or("Unexpected runner archive member")?;
        if !seen.insert(name.clone())
            || e.size() != m.bytes
            || e.header().entry_type().is_dir() != m.directory
            || (!m.directory && !e.header().entry_type().is_file())
        {
            return Err("Duplicate, unsafe or linked runner archive member".into());
        }
        let parts = name.split('/').collect::<Vec<_>>();
        if parts
            .iter()
            .any(|p| p.is_empty() || *p == ".." || *p == ".")
        {
            return Err("Unsafe runner archive path".into());
        }
        let mut target = Directory(d.0.try_clone().map_err(|_| "Cannot pin staging")?);
        for p in &parts[..parts.len() - 1] {
            target = target.existing_dir(p)?;
        }
        let last = parts.last().unwrap();
        if m.directory {
            target.directory(last, true)?;
            continue;
        }
        let mut b = vec![];
        e.by_ref()
            .take(m.bytes + 1)
            .read_to_end(&mut b)
            .map_err(|_| "Truncated runner member")?;
        if b.len() as u64 != m.bytes || Some(digest(&b)) != m.sha256 {
            return Err("Runner member identity mismatch".into());
        }
        target.write(last, &b)?;
        let f = target.file(last, false)?;
        f.set_permissions(std::fs::Permissions::from_mode(
            if b.starts_with(b"\x7fELF") {
                0o500
            } else {
                0o400
            },
        ))
        .map_err(|_| "Cannot seal companion")?;
        f.sync_all().map_err(|_| "Cannot sync companion")?;
    }
    if seen.len() != r.members.len() {
        return Err("Runner package member inventory incomplete".into());
    }
    d.write("manifest.json", catalog_text.as_bytes())?;
    for (name, bytes) in release_notices(reference)? {
        d.write(name, bytes)?;
    }
    for n in ["manifest.json", "LICENSE", "NOTICE"] {
        d.file(n, false)?
            .set_permissions(std::fs::Permissions::from_mode(0o400))
            .map_err(|_| "Cannot seal notice")?;
    }
    for name in r.members.keys().rev().filter(|n| r.members[*n].directory) {
        let mut dir = Directory(d.0.try_clone().map_err(|_| "Cannot pin staging")?);
        for p in name.split('/') {
            dir = dir.existing_dir(p)?;
        }
        dir.0.sync_all().map_err(|_| "Cannot sync directory")?;
        dir.0
            .set_permissions(std::fs::Permissions::from_mode(0o500))
            .map_err(|_| "Cannot seal directory")?;
    }
    d.0.sync_all().map_err(|_| "Cannot sync package")?;
    d.0.set_permissions(std::fs::Permissions::from_mode(0o500))
        .map_err(|_| "Cannot seal package")?;
    let from = std::ffi::CString::new(stage).unwrap();
    let to = std::ffi::CString::new(reference).unwrap();
    if unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            parent.0.as_raw_fd(),
            from.as_ptr(),
            parent.0.as_raw_fd(),
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    } < 0
    {
        return Err(
            "Immutable runner publication failed; retained staging requires inspection".into(),
        );
    }
    parent
        .0
        .sync_all()
        .map_err(|_| "Cannot persist runner publication")?;
    pin_release(path, reference)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Plan {
    pub id: String,
    pub revision: u64,
    pub host: String,
    pub project: String,
    pub action: String,
    pub before: Option<RunnerBinding>,
    pub target: RunnerBinding,
    pub store: String,
    pub catalog: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Operation {
    pub allow: bool,
    pub id: String,
    pub plan: Plan,
    pub phase: String,
    pub published: bool,
    pub detail: String,
    pub at_ms: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Review {
    pub api: u32,
    pub expected_revision: u64,
    pub action: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Apply {
    pub api: u32,
    pub operation_id: String,
    pub allow: bool,
}
fn identity(id: &str) -> bool {
    (8..=80).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
pub fn terminal(phase: &str) -> bool {
    matches!(
        phase,
        "applied"
            | "failed"
            | "denied"
            | "cancelled"
            | "stale"
            | "authenticated"
            | "not_authenticated"
            | "deadline"
            | "interrupted"
    )
}
impl Store {
    pub(crate) fn init_runner_management(&mut self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS runner_plans(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runner_operations(id TEXT PRIMARY KEY,body TEXT NOT NULL);").map_err(|_|"Cannot migrate runner management")?;
        for mut op in self.runner_operations()? {
            if !terminal(&op.phase) && op.phase != "uncertain" {
                op.phase = if op.plan.action.starts_with("login_") {
                    "interrupted"
                } else {
                    "recovery_required"
                }
                .into();
                op.detail="Host restarted; no automatic replay. Refresh native authentication and inspect retained artifacts before explicit recovery.".into();
                self.save_runner_operation(&op)?;
            }
        }
        Ok(())
    }
    pub fn runner_operations(&self) -> Result<Vec<Operation>, String> {
        let mut q = self
            .conn
            .prepare("SELECT body FROM runner_operations ORDER BY rowid")
            .map_err(|_| "Cannot read runner operations")?;
        q.query_map([], |r| r.get::<_, String>(0))
            .map_err(|_| "Cannot read runner operations")?
            .map(|r| {
                serde_json::from_str(&r.map_err(|_| "Cannot read runner operation")?)
                    .map_err(|_| "Invalid runner operation".into())
            })
            .collect()
    }
    pub fn runner_operation(&self, id: &str) -> Result<Operation, String> {
        self.runner_operations()?
            .into_iter()
            .find(|o| o.id == id)
            .ok_or("Runner operation unavailable".into())
    }
    fn save_runner_operation(&self, op: &Operation) -> Result<(), String> {
        self.conn.execute("INSERT INTO runner_operations VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![op.id,serde_json::to_string(op).map_err(|_|"Cannot encode runner operation")?]).map_err(|_|"Cannot persist runner operation")?;
        Ok(())
    }
    pub fn runner_busy(&self) -> Result<bool, String> {
        Ok(self.ordinary_preparing()?
            || self.runner_operations()?.iter().any(|o| {
                o.phase == "uncertain"
                    || (o.plan.action.starts_with("login_") && !terminal(&o.phase))
            }))
    }
    pub fn affected_work(&self) -> Result<bool, String> {
        Ok(self
            .all()?
            .iter()
            .any(|r| r.phase.active() || matches!(r.phase, Phase::Queued | Phase::Uncertain))
            || self.tasks_unsettled()?)
    }
    pub fn plan_runner(&mut self,r:&Review,path:&Path)->Result<Plan,String>{let p=self.project.clone();self.plan_runner_for(&p,r,path)}
    pub fn plan_runner_for(&mut self,project:&str,r:&Review,path:&Path)->Result<Plan,String>{
        let c = self.configuration_for(project)?;
        if r.api != API || r.expected_revision != c.revision {
            return Err("Runner configuration changed; refresh and review again".into());
        }
        let target = match r.action.as_str() {
            "install" => managed_binding(path, c.runner.as_ref().and_then(|b| b.model.clone())),
            "acquire_0.167.1" => artifact_binding(
                path,
                &candidate_catalog(),
                c.runner.as_ref().and_then(|b| b.model.clone()),
            )?,
            "reselect_external" => {
                let mut b = c.runner.clone().ok_or("Select an installed runner first")?;
                if b.ownership != "external_unknown" {
                    return Err("Only external installations can be reselected".into());
                }
                b.executable =
                    digest(&std::fs::read(&b.path).map_err(|_| "External executable unavailable")?);
                b
            }
            "native_model" | "sol_model" => {
                let mut b = c.runner.clone().ok_or("Select an installed runner first")?;
                b.model = if r.action == "sol_model" {
                    Some("gpt-6.1-sol".into())
                } else {
                    None
                };
                b
            }
            _ => return Err("Runner/model tuple has not been qualified".into()),
        };
        if r.action != "acquire_0.167.1" {
            validate_binding(&target)?;
        }
        let reference = target.catalog.clone().unwrap_or_else(catalog);
        let plan = Plan {
            id: uuid::Uuid::new_v4().to_string(),
            revision: c.revision,
            host: self.host_id()?,
            project: project.into(),
            before: c.runner,
            target,
            action: r.action.clone(),
            store: store_identity(path)?,
            catalog: reference,
        };
        self.conn
            .execute(
                "INSERT INTO runner_plans VALUES(?1,?2)",
                params![plan.id, serde_json::to_string(&plan).unwrap()],
            )
            .map_err(|_| "Cannot retain runner review")?;
        Ok(plan)
    }
    pub fn accept_runner(&mut self, id: &str, r: &Apply) -> Result<(Operation, bool), String> {
        if r.api != API || !identity(&r.operation_id) {
            return Err("Invalid runner operation identity/API".into());
        }
        if let Ok(op) = self.runner_operation(&r.operation_id) {
            if op.plan.id != id || op.allow != r.allow {
                return Err("Runner operation identity conflict".into());
            }
            return Ok((op, false));
        }
        if self.runner_operations()?.len() >= 256 {
            return Err("Runner operation history is full".into());
        }
        let body: String = self
            .conn
            .query_row("SELECT body FROM runner_plans WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|_| "Cannot read runner plan")?
            .ok_or("Runner plan unavailable")?;
        let plan: Plan = serde_json::from_str(&body).map_err(|_| "Invalid runner plan")?;
        let c = self.configuration_for(&plan.project)?;
        let stale = plan.revision != c.revision
            || plan.before != c.runner
            || catalog_bytes(&plan.catalog).is_err();
        if plan.host != self.host_id()? || self.project_by_id(&crate::projects::id(&plan.project)).is_err() {
            return Err("Foreign runner review".into());
        }
        let op = Operation {
            allow: r.allow,
            id: r.operation_id.clone(),
            plan,
            phase: if !r.allow {
                "denied"
            } else if stale {
                "stale"
            } else {
                "accepted"
            }
            .into(),
            published: false,
            detail: String::new(),
            at_ms: now(),
        };
        self.save_runner_operation(&op)?;
        let run = op.phase == "accepted";
        Ok((op, run))
    }
    fn runner_progress(
        &self,
        op: &mut Operation,
        phase: &str,
        published: bool,
    ) -> Result<bool, String> {
        let mut current = self.runner_operation(&op.id)?;
        current.published |= published;
        if terminal(&current.phase) {
            // A concurrent cancellation can retain publication evidence but can
            // never be overwritten by a worker's older progress snapshot.
            self.save_runner_operation(&current)?;
            *op = current;
            return Ok(false);
        }
        current.phase = phase.into();
        self.save_runner_operation(&current)?;
        *op = current;
        Ok(true)
    }
    pub fn activate_runner(&mut self, op: &mut Operation) -> Result<(), String> {
        validate_binding(&op.plan.target)?;
        let current = self.runner_operation(&op.id)?;
        if terminal(&current.phase) {
            *op = current;
            return Ok(());
        }
        let mut c = self.configuration_for(&op.plan.project)?;
        if c.revision != op.plan.revision || c.runner != op.plan.before {
            op.phase = "stale".into();
            op.detail = "Selection changed; published artifact is retained".into();
            return self.save_runner_operation(op);
        }
        if self.affected_work()? || self.runner_busy()? {
            op.phase = "deferred".into();
            op.detail =
                "Settle queued, running and uncertain work, then continue this reviewed operation"
                    .into();
            return self.save_runner_operation(op);
        }
        c.revision=self.next_configuration_revision()?;
        c.runner = Some(op.plan.target.clone());
        c.codex_executable = Some(op.plan.target.executable.clone());
        op.phase = "applied".into();
        op.detail =
            "Selected for future work; prior artifacts and admitted bindings retained".into();
        self.conn
            .execute_batch("SAVEPOINT runner_activation")
            .map_err(|_| "Cannot begin runner activation")?;
        let result = (|| {
            self.save_configuration(&c)?;
            self.save_runner_operation(op)?;
            self.conn
                .execute_batch("RELEASE runner_activation")
                .map_err(|_| "Cannot commit runner activation".to_string())
        })();
        if result.is_err() {
            let _ = self
                .conn
                .execute_batch("ROLLBACK TO runner_activation; RELEASE runner_activation");
        }
        result
    }
}

// Only follow the user's PATH launcher and legacy selections from that same
// standalone install. Explicit external binaries and catalog packages retain
// their own ownership. New revisions leave all admitted snapshots intact.
fn follows_launcher(binding: &RunnerBinding, launcher: &Path, target: &Path) -> bool {
    if binding.ownership != "external_unknown" { return false; }
    let saved = Path::new(&binding.path);
    if saved == launcher || saved == target { return true; }
    let release_root = |path: &Path| -> Option<PathBuf> {
        if !path.ends_with("bin/codex") { return None; }
        let releases = path.ancestors().nth(3)?;
        releases.ends_with("standalone/releases").then(|| releases.to_path_buf())
    };
    release_root(saved).is_some_and(|root| Some(root) == release_root(target))
}

pub async fn follow_codex_launcher(app: &App, launcher: &Path, previous: &mut Option<crate::native::ExecutableIdentity>) -> Result<(), String> {
    let identity = crate::native::executable_identity(launcher)?;
    if previous.as_ref() == Some(&identity) { return Ok(()); }
    crate::native::version(launcher).await?;
    let target = launcher.canonicalize().map_err(|_| "Cannot resolve Codex launcher")?;
    let source = target.clone();
    let hash = tokio::task::spawn_blocking(move || {
        let mut file = std::fs::File::open(source)?;
        use sha2::Digest;
        let mut hash = sha2::Sha256::new();
        std::io::copy(&mut file, &mut hash)?;
        Ok::<_, std::io::Error>(format!("{:x}", hash.finalize()))
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    if identity != crate::native::executable_identity(launcher)? { return Err("Codex changed during discovery".into()); }
    let store = app.store.lock().unwrap();
    let mut roots = std::collections::BTreeSet::from([store.project.clone()]);
    roots.extend(store.projects()?.into_iter().map(|p| p.root));
    for root in roots {
        let mut c = store.configuration_for(&root)?;
        let Some(binding) = c.runner.as_mut() else { continue; };
        if !follows_launcher(binding, launcher, &target) { continue; }
        let path = launcher.to_str().ok_or("Codex path must be UTF-8")?;
        if binding.path == path && binding.executable == hash { continue; }
        binding.path = path.into();
        binding.executable = hash.clone();
        c.codex_executable = Some(hash.clone());
        c.revision = store.next_configuration_revision()?;
        store.save_configuration(&c)?;
    }
    *previous = Some(identity);
    Ok(())
}

impl App {
    pub(crate) fn scope_lock(
        &self,
        exclusive: bool,
    ) -> Result<crate::managed_tools::OwnedLock, String> {
        #[cfg(test)]
        let root = self.scope_root.lock().unwrap().clone().unwrap_or_else(|| {
            PathBuf::from("/tmp").join(format!("deck2-codex-scopes-{}", unsafe { libc::geteuid() }))
        });
        #[cfg(not(test))]
        let root = PathBuf::from("/tmp")
            .join(format!("deck2-codex-scopes-{}", unsafe { libc::geteuid() }));
        let scope = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".codex")
            });
        let scope = std::fs::canonicalize(&scope).unwrap_or(scope);
        Directory::open_root(&root)?.lock_mode(&digest(scope.as_os_str().as_encoded_bytes()),exclusive).map(crate::managed_tools::OwnedLock).map_err(|_|"Another Deck host owns this native authentication scope; settle its work/sign-in first".into())
    }
    pub(crate) fn retain_auth_scope(&self) -> Result<(), String> {
        let mut held = self.auth_scope.lock().unwrap();
        if held.is_none() {
            *held = Some(self.scope_lock(false)?);
        }
        Ok(())
    }
    pub(crate) fn execution_binary(&self, id: &str) -> Result<PathBuf, String> {
        let receipt = self.receipt(id)?;
        let b = receipt
            .configuration
            .as_ref()
            .and_then(|s| s.runner.as_ref());
        if let Some(b) = b {
            if !receipt.configuration.as_ref().is_some_and(crate::connected_opencode::admitted) {validate_binding(b)?;}
            if b.ownership == "deck_owned"
                && pin_package(&self.artifact_root()?)? != Path::new(&b.path)
            {
                return Err("Admitted package path differs; no fallback".into());
            }
            if crate::tasks::file_digest(Path::new(&b.path))
                .map_err(|_| "Admitted executable unavailable; no fallback")?
                != b.executable
            {
                return Err("Admitted executable changed; no fallback".into());
            }
            Ok(PathBuf::from(&b.path))
        } else {
            Ok(self.binary.clone())
        }
    }
    pub(crate) fn execution_digest(&self, id: &str) -> Result<String, String> {
        crate::tasks::file_digest(&self.execution_binary(id)?)
            .map_err(|_| "Admitted executable unavailable".into())
    }
    pub fn selected_binary(&self) -> Result<PathBuf, String> {
        Ok(self
            .store
            .lock()
            .unwrap()
            .configuration_for(&self.project)?
            .runner
            .map(|b| PathBuf::from(b.path))
            .unwrap_or_else(|| self.binary.clone()))
    }
    pub(crate) fn runner_available(&self) -> Option<String> {
        self.runner_available_for(&self.store.lock().unwrap(), &self.project)
    }
    pub(crate) fn runner_available_for(&self, store: &Store, project: &str) -> Option<String> {
        let c = match store.configuration_for(project) {
            Ok(c) => c,
            Err(e) => return Some(e),
        };
        if c.runner.is_none() && self.availability.is_some() {
            return self.availability.clone();
        }
        let path = c.runner.map(|b| PathBuf::from(b.path)).unwrap_or_else(|| self.binary.clone());
        if path.is_file() { None } else {
            Some(format!("The configured Codex executable is missing: {}. Select a compatible executable in Configuration → Runners.", path.display()))
        }
    }
}

/// Strict, authenticated caller-owned native inventory. A hidden or malformed
/// entry can never become an execution selection through namespace translation.
pub(crate) async fn native_models(n: &mut crate::native::Native) -> Result<Vec<Value>,String> {
    let mut models=vec![];
    let mut seen=std::collections::HashSet::new();
    let mut cursor=Value::Null;
    for page in 0..16 {
        let response=n.request("model/list",json!({"cursor":cursor,"limit":100,"includeHidden":false})).await?;
        for m in response["data"].as_array().ok_or("Native model inventory unavailable")? {
            if ["hidden","isHidden"].iter().any(|key|m.get(*key).is_some_and(|v|!v.is_boolean())) {return Err("Malformed native model visibility".into());}
            if m["hidden"] == true || m["isHidden"] == true {continue;}
            let name=m["model"].as_str().filter(|s|!s.is_empty()&&s.len()<=160&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b"_.-".contains(&b))).ok_or("Malformed native model identity")?;
            if !seen.insert(name.to_owned()) {return Err("Ambiguous native model inventory".into());}
            let levels=m["supportedReasoningEfforts"].as_array().ok_or("Native reasoning inventory unavailable")?.iter().map(|l|l["reasoningEffort"].as_str().filter(|s|!s.is_empty()&&s.len()<=64&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b"_-".contains(&b))).ok_or("Malformed native reasoning level")).collect::<Result<Vec<_>,_>>()?;
            let default = m.get("defaultReasoningEffort").filter(|v| !v.is_null());
            if default.is_some_and(|v| v.as_str().is_none_or(|v| !levels.contains(&v))) {
                return Err("Native default reasoning level is not supported by its model".into());
            }
            models.push(json!({"model":name,"defaultThinkingLevel":default,"thinkingLevels":levels,"qualified":name=="gpt-6.1-sol","reason":if name=="gpt-6.1-sol"{"Qualified explicit policy"}else{"Advertised; execution tuple not qualified"}}));
        }
        cursor=response.get("nextCursor").cloned().unwrap_or(Value::Null);
        if cursor.is_null() {return Ok(models);}
        if !cursor.is_string() || page==15 {return Err("Native model pagination bound or cursor invalid".into());}
    }
    Err("Native model inventory unavailable".into())
}

pub async fn inspect_native(binary: &Path, project: &str) -> Result<Value, String> {
    crate::native::version(binary).await?;
    let mut n = crate::native::Native::start(binary).await?;
    let result = tokio::time::timeout(Duration::from_secs(40), async {
        let (authenticated, _) = n.management(project).await?;
        let mut models = vec![];
        if !authenticated { return Ok(json!({"at_ms":now(),"authenticated":false,"qualified":true,"ready":false,"models":models,"state":"authentication_required"})); }
        models = native_models(&mut n).await?;
        Ok(json!({"at_ms":now(),"authenticated":authenticated,"qualified":true,"ready":authenticated,"models":models,"state":if authenticated{"ready"}else{"authentication_required"}}))
    }).await.unwrap_or_else(|_| Err("Runner inspection deadline exceeded".into()));
    n.terminate()
        .await
        .map_err(|_| "Runner inspection cleanup uncertain".to_string())?;
    result
}
pub async fn run_operation(app: App, id: String) {
    crate::native::invalidate_qualifications();
    let result = worker(&app, &id).await;
    if let Err(e) = result {
        let s = app.store.lock().unwrap();
        if let Ok(mut op) = s.runner_operation(&id) {
            if !terminal(&op.phase) {
                op.phase = if e == "Runner inspection cleanup uncertain" {
                    "uncertain"
                } else {
                    "failed"
                }
                .into();
                op.detail = e;
                if s.save_runner_operation(&op).is_err() {
                    app.storage_failed();
                }
            }
        } else {
            app.storage_failed();
        }
    }
}
async fn worker(app: &App, id: &str) -> Result<(), String> {
    let path = app.artifact_root()?;
    let artifacts = Artifacts::open(&path)?;
    let host = app.store.lock().unwrap().host_id()?;
    let _lock = match artifacts.lock_operation(&host, id) {
        Ok(lock) => lock,
        Err(e) if e == "Shared artifact operation is busy; retry this same operation" => {
            return Ok(());
        }
        Err(e) => return Err(e),
    };
    let mut op = app.store.lock().unwrap().runner_operation(id)?;
    if terminal(&op.phase) {
        return Ok(());
    }
    if store_identity(&path)? != op.plan.store || catalog_bytes(&op.plan.catalog).is_err() {
        return Err("Runner store/catalog changed; selection preserved".into());
    }
    if matches!(op.plan.action.as_str(), "install" | "acquire_0.167.1") {
        if op.plan.target
            != artifact_binding(&path, &op.plan.catalog, op.plan.target.model.clone())?
        {
            return Err("Reviewed artifact differs from release reference".into());
        }
        if pin_release(&path, &op.plan.catalog).is_err() {
            if !app
                .store
                .lock()
                .unwrap()
                .runner_progress(&mut op, "downloading", false)?
            {
                return Ok(());
            }
            let r = release_for_catalog(&op.plan.catalog)?;
            let bytes =
                crate::managed_tools::download_exact(&r.url, r.archive_bytes, &r.archive_sha256)
                    .await?;
            if !app
                .store
                .lock()
                .unwrap()
                .runner_progress(&mut op, "validating", false)?
            {
                return Ok(());
            }
            let root = path.clone();
            let reference = op.plan.catalog.clone();
            tokio::task::spawn_blocking(move || publish_release(&root, &reference, &bytes))
                .await
                .map_err(|_| "Runner publication interrupted")??;
        }
        if !app
            .store
            .lock()
            .unwrap()
            .runner_progress(&mut op, "published_not_selected", true)?
        {
            return Ok(());
        }
    }
    if op.plan.action == "acquire_0.167.1" {
        let s = app.store.lock().unwrap();
        if !terminal(&s.runner_operation(id)?.phase) {
            op.phase = "applied".into();
            op.detail = "Exact package installed but unselected. Native compatibility and execution qualification are incomplete; activation unavailable.".into();
            s.save_runner_operation(&op)?;
        }
        return Ok(());
    }
    validate_binding(&op.plan.target)?;
    if digest(&std::fs::read(&op.plan.target.path).map_err(|_| "Runner executable unavailable")?)
        != op.plan.target.executable
    {
        return Err("Runner executable differs from review".into());
    }
    // Refuse a lost/replaced root before acquiring host-wide process ownership.
    // No native process exists yet, so no uncertain-process reservation is needed.
    {
        let store = app.store.lock().unwrap();
        crate::projects::validate(&store.project_by_id(&crate::projects::id(&op.plan.project))?)?;
    }
    app.retire_native().await?;
    // Reserve before the first native process, with the admission lock order.
    // This path still admits only the original qualified release. The acquired
    // candidate above never reaches native state while qualification is pending.
    let scope = {
        let mut active = app.active.lock().unwrap();
        let s = app.store.lock().unwrap();
        if terminal(&s.runner_operation(id)?.phase) {
            return Ok(());
        }
        if !active.is_empty() || s.affected_work()? || s.runner_busy()? {
            op.phase = "deferred".into();
            op.detail =
                "Settle all queued, active, child and Quality ownership before native validation"
                    .into();
            s.save_runner_operation(&op)?;
            return Ok(());
        }
        app.auth_scope.lock().unwrap().take();
        let scope = app.scope_lock(true)?;
        let (sender, _receiver) = tokio::sync::watch::channel(false);
        active.insert(format!("runner:{id}"), sender);
        scope
    };
    let health = inspect_native(Path::new(&op.plan.target.path), &op.plan.project).await;
    if health
        .as_ref()
        .is_err_and(|e| e == "Runner inspection cleanup uncertain")
    {
        *app.auth_scope.lock().unwrap() = Some(scope);
        return Err("Runner inspection cleanup uncertain".into());
    }
    let result = (|| -> Result<(), String> {
        health?;
        if digest(
            &std::fs::read(&op.plan.target.path)
                .map_err(|_| "Runner disappeared after inspection")?,
        ) != op.plan.target.executable
        {
            return Err("Runner changed during inspection; review again".into());
        }
        let active = app.active.lock().unwrap();
        let mut s = app.store.lock().unwrap();
        if s.runner_operation(id)?.phase == "cancelled" {
            return Ok(());
        }
        if store_identity(&path)? != op.plan.store {
            return Err("Runner store ownership changed".into());
        }
        if active.keys().any(|key| key != &format!("runner:{id}")) {
            op.phase = "deferred".into();
            op.detail = "Execution is still settling; continue after it settles".into();
            s.save_runner_operation(&op)?;
        } else {
            s.activate_runner(&mut op)?;
        }
        Ok(())
    })();
    drop(scope);
    app.clear_active(&format!("runner:{id}"));
    result
}
#[cfg(test)]
mod tests {
    use crate::Store;
    // Protects persisted selection against a startup override. Oracle: S7a
    // selection is explicit; registering a different executable must fail closed.
    #[test]
    fn startup_cannot_overwrite_selected_executable() {
        let mut s = Store::open_memory("/fixture").unwrap();
        s.register_codex("a".repeat(64)).unwrap();
        assert!(s.register_codex("b".repeat(64)).is_err());
        assert_eq!(
            s.configuration().unwrap().codex_executable,
            Some("a".repeat(64))
        );
    }
}

#[derive(Default)]
pub struct Runtime {
    daemon_restart: std::sync::Arc<tokio::sync::Mutex<()>>,
    observation: Option<Value>,
    observation_invalidated: bool,
    refresh_error: Option<String>,
    refresh_owner: Option<(String, Option<RunnerBinding>)>,
    material: BTreeMap<String, Value>,
}
use axum::{
    Json, Router,
    extract::Path as RoutePath,
    response::{IntoResponse, Response},
    routing::{get, post},
};
fn response(result: Result<Value, String>) -> Response {
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => crate::server::problem(axum::http::StatusCode::CONFLICT, "runner_management", e),
    }
}
async fn inspect(crate::server::ProjectState(app): crate::server::ProjectState<App>) -> Response {
    response((|| {
        let s = app.store.lock().unwrap();
        let c = s.configuration_for(&app.project)?;
        let live = app.runner_runtime.lock().unwrap();
        let observation = live.observation.as_ref().filter(|v| v["project"] == app.project);
        let refresh_error = live.refresh_error.as_ref().filter(|_| {
            live.refresh_owner.as_ref() == Some(&(app.project.clone(), c.runner.clone()))
        });
        let historical = refresh_error.is_some()
            || observation.is_some_and(|v| {
                live.observation_invalidated || v.get("binding") != Some(&json!(c.runner))
            });
        Ok(
            json!({"api":API,"revision":c.revision,"selected":c.runner,"catalog":catalog(),"release":release(),"candidate":{"catalog":candidate_catalog(),"release":release_for_catalog(&candidate_catalog())?,"installed":root(&app.artifact_root()?).and_then(|r| r.existing_dir(&candidate_catalog())).and_then(|d| d.bytes("manifest.json",100000)).is_ok_and(|b| b == CANDIDATE_CATALOG.as_bytes()),"activation_available":false,"detail":"Full native-state and execution qualification are pending. Acquisition does not select or start this release.","notices":release_notices(&candidate_catalog())?.iter().map(|(n,b)|json!({"name":n,"body":String::from_utf8_lossy(b)})).collect::<Vec<_>>()},"notices":notices().iter().map(|(n,b)|json!({"name":n,"body":String::from_utf8_lossy(b)})).collect::<Vec<_>>(),"observation":observation,"historical":historical,"refresh_error":refresh_error,"operations":s.runner_operations()?,"open_code":{"assignment":c.investigator,"ready":app.team.lock().unwrap().as_ref().is_some_and(|r|r.matches_project(&app.project)),"scope":"Qualified Investigator only; administration unavailable"}}),
        )
    })())
}
async fn restart_codex_daemon(crate::server::ProjectState(app): crate::server::ProjectState<App>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }
    let lock = app.runner_runtime.lock().unwrap().daemon_restart.clone();
    let Ok(guard) = lock.try_lock_owned() else {
        return response(Err("A Codex server restart is already in progress.".into()));
    };
    let binary = match app.selected_binary() {
        Ok(path) => path,
        Err(error) => return response(Err(error)),
    };
    // Keep ownership if the browser navigates away during the native operation.
    let restart = tokio::spawn(async move {
        let _guard = guard;
        use std::process::Stdio;
        let mut command = tokio::process::Command::new(binary);
        command.args(["app-server", "daemon", "restart"])
            .env_remove("CODEX_REMOTE")
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .kill_on_drop(true);
        let status = tokio::time::timeout(Duration::from_secs(60), command.status()).await
            .map_err(|_| "Codex did not confirm the restart within 60 seconds. Check the server before retrying.")?
            .map_err(|e| format!("Could not start the selected Codex CLI: {e}"))?;
        if !status.success() {
            return Err(format!("Codex daemon restart failed ({status}). Check that the selected CLI supports app-server daemon restart."));
        }
        app.runner_runtime.lock().unwrap().observation_invalidated = true;
        Ok(json!({"restarted": true}))
    });
    response(restart.await.unwrap_or_else(|_| Err("Codex server restart outcome unavailable.".into())))
}

async fn refresh(crate::server::ProjectState(app): crate::server::ProjectState<App>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    let binary = match app.selected_binary() {
        Ok(p) => p,
        Err(e) => return response(Err(e)),
    };
    let selected = app
        .store
        .lock()
        .unwrap()
        .configuration_for(&app.project)
        .ok()
        .and_then(|c| c.runner);
    let result: Result<Value, String> = async {
        let mut observed = observe_installation(&binary, "codex").await?;
        observed["binding"] = json!(selected);
        if observed["qualified"] == false {
            return Ok(observed);
        }
        if let Some(b) = &selected {
            validate_binding(b)?;
            if b.ownership == "deck_owned" && pin_package(&app.artifact_root()?)? != binary {
                return Err("Managed runner package differs from selection".into());
            }
            if digest(
                &std::fs::read(&binary)
                    .map_err(|_| "Codex is missing at the selected path; review installation")?,
            ) != b.executable
            {
                observed["state"] = json!("reselection_required");
                observed["detail"] = json!("Supported version at a changed executable. Explicitly review reselection before future work; admitted work retains its original identity.");
                return Ok(observed);
            }
        }
        let mut v = inspect_native(&binary, &app.project).await?;
        v["version"] = observed["version"].clone();
        Ok(v)
    }
    .await;
    let mut runtime = app.runner_runtime.lock().unwrap();
    match result {
        Ok(mut v) => {
            v["binding"] = json!(selected);
            v["project"] = json!(app.project);
            runtime.observation = Some(v.clone());
            runtime.observation_invalidated = false;
            runtime.refresh_error = None;
            response(Ok(v))
        }
        Err(e) => {
            // An error displayed for another owner must not renew this observation.
            if runtime.observation.as_ref().is_some_and(|v| {
                v["project"] == app.project && v.get("binding") == Some(&json!(selected))
            }) {
                runtime.observation_invalidated = true;
            }
            runtime.refresh_owner = Some((app.project.clone(), selected));
            runtime.refresh_error = Some(e.clone());
            response(Err(e))
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Maintenance {
    api: u32,
    expected_revision: u64,
    #[serde(default = "codex_target")]
    target: String,
}
fn codex_target() -> String {
    "codex".into()
}
// The last probe/cleanup owner releases exclusion, including on cancellation.
struct MaintenanceReservation {
    app: App,
    scope: Option<crate::managed_tools::OwnedLock>,
}
impl MaintenanceReservation {
    fn outcome<T>(held: &std::sync::Arc<Self>, result: Result<T, String>) -> Result<T, String> {
        result.map_err(|e| {
            if std::sync::Arc::strong_count(held) > 1 {
                format!("{e}. Probe cleanup is uncertain; affected Deck work remains blocked until settlement.")
            } else {
                e
            }
        })
    }
}
impl Drop for MaintenanceReservation {
    fn drop(&mut self) {
        self.scope.take();
        self.app.clear_active("maintenance-help");
    }
}
// This action only prepares a terminal handoff. Native update may need a TTY
// or invoke a package manager/installer whose destination Deck cannot attest.
async fn maintenance_handoff(app: &App, revision: u64) -> Result<Value, String> {
    app.retire_native().await?;
    crate::native::invalidate_qualifications();
    let (binding, scope) = {
        let mut active = app.active.lock().unwrap();
        let s = app.store.lock().unwrap();
        if !app.persistence_available()
            || !active.is_empty()
            || s.affected_work()?
            || s.runner_busy()?
        {
            return Err("Settle Deck work and sign-in before preparing maintenance".into());
        }
        let c = s.configuration_for(&app.project)?;
        if c.revision != revision {
            return Err("Runner selection changed; refresh before maintenance".into());
        }
        let b = c.runner.ok_or("Select an installed Codex first")?;
        validate_binding(&b)?;
        if b.ownership == "deck_owned" {
            return Err("This is an immutable Deck package. In-place native updates are unavailable; use an externally managed installation for native maintenance. The retained package is unchanged.".into());
        }
        if digest(&std::fs::read(&b.path).map_err(|_| "Selected executable unavailable")?)
            != b.executable
        {
            return Err(
                "Selected executable changed; inspect its installation before maintenance".into(),
            );
        }
        app.auth_scope.lock().unwrap().take();
        let scope = app.scope_lock(true)?;
        let (tx, _rx) = tokio::sync::watch::channel(false);
        active.insert("maintenance-help".into(), tx);
        (b, scope)
    };
    let reservation = std::sync::Arc::new(MaintenanceReservation {
        app: app.clone(),
        scope: Some(scope),
    });
    let result = crate::native::PROBE_RESERVATION.scope(reservation.clone(), async {
        crate::native::version(Path::new(&binding.path)).await?;
        let help = crate::native::command_probe(Path::new(&binding.path), &["update", "--help"]).await?;
        if !String::from_utf8_lossy(&help).contains("codex update") {
            return Err("Selected CLI does not advertise native update; use its owning package manager".into());
        }
        let s = app.store.lock().unwrap();
        let c = s.configuration_for(&app.project)?;
        if c.revision != revision || c.runner.as_ref() != Some(&binding) {
            return Err("Runner selection changed during maintenance preparation".into());
        }
        let quoted = format!("'{}'", binding.path.replace('\'', "'\"'\"'"));
        Ok(json!({"api":API,"revision":revision,"phase":"terminal_handoff","updated":false,"executable":binding.path,"command":format!("{quoted} update"),"detail":"No update was run. In a terminal outside the project, confirm this installation's owner and the native updater's destination before proceeding; it may invoke a package manager or installer and affect another copy. Stop Deck work first. After completion, check this exact executable with --version and refresh readiness here. Changed or unsupported versions remain blocked; an exit code alone does not establish Deck compatibility."}))
    }).await;
    MaintenanceReservation::outcome(&reservation, result)
}
const MAINTENANCE_TARGETS: [&str; 6] = [
    "codex",
    "claude",
    "pi",
    "opencode",
    "rtk",
    "codebase-memory-mcp",
];
fn installed_path(app: &App, target: &str) -> Result<PathBuf, String> {
    if !MAINTENANCE_TARGETS.contains(&target) {
        return Err("Unknown maintenance target".into());
    }
    if target == "codex" {
        return app.selected_binary();
    }
    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .filter(|p| p.is_absolute())
        .map(|p| p.join(target))
        .find(|p| {
            p.metadata()
                .is_ok_and(|m| m.is_file() && m.mode() & 0o111 != 0)
        })
        .ok_or("Tool is not installed on the host PATH".into())
}
fn quote(v: &str) -> String {
    format!("'{}'", v.replace('\'', "'\"'\"'"))
}
async fn observe_installation(binary: &Path, target: &str) -> Result<Value, String> {
    let bytes = crate::native::command_probe(binary, &["--version"]).await?;
    let version = String::from_utf8(bytes).map_err(|_| "Version is not UTF-8")?;
    let version = version.trim();
    if version.is_empty() || version.len() > 160 || version.chars().any(char::is_control) {
        return Err("Invalid bounded version response".into());
    }
    let supported = target == "codex" && crate::native::codex_version(version).is_some();
    Ok(
        json!({"target":target,"executable":binary,"version":version,"at_ms":now(),"authenticated":null,"models":[],"qualified":supported,"ready":false,"state":if supported {"readiness_check_required"} else if target=="codex" {"unsupported_version"} else {"version_observed"},"detail":if supported {"Supported version; inspect native readiness before explicit reselection"} else if target=="codex" {"The executable did not identify itself as Codex CLI."} else {"Version observed; this does not qualify an execution role or prove an update completed."}}),
    )
}
async fn tool_handoff(binary: &Path, target: &str) -> Result<Value, String> {
    let observed = observe_installation(binary, target).await?;
    let (args, marker, suffix) = match target {
        "claude" => (vec!["update", "--help"], "claude update", "update"),
        "pi" => (vec!["update", "--help"], "--self", "update --self"),
        "opencode" => (vec!["upgrade", "--help"], "opencode upgrade", "upgrade"),
        "codebase-memory-mcp" => (vec!["--help"], "codebase-memory-mcp update", "update"),
        "rtk" => (vec!["--help"], "Usage: rtk", ""),
        _ => return Err("Unknown helper maintenance target".into()),
    };
    let help = crate::native::command_probe(binary, &args).await?;
    if !String::from_utf8_lossy(&help).contains(marker) {
        return Err("Installed tool does not advertise the supported maintenance mechanism".into());
    }
    let command = if target == "rtk" {
        // Upstream installer supports RTK_INSTALL_DIR. Never direct it at a
        // symlink/package-managed location; those need their actual manager.
        let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
        if binary != home.join(".local/bin/rtk")
            || binary
                .symlink_metadata()
                .map_err(|_| "Cannot inspect ownership")?
                .file_type()
                .is_symlink()
        {
            return Err(
                "RTK installation is package-managed or unknown; use its owning package manager"
                    .into(),
            );
        }
        format!(
            "curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | RTK_INSTALL_DIR={} sh",
            quote(
                &binary
                    .parent()
                    .ok_or("Missing installation directory")?
                    .to_string_lossy()
            )
        )
    } else {
        format!("{} {suffix}", quote(&binary.to_string_lossy()))
    };
    Ok(
        json!({"api":API,"phase":"terminal_handoff","updated":false,"target":target,"executable":binary,"command":command,"observation":observed,"detail":"No update was run. Confirm installation ownership and the updater destination in your terminal; package-managed installations must use their actual manager. Stop affected Deck work before running the command. Preparation does not lock a later terminal action. Afterwards inspect this same path here; version observation alone does not qualify execution. Existing Deck packages and prepared service state are retained."}),
    )
}
async fn maintenance(crate::server::ProjectState(app): crate::server::ProjectState<App>, Json(r): Json<Maintenance>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if r.api != API {
        return response(Err("Incompatible maintenance request".into()));
    }
    if r.target == "codex" {
        return response(maintenance_handoff(&app, r.expected_revision).await);
    }
    response(maintenance_tool(&app, &r, false).await)
}
// Uses the existing active-work exclusion for probes; no updater runs in the host.
async fn maintenance_tool(app: &App, r: &Maintenance, observe: bool) -> Result<Value, String> {
    app.retire_native().await?;
    crate::native::invalidate_qualifications();
    let (binary, scope) = {
        let mut active = app.active.lock().unwrap();
        let s = app.store.lock().unwrap();
        if !app.persistence_available()
            || !active.is_empty()
            || s.affected_work()?
            || s.runner_busy()?
        {
            return Err("Settle Deck work before inspection/maintenance".into());
        }
        let c = s.configuration_for(&app.project)?;
        if c.revision != r.expected_revision {
            return Err("Selection changed; refresh first".into());
        }
        let binary = if r.target == "codex" {
            c.runner
                .map(|b| PathBuf::from(b.path))
                .unwrap_or_else(|| app.binary.clone())
        } else {
            installed_path(app, &r.target)?
        };
        app.auth_scope.lock().unwrap().take();
        let scope = app.scope_lock(true)?;
        let (tx, _rx) = tokio::sync::watch::channel(false);
        active.insert("maintenance-help".into(), tx);
        (binary, scope)
    };
    let reservation = std::sync::Arc::new(MaintenanceReservation {
        app: app.clone(),
        scope: Some(scope),
    });
    let mut result = crate::native::PROBE_RESERVATION
        .scope(reservation.clone(), async {
            if observe {
                observe_installation(&binary, &r.target).await
            } else {
                tool_handoff(&binary, &r.target).await
            }
        })
        .await;
    if let Ok(v) = &mut result {
        if app
            .store
            .lock()
            .unwrap()
            .configuration_for(&app.project)
            .map(|c| c.revision)
            != Ok(r.expected_revision)
        {
            result = Err("Selection changed during maintenance inspection; refresh first".into());
        } else {
            v["revision"] = json!(r.expected_revision);
        }
    }
    MaintenanceReservation::outcome(&reservation, result)
}
async fn maintenance_inspect(crate::server::ProjectState(app): crate::server::ProjectState<App>, Json(r): Json<Maintenance>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if r.api != API {
        return response(Err("Incompatible maintenance request".into()));
    }
    response(maintenance_tool(&app, &r, true).await)
}
async fn review(crate::server::ProjectState(app): crate::server::ProjectState<App>, Json(r): Json<Review>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    response((|| {
        if !app.persistence_available() {
            return Err("Persistence unavailable".into());
        }
        let path = app.artifact_root()?;
        let p = app.store.lock().unwrap().plan_runner_for(&app.project, &r, &path)?;
        Ok(json!(p))
    })())
}
async fn apply(
    crate::server::ProjectState(app): crate::server::ProjectState<App>,
    RoutePath(id): RoutePath<String>,
    Json(r): Json<Apply>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    let result = (|| {
        if !app.persistence_available() {
            return Err("Persistence unavailable".into());
        }
        app.store.lock().unwrap().accept_runner(&id, &r)
    })();
    match result {
        Ok((op, run)) => {
            if run {
                tokio::spawn(run_operation(app, op.id.clone()));
            }
            response(Ok(json!(op)))
        }
        Err(e) => response(Err(e)),
    }
}
async fn operation(crate::server::ProjectState(app): crate::server::ProjectState<App>, RoutePath(id): RoutePath<String>) -> Response {
    response((|| {
        let op = app.store.lock().unwrap().runner_operation(&id)?;
        let material = app
            .runner_runtime
            .lock()
            .unwrap()
            .material
            .get(&id)
            .cloned();
        Ok(json!({"operation":op,"handoff":material}))
    })())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Action {
    api: u32,
}
async fn resume(
    crate::server::ProjectState(app): crate::server::ProjectState<App>,
    RoutePath(id): RoutePath<String>,
    Json(r): Json<Action>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    let result = (|| {
        if r.api != API || !app.persistence_available() {
            return Err("Incompatible API or persistence unavailable".into());
        }
        let s = app.store.lock().unwrap();
        let mut op = s.runner_operation(&id)?;
        if !["deferred", "recovery_required"].contains(&op.phase.as_str())
            || op.plan.action.starts_with("login_")
        {
            return Err("Operation is not eligible for explicit installation recovery".into());
        }
        op.phase = "accepted".into();
        s.save_runner_operation(&op)?;
        Ok(op)
    })();
    match result {
        Ok(op) => {
            tokio::spawn(run_operation(app, op.id.clone()));
            response(Ok(json!(op)))
        }
        Err(e) => response(Err(e)),
    }
}
async fn cancel(
    crate::server::ProjectState(app): crate::server::ProjectState<App>,
    RoutePath(id): RoutePath<String>,
    Json(r): Json<Action>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if r.api != API {
        return response(Err("Incompatible API".into()));
    }
    // Same lock order as admission/activation. Login cancellation is reconciled by
    // its supervising connection; installation cancellation never removes artifacts.
    let active = app.active.lock().unwrap();
    let s = app.store.lock().unwrap();
    response((|| {
        let mut op = s.runner_operation(&id)?;
        if op.phase == "uncertain" {
            return Err("Native cleanup is uncertain; preserve state and inspect the owning process before recovery".into());
        }
        if let Some(sender) = active.get(&format!("login:{id}")) {
            let _ = sender.send(true);
        } else if !terminal(&op.phase) {
            op.phase = "cancelled".into();
            op.detail =
                "Cancelled; any published package is retained and selection is unchanged".into();
            s.save_runner_operation(&op)?;
        }
        Ok(json!(op))
    })())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Login {
    api: u32,
    id: String,
    kind: String,
    expected_revision: u64,
}
async fn login(crate::server::ProjectState(app): crate::server::ProjectState<App>, Json(r): Json<Login>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if r.api != API
        || !identity(&r.id)
        || !["browser", "device"].contains(&r.kind.as_str())
        || !app.persistence_available()
    {
        return response(Err("Invalid sign-in request".into()));
    }
    if let Err(e) = app.retire_native().await { return response(Err(e)); }
    let result = (|| -> Result<_, String> {
        let mut active = app.active.lock().unwrap();
        let s = app.store.lock().unwrap();
        if let Ok(op) = s.runner_operation(&r.id) {
            if op.plan.action != format!("login_{}", r.kind)
                || op.plan.revision != r.expected_revision
            {
                return Err("Sign-in identity conflict".into());
            }
            return Ok((op, None));
        }
        if !active.is_empty() || s.affected_work()? || s.runner_busy()? {
            return Err("Settle Deck work and any earlier sign-in before signing in".into());
        }
        let c = s.configuration_for(&app.project)?;
        if c.revision != r.expected_revision {
            return Err("Runner selection changed; refresh before signing in".into());
        }
        let b = c.runner.ok_or("Select an installed Codex first")?;
        validate_binding(&b)?;
        if s.runner_operations()?.len() >= 256 {
            return Err("Runner operation history is full".into());
        }
        let op = Operation {
            allow: true,
            id: r.id.clone(),
            phase: "accepted".into(),
            published: false,
            detail: "Preparing native sign-in; native Codex owns credentials".into(),
            at_ms: now(),
            plan: Plan {
                id: r.id.clone(),
                revision: c.revision,
                host: s.host_id()?,
                project: app.project.clone(),
                before: Some(b.clone()),
                target: b,
                action: format!("login_{}", r.kind),
                store: String::new(),
                catalog: catalog(),
            },
        };
        // Drop a settled host's old shared reservation before requesting EX.
        app.auth_scope.lock().unwrap().take();
        let scope = app.scope_lock(true)?;
        s.save_runner_operation(&op)?;
        let (tx, rx) = tokio::sync::watch::channel(false);
        active.insert(format!("login:{}", r.id), tx);
        Ok((op, Some((rx, scope))))
    })();
    match result {
        Ok((op, rx)) => {
            if let Some((rx, scope)) = rx {
                tokio::spawn(login_worker(app, op.clone(), rx, scope));
            }
            response(Ok(json!(op)))
        }
        Err(e) => response(Err(e)),
    }
}
pub fn safe_handoff(v: &Value) -> Result<Value, String> {
    let device = v["type"] == "chatgptDeviceCode";
    let raw = v[if device { "verificationUrl" } else { "authUrl" }]
        .as_str()
        .ok_or("Native sign-in destination unavailable")?;
    let url = reqwest::Url::parse(raw).map_err(|_| "Invalid native sign-in destination")?;
    if raw.len() > 8192
        || url.scheme() != "https"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.host_str(), Some("auth.openai.com" | "chatgpt.com"))
    {
        return Err("Native sign-in destination is outside the allowed HTTPS service".into());
    }
    let code = if device {
        Some(
            v["userCode"]
                .as_str()
                .filter(|s| {
                    !s.is_empty()
                        && s.len() <= 128
                        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                })
                .ok_or("Invalid device verification code")?,
        )
    } else {
        None
    };
    Ok(json!({"url":url.as_str(),"code":code,"kind":if device{"device"}else{"browser"}}))
}
async fn login_worker(
    app: App,
    mut op: Operation,
    mut cancel: tokio::sync::watch::Receiver<bool>,
    scope: crate::managed_tools::OwnedLock,
) {
    let result = login_inner(&app, &mut op, &mut cancel, Duration::from_secs(300)).await;
    app.runner_runtime.lock().unwrap().material.remove(&op.id);
    match result {
        Ok((authenticated, state)) => {
            op.phase = if authenticated {
                "authenticated"
            } else {
                state
            }
            .into();
            op.detail = if authenticated {
                "Native account is authenticated. Refresh runner readiness before execution."
            } else {
                "Native sign-in did not establish authentication. No automatic retry was started."
            }
            .into();
        }
        Err(e) => {
            op.phase = if e == "Native login cleanup uncertain" {
                "uncertain"
            } else if e == "Local sign-in deadline exceeded"
                || e == "Runner initialization deadline exceeded"
            {
                "deadline"
            } else {
                "failed"
            }
            .into();
            op.detail="Native sign-in failed or its connection could not settle. Inspect Codex using its own CLI and refresh before another attempt.".into();
        }
    }
    if app
        .store
        .lock()
        .unwrap()
        .save_runner_operation(&op)
        .is_err()
    {
        app.storage_failed();
    }
    if op.phase == "uncertain" {
        *app.auth_scope.lock().unwrap() = Some(scope);
    } else {
        drop(scope);
        app.clear_active(&format!("login:{}", op.id));
    }
}
async fn login_inner(
    app: &App,
    op: &mut Operation,
    cancel: &mut tokio::sync::watch::Receiver<bool>,
    deadline: Duration,
) -> Result<(bool, &'static str), String> {
    let path = Path::new(&op.plan.target.path);
    if digest(&std::fs::read(path).map_err(|_| "Missing executable")?) != op.plan.target.executable
    {
        return Err("Executable identity changed".into());
    }
    crate::native::version(path).await?;
    let mut n = crate::native::Native::start(path).await?;
    let result=tokio::time::timeout(deadline+Duration::from_secs(30),async {
        let (authenticated,_)=tokio::select! { r=tokio::time::timeout(Duration::from_secs(40),n.management(&app.project))=>r.map_err(|_|"Runner initialization deadline exceeded")??, _=cancel.changed()=>return Ok((false,"cancelled")) };
        if authenticated{return Ok((true,"authenticated"));}
        if *cancel.borrow(){return Ok((false,"cancelled"));}
        let kind=if op.plan.action=="login_device"{"chatgptDeviceCode"}else{"chatgpt"};
        let started=n.request("account/login/start",json!({"type":kind})).await?;
        let login=started["loginId"].as_str().filter(|s|!s.is_empty()&&s.len()<=256).ok_or("Missing native login identity")?.to_string();
        if started["type"]!=kind{return Err("Unexpected native login method".into());}
        let material=safe_handoff(&started)?;
        app.runner_runtime.lock().unwrap().material.insert(op.id.clone(),material);
        op.phase="awaiting_user".into();op.detail="Complete sign-in in the native service. Verification material is temporary and never stored.".into();app.store.lock().unwrap().save_runner_operation(op)?;
        let wait=async {loop{let v=n.read().await?;if v["method"]=="account/login/completed"&&v["params"]["loginId"]==login{return Ok::<_,String>(v["params"]["success"]==true);}}};
        let state=tokio::select!{r=wait=>{if r?{"not_authenticated"}else{"failed"}},_=cancel.changed()=>"cancelled",_=tokio::time::sleep(deadline)=>"deadline"};
        if state=="cancelled"||state=="deadline" {let _=n.request("account/login/cancel",json!({"loginId":login})).await?;}
        // Re-read after completion AND cancellation; notFound/canceled does not undo
        // a concurrently successful provider login. Never persist native errors.
        let account=n.request("account/read",json!({"refreshToken":false})).await?;
        Ok((account.get("account").is_some_and(|v|!v.is_null()),state))
    }).await.unwrap_or_else(|_|Err("Local sign-in deadline exceeded".to_string()));
    n.terminate()
        .await
        .map_err(|_| "Native login cleanup uncertain".to_string())?;
    result
}
pub fn routes() -> Router<App> {
    Router::new()
        .route("/api/runners", get(inspect))
        .route("/api/runners/refresh", post(refresh))
        .route("/api/runners/codex/daemon/restart", post(restart_codex_daemon))
        .route("/api/runners/maintenance", post(maintenance))
        .route(
            "/api/runners/maintenance/inspect",
            post(maintenance_inspect),
        )
        .route("/api/runners/plans", post(review))
        .route("/api/runners/plans/{id}/apply", post(apply))
        .route("/api/runners/operations/{id}", get(operation))
        .route("/api/runners/operations/{id}/continue", post(resume))
        .route("/api/runners/operations/{id}/cancel", post(cancel))
        .route("/api/runners/login", post(login))
}

pub(crate) fn inspect_state(conn: &rusqlite::Connection) -> Result<(), String> {
    for table in ["runner_plans", "runner_operations"] {
        let mut query = conn
            .prepare(&format!("SELECT id,body FROM {table}"))
            .map_err(|_| "Corrupt runner management state")?;
        let rows = query
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|_| "Corrupt runner management state")?;
        for row in rows {
            let (id, body) = row.map_err(|_| "Corrupt runner record")?;
            let plan = if table == "runner_plans" {
                let p: Plan = serde_json::from_str(&body).map_err(|_| "Corrupt runner plan")?;
                if p.id != id {
                    return Err("Runner plan identity mismatch".into());
                }
                p
            } else {
                let op: Operation =
                    serde_json::from_str(&body).map_err(|_| "Corrupt runner operation")?;
                if op.id != id {
                    return Err("Runner operation identity mismatch".into());
                }
                op.plan
            };
            if plan.action == "acquire_0.167.1" {
                if plan.catalog != candidate_catalog()
                    || plan.target.catalog.as_deref() != Some(plan.catalog.as_str())
                {
                    return Err("Invalid unqualified acquisition reference".into());
                }
                let r = release_for_catalog(&plan.catalog)?;
                if plan.target.executable != r.members["bin/codex"].sha256.clone().unwrap()
                    || plan.target.qualification != r.qualification
                    || plan.target.ownership != "deck_owned"
                {
                    return Err("Invalid unqualified acquisition binding".into());
                }
            } else {
                validate_binding(&plan.target)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "runner_management_tests.rs"]
mod boundary_tests;
