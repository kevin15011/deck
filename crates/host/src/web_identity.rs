//! Original browser identity. No imported credential cache: the private source
//! is authoritative on every admission and throughout long-lived requests.
use crate::server::{App, problem};
use axum::http::{StatusCode, header};
use axum::{
    Json,
    http::{HeaderMap, Method},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::SocketAddr,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
// Per-request authority follows preparation workers explicitly; admitted native work
// keeps its existing resource owner. No credential is copied into durable state.
#[derive(Clone)]
pub(crate) struct RequestAuthority {
    identity: Identity,
    headers: HeaderMap,
    peer: Option<SocketAddr>,
    accepted: std::sync::Arc<std::sync::atomic::AtomicBool>,
}
tokio::task_local! { static REQUEST_AUTHORITY: Option<RequestAuthority>; }
impl RequestAuthority {
    pub(crate) fn new(identity: Identity, headers: HeaderMap, peer: Option<SocketAddr>) -> Self {
        Self { identity, headers, peer, accepted: Default::default() }
    }
    pub(crate) fn accepted(&self) -> bool { self.accepted.load(std::sync::atomic::Ordering::SeqCst) }
}
pub(crate) async fn request_scope<F: std::future::Future>(authority: Option<RequestAuthority>, future: F) -> F::Output {
    REQUEST_AUTHORITY.scope(authority, future).await
}
pub(crate) fn inherit<F: std::future::Future>(future: F) -> impl std::future::Future<Output=F::Output> {
    let authority = REQUEST_AUTHORITY.try_with(Clone::clone).ok().flatten();
    request_scope(authority, future)
}
pub(crate) fn inherit_blocking<F: FnOnce() -> R, R>(f: F) -> impl FnOnce() -> R {
    let authority = REQUEST_AUTHORITY.try_with(Clone::clone).ok().flatten();
    move || REQUEST_AUTHORITY.sync_scope(authority, f)
}
pub(crate) fn authorize() -> Result<()> {
    REQUEST_AUTHORITY.try_with(|a| match a {
        Some(a) if !a.identity.authorized(&a.headers, a.peer) => Err("device-required"),
        _ => Ok(()),
    }).unwrap_or(Ok(()))
}
// Call after extraction/preparation, immediately before the synchronous effect or
// durable acceptance. Subsequent work follows that admission, not a cached grant.
pub(crate) fn admit() -> Result<()> {
    authorize()?;
    let _ = REQUEST_AUTHORITY.try_with(|a| if let Some(a) = a { a.accepted.store(true, std::sync::atomic::Ordering::SeqCst); });
    Ok(())
}
pub(crate) fn effect_denied() -> Option<Response> {
    admit().err().map(|_| problem(StatusCode::FORBIDDEN,"device-required","Device access ended"))
}
type Result<T> = std::result::Result<T, &'static str>;
#[derive(Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Policy {
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub trusted_proxy: Option<String>,
    #[serde(default)]
    pub allowed_origins: Vec<String>,
    #[serde(default)]
    pub allow_funnel: bool,
    #[serde(default)]
    pub tailscale_serve_access: bool,
}
#[derive(Clone, Default)]
pub struct Identity {
    pub assignment_config: Option<PathBuf>,
    pub root: Option<PathBuf>,
    pub policy: Policy,
    pub local_state: Option<PathBuf>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Device {
    id: String,
    name: String,
    created_at: String,
    hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    revoked_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expires_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tailscale_identity: Option<String>,
    #[serde(flatten)]
    extra: serde_json::Map<String, Value>,
}
fn fail() -> &'static str {
    "device-store-unavailable"
}
fn private(f: &File, dir: bool) -> Result<()> {
    let m = f.metadata().map_err(|_| fail())?;
    if m.uid() != unsafe { libc::geteuid() }
        || m.mode() & 0o077 != 0
        || if dir { !m.is_dir() } else { !m.is_file() }
    {
        return Err(fail());
    }
    Ok(())
}
pub(crate) fn open_at(dir: &File, name: &str, directory: bool) -> Result<File> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let name = std::ffi::CString::new(name).map_err(|_| fail())?;
    let fd = unsafe {
        libc::openat(
            dir.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY
                | libc::O_NOFOLLOW
                | libc::O_CLOEXEC
                | libc::O_NONBLOCK
                | if directory { libc::O_DIRECTORY } else { 0 },
        )
    };
    if fd < 0 {
        return Err(fail());
    }
    let f = unsafe { File::from_raw_fd(fd) };
    private(&f, directory)?;
    Ok(f)
}
pub(crate) fn root(path: &Path) -> Result<File> {
    let f = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| fail())?;
    private(&f, true)?;
    Ok(f)
}
pub(crate) fn value(dir: &File, name: &str) -> Result<Value> {
    let mut f = open_at(dir, name, false)?;
    if f.metadata().map_err(|_| fail())?.len() > 1024 * 1024 {
        return Err(fail());
    }
    let mut b = Vec::new();
    Read::by_ref(&mut f)
        .take(1024 * 1024 + 1)
        .read_to_end(&mut b)
        .map_err(|_| fail())?;
    if b.len() > 1024 * 1024 {
        return Err(fail());
    }
    serde_json::from_slice(&b).map_err(|_| fail())
}
fn hex(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn equal(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |v, (a, b)| v | (a ^ b)) == 0
}
// ISO timestamps accepted by the original writer, including timezone offsets.
// SQLite's date parser is already a production dependency; invalid dates fail closed.
fn timestamp(s: &str) -> Result<i64> {
    if s.len() < 10 || !s.as_bytes()[0..4].iter().all(u8::is_ascii_digit) || s.as_bytes()[4] != b'-'
    {
        return Err(fail());
    }
    let c = rusqlite::Connection::open_in_memory().map_err(|_| fail())?;
    c.query_row(
        "SELECT CAST((julianday(?1)-2440587.5)*86400000 AS INTEGER)",
        [s],
        |r| r.get::<_, Option<i64>>(0),
    )
    .map_err(|_| fail())?
    .ok_or_else(fail)
}
fn now_iso() -> String {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    c.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| {
        r.get(0)
    })
    .unwrap()
}
const REMEMBER_SECONDS: u64 = 180 * 24 * 60 * 60;
const LOCAL_DEVICE_PREFIX: &str = "local-";

