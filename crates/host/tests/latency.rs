// Protects send-latency attribution on the connected Lead path through default
// HTTP composition with live SSE clients. Oracle: recorded phase durations must
// partition the observed handshake, and a send delayed by a held lock must say
// so. Fails if phases overlap/lose time, idle sends claim a blocker, or SSE
// clients disturb the receipt/dispatch contract.
use axum::{body::Body, http::Request};
use deck2::{Store, server::{App, router}};
use deck2_shared::{API, Phase, SessionCommand};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use std::{os::unix::fs::PermissionsExt, sync::{Arc, atomic::{AtomicUsize, Ordering}}, time::Duration};
use tower::ServiceExt;

const HOST: &str = "127.0.0.1:32123";

async fn cookie(app: &App) -> String {
    let token = app.issue_launch();
    let r = router(app.clone())
        .oneshot(Request::builder().method("POST").uri("/auth").header("Host", HOST)
            .header("Origin", format!("http://{HOST}")).body(Body::from(token)).unwrap())
        .await.unwrap();
    r.headers()["set-cookie"].to_str().unwrap().split(';').next().unwrap().into()
}

fn get(path: &str, cookie: &str) -> Request<Body> {
    Request::builder().uri(path).header("Host", HOST).header("Cookie", cookie).body(Body::empty()).unwrap()
}

fn post(session: &str, id: &str, cookie: &str) -> Request<Body> {
    let body = json!({"api":API,"session":session,"id":id,"prompt":"Remember and continue","mode":"session_v1","fresh":false});
    Request::builder().method("POST").uri("/api/commands").header("Host", HOST)
        .header("Origin", format!("http://{HOST}")).header("Content-Type", "application/json")
        .header("Cookie", cookie).body(Body::from(body.to_string())).unwrap()
}

async fn completed(app: &App, id: &str) -> deck2_shared::Receipt {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let r = app.receipt(id).unwrap();
            if r.phase == Phase::Completed { return r; }
            assert!(!matches!(r.phase, Phase::Failed | Phase::Uncertain | Phase::Cancelled), "{}", r.detail);
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.unwrap()
}

fn dur(timing: &str, name: &str) -> f64 {
    timing.split(", ").find_map(|p| p.strip_prefix(name)?.strip_prefix(";dur=")?.split(';').next()?.parse().ok())
        .unwrap_or_else(|| panic!("{name} missing in {timing}"))
}

fn assert_phases_partition(r: &deck2_shared::Receipt) {
    let t = r.startup_timing.as_ref().expect("dispatch records timing");
    let handshake = r.handshake_ms.unwrap();
    let parts = t.version_ms + t.bridge_role_ms + t.native_acquire_ms + t.provenance_ms + t.prepare_ms;
    // Each top-level phase is truncated to whole ms, so the sum may undershoot by
    // at most one ms per phase; `other_ms` carries the rest. Nothing is double counted.
    assert!(parts <= handshake + 5, "phases {parts} exceed handshake {handshake}: {t:?}");
    assert!(parts + t.other_ms >= handshake && parts + t.other_ms <= handshake + 5, "{t:?} handshake {handshake}");
    // Nested measurements stay inside their parents.
    assert!(t.bridge_start_ms <= t.bridge_role_ms && t.reuse_take_ms <= t.native_acquire_ms, "{t:?}");
    assert!(t.run_lock_acquisitions > 0 && t.run_lock_wait_us <= handshake * 1000 + 5_000, "{t:?}");
}

