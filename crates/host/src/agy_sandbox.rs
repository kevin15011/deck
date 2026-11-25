//! Filesystem namespace for delegated Antigravity processes.
use std::{
    ffi::{CStr, CString},
    fs::{self, File, OpenOptions},
    io,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::{
            ffi::OsStrExt,
            fs::{MetadataExt, OpenOptionsExt, symlink},
        },
    },
    path::Path,
    ptr,
};

use serde_json::Value;
use tokio::process::Command;

use crate::managed_tools::Directory;

const HOME: &str = "/deck-member";
pub(super) const SCRATCH: &str = "/deck-scratch";
const AUTH_FILE: &str = "antigravity-oauth-token";
const PROFILE: &str = "/deck-member/.gemini/antigravity-cli";

pub(super) struct Sandbox {
    _root: tempfile::TempDir,
    _scratch: tempfile::TempDir,
    _lock: File,
    _profile: Directory,
    _auth: Option<File>,
    launch: Launch,
}

pub(super) fn parse_identity(text: Option<&str>) -> Result<(u64, u64), String> {
    let text = text.ok_or("Project identity unavailable")?;
    let (dev, ino) = text.split_once(':').ok_or("Project identity unavailable")?;
    let dev = dev
        .parse::<u64>()
        .map_err(|_| "Project identity unavailable")?;
    let ino = ino
        .parse::<u64>()
        .map_err(|_| "Project identity unavailable")?;
    Ok((dev, ino))
}

impl Sandbox {
    pub(super) fn state_root(app: &crate::server::App) -> Result<Directory, String> {
        Directory::open_root(&app.artifact_root()?)?.directory("agy-members", true)
    }

