//! Public-route isolation: explicit navigation may never retarget a reviewed effect.
use super::*;
use tower::ServiceExt;

fn fixture() -> (tempfile::TempDir, App, deck2_shared::ProjectBinding) {
    let d = tempfile::tempdir().unwrap();
    for name in ["a", "b"] {
        std::fs::create_dir(d.path().join(name)).unwrap();
    }
    let a = d.path().join("a");
    let b = d.path().join("b");
    let mut s = Store::open_memory(a.to_str().unwrap()).unwrap();
    let pb = s.register_project(b.to_str().unwrap()).unwrap();
    s.set_trust(a.to_str().unwrap(), true).unwrap();
    s.set_trust(b.to_str().unwrap(), true).unwrap();
    let app = App::new(
        s,
        "127.0.0.1:1234".into(),
        "/missing".into(),
        None,
        "admin".into(),
        "recover".into(),
    );
    *app.artifact_store.lock().unwrap() = Some(d.path().join("artifacts"));
    (d, app, pb)
}
async fn call(
    app: &App,
    method: &str,
    path: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let r = router(app.clone())
        .oneshot(
            axum::http::Request::builder()
                .method(method)
                .uri(path)
                .header("host", &app.host)
                .header("origin", format!("http://{}", app.host))
                .header("cookie", format!("{}={}", app.cookie_name, app.cookie))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status();
    let bytes = axum::body::to_bytes(r.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or_else(|_|json!({"body":String::from_utf8_lossy(&bytes)})))
}

// Protects explicit target identity, independent revisions, legacy fallback and receipts.
// Oracle: acceptance 1/2/4. Fails if a reviewed A effect is admitted from B.
#[tokio::test]
async fn project_settings_configuration_isolation() {
    let (_d, app, pb) = fixture();
    let pa = crate::projects::id(&app.project);
    let (_, a) = call(&app, "GET", "/api/configuration", json!(null)).await;
    let (status, b) = call(
        &app,
        "GET",
        &format!("/api/configuration?projectId={}", pb.id),
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{b}");
    assert_eq!(b["selected"]["project"], pb.root);
    let revision = a["selected"]["revision"].as_u64().unwrap();
    let (status, p) = call(
        &app,
        "POST",
        &format!("/api/configuration/plans?projectId={pa}"),
        json!({"api":API,"expected_revision":revision,"team_enabled":false}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{p}");
    let id = p["id"].as_str().unwrap();
    let body = json!({"api":API,"operation_id":"scope-operation-a","allow":true});
    let (status, v) = call(
        &app,
        "POST",
        &format!("/api/configuration/plans/{id}/apply?projectId={}", pb.id),
        body.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "cross-project apply: {v}");
    assert_eq!(v["code"], "project_mismatch");
    let (status, v) = call(
        &app,
        "POST",
        &format!("/api/configuration/plans/{id}/apply"),
        body,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "legacy apply: {v}");
    let (status, v) = call(
        &app,
        "GET",
        &format!("/api/operations/scope-operation-a?projectId={}", pb.id),
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "foreign receipt: {v}");
    assert_eq!(
        app.store
            .lock()
            .unwrap()
            .configuration_for(&pb.root)
            .unwrap()
            .revision,
        b["selected"]["revision"].as_u64().unwrap()
    );
}

// Protects registered-root trust and filesystem identity at every explicit API boundary.
#[tokio::test]
async fn project_settings_refuses_untrusted_unavailable_and_unknown() {
    let (d, app, pb) = fixture();
    app.store
        .lock()
        .unwrap()
        .set_trust(&pb.root, false)
        .unwrap();
    for endpoint in ["/api/configuration", "/api/cbm", "/api/helpers"] {
        let (status, v) = call(
            &app,
            "GET",
            &format!("{endpoint}?projectId={}", pb.id),
            json!(null),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{v}");
        assert_eq!(v["code"], "project_untrusted");
    }
    app.store.lock().unwrap().set_trust(&pb.root, true).unwrap();
    std::fs::rename(&pb.root, d.path().join("old-b")).unwrap();
    let (status, v) = call(
        &app,
        "GET",
        &format!("/api/configuration?projectId={}", pb.id),
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{v}");
    assert_eq!(v["code"], "project_unavailable");
    let (status, v) = call(
        &app,
        "GET",
        "/api/configuration?projectId=/tmp",
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{v}");
    assert_eq!(v["code"], "project_unknown");
}

// Protects CBM plan/receipt ownership without invoking native effects or the network.
#[tokio::test]
async fn project_settings_cbm_isolation() {
    let (_d, app, pb) = fixture();
    let pa = crate::projects::id(&app.project);
    let revision = app.store.lock().unwrap().configuration().unwrap().revision;
    let (status,p)=call(&app,"POST",&format!("/api/cbm/plans?projectId={pa}"),json!({"api":API,"expected_revision":revision,"action":"disable","paths":[],"service":null,"operation":null,"root":null})).await;
    assert_eq!(status, StatusCode::OK, "{p}");
    let id = p["plan"]["id"].as_str().unwrap();
    let body = json!({"api":API,"operation_id":"scope-cbm-operation","allow":false});
    let (status, v) = call(
        &app,
        "POST",
        &format!("/api/cbm/plans/{id}/apply?projectId={}", pb.id),
        body.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{v}");
    assert_eq!(v["code"], "project_mismatch");
    let (status, v) = call(
        &app,
        "POST",
        &format!("/api/cbm/plans/{id}/apply?projectId={pa}"),
        body,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert_eq!(v["phase"], "denied");
    let (status, v) = call(
        &app,
        "GET",
        &format!(
            "/api/cbm/operations/scope-cbm-operation?projectId={}",
            pb.id
        ),
        json!(null),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{v}");
    assert_eq!(v["code"], "project_mismatch");
}

// Oracle: same-project stale writes lose, while another project's revision is independent.
#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
async fn project_settings_concurrent_applies_keep_project_revisions() {
    let (_d, app, pb) = fixture();
    let pa = crate::projects::id(&app.project);
    let mut plans = vec![];
    for project in [&pa, &pa, &pb.id] {
        let root = app
            .store
            .lock()
            .unwrap()
            .project_by_id(project)
            .unwrap()
            .root;
        let revision = app
            .store
            .lock()
            .unwrap()
            .configuration_for(&root)
            .unwrap()
            .revision;
        let (status, p) = call(
            &app,
            "POST",
            &format!("/api/configuration/plans?projectId={project}"),
            json!({"api":API,"expected_revision":revision,"team_enabled":false}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{p}");
        plans.push(p["id"].as_str().unwrap().to_string());
    }
    let urls: Vec<_> = plans
        .iter()
        .zip([&pa, &pa, &pb.id])
        .map(|(p, id)| format!("/api/configuration/plans/{p}/apply?projectId={id}"))
        .collect();
    let mut workers = vec![];
    for (url, id) in urls
        .into_iter()
        .zip(["scope-race-one", "scope-race-two", "scope-race-other"])
    {
        let app = app.clone();
        workers.push(tokio::spawn(async move {
            call(
                &app,
                "POST",
                &url,
                json!({"api":API,"operation_id":id,"allow":true}),
            )
            .await
        }));
    }
    let a = workers.remove(0).await.unwrap();
    let b = workers.remove(0).await.unwrap();
    let c = workers.remove(0).await.unwrap();
    assert_eq!(
        [a.0, b.0].iter().filter(|s| **s == StatusCode::OK).count(),
        1
    );
    assert_eq!(c.0, StatusCode::OK, "{}", c.1);
}

// Protects installed schema17 state: existing JSON plans and receipts retain ownership
// after upgrade/reopen; no table or durable JSON shape is rewritten by targeting.
#[test]
fn project_settings_state_upgrade_preserves_legacy_plans_and_receipts() {
    let d = tempfile::tempdir().unwrap();
    for name in ["a", "b"] {
        std::fs::create_dir(d.path().join(name)).unwrap();
    }
    let a = d.path().join("a");
    let b = d.path().join("b");
    let db = d.path().join("state.db");
    let mut s = Store::open(&db, a.to_str().unwrap()).unwrap();
    let pb = s.register_project(b.to_str().unwrap()).unwrap();
    let ca = s.configuration().unwrap();
    let cb = s.configuration_for(&pb.root).unwrap();
    let p = s
        .plan_configuration(
            &crate::configuration::PlanRequest {
                api: API,
                expected_revision: ca.revision,
                team_enabled: false,
            },
            &None,
        )
        .unwrap();
    let o = s
        .apply_configuration(
            &p.id,
            &crate::configuration::ApplyRequest {
                api: API,
                operation_id: "legacy-scope-operation".into(),
                allow: false,
            },
            &None,
        )
        .unwrap();
    // An installed CBM review has no optional explicit-target binding.
    let legacy_graph = json!({"id":"legacy-graph-plan","host":ca.host_id,"revision":ca.revision,"store":d.path().join("artifacts"),"request":{"api":API,"expected_revision":ca.revision,"action":"disable","paths":[],"service":null,"operation":null,"root":null},"snapshot":null,"binding":null,"instruction":crate::tasks::digest(crate::cbm_management::INSTRUCTIONS.as_bytes())}).to_string();
    s.conn
        .execute(
            "INSERT INTO cbm_plans VALUES(?1,?2)",
            rusqlite::params!["legacy-graph-plan", legacy_graph],
        )
        .unwrap();
    let legacy_receipt = json!({"id":"legacy-cbm-receipt","plan":"legacy-graph-plan","allow":false,"phase":"denied","detail":"Preserved legacy decision","service":null,"effect_started":false}).to_string();
    s.conn.execute("INSERT INTO cbm_operations VALUES(?1,?2,?3)", rusqlite::params!["legacy-cbm-receipt","legacy-graph-plan",legacy_receipt]).unwrap();
    s.conn
        .execute("UPDATE meta SET value='17' WHERE key='schema'", [])
        .unwrap();
    drop(s);
    let s = Store::open(&db, b.to_str().unwrap()).unwrap();
    assert_eq!(s.configuration_for(a.to_str().unwrap()).unwrap(), ca);
    assert_eq!(s.configuration_for(&pb.root).unwrap(), cb);
    assert_eq!(s.helper_plan(&p.id).unwrap(), p);
    assert_eq!(s.operation(&o.id).unwrap(), o);
    assert_eq!(
        s.cbm_plan_project("legacy-graph-plan").unwrap(),
        a.to_str().unwrap()
    );
    let raw: String = s
        .conn
        .query_row(
            "SELECT body FROM cbm_plans WHERE id='legacy-graph-plan'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(raw, legacy_graph);
    let raw_receipt: String = s.conn.query_row("SELECT body FROM cbm_operations WHERE id='legacy-cbm-receipt'",[],|r|r.get(0)).unwrap();
    assert_eq!(raw_receipt,legacy_receipt);
    let loaded: crate::cbm_management::Operation = serde_json::from_str(&raw_receipt).unwrap();
    assert!(loaded.execution_target.is_none());
    assert_eq!(loaded.phase,"denied");
}

// Protects per-project capacity: A's retained reviews cannot exhaust B's allowance.
#[tokio::test]
async fn project_settings_plan_capacity_is_per_project() {
    let (_d, app, pb) = fixture();
    {
        let mut s = app.store.lock().unwrap();
        let c = s.configuration().unwrap();
        for _ in 0..256 {
            s.plan_configuration(
                &crate::configuration::PlanRequest {
                    api: API,
                    expected_revision: c.revision,
                    team_enabled: false,
                },
                &None,
            )
            .unwrap();
        }
    }
    let revision = app
        .store
        .lock()
        .unwrap()
        .configuration_for(&pb.root)
        .unwrap()
        .revision;
    let (status, p) = call(
        &app,
        "POST",
        &format!("/api/configuration/plans?projectId={}", pb.id),
        json!({"api":API,"expected_revision":revision,"team_enabled":false}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{p}");
    let (status, p) = call(
        &app,
        "POST",
        &format!("/api/helpers/plans?projectId={}", pb.id),
        json!({"api":API,"expected_revision":revision,"version":"1.2.0"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{p}");
}

// Protects automatic scope selection and refusal of client-selected paths.
// Oracle: brief decision 8; fails if ignored, binary, large or linked sources enter the map.
#[tokio::test]
async fn project_settings_whole_project_scope() {
    let (d, app, pb) = fixture();
    let root = std::path::Path::new(&pb.root);
    std::fs::write(root.join(".gitignore"), "ignored/\n*.secret\n").unwrap();
    std::fs::create_dir(root.join("src")).unwrap();
    std::fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();
    std::fs::create_dir(root.join("ignored")).unwrap();
    std::fs::write(root.join("ignored/hidden.rs"), "secret").unwrap();
    std::fs::write(root.join("key.secret"), "secret").unwrap();
    std::fs::write(root.join("image.bin"), b"abc\0def").unwrap();
    std::fs::write(root.join("large.rs"), vec![b'x'; 65537]).unwrap();
    std::fs::write(d.path().join("outside.rs"), "outside").unwrap();
    std::os::unix::fs::symlink(d.path().join("outside.rs"), root.join("link.rs")).unwrap();
    std::os::unix::fs::symlink(d.path(), root.join("escape")).unwrap();
    std::fs::write(root.join("src/.gitignore"), "nested.rs\n").unwrap();
    std::fs::write(root.join("src/nested.rs"), "ignored").unwrap();
    let (_, c) = call(&app,"GET",&format!("/api/configuration?projectId={}",pb.id),json!(null)).await;
    let body=json!({"api":API,"expected_revision":c["selected"]["revision"],"action":"prepare_project","paths":[],"service":null,"operation":null,"root":null});
    let endpoint=format!("/api/cbm/plans?projectId={}",pb.id);
    let (status,v)=call(&app,"POST",&endpoint,body.clone()).await;
    assert_eq!(status,StatusCode::OK,"{v}");
    let files=v["plan"]["snapshot"]["files"].as_object().unwrap();
    assert!(files.contains_key("src/main.rs"));
    for path in ["ignored/hidden.rs","key.secret","image.bin","large.rs","link.rs","escape/outside.rs","src/nested.rs"] { assert!(!files.contains_key(path),"{path}"); }
    let mut bad=body;bad["paths"]=json!(["src/main.rs"]);
    assert_ne!(call(&app,"POST",&endpoint,bad).await.0,StatusCode::OK);
}

// Protects helper on/off revision-safe, project-isolated application without acquisition.
#[tokio::test]
async fn project_settings_switch_round_trip() {
    let (_d,app,pb)=fixture();
    let latest=crate::managed_tools::release("1.2.0").unwrap().selection;
    {let s=app.store.lock().unwrap();let mut c=s.configuration_for(&pb.root).unwrap();c.helper=Some(latest);c.revision=s.next_configuration_revision().unwrap();s.save_configuration(&c).unwrap();}
    for enabled in [false,true] {
        let (_,c)=call(&app,"GET",&format!("/api/configuration?projectId={}",pb.id),json!(null)).await;
        let (status,p)=call(&app,"POST",&format!("/api/configuration/plans?projectId={}",pb.id),json!({"api":API,"expected_revision":c["selected"]["revision"],"team_enabled":enabled})).await;
        assert_eq!(status,StatusCode::OK,"{p}");
        let (status,o)=call(&app,"POST",&format!("/api/configuration/plans/{}/apply?projectId={}",p["id"].as_str().unwrap(),pb.id),json!({"api":API,"operation_id":uuid::Uuid::new_v4().to_string(),"allow":true})).await;
        assert_eq!(status,StatusCode::OK,"{o}");assert_eq!(o["phase"],"applied");
        assert_eq!(app.store.lock().unwrap().configuration_for(&pb.root).unwrap().team_enabled,enabled);
    }
    let (_,c)=call(&app,"GET",&format!("/api/configuration?projectId={}",pb.id),json!(null)).await;
    let (status,p)=call(&app,"POST",&format!("/api/helpers/plans?projectId={}",pb.id),json!({"api":API,"expected_revision":c["selected"]["revision"],"version":"off"})).await;
    assert_eq!(status,StatusCode::OK,"{p}");
    let (status,o)=call(&app,"POST",&format!("/api/configuration/plans/{}/apply?projectId={}",p["id"].as_str().unwrap(),pb.id),json!({"api":API,"operation_id":uuid::Uuid::new_v4().to_string(),"allow":true})).await;
    assert_eq!(status,StatusCode::OK,"{o}");assert_eq!(o["phase"],"applied");
    assert!(app.store.lock().unwrap().configuration_for(&pb.root).unwrap().helper.is_none());
}

// Latest is resolved server-side to a pinned reviewed artifact, never a remote
// version lookup. This public-boundary test performs no download.
#[tokio::test]
async fn project_settings_token_saver_latest_is_pinned() {
    let (_d, app, pb) = fixture();
    let c = app.store.lock().unwrap().configuration_for(&pb.root).unwrap();
    let (status, p) = call(&app,"POST",&format!("/api/helpers/plans?projectId={}",pb.id),json!({"api":API,"expected_revision":c.revision,"version":"latest"})).await;
    assert_eq!(status,StatusCode::OK,"{p}");
    assert_eq!(p["helper"],serde_json::to_value(crate::managed_tools::release("1.2.0").unwrap().selection).unwrap());
    assert!(app.store.lock().unwrap().configuration_for(&pb.root).unwrap().helper.is_none());
}

// Whole-project preparation is a new effect, not a legacy authority bypass.
#[tokio::test]
async fn project_settings_automatic_host_scope_requires_trust() {
    let (_d, app, _pb) = fixture();
    std::fs::write(std::path::Path::new(&app.project).join("main.rs"),"fn main() {}\n").unwrap();
    let revision=app.store.lock().unwrap().configuration().unwrap().revision;
    app.store.lock().unwrap().set_trust(&app.project,false).unwrap();
    let body=json!({"api":API,"expected_revision":revision,"action":"prepare_project","paths":[],"service":null,"operation":null,"root":null});
    let (status,v)=call(&app,"POST","/api/cbm/plans",body).await;
    assert_eq!(status,StatusCode::FORBIDDEN);
    assert_eq!(v["code"],"project_untrusted");
    app.store.lock().unwrap().set_trust(&app.project,true).unwrap();
    let (status,v)=call(&app,"POST","/api/cbm/plans",json!({"api":API,"expected_revision":revision,"action":"prepare_project","paths":[],"service":null,"operation":null,"root":null})).await;
    assert_eq!(status,StatusCode::OK);
    assert_eq!(v["plan"]["target"]["root"],app.project);
}

// Protects automatic admission: untrusted projects never start a worker or scan.
// Oracle: decision 11 and project authority; a posted path must be rejected.
#[tokio::test]
async fn settings_model_automatic_trust_and_input_boundary() {
    let (_d,app,p)=fixture();
    app.store.lock().unwrap().set_trust(&p.root,false).unwrap();
    let path=format!("/api/cbm/automatic?projectId={}",p.id);
    let (code,v)=call(&app,"POST",&path,json!({"api":API})).await;
    assert_eq!(code,StatusCode::OK);assert_eq!(v["status"]["phase"],"paused");
    assert!(app.git_review.automatic.lock().unwrap().is_empty());
    let response=router(app.clone()).oneshot(axum::http::Request::builder().method("POST").uri(&path)
        .header("host",&app.host).header("origin",format!("http://{}",app.host))
        .header("cookie",format!("{}={}",app.cookie_name,app.cookie)).header("content-type","application/json")
        .body(Body::from(json!({"api":API,"paths":["/etc/passwd"]}).to_string())).unwrap()).await.unwrap();
    assert_eq!(response.status(),StatusCode::UNPROCESSABLE_ENTITY);
    let (code,v)=call(&app,"GET",&path,json!(null)).await;
    assert_eq!(code,StatusCode::OK);assert_eq!(v["status"]["phase"],"paused");
}

// Protects the default authenticated production router's global tool intent.
// Oracle: enable is explicit and idempotent across projects, never a path target,
// revision rewrite, implicit installation or runner-configuration mutation.
#[tokio::test]
async fn external_tools_host_api_is_global_and_rejects_paths(){
    // Detection and new update checks must not consult the developer's tool
    // installations or network. Isolate HOME in a child, as installer tests do.
    const CHILD:&str="DECK_TOOL_API_FIXTURE";
    if std::env::var_os(CHILD).is_none(){
        let dir=tempfile::tempdir().unwrap();
        let out=std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact","server::project_settings_tests::external_tools_host_api_is_global_and_rejects_paths","--nocapture","--test-threads=1"])
            .env(CHILD,"1").env("HOME",dir.path()).output().unwrap();
        assert!(out.status.success(),"{}{}",String::from_utf8_lossy(&out.stdout),String::from_utf8_lossy(&out.stderr));
        assert!(String::from_utf8_lossy(&out.stdout).contains("1 passed"));return;
    }
    let (_d,app,pb)=fixture();
    let revisions={let s=app.store.lock().unwrap();(s.configuration_for(&app.project).unwrap().revision,s.configuration_for(&pb.root).unwrap().revision)};
    for enabled in [true,true,false]{
        let (code,value)=call(&app,"POST","/api/tools/rtk",json!({"api":API,"action":"enable","enabled":enabled})).await;
        assert_eq!(code,StatusCode::OK,"{value}");
        assert_eq!(value["tools"].as_array().unwrap().iter().find(|t|t["id"]=="rtk").unwrap()["enabled"],enabled);
        assert_eq!(app.store.lock().unwrap().external_settings().unwrap().rtk,enabled);
    }
    let response=router(app.clone()).oneshot(axum::http::Request::builder().method("POST").uri("/api/tools/rtk").header("host",&app.host).header("origin",format!("http://{}",app.host)).header("cookie",format!("{}={}",app.cookie_name,app.cookie)).header("content-type","application/json").body(Body::from(json!({"api":API,"action":"enable","enabled":true,"path":"/arbitrary"}).to_string())).unwrap()).await.unwrap();
    assert_eq!(response.status(),StatusCode::UNPROCESSABLE_ENTITY);
    let s=app.store.lock().unwrap();assert!(!s.external_settings().unwrap().rtk);
    assert_eq!((s.configuration_for(&app.project).unwrap().revision,s.configuration_for(&pb.root).unwrap().revision),revisions);
}

// Protects the authenticated runner integration route and fixed upstream commands.
// Oracle: decision 19; no client path/arguments, no other runner, no silent success.
#[tokio::test]
async fn external_tools_rtk_runner_roundtrip() {
    use std::os::unix::fs::PermissionsExt;
    const CHILD:&str="DECK_RTK_RUNNER_TEST";
    if std::env::var_os(CHILD).is_none(){
        let d=tempfile::tempdir().unwrap();
        let output=std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact","server::project_settings_tests::external_tools_rtk_runner_roundtrip","--nocapture","--test-threads=1"])
            .env(CHILD,"1").env("HOME",d.path()).env("CODEX_HOME",d.path().join("custom-codex")).output().unwrap();
        assert!(output.status.success(),"{}{}",String::from_utf8_lossy(&output.stdout),String::from_utf8_lossy(&output.stderr));return;
    }
    let (_d,app,_)=fixture();
    let h=std::path::PathBuf::from(std::env::var_os("HOME").unwrap());
    let (code,v)=call(&app,"POST","/api/tools/rtk/runners/codex",json!({"api":API,"action":"install"})).await;
    assert_eq!(code,StatusCode::CONFLICT,"{v}");
    let exe=h.join(".local/bin/rtk");std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
    std::fs::create_dir(h.join("custom-codex")).unwrap();
    std::fs::write(&exe,r#"#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$HOME/commands"
case "$*" in
'--version') echo 'rtk 1.2.0';;
'init -g --codex --show')
 if [ -f "$CODEX_HOME/RTK.md" ]; then mark=ok; else mark=--; fi
 printf '[%s] Global RTK.md: fixture\n[%s] Global hook: fixture\n[%s] Global AGENTS.md: fixture\n' "$mark" "$mark" "$mark";;
'init -g --codex')
 printf '%s\n' '<!-- rtk-owned: written by `rtk init --codex`, removed by `rtk init --codex --uninstall` -->' > "$CODEX_HOME/RTK.md"
 printf '@%s/RTK.md\n' "$CODEX_HOME" > "$CODEX_HOME/AGENTS.md"
 printf '%s\n' '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"rtk hook codex"}]}]}}' > "$CODEX_HOME/hooks.json";;
'init -g --codex --uninstall')
 rm "$CODEX_HOME/RTK.md" "$CODEX_HOME/AGENTS.md" "$CODEX_HOME/hooks.json";;
*) exit 44;;
esac
"#).unwrap();std::fs::set_permissions(&exe,std::fs::Permissions::from_mode(0o755)).unwrap();
    for (action,state) in [("install","installed"),("remove","not_installed")]{
        let (code,v)=call(&app,"POST","/api/tools/rtk/runners/codex",json!({"api":API,"action":action})).await;
        assert_eq!(code,StatusCode::OK,"{v}");assert_eq!(v["runner"]["state"],state);
        assert_eq!(v["changes"].as_array().unwrap().len(),3);
        if action=="install" {
            // Runner artifacts remain installed even if the RTK binary disappears.
            let offline=exe.with_extension("offline");std::fs::rename(&exe,&offline).unwrap();
            let (code,status)=call(&app,"GET","/api/tools",json!(null)).await;assert_eq!(code,StatusCode::OK);
            let rtk=status["tools"].as_array().unwrap().iter().find(|t|t["id"]=="rtk").unwrap();
            assert_eq!(rtk["installed"],false);assert_eq!(rtk["runners"][0]["state"],"installed");
            std::fs::rename(offline,&exe).unwrap();
        }
    }
    for body in [json!({"api":API,"action":"install","path":"/escape"}),json!({"api":API,"action":"install","args":["--gemini"]})]{
        let(code,_)=call(&app,"POST","/api/tools/rtk/runners/codex",body).await;assert_eq!(code,StatusCode::UNPROCESSABLE_ENTITY);
    }
    let(code,_)=call(&app,"POST","/api/tools/rtk/runners/claude",json!({"api":API,"action":"install"})).await;assert_eq!(code,StatusCode::BAD_REQUEST);
    let(code,_)=call(&app,"POST","/api/tools/rtk/runners/codex",json!({"api":0,"action":"install"})).await;assert_eq!(code,StatusCode::BAD_REQUEST);
    let commands=std::fs::read_to_string(h.join("commands")).unwrap();
    assert!(commands.lines().all(|s|matches!(s,"--version"|"init -g --codex --show"|"init -g --codex"|"init -g --codex --uninstall")));
    assert!(!h.join(".codex").exists());assert!(!h.join(".claude").exists());assert!(!h.join(".bashrc").exists());
    // Exit zero is insufficient: no RTK markers after install must fail verification.
    std::fs::write(&exe,"#!/bin/sh\nexit 0\n").unwrap();
    let(code,v)=call(&app,"POST","/api/tools/rtk/runners/codex",json!({"api":API,"action":"install"})).await;
    assert_eq!(code,StatusCode::CONFLICT,"{v}");
}
