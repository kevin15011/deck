//! Account observations are host-only reads; native account queries run separately from snapshot reads.
use crate::{
    Store,
    server::{App, problem},
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use rusqlite::OptionalExtension;
use serde_json::{Value, json};

#[derive(Default)]
pub(crate) struct Runtime {
    after: u64,
    busy: bool,
    error: Option<String>,
}

const CODEX: &str = "codex";
const CLAUDE: &str = "claude";
const AGY: &str = "agy";
pub(crate) const AGY_REFRESH_KEY: &str = "quota:agy";

// Original quota allowlist: account identifiers, credits and raw payloads never leave the host.
pub(crate) fn snapshot(data: &Value, at: u64) -> Value {
    let mut windows = vec![];
    for key in ["primary", "secondary"] {
        let w = &data[key];
        let id = match w["windowDurationMins"].as_u64() {
            Some(300) => "five-hour",
            Some(10080) => "seven-day",
            _ => continue,
        };
        if windows.iter().any(|w: &Value| w["id"] == id) {
            continue;
        }
        if let Some(used) = w["usedPercent"]
            .as_f64()
            .filter(|p| p.is_finite() && (0.0..=100.0).contains(p))
        {
            let mut window = json!({"id":id,"usedPercent":(used*10.0).round()/10.0});
            if let Some(reset) = w["resetsAt"]
                .as_f64()
                .filter(|p| p.is_finite() && *p > 0.0 && *p * 1000.0 <= 8.64e15)
            {
                window["resetsAt"] = json!(reset * 1000.0);
            }
            windows.push(window);
        }
    }
    let mut s = json!({"runnerId":"codex","updatedAt":at,"windows":windows});
    if let Some(plan) = data["planType"].as_str().filter(|s| {
        !s.is_empty()
            && s.len() <= 40
            && s.as_bytes()[0].is_ascii_alphabetic()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    }) {
        s["plan"] = json!(plan);
    }
    s
}

fn claude_snapshot(data: &Value, at: u64) -> Result<Value, String> {
    let plan = data["plan"]
        .as_str()
        .filter(|plan| matches!(*plan, "pro" | "max" | "ultra" | "team" | "enterprise"))
        .ok_or("Invalid Claude subscription metadata")?;
    let source = data["windows"]
        .as_array()
        .ok_or("Invalid Claude quota windows")?;
    let mut windows = Vec::new();
    for item in source.iter().take(37) {
        let Some(id) = item["id"].as_str().filter(|id| {
            matches!(
                *id,
                "five-hour"
                    | "seven-day"
                    | "seven-day-oauth-apps"
                    | "seven-day-opus"
                    | "seven-day-sonnet"
            ) || id.strip_prefix("model:").is_some_and(|label| {
                !label.trim().is_empty()
                    && label.len() <= 40
                    && label
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b' ' | b'-' | b'.'))
            })
        }) else {
            continue;
        };
        let Some(used) = item["usedPercent"]
            .as_f64()
            .filter(|p| (0.0..=100.0).contains(p))
        else {
            continue;
        };
        if windows.iter().any(|window: &Value| window["id"] == id) {
            continue;
        }
        let mut window = json!({"id":id,"usedPercent":(used * 10.0).round() / 10.0});
        if let Some(reset) = item["resetsAt"]
            .as_u64()
            .filter(|ms| (1..=8_640_000_000_000_000).contains(ms))
        {
            window["resetsAt"] = json!(reset);
        }
        windows.push(window);
    }
    let mut snapshot = json!({"runnerId":CLAUDE,"updatedAt":at,"windows":windows,"plan":plan});
    if data["extraUsage"] == true {
        snapshot["overageStatus"] = json!("allowed");
    }
    Ok(snapshot)
}