    pub(super) fn prepare(
        owners: &Directory,
        owner: &str,
        shared_profile: &Path,
        binary: &Path,
        cwd: &Path,
        project: Option<(&Path, (u64, u64), bool)>,
        external: &Value,
    ) -> Result<Self, String> {
        let owner = owners.directory(owner, true)?;
        let lock = owner.lock("execution.lock")?;
        let profile = owner.directory("profile", true)?;
        let auth_path = shared_profile.join(AUTH_FILE);
        let auth = match OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&auth_path)
        {
            Ok(auth) => {
                let metadata = auth.metadata().map_err(layout_error)?;
                if !metadata.is_file()
                    || metadata.uid() != unsafe { libc::geteuid() }
                    || metadata.mode() & 0o077 != 0
                    || metadata.nlink() != 1
                {
                    return Err("Unsafe Antigravity account file".into());
                }
                // Make a checked mount point in the task-owned profile. It
                // contains no credential when observed outside the namespace.
                match profile.file(AUTH_FILE, false) {
                    Ok(_) => {}
                    Err(_) => {
                        profile.file(AUTH_FILE, true)?;
                    }
                }
                Some(auth)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(_) => return Err("Cannot inspect Antigravity account material".into()),
        };

        let root = tempfile::Builder::new()
            .prefix("deck2-agy-root-")
            .tempdir_in("/tmp")
            .map_err(|_| "Cannot prepare Antigravity filesystem namespace")?;
        let scratch = tempfile::Builder::new()
            .prefix("deck2-agy-tmp-")
            .tempdir_in("/tmp")
            .map_err(|_| "Cannot prepare Antigravity member scratch")?;
        let mut mounts = Layout {
            root: root.path(),
            mounts: Vec::new(),
        };
        // A non-recursive bind of all /usr/lib fails on Linux hosts that
        // have locked submounts there (including WSL's host integration).
        for path in [
            "/usr/bin",
            "/usr/lib/x86_64-linux-gnu",
            "/usr/lib/aarch64-linux-gnu",
            "/usr/lib/git-core",
            "/usr/lib/locale",
            "/lib64",
        ] {
            if Path::new(path).is_dir() {
                mounts.same(path, true)?;
            }
        }
        for entry in fs::read_dir("/usr/lib").map_err(layout_error)? {
            let entry = entry.map_err(layout_error)?;
            if entry.file_name().as_bytes().starts_with(b"python3")
                && entry.file_type().map_err(layout_error)?.is_dir()
            {
                mounts.add(&entry.path(), &entry.path(), true, false)?;
            }
        }
        for (target, source) in [("bin", "usr/bin"), ("lib", "usr/lib")] {
            symlink(source, root.path().join(target)).map_err(layout_error)?;
        }
        for path in [
            "/etc/hosts",
            "/etc/nsswitch.conf",
            "/etc/resolv.conf",
            "/etc/ssl/certs/ca-certificates.crt",
        ] {
            if Path::new(path).is_file() {
                mounts.same(path, true)?;
            }
        }
        for device in ["/dev/null", "/dev/random", "/dev/urandom"] {
            mounts.add(Path::new(device), Path::new(device), false, true)?;
        }
        if !binary.starts_with("/usr/bin") {
            mounts.add(binary, binary, true, false)?;
        }
        for (label, spec) in external.as_object().into_iter().flatten() {
            if spec["enabled"] != true {
                continue;
            }
            let command = Path::new(spec["command"].as_str().ok_or("Missing MCP executable")?);
            let resolved = command.canonicalize().map_err(layout_error)?;
            if label == "deck-context7"
                && let Some(package) = resolved.parent().and_then(Path::parent)
                && package
                    .file_name()
                    .is_some_and(|name| name == "context7-mcp")
            {
                mounts.add(package, package, true, false)?;
                let alias = root.path().join(relative(command)?);
                fs::create_dir_all(alias.parent().ok_or("Invalid Context7 executable")?)
                    .map_err(layout_error)?;
                symlink(resolved, alias).map_err(layout_error)?;
                let node = crate::runner_management::path_tool("node")?;
                mounts.add(&node, Path::new("/deck-bin/node"), true, false)?;
            } else {
                mounts.add(&resolved, command, true, false)?;
            }
        }

        let state_path = profile.path().canonicalize().map_err(layout_error)?;
        if let Some((project, project_identity, readonly)) = project {
            let meta = fs::symlink_metadata(project).map_err(layout_error)?;
            if !meta.is_dir() || (meta.dev(), meta.ino()) != project_identity {
                return Err("Recorded project root was replaced before sandbox mount".into());
            }
            let overlaps =
                |left: &Path, right: &Path| left.starts_with(right) || right.starts_with(left);
            if [
                shared_profile,
                &state_path,
                root.path(),
                scratch.path(),
                Path::new("/deck-bin"),
                Path::new(HOME),
                Path::new(SCRATCH),
            ]
            .into_iter()
            .any(|path| overlaps(project, path))
            {
                return Err("Antigravity member scope overlaps private runtime state".into());
            }
            mounts.add_pinned_dir(project, project, readonly, project_identity)?;
        }
        mounts.add(&state_path, Path::new(PROFILE), false, false)?;
        mounts.mounts.last_mut().unwrap().pin(&profile.0)?;
        mounts.add(scratch.path(), Path::new(SCRATCH), false, false)?;
        if let Some(auth) = &auth {
            // The checked destination becomes visible after the profile mount.
            let mut mount = Mount {
                source: path_arg(&auth_path)?,
                target: path_arg(
                    &root
                        .path()
                        .join(relative(Path::new(PROFILE))?)
                        .join(AUTH_FILE),
                )?,
                readonly: true,
                device: false,
                identity: None,
            };
            mount.pin(auth)?;
            mounts.mounts.push(mount);
        }

        let uid = unsafe { libc::geteuid() };
        let gid = unsafe { libc::getegid() };
        fs::write(
            root.path().join("etc/passwd"),
            format!("deck:x:{uid}:{gid}:Deck member:{HOME}:/bin/sh\n"),
        )
        .map_err(layout_error)?;
        fs::write(root.path().join("etc/group"), format!("deck:x:{gid}:\n"))
            .map_err(layout_error)?;
        let launch = Launch {
            root: path_arg(root.path())?,
            cwd: path_arg(cwd)?,
            mounts: mounts.mounts,
            uid_map: format!("{uid} {uid} 1\n"),
            gid_map: format!("{gid} {gid} 1\n"),
        };
        Ok(Self {
            _root: root,
            _scratch: scratch,
            _profile: profile,
            _auth: auth,
            _lock: lock,
            launch,
        })
    }