fn expiry() -> Result<String> {
    let c = rusqlite::Connection::open_in_memory().map_err(|_| fail())?;
    c.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%fZ',?1/1000.0,'unixepoch')",
        [(crate::now() + REMEMBER_SECONDS * 1000) as i64],
        |r| r.get(0),
    )
    .map_err(|_| fail())
}
fn host_of(origin: &str) -> Option<String> {
    let u = reqwest::Url::parse(origin).ok()?;
    if !["http", "https"].contains(&u.scheme())
        || !u.username().is_empty()
        || u.password().is_some()
        || u.origin().ascii_serialization() != origin
    {
        return None;
    }
    Some(origin.split_once("://")?.1.to_string())
}
fn h<'a>(headers: &'a HeaderMap, key: &str) -> Option<&'a str> {
    headers.get(key)?.to_str().ok()
}
pub fn cookie(headers: &HeaderMap) -> Option<&str> {
    credential(headers).map(|(_, token)| token)
}
fn cookie_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    h(headers, "cookie")?
        .split(';')
        .map(str::trim)
        .find_map(|s| s.split_once('=').filter(|(key, _)| *key == name).map(|(_, value)| value))
}
fn local_cookie_name(headers: &HeaderMap) -> Option<String> {
    let (host, port) = h(headers, "host")?.split_once(':')?;
    (matches!(host, "127.0.0.1" | "localhost") && port.parse::<u16>().is_ok())
        .then(|| format!("deck_device_{port}"))
}
fn credential(headers: &HeaderMap) -> Option<(bool, &str)> {
    if let Some(token) = cookie_value(headers, "deck_device") {
        return Some((false, token));
    }
    Some((true, cookie_value(headers, &local_cookie_name(headers)?)?))
}
fn direct_host(headers: &HeaderMap, peer: Option<SocketAddr>) -> Option<&str> {
    local_cookie_name(headers)?;
    let host = h(headers, "host")?;
    (peer.is_some_and(|p| p.ip().is_loopback())
        && h(headers, "origin").is_none_or(|o| o == format!("http://{host}"))
        && !headers.keys().any(|k| {
            k == "forwarded"
                || k.as_str().starts_with("x-forwarded-")
                || k.as_str().contains("funnel")
        }))
    .then_some(host)
}
// Cookies are host-only in browsers, but HTTP cookies do not isolate ports.
fn local_digest(token: &str, host: &str) -> String {
    crate::tasks::digest(format!("{host}/{token}").as_bytes())
}
fn local_device_id(id: &str) -> bool {
    id.strip_prefix(LOCAL_DEVICE_PREFIX)
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
}
fn set_cookie(headers: &mut HeaderMap, name: &str, token: &str, max_age: u64) {
    headers.append(
        header::SET_COOKIE,
        format!("{name}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}")
            .parse()
            .unwrap(),
    );
}
pub(crate) fn expire_cookie(headers: &mut HeaderMap, name: &str) {
    set_cookie(headers, name, "", 0);
}
pub(crate) fn clear_stale_device(
    identity: &Identity,
    headers: &HeaderMap,
    peer: Option<SocketAddr>,
    response: &mut Response,
) {
    if direct_host(headers, peer).is_none() || identity.authorized(headers, peer) {
        return;
    }
    match credential(headers) {
        Some((true, _)) => expire_cookie(response.headers_mut(), &local_cookie_name(headers).unwrap()),
        Some((false, _)) => expire_cookie(response.headers_mut(), "deck_device"),
        None => {}
    }
}
fn loopback(s: &str) -> bool {
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].contains(&s)
}
impl Identity {
    pub fn discover(root: Option<PathBuf>, isolated: bool) -> Result<Self> {
        // Explicit helper stores and --no-history never discover a real user's config.
        let policy = if isolated {
            Policy::default()
        } else {
            let home = std::env::var_os("HOME")
                .map(PathBuf::from)
                .ok_or("web-config-unavailable")?;
            let base = std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .unwrap_or_else(|| home.join(".config"));
            let path = base.join("deck/config.json");
            if fs::symlink_metadata(&path).is_ok() {
                let dir = root_config(&base)?;
                let v = value(&dir, "config.json")?;
                let w = v.pointer("/crossRunner/web").cloned().unwrap_or(json!({}));
                serde_json::from_value(w).map_err(|_| "web-config-invalid")?
            } else {
                Policy::default()
            }
        };
        for o in &policy.allowed_origins {
            if host_of(o).is_none() {
                return Err("web-config-invalid");
            }
        }
        if policy.port == Some(0)
            || policy
                .trusted_proxy
                .as_ref()
                .is_some_and(|p| p.trim() != p || p.is_empty())
            || policy.tailscale_serve_access
                && (!policy.trusted_proxy.as_deref().is_some_and(loopback)
                    || !policy.allowed_origins.iter().any(|o| {
                        o.starts_with("https://")
                            && reqwest::Url::parse(o)
                                .is_ok_and(|u| u.host_str().is_some_and(|s| s.ends_with(".ts.net")))
                    }))
        {
            return Err("web-config-invalid");
        }
        let assignment_config=if isolated {None}else{
            let home=std::env::var_os("HOME").map(PathBuf::from).ok_or("web-config-unavailable")?;
            Some(std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).filter(|p|p.is_absolute()).unwrap_or_else(||home.join(".config")).join("deck/config.json"))
        };
        Ok(Self { root, policy, assignment_config, local_state: None })
    }
    pub(crate) fn scheduler_config(&self) -> std::result::Result<Value,String> {
        let Some(path)=&self.assignment_config else {return Ok(json!({}));};
        if !path.try_exists().map_err(|_|"Deck execution configuration unavailable")? {return Ok(json!({}));}
        let dir=root_config(path.parent().and_then(Path::parent).ok_or("Deck configuration root invalid")?).map_err(str::to_owned)?;
        let config=value(&dir,"config.json").map_err(str::to_owned)?;
        let cross=config.get("crossRunner").cloned().unwrap_or(json!({}));
        if !cross.is_object() {return Err("Deck execution configuration invalid".into());}
        Ok(cross)
    }
    pub(crate) fn assignment_members(&self) -> std::result::Result<Value,String> {
        let Some(path)=&self.assignment_config else {return Ok(json!({}));};
        if !path.try_exists().map_err(|_|"Deck member configuration unavailable")? {return Ok(json!({}));}
        let dir=root_config(path.parent().and_then(Path::parent).ok_or("Deck configuration root invalid")?).map_err(str::to_owned)?;
        let config=value(&dir,"config.json").map_err(str::to_owned)?;
        let members=config.pointer("/crossRunner/members").cloned().unwrap_or(json!({}));
        if !members.is_object() {return Err("Deck member configuration invalid".into());}
        Ok(members)
    }
    fn web(&self) -> Result<File> {
        open_at(&root(self.root.as_deref().ok_or_else(fail)?)?, "web", true)
    }
    fn devices(&self) -> Result<Vec<Device>> {
        Self::read_devices(&self.web()?, "devices.json")
    }
    fn read_devices(dir: &File, filename: &str) -> Result<Vec<Device>> {
        let v = value(dir, filename)?;
        if !v.as_array().is_some_and(|ds| {
            ds.iter().all(|d| {
                ["expiresAt", "tailscaleIdentity"]
                    .iter()
                    .all(|key| d.get(key).is_none_or(Value::is_string))
            })
        }) {
            return Err(fail());
        }
        let devices: Vec<Device> = serde_json::from_value(v).map_err(|_| fail())?;
        let mut ids = std::collections::HashSet::new();
        if !devices.iter().all(|d| {
            !d.id.is_empty()
                && ids.insert(&d.id)
                && hex(&d.hash)
                && d.expires_at.as_deref().is_none_or(|s| timestamp(s).is_ok())
                && d.tailscale_identity.as_deref().is_none_or(hex)
        }) {
            return Err(fail());
        }
        Ok(devices)
    }
    pub fn host_allowed(&self, host: Option<&str>, local_host: &str) -> bool {
        let port = local_host.rsplit(':').next().unwrap_or("");
        host.is_some_and(|host| {
            host == format!("127.0.0.1:{port}")
                || host == format!("localhost:{port}")
                || self
                    .policy
                    .allowed_origins
                    .iter()
                    .any(|o| host_of(o).as_deref() == Some(host))
        })
    }
    pub fn boundary(
        &self,
        headers: &HeaderMap,
        method: &Method,
        local_host: &str,
        peer: Option<SocketAddr>,
    ) -> bool {
        let Some(host) = h(headers, "host") else {
            return false;
        };
        let origin = h(headers, "origin");
        let port = local_host.rsplit(':').next().unwrap_or("");
        let mut origins = vec![
            format!("http://127.0.0.1:{port}"),
            format!("http://localhost:{port}"),
        ];
        origins.extend(self.policy.allowed_origins.clone());
        if !origins.iter().any(|o| host_of(o).as_deref() == Some(host)) {
            return false;
        }
        let forwarded = headers
            .keys()
            .any(|k| k == "forwarded" || k.as_str().starts_with("x-forwarded-"));
        let funnel = headers.keys().any(|k| k.as_str().contains("funnel"));
        if forwarded || funnel {
            let ip = peer.map(|p| p.ip().to_string());
            if self.policy.trusted_proxy.is_none()
                || ip != self.policy.trusted_proxy
                || !self
                    .policy
                    .allowed_origins
                    .iter()
                    .any(|o| host_of(o).as_deref() == Some(host))
                || origin.is_some_and(|o| !self.policy.allowed_origins.iter().any(|s| s == o))
                || funnel && !self.policy.allow_funnel
            {
                return false;
            }
        }
        if (method != Method::GET
            || h(headers, "upgrade").is_some_and(|s| s.eq_ignore_ascii_case("websocket")))
            && !origin.is_some_and(|o| {
                origins.iter().any(|s| s == o) && host_of(o).as_deref() == Some(host)
            })
        {
            return false;
        }
        // Retain the existing Rust boundary's rejection for supplied cross-origin GETs.
        origin.is_none_or(|o| origins.iter().any(|s| s == o) && host_of(o).as_deref() == Some(host))
    }
    fn serve_identity(&self, headers: &HeaderMap, peer: Option<SocketAddr>) -> Option<String> {
        let ip = peer?.ip().to_string();
        if !self.policy.tailscale_serve_access
            || self.policy.trusted_proxy.as_deref() != Some(&ip)
            || !loopback(&ip)
            || headers.keys().any(|k| k.as_str().contains("funnel"))
        {
            return None;
        }
        let origin = self.policy.allowed_origins.iter().find(|o| {
            o.starts_with("https://")
                && reqwest::Url::parse(o)
                    .is_ok_and(|u| u.host_str().is_some_and(|s| s.ends_with(".ts.net")))
                && host_of(o).as_deref() == h(headers, "host")
        })?;
        if h(headers, "origin").is_some_and(|o| o != origin) {
            return None;
        }
        let login = h(headers, "tailscale-user-login")?;
        if login.is_empty()
            || login.len() > 512
            || login
                .chars()
                .any(|c| c.is_whitespace() || c.is_control() || c == ',')
        {
            return None;
        }
        Some(crate::tasks::digest(
            serde_json::to_string(&[origin.as_str(), login])
                .ok()?
                .as_bytes(),
        ))
    }
    fn active(d: &Device) -> bool {
        d.revoked_at.is_none()
            && d.expires_at.as_deref().is_none_or(|s| {
                timestamp(s).is_ok_and(|t| t > crate::now() as i64)
            })
    }

    fn access(&self, headers: &HeaderMap, peer: Option<SocketAddr>) -> Result<(bool, Device)> {
        let (local, token) = credential(headers).ok_or("device-required")?;
        if token.len() != 43
            || !token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err("device-required");
        }
        let (devices, hash) = if local {
            let host = direct_host(headers, peer).ok_or("device-required")?;
            (self.local_devices()?, local_digest(token, host))
        } else {
            (self.devices()?, crate::tasks::digest(token.as_bytes()))
        };
        let device = devices.into_iter().find(|d| {
            equal(&d.hash, &hash)
                && Self::active(d)
                && (!local || d.expires_at.is_some())
                && d.tailscale_identity.as_ref().is_none_or(|id| {
                    self.serve_identity(headers, peer).as_ref() == Some(id)
                })
        }).ok_or("device-required")?;
        Ok((local, device))
    }
    pub(crate) fn remembered(&self, headers: &HeaderMap, peer: Option<SocketAddr>) -> bool {
        self.access(headers, peer).is_ok_and(|(_, d)| d.expires_at.is_some())
    }
    pub fn authorized(&self, headers: &HeaderMap, peer: Option<SocketAddr>) -> bool {
        self.access(headers, peer).is_ok()
    }
    pub(crate) fn device_id(&self, headers: &HeaderMap, peer: Option<SocketAddr>) -> Result<String> {
        self.access(headers, peer).map(|(_, d)| d.id).map_err(|_| "device-required")
    }
    pub(crate) fn active_device_ids<'a>(&self, ids: impl Iterator<Item = &'a str>) -> Result<std::collections::HashSet<String>> {
        let (mut local, mut original) = (false, false);
        for id in ids {
            if local_device_id(id) { local = true; } else { original = true; }
        }
        let mut active = std::collections::HashSet::new();
        if original {
            active.extend(self.devices()?.into_iter().filter(Self::active).map(|d| d.id));
        }
        if local {
            active.extend(self.local_devices()?.into_iter().filter(Self::active).map(|d| d.id));
        }
        Ok(active)
    }
    pub(crate) fn active_device(&self,id:&str)->bool {
        self.active_device_ids(std::iter::once(id)).is_ok_and(|ids| ids.contains(id))
    }
    pub(crate) fn renew_notification_device(&self, headers: &HeaderMap, peer: Option<SocketAddr>) -> Result<String> {
        let (local, device) = self.access(headers, peer).map_err(|_| "device-required")?;
        let token = cookie(headers).ok_or("device-required")?;
        if local {
            let name = local_cookie_name(headers).ok_or("device-required")?;
            let end = timestamp(device.expires_at.as_deref().ok_or("device-required")?)?;
            let remaining = (end - crate::now() as i64).max(0) / 1000;
            return Ok(format!("{name}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={remaining}"));
        }
        let mut devices = self.devices()?;
        devices.iter_mut().find(|d| d.id == device.id).ok_or("device-required")?.expires_at = Some(expiry()?);
        self.save(&devices)?;
        Ok(format!("deck_device={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={REMEMBER_SECONDS}{}",if h(headers,"origin").is_some_and(|o|o.starts_with("https://")){"; Secure"}else{""}))
    }
    fn local_devices(&self) -> Result<Vec<Device>> {
        let Some(path) = &self.local_state else { return Ok(vec![]); };
        let dir = root(path)?;
        self.devices_or_new_in(&dir, "local-devices.json")
    }
    fn save_local(&self, devices: &[Device]) -> Result<()> {
        let dir = root(self.local_state.as_deref().ok_or_else(fail)?)?;
        let bytes = serde_json::to_vec(devices).map_err(|_| fail())?;
        if bytes.len() > 1024 * 1024 {
            return Err(fail());
        }
        atomic(&dir, "local-devices.json", &bytes)
    }
    fn remember_local(&self, host: &str) -> Result<String> {
        let mut devices = self.local_devices()?;
        devices.retain(Self::active);
        let token = token();
        devices.push(Device {
            id: format!("{LOCAL_DEVICE_PREFIX}{}", uuid::Uuid::new_v4()),
            name: "Local browser".into(),
            created_at: now_iso(),
            hash: local_digest(&token, host),
            revoked_at: None,
            expires_at: Some(expiry()?),
            tailscale_identity: None,
            extra: Default::default(),
        });
        self.save_local(&devices)?;
        Ok(token)
    }
    fn revoke(&self, id: &str, local: bool) -> Result<()> {
        let mut devices = if local { self.local_devices()? } else { self.devices()? };
        let device = devices.iter_mut().find(|d| d.id == id).ok_or("device-unknown")?;
        device.revoked_at.get_or_insert_with(now_iso);
        if local { self.save_local(&devices) } else { self.save(&devices) }
    }
    fn save(&self, devices: &[Device]) -> Result<()> {
        atomic(
            &self.web()?,
            "devices.json",
            &serde_json::to_vec(devices).map_err(|_| fail())?,
        )
    }
    fn issue(&self, headers: &HeaderMap, name: &str, peer: Option<SocketAddr>) -> Result<Response> {
        let mut ds = self.devices_or_new()?;
        let token = token();
        let id = uuid::Uuid::new_v4().to_string();
        let d = Device {
            id: id.clone(),
            name: name.chars().take(80).collect(),
            created_at: now_iso(),
            hash: crate::tasks::digest(token.as_bytes()),
            revoked_at: None,
            expires_at: None,
            tailscale_identity: self.serve_identity(headers, peer),
            extra: Default::default(),
        };
        let public = json!({"id":d.id,"name":d.name,"createdAt":d.created_at});
        ds.push(d);
        self.save(&ds)?;
        let mut r = Json(json!({"ok":true,"device":public})).into_response();
        r.headers_mut().insert(
            header::SET_COOKIE,
            format!(
                "deck_device={token}; Path=/; HttpOnly; SameSite=Strict{}",
                if h(headers, "origin").is_some_and(|o| o.starts_with("https://")) {
                    "; Secure"
                } else {
                    ""
                }
            )
            .parse()
            .unwrap(),
        );
        Ok(r)
    }
    fn devices_or_new(&self) -> Result<Vec<Device>> {
        let source = root(self.root.as_deref().ok_or_else(fail)?)?;
        use std::os::fd::AsRawFd;
        let p = PathBuf::from(format!("/proc/self/fd/{}/web", source.as_raw_fd()));
        if fs::symlink_metadata(&p).is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound) {
            use std::os::unix::fs::DirBuilderExt;
            fs::DirBuilder::new()
                .mode(0o700)
                .create(p)
                .map_err(|_| fail())?;
        }
        self.devices_or_new_in(&self.web()?, "devices.json")
    }
    fn devices_or_new_in(&self, dir: &File, filename: &str) -> Result<Vec<Device>> {
        use std::os::fd::AsRawFd;
        let p = PathBuf::from(format!("/proc/self/fd/{}/{filename}", dir.as_raw_fd()));
        if fs::symlink_metadata(p).is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound) {
            Ok(vec![])
        } else {
            Self::read_devices(dir, filename)
        }
    }
}
fn root_config(base: &Path) -> Result<File> {
    let f = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY)
        .open(base)
        .map_err(|_| "web-config-unavailable")?;
    open_at(&f, "deck", true)
}
pub(crate) fn atomic(dir: &File, name: &str, b: &[u8]) -> Result<()> {
    use std::os::fd::AsRawFd;
    let dirpath = PathBuf::from(format!("/proc/self/fd/{}", dir.as_raw_fd()));
    let tmp = dirpath.join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&tmp)
            .map_err(|_| fail())?;
        f.write_all(b)
            .and_then(|_| f.sync_all())
            .map_err(|_| fail())?;
        fs::rename(&tmp, dirpath.join(name)).map_err(|_| fail())?;
        dir.sync_all().map_err(|_| fail())
    })();
    let _ = fs::remove_file(tmp);
    result
}
fn token() -> String {
    // 32 random bytes encoded as the original unpadded base64url token.
    let mut b = [0u8; 32];
    File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut b))
        .expect("Operating system randomness unavailable");
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut s = String::new();
    for c in b.chunks(3) {
        let n = ((c[0] as u32) << 16)
            | ((c.get(1).copied().unwrap_or(0) as u32) << 8)
            | c.get(2).copied().unwrap_or(0) as u32;
        s.push(A[((n >> 18) & 63) as usize] as char);
        s.push(A[((n >> 12) & 63) as usize] as char);
        if c.len() > 1 {
            s.push(A[((n >> 6) & 63) as usize] as char)
        }
        if c.len() > 2 {
            s.push(A[(n & 63) as usize] as char)
        }
    }
    s
}
struct Challenge {
    code: String,
    token: String,
    expires: u64,
    attempts: u8,
}
#[derive(Default)]
pub struct Runtime {
    pub identity: Identity,
    challenge: Option<Challenge>,
}
pub async fn browser_device_status(
    axum::extract::State(app): axum::extract::State<App>,
    headers: HeaderMap,
    peer: Option<axum::Extension<axum::extract::ConnectInfo<SocketAddr>>>,
) -> Response {
    let owner = app.history.lock().unwrap();
    let runtime = app.web_identity.lock().unwrap();
    let identity = &runtime.identity;
    let peer = peer.map(|p| p.0.0);
    let device = identity.access(&headers, peer).ok();
    let available = direct_host(&headers, peer).is_some()
        && match &device {
            Some((false, _)) => owner.web_writable().is_ok(),
            _ => identity.local_state.is_some(),
        };
    let expires_at = device.and_then(|(_, d)| d.expires_at);
    Json(json!({"available": available, "remembered": expires_at.is_some(), "expiresAt": expires_at})).into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserDeviceChoice {
    remember: bool,
}

pub async fn change_browser_device(
    axum::extract::State(app): axum::extract::State<App>,
    headers: HeaderMap,
    peer: Option<axum::Extension<axum::extract::ConnectInfo<SocketAddr>>>,
    Json(choice): Json<BrowserDeviceChoice>,
) -> Response {
    let peer = peer.map(|p| p.0.0);
    let Some(host) = direct_host(&headers, peer) else {
        return problem(StatusCode::FORBIDDEN, "request-forbidden", "Browser access can only be changed at this host’s loopback address");
    };
    let owner = app.history.lock().unwrap();
    let runtime = app.web_identity.lock().unwrap();
    let identity = &runtime.identity;
    let result = (|| -> Result<Response> {
        // Revalidate after body extraction and while identity writers are serialized.
        let device = credential(&headers).map(|_| identity.access(&headers, peer)).transpose()
            .map_err(|_| "device-required")?;
        if device.as_ref().is_some_and(|(local, _)| !local) {
            owner.web_writable().map_err(|_| "ownership")?;
        }
        admit()?;
        let mut response = Json(json!({"ok":true})).into_response();
        let response_headers = response.headers_mut();
        if choice.remember {
            match device {
                Some((true, _)) => {}
                Some((false, _)) => {
                    let value = identity.renew_notification_device(&headers, peer)?;
                    response_headers.append(header::SET_COOKIE, value.parse().map_err(|_| fail())?);
                }
                None => {
                    let token = identity.remember_local(host)?;
                    set_cookie(response_headers, &local_cookie_name(&headers).unwrap(), &token, REMEMBER_SECONDS);
                }
            }
        } else if let Some((local, device)) = device {
            identity.revoke(&device.id, local)?;
            let local_name = local_cookie_name(&headers).unwrap();
            expire_cookie(response_headers, if local { &local_name } else { "deck_device" });
        }
        // Never leave a session grant that could mask expiry or revocation.
        app.expire_browser_session(response_headers);
        Ok(response)
    })();
    result.unwrap_or_else(|code| match code {
        "device-required" => problem(StatusCode::FORBIDDEN, code, "Device access ended"),
        "ownership" => problem(StatusCode::CONFLICT, code, "The existing device store is read-only"),
        _ => problem(StatusCode::SERVICE_UNAVAILABLE, code, "Browser access could not be updated"),
    })
}

pub async fn local_access(
    axum::extract::State(app): axum::extract::State<App>,
    headers: HeaderMap,
    peer: Option<axum::extract::Extension<axum::extract::ConnectInfo<SocketAddr>>>,
    Json(body): Json<Value>,
) -> Response {
    // Shared ordering with assignment snapshots and commit: history before identity.
    let owner = app.history.lock().unwrap();
    let runtime = app.web_identity.lock().unwrap();
    let identity = &runtime.identity;
    let peer = peer.map(|p| p.0.0);
    if identity.authorized(&headers, peer) {
        return Json(json!({"ok":true})).into_response();
    }
    if identity.serve_identity(&headers, peer).is_none() {
        return problem(
            StatusCode::FORBIDDEN,
            "request-forbidden",
            "Local access is unavailable",
        );
    }
    if cookie(&headers).is_some() {
        return problem(
            StatusCode::FORBIDDEN,
            "device-revoked",
            "Device access is unavailable",
        );
    }
    if owner.web_writable().is_err() {
        return problem(
            StatusCode::CONFLICT,
            "ownership",
            "Original identity is read-only while its owner is active or unknown",
        );
    }
    match identity.issue(&headers, body["name"].as_str().unwrap_or("Browser"), peer) {
        Ok(r) => r,
        Err(e) => problem(
            StatusCode::SERVICE_UNAVAILABLE,
            e,
            "Device storage is unavailable",
        ),
    }
}
pub async fn pair(
    axum::extract::State(app): axum::extract::State<App>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    // Shared ordering with assignment snapshots and commit: history before identity.
    let owner = app.history.lock().unwrap();
    let mut r = app.web_identity.lock().unwrap();
    let valid = if let Some(c) = r.challenge.as_mut() {
        let v = body["code"]
            .as_str()
            .map(|v| (&c.code, v))
            .or_else(|| body["token"].as_str().map(|v| (&c.token, v)));
        let admitted = c.expires > crate::now() && c.attempts < 5;
        c.attempts = c.attempts.saturating_add(1);
        admitted && v.is_some_and(|(hash, v)| equal(hash, &crate::tasks::digest(v.as_bytes())))
    } else {
        false
    };
    if !valid {
        return problem(
            StatusCode::UNAUTHORIZED,
            "pairing-invalid",
            "Pairing is invalid or expired",
        );
    }
    r.challenge = None;
    if owner.web_writable().is_err() {
        return problem(
            StatusCode::CONFLICT,
            "ownership",
            "Original identity is read-only",
        );
    }
    match r
        .identity
        .issue(&headers, body["name"].as_str().unwrap_or("Browser"), None)
    {
        Ok(r) => r,
        Err(e) => problem(
            StatusCode::SERVICE_UNAVAILABLE,
            e,
            "Device storage is unavailable",
        ),
    }
}
// Native-only management uses the existing launcher admin boundary, never a device cookie.
pub async fn control(
    axum::extract::State(app): axum::extract::State<App>,
    Json(body): Json<Value>,
) -> Response {
    if !app.native_admin(body["admin"].as_str().unwrap_or("")) {
        return problem(
            StatusCode::FORBIDDEN,
            "access_denied",
            "Native launcher authentication required",
        );
    }
    if body["command"] == "stop" {
        app.stop_request.notify_one();
        return Json(json!({"stopping":true})).into_response();
    }
    // Never hold identity while waiting for history: assignment/create snapshots
    // read selected identity while holding history/Store. Keep ownership locked
    // through the device effect, in the same direction as those readers.
    #[cfg(test)]
    { let probe=app.device_history_probe.lock().unwrap().take(); if let Some(probe)=probe { probe(); } }
    let owner = app.history.lock().unwrap();
    let mut runtime = app.web_identity.lock().unwrap();
    let result = (|| -> Result<Value> {
        match body["command"].as_str() {
            Some("devices") => {
                let mut devices = runtime.identity.local_devices()?;
                if runtime.identity.root.is_some() {
                    match runtime.identity.devices() {
                        Ok(original) => devices.extend(original),
                        Err(e) if devices.is_empty() => return Err(e),
                        Err(_) => {}
                    }
                }
                let mut v = serde_json::to_value(devices).map_err(|_| fail())?;
                for d in v.as_array_mut().unwrap() {
                    d.as_object_mut().unwrap().remove("hash");
                    d.as_object_mut().unwrap().remove("tailscaleIdentity");
                }
                Ok(json!({"devices":v}))
            }
            Some("pair") => {
                owner.web_writable().map_err(|_| "ownership")?;
                let code = format!(
                    "{:08}",
                    u32::from_le_bytes(
                        *uuid::Uuid::new_v4().as_bytes().first_chunk::<4>().unwrap()
                    ) % 100000000
                );
                let token = token();
                runtime.challenge = Some(Challenge {
                    code: crate::tasks::digest(code.as_bytes()),
                    token: crate::tasks::digest(token.as_bytes()),
                    expires: crate::now() + 300000,
                    attempts: 0,
                });
                Ok(json!({"code":code,"url":format!("http://{}/#pair={token}",app.host)}))
            }
            Some("revoke") => {
                let id = body["deviceId"].as_str().ok_or("device-unknown")?;
                let local = runtime.identity.local_devices()?.iter().any(|d| d.id == id);
                if !local {
                    owner.web_writable().map_err(|_| "ownership")?;
                }
                runtime.identity.revoke(id, local)?;
                Ok(json!({"ok":true}))
            }
            _ => Err("query-unknown"),
        }
    })();
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => problem(StatusCode::CONFLICT, e, "Device operation unavailable"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        body::{Body, to_bytes},
        extract::{ConnectInfo, State},
        http::Request,
        middleware,
        routing::get,
    };
    use std::{os::unix::fs::PermissionsExt, sync::Arc};
    use tower::ServiceExt;
    const TOKEN: &str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
    struct Fixture {
        _dir: tempfile::TempDir,
        source: PathBuf,
        app: App,
    }
    impl Fixture {
        fn new() -> Self { Self::with_native(None) }
        fn with_native(script: Option<&str>) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let source = dir.path().join("original");
            fs::create_dir(&source).unwrap();
            fs::set_permissions(&source, fs::Permissions::from_mode(0o700)).unwrap();
            fs::create_dir(source.join("web")).unwrap();
            fs::set_permissions(source.join("web"), fs::Permissions::from_mode(0o700)).unwrap();
            let binary = if let Some(script) = script {
                let path = dir.path().join("fake-native");
                let script = script.replace("FIXTURE_SOURCE", &source.to_string_lossy());
                fs::write(&path, script).unwrap();
                fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
                path
            } else { PathBuf::from("/missing/native") };
            let app = App::new(
                crate::Store::open_memory(dir.path().to_str().unwrap()).unwrap(),
                "127.0.0.1:3333".into(),
                binary,
                Some("unavailable".into()),
                "native-admin".into(),
                "deck2 open".into(),
            );
            *app.native_role_root.lock().unwrap() = dir.path().join("native");
            app.browser_identity(Identity {
                assignment_config: None,
                root: Some(source.clone()),
                policy: Policy::default(),
                local_state: None,
            });
            let f = Self {
                _dir: dir,
                source,
                app,
            };
            f.write(json!([{"id":"original-device","name":"Original browser","createdAt":"2026-01-01T00:00:00Z","hash":crate::tasks::digest(TOKEN.as_bytes()),"future":{"retained":true}}]));
            f
        }
        fn write(&self, v: Value) {
            let p = self.source.join("web/devices.json");
            fs::write(&p, serde_json::to_vec(&v).unwrap()).unwrap();
            fs::set_permissions(p, fs::Permissions::from_mode(0o600)).unwrap();
        }
        fn own_source(&self) {
            fs::create_dir(self.source.join("sessions")).unwrap();
            fs::set_permissions(self.source.join("sessions"),fs::Permissions::from_mode(0o700)).unwrap();
            self.app.history_root(Some(self.source.clone()));
            self.app.history.lock().unwrap().adopt(&self._dir.path().join("history.db")).unwrap();
        }
        fn records(&self) -> Value {
            serde_json::from_slice(&fs::read(self.source.join("web/devices.json")).unwrap())
                .unwrap()
        }
        fn headers(&self) -> HeaderMap {
            let mut h = HeaderMap::new();
            h.insert("host", "127.0.0.1:3333".parse().unwrap());
            h.insert("origin", "http://127.0.0.1:3333".parse().unwrap());
            h.insert("cookie", format!("deck_device={TOKEN}").parse().unwrap());
            h
        }
        fn req(&self, path: &str) -> Request<Body> {
            let mut r = Request::builder().uri(path).body(Body::empty()).unwrap();
            *r.headers_mut() = self.headers();
            r.extensions_mut()
                .insert(ConnectInfo("127.0.0.1:1234".parse::<SocketAddr>().unwrap()));
            r
        }
        fn identity(&self) -> Identity {
            self.app.web_identity.lock().unwrap().identity.clone()
        }
    }
    // Protects original identity continuity and the authoritative source, never an imported cache.
    #[tokio::test]
    async fn original_access_reloads_revocation_and_never_falls_back() {
        let f = Fixture::new();
        let router = crate::server::router(f.app.clone());
        assert_eq!(
            router
                .clone()
                .oneshot(f.req("/api/workspace"))
                .await
                .unwrap()
                .status(),
            200
        );
        let mut ds = f.records();
        ds[0]["revokedAt"] = json!(now_iso());
        f.write(ds);
        assert_eq!(
            router
                .clone()
                .oneshot(f.req("/api/workspace"))
                .await
                .unwrap()
                .status(),
            403
        );
        let mut auth = f.req("/auth");
        *auth.method_mut() = Method::POST;
        let cap = f.app.issue_launch();
        *auth.body_mut() = Body::from(cap);
        let r = router.clone().oneshot(auth).await.unwrap();
        let experimental = r.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap();
        let mut request = f.req("/api/workspace");
        request.headers_mut().insert(
            "cookie",
            format!("deck_device={TOKEN}; {experimental}")
                .parse()
                .unwrap(),
        );
        assert_eq!(router.oneshot(request).await.unwrap().status(), 403);
    }
    #[test]
    fn invalid_expired_missing_and_unsafe_records_fail_closed() {
        let f = Fixture::new();
        let original = f.records();
        let identity = f.identity();
        let h = f.headers();
        assert!(identity.authorized(&h, None));
        for value in [
            json!({}),
            json!([{}]),
            {
                let mut v = original.clone();
                v[0]["expiresAt"] = json!("2000-01-01T00:00:00Z");
                v
            },
            {
                let mut v = original.clone();
                v[0]["hash"] = json!("invalid");
                v
            },
            {
                let mut v = original.clone();
                v[0]["expiresAt"] = json!("broken");
                v
            },
            {
                let mut v = original.clone();
                v[0]["tailscaleIdentity"] = json!("broken");
                v
            },
            json!([]),
        ] {
            f.write(value);
            assert!(!identity.authorized(&h, None));
        }
        f.write(original);
        let p = f.source.join("web/devices.json");
        fs::set_permissions(&p, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!identity.authorized(&h, None));
        fs::remove_file(&p).unwrap();
        assert!(!identity.authorized(&h, None));
        std::os::unix::fs::symlink(f.source.join("outside"), p).unwrap();
        assert!(!identity.authorized(&h, None));
    }
    #[test]
    fn exact_origin_proxy_and_serve_binding_rules() {
        let f = Fixture::new();
        let mut i = f.identity();
        let peer = Some("127.0.0.1:1234".parse().unwrap());
        let mut h = f.headers();
        assert!(i.boundary(&h, &Method::POST, "127.0.0.1:3333", peer));
        h.insert("x-forwarded-host", "attacker.example".parse().unwrap());
        assert!(!i.boundary(&h, &Method::POST, "127.0.0.1:3333", peer));
        h.remove("x-forwarded-host");
        i.policy = Policy {
            trusted_proxy: Some("127.0.0.1".into()),
            allowed_origins: vec!["https://deck.tail123.ts.net".into()],
            tailscale_serve_access: true,
            ..Default::default()
        };
        h.insert("host", "deck.tail123.ts.net".parse().unwrap());
        h.insert("origin", "https://deck.tail123.ts.net".parse().unwrap());
        h.insert("x-forwarded-proto", "https".parse().unwrap());
        h.insert(
            "tailscale-user-login",
            "person@example.test".parse().unwrap(),
        );
        assert!(i.boundary(&h, &Method::POST, "127.0.0.1:3333", peer));
        let binding = i.serve_identity(&h, peer).unwrap();
        let mut ds = f.records();
        ds[0]["tailscaleIdentity"] = json!(binding);
        f.write(ds);
        assert!(i.authorized(&h, peer));
        assert!(!i.authorized(&h, Some("192.0.2.1:1234".parse().unwrap())));
        h.insert(
            "tailscale-user-login",
            "someone-else@example.test".parse().unwrap(),
        );
        assert!(!i.authorized(&h, peer));
        h.insert(
            "tailscale-user-login",
            "person@example.test".parse().unwrap(),
        );
        h.insert("x-tailscale-funnel", "true".parse().unwrap());
        assert!(!i.boundary(&h, &Method::GET, "127.0.0.1:3333", peer));
        assert!(!i.authorized(&h, peer));
        i.policy.allow_funnel = true;
        assert!(i.boundary(&h, &Method::GET, "127.0.0.1:3333", peer));
        assert!(!i.authorized(&h, peer));
        h.remove("x-tailscale-funnel");
        h.insert("origin", "https://other.test".parse().unwrap());
        assert!(!i.boundary(&h, &Method::POST, "127.0.0.1:3333", peer));
        h.remove("origin");
        assert!(!i.boundary(&h, &Method::POST, "127.0.0.1:3333", peer));
        assert!(i.boundary(&h, &Method::GET, "127.0.0.1:3333", peer));
    }
    #[tokio::test]
    async fn active_or_unknown_original_owner_blocks_identity_mutations() {
        let f = Fixture::new();
        let before = fs::read(f.source.join("web/devices.json")).unwrap();
        let router = crate::server::router(f.app.clone());
        let mut req = f.req("/api/local-access");
        *req.method_mut() = Method::POST;
        req.headers_mut().remove("cookie");
        req.headers_mut()
            .insert("content-type", "application/json".parse().unwrap());
        *req.body_mut() = Body::from("{}");
        assert_eq!(router.clone().oneshot(req).await.unwrap().status(), 403);
        for cmd in ["pair", "revoke"] {
            let mut req = f.req("/web-control");
            *req.method_mut() = Method::POST;
            req.headers_mut()
                .insert("content-type", "application/json".parse().unwrap());
            *req.body_mut() = Body::from(
                json!({"admin":"native-admin","command":cmd,"deviceId":"original-device"})
                    .to_string(),
            );
            assert_eq!(router.clone().oneshot(req).await.unwrap().status(), 409);
        }
        assert_eq!(fs::read(f.source.join("web/devices.json")).unwrap(), before);
        assert_eq!(
            router
                .oneshot(f.req("/api/workspace"))
                .await
                .unwrap()
                .status(),
            200
        );
        let isolated = Identity::discover(None, true).unwrap();
        assert!(isolated.policy.allowed_origins.is_empty());
        assert!(!isolated.authorized(&f.headers(), None));
    }
    // Real incomplete HTTP body exercises the production router's extraction path.
    #[tokio::test]
    async fn revocation_cancels_inflight_upload_before_effect() {
        let f = Fixture::new();
        let entered = Arc::new(tokio::sync::Notify::new());
        let signal = entered.clone();
        let body = futures_util::stream::once(async move {
            signal.notify_one();
            std::future::pending::<std::result::Result<Vec<u8>, std::io::Error>>().await
        });
        let mut req = f.req("/api/sessions");
        *req.method_mut() = Method::POST;
        req.headers_mut()
            .insert("content-type", "application/json".parse().unwrap());
        *req.body_mut() = Body::from_stream(body);
        let router = crate::server::router(f.app.clone());
        let call = tokio::spawn(router.oneshot(req));
        entered.notified().await;
        f.write(json!([]));
        let r = tokio::time::timeout(std::time::Duration::from_secs(2), call)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(r.status(), 403);
        assert_eq!(f.app.store.lock().unwrap().sessions().unwrap().len(), 1);
    }
    // Released valid JSON must not commit when the source is revoked while extracting it.
    #[tokio::test]
    async fn released_body_revalidates_before_session_commit() {
        let f = Fixture::new();
        let path = f.source.join("web/devices.json");
        let before = f.app.store.lock().unwrap().sessions().unwrap().len();
        let body = futures_util::stream::once(async move {
            fs::write(path, "[]").unwrap();
            Ok::<_, std::io::Error>(serde_json::to_vec(&json!({"api":deck2_shared::API,"id":"released-body-session","title":"Released upload"})).unwrap())
        });
        let mut req = f.req("/api/sessions");
        *req.method_mut() = Method::POST;
        req.headers_mut().insert("content-type", "application/json".parse().unwrap());
        *req.body_mut() = Body::from_stream(body);
        let response = crate::server::router(f.app.clone()).oneshot(req).await.unwrap();
        assert_eq!(response.status(), 403);
        assert_eq!(f.app.store.lock().unwrap().sessions().unwrap().len(), before, "revoked extraction must have no durable effect");
    }
    // Real asynchronous model preparation, followed by revocation at its external edge.
    #[tokio::test]
    async fn async_member_preparation_cannot_commit_after_revocation() {
        for (held, assignment) in [(false,false),(true,false),(true,true)] {
            let probe = if held {
                "pathlib.Path('FIXTURE_SOURCE/entered').write_text(str(os.getpid()));\n  while not pathlib.Path('FIXTURE_SOURCE/release').exists(): time.sleep(.005)\n  result"
            } else {
                "pathlib.Path('FIXTURE_SOURCE/entered').write_text(str(os.getpid()));pathlib.Path('FIXTURE_SOURCE/web/devices.json').write_text('[]');result"
            };
            let script = include_str!("../tests/fake_session_native.py").replace("elif m=='model/list':result", &format!("elif m=='model/list':\n  {probe}"));
            let f = Fixture::with_native(Some(&script));
            f.own_source();
            if assignment {
                let command=serde_json::from_value(json!({"api":deck2_shared::API,"id":"prepared-existing","title":"Existing","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
                f.app.store.lock().unwrap().create_session(&command).unwrap();
            }
            let before = f.app.store.lock().unwrap().sessions().unwrap().len();
            let mut req = f.req(if assignment {"/api/sessions/prepared-existing/assignments"} else {"/api/sessions"});
            *req.method_mut() = Method::POST;
            req.headers_mut().insert("content-type", "application/json".parse().unwrap());
            *req.body_mut() = Body::from(if assignment {json!({"api":deck2_shared::API,"memberId":"lead","assignment":{"runnerId":"codex","modelId":"gpt-6.1-sol","thinking":"high"},"expectedRevision":1})} else {json!({"api":deck2_shared::API,"id":"prepared-session","title":"Prepared session","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})}.to_string());
            let call = tokio::spawn(crate::server::router(f.app.clone()).oneshot(req));
            let entered = f.source.join("entered");
            tokio::time::timeout(std::time::Duration::from_secs(5), async {
                while !entered.exists() { tokio::time::sleep(std::time::Duration::from_millis(5)).await; }
            }).await.expect("real model preparation must be reached");
            if held {
                let revoked=super::control(State(f.app.clone()),Json(json!({"admin":"native-admin","command":"revoke","deviceId":"original-device"}))).await;
                assert_eq!(revoked.status(),StatusCode::OK,"native revocation during held discovery must complete");
            }
            let response = tokio::time::timeout(std::time::Duration::from_secs(5),call).await.unwrap().unwrap().unwrap();
            assert_eq!(response.status(),403);
            assert_eq!(f.app.store.lock().unwrap().sessions().unwrap().len(),before);
            if assignment {assert_eq!(f.app.store.lock().unwrap().session_by_id("prepared-existing").unwrap().contract.unwrap().revision,1);}
            let pid: i32 = fs::read_to_string(entered).unwrap().parse().unwrap();
            tokio::time::timeout(std::time::Duration::from_secs(5),async {
                while unsafe { libc::kill(pid,0) } == 0 { tokio::time::sleep(std::time::Duration::from_millis(5)).await; }
            }).await.expect("cancelled preparation child must be reaped");
            assert!(f.app.active.lock().unwrap().is_empty());
        }
    }
    // ASSIGN81-Q01: compose the actual assignment router and native device
    // control. Channels force the historical lock-cycle interleaving. The parent
    // process bounds a broken synchronous mutex cycle, which async timeout cannot.
    #[test]
    fn assignment_device_control_completes_without_deadlock() {
        use std::{process::Command, time::{Duration,Instant}};
        use std::os::unix::process::CommandExt;
        const CHILD: &str = "DECK2_ASSIGNMENT_LOCK_CHILD";
        if std::env::var_os(CHILD).is_none() {
            for operation in ["revoke","pair"] {
                let mut child=Command::new(std::env::current_exe().unwrap())
                    .args(["--exact","web_identity::tests::assignment_device_control_completes_without_deadlock","--nocapture"])
                    .env(CHILD,operation).process_group(0).spawn().unwrap();
                let deadline=Instant::now()+Duration::from_secs(12);
                loop {
                    if let Some(status)=child.try_wait().unwrap() { assert!(status.success(),"{operation}: composed child failed"); break; }
                    if Instant::now()>deadline {
                        unsafe { libc::kill(-(child.id() as i32),libc::SIGKILL); }
                        child.wait().unwrap();
                        panic!("{operation}: assignment/device control deadlocked at synchronized history/identity boundary");
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
            return;
        }
        let operation=std::env::var(CHILD).unwrap();
        let script=include_str!("../tests/fake_session_native.py").replace("elif m=='model/list':result", "elif m=='model/list':\n  deadline=time.monotonic()+5\n  while not (root/'release-lock-discovery').exists():\n   if time.monotonic()>deadline: raise RuntimeError('discovery deadline')\n   time.sleep(.005)\n  result");
        let f=Fixture::with_native(Some(&script));
        f.own_source();
        let command=serde_json::from_value(json!({"api":deck2_shared::API,"id":"lock-session","title":"Lock boundary","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
        f.app.store.lock().unwrap().create_session(&command).unwrap();
        let before=serde_json::to_value(f.app.store.lock().unwrap().session_by_id("lock-session").unwrap()).unwrap();
        let (held_tx,held_rx)=std::sync::mpsc::channel();
        let (resume_tx,resume_rx)=std::sync::mpsc::channel();
        let (control_tx,control_rx)=std::sync::mpsc::channel();
        *f.app.assignment_probe.lock().unwrap()=Some(Box::new(move || {held_tx.send(()).unwrap();resume_rx.recv().unwrap();}));
        *f.app.device_history_probe.lock().unwrap()=Some(Box::new(move || {control_tx.send(()).unwrap();}));
        let mut req=f.req("/api/sessions/lock-session/assignments");
        *req.method_mut()=Method::POST;
        req.headers_mut().insert("content-type","application/json".parse().unwrap());
        *req.body_mut()=Body::from(json!({"api":deck2_shared::API,"memberId":"lead","assignment":{"runnerId":"codex","modelId":"gpt-6.1-sol","thinking":"high"},"expectedRevision":1}).to_string());
        let router=crate::server::router(f.app.clone());
        // Each future owns one OS thread. Preserve the real concurrent lock
        // interleaving without two machine-sized worker pools in every child.
        let assignment = std::thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(router.oneshot(req))
                .unwrap()
                .status()
        });
        held_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        let app=f.app.clone();let op=operation.clone();
        let control = std::thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(super::control(
                    State(app),
                    Json(json!({"admin":"native-admin","command":op,"deviceId":"original-device"})),
                ))
                .status()
        });
        control_rx.recv_timeout(Duration::from_secs(3)).unwrap();
        resume_tx.send(()).unwrap();
        assert_eq!(control.join().unwrap(),StatusCode::OK,"native device control must finish");
        fs::write(f._dir.path().join("release-lock-discovery"),"release").unwrap();
        let status=assignment.join().unwrap();
        let after=serde_json::to_value(f.app.store.lock().unwrap().session_by_id("lock-session").unwrap()).unwrap();
        if operation=="revoke" {
            assert_eq!(status,StatusCode::FORBIDDEN,"revoked discovery must not commit");
            assert_eq!(before,after,"revocation preserves assignment and generation");
            assert!(f.records()[0]["revokedAt"].is_string());
        } else {
            assert_eq!(status,StatusCode::OK,"pairing must not stall assignment");
            assert_eq!(after["contract"]["revision"],2);
        }
        assert!(!f._dir.path().join("wire").exists(),"discovery never dispatches a native turn");
    }
    // A synchronous durable acceptance must keep its truthful result even if
    // authority is revoked immediately after acceptance, before response delivery.
    #[tokio::test]
    async fn admitted_effect_retains_truthful_response_after_revocation() {
        let f = Fixture::new();
        let source = f.source.clone();
        let route = Router::new().route("/api/accepted", axum::routing::post(move || {
            let source = source.clone();
            async move {
                if let Some(r) = effect_denied() { return r; }
                fs::write(source.join("accepted"), "accepted").unwrap();
                fs::write(source.join("web/devices.json"), "[]").unwrap();
                Json(json!({"accepted":true})).into_response()
            }
        })).layer(middleware::from_fn_with_state(f.app.clone(),crate::server::boundary)).with_state(f.app.clone());
        let mut req=f.req("/api/accepted");*req.method_mut()=Method::POST;
        let response=route.oneshot(req).await.unwrap();assert_eq!(response.status(),200);
        assert_eq!(to_bytes(response.into_body(),100).await.unwrap(),"{\"accepted\":true}");
        assert!(f.source.join("accepted").exists());
        assert!(!f.identity().authorized(&f.headers(),None));
    }
    #[tokio::test]
    async fn revocation_ends_an_actual_response_stream() {
        let f = Fixture::new();
        let ready = Arc::new(tokio::sync::Notify::new());
        let r = ready.clone();
        let route = Router::new()
            .route(
                "/api/stream",
                get(move |State(_): State<App>| {
                    let r = r.clone();
                    async move {
                        let stream = futures_util::stream::once(async {
                            Ok::<_, std::io::Error>("first")
                        })
                        .chain(futures_util::stream::once(async move {
                            r.notify_one();
                            std::future::pending::<std::result::Result<&str, std::io::Error>>()
                                .await
                        }));
                        Body::from_stream(stream)
                    }
                }),
            )
            .layer(middleware::from_fn_with_state(
                f.app.clone(),
                crate::server::boundary,
            ))
            .with_state(f.app.clone());
        let response = route.oneshot(f.req("/api/stream")).await.unwrap();
        let read = tokio::spawn(to_bytes(response.into_body(), 100));
        ready.notified().await;
        f.write(json!([]));
        assert!(
            tokio::time::timeout(std::time::Duration::from_secs(2), read)
                .await
                .unwrap()
                .unwrap()
                .is_err()
        );
    }
    use futures_util::StreamExt;
}