fn parse_rfc3339_utc_ms(text: &str) -> Option<u64> {
    let rest = text
        .strip_suffix('Z')
        .or_else(|| text.strip_suffix("+00:00"))?;
    let (date, time) = rest.split_once('T')?;
    let mut d = date.split('-');
    let year: i64 = d.next()?.parse().ok()?;
    let month: u32 = d.next()?.parse().ok()?;
    let day: u32 = d.next()?.parse().ok()?;
    if d.next().is_some()
        || !(1970..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
    {
        return None;
    }
    let (hms, frac) = match time.split_once('.') {
        Some((hms, frac)) => (hms, Some(frac)),
        None => (time, None),
    };
    let mut t = hms.split(':');
    let hour: u32 = t.next()?.parse().ok()?;
    let min: u32 = t.next()?.parse().ok()?;
    let sec: u32 = t.next()?.parse().ok()?;
    if t.next().is_some() || hour > 23 || min > 59 || sec > 59 {
        return None;
    }
    let ms: u64 = match frac {
        None => 0,
        Some(f) if !f.is_empty() && f.len() <= 9 && f.bytes().all(|b| b.is_ascii_digit()) => {
            let mut padded = [b'0'; 3];
            for (slot, b) in padded.iter_mut().zip(f.bytes()) {
                *slot = b;
            }
            std::str::from_utf8(&padded).ok()?.parse().ok()?
        }
        Some(_) => return None,
    };
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        _ => return None,
    };
    if day > max_day {
        return None;
    }
    let y = year - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = (y - era * 400) as u64;
    let m = month as u64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + u64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe as i64 - 719_468;
    if days < 0 {
        return None;
    }
    let secs = (days as u64)
        .checked_mul(86_400)?
        .checked_add(u64::from(hour) * 3600 + u64::from(min) * 60 + u64::from(sec))?;
    let total = secs.checked_mul(1000)?.checked_add(ms)?;
    (1..=8_640_000_000_000_000)
        .contains(&total)
        .then_some(total)
}

// Allowlist only Antigravity's Gemini 5-hour and weekly quota windows; account
// identifiers (email), paths, third-party buckets and raw payloads never leave the host.
fn agy_snapshot(data: &Value, at: u64) -> Result<Value, String> {
    let source = data["quota"]
        .as_object()
        .ok_or("Antigravity did not report subscription quota.")?;
    let mut windows = Vec::new();
    for (key, id) in [("gemini-5h", "five-hour"), ("gemini-weekly", "seven-day")] {
        let Some(entry) = source.get(key) else {
            continue;
        };
        if entry["disabled"] == true {
            continue;
        }
        let Some(remaining) = entry["remaining_fraction"]
            .as_f64()
            .filter(|p| p.is_finite() && (0.0..=1.0).contains(p))
        else {
            continue;
        };
        let used = (((1.0 - remaining) * 1000.0).round() / 10.0).clamp(0.0, 100.0);
        let used = if used == 0.0 { 0.0 } else { used };
        let mut window = json!({"id":id,"usedPercent":used});
        let reset = entry["reset_time"]
            .as_str()
            .and_then(parse_rfc3339_utc_ms)
            .or_else(|| {
                entry["reset_in_seconds"]
                    .as_u64()
                    .filter(|secs| *secs > 0)
                    .and_then(|secs| secs.checked_mul(1000))
                    .and_then(|ms| at.checked_add(ms))
                    .filter(|ms| (1..=8_640_000_000_000_000).contains(ms))
            });
        if let Some(reset) = reset {
            window["resetsAt"] = json!(reset);
        }
        windows.push(window);
    }
    if windows.is_empty() {
        return Err("Antigravity did not report subscription quota.".into());
    }
    Ok(json!({"runnerId":AGY,"updatedAt":at,"windows":windows}))
}

impl Store {
    fn quota(&self, runner: &str) -> Result<Option<Value>, String> {
        let text: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key=?1",
                [format!("quota.{runner}")],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "Quota storage unavailable")?;
        text.map(|t| serde_json::from_str(&t).map_err(|_| "Quota snapshot unavailable".into()))
            .transpose()
    }
    fn save_quota(&self, runner: &str, value: &Value) -> Result<(), String> {
        self.conn.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[format!("quota.{runner}"), value.to_string()]).map_err(|_|"Quota persistence failed")?;
        Ok(())
    }
}
impl App {
    fn quota_runtime(&self, runner: &str) -> &std::sync::Mutex<Runtime> {
        match runner {
            CLAUDE => &self.claude_quota_runtime,
            AGY => &self.agy_quota_runtime,
            _ => &self.quota_runtime,
        }
    }