    pub(super) fn apply(&self, command: &mut Command) {
        command.env_clear().envs([
            ("HOME", HOME),
            ("PATH", "/deck-bin:/usr/bin:/bin"),
            ("TMPDIR", SCRATCH),
            ("XDG_CACHE_HOME", "/deck-scratch/cache"),
            ("XDG_CONFIG_HOME", "/deck-scratch/config"),
            ("XDG_DATA_HOME", "/deck-scratch/data"),
            ("XDG_RUNTIME_DIR", SCRATCH),
            ("LANG", "C.UTF-8"),
        ]);
        for name in ["GEMINI_API_KEY", "GOOGLE_API_KEY"] {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }

        let launch = self.launch.clone();
        unsafe {
            // All paths, mount points and ID maps are prepared before fork.
            command.pre_exec(move || launch.enter());
        }
    }
}

fn layout_error(error: io::Error) -> String {
    format!("Cannot prepare Antigravity member filesystem: {error}")
}

fn relative(path: &Path) -> Result<&Path, String> {
    let relative = path
        .strip_prefix("/")
        .map_err(|_| "Expected absolute sandbox path")?;
    if relative.as_os_str().is_empty()
        || !relative
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_)))
    {
        return Err("Invalid Antigravity sandbox path".into());
    }
    Ok(relative)
}

fn path_arg(path: &Path) -> Result<CString, String> {
    CString::new(path.as_os_str().as_encoded_bytes()).map_err(|_| "Invalid sandbox path".into())
}

struct Layout<'a> {
    root: &'a Path,
    mounts: Vec<Mount>,
}

impl Layout<'_> {
    fn same(&mut self, path: &str, readonly: bool) -> Result<(), String> {
        self.add(Path::new(path), Path::new(path), readonly, false)
    }

    fn add(
        &mut self,
        source: &Path,
        target: &Path,
        readonly: bool,
        device: bool,
    ) -> Result<(), String> {
        let target = self.root.join(relative(target)?);
        if self.mounts.iter().any(|mount| {
            let existing = Path::new(std::ffi::OsStr::from_bytes(mount.target.as_bytes()));
            target.starts_with(existing) || existing.starts_with(&target)
        }) {
            return Err("Antigravity member mounts overlap".into());
        }
        if source.metadata().map_err(layout_error)?.is_dir() {
            fs::create_dir_all(&target).map_err(layout_error)?;
        } else {
            fs::create_dir_all(target.parent().ok_or("Invalid sandbox target")?)
                .map_err(layout_error)?;
            File::create_new(&target).map_err(layout_error)?;
        }
        self.mounts.push(Mount {
            source: path_arg(&source.canonicalize().map_err(layout_error)?)?,
            target: path_arg(&target)?,
            readonly,
            device,
            identity: None,
        });
        Ok(())
    }

    fn add_pinned_dir(
        &mut self,
        source: &Path,
        target: &Path,
        readonly: bool,
        identity: (u64, u64),
    ) -> Result<(), String> {
        let target = self.root.join(relative(target)?);
        if self.mounts.iter().any(|mount| {
            let existing = Path::new(std::ffi::OsStr::from_bytes(mount.target.as_bytes()));
            target.starts_with(existing) || existing.starts_with(&target)
        }) {
            return Err("Antigravity member mounts overlap".into());
        }
        fs::create_dir_all(&target).map_err(layout_error)?;
        self.mounts.push(Mount {
            source: path_arg(source)?,
            target: path_arg(&target)?,
            readonly,
            device: false,
            identity: Some(identity),
        });
        Ok(())
    }
}

