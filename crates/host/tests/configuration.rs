use deck2::{Store, configuration::*};
use deck2_shared::{API, Mode, ScopedSubmit};
fn setup() -> Store {
    let mut s = Store::open_memory("/fixture").unwrap();
    s.register_assignment(Assignment {
        model: "p/m".into(),
        runner: "opencode 1.19.1".into(),
        executable: "abc".into(),
        content: deck2::tasks::digest(deck2::tasks::INVESTIGATOR.as_bytes()),
    })
    .unwrap();
    s
}
// Protects review freshness, once-only effects and immutable queue admission.
// Oracle: S5a revision N admissions survive N+1; stale plans cannot overwrite it.
#[test]
fn reviewed_selection_preserves_admissions_and_deduplicates() {
    let mut s = setup();
    let c = s.configuration().unwrap();
    let command = ScopedSubmit {
        attachments: Vec::new(),
        api: API,
        id: "queued-root-01".into(),
        session: s.session.clone(),
        prompt: "inspect".into(),
        mode: Mode::Team,
        queue: true,
        fresh: true,
    };
    let r = s.admit(&command).unwrap();
    let p = s
        .plan_configuration(
            &PlanRequest {
                api: API,
                expected_revision: c.revision,
                team_enabled: false,
            },
            &c.qualification(),
        )
        .unwrap();
    let stale = s
        .plan_configuration(
            &PlanRequest {
                api: API,
                expected_revision: c.revision,
                team_enabled: false,
            },
            &c.qualification(),
        )
        .unwrap();
    let apply = ApplyRequest {
        api: API,
        operation_id: "operation-01".into(),
        allow: true,
    };
    let done = s
        .apply_configuration(&p.id, &apply, &c.qualification())
        .unwrap();
    assert_eq!(done.phase, "applied");
    assert_eq!(
        s.apply_configuration(&p.id, &apply, &c.qualification())
            .unwrap(),
        done
    );
    assert!(
        s.apply_configuration(
            &stale.id,
            &ApplyRequest {
                operation_id: "operation-02".into(),
                ..apply.clone()
            },
            &c.qualification()
        )
        .is_err()
    );
    assert!(
        s.apply_configuration(
            &p.id,
            &ApplyRequest {
                allow: false,
                ..apply
            },
            &c.qualification()
        )
        .is_err()
    );
    assert_eq!(
        s.get(&r.id)
            .unwrap()
            .unwrap()
            .configuration
            .unwrap()
            .revision,
        c.revision
    );
    assert!(!s.configuration().unwrap().team_enabled);
    assert!(
        s.admit(&ScopedSubmit {
            attachments: Vec::new(),
            id: "new-team-01".into(),
            ..command
        })
        .is_err()
    );
    s.pause_queue(false).unwrap();
    assert_eq!(
        s.claim_next()
            .unwrap()
            .unwrap()
            .configuration
            .unwrap()
            .revision,
        c.revision
    );
}
#[test]
fn denied_or_changed_qualification_cannot_activate() {
    let mut s = setup();
    let c = s.configuration().unwrap();
    let p = s
        .plan_configuration(
            &PlanRequest {
                api: API,
                expected_revision: c.revision,
                team_enabled: false,
            },
            &c.qualification(),
        )
        .unwrap();
    assert!(
        s.apply_configuration(
            &p.id,
            &ApplyRequest {
                api: API,
                operation_id: "wrong-resource".into(),
                allow: true
            },
            &None
        )
        .is_err()
    );
    let denied = s
        .apply_configuration(
            &p.id,
            &ApplyRequest {
                api: API,
                operation_id: "denied-operation".into(),
                allow: false,
            },
            &c.qualification(),
        )
        .unwrap();
    assert_eq!(denied.phase, "denied");
    assert!(s.configuration().unwrap().team_enabled);
    assert!(
        s.apply_configuration(
            &p.id,
            &ApplyRequest {
                api: API,
                operation_id: "another-operation".into(),
                allow: true
            },
            &c.qualification()
        )
        .is_err()
    );
}

