// Protects SESSION-PARITY-01: creation records the original assignment/relay
// contract atomically; stale changes and legacy widening must fail.
use deck2::Store;
use deck2_shared::{API, SessionCommand};
use serde_json::json;
#[test]
fn creation_records_assignments_and_default_relay() {
    let mut store = Store::open_memory("/fixture").unwrap();
    let command: SessionCommand=serde_json::from_value(json!({"api":API,"id":"normal-session-01","title":"Normal session","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol","thinking":"high"}}})).expect("original creation contract must decode");
    let session = serde_json::to_value(store.create_session(&command).unwrap()).unwrap();
    assert_eq!(session["contract"]["approvals"], "relay");
    assert_eq!(session["contract"]["members"]["lead"]["thinking"], "high");
    assert_eq!(session["contract"]["revision"], 1);
    assert!(session["contract"]["leadTask"].is_string());
}
#[test]
fn stale_assignments_cannot_reseed_and_legacy_never_upgrades() {
    let mut s = Store::open_memory("/fixture").unwrap();
    let legacy = s.session.clone();
    let c:SessionCommand=serde_json::from_value(json!({"api":API,"id":"normal-session-02","title":"Session","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
    let initial = s.create_session(&c).unwrap();
    let task = initial.contract.as_ref().unwrap().lead_task.clone();
    let assignment: deck2_shared::MemberAssignment = serde_json::from_value(
        json!({"runnerId":"codex","modelId":"gpt-6.1-sol","thinking":"high"}),
    )
    .unwrap();
    assert!(
        s.assign_member(&legacy, "lead", assignment.clone(), 0)
            .is_err()
    );
    assert!(
        s.assign_member(&initial.id, "lead", assignment.clone(), 0)
            .is_err()
    );
    let updated = s
        .assign_member(&initial.id, "lead", assignment.clone(), 1)
        .unwrap();
    assert!(s.assign_member(&initial.id, "lead", assignment, 1).is_err());
    let updated = updated.contract.unwrap();
    assert_eq!(updated.revision, 2);
    assert_eq!(updated.generation, 2);
    assert_eq!(updated.lead_task, task);
    assert!(s.session_by_id(&legacy).unwrap().contract.is_none());
}

// Protects SESSION-PARITY-02/03 through default native composition: consecutive
// accepted messages must resume, and the configured MCP must actually answer.
#[tokio::test]
async fn two_messages_resume_one_native_context_with_current_session_bridge() {
    use deck2_shared::{Phase, ScopedSubmit};
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let binary = dir.path().join("codex");
    std::fs::write(&binary, include_str!("fake_session_native.py")).unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(dir.path().join("startup-fixture"), "").unwrap();
    let project = dir.path().to_str().unwrap();
    let path = dir.path().join("state.db");
    let app = deck2::server::App::new(
        Store::open(&path, project).unwrap(),
        "127.0.0.1:32123".into(),
        binary.clone(),
        None,
        "admin".into(),
        "recover".into(),
    );
    let c:SessionCommand=serde_json::from_value(json!({"api":API,"id":"normal-session-03","title":"Session","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
    *app.native_role_root.lock().unwrap() = dir.path().join("native-role-fixture");
    app.store.lock().unwrap().create_session(&c).unwrap();
    for id in ["normal-command-01", "normal-command-02"] {
        let submit:ScopedSubmit=serde_json::from_value(json!({"api":API,"id":id,"session":c.id,"prompt":"Remember and continue","mode":"session_v1","fresh":false})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let (_tx, rx) = tokio::sync::watch::channel(false);
        deck2::native::run(app.clone(), id.into(), binary.clone(), rx).await;
        let r = app.receipt(id).unwrap();
        assert_eq!(r.phase, Phase::Completed, "{}", r.detail);
        assert_eq!(r.thread.as_deref(), Some("normal-thread"));
        assert_eq!(r.text, "Connected reply");
        // Effective effort comes from the native acknowledgement, not a guessed UI default.
        let projection = serde_json::to_value(&r).unwrap();
        assert_eq!(projection["reasoning"]["effort"], "high");
        assert_eq!(projection["reasoning"]["model"], r.model.as_deref().unwrap());
        assert_eq!(projection["reasoning"]["source"], if id.ends_with("01") {"thread/start"} else {"thread/resume"});
    }
    assert_eq!(
        std::fs::read_to_string(dir.path().join("journey")).unwrap(),
        "thread/start\nthread/resume\n"
    );
    let first = app.receipt("normal-command-01").unwrap();
    let second = app.receipt("normal-command-02").unwrap();
    assert_eq!(first.native_pid, second.native_pid, "compatible turns must reuse the supervised process");
    assert!(!first.startup_timing.as_ref().unwrap().process_reused);
    assert!(second.startup_timing.as_ref().unwrap().process_reused);
    let wire: Vec<serde_json::Value> = std::fs::read_to_string(dir.path().join("startup-wire")).unwrap().lines().map(|line|serde_json::from_str(line).unwrap()).collect();
    assert_eq!(wire.iter().filter(|v|v["method"]=="initialize").count(),1);
    for method in ["account/read", "config/read"] {
        assert_eq!(wire.iter().filter(|v|v["method"]==method).count(),2,"{method} must remain per-attempt");
    }
    let configs: Vec<serde_json::Value> = std::fs::read_to_string(dir.path().join("overrides")).unwrap().lines().map(|line|serde_json::from_str(line).unwrap()).collect();
    let old = &configs[0]["deck-session"];
    let current = &configs[1]["deck-session"];
    assert!(!wire.iter().any(|v|v["method"]=="thread/unsubscribe"), "compatible Lead thread must remain loaded");
    assert!(old == current, "stable transport must survive private attempt credential rotation");
    let mcp_checks: Vec<_> = wire.iter()
        .filter(|v| v["method"] == "mcpServerStatus/list")
        .map(|v| v["serverName"].as_str())
        .collect();
    assert_eq!(mcp_checks, vec![None; 2], "each attempt attests the live MCP inventory");
    let retired = reqwest::Client::new().post(current["url"].as_str().unwrap())
        .header("authorization",old["http_headers"]["Authorization"].as_str().unwrap())
        .json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/list"})).send().await;
    assert!(retired.is_err() || !retired.unwrap().status().is_success(), "Retained transport must deny idle requests");
    drop(app);
    let reopened = Store::open(&path, project).unwrap();
    assert_eq!(reopened.all().unwrap().len(), 2);
    assert_eq!(serde_json::to_value(&reopened.all().unwrap()[1]).unwrap()["reasoning"]["effort"], "high");
    assert_eq!(
        reopened
            .session_by_id(&c.id)
            .unwrap()
            .native
            .unwrap()
            .thread,
        "normal-thread"
    );
}

// Explicit live qualification only; the default suite stays hermetic.
#[tokio::test]
#[ignore = "requires explicitly selected native login; run in an isolated project"]
async fn live_codex_two_turn_session() {
    use deck2_shared::{Phase, ScopedSubmit};
    let binary = std::path::PathBuf::from(
        std::env::var("DECK2_REAL_CODEX").expect("explicit native path required"),
    );
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().to_str().unwrap();
    let app = deck2::server::App::new(
        Store::open(&dir.path().join("state.db"), project).unwrap(),
        "127.0.0.1:32123".into(),
        binary.clone(),
        None,
        "admin".into(),
        "recover".into(),
    );
    let c:SessionCommand=serde_json::from_value(json!({"api":API,"id":"live-session-01","title":"Isolated session qualification","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
    app.store.lock().unwrap().create_session(&c).unwrap();
    let mut thread = None;
    for (id, prompt) in [
        (
            "live-command-01",
            "Use the deck_session_history MCP tool once to read current session evidence. Remember the token MAPLE-6274 in this conversation. Reply only SESSION_PARITY_OK.",
        ),
        (
            "live-command-02",
            "What token did I give you in the previous message? Reply only with that token.",
        ),
    ] {
        let submit:ScopedSubmit=serde_json::from_value(json!({"api":API,"id":id,"session":c.id,"prompt":prompt,"mode":"session_v1","fresh":false})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let (tx, rx) = tokio::sync::watch::channel(false);
        let running = tokio::spawn(deck2::native::run(
            app.clone(),
            id.into(),
            binary.clone(),
            rx,
        ));
        tokio::pin!(running);
        let start = std::time::Instant::now();
        let mut last = String::new();
        let mut interrupted = false;
        loop {
            tokio::select! {done=&mut running=>{done.unwrap();break;},_=tokio::time::sleep(std::time::Duration::from_millis(200))=>{
                let r=app.receipt(id).unwrap();let state=format!("{:?}; decisions={:?}",r.phase,r.decisions.iter().map(|d|(&d.state,d.native.as_ref().map(|n|n.method.as_str()))).collect::<Vec<_>>());if state!=last{println!("{id}: {state}");last=state;}
                for d in r.decisions.iter().filter(|d|d.state==deck2_shared::DecisionState::Pending){if let Some(n)=&d.native{
                    let p:serde_json::Value=serde_json::from_str(&n.parameters).unwrap();
                    let known=n.method=="mcpServer/elicitation/request"&&p["serverName"]=="deck-session"&&(p["toolName"]=="deck_session_history"||p["tool_name"]=="deck_session_history"||p["_meta"]["tool_name"]=="deck_session_history"||p["message"].as_str()==Some("Allow the deck-session MCP server to run tool \"deck_session_history\"?"));
                    if known{app.store.lock().unwrap().resolve(&d.id,&deck2_shared::Resolve{api:API,command_id:uuid::Uuid::new_v4().to_string(),expected_revision:d.revision,response:deck2_shared::DecisionResponse::AllowOnce}).unwrap();}
                }}
                if start.elapsed()>std::time::Duration::from_secs(240)&&!interrupted{app.store.lock().unwrap().request_cancel(id).unwrap();let _=tx.send(true);interrupted=true;}
            }}
        }
        let r = app.receipt(id).unwrap();
        assert_eq!(r.phase, Phase::Completed, "{}", r.detail);
        if id == "live-command-01" {
            assert!(r.text.contains("SESSION_PARITY_OK"), "{}", r.text);
            assert!(
                r.delivery.contains("deck_session_history"),
                "Native tool use was not observed: {}",
                r.delivery
            );
            thread = r.thread;
        } else {
            assert_eq!(r.thread, thread);
            assert!(r.text.contains("MAPLE-6274"), "{}", r.text);
        }
    }
}

// Original relay oracle: deny produces no effect; allow once releases the exact
// pending native request; a response after attempt termination never releases it.
#[tokio::test]
async fn command_approvals_release_only_current_explicit_permission() {
    use deck2_shared::{DecisionResponse, DecisionState, Phase, Resolve, ScopedSubmit};
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let binary = dir.path().join("codex");
    std::fs::write(&binary, include_str!("fake_session_native.py")).unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
    let project = dir.path().to_str().unwrap();
    let app = deck2::server::App::new(
        Store::open_memory(project).unwrap(),
        "127.0.0.1:32123".into(),
        binary.clone(),
        None,
        "admin".into(),
        "recover".into(),
    );
    let c:SessionCommand=serde_json::from_value(json!({"api":API,"id":"normal-approvals","title":"Approval oracle","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
    *app.native_role_root.lock().unwrap() = dir.path().join("native-role-fixture");
    app.store.lock().unwrap().create_session(&c).unwrap();
    for (i, response) in [
        Some(DecisionResponse::Deny),
        None,
        Some(DecisionResponse::AllowOnce),
    ]
    .into_iter()
    .enumerate()
    {
        let id = format!("native-approval-{i}");
        let submit:ScopedSubmit=serde_json::from_value(json!({"api":API,"id":id,"session":c.id,"prompt":"Native command consent oracle","mode":"session_v1"})).unwrap();
        app.store.lock().unwrap().admit(&submit).unwrap();
        let (_tx, rx) = tokio::sync::watch::channel(false);
        let running = tokio::spawn(deck2::native::run(
            app.clone(),
            id.clone(),
            binary.clone(),
            rx,
        ));
        let decision = tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let r = app.receipt(&id).unwrap();
                if let Some(d) = r.decisions.first() {
                    break d.clone();
                }
                assert!(r.phase.active(), "{}", r.detail);
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let revoked = response.is_none();
        if let Some(response) = response {
            app.store
                .lock()
                .unwrap()
                .resolve(
                    &decision.id,
                    &Resolve {
                        api: API,
                        command_id: format!("native-response-{i}"),
                        expected_revision: decision.revision,
                        response,
                    },
                )
                .unwrap();
        } else {
            app.store
                .lock()
                .unwrap()
                .revoke_session_grants(&c.id)
                .unwrap();
        }
        tokio::time::timeout(std::time::Duration::from_secs(10), running)
            .await
            .unwrap()
            .unwrap();
        let r = app.receipt(&id).unwrap();
        assert_eq!(r.phase, Phase::Completed, "{}", r.detail);
        assert_eq!(
            r.decisions[0].state,
            if revoked {
                DecisionState::Invalidated
            } else {
                DecisionState::Settled
            }
        );
        assert_eq!(dir.path().join("native-created.txt").exists(), i == 2);
        assert!(
            app.store
                .lock()
                .unwrap()
                .resolve(
                    &decision.id,
                    &Resolve {
                        api: API,
                        command_id: format!("late-native-{i}"),
                        expected_revision: decision.revision,
                        response: DecisionResponse::AllowOnce
                    }
                )
                .is_err()
        );
    }
}
fn boundary_fixture() -> (tempfile::TempDir, deck2::server::App, std::path::PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let binary = dir.path().join("codex");
    std::fs::write(&binary, include_str!("fake_session_native.py")).unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
    let app = deck2::server::App::new(
        Store::open_memory(dir.path().to_str().unwrap()).unwrap(),
        "127.0.0.1:32123".into(),
        binary.clone(),
        None,
        "admin".into(),
        "recover".into(),
    );
    *app.native_role_root.lock().unwrap() = dir.path().join("native-role-fixture");
    let c=serde_json::from_value(json!({"api":API,"id":"session-boundary","title":"Session","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
    app.store.lock().unwrap().create_session(&c).unwrap();
    (dir, app, binary)
}
async fn boundary_send(app: &deck2::server::App, binary: &std::path::Path, id: &str) {
    let input=serde_json::from_value(json!({"api":API,"id":id,"session":"session-boundary","mode":"session_v1","prompt":"Current user input"})).unwrap();
    app.store.lock().unwrap().admit(&input).unwrap();
    let (_tx, rx) = tokio::sync::watch::channel(false);
    deck2::native::run(app.clone(), id.into(), binary.into(), rx).await;
}
#[tokio::test]
async fn confirmed_missing_history_reseeds_before_one_new_input_dispatch() {
    let (dir, app, binary) = boundary_fixture();
    boundary_send(&app, &binary, "history-command-01").await;
    assert_eq!(
        app.receipt("history-command-01").unwrap().phase,
        deck2_shared::Phase::Completed
    );
    std::fs::write(dir.path().join("missing-history"), "").unwrap();
    boundary_send(&app, &binary, "history-command-02").await;
    let receipt = app.receipt("history-command-02").unwrap();
    assert_eq!(
        receipt.phase,
        deck2_shared::Phase::Completed,
        "{}",
        receipt.detail
    );
    assert!(
        receipt
            .delivery
            .contains("Confirmed missing native history")
    );
    assert_eq!(receipt.thread.as_deref(), Some("reseed-thread"));
    let mut admitted = receipt.configuration.unwrap().session_contract.unwrap();
    let previous = app.receipt("history-command-01").unwrap().configuration.unwrap().session_contract.unwrap();
    assert_eq!(admitted.generation, 2);
    assert_eq!(previous.generation, 1, "older receipts must not inherit reseed authority");
    admitted.generation = previous.generation;
    assert_eq!(admitted, previous, "reseed must preserve the admitted assignment and permission policy");
    assert_eq!(
        app.store
            .lock()
            .unwrap()
            .session_by_id("session-boundary")
            .unwrap()
            .contract
            .unwrap()
            .generation,
        2
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("dispatch-count"))
            .unwrap()
            .lines()
            .count(),
        2
    );
}
// A confirmed missing thread cannot renew revoked or stale caller authority.
#[tokio::test]
async fn missing_history_reseed_cannot_refresh_revoked_or_stale_authority() {
    use deck2_shared::{Phase, ScopedSubmit};
    for revoked in [false, true] {
        let (_dir, app, binary) = boundary_fixture();
        boundary_send(&app, &binary, "reseed-predecessor").await;
        let mut store = app.store.lock().unwrap();
        let input: ScopedSubmit = serde_json::from_value(json!({"api":API,"id":"reseed-current","session":"session-boundary","mode":"session_v1","prompt":"Current input"})).unwrap();
        let mut receipt = store.admit(&input).unwrap();
        receipt.phase = Phase::Preparing;
        if !revoked {
            receipt.configuration.as_mut().unwrap().session_contract.as_mut().unwrap().generation = 0;
        }
        store.save(&mut receipt).unwrap();
        if revoked { store.revoke_session_grants("session-boundary").unwrap(); }
        let before = serde_json::to_value(store.session_by_id("session-boundary").unwrap()).unwrap();
        assert!(store.record_native_reseed("reseed-current", "normal-thread").is_err(), "reseed must not renew revoked={revoked} authority");
        assert_eq!(serde_json::to_value(store.session_by_id("session-boundary").unwrap()).unwrap(), before);
    }
}
#[tokio::test]
async fn lost_native_ack_never_reseeds_or_replays_uncertain_input() {
    let (dir, app, binary) = boundary_fixture();
    std::fs::write(dir.path().join("lose-ack"), "").unwrap();
    boundary_send(&app, &binary, "uncertain-command").await;
    assert_eq!(
        app.receipt("uncertain-command").unwrap().phase,
        deck2_shared::Phase::Uncertain
    );
    let retry=serde_json::from_value(json!({"api":API,"id":"new-after-uncertain","session":"session-boundary","mode":"session_v1","prompt":"Do not dispatch"})).unwrap();
    assert!(app.store.lock().unwrap().admit(&retry).is_err());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("dispatch-count")).unwrap(),
        "dispatch\n"
    );
    assert_eq!(
        app.store
            .lock()
            .unwrap()
            .session_by_id("session-boundary")
            .unwrap()
            .contract
            .unwrap()
            .generation,
        1
    );
}

// ASSIGN-01/02: oracle is the selected public assignment at the real transport
// boundary. Fail if the provider prefix leaks or turn effort/model is omitted.
#[tokio::test]
async fn assignment_wire_resolves_alias_and_turn_effort() {
    for (index, model) in ["gpt-6.1-sol", "openai-codex/gpt-6.1-sol"].iter().enumerate() {
        let (dir, app, binary) = boundary_fixture();
        let selected = serde_json::from_value(json!({"runnerId":"codex","modelId":model,"thinking":"high"})).unwrap();
        app.store.lock().unwrap().assign_member("session-boundary","lead",selected,1).unwrap();
        let id=format!("assignment-wire-{index}");
        boundary_send(&app,&binary,&id).await;
        let receipt=app.receipt(&id).unwrap();
        assert_eq!(receipt.phase,deck2_shared::Phase::Completed,"{}",receipt.detail);
        let wire=std::fs::read_to_string(dir.path().join("wire")).unwrap();
        let values:Vec<serde_json::Value>=wire.lines().map(|s|serde_json::from_str(s).unwrap()).collect();
        for method in ["thread/start","turn/start"] {
            let params=&values.iter().find(|v|v["method"]==method).unwrap()["params"];
            assert_eq!(params["model"],"gpt-6.1-sol","{method}: native model");
            if method=="turn/start" {assert_eq!(params["effort"],"high","turn effort must match explicit assignment");}
            else {assert_eq!(params["config"]["model_reasoning_effort"],"high");}
        }
        assert_eq!(receipt.requested_model.as_deref(),Some(*model));
    }
}

#[tokio::test]
async fn assignment_catalog_accepts_original_alias() {
    let (_dir,app,_binary)=boundary_fixture();
    let members=serde_json::from_value(json!({"lead":{"runnerId":"codex","modelId":"openai-codex/gpt-6.1-sol","thinking":"high"}})).unwrap();
    deck2::session_contract::validate_available(&app,&members).await.expect("original alias must resolve against authenticated native inventory");
}

async fn assignment_http(app: &deck2::server::App, path: &str, body: serde_json::Value) -> (u16,serde_json::Value) {
    use axum::{body::Body,http::Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    let token=app.issue_launch();
    let response=deck2::server::router(app.clone()).oneshot(Request::builder().method("POST").uri("/auth").header("host","127.0.0.1:32123").header("origin","http://127.0.0.1:32123").body(Body::from(token)).unwrap()).await.unwrap();
    let cookie=response.headers()["set-cookie"].to_str().unwrap().split(';').next().unwrap().to_owned();
    let response=deck2::server::router(app.clone()).oneshot(Request::builder().method("POST").uri(path).header("host","127.0.0.1:32123").header("origin","http://127.0.0.1:32123").header("cookie",cookie).header("content-type","application/json").body(Body::from(body.to_string())).unwrap()).await.unwrap();
    let status=response.status().as_u16();
    let bytes=response.into_body().collect().await.unwrap().to_bytes();
    (status,serde_json::from_slice(&bytes).unwrap_or_default())
}
// ASSIGN-04: real composed HTTP path, a held native inventory and independent
// mutations. Any stale completion must preserve the state after the competing
// mutation and must never dispatch a turn.
#[tokio::test]
async fn assignment_http_discovery_races_preserve_current_state() {
    for race in ["busy","revision","executable","native-config","project-config"] {
        let (dir,app,binary)=boundary_fixture();
        std::fs::create_dir_all(dir.path().join("native-role-fixture")).unwrap();
        std::fs::create_dir_all(dir.path().join(".deck")).unwrap();
        let script=include_str!("fake_session_native.py").replace("elif m=='model/list':result", "elif m=='model/list':\n  (root/'entered').touch()\n  deadline=time.monotonic()+10\n  while not (root/'release').exists():\n   if time.monotonic()>deadline: raise RuntimeError('discovery release deadline')\n   time.sleep(.005)\n  result");
        std::fs::write(&binary,script).unwrap();
        let running={let app=app.clone();tokio::spawn(async move {assignment_http(&app,"/api/sessions/session-boundary/assignments",json!({"api":API,"memberId":"lead","assignment":{"runnerId":"codex","modelId":"openai-codex/gpt-6.1-sol","thinking":"high"},"expectedRevision":1})).await})};
        tokio::time::timeout(std::time::Duration::from_secs(5),async {while !dir.path().join("entered").exists(){tokio::time::sleep(std::time::Duration::from_millis(5)).await;}}).await.expect("must reach held native inventory");
        match race {
            "busy"=>{let input=serde_json::from_value(json!({"api":API,"id":"competing-input","session":"session-boundary","mode":"session_v1","prompt":"Current request"})).unwrap();app.store.lock().unwrap().admit(&input).unwrap();},
            "revision"=>{let a=serde_json::from_value(json!({"runnerId":"codex","modelId":"recorded-worker","thinking":"high"})).unwrap();app.store.lock().unwrap().assign_member("session-boundary","quality",a,1).unwrap();},
            "executable"=>{use std::io::Write;std::fs::OpenOptions::new().append(true).open(&binary).unwrap().write_all(b"\n# changed executable\n").unwrap();},
            "native-config"=>std::fs::write(dir.path().join("native-role-fixture/config.toml"),"sandbox_mode = 'read-only'\n").unwrap(),
            _=>std::fs::write(dir.path().join(".deck/config.json"),"{}").unwrap(),
        }
        let expected=app.store.lock().unwrap().session_by_id("session-boundary").unwrap();
        std::fs::write(dir.path().join("release"),"").unwrap();
        let (status,error)=running.await.unwrap();
        assert_eq!(status,409,"{race}: {error}");
        assert_eq!(app.store.lock().unwrap().session_by_id("session-boundary").unwrap(),expected,"{race}: no partial assignment");
        assert!(!dir.path().join("dispatch-count").exists());
    }
}
// ASSIGN-01: only authenticated, visible, unambiguous inventory and supported
// effort may become executable. Source IDs are not arbitrary provider prefixes.
#[tokio::test]
async fn assignment_inventory_rejects_hidden_malformed_and_unsupported() {
    let (dir,app,_)=boundary_fixture();
    for (model,thinking) in [("foreign/gpt-6.1-sol","high"),("gpt-6.1-sol","ultra"),("hidden-model","high")] {
        std::fs::write(dir.path().join("model-inventory.json"),json!([{"model":"gpt-6.1-sol","supportedReasoningEfforts":[{"reasoningEffort":"high"}]},{"model":"hidden-model","hidden":true,"supportedReasoningEfforts":[{"reasoningEffort":"high"}]}]).to_string()).unwrap();
        let (status,_)=assignment_http(&app,"/api/sessions/session-boundary/assignments",json!({"api":API,"memberId":"lead","assignment":{"runnerId":"codex","modelId":model,"thinking":thinking},"expectedRevision":1})).await;
        assert_eq!(status,409,"{model}/{thinking}");
        assert_eq!(app.store.lock().unwrap().session_by_id("session-boundary").unwrap().contract.unwrap().revision,1);
    }
    for inventory in [json!([{"model":"bad/model","supportedReasoningEfforts":[]}]),json!([{"model":"same","supportedReasoningEfforts":[]},{"model":"same","supportedReasoningEfforts":[]}]),json!([{"model":"gpt-6.1-sol","supportedReasoningEfforts":[{}]}])] {
        std::fs::write(dir.path().join("model-inventory.json"),inventory.to_string()).unwrap();
        assert!(deck2::session_contract::validate_available(&app,&serde_json::from_value(json!({"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}})).unwrap()).await.is_err());
    }
    let binary=dir.path().join("codex");
    let unauthed=include_str!("fake_session_native.py").replace("{'account':{'type':'chatgpt'}}","{'account':None}");
    std::fs::write(&binary,unauthed).unwrap();
    assert!(deck2::session_contract::validate_available(&app,&serde_json::from_value(json!({"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}})).unwrap()).await.is_err());
    assert!(!dir.path().join("dispatch-count").exists());
}
// ASSIGN-02: separate sessions and two member selections survive restart. Native
// wire values must be independently selected rather than copied from Lead.
#[tokio::test]
async fn assignment_independent_sessions_and_members_reach_native_wire() {
    use deck2_shared::{Phase,ScopedSubmit};
    let (dir,app,binary)=boundary_fixture();
    std::fs::write(dir.path().join("waiting-fixture"),"").unwrap();
    std::fs::write(dir.path().join("model-inventory.json"),json!([{"model":"gpt-6.1-sol","supportedReasoningEfforts":[{"reasoningEffort":"high"}]},{"model":"recorded-worker","supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"high"}]}]).to_string()).unwrap();
    for (session,lead,effort) in [("independent-a","gpt-6.1-sol","high"),("independent-b","recorded-worker","low")] {
        let c=serde_json::from_value(json!({"api":API,"id":session,"title":session,"members":{"lead":{"runnerId":"codex","modelId":lead,"thinking":effort},"apply-deep":{"runnerId":"codex","modelId":"openai-codex/recorded-worker","thinking":"high"},"quality":{"runnerId":"codex","modelId":"gpt-6.1-sol","thinking":"high"}}})).unwrap();
        app.store.lock().unwrap().create_session(&c).unwrap();
        let id=format!("independent-command-{session}");
        let submit:ScopedSubmit=serde_json::from_value(json!({"api":API,"id":id,"session":session,"mode":"session_v1","prompt":format!("Waiting-policy seed {session}")})).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(10),async {while app.store.lock().unwrap().all().unwrap().iter().any(|r|r.phase.active()) {tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.expect("previous owned notification must settle");
        let admitted=app.store.lock().unwrap().admit(&submit);
        assert!(admitted.is_ok(),"{session}: {admitted:?}; receipts={:?}",app.store.lock().unwrap().all().unwrap().iter().map(|r|(&r.id,&r.phase,&r.detail)).collect::<Vec<_>>());
        let (_tx,rx)=tokio::sync::watch::channel(false);deck2::native::run(app.clone(),id.clone(),binary.clone(),rx).await;
        assert_eq!(app.receipt(&id).unwrap().phase,Phase::Completed);
        tokio::time::timeout(std::time::Duration::from_secs(10),async {loop {let tasks=app.store.lock().unwrap().tasks().unwrap();if tasks.iter().filter(|t|t.session==session).all(|t|t.attempts.last().unwrap().report.is_some()) {break;}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await.unwrap();
        let wire=std::fs::read_to_string(dir.path().join("wire")).unwrap();
        let wire:Vec<serde_json::Value>=wire.lines().map(|l|serde_json::from_str(l).unwrap()).collect();
        assert!(wire.iter().any(|v|v["method"]=="turn/start"&&v["params"]["model"]==lead&&v["params"]["effort"]==effort));
        assert!(wire.iter().any(|v|v["method"]=="turn/start"&&v["params"]["model"]=="recorded-worker"&&v["params"]["effort"]=="high"));
    }
}

// Effective default is native model metadata, below explicit session and cwd
// config precedence. The oracle inspects what actually reaches thread/turn.
#[tokio::test]
async fn reasoning_default_config_and_explicit_precedence() {
    for (index, configured, explicit, expected) in [
        (0, None, None, "low"),
        (1, Some("medium"), None, "medium"),
        (2, Some("medium"), Some("high"), "high"),
    ] {
        let (dir, app, binary) = boundary_fixture();
        std::fs::write(dir.path().join("model-inventory.json"), json!([{"model":"gpt-6.1-sol","defaultReasoningEffort":"low","supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"medium"},{"reasoningEffort":"high"}]}]).to_string()).unwrap();
        if let Some(effort) = configured {
            std::fs::write(
                dir.path().join("reasoning-config.json"),
                json!({"model_reasoning_effort":effort}).to_string(),
            )
            .unwrap();
        }
        if let Some(effort) = explicit {
            app.store
                .lock()
                .unwrap()
                .assign_member(
                    "session-boundary",
                    "lead",
                    serde_json::from_value(
                        json!({"runnerId":"codex","modelId":"gpt-6.1-sol","thinking":effort}),
                    )
                    .unwrap(),
                    1,
                )
                .unwrap();
        }
        let id = format!("reasoning-precedence-{index}");
        boundary_send(&app, &binary, &id).await;
        let receipt = app.receipt(&id).unwrap();
        assert_eq!(
            receipt.phase,
            deck2_shared::Phase::Completed,
            "{}",
            receipt.detail
        );
        let wire = std::fs::read_to_string(dir.path().join("wire")).unwrap();
        let requests: Vec<serde_json::Value> = wire
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(
            requests
                .iter()
                .find(|v| v["method"] == "turn/start")
                .unwrap()["params"]["effort"],
            expected
        );
        assert_eq!(
            serde_json::to_value(&receipt).unwrap()["reasoning"]["effort"],
            expected
        );
        // A missing acknowledgement must not be advertised as confirmed.
        std::fs::write(dir.path().join("reasoning-ack.json"), "null").unwrap();
        let next = format!("reasoning-unknown-{index}");
        boundary_send(&app, &binary, &next).await;
        assert_eq!(
            serde_json::to_value(app.receipt(&next).unwrap()).unwrap()["reasoning"],
            serde_json::Value::Null
        );
    }
}