#[derive(Clone)]
struct Mount {
    source: CString,
    target: CString,
    readonly: bool,
    device: bool,
    identity: Option<(u64, u64)>,
}

impl Mount {
    fn pin(&mut self, file: &File) -> Result<(), String> {
        let metadata = file.metadata().map_err(layout_error)?;
        self.identity = Some((metadata.dev(), metadata.ino()));
        Ok(())
    }

    fn install(&self) -> io::Result<()> {
        // Descriptor paths opened before unshare refer to the old mount
        // namespace. Clone in this namespace and verify pinned identities
        // before exposing the private state or account file.
        if let Some(identity) = self.identity {
            let fd = unsafe {
                libc::syscall(
                    libc::SYS_open_tree,
                    libc::AT_FDCWD,
                    self.source.as_ptr(),
                    libc::OPEN_TREE_CLONE
                        | libc::OPEN_TREE_CLOEXEC
                        | libc::AT_SYMLINK_NOFOLLOW as u32,
                )
            };
            if fd < 0 {
                return Err(io::Error::last_os_error());
            }
            let mount_fd = unsafe { OwnedFd::from_raw_fd(fd as i32) };
            let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            checked(unsafe { libc::fstat(mount_fd.as_raw_fd(), stat.as_mut_ptr()) })?;
            let stat = unsafe { stat.assume_init() };
            if (stat.st_dev, stat.st_ino) != identity {
                return Err(io::Error::from_raw_os_error(libc::ESTALE));
            }
            const FROM_EMPTY_PATH: libc::c_uint = 0x00000004;
            let moved = unsafe {
                libc::syscall(
                    libc::SYS_move_mount,
                    mount_fd.as_raw_fd(),
                    c"".as_ptr(),
                    libc::AT_FDCWD,
                    self.target.as_ptr(),
                    FROM_EMPTY_PATH,
                )
            };
            if moved < 0 {
                return Err(io::Error::last_os_error());
            }
        } else {
            mount(Some(&self.source), &self.target, libc::MS_BIND)?;
        }
        restrict_mount(&self.target, self.readonly, self.device)
    }
}

#[derive(Clone)]
struct Launch {
    root: CString,
    cwd: CString,
    mounts: Vec<Mount>,
    uid_map: String,
    gid_map: String,
}

