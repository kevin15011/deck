use super::*;
use crate::{Store, server::App};
use deck2_shared::{API, Phase};
use std::{os::unix::fs::PermissionsExt, path::PathBuf};

// Preserve only synthetic request traces; no native configuration/passwords.
fn preserve_witness(root: &std::path::Path, name: &str) {
    let Some(target) = std::env::var_os("DECK2_OPENCODE_EVIDENCE_DIR") else {
        return;
    };
    let target = PathBuf::from(target).join(name);
    std::fs::create_dir_all(&target).unwrap();
    for file in [
        "opencode-wire",
        "wire",
        "native-protocol",
        "dispatch-count",
        "abort-child-pid",
        "fixture-stderr",
        "fixture-stages",
    ] {
        let source = root.join(file);
        if source.is_file() {
            std::fs::copy(source, target.join(file)).unwrap();
        }
    }
}

// Protects OPENCODE-01/02/05 at default production composition. The native
// process is the only fake; the real Store, MCP and selected dispatch execute.
// A subprocess gives each fixture its own environment without global test races.
#[tokio::test]
async fn ordinary_catalog_execution_and_restart_with_codex_absent() {
    let name = "connected_opencode::composed_tests::ordinary_catalog_execution_and_restart_with_codex_absent";
    if std::env::var_os("DECK2_OPENCODE_COMPOSED_CHILD").is_none() {
        let d = tempfile::tempdir().unwrap();
        let binary = d.path().join("opencode");
        std::fs::write(
            &binary,
            include_str!("../../tests/fake_connected_opencode.py"),
        )
        .unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", name, "--nocapture", "--test-threads=1"])
            .env("DECK2_OPENCODE_COMPOSED_CHILD", d.path())
            .env("DECK2_OPENCODE", &binary)
            .env("HOME", d.path())
            .env("CODEX_HOME", d.path().join("codex-home"))
            .env("XDG_CONFIG_HOME", d.path().join("config"))
            .env("XDG_DATA_HOME", d.path().join("data"))
            .env_remove("OPENCODE_CONFIG_DIR")
            .env_remove("OPENCODE_CONFIG")
            .env_remove("OPENCODE_CONFIG_CONTENT")
            .env_remove("OPENCODE_DB")
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        preserve_witness(d.path(), "mixed-and-restart");
        return;
    }
    let dir = PathBuf::from(std::env::var_os("DECK2_OPENCODE_COMPOSED_CHILD").unwrap());
    let project = dir.to_str().unwrap();
    let path = dir.join("state.db");
    let app = App::new(
        Store::open(&path, project).unwrap(),
        "127.0.0.1:32123".into(),
        dir.join("missing-codex"),
        Some("Codex absent".into()),
        "admin".into(),
        "recover".into(),
    );
    *app.native_role_root.lock().unwrap() = dir.join("missing-codex-role");
    let data = crate::session_contract::model_data(&app).await.unwrap();
    assert_eq!(data["runners"][0]["available"], false);
    assert_eq!(data["runners"][1]["available"], true, "{data}");
    let assignments=serde_json::from_value(json!({"lead":{"runnerId":"opencode","modelId":"a/model/revision","thinking":"fast/native"},"apply-deep":{"runnerId":"opencode","modelId":"b/model/revision","thinking":"off"}})).unwrap();
    let members = crate::session_contract::creation_members(&app, &assignments)
        .await
        .unwrap();
    let c = serde_json::from_value(
        json!({"api":API,"id":"opencode-composed-session","title":"Fixture","members":members}),
    )
    .unwrap();
    app.store.lock().unwrap().create_session(&c).unwrap();
    for (id, prompt) in [
        ("opencode-first-command", "Remember fixture"),
        ("opencode-second-command", "Continue fixture"),
    ] {
        let command=serde_json::from_value(json!({"api":API,"id":id,"session":"opencode-composed-session","prompt":prompt,"mode":"session_v1","fresh":false})).unwrap();
        app.store.lock().unwrap().admit(&command).unwrap();
        let (_tx, rx) = tokio::sync::watch::channel(false);
        crate::native::run(app.clone(), id.into(), dir.join("missing-codex"), rx).await;
        let r = app.receipt(id).unwrap();
        assert_eq!(r.phase, Phase::Completed, "{}", r.detail);
        assert_eq!(r.text, "Connected OpenCode a/model/revision");
        assert!(
            r.runner.starts_with("opencode "),
            "Receipt runner must match immutable native admission: {}",
            r.runner
        );
    }
    // Protects tool rendezvous cleanup on a real production startup failure.
    // Oracle: a failed native server never leaves its configured /tmp runtime.
    std::fs::write(dir.join("fail-start"), "").unwrap();
    let command=serde_json::from_value(json!({"api":API,"id":"opencode-start-failure","session":"opencode-composed-session","prompt":"fixture","mode":"session_v1","fresh":false})).unwrap();
    app.store.lock().unwrap().admit(&command).unwrap();
    let (_tx,rx)=tokio::sync::watch::channel(false);
    crate::native::run(app.clone(),"opencode-start-failure".into(),dir.join("missing-codex"),rx).await;
    assert_eq!(app.receipt("opencode-start-failure").unwrap().phase,Phase::Failed);
    let runtime_path=PathBuf::from(std::fs::read_to_string(dir.join("failed-tool-runtime")).unwrap());
    assert!(runtime_path.starts_with("/tmp") && runtime_path.file_name().unwrap().to_str().unwrap().starts_with("d2oc-tool-"));
    assert!(!runtime_path.exists(),"failed OpenCode startup leaked {}",runtime_path.display());
    std::fs::remove_file(dir.join("fail-start")).unwrap();
    let wire = std::fs::read_to_string(dir.join("opencode-wire")).unwrap();
    let calls = wire
        .lines()
        .map(|s| serde_json::from_str::<Value>(s).unwrap())
        .collect::<Vec<_>>();
    let inputs = calls
        .iter()
        .filter(|v| v["path"].as_str().is_some_and(|p| p.ends_with("/message")))
        .collect::<Vec<_>>();
    assert_eq!(inputs.len(), 2);
    assert_eq!(
        inputs[0]["body"]["model"],
        json!({"providerID":"a","modelID":"model/revision"})
    );
    assert_eq!(inputs[0]["body"]["variant"], "fast/native");
    assert_eq!(inputs[0]["path"], inputs[1]["path"]);
    assert!(
        calls
            .iter()
            .filter(|v| v.get("mcp").is_some())
            .all(|v| v["mcp"]["result"]["isError"] != true)
    );
    // The request must not reach native always without explicit user scope.
    for (id, prompt, response, expected) in [
        (
            "opencode-deny-command",
            "NATIVE_PERMISSION NATIVE_DENY",
            None,
            "reject",
        ),
        (
            "opencode-session-command",
            "NATIVE_PERMISSION",
            Some(deck2_shared::DecisionResponse::AllowSession),
            "once",
        ),
        (
            "opencode-always-command",
            "NATIVE_PERMISSION",
            Some(deck2_shared::DecisionResponse::AllowAlways),
            "always",
        ),
    ] {
        if matches!(response, Some(deck2_shared::DecisionResponse::AllowAlways)) {
            app.store
                .lock()
                .unwrap()
                .revoke_session_grants("opencode-composed-session")
                .unwrap();
        }
        let command=serde_json::from_value(json!({"api":API,"id":id,"session":"opencode-composed-session","prompt":prompt,"mode":"session_v1","fresh":false})).unwrap();
        app.store.lock().unwrap().admit(&command).unwrap();
        let (_tx, rx) = tokio::sync::watch::channel(false);
        let running = tokio::spawn(crate::native::run(
            app.clone(),
            id.into(),
            dir.join("missing-codex"),
            rx,
        ));
        tokio::time::timeout(Duration::from_secs(25), async {
            loop {
                let r = app.receipt(id).unwrap();
                if let Some(d) = r
                    .decisions
                    .iter()
                    .find(|d| d.state == deck2_shared::DecisionState::Pending)
                {
                    let response = response
                        .clone()
                        .expect("Native denial must never request user permission");
                    app.store
                        .lock()
                        .unwrap()
                        .resolve(
                            &d.id,
                            &deck2_shared::Resolve {
                                api: API,
                                command_id: format!("reply-{id}"),
                                expected_revision: d.revision,
                                response,
                            },
                        )
                        .unwrap();
                    break;
                }
                if r.phase == Phase::Completed {
                    assert!(response.is_none());
                    break;
                }
                if matches!(r.phase, Phase::Failed | Phase::Uncertain) {
                    panic!("{}", r.detail);
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            running.await.unwrap();
        })
        .await
        .unwrap();
        assert_eq!(app.receipt(id).unwrap().phase, Phase::Completed);
        let wire = std::fs::read_to_string(dir.join("opencode-wire")).unwrap();
        let delivered = wire
            .lines()
            .filter_map(|s| serde_json::from_str::<Value>(s).ok())
            .rfind(|v| v.get("delivered").is_some())
            .unwrap();
        assert_eq!(delivered["delivered"]["reply"], expected);
    }
    // Lead changes clear only the execution generation, never the history.
    let before = app
        .store
        .lock()
        .unwrap()
        .session_by_id("opencode-composed-session")
        .unwrap();
    let next = app
        .store
        .lock()
        .unwrap()
        .assign_member(
            &before.id,
            "lead",
            serde_json::from_value(
                json!({"runnerId":"opencode","modelId":"b/model/revision","thinking":"off"}),
            )
            .unwrap(),
            before.contract.unwrap().revision,
        )
        .unwrap();
    assert!(next.native.is_none());
    let command=serde_json::from_value(json!({"api":API,"id":"opencode-reassigned-command","session":next.id,"prompt":"New selection","mode":"session_v1","fresh":false})).unwrap();
    app.store.lock().unwrap().admit(&command).unwrap();
    let (_tx, rx) = tokio::sync::watch::channel(false);
    crate::native::run(
        app.clone(),
        "opencode-reassigned-command".into(),
        dir.join("missing-codex"),
        rx,
    )
    .await;
    assert_eq!(
        app.receipt("opencode-reassigned-command").unwrap().phase,
        Phase::Completed
    );
    let wire = std::fs::read_to_string(dir.join("opencode-wire")).unwrap();
    let calls = wire
        .lines()
        .map(|s| serde_json::from_str::<Value>(s).unwrap())
        .collect::<Vec<_>>();
    let last = calls
        .iter()
        .rfind(|v| v["path"].as_str().is_some_and(|p| p.ends_with("/message")))
        .unwrap();
    assert_eq!(last["body"]["model"]["providerID"], "b");
    assert!(last["body"].get("variant").is_none());
    // Exercise both directions through actual session MCP delegation and immutable
    // recorded task assignments. Each fake is only an external runner boundary.
    let codex = dir.join("codex");
    std::fs::write(&codex, include_str!("../../tests/fake_session_native.py")).unwrap();
    std::fs::set_permissions(&codex, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mixed = App::new(
        Store::open(&dir.join("mixed.db"), project).unwrap(),
        "127.0.0.1:32124".into(),
        codex.clone(),
        None,
        "admin".into(),
        "recover".into(),
    );
    *mixed.native_role_root.lock().unwrap() = dir.join("missing-codex-role");
    for (session, lead, worker, prompt) in [
        (
            "codex-leads-opencode",
            "codex",
            "opencode",
            "Delegate fixture apply-deep work",
        ),
        (
            "opencode-leads-codex",
            "opencode",
            "codex",
            "DELEGATE_OPENCODE",
        ),
    ] {
        let assign = |runner: &str| {
            if runner == "codex" {
                json!({"runnerId":runner,"modelId":"gpt-6.1-sol","thinking":"high"})
            } else {
                json!({"runnerId":runner,"modelId":"b/model/revision","thinking":"off"})
            }
        };
        let c=serde_json::from_value(json!({"api":API,"id":session,"title":session,"members":{"lead":assign(lead),"apply-deep":assign(worker)}})).unwrap();
        mixed.store.lock().unwrap().create_session(&c).unwrap();
        let command=serde_json::from_value(json!({"api":API,"id":format!("input-{session}"),"session":session,"prompt":prompt,"mode":"session_v1","fresh":false})).unwrap();
        mixed.store.lock().unwrap().admit(&command).unwrap();
        let (_tx, rx) = tokio::sync::watch::channel(false);
        crate::native::run(mixed.clone(), format!("input-{session}"), codex.clone(), rx).await;
        assert_eq!(
            mixed.receipt(&format!("input-{session}")).unwrap().phase,
            Phase::Completed,
            "{}",
            mixed.receipt(&format!("input-{session}")).unwrap().detail
        );
        tokio::time::timeout(Duration::from_secs(35), async {
            loop {
                let tasks = mixed.store.lock().unwrap().tasks().unwrap();
                let selected = tasks.iter().find(|t| t.session == session);
                if let Some(t) = selected {
                    let a = &t.attempts[0];
                    assert_eq!(
                        a.configuration
                            .as_ref()
                            .unwrap()
                            .session_contract
                            .as_ref()
                            .unwrap()
                            .members["apply-deep"]
                            .runner_id,
                        worker
                    );
                    if a.phase == Phase::Completed {
                        break;
                    }
                    if matches!(a.phase, Phase::Uncertain | Phase::Failed) {
                        panic!("{}", a.detail);
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(35), async {
            loop {
                if mixed
                    .store
                    .lock()
                    .unwrap()
                    .all()
                    .unwrap()
                    .iter()
                    .all(|r| !r.phase.active() && r.phase != Phase::Queued)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        // Change the default to the other runner, then continue the same task
        // through a genuine new Lead turn. The immutable task tuple must win.
        let task = mixed
            .store
            .lock()
            .unwrap()
            .tasks()
            .unwrap()
            .into_iter()
            .find(|t| t.session == session)
            .unwrap();
        let before = mixed.store.lock().unwrap().session_by_id(session).unwrap();
        mixed
            .store
            .lock()
            .unwrap()
            .assign_member(
                session,
                "apply-deep",
                serde_json::from_value(assign(lead)).unwrap(),
                before.contract.unwrap().revision,
            )
            .unwrap();
        let command=serde_json::from_value(json!({"api":API,"id":format!("continue-{session}"),"session":session,"prompt":format!("CONTINUE_MIXED {}",task.id),"mode":"session_v1","fresh":false})).unwrap();
        mixed.store.lock().unwrap().admit(&command).unwrap();
        let (_tx, rx) = tokio::sync::watch::channel(false);
        crate::native::run(
            mixed.clone(),
            format!("continue-{session}"),
            codex.clone(),
            rx,
        )
        .await;
        assert_eq!(
            mixed.receipt(&format!("continue-{session}")).unwrap().phase,
            Phase::Completed
        );
        tokio::time::timeout(Duration::from_secs(35), async {
            loop {
                let t = mixed.store.lock().unwrap().task(&task.id).unwrap();
                if let Some(a) = t.attempts.get(1) {
                    assert_eq!(
                        a.configuration
                            .as_ref()
                            .unwrap()
                            .session_contract
                            .as_ref()
                            .unwrap()
                            .members["apply-deep"]
                            .runner_id,
                        worker
                    );
                    assert!(a.provenance.runner.starts_with(worker));
                    if a.phase == Phase::Completed {
                        assert_eq!(a.report.as_ref().unwrap().attempt, a.id);
                        break;
                    }
                    if matches!(a.phase, Phase::Failed | Phase::Uncertain) {
                        panic!("{}", a.detail);
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(35), async {
            loop {
                if mixed
                    .store
                    .lock()
                    .unwrap()
                    .all()
                    .unwrap()
                    .iter()
                    .all(|r| !r.phase.active() && r.phase != Phase::Queued)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            mixed
                .store
                .lock()
                .unwrap()
                .tasks()
                .unwrap()
                .iter()
                .filter(|t| t.session == session)
                .count(),
            1
        );
    }
    drop(mixed);
    Store::open(&dir.join("mixed.db"), project).unwrap();
    let command=serde_json::from_value(json!({"api":API,"id":"opencode-lost-ack-command","session":next.id,"prompt":"LOST_ACK","mode":"session_v1","fresh":false})).unwrap();
    app.store.lock().unwrap().admit(&command).unwrap();
    let (_tx, rx) = tokio::sync::watch::channel(false);
    crate::native::run(
        app.clone(),
        "opencode-lost-ack-command".into(),
        dir.join("missing-codex"),
        rx,
    )
    .await;
    let lost = app.receipt("opencode-lost-ack-command").unwrap();
    assert_eq!(lost.phase, Phase::Uncertain);
    assert!(lost.dispatch_ms.is_some());
    drop(app);
    let store = Store::open(&path, project).unwrap();
    assert_eq!(store.all().unwrap().len(), 8);
    assert_eq!(
        store
            .get("opencode-lost-ack-command")
            .unwrap()
            .unwrap()
            .phase,
        Phase::Uncertain
    );
    assert_eq!(
        store
            .session_by_id("opencode-composed-session")
            .unwrap()
            .native
            .unwrap()
            .runner,
        Some(deck2_shared::NativeRunner::Opencode)
    );
}

// OPENCODE-05: a lost abort acknowledgment cannot release the storage lease
// while an owned descendant is alive. Only native process/network effects fake.
#[tokio::test]
async fn abort_drains_descendants_before_releasing_storage() {
    const NAME: &str =
        "connected_opencode::composed_tests::abort_drains_descendants_before_releasing_storage";
    if std::env::var_os("DECK2_ABORT_CHILD").is_none() {
        let d = tempfile::tempdir().unwrap();
        let binary = d.path().join("opencode");
        std::fs::write(
            &binary,
            include_str!("../../tests/fake_connected_opencode.py"),
        )
        .unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", NAME, "--test-threads=1", "--nocapture"])
            .env("DECK2_ABORT_CHILD", d.path())
            .env("DECK2_OPENCODE", binary)
            .env("HOME", d.path())
            .env("CODEX_HOME", d.path().join("native"))
            .env("XDG_CONFIG_HOME", d.path().join("config"))
            .env("XDG_DATA_HOME", d.path().join("data"))
            .env_remove("OPENCODE_CONFIG_DIR")
            .env_remove("OPENCODE_CONFIG")
            .env_remove("OPENCODE_CONFIG_CONTENT")
            .env_remove("OPENCODE_DB")
            .output()
            .unwrap();
        preserve_witness(d.path(), "hanging-abort");
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        return;
    }
    let d = PathBuf::from(std::env::var_os("DECK2_ABORT_CHILD").unwrap());
    let project = d.to_str().unwrap();
    let db = d.join("state.db");
    let app = App::new(
        Store::open(&db, project).unwrap(),
        "127.0.0.1:32126".into(),
        d.join("missing-codex"),
        Some("Codex absent".into()),
        "admin".into(),
        "recover".into(),
    );
    let session=serde_json::from_value(json!({"api":API,"id":"abort-owned-session","title":"Abort","members":{"lead":{"runnerId":"opencode","modelId":"a/model/revision"}}})).unwrap();
    app.store.lock().unwrap().create_session(&session).unwrap();
    let command=serde_json::from_value(json!({"api":API,"id":"abort-owned-command","session":"abort-owned-session","mode":"session_v1","prompt":"HANG_ABORT","fresh":false})).unwrap();
    app.store.lock().unwrap().admit(&command).unwrap();
    let (cancel, rx) = tokio::sync::watch::channel(false);
    let mut running = tokio::spawn(crate::native::run(
        app.clone(),
        "abort-owned-command".into(),
        d.join("missing-codex"),
        rx,
    ));
    let readiness = tokio::time::timeout(Duration::from_secs(15), async {
        while !d.join("abort-child-pid").exists() {
            if running.is_finished() {
                return Err("native attempt ended before descendant readiness");
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        Ok(())
    })
    .await;
    if !matches!(readiness, Ok(Ok(()))) {
        let receipt = app.receipt("abort-owned-command").unwrap();
        eprintln!("abort fixture readiness: result={readiness:?} task_finished={} phase={:?} detail={} native_pid={:?} native_alive={} stages={} stderr={} wire={}",
            running.is_finished(), receipt.phase, receipt.detail, receipt.native_pid,
            receipt.native_pid.is_some_and(|pid| unsafe { libc::kill(pid as i32, 0) } == 0),
            std::fs::read_to_string(d.join("fixture-stages")).unwrap_or_default(),
            std::fs::read_to_string(d.join("fixture-stderr")).unwrap_or_default(),
            std::fs::read_to_string(d.join("opencode-wire")).unwrap_or_default());
        let _ = cancel.send(true);
        let settled = tokio::time::timeout(Duration::from_secs(10), &mut running).await;
        panic!("abort fixture did not become ready: settlement={settled:?}");
    }
    let pid = std::fs::read_to_string(d.join("abort-child-pid"))
        .unwrap()
        .parse::<i32>()
        .unwrap();
    app.change("abort-owned-command", |r| r.cancel_requested = true)
        .unwrap();
    cancel.send(true).unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while !d.join("abort-entered").exists() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let scopes = crate::managed_tools::Directory::open_root(
        &std::env::temp_dir().join(format!("deck2-opencode-scopes-{}", unsafe {
            libc::geteuid()
        })),
    )
    .unwrap();
    let storage = source::storage().unwrap();
    assert!(
        scopes.lock_mode(&storage, true).is_err(),
        "Abort in flight still owns storage"
    );
    assert_eq!(unsafe { libc::kill(pid, 0) }, 0);
    tokio::time::timeout(Duration::from_secs(10), running)
        .await
        .unwrap()
        .unwrap();
    assert_ne!(
        unsafe { libc::kill(pid, 0) },
        0,
        "Owned descendant must be drained before the attempt settles"
    );
    assert!(scopes.lock_mode(&storage, true).is_ok());
    assert_eq!(
        app.receipt("abort-owned-command").unwrap().phase,
        Phase::Uncertain
    );
    drop(app);
    let reopened = Store::open(&db, project).unwrap();
    assert_eq!(
        reopened.get("abort-owned-command").unwrap().unwrap().phase,
        Phase::Uncertain
    );
    let wire = std::fs::read_to_string(d.join("opencode-wire")).unwrap();
    assert_eq!(
        wire.lines()
            .filter_map(|l| serde_json::from_str::<Value>(l).ok())
            .filter(|v| v["path"].as_str().is_some_and(|p| p.ends_with("/message")))
            .count(),
        1,
        "No restart replay"
    );
}
