//! Local dictation. Browser values never choose a path, URL or engine arguments.
use crate::{managed_tools::Directory, server::App};
use axum::{
    Json,
    extract::{Path, Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use std::{
    fs::File,
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::fs::{MetadataExt, PermissionsExt},
    },
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex, atomic::Ordering},
    time::{Duration, Instant},
};
use tokio::sync::{Mutex as AsyncMutex, watch};
mod runtime;
#[cfg(test)]
mod tests;
const ID: &str = "large-v3-turbo-q5_0";
const MAX_BYTES: usize = 10 * 1024 * 1024;
const OUTPUT_LIMIT: u64 = 1024 * 1024;
#[derive(Clone)]
struct Artifact {
    bytes: u64,
    sha: String,
    url: String,
}
fn catalog() -> Artifact {
    Artifact {
        bytes: 574041195,
        sha: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2".into(),
        url: format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-{ID}.bin"
        ),
    }
}
const MODEL: &str = "ggml-large-v3-turbo-q5_0.bin";
type Result<T> = std::result::Result<T, &'static str>;
fn parse_wav(b: &[u8]) -> Result<u64> {
    if b.len() > MAX_BYTES {
        return Err("dictation-audio-too-large");
    }
    let fail = "dictation-audio-format";
    if b.len() < 44
        || &b[..4] != b"RIFF"
        || &b[8..12] != b"WAVE"
        || u32::from_le_bytes(b[4..8].try_into().unwrap()) as usize != b.len() - 8
    {
        return Err(fail);
    }
    let mut fmt = false;
    let mut data = None;
    let mut i = 12;
    while i < b.len() {
        if b.len() - i < 8 {
            return Err(fail);
        }
        let size = u32::from_le_bytes(b[i + 4..i + 8].try_into().unwrap()) as usize;
        let start = i + 8;
        let end = start
            .checked_add(size)
            .filter(|e| *e <= b.len())
            .ok_or(fail)?;
        if &b[i..i + 4] == b"fmt " {
            if fmt
                || size != 16
                || b[start..end] != [1, 0, 1, 0, 128, 62, 0, 0, 0, 125, 0, 0, 2, 0, 16, 0]
            {
                return Err(fail);
            }
            fmt = true;
        }
        if &b[i..i + 4] == b"data" {
            if data.is_some() || !size.is_multiple_of(2) {
                return Err(fail);
            }
            data = Some(size);
        }
        i = end + size % 2;
        if i > b.len() {
            return Err(fail);
        }
    }
    let size = data.filter(|_| fmt).ok_or(fail)?;
    // Compare samples before truncating fractional milliseconds at the duration boundary.
    if size < 9600 {
        return Err("dictation-audio-too-short");
    }
    if size > 9600000 {
        return Err("dictation-audio-too-long");
    }
    Ok(size as u64 / 32)
}
// Readiness is a metadata observation, never an integrity decision for selection/use.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Identity {
    dev: u64,
    ino: u64,
    size: u64,
    mtime: i64,
    mtime_ns: i64,
    ctime: i64,
    ctime_ns: i64,
    mode: u32,
    uid: u32,
    links: u64,
}
impl Identity {
    fn of(m: &std::fs::Metadata) -> Self {
        Self {
            dev: m.dev(),
            ino: m.ino(),
            size: m.len(),
            mtime: m.mtime(),
            mtime_ns: m.mtime_nsec(),
            ctime: m.ctime(),
            ctime_ns: m.ctime_nsec(),
            mode: m.mode(),
            uid: m.uid(),
            links: m.nlink(),
        }
    }
}
struct Info {
    selected: bool,
    language: String,
    model_state: &'static str,
    received: u64,
    error: Option<&'static str>,
    engine: Option<PathBuf>,
    last: Option<Value>,
    download: Option<(watch::Sender<bool>, watch::Receiver<bool>)>,
}
pub(crate) struct Service {
    root: Directory,
    models: Directory,
    tmp: Directory,
    artifact: Artifact,
    engine_override: Option<PathBuf>,
    source: Option<PathBuf>,
    info: Mutex<Info>,
    verified_model: Mutex<Option<Identity>>,
    verified_engine: Mutex<Option<(PathBuf, Identity)>>,
    serial: Arc<AsyncMutex<()>>,
    #[cfg(test)]
    verification_gate: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
    #[cfg(test)]
    cleanup_gate: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
}
struct Lease {
    _file: crate::managed_tools::OwnedLock,
    _serial: tokio::sync::OwnedMutexGuard<()>,
}
// Match Deck1's state-root resolution. Only the fixed catalog is read from this root.
fn original_root(
    xdg: Option<std::ffi::OsString>,
    home: Option<std::ffi::OsString>,
) -> Option<PathBuf> {
    let base = xdg
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| {
            home.map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .map(|p| p.join(".local/state"))
        })?;
    Some(base.join("deck/dictation"))
}
// Unlike open_root, this traversal never creates directories or cleans source state.
// Reopening every time observes replacement/removal and rejects symlink components.
fn existing_source(path: &FsPath) -> Result<Option<Directory>> {
    if !path.is_absolute() {
        return Err("dictation-unsafe-path");
    }
    let mut dir = File::open("/").map_err(|_| "dictation-unsafe-path")?;
    for part in path.components() {
        let std::path::Component::Normal(name) = part else {
            if matches!(
                part,
                std::path::Component::RootDir | std::path::Component::CurDir
            ) {
                continue;
            }
            return Err("dictation-unsafe-path");
        };
        use std::os::unix::ffi::OsStrExt;
        let name = std::ffi::CString::new(name.as_bytes()).map_err(|_| "dictation-unsafe-path")?;
        let fd = unsafe {
            libc::openat(
                dir.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            if std::io::Error::last_os_error().kind() == std::io::ErrorKind::NotFound {
                return Ok(None);
            }
            return Err("dictation-unsafe-path");
        }
        dir = unsafe { File::from_raw_fd(fd) };
    }
    let m = dir.metadata().map_err(|_| "dictation-unsafe-path")?;
    if m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o077 != 0 {
        return Err("dictation-unsafe-path");
    }
    Ok(Some(Directory(dir)))
}
impl Service {
    pub(crate) fn downloading(&self) -> bool {
        self.info.lock().unwrap().download.is_some()
    }
    #[cfg(test)]
    fn open(path: &FsPath, artifact: Artifact) -> Result<Arc<Self>> {
        Self::open_compatible(path, artifact, None)
    }
    fn open_compatible(
        path: &FsPath,
        artifact: Artifact,
        source: Option<PathBuf>,
    ) -> Result<Arc<Self>> {
        let root = Directory::open_root(path).map_err(|_| "dictation-unsafe-path")?;
        let models = root
            .directory("models", true)
            .map_err(|_| "dictation-unsafe-path")?;
        let tmp = root
            .directory("tmp", true)
            .map_err(|_| "dictation-unsafe-path")?;
        let service = Arc::new(Self {
            root,
            models,
            tmp,
            artifact,
            source,
            engine_override: std::env::var_os("DECK_WHISPER_CLI")
                .filter(|s| !s.is_empty())
                .map(PathBuf::from),
            serial: Arc::new(AsyncMutex::new(())),
            #[cfg(test)]
            cleanup_gate: Mutex::new(None),
            #[cfg(test)]
            verification_gate: Mutex::new(None),
            verified_model: Mutex::new(None),
            verified_engine: Mutex::new(None),
            info: Mutex::new(Info {
                selected: false,
                language: "es".into(),
                model_state: "absent",
                received: 0,
                error: None,
                engine: None,
                last: None,
                download: None,
            }),
        });
        // One lock covers startup recovery and all native/model effects across project hosts.
        let _lease = service.lease()?;
        service.read_settings()?;
        for dir in [&service.models, &service.tmp] {
            for entry in std::fs::read_dir(dir.path()).map_err(|_| "dictation-unsafe-path")? {
                let e = entry.map_err(|_| "dictation-unsafe-path")?;
                let name = e.file_name();
                let n = name.to_string_lossy();
                if (std::ptr::eq(dir, &service.models) && n.starts_with(".partial-"))
                    || (std::ptr::eq(dir, &service.tmp) && n.starts_with("clip-"))
                {
                    let meta = e.file_type().map_err(|_| "dictation-unsafe-path")?;
                    if meta.is_dir() {
                        std::fs::remove_dir_all(e.path()).map_err(|_| "dictation-unsafe-path")?;
                    } else {
                        std::fs::remove_file(e.path()).map_err(|_| "dictation-unsafe-path")?;
                    }
                }
            }
        }
        Ok(service)
    }
    fn lease(&self) -> Result<Lease> {
        let serial = self
            .serial
            .clone()
            .try_lock_owned()
            .map_err(|_| "dictation-busy")?;
        let file = self
            .root
            .lock("operation.lock")
            .map_err(|_| "dictation-busy")?;
        Ok(Lease {
            _serial: serial,
            _file: crate::managed_tools::OwnedLock(file),
        })
    }
    fn settings_name(&self) -> &'static str {
        // Start compatibility from Deck1; old experimental Deck2 preferences are not inherited.
        if self.source.is_some() {
            "settings-compatible.json"
        } else {
            "settings.json"
        }
    }
    fn model_name(&self) -> &'static str {
        // An old Deck2 artifact must not override or resurrect a removed Deck1 model.
        if self.source.is_some() {
            "compatible-model.bin"
        } else {
            MODEL
        }
    }
    fn read_settings(&self) -> Result<()> {
        let local = self.root.path().join(self.settings_name());
        let source;
        let dir = match local.symlink_metadata() {
            Ok(_) => &self.root,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                source = self
                    .source
                    .as_deref()
                    .map(existing_source)
                    .transpose()?
                    .flatten();
                let Some(dir) = source.as_ref() else {
                    return Ok(());
                };
                match dir.path().join("settings.json").symlink_metadata() {
                    Ok(_) => dir,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                    Err(_) => return Err("dictation-settings-invalid"),
                }
            }
            Err(_) => return Err("dictation-settings-invalid"),
        };
        let name = if std::ptr::eq(dir, &self.root) {
            self.settings_name()
        } else {
            "settings.json"
        };
        let b = dir
            .bytes(name, 4096)
            .map_err(|_| "dictation-settings-invalid")?;
        let v: Value = serde_json::from_slice(&b).map_err(|_| "dictation-settings-invalid")?;
        if !(v["selected"].is_null() || v["selected"] == ID)
            || !matches!(v["language"].as_str(), Some("es" | "en" | "auto"))
        {
            return Err("dictation-settings-invalid");
        }
        let mut i = self.info.lock().unwrap();
        i.selected = v["selected"] == ID;
        i.language = v["language"].as_str().unwrap().into();
        Ok(())
    }
    fn persist(&self, selected: bool, language: &str) -> Result<()> {
        let bytes =
            serde_json::to_vec(&json!({"selected":selected.then_some(ID),"language":language}))
                .unwrap();
        let n = format!(".settings-{}", uuid::Uuid::new_v4());
        self.root
            .write(&n, &bytes)
            .map_err(|_| "dictation-disk-full")?;
        let result = std::fs::rename(
            self.root.path().join(&n),
            self.root.path().join(self.settings_name()),
        )
        .map_err(|_| "dictation-settings-invalid");
        let _ = std::fs::remove_file(self.root.path().join(n));
        result?;
        self.root
            .0
            .sync_all()
            .map_err(|_| "dictation-settings-invalid")
    }
    fn external_model(&self) -> bool {
        match self.source.as_deref().map(existing_source) {
            Some(Ok(Some(dir))) if matches!(dir.path().join("models").symlink_metadata(), Err(e) if e.kind() == std::io::ErrorKind::NotFound) => {
                false
            }
            Some(Ok(Some(dir))) => match dir.existing_dir("models") {
                Ok(models) => {
                    !matches!(models.path().join(MODEL).symlink_metadata(), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
                }
                Err(_) => true,
            },
            Some(Err(_)) => true,
            _ => false,
        }
    }
    fn model_file(&self) -> Result<File> {
        if self.external_model() {
            let dir = existing_source(self.source.as_deref().unwrap())?
                .ok_or("dictation-model-not-installed")?;
            return dir
                .existing_dir("models")
                .and_then(|d| d.file(MODEL, false))
                .map_err(|_| "dictation-model-not-installed");
        }
        self.models
            .file(self.model_name(), false)
            .map_err(|_| "dictation-model-not-installed")
    }
    fn model_present(&self) -> bool {
        if self.external_model() {
            // An inaccessible/unsafe source must be reported as corrupt, never as installed.
            return match existing_source(self.source.as_deref().unwrap()) {
                Ok(Some(d)) => d
                    .existing_dir("models")
                    .map(|m| m.path().join(MODEL).symlink_metadata().is_ok())
                    .unwrap_or(true),
                Ok(None) => false,
                Err(_) => true,
            };
        }
        self.models
            .path()
            .join(self.model_name())
            .symlink_metadata()
            .is_ok()
    }
    async fn verify(&self) -> Result<File> {
        *self.verified_model.lock().unwrap() = None;
        #[cfg(test)]
        {
            let gate = self.verification_gate.lock().unwrap().take();
            if let Some((reached, resume)) = gate {
                reached.notify_one();
                resume.notified().await;
            }
        }

        let file = self.model_file()?;
        let artifact = self.artifact.clone();
        let clone = file
            .try_clone()
            .map_err(|_| "dictation-model-not-installed")?;
        let identity = tokio::task::spawn_blocking(move || {
            use sha2::{Digest, Sha256};
            if clone
                .metadata()
                .map_err(|_| "dictation-model-not-installed")?
                .len()
                != artifact.bytes
            {
                return Err("dictation-model-not-installed");
            };
            let before = clone
                .metadata()
                .map_err(|_| "dictation-model-not-installed")?;
            let mut reader = clone;
            let mut hash = Sha256::new();
            let mut count = 0;
            let mut b = [0; 65536];
            loop {
                let n = reader
                    .read(&mut b)
                    .map_err(|_| "dictation-model-not-installed")?;
                if n == 0 {
                    break;
                }
                count += n as u64;
                if count > artifact.bytes {
                    return Err("dictation-model-not-installed");
                }
                hash.update(&b[..n]);
            }
            let after = reader
                .metadata()
                .map_err(|_| "dictation-model-not-installed")?;
            if Identity::of(&before) != Identity::of(&after) || after.nlink() != 1 {
                return Err("dictation-model-not-installed");
            }
            if count != artifact.bytes || format!("{:x}", hash.finalize()) != artifact.sha {
                return Err("dictation-model-not-installed");
            }
            Ok(Identity::of(&after))
        })
        .await
        .map_err(|_| "dictation-model-not-installed")??;
        let current = self
            .model_file()?
            .metadata()
            .map_err(|_| "dictation-model-not-installed")?;
        if Identity::of(&current) != identity {
            return Err("dictation-model-not-installed");
        }
        *self.verified_model.lock().unwrap() = Some(identity);
        Ok(file)
    }
    async fn summary(&self, app: &App, cancel: &mut watch::Receiver<bool>) -> Result<Value> {
        if let Ok(_lease) = self.lease() {
            self.read_settings()?;
            let identity = self
                .model_file()
                .ok()
                .and_then(|f| f.metadata().ok())
                .map(|m| Identity::of(&m));
            let cached = identity.is_some() && identity == *self.verified_model.lock().unwrap();
            let installed = cached || self.verify().await.is_ok();
            let state = if installed {
                "installed"
            } else if self.model_present() {
                "corrupt"
            } else {
                "absent"
            };
            let path = runtime::resolve(
                app,
                cancel,
                self.engine_override.as_deref(),
                &self.verified_engine,
            )
            .await?;
            let mut i = self.info.lock().unwrap();
            i.model_state = state;
            i.engine = path;
        }
        admitted(app)?;
        let i = self.info.lock().unwrap();
        Ok(
            json!({"ok":true,"available":i.engine.is_some()&&i.selected&&i.model_state=="installed","runtime":i.engine.as_ref().map(|p|json!({"state":"ready","path":p})).unwrap_or(json!({"state":"missing"})),"models":[{"id":ID,"label":"Large v3 Turbo · Q5_0","bytes":self.artifact.bytes,"state":i.model_state,"source":if self.external_model(){"deck1"}else{"deck2"},"received":i.received,"error":i.error}],"selected":i.selected.then_some(ID),"language":i.language,"active":self.serial.try_lock().is_err(),"lastRun":i.last}),
        )
    }
    async fn perform(
        &self,
        app: &App,
        b: Vec<u8>,
        audio_ms: u64,
        cancel: &mut watch::Receiver<bool>,
    ) -> Result<Value> {
        let started = Instant::now();
        self.read_settings()?;
        let language = {
            let i = self.info.lock().unwrap();
            if !i.selected {
                return Err("dictation-model-not-installed");
            }
            i.language.clone()
        };
        let model = self.verify().await?;
        let engine = runtime::resolve(
            app,
            cancel,
            self.engine_override.as_deref(),
            &self.verified_engine,
        )
        .await?
        .ok_or("dictation-engine-missing")?;
        admitted(app)?;
        if *cancel.borrow() {
            return Err("dictation-cancelled");
        }
        crate::web_identity::admit()?;
        let temp = tempfile::Builder::new()
            .prefix("clip-")
            .tempdir_in(self.tmp.path())
            .map_err(|_| "dictation-disk-full")?;
        let result = async {
            std::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o700))
                .map_err(|_| "dictation-unsafe-path")?;
            let dir = Directory::open_root(
                &temp
                    .path()
                    .canonicalize()
                    .map_err(|_| "dictation-unsafe-path")?,
            )
            .map_err(|_| "dictation-unsafe-path")?;
            dir.write("audio.wav", &b)
                .map_err(|_| "dictation-disk-full")?;
            dir.write("result.json", b"")
                .map_err(|_| "dictation-disk-full")?;
            // Descriptor paths keep model/audio identity pinned even if pathnames change.
            let base = format!("/proc/{}/fd/{}", std::process::id(), dir.0.as_raw_fd());
            let model_path = format!("/proc/{}/fd/{}", std::process::id(), model.as_raw_fd());
            let threads = std::thread::available_parallelism()
                .map(|n| n.get().saturating_sub(1).clamp(1, 8))
                .unwrap_or(1)
                .to_string();
            let args = [
                "-m",
                &model_path,
                "-f",
                &format!("{base}/audio.wav"),
                "-l",
                &language,
                "-t",
                &threads,
                "-nt",
                "-np",
                "-mc",
                "0",
                "-sns",
                "-oj",
                "-of",
                &format!("{base}/result"),
            ]
            .map(String::from);
            runtime::run(
                app,
                &engine,
                &args,
                cancel,
                Duration::from_millis((audio_ms * 6).clamp(60000, 600000)),
                OUTPUT_LIMIT as usize,
                false,
                Some(dir.path().join("result.json")),
            )
            .await?;
            admitted(app)?;
            if *cancel.borrow() {
                return Err("dictation-cancelled");
            }
            let output = dir
                .bytes("result.json", OUTPUT_LIMIT)
                .map_err(|_| "dictation-engine-output-limit")?;
            let v: Value =
                serde_json::from_slice(&output).map_err(|_| "dictation-engine-invalid-output")?;
            let segments = v["transcription"]
                .as_array()
                .filter(|s| s.len() <= 10000)
                .ok_or("dictation-engine-invalid-output")?;
            let mut text = String::new();
            for s in segments {
                let t = s["text"]
                    .as_str()
                    .ok_or("dictation-engine-invalid-output")?;
                text.push_str(t);
                if text.chars().count() > 100000 {
                    return Err("dictation-engine-output-limit");
                }
            }
            let last = json!({"modelId":ID,"audioMs":audio_ms,"elapsedMs":started.elapsed().as_millis()as u64});
            self.info.lock().unwrap().last = Some(last.clone());
            Ok(
                json!({"ok":true,"text":text.trim(),"modelId":ID,"audioMs":audio_ms,"elapsedMs":last["elapsedMs"]}),
            )
        }
        .await;
        remove_owned(temp.path(), true).await;
        result
    }
    async fn acquire(&self, app: &App, cancel: &mut watch::Receiver<bool>) -> Result<()> {
        use sha2::{Digest, Sha256};
        let name = format!(".partial-{}", uuid::Uuid::new_v4());
        let path = self.models.path().join(&name);
        let observed = cancel.clone();
        let effect = async {
            let client = reqwest::Client::builder()
                .https_only(!cfg!(test))
                .timeout(Duration::from_secs(1800))
                .build()
                .map_err(|_| "dictation-download-failed")?;
            let mut response = client
                .get(&self.artifact.url)
                .send()
                .await
                .map_err(|_| "dictation-download-failed")?;
            if !response.status().is_success()
                || response
                    .content_length()
                    .is_some_and(|n| n != self.artifact.bytes)
            {
                return Err("dictation-download-integrity");
            }
            let mut file = self
                .models
                .file(&name, true)
                .map_err(|_| "dictation-disk-full")?;
            let mut hash = Sha256::new();
            let mut size = 0;
            while let Some(b) = response
                .chunk()
                .await
                .map_err(|_| "dictation-download-failed")?
            {
                admitted(app)?;
                if *observed.borrow() {
                    return Err("dictation-cancelled");
                }
                size += b.len() as u64;
                if size > self.artifact.bytes {
                    return Err("dictation-download-integrity");
                }
                file.write_all(&b).map_err(|_| "dictation-disk-full")?;
                hash.update(&b);
                self.info.lock().unwrap().received = size;
            }
            self.info.lock().unwrap().model_state = "verifying";
            if size != self.artifact.bytes || format!("{:x}", hash.finalize()) != self.artifact.sha
            {
                return Err("dictation-download-integrity");
            }
            file.sync_all().map_err(|_| "dictation-disk-full")?;
            admitted(app)?;
            if *observed.borrow() {
                return Err("dictation-cancelled");
            }
            std::fs::rename(&path, self.models.path().join(self.model_name()))
                .map_err(|_| "dictation-download-failed")?;
            self.models
                .0
                .sync_all()
                .map_err(|_| "dictation-download-failed")?;
            Ok(())
        };
        let shutdown = async {
            while admitted(app).is_ok() {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        };
        let result = tokio::select! {r=effect=>r,_=cancel.changed()=>Err("dictation-cancelled"),_=shutdown=>Err("daemon-stopping")};
        remove_owned(&path, false).await;
        result
    }
}
// Keep the caller's lease until removal is observed, including aborted HTTP observers.
async fn remove_owned(path: &FsPath, directory: bool) {
    loop {
        let result = if directory {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        };
        match result {
            Ok(()) => return,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
            Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }
}

fn admitted(app: &App) -> Result<()> {
    crate::web_identity::authorize()?;
    if app.shutdown_requested.load(Ordering::SeqCst) || !app.persistence_available() {
        Err("daemon-stopping")
    } else {
        Ok(())
    }
}
async fn service(app: &App) -> Result<Arc<Service>> {
    app.dictation
        .get_or_try_init(|| async {
            let root = app
                .artifact_root()
                .map_err(|_| "dictation-unavailable")?
                .join("dictation");
            // Explicit stores are intentionally isolated (fixtures and user-selected stores).
            let source = if app.artifact_store.lock().unwrap().is_none() {
                original_root(std::env::var_os("XDG_STATE_HOME"), std::env::var_os("HOME"))
            } else {
                None
            };
            Service::open_compatible(&root, catalog(), source)
        })
        .await
        .cloned()
}
fn response(r: Result<Value>) -> Response {
    match r {
        Ok(v) => Json(v).into_response(),
        Err(code) => {
            let status = match code {
                "dictation-busy" => 429,
                "dictation-engine-unavailable" => 503,
                "dictation-engine-timeout" => 504,
                "dictation-engine-failed"
                | "dictation-engine-invalid-output"
                | "dictation-engine-output-limit" => 502,
                "daemon-stopping" => 503,
                "dictation-audio-format" => 415,
                "dictation-audio-too-large" | "dictation-audio-too-long" => 413,
                "dictation-audio-too-short" => 422,
                "dictation-settings-invalid"
                | "dictation-model-invalid"
                | "dictation-language-invalid" => 400,
                "dictation-cancelled" => 408,
                _ => 409,
            };
            (
                StatusCode::from_u16(status).unwrap(),
                Json(json!({"ok":false,"code":code})),
            )
                .into_response()
        }
    }
}
struct CancelOnDrop(watch::Sender<bool>);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        let _ = self.0.send(true);
    }
}
// The detached owner retains its lease and tempfiles through confirmed process cleanup.
async fn owned<F, Fut>(app: App, f: F) -> Response
where
    F: FnOnce(App, watch::Receiver<bool>) -> Fut + Send + 'static,
    Fut: Future<Output = Result<Value>> + Send + 'static,
{
    let (sender, receiver) = watch::channel(false);
    let _guard = CancelOnDrop(sender);
    let task = tokio::spawn(crate::web_identity::inherit(f(app, receiver)));
    response(task.await.unwrap_or(Err("dictation-unavailable")))
}
pub(crate) async fn summary(State(app): State<App>) -> Response {
    owned(app, |app, mut cancel| async move {
        service(&app).await?.summary(&app, &mut cancel).await
    })
    .await
}
pub(crate) async fn transcribe(State(app): State<App>, request: Request) -> Response {
    if !request
        .headers()
        .get("content-type")
        .and_then(|s| s.to_str().ok())
        .is_some_and(|s| {
            s.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .eq_ignore_ascii_case("audio/wav")
        })
    {
        return response(Err("dictation-audio-format"));
    }
    let service = match service(&app).await {
        Ok(s) => s,
        Err(e) => return response(Err(e)),
    };
    let lease = match service.lease() {
        Ok(l) => l,
        Err(e) => return response(Err(e)),
    };
    owned(app,move|app,mut cancel|async move{let _lease=lease;admitted(&app)?;
 let b=tokio::select!{r=tokio::time::timeout(Duration::from_secs(90),axum::body::to_bytes(request.into_body(),MAX_BYTES))=>r.map_err(|_|"dictation-audio-too-large")?.map_err(|_|"dictation-audio-too-large")?,_=cancel.changed()=>return Err("dictation-cancelled")};admitted(&app)?;let ms=parse_wav(&b)?;service.perform(&app,b.to_vec(),ms,&mut cancel).await}).await
}
pub(crate) async fn settings(State(app): State<App>, Json(body): Json<Value>) -> Response {
    owned(app, move |app, mut cancel| async move {
        let s = service(&app).await?;
        let _lease = s.lease()?;
        s.read_settings()?;
        let object = body
            .as_object()
            .filter(|o| {
                o.keys()
                    .all(|k| matches!(k.as_str(), "selected" | "language"))
            })
            .ok_or("dictation-settings-invalid")?;
        let selected = object.get("selected");
        let language = object.get("language");
        if selected.is_some_and(|v| !v.is_null() && v != ID) {
            return Err("dictation-model-invalid");
        }
        if language.is_some_and(|v| !matches!(v.as_str(), Some("es" | "en" | "auto"))) {
            return Err("dictation-language-invalid");
        }
        if selected.is_some_and(|v| v == ID) {
            s.verify().await?;
        }
        admitted(&app)?;
        if *cancel.borrow_and_update() {
            return Err("dictation-cancelled");
        }
        let mut i = s.info.lock().unwrap();
        let selected = selected.map(|v| v == ID).unwrap_or(i.selected);
        let language = language
            .and_then(Value::as_str)
            .unwrap_or(&i.language)
            .to_owned();
        crate::web_identity::admit()?;
        s.persist(selected, &language)?;
        i.selected = selected;
        i.language = language;
        Ok(json!({"ok":true}))
    })
    .await
}
pub(crate) async fn download(State(app): State<App>, Path(id): Path<String>) -> Response {
    if id != ID {
        return response(Err("dictation-model-invalid"));
    }
    let s = match service(&app).await {
        Ok(s) => s,
        Err(e) => return response(Err(e)),
    };
    let lease = match s.lease() {
        Ok(l) => l,
        Err(e) => return response(Err(e)),
    };
    if s.verify().await.is_ok() {
        return response(Err("dictation-model-installed"));
    }
    if s.external_model() {
        return response(Err("dictation-model-source-owned"));
    }
    if let Err(e) = admitted(&app) {
        return response(Err(e));
    }
    if let Some(r) = crate::web_identity::effect_denied() { return r; }
    let (tx, mut rx) = watch::channel(false);
    let (done, finished) = watch::channel(false);
    {
        let mut i = s.info.lock().unwrap();
        i.model_state = "downloading";
        i.received = 0;
        i.error = None;
        i.download = Some((tx, finished));
    }
    tokio::spawn(async move {
        let _lease = lease;
        let result = s.acquire(&app, &mut rx).await;
        let mut i = s.info.lock().unwrap();
        i.model_state = if result.is_ok() {
            "installed"
        } else if *rx.borrow() {
            "absent"
        } else {
            "failed"
        };
        i.error = result.err().filter(|e| *e != "dictation-cancelled");
        i.download = None;
        let _ = done.send(true);
    });
    (StatusCode::ACCEPTED, Json(json!({"ok":true}))).into_response()
}
pub(crate) async fn cancel_download(State(app): State<App>, Path(id): Path<String>) -> Response {
    if id != ID {
        return response(Err("dictation-model-invalid"));
    }
    let s = match service(&app).await {
        Ok(s) => s,
        Err(e) => return response(Err(e)),
    };
    if let Some(r) = crate::web_identity::effect_denied() { return r; }
    let job = s.info.lock().unwrap().download.clone();
    if let Some((cancel, mut done)) = job {
        let _ = cancel.send(true);
        if !*done.borrow() {
            let _ = done.changed().await;
        }
    }
    response(Ok(json!({"ok":true})))
}
pub(crate) async fn delete(State(app): State<App>, Path(id): Path<String>) -> Response {
    if id != ID {
        return response(Err("dictation-model-invalid"));
    }
    owned(app, |app, _| async move {
        let s = service(&app).await?;
        let _lease = s.lease()?;
        s.read_settings()?;
        admitted(&app)?;
        if s.external_model() {
            return Err("dictation-model-source-owned");
        }
        crate::web_identity::admit()?;
        let path = s.models.path().join(s.model_name());
        match std::fs::remove_file(path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("dictation-unsafe-path"),
        };
        let language = s.info.lock().unwrap().language.clone();
        s.persist(false, &language)?;
        let mut i = s.info.lock().unwrap();
        i.selected = false;
        i.model_state = "absent";
        Ok(json!({"ok":true}))
    })
    .await
}

/// Drain the same owned native/model lifecycle before the host runtime exits.
pub async fn close(app: &App) {
    if let Some(service) = app.dictation.get() {
        let job = service.info.lock().unwrap().download.clone();
        if let Some((cancel, mut done)) = job {
            let _ = cancel.send(true);
            if !*done.borrow() {
                let _ = done.changed().await;
            }
        }
        let _drained = service.serial.lock().await;
    }
}
