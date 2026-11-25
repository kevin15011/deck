use super::*;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use deck2_shared::{API, DecisionState};
use std::os::unix::fs::{PermissionsExt, symlink};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};
use tower::ServiceExt;

const HOST: &str = "127.0.0.1:32127";
const SESSION: &str = "agy-fixture-session";
const TEST: &str = "agy::tests::agy_acp_normal_entrypoint_and_restart";
const FIXTURE_JWT: &str = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.K8Avp1Dsj9f1";

struct Browser {
    router: Router,
    cookie: String,
}

impl Browser {
    async fn open(host: &App) -> Self {
        let router = crate::server::router(host.clone());
        let response = router
            .clone()
            .oneshot(
                Request::post("/auth")
                    .header(header::HOST, HOST)
                    .header(header::ORIGIN, format!("http://{HOST}"))
                    .body(Body::from(host.issue_launch()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let cookie = response.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned();
        Self { router, cookie }
    }

    async fn response(&self, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
        let response = self
            .router
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header(header::HOST, HOST)
                    .header(header::ORIGIN, format!("http://{HOST}"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::COOKIE, &self.cookie)
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    async fn request(&self, method: &str, path: &str, body: Value) -> Value {
        let (status, body) = self.response(method, path, body).await;
        assert!(status.is_success(), "{path}: {status} {body}");
        body
    }

    async fn send(&self, id: &str, prompt: &str, queue: bool) {
        self.request("POST", "/api/commands", json!({
            "api":API, "id":id, "session":SESSION, "mode":"session_v1", "prompt":prompt, "queue":queue,
        })).await;
    }
}

fn fixture() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path();
    for (name, contents) in [
        ("agy", include_str!("../tests/fake_agy_acp.py")),
        ("codex", include_str!("../tests/fake_session_native.py")),
    ] {
        let binary = path.join(name);
        std::fs::write(&binary, contents).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    std::fs::create_dir(path.join("project")).unwrap();
    symlink(path, path.join("project/outside-link")).unwrap();
    dir
}

fn subprocess(dir: &Path, action: &str) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", TEST, "--nocapture"])
        .env_clear()
        .env("PATH", format!("{}:/usr/bin", dir.display()))
        .env("HOME", dir)
        .env("TMPDIR", "/dev/shm")
        .env("DECK2_AGY_FIXTURE", dir)
        .env("DECK2_AGY_CASE", action)
        .kill_on_drop(true);
    command
}

async fn run_case(dir: &Path, action: &str) {
    let result = timeout(Duration::from_secs(15), subprocess(dir, action).output())
        .await
        .unwrap()
        .unwrap();
    assert!(
        result.status.success(),
        "{action}: {}\n{}\n{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr),
        std::fs::read_to_string(dir.join("fixture-errors")).unwrap_or_default(),
        member_errors(dir),
    );
}

fn member_errors(dir: &Path) -> String {
    std::fs::read_dir(dir.join(".local/share/deck2-managed-v1/agy-members"))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            std::fs::read_to_string(entry.path().join("profile/member-errors")).ok()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn host(dir: &Path) -> App {
    let project = dir.join("project");
    let binary = dir.join("codex");
    let mut store = Store::open(&dir.join("state.db"), project.to_str().unwrap()).unwrap();
    store.register_codex(file_digest(&binary).unwrap()).unwrap();
    let host = App::new(
        store,
        HOST.into(),
        binary,
        None,
        "admin".into(),
        "recover".into(),
    );
    *host.scope_root.lock().unwrap() = Some(dir.join("scopes"));
    host
}

async fn wait<T>(mut check: impl FnMut() -> Option<T>) -> T {
    timeout(Duration::from_secs(8), async {
        loop {
            if let Some(result) = check() {
                return result;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("Antigravity fixture did not settle")
}

async fn receipt(host: &App, id: &str, predicate: impl Fn(&Receipt) -> bool) -> Receipt {
    wait(|| {
        let row = host.receipt(id).unwrap();
        if predicate(&row) {
            return Some(row);
        }
        assert!(
            !matches!(
                row.phase,
                Phase::Completed | Phase::Cancelled | Phase::Failed
            ),
            "{id}: {:?}: {}",
            row.phase,
            row.detail
        );
        None
    })
    .await
}

fn wire(dir: &Path, kind: &str) -> Vec<Value> {
    std::fs::read_to_string(dir.join("agy-wire"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|line| line[0] == kind)
        .map(|line| line[1].clone())
        .collect()
}

// Exercises the same browser, scheduler, executable admission, stdio transport and
// restart path used by an installed host, with external calls confined to fixtures.
#[tokio::test]
async fn agy_acp_normal_entrypoint_and_restart() {
    let Some(dir) = std::env::var_os("DECK2_AGY_FIXTURE").map(PathBuf::from) else {
        let normal = fixture();
        run_case(normal.path(), "normal").await;
        let quota = fixture();
        run_case(quota.path(), "quota").await;
        let phase2 = fixture();
        run_case(phase2.path(), "phase2").await;
        let restart = fixture();
        let mut crashed = subprocess(restart.path(), "crash")
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let mut lines = BufReader::new(crashed.stdout.take().unwrap()).lines();
        timeout(Duration::from_secs(15), async {
            loop {
                let line = lines
                    .next_line()
                    .await
                    .unwrap()
                    .expect("Fixture exited before recording queued work");
                if line == "Antigravity ready to simulate host loss" {
                    break;
                }
            }
        })
        .await
        .unwrap();
        crashed.kill().await.unwrap();
        run_case(restart.path(), "restart").await;
        let untrusted = fixture();
        run_case(untrusted.path(), "untrusted").await;
        let signed_out = fixture();
        std::fs::write(signed_out.path().join("signed-out"), "").unwrap();
        run_case(signed_out.path(), "signed-out").await;
        let missing = fixture();
        std::fs::remove_file(missing.path().join("agy")).unwrap();
        run_case(missing.path(), "missing").await;
        return;
    };
    let action = std::env::var("DECK2_AGY_CASE").unwrap();
    let host = host(&dir);
    if action == "restart" {
        let previous = host.receipt("interrupted").unwrap();
        assert_eq!(previous.phase, Phase::Uncertain);
        assert_eq!(previous.text, "Partial");
        assert_eq!(host.receipt("agy-next").unwrap().phase, Phase::Queued);
        host.pump_queue();
        assert_eq!(host.receipt("interrupted").unwrap().phase, Phase::Uncertain);
        assert_eq!(host.receipt("agy-next").unwrap().phase, Phase::Queued);
        assert_eq!(previous.decisions[0].state, DecisionState::Invalidated);
        std::fs::remove_file(dir.join("hold-group")).unwrap();
        let done = receipt(&host, "agy-next", |r| r.phase == Phase::Completed).await;
        assert_eq!(done.thread, previous.thread);
        assert_eq!(host.receipt("interrupted").unwrap().phase, Phase::Failed);
        assert_eq!(wire(&dir, "prompt"), [json!("crash"), json!("queued")]);
        return;
    }

    host.store
        .lock()
        .unwrap()
        .select_project_folder_with_trust(&host.project, action != "untrusted")
        .unwrap();
    let browser = Browser::open(&host).await;
    let ready = browser
        .request("GET", "/api/runners/agy/readiness", Value::Null)
        .await;
    if action == "signed-out" {
        assert_eq!(ready["reasonCode"], "agy_signed_out");
        assert!(!ready.to_string().contains("PRIVATE_TEST_ID"));
        return;
    }
    if action == "missing" {
        assert_eq!(ready["reasonCode"], "agy_not_installed");
        assert_eq!(ready["available"], false);
        return;
    }
    assert_eq!(ready["version"], "1.5.16");
    assert!(!ready.to_string().contains("PRIVATE_TEST_TIER"));
    let catalog = browser
        .request("GET", "/api/sessions/models", Value::Null)
        .await;
    let agy = catalog["runners"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["runnerId"] == "agy")
        .unwrap();
    assert_eq!(
        agy["models"],
        json!([
            {"modelId":"gemini-3.8-flash","label":"Gemini Flash","thinkingLevels":["low","high"]},
            {"modelId":"orchestrator","label":"Orchestrator","thinkingLevels":[]},
        ])
    );
    assert_eq!(wire(&dir, "probe"), [Value::Null]);
    assert_eq!(wire(&dir, "close"), [json!("native-agy-fixture")]);

    let model = json!({"runnerId":"agy","modelId":"gemini-3.8-flash"});
    browser
        .request(
            "POST",
            "/api/sessions",
            json!({
                "api":API, "id":SESSION, "title":"Antigravity fixture", "members":{"lead":model},
            }),
        )
        .await;
    let assignments = format!("/api/sessions/{SESSION}/assignments");
    let thinking = json!({"runnerId":"agy","modelId":"gemini-3.8-flash","thinking":"low"});
    let saved = browser
        .request(
            "POST",
            &assignments,
            json!({
                "api":API, "memberId":"lead", "expectedRevision":1, "assignment":thinking,
            }),
        )
        .await;
    assert_eq!(saved["contract"]["members"]["lead"], thinking);
    if action == "phase2" {
        exercise_phase2(&dir, &host, &browser, &assignments, &thinking).await;
        return;
    }
    if action == "quota" {
        // Keep the fake status-line process alive while the next Lead runs.
        let quota = |state: Value| state["runners"]["agy"].clone();
        let initial = quota(browser.request("GET", "/api/quota", Value::Null).await);
        assert!(initial["snapshot"].is_null());
        std::fs::write(dir.join("hold-turn"), "").unwrap();
        std::fs::write(dir.join("hold-quota"), "").unwrap();
        browser.send("quota-first", "quota-first", false).await;
        receipt(&host, "quota-first", |r| r.text == "Quota fixture ready").await;
        browser.send("quota-queued", "queued", true).await;
        assert_eq!(host.receipt("quota-queued").unwrap().phase, Phase::Queued);
        std::fs::remove_file(dir.join("hold-turn")).unwrap();
        receipt(&host, "quota-first", |r| r.phase == Phase::Completed).await;
        wait(|| (!wire(&dir, "quota").is_empty()).then_some(())).await;
        assert_eq!(
            quota(browser.request("GET", "/api/quota", Value::Null).await)["refreshing"],
            true
        );
        assert_eq!(
            browser
                .response("POST", "/api/quota/agy/refresh", json!({}))
                .await
                .0,
            StatusCode::CONFLICT
        );
        receipt(&host, "quota-queued", |r| r.phase == Phase::Completed).await;
        browser.send("quota-during", "resumed", true).await;
        receipt(&host, "quota-during", |r| r.phase == Phase::Completed).await;
        assert_eq!(wire(&dir, "quota"), [Value::Null]);
        wait(|| {
            let active = host.active.lock().unwrap();
            (active.len() == 1 && active.contains_key(crate::quota::AGY_REFRESH_KEY)).then_some(())
        })
        .await;
        let workspace = browser.request("GET", "/api/workspace", Value::Null).await;
        assert_eq!(workspace["process_active"], false);

        std::fs::remove_file(dir.join("hold-quota")).unwrap();
        wait(|| {
            (!host
                .active
                .lock()
                .unwrap()
                .contains_key(crate::quota::AGY_REFRESH_KEY))
            .then_some(())
        })
        .await;
        let refreshed = quota(browser.request("GET", "/api/quota", Value::Null).await);
        assert_eq!(
            refreshed["snapshot"]["windows"].as_array().unwrap().len(),
            2
        );
        assert_eq!(refreshed["snapshot"]["windows"][0]["usedPercent"], 8.0);
        browser.send("quota-cooldown", "resumed", false).await;
        receipt(&host, "quota-cooldown", |r| r.phase == Phase::Completed).await;
        wait(|| (!host.active.lock().unwrap().contains_key("quota-cooldown")).then_some(())).await;
        assert_eq!(wire(&dir, "quota"), [Value::Null]);
        return;
    }

    if action == "untrusted" {
        // Protects the trust gate. Fails if YOLO approves a native command
        // automatically or starts an untrusted project without its sandbox.
        host.store
            .lock()
            .unwrap()
            .set_approvals(SESSION, "yolo")
            .unwrap();
        browser.send("agy-untrusted", "untrusted-yolo", false).await;
        let denied = receipt(&host, "agy-untrusted", |r| r.phase == Phase::Completed).await;
        assert!(denied.decisions.is_empty());
        return;
    }
    if action == "crash" {
        browser.send("interrupted", "crash", false).await;
        receipt(&host, "interrupted", |r| {
            r.text == "Partial" && !r.decisions.is_empty()
        })
        .await;
        browser.send("agy-next", "queued", true).await;
        assert_eq!(host.receipt("agy-next").unwrap().phase, Phase::Queued);
        println!("Antigravity ready to simulate host loss");
        std::future::pending::<()>().await;
        return;
    }
    if action.starts_with("replay-") || action.starts_with("revision-") || action == "token-review"
    {
        run_permission_regression(&dir, &host, &browser, &assignments, &action).await;
        return;
    }

    browser.send("agy-first", "permission", false).await;
    let reviewing = receipt(&host, "agy-first", |r| !r.decisions.is_empty()).await;
    assert_eq!(reviewing.text, "Starting ");
    assert_eq!(reviewing.decisions.len(), 1);
    let decision = &reviewing.decisions[0];
    assert_eq!(decision.state, DecisionState::Pending);
    assert_eq!(decision.native.as_ref().unwrap().method, approval::METHOD);
    browser
        .request(
            "POST",
            &format!("/api/decisions/{}/responses", decision.id),
            json!({
                "api":API, "command_id":"review-shell", "expected_revision":decision.revision,
                "response":{"type":"allow_once"},
            }),
        )
        .await;
    let first = receipt(&host, "agy-first", |r| r.phase == Phase::Completed).await;
    assert_eq!(first.text, "Starting \n\nfinished");
    assert_eq!(
        first
            .message_times
            .iter()
            .map(|m| m.kind)
            .collect::<Vec<_>>(),
        vec![
            Some(deck2_shared::MessageKind::Progress),
            Some(deck2_shared::MessageKind::Answer)
        ]
    );
    assert_eq!(first.decisions[0].state, DecisionState::Delivered);
    let activities = browser
        .request(
            "GET",
            &format!("/api/sessions/{SESSION}/activity"),
            Value::Null,
        )
        .await;
    assert!(
        activities.to_string().contains(&format!(
            "mcp_{}_deck_task_list",
            wire(&dir, "deck-server")[0].as_str().unwrap()
        )),
        "{activities}"
    );
    let context = host
        .store
        .lock()
        .unwrap()
        .session_by_id(SESSION)
        .unwrap()
        .native
        .unwrap();
    assert_eq!(context.runner, Some(NativeRunner::Agy));

    browser.send("agy-second", "resumed", false).await;
    let second = receipt(&host, "agy-second", |r| r.phase == Phase::Completed).await;
    assert_eq!(first.thread, second.thread);
    assert_ne!(first.native_pid, second.native_pid);
    assert_eq!(wire(&dir, "session/new").len(), 1);
    assert_eq!(wire(&dir, "session/resume").len(), 1);
    let servers = wire(&dir, "deck-server");
    assert_eq!(servers.len(), 2);
    assert_ne!(servers[0], servers[1]);
    assert!(second.context.observation.is_none());

    browser.send("agy-review", "review", false).await;
    let project_path = dir.join("project/src/lib.rs");
    for request in [
        "url-path",
        "url-query",
        "url-include",
        "project-path",
        "capability-fetch",
        "outside-shell",
        "linked-shell",
    ] {
        let reviewing = receipt(&host, "agy-review", |r| {
            r.decisions
                .iter()
                .any(|decision| decision.request == request)
        })
        .await;
        let decision = reviewing
            .decisions
            .iter()
            .find(|d| d.request == request)
            .unwrap();
        let expected_public_field = match request {
            "url-query" | "capability-fetch" => {
                // Model an older build that stored raw approval data. Protects
                // public receipt and response projections when history is unsafe.
                let store = host.store.lock().unwrap();
                let mut receipt = store.get("agy-review").unwrap().unwrap();
                let native = receipt
                    .decisions
                    .iter_mut()
                    .find(|d| d.id == decision.id)
                    .unwrap()
                    .native
                    .as_mut()
                    .unwrap();
                let mut params: Value = serde_json::from_str(&native.parameters).unwrap();
                params["input"] = if request == "capability-fetch" {
                    json!({
                        "Url":"https://old-user:legacy-approval-secret@example.invalid:8443/legacy-approval-secret?token=legacy-approval-secret",
                        "Headers":{"Authorization":"legacy-approval-secret"}
                    })
                } else {
                    json!({
                        "SearchPath":dir.join("project/src//./lib.rs"),
                        "Query":"https%3A%2F%2Fhost%2Flegacy-approval-secret",
                        "Includes":["src//lib.rs","//host/legacy-approval-secret"]
                    })
                };
                native.parameters = params.to_string();
                native.summary = "legacy-approval-secret".into();
                store
                    .conn
                    .execute(
                        "UPDATE receipts SET body=?1 WHERE id=?2",
                        [serde_json::to_string(&receipt).unwrap(), receipt.id],
                    )
                    .unwrap();
                if request == "capability-fetch" {
                    Some(("Url", json!("https://example.invalid:8443/…")))
                } else {
                    Some(("SearchPath", json!(project_path)))
                }
            }
            "url-include" => Some(("Query", json!("needle (café|文字)"))),
            "project-path" => Some(("Path", json!("src/lib.rs"))),
            _ => None,
        };

        let state = browser.request("GET", "/api/workspace", Value::Null).await;
        let workspace_receipt = state["receipts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == "agy-review")
            .unwrap();
        let retry = browser.request("POST", "/api/commands", json!({
            "api":API,"id":"agy-review","session":SESSION,"mode":"session_v1","prompt":"review",
        })).await;
        let disposition = if request.ends_with("-shell") {
            "deny"
        } else {
            "allow_once"
        };
        let response = browser
            .request(
                "POST",
                &format!("/api/decisions/{}/responses", decision.id),
                json!({
                    "api":API, "command_id":format!("review-{request}"), "expected_revision":decision.revision,
                    "response":{"type":disposition},
                }),
            )
            .await;
        for presented in [workspace_receipt, &retry]
            .into_iter()
            .map(|value| {
                value["decisions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|d| d["id"] == decision.id)
                    .unwrap()
            })
            .chain(std::iter::once(&response))
        {
            assert!(presented.get("native").is_none());
            for secret in [
                "legacy-approval-secret",
                "fixture-private-",
                "6fa29b375c048da71bf34e8f",
            ] {
                assert!(!presented.to_string().contains(secret));
            }
            let input = &presented["presentation"]["details"]["input"];
            if let Some((field, expected)) = &expected_public_field {
                assert_eq!(input[*field], *expected);
            }
            if request == "url-include" {
                assert_eq!(input["SearchPath"], json!(project_path));
                assert_eq!(input["Includes"][1], "src/lib.rs");
            }
        }
    }
    let reviewed = receipt(&host, "agy-review", |r| r.phase == Phase::Completed).await;
    assert_eq!(reviewed.decisions.len(), 7);
    assert!(
        reviewed
            .decisions
            .iter()
            .all(|d| d.state == DecisionState::Delivered)
    );

    // Protects faithful Allow once delivery. Fails if the runner drops or
    // rewrites any original ACP argument before using it after approval.
    assert_eq!(
        wire(&dir, "read-search-target"),
        [
            json!({"Path":"https%3A%2F%2Fexample.invalid%2Ffixture-private-read-path"}),
            json!({"Query":"prefix HtTpS://example.invalid/hooks/fixture-private-query"}),
            json!({
                "SearchPath":format!("{}/project/src//./lib.rs", dir.display()),
                "Query":"needle (café|文字)",
                "Includes":["*.txt","src//lib.rs","//example.invalid/fixture-private-include",
                    "data:text/plain,fixture-private-data",
                    "https://user:fixture-private-userinfo@example.invalid/hook"]
            }),
            json!({"Path":"src//lib.rs"}),
        ]
    );
    assert_eq!(
        wire(&dir, "fetch-target"),
        [json!(
            "https://example.invalid/hooks/6fa29b375c048da71bf34e8f"
        )]
    );
    let mut db = std::fs::read(dir.join("state.db")).unwrap();
    if let Ok(wal) = std::fs::read(dir.join("state.db-wal")) {
        db.extend(wal);
    }
    // Protects credential-safe tool review. Fails if a fetch header or path,
    // read path, search query or search include credential reaches SQLite/WAL.
    for secret in [
        "AGY_FIXTURE_PLANTED_VALUE",
        "6fa29b375c048da71bf34e8f",
        "fixture-private-read-path",
        "fixture-private-query",
        "fixture-private-include",
        "fixture-private-data",
        "fixture-private-userinfo",
    ] {
        assert!(
            !db.windows(secret.len())
                .any(|bytes| bytes == secret.as_bytes()),
            "tool credential reached SQLite or its WAL"
        );
    }
    // Protects trusted Lead YOLO parity. Fails if an outside-project
    // command opens a Decision or still runs under ACP terminal restrictions.
    host.store
        .lock()
        .unwrap()
        .set_approvals(SESSION, "yolo")
        .unwrap();
    browser.send("agy-yolo", "yolo", false).await;
    let yolo = receipt(&host, "agy-yolo", |r| r.phase == Phase::Completed).await;
    assert!(yolo.decisions.is_empty());
    assert!(dir.join("outside.txt").is_file());
    host.store
        .lock()
        .unwrap()
        .set_approvals(SESSION, "relay")
        .unwrap();

    browser.send("agy-stop", "hold", false).await;
    let running = receipt(&host, "agy-stop", |r| r.text == "Partial").await;
    browser.send("after-stop", "queued", true).await;
    assert_eq!(host.receipt("after-stop").unwrap().phase, Phase::Queued);
    browser
        .request("POST", "/api/commands/agy-stop/cancel", Value::Null)
        .await;
    let stopped = receipt(&host, "agy-stop", |r| r.phase == Phase::Cancelled).await;
    assert_eq!(stopped.text, "Partial");
    assert_eq!(wire(&dir, "cancel"), [json!("native-agy-fixture")]);
    assert!(crate::claude::process_group_stopped(
        running.native_pid.unwrap() as i32
    ));
    receipt(&host, "after-stop", |r| r.phase == Phase::Completed).await;
    assert_eq!(
        wire(&dir, "prompt")
            .iter()
            .filter(|prompt| **prompt == "queued")
            .count(),
        1
    );

    browser
        .request(
            "POST",
            &assignments,
            json!({
                "api":API, "memberId":"investigate", "expectedRevision":2,
                "assignment":{"runnerId":"codex","modelId":"gpt-6.1-sol"},
            }),
        )
        .await;
    browser.send("agy-root", "delegate", false).await;
    receipt(&host, "agy-root", |r| r.phase == Phase::Completed).await;
    let continued = wait(|| {
        host.store
            .lock()
            .unwrap()
            .all()
            .unwrap()
            .into_iter()
            .find(|r| {
                r.continuation.is_some() && matches!(r.phase, Phase::Completed | Phase::Failed)
            })
    })
    .await;
    assert_eq!(continued.phase, Phase::Completed, "{}", continued.detail);
    assert_eq!(continued.thread, first.thread);
    let store = host.store.lock().unwrap();
    let tasks = store.tasks().unwrap();
    let member = tasks
        .iter()
        .find(|task| task.owner == "investigate")
        .unwrap();
    assert_eq!(member.attempts[0].phase, Phase::Completed);
}

#[tokio::test]
async fn agy_permission_replay() {
    // Protects one-time permission admission. Fails if either ACP identity
    // can be replayed after a native allow, or if a duplicate can select a
    // permission option on a still-pending wire request.
    for action in ["replay-yolo", "replay-relay"] {
        run_case(fixture().path(), action).await;
    }
}

#[tokio::test]
async fn agy_permission_revision() {
    // Protects the admitted contract revision. Fails if reassigning a
    // member preserves native auto-allow or releases an existing review.
    for action in ["revision-relay", "revision-yolo"] {
        run_case(fixture().path(), action).await;
    }
}

#[tokio::test]
async fn agy_permission_query_credentials() {
    // Protects persistent and public approval projections. Fails if the
    // active bearer or a JWT reaches a new record, WAL, or a legacy response.
    run_case(fixture().path(), "token-review").await;
}

async fn run_permission_regression(
    dir: &Path,
    host: &App,
    browser: &Browser,
    assignments: &str,
    action: &str,
) {
    if action.ends_with("-yolo") {
        host.store
            .lock()
            .unwrap()
            .set_approvals(SESSION, "yolo")
            .unwrap();
    }
    browser.send("agy-regression", action, false).await;
    let mut expected_decisions = if action == "replay-relay" { 2 } else { 0 };
    if action.starts_with("revision-") {
        let running = receipt(host, "agy-regression", |r| {
            r.text == "Waiting for reassignment"
                && (action.ends_with("-yolo") || !r.decisions.is_empty())
        })
        .await;
        let assignment = json!({"runnerId":"codex","modelId":"gpt-6.1-sol"});
        if let Some(decision) = running.decisions.first() {
            expected_decisions = 1;
            // Persist reassignment and the user's response before the ACP
            // worker can inspect either change.
            let mut store = host.store.lock().unwrap();
            let updated = store
                .assign_member(
                    SESSION,
                    "investigate",
                    serde_json::from_value(assignment).unwrap(),
                    2,
                )
                .unwrap();
            assert_eq!(updated.contract.unwrap().revision, 3);
            store
                .resolve(
                    &decision.id,
                    &deck2_shared::Resolve {
                        api: API,
                        command_id: "stale-review".into(),
                        expected_revision: decision.revision,
                        response: deck2_shared::DecisionResponse::AllowOnce,
                    },
                )
                .unwrap();
        } else {
            let updated = browser.request("POST", assignments, json!({
                "api":API, "memberId":"investigate", "expectedRevision":2, "assignment":assignment,
            })).await;
            assert_eq!(updated["contract"]["revision"], 3);
        }
        std::fs::write(dir.join("member-reassigned"), "").unwrap();
    }
    if action == "token-review" {
        expected_decisions = 3;
        let mut leaked = Vec::new();
        for (index, request) in ["opaque-hex", "opaque-jwt", "ordinary"]
            .into_iter()
            .enumerate()
        {
            let running = receipt(host, "agy-regression", |r| r.decisions.len() > index).await;
            let decision = &running.decisions[index];
            assert_eq!(decision.request, request);
            let safe = &decision.native.as_ref().unwrap().parameters;
            let secret = match request {
                "opaque-hex" => std::fs::read_to_string(dir.join("fixture-bearer")).unwrap(),
                "opaque-jwt" => FIXTURE_JWT.into(),
                _ => String::new(),
            };
            if !secret.is_empty() {
                let mut db = std::fs::read(dir.join("state.db")).unwrap();
                db.extend(std::fs::read(dir.join("state.db-wal")).unwrap());
                let workspace = browser.request("GET", "/api/workspace", Value::Null).await;
                let leak = safe.contains(&secret)
                    || workspace.to_string().contains(&secret)
                    || db
                        .windows(secret.len())
                        .any(|bytes| bytes == secret.as_bytes());
                if leak {
                    leaked.push((request, "new approval"));
                }
                {
                    let store = host.store.lock().unwrap();
                    let mut legacy = store.get("agy-regression").unwrap().unwrap();
                    let native = legacy.decisions[index].native.as_mut().unwrap();
                    let mut parameters: Value = serde_json::from_str(&native.parameters).unwrap();
                    parameters["input"]["Query"] = json!(secret);
                    native.parameters = parameters.to_string();
                    store
                        .conn
                        .execute(
                            "UPDATE receipts SET body=?1 WHERE id=?2",
                            [serde_json::to_string(&legacy).unwrap(), legacy.id],
                        )
                        .unwrap();
                }
            }
            let response = browser
                .request(
                    "POST",
                    &format!("/api/decisions/{}/responses", decision.id),
                    json!({
                        "api":API, "command_id":format!("regression-{request}"),
                        "expected_revision":decision.revision, "response":{"type":"allow_once"},
                    }),
                )
                .await;
            if secret.is_empty() {
                assert_eq!(
                    response["presentation"]["details"]["input"]["Query"],
                    "find (café|文字)"
                );
            } else if response.to_string().contains(&secret) {
                leaked.push((request, "legacy response"));
            }
        }
        assert!(leaked.is_empty(), "credential leaked: {leaked:?}");
    }
    let done = receipt(host, "agy-regression", |r| !r.phase.active()).await;
    assert_eq!(
        done.phase,
        Phase::Completed,
        "{:?}",
        wire(dir, "permission-outcome")
    );
    assert_eq!(done.decisions.len(), expected_decisions);
    match action {
        "replay-yolo" | "replay-relay" => {
            let mut expected = vec![
                json!(["first", true]),
                json!(["first", false]),
                json!(["second", true]),
                json!(["new-wire", false]),
            ];
            if action == "replay-relay" {
                // The withdrawn pending review is answered before its duplicate.
                expected.push(json!(["pending-item", false]));
                expected.push(json!(["reuse-item", false]));
                expected.push(json!(["ambiguous", false]));
                assert!(
                    done.decisions
                        .iter()
                        .all(|decision| decision.state == DecisionState::Invalidated)
                );
            }
            assert_eq!(wire(dir, "permission-outcome"), expected);
        }
        "revision-yolo" => assert_eq!(
            wire(dir, "permission-outcome"),
            [json!(["after-reassignment", false])]
        ),
        "revision-relay" => assert_eq!(
            wire(dir, "permission-outcome"),
            [
                json!(["pending-review", false]),
                json!(["after-reassignment", false])
            ]
        ),
        _ => {}
    }
    if action == "revision-relay" {
        assert_eq!(done.decisions[0].state, DecisionState::Invalidated);
        assert!(!done.decisions[0].grant_consumed);
    }
}

#[tokio::test]
async fn agy_dropped_probe_reaps_process_group() {
    let dir = fixture();
    std::fs::write(dir.path().join("hold-probe"), "").unwrap();
    std::fs::write(dir.path().join("agy-wire"), "").unwrap();
    let binary = dir.path().join("agy");
    let fault = std::sync::Arc::new(crate::native::ProbeCleanupFault {
        unsettled: true.into(),
        reached: Default::default(),
        pause: false,
        help_only: false,
    });
    let probe = tokio::spawn(
        crate::native::PROBE_CLEANUP_FAULT.scope(fault.clone(), async move {
            crate::agy_readiness::probe(&binary).await
        }),
    );
    let pids = timeout(Duration::from_secs(5), async {
        loop {
            if let Some(record) = wire(dir.path(), "probe-group").first() {
                break [record[0].as_i64().unwrap(), record[1].as_i64().unwrap()];
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    probe.abort();
    assert!(probe.await.unwrap_err().is_cancelled());
    timeout(Duration::from_secs(3), fault.reached.notified())
        .await
        .expect("cancelled observer left no reaper to retry settlement");
    std::fs::remove_file(dir.path().join("hold-probe")).unwrap();
    let binary = dir.path().join("agy");
    let next_probe = crate::agy_readiness::probe(&binary);
    tokio::pin!(next_probe);
    assert!(
        timeout(Duration::from_millis(150), &mut next_probe)
            .await
            .is_err(),
        "another probe overtook process-group settlement"
    );
    fault.unsettled.store(false, Ordering::SeqCst);
    assert!(
        timeout(Duration::from_secs(3), next_probe)
            .await
            .unwrap()
            .is_ok()
    );

    let settled = timeout(Duration::from_secs(3), async {
        while pids
            .iter()
            .any(|pid| Path::new(&format!("/proc/{pid}")).exists())
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(unsafe { libc::kill(-(pids[0] as i32), 0) }, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
    })
    .await;
    if settled.is_err() {
        // Clean up the regression fixture even when the production reaper fails.
        let _ = crate::native::reap_group(pids[0] as u32).await;
    }
    settled.expect("cancelled readiness probe left an unreaped process");
}

// Uses the production HTTP/scheduler composition. The ACP process verifies the
// wire identities and attempts a direct write independently of permission replies.
async fn exercise_phase2(
    dir: &Path,
    host: &App,
    browser: &Browser,
    assignments: &str,
    thinking: &Value,
) {
    use base64::{Engine, engine::general_purpose::STANDARD};

    let tools = dir.join(".local/bin");
    std::fs::create_dir_all(&tools).unwrap();
    for tool in ["codebase-memory-mcp", "context7-mcp"] {
        let path = tools.join(tool);
        std::fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    std::fs::write(dir.join("project/member-input.txt"), "read fixture").unwrap();
    std::fs::write(dir.join("outside.txt"), "outside fixture").unwrap();
    std::fs::create_dir_all(dir.join(".gemini/antigravity-cli")).unwrap();
    std::fs::write(dir.join(".gemini/antigravity-cli/settings.json"), "{}").unwrap();
    let auth = dir.join(".gemini/antigravity-cli/antigravity-oauth-token");
    std::fs::write(&auth, "fixture account").unwrap();
    std::fs::set_permissions(&auth, std::fs::Permissions::from_mode(0o600)).unwrap();
    let image = {
        let bytes = STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==").unwrap();
        let store = host.store.lock().unwrap();
        store
            .conn
            .execute(
                "UPDATE meta SET value=?1 WHERE key='external_tools_v1'",
                [r#"{"codebase_memory":true,"context7":true,"rtk":false}"#],
            )
            .unwrap();
        store
            .upload_image(
                SESSION,
                "fixture-upload",
                crate::images::validate(&bytes).unwrap(),
                &bytes,
            )
            .unwrap()
    };

    let r = host
        .store
        .lock()
        .unwrap()
        .configuration_for(&host.project)
        .unwrap()
        .revision;
    let maintenance = json!({"api":API,"expected_revision":r,"target":"agy"});
    let installed = browser
        .request(
            "POST",
            "/api/runners/maintenance/inspect",
            maintenance.clone(),
        )
        .await;
    assert_eq!(installed["version"], "agy 1.5.16");
    assert_eq!(installed["ready"], true);
    let update = browser
        .request("POST", "/api/runners/maintenance", maintenance)
        .await;
    assert!(
        update["command"]
            .as_str()
            .unwrap()
            .ends_with("/agy' update")
    );
    assert_eq!(update["updated"], false);

    browser
        .request(
            "POST",
            "/api/commands",
            json!({
                "api":API,"id":"agy-image","session":SESSION,"mode":"session_v1",
                "prompt":"phase2-media","attachments":[image.id],
            }),
        )
        .await;
    let media = receipt(host, "agy-image", |r| r.phase == Phase::Completed).await;
    let usage = media.context.observation.unwrap();
    assert_eq!(
        (usage.basis.as_str(), usage.tokens, usage.capacity),
        ("agy-acp-usage", Some(42000), Some(105000))
    );
    assert_eq!(wire(dir, "image"), [json!(image.digest)]);
    assert!(media.decisions.is_empty());

    for (index, role) in [
        "investigate",
        "architect",
        "apply-fast",
        "apply-deep",
        "quality",
        "setup",
    ]
    .iter()
    .enumerate()
    {
        let saved = browser
            .request(
                "POST",
                assignments,
                json!({
                    "api":API,"memberId":role,"expectedRevision":index+2,"assignment":thinking,
                }),
            )
            .await;
        assert_eq!(saved["contract"]["members"][*role], *thinking);
    }
    browser
        .send("agy-team-ask", "phase2-delegate-readonly", false)
        .await;
    receipt(host, "agy-team-ask", |r| r.phase == Phase::Completed).await;
    wait(|| {
        let reports = host.store.lock().unwrap().tasks().unwrap();
        for task in &reports {
            let attempt = task.attempts.last().unwrap();
            assert_ne!(
                attempt.phase,
                Phase::Failed,
                "Ask-first {}: {}",
                task.owner,
                attempt.detail
            );
        }
        (reports.len() == 2
            && reports
                .iter()
                .all(|task| task.attempts[0].phase == Phase::Completed))
        .then_some(())
    })
    .await;

    host.store
        .lock()
        .unwrap()
        .set_approvals(SESSION, "yolo")
        .unwrap();
    browser.send("agy-team", "phase2-delegate", false).await;
    let lead = receipt(host, "agy-team", |r| r.phase == Phase::Completed).await;
    assert_ne!(
        lead.native_pid, media.native_pid,
        "changed modes or MCP scopes must retire the old process"
    );
    assert!(crate::claude::process_group_stopped(
        media.native_pid.unwrap() as i32
    ));
    let reports = wait(|| {
        let tasks = host
            .store
            .lock()
            .unwrap()
            .tasks()
            .unwrap()
            .into_iter()
            .filter(|task| task.root == "agy-team")
            .collect::<Vec<_>>();
        let done = tasks
            .iter()
            .filter(|t| matches!(t.owner.as_str(), "investigate" | "apply-fast" | "quality"))
            .map(|t| (&t.owner, &t.attempts[0]))
            .collect::<Vec<_>>();
        for (role, a) in &done {
            assert_ne!(a.phase, Phase::Failed, "{role}: {}", a.detail);
        }
        (done.len() == 3 && done.iter().all(|(_, a)| a.phase == Phase::Completed)).then_some(tasks)
    })
    .await;
    for task in &reports {
        let a = &task.attempts[0];
        assert_ne!(a.native_pid, lead.native_pid);
        assert!(crate::claude::process_group_stopped(
            a.native_pid.unwrap() as i32
        ));
        assert_eq!(a.report.as_ref().unwrap().text, "finished");
        assert_eq!(a.context.observation.as_ref().unwrap().tokens, Some(123));
    }
    wait(|| {
        host.store
            .lock()
            .unwrap()
            .all()
            .unwrap()
            .iter()
            .all(|r| !r.phase.active() && r.phase != Phase::Queued)
            .then_some(())
    })
    .await;
    browser
        .send("agy-member-followup", "phase2-continue", false)
        .await;
    receipt(host, "agy-member-followup", |r| r.phase == Phase::Completed).await;
    let current = wait(|| {
        let tasks = host.store.lock().unwrap().tasks().unwrap();
        let task = tasks
            .into_iter()
            .find(|t| t.root == "agy-team" && t.owner == "investigate")?;
        let correction = task.attempts.get(1)?;
        assert_ne!(correction.phase, Phase::Failed, "{}", correction.detail);
        (correction.phase == Phase::Completed).then_some(task)
    })
    .await;
    let (prior, next) = (&current.attempts[0], &current.attempts[1]);
    assert_eq!(prior.native_session, next.native_session);
    assert_ne!(prior.native_pid, next.native_pid);
    let selection: Value = serde_json::from_str(next.structured.as_deref().unwrap()).unwrap();
    assert_eq!(selection["selection"]["continuity"], "native");

    host.store
        .lock()
        .unwrap()
        .set_trust(&host.project, false)
        .unwrap();
    browser
        .request(
            "POST",
            "/api/commands",
            json!({
                "api":API, "id":"agy-untrusted-member", "session":SESSION, "mode":"session_v1",
                "prompt":"phase2-delegate-untrusted", "fresh":true,
            }),
        )
        .await;
    receipt(host, "agy-untrusted-member", |r| {
        r.phase == Phase::Completed
    })
    .await;
    wait(|| {
        let tasks = host.store.lock().unwrap().tasks().unwrap();
        let task = tasks
            .iter()
            .find(|task| task.root == "agy-untrusted-member")?;
        let attempt = &task.attempts[0];
        assert_ne!(attempt.phase, Phase::Failed, "{}", attempt.detail);
        (attempt.phase == Phase::Completed).then_some(())
    })
    .await;

    assert_eq!(
        std::fs::read_to_string(dir.join(".gemini/antigravity-cli/settings.json")).unwrap(),
        "{}"
    );
    assert_eq!(std::fs::read_to_string(auth).unwrap(), "fixture account");
    host.retire_native().await.unwrap();
}
