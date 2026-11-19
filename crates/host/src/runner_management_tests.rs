use super::*;
use deck2_shared::{Mode, ScopedSubmit};
fn fixture(case: &str) -> (tempfile::TempDir, App) {
    let d = tempfile::tempdir().unwrap();
    let binary = d.path().join("codex");
    std::fs::write(
        &binary,
        include_bytes!("../../../scripts/fixtures/s7-codex.py"),
    )
    .unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(d.path().join("case"), case).unwrap();
    let store = Store::open(&d.path().join("state.db"), d.path().to_str().unwrap()).unwrap();
    let app = App::new(
        store,
        "127.0.0.1:12345".into(),
        binary,
        None,
        "admin".into(),
        "recovery".into(),
    );
    *app.artifact_store.lock().unwrap() = Some(d.path().join("artifacts"));
    *app.scope_root.lock().unwrap() = Some(d.path().join("scope-locks"));
    (d, app)
}
fn submit(s: &Store, id: &str, fresh: bool, queue: bool) -> ScopedSubmit {
    ScopedSubmit {
        attachments: Vec::new(),
        api: API,
        id: id.into(),
        prompt: "Inspect fixture".into(),
        mode: Mode::ReadOnly,
        session: s.session.clone(),
        queue,
        fresh,
    }
}
fn calls(d: &Path) -> Vec<Value> {
    std::fs::read_to_string(d.join("calls.jsonl"))
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}
// Oracle: management is finite, independent of threads/provider turns, and
// advertised models grant no qualification. Fails if inspection dispatches work.
#[tokio::test]
async fn inspection_is_threadless_and_distinguishes_failure_boundaries() {
    for case in [
        "ready",
        "missingauth",
        "version",
        "environment",
        "restriction",
    ] {
        let (d, app) = fixture(case);
        let result = inspect_native(&app.binary, &app.project).await;
        if ["ready", "missingauth", "version"].contains(&case) {
            let v = result.unwrap();
            assert_eq!(v["authenticated"], case != "missingauth");
            assert_eq!(
                v["models"].as_array().unwrap().len(),
                if case != "missingauth" { 2 } else { 0 }
            );
            if case == "ready" {
                assert_eq!(v["models"][1]["qualified"], false);
            }
        } else {
            let e = result.unwrap_err();
            assert!(
                match case {
                    "environment" => e.contains("environment"),
                    _ => e.contains("restriction"),
                },
                "{e}"
            );
        }
        assert!(
            calls(d.path())
                .iter()
                .all(|v| !v["method"].as_str().unwrap().starts_with("thread/")
                    && !v["method"].as_str().unwrap().starts_with("turn/"))
        );
    }
    let (d, app) = fixture("ready");
    assert!(
        inspect_native(&d.path().join("absent"), &app.project)
            .await
            .unwrap_err()
            .contains("missing")
    );
}
// Oracle: queued/active/uncertain ownership defers activation; duplicate/lost ack
// is the same receipt; admitted and continued policy never follows new selection.
#[test]
fn activation_preserves_admitted_and_continued_bindings() {
    let (_d, app) = fixture("ready");
    let path = app.artifact_root().unwrap();
    let mut s = app.store.lock().unwrap();
    let rev = s.configuration().unwrap().revision;
    let plan = s
        .plan_runner(
            &Review {
                api: API,
                expected_revision: rev,
                action: "sol_model".into(),
            },
            &path,
        )
        .unwrap();
    let r = Apply {
        api: API,
        operation_id: "operation-one".into(),
        allow: true,
    };
    let (mut op, run) = s.accept_runner(&plan.id, &r).unwrap();
    assert!(run);
    assert!(!s.accept_runner(&plan.id, &r).unwrap().1);
    let cmd = submit(&s, "queued-original", true, true);
    let mut root = s.admit(&cmd).unwrap();
    let original = root.configuration.clone();
    s.activate_runner(&mut op).unwrap();
    assert_eq!(op.phase, "deferred");
    assert_eq!(s.configuration().unwrap().revision, rev);
    root.phase = Phase::Completed;
    root.model = Some("gpt-6.1-sol".into());
    root.thread = Some("historical-thread".into());
    s.save(&mut root).unwrap();
    let session = s.session.clone();
    s.bind_native(&session, "historical-thread", Mode::ReadOnly, deck2_shared::NativeRunner::Codex)
        .unwrap();
    s.activate_runner(&mut op).unwrap();
    assert_eq!(op.phase, "applied");
    let c = submit(&s, "continue-original", false, true);
    let continued = s.admit(&c).unwrap();
    assert_eq!(continued.configuration, original);
    assert_eq!(continued.requested_model.as_deref(), Some("gpt-6.1-sol"));
    let c = submit(&s, "fresh-selection", true, true);
    let fresh = s.admit(&c).unwrap();
    assert_eq!(fresh.requested_model.as_deref(), Some("gpt-6.1-sol"));
    assert_eq!(s.get(&root.id).unwrap().unwrap().configuration, original);
    assert!(
        s.plan_runner(
            &Review {
                api: API,
                expected_revision: rev,
                action: "sol_model".into()
            },
            &path
        )
        .is_err()
    );
    let current_revision = s.configuration().unwrap().revision;
    assert!(
        s.plan_runner(
            &Review {
                api: API,
                expected_revision: current_revision,
                action: "unqualified".into()
            },
            &path
        )
        .is_err()
    );
}
// Oracle: selection and applied receipt commit together; an injected DB failure
// cannot leave the new policy selected with the prior operation outcome.
#[test]
fn activation_rolls_back_selection_when_receipt_fails() {
    let (_d, app) = fixture("ready");
    let path = app.artifact_root().unwrap();
    let mut s = app.store.lock().unwrap();
    let before = s.configuration().unwrap();
    let p = s
        .plan_runner(
            &Review {
                api: API,
                expected_revision: before.revision,
                action: "sol_model".into(),
            },
            &path,
        )
        .unwrap();
    let (mut op, _) = s
        .accept_runner(
            &p.id,
            &Apply {
                api: API,
                operation_id: "rollback-op".into(),
                allow: true,
            },
        )
        .unwrap();
    s.conn.execute_batch("CREATE TRIGGER deny_receipt BEFORE UPDATE ON runner_operations BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
    assert!(s.activate_runner(&mut op).is_err());
    assert_eq!(s.configuration().unwrap(), before);
    assert_eq!(s.runner_operation(&op.id).unwrap().phase, "accepted");
}
// Oracle: model acknowledgement mismatch blocks BEFORE turn dispatch.
#[tokio::test]
async fn acknowledged_model_mismatch_blocks_provider_turn() {
    let (d, app) = fixture("mismatch");
    let id = "mismatch-root";
    {
        let mut s = app.store.lock().unwrap();
        let mut c = s.configuration().unwrap();
        c.revision += 1;
        c.runner.as_mut().unwrap().model = Some("gpt-6.1-sol".into());
        s.save_configuration(&c).unwrap();
        let cmd = submit(&s, id, true, false);
        s.admit(&cmd).unwrap();
    }
    let (_tx, rx) = tokio::sync::watch::channel(false);
    crate::native::run(app.clone(), id.into(), app.binary.clone(), rx).await;
    assert_eq!(app.receipt(id).unwrap().phase, Phase::Failed);
    assert!(app.receipt(id).unwrap().detail.contains("model differs"));
    assert!(calls(d.path()).iter().all(|v| v["method"] != "turn/start"));
}
fn login_op(app: &App) -> Operation {
    let s = app.store.lock().unwrap();
    let c = s.configuration().unwrap();
    let b = c.runner.unwrap();
    Operation {
        allow: true,
        id: "login-fixture".into(),
        phase: "accepted".into(),
        published: false,
        detail: String::new(),
        at_ms: now(),
        plan: Plan {
            id: "login-fixture".into(),
            revision: c.revision,
            host: s.host_id().unwrap(),
            project: s.project.clone(),
            before: Some(b.clone()),
            target: b,
            action: "login_device".into(),
            store: String::new(),
            catalog: catalog(),
        },
    }
}
// Oracle: exact login IDs, account reread, cancellation races, finite deadline,
// and no durable verification material. Fakes explicitly do not qualify third-party login.
#[tokio::test]
async fn login_completion_cancellation_deadline_and_secrets() {
    for case in [
        "ready",
        "complete",
        "failure",
        "cancel",
        "race",
        "deadline",
        "malicious",
    ] {
        let (d, app) = fixture(case);
        let mut op = login_op(&app);
        app.store
            .lock()
            .unwrap()
            .save_runner_operation(&op)
            .unwrap();
        let (tx, mut rx) = tokio::sync::watch::channel(false);
        let cancel_task = if ["cancel", "race"].contains(&case) {
            let app = app.clone();
            Some(tokio::spawn(async move {
                for _ in 0..100 {
                    if !app.runner_runtime.lock().unwrap().material.is_empty() {
                        tx.send(true).unwrap();
                        return;
                    }
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
                panic!("handoff not reached")
            }))
        } else {
            None
        };
        let result = login_inner(&app, &mut op, &mut rx, Duration::from_millis(150)).await;
        if case == "malicious" {
            assert!(result.is_err());
        } else {
            let (auth, state) = result.unwrap();
            assert_eq!(auth, ["ready", "complete", "race"].contains(&case));
            if ["cancel", "race"].contains(&case) {
                assert_eq!(state, "cancelled");
            }
            if case == "deadline" {
                assert_eq!(state, "deadline");
            }
        }
        if let Some(t) = cancel_task {
            t.await.unwrap();
        }
        let stored =
            serde_json::to_string(&app.store.lock().unwrap().runner_operations().unwrap()).unwrap();
        assert!(
            !stored.contains("FIXTURE-CODE")
                && !stored.contains("SECRET-FIXTURE")
                && !stored.contains("auth.openai.com")
        );
        if case == "ready" {
            assert!(
                calls(d.path())
                    .iter()
                    .all(|v| v["method"] != "account/login/start")
            );
        }
        assert!(
            calls(d.path())
                .iter()
                .all(|v| v["method"] != "thread/start" && v["method"] != "turn/start")
        );
    }
}
// Oracle: restart does not replay login; same-scope admission stays serialized.
#[test]
fn login_restart_is_sanitized_and_uncertain_cleanup_keeps_blocker() {
    let (d, app) = fixture("ready");
    let mut op = login_op(&app);
    op.phase = "awaiting_user".into();
    app.store
        .lock()
        .unwrap()
        .save_runner_operation(&op)
        .unwrap();
    {
        let mut s = app.store.lock().unwrap();
        let cmd = submit(&s, "blocked-during-login", true, true);
        assert!(s.admit(&cmd).is_err());
    }
    drop(app);
    let s = Store::open(&d.path().join("state.db"), d.path().to_str().unwrap()).unwrap();
    assert_eq!(s.runner_operation(&op.id).unwrap().phase, "interrupted");
    op.phase = "uncertain".into();
    s.save_runner_operation(&op).unwrap();
    drop(s);
    let s = Store::open(&d.path().join("state.db"), d.path().to_str().unwrap()).unwrap();
    assert_eq!(s.runner_operation(&op.id).unwrap().phase, "uncertain");
    assert!(s.runner_busy().unwrap());
    let app = App::new(
        s,
        "127.0.0.1:12346".into(),
        d.path().join("codex"),
        None,
        "admin".into(),
        "recover".into(),
    );
    *app.scope_root.lock().unwrap() = Some(d.path().join("scope-locks"));
    app.retain_auth_scope().unwrap();
    app.clear_active("unrelated");
    assert!(
        app.scope_lock(true).is_err(),
        "uncertain login must retain scope"
    );
    assert!(calls(d.path()).is_empty());
}
#[test]
fn unsafe_urls_and_corrupt_archives_do_not_publish() {
    let (d, app) = fixture("ready");
    for url in [
        "http://auth.openai.com/x",
        "https://auth.openai.com.evil/x",
        "https://x@auth.openai.com/x",
        "https://auth.openai.com:444/x",
        "file:///tmp/x",
    ] {
        assert!(safe_handoff(&json!({"type":"chatgpt","authUrl":url})).is_err());
    }
    assert!(publish(&app.artifact_root().unwrap(), b"truncated").is_err());
    assert!(!d.path().join("artifacts/runners").exists());
}
// Explicit manual gate: exact acquired package, all companions and native
// no-thread handshake. Uses the native account location; no login initiated.
#[tokio::test]
#[ignore = "requires the exact acquired release and already-authenticated native environment"]
async fn acquired_package_publishes_and_inspects() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join("store");
    let archive = std::fs::read("../../target/s7-verification/acquisition/codex.tar.gz").unwrap();
    let binary = publish(&path, &archive).unwrap();
    assert_eq!(binary, pin_package(&path).unwrap());
    let result = inspect_native(&binary, d.path().to_str().unwrap())
        .await
        .unwrap();
    assert_eq!(result["authenticated"], true);
    assert_eq!(result["ready"], true);
    println!(
        "qualified actual package and threadless management; {} models",
        result["models"].as_array().unwrap().len()
    );
}

// Protects default HTTP composition: paired origin, secret no-store projection,
// same-scope serialization and exact duplicate/cancellation identities.
#[tokio::test]
async fn login_http_authority_serialization_and_ephemeral_handoff() {
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    let (d, app) = fixture("cancel");
    let router = crate::server::router(app.clone());
    let token = app.issue_launch();
    let auth = router
        .clone()
        .oneshot(
            Request::post("/auth")
                .header("host", "127.0.0.1:12345")
                .header("origin", "http://127.0.0.1:12345")
                .body(Body::from(token))
                .unwrap(),
        )
        .await
        .unwrap();
    let cookie = auth.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    async fn request(
        router: axum::Router,
        cookie: &str,
        method: &str,
        path: &str,
        value: Option<Value>,
        origin: &str,
    ) -> (u16, Value, String) {
        let req = Request::builder()
            .method(method)
            .uri(path)
            .header("host", "127.0.0.1:12345")
            .header("origin", origin)
            .header("cookie", cookie)
            .header("content-type", "application/json")
            .body(Body::from(value.map(|v| v.to_string()).unwrap_or_default()))
            .unwrap();
        let r = router.oneshot(req).await.unwrap();
        let status = r.status().as_u16();
        let cache = r
            .headers()
            .get("cache-control")
            .map(|v| v.to_str().unwrap().to_string())
            .unwrap_or_default();
        let b = r.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&b).unwrap(), cache)
    }
    let revision = app.store.lock().unwrap().configuration().unwrap().revision;
    let body = json!({"api":API,"id":"http-login-01","kind":"device","expected_revision":revision});
    assert_eq!(
        request(
            router.clone(),
            &cookie,
            "POST",
            "/api/runners/login",
            Some(body.clone()),
            "http://evil.example"
        )
        .await
        .0,
        403
    );
    assert_eq!(
        request(
            router.clone(),
            &cookie,
            "POST",
            "/api/runners/login",
            Some(body.clone()),
            "http://127.0.0.1:12345"
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(
            router.clone(),
            &cookie,
            "POST",
            "/api/runners/login",
            Some(body.clone()),
            "http://127.0.0.1:12345"
        )
        .await
        .0,
        200
    );
    let mut material = Value::Null;
    for _ in 0..150 {
        let (status, v, cache) = request(
            router.clone(),
            &cookie,
            "GET",
            "/api/runners/operations/http-login-01",
            None,
            "http://127.0.0.1:12345",
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(cache, "no-store");
        if !v["handoff"].is_null() {
            material = v["handoff"].clone();
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(material["code"], "FIXTURE-CODE");
    let mut conflicting = body;
    conflicting["id"] = json!("http-login-02");
    assert_eq!(
        request(
            router.clone(),
            &cookie,
            "POST",
            "/api/runners/login",
            Some(conflicting),
            "http://127.0.0.1:12345"
        )
        .await
        .0,
        409
    );
    assert_eq!(
        request(
            router.clone(),
            &cookie,
            "POST",
            "/api/runners/operations/http-login-01/cancel",
            Some(json!({"api":API})),
            "http://127.0.0.1:12345"
        )
        .await
        .0,
        200
    );
    for _ in 0..150 {
        if app
            .store
            .lock()
            .unwrap()
            .runner_operation("http-login-01")
            .unwrap()
            .phase
            == "cancelled"
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(
        app.store
            .lock()
            .unwrap()
            .runner_operation("http-login-01")
            .unwrap()
            .phase,
        "cancelled"
    );
    assert!(app.runner_runtime.lock().unwrap().material.is_empty());
    let stored =
        serde_json::to_string(&app.store.lock().unwrap().runner_operations().unwrap()).unwrap();
    assert!(!stored.contains("FIXTURE-CODE") && !stored.contains("auth.openai.com"));
    assert_eq!(
        calls(d.path())
            .iter()
            .filter(|v| v["method"] == "account/login/start")
            .count(),
        1
    );
}
// Protects activation when prepared health or shared-store ownership changes.
// Oracle: neither a failed native probe nor a different store inode may select.
#[tokio::test]
async fn failed_health_and_store_drift_preserve_selection() {
    for case in ["environment", "ready"] {
        let (d, app) = fixture(case);
        let path = app.artifact_root().unwrap();
        let before = app.store.lock().unwrap().configuration().unwrap();
        let op = {
            let mut s = app.store.lock().unwrap();
            let plan = s
                .plan_runner(
                    &Review {
                        api: API,
                        expected_revision: before.revision,
                        action: "sol_model".into(),
                    },
                    &path,
                )
                .unwrap();
            s.accept_runner(
                &plan.id,
                &Apply {
                    api: API,
                    operation_id: "failed-health-op".into(),
                    allow: true,
                },
            )
            .unwrap()
            .0
        };
        if case == "ready" {
            std::fs::rename(path.join("runners"), d.path().join("preserved-runners")).unwrap();
            std::fs::create_dir(path.join("runners")).unwrap();
            std::fs::set_permissions(path.join("runners"), std::fs::Permissions::from_mode(0o700))
                .unwrap();
        }
        run_operation(app.clone(), op.id.clone()).await;
        assert_eq!(app.store.lock().unwrap().configuration().unwrap(), before);
        assert_eq!(
            app.store
                .lock()
                .unwrap()
                .runner_operation(&op.id)
                .unwrap()
                .phase,
            "failed"
        );
    }
}
// Protects the cancellation/progress interleaving: a stale installer snapshot
// may add publication evidence, but cannot revive a cancelled operation.
#[test]
fn cancelled_operation_cannot_be_revived_by_stale_worker_progress() {
    let (_d, app) = fixture("ready");
    let path = app.artifact_root().unwrap();
    let mut s = app.store.lock().unwrap();
    let before = s.configuration().unwrap();
    let plan = s
        .plan_runner(
            &Review {
                api: API,
                expected_revision: before.revision,
                action: "install".into(),
            },
            &path,
        )
        .unwrap();
    let (mut worker, _) = s
        .accept_runner(
            &plan.id,
            &Apply {
                api: API,
                operation_id: "cancelled-installer".into(),
                allow: true,
            },
        )
        .unwrap();
    let mut current = worker.clone();
    current.phase = "cancelled".into();
    s.save_runner_operation(&current).unwrap();
    assert!(!s.runner_progress(&mut worker, "validating", false).unwrap());
    assert_eq!(worker.phase, "cancelled");
    assert!(
        !s.runner_progress(&mut worker, "published_not_selected", true)
            .unwrap()
    );
    let done = s.runner_operation(&worker.id).unwrap();
    assert_eq!(done.phase, "cancelled");
    assert!(done.published);
    assert_eq!(s.configuration().unwrap(), before);
}
// Oracle: even native-selection policy needs an observed model before a turn;
// the string "unknown" must never become an admitted continuation target.
#[tokio::test]
async fn missing_observed_model_blocks_provider_turn() {
    let (d, app) = fixture("missingmodel");
    let id = "missing-model-root";
    {
        let mut s = app.store.lock().unwrap();
        let cmd = submit(&s, id, true, false);
        s.admit(&cmd).unwrap();
    }
    let (_tx, rx) = tokio::sync::watch::channel(false);
    crate::native::run(app.clone(), id.into(), app.binary.clone(), rx).await;
    assert_eq!(app.receipt(id).unwrap().phase, Phase::Failed);
    assert!(
        app.receipt(id)
            .unwrap()
            .detail
            .contains("acknowledgement missing")
    );
    assert!(calls(d.path()).iter().all(|v| v["method"] != "turn/start"));
}
// Protects native authentication shared by two live Deck hosts. Kernel locks
// coordinate Deck only; external native clients do not participate.
#[test]
fn two_hosts_serialize_login_against_admitted_scope_ownership() {
    let (d, first) = fixture("ready");
    let (_other, second) = fixture("ready");
    *second.scope_root.lock().unwrap() = Some(d.path().join("scope-locks"));
    first.retain_auth_scope().unwrap();
    assert!(second.scope_lock(true).is_err());
    second.retain_auth_scope().unwrap();
    first.auth_scope.lock().unwrap().take();
    assert!(first.scope_lock(true).is_err());
    second.auth_scope.lock().unwrap().take();
    let exclusive = first.scope_lock(true).unwrap();
    assert!(second.retain_auth_scope().is_err());
    drop(exclusive);
    second.retain_auth_scope().unwrap();
}

// Protects publication versus activation. Acquisition alone may not start native
// state or change the selected binding, even after the full artifact is present.
#[tokio::test]
async fn queued_work_defers_before_any_native_probe() {
    let (d, app) = fixture("ready");
    let path = app.artifact_root().unwrap();
    let op = {
        let mut s = app.store.lock().unwrap();
        let rev = s.configuration().unwrap().revision;
        let plan = s
            .plan_runner(
                &Review {
                    api: API,
                    expected_revision: rev,
                    action: "sol_model".into(),
                },
                &path,
            )
            .unwrap();
        let op = s
            .accept_runner(
                &plan.id,
                &Apply {
                    api: API,
                    operation_id: "pre-probe-queued".into(),
                    allow: true,
                },
            )
            .unwrap()
            .0;
        let command = submit(&s, "queued-before-probe", true, true);
        s.admit(&command).unwrap();
        op
    };
    run_operation(app.clone(), op.id.clone()).await;
    assert_eq!(
        app.store
            .lock()
            .unwrap()
            .runner_operation(&op.id)
            .unwrap()
            .phase,
        "deferred"
    );
    assert!(
        calls(d.path()).is_empty(),
        "queued ownership must prevent the first target process"
    );
}
// Protects retained-release identity: a binding can never resolve the singleton
// package merely because another release became current. Oracle: exact catalog
// selection; fails if an unknown reference can reach the default artifact.
#[test]
fn unknown_release_reference_never_falls_back() {
    let (_d, app) = fixture("ready");
    let path = app.artifact_root().unwrap();
    assert!(pin_release(&path, &"0".repeat(64)).is_err());
    assert!(publish_release(&path, &"0".repeat(64), b"invalid").is_err());
}

// Protects two-host probe ordering. A shared reservation in any other project
// prevents a management native process before health, not merely selection.
#[tokio::test]
async fn other_host_reservation_prevents_native_probe() {
    let (d, app) = fixture("ready");
    let (_other, second) = fixture("ready");
    *second.scope_root.lock().unwrap() = Some(d.path().join("scope-locks"));
    second.retain_auth_scope().unwrap();
    let path = app.artifact_root().unwrap();
    let before = app.store.lock().unwrap().configuration().unwrap();
    let op = {
        let mut s = app.store.lock().unwrap();
        let plan = s
            .plan_runner(
                &Review {
                    api: API,
                    expected_revision: before.revision,
                    action: "sol_model".into(),
                },
                &path,
            )
            .unwrap();
        s.accept_runner(
            &plan.id,
            &Apply {
                api: API,
                operation_id: "other-host-probe".into(),
                allow: true,
            },
        )
        .unwrap()
        .0
    };
    run_operation(app.clone(), op.id.clone()).await;
    assert!(calls(d.path()).is_empty());
    assert_eq!(app.store.lock().unwrap().configuration().unwrap(), before);
    assert!(second.scope_lock(true).is_err());
}
// Real artifact gate only: no target native state or provider turn. Fails if an
// acquired package can change selection, lose its retained reference or accept a
// modified companion. This does not qualify target execution.
#[tokio::test]
#[ignore = "requires both exact locally acquired release archives"]
async fn both_exact_packages_publish_independently_without_activation() {
    let (_d, app) = fixture("ready");
    let root = app.artifact_root().unwrap();
    let before = app.store.lock().unwrap().configuration().unwrap();
    for (reference, archive) in [
        (
            catalog(),
            "../../target/s7-verification/acquisition/codex.tar.gz",
        ),
        (
            candidate_catalog(),
            "../../target/s7b-qualification/codex-0.167.1.tar.gz",
        ),
    ] {
        let bytes = std::fs::read(archive).unwrap();
        let binary = publish_release(&root, &reference, &bytes).unwrap();
        assert_eq!(binary, pin_release(&root, &reference).unwrap());
        assert_eq!(
            digest(&std::fs::read(binary).unwrap()),
            release_for_catalog(&reference).unwrap().members["bin/codex"]
                .sha256
                .clone()
                .unwrap()
        );
    }
    let op = {
        let mut s = app.store.lock().unwrap();
        let p = s
            .plan_runner(
                &Review {
                    api: API,
                    expected_revision: before.revision,
                    action: "acquire_0.167.1".into(),
                },
                &root,
            )
            .unwrap();
        let (mut op, _) = s
            .accept_runner(
                &p.id,
                &Apply {
                    api: API,
                    operation_id: "acquire-only-fixture".into(),
                    allow: true,
                },
            )
            .unwrap();
        assert!(s.activate_runner(&mut op).is_err());
        assert_eq!(s.configuration().unwrap(), before);
        op
    };
    run_operation(app.clone(), op.id.clone()).await;
    assert_eq!(
        app.store
            .lock()
            .unwrap()
            .runner_operation(&op.id)
            .unwrap()
            .phase,
        "applied"
    );
    assert_eq!(app.store.lock().unwrap().configuration().unwrap(), before);
    let target = artifact_binding(&root, &candidate_catalog(), None).unwrap();
    assert!(validate_binding(&target).is_err());
    let companion = Path::new(&target.path)
        .parent()
        .unwrap()
        .join("codex-exec-server");
    std::fs::set_permissions(&companion, std::fs::Permissions::from_mode(0o600)).unwrap();
    std::fs::write(&companion, b"tampered companion").unwrap();
    assert!(pin_release(&root, &candidate_catalog()).is_err());
    assert!(pin_release(&root, &catalog()).is_ok());
}

// Protects: maintenance is a targeted, explicit terminal handoff, never an
// update effect. Oracle: native-first brief; fails if busy/stale/altered targets
// receive a command or handoff is represented as a completed update.
#[tokio::test]
async fn maintenance_handoff_targets_selection_without_updating() {
    let (d, app) = fixture("ready");
    let revision = app.store.lock().unwrap().configuration().unwrap().revision;
    let result = maintenance_handoff(&app, revision).await.unwrap();
    assert_eq!(result["phase"], "terminal_handoff");
    assert_eq!(result["updated"], false);
    assert_eq!(result["executable"], app.binary.to_str().unwrap());
    assert!(result["command"].as_str().unwrap().ends_with("' update"));
    assert!(calls(d.path()).is_empty());
    let invocations = std::fs::read_to_string(d.path().join("invocations.jsonl")).unwrap();
    let args: Vec<Value> = invocations
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(
        args,
        vec![json!(["--version"]), json!(["update", "--help"])]
    );
    assert!(maintenance_handoff(&app, revision + 1).await.is_err());
    let queued = submit(&app.store.lock().unwrap(), "maintenance-queued", true, true);
    let mut root = app.store.lock().unwrap().admit(&queued).unwrap();
    assert!(
        maintenance_handoff(&app, revision)
            .await
            .unwrap_err()
            .contains("Settle")
    );
    root.phase = Phase::Completed;
    app.store.lock().unwrap().save(&mut root).unwrap();
    std::fs::write(&app.binary, "changed").unwrap();
    assert!(maintenance_handoff(&app, revision).await.is_err());
}

// Protects: failure/timeout cannot be mistaken for an update or leave admission
// blocked. Oracle: bounded native handoff contract; fails if help failure is
// accepted or a later clean attempt cannot prepare instructions.
#[tokio::test]
async fn maintenance_probe_failures_release_reservations() {
    for case in ["update-help-failure", "update-help-timeout"] {
        let (d, app) = fixture(case);
        let revision = app.store.lock().unwrap().configuration().unwrap().revision;
        assert!(maintenance_handoff(&app, revision).await.is_err());
        assert!(app.active.lock().unwrap().is_empty());
        std::fs::write(d.path().join("case"), "ready").unwrap();
        assert_eq!(
            maintenance_handoff(&app, revision).await.unwrap()["updated"],
            false
        );
    }
}
// Protects: the default HTTP composition requires browser pairing and origin,
// rejects incompatible requests, and never hands off immutable packages.
#[tokio::test]
async fn maintenance_http_authority_and_managed_ownership() {
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    let (_d, app) = fixture("ready");
    let router = crate::server::router(app.clone());
    let revision = app.store.lock().unwrap().configuration().unwrap().revision;
    let payload = json!({"api":API,"expected_revision":revision}).to_string();
    let request = |cookie: &str, origin: &str, body: String| {
        Request::post("/api/runners/maintenance")
            .header("host", "127.0.0.1:12345")
            .header("origin", origin)
            .header("cookie", cookie)
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap()
    };
    assert_eq!(
        router
            .clone()
            .oneshot(request("", "http://127.0.0.1:12345", payload.clone()))
            .await
            .unwrap()
            .status(),
        403
    );
    let token = app.issue_launch();
    let auth = router
        .clone()
        .oneshot(
            Request::post("/auth")
                .header("host", "127.0.0.1:12345")
                .header("origin", "http://127.0.0.1:12345")
                .body(Body::from(token))
                .unwrap(),
        )
        .await
        .unwrap();
    let cookie = auth.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap();
    assert_eq!(
        router
            .clone()
            .oneshot(request(cookie, "http://evil.example", payload.clone()))
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        router
            .clone()
            .oneshot(request(
                cookie,
                "http://127.0.0.1:12345",
                json!({"api":0,"expected_revision":revision}).to_string()
            ))
            .await
            .unwrap()
            .status(),
        409
    );
    assert_eq!(
        router
            .oneshot(request(cookie, "http://127.0.0.1:12345", payload))
            .await
            .unwrap()
            .status(),
        200
    );
    let mut c = app.store.lock().unwrap().configuration().unwrap();
    c.runner = Some(managed_binding(&app.artifact_root().unwrap(), None));
    c.revision += 1;
    app.store.lock().unwrap().save_configuration(&c).unwrap();
    assert!(
        maintenance_handoff(&app, c.revision)
            .await
            .unwrap_err()
            .contains("immutable")
    );
}

// Protects truthful post-update observation and explicit adoption. Oracle: native
// maintenance contract; fails if unsupported version is hidden or silently admitted.
#[tokio::test]
async fn maintenance_observes_changed_version_without_adopting_it() {
    let (d, app) = fixture("ready");
    let before = app.store.lock().unwrap().configuration().unwrap();
    std::fs::write(d.path().join("case"), "version").unwrap();
    let v = observe_installation(&app.binary, "codex").await.unwrap();
    assert_eq!(v["version"], "codex-cli 9.0.0");
    assert_eq!(v["state"], "readiness_check_required");
    assert_eq!(v["ready"], false);
    assert_eq!(app.store.lock().unwrap().configuration().unwrap(), before);
    assert!(calls(d.path()).is_empty());
}

#[tokio::test]
async fn standalone_update_follows_launcher_and_preserves_admitted_binding() {
    use std::os::unix::fs::symlink;
    let (dir, app) = fixture("ready");
    let releases = dir.path().join("standalone/releases");
    let old = releases.join("0.166.0/bin/codex");
    let new = releases.join("0.170.0/bin/codex");
    for path in [&old, &new] {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::copy(&app.binary, path).unwrap();
    }
    let launcher = dir.path().join("launcher");
    symlink(&old, &launcher).unwrap();
    let original = {
        let store = app.store.lock().unwrap();
        let mut c = store.configuration().unwrap();
        c.runner.as_mut().unwrap().path = old.to_str().unwrap().into();
        c.revision = store.next_configuration_revision().unwrap();
        store.save_configuration(&c).unwrap();
        store.admission_snapshot(&Mode::ReadOnly).unwrap()
    };
    std::fs::remove_file(&launcher).unwrap();
    symlink(&new, &launcher).unwrap();
    std::fs::remove_file(&old).unwrap();
    let mut identity = None;
    follow_codex_launcher(&app, &launcher, &mut identity).await.unwrap();
    assert_eq!(app.selected_binary().unwrap(), launcher);
    assert_eq!(original.runner.unwrap().path, old.to_str().unwrap());
    let revision = app.store.lock().unwrap().configuration().unwrap().revision;
    follow_codex_launcher(&app, &launcher, &mut identity).await.unwrap();
    assert_eq!(app.store.lock().unwrap().configuration().unwrap().revision, revision);
}

// Protects tool-specific command targeting without extension/major/config effects.
// Oracle: native help contracts, not implementation output; fake only process IO.
#[tokio::test]
async fn helper_maintenance_uses_supported_commands_without_updater_effects() {
    for (target, suffix) in [
        ("claude", "update"),
        ("pi", "update --self"),
        ("opencode", "upgrade"),
        ("codebase-memory-mcp", "update"),
    ] {
        let d = tempfile::tempdir().unwrap();
        let binary = d.path().join(format!("{target}' scoped"));
        std::fs::write(&binary,format!("#!/bin/sh\nprintf '%s\\n' \"$*\" >> '{}'\nif [ \"$1\" = '--version' ]; then echo 'tool 1.0'; else echo 'Usage: claude update | pi update --self | opencode upgrade | codebase-memory-mcp update'; fi\n",d.path().join("calls").display())).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let v = tool_handoff(&binary, target).await.unwrap();
        assert_eq!(v["updated"], false);
        assert_eq!(v["executable"], binary.to_str().unwrap());
        assert!(
            v["command"]
                .as_str()
                .unwrap()
                .ends_with(&format!("' {suffix}"))
        );
        assert!(v["command"].as_str().unwrap().contains("'\"'\"'"));
        let calls = std::fs::read_to_string(d.path().join("calls")).unwrap();
        assert!(
            calls
                .lines()
                .all(|line| line == "--version" || line.ends_with("--help"))
        );
        assert!(!calls.contains("--extensions") && !calls.contains("--major"));
    }
}

// Protects changed supported executables against silent identity adoption and
// active-work races. Oracle: explicit review for future work; prior bindings stay.
#[tokio::test]
async fn external_reselection_defers_and_preserves_admitted_identity() {
    let (_d, app) = fixture("ready");
    let original = app
        .store
        .lock()
        .unwrap()
        .configuration()
        .unwrap()
        .runner
        .unwrap();
    let mut bytes = std::fs::read(&app.binary).unwrap();
    bytes.extend_from_slice(b"\n# updated supported installation\n");
    std::fs::write(&app.binary, &bytes).unwrap();
    let (op, receipt) = {
        let mut s = app.store.lock().unwrap();
        let r = submit(&s, "retained-external-identity", true, true);
        let receipt = s.admit(&r).unwrap();
        let review = Review {
            api: API,
            expected_revision: s.configuration().unwrap().revision,
            action: "reselect_external".into(),
        };
        let p = s
            .plan_runner(&review, &app.artifact_root().unwrap())
            .unwrap();
        let (op, _) = s
            .accept_runner(
                &p.id,
                &Apply {
                    api: API,
                    operation_id: "reselect-external-01".into(),
                    allow: true,
                },
            )
            .unwrap();
        (op, receipt)
    };
    worker(&app, &op.id).await.unwrap();
    assert_eq!(
        app.store
            .lock()
            .unwrap()
            .runner_operation(&op.id)
            .unwrap()
            .phase,
        "deferred"
    );
    {
        let mut s = app.store.lock().unwrap();
        let mut r = s.get(&receipt.id).unwrap().unwrap();
        r.phase = Phase::Cancelled;
        s.save(&mut r).unwrap();
    }
    worker(&app, &op.id).await.unwrap();
    let s = app.store.lock().unwrap();
    assert_eq!(s.runner_operation(&op.id).unwrap().phase, "applied");
    assert_ne!(
        s.configuration().unwrap().runner.unwrap().executable,
        original.executable
    );
    assert_eq!(
        s.get(&receipt.id)
            .unwrap()
            .unwrap()
            .configuration
            .unwrap()
            .runner
            .unwrap(),
        original
    );
}

// Protects NATIVE6-Q01: uncertainty and cancelled requests keep same-host and
// cross-host native admission excluded; confirmed settlement restores usability.
// Oracle: maintenance ownership contract. Fake only the process cleanup edge.
#[tokio::test]
async fn maintenance_uncertain_cleanup_retains_admission_until_settled() {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    for (inspect, cancel, help_only) in [
        (false, false, false),
        (false, false, true),
        (true, false, false),
        (false, true, false),
        (false, true, true),
        (true, true, false),
    ] {
        let (d, app) = fixture("ready");
        let (_other, other) = fixture("ready");
        *other.scope_root.lock().unwrap() = Some(d.path().join("scope-locks"));
        let revision = app.store.lock().unwrap().configuration().unwrap().revision;
        let fault = Arc::new(crate::native::ProbeCleanupFault {
            unsettled: AtomicBool::new(true),
            reached: tokio::sync::Notify::new(),
            pause: cancel,
            help_only,
        });
        let a = app.clone();
        let task = tokio::spawn(crate::native::PROBE_CLEANUP_FAULT.scope(
            fault.clone(),
            async move {
                if inspect {
                    maintenance_tool(
                        &a,
                        &Maintenance {
                            api: API,
                            expected_revision: revision,
                            target: "codex".into(),
                        },
                        true,
                    )
                    .await
                } else {
                    maintenance_handoff(&a, revision).await
                }
            },
        ));
        tokio::time::timeout(std::time::Duration::from_secs(3), fault.reached.notified())
            .await
            .unwrap();
        if cancel {
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
        } else {
            assert!(task.await.unwrap().unwrap_err().contains("remains blocked"));
        }
        assert!(
            !app.active.lock().unwrap().is_empty(),
            "uncertain probe must exclude same-host work"
        );
        assert!(
            other.retain_auth_scope().is_err(),
            "uncertain probe must exclude other hosts"
        );
        assert!(maintenance_handoff(&app, revision).await.is_err());
        fault.unsettled.store(false, Ordering::SeqCst);
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while !app.active.lock().unwrap().is_empty() {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        other.retain_auth_scope().unwrap();
        other.auth_scope.lock().unwrap().take();
        assert_eq!(
            maintenance_handoff(&app, revision).await.unwrap()["updated"],
            false
        );
    }
}

// DAILY52-Q01: actual native admission in both orders and hosts sharing an isolated lock root.
#[tokio::test]
async fn quota_excludes_login_and_maintenance_in_both_orders() {
    for cross_host in [false, true] {
        for exclusive in ["login", "maintenance"] {
            for quota_first in [false, true] {
                let (d, old) = fixture("cancel");
                let source = std::fs::read_to_string(&old.binary).unwrap()
                    .replace("if '--version' in sys.argv:", "if '--version' in sys.argv:\n if (base/'hold-maintenance').exists():\n  import time\n  (base/'entered-maintenance').touch()\n  while (base/'hold-maintenance').exists():time.sleep(.01)")
                    .replace(" elif m=='account/read':", " elif m=='account/rateLimits/read':\n  import time\n  (base/'entered-quota').touch()\n  while (base/'hold-quota').exists():time.sleep(.01)\n  reply(q,{'rateLimits':{'planType':'pro'}})\n elif m=='account/read':");
                let binary = old.binary.clone();
                drop(old);
                std::fs::write(&binary, source).unwrap();
                let make = || {
                    let app = App::new(
                        Store::open_memory(d.path().to_str().unwrap()).unwrap(),
                        "127.0.0.1:12345".into(),
                        binary.clone(),
                        None,
                        "admin".into(),
                        "recovery".into(),
                    );
                    *app.scope_root.lock().unwrap() = Some(d.path().join("scope-locks"));
                    app
                };
                let app = make();
                let other = if cross_host { make() } else { app.clone() };
                let revision = app.store.lock().unwrap().configuration().unwrap().revision;
                let start_quota = |a: App| {
                    tokio::spawn(async move {
                        crate::quota::refresh(axum::extract::State(a), axum::extract::Path("codex".into()))
                            .await
                            .status()
                    })
                };
                let start_exclusive = |a: App| {
                    tokio::spawn(async move {
                        if exclusive == "login" {
                            login(
                                crate::server::ProjectState(a),
                                Json(Login {
                                    api: API,
                                    id: "quota-overlap-login".into(),
                                    kind: "device".into(),
                                    expected_revision: revision,
                                }),
                            )
                            .await
                            .status()
                            .is_success()
                        } else {
                            maintenance_handoff(&a, revision).await.is_ok()
                        }
                    })
                };
                std::fs::write(d.path().join("hold-quota"), "").unwrap();
                if exclusive == "maintenance" {
                    std::fs::write(d.path().join("hold-maintenance"), "").unwrap();
                }
                let (blocked, quota) = if quota_first {
                    let q = start_quota(app.clone());
                    wait_marker(&d.path().join("entered-quota")).await;
                    // Abort the HTTP observer: the independent native owner must remain.
                    q.abort();
                    let rejected = tokio::time::timeout(
                        Duration::from_millis(150),
                        start_exclusive(other.clone()),
                    )
                    .await;
                    let blocked = matches!(rejected, Ok(Ok(false)));
                    (blocked, None)
                } else {
                    let e = start_exclusive(app.clone());
                    if exclusive == "maintenance" {
                        wait_marker(&d.path().join("entered-maintenance")).await;
                    } else {
                        assert!(e.await.unwrap());
                        wait_marker(&d.path().join("calls.jsonl")).await;
                    }
                    let q = start_quota(other.clone());
                    let result = tokio::time::timeout(Duration::from_millis(150), q).await;
                    (
                        matches!(result, Ok(Ok(axum::http::StatusCode::CONFLICT))),
                        Some(other.clone()),
                    )
                };
                std::fs::remove_file(d.path().join("hold-quota")).unwrap();
                let _ = std::fs::remove_file(d.path().join("hold-maintenance"));
                if exclusive == "login" {
                    for a in [&app, &other] {
                        for (id, tx) in a.active.lock().unwrap().iter() {
                            if id.starts_with("login:") {
                                let _ = tx.send(true);
                            }
                        }
                    }
                }
                for _ in 0..300 {
                    if app.active.lock().unwrap().is_empty()
                        && other.active.lock().unwrap().is_empty()
                    {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                assert!(
                    blocked,
                    "overlap permitted: cross={cross_host}, exclusive={exclusive}, quota_first={quota_first}"
                );
                assert!(app.active.lock().unwrap().is_empty());
                assert!(other.active.lock().unwrap().is_empty());
                assert!(
                    app.scope_lock(true).is_ok(),
                    "scope not released after confirmed cleanup"
                );
                drop(quota);
            }
        }
    }
}
async fn wait_marker(path: &Path) {
    for _ in 0..500 {
        if path.exists() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("fixture did not reach {}", path.display());
}

// PROJECT73-Q01/Q02: refusal in one project must not strand another owner's
// queued receipt. Oracle: immutable project identity and host-wide serial capacity.
#[tokio::test]
async fn project74_root_refusal_releases_reservation() {
    for replaced in [false, true] {
        let (d, app) = fixture("ready");
        let a = d.path().join("project-a");
        std::fs::create_dir(&a).unwrap();
        let op = {
            let mut s = app.store.lock().unwrap();
            s.register_project(a.to_str().unwrap()).unwrap();
            let mut c = s.configuration_for(a.to_str().unwrap()).unwrap();
            c.runner = s.configuration().unwrap().runner;
            c.revision = s.next_configuration_revision().unwrap();
            s.save_configuration(&c).unwrap();
            let p = s
                .plan_runner_for(
                    a.to_str().unwrap(),
                    &Review {
                        api: API,
                        expected_revision: c.revision,
                        action: "sol_model".into(),
                    },
                    &app.artifact_root().unwrap(),
                )
                .unwrap();
            s.accept_runner(
                &p.id,
                &Apply {
                    api: API,
                    operation_id: "missing-root-op".into(),
                    allow: true,
                },
            )
            .unwrap()
            .0
        };
        std::fs::rename(&a, d.path().join("old-a")).unwrap();
        if replaced {
            std::fs::create_dir(&a).unwrap();
        }
        let before = calls(d.path()).len();
        run_operation(app.clone(), op.id.clone()).await;
        assert_eq!(
            app.store
                .lock()
                .unwrap()
                .runner_operation(&op.id)
                .unwrap()
                .phase,
            "failed"
        );
        assert_eq!(
            calls(d.path()).len(),
            before,
            "refused root launched a native probe"
        );
        assert!(
            app.active.lock().unwrap().is_empty(),
            "refused root retained host reservation"
        );
        let command = {
            let s = app.store.lock().unwrap();
            submit(&s, "other-project-work", true, true)
        };
        app.store.lock().unwrap().pause_queue(false).unwrap();
        app.store.lock().unwrap().admit(&command).unwrap();
        app.pump_queue();
        wait_project74(&app, &command.id).await;
        assert_eq!(app.receipt(&command.id).unwrap().phase, Phase::Completed);
    }
}
async fn wait_project74(app: &App, id: &str) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if !app.receipt(id).unwrap().phase.active()
                && app.receipt(id).unwrap().phase != Phase::Queued
                && app.active.lock().unwrap().is_empty()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "receipt {:?}; active {:?}; calls {:?}",
            app.receipt(id),
            app.active.lock().unwrap().keys().collect::<Vec<_>>(),
            calls(Path::new(&app.project))
        )
    });
}
#[tokio::test]
async fn project74_queue_uses_receipt_owner_after_caller_binary_disappears() {
    let (d, app) = fixture("ready");
    let b = tempfile::tempdir().unwrap();
    let binary = b.path().join("codex");
    std::fs::copy(&app.binary, &binary).unwrap();
    let command = {
        let mut s = app.store.lock().unwrap();
        let p = s.register_project(b.path().to_str().unwrap()).unwrap();
        let mut c = s.configuration_for(&p.root).unwrap();
        c.runner = s.configuration().unwrap().runner;
        c.runner.as_mut().unwrap().path = binary.to_str().unwrap().into();
        c.revision = s.next_configuration_revision().unwrap();
        s.save_configuration(&c).unwrap();
        let session = s
            .create_session(&deck2_shared::SessionCommand {
                api: API,
                id: "project-b-session".into(),
                title: "B".into(),
                project_id: Some(p.id),
                members: None,
                approvals: None,
            })
            .unwrap();
        let mut command = submit(&s, "queued-b-work", true, true);
        command.session = session.id;
        s.pause_queue(false).unwrap();
        s.admit(&command).unwrap();
        command
    };
    app.active
        .lock()
        .unwrap()
        .insert("finishing-a".into(), tokio::sync::watch::channel(false).0);
    std::fs::remove_file(&app.binary).unwrap();
    app.clear_active("finishing-a");
    wait_project74(&app, &command.id).await;
    assert_eq!(app.receipt(&command.id).unwrap().phase, Phase::Completed);
    let turns = calls(b.path());
    assert!(turns.iter().any(|v| v["method"] == "turn/start"));
    assert!(
        turns
            .iter()
            .filter(|v| v["method"] == "thread/start")
            .all(|v| v["params"]["cwd"] == b.path().to_str().unwrap())
    );
    assert!(!calls(d.path()).iter().any(|v| v["method"] == "turn/start"));
}
// PROJECT73-Q05: equal executable bindings do not make a project-sensitive
// probe current in another root. Probe each through the production handler.
#[tokio::test]
async fn project74_native_observations_are_project_bound() {
    use http_body_util::BodyExt;
    async fn value(r: Response) -> Value {
        serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap()
    }
    let (_d, app) = fixture("ready");
    let b = tempfile::tempdir().unwrap();
    let p = {
        let mut s = app.store.lock().unwrap();
        let p = s.register_project(b.path().to_str().unwrap()).unwrap();
        let mut c = s.configuration_for(&p.root).unwrap();
        c.runner = s.configuration().unwrap().runner;
        c.revision = s.next_configuration_revision().unwrap();
        s.save_configuration(&c).unwrap();
        p
    };
    let other = app.project_context(&p.id).unwrap();
    let a = value(refresh(crate::server::ProjectState(app.clone())).await).await;
    assert_eq!(a["ready"], true);
    let v = value(inspect(crate::server::ProjectState(other.clone())).await).await;
    assert!(
        v["observation"].is_null() || v["historical"] == true,
        "A probe presented as current B readiness"
    );
    std::fs::write(_d.path().join("case"), "environment").unwrap();
    let failed = refresh(crate::server::ProjectState(other.clone())).await;
    assert_eq!(failed.status(), axum::http::StatusCode::CONFLICT);
    let own = value(inspect(crate::server::ProjectState(app.clone())).await).await;
    assert!(
        own["refresh_error"].is_null(),
        "B refresh failure leaked into A"
    );
    assert_eq!(own["historical"], false);
    let foreign = value(inspect(crate::server::ProjectState(other.clone())).await).await;
    assert!(foreign["observation"].is_null());
    assert!(foreign["refresh_error"].is_string());
    // A failed probe invalidates its observation even after B replaces the
    // displayed error. Oracle: only A's own successful probe can renew A.
    let failed = refresh(crate::server::ProjectState(app.clone())).await;
    assert_eq!(failed.status(), axum::http::StatusCode::CONFLICT);
    let own = value(inspect(crate::server::ProjectState(app.clone())).await).await;
    assert_eq!(own["historical"], true);
    let failed = refresh(crate::server::ProjectState(other.clone())).await;
    assert_eq!(failed.status(), axum::http::StatusCode::CONFLICT);
    let own = value(inspect(crate::server::ProjectState(app.clone())).await).await;
    assert_eq!(own["historical"], true, "B failure restored stale A readiness");
    assert!(own["refresh_error"].is_null(), "B error leaked into A");
    std::fs::write(_d.path().join("case"), "ready").unwrap();
    let renewed = value(refresh(crate::server::ProjectState(app.clone())).await).await;
    assert_eq!(renewed["ready"], true);
    let own = value(inspect(crate::server::ProjectState(app.clone())).await).await;
    assert_eq!(own["historical"], false);
    // A changed owning binding is historical independently of refresh errors.
    let original = {
        let s = app.store.lock().unwrap();
        let original = s.configuration_for(&app.project).unwrap();
        let mut changed = original.clone();
        changed.runner.as_mut().unwrap().model = Some("different-model".into());
        changed.revision = s.next_configuration_revision().unwrap();
        s.save_configuration(&changed).unwrap();
        original
    };
    let own = value(inspect(crate::server::ProjectState(app.clone())).await).await;
    assert_eq!(own["historical"], true);
    {
        let s = app.store.lock().unwrap();
        let mut restored = original;
        restored.revision = s.next_configuration_revision().unwrap();
        s.save_configuration(&restored).unwrap();
    }
    let own = value(inspect(crate::server::ProjectState(app.clone())).await).await;
    assert_eq!(own["historical"], false);
    value(refresh(crate::server::ProjectState(other.clone())).await).await;
    let v = value(inspect(crate::server::ProjectState(other)).await).await;
    assert_eq!(v["historical"], false);
    assert_eq!(v["observation"]["ready"], true);
}

// A fork inherits the same open file description until exec. A settled owner
// must release admission even if that inherited descriptor has not closed yet.
#[test]
fn settled_scope_releases_inherited_description() {
    let (d, first) = fixture("ready");
    let (_other, second) = fixture("ready");
    *second.scope_root.lock().unwrap() = Some(d.path().join("scope-locks"));
    let held = first.scope_lock(true).unwrap();
    let inherited = held.0.try_clone().unwrap();
    assert!(second.retain_auth_scope().is_err());
    drop(held);
    assert!(
        second.retain_auth_scope().is_ok(),
        "settled scope retained by inherited descriptor"
    );
    // Unlocking one shared reservation must preserve an independent owner's lock.
    let shared = first.scope_lock(false).unwrap();
    let shared_copy = shared.0.try_clone().unwrap();
    drop(shared);
    assert!(first.scope_lock(true).is_err());
    second.auth_scope.lock().unwrap().take();
    assert!(first.scope_lock(true).is_ok());
    drop(shared_copy);
    drop(inherited);
}
