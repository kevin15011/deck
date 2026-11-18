//! Fixed CBM releases. Verification is explicit; warm use only checks held identity.
use crate::{managed_tools::Directory, tasks::digest};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Write},
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::Path,
};
const CATALOG: &str = include_str!("../resources/cbm/catalog.json");
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Release {
    pub version: String,
    pub executable: String,
    pub executable_bytes: u64,
    pub archive_sha256: String,
    pub archive_bytes: u64,
    pub url: String,
    pub verified_at: String,
    pub catalog: String,
    pub members: BTreeMap<String, u64>,
    pub notices: BTreeMap<String, String>,
}
pub fn release(version: &str) -> Result<Release, String> {
    let c: serde_json::Value = serde_json::from_str(CATALOG).map_err(|_| "Invalid CBM catalog")?;
    let v = &c[version];
    if v.is_null() {
        return Err("CBM version outside qualified catalog".into());
    }
    let notices = match version {
        "0.12.0" => [
            include_str!("../resources/cbm/0.12.0/notice-1-LICENSE"),
            include_str!("../resources/cbm/0.12.0/notice-2-THIRD_PARTY_NOTICES.md"),
        ],
        "0.12.1" => [
            include_str!("../resources/cbm/0.12.1/notice-1-LICENSE"),
            include_str!("../resources/cbm/0.12.1/notice-2-THIRD_PARTY_NOTICES.md"),
        ],
        _ => return Err("Unknown CBM version".into()),
    };
    let mut bodies = BTreeMap::new();
    for (i, body) in notices.into_iter().enumerate() {
        let n = &v["extracted"][i + 1];
        if n["size"].as_u64() != Some(body.len() as u64) || n["sha256"] != digest(body.as_bytes()) {
            return Err("CBM embedded notice mismatch".into());
        }
        bodies.insert(
            n["member"].as_str().ok_or("Missing notice member")?.into(),
            body.into(),
        );
    }
    Ok(Release {
        version: version.into(),
        executable: v["extracted"][0]["sha256"]
            .as_str()
            .ok_or("Missing executable")?
            .into(),
        executable_bytes: v["extracted"][0]["size"].as_u64().ok_or("Missing size")?,
        archive_sha256: v["archive_sha256"]
            .as_str()
            .ok_or("Missing archive")?
            .into(),
        archive_bytes: v["archive_size"].as_u64().ok_or("Missing archive size")?,
        url: v["url"].as_str().ok_or("Missing URL")?.into(),
        verified_at: v["verified_at"]
            .as_str()
            .ok_or("Missing verification timestamp")?
            .into(),
        catalog: digest(CATALOG.as_bytes()),
        members: v["members"]
            .as_array()
            .ok_or("Missing inventory")?
            .iter()
            .map(|m| {
                Ok((
                    m["name"].as_str().ok_or("Missing member")?.into(),
                    m["size"].as_u64().ok_or("Missing member size")?,
                ))
            })
            .collect::<Result<_, String>>()?,
        notices: bodies,
    })
}
fn io(e: std::io::Error) -> String {
    format!("CBM artifact IO: {e}")
}
fn hash(mut f: impl Read) -> Result<String, String> {
    let mut h = Sha256::new();
    let mut b = [0; 65536];
    loop {
        let n = f.read(&mut b).map_err(io)?;
        if n == 0 {
            break;
        }
        h.update(&b[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
type FileIdentity = (u64, u64, u64, i64, i64, i64, i64);
pub struct Verified {
    pub file: File,
    pub release: Release,
    identity: FileIdentity,
}
fn identity(f: &File) -> Result<FileIdentity, String> {
    let m = f.metadata().map_err(io)?;
    if !m.is_file()
        || m.nlink() != 1
        || m.uid() != unsafe { libc::geteuid() }
        || m.mode() & 0o277 != 0
        || m.mode() & 0o100 == 0
    {
        return Err("CBM executable ownership/mode changed; prepare again".into());
    }
    Ok((
        m.dev(),
        m.ino(),
        m.len(),
        m.mtime(),
        m.mtime_nsec(),
        m.ctime(),
        m.ctime_nsec(),
    ))
}
impl Verified {
    pub fn check(&self) -> Result<(), String> {
        if identity(&self.file)? != self.identity {
            Err("CBM executable changed; explicit preparation required".into())
        } else {
            Ok(())
        }
    }
}
pub struct Artifacts {
    pub root: Directory,
}
impl Artifacts {
    pub fn open(path: &Path) -> Result<Self, String> {
        let root = Directory::open_root(path)?;
        root.directory("cbm-artifacts", true)?;
        root.directory("cbm-locks", true)?;
        Ok(Self { root })
    }
    pub fn verify(&self, r: &Release) -> Result<Verified, String> {
        if release(&r.version)? != *r {
            return Err("CBM catalog mismatch".into());
        }
        let d = self
            .root
            .existing_dir("cbm-artifacts")?
            .existing_dir(&r.executable)?;
        if d.0.metadata().map_err(io)?.mode() & 0o222 != 0 {
            return Err("Mutable CBM publication".into());
        }
        let manifest: Release = serde_json::from_slice(&d.bytes("manifest.json", 1500000)?)
            .map_err(|_| "Invalid CBM manifest")?;
        if manifest != *r {
            return Err("Foreign CBM publication".into());
        }
        for (name, body) in &r.notices {
            if d.bytes(name, body.len() as u64)? != body.as_bytes() {
                return Err("CBM notice mismatch".into());
            }
        }
        let file = d.file("codebase-memory-mcp", false)?;
        let id = identity(&file)?;
        if id.2 != r.executable_bytes || hash(file.try_clone().map_err(io)?)? != r.executable {
            return Err("CBM executable identity mismatch".into());
        }
        Ok(Verified {
            file,
            release: r.clone(),
            identity: id,
        })
    }
    pub fn publish(&self, r: &Release, archive: &[u8]) -> Result<(), String> {
        if release(&r.version)? != *r {
            return Err("CBM catalog mismatch".into());
        }
        let _lock = self.root.existing_dir("cbm-locks")?.lock(&r.executable)?;
        let parent = self.root.existing_dir("cbm-artifacts")?;
        if parent.path().join(&r.executable).symlink_metadata().is_ok() {
            return self.verify(r).map(|_| ());
        }
        if archive.len() as u64 != r.archive_bytes || digest(archive) != r.archive_sha256 {
            return Err("CBM archive identity mismatch".into());
        }
        let id = format!(".stage-{}", uuid::Uuid::new_v4());
        let d = parent.directory(&id, true)?;
        let mut seen = BTreeMap::new();
        let mut tar = tar::Archive::new(
            flate2::read::GzDecoder::new(archive).take(r.members.values().sum::<u64>() + 65536),
        );
        for e in tar.entries().map_err(io)? {
            let mut e = e.map_err(io)?;
            let name = std::str::from_utf8(&e.path_bytes())
                .map_err(|_| "Invalid CBM member")?
                .to_string();
            let size = e.size();
            if !e.header().entry_type().is_file()
                || r.members.get(&name) != Some(&size)
                || seen.insert(name.clone(), size).is_some()
            {
                return Err("Unsafe CBM inventory".into());
            }
            if name == "codebase-memory-mcp" {
                let mut f = d.file(&name, true)?;
                let mut h = Sha256::new();
                let mut b = [0; 65536];
                let mut total = 0;
                loop {
                    let n = e.read(&mut b).map_err(io)?;
                    if n == 0 {
                        break;
                    }
                    total += n as u64;
                    h.update(&b[..n]);
                    f.write_all(&b[..n]).map_err(io)?;
                }
                if total != r.executable_bytes || format!("{:x}", h.finalize()) != r.executable {
                    return Err("CBM executable hash mismatch".into());
                }
                f.set_permissions(std::fs::Permissions::from_mode(0o500))
                    .map_err(io)?;
                f.sync_all().map_err(io)?;
            } else {
                let mut b = vec![];
                e.take(size + 1).read_to_end(&mut b).map_err(io)?;
                if b.len() as u64 != size {
                    return Err("Truncated CBM member".into());
                }
                if name == "install.sh" {
                    continue;
                }
                if r.notices.get(&name).is_none_or(|s| s.as_bytes() != b) {
                    return Err("CBM archive notice mismatch".into());
                }
                d.write(&name, &b)?;
            }
        }
        if seen != r.members {
            return Err("Incomplete CBM inventory".into());
        }
        d.write(
            "manifest.json",
            &serde_json::to_vec(r).map_err(|_| "Cannot encode CBM manifest")?,
        )?;
        for name in r
            .notices
            .keys()
            .map(String::as_str)
            .chain(["manifest.json"])
        {
            let f = d.file(name, false)?;
            f.set_permissions(std::fs::Permissions::from_mode(0o400))
                .map_err(io)?;
            f.sync_all().map_err(io)?;
        }
        d.0.sync_all().map_err(io)?;
        d.0.set_permissions(std::fs::Permissions::from_mode(0o500))
            .map_err(io)?;
        // Publication lock serializes owned writers; NOREPLACE also preserves foreign entries.
        use std::os::fd::AsRawFd;
        let from = std::ffi::CString::new(id).unwrap();
        let to = std::ffi::CString::new(r.executable.clone()).unwrap();
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
            return Err(io(std::io::Error::last_os_error()));
        }
        parent.0.sync_all().map_err(io)?;
        self.verify(r).map(|_| ())
    }
}