#[tokio::test]
async fn connected_sends_attribute_waits_with_live_sse_clients() {
    let dir = tempfile::tempdir().unwrap();
    let binary = dir.path().join("codex");
    std::fs::write(&binary, include_str!("fake_session_native.py")).unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(dir.path().join("startup-fixture"), "").unwrap();
    let app = App::new(
        Store::open(&dir.path().join("state.db"), dir.path().to_str().unwrap()).unwrap(),
        HOST.into(), binary.clone(), None, "admin".into(), "recover".into(),
    );
    let created: SessionCommand = serde_json::from_value(json!({"api":API,"id":"latency-session","title":"Latency","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
    *app.native_role_root.lock().unwrap() = dir.path().join("native-role-fixture");
    app.store.lock().unwrap().create_session(&created).unwrap();
    let c = cookie(&app).await;
    let routed = router(app.clone());

    // Four simultaneous browsers on the shared workspace event stream.
    let bootstrap = routed.clone().oneshot(get("/api/workspace?transport=events", &c)).await.unwrap();
    let after = bootstrap.headers()["x-deck-workspace-cursor"].to_str().unwrap().to_owned();
    let frames = Arc::new(AtomicUsize::new(0));
    let mut clients = vec![];
    for _ in 0..4 {
        let routed = routed.clone();
        let request = get(&format!("/api/workspace/events?after={after}"), &c);
        let frames = frames.clone();
        clients.push(tokio::spawn(async move {
            let mut body = routed.oneshot(request).await.unwrap().into_body();
            while let Some(Ok(frame)) = body.frame().await {
                if frame.into_data().is_ok_and(|d| d.starts_with(b"data") || d.starts_with(b"id")) {
                    frames.fetch_add(1, Ordering::Relaxed);
                }
            }
        }));
    }

    // Idle send: no blocker is claimed and the phases partition the handshake.
    let first = routed.clone().oneshot(post("latency-session", "latency-1", &c)).await.unwrap();
    assert_eq!(first.status(), 200);
    let idle_header = first.headers()["server-timing"].to_str().unwrap().to_owned();
    assert!(idle_header.contains("desc=\"none\""), "{idle_header}");
    let r1 = completed(&app, "latency-1").await;
    assert_phases_partition(&r1);
    let t1 = r1.startup_timing.as_ref().unwrap();
    assert_eq!(t1.submit_blocker, "");
    assert!(t1.submit_lock_wait_us <= t1.submit_lock_span_us);
    assert!(t1.bridge_start_ms <= t1.bridge_role_ms);

    // Contended send: an untraced store holder delays the handler. The header and the
    // persisted dispatch timing agree on where the time went.
    let holder = {
        let app = app.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let join = std::thread::spawn(move || {
            let guard = app.store.lock().unwrap();
            tx.send(()).unwrap();
            std::thread::sleep(Duration::from_millis(200));
            drop(guard);
        });
        rx.recv().unwrap();
        join
    };
    let blocked = routed.clone().oneshot(post("latency-session", "latency-2", &c)).await.unwrap();
    holder.join().unwrap();
    assert_eq!(blocked.status(), 200);
    let header = blocked.headers()["server-timing"].to_str().unwrap().to_owned();
    let waited = dur(&header, "deck_lock_pre") + dur(&header, "deck_lock_active")
        + dur(&header, "deck_lock_history") + dur(&header, "deck_lock_store");
    assert!(waited >= 150.0 && waited <= dur(&header, "deck_receipt"), "{header}");
    assert!(header.contains("desc=\"untraced\""), "{header}");
    let r2 = completed(&app, "latency-2").await;
    assert_phases_partition(&r2);
    let t2 = r2.startup_timing.as_ref().unwrap();
    assert!(t2.submit_lock_wait_us >= 150_000 && t2.submit_lock_wait_us <= t2.submit_lock_span_us, "{t2:?}");
    assert_eq!(t2.submit_blocker, "untraced");
    // Dominant stage of this send, derived only from recorded fields.
    let others = [t2.version_ms, t2.bridge_role_ms, t2.native_acquire_ms, t2.prepare_ms, t2.other_ms];
    assert!(t2.submit_lock_wait_us / 1000 > *others.iter().max().unwrap(), "{t2:?}");

    // The next ordinary send after release is clean again, and dedup still holds.
    let third = routed.clone().oneshot(post("latency-session", "latency-3", &c)).await.unwrap();
    assert!(third.headers()["server-timing"].to_str().unwrap().contains("desc=\"none\""));
    let again = routed.clone().oneshot(post("latency-session", "latency-3", &c)).await.unwrap();
    assert_eq!(again.status(), 200);
    let r3 = completed(&app, "latency-3").await;
    assert_phases_partition(&r3);
    let receipt: Value = serde_json::to_value(app.receipt("latency-3").unwrap()).unwrap();
    assert_eq!(receipt["id"], "latency-3");
    assert_eq!(app.store.lock().unwrap().all().unwrap().iter().filter(|r| r.id == "latency-3").count(), 1);

    // Live clients saw the commits without altering admission order.
    tokio::time::timeout(Duration::from_secs(5), async { while frames.load(Ordering::Relaxed) < 4 { tokio::time::sleep(Duration::from_millis(20)).await; } })
        .await.expect("every SSE client receives workspace frames");
    assert!(app.receipt("latency-1").unwrap().dispatch_ms <= app.receipt("latency-2").unwrap().dispatch_ms);
    assert!(app.receipt("latency-2").unwrap().dispatch_ms <= app.receipt("latency-3").unwrap().dispatch_ms);
    for client in clients { client.abort(); }
}