    pub(crate) fn observe_quota(&self, value: &Value) -> Result<(), String> {
        if value["method"] == "account/rateLimits/updated"
            && value["params"]["rateLimits"].is_object()
        {
            self.store.lock().unwrap().save_quota(
                CODEX,
                &snapshot(&value["params"]["rateLimits"], crate::now()),
            )?;
        }
        Ok(())
    }
    pub(crate) fn observe_claude_quota(&self, data: &Value) -> Result<(), String> {
        let snapshot = claude_snapshot(data, crate::now())?;
        self.store.lock().unwrap().save_quota(CLAUDE, &snapshot)?;
        self.claude_quota_runtime.lock().unwrap().error = None;
        Ok(())
    }
    pub(crate) fn observe_agy_quota(&self, data: &Value) -> Result<(), String> {
        let snapshot = agy_snapshot(data, crate::now())?;
        self.store.lock().unwrap().save_quota(AGY, &snapshot)?;
        self.agy_quota_runtime.lock().unwrap().error = None;
        Ok(())
    }

    fn quota_state(&self) -> Value {
        let store = self.store.lock().unwrap();
        let mut runners = json!({});
        for runner in [CODEX, CLAUDE, AGY] {
            let runtime = self.quota_runtime(runner).lock().unwrap();
            let mut view =
                json!({"refreshAfter":runtime.after,"refreshing":runtime.busy,"supported":true});
            match store.quota(runner) {
                Ok(Some(snapshot)) => view["snapshot"] = snapshot,
                Ok(None) => {}
                Err(error) => view["error"] = json!(error),
            }
            if let Some(error) = &runtime.error {
                view["error"] = json!(error);
            }
            runners[runner] = view;
        }
        json!({"runners":runners})
    }
}
pub(crate) async fn read(State(app): State<App>) -> Response {
    Json(app.quota_state()).into_response()
}
pub(crate) async fn refresh(State(app): State<App>, Path(runner): Path<String>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }

    let runner = match runner.as_str() {
        CODEX => CODEX,
        CLAUDE => CLAUDE,
        AGY => AGY,
        _ => {
            return problem(
                StatusCode::BAD_REQUEST,
                "quota-unavailable",
                "This runner does not offer subscription quota refresh.",
            );
        }
    };
    // The request can disconnect without dropping native process ownership.
    match tokio::spawn(run_refresh(app.clone(), runner)).await {
        Ok(Ok(())) => Json(json!({"ok":true,"state":app.quota_state()})).into_response(),
        Ok(Err(RefreshError::Unavailable(error))) => {
            problem(StatusCode::CONFLICT, "quota-unavailable", error)
        }
        outcome => problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "quota-refresh-failed",
            match outcome {
                Ok(Err(RefreshError::Failed(error))) => error,
                _ => "Could not refresh quota.".into(),
            },
        ),
    }
}

pub(crate) fn refresh_agy_after_turn(app: App) {
    // Admission and the probe both run off the Lead settlement path.
    tokio::spawn(run_refresh(app, AGY));
}

enum RefreshError {
    Unavailable(String),
    Failed(String),
}

