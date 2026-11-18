// Protects S3 selection/admission boundaries using the default HTTP composition.
// Oracle: S3-SESSIONS/QUEUE/RECOVERY; fails if stale clients dispatch or selection launches work.
use axum::{body::Body, http::Request};
use deck2::{
    Store,
    server::{App, router},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
async fn call(app: &App, path: &str, body: Option<Value>, cookie: &str) -> (u16, Value) {
    let mut b = Request::builder()
        .uri(path)
        .header("Host", "127.0.0.1:32123")
        .header("Cookie", cookie);
    if body.is_some() {
        b = b
            .method("POST")
            .header("Origin", "http://127.0.0.1:32123")
            .header("Content-Type", "application/json");
    }
    let r = router(app.clone())
        .oneshot(
            b.body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status().as_u16();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn cookie(app: &App) -> String {
    let token = app.issue_launch();
    let r = router(app.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth")
                .header("Host", "127.0.0.1:32123")
                .header("Origin", "http://127.0.0.1:32123")
                .body(Body::from(token))
                .unwrap(),
        )
        .await
        .unwrap();
    r.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .into()
}
#[tokio::test]
async fn sessions_and_explicit_queue_are_durable_without_selection_dispatch() {
    let project_fixture=tempfile::tempdir().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("state.db");
    let app = App::new(
        Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        "/missing-native".into(),
        Some("unavailable fixture".into()),
        "admin".into(),
        "reopen".into(),
    );
    let c = cookie(&app).await;
    let (_, w) = call(&app, "/api/workspace", None, &c).await;
    let old = w["session"].as_str().unwrap();
    let (status, new) = call(
        &app,
        "/api/sessions",
        Some(json!({"api":deck2_shared::API,"id":"session-second","title":"Second conversation"})),
        &c,
    )
    .await;
    assert_eq!(status, 200, "{new}");
    let session = new["id"].as_str().unwrap();
    assert_ne!(session, old);
    let input = json!({"api":deck2_shared::API,"session":session,"id":"queued-command-1","prompt":"must not launch","mode":"read_only","queue":true,"fresh":false});
    let (status, r) = call(&app, "/api/commands", Some(input.clone()), &c).await;
    assert_eq!(status, 200, "{r}");
    assert_eq!(r["phase"], "queued");
    assert_eq!(
        call(&app, "/api/commands", Some(input), &c).await.1["id"],
        r["id"]
    );
    let (_, w) = call(&app, "/api/workspace", None, &c).await;
    assert_eq!(w["receipts"][0]["session"], session);
    assert_eq!(w["receipts"][0]["dispatch_ms"], Value::Null);
    drop(app);
    let app = App::new(
        Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        "/missing-native".into(),
        Some("unavailable fixture".into()),
        "admin".into(),
        "reopen".into(),
    );
    let c = cookie(&app).await;
    let (_, w) = call(&app, "/api/workspace", None, &c).await;
    assert_eq!(w["queue_paused"], true);
    assert_eq!(w["receipts"][0]["phase"], "queued");
    assert_eq!(
        call(
            &app,
            "/api/commands/queued-command-1/cancel",
            Some(json!({})),
            &c
        )
        .await
        .0,
        200
    );
    assert_eq!(
        call(&app, "/api/workspace", None, &c).await.1["receipts"][0]["phase"],
        "cancelled"
    );
}
#[tokio::test]
async fn old_client_cannot_choose_an_implicit_session() {
    let project_fixture=tempfile::tempdir().unwrap();
    let app = App::new(
        Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        "/missing".into(),
        None,
        "admin".into(),
        "reopen".into(),
    );
    let c = cookie(&app).await;
    let (status,_)=call(&app,"/api/commands",Some(json!({"api":deck2_shared::API,"id":"old-client-command","prompt":"must not be admitted"})),&c).await;
    assert!(status >= 400);
    assert!(app.store.lock().unwrap().all().unwrap().is_empty());
}
fn input(session: &str, id: &str, queued: bool) -> Value {
    json!({"api":deck2_shared::API,"session":session,"id":id,"prompt":"Owned fixture","queue":queued,"fresh":false})
}
async fn wait_phase(app: &App, id: &str, phase: deck2_shared::Phase) {
    tokio::time::timeout(std::time::Duration::from_secs(8), async {
        loop {
            if app.receipt(id).unwrap().phase == phase {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
fn fake(root: &std::path::Path, mode: &str) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let binary = root.join("codex");
    std::fs::write(&binary, include_str!("fake_native.py")).unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(root.join("mode"), mode).unwrap();
    binary
}
#[tokio::test]
async fn queue_cancel_and_one_slot_hold_across_conversations() {
    let project_fixture=tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let store = Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap();
    let session = store.session.clone();
    let app = App::new(
        store,
        "127.0.0.1:32123".into(),
        fake(root.path(), "hold"),
        None,
        "admin".into(),
        "reopen".into(),
    );
    let c = cookie(&app).await;
    assert_eq!(
        call(
            &app,
            "/api/commands",
            Some(input(&session, "running-first", false)),
            &c
        )
        .await
        .0,
        200
    );
    wait_phase(&app, "running-first", deck2_shared::Phase::Running).await;
    call(
        &app,
        "/api/sessions",
        Some(json!({"api":deck2_shared::API,"id":"session-second","title":"Second"})),
        &c,
    )
    .await;
    assert_eq!(
        call(
            &app,
            "/api/commands",
            Some(input("session-second", "must-not-dispatch", false)),
            &c
        )
        .await
        .0,
        409
    );
    for id in ["queued-cancelled", "queued-next"] {
        assert_eq!(
            call(
                &app,
                "/api/commands",
                Some(input("session-second", id, true)),
                &c
            )
            .await
            .0,
            200
        );
    }
    call(
        &app,
        "/api/commands/queued-cancelled/cancel",
        Some(json!({})),
        &c,
    )
    .await;
    assert_eq!(
        call(
            &app,
            "/api/sessions/session-second/remove",
            Some(json!({"api":deck2_shared::API})),
            &c
        )
        .await
        .0,
        409
    );
    call(
        &app,
        "/api/queue",
        Some(json!({"api":deck2_shared::API,"paused":false})),
        &c,
    )
    .await;
    assert_eq!(
        std::fs::read_to_string(root.path().join("dispatches"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    call(
        &app,
        "/api/commands/running-first/cancel",
        Some(json!({})),
        &c,
    )
    .await;
    wait_phase(&app, "queued-next", deck2_shared::Phase::Running).await;
    assert_eq!(
        std::fs::read_to_string(root.path().join("dispatches"))
            .unwrap()
            .lines()
            .count(),
        2
    );
    call(
        &app,
        "/api/commands/queued-next/cancel",
        Some(json!({})),
        &c,
    )
    .await;
    wait_phase(&app, "queued-next", deck2_shared::Phase::Cancelled).await;
    assert_eq!(app.receipt("queued-cancelled").unwrap().dispatch_ms, None);
}
#[tokio::test]
async fn lost_ack_blocks_every_conversation_and_never_replays() {
    let project_fixture=tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("state.db");
    let store = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    let session = store.session.clone();
    let app = App::new(
        store,
        "127.0.0.1:32123".into(),
        fake(root.path(), "lost-ack"),
        None,
        "admin".into(),
        "reopen".into(),
    );
    let c = cookie(&app).await;
    let command = input(&session, "ambiguous-input", false);
    call(&app, "/api/commands", Some(command.clone()), &c).await;
    wait_phase(&app, "ambiguous-input", deck2_shared::Phase::Uncertain).await;
    call(&app, "/api/commands", Some(command), &c).await;
    call(
        &app,
        "/api/sessions",
        Some(json!({"api":deck2_shared::API,"id":"session-second","title":"Second"})),
        &c,
    )
    .await;
    call(
        &app,
        "/api/commands",
        Some(input("session-second", "queued-after-uncertain", true)),
        &c,
    )
    .await;
    call(
        &app,
        "/api/queue",
        Some(json!({"api":deck2_shared::API,"paused":false})),
        &c,
    )
    .await;
    assert_eq!(
        app.receipt("queued-after-uncertain").unwrap().phase,
        deck2_shared::Phase::Queued
    );
    assert_eq!(
        call(
            &app,
            "/api/sessions/session-second/remove",
            Some(json!({"api":deck2_shared::API})),
            &c
        )
        .await
        .0,
        409
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("dispatches"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    drop(app);
    let s = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    assert!(s.queue_paused().unwrap());
    assert_eq!(
        s.get("ambiguous-input").unwrap().unwrap().phase,
        deck2_shared::Phase::Uncertain
    );
}
#[test]
fn queued_edit_rechecks_trust_and_claim_storage_failure_retains_waiting_input() {
    let project_fixture=tempfile::tempdir().unwrap();
    use deck2_shared::{Mode, ScopedSubmit};
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("state.db");
    let mut s = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    let command = ScopedSubmit {
        attachments: Vec::new(),
        api: deck2_shared::API,
        id: "queued-edit".into(),
        prompt: "fixture".into(),
        session: s.session.clone(),
        mode: Mode::ReviewedEdit,
        queue: true,
        fresh: false,
    };
    s.admit(&command).unwrap();
    s.pause_queue(false).unwrap();
    assert!(s.claim_next().unwrap().is_none());
    assert!(s.queue_paused().unwrap());
    assert_eq!(s.get(&command.id).unwrap().unwrap().dispatch_ms, None);
    s.set_trust(project_fixture.path().to_str().unwrap(), true).unwrap();
    s.pause_queue(false).unwrap();
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_claim BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'fault'); END;").unwrap();
    assert!(s.claim_next().is_err());
    assert_eq!(
        s.get(&command.id).unwrap().unwrap().phase,
        deck2_shared::Phase::Queued
    );
    conn.execute_batch("DROP TRIGGER fail_claim").unwrap();
    assert_eq!(
        s.claim_next().unwrap().unwrap().phase,
        deck2_shared::Phase::Accepted
    );
}
#[test]
fn schema_one_and_two_migrate_receipt_ownership_without_claiming_native_resume() {
    let project_fixture=tempfile::tempdir().unwrap();
    for schema in ["1", "2"] {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("state.db");
        let mut s = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
        let old = s.session.clone();
        let host = s.host_id().unwrap();
        let mut r = s
            .admit(&serde_json::from_value(input(&old, "legacy-command", false)).unwrap())
            .unwrap();
        r.phase = deck2_shared::Phase::Completed;
        r.thread = Some("ephemeral-legacy-thread".into());
        r.configuration = None; // These fields were not recorded in schema 1/2.
        s.save(&mut r).unwrap();
        drop(s);
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA journal_mode=DELETE; DROP TABLE projects; UPDATE sessions SET body=json_remove(body,'$.project'); UPDATE receipts SET body=json_remove(body,'$.configuration.project'); DROP TABLE decision_replies; DROP TABLE decision_commands; DROP TABLE session_decisions; DROP TABLE session_events; DROP TABLE sessions; DROP TABLE tasks; DROP TABLE task_calls; DROP TABLE configurations; DROP TABLE configuration_plans; DROP TABLE management_operations; DROP TABLE definitions; DROP TABLE read_snapshots; DROP TABLE snapshot_views; DROP TABLE snapshot_accesses; DELETE FROM meta WHERE key IN ('host','queue_paused');").unwrap();
        conn.execute("UPDATE meta SET value=?1 WHERE key='schema'", [schema])
            .unwrap();
        if schema == "1" {
            conn.execute("DELETE FROM meta WHERE key='trusted'", [])
                .unwrap();
        }
        drop(conn);
        let s = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
        assert_eq!(s.session, old);
        assert_eq!(s.all().unwrap()[0].session, old);
        assert_eq!(
            s.all().unwrap()[0].thread.as_deref(),
            Some("ephemeral-legacy-thread")
        );
        assert_eq!(s.session_by_id(&old).unwrap().native, None);
        assert_ne!(s.host_id().unwrap(), host);
    }
}

#[test]
fn operator_recovery_releases_unqualified_context_without_replaying_input() {
    let project_fixture=tempfile::tempdir().unwrap();
    let mut s = Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap();
    let session = s.session.clone();
    let mut r = s
        .admit(&serde_json::from_value(input(&session, "uncertain-native-context", false)).unwrap())
        .unwrap();
    s.bind_native(
        &session,
        "owned-unfinished-thread",
        deck2_shared::Mode::ReadOnly,
        deck2_shared::NativeRunner::Codex,
    )
    .unwrap();
    r.phase = deck2_shared::Phase::Uncertain;
    r.dispatch_ms = Some(1);
    s.save(&mut r).unwrap();
    assert_eq!(s.recover().unwrap(), 1);
    assert_eq!(s.session_by_id(&session).unwrap().native, None);
    assert_eq!(s.all().unwrap().len(), 1);
    assert!(
        s.all().unwrap()[0]
            .detail
            .contains("Previous outcome remains unknown")
    );
}

// Protects S4 recognized migration atomicity and rejection before journal changes.
// Oracle INV08/15: failed migration leaves previous schema/data/bytes intact.
#[test]
fn schema_three_task_migration_is_atomic_and_old_state_is_honest() {
    let project_fixture=tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("state.db");
    drop(Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap());
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("PRAGMA journal_mode=DELETE; DROP TABLE projects; UPDATE sessions SET body=json_remove(body,'$.project'); UPDATE receipts SET body=json_remove(body,'$.configuration.project'); DROP TABLE decision_replies; DROP TABLE decision_commands; DROP TABLE session_decisions; DROP TABLE session_events; DROP TABLE tasks; DROP TABLE task_calls; UPDATE meta SET value='3' WHERE key='schema'; CREATE TRIGGER stop_task_migration BEFORE UPDATE ON meta BEGIN SELECT RAISE(ABORT,'owned migration fault'); END;").unwrap();
    drop(conn);
    let before = std::fs::read(&path).unwrap();
    assert!(Store::open(&path, project_fixture.path().to_str().unwrap()).is_err());
    assert_eq!(before, std::fs::read(&path).unwrap());
    let conn = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='tasks'",
            [],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        0
    );
    conn.execute_batch("DROP TRIGGER stop_task_migration")
        .unwrap();
    drop(conn);
    let store = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    assert!(store.tasks().unwrap().is_empty());
    assert!(store.sessions().unwrap().iter().all(|s| s.native.is_none()));
}

// Unsupported team assignments fail in default HTTP composition, before launch.
#[tokio::test]
async fn unavailable_team_and_cached_clients_cannot_admit_work() {
    let project_fixture=tempfile::tempdir().unwrap();
    let app = App::new(
        Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        "/missing-native".into(),
        None,
        "admin".into(),
        "reopen".into(),
    );
    let c = cookie(&app).await;
    let (_, w) = call(&app, "/api/workspace", None, &c).await;
    for api in [2, deck2_shared::API] {
        let (status,_)=call(&app,"/api/commands",Some(json!({"api":api,"id":"team-command-1","session":w["session"],"prompt":"investigate","mode":"team","fresh":true})),&c).await;
        assert_eq!(status, 409);
    }
    let (_, w) = call(&app, "/api/workspace", None, &c).await;
    assert!(w["receipts"].as_array().unwrap().is_empty());
    assert!(w["tasks"].as_array().unwrap().is_empty());
}

// Original P10 oracle: revoke only exact unread input, under the same store lock
// as dispatch intent. A stale session/attempt or native claim must have no effect.
#[tokio::test]
async fn recall_input_exact_ack_and_claim_race() {
    use deck2_shared::{API, Phase};
    for phase in [
        Phase::Queued,
        Phase::Accepted,
        Phase::Preparing,
        Phase::Dispatching,
        Phase::Running,
        Phase::Uncertain,
    ] {
        let mut s = Store::open_memory("/fixture").unwrap();
        let session = s.session.clone();
        let command=serde_json::from_value(json!({"api":API,"id":"recall-input-one","session":session,"prompt":"original","queue":true,"mode":"read_only","fresh":false})).unwrap();
        let mut r = s.admit(&command).unwrap();
        r.phase = phase.clone();
        if matches!(
            phase,
            Phase::Dispatching | Phase::Running | Phase::Uncertain
        ) {
            r.dispatch_ms = Some(1);
        }
        s.save(&mut r).unwrap();
        let app = App::new(
            s,
            "127.0.0.1:32123".into(),
            "/missing-native".into(),
            Some("fixture".into()),
            "admin".into(),
            "reopen".into(),
        );
        let c = cookie(&app).await;
        let path = "/api/commands/recall-input-one/recall";
        for body in [
            json!({"api":API,"session":"foreign","attempt":r.attempt}),
            json!({"api":API,"session":session,"attempt":"stale"}),
        ] {
            assert_eq!(call(&app, path, Some(body), &c).await.0, 409);
            assert_eq!(app.store.lock().unwrap().get(&r.id).unwrap().unwrap(), r);
        }
        assert_eq!(
            call(
                &app,
                path,
                Some(json!({"api":API,"session":session,"attempt":r.attempt})),
                ""
            )
            .await
            .0,
            403
        );
        let (status, reply) = call(
            &app,
            path,
            Some(json!({"api":API,"session":session,"attempt":r.attempt})),
            &c,
        )
        .await;
        if matches!(phase, Phase::Queued | Phase::Accepted | Phase::Preparing) {
            assert_eq!(status, 200, "{reply}");
            assert_eq!(
                reply,
                json!({"id":r.id,"session":session,"attempt":r.attempt,"state":"cancelled"})
            );
            let revoked = app.store.lock().unwrap().get(&r.id).unwrap().unwrap();
            assert!(revoked.cancel_requested);
            assert_eq!(revoked.dispatch_ms, None);
            // Successful unread recall retracts only the conversation projection;
            // its durable audit receipt must remain available after reload.
            let (_, projection) = call(&app, "/api/workspace", None, &c).await;
            let projected = projection["receipts"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["id"] == r.id)
                .unwrap();
            assert!(
                projected["recalled_ms"].as_u64().is_some(),
                "recalled input must be durably retracted: {projected}"
            );
            let (_, repeated) = call(
                &app,
                path,
                Some(json!({"api":API,"session":session,"attempt":r.attempt})),
                &c,
            )
            .await;
            assert_eq!(repeated, reply);
            assert_eq!(
                app.store
                    .lock()
                    .unwrap()
                    .get(&r.id)
                    .unwrap()
                    .unwrap()
                    .revision,
                revoked.revision
            );
            // Simulate the production native dispatch gate after cancellation won.
            app.change(&r.id, |v| {
                if v.cancel_requested {
                    v.phase = Phase::Cancelled;
                } else {
                    v.phase = Phase::Dispatching;
                    v.dispatch_ms = Some(2);
                }
            })
            .unwrap();
            assert_eq!(
                app.store
                    .lock()
                    .unwrap()
                    .get(&r.id)
                    .unwrap()
                    .unwrap()
                    .dispatch_ms,
                None
            );
        } else {
            assert_eq!(status, 409);
            assert_eq!(app.store.lock().unwrap().get(&r.id).unwrap().unwrap(), r);
        }
    }
}

// Protects durable recall across host restart; ordinary cancellation is retained.
#[test]
fn recalled_input_survives_restart_without_erasing_audit() {
    use deck2_shared::API;
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("recall.db");
    let mut store = Store::open(&db, "/fixture").unwrap();
    let session = store.session.clone();
    let input = |id| {
        serde_json::from_value(json!({"api":API,"id":id,"session":session,"prompt":"retained audit","queue":true,"mode":"read_only","fresh":false})).unwrap()
    };
    let recalled = store.admit(&input("recalled-input")).unwrap();
    let cancelled = store.admit(&input("cancelled-input")).unwrap();
    let ack = store
        .recall_input(&session, &recalled.id, &recalled.attempt)
        .unwrap();
    store.request_cancel(&cancelled.id).unwrap();
    drop(store);
    let mut store = Store::open(&db, "/fixture").unwrap();
    assert_eq!(store.get(&recalled.id).unwrap().unwrap(), ack);
    assert!(
        store
            .get(&cancelled.id)
            .unwrap()
            .unwrap()
            .recalled_ms
            .is_none()
    );
    assert_eq!(
        store
            .recall_input(&session, &recalled.id, &recalled.attempt)
            .unwrap(),
        ack
    );
    assert_eq!(store.all().unwrap().len(), 2);
}
