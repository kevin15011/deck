//! Per-project/scope durable authority. A short file gate serializes all participating hosts.
use crate::{
    managed_tools::Directory,
    tasks::{digest, validate_relative},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{File, OpenOptions},
    os::{
        fd::AsRawFd,
        unix::fs::{MetadataExt, OpenOptionsExt},
    },
    path::{Path, PathBuf},
};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Snapshot {
    pub project: String,
    pub device: u64,
    pub inode: u64,
    pub files: BTreeMap<String, String>,
    pub hashes: BTreeMap<String, String>,
    pub digest: String,
}
fn root_identity(p: &Path) -> Result<(String, u64, u64), String> {
    let f = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(p)
        .map_err(|_| "Project root unavailable")?;
    let m = f.metadata().map_err(|_| "Project metadata unavailable")?;
    let canonical = std::fs::canonicalize(p).map_err(|_| "Project root unavailable")?;
    Ok((
        canonical.to_str().ok_or("Project is not UTF-8")?.into(),
        m.dev(),
        m.ino(),
    ))
}
impl Snapshot {
    pub fn capture(project: &Path, paths: &[String]) -> Result<Self, String> {
        Self::capture_checked(project,paths,||Ok(()))
    }
    pub(crate) fn capture_checked(project:&Path, paths:&[String], check:impl Fn()->Result<(),String>)->Result<Self,String>{
        check()?;
        if paths.is_empty() || paths.len() > 50_000 {
            return Err("Index 1 to 50000 ordinary UTF-8 source files".into());
        }
        let (project_name, device, inode) = root_identity(project)?;
        let mut files = BTreeMap::new();
        let mut total = 0;
        for path in paths {
            check()?;
            validate_relative(path)?;
            if files.contains_key(path) {
                return Err("Duplicate source path".into());
            }
            let text = crate::opencode::scoped_source(project, std::slice::from_ref(path), path)?;
            total += text.len();
            if total > 128 * 1024 * 1024 {
                return Err("Code index exceeds 128 MiB".into());
            }
            files.insert(path.clone(), text);
        }
        check()?;
        if root_identity(project)? != (project_name.clone(), device, inode) {
            return Err("Project root changed during capture".into());
        }
        let hashes = files
            .iter()
            .map(|(path, body)| (path.clone(), digest(body.as_bytes())))
            .collect();
        let digest = digest(
            &serde_json::to_vec(&(&project_name, device, inode, &files))
                .map_err(|_| "Cannot encode source manifest")?,
        );
        Ok(Self {
            project: project_name,
            device,
            inode,
            hashes,
            files,
            digest,
        })
    }
    pub fn verify_materialized(&self, source: &Path) -> Result<(), String> {
        fn paths(root: &Path, p: &Path, out: &mut Vec<String>) -> Result<(), String> {
            for e in std::fs::read_dir(p).map_err(io)? {
                let e = e.map_err(io)?;
                let m = e.file_type().map_err(io)?;
                if m.is_dir() {
                    paths(root, &e.path(), out)?
                } else if m.is_file() {
                    out.push(
                        e.path()
                            .strip_prefix(root)
                            .map_err(|_| "Snapshot path mismatch")?
                            .to_str()
                            .ok_or("Snapshot path encoding")?
                            .into(),
                    );
                } else {
                    return Err("Linked or special snapshot material".into());
                }
            }
            Ok(())
        }
        let mut actual = vec![];
        paths(source, source, &mut actual)?;
        actual.sort();
        if actual != self.files.keys().cloned().collect::<Vec<_>>() {
            return Err("Prepared source inventory changed".into());
        }
        for (path, body) in &self.files {
            if crate::opencode::scoped_source(source, std::slice::from_ref(path), path)? != *body {
                return Err("Prepared snapshot bytes changed".into());
            }
        }
        Ok(())
    }
    pub fn authorize(&self, project: &Path, scope: &[String]) -> Result<(), String> {
        self.authorize_checked(project,scope,||Ok(()))
    }
    pub(crate) fn authorize_checked(&self,project:&Path,scope:&[String],check:impl Fn()->Result<(),String>)->Result<(),String>{
        check()?;
        if root_identity(project)? != (self.project.clone(), self.device, self.inode) {
            return Err("Prepared project identity changed; use admitted scoped reads".into());
        }
        let exact=scope.iter().collect::<std::collections::BTreeSet<_>>();
        for (path, bytes) in &self.files {
            check()?;
            if !exact.contains(path) && !scope.iter().any(|s| Path::new(path).starts_with(s)) {
                return Err("Entire prepared index is not authorized by this task; use admitted scoped reads".into());
            }
            if crate::opencode::scoped_source(project, std::slice::from_ref(path), path)? != *bytes {
                return Err("Prepared source is stale; use admitted exact scoped reads and explicitly reprepare".into());
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Reservation {
    pub host: String,
    pub root: String,
    pub snapshot: String,
    pub created: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Maintenance {
    pub id: String,
    pub old: String,
    pub target: String,
    pub phase: String,
    pub manifest: BTreeMap<String, String>,
    pub configuration: BTreeMap<String, String>,
    pub adr: serde_json::Value,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Record {
    #[serde(default)]
    pub automatic_project: Option<String>,
    pub store_identity: String,
    pub schema: u32,
    pub id: String,
    pub snapshot: String,
    pub version: String,
    pub executable: String,
    pub catalog: String,
    pub state_format: u32,
    pub generation: u64,
    pub admission_open: bool,
    pub phase: String,
    pub operation: Option<String>,
    #[serde(default)]
    pub maintenance: Option<Maintenance>,
    pub reservations: Vec<Reservation>,
    pub supervisor: Option<String>,
}
// This guard owns a completed metadata critical section, not a process lifetime.
// Explicit unlock prevents unrelated fork copies from prolonging its ownership.
pub struct Gate(File);
impl Drop for Gate {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.0);
    }
}
pub struct Service {
    pub store_identity: String,
    pub id: String,
    pub directory: Directory,
    pub path: PathBuf,
}
fn io(e: std::io::Error) -> String {
    format!("CBM service IO: {e}")
}
fn remove_owned_tree(path:&Path)->Result<(),String>{
    use std::os::unix::fs::PermissionsExt;
    let m=std::fs::symlink_metadata(path).map_err(io)?;
    if m.is_dir(){std::fs::set_permissions(path,std::fs::Permissions::from_mode(0o700)).map_err(io)?;
        for entry in std::fs::read_dir(path).map_err(io)?{remove_owned_tree(&entry.map_err(io)?.path())?;}
        std::fs::remove_dir(path).map_err(io)
    }else{std::fs::remove_file(path).map_err(io)}
}
struct Unpublished { path:PathBuf, committed:bool }
impl Drop for Unpublished {fn drop(&mut self){if !self.committed {let _=remove_owned_tree(&self.path);}}}
impl Service {
    pub(crate) fn identity(snapshot: &Snapshot) -> Result<String, String> {
        Ok(digest(
            &serde_json::to_vec(&(
                &snapshot.project,
                snapshot.device,
                snapshot.inode,
                snapshot.files.keys().collect::<Vec<_>>(),
                &snapshot.digest,
            ))
            .map_err(|_| "Cannot encode service identity")?,
        ))
    }
    /// Seed only an unprepared same-project service from a stable native cache.
    /// SQLite backup includes WAL content; native content hashes handle additions,
    /// changes and deletions on the next index_repository call.
    pub(crate) fn seed_index(&self, previous:&Self)->Result<(),String>{
        self.seed_index_checked(previous,||Ok(()))
    }
    pub(crate) fn seed_index_checked(&self,previous:&Self,check:impl Fn()->Result<(),String>)->Result<(),String>{
        check()?;
        if self.id==previous.id{return Ok(());}
        let _old=previous.gate()?;
        let _new=self.gate()?;
        let current=self.record()?;let old=previous.record()?;
        if self.id==previous.id || current.phase!="unprepared" || old.phase!="ready" || current.version!=old.version {return Ok(());}
        let a=self.snapshot()?;let b=previous.snapshot()?;
        if (a.project,a.device,a.inode)!=(b.project,b.device,b.inode){return Err("Cannot seed a foreign code index".into());}
        if !previous.path.join("state/cache/scope-repo.db").exists(){return Ok(());}
        let source=previous.directory.directory("state",false)?.directory("cache",false)?;
        let name=std::ffi::CString::new("scope-repo.db").unwrap();
        let fd=unsafe{libc::openat(source.0.as_raw_fd(),name.as_ptr(),libc::O_RDONLY|libc::O_NOFOLLOW|libc::O_CLOEXEC)};
        if fd<0{return Ok(());}
        use std::os::fd::FromRawFd;
        let file=unsafe{File::from_raw_fd(fd)};
        let metadata=file.metadata().map_err(io)?;
        if !metadata.is_file() || metadata.uid()!=unsafe{libc::geteuid()} || metadata.nlink()!=1{return Err("Unsafe native index cache".into());}
        // Hold both owned directory descriptors and the database descriptor while
        // opening SQLite. The service gate excludes Deck maintenance/replacement.
        let source_path=source.path().join("scope-repo.db");
        let src=rusqlite::Connection::open_with_flags(&source_path,rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_|"Cannot read previous code index")?;
        let destination=self.directory.directory("state",false)?.directory("cache",true)?;
        let mut dest=rusqlite::Connection::open(destination.path().join("scope-repo.db")).map_err(|_|"Cannot seed code index")?;
        std::fs::set_permissions(destination.path().join("scope-repo.db"),std::os::unix::fs::PermissionsExt::from_mode(0o600)).map_err(io)?;
        let backup=rusqlite::backup::Backup::new(&src,&mut dest).map_err(|_|"Cannot snapshot previous code index")?;
        loop {check()?;match backup.step(128).map_err(|_|"Cannot snapshot previous code index")? {rusqlite::backup::StepResult::Done=>break,rusqlite::backup::StepResult::More=>{},_=>return Err("Code index cache busy".into())}}
        check()?;
        Ok(())
    }
    pub fn create(root: &Path, snapshot: &Snapshot, version: &str) -> Result<Self, String> {
        Self::create_checked(root,snapshot,version,||Ok(()))
    }
    pub(crate) fn create_checked(root: &Path, snapshot: &Snapshot, version: &str, check:impl Fn()->Result<(),String>) -> Result<Self, String> {
        check()?;
        let release = crate::cbm_artifacts::release(version)?;
        let id = Self::identity(snapshot)?;
        let s = Self::open_mode(root, &id, true)?;
        let _gate = s.gate()?;
        if s.directory
            .path()
            .join("record.json")
            .symlink_metadata()
            .is_ok()
        {
            let r = s.record()?;
            if r.snapshot != snapshot.digest {
                return Err("Service already has a different prepared snapshot; explicit maintenance required".into());
            }
            return Ok(s);
        }
        let mut pending=Unpublished{path:s.path.clone(),committed:false};
        // Store captured bytes once, then write the authoritative record last.
        let snap = s.directory.directory(&snapshot.digest, true)?;
        let source = snap.directory("source", true)?;
        for (path, body) in &snapshot.files {
            check()?;
            let parts: Vec<_> = Path::new(path).components().collect();
            let mut d = Directory(source.0.try_clone().map_err(io)?);
            for p in &parts[..parts.len() - 1] {
                d = d.directory(
                    p.as_os_str().to_str().ok_or("Invalid source directory")?,
                    true,
                )?;
            }
            d.write(
                parts
                    .last()
                    .unwrap()
                    .as_os_str()
                    .to_str()
                    .ok_or("Invalid source filename")?,
                body.as_bytes(),
            )?;
            d.0.sync_all().map_err(io)?;
        }
        check()?;
        snap.write(
            "snapshot.json",
            &serde_json::to_vec(snapshot).map_err(|_| "Cannot encode snapshot")?,
        )?;
        snap.0.sync_all().map_err(io)?;
        fn seal(path: &Path, check:&dyn Fn()->Result<(),String>) -> Result<(), String> {
            use std::os::unix::fs::PermissionsExt;
            for e in std::fs::read_dir(path).map_err(io)? {
                check()?;
                let e = e.map_err(io)?;
                if e.file_type().map_err(io)?.is_dir() {
                    seal(&e.path(),check)?
                } else {
                    let f = File::open(e.path()).map_err(io)?;
                    f.set_permissions(std::fs::Permissions::from_mode(0o400))
                        .map_err(io)?;
                    f.sync_all().map_err(io)?;
                }
            }
            let f = File::open(path).map_err(io)?;
            f.set_permissions(std::fs::Permissions::from_mode(0o500))
                .map_err(io)?;
            f.sync_all().map_err(io)
        }
        seal(&source.path(),&check)?;
        for name in ["state", "runtime", "evidence"] {
            s.directory.directory(name, true)?;
        }
        check()?;
        s.save(&Record {
            store_identity: s.store_identity.clone(),
            automatic_project: None,
            schema: 3,
            id: s.id.clone(),
            snapshot: snapshot.digest.clone(),
            version: version.into(),
            executable: release.executable,
            catalog: release.catalog,
            state_format: if version == "0.12.0" { 2 } else { 3 },
            generation: 1,
            admission_open: false,
            phase: "unprepared".into(),
            operation: None,
            maintenance: None,
            reservations: vec![],
            supervisor: None,
        })?;
        pending.committed=true;
        Ok(s)
    }
    /// Close admission before checking leases. A retained lease delays retirement.
    #[cfg(test)]
    pub(crate) fn retire(&self)->Result<bool,String>{self.retire_with(||Ok(()))}
    // Record retirement under the service gates before removing its journal.
    // A failed deletion leaves closed admission and durable cleanup authority.
    pub(crate) fn retire_with(&self, retired:impl FnOnce()->Result<(),String>)->Result<bool,String>{
        {let _gate=self.gate()?;let mut r=self.record()?;
         if r.operation.is_some() || !["ready","unprepared","retired"].contains(&r.phase.as_str()){return Err("Code index operation still owns service".into());}
         r.admission_open=false;self.save(&r)?;
         if !r.reservations.is_empty(){return Ok(false);}}
        if self.check_supervisor().is_ok(){crate::cbm_runtime::control(&self.path,&serde_json::json!({"action":"retire"}))?;}
        let until=std::time::Instant::now()+std::time::Duration::from_secs(5);
        let _supervisor=loop {match self.directory.lock("supervisor.lock"){Ok(g)=>break g,Err(_) if std::time::Instant::now()<until=>std::thread::sleep(std::time::Duration::from_millis(10)),Err(e)=>return Err(e)}};
        let _gate=self.gate()?;
        if !self.record()?.reservations.is_empty(){return Ok(false);}
        let mut record=self.record()?;
        record.phase="retired".into();record.admission_open=false;self.save(&record)?;
        retired()?;
        remove_owned_tree(&self.path)?;Ok(true)
    }
    pub fn open(root: &Path, id: &str) -> Result<Self, String> {
        Self::open_mode(root, id, false)
    }
    fn open_mode(root: &Path, id: &str, create: bool) -> Result<Self, String> {
        if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid managed service identity".into());
        }
        let root = if create { Directory::open_root(root)? } else { Directory::existing_root(root)? };
        let m = root.0.metadata().map_err(io)?;
        let store_identity = format!("{}:{}:{}", m.uid(), m.dev(), m.ino());
        let parent = if create { root.directory("cbm-services", true)? } else { root.existing_dir("cbm-services")? };
        let directory = if create { parent.directory(id, true)? } else { parent.existing_dir(id)? };
        let path = std::fs::canonicalize(directory.path()).map_err(io)?;
        Ok(Self {
            store_identity,
            id: id.into(),
            directory,
            path,
        })
    }
    pub fn check_supervisor(&self) -> Result<(), String> {
        let r = self.record()?;
        let identity = r.supervisor.ok_or("Managed supervisor was not prepared")?;
        let parts: Vec<_> = identity.split(':').collect();
        if parts.len() != 3 {
            return Err("Supervisor identity uncertain; explicit preparation required".into());
        }
        let boot = std::fs::read_to_string("/proc/sys/kernel/random/boot_id")
            .map_err(|_| "Cannot inspect supervisor boot identity")?;
        let stat = std::fs::read_to_string(format!("/proc/{}/stat", parts[1]))
            .map_err(|_| "Managed supervisor lost; explicit reconciliation/preparation required")?;
        let start = stat
            .rsplit_once(')')
            .ok_or("Supervisor identity unavailable")?
            .1
            .split_whitespace()
            .nth(19)
            .ok_or("Supervisor start identity unavailable")?;
        let lock = self.directory.file("supervisor.lock", false)?;
        if boot.trim() != parts[0]
            || start != parts[2]
            || fs2::FileExt::try_lock_shared(&lock).is_ok()
        {
            return Err(
                "Supervisor lifetime uncertain; explicit reconciliation/preparation required"
                    .into(),
            );
        }
        Ok(())
    }
    pub fn gate(&self) -> Result<Gate, String> {
        self.directory.lock("gate.lock").map(Gate)
    }
    pub fn record(&self) -> Result<Record, String> {
        let r: Record = serde_json::from_slice(&self.directory.bytes("record.json", 1024 * 1024)?)
            .map_err(|_| "CBM journal unavailable; preserve state, admission closed")?;
        if r.schema != 3 || r.id != self.id || r.store_identity != self.store_identity {
            return Err("Unsupported or foreign CBM service state".into());
        }
        let release = crate::cbm_artifacts::release(&r.version)?;
        if r.executable != release.executable
            || r.catalog != release.catalog
            || r.state_format != if r.version == "0.12.0" { 2 } else { 3 }
        {
            return Err("CBM executable/catalog/state-format identity mismatch".into());
        }
        Ok(r)
    }
    pub fn snapshot(&self) -> Result<Snapshot, String> {
        let r = self.record()?;
        let d = self.directory.existing_dir(&r.snapshot)?;
        let s: Snapshot = serde_json::from_slice(&d.bytes("snapshot.json", 192 * 1024 * 1024)?)
            .map_err(|_| "CBM snapshot unavailable")?;
        let expected = digest(
            &serde_json::to_vec(&(&s.project, s.device, s.inode, &s.files))
                .map_err(|_| "Cannot encode snapshot")?,
        );
        let hashes: BTreeMap<_, _> = s
            .files
            .iter()
            .map(|(path, body)| (path.clone(), digest(body.as_bytes())))
            .collect();
        if s.digest != r.snapshot || s.digest != expected || s.hashes != hashes {
            return Err("CBM snapshot identity mismatch".into());
        }
        Ok(s)
    }
    pub fn save(&self, r: &Record) -> Result<(), String> {
        let name = format!(".record-{}", uuid::Uuid::new_v4());
        let body = serde_json::to_vec(r).map_err(|_| "Cannot encode service record")?;
        self.directory.write(&name, &body)?;
        let from = std::ffi::CString::new(name).unwrap();
        let to = c"record.json";
        if unsafe {
            libc::renameat(
                self.directory.0.as_raw_fd(),
                from.as_ptr(),
                self.directory.0.as_raw_fd(),
                to.as_ptr(),
            )
        } < 0
        {
            return Err(io(std::io::Error::last_os_error()));
        }
        self.directory.0.sync_all().map_err(io)
    }
    // Called only after designated native health. The runtime owns this transition.
    pub fn mark_ready(&self) -> Result<(), String> {
        let _g = self.gate()?;
        let mut r = self.record()?;
        if !["unprepared", "preparing", "ready"].contains(&r.phase.as_str())
            || !r.reservations.is_empty()
        {
            return Err("Preparation phase changed".into());
        }
        r.phase = "ready".into();
        r.admission_open = true;
        self.save(&r)
    }
    pub fn reserve(
        &self,
        host: &str,
        root: &str,
        snapshot: &str,
        generation: u64,
        version: &str,
    ) -> Result<(), String> {
        let _g = self.gate()?;
        let mut r = self.record()?;
        if r.generation != generation || r.version != version {
            return Err(
                "Selected graph generation changed; admitted scoped-read fallback required".into(),
            );
        }
        if let Some(existing) = r
            .reservations
            .iter()
            .find(|v| v.host == host && v.root == root)
        {
            if existing.snapshot == snapshot {
                return Ok(());
            }
            return Err("Existing CBM reservation binding differs".into());
        }
        if !r.admission_open || r.phase != "ready" || r.snapshot != snapshot {
            return Err(
                "CBM unavailable or maintenance pending; admitted scoped-read fallback required"
                    .into(),
            );
        }
        if r.reservations.len() >= 256
            || host.len() > 128
            || root.len() > 128
            || host.is_empty()
            || root.is_empty()
        {
            return Err("CBM reservation bound exceeded".into());
        }
        r.reservations.push(Reservation {
            host: host.into(),
            root: root.into(),
            snapshot: snapshot.into(),
            created: crate::now(),
        });
        self.save(&r)
    }
    pub fn release(&self, host: &str, root: &str) -> Result<(), String> {
        let _g = self.gate()?;
        let mut r = self.record()?;
        r.reservations.retain(|v| v.host != host || v.root != root);
        self.save(&r)
    }
    pub fn begin_maintenance(&self, operation: &str) -> Result<bool, String> {
        let _g = self.gate()?;
        let mut r = self.record()?;
        if r.operation.as_deref().is_some_and(|v| v != operation) {
            return Err("Another CBM operation owns maintenance".into());
        }
        if !["ready", "deferred"].contains(&r.phase.as_str()) {
            return Err("CBM requires preparation or recovery".into());
        }
        if r.operation.is_none() {
            r.maintenance = Some(Maintenance {
                id: operation.into(),
                old: r.version.clone(),
                target: "0.12.1".into(),
                phase: "intent".into(),
                manifest: BTreeMap::new(),
                configuration: BTreeMap::new(),
                adr: serde_json::Value::Null,
            });
        }
        r.operation = Some(operation.into());
        r.admission_open = false;
        r.phase = if r.reservations.is_empty() {
            "maintenance"
        } else {
            "deferred"
        }
        .into();
        self.save(&r)?;
        Ok(r.reservations.is_empty())
    }
}
#[cfg(test)]
mod gate_boundary {
    use super::*;
    // A fork can retain a CLOEXEC copy until exec. Scope end must still unlock
    // the completed metadata transaction; a live owning guard excludes peers.
    #[test]
    fn incidental_descriptor_does_not_extend_completed_gate_ownership() {
        let project = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(store.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(project.path().join("handler.rs"), "fn handler(){}\n").unwrap();
        let snapshot = Snapshot::capture(project.path(), &["handler.rs".into()]).unwrap();
        let service = Service::create(store.path(), &snapshot, "0.12.0").unwrap();
        let owning = service.gate().unwrap();
        let incidental = owning.0.try_clone().unwrap();
        assert!(service.gate().is_err());
        drop(owning);
        assert!(
            service.gate().is_ok(),
            "A settled metadata gate must not remain busy through an incidental descriptor"
        );
        drop(incidental);
    }
}

#[cfg(test)]
mod automatic_seed_tests {
    use super::*;
    // Oracle: native incremental refresh starts from a consistent prior graph,
    // including WAL writes, without changing the prior service or snapshot.
    // Protects consistent incremental cache seeding and immutable prior source.
    #[test]
    fn settings_model_incremental_seed_preserves_wal_and_project_identity(){
        let d=tempfile::tempdir().unwrap();let project=d.path().join("project");
        std::fs::create_dir(&project).unwrap();let paths=vec!["a.rs".into()];
        std::fs::write(project.join("a.rs"),"fn first() {}\n").unwrap();
        let root=d.path().join("tools");
        let first=Service::create(&root,&Snapshot::capture(&project,&paths).unwrap(),"0.12.0").unwrap();
        first.mark_ready().unwrap();
        let cache=first.directory.directory("state",false).unwrap().directory("cache",true).unwrap();
        let db=rusqlite::Connection::open(cache.path().join("scope-repo.db")).unwrap();
        db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES('committed in WAL');").unwrap();
        std::fs::write(project.join("a.rs"),"fn changed() {}\n").unwrap();
        let second=Service::create(&root,&Snapshot::capture(&project,&paths).unwrap(),"0.12.0").unwrap();
        second.seed_index(&first).unwrap();
        let seeded=rusqlite::Connection::open(second.path.join("state/cache/scope-repo.db")).unwrap();
        assert_eq!(seeded.query_row("SELECT value FROM probe",[],|r|r.get::<_,String>(0)).unwrap(),"committed in WAL");
        assert_eq!(seeded.query_row("PRAGMA quick_check",[],|r|r.get::<_,String>(0)).unwrap(),"ok");
        assert_ne!(first.snapshot().unwrap().digest,second.snapshot().unwrap().digest);
        assert_eq!(first.record().unwrap().phase,"ready");
    }
}

#[cfg(test)]
mod retention_tests {
    use super::*;
    fn bytes(path:&Path)->u64 {std::fs::read_dir(path).unwrap().map(|e|{let e=e.unwrap();if e.file_type().unwrap().is_dir(){bytes(&e.path())}else{e.metadata().unwrap().len()}}).sum()}
    // SM-Q1: disk and generation count stay bounded; reservations delay removal.
    // Protects reservations and bounded automatic service disk use.
    #[test]
    fn settings_model_service_retention_preserves_leases_and_bounds_disk(){
        let d=tempfile::tempdir().unwrap();let project=d.path().join("project");std::fs::create_dir(&project).unwrap();
        let root=d.path().join("store");let mut current:Option<Service>=None;
        for i in 0..24 {
            std::fs::write(project.join("a.rs"),format!("fn version_{i}(){{}}\n")).unwrap();
            let next=Service::create(&root,&Snapshot::capture(&project,&["a.rs".into()]).unwrap(),"0.12.0").unwrap();next.mark_ready().unwrap();
            if let Some(old)=current.take(){
                let r=old.record().unwrap();old.reserve("host","root",&r.snapshot,r.generation,&r.version).unwrap();
                assert!(!old.retire().unwrap());assert!(old.path.exists());
                assert!(old.reserve("host","other",&r.snapshot,r.generation,&r.version).is_err());
                old.release("host","root").unwrap();assert!(old.retire().unwrap());assert!(!old.path.exists());
            }
            assert!(std::fs::read_dir(root.join("cbm-services")).unwrap().count()<=2);
            assert!(bytes(&root)<32*1024,"source payload must not accumulate across refreshes");
            current=Some(next);
        }
    }
    // SM-Q2/Q5: cancel within capture/materialization, never publish partial source.
    // Protects cancellation within capture and partial-service cleanup.
    #[test]
    fn settings_model_capture_and_materialization_cancel_cooperatively(){
        let d=tempfile::tempdir().unwrap();let root=d.path().join("store");
        std::fs::write(d.path().join("a.rs"),"fn a(){}\n").unwrap();
        std::fs::write(d.path().join("b.rs"),"fn b(){}\n").unwrap();
        let paths=vec!["a.rs".into(),"b.rs".into()];let calls=std::cell::Cell::new(0);
        assert!(Snapshot::capture_checked(d.path(),&paths,||{calls.set(calls.get()+1);if calls.get()>=3{Err("revoked".into())}else{Ok(())}}).is_err());
        let snapshot=Snapshot::capture(d.path(),&paths).unwrap();calls.set(0);
        assert!(Service::create_checked(&root,&snapshot,"0.12.0",||{calls.set(calls.get()+1);if calls.get()>=3{Err("revoked".into())}else{Ok(())}}).is_err());
        assert_eq!(std::fs::read_dir(root.join("cbm-services")).unwrap().count(),0);
    }
}