async fn run_refresh(app: App, runner: &'static str) -> Result<(), RefreshError> {
    // Match native admission's active -> Store -> auth lock order. Selection and
    // its digest are bound while exclusive operations cannot enter this host.
    let (binary, reservation, cancel) = (|| -> Result<_, String> {
        let mut active = app.active.lock().unwrap();
        let store = app.store.lock().unwrap();
        if app
            .shutdown_requested
            .load(std::sync::atomic::Ordering::Acquire)
            || !app.persistence_available()
            || store.runner_busy()?
            || active
                .keys()
                .any(|id| id.starts_with("login:") || id == "maintenance-help")
        {
            return Err("Settle sign-in and maintenance before refreshing quota".into());
        }
        let mut runtime = app.quota_runtime(runner).lock().unwrap();
        if runtime.busy || crate::now() < runtime.after {
            return Err("Wait a minute between refreshes for this runner.".into());
        }
        let binary = if runner == CODEX {
            let binding = store.configuration()?.runner;
            let binary = binding
                .as_ref()
                .map(|b| std::path::PathBuf::from(&b.path))
                .unwrap_or_else(|| app.binary.clone());
            if let Some(b) = binding
                && std::fs::read(&binary)
                    .ok()
                    .is_none_or(|bytes| crate::tasks::digest(&bytes) != b.executable)
            {
                return Err(
                    "Selected Codex executable changed. Review Runners before refreshing.".into(),
                );
            }
            Some(binary)
        } else {
            None
        };
        // A separate shared file belongs to this query, so another host's
        // exclusive admission cannot enter until its child group is reaped.
        let scope = app.scope_lock(false)?;
        let (tx, cancel) = tokio::sync::watch::channel(false);
        active.insert(active_key(runner).into(), tx);
        runtime.after = crate::now() + 60_000;
        runtime.busy = true;
        Ok((
            binary,
            std::sync::Arc::new(Reservation {
                app: app.clone(),
                scope: Some(scope),
                runner,
                #[cfg(test)]
                before_clear: None,
            }),
            cancel,
        ))
    })()
    .map_err(RefreshError::Unavailable)?;
    let result = match runner {
        CODEX => native_refresh(&binary.expect("codex binary"), Some(reservation.clone()))
            .await
            .and_then(|data| {
                app.store
                    .lock()
                    .unwrap()
                    .save_quota(CODEX, &snapshot(&data, crate::now()))
            })
            .map_err(|_| "Could not refresh Codex quota. Previous snapshot kept.".into()),
        CLAUDE => crate::native::PROBE_RESERVATION
            .scope(reservation.clone(), crate::claude::read_quota())
            .await
            .and_then(|data| app.observe_claude_quota(&data)),
        AGY => {
            #[cfg(test)]
            let override_binary = app.agy_binary.lock().unwrap().clone();
            #[cfg(not(test))]
            let override_binary: Option<std::path::PathBuf> = None;
            let fetched = crate::native::PROBE_RESERVATION
                .scope(reservation.clone(), async {
                    if let Some(binary) = override_binary {
                        crate::agy_readiness::read_quota_from(&binary, cancel).await
                    } else {
                        crate::agy_readiness::read_quota(cancel).await
                    }
                })
                .await;
            fetched.and_then(|data| app.observe_agy_quota(&data))
        }
        _ => unreachable!(),
    };
    app.quota_runtime(runner).lock().unwrap().error = result.as_ref().err().cloned();
    drop(reservation);
    result.map_err(RefreshError::Failed)
}
fn active_key(runner: &str) -> &'static str {
    match runner {
        CLAUDE => "quota:claude",
        AGY => AGY_REFRESH_KEY,
        _ => "quota:codex",
    }
}
// The worker and Native's detached reaper share ownership. Only the last
// confirmed cleanup owner releases admission; an aborted observer owns neither.
struct Reservation {
    app: App,
    scope: Option<crate::managed_tools::OwnedLock>,
    runner: &'static str,
    #[cfg(test)]
    before_clear: Option<Box<dyn FnOnce() + Send + Sync>>,
}
impl Drop for Reservation {
    fn drop(&mut self) {
        self.scope.take();
        #[cfg(test)]
        if let Some(probe) = self.before_clear.take() {
            probe();
        }
        // Keep quota admission closed through removal and scheduler progress.
        // No admission can replace the fixed entry while busy remains true;
        // clear_active takes its own active lock, so hold no runtime guard here.
        self.app.clear_active(active_key(self.runner));
        self.app.quota_runtime(self.runner).lock().unwrap().busy = false;
    }
}
async fn native_refresh(
    binary: &std::path::Path,
    reservation: Option<std::sync::Arc<Reservation>>,
) -> Result<Value, String> {
    let cwd = tempfile::tempdir().map_err(|_| "Quota query directory unavailable")?;
    let mut n = crate::native::Native::start_account(binary, cwd.path()).await?;
    n.own_account_cleanup(
        reservation.map(|r| r as std::sync::Arc<dyn Send + Sync>),
        cwd,
    );
    let result=tokio::time::timeout(std::time::Duration::from_secs(20),async {
        n.request("initialize",json!({"clientInfo":{"name":"deck-quota","version":"1.0.0"},"capabilities":{"experimentalApi":true}})).await?;
        n.write(json!({"method":"initialized"})).await?;
        let result=n.request("account/rateLimits/read",json!({})).await?;
        result.get("rateLimits").filter(|v|v.is_object()).cloned().ok_or("No quota event arrived. Previous snapshot kept.".into())
    }).await.map_err(|_|"Quota refresh timed out".to_string()).and_then(|r|r);
    n.terminate().await?;
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quota_worker_keys_are_rejected_by_command_admission() {
        for runner in [CODEX, CLAUDE, AGY] {
            let mut store = Store::open_memory("/fixture").unwrap();
            let mut command = deck2_shared::Submit {
                api: deck2_shared::API,
                id: active_key(runner).into(),
                prompt: "ordinary command".into(),
                mode: deck2_shared::Mode::ReadOnly,
                attachments: Vec::new(),
            };
            assert!(store.accept(&command).is_err(), "{runner}");
            command.id = command.id.replace(':', "-");
            assert!(store.accept(&command).is_ok(), "{runner}");
        }
    }

    #[test]
    fn quota_allowlist_and_persistence() {
        let s = Store::open_memory("/fixture").unwrap();
        let value = snapshot(
            &json!({"accountId":"private","credits":{"balance":50},"planType":"pro","primary":{"windowDurationMins":300,"usedPercent":42.24,"resetsAt":1900000000},"secondary":{"windowDurationMins":10080,"usedPercent":101}}),
            123,
        );
        assert_eq!(value["windows"].as_array().unwrap().len(), 1);
        assert_eq!(value["windows"][0]["usedPercent"], 42.2);
        assert_eq!(value["plan"], "pro");
        assert!(value.get("accountId").is_none());
        assert!(value.get("credits").is_none());
        s.save_quota(CODEX, &value).unwrap();
        assert_eq!(s.quota(CODEX).unwrap(), Some(value));
    }

    #[test]
    fn agy_quota_allowlist_only_five_hour_and_weekly() {
        let s = Store::open_memory("/fixture").unwrap();
        let value = agy_snapshot(
            &json!({
                "email": "private@example.com",
                "cwd": "/secret/path",
                "plan_tier": "PrivateAccountToken123",
                "quota": {
                    "gemini-5h": {
                        "remaining_fraction": 0.9501591,
                        "reset_time": "2026-11-25T17:59:06Z",
                        "reset_in_seconds": 133
                    },
                    "gemini-weekly": {
                        "remaining_fraction": 0.83336884,
                        "reset_in_seconds": 512491
                    },
                    "3p-5h": {
                        "remaining_fraction": 0.25,
                        "reset_in_seconds": 3600
                    },
                    "3p-weekly": {
                        "remaining_fraction": 0.50,
                        "reset_in_seconds": 86400
                    }
                }
            }),
            1_700_000_000_000,
        )
        .unwrap();
        assert_eq!(value["runnerId"], "agy");
        assert!(value.get("plan").is_none());
        let windows = value["windows"].as_array().unwrap();
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0]["id"], "five-hour");
        assert_eq!(windows[0]["usedPercent"], 5.0);
        assert_eq!(windows[0]["resetsAt"], 1_795_629_546_000u64);
        assert_eq!(windows[1]["id"], "seven-day");
        assert_eq!(windows[1]["usedPercent"], 16.7);
        assert_eq!(windows[1]["resetsAt"], 1_700_512_491_000u64);
        let serialized = value.to_string();
        assert!(!serialized.contains("private@example.com"));
        assert!(!serialized.contains("/secret/path"));
        assert!(!serialized.contains("3p-"));
        s.save_quota(AGY, &value).unwrap();
        assert_eq!(s.quota(AGY).unwrap(), Some(value));
    }

    #[test]
    fn agy_quota_rejects_empty_or_only_third_party() {
        let err = agy_snapshot(
            &json!({
                "quota": {
                    "3p-5h": {"remaining_fraction": 1.0},
                    "gemini-5h": {"remaining_fraction": 0.5, "disabled": true}
                }
            }),
            1_700_000_000_000,
        )
        .unwrap_err();
        assert!(err.contains("Antigravity"));
    }
}

