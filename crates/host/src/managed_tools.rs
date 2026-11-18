//! Fixed reviewed artifacts. Publication is shared; activation belongs to one Store.
use crate::tasks::digest;
use deck2_shared::HelperSelection;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::fs::MetadataExt,
    },
    path::{Path, PathBuf},
};

// An owned flock reservation must explicitly unlock on settlement. Closing the
// parent's descriptor alone leaves a concurrent fork's copy locked until exec.
// Keep this guard with the process/cleanup owner until settlement is confirmed.
pub(crate) struct OwnedLock(pub(crate) File);
impl Drop for OwnedLock {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.0);
    }
}

const CATALOG: &str = include_str!("../resources/rtk/catalog.json");
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Notice {
    pub member: String,
    pub origin: String,
    pub url: String,
    pub sha256: String,
    pub body: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Release {
    pub selection: HelperSelection,
    pub url: String,
    pub archive_bytes: u64,
    pub archive_sha256: String,
    pub executable_bytes: u64,
    pub members: BTreeMap<String, u64>,
    pub notices: Vec<Notice>,
}
pub fn catalog_digest() -> String {
    digest(CATALOG.as_bytes())
}
pub fn release(version: &str) -> Result<Release, String> {
    let catalog: Value = serde_json::from_str(CATALOG).map_err(|_| "Invalid embedded catalog")?;
    let d = &catalog["versions"][version];
    if d.is_null() {
        return Err("Version is outside the reviewed Linux x86_64 musl catalog".into());
    }
    let notice_bytes = |file: &str| -> Result<&'static str, String> {
        match file {
            "0.50.0/tag-LICENSE" => Ok(include_str!("../resources/rtk/0.50.0/tag-LICENSE")),
            "1.2.0/archive-LICENSE" => Ok(include_str!("../resources/rtk/1.2.0/archive-LICENSE")),
            "1.2.0/archive-LICENSE-ENGINE" => Ok(include_str!(
                "../resources/rtk/1.2.0/archive-LICENSE-ENGINE"
            )),
            "1.2.0/tag-LICENSE" => Ok(include_str!("../resources/rtk/1.2.0/tag-LICENSE")),
            _ => Err("Unknown notice".into()),
        }
    };
    let mut notices = vec![];
    for n in d["notices"].as_array().ok_or("Missing notices")? {
        let body = notice_bytes(n["file"].as_str().ok_or("Missing notice bytes")?)?;
        if digest(body.as_bytes()) != n["sha256"] || body.len() as u64 != n["bytes"] {
            return Err("Embedded notice identity mismatch".into());
        }
        // Preserve separately acquired provenance even when bytes match.
        notices.push(Notice {
            member: n["member"].as_str().unwrap().into(),
            origin: n["origin"].as_str().unwrap().into(),
            url: n["url"].as_str().unwrap().into(),
            sha256: digest(body.as_bytes()),
            body: body.into(),
        });
    }
    Ok(Release {
        selection: HelperSelection {
            version: version.into(),
            executable: d["binary"]["sha256"].as_str().unwrap().into(),
            catalog: catalog_digest(),
        },
        url: d["archive"]["url"].as_str().unwrap().into(),
        archive_bytes: d["archive"]["bytes"].as_u64().unwrap(),
        archive_sha256: d["archive"]["sha256"].as_str().unwrap().into(),
        executable_bytes: d["binary"]["bytes"].as_u64().unwrap(),
        members: d["archive"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| {
                (
                    m["name"].as_str().unwrap().into(),
                    m["size"].as_u64().unwrap(),
                )
            })
            .collect(),
        notices,
    })
}
pub fn validate_selection(s: &HelperSelection) -> Result<Release, String> {
    let r = release(&s.version)?;
    if r.selection != *s {
        Err("Admitted artifact/catalog mismatch; no fallback".into())
    } else {
        Ok(r)
    }
}
pub fn default_root() -> Result<PathBuf, String> {
    Ok(
        PathBuf::from(std::env::var_os("HOME").ok_or("Home unavailable")?)
            .join(".local/share/deck2-managed-v1"),
    )
}
fn cstr(s: &str) -> Result<std::ffi::CString, String> {
    if s.is_empty() || s.contains('/') || s == "." || s == ".." {
        return Err("Invalid owned entry".into());
    }
    std::ffi::CString::new(s).map_err(|_| "Invalid owned entry".into())
}
fn io(e: std::io::Error) -> String {
    format!("Owned artifact IO: {e}")
}
// Every owned path is traversed through held descriptors, never mutable symlinks.
pub struct Directory(pub File);
impl Directory {
    pub fn open_root(path: &Path) -> Result<Self, String> {
        Self::root(path, true)
    }
    pub fn existing_root(path: &Path) -> Result<Self, String> {
        Self::root(path, false)
    }
    fn root(path: &Path, create: bool) -> Result<Self, String> {
        if !path.is_absolute() {
            return Err("Artifact root must be absolute".into());
        }
        let mut dir = Self(File::open("/").map_err(io)?);
        let parts: Vec<_> = path
            .components()
            .filter_map(|p| {
                if let std::path::Component::Normal(s) = p {
                    Some(s.to_str())
                } else {
                    None
                }
            })
            .collect();
        for (i, p) in parts.iter().enumerate() {
            let name = p.ok_or("Invalid root path")?;
            let private = i + 1 == parts.len();
            dir = dir.open_directory(name, private, create)?;
        }
        dir.check(true)?;
        Ok(dir)
    }
    fn check(&self, directory: bool) -> Result<(), String> {
        let m = self.0.metadata().map_err(io)?;
        if (directory && !m.is_dir())
            || (!directory && !m.is_file())
            || m.uid() != unsafe { libc::geteuid() }
            || m.mode() & 0o077 != 0
            || (!directory && m.nlink() != 1)
        {
            return Err("Owned path has unsafe type, owner, mode or links".into());
        }
        Ok(())
    }
    pub fn directory(&self, name: &str, private: bool) -> Result<Self, String> {
        self.open_directory(name, private, true)
    }
    pub fn existing_dir(&self, name: &str) -> Result<Self, String> {
        self.open_directory(name, true, false)
    }
    fn open_directory(&self, name: &str, private: bool, create: bool) -> Result<Self, String> {
        let n = cstr(name)?;
        if create {
            let made = unsafe { libc::mkdirat(self.0.as_raw_fd(), n.as_ptr(), 0o700) };
            if made < 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::EEXIST) {
                return Err(io(std::io::Error::last_os_error()));
            }
        }
        let fd = unsafe {
            libc::openat(
                self.0.as_raw_fd(), n.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 { return Err(io(std::io::Error::last_os_error())); }
        let d = Self(unsafe { File::from_raw_fd(fd) });
        if private { d.check(true)?; }
        Ok(d)
    }
    pub fn file(&self, name: &str, create: bool) -> Result<File, String> {
        let n = cstr(name)?;
        let flags = if create {
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL
        } else {
            libc::O_RDONLY
        };
        let fd = unsafe {
            libc::openat(
                self.0.as_raw_fd(),
                n.as_ptr(),
                flags | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
                0o600,
            )
        };
        if fd < 0 {
            return Err(io(std::io::Error::last_os_error()));
        }
        let f = unsafe { File::from_raw_fd(fd) };
        Self(f.try_clone().map_err(io)?).check(false)?;
        Ok(f)
    }
    pub fn write(&self, name: &str, bytes: &[u8]) -> Result<(), String> {
        let mut f = self.file(name, true)?;
        f.write_all(bytes).map_err(io)?;
        f.sync_all().map_err(io)
    }
    pub fn bytes(&self, name: &str, cap: u64) -> Result<Vec<u8>, String> {
        let f = self.file(name, false)?;
        if f.metadata().map_err(io)?.len() > cap {
            return Err("Owned file exceeds bound".into());
        }
        let mut b = vec![];
        f.take(cap + 1).read_to_end(&mut b).map_err(io)?;
        if b.len() as u64 > cap {
            return Err("Owned file grew beyond bound".into());
        }
        Ok(b)
    }
    pub fn lock(&self, name: &str) -> Result<File, String> {
        self.lock_mode(name, true)
    }
    pub fn lock_mode(&self, name: &str, exclusive: bool) -> Result<File, String> {
        let n = cstr(name)?;
        let fd = unsafe {
            libc::openat(
                self.0.as_raw_fd(),
                n.as_ptr(),
                libc::O_RDWR
                    | libc::O_CREAT
                    | libc::O_NOFOLLOW
                    | libc::O_CLOEXEC
                    | libc::O_NONBLOCK,
                0o600,
            )
        };
        if fd < 0 {
            return Err(io(std::io::Error::last_os_error()));
        }
        let f = unsafe { File::from_raw_fd(fd) };
        Self(f.try_clone().map_err(io)?).check(false)?;
        (if exclusive {
            f.try_lock_exclusive()
        } else {
            fs2::FileExt::try_lock_shared(&f)
        })
        .map_err(|_| "Shared artifact operation is busy; retry this same operation".to_string())?;
        Ok(f)
    }
    pub fn path(&self) -> PathBuf {
        PathBuf::from(format!("/proc/self/fd/{}", self.0.as_raw_fd()))
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct Manifest {
    owner: String,
    selection: HelperSelection,
    notices: Vec<Notice>,
}
fn manifest(r: &Release) -> Manifest {
    Manifest {
        owner: "deck2-managed-v1".into(),
        selection: r.selection.clone(),
        notices: r.notices.clone(),
    }
}
pub struct Artifacts {
    root: Directory,
    pub identity: String,
}
impl Artifacts {
    pub fn open(path: &Path) -> Result<Self, String> {
        let root = Directory::open_root(path)?;
        let m = root.0.metadata().map_err(io)?;
        let identity = format!("deck2-managed-v1:{}:{}:{}", m.uid(), m.dev(), m.ino());
        for d in ["artifacts", "staging", "locks", "operations", "invocations"] {
            root.directory(d, true)?;
        }
        Ok(Self { root, identity })
    }
    pub fn lock_operation(&self, host: &str, id: &str) -> Result<File, String> {
        self.root.directory("locks", true)?.lock(&format!(
            "operation-{}",
            digest(format!("{host}:{id}").as_bytes())
        ))
    }
    pub fn pin(&self, s: &HelperSelection) -> Result<File, String> {
        let r = validate_selection(s)?;
        let d = self
            .root
            .existing_dir("artifacts")?
            .existing_dir(&s.executable)?;
        if d.0.metadata().map_err(io)?.mode() & 0o222 != 0 {
            return Err("Published directory is mutable".into());
        }
        let m: Manifest = serde_json::from_slice(&d.bytes("manifest.json", 100000)?)
            .map_err(|_| "Artifact manifest unreadable")?;
        if m != manifest(&r) {
            return Err("Artifact ownership/notice mismatch".into());
        }
        for (i, n) in r.notices.iter().enumerate() {
            if d.bytes(&format!("notice-{i}"), 20000)? != n.body.as_bytes() {
                return Err("Artifact notice mismatch".into());
            }
        }
        let f = d.file("rtk", false)?;
        let meta = f.metadata().map_err(io)?;
        if meta.len() != r.executable_bytes || meta.mode() & 0o222 != 0 || meta.mode() & 0o100 == 0
        {
            return Err("Artifact executable size/mode mismatch".into());
        }
        let mut b = vec![];
        (&f).take(r.executable_bytes + 1)
            .read_to_end(&mut b)
            .map_err(io)?;
        if digest(&b) != s.executable {
            return Err("Artifact executable hash mismatch".into());
        }
        Ok(f)
    }
    pub fn status(&self, s: &HelperSelection) -> (bool, Option<String>) {
        match self.pin(s) {
            Ok(_) => (true, None),
            Err(e) => {
                let absent = (|| {
                    let d = self.root.existing_dir("artifacts")?;
                    let name = cstr(&s.executable)?;
                    let mut st: libc::stat = unsafe { std::mem::zeroed() };
                    let result = unsafe {
                        libc::fstatat(
                            d.0.as_raw_fd(),
                            name.as_ptr(),
                            &mut st,
                            libc::AT_SYMLINK_NOFOLLOW,
                        )
                    };
                    Ok::<_, String>(
                        result < 0
                            && std::io::Error::last_os_error().raw_os_error() == Some(libc::ENOENT),
                    )
                })();
                (false, if absent == Ok(true) { None } else { Some(e) })
            }
        }
    }
    pub fn invocation(
        &self,
        s: &HelperSelection,
        host: &str,
        attempt: &str,
        call: &str,
    ) -> Result<Directory, String> {
        validate_selection(s)?;
        self.root
            .directory("invocations", true)?
            .directory(&s.executable, true)?
            .directory(&digest(host.as_bytes()), true)?
            .directory(&digest(attempt.as_bytes()), true)?
            .directory(&digest(call.as_bytes()), true)
    }
    pub fn stage(&self) -> Result<Directory, String> {
        self.root
            .directory("staging", true)?
            .directory(&uuid::Uuid::new_v4().to_string(), true)
    }
    pub fn publish(&self, r: &Release, archive: &[u8]) -> Result<(), String> {
        let _lock = self
            .root
            .directory("locks", true)?
            .lock(&r.selection.executable)?;
        let artifacts = self.root.directory("artifacts", true)?;
        // Any existing destination must validate fully; never replace it.
        let name = cstr(&r.selection.executable)?;
        let mut st: libc::stat = unsafe { std::mem::zeroed() };
        let exists = unsafe {
            libc::fstatat(
                artifacts.0.as_raw_fd(),
                name.as_ptr(),
                &mut st,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } == 0;
        if exists {
            return self.pin(&r.selection).map(|_| ());
        }
        // Seal then rename within one parent: moving a sealed directory across
        // parents needs write permission to update its parent link on Linux.
        let staging = self.root.directory("artifacts", true)?;
        let id = format!(".staging-{}", uuid::Uuid::new_v4());
        let d = staging.directory(&id, true)?;
        extract(r, archive, &d)?;
        for (i, n) in r.notices.iter().enumerate() {
            d.write(&format!("notice-{i}"), n.body.as_bytes())?;
        }
        d.write(
            "manifest.json",
            &serde_json::to_vec(&manifest(r)).map_err(|_| "Cannot encode artifact manifest")?,
        )?;
        use std::os::unix::fs::PermissionsExt;
        for name in ["manifest.json".to_string()]
            .into_iter()
            .chain((0..r.notices.len()).map(|i| format!("notice-{i}")))
        {
            let f = d.file(&name, false)?;
            f.set_permissions(std::fs::Permissions::from_mode(0o400))
                .map_err(io)?;
            f.sync_all().map_err(io)?;
        }
        let f = d.file("rtk", false)?;
        f.set_permissions(std::fs::Permissions::from_mode(0o500))
            .map_err(io)?;
        f.sync_all().map_err(io)?;
        d.0.sync_all().map_err(io)?;
        d.0.set_permissions(std::fs::Permissions::from_mode(0o500))
            .map_err(io)?;
        let from = cstr(&id)?;
        let result = unsafe {
            libc::syscall(
                libc::SYS_renameat2,
                staging.0.as_raw_fd(),
                from.as_ptr(),
                artifacts.0.as_raw_fd(),
                name.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        if result < 0 {
            return Err(io(std::io::Error::last_os_error()));
        }
        artifacts.0.sync_all().map_err(io)?;
        self.pin(&r.selection).map(|_| ())
    }
    pub fn observation(&self, host: &str, id: &str, body: &Value) -> Result<(), String> {
        let d = self
            .root
            .directory("operations", true)?
            .directory(&digest(format!("{host}:{id}").as_bytes()), true)?;
        d.write(
            &format!("{}.json", uuid::Uuid::new_v4()),
            &serde_json::to_vec(body).map_err(|_| "Cannot encode publication observation")?,
        )?;
        d.0.sync_all().map_err(io)
    }
}
fn extract(r: &Release, archive: &[u8], d: &Directory) -> Result<(), String> {
    if archive.len() as u64 != r.archive_bytes || digest(archive) != r.archive_sha256 {
        return Err("Archive size/hash mismatch".into());
    }
    let cap = r.members.values().sum::<u64>() + 65536;
    let decoder = flate2::read::GzDecoder::new(archive);
    let mut tar = tar::Archive::new(decoder.take(cap));
    let mut seen = BTreeMap::new();
    for entry in tar.entries().map_err(|_| "Invalid tar stream")? {
        let mut e = entry.map_err(|_| "Invalid tar member")?;
        let path = std::str::from_utf8(&e.path_bytes())
            .map_err(|_| "Invalid member path")?
            .to_string();
        let size = e.size();
        if !e.header().entry_type().is_file()
            || r.members.get(&path) != Some(&size)
            || seen.insert(path.clone(), size).is_some()
        {
            return Err("Unexpected, duplicate, linked or unsafe archive member".into());
        }
        let mut b = vec![];
        e.by_ref().take(size + 1).read_to_end(&mut b).map_err(io)?;
        if b.len() as u64 != size {
            return Err("Truncated archive member".into());
        }
        if path == "rtk" {
            if digest(&b) != r.selection.executable
                || b.get(..4) != Some(b"\x7fELF")
                || b.get(4) != Some(&2)
                || b.get(5) != Some(&1)
                || b.get(18..20) != Some(&[62, 0])
            {
                return Err("Executable hash/platform mismatch".into());
            }
            d.write("rtk", &b)?;
        } else if !r
            .notices
            .iter()
            .any(|n| n.member == path && n.body.as_bytes() == b)
        {
            return Err("Archive notice mismatch".into());
        }
    }
    if seen != r.members {
        return Err("Archive member inventory mismatch".into());
    }
    Ok(())
}
fn allowed_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(
            url.host_str(),
            Some(
                "github.com"
                    | "release-assets.githubusercontent.com"
                    | "objects.githubusercontent.com"
            )
        )
}
pub async fn download(_r: &Release) -> Result<Vec<u8>, String> {
    Err("Legacy private RTK installation is retired. Use Settings → Agents & tools to install the standard tool.".into())
}
pub async fn download_exact(
    url: &str,
    archive_bytes: u64,
    archive_sha256: &str,
) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 3 || !allowed_url(attempt.url()) {
                attempt.error("Release redirect outside allowed HTTPS routes")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "Cannot prepare TLS acquisition")?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Release acquisition failed")?;
    if !response.status().is_success() {
        return Err(format!("Release HTTP {}", response.status().as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|s| s != archive_bytes)
    {
        return Err("Release size differs from catalog".into());
    }
    let mut bytes = Vec::with_capacity(archive_bytes as usize);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Release stream interrupted")?
    {
        if bytes.len() + chunk.len() > archive_bytes as usize {
            return Err("Release exceeds catalog bound".into());
        }
        bytes.extend_from_slice(&chunk)
    }
    if bytes.len() as u64 != archive_bytes || digest(&bytes) != archive_sha256 {
        return Err("Release size/hash mismatch".into());
    }
    Ok(bytes)
}

use crate::{
    Store,
    configuration::{ApplyRequest, ManagementOperation, Plan},
};
use rusqlite::{OptionalExtension, params};
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewRequest {
    pub api: u32,
    pub expected_revision: u64,
    pub version: String,
}
impl Store {
    pub fn plan_helper(&self,r:&ReviewRequest,artifact_store:&str)->Result<Plan,String>{self.plan_helper_for(&self.project,r,artifact_store)}
    pub fn plan_helper_for(&self,project:&str,r:&ReviewRequest,artifact_store:&str)->Result<Plan,String>{
        let c = self.configuration_for(project)?;
        if r.api != deck2_shared::API || c.revision != r.expected_revision || !self.trusted_project(project)? {
            return Err(
                "Refresh configuration and project trust before reviewing a helper change".into(),
            );
        }
        let selected = if r.version == "off" { None } else {
            let version = if r.version == "latest" {
                let catalog: Value = serde_json::from_str(CATALOG).map_err(|_| "Invalid reviewed catalog")?;
                catalog["versions"].as_object().ok_or("Missing reviewed versions")?.keys()
                    .max_by_key(|v| v.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>())
                    .ok_or("No reviewed versions")?.clone()
            } else { r.version.clone() };
            Some(release(&version)?.selection)
        };
        let p = Plan {
            id: uuid::Uuid::new_v4().to_string(),
            qualification: c.qualification(),
            team_enabled: c.team_enabled,
            before: c,
            trusted: true,
            helper: selected,
            artifact_store: Some(artifact_store.into()),
        };
        let count: u32 = self
            .conn
            .query_row("SELECT count(*) FROM configuration_plans WHERE json_extract(body,'$.before.project')=?1", [project], |r| r.get(0))
            .map_err(|_| "Cannot inspect plans")?;
        if count >= 256 {
            return Err("Configuration plan history is full".into());
        }
        self.conn
            .execute(
                "INSERT INTO configuration_plans VALUES(?1,?2)",
                params![p.id, serde_json::to_string(&p).unwrap()],
            )
            .map_err(|_| "Cannot retain helper review")?;
        Ok(p)
    }
    pub fn helper_plan(&self, id: &str) -> Result<Plan, String> {
        let body: String = self
            .conn
            .query_row(
                "SELECT body FROM configuration_plans WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(|_| "Plan unavailable")?;
        serde_json::from_str(&body).map_err(|_| "Invalid plan".into())
    }
    pub fn accept_helper(
        &mut self,
        id: &str,
        r: &ApplyRequest,
        identity: &str,
    ) -> Result<ManagementOperation, String> {
        if r.api != deck2_shared::API
            || !(8..=80).contains(&r.operation_id.len())
            || !r
                .operation_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("Invalid operation identity".into());
        }
        self.conn
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|_| "Cannot begin helper operation")?;
        let result = (|| {
            let prior: Option<String> = self
                .conn
                .query_row(
                    "SELECT body FROM management_operations WHERE id=?1",
                    [&r.operation_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|_| "Cannot read operation")?;
            if let Some(body) = prior {
                let o: ManagementOperation =
                    serde_json::from_str(&body).map_err(|_| "Corrupt operation")?;
                if o.plan != id || o.allow != r.allow {
                    return Err("Conflicting operation identity".into());
                }
                return Ok(o);
            }
            let p = self.helper_plan(id)?;
            validate_selection(p.helper.as_ref().ok_or("Not a helper review")?)?;
            if p.artifact_store.as_deref() != Some(identity)
                || p.before != self.configuration_for(&p.before.project)?
                || !p.trusted
                || !self.trusted_project(&p.before.project)?
            {
                return Err("Helper plan stale or authority/ownership changed".into());
            }
            let o = ManagementOperation {
                id: r.operation_id.clone(),
                plan: id.into(),
                allow: r.allow,
                phase: if r.allow { "accepted" } else { "denied" }.into(),
                revision: p.before.revision,
                owner: Some(self.host_id()?),
                ..Default::default()
            };
            self.conn
                .execute(
                    "INSERT INTO management_operations VALUES(?1,?2,?3)",
                    params![o.id, o.plan, serde_json::to_string(&o).unwrap()],
                )
                .map_err(|_| "Cannot retain helper operation")?;
            Ok(o)
        })();
        if result.is_ok() {
            self.conn
                .execute_batch("COMMIT")
                .map_err(|_| "Cannot commit helper acceptance")?;
        } else {
            let _ = self.conn.execute_batch("ROLLBACK");
        }
        result
    }
    fn save_helper_operation(&self, o: &ManagementOperation) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE management_operations SET body=?1 WHERE id=?2",
                params![serde_json::to_string(o).unwrap(), o.id],
            )
            .map_err(|_| "Cannot persist helper progress")?;
        Ok(())
    }
    pub fn helper_progress(
        &self,
        id: &str,
        phase: &str,
        published: bool,
        detail: &str,
    ) -> Result<ManagementOperation, String> {
        let mut o = self.operation(id)?;
        if terminal(&o.phase) {
            return Ok(o);
        }
        o.phase = phase.into();
        o.published |= published;
        o.detail = detail.into();
        self.save_helper_operation(&o)?;
        Ok(o)
    }
    pub fn cancel_helper(&self, id: &str) -> Result<ManagementOperation, String> {
        let mut o = self.operation(id)?;
        if o.owner.as_deref() != Some(self.host_id()?.as_str()) {
            return Err("Foreign helper operation".into());
        }
        if !terminal(&o.phase) {
            o.cancel_requested = true;
            self.save_helper_operation(&o)?;
        }
        Ok(o)
    }
    // Publication is external; selection + final receipt are one short transaction.
    pub fn activate_helper(
        &mut self,
        id: &str,
        identity: &str,
    ) -> Result<ManagementOperation, String> {
        self.conn
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|_| "Cannot begin activation")?;
        let result = (|| {
            let mut o = self.operation(id)?;
            if terminal(&o.phase) {
                return Ok(o);
            }
            let p = self.helper_plan(&o.plan)?;
            if !o.allow
                || o.owner.as_deref() != Some(self.host_id()?.as_str())
                || p.artifact_store.as_deref() != Some(identity)
            {
                return Err("Foreign activation ownership".into());
            }
            if !o.published {
                return Err("Artifact publication not observed".into());
            }
            let mut c = self.configuration_for(&p.before.project)?;
            o.phase = if o.cancel_requested {
                "cancelled"
            } else if c != p.before || !self.trusted_project(&p.before.project)? {
                "stale"
            } else {
                c.revision=self.next_configuration_revision()?;
                c.helper = p.helper;
                let defs = crate::configuration::compact_definitions();
                for d in &defs {
                    self.conn
                        .execute(
                            "INSERT OR IGNORE INTO definitions VALUES(?1,?2)",
                            params![d.digest, serde_json::to_string(d).unwrap()],
                        )
                        .map_err(|_| "Cannot retain helper definitions")?;
                    if self.definition(&d.digest)? != *d {
                        return Err("Helper definition conflict".into());
                    }
                }
                let ids = c.modes.get_mut("team").ok_or("Team selection missing")?;
                ids.retain(|id| {
                    self.definition(id)
                        .is_ok_and(|d| d.name != "Scoped project tools")
                });
                for d in defs {
                    if !c.definitions.contains(&d.digest) {
                        c.definitions.push(d.digest.clone());
                    }
                    ids.push(d.digest);
                }
                c.definitions
                    .retain(|id| c.modes.values().any(|ids| ids.contains(id)));
                self.save_configuration(&c)?;
                self.select_host_helper(c.helper.clone())?;
                "applied"
            }
            .into();
            o.revision = c.revision;
            o.detail = match o.phase.as_str() {
                "applied" => "Project selection and final receipt committed",
                "cancelled" => "Cancelled before activation; published artifact retained",
                _ => "Activation preconditions changed; published artifact remains unselected",
            }
            .into();
            self.save_helper_operation(&o)?;
            Ok(o)
        })();
        if result.is_ok() {
            if self.conn.execute_batch("COMMIT").is_err() {
                let _ = self.conn.execute_batch("ROLLBACK");
                return Err("Activation commit uncertain; retrieve same operation".into());
            }
        } else {
            let _ = self.conn.execute_batch("ROLLBACK");
        }
        result
    }
}
pub fn terminal(phase: &str) -> bool {
    matches!(
        phase,
        "applied" | "denied" | "cancelled" | "stale" | "failed"
    )
}

pub async fn run_operation(app: crate::server::App, id: String) {
    let result = worker(&app, &id, |r| async move { download(&r).await }).await;
    if let Err(e) = result {
        // Preserve uncertainty: an unreadable artifact or failed receipt is not rollback.
        if app
            .store
            .lock()
            .unwrap()
            .helper_progress(&id, "recovery_required", false, &e)
            .is_err()
        {
            app.storage_failed();
        }
    }
}
async fn worker<F: std::future::Future<Output = Result<Vec<u8>, String>>>(
    app: &crate::server::App,
    id: &str,
    acquire: impl FnOnce(Release) -> F,
) -> Result<(), String> {
    let root = app.artifact_root()?;
    let (p, o, host) = {
        let s = app.store.lock().unwrap();
        let o = s.operation(id)?;
        (s.helper_plan(&o.plan)?, o, s.host_id()?)
    };
    if terminal(&o.phase) {
        return Ok(());
    }
    if o.owner.as_deref() != Some(host.as_str()) {
        return Err("Foreign operation store".into());
    }
    let artifacts = tokio::task::spawn_blocking(move || Artifacts::open(&root))
        .await
        .map_err(|_| "Artifact inspection interrupted")??;
    if p.artifact_store.as_deref() != Some(&artifacts.identity) {
        return Err("Artifact store identity changed".into());
    }
    let lock = match artifacts.lock_operation(&host, id) {
        Ok(l) => l,
        Err(_) => return Ok(()),
    };
    let r = validate_selection(p.helper.as_ref().ok_or("Missing helper selection")?)?;
    let cancelled = || {
        app.store
            .lock()
            .unwrap()
            .operation(id)
            .map(|o| o.cancel_requested || terminal(&o.phase))
    };
    if cancelled()? {
        app.store.lock().unwrap().helper_progress(
            id,
            "cancelled",
            o.published,
            "Cancelled before activation",
        )?;
        return Ok(());
    }
    // A destination that exists but fails validation is never repaired/replaced.
    let exists = artifacts
        .root
        .existing_dir("artifacts")?
        .path()
        .join(&r.selection.executable)
        .symlink_metadata()
        .is_ok();
    if !exists {
        app.store.lock().unwrap().helper_progress(
            id,
            "downloading",
            false,
            "Downloading reviewed HTTPS artifact",
        )?;
        let download = acquire(r.clone());
        tokio::pin!(download);
        let bytes = loop {
            tokio::select! {v=&mut download=>break v?,_=tokio::time::sleep(std::time::Duration::from_millis(40))=>{if cancelled()?{app.store.lock().unwrap().helper_progress(id,"cancelled",false,"Download cancelled; selection unchanged")?;return Ok(())}}}
        };
        app.store.lock().unwrap().helper_progress(
            id,
            "validating",
            false,
            "Validating bounded archive and notices",
        )?;
        let rr = r.clone();
        let a = artifacts;
        let (a, result) = tokio::task::spawn_blocking(move || {
            let result = a.publish(&rr, &bytes);
            (a, result)
        })
        .await
        .map_err(|_| "Publication interrupted; inspect same operation")?;
        result?;
        activate_published(app, id, &host, &p, a).await?;
    } else {
        activate_published(app, id, &host, &p, artifacts).await?;
    }
    drop(lock);
    Ok(())
}
async fn activate_published(
    app: &crate::server::App,
    id: &str,
    host: &str,
    p: &Plan,
    a: Artifacts,
) -> Result<(), String> {
    let s = p.helper.clone().ok_or("Missing selected helper")?;
    let a = tokio::task::spawn_blocking(move || {
        a.pin(&s)?;
        Ok::<_, String>(a)
    })
    .await
    .map_err(|_| "Published verification interrupted")??;
    a.observation(host,id,&json!({"owner":host,"operation":id,"plan":p.id,"plan_digest":digest(&serde_json::to_vec(p).unwrap()),"phase":"published_not_selected","artifact":p.helper}))?;
    app.store.lock().unwrap().helper_progress(
        id,
        "published_not_selected",
        true,
        "Verified artifact retained; activation pending",
    )?;
    let receipt = app.store.lock().unwrap().activate_helper(id, &a.identity)?;
    a.observation(
        host,
        id,
        &json!({"owner":host,"operation":id,"receipt":receipt}),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture_archive(entries: &[(&str, &[u8], tar::EntryType)]) -> Vec<u8> {
        let enc = flate2::write::GzEncoder::new(vec![], flate2::Compression::default());
        let mut t = tar::Builder::new(enc);
        for (path, bytes, kind) in entries {
            let mut h = tar::Header::new_gnu();
            h.set_size(bytes.len() as u64);
            h.set_mode(0o700);
            h.set_entry_type(*kind);
            h.set_cksum();
            t.append_data(&mut h, path, *bytes).unwrap();
        }
        t.into_inner().unwrap().finish().unwrap()
    }
    // Protects exact inventory and bounded extraction; oracle: reviewed catalog,
    // links/duplicates/unexpected members must never become executable files.
    #[test]
    fn extraction_rejects_wrong_identity_links_duplicates_and_unexpected_members() {
        let root = tempfile::tempdir().unwrap();
        let a = Artifacts::open(&root.path().join("owned")).unwrap();
        let r = release("0.50.0").unwrap();
        assert!(extract(&r, b"corrupt", &a.stage().unwrap()).is_err());
        for entries in [
            vec![("rtk", b"payload".as_slice(), tar::EntryType::Symlink)],
            vec![
                ("rtk", b"payload".as_slice(), tar::EntryType::Regular),
                ("rtk", b"payload".as_slice(), tar::EntryType::Regular),
            ],
            vec![("outside", b"payload".as_slice(), tar::EntryType::Regular)],
        ] {
            let archive = fixture_archive(&entries);
            let mut fake = r.clone();
            fake.archive_bytes = archive.len() as u64;
            fake.archive_sha256 = digest(&archive);
            fake.members = BTreeMap::from([("rtk".into(), 7)]);
            fake.selection.executable = digest(b"payload");
            assert!(extract(&fake, &archive, &a.stage().unwrap()).is_err());
        }
    }
    // OS locks keep stable inode identity; no lock-file deletion or adoption.
    #[test]
    fn stable_locks_and_foreign_or_symlink_destinations_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let owned = dir.path().join("owned");
        let a = Artifacts::open(&owned).unwrap();
        let other = Artifacts::open(&owned).unwrap();
        assert_eq!(a.identity, other.identity);
        let lock = a.lock_operation("host", "op").unwrap();
        assert!(other.lock_operation("host", "op").is_err());
        drop(lock);
        assert!(other.lock_operation("host", "op").is_ok());
        let release = release("0.50.0").unwrap();
        let destination = owned.join("artifacts").join(&release.selection.executable);
        std::os::unix::fs::symlink("/tmp", &destination).unwrap();
        assert!(a.pin(&release.selection).is_err());
        assert!(a.publish(&release, b"unchecked").is_err());
        assert!(destination.is_symlink());
        let link = dir.path().join("link");
        std::os::unix::fs::symlink("/tmp", &link).unwrap();
        assert!(Directory::open_root(&link).is_err());
    }
    fn accepted() -> (Store, String, String) {
        let mut s = Store::open_memory("/fixture").unwrap();
        s.set_trust("/fixture", true).unwrap();
        let c = s.configuration().unwrap();
        let p = s
            .plan_helper(
                &ReviewRequest {
                    api: deck2_shared::API,
                    expected_revision: c.revision,
                    version: "0.50.0".into(),
                },
                "owned-root",
            )
            .unwrap();
        let id = "helper-operation-01".to_string();
        s.accept_helper(
            &p.id,
            &ApplyRequest {
                api: deck2_shared::API,
                operation_id: id.clone(),
                allow: true,
            },
            "owned-root",
        )
        .unwrap();
        (s, p.id, id)
    }
    // Protects atomic activation+receipt and retained old admissions (S5B-RECOVERY).
    #[test]
    fn activation_requires_publication_authority_and_atomic_receipt() {
        let (mut s, plan, id) = accepted();
        let original = s.configuration().unwrap();
        assert!(s.activate_helper(&id, "owned-root").is_err());
        s.helper_progress(&id, "published_not_selected", true, "verified")
            .unwrap();
        assert!(s.activate_helper(&id, "foreign-root").is_err());
        assert_eq!(s.configuration().unwrap(), original);
        s.conn.execute_batch("CREATE TRIGGER fail_activation BEFORE UPDATE ON management_operations BEGIN SELECT RAISE(ABORT,'fault'); END;").unwrap();
        assert!(s.activate_helper(&id, "owned-root").is_err());
        assert_eq!(s.configuration().unwrap(), original);
        s.conn
            .execute_batch("DROP TRIGGER fail_activation")
            .unwrap();
        let receipt = s.activate_helper(&id, "owned-root").unwrap();
        assert_eq!(receipt.phase, "applied");
        assert_eq!(
            s.configuration().unwrap().helper,
            Some(release("0.50.0").unwrap().selection)
        );
        assert_eq!(s.cancel_helper(&id).unwrap().phase, "applied");
        assert_eq!(s.activate_helper(&id, "owned-root").unwrap(), receipt);
        assert!(
            s.accept_helper(
                &plan,
                &ApplyRequest {
                    api: deck2_shared::API,
                    operation_id: id,
                    allow: false
                },
                "owned-root"
            )
            .is_err()
        );
    }
    #[test]
    fn cancelled_stale_and_revoked_activation_preserve_prior_selection() {
        for fault in ["cancel", "stale", "revoke"] {
            let (mut s, _, id) = accepted();
            let old = s.configuration().unwrap().helper;
            s.helper_progress(&id, "published_not_selected", true, "verified")
                .unwrap();
            match fault {
                "cancel" => {
                    s.cancel_helper(&id).unwrap();
                }
                "stale" => {
                    s.register_codex("new-native".into()).unwrap();
                }
                _ => {
                    s.set_trust("/fixture", false).unwrap();
                }
            }
            let receipt = s.activate_helper(&id, "owned-root").unwrap();
            assert_eq!(
                receipt.phase,
                if fault == "cancel" {
                    "cancelled"
                } else {
                    "stale"
                }
            );
            assert!(receipt.published);
            assert_eq!(s.configuration().unwrap().helper, old);
        }
    }
    // A recognized asynchronous phase is valid persisted state, never corruption.
    // The process may resume only on an exact reviewed operation retry.
    #[test]
    fn pending_helper_operations_reopen_without_replay() {
        for phase in [
            "accepted",
            "downloading",
            "validating",
            "published_not_selected",
            "recovery_required",
            "cancelled",
        ] {
            let dir = tempfile::tempdir().unwrap();
            let db = dir.path().join("state.db");
            let mut s = Store::open(&db, "/fixture").unwrap();
            s.set_trust("/fixture", true).unwrap();
            let c = s.configuration().unwrap();
            let p = s
                .plan_helper(
                    &ReviewRequest {
                        api: deck2_shared::API,
                        version: "0.50.0".into(),
                        expected_revision: c.revision,
                    },
                    "owned-root",
                )
                .unwrap();
            let id = "restart-operation";
            s.accept_helper(
                &p.id,
                &ApplyRequest {
                    api: deck2_shared::API,
                    operation_id: id.into(),
                    allow: true,
                },
                "owned-root",
            )
            .unwrap();
            s.helper_progress(
                id,
                phase,
                matches!(
                    phase,
                    "published_not_selected" | "recovery_required" | "cancelled"
                ),
                "fixture phase",
            )
            .unwrap();
            drop(s);
            let reopened = Store::open(&db, "/fixture").unwrap();
            assert_eq!(reopened.operation(id).unwrap().phase, phase);
            assert_eq!(reopened.configuration().unwrap().helper, None);
        }
    }
    #[test]
    fn redirect_escape_and_unknown_catalog_selection_are_rejected() {
        for url in [
            "http://github.com/path",
            "https://evil.example/path",
            "https://github.com:444/path",
            "https://user@github.com/path",
        ] {
            assert!(!allowed_url(&url.parse().unwrap()));
        }
        assert!(release("latest").is_err());
        let mut s = release("1.2.0").unwrap().selection;
        s.executable = "other".into();
        assert!(validate_selection(&s).is_err());
    }
}

#[cfg(test)]
mod live_evidence {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    async fn call(router: &axum::Router, cookie: &str, path: &str, body: Value) -> Value {
        let r = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("host", "127.0.0.1:1234")
                    .header("origin", "http://127.0.0.1:1234")
                    .header("cookie", cookie)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = r.status();
        let b = axum::body::to_bytes(r.into_body(), 1000000).await.unwrap();
        assert!(
            status.is_success(),
            "{} {}",
            status,
            String::from_utf8_lossy(&b)
        );
        serde_json::from_slice(&b).unwrap()
    }
    // Real native dispatch, only acquisition edge is held pending. The default
    // router, worker, Store mutex and native adapter execute unchanged.
    #[tokio::test]
    #[ignore = "Explicit paid native qualification; set DECK2_LIVE_CODEX and DECK2_LIVE_OUT"]
    async fn ordinary_admission_and_native_dispatch_do_not_wait_for_download() {
        let binary = PathBuf::from(std::env::var("DECK2_LIVE_CODEX").unwrap());
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let store = Store::open_memory(project.to_str().unwrap()).unwrap();
        let session = store.session.clone();
        let app = crate::server::App::new(
            store,
            "127.0.0.1:1234".into(),
            binary,
            None,
            "admin".into(),
            "recovery".into(),
        );
        *app.artifact_store.lock().unwrap() = Some(tmp.path().join("artifacts"));
        let router = crate::server::router(app.clone());
        let token = app.issue_launch();
        let auth = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/auth")
                    .header("host", "127.0.0.1:1234")
                    .header("origin", "http://127.0.0.1:1234")
                    .body(Body::from(token))
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
        let mut records = vec![];
        let mut pending = None;
        for stalled in [false, true] {
            if stalled {
                let a = Artifacts::open(&app.artifact_root().unwrap()).unwrap();
                let id = "stalled-download-operation";
                {
                    let mut s = app.store.lock().unwrap();
                    s.set_trust(project.to_str().unwrap(), true).unwrap();
                    let c = s.configuration().unwrap();
                    let p = s
                        .plan_helper(
                            &ReviewRequest {
                                api: deck2_shared::API,
                                version: "0.50.0".into(),
                                expected_revision: c.revision,
                            },
                            &a.identity,
                        )
                        .unwrap();
                    s.accept_helper(
                        &p.id,
                        &ApplyRequest {
                            api: deck2_shared::API,
                            operation_id: id.into(),
                            allow: true,
                        },
                        &a.identity,
                    )
                    .unwrap();
                }
                let (started, waiting) = tokio::sync::oneshot::channel();
                let a = app.clone();
                pending = Some(tokio::spawn(async move {
                    worker(&a, id, |_| async move {
                        let _ = started.send(());
                        std::future::pending::<Result<Vec<u8>, String>>().await
                    })
                    .await
                }));
                waiting.await.unwrap();
            }
            let id = uuid::Uuid::new_v4().to_string();
            let start = std::time::Instant::now();
            let response=call(&router,&cookie,"/api/commands",json!({"api":deck2_shared::API,"id":id,"session":session,"prompt":"Reply with the single word ready. Do not invoke tools.","fresh":true,"queue":false,"mode":"read_only"})).await;
            let admission_ms = start.elapsed().as_millis();
            assert_eq!(response["phase"], "accepted");
            let row = tokio::time::timeout(std::time::Duration::from_secs(120), async {
                loop {
                    let r = app.receipt(&id).unwrap();
                    if !r.phase.active() {
                        break r;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(30)).await;
                }
            })
            .await
            .unwrap();
            assert_eq!(row.phase, deck2_shared::Phase::Completed, "{}", row.detail);
            assert!(row.dispatch_ms.is_some());
            records.push(json!({"stalled_acquisition":stalled,"admission_ms":admission_ms,"total_ms":start.elapsed().as_millis(),"receipt":row}));
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        app.store
            .lock()
            .unwrap()
            .cancel_helper("stalled-download-operation")
            .unwrap();
        pending.unwrap().await.unwrap().unwrap();
        assert_eq!(
            app.store
                .lock()
                .unwrap()
                .operation("stalled-download-operation")
                .unwrap()
                .phase,
            "cancelled"
        );
        std::fs::write(std::env::var("DECK2_LIVE_OUT").unwrap(),serde_json::to_vec_pretty(&json!({"scope":"real Codex/default router+Store; only HTTPS acquisition held pending at external edge","records":records})).unwrap()).unwrap();
    }
}
