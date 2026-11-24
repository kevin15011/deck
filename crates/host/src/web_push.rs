//! Original Web Push identity and exact per-occurrence delivery. Network effects
//! use library crypto, a pinned public DNS answer and live device/owner fences.
use crate::{
    notification_store::{Result, Storage},
    server::{App, problem},
};
use axum::{
    Json, Router,
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use rusqlite::{OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::atomic::Ordering,
    time::Duration,
};
const MAX_SAFE: u64 = 9_007_199_254_740_991;
fn failure(_: impl std::fmt::Display) -> String {
    "notification-storage-unavailable".into()
}
fn safe(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && !s.contains("..")
        && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
fn provider_subdomain(host: &str, suffix: &str) -> bool {
    host.strip_suffix(suffix).is_some_and(|prefix| {
        prefix.split('.').all(|label| {
            !label.is_empty()
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
    })
}
fn is_wns(host: &str) -> bool {
    provider_subdomain(host, ".notify.windows.com")
}
fn endpoint(s: &str) -> Result<reqwest::Url> {
    let u = reqwest::Url::parse(s).map_err(|_| "push-subscription-invalid")?;
    let host = u.host_str().unwrap_or("");
    let apple = provider_subdomain(host, ".push.apple.com");
    let wns = is_wns(host);
    if s.len() > 4096
        || s.bytes().any(|b| b.is_ascii_whitespace() || b == b'\\')
        || u.scheme() != "https"
        || !u.username().is_empty()
        || u.password().is_some()
        || u.fragment().is_some()
        || u.port().is_some()
        || (u.path() == "/" && !(wns && u.query().is_some_and(|q| !q.is_empty())))
        || !(host == "fcm.googleapis.com" || host == "updates.push.services.mozilla.com" || apple || wns)
    {
        return Err("push-provider-unsupported".into());
    }
    Ok(u)
}
pub(crate) fn subscription(v: &Value, now: u64) -> Result<()> {
    endpoint(v["endpoint"].as_str().ok_or("push-subscription-invalid")?)?;
    let point = B64
        .decode(
            v["keys"]["p256dh"]
                .as_str()
                .ok_or("push-subscription-invalid")?,
        )
        .map_err(|_| "push-subscription-invalid")?;
    if point.len() != 65
        || p256::PublicKey::from_sec1_bytes(&point).is_err()
        || B64
            .decode(
                v["keys"]["auth"]
                    .as_str()
                    .ok_or("push-subscription-invalid")?,
            )
            .map_err(|_| "push-subscription-invalid")?
            .len()
            != 16
    {
        return Err("push-subscription-invalid".into());
    }
    if let Some(t) = v.get("expirationTime").filter(|t| !t.is_null())
        && t.as_u64().is_none_or(|t| t <= now)
    {
        return Err("push-subscription-expired".into());
    }
    Ok(())
}
pub(crate) fn validate_store(v: &Value) -> Result<()> {
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    let private = B64
        .decode(
            v["keys"]["privateKey"]
                .as_str()
                .ok_or("push-store-invalid")?,
        )
        .map_err(|_| "push-store-invalid")?;
    let key = p256::SecretKey::from_slice(&private).map_err(|_| "push-store-invalid")?;
    if v["v"] != 1
        || v["keys"]["publicKey"] != B64.encode(key.public_key().to_encoded_point(false).as_bytes())
        || !v["subscriptions"].as_array().is_some_and(|a| {
            a.len() <= 128
                && a.iter().all(|r| {
                    r["deviceId"].as_str().is_some_and(safe)
                        && r["origin"].as_str().is_some_and(|s| {
                            reqwest::Url::parse(s)
                                .is_ok_and(|u| u.origin().ascii_serialization() == s)
                        })
                        && r.get("generation")
                            .is_none_or(|n| n.as_u64().is_some_and(|n| n < MAX_SAFE))
                        && subscription(&r["subscription"], 0).is_ok()
                })
        })
    {
        return Err("push-store-invalid".into());
    }
    Ok(())
}
#[derive(Clone)]
struct Presence {
    device: String,
    origin: String,
    session: Option<String>,
    seen: Option<u64>,
    revision: u64,
    until: u64,
}
#[derive(Clone)]
struct Job {
    epoch: String,
    item: Value,
    record: Value,
    key: String,
    expires: u64,
    ack_by: u64,
    retry_at: u64,
    attempts: u8,
}
#[cfg(test)]
type SendOverride = std::sync::Arc<dyn Fn(&Value, &[u8]) -> Result<u16> + Send + Sync>;
#[derive(Default)]
pub struct Runtime {
    storage: Option<Storage>,
    destination: Option<PathBuf>,
    issue: Option<String>,
    tabs: BTreeMap<String, Presence>,
    queue: BTreeMap<String, Job>,
    delivery: BTreeMap<String, Value>,
    // Known uncertain writes stop all further sends until process restart and repair.
    blocked: bool,
    retry_storage_at: u64,
    #[cfg(test)]
    send_override: Option<SendOverride>,
}
fn device_key(record: &Value) -> String {
    json!([record["deviceId"], record["origin"]]).to_string()
}
impl Runtime {
    fn record(&mut self, key: &str, counter: &str, outcome: &str, status: Option<u16>) {
        if !self.delivery.contains_key(key)
            && self.delivery.len() >= 256
            && let Some(first) = self.delivery.keys().next().cloned()
        {
            self.delivery.remove(&first);
        }
        let v=self.delivery.entry(key.into()).or_insert_with(||json!({"eligible":0,"sent":0,"suppressed":0,"deferred":0,"stale":0,"failed":0,"expired":0,"queueFull":0,"retried":0}));
        v[counter] = json!(v[counter].as_u64().unwrap_or(0).saturating_add(1));
        if !outcome.is_empty() {
            v["lastOutcome"] = json!(outcome);
            v["lastStatus"] = json!(status);
        }
    }
    fn ensure(&mut self, app: &App) -> Result<()> {
        if self.blocked {
            return Err("notification-storage-unavailable".into());
        }
        app.history
            .lock()
            .unwrap()
            .web_writable()
            .map_err(|_| "push-history-unavailable")?;
        if self.storage.is_none() {
            let source = app.history_source().ok_or("push-unavailable")?;
            let dest = self.destination.as_deref().ok_or("push-unavailable")?;
            self.storage = Some(Storage::open(&source, dest, crate::now())?);
        }
        // Device/expiration state remains authoritative after adoption. A later
        // credential must not silently revive an old browser subscription.
        let identity = app.web_identity.lock().unwrap().identity.clone();
        let records = self.storage.as_ref().unwrap().push["subscriptions"]
            .as_array()
            .unwrap()
            .clone();
        // An unreadable device store suspends effects; it is not a revocation
        // and must never erase valid adopted subscriptions or display receipts.
        let active_ids = if records.is_empty() {
            std::collections::HashSet::new()
        } else {
            identity
                .active_device_ids(records.iter().filter_map(|r| r["deviceId"].as_str()))
                .map_err(String::from)?
        };
        for r in records {
            let active = active_ids.contains(r["deviceId"].as_str().unwrap());
            if !active || subscription(&r["subscription"], crate::now()).is_err() {
                if !active {
                    let s = self.storage.as_ref().unwrap();
                    let id = r["deviceId"].as_str().unwrap();
                    s.replies
                        .execute_batch("SAVEPOINT revoke_reader")
                        .map_err(failure)?;
                    let result: Result<()> = (|| {
                        s.replies
                            .execute("DELETE FROM pending WHERE deviceId=?1", [id])
                            .map_err(failure)?;
                        s.replies
                            .execute("DELETE FROM displayed WHERE deviceId=?1", [id])
                            .map_err(failure)?;
                        s.replies
                            .execute("DELETE FROM readers WHERE deviceId=?1", [id])
                            .map_err(failure)?;
                        Ok(())
                    })();
                    if result.is_ok() {
                        s.replies
                            .execute_batch("RELEASE revoke_reader")
                            .map_err(failure)?;
                    } else {
                        let _ = s
                            .replies
                            .execute_batch("ROLLBACK TO revoke_reader;RELEASE revoke_reader");
                    }
                    result?;
                }
                self.unsubscribe(
                    r["deviceId"].as_str().unwrap(),
                    r["origin"].as_str().unwrap(),
                )?;
            }
        }
        let records = self.storage.as_ref().unwrap().push["subscriptions"]
            .as_array()
            .unwrap()
            .clone();
        for r in records {
            let s = self.storage.as_mut().unwrap();
            s.add_device(&device_key(&r), crate::now())?;
            s.enroll(r["deviceId"].as_str().unwrap(), crate::now())?;
        }
        self.issue = None;
        Ok(())
    }
    fn current_record(&self, j: &Job) -> bool {
        self.storage.as_ref().is_some_and(|s| {
            s.epoch(&device_key(&j.record)) == Some(j.epoch.as_str())
                && s.push["subscriptions"].as_array().unwrap().iter().any(|r| {
                    r["deviceId"] == j.record["deviceId"] && r["origin"] == j.record["origin"]
                })
        })
    }
    fn latest_record(&self, j: &Job) -> Option<Value> {
        self.storage.as_ref()?.push["subscriptions"]
            .as_array()?
            .iter()
            .find(|r| r["deviceId"] == j.record["deviceId"] && r["origin"] == j.record["origin"])
            .cloned()
    }
    fn viewing(&mut self, j: &Job, now: u64) -> Result<Option<bool>> {
        self.tabs.retain(|_, p| p.until > now);
        let device = j.record["deviceId"].as_str().unwrap();
        let session = j.item["sessionId"].as_str().unwrap();
        if let Some(reply) = j.item["replyId"].as_str()
            && self
                .storage
                .as_ref()
                .unwrap()
                .displayed(device, session, reply)?
        {
            return Ok(Some(true));
        }
        let tabs = self
            .tabs
            .values()
            .filter(|p| {
                p.device == device
                    && p.origin == j.record["origin"]
                    && p.session.as_deref() == Some(session)
            })
            .collect::<Vec<_>>();
        if j.item.get("replyId").is_none()
            && tabs
                .iter()
                .any(|p| p.seen.is_some_and(|s| s >= j.item["seq"].as_u64().unwrap()))
        {
            return Ok(Some(true));
        }
        Ok(if tabs.is_empty() { None } else { Some(false) })
    }
    fn evaluate(&mut self, app: &App, now: u64) -> Result<()> {
        self.ensure(app)?;
        project(app, self.storage.as_mut().unwrap())?;
        let s = self.storage.as_ref().unwrap();
        let records = s.push["subscriptions"].as_array().unwrap().clone();
        if records.is_empty() {
            return Ok(());
        }
        let mut items = attention(app)?;
        // Indexed bounded pages. Already receipted rows do not consume queue space.
        let mut cursor = s
            .replies
            .query_row(
                "SELECT seq FROM rust_reply_scan WHERE singleton=1",
                [],
                |r| r.get::<_, u64>(0),
            )
            .optional()
            .map_err(failure)?
            .unwrap_or(0);
        let initial_cursor = cursor;
        loop {
            let mut q=s.replies.prepare("SELECT replyId,sessionId,completedSeq,ts,id FROM replies r WHERE id>?1 AND ts>=?2 AND NOT EXISTS(SELECT 1 FROM retired_sessions t WHERE t.sessionId=r.sessionId) ORDER BY id LIMIT 32").map_err(failure)?;
            let rows = q
                .query_map(params![cursor, now.saturating_sub(30 * 60_000)], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, u64>(2)?,
                        r.get::<_, u64>(3)?,
                        r.get::<_, u64>(4)?,
                    ))
                })
                .map_err(failure)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(failure)?;
            if rows.is_empty() {
                cursor = 0;
                break;
            }
            for (reply, session, seq, ts, id) in rows {
                cursor = id;
                items.push(json!({"sessionId":session,"kind":"finished","key":reply,"replyId":reply,"revision":1,"seq":seq,"ts":ts}));
            }
            // Bound each evaluation's extraction; indexed scan resumes next tick.
            if items.len() >= 256 {
                break;
            }
        }
        if cursor != initial_cursor {
            s.replies.execute("INSERT INTO rust_reply_scan VALUES (1,?1) ON CONFLICT(singleton) DO UPDATE SET seq=excluded.seq",[cursor]).map_err(failure)?;
        }
        for a in items {
            for r in &records {
                let key = device_key(r);
                let s = self.storage.as_ref().unwrap();
                if !s.eligible(&key, &a, now)? {
                    continue;
                }
                let epoch = s
                    .epoch(&key)
                    .ok_or("notification-storage-unavailable")?
                    .to_owned();
                let job_key =
                    json!([key, epoch, a["sessionId"], a["key"], a["revision"]]).to_string();
                if self.queue.contains_key(&job_key) {
                    continue;
                }
                if self.queue.len() >= 256 {
                    self.record(&key, "queueFull", "queue-full", None);
                    continue;
                }
                self.record(&key, "eligible", "", None);
                self.queue.insert(
                    job_key.clone(),
                    Job {
                        epoch: epoch.to_string(),
                        item: a.clone(),
                        record: r.clone(),
                        key: job_key,
                        expires: now
                            + if a["kind"] == "finished" {
                                120_000
                            } else {
                                600_000
                            },
                        ack_by: now + 2000,
                        retry_at: now,
                        attempts: 0,
                    },
                );
            }
        }
        Ok(())
    }
    fn next(&mut self, app: &App, now: u64) -> Result<Option<Job>> {
        self.evaluate(app, now)?;
        let keys = self.queue.keys().cloned().collect::<Vec<_>>();
        for key in keys {
            let mut j = self.queue.remove(&key).unwrap();
            if let Some(latest) = self.latest_record(&j) {
                j.record = latest;
            }
            let auth = device_key(&j.record);
            if j.retry_at > now {
                self.queue.insert(key, j);
                continue;
            }
            if !authorized_job(app, self, &j) {
                self.record(&auth, "stale", "stale", None);
                continue;
            }
            if !self
                .storage
                .as_ref()
                .unwrap()
                .eligible(&auth, &j.item, now)?
            {
                continue;
            }
            match self.viewing(&j, now)? {
                Some(true) => {
                    self.storage
                        .as_ref()
                        .unwrap()
                        .outcome(&auth, &j.item, "suppressed", now)?;
                    self.record(&auth, "suppressed", "viewed", None);
                    continue;
                }
                Some(false) if now < j.ack_by => {
                    j.retry_at = j.ack_by;
                    self.record(&auth, "deferred", "waiting-for-view", None);
                    self.queue.insert(key, j);
                    continue;
                }
                _ => {}
            }
            if j.expires <= now {
                self.storage
                    .as_ref()
                    .unwrap()
                    .outcome(&auth, &j.item, "failed", now)?;
                self.record(&auth, "expired", "expired", None);
                continue;
            }
            return Ok(Some(j));
        }
        Ok(None)
    }
    fn complete(&mut self, app: &App, mut j: Job, result: Result<u16>, now: u64) -> Result<()> {
        if !authorized_job(app, self, &j) {
            return Ok(());
        }
        let key = device_key(&j.record);
        match result {
            Ok(status) if (200..300).contains(&status) => {
                self.storage
                    .as_ref()
                    .unwrap()
                    .outcome(&key, &j.item, "sent", now)?;
                self.record(&key, "sent", "accepted", Some(status));
            }
            Ok(status)
                if self
                    .latest_record(&j)
                    .is_some_and(|r| r["generation"] != j.record["generation"])
                    && j.attempts < 3 =>
            {
                j.attempts += 1;
                j.retry_at = now + 1000 * (1u64 << j.attempts);
                self.record(&key, "retried", "rejected", Some(status));
                self.queue.insert(j.key.clone(), j);
            }
            Ok(status) if status == 404 || status == 410 => {
                self.unsubscribe(
                    j.record["deviceId"].as_str().unwrap(),
                    j.record["origin"].as_str().unwrap(),
                )?;
                self.record(&key, "failed", "rejected", Some(status));
            }
            other => {
                let status = other.as_ref().ok().copied();
                if (other.is_err() || status == Some(429) || status.is_some_and(|s| s >= 500))
                    && j.attempts < 3
                    && now < j.expires
                {
                    j.attempts += 1;
                    j.retry_at = now + 1000 * (1u64 << j.attempts);
                    self.record(
                        &key,
                        "retried",
                        if status.is_some() {
                            "rejected"
                        } else {
                            "transport-error"
                        },
                        status,
                    );
                    self.queue.insert(j.key.clone(), j);
                } else {
                    self.storage
                        .as_ref()
                        .unwrap()
                        .outcome(&key, &j.item, "failed", now)?;
                    self.record(
                        &key,
                        "failed",
                        if status.is_some() {
                            "rejected"
                        } else {
                            "transport-error"
                        },
                        status,
                    );
                }
            }
        }
        Ok(())
    }
    fn unsubscribe(&mut self, device: &str, origin: &str) -> Result<()> {
        self.queue
            .retain(|_, j| j.record["deviceId"] != device || j.record["origin"] != origin);
        self.tabs
            .retain(|_, p| p.device != device || p.origin != origin);
        let s = self.storage.as_mut().ok_or("push-unavailable")?;
        s.push["subscriptions"]
            .as_array_mut()
            .unwrap()
            .retain(|r| r["deviceId"] != device || r["origin"] != origin);
        s.save_push()?;
        let key = json!([device, origin]).to_string();
        s.attention["devices"]
            .as_array_mut()
            .unwrap()
            .retain(|d| d[0] != key);
        s.save_attention()?;
        Ok(())
    }
}
fn authorized_job(app: &App, runtime: &Runtime, j: &Job) -> bool {
    if app.shutdown_requested.load(Ordering::SeqCst)
        || runtime.blocked
        || !runtime.current_record(j)
    {
        return false;
    }
    // Release each synchronous authority guard before current attention takes
    // history -> Store. Never carry a temporary guard across that projection.
    let owner = app.history.lock().unwrap().web_writable().is_ok();
    let device = app
        .web_identity
        .lock()
        .unwrap()
        .identity
        .active_device(j.record["deviceId"].as_str().unwrap());
    owner && device && current(app, runtime, &j.item)
}

fn current(app: &App, runtime: &Runtime, a: &Value) -> bool {
    if let (Some(session), Some(reply)) = (a["sessionId"].as_str(), a["replyId"].as_str()) {
        return runtime
            .storage
            .as_ref()
            .unwrap()
            .reply(session, reply)
            .is_ok_and(|r| r.is_some());
    }
    attention(app).is_ok_and(|items| {
        items.iter().any(|i| {
            i["sessionId"] == a["sessionId"]
                && i["key"] == a["key"]
                && i["revision"] == a["revision"]
        })
    })
}
pub fn start(app: App, state: PathBuf) {
    app.web_push.lock().unwrap().destination = Some(state.join("notifications"));
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_millis(250));
        loop {
            tick.tick().await;
            if app.shutdown_requested.load(Ordering::SeqCst) {
                break;
            }
            let job = {
                let mut r = app.web_push.lock().unwrap();
                if crate::now() < r.retry_storage_at {
                    continue;
                }
                match r.next(&app, crate::now()) {
                    Ok(j) => j,
                    Err(e) => {
                        if e == "notification-storage-unavailable" && r.storage.is_some() {
                            r.blocked = true;
                        }
                        r.issue = Some(e);
                        r.retry_storage_at = crate::now() + 5000;
                        None
                    }
                }
            };
            let Some(j) = job else {
                continue;
            };
            let private =
                app.web_push.lock().unwrap().storage.as_ref().unwrap().push["keys"]["privateKey"]
                    .as_str()
                    .unwrap()
                    .to_string();
            let send = transport(&app, &j, &private);
            tokio::pin!(send);
            let deadline = tokio::time::sleep(Duration::from_secs(5));
            tokio::pin!(deadline);
            let result = loop {
                tokio::select! {
                    result=&mut send=>break result,
                    _=&mut deadline=>break Err("push-deadline".into()),
                    _=tick.tick()=>{if !authorized_job(&app,&app.web_push.lock().unwrap(),&j){break Err("push-authorization-ended".into());}}
                }
            };
            let mut r = app.web_push.lock().unwrap();
            if let Err(e) = r.complete(&app, j.clone(), result, crate::now()) {
                r.blocked = true;
                r.issue = Some(e);
            }
        }
    });
}
pub(crate) fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || a == 169 && b == 254
                || a == 172 && (16..=31).contains(&b)
                || a == 192 && (b == 168 || b == 0 || b == 2 || b == 88 && c == 99)
                || a == 100 && (64..=127).contains(&b)
                || a == 198 && (b == 18 || b == 19 || b == 51 && c == 100)
                || a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(ip) => {
            let [a, b, ..] = ip.segments();
            (0x2000..0x4000).contains(&a)
                && a != 0x2002
                && a != 0x3ffe
                && a != 0x3fff
                && !(a == 0x2001 && (b <= 0x1ff || b == 0xdb8))
        }
    }
}
async fn transport(app: &App, j: &Job, private: &str) -> Result<u16> {
    let info: web_push::SubscriptionInfo = serde_json::from_value(j.record["subscription"].clone())
        .map_err(|_| "push-payload-error")?;
    subscription(&j.record["subscription"], crate::now())?;
    let url = endpoint(&info.endpoint)?;
    let host = url.host_str().unwrap();
    let request = web_push::request_builder::build_request::<Vec<u8>>(encrypted(j, private)?);
    #[cfg(test)]
    {
        let send = app.web_push.lock().unwrap().send_override.clone();
        if let Some(send) = send {
            return send(&j.item, request.body());
        }
    }
    let addresses = tokio::net::lookup_host((host, 443))
        .await
        .map_err(|_| "push-dns-failed")?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
        return Err("push-destination-forbidden".into());
    }
    if !authorized_job(app, &app.web_push.lock().unwrap(), j) {
        return Err("push-authorization-ended".into());
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .resolve(host, addresses[0])
        .build()
        .map_err(|_| "push-transport-error")?;
    let mut send = client.post(url.clone());
    for (key, val) in request.headers() {
        send = send.header(key.as_str(), val.as_bytes());
    }
    if is_wns(host) {
        send = send.header("X-WNS-Type", "wns/raw");
    }
    Ok(send
        .body(request.into_body())
        .send()
        .await
        .map_err(|_| "push-transport-error")?
        .status()
        .as_u16())
}
fn payload(a: &Value) -> String {
    // Never include prompt, command, file, error or arbitrary native text. Prose
    // summaries remain generic until the original redaction parser is ported.
    let mut v = json!({"sessionId":a["sessionId"],"seq":a["seq"],"kind":if a["kind"]=="decision"{"question"}else{a["kind"].as_str().unwrap_or("failure")},"attention":a["kind"]});
    for k in ["replyId", "approvalId", "tool", "risk"] {
        if let Some(x) = a.get(k) {
            v[k] = x.clone();
        }
    }
    if a["kind"] == "decision" {
        v["tagId"] = json!(B64.encode(&sha2_bytes(a["key"].to_string().as_bytes())[..12]));
    }
    v.to_string()
}
fn sha2_bytes(b: &[u8]) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    Sha256::digest(b).to_vec()
}