#[cfg(test)]
mod native_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    // Protects atomic release/admission: an old settled query may not erase a
    // replacement's host ownership or let the scheduler ignore its native child.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn quota_reservation_handoff_preserves_next_owner() {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("codex");
        std::fs::write(
            &binary,
            r#"#!/usr/bin/python3
import sys,json,pathlib,time
# Queued work deliberately fails its version probe after scheduler admission.
if '--version' in sys.argv:sys.exit(1)
root=pathlib.Path(__file__).parent
for line in sys.stdin:
 v=json.loads(line);m=v['method']
 if m=='initialized':continue
 assert m in ['initialize','account/rateLimits/read']
 if m=='account/rateLimits/read':
  (root/'entered').touch()
  while (root/'hold').exists():time.sleep(.005)
 print(json.dumps({'id':v['id'],'result':{'rateLimits':{'planType':'pro'}}}),flush=True)
"#,
        )
        .unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let app = App::new(
            Store::open_memory("/fixture").unwrap(),
            "127.0.0.1:12345".into(),
            binary,
            None,
            "a".into(),
            "r".into(),
        );
        *app.scope_root.lock().unwrap() = Some(dir.path().join("scopes"));
        let (tx, _) = tokio::sync::watch::channel(false);
        app.active.lock().unwrap().insert("quota:codex".into(), tx);
        // Zero is an injected expired cooldown, no wall-clock wait required.
        app.quota_runtime.lock().unwrap().busy = true;
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let release_rx = std::sync::Mutex::new(release_rx);
        let old = Reservation {
            app: app.clone(),
            scope: Some(app.scope_lock(false).unwrap()),
            runner: CODEX,
            before_clear: Some(Box::new(move || {
                entered_tx.send(()).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
            })),
        };
        let cleanup = std::thread::spawn(move || drop(old));
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        let blocked = refresh(State(app.clone()), Path("codex".into())).await;
        // Always release the test gate before asserting, including predecessor RED.
        release_tx.send(()).unwrap();
        cleanup.join().unwrap();
        assert_eq!(
            blocked.status(),
            StatusCode::CONFLICT,
            "new admission must wait until old active ownership is removed"
        );
        assert!(
            !dir.path().join("entered").exists(),
            "rejected admission must not spawn"
        );
        std::fs::write(dir.path().join("hold"), "").unwrap();
        let owned = app.clone();
        let next = tokio::spawn(async move { refresh(State(owned), Path("codex".into())).await });
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while !dir.path().join("entered").exists() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        {
            let mut store = app.store.lock().unwrap();
            store.pause_queue(false).unwrap();
            let session = store.session.clone();
            store
                .accept_in(
                    &deck2_shared::Submit {
                        api: deck2_shared::API,
                        id: "queued-handoff".into(),
                        prompt: "queued fixture".into(),
                        mode: deck2_shared::Mode::ReadOnly,
                        attachments: vec![],
                    },
                    &session,
                    true,
                    true,
                )
                .unwrap();
        }
        app.pump_queue();
        assert_eq!(
            app.store
                .lock()
                .unwrap()
                .get("queued-handoff")
                .unwrap()
                .unwrap()
                .phase,
            deck2_shared::Phase::Queued,
            "scheduler must respect the new query owner"
        );
        assert!(app.active.lock().unwrap().contains_key("quota:codex"));
        assert!(app.quota_runtime.lock().unwrap().busy);
        assert!(
            app.scope_lock(true).is_err(),
            "new native child still owns authentication scope"
        );
        std::fs::remove_file(dir.path().join("hold")).unwrap();
        assert_eq!(next.await.unwrap().status(), StatusCode::OK);
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let phase = app
                    .store
                    .lock()
                    .unwrap()
                    .get("queued-handoff")
                    .unwrap()
                    .unwrap()
                    .phase;
                if !matches!(phase, deck2_shared::Phase::Queued)
                    && app.active.lock().unwrap().is_empty()
                    && app.scope_lock(true).is_ok()
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(!app.quota_runtime.lock().unwrap().busy);
        assert!(app.scope_lock(true).is_ok());
    }
    // Failure at each external boundary releases only after native settlement;
    // cached observations survive and compatible ordinary work is not excluded.
    #[tokio::test]
    async fn quota_failures_settle_and_preserve_snapshot() {
        for failure in ["spawn", "initialize", "request", "malformed", "compatible"] {
            let dir = tempfile::tempdir().unwrap();
            let binary = dir.path().join("codex");
            if failure != "spawn" {
                std::fs::write(&binary,format!(r#"#!/usr/bin/python3
import sys,json
failure={failure:?}
for line in sys.stdin:
 v=json.loads(line);m=v['method']
 if m=='initialized':continue
 assert m in ['initialize','account/rateLimits/read']
 if m==('initialize' if failure=='initialize' else 'account/rateLimits/read') and failure in ['initialize','request']:
  print(json.dumps({{'id':v['id'],'error':{{'code':-1,'message':'fixture failure'}}}}),flush=True)
 else:print(json.dumps({{'id':v['id'],'result':{{'rateLimits':None if failure=='malformed' else {{'planType':'pro'}}}}}}),flush=True)
"#)).unwrap();
                std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
            }
            let app = App::new(
                Store::open_memory("/fixture").unwrap(),
                "127.0.0.1:12345".into(),
                binary,
                None,
                "a".into(),
                "r".into(),
            );
            *app.scope_root.lock().unwrap() = Some(dir.path().join("scopes"));
            let previous = snapshot(&json!({"planType":"old"}), 1);
            app.store
                .lock()
                .unwrap()
                .save_quota(CODEX, &previous)
                .unwrap();
            if failure == "compatible" {
                let (tx, _) = tokio::sync::watch::channel(false);
                app.active.lock().unwrap().insert("ordinary".into(), tx);
            }
            let response = refresh(State(app.clone()), Path("codex".into())).await;
            assert_eq!(
                response.status(),
                if failure == "compatible" {
                    StatusCode::OK
                } else {
                    StatusCode::SERVICE_UNAVAILABLE
                },
                "{failure}"
            );
            assert!(!app.active.lock().unwrap().contains_key("quota:codex"));
            assert!(!app.quota_runtime.lock().unwrap().busy);
            assert!(app.scope_lock(true).is_ok());
            if failure != "compatible" {
                assert_eq!(
                    app.store.lock().unwrap().quota(CODEX).unwrap(),
                    Some(previous)
                );
            }
        }
    }
    // Original refresh contract: isolated app-server initialize/account query, no thread or turn.
    #[tokio::test]
    async fn refresh_is_account_only_and_settles_its_process() {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("codex");
        std::fs::write(
            &binary,
            r#"#!/usr/bin/env python3
import sys,json,pathlib,os
root=pathlib.Path(__file__).parent
for line in sys.stdin:
 v=json.loads(line);m=v.get('method')
 with (root/'calls').open('a') as f:f.write(m+'\n')
 if m=='initialize':r={'userAgent':'fixture'}
 elif m=='initialized':continue
 elif m=='account/rateLimits/read':
  (root/'cwd').write_text(os.getcwd())
  r={'rateLimits':{'planType':'pro','primary':{'windowDurationMins':300,'usedPercent':12}}}
 else:sys.exit(3)
 print(json.dumps({'id':v['id'],'result':r}),flush=True)
"#,
        )
        .unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(
            native_refresh(&binary, None).await.unwrap()["planType"],
            "pro"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("calls")).unwrap(),
            "initialize\ninitialized\naccount/rateLimits/read\n"
        );
        let cwd = std::fs::read_to_string(dir.path().join("cwd")).unwrap();
        assert!(
            !std::path::Path::new(&cwd).exists(),
            "isolated query directory must settle"
        );
    }

    #[tokio::test]
    async fn agy_quota_admission_skips_busy_and_cooldown_independently() {
        let dir = tempfile::tempdir().unwrap();
        let app = App::new(
            Store::open_memory("/fixture").unwrap(),
            "127.0.0.1:12346".into(),
            dir.path().join("codex-unused"),
            None,
            "a".into(),
            "r".into(),
        );
        *app.scope_root.lock().unwrap() = Some(dir.path().join("scopes"));
        *app.agy_binary.lock().unwrap() = Some(dir.path().join("unavailable-agy"));
        for (busy, after) in [(true, 0), (false, crate::now() + 60_000)] {
            {
                let mut runtime = app.agy_quota_runtime.lock().unwrap();
                runtime.busy = busy;
                runtime.after = after;
            }
            assert!(matches!(
                run_refresh(app.clone(), AGY).await,
                Err(RefreshError::Unavailable(_))
            ));
            let runtime = app.agy_quota_runtime.lock().unwrap();
            assert_eq!((runtime.busy, runtime.after), (busy, after));
            assert!(runtime.error.is_none());
        }
        assert!(app.active.lock().unwrap().is_empty());
    }

    // Protects Antigravity quota refresh: uses documented --settings statusLine
    // on a PTY, persists only allowlisted 5h/weekly windows, strips PII and 3p
    // buckets, enforces cooldown and reaps the child group cleanly.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn agy_refresh_persists_five_hour_and_weekly_and_settles_process() {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("agy");
        std::fs::write(
            &binary,
            r#"#!/usr/bin/env python3
import json, os, subprocess, sys, time
assert os.isatty(0) and os.isatty(1), "agy statusLine requires a TTY"
assert "--settings" in sys.argv, sys.argv
settings_path = sys.argv[sys.argv.index("--settings") + 1]
with open(settings_path) as f:
    settings = json.load(f)
cmd = settings["statusLine"]["command"]
payload = {
    "email": "private-agy@example.com",
    "plan_tier": "Pro",
    "quota": {
        "gemini-5h": {
            "remaining_fraction": 0.92,
            "reset_time": "2026-11-25T20:00:00Z",
            "reset_in_seconds": 3600,
        },
        "gemini-weekly": {
            "remaining_fraction": 0.815,
            "reset_time": "2026-12-01T16:18:24Z",
            "reset_in_seconds": 512491,
        },
        "3p-5h": {"remaining_fraction": 0.5},
        "3p-weekly": {"remaining_fraction": 0.4},
    },
}
subprocess.run(["/bin/sh", "-c", cmd], input=json.dumps(payload).encode(), check=True)
# Stay alive like the interactive TUI until Deck terminates the process group.
time.sleep(30)
"#,
        )
        .unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let app = App::new(
            Store::open_memory("/fixture").unwrap(),
            "127.0.0.1:12346".into(),
            dir.path().join("codex-unused"),
            None,
            "a".into(),
            "r".into(),
        );
        *app.scope_root.lock().unwrap() = Some(dir.path().join("scopes"));
        *app.agy_binary.lock().unwrap() = Some(binary);

        let response = refresh(State(app.clone()), Path("agy".into())).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert!(!app.active.lock().unwrap().contains_key("quota:agy"));
        assert!(!app.agy_quota_runtime.lock().unwrap().busy);
        assert!(app.scope_lock(true).is_ok());

        let saved = app.store.lock().unwrap().quota(AGY).unwrap().unwrap();
        assert_eq!(saved["runnerId"], "agy");
        assert!(saved.get("plan").is_none());
        let windows = saved["windows"].as_array().unwrap();
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0]["id"], "five-hour");
        assert_eq!(windows[0]["usedPercent"], 8.0);
        assert_eq!(windows[1]["id"], "seven-day");
        assert_eq!(windows[1]["usedPercent"], 18.5);
        assert!(!saved.to_string().contains("private-agy@example.com"));
        assert!(!saved.to_string().contains("3p-"));

        // Independent cooldown rejects an immediate second refresh.
        let cooldown = refresh(State(app.clone()), Path("agy".into())).await;
        assert_eq!(cooldown.status(), StatusCode::CONFLICT);

        app.agy_quota_runtime.lock().unwrap().after = 0;
        let fault = std::sync::Arc::new(crate::native::ProbeCleanupFault {
            unsettled: true.into(),
            reached: Default::default(),
            pause: false,
            help_only: false,
        });
        let worker = tokio::spawn(
            crate::native::PROBE_CLEANUP_FAULT.scope(fault.clone(), run_refresh(app.clone(), AGY)),
        );
        tokio::time::timeout(std::time::Duration::from_secs(3), fault.reached.notified())
            .await
            .expect("the quota reaper must report the injected failure");
        assert!(app.active.lock().unwrap().contains_key(active_key(AGY)));
        assert!(app.agy_quota_runtime.lock().unwrap().busy);
        assert!(app.scope_lock(true).is_err());
        assert_eq!(
            app.store.lock().unwrap().quota(AGY).unwrap().unwrap(),
            saved
        );
        worker.abort();
        assert!(matches!(worker.await, Err(error) if error.is_cancelled()));
        assert!(app.active.lock().unwrap().contains_key(active_key(AGY)));
        assert!(app.scope_lock(true).is_err());
        fault
            .unsettled
            .store(false, std::sync::atomic::Ordering::SeqCst);
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while app.agy_quota_runtime.lock().unwrap().busy {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert!(app.scope_lock(true).is_ok());
        assert!(!app.active.lock().unwrap().contains_key(active_key(AGY)));

        app.agy_quota_runtime.lock().unwrap().after = 0;
        *app.agy_binary.lock().unwrap() = Some(dir.path().join("unavailable-agy"));
        let unavailable = refresh(State(app.clone()), Path("agy".into())).await;
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        let view = app.quota_state();
        assert!(view["runners"][AGY]["error"].is_string());
        assert_eq!(view["runners"][AGY]["refreshing"], false);
        assert_eq!(view["runners"][AGY]["snapshot"], saved);
    }
}
