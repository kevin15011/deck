//! Account observations are host-only reads; only explicit refresh starts a native account query.
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
}

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
impl Store {
    fn quota(&self) -> Result<Option<Value>, String> {
        let text: Option<String> = self
            .conn
            .query_row("SELECT value FROM meta WHERE key='quota.codex'", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|_| "Quota storage unavailable")?;
        text.map(|t| serde_json::from_str(&t).map_err(|_| "Quota snapshot unavailable".into()))
            .transpose()
    }
    fn save_quota(&self, value: &Value) -> Result<(), String> {
        self.conn.execute("INSERT INTO meta(key,value) VALUES('quota.codex',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[value.to_string()]).map_err(|_|"Quota persistence failed")?;
        Ok(())
    }
}
impl App {
    pub(crate) fn observe_quota(&self, value: &Value) -> Result<(), String> {
        if value["method"] == "account/rateLimits/updated"
            && value["params"]["rateLimits"].is_object()
        {
            self.store
                .lock()
                .unwrap()
                .save_quota(&snapshot(&value["params"]["rateLimits"], crate::now()))?;
        }
        Ok(())
    }
    fn quota_state(&self) -> Result<Value, String> {
        let snapshot = self.store.lock().unwrap().quota()?;
        let runtime = self.quota_runtime.lock().unwrap();
        let mut codex =
            json!({"refreshAfter":runtime.after,"refreshing":runtime.busy,"supported":true});
        if let Some(s) = snapshot {
            codex["snapshot"] = s;
        }
        Ok(
            json!({"runners":{"codex":codex,"claude":{"refreshAfter":0,"refreshing":false,"supported":false}}}),
        )
    }
}
pub(crate) async fn read(State(app): State<App>) -> Response {
    match app.quota_state() {
        Ok(s) => Json(s).into_response(),
        Err(e) => problem(StatusCode::SERVICE_UNAVAILABLE, "quota-unavailable", e),
    }
}
pub(crate) async fn refresh(State(app): State<App>, Path(runner): Path<String>) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() { return r; }

    if runner != "codex" {
        return problem(
            StatusCode::BAD_REQUEST,
            "quota-unavailable",
            "This runner's quota refresh is not yet ported.",
        );
    }
    // Match native admission's active -> Store -> auth lock order. Selection and
    // its digest are bound while exclusive operations cannot enter this host.
    let admission = (|| -> Result<_, String> {
        let mut active = app.active.lock().unwrap();
        let store = app.store.lock().unwrap();
        if !app.persistence_available()
            || store.runner_busy()?
            || active
                .keys()
                .any(|id| id.starts_with("login:") || id == "maintenance-help")
        {
            return Err("Settle sign-in and maintenance before refreshing quota".into());
        }
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
        let mut runtime = app.quota_runtime.lock().unwrap();
        if runtime.busy || crate::now() < runtime.after {
            return Err("Wait a minute between quota refreshes.".into());
        }
        // A separate shared file belongs to this query, so another host's
        // exclusive admission cannot enter until its child group is reaped.
        let scope = app.scope_lock(false)?;
        let (tx, _rx) = tokio::sync::watch::channel(false);
        active.insert("quota-refresh".into(), tx);
        runtime.after = crate::now() + 60_000;
        runtime.busy = true;
        Ok((
            binary,
            std::sync::Arc::new(Reservation {
                app: app.clone(),
                scope: Some(scope),
                #[cfg(test)]
                before_clear: None,
            }),
        ))
    })();
    let (binary, reservation) = match admission {
        Ok(a) => a,
        Err(e) => return problem(StatusCode::CONFLICT, "quota-unavailable", e),
    };
    // Own the effect independently of HTTP cancellation; always settle the process and busy state.
    let owned = app.clone();
    let result = tokio::spawn(async move {
        let result = native_refresh(&binary, Some(reservation.clone()))
            .await
            .and_then(|data| {
                owned
                    .store
                    .lock()
                    .unwrap()
                    .save_quota(&snapshot(&data, crate::now()))?;
                Ok(data)
            });
        drop(reservation);
        result
    })
    .await;
    match result {
        Ok(Ok(_)) => match app.quota_state() {
            Ok(s) => Json(json!({"ok":true,"state":s})).into_response(),
            Err(e) => problem(StatusCode::SERVICE_UNAVAILABLE, "quota-unavailable", e),
        },
        _ => problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "quota-refresh-failed",
            "Could not refresh quota. Previous snapshot kept.",
        ),
    }
}
// The worker and Native's detached reaper share ownership. Only the last
// confirmed cleanup owner releases admission; an aborted observer owns neither.
struct Reservation {
    app: App,
    scope: Option<crate::managed_tools::OwnedLock>,
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
        self.app.clear_active("quota-refresh");
        self.app.quota_runtime.lock().unwrap().busy = false;
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
        s.save_quota(&value).unwrap();
        assert_eq!(s.quota().unwrap(), Some(value));
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
        app.active
            .lock()
            .unwrap()
            .insert("quota-refresh".into(), tx);
        // Zero is an injected expired cooldown, no wall-clock wait required.
        app.quota_runtime.lock().unwrap().busy = true;
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let release_rx = std::sync::Mutex::new(release_rx);
        let old = Reservation {
            app: app.clone(),
            scope: Some(app.scope_lock(false).unwrap()),
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
        assert!(app.active.lock().unwrap().contains_key("quota-refresh"));
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
            app.store.lock().unwrap().save_quota(&previous).unwrap();
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
            assert!(!app.active.lock().unwrap().contains_key("quota-refresh"));
            assert!(!app.quota_runtime.lock().unwrap().busy);
            assert!(app.scope_lock(true).is_ok());
            if failure != "compatible" {
                assert_eq!(app.store.lock().unwrap().quota().unwrap(), Some(previous));
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
}
