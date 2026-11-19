// Protects durable command identity, conservative recovery, and authority admission.
// Oracles: Sprint 1 scenarios 2, 3, 5, 6, 9; INV06, INV10, INV11, INV14.
use deck2::{Store, admit_http};
use deck2_shared::{API, Phase, Submit};
fn command(id: &str, prompt: &str) -> Submit {
    Submit {
        attachments: Vec::new(),
        mode: Default::default(),
        api: API,
        id: id.into(),
        prompt: prompt.into(),
    }
}
#[test]
fn durable_identity_and_conflict() {
    let project_fixture=tempfile::tempdir().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("state.db");
    let mut s = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    let first = s.accept(&command("command-1", "Explain README")).unwrap();
    assert_eq!(first.phase, Phase::Accepted);
    assert_eq!(
        s.accept(&command("command-1", "Explain README"))
            .unwrap()
            .id,
        first.id
    );
    assert!(s.accept(&command("command-1", "Different input")).is_err());
    assert!(s.accept(&command("command-2", "Explain README")).is_err());
    drop(s);
    let mut s = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    assert_eq!(
        s.accept(&command("command-1", "Explain README"))
            .unwrap()
            .phase,
        Phase::Uncertain
    );
    assert!(s.accept(&command("command-3", "new turn")).is_err());
    let reopened=Store::open(&path,"/other-project").unwrap();
    assert_eq!(reopened.project,project_fixture.path().to_str().unwrap());
    assert_eq!(reopened.all().unwrap().len(),1);
}
#[test]
fn incompatible_or_invalid_never_accepts() {
    let project_fixture=tempfile::tempdir().unwrap();
    let mut s = Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap();
    let mut c = command("command-1", "Explain README");
    c.api = API + 1;
    assert!(s.accept(&c).is_err());
    assert!(s.accept(&command("bad/id", "x")).is_err());
    assert!(s.accept(&command("command-2", " ")).is_err());
    assert!(s.all().unwrap().is_empty());
}
#[test]
fn host_origin_and_auth_are_independent_requirements() {
    let host = "127.0.0.1:32123";
    assert!(admit_http(
        host,
        Some(host),
        Some("http://127.0.0.1:32123"),
        true,
        true
    ));
    assert!(!admit_http(
        host,
        Some("evil.example"),
        Some("http://127.0.0.1:32123"),
        true,
        true
    ));
    assert!(!admit_http(
        host,
        Some(host),
        Some("http://evil.example"),
        true,
        true
    ));
    assert!(!admit_http(host, Some(host), None, true, true));
    assert!(!admit_http(
        host,
        Some(host),
        Some("http://127.0.0.1:32123"),
        false,
        true
    ));
    assert!(admit_http(host, Some(host), None, true, false));
}

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use deck2::server::{App, router};
use http_body_util::BodyExt;
use std::{os::unix::fs::PermissionsExt, path::Path};
use tower::ServiceExt;
fn fake(root: &Path, mode: &str) -> std::path::PathBuf {
    std::fs::write(root.join("mode"), mode).unwrap();
    let path = root.join("codex");
    std::fs::write(&path, include_str!("fake_native.py")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    path
}
async fn call(
    app: &App,
    path: &str,
    body: Option<String>,
    cookie: Option<&str>,
) -> axum::response::Response {
    let body = if path == "/api/commands" {
        body.map(|b| {
            if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&b) {
                v["session"] = serde_json::json!(app.store.lock().unwrap().session);
                v["fresh"] = serde_json::json!(true);
                v.to_string()
            } else {
                b
            }
        })
    } else {
        body
    };
    let mut req = Request::builder()
        .uri(path)
        .header("Host", "127.0.0.1:32123");
    if body.is_some() {
        req = req
            .method("POST")
            .header("Origin", "http://127.0.0.1:32123")
            .header("Content-Type", "application/json");
    }
    if let Some(c) = cookie {
        req = req.header("Cookie", c);
    }
    router(app.clone())
        .oneshot(req.body(Body::from(body.unwrap_or_default())).unwrap())
        .await
        .unwrap()
}
async fn authenticate(app: &App) -> String {
    let token = app.issue_launch();
    let response = call(app, "/auth", Some(token.clone()), None).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    assert_eq!(
        call(app, "/auth", Some(token), None).await.status(),
        StatusCode::FORBIDDEN
    );
    cookie
}
async fn settle(app: &App, id: &str) -> deck2_shared::Receipt {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let r = app.receipt(id).unwrap();
            if !r.phase.active() {
                return r;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("fake native did not settle")
}
#[tokio::test]
async fn authenticated_default_composition_streams_and_deduplicates() {
    let project_fixture=tempfile::tempdir().unwrap();
    let t = tempfile::tempdir().unwrap();
    let binary = fake(t.path(), "early");
    let app = App::new(
        Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        binary,
        None,
        "admin".into(),
        "deck2 open --state-dir /owned-fixture".into(),
    );
    let cmd = serde_json::to_string(&command("command-1", "Explain file")).unwrap();
    assert_eq!(
        call(&app, "/api/commands", Some(cmd.clone()), None)
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let cookie = authenticate(&app).await;
    let (a, b) = tokio::join!(
        call(&app, "/api/commands", Some(cmd.clone()), Some(&cookie)),
        call(&app, "/api/commands", Some(cmd.clone()), Some(&cookie))
    );
    assert_eq!(a.status(), StatusCode::OK);
    assert_eq!(b.status(), StatusCode::OK);
    let r = settle(&app, "command-1").await;
    assert_eq!(r.phase, Phase::Completed);
    assert!(r.text.contains("early output"));
    assert!(r.text.contains("Real boundary output"));
    assert!(r.first_output_ms.is_some());
    assert!(r.handshake_ms.is_some());
    assert_eq!(
        call(&app, "/api/commands", Some(cmd), Some(&cookie))
            .await
            .status(),
        StatusCode::OK
    );
    let response = call(&app, "/api/workspace", None, Some(&cookie)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let w: deck2_shared::Workspace =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(w.receipts.len(), 1);
    assert_eq!(
        std::fs::read_to_string(t.path().join("dispatches"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    assert_eq!(
        call(
            &app,
            "/api/commands",
            Some(serde_json::to_string(&command("command-1", "changed")).unwrap()),
            Some(&cookie)
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
}
#[tokio::test]
async fn malformed_lost_ack_and_unexpected_requests_are_uncertain_never_replayed() {
    let project_fixture=tempfile::tempdir().unwrap();
    for mode in ["malformed", "lost-ack", "request", "wrong-turn"] {
        let t = tempfile::tempdir().unwrap();
        let binary = fake(t.path(), mode);
        let app = App::new(
            Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
            "127.0.0.1:32123".into(),
            binary,
            None,
            "admin".into(),
            "deck2 open --state-dir /owned-fixture".into(),
        );
        let cookie = authenticate(&app).await;
        let cmd = serde_json::to_string(&command("command-1", "Explain file")).unwrap();
        call(&app, "/api/commands", Some(cmd.clone()), Some(&cookie)).await;
        assert_eq!(
            settle(&app, "command-1").await.phase,
            Phase::Uncertain,
            "{mode}"
        );
        call(&app, "/api/commands", Some(cmd), Some(&cookie)).await;
        assert_eq!(
            std::fs::read_to_string(t.path().join("dispatches"))
                .unwrap()
                .lines()
                .count(),
            1
        );
    }
}
#[tokio::test]
async fn missing_auth_unsafe_sandbox_and_connected_mcp_block_before_dispatch() {
    let project_fixture=tempfile::tempdir().unwrap();
    for mode in ["auth", "unsafe", "mcp"] {
        let t = tempfile::tempdir().unwrap();
        let binary = fake(t.path(), mode);
        let app = App::new(
            Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
            "127.0.0.1:32123".into(),
            binary,
            None,
            "admin".into(),
            "deck2 open --state-dir /owned-fixture".into(),
        );
        let cookie = authenticate(&app).await;
        call(
            &app,
            "/api/commands",
            Some(serde_json::to_string(&command("command-1", "Explain file")).unwrap()),
            Some(&cookie),
        )
        .await;
        assert_eq!(
            settle(&app, "command-1").await.phase,
            Phase::Failed,
            "{mode}"
        );
        assert!(!t.path().join("dispatches").exists());
    }
}
#[tokio::test]
async fn cancellation_waits_for_native_settlement_and_reconnect_does_not_dispatch() {
    let project_fixture=tempfile::tempdir().unwrap();
    let t = tempfile::tempdir().unwrap();
    let binary = fake(t.path(), "hold");
    let app = App::new(
        Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        binary,
        None,
        "admin".into(),
        "deck2 open --state-dir /owned-fixture".into(),
    );
    let cookie = authenticate(&app).await;
    call(
        &app,
        "/api/commands",
        Some(serde_json::to_string(&command("command-1", "Explain file")).unwrap()),
        Some(&cookie),
    )
    .await;
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while app.receipt("command-1").unwrap().phase != Phase::Running {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    for _ in 0..3 {
        assert_eq!(
            call(&app, "/api/workspace", None, Some(&cookie))
                .await
                .status(),
            StatusCode::OK
        );
    }
    assert_eq!(
        call(
            &app,
            "/api/commands/command-1/cancel",
            Some("{}".into()),
            Some(&cookie)
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(settle(&app, "command-1").await.phase, Phase::Cancelled);
    assert_eq!(
        std::fs::read_to_string(t.path().join("dispatches"))
            .unwrap()
            .lines()
            .count(),
        1
    );
}
#[tokio::test]
async fn wrong_origin_host_and_api_cannot_dispatch() {
    let project_fixture=tempfile::tempdir().unwrap();
    let t = tempfile::tempdir().unwrap();
    let app = App::new(
        Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        fake(t.path(), "normal"),
        None,
        "admin".into(),
        "deck2 open --state-dir /owned-fixture".into(),
    );
    let cookie = authenticate(&app).await;
    for (host, origin) in [
        ("evil.test", "http://127.0.0.1:32123"),
        ("127.0.0.1:32123", "http://evil.test"),
        ("127.0.0.1:32123", ""),
    ] {
        let req = Request::builder()
            .method("POST")
            .uri("/api/commands")
            .header("Host", host)
            .header("Origin", origin)
            .header("Cookie", &cookie)
            .header("Content-Type", "application/json")
            .body(Body::from(
                serde_json::to_string(&command("command-1", "x")).unwrap(),
            ))
            .unwrap();
        assert_eq!(
            router(app.clone()).oneshot(req).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }
    let mut cmd = command("command-1", "x");
    cmd.api = API + 1;
    assert_eq!(
        call(
            &app,
            "/api/commands",
            Some(serde_json::to_string(&cmd).unwrap()),
            Some(&cookie)
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    assert!(!t.path().join("dispatches").exists());
}

// Admission must reject before native effects, while distinguishing only safe
// boundary categories so a missing cookie can be recovered without weakening it.
#[tokio::test]
async fn authentication_diagnostics_preserve_all_admission_requirements() {
    let project_fixture=tempfile::tempdir().unwrap();
    let t = tempfile::tempdir().unwrap();
    let app = App::new(
        Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        fake(t.path(), "normal"),
        None,
        "private-admin".into(),
        "deck2 open --state-dir /owned-fixture".into(),
    );
    let cookie = authenticate(&app).await;
    for (host, origin, site, credential, code) in [
        (
            "evil.test",
            Some("http://127.0.0.1:32123"),
            "same-origin",
            cookie.as_str(),
            "host_denied",
        ),
        (
            "127.0.0.1:32123",
            Some("http://evil.test"),
            "same-origin",
            cookie.as_str(),
            "origin_denied",
        ),
        (
            "127.0.0.1:32123",
            None,
            "same-origin",
            cookie.as_str(),
            "origin_denied",
        ),
        (
            "127.0.0.1:32123",
            Some("http://127.0.0.1:32123"),
            "cross-site",
            cookie.as_str(),
            "fetch_site_denied",
        ),
        (
            "127.0.0.1:32123",
            Some("http://127.0.0.1:32123"),
            "same-origin",
            "",
            "session_required",
        ),
        (
            "127.0.0.1:32123",
            Some("http://127.0.0.1:32123"),
            "same-origin",
            "deck2_32123=stale-secret",
            "session_required",
        ),
    ] {
        let mut req = Request::builder()
            .method("POST")
            .uri("/api/commands")
            .header("Host", host)
            .header("Sec-Fetch-Site", site)
            .header("Cookie", credential)
            .header("Content-Type", "application/json");
        if let Some(origin) = origin {
            req = req.header("Origin", origin);
        }
        let response = router(app.clone())
            .oneshot(
                req.body(Body::from(
                    serde_json::to_string(&command("private-prompt-id", "private-prompt")).unwrap(),
                ))
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let bytes = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        let text = std::str::from_utf8(&bytes).unwrap();
        let problem: deck2_shared::Problem = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(problem.code, code);
        assert!(
            !text.contains("private-admin")
                && !text.contains("stale-secret")
                && !text.contains("private-prompt")
                && !text.contains(&cookie)
        );
    }
    assert!(app.store.lock().unwrap().all().unwrap().is_empty());
    assert!(!t.path().join("dispatches").exists());
}

#[tokio::test]
async fn storage_failure_before_acceptance_never_dispatches() {
    let project_fixture=tempfile::tempdir().unwrap();
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("state.db");
    let store = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    let external = rusqlite::Connection::open(&path).unwrap();
    external.execute_batch("CREATE TRIGGER fail_insert BEFORE INSERT ON receipts BEGIN SELECT RAISE(FAIL,'fault'); END;").unwrap();
    let app = App::new(
        store,
        "127.0.0.1:32123".into(),
        fake(t.path(), "normal"),
        None,
        "admin".into(),
        "deck2 open --state-dir /owned-fixture".into(),
    );
    let cookie = authenticate(&app).await;
    assert_eq!(
        call(
            &app,
            "/api/commands",
            Some(serde_json::to_string(&command("command-1", "x")).unwrap()),
            Some(&cookie)
        )
        .await
        .status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert!(!t.path().join("dispatches").exists());
    let response = call(&app, "/api/workspace", None, Some(&cookie)).await;
    let w: deck2_shared::Workspace =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert!(w.availability.is_some());
    assert!(w.receipts.is_empty());
}
#[tokio::test]
async fn storage_failure_after_dispatch_blocks_admission_and_recovers_uncertain() {
    let project_fixture=tempfile::tempdir().unwrap();
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("state.db");
    let store = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    let external = rusqlite::Connection::open(&path).unwrap();
    external.execute_batch("CREATE TRIGGER fail_running BEFORE UPDATE ON receipts WHEN json_extract(NEW.body,'$.phase') IN ('running','uncertain') BEGIN SELECT RAISE(FAIL,'fault'); END;").unwrap();
    let app = App::new(
        store,
        "127.0.0.1:32123".into(),
        fake(t.path(), "normal"),
        None,
        "admin".into(),
        "deck2 open --state-dir /owned-fixture".into(),
    );
    let cookie = authenticate(&app).await;
    call(
        &app,
        "/api/commands",
        Some(serde_json::to_string(&command("command-1", "x")).unwrap()),
        Some(&cookie),
    )
    .await;
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let response = call(&app, "/api/workspace", None, Some(&cookie)).await;
            let w: deck2_shared::Workspace =
                serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            if w.availability.is_some() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(app.receipt("command-1").unwrap().phase, Phase::Dispatching);
    assert_eq!(
        call(
            &app,
            "/api/commands",
            Some(serde_json::to_string(&command("command-2", "new")).unwrap()),
            Some(&cookie)
        )
        .await
        .status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    external
        .execute_batch("DROP TRIGGER fail_running;")
        .unwrap();
    drop(app);
    let mut s = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    assert_eq!(s.get("command-1").unwrap().unwrap().phase, Phase::Uncertain);
    assert_eq!(s.recover().unwrap(), 1);
    assert_eq!(s.get("command-1").unwrap().unwrap().phase, Phase::Failed);
    assert_eq!(
        std::fs::read_to_string(t.path().join("dispatches"))
            .unwrap()
            .lines()
            .count(),
        1
    );
}
#[tokio::test]
async fn native_failed_result_retains_output_without_claiming_success() {
    let project_fixture=tempfile::tempdir().unwrap();
    let t = tempfile::tempdir().unwrap();
    let app = App::new(
        Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        fake(t.path(), "failed"),
        None,
        "admin".into(),
        "deck2 open --state-dir /owned-fixture".into(),
    );
    let cookie = authenticate(&app).await;
    call(
        &app,
        "/api/commands",
        Some(serde_json::to_string(&command("command-1", "x")).unwrap()),
        Some(&cookie),
    )
    .await;
    let r = settle(&app, "command-1").await;
    assert_eq!(r.phase, Phase::Failed);
    assert!(!r.text.is_empty());
}

#[test]
fn diagnostic_retention_is_bounded_and_does_not_replace_receipts() {
    let project_fixture=tempfile::tempdir().unwrap();
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("state.db");
    let store = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    for i in 0..150 {
        store.diagnostic(&format!("reference-{i}"), "access_denied", 403);
    }
    let conn = rusqlite::Connection::open(&path).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM diagnostics", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 128);
    assert!(store.all().unwrap().is_empty());
    let latest: String = conn
        .query_row(
            "SELECT id FROM diagnostics ORDER BY rowid DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(latest, "reference-149");
}

// S1-Q01: rejected stores preserve bytes, SQL schema/data and journal mode.
#[test]
fn rejected_existing_state_is_untouched() {
    let project_fixture=tempfile::tempdir().unwrap();
    for sql in [
        "CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); INSERT INTO meta VALUES('schema','999');",
        "CREATE TABLE meta(key TEXT PRIMARY KEY,broken TEXT);",
        "CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES('preserve');",
        "CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); INSERT INTO meta VALUES('schema','1');",
    ] {
        let t = tempfile::tempdir().unwrap();
        let path = t.path().join("state.db");
        let c = rusqlite::Connection::open(&path).unwrap();
        c.execute_batch(sql).unwrap();
        let schema: String = c
            .query_row("SELECT group_concat(sql) FROM sqlite_master", [], |r| {
                r.get(0)
            })
            .unwrap();
        let journal: String = c
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        drop(c);
        let before = std::fs::read(&path).unwrap();
        assert!(Store::open(&path, project_fixture.path().to_str().unwrap()).is_err());
        assert!(
            before == std::fs::read(&path).unwrap(),
            "bytes changed: {sql}"
        );
        let c = rusqlite::Connection::open(&path).unwrap();
        assert_eq!(
            schema,
            c.query_row::<String, _, _>("SELECT group_concat(sql) FROM sqlite_master", [], |r| r
                .get(0))
                .unwrap()
        );
        assert_eq!(
            journal,
            c.query_row::<String, _, _>("PRAGMA journal_mode", [], |r| r.get(0))
                .unwrap()
        );
    }
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("corrupt.db");
    std::fs::write(&path, b"not a SQLite database").unwrap();
    assert!(Store::open(&path, project_fixture.path().to_str().unwrap()).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"not a SQLite database");
}

// S1-Q04: encoded size must accommodate every valid 16 KiB prompt.
#[tokio::test]
async fn escaped_prompt_is_accepted_and_oversize_is_rejected_before_dispatch() {
    let project_fixture=tempfile::tempdir().unwrap();
    let t = tempfile::tempdir().unwrap();
    let app = App::new(
        Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        fake(t.path(), "normal"),
        None,
        "admin".into(),
        "deck2 open --state-dir /owned-fixture".into(),
    );
    let cookie = authenticate(&app).await;
    let huge = serde_json::to_string(&command("oversize-1", &"\0".repeat(17000))).unwrap();
    assert_eq!(
        call(&app, "/api/commands", Some(huge), Some(&cookie))
            .await
            .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert!(app.store.lock().unwrap().all().unwrap().is_empty());
    let valid = serde_json::to_string(&command("escaped-1", &"\0".repeat(16384))).unwrap();
    assert_eq!(
        call(&app, "/api/commands", Some(valid), Some(&cookie))
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(settle(&app, "escaped-1").await.phase, Phase::Completed);
}

// S1-Q02: no dispatch and no surviving probe group, including reaped descendants.
#[tokio::test]
async fn version_probe_hangs_and_floods_are_owned_and_bounded() {
    let project_fixture=tempfile::tempdir().unwrap();
    for mode in ["probe-hang", "probe-flood", "probe-stderr"] {
        let t = tempfile::tempdir().unwrap();
        let app = App::new(
            Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
            "127.0.0.1:32123".into(),
            fake(t.path(), mode),
            None,
            "admin".into(),
            "deck2 open --state-dir /owned-fixture".into(),
        );
        let cookie = authenticate(&app).await;
        call(
            &app,
            "/api/commands",
            Some(serde_json::to_string(&command("probe-command", "x")).unwrap()),
            Some(&cookie),
        )
        .await;
        let r = tokio::time::timeout(std::time::Duration::from_secs(7), async {
            loop {
                let r = app.receipt("probe-command").unwrap();
                if !r.phase.active() {
                    break r;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(r.phase, Phase::Failed);
        assert!(!t.path().join("dispatches").exists());
        let pids = std::fs::read_to_string(t.path().join("probe-pids")).unwrap();
        for pid in pids.split_whitespace() {
            assert!(
                !Path::new(&format!("/proc/{pid}")).exists(),
                "probe {pid} survived {mode}"
            );
        }
    }
}

// S1-Q03: interruption after a partial JSON line must preserve its prefix.
#[tokio::test]
async fn cancellation_preserves_partial_native_notification() {
    let project_fixture=tempfile::tempdir().unwrap();
    let t = tempfile::tempdir().unwrap();
    let app = App::new(
        Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        fake(t.path(), "split"),
        None,
        "admin".into(),
        "deck2 open --state-dir /owned-fixture".into(),
    );
    let cookie = authenticate(&app).await;
    call(
        &app,
        "/api/commands",
        Some(serde_json::to_string(&command("split-command", "x")).unwrap()),
        Some(&cookie),
    )
    .await;
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while !t.path().join("partial-written").exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    // The fake will not write the suffix until interrupt; allow the reader to consume.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    call(
        &app,
        "/api/commands/split-command/cancel",
        Some("{}".into()),
        Some(&cookie),
    )
    .await;
    let r = settle(&app, "split-command").await;
    assert_eq!(r.phase, Phase::Cancelled, "{}", r.detail);
    assert_eq!(r.text, "split output");
    assert_eq!(
        std::fs::read_to_string(t.path().join("dispatches"))
            .unwrap()
            .lines()
            .count(),
        1
    );
}

// S1-Q01 also covers a nominally supported schema with corrupt persisted data.
#[test]
fn corrupt_supported_receipt_is_rejected_before_writes() {
    let project_fixture=tempfile::tempdir().unwrap();
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("state.db");
    let mut store = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    store.accept(&command("corrupt-command", "retain")).unwrap();
    drop(store);
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute("UPDATE receipts SET body='corrupt JSON'", [])
        .unwrap();
    drop(conn);
    let before = std::fs::read(&path).unwrap();
    assert!(Store::open(&path, project_fixture.path().to_str().unwrap()).is_err());
    assert!(
        before == std::fs::read(&path).unwrap(),
        "corrupt supported state changed"
    );
    let conn =
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    assert_eq!(
        conn.query_row::<String, _, _>("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap(),
        "wal"
    );
    assert_eq!(
        conn.query_row::<String, _, _>("SELECT body FROM receipts", [], |r| r.get(0))
            .unwrap(),
        "corrupt JSON"
    );
}

// S2 external-effect contract: fake only at native edge; production HTTP, store,
// control loop and transport must jointly enforce the accepted release boundary.
#[tokio::test]
async fn reviewed_edit_default_composition_denies_deduplicates_and_cancels() {
    for case in [
        "allow",
        "deny",
        "cancel",
        "revoke",
        "disconnect",
        "stale",
        "no-result",
        "missing",
    ] {
        let t = tempfile::tempdir().unwrap();
        let project = t.path().to_str().unwrap();
        std::fs::write(t.path().join("example.txt"), "before\n").unwrap();
        let binary = fake(
            t.path(),
            if case == "disconnect" {
                "edit-disconnect"
            } else if case == "missing" {
                "edit-missing"
            } else if case == "no-result" {
                "edit-no-result"
            } else {
                "edit"
            },
        );
        let app = App::new(
            Store::open_memory(project).unwrap(),
            "127.0.0.1:32123".into(),
            binary,
            None,
            "admin".into(),
            "open".into(),
        );
        let cookie = authenticate(&app).await;
        let cmd=serde_json::json!({"api":API,"id":"reviewed-edit","mode":"reviewed_edit","prompt":"edit example.txt"}).to_string();
        assert_eq!(
            call(&app, "/api/commands", Some(cmd.clone()), Some(&cookie))
                .await
                .status(),
            StatusCode::CONFLICT
        );
        let trust = serde_json::json!({"api":API,"project":project,"trusted":true}).to_string();
        assert_eq!(
            call(&app, "/api/project/trust", Some(trust.clone()), None)
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(&app, "/api/project/trust", Some(trust), Some(&cookie))
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            call(&app, "/api/commands", Some(cmd), Some(&cookie))
                .await
                .status(),
            StatusCode::OK
        );
        let r = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let r = app.receipt("reviewed-edit").unwrap();
                if !r.decisions.is_empty() {
                    break r;
                }
                assert!(r.phase.active(), "{}", r.detail);
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let d = &r.decisions[0];
        assert_eq!(d.file.as_ref().unwrap().before, "before\n");
        assert!(!t.path().join("responses").exists());
        let path = format!("/api/decisions/{}/responses", d.id);
        let response=serde_json::json!({"api":API,"command_id":"decision-response","expected_revision":1,"response":{"type":if case=="deny" {"deny"}else{"allow_once"}}}).to_string();
        assert_eq!(
            call(&app, &path, Some(response.clone()), None)
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
        if case == "cancel" {
            call(
                &app,
                "/api/commands/reviewed-edit/cancel",
                Some("{}".into()),
                Some(&cookie),
            )
            .await;
        }
        if case == "revoke" {
            call(
                &app,
                "/api/project/trust",
                Some(serde_json::json!({"api":API,"project":project,"trusted":false}).to_string()),
                Some(&cookie),
            )
            .await;
        }
        if case == "stale" {
            std::fs::write(t.path().join("example.txt"), "user edits\n").unwrap();
        }
        let accepted = call(&app, &path, Some(response.clone()), Some(&cookie)).await;
        if ["cancel", "revoke"].contains(&case) {
            assert_eq!(accepted.status(), StatusCode::CONFLICT);
        } else {
            assert_eq!(accepted.status(), StatusCode::OK);
            assert_eq!(
                call(&app, &path, Some(response), Some(&cookie))
                    .await
                    .status(),
                StatusCode::OK
            );
        }
        if case == "stale" {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            assert!(!t.path().join("responses").exists());
            call(
                &app,
                "/api/commands/reviewed-edit/cancel",
                Some("{}".into()),
                Some(&cookie),
            )
            .await;
        }
        let r = settle(&app, "reviewed-edit").await;
        if case == "missing" {
            let d = &r.decisions[0];
            assert_eq!(d.state, deck2_shared::DecisionState::Settled);
            let f = d.file.as_ref().unwrap();
            assert_eq!(f.native_status.as_deref(), Some("completed"));
            assert!(f.after.is_none() && f.snapshot_error.is_some());
            assert!(!t.path().join("example.txt").exists());
            continue;
        }
        let text = std::fs::read_to_string(t.path().join("example.txt")).unwrap();
        assert_eq!(
            text,
            if case == "allow" || case == "no-result" {
                "after\n"
            } else if case == "stale" {
                "user edits\n"
            } else {
                "before\n"
            }
        );
        if case == "disconnect" || case == "no-result" {
            assert_eq!(r.phase, Phase::Uncertain);
        }
        let count = std::fs::read_to_string(t.path().join("responses"))
            .unwrap_or_default()
            .lines()
            .count();
        assert_eq!(
            count,
            if ["allow", "deny", "disconnect", "no-result"].contains(&case) {
                1
            } else {
                0
            }
        );
    }
}

// S2-Q01: only validation before persistence may certify non-acceptance.
// Conflicts, stale identities and accepted retries must not carry that proof.
#[tokio::test]
async fn rejected_answers_are_correctable_and_proof_excludes_conflicts() {
    let t = tempfile::tempdir().unwrap();
    let project = t.path().to_str().unwrap();
    let app = App::new(
        Store::open_memory(project).unwrap(),
        "127.0.0.1:32123".into(),
        fake(t.path(), "edit-question"),
        None,
        "admin".into(),
        "open".into(),
    );
    let cookie = authenticate(&app).await;
    call(
        &app,
        "/api/project/trust",
        Some(serde_json::json!({"api":API,"project":project,"trusted":true}).to_string()),
        Some(&cookie),
    )
    .await;
    assert_eq!(call(&app, "/api/commands", Some(serde_json::json!({"api":API,"id":"question-command","mode":"reviewed_edit","prompt":"ask"}).to_string()), Some(&cookie)).await.status(), StatusCode::OK);
    let d = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let r = app.receipt("question-command").unwrap();
            if let Some(d) = r.decisions.first() {
                break d.clone();
            }
            assert!(r.phase.active(), "{}", r.detail);
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let path = format!("/api/decisions/{}/responses", d.id);
    let mut body = serde_json::json!({"api":API,"command_id":"answer-response","expected_revision":d.revision,"response":{"type":"answers","answers":{"word":["界".repeat(2000)]}}});
    let rejected = call(&app, &path, Some(body.to_string()), Some(&cookie)).await;
    assert_eq!(rejected.status(), StatusCode::CONFLICT);
    let proof: serde_json::Value =
        serde_json::from_slice(&rejected.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(proof["code"], "answers_not_accepted");
    assert_eq!(proof["decision_id"], d.id);
    assert_eq!(proof["command_id"], body["command_id"]);
    assert_eq!(proof["expected_revision"], d.revision);
    assert!(
        app.receipt("question-command").unwrap().decisions[0]
            .resolution
            .is_none()
    );
    body["response"]["answers"]["word"] = serde_json::json!(["Copper"]);
    assert_eq!(
        call(&app, &path, Some(body.to_string()), Some(&cookie))
            .await
            .status(),
        StatusCode::OK
    );
    // Even invalid answers under an already accepted identity are a conflict.
    body["response"]["answers"]["word"] = serde_json::json!(["界".repeat(2000)]);
    let conflict = call(&app, &path, Some(body.to_string()), Some(&cookie)).await;
    let error: serde_json::Value =
        serde_json::from_slice(&conflict.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_ne!(error["code"], "answers_not_accepted");
    let r = settle(&app, "question-command").await;
    assert!(!r.decisions[0].grant_consumed);
    assert_eq!(
        std::fs::read_to_string(t.path().join("responses"))
            .unwrap()
            .lines()
            .count(),
        1
    );
}

// S5a missing preparation: unknown executable selection cannot be replaced by
// a later prepared binary. Oracle: no fallback; new admissions remain available.
#[tokio::test]
async fn missing_admitted_native_identity_never_falls_back_to_later_preparation() {
    let project_fixture=tempfile::tempdir().unwrap();
    let t = tempfile::tempdir().unwrap();
    let binary = fake(t.path(), "normal");
    let mut store = Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap();
    store
        .admit(&deck2_shared::ScopedSubmit {
            attachments: Vec::new(),
            api: API,
            id: "missing-admission".into(),
            session: store.session.clone(),
            prompt: "old unknown identity".into(),
            mode: Default::default(),
            queue: true,
            fresh: true,
        })
        .unwrap();
    let app = App::new(
        store,
        "127.0.0.1:32123".into(),
        binary,
        None,
        "admin".into(),
        "recover".into(),
    );
    app.store.lock().unwrap().pause_queue(false).unwrap();
    app.pump_queue();
    let old = settle(&app, "missing-admission").await;
    assert_eq!(
        old.phase,
        Phase::Failed,
        "unknown old selection must not silently dispatch current native"
    );
    assert!(old.dispatch_ms.is_none());
    let cookie = authenticate(&app).await;
    let body = serde_json::to_string(&command(
        "new-prepared-admission",
        "use current selected identity",
    ))
    .unwrap();
    assert_eq!(
        call(&app, "/api/commands", Some(body), Some(&cookie))
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        settle(&app, "new-prepared-admission").await.phase,
        Phase::Completed
    );
}