// Original Codex adapter policy: only identified MCP tools without effectful
// name markers are normal risk. Native commands/files/permissions stay high.
fn approval_fields(d: &deck2_shared::Decision) -> (String, bool) {
    let Some(native) = &d.native else {
        return ("Tool".into(), false);
    };
    if native.method != "mcpServer/elicitation/request" {
        return ("Tool".into(), false);
    }
    let Ok(p) = serde_json::from_str::<Value>(&native.parameters) else {
        return ("Tool".into(), false);
    };
    let Some(tool) = crate::session_contract::native_tool_name(&p) else {
        return ("Tool".into(), false);
    };
    if p["_meta"]["codex_approval_kind"] != "mcp_tool_call" || p["mode"] != "form" {
        return ("Tool".into(), false);
    }
    let normal = ![
        "exec", "shell", "command", "write", "edit", "patch", "delete", "remove", "fetch",
        "network",
    ]
    .iter()
    .any(|word| tool.to_ascii_lowercase().contains(word));
    let name = format!(
        "mcp__{}__{tool}",
        p["serverName"].as_str().unwrap_or("unknown")
    );
    let public = if name.len() <= 80
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
        && !name.to_ascii_lowercase().contains("secret")
        && !name.contains("sk-")
    {
        name
    } else {
        "Tool".into()
    };
    (public, normal)
}
#[derive(serde::Deserialize)]
#[serde(untagged)]
pub(crate) enum BrowserCommand {
    Submit(deck2_shared::ScopedSubmit),
    Notification(NotificationEnvelope),
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NotificationEnvelope {
    session_id: String,
    command: NotificationCommand,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NotificationCommand {
    v: u32,
    command_id: String,
    #[serde(rename = "type")]
    kind: String,
    approval_id: String,
    decision: String,
    scope: String,
    origin: String,
}
pub(crate) fn notification_command(
    app: &App,
    headers: &HeaderMap,
    peer: Option<SocketAddr>,
    body: NotificationEnvelope,
) -> Response {
    let outcome = (|| -> Result<Value> {
        context(app, headers, peer)?;
        crate::web_identity::admit().map_err(String::from)?;
        if !app.persistence_available() {
            return Err("notification-storage-unavailable".into());
        }
        let owner = app.history.lock().unwrap();
        owner.web_writable()?;
        let c = body.command;
        if c.v != 1
            || c.kind != "approval.respond"
            || c.scope != "once"
            || c.origin != "notification"
            || !["allow", "deny"].contains(&c.decision.as_str())
            || !safe(&body.session_id)
            || !safe(&c.approval_id)
            || !safe(&c.command_id)
        {
            return Err("notification-action-invalid".into());
        }
        let mut store = app.store.lock().unwrap();
        let mut q=store.conn.prepare("SELECT body FROM receipts WHERE json_extract(body,'$.session')=?1 AND EXISTS(SELECT 1 FROM json_each(body,'$.decisions') d WHERE json_extract(d.value,'$.id')=?2) LIMIT 1").map_err(failure)?;
        let receipt: Option<String> = q
            .query_row(params![body.session_id, c.approval_id], |r| r.get(0))
            .optional()
            .map_err(failure)?;
        drop(q);
        let receipt: deck2_shared::Receipt =
            serde_json::from_str(&receipt.ok_or("notification-action-stale")?).map_err(failure)?;
        let d = receipt
            .decisions
            .iter()
            .find(|d| d.id == c.approval_id)
            .ok_or("notification-action-stale")?;
        if !approval_fields(d).1 || !d.questions.is_empty() {
            return Err("notification-action-unavailable".into());
        }
        let response = deck2_shared::Resolve {
            api: deck2_shared::API,
            command_id: c.command_id,
            expected_revision: d.revision,
            response: if c.decision == "allow" {
                deck2_shared::DecisionResponse::AllowOnce
            } else {
                deck2_shared::DecisionResponse::Deny
            },
        };
        crate::web_identity::admit().map_err(String::from)?;
        store
            .resolve(&d.id, &response)
            .map_err(|_| "notification-action-stale")?;
        Ok(json!({"ok":true}))
    })();
    match outcome {
        Ok(v) => Json(v).into_response(),
        Err(e) => problem(
            if e == "device-required" || e == "request-forbidden" {
                StatusCode::FORBIDDEN
            } else {
                StatusCode::CONFLICT
            },
            &e,
            "Notification action was not applied; open Deck",
        ),
    }
}
pub(crate) fn decision_occurrence(
    store: &crate::Store,
    r: &deck2_shared::Receipt,
    d: &deck2_shared::Decision,
) -> Result<Option<(u64, u64)>> {
    let mut stmt = store
        .conn
        .prepare_cached(
            "SELECT seq,json_extract(body,'$.at_ms') FROM session_events WHERE session=?1 AND attempt=?2 AND kind=?3",
        )
        .map_err(failure)?;
    stmt.query_row(
        params![
            r.session,
            r.attempt,
            format!("notification:attention:{}:{}", d.id, d.revision)
        ],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(failure)
}
fn attention(app: &App) -> Result<Vec<Value>> {
    use deck2_shared::{DecisionState, Phase, Receipt};
    let mut trace = crate::latency::Trace::new("web_push_attention");
    let history = trace.lock(&app.history, crate::latency::Lock::History);
    let store = trace.lock(&app.store, crate::latency::Lock::Store);
    let mut q = store
        .conn
        .prepare_cached(
            "SELECT json_extract(body,'$.session'),json_extract(body,'$.phase'),body FROM receipts ORDER BY rowid DESC LIMIT 256",
        )
        .map_err(failure)?;
    let rows = q
        .query_map([], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(failure)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(failure)?;
    drop(q);
    let mut items = vec![];
    let mut latest = std::collections::BTreeSet::new();
    let mut failed_stmt = store
        .conn
        .prepare_cached(
            "SELECT seq,json_extract(body,'$.at_ms') FROM session_events WHERE session=?1 AND attempt=?2 AND kind>='receipt:' AND kind<'receipt;' AND json_extract(body,'$.phase')=?3 ORDER BY seq LIMIT 1",
        )
        .map_err(failure)?;
    for (session, phase, body) in rows {
        let Some(session) = session else { continue };
        let newest = latest.insert(session);
        let active = matches!(
            phase.as_deref(),
            Some("accepted" | "dispatching" | "running" | "cancelling")
        );
        let newest_failed = newest && matches!(phase.as_deref(), Some("failed" | "uncertain"));
        if !active && !newest_failed {
            continue;
        }
        let r: Receipt = serde_json::from_str(&body).map_err(failure)?;
        if store.session_by_id(&r.session).is_err() || r.cancel_requested {
            continue;
        }
        if !r.mode.ordinary() && r.mode != deck2_shared::Mode::SessionV1 {
            continue;
        }
        let offset = history.notification_boundary(&r.session)?;
        if newest && (r.phase == Phase::Failed || r.phase == Phase::Uncertain) {
            let phase = if r.phase == Phase::Failed {
                "failed"
            } else {
                "uncertain"
            };
            let occurrence: Option<(u64, u64)> = failed_stmt
                .query_row(params![r.session, r.attempt, phase], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .optional()
                .map_err(failure)?;
            if let Some((seq, ts)) = occurrence {
                items.push(json!({"sessionId":r.session,"key":format!("lead-failed:{}",r.attempt),"kind":"failure","revision":1,"seq":seq+offset,"ts":ts}));
            }
        }
        if !r.phase.active() {
            continue;
        }
        for d in r
            .decisions
            .iter()
            .filter(|d| d.state == DecisionState::Pending)
        {
            let kind = if d.questions.is_empty() {
                "approval"
            } else {
                "question"
            };
            let Some((seq, ts)) = decision_occurrence(&store, &r, d)? else {
                continue;
            };
            let seq = seq + offset;
            let (tool, normal) = approval_fields(d);
            items.push(json!({"sessionId":r.session,"key":format!("{kind}:{}",d.id),"kind":kind,"revision":d.revision,"seq":seq,"ts":ts,"approvalId":d.id,"tool":tool,"risk":if normal{"normal"}else{"high"}}));
        }
    }
    drop(failed_stmt);
    let mut q = store
        .conn
        .prepare_cached(
            "SELECT session,body FROM session_decisions WHERE json_extract(body,'$.state')='pending' ORDER BY rowid LIMIT 256",
        )
        .map_err(failure)?;
    let rows = q
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(failure)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(failure)?;
    drop(q);
    for (session, body) in rows {
        let d: Value = serde_json::from_str(&body).map_err(failure)?;
        if store.session_by_id(&session).is_err() {
            continue;
        }
        let seq = d["questionSeq"]
            .as_u64()
            .ok_or("decision-sequence-unavailable")?;
        let event: Option<String> = store
            .conn
            .query_row(
                "SELECT body FROM session_events WHERE seq=?1 AND session=?2",
                params![seq, session],
                |r| r.get(0),
            )
            .optional()
            .map_err(failure)?;
        let Some(event) = event else {
            continue;
        };
        let event: Value = serde_json::from_str(&event).map_err(failure)?;
        let Some(ts) = event["at_ms"].as_u64() else {
            continue;
        };
        items.push(json!({"sessionId":session,"kind":"decision","key":format!("decision:{}",d["decisionId"].as_str().unwrap_or("")),"seq":seq+history.notification_boundary(&session)?,"revision":d["questionRevision"],"ts":ts}));
    }
    trace.release();
    Ok(items)
}
fn project(app: &App, s: &mut Storage) -> Result<()> {
    // Read local notification cursor and pending sessions before taking host locks,
    // then release host locks before writing/fsyncing replies.db.
    let after: u64 = s
        .replies
        .query_row("SELECT seq FROM rust_cursor WHERE singleton=1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(failure)?
        .unwrap_or(0);
    let pending: Vec<String> = {
        let mut q = s
            .replies
            .prepare_cached("SELECT DISTINCT sessionId FROM pending LIMIT 4096")
            .map_err(failure)?;
        q.query_map([], |r| r.get::<_, String>(0))
            .map_err(failure)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(failure)?
    };
    let (events, session_meta, retired_pending) = {
        let mut trace = crate::latency::Trace::new("web_push_project");
        let history = trace.lock(&app.history, crate::latency::Lock::History);
        let store = trace.lock(&app.store, crate::latency::Lock::Store);
        let mut q = store
            .conn
            .prepare_cached(
                "SELECT seq,session,task,attempt,kind,body FROM session_events WHERE seq>?1 ORDER BY seq LIMIT 4096",
            )
            .map_err(failure)?;
        let events = q
            .query_map([after], |r| {
                Ok((
                    r.get::<_, u64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                ))
            })
            .map_err(failure)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(failure)?;
        drop(q);
        let mut session_meta: std::collections::HashMap<String, (u64, bool)> =
            std::collections::HashMap::new();
        for (_, session, _, _, _, _) in &events {
            if !session_meta.contains_key(session) {
                let offset = history.notification_boundary(session)?;
                let exists = store.session_by_id(session).is_ok();
                session_meta.insert(session.clone(), (offset, exists));
            }
        }
        let mut retired_pending = Vec::new();
        for session in pending {
            if store.session_by_id(&session).is_err()
                && !history.notification_session_exists(&session)?
            {
                retired_pending.push(session);
            }
        }
        trace.release();
        (events, session_meta, retired_pending)
    };
    if events.is_empty() && retired_pending.is_empty() {
        return Ok(());
    }
    s.replies
        .execute_batch("SAVEPOINT rust_projection")
        .map_err(failure)?;
    let result = (|| {
        for (raw_seq, session, task, attempt, kind, body) in events {
            let &(offset, session_exists) = session_meta
                .get(&session)
                .ok_or("reply-session-meta-missing")?;
            let seq = offset
                .checked_add(raw_seq)
                .ok_or("reply-sequence-overflow")?;
            let body: Value = serde_json::from_str(&body).map_err(failure)?;
            if kind.starts_with("notification:message:") {
                if body["final"] == true {
                    s.replies.execute("INSERT INTO rust_parts VALUES (?1,?2,?3,?4,'') ON CONFLICT(session,task,attempt) DO UPDATE SET seq=MIN(rust_parts.seq,excluded.seq)",params![session,task,attempt,seq]).map_err(failure)?;
                } else {
                    s.replies
                        .execute(
                            "DELETE FROM rust_parts WHERE session=?1 AND task=?2 AND attempt=?3",
                            params![session, task, attempt],
                        )
                        .map_err(failure)?;
                }
            }
            if kind.starts_with("receipt:")
                && ["completed", "failed", "cancelled", "uncertain"]
                    .iter()
                    .any(|p| body["phase"] == *p)
            {
                let part: Option<u64> = s
                    .replies
                    .query_row(
                        "SELECT seq FROM rust_parts WHERE session=?1 AND task=?2 AND attempt=?3",
                        params![session, task, attempt],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(failure)?;
                if body["phase"] == "completed"
                    && let Some(part) = part
                    && session_exists
                {
                    let retired: bool = s
                        .replies
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM retired_sessions WHERE sessionId=?1)",
                            [&session],
                            |r| r.get(0),
                        )
                        .map_err(failure)?;
                    if !retired {
                        let id = format!("reply-{seq}-{part}");
                        let ts = body["at_ms"].as_u64().ok_or("reply-time-missing")?;
                        let inserted=s.replies.execute("INSERT OR IGNORE INTO replies(replyId,sessionId,taskId,attempt,messageSeq,completedSeq,ts,summary) VALUES (?1,?2,?3,?4,?5,?6,?7,'Lead reply available.')",params![id,session,task,body["attemptNumber"].as_u64().unwrap_or(1),part,seq,ts]).map_err(failure)?;
                        let reply: u64 = s
                            .replies
                            .query_row(
                                "SELECT id FROM replies WHERE sessionId=?1 AND replyId=?2",
                                params![session, id],
                                |r| r.get(0),
                            )
                            .optional()
                            .map_err(failure)?
                            .ok_or("reply-row-missing")?;
                        s.replies
                            .execute(
                                "INSERT OR IGNORE INTO reply_messages VALUES (?1,?2,?3)",
                                params![session, part, reply],
                            )
                            .map_err(failure)?;
                        if inserted > 0 {
                            s.replies.execute("INSERT OR IGNORE INTO pending SELECT deviceId,?1,?2 FROM readers WHERE floor<?1 AND since<=?3",params![reply,session,ts]).map_err(failure)?;
                        }
                    }
                }
                s.replies
                    .execute(
                        "DELETE FROM rust_parts WHERE session=?1 AND task=?2 AND attempt=?3",
                        params![session, task, attempt],
                    )
                    .map_err(failure)?;
            }
            s.replies.execute("INSERT INTO rust_cursor VALUES (1,?1) ON CONFLICT(singleton) DO UPDATE SET seq=excluded.seq",[raw_seq]).map_err(failure)?;
        }
        // Session removal is disposition, never a fabricated display receipt.
        for session in retired_pending {
            s.replies
                .execute(
                    "INSERT OR IGNORE INTO retired_sessions VALUES (?1,0)",
                    [&session],
                )
                .map_err(failure)?;
            s.replies
                .execute("DELETE FROM pending WHERE sessionId=?1", [&session])
                .map_err(failure)?;
        }
        Ok(())
    })();
    if result.is_ok() {
        s.replies
            .execute_batch("RELEASE rust_projection")
            .map_err(failure)?;
    } else {
        let _ = s
            .replies
            .execute_batch("ROLLBACK TO rust_projection; RELEASE rust_projection");
    }
    result
}
impl crate::Store {
    pub(crate) fn notification_message(
        &self,
        r: &deck2_shared::Receipt,
        item: &Value,
    ) -> Result<()> {
        if r.mode != deck2_shared::Mode::SessionV1 {
            return Ok(());
        }
        let Some(c) = r
            .configuration
            .as_ref()
            .and_then(|c| c.session_contract.as_ref())
        else {
            return Ok(());
        };
        let id = item["id"].as_str().ok_or("reply-item-missing")?;
        let final_message = item["phase"]
            .as_str()
            .is_none_or(|p| p == "final_answer" || p == "final")
            && item["text"].as_str().is_some_and(|t| !t.trim().is_empty());
        let display_start = item["text"]
            .as_str()
            .and_then(|text| r.text.strip_suffix(text))
            .map(|prefix| prefix.encode_utf16().count());
        self.conn.execute("INSERT OR IGNORE INTO session_events(session,task,attempt,kind,body) VALUES (?1,?2,?3,?4,?5)",params![r.session,c.lead_task,r.attempt,format!("notification:message:{id}"),json!({"final":final_message,"receiptId":r.id,"displayStart":display_start}).to_string()]).map_err(failure)?;
        Ok(())
    }
}
fn context(app: &App, headers: &HeaderMap, peer: Option<SocketAddr>) -> Result<(String, String)> {
    let identity = app.web_identity.lock().unwrap().identity.clone();
    let device = identity.device_id(headers, peer).map_err(String::from)?;
    let host = headers
        .get("host")
        .and_then(|h| h.to_str().ok())
        .ok_or("request-forbidden")?;
    let origin = headers
        .get("origin")
        .and_then(|h| h.to_str().ok())
        .map(String::from)
        .or_else(|| {
            headers
                .get("referer")
                .and_then(|h| h.to_str().ok())
                .and_then(|s| reqwest::Url::parse(s).ok())
                .map(|u| u.origin().ascii_serialization())
        })
        .unwrap_or_else(|| {
            identity
                .policy
                .allowed_origins
                .iter()
                .find(|o| o.split_once("://").is_some_and(|(_, h)| h == host))
                .cloned()
                .unwrap_or_else(|| format!("http://{host}"))
        });
    let valid = origin == format!("http://127.0.0.1:{}", app.host.rsplit(':').next().unwrap())
        || origin == format!("http://localhost:{}", app.host.rsplit(':').next().unwrap())
        || identity.policy.allowed_origins.contains(&origin);
    if !valid || origin.split_once("://").map(|(_, h)| h) != Some(host) {
        return Err("request-forbidden".into());
    }
    Ok((device, origin))
}
fn response_for(app: &App, result: Result<Value>) -> Response {
    if result
        .as_ref()
        .is_err_and(|e| e == "notification-storage-unavailable")
    {
        let mut r = app.web_push.lock().unwrap();
        r.blocked = true;
        r.issue = Some("notification-storage-unavailable".into());
    }
    response(result)
}
fn response(result: Result<Value>) -> Response {
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => problem(
            if e == "device-required" || e == "request-forbidden" {
                StatusCode::FORBIDDEN
            } else if e.starts_with("push-subscription")
                || e == "push-provider-unsupported"
                || e == "push-presence-invalid"
                || e == "reply-receipt-invalid"
            {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            },
            &e,
            "Notification request could not be completed",
        ),
    }
}
async fn status(
    State(app): State<App>,
    headers: HeaderMap,
    peer: Option<axum::Extension<ConnectInfo<SocketAddr>>>,
) -> Response {
    response_for(
        &app,
        (|| {
            let (device, origin) = context(&app, &headers, peer.map(|p| p.0.0))?;
            crate::web_identity::admit().map_err(String::from)?;
            let mut r = app.web_push.lock().unwrap();
            r.ensure(&app)?;
            let key = json!([device, origin]).to_string();
            let s = r.storage.as_ref().unwrap();
            Ok(
                json!({"ok":true,"enabled":s.push["subscriptions"].as_array().unwrap().iter().any(|s|s["deviceId"]==device&&s["origin"]==origin),"publicKey":s.push["keys"]["publicKey"],"delivery":r.delivery.get(&key).cloned().unwrap_or(json!({"eligible":0,"sent":0,"suppressed":0,"failed":0})),"actionsAvailable":true}),
            )
        })(),
    )
}
async fn subscribe(
    State(app): State<App>,
    headers: HeaderMap,
    peer: Option<axum::Extension<ConnectInfo<SocketAddr>>>,
    Json(body): Json<Value>,
) -> Response {
    let mut renewed = None;
    let mut response = response_for(
        &app,
        (|| {
            let (device, origin) = context(&app, &headers, peer.as_ref().map(|p| p.0.0))?;
            crate::web_identity::admit().map_err(String::from)?;
            subscription(&body["subscription"], crate::now())?;
            let mut r = app.web_push.lock().unwrap();
            r.ensure(&app)?;
            let s = r.storage.as_mut().unwrap();
            let records = s.push["subscriptions"].as_array_mut().unwrap();
            let old = records
                .iter()
                .position(|r| r["deviceId"] == device && r["origin"] == origin);
            if body["renew"] == true && old.is_none() {
                return Err("push-not-enabled".into());
            }
            if records.iter().any(|r| {
                r["subscription"]["endpoint"] == body["subscription"]["endpoint"]
                    && (r["deviceId"] != device || r["origin"] != origin)
            }) {
                return Err("push-subscription-owned".into());
            }
            if old.is_none() && records.len() >= 128 {
                return Err("push-subscription-limit".into());
            }
            let generation = old
                .map(|i| records[i]["generation"].as_u64().unwrap_or(0) + 1)
                .unwrap_or(0);
            let key = json!([device, origin]).to_string();
            crate::web_identity::admit().map_err(String::from)?;
            renewed = Some(
                app.web_identity
                    .lock()
                    .unwrap()
                    .identity
                    .renew_notification_device(&headers, peer.as_ref().map(|p| p.0.0))
                    .map_err(String::from)?,
            );
            let epoch = s.add_device(&key, crate::now())?;
            let record = json!({"deviceId":device,"origin":origin,"subscription":body["subscription"],"epoch":epoch,"generation":generation});
            if let Some(i) = old {
                s.push["subscriptions"][i] = record;
            } else {
                s.push["subscriptions"].as_array_mut().unwrap().push(record);
            }
            s.save_push()?;
            s.enroll(&device, crate::now())?;
            Ok(json!({"ok":true}))
        })(),
    );
    if response.status().is_success()
        && let Some(cookie) = renewed
    {
        response
            .headers_mut()
            .insert(axum::http::header::SET_COOKIE, cookie.parse().unwrap());
    }
    response
}
async fn unsubscribe(
    State(app): State<App>,
    headers: HeaderMap,
    peer: Option<axum::Extension<ConnectInfo<SocketAddr>>>,
) -> Response {
    response_for(
        &app,
        (|| {
            let (device, origin) = context(&app, &headers, peer.map(|p| p.0.0))?;
            crate::web_identity::admit().map_err(String::from)?;
            let mut r = app.web_push.lock().unwrap();
            r.ensure(&app)?;
            r.unsubscribe(&device, &origin)?;
            Ok(json!({"ok":true}))
        })(),
    )
}
async fn presence(
    State(app): State<App>,
    headers: HeaderMap,
    peer: Option<axum::Extension<ConnectInfo<SocketAddr>>>,
    Json(body): Json<Value>,
) -> Response {
    response_for(
        &app,
        (|| {
            let (device, origin) = context(&app, &headers, peer.map(|p| p.0.0))?;
            crate::web_identity::admit().map_err(String::from)?;
            let tab = body["tabId"]
                .as_str()
                .filter(|s| safe(s))
                .ok_or("push-presence-invalid")?;
            let session = if body["sessionId"].is_null() {
                None
            } else {
                Some(
                    body["sessionId"]
                        .as_str()
                        .filter(|s| safe(s))
                        .ok_or("push-presence-invalid")?
                        .to_string(),
                )
            };
            let mut r = app.web_push.lock().unwrap();
            r.ensure(&app)?;
            let now = crate::now();
            r.tabs.retain(|_, p| p.until > now);
            let key = json!([device, origin, tab]).to_string();
            let old = r.tabs.get(&key);
            let revision = body
                .get("revision")
                .map(|v| {
                    v.as_u64()
                        .filter(|n| *n > 0 && *n <= MAX_SAFE)
                        .ok_or("push-presence-invalid")
                })
                .transpose()?
                .unwrap_or(old.map(|p| p.revision + 1).unwrap_or(1));
            let seen = body
                .get("seenSeq")
                .map(|s| {
                    s.as_u64()
                        .filter(|n| *n <= MAX_SAFE)
                        .ok_or("push-presence-invalid")
                })
                .transpose()?;
            if old.is_some_and(|p| revision <= p.revision) {
                return Ok(json!({"ok":true}));
            }
            if old.is_none() && r.tabs.values().filter(|p| p.device == device).count() >= 16 {
                return Err("push-presence-limit".into());
            }
            if let (Some(session), Some(seq)) = (&session, seen) {
                let s = r.storage.as_mut().unwrap();
                let auth = json!([device, origin]).to_string();
                if let Some(d) = s.attention["devices"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|d| d[0] == auth)
                {
                    let viewed = d[1]["viewed"].as_array_mut().unwrap();
                    if let Some(v) = viewed.iter_mut().find(|v| v[0] == *session) {
                        if v[1].as_u64().unwrap_or(0) < seq {
                            v[1] = json!(seq);
                        }
                    } else {
                        viewed.push(json!([session, seq]));
                        if viewed.len() > 64 {
                            viewed.remove(0);
                        }
                    }
                    s.save_attention()?;
                }
            }
            r.tabs.insert(
                key,
                Presence {
                    device,
                    origin,
                    session,
                    seen,
                    revision,
                    until: now + 45_000,
                },
            );
            Ok(json!({"ok":true}))
        })(),
    )
}
#[derive(Default, Deserialize)]
struct ReplyQuery {
    cursor: Option<u64>,
}
async fn replies(
    State(app): State<App>,
    headers: HeaderMap,
    peer: Option<axum::Extension<ConnectInfo<SocketAddr>>>,
    Query(q): Query<ReplyQuery>,
) -> Response {
    reply_list(
        &app,
        &headers,
        peer.map(|p| p.0.0),
        None,
        q.cursor.unwrap_or(0),
    )
}
async fn session_replies(
    State(app): State<App>,
    Path(session): Path<String>,
    headers: HeaderMap,
    peer: Option<axum::Extension<ConnectInfo<SocketAddr>>>,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
) -> Response {
    let url =
        reqwest::Url::parse(&format!("http://fixture/?{}", query.unwrap_or_default())).unwrap();
    let values = url.query_pairs().collect::<Vec<_>>();
    if values
        .iter()
        .any(|(k, _)| k == "messageSeq" || k == "commandId")
    {
        let precheck = (|| -> Result<(String, Vec<(String, String)>)> {
            let (device, _) = context(&app, &headers, peer.map(|p| p.0.0))?;
            crate::web_identity::admit().map_err(String::from)?;
            if values.len() > 120
                || values.iter().any(|(k, v)| {
                    !(k == "messageSeq"
                        && v.parse::<u64>().is_ok_and(|n| n > 0 && n <= MAX_SAFE)
                        || k == "commandId" && safe(v))
                })
            {
                return Err("reply-receipt-invalid".into());
            }
            Ok((
                device,
                values
                    .into_iter()
                    .map(|(k, v)| (k.into_owned(), v.into_owned()))
                    .collect(),
            ))
        })();
        let (device, owned_values) = match precheck {
            Ok(v) => v,
            Err(e) => return response_for(&app, Err(e)),
        };
        let worker_app = app.clone();
        let worker_session = session.clone();
        let outcome = tokio::task::spawn_blocking(move || -> Result<Value> {
            let mut requested = vec![];
            {
                let mut trace = crate::latency::Trace::new("web_push_replies");
                let history = trace.lock(&worker_app.history, crate::latency::Lock::History);
                let store = trace.lock(&worker_app.store, crate::latency::Lock::Store);
                let offset = history.notification_boundary(&worker_session)?;
                let mut q = store
                    .conn
                    .prepare_cached(
                        "SELECT seq,body FROM session_events e \
                         WHERE session=?1 \
                           AND kind>='notification:message:' AND kind<'notification:message;' \
                           AND json_extract(body,'$.receiptId')=?2 \
                           AND json_extract(body,'$.final')=1 \
                           AND seq>COALESCE((SELECT MAX(seq) FROM session_events \
                             WHERE session=?1 \
                               AND kind>='notification:message:' AND kind<'notification:message;' \
                               AND json_extract(body,'$.receiptId')=?2 \
                               AND json_extract(body,'$.final')=0),0) \
                         ORDER BY seq LIMIT 1",
                    )
                    .map_err(failure)?;
                for (k, v) in &owned_values {
                    if k == "messageSeq" {
                        requested.push((v.parse::<u64>().unwrap(), None, None));
                    } else {
                        let event: Option<(u64, String)> = q
                            .query_row(params![worker_session, v.as_str()], |r| {
                                Ok((r.get(0)?, r.get(1)?))
                            })
                            .optional()
                            .map_err(failure)?;
                        if let Some((seq, body)) = event {
                            let body: Value = serde_json::from_str(&body).map_err(failure)?;
                            requested.push((
                                seq + offset,
                                Some(v.clone()),
                                body["displayStart"].as_u64(),
                            ));
                        }
                    }
                }
                trace.release();
            }
            let mut runtime = worker_app.web_push.lock().unwrap();
            runtime.ensure(&worker_app)?;
            let s = runtime.storage.as_ref().unwrap();
            s.enroll(&device, crate::now())?;
            let mut replies = vec![];
            let mut q = s
                .replies
                .prepare_cached(
                    "SELECT r.replyId FROM reply_messages m \
                     JOIN replies r ON r.id=m.reply \
                     JOIN pending p ON p.reply=r.id AND p.deviceId=?1 \
                     WHERE m.sessionId=?2 AND m.seq=?3 \
                       AND NOT EXISTS(SELECT 1 FROM retired_sessions t WHERE t.sessionId=r.sessionId)",
                )
                .map_err(failure)?;
            for (seq, command, display_start) in requested {
                let ids = q
                    .query_map(params![device, worker_session, seq], |r| {
                        r.get::<_, String>(0)
                    })
                    .map_err(failure)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(failure)?;
                for id in ids {
                    if let Some(mut reply) = s.reply(&worker_session, &id)? {
                        reply["displayMessageSeq"] = json!(seq);
                        if let Some(command) = &command {
                            reply["commandId"] = json!(command);
                            reply["displayStart"] = json!(display_start);
                        }
                        replies.push(reply);
                    }
                }
            }
            Ok(json!({"ok":true,"replies":replies,"syncing":false}))
        })
        .await
        .map_err(|_| "notification-storage-unavailable".to_string())
        .and_then(|res| {
            crate::web_identity::admit().map_err(String::from)?;
            res
        });
        return response_for(&app, outcome);
    }
    if values.len() > 1
        || values
            .iter()
            .any(|(k, v)| k != "cursor" || v.parse::<u64>().map_or(true, |n| n > MAX_SAFE))
    {
        return response(Err("reply-receipt-invalid".into()));
    }
    let cursor = values
        .first()
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    reply_list(&app, &headers, peer.map(|p| p.0.0), Some(&session), cursor)
}
fn reply_list(
    app: &App,
    headers: &HeaderMap,
    peer: Option<SocketAddr>,
    session: Option<&str>,
    cursor: u64,
) -> Response {
    response_for(
        app,
        (|| {
            if cursor > MAX_SAFE {
                return Err("reply-receipt-invalid".into());
            }
            let (device, _) = context(app, headers, peer)?;
            crate::web_identity::admit().map_err(String::from)?;
            let mut r = app.web_push.lock().unwrap();
            r.ensure(app)?;
            let s = r.storage.as_ref().unwrap();
            s.enroll(&device, crate::now())?;
            s.list(&device, session, cursor)
        })(),
    )
}
async fn reply(
    State(app): State<App>,
    Path((session, id)): Path<(String, String)>,
    headers: HeaderMap,
    peer: Option<axum::Extension<ConnectInfo<SocketAddr>>>,
) -> Response {
    response_for(
        &app,
        (|| {
            context(&app, &headers, peer.map(|p| p.0.0))?;
            let mut r = app.web_push.lock().unwrap();
            r.ensure(&app)?;
            Ok(
                json!({"ok":true,"reply":r.storage.as_ref().unwrap().reply(&session,&id)?.ok_or("reply-unknown")?}),
            )
        })(),
    )
}
async fn displayed(
    State(app): State<App>,
    Path((session, id)): Path<(String, String)>,
    headers: HeaderMap,
    peer: Option<axum::Extension<ConnectInfo<SocketAddr>>>,
    Json(body): Json<Value>,
) -> Response {
    response_for(
        &app,
        (|| {
            let (device, _) = context(&app, &headers, peer.map(|p| p.0.0))?;
            crate::web_identity::admit().map_err(String::from)?;
            if body != json!({"displayed":true}) {
                return Err("reply-receipt-invalid".into());
            }
            let mut r = app.web_push.lock().unwrap();
            r.ensure(&app)?;
            let s = r.storage.as_ref().unwrap();
            s.enroll(&device, crate::now())?;
            s.acknowledge(&device, &session, &id)?;
            Ok(json!({"ok":true}))
        })(),
    )
}
pub fn routes() -> Router<App> {
    Router::new()
        .route("/api/push", get(status).post(subscribe).delete(unsubscribe))
        .route("/api/push/presence", post(presence))
        .route("/api/replies", get(replies))
        .route("/api/sessions/{session}/replies", get(session_replies))
        .route(
            "/api/sessions/{session}/replies/{reply}",
            get(reply).post(displayed),
        )
        .layer(axum::extract::DefaultBodyLimit::max(8192))
}

fn encrypted(j: &Job, private: &str) -> Result<web_push::WebPushMessage> {
    let info: web_push::SubscriptionInfo = serde_json::from_value(j.record["subscription"].clone())
        .map_err(|_| "push-payload-error")?;
    let payload = payload(&j.item);
    let mut sig = web_push::VapidSignatureBuilder::from_base64(private, &info)
        .map_err(|_| "push-payload-error")?;
    sig.add_claim("sub", "https://github.com/kevin15011/deck");
    let mut builder = web_push::WebPushMessageBuilder::new(&info);
    builder.set_payload(web_push::ContentEncoding::Aes128Gcm, payload.as_bytes());
    builder.set_vapid_signature(sig.build().map_err(|_| "push-payload-error")?);
    builder.set_ttl(if j.item["kind"] == "finished" {
        120
    } else {
        600
    });
    builder.set_urgency(web_push::Urgency::Normal);
    builder.set_topic(
        crate::tasks::digest(
            json!([j.item["sessionId"], j.item["key"], j.item["revision"]])
                .to_string()
                .as_bytes(),
        )[..32]
            .into(),
    );
    builder.build().map_err(|_| "push-payload-error".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use std::os::unix::fs::PermissionsExt;
    use tower::ServiceExt;
    fn write(p: &std::path::Path, v: Value) {
        std::fs::write(p, v.to_string()).unwrap();
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    fn mkdir(p: &std::path::Path) {
        std::fs::create_dir_all(p).unwrap();
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    async fn fixture() -> (tempfile::TempDir, App, String, crate::test_clock::Guard) {
        // Tokio's default test runtime and its spawned native tasks use this
        // thread. The guard restores the clock when this fixture is dropped.
        let clock = crate::test_clock::scoped();
        let t = tempfile::tempdir().unwrap();
        let source = t.path().join("original");
        let state = t.path().join("state");
        mkdir(&source);
        mkdir(&state);
        mkdir(&source.join("sessions"));
        mkdir(&source.join("web"));
        write(&source.join("projects.json"), json!({"v":1,"projects":[]}));
        let token = "A".repeat(43);
        write(
            &source.join("web/devices.json"),
            json!([{"id":"browser","name":"Fixture","createdAt":"2026-01-01T00:00:00Z","hash":crate::tasks::digest(token.as_bytes())}]),
        );
        let fake = t.path().join("codex");
        let script=include_str!("../tests/fake_session_native.py").replace("  out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':turn,'delta':'Connected reply'}})","  out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':turn,'delta':'Connected reply'}})\n  out({'method':'item/completed','params':{'threadId':thread,'turnId':turn,'item':{'type':'agentMessage','id':'final-message','phase':'final_answer','text':'Connected reply'}}})");
        std::fs::write(&fake, script).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o700)).unwrap();
        let app = App::new(
            crate::Store::open(&state.join("state.db"), t.path().to_str().unwrap()).unwrap(),
            "127.0.0.1:32123".into(),
            fake,
            None,
            "admin".into(),
            "recover".into(),
        );
        *app.native_role_root.lock().unwrap() = t.path().join("native-role");
        *app.scope_root.lock().unwrap() = Some(t.path().join("scopes"));
        app.history_root(Some(source.clone()));
        app.browser_identity(crate::web_identity::Identity::discover(Some(source), true).unwrap());
        app.adopt_history(state.join("history.db")).await;
        app.web_push.lock().unwrap().destination = Some(state.join("notifications"));
        (t, app, token, clock)
    }
    fn sub() -> Value {
        use p256::elliptic_curve::sec1::ToEncodedPoint;
        let key = p256::SecretKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
        json!({"endpoint":"https://fcm.googleapis.com/fcm/send/synthetic-never-network","keys":{"p256dh":B64.encode(key.public_key().to_encoded_point(false).as_bytes()),"auth":B64.encode([7u8;16])}})
    }
    async fn call(
        app: &App,
        token: &str,
        method: &str,
        url: &str,
        body: Value,
    ) -> (StatusCode, Value) {
        let response = crate::server::router(app.clone())
            .oneshot(
                Request::builder()
                    .uri(url)
                    .method(method)
                    .header("host", &app.host)
                    .header("origin", format!("http://{}", app.host))
                    .header("cookie", format!("deck_device={token}"))
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
    }
    #[tokio::test]
    async fn push_status_reports_unavailable_history_owner() {
        let (_dir, app, token, _clock) = fixture().await;
        *app.history.lock().unwrap() = Default::default();
        let (status, body) = call(&app, &token, "GET", "/api/push", Value::Null).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["code"], "push-history-unavailable");
    }
    #[tokio::test]
    async fn push_registration_accepts_public_browser_providers() {
        let (_dir, app, token, _clock) = fixture().await;
        let (status, body) = call(&app, &token, "GET", "/api/push", Value::Null).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["enabled"], false);
        for url in [
            "https://wns2-ln2p.notify.windows.com/w/?token=fixture",
            "https://fcm.googleapis.com/send/fixture",
            "https://updates.push.services.mozilla.com/wpush/v2/fixture",
            "https://web.push.apple.com/fixture",
        ] {
            let mut subscription = sub();
            subscription["endpoint"] = json!(url);
            let (status, body) = call(
                &app,
                &token,
                "POST",
                "/api/push",
                json!({"subscription": subscription}),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{url}: {body}");
        }
        let (status, body) = call(&app, &token, "GET", "/api/push", Value::Null).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["enabled"], true);
    }
    // Oracle: public/private destination partitions match original policy, and
    // malformed peer keys/expired subscriptions fail before any external effect.
    #[test]
    fn destination_and_subscription_validation_fail_closed() {
        for ip in [
            "127.0.0.1",
            "10.2.3.4",
            "100.64.0.2",
            "169.254.1.1",
            "198.51.100.2",
            "203.0.113.2",
            "::1",
            "::ffff:8.8.8.8",
            "2001:db8::1",
            "2002::1",
            "3fff::1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "2606:4700:4700::1111"] {
            assert!(public_ip(ip.parse().unwrap()));
        }
        let original = sub();
        assert!(subscription(&original, 100).is_ok());
        for endpoint in [
            "http://fcm.googleapis.com/send/x",
            "https://localhost/x",
            "https://fcm.googleapis.com.evil.test/x",
            "https://fcm.googleapis.com:444/x",
            "https://user@fcm.googleapis.com/x",
            "https://fcm.googleapis.com/x#fragment",
            "https://fcm.googleapis.com/",
            "http://wns2-ln2p.notify.windows.com/w/?token=fixture",
            "https://wns2-ln2p.notify.windows.com.evil.test/w/",
            "https://fake-notify.windows.com/w/",
            "https://wns2-ln2p.notify.windows.com:444/w/",
            "https://user@wns2-ln2p.notify.windows.com/w/",
            "https://wns2-ln2p.notify.windows.com/w/#fragment",
        ] {
            let mut s = original.clone();
            s["endpoint"] = json!(endpoint);
            assert!(subscription(&s, 100).is_err(), "{endpoint}");
        }
        let mut bad = original.clone();
        bad["keys"]["p256dh"] = json!(B64.encode([0u8; 65]));
        assert!(subscription(&bad, 100).is_err());
        let mut expired = original;
        expired["expirationTime"] = json!(99);
        assert!(subscription(&expired, 100).is_err());
    }
    // Oracle: a real normal-session native final (not commentary) projects one
    // stable reply through default App/HTTP composition into library-encrypted
    // injected transport, and exact display suppresses only that occurrence.
    #[tokio::test]
    async fn native_final_reply_encryption_delivery_and_exact_display() {
        let (_t, app, token, _clock) = fixture().await;
        assert_eq!(
            call(&app, &token, "GET", "/api/push", Value::Null).await.0,
            StatusCode::OK
        );
        assert_eq!(
            call(
                &app,
                &token,
                "POST",
                "/api/push",
                json!({"subscription":sub()})
            )
            .await
            .0,
            StatusCode::OK
        );
        let c:deck2_shared::SessionCommand=serde_json::from_value(json!({"api":deck2_shared::API,"id":"notification-session","title":"Session","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
        app.store.lock().unwrap().create_session(&c).unwrap();
        let submit:deck2_shared::ScopedSubmit=serde_json::from_value(json!({"api":deck2_shared::API,"id":"notification-command","session":c.id,"prompt":"Remember and continue","mode":"session_v1","fresh":false})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let (_tx, rx) = tokio::sync::watch::channel(false);
        crate::native::run(app.clone(), submit.id.clone(), app.binary.clone(), rx).await;
        assert_eq!(
            app.receipt(&submit.id).unwrap().phase,
            deck2_shared::Phase::Completed
        );
        let job = app
            .web_push
            .lock()
            .unwrap()
            .next(&app, crate::now())
            .unwrap()
            .expect("new final reply must be eligible");
        let private =
            app.web_push.lock().unwrap().storage.as_ref().unwrap().push["keys"]["privateKey"]
                .as_str()
                .unwrap()
                .to_string();
        let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let out = captured.clone();
        app.web_push.lock().unwrap().send_override =
            Some(std::sync::Arc::new(move |payload, body| {
                out.lock().unwrap().push((payload.clone(), body.to_vec()));
                Ok(201)
            }));
        let status = transport(&app, &job, &private).await.unwrap();
        assert_eq!(status, 201);
        app.web_push
            .lock()
            .unwrap()
            .complete(&app, job.clone(), Ok(status), crate::now())
            .unwrap();
        {
            let captured = captured.lock().unwrap();
            assert_eq!(captured.len(), 1);
            assert!(!String::from_utf8_lossy(&captured[0].1).contains("Connected reply"));
            assert!(captured[0].1.len() > 100);
        }
        assert!(
            app.web_push
                .lock()
                .unwrap()
                .next(&app, crate::now())
                .unwrap()
                .is_none()
        );
        let (status, page) = call(
            &app,
            &token,
            "GET",
            "/api/sessions/notification-session/replies?commandId=notification-command",
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(page["replies"].as_array().unwrap().len(), 1);
        assert_eq!(page["replies"][0]["displayStart"], 0);
        let id = page["replies"][0]["replyId"].as_str().unwrap();
        let (status, _) = call(
            &app,
            &token,
            "POST",
            &format!("/api/sessions/notification-session/replies/{id}"),
            json!({"displayed":true}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            app.web_push
                .lock()
                .unwrap()
                .storage
                .as_ref()
                .unwrap()
                .displayed("browser", "notification-session", id)
                .unwrap()
        );
        assert_eq!(
            call(&app, &token, "GET", "/api/replies", Value::Null)
                .await
                .1["total"],
            0
        );
        assert_eq!(
            call(&app, &"B".repeat(43), "GET", "/api/push", Value::Null)
                .await
                .0,
            StatusCode::FORBIDDEN
        );
        app.shutdown();
    }
    async fn waiting_reply(app: &App, token: &str) -> (String, u64) {
        assert_eq!(
            call(
                app,
                token,
                "POST",
                "/api/push",
                json!({"subscription":sub()})
            )
            .await
            .0,
            StatusCode::OK
        );
        let c:deck2_shared::SessionCommand=serde_json::from_value(json!({"api":deck2_shared::API,"id":"notification-waiting","title":"Waiting","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
        app.store.lock().unwrap().create_session(&c).unwrap();
        let now = crate::now();
        let mut r = app.web_push.lock().unwrap();
        r.ensure(app).unwrap();
        let s = r.storage.as_ref().unwrap();
        s.replies.execute("INSERT INTO replies VALUES (1,'reply-10-9','notification-waiting','lead',1,9,10,?1,'Lead reply available.')",[now]).unwrap();
        s.replies
            .execute(
                "INSERT INTO pending VALUES ('browser',1,'notification-waiting')",
                [],
            )
            .unwrap();
        ("reply-10-9".into(), now)
    }
    // Oracle: tab-scoped presence only defers a reply, sequence watermarks cannot
    // claim it was displayed; bounded retries record one terminal outcome.
    #[tokio::test]
    async fn tab_leases_exact_reply_suppression_and_bounded_retry() {
        let (_t, app, token, _clock) = fixture().await;
        let (id, now) = waiting_reply(&app, &token).await;
        for (tab, session, revision) in [
            ("tab-a", Some("notification-waiting"), 1),
            ("tab-b", Some("notification-waiting"), 1),
            ("tab-a", None, 2),
            ("tab-b", None, 0),
        ] {
            let (status, _) = call(
                &app,
                &token,
                "POST",
                "/api/push/presence",
                json!({"tabId":tab,"sessionId":session,"revision":revision,"seenSeq":999999}),
            )
            .await;
            assert_eq!(
                status,
                if revision == 0 {
                    StatusCode::BAD_REQUEST
                } else {
                    StatusCode::OK
                }
            );
        }
        let mut runtime = app.web_push.lock().unwrap();
        assert!(runtime.next(&app, now).unwrap().is_none());
        let mut job = runtime.next(&app, now + 2100).unwrap().unwrap();
        let mut time = now + 2100;
        for attempt in 1..=3 {
            runtime
                .complete(&app, job.clone(), Err("fake-network".into()), time)
                .unwrap();
            assert!(runtime.next(&app, time).unwrap().is_none());
            time += 1000 * (1u64 << attempt);
            job = runtime
                .next(&app, time)
                .unwrap()
                .expect("retry after exact backoff");
        }
        runtime.complete(&app, job.clone(), Ok(503), time).unwrap();
        assert!(runtime.next(&app, time + 10000).unwrap().is_none());
        assert!(
            !runtime
                .storage
                .as_ref()
                .unwrap()
                .displayed("browser", "notification-waiting", &id)
                .unwrap()
        );
        let stats = runtime.delivery.get(&device_key(&job.record)).unwrap();
        assert_eq!(stats["retried"], 3);
        assert_eq!(stats["failed"], 1);
        drop(runtime);
        app.shutdown();
    }
    #[tokio::test]
    async fn revoked_device_or_unknown_owner_cannot_send_or_write_receipts() {
        for fault in ["device", "owner", "device-unavailable"] {
            let (t, app, token, _clock) = fixture().await;
            let (_, now) = waiting_reply(&app, &token).await;
            let job = {
                let mut runtime = app.web_push.lock().unwrap();
                let job = runtime.next(&app, now).unwrap();
                assert!(
                    job.is_some(),
                    "fixture eligibility missing: now={now}, actual={}, counters={:?}, owner={:?}",
                    crate::now(),
                    runtime.delivery,
                    app.history.lock().unwrap().web_writable()
                );
                job.unwrap()
            };
            let before = app
                .web_push
                .lock()
                .unwrap()
                .storage
                .as_ref()
                .unwrap()
                .outcomes
                .query_row("SELECT count(*) FROM outcomes", [], |r| r.get::<_, i64>(0))
                .unwrap();
            let device_file = t.path().join("original/web/devices.json");
            let device_before = std::fs::read(&device_file).unwrap();
            if fault == "device-unavailable" {
                write(&device_file, json!({"corrupt":true}));
            } else if fault == "device" {
                write(
                    &t.path().join("original/web/devices.json"),
                    json!([{"id":"browser","name":"Fixture","createdAt":"2026-01-01T00:00:00Z","hash":crate::tasks::digest(token.as_bytes()),"revokedAt":"2026-01-02T00:00:00Z"}]),
                );
            } else {
                let p = t.path().join("original/daemon/daemon.lock");
                let mut v: Value = serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap();
                v["nonce"] = json!("foreign-owner");
                write(&p, v);
            }
            assert!(!authorized_job(&app, &app.web_push.lock().unwrap(), &job));
            app.web_push
                .lock()
                .unwrap()
                .complete(&app, job, Ok(201), now + 1)
                .unwrap();
            assert_eq!(
                app.web_push
                    .lock()
                    .unwrap()
                    .storage
                    .as_ref()
                    .unwrap()
                    .outcomes
                    .query_row("SELECT count(*) FROM outcomes", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                before
            );
            if fault == "device" {
                assert_eq!(
                    call(&app, &token, "GET", "/api/push", Value::Null).await.0,
                    StatusCode::FORBIDDEN
                );
            } else {
                assert!(app.web_push.lock().unwrap().next(&app, now + 1).is_err());
            }
            if fault == "device-unavailable" {
                assert_eq!(
                    app.web_push.lock().unwrap().storage.as_ref().unwrap().push["subscriptions"]
                        .as_array()
                        .unwrap()
                        .len(),
                    1
                );
                std::fs::write(&device_file, device_before).unwrap();
                assert_eq!(
                    call(&app, &token, "GET", "/api/push", Value::Null).await.1["enabled"],
                    true
                );
            }
            app.shutdown();
        }
    }
    // Renewal changes a destination, not the authorized logical occurrence.
    // Accepted old-generation effects stay receipted; rejection must never remove
    // the new destination, while disable/re-enable establishes a new epoch.
    #[tokio::test]
    async fn renewal_preserves_occurrence_and_disable_changes_authority_epoch() {
        for status in [201, 410] {
            let (_t, app, token, _clock) = fixture().await;
            let (_, now) = waiting_reply(&app, &token).await;
            let old = app
                .web_push
                .lock()
                .unwrap()
                .next(&app, now)
                .unwrap()
                .unwrap();
            let mut replacement = sub();
            replacement["endpoint"] =
                json!("https://fcm.googleapis.com/fcm/send/replacement-never-network");
            assert_eq!(
                call(
                    &app,
                    &token,
                    "POST",
                    "/api/push",
                    json!({"subscription":replacement,"renew":true})
                )
                .await
                .0,
                StatusCode::OK
            );
            app.web_push
                .lock()
                .unwrap()
                .complete(&app, old.clone(), Ok(status), now + 1)
                .unwrap();
            if status == 201 {
                assert!(
                    app.web_push
                        .lock()
                        .unwrap()
                        .next(&app, now + 9000)
                        .unwrap()
                        .is_none()
                );
            } else {
                let retry = app
                    .web_push
                    .lock()
                    .unwrap()
                    .next(&app, now + 9000)
                    .unwrap()
                    .unwrap();
                assert_eq!(retry.record["subscription"], replacement);
            }
            assert_eq!(
                call(&app, &token, "GET", "/api/push", Value::Null).await.1["enabled"],
                true
            );
            assert_eq!(
                call(&app, &token, "DELETE", "/api/push", Value::Null)
                    .await
                    .0,
                StatusCode::OK
            );
            assert_eq!(
                call(
                    &app,
                    &token,
                    "POST",
                    "/api/push",
                    json!({"subscription":replacement})
                )
                .await
                .0,
                StatusCode::OK
            );
            assert!(!authorized_job(&app, &app.web_push.lock().unwrap(), &old));
            assert_eq!(
                call(
                    &app,
                    &token,
                    "GET",
                    "/api/replies?cursor=18446744073709551615",
                    Value::Null
                )
                .await
                .0,
                StatusCode::BAD_REQUEST
            );
            assert_eq!(
                call(&app, &token, "GET", "/api/push", Value::Null).await.0,
                StatusCode::OK
            );
            app.shutdown();
        }
    }
    #[tokio::test]
    async fn accepted_transport_with_failed_receipt_write_suspends_further_effects() {
        let (t, app, token, _clock) = fixture().await;
        waiting_reply(&app, &token).await;
        let sends = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = sends.clone();
        {
            let mut r = app.web_push.lock().unwrap();
            r.storage
                .as_ref()
                .unwrap()
                .outcomes
                .execute_batch("PRAGMA query_only=ON")
                .unwrap();
            r.send_override = Some(std::sync::Arc::new(move |_, _| {
                count.fetch_add(1, Ordering::SeqCst);
                Ok(201)
            }));
        }
        start(app.clone(), t.path().join("state"));
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if app.web_push.lock().unwrap().blocked {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("write failure must suspend sender");
        assert_eq!(sends.load(Ordering::SeqCst), 1);
        assert!(
            app.web_push
                .lock()
                .unwrap()
                .next(&app, crate::now() + 30000)
                .is_err()
        );
        assert_eq!(sends.load(Ordering::SeqCst), 1);
        app.shutdown();
    }
    #[tokio::test]
    async fn notification_action_uses_live_native_authority_and_never_replays_effects() {
        let (t, app, token, _clock) = fixture().await;
        assert_eq!(
            call(
                &app,
                &token,
                "POST",
                "/api/push",
                json!({"subscription":sub()})
            )
            .await
            .0,
            StatusCode::OK
        );
        let c:deck2_shared::SessionCommand=serde_json::from_value(json!({"api":deck2_shared::API,"id":"notification-action","title":"Action","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
        app.store.lock().unwrap().create_session(&c).unwrap();
        let submit:deck2_shared::ScopedSubmit=serde_json::from_value(json!({"api":deck2_shared::API,"id":"notification-action-command","session":c.id,"prompt":"Synthetic MCP first","mode":"session_v1","fresh":false})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let (_cancel, rx) = tokio::sync::watch::channel(false);
        let run = tokio::spawn(crate::native::run(
            app.clone(),
            submit.id.clone(),
            app.binary.clone(),
            rx,
        ));
        let decision = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let r = app.receipt(&submit.id).unwrap();
                if let Some(d) = r.decisions.first() {
                    break d.clone();
                }
                if !r.phase.active() {
                    panic!("{}", r.detail);
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert!(approval_fields(&decision).1);
        let queued:deck2_shared::ScopedSubmit=serde_json::from_value(json!({"api":deck2_shared::API,"id":"notification-queued-command","session":c.id,"prompt":"A later queued message","mode":"session_v1","fresh":false,"queue":true})).unwrap();
        {
            let mut store = app.store.lock().unwrap();
            store.pause_queue(true).unwrap();
            store.admit(&queued).unwrap();
            store.request_cancel(&queued.id).unwrap();
        }
        // An old/queued prompt must not age a newly requested approval.
        app.change(&submit.id, |r| {
            r.accepted_ms = crate::now().saturating_sub(48 * 60 * 60_000)
        })
        .unwrap();
        let alert = app
            .web_push
            .lock()
            .unwrap()
            .next(&app, crate::now())
            .unwrap()
            .expect("live approval must enter the production scheduler")
            .item;
        assert_eq!(alert["risk"], "normal");
        let (_, w) = call(&app, &token, "GET", "/api/workspace", Value::Null).await;
        let received = w["receipts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == submit.id)
            .unwrap();
        assert_eq!(received["decisions"][0]["notificationSeq"], alert["seq"]);
        assert!(alert["ts"].as_u64().unwrap() > received["accepted_ms"].as_u64().unwrap());
        assert_eq!(call(&app,&token,"POST","/api/push/presence",json!({"tabId":"native-visible-tab","sessionId":c.id,"revision":1,"seenSeq":alert["seq"]})).await.0,StatusCode::OK);
        assert!(
            app.web_push
                .lock()
                .unwrap()
                .next(&app, crate::now())
                .unwrap()
                .is_none(),
            "received native attention should not enqueue again"
        );
        assert!(!payload(&alert).contains("fixture-secret"));
        let mut envelope = json!({"sessionId":c.id,"command":{"v":1,"commandId":"notify-normal-action-01","type":"approval.respond","approvalId":decision.id,"decision":"allow","scope":"once","origin":"notification"}});
        assert_eq!(
            call(&app, &token, "POST", "/api/commands", envelope.clone())
                .await
                .0,
            StatusCode::OK
        );
        tokio::time::timeout(Duration::from_secs(10), run)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            app.receipt(&submit.id).unwrap().phase,
            deck2_shared::Phase::Completed
        );
        assert_eq!(
            std::fs::read_to_string(t.path().join("mcp-approved"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        assert_eq!(
            call(&app, &token, "POST", "/api/commands", envelope.clone())
                .await
                .0,
            StatusCode::OK
        );
        envelope["command"]["commandId"] = json!("notify-stale-action-02");
        assert_eq!(
            call(&app, &token, "POST", "/api/commands", envelope)
                .await
                .0,
            StatusCode::CONFLICT
        );
        assert_eq!(
            std::fs::read_to_string(t.path().join("mcp-approved"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        let mut high = decision;
        high.native.as_mut().unwrap().method = "item/commandExecution/requestApproval".into();
        assert!(!approval_fields(&high).1);
        app.shutdown();
    }
    #[tokio::test]
    async fn a_trailing_reply_segment_keeps_its_first_message_identity() {
        let (_t, app, token, _clock) = fixture().await;
        waiting_reply(&app, &token).await;
        {
            let store = app.store.lock().unwrap();
            for (seq, kind, body) in [
                (100, "notification:message:first", json!({"final":true})),
                (101, "notification:message:second", json!({"final":true})),
                (
                    102,
                    "receipt:terminal",
                    json!({"phase":"completed","at_ms":crate::now(),"attemptNumber":1}),
                ),
            ] {
                store.conn.execute("INSERT INTO session_events(seq,session,task,attempt,kind,body) VALUES (?1,'notification-waiting','lead','turn',?2,?3)",params![seq,kind,body.to_string()]).unwrap();
            }
        }
        let mut runtime = app.web_push.lock().unwrap();
        runtime.evaluate(&app, crate::now()).unwrap();
        let s = runtime.storage.as_ref().unwrap();
        assert!(
            s.reply("notification-waiting", "reply-102-100")
                .unwrap()
                .is_some(),
            "reply identity must use the first final message in its trailing segment"
        );
        assert!(
            s.reply("notification-waiting", "reply-102-101")
                .unwrap()
                .is_none()
        );
        drop(runtime);
        app.shutdown();
    }
    #[tokio::test]
    async fn session_replies_uses_partial_index_and_stays_fast_with_large_ledger() {
        let (_t, app, token, _clock) = fixture().await;
        waiting_reply(&app, &token).await;
        {
            let store = app.store.lock().unwrap();
            store.conn.execute_batch("BEGIN").unwrap();
            {
                let mut stmt = store
                    .conn
                    .prepare("INSERT INTO session_events(session,task,attempt,kind,body) VALUES (?1,?2,?3,?4,?5)")
                    .unwrap();
                for i in 0..5_000 {
                    stmt.execute(params![
                        "notification-waiting",
                        "lead",
                        format!("hist-{}", i % 50),
                        format!("receipt:{i}"),
                        r#"{"type":"receipt.updated","phase":"completed","at_ms":1}"#,
                    ])
                    .unwrap();
                }
            }
            store.conn.execute_batch("COMMIT").unwrap();
            let plan: String = store
                .conn
                .query_row(
                    "EXPLAIN QUERY PLAN SELECT seq,body FROM session_events e \
                     WHERE session=?1 \
                       AND kind>='notification:message:' AND kind<'notification:message;' \
                       AND json_extract(body,'$.receiptId')=?2 \
                       AND json_extract(body,'$.final')=1 \
                       AND seq>COALESCE((SELECT MAX(seq) FROM session_events \
                         WHERE session=?1 \
                           AND kind>='notification:message:' AND kind<'notification:message;' \
                           AND json_extract(body,'$.receiptId')=?2 \
                           AND json_extract(body,'$.final')=0),0) \
                     ORDER BY seq LIMIT 1",
                    params!["notification-waiting", "cmd-0"],
                    |row| row.get(3),
                )
                .unwrap();
            assert!(
                plan.contains("session_events_notification_message"),
                "session_replies should use partial index, got: {plan}"
            );
        }
        let query: String = (0..80)
            .map(|i| format!("commandId=cmd-{i}"))
            .collect::<Vec<_>>()
            .join("&");
        let started = std::time::Instant::now();
        let (status, body) = call(
            &app,
            &token,
            "GET",
            &format!("/api/sessions/notification-waiting/replies?{query}"),
            Value::Null,
        )
        .await;
        let elapsed_ms = started.elapsed().as_millis();
        assert_eq!(status, StatusCode::OK, "{body}");
        assert!(
            elapsed_ms < 250,
            "80-commandId session_replies exceeded budget: {elapsed_ms} ms"
        );
        app.shutdown();
    }
}