// Protects the actual authenticated router: edit trust is not a management grant,
// wrong Origin/auth cannot plan or apply, and stale authority does not mutate.
#[tokio::test]
async fn management_http_requires_browser_authority_and_fresh_review() {
    let project_fixture=tempfile::tempdir().unwrap();
    use axum::{body::Body, http::Request};
    use deck2::server::{App, router};
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tower::ServiceExt;
    let app = App::new(
        Store::open_memory(project_fixture.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        "/missing".into(),
        Some("test has no native".into()),
        "admin".into(),
        "recover".into(),
    );
    let auth = router(app.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth")
                .header("host", "127.0.0.1:32123")
                .header("origin", "http://127.0.0.1:32123")
                .body(Body::from(app.issue_launch()))
                .unwrap(),
        )
        .await
        .unwrap();
    let cookie = auth
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    async fn call(app: &App, path: &str, body: Value, cookie: &str, origin: &str) -> (u16, Value) {
        let res = router(app.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("host", "127.0.0.1:32123")
                    .header("origin", origin)
                    .header("cookie", cookie)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = res.status().as_u16();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }
    let origin = "http://127.0.0.1:32123";
    let body = json!({"api":API,"expected_revision":1,"team_enabled":false});
    assert_eq!(
        call(&app, "/api/configuration/plans", body.clone(), "", origin)
            .await
            .0,
        403
    );
    assert_eq!(
        call(
            &app,
            "/api/configuration/plans",
            body.clone(),
            &cookie,
            "http://foreign.invalid"
        )
        .await
        .0,
        403
    );
    let (status, p) = call(&app, "/api/configuration/plans", body, &cookie, origin).await;
    assert_eq!(status, 200);
    let route = format!(
        "/api/configuration/plans/{}/apply",
        p["id"].as_str().unwrap()
    );
    let apply = json!({"api":API,"operation_id":"http-operation-01","allow":true});
    assert_eq!(call(&app, &route, apply.clone(), "", origin).await.0, 403);
    // Revocation changes the reviewed ownership facts and invalidates this plan.
    assert_eq!(
        call(
            &app,
            "/api/project/trust",
            json!({"api":API,"project":project_fixture.path().to_str().unwrap(),"trusted":true}),
            &cookie,
            origin
        )
        .await
        .0,
        200
    );
    let (status, rejected) = call(&app, &route, apply, &cookie, origin).await;
    assert_eq!(status, 409);
    assert_eq!(rejected["code"], "management_not_applied");
    assert!(
        app.store
            .lock()
            .unwrap()
            .configuration()
            .unwrap()
            .team_enabled
    );
}

#[test]
fn queued_revision_and_operation_survive_restart_without_replay() {
    let project_fixture=tempfile::tempdir().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    let mut s = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    let c = s.configuration().unwrap();
    let r = s
        .admit(&ScopedSubmit {
            attachments: Vec::new(),
            api: API,
            id: "restart-queued-01".into(),
            session: s.session.clone(),
            mode: Mode::ReadOnly,
            prompt: "queued".into(),
            queue: true,
            fresh: true,
        })
        .unwrap();
    let p = s
        .plan_configuration(
            &PlanRequest {
                api: API,
                expected_revision: c.revision,
                team_enabled: false,
            },
            &None,
        )
        .unwrap();
    let apply = ApplyRequest {
        api: API,
        operation_id: "restart-operation".into(),
        allow: true,
    };
    let o = s.apply_configuration(&p.id, &apply, &None).unwrap();
    drop(s);
    let mut s = Store::open(&path, project_fixture.path().to_str().unwrap()).unwrap();
    assert!(s.queue_paused().unwrap());
    assert!(s.claim_next().unwrap().is_none());
    assert_eq!(s.apply_configuration(&p.id, &apply, &None).unwrap(), o);
    assert_eq!(
        s.get(&r.id)
            .unwrap()
            .unwrap()
            .configuration
            .unwrap()
            .revision,
        c.revision
    );
    s.pause_queue(false).unwrap();
    assert_eq!(s.claim_next().unwrap().unwrap().id, r.id);
}

// STARTUP-Q01: reject mode changes before persistence/reservation, including queued
// input; explicit fresh work and immutable retry identity remain available.
#[test]
fn continuation_mode_change_is_rejected_before_admission() {
    for (prior, next) in [
        (Mode::ReadOnly, Mode::ReviewedEdit),
        (Mode::ReviewedEdit, Mode::ReadOnly),
    ] {
        for queue in [false, true] {
            let mut s = setup();
            let project = s.project.clone();
            s.set_trust(&project, true).unwrap();
            let mut command = ScopedSubmit {
                api: API,
                id: "previous-command".into(),
                session: s.session.clone(),
                prompt: "fixture".into(),
                attachments: vec![],
                mode: prior.clone(),
                fresh: true,
                queue: false,
            };
            let mut previous = s.admit(&command).unwrap();
            previous.phase = deck2_shared::Phase::Completed;
            previous.thread = Some("fixture-thread".into());
            s.save(&mut previous).unwrap();
            s.bind_native(&command.session, "fixture-thread", prior.clone(), deck2_shared::NativeRunner::Codex)
                .unwrap();
            command.id = "mode-change-command".into();
            command.mode = next.clone();
            command.fresh = false;
            command.queue = queue;
            let before = s.all().unwrap();
            assert!(
                s.admit(&command).is_err(),
                "cross-mode continuation was admitted"
            );
            assert_eq!(s.all().unwrap(), before);
            command.mode = prior.clone();
            let same = s.admit(&command).unwrap();
            assert_eq!(s.admit(&command).unwrap(), same);
            // Fresh is part of the immutable command identity.
            command.fresh = true;
            assert!(s.admit(&command).is_err());
            command.id = "explicit-fresh-command".into();
            command.mode = next.clone();
            if !queue {
                let mut done = same;
                done.phase = deck2_shared::Phase::Completed;
                s.save(&mut done).unwrap();
            }
            assert_eq!(
                s.admit(&command).unwrap().configuration,
                Some(s.admission_snapshot(&command.mode).unwrap())
            );
        }
    }
}