impl Launch {
    fn enter(&self) -> io::Result<()> {
        checked(unsafe { libc::unshare(libc::CLONE_NEWUSER) })?;
        write_map(c"/proc/self/setgroups", b"deny")?;
        write_map(c"/proc/self/uid_map", self.uid_map.as_bytes())?;
        write_map(c"/proc/self/gid_map", self.gid_map.as_bytes())?;
        checked(unsafe { libc::unshare(libc::CLONE_NEWNS) })?;
        mount(None, c"/", libc::MS_REC | libc::MS_PRIVATE)?;
        mount(Some(&self.root), &self.root, libc::MS_BIND)?;
        for entry in &self.mounts {
            entry.install()?;
        }
        restrict_mount(&self.root, true, false)?;
        checked(unsafe { libc::chroot(self.root.as_ptr()) })?;
        checked(unsafe { libc::chdir(self.cwd.as_ptr()) })?;
        // Prevent host file descriptors and capabilities from crossing exec.
        // The exec-error pipe remains usable until exec closes it.
        if unsafe {
            libc::syscall(
                libc::SYS_close_range,
                3u32,
                u32::MAX,
                libc::CLOSE_RANGE_CLOEXEC,
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        checked(unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) })?;
        // Even if Deck runs as UID 0, exec must not restore capabilities.
        const NOROOT_LOCKED: libc::c_ulong = 0b11;
        checked(unsafe { libc::prctl(libc::PR_SET_SECUREBITS, NOROOT_LOCKED, 0, 0, 0) })?;
        let capability_header = [0x2008_0522u32, 0];
        let capability_data = [0u32; 6];
        if unsafe {
            libc::syscall(
                libc::SYS_capset,
                capability_header.as_ptr(),
                capability_data.as_ptr(),
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

fn write_map(path: &CStr, data: &[u8]) -> io::Result<()> {
    let fd = unsafe { libc::open(path.as_ptr(), libc::O_WRONLY | libc::O_CLOEXEC) };
    checked(fd)?;
    let written = unsafe { libc::write(fd, data.as_ptr().cast(), data.len()) };
    let error = io::Error::last_os_error();
    unsafe { libc::close(fd) };
    if written < 0 {
        Err(error)
    } else if written as usize != data.len() {
        Err(io::Error::from(io::ErrorKind::WriteZero))
    } else {
        Ok(())
    }
}

fn mount(source: Option<&CStr>, target: &CStr, flags: libc::c_ulong) -> io::Result<()> {
    checked(unsafe {
        libc::mount(
            source.map_or(ptr::null(), CStr::as_ptr),
            target.as_ptr(),
            ptr::null(),
            flags,
            ptr::null(),
        )
    })
}

fn restrict_mount(target: &CStr, readonly: bool, device: bool) -> io::Result<()> {
    let mut flags = libc::MOUNT_ATTR_NOSUID;
    if readonly {
        flags |= libc::MOUNT_ATTR_RDONLY;
    }
    if !device {
        flags |= libc::MOUNT_ATTR_NODEV;
    }
    let attributes = libc::mount_attr {
        attr_set: flags,
        attr_clr: 0,
        propagation: 0,
        userns_fd: 0,
    };
    if unsafe {
        libc::syscall(
            libc::SYS_mount_setattr,
            libc::AT_FDCWD,
            target.as_ptr(),
            0,
            &attributes as *const libc::mount_attr,
            std::mem::size_of_val(&attributes),
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn checked(result: libc::c_int) -> io::Result<()> {
    if result < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::os::unix::fs::PermissionsExt;

    #[tokio::test]
    async fn project_mount_fails_closed_when_directory_replaced_before_exec() {
        let tmp = tempfile::Builder::new()
            .prefix("deck2-agy-sbx-")
            .tempdir_in("/tmp")
            .unwrap();
        fs::set_permissions(tmp.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let owners = Directory::open_root(tmp.path())
            .unwrap()
            .directory("owners", true)
            .unwrap();
        let shared = tmp.path().join("shared-profile");
        fs::create_dir_all(&shared).unwrap();
        let project_parent = tempfile::Builder::new()
            .prefix("deck2-agy-proj-")
            .tempdir_in("/tmp")
            .unwrap();
        let project = project_parent.path().join("project");
        fs::create_dir_all(&project).unwrap();
        let canonical = project.canonicalize().unwrap();
        let meta = fs::symlink_metadata(&canonical).unwrap();
        let admitted = (meta.dev(), meta.ino());

        // Mismatched identity is rejected during prepare.
        let wrong = Sandbox::prepare(
            &owners,
            "task-mismatch",
            &shared,
            Path::new("/usr/bin/true"),
            &canonical,
            Some((&canonical, (admitted.0, admitted.1.wrapping_add(1)), false)),
            &json!({}),
        );
        assert!(wrong.is_err());

        // Prepare succeeds with the admitted identity.
        let sandbox = Sandbox::prepare(
            &owners,
            "task-swap",
            &shared,
            Path::new("/usr/bin/true"),
            &canonical,
            Some((&canonical, admitted, false)),
            &json!({}),
        )
        .unwrap();

        // Replace the directory at the exact same pathname before spawn/mount.
        let moved = project_parent.path().join("project-old");
        fs::rename(&canonical, &moved).unwrap();
        fs::create_dir_all(&canonical).unwrap();
        let replaced_meta = fs::symlink_metadata(&canonical).unwrap();
        assert_ne!((replaced_meta.dev(), replaced_meta.ino()), admitted);

        let mut command = Command::new("/usr/bin/true");
        sandbox.apply(&mut command);
        let err = command.spawn().unwrap_err();
        assert_eq!(err.raw_os_error(), Some(libc::ESTALE));
    }
}
