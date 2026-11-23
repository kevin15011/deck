use super::*;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use deck2_shared::{API, DecisionState, SteeringState};
use std::os::unix::fs::{PermissionsExt, symlink};
use tower::ServiceExt;

const HOST: &str = "127.0.0.1:32126";
const SESSION: &str = "claude-sdk-test-session";

struct Browser {
    router: Router,
    cookie: String,
}

impl Browser {
    async fn open(app: &App) -> Self {
        let router = crate::server::router(app.clone());
        let res = router
            .clone()
            .oneshot(
                Request::post("/auth")
                    .header(header::HOST, HOST)
                    .header(header::ORIGIN, format!("http://{HOST}"))
                    .body(Body::from(app.issue_launch()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let cookie = res.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_owned();
        Self { router, cookie }
    }

    async fn request(&self, method: &str, uri: &str, body: Value) -> Value {
        let response = self
            .router
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
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
        let bytes = to_bytes(response.into_body(), MAX_FRAME).await.unwrap();
        assert!(
            status == StatusCode::OK || status == StatusCode::CREATED || status == StatusCode::ACCEPTED,
            "{status}: {}",
            String::from_utf8_lossy(&bytes)
        );
        serde_json::from_slice(&bytes).unwrap()
    }
}

fn app(dir: &Path) -> App {
    let project = dir.join("project");
    let codex = dir.join("codex");
    let mut store = Store::open(&dir.join("state.db"), project.to_str().unwrap()).unwrap();
    let unavailable = if codex.is_file() {
        store.register_codex(file_digest(&codex).unwrap()).unwrap();
        None
    } else {
        Some("Codex absent".into())
    };
    let app = App::new(
        store,
        HOST.into(),
        codex,
        unavailable,
        "admin".into(),
        "recover".into(),
    );
    *app.scope_root.lock().unwrap() = Some(dir.join("scopes"));
    app
}

async fn wait_for(app: &App, id: &str, until: impl Fn(&Receipt) -> bool) -> Receipt {
    timeout(Duration::from_secs(8), async {
        loop {
            let receipt = app.receipt(id).unwrap();
            if until(&receipt) {
                return receipt;
            }
            assert!(
                receipt.phase.active() || receipt.phase == Phase::Queued,
                "Unexpected settlement: {:?}, {}",
                receipt.phase,
                receipt.detail
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("Claude SDK receipt {id} did not reach the requested state"))
}

fn send_command(id: &str, prompt: &str) -> Value {
    json!({"api":API,"id":id,"session":SESSION,"prompt":prompt,"mode":"session_v1","fresh":false})
}

async fn verify_coordination(host: &App, dir: &Path) {
    {
        let mut store = host.store.lock().unwrap();
        store
            .select_project_folder_with_trust(host.project.as_str(), true)
            .unwrap();
    }
    let browser = Browser::open(host).await;
    browser
        .request(
            "POST",
            "/api/sessions",
            json!({
                "api": API, "id": SESSION, "title": "Claude delegation fixture",
                "members": {
                    "lead": {"runnerId":"claude","modelId":"default"},
                    "investigate": {"runnerId":"codex","modelId":"gpt-6.1-sol"}
                }
            }),
        )
        .await;
    let marker = |name: &str| std::fs::write(dir.join(name), "").unwrap();
    marker("unexpected-mcp");
    let blocked = "foreign-mcp-blocked";
    browser
        .request("POST", "/api/commands", send_command(blocked, blocked))
        .await;
    let rejected = wait_for(host, blocked, |r| r.phase == Phase::Failed).await;
    assert!(rejected.dispatch_ms.is_none());
    assert!(rejected.detail.contains("scoped Deck session tools"));
    std::fs::remove_file(dir.join("unexpected-mcp")).unwrap();

    let codex_session = "codex-concurrent-lead";
    browser
        .request(
            "POST",
            "/api/sessions",
            json!({
                "api": API, "id": codex_session, "title": "Independent Codex turn",
                "members": {"lead": {"runnerId":"codex","modelId":"gpt-6.1-sol"}}
            }),
        )
        .await;
    let mut codex = send_command("held-codex-lead", "Waiting-policy hold codex-lead");
    codex["session"] = json!(codex_session);
    browser.request("POST", "/api/commands", codex).await;
    wait_for(host, "held-codex-lead", |r| r.phase == Phase::Running).await;
    let mut claude = send_command("overlapping-claude-lead", "Check configured roles");
    claude["queue"] = json!(true);
    let queued = browser.request("POST", "/api/commands", claude).await;
    assert_eq!(queued["phase"], "queued");
    let overlap = wait_for(host, "overlapping-claude-lead", |r| {
        r.phase == Phase::Completed
    })
    .await;
    assert_eq!(
        host.receipt("held-codex-lead").unwrap().phase,
        Phase::Running
    );
    assert_eq!(overlap.text, "Configured roles received");
    assert!(overlap.handshake_ms.is_some());
    marker("release-codex-lead");
    wait_for(host, "held-codex-lead", |r| r.phase == Phase::Completed).await;

    for (id, key) in [
        ("delegate-and-yield", "complete"),
        ("delegate-and-stop", "stop"),
    ] {
        browser
            .request("POST", "/api/commands", send_command(id, id))
            .await;
        let lead = wait_for(host, id, |r| r.phase == Phase::Running).await;
        marker(&format!("lead-running-{key}"));
        timeout(Duration::from_secs(5), async {
            while !dir.join(format!("ready-{key}")).is_file() {
                assert_eq!(host.receipt(id).unwrap().phase, Phase::Running);
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("Claude SDK did not delegate to the configured Codex member");
        let workspace = browser.request("GET", "/api/workspace", Value::Null).await;
        let tasks = workspace["tasks"].as_array().unwrap();
        assert_eq!(tasks.len(), if key == "complete" { 1 } else { 2 });
        assert!(tasks.iter().any(|task| task["session"] == SESSION
            && task["owner"] == "investigate"
            && task["attempts"][0]["phase"] == "running"));
        if key == "stop" {
            browser
                .request("POST", &format!("/api/commands/{id}/cancel"), Value::Null)
                .await;
            // The native fixture's in-flight tool call is released by this marker.
            marker("lead-release-stop");
            wait_for(host, id, |r| r.phase == Phase::Cancelled).await;
            assert!(dir.join("grant-revoked").is_file());
            timeout(Duration::from_secs(5), async {
                loop {
                    let workspace = browser.request("GET", "/api/workspace", Value::Null).await;
                    if workspace["tasks"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|t| t["attempts"][0]["phase"] == "cancelled")
                    {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            assert_eq!(
                host.store
                    .lock()
                    .unwrap()
                    .all()
                    .unwrap()
                    .iter()
                    .filter(|r| r.continuation.is_some())
                    .count(),
                1
            );
            break;
        }
        marker("release-complete");
        let outcome = timeout(Duration::from_secs(5), async {
            loop {
                if let Some(outcome) = host
                    .store
                    .lock()
                    .unwrap()
                    .all()
                    .unwrap()
                    .into_iter()
                    .find(|r| r.continuation.is_some())
                {
                    break outcome;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(outcome.phase, Phase::Queued);
        assert!(outcome.dispatch_ms.is_none());
        assert_eq!(host.receipt(id).unwrap().phase, Phase::Running);
        marker("lead-release-complete");
        wait_for(host, &outcome.id, |r| r.phase == Phase::Running).await;
        marker("continuation-running");
        let resumed = wait_for(host, &outcome.id, |r| r.phase == Phase::Completed).await;
        assert_eq!(resumed.thread, lead.thread);
        assert_eq!(resumed.text, "Integrated member report");
        assert_eq!(
            host.store
                .lock()
                .unwrap()
                .all()
                .unwrap()
                .iter()
                .filter(|r| r.continuation.is_some())
                .count(),
            1
        );
    }
}

fn png_bytes(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(width, height)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

fn upload_png(host: &App, upload: &str, width: u32) -> (deck2_shared::ImageAttachment, Vec<u8>) {
    let bytes = png_bytes(width, 9);
    let metadata = crate::images::validate(&bytes).unwrap();
    let stored = host
        .store
        .lock()
        .unwrap()
        .upload_image(SESSION, upload, metadata, &bytes)
        .unwrap();
    (stored, bytes)
}

fn fixture_blocks(dir: &Path, name: &str) -> Vec<Value> {
    serde_json::from_str(&std::fs::read_to_string(dir.join(name)).unwrap()).unwrap()
}

fn steer_files(dir: &Path) -> Vec<String> {
    let mut names: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|entry| entry.unwrap().file_name().into_string().ok())
        .filter(|name| name.starts_with("steer-"))
        .collect();
    names.sort();
    names
}

fn assert_png_block(block: &Value, bytes: &[u8]) {
    use base64::{Engine, engine::general_purpose::STANDARD};
    assert_eq!(block["type"], "image");
    assert_eq!(block["source"]["type"], "base64");
    assert_eq!(block["source"]["media_type"], "image/png");
    assert_eq!(STANDARD.decode(block["source"]["data"].as_str().unwrap()).unwrap(), bytes);
}

// Live Send now and image input through the real router, store and TypeScript
// bridge. Only the Claude CLI's wire is a fixture; the Claude process receives
// the same user messages the pinned SDK writes for it.
async fn verify_steering(host: &App, dir: &Path) {
    host.store
        .lock()
        .unwrap()
        .select_project_folder_with_trust(host.project.as_str(), true)
        .unwrap();
    let browser = Browser::open(host).await;
    browser
        .request(
            "POST",
            "/api/sessions",
            json!({"api": API, "id": SESSION, "title": "Claude live input",
                   "members": {"lead": {"runnerId": "claude", "modelId": "default"}}}),
        )
        .await;
    let image_turn = |id: &str, prompt: &str, attachments: &[&deck2_shared::ImageAttachment], queue: bool| {
        let mut command = send_command(id, prompt);
        command["attachments"] = json!(attachments.iter().map(|a| &a.id).collect::<Vec<_>>());
        command["queue"] = json!(queue);
        command
    };
    let steer_target = |root: &Receipt| {
        json!({"session": SESSION, "threadId": root.thread, "expectedTurnId": root.turn})
    };
    let queued_body = |root: &Receipt, id: &str, source: &Receipt| {
        let mut body = steer_target(root);
        body["id"] = json!(id);
        body["queuedSource"] = json!({"id": source.id, "attempt": source.attempt});
        body
    };

    // 1. A first turn that starts with an image reaches the model as a text +
    // image user message, and the turn is live-steerable once initialized.
    let (first_image, first_bytes) = upload_png(host, "upload-first-image", 7);
    browser
        .request("POST", "/api/commands",
            image_turn("steer-root-1", "Hold for live steering one", &[&first_image], false))
        .await;
    let root = wait_for(host, "steer-root-1", |r| r.can_steer && r.text == "Partial").await;
    let blocks = fixture_blocks(dir, "initial-blocks");
    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[0], json!({"type": "text", "text": "Hold for live steering one"}));
    assert_png_block(&blocks[1], &first_bytes);

    // 2. Normal live text: acknowledged by the CLI's own echo, it changes the
    // outcome of the working turn, and the same id is a retry, not a new write.
    let text_id = Uuid::new_v4().to_string();
    let mut direct = steer_target(&root);
    direct["id"] = json!(text_id);
    direct["text"] = json!("finish with the direct note");
    let admitted = browser.request("POST", "/api/commands/steer-root-1/steering", direct.clone()).await;
    assert_eq!(admitted["state"], "pending");
    let done = wait_for(host, "steer-root-1", |r| r.phase == Phase::Completed).await;
    assert_eq!(done.text, "Steered: finish with the direct note");
    assert_eq!(done.steering.len(), 1);
    assert_eq!(done.steering[0].state, SteeringState::Accepted);
    let retry = browser.request("POST", "/api/commands/steer-root-1/steering", direct).await;
    assert_eq!(retry["state"], "accepted");
    assert_eq!(steer_files(dir), vec![format!("steer-{text_id}")]);
    assert_eq!(fixture_blocks(dir, &format!("steer-{text_id}")),
        vec![json!({"type": "text", "text": "finish with the direct note"})]);

    // 3. A queued message with an image is sent live through the shared queue
    // path: its text and image reach the active turn, its slot is consumed once
    // and never becomes a next turn.
    let (live_image, live_bytes) = upload_png(host, "upload-live-image", 11);
    browser
        .request("POST", "/api/commands",
            image_turn("steer-root-2", "Hold for live steering two", &[], false))
        .await;
    let root2 = wait_for(host, "steer-root-2", |r| r.can_steer && r.text == "Partial").await;
    assert_eq!(root2.thread, root.thread, "live input stays on the same native thread");
    browser
        .request("POST", "/api/commands",
            image_turn("queued-live-image", "finish using this picture", &[&live_image], true))
        .await;
    let eligible = timeout(Duration::from_secs(5), async {
        loop {
            let workspace = browser.request("GET", "/api/workspace", Value::Null).await;
            if workspace["steerable_queued"] == json!(["queued-live-image"]) {
                return workspace;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("A queued message with images is eligible for live delivery on a Claude Lead");
    assert!(eligible["receipts"].as_array().unwrap().iter().any(|r| r["id"] == "queued-live-image"));
    let queued = host.receipt("queued-live-image").unwrap();
    let queued_steer = Uuid::new_v4().to_string();
    let body = queued_body(&root2, &queued_steer, &queued);
    browser.request("POST", "/api/commands/steer-root-2/steering/queued", body.clone()).await;
    let done = wait_for(host, "steer-root-2", |r| r.phase == Phase::Completed).await;
    assert_eq!(done.text, "Steered: finish using this picture");
    assert_eq!(done.steering[0].state, SteeringState::Accepted);
    let blocks = fixture_blocks(dir, &format!("steer-{queued_steer}"));
    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[0], json!({"type": "text", "text": "finish using this picture"}));
    assert_png_block(&blocks[1], &live_bytes);
    let source = host.receipt("queued-live-image").unwrap();
    assert_eq!(source.phase, Phase::Cancelled);
    assert_eq!(source.steered_to.as_deref(), Some("steer-root-2"));
    assert!(source.dispatch_ms.is_none());
    host.pump_queue();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(host.receipt("queued-live-image").unwrap().phase, Phase::Cancelled);
    let before = steer_files(dir).len();
    let again = browser.request("POST", "/api/commands/steer-root-2/steering/queued", body).await;
    assert_eq!(again["state"], "accepted");
    assert_eq!(steer_files(dir).len(), before);

    // 4. Consumption proven by the turn's own reply list, without an echo,
    // counts as acknowledgment of a queued message carrying an image.
    let (only_image, only_bytes) = upload_png(host, "upload-only-image", 13);
    browser
        .request("POST", "/api/commands",
            image_turn("steer-root-3", "Hold for live steering three", &[], false))
        .await;
    let root3 = wait_for(host, "steer-root-3", |r| r.can_steer && r.text == "Partial").await;
    browser
        .request("POST", "/api/commands",
            image_turn("queued-consumed-only", "finish consumed-only echo-withheld", &[&only_image], true))
        .await;
    let source = wait_for(host, "queued-consumed-only", |r| r.phase == Phase::Queued).await;
    wait_steerable(&browser, "queued-consumed-only").await;
    let id = Uuid::new_v4().to_string();
    browser
        .request("POST", "/api/commands/steer-root-3/steering/queued", queued_body(&root3, &id, &source))
        .await;
    let done = wait_for(host, "steer-root-3", |r| r.phase == Phase::Completed).await;
    assert_eq!(done.steering[0].state, SteeringState::Accepted);
    assert_png_block(&fixture_blocks(dir, &format!("steer-{id}"))[1], &only_bytes);

    // 5. Without an echo or a consumption record the host will not claim
    // delivery, and will not send the message again.
    browser
        .request("POST", "/api/commands",
            image_turn("steer-root-4", "Hold for live steering four", &[], false))
        .await;
    let root4 = wait_for(host, "steer-root-4", |r| r.can_steer && r.text == "Partial").await;
    browser
        .request("POST", "/api/commands",
            image_turn("queued-unconfirmed", "finish echo-withheld", &[], true))
        .await;
    let source = wait_for(host, "queued-unconfirmed", |r| r.phase == Phase::Queued).await;
    wait_steerable(&browser, "queued-unconfirmed").await;
    let id = Uuid::new_v4().to_string();
    browser
        .request("POST", "/api/commands/steer-root-4/steering/queued", queued_body(&root4, &id, &source))
        .await;
    let done = wait_for(host, "steer-root-4", |r| r.phase == Phase::Completed).await;
    assert_eq!(done.steering[0].state, SteeringState::Uncertain);
    let source = host.receipt("queued-unconfirmed").unwrap();
    assert_eq!(source.phase, Phase::Cancelled);
    host.pump_queue();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(host.receipt("queued-unconfirmed").unwrap().phase, Phase::Cancelled);
    assert_eq!(steer_files(dir).iter().filter(|name| **name == format!("steer-{id}")).count(), 1);

    // 6. Every turn above resumed the one native Claude thread.
    let thread = host.store.lock().unwrap().session_by_id(SESSION).unwrap().native.unwrap().thread;
    for id in ["steer-root-1", "steer-root-2", "steer-root-3", "steer-root-4"] {
        assert_eq!(host.receipt(id).unwrap().thread.as_deref(), Some(thread.as_str()));
    }
}

async fn wait_steerable(browser: &Browser, id: &str) {
    timeout(Duration::from_secs(5), async {
        loop {
            let workspace = browser.request("GET", "/api/workspace", Value::Null).await;
            if workspace["steerable_queued"].as_array().unwrap().iter().any(|v| v == id) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{id} never became eligible for live delivery"));
}

// The real router, SDK bundle and receipt/queue store run with a fake native
// process. Assert prompt separation across attempts and actual stream identity.
#[tokio::test]
async fn claude_sdk_normal_entrypoint_streams_stops_and_resumes_once() {
    const NAME: &str = "claude::tests::claude_sdk_normal_entrypoint_streams_stops_and_resumes_once";
    let Some(dir) = std::env::var_os("DECK2_SDK_FIXTURE").map(PathBuf::from) else {
        if BRIDGE.is_empty() {
            eprintln!("Build the embedded SDK first with bun run build");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let node = node_runtime().expect("SDK contract test requires Node.js");
        symlink(node.canonicalize().unwrap(), dir.path().join("node")).unwrap();
        let executable = dir.path().join(RUNNER);
        std::fs::write(&executable, include_str!("../tests/fake_claude_sdk.py")).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::create_dir(dir.path().join("project")).unwrap();
        std::fs::write(
            dir.path().join("project/CLAUDE.md"),
            "Fixture instructions only.",
        )
        .unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir(project.join("search")).unwrap();
        std::fs::create_dir(project.join(".git")).unwrap();
        std::fs::write(project.join(".git/config"), "before\n").unwrap();
        symlink(project.join("deny.txt"), project.join("link.txt")).unwrap();
        std::fs::write(project.join("deny.txt"), "First line\nbefore\n").unwrap();
        std::fs::hard_link(project.join("deny.txt"), project.join("hardlink.txt")).unwrap();
        symlink(dir.path(), project.join("outside-dir")).unwrap();
        let command = |action: &str| {
            let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
            command
                .args(["--exact", NAME, "--nocapture"])
                .env_clear()
                .env("DECK2_SDK_FIXTURE", dir.path())
                .env("DECK2_SDK_CASE", action)
                .env("HOME", dir.path())
                .env("PATH", dir.path())
                .kill_on_drop(true);
            command
        };
        let assert_pass = |result: std::process::Output| {
            assert!(
                result.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            );
            assert!(String::from_utf8_lossy(&result.stdout).contains("1 passed"));
        };
        assert_pass(command("normal").output().await.unwrap());
        for file in ["wire", "state.db"] {
            std::fs::rename(
                dir.path().join(file),
                dir.path().join(format!("normal-{file}")),
            )
            .unwrap();
        }
        std::fs::write(dir.path().join("hold-group"), "").unwrap();
        let mut crash = command("crash").stdout(Stdio::piped()).spawn().unwrap();
        let mut lines = BufReader::new(crash.stdout.take().unwrap()).lines();
        timeout(Duration::from_secs(15), async {
            while let Some(line) = lines.next_line().await.unwrap() {
                if line == "SDK ready to simulate host loss" {
                    return;
                }
            }
            panic!("Claude crash fixture exited before the queued turn was saved");
        })
        .await
        .expect("Claude crash fixture timed out");
        crash.kill().await.unwrap();
        assert_pass(command("restart").output().await.unwrap());
        let coordination = tempfile::tempdir().unwrap();
        symlink(
            node.canonicalize().unwrap(),
            coordination.path().join("node"),
        )
        .unwrap();
        std::fs::copy(&executable, coordination.path().join(RUNNER)).unwrap();
        std::fs::create_dir(coordination.path().join("project")).unwrap();
        std::fs::write(
            coordination.path().join("project/CLAUDE.md"),
            "Fixture only.",
        )
        .unwrap();
        let codex = coordination.path().join("codex");
        let fixture = include_str!("../tests/fake_session_native.py").replacen(
            "#!/usr/bin/env python3",
            "#!/usr/bin/python3",
            1,
        );
        std::fs::write(&codex, fixture).unwrap();
        std::fs::set_permissions(codex, std::fs::Permissions::from_mode(0o700)).unwrap();
        let steering = tempfile::tempdir().unwrap();
        symlink(node.canonicalize().unwrap(), steering.path().join("node")).unwrap();
        std::fs::copy(&executable, steering.path().join(RUNNER)).unwrap();
        std::fs::create_dir(steering.path().join("project")).unwrap();
        std::fs::write(steering.path().join("project/CLAUDE.md"), "Fixture only.").unwrap();
        assert_pass(
            command("steering")
                .env("DECK2_SDK_FIXTURE", steering.path())
                .env("HOME", steering.path())
                .env("PATH", steering.path())
                .output()
                .await
                .unwrap(),
        );
        assert_pass(
            command("coordination")
                .env("DECK2_SDK_FIXTURE", coordination.path())
                .env("HOME", coordination.path())
                .env("PATH", coordination.path())
                .output()
                .await
                .unwrap(),
        );
        return;
    };
    const FIRST: &str = "claude-sdk-first-command";
    const SECOND: &str = "claude-sdk-second-command";
    const REJECTED: &str = "claude-sdk-rejected-command";
    let action = std::env::var("DECK2_SDK_CASE").unwrap();
    let host = app(&dir);
    if action == "coordination" {
        verify_coordination(&host, &dir).await;
        return;
    }
    if action == "steering" {
        verify_steering(&host, &dir).await;
        return;
    }
    if action == "restart" {
        let previous = host.receipt(FIRST).unwrap();
        assert_eq!(previous.phase, Phase::Uncertain);
        assert_eq!(previous.text, "Partial");
        assert_eq!(host.receipt(SECOND).unwrap().phase, Phase::Queued);
        host.pump_queue();
        assert_eq!(host.receipt(FIRST).unwrap().phase, Phase::Uncertain);
        assert_eq!(host.receipt(SECOND).unwrap().phase, Phase::Queued);
        std::fs::remove_file(dir.join("hold-group")).unwrap();
        let followup = wait_for(&host, SECOND, |r| r.phase == Phase::Completed).await;
        assert_eq!(followup.thread, previous.thread);
        assert_eq!(followup.text, "Follow-up finished");
        assert_reused_grep(&previous, &followup);
        let retained = host.receipt(FIRST).unwrap();
        assert_eq!(retained.phase, Phase::Failed);
        assert!(retained.detail.contains("without a confirmed result"));
        assert_eq!(retained.decisions[3].state, DecisionState::Invalidated);
        assert_inputs(&dir, false);
        return;
    }
    host.store
        .lock()
        .unwrap()
        .select_project_folder_with_trust(host.project.as_str(), true)
        .unwrap();
    let browser = Browser::open(&host).await;
    let inventory = browser.request("GET", "/api/models", Value::Null).await;
    assert_eq!(inventory["runners"][2]["available"], true, "{inventory}");
    let rows = inventory["runners"][2]["models"].as_array().unwrap();
    let sonnet = rows
        .iter()
        .find(|model| model["modelId"] == "sonnet")
        .expect("Missing native Sonnet alias");
    assert_eq!(sonnet["thinkingLevels"], json!(["low", "high"]));
    let assignment = if action == "normal" {
        json!({"runnerId": RUNNER, "modelId": "sonnet", "thinking": "high"})
    } else {
        json!({"runnerId": RUNNER, "modelId": "default"})
    };
    browser
        .request(
            "POST",
            "/api/sessions",
            json!({
                "api": API, "id": SESSION, "title": "Claude SDK fixture",
                "members":{"lead":assignment}
            }),
        )
        .await;
    browser
        .request("POST", "/api/commands", send_command(FIRST, "First turn"))
        .await;
    for (index, (tool, response)) in [
        ("Read", "allow_once"),
        ("Glob", "deny"),
        ("Grep", "allow_session"),
    ]
    .into_iter()
    .enumerate()
    {
        let receipt = wait_for(&host, FIRST, |r| r.decisions.len() > index).await;
        let decision = &receipt.decisions[index];
        assert_eq!(decision.state, DecisionState::Pending);
        let workspace = browser.request("GET", "/api/workspace", Value::Null).await;
        let active = workspace["receipts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|value| value["id"] == FIRST)
            .unwrap();
        let presentation = &active["decisions"][index]["presentation"];
        assert_eq!(active["decisions"][index]["id"], decision.id);
        assert_eq!(presentation["validated"], true);
        assert_eq!(
            presentation["responses"],
            json!(["allow_once", "allow_session", "deny"])
        );
        assert_eq!(presentation["details"]["tool"], tool);
        if tool == "Read" {
            assert_eq!(
                presentation["details"]["input"]["file_path"],
                json!(dir.join("project/CLAUDE.md"))
            );
        }
        let mut body = json!({"api":API, "command_id":Uuid::new_v4().to_string(),
            "expected_revision":decision.revision, "response":{"type":response}});
        if response == "allow_session" {
            let option = &presentation["permission_policy"]["options"][0];
            assert_eq!(option["kind"], "exact");
            assert_eq!(option["survives_host_restart"], true);
            body["scope_option_id"] = option["id"].clone();
        }
        browser
            .request(
                "POST",
                &format!("/api/decisions/{}/responses", decision.id),
                body,
            )
            .await;
    }
    let first = wait_for(&host, FIRST, |r| {
        r.text == "Partial" && r.decisions.len() == 4
    })
    .await;
    for (decision, allowed) in first.decisions.iter().zip([true, false, true]) {
        assert_eq!(decision.state, DecisionState::Delivered);
        assert!(decision.delivered_ms.is_some());
        assert_eq!(decision.grant_consumed, allowed);
    }
    assert_eq!(first.decisions[3].state, DecisionState::Pending);
    assert_eq!(
        std::fs::read_to_string(dir.join("project/.git/config")).unwrap(),
        "before\n"
    );
    assert!(!dir.join("new.txt").exists());
    assert!(!dir.join("project/missing.txt").exists());
    let queued = browser
        .request("POST", "/api/commands", send_command(SECOND, "Follow up"))
        .await;
    assert_eq!(queued["phase"], "queued");
    if action == "crash" {
        println!("SDK ready to simulate host loss");
        std::future::pending::<()>().await;
    }
    browser
        .request(
            "POST",
            &format!("/api/commands/{FIRST}/cancel"),
            json!({"api":API,"session":SESSION}),
        )
        .await;
    let stopped = wait_for(&host, FIRST, |r| r.phase == Phase::Cancelled).await;
    assert_eq!(stopped.text, "Partial");
    assert_eq!(stopped.decisions[3].state, DecisionState::Invalidated);
    let second = wait_for(&host, SECOND, |r| r.phase == Phase::Completed).await;
    assert_eq!(second.text, "Follow-up finished");
    assert_reused_grep(&first, &second);
    assert_eq!(second.thread, first.thread);
    assert_eq!(second.model.as_deref(), Some("fixture-model"));
    assert_eq!(
        second
            .configuration
            .as_ref()
            .unwrap()
            .runner
            .as_ref()
            .unwrap()
            .model
            .as_deref(),
        Some("sonnet")
    );
    // A catalog change after assignment must stop before dispatch, with the same
    // fresh inventory visible when the dialog is opened again.
    std::fs::write(dir.join("remove-effort"), "").unwrap();
    let refreshed = browser.request("GET", "/api/models", Value::Null).await;
    let refreshed = refreshed["runners"][2]["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|model| model["modelId"] == "sonnet")
        .unwrap();
    assert_eq!(refreshed["thinkingLevels"], json!(["low"]));
    const REMOVED: &str = "claude-sdk-removed-effort";
    browser
        .request(
            "POST",
            "/api/commands",
            send_command(REMOVED, "Do not deliver stale selection"),
        )
        .await;
    let rejected = wait_for(&host, REMOVED, |r| r.phase == Phase::Failed).await;
    assert_eq!(rejected.dispatch_ms, None);
    assert!(
        rejected
            .detail
            .contains("no longer offers the selected model or effort")
    );
    std::fs::remove_file(dir.join("remove-effort")).unwrap();
    // Preflight must check actual SDK account metadata before releasing input.
    std::fs::write(dir.join("reject-billing"), "").unwrap();
    browser
        .request(
            "POST",
            "/api/commands",
            send_command(REJECTED, "Do not deliver"),
        )
        .await;
    let rejected = wait_for(&host, REJECTED, |r| r.phase == Phase::Failed).await;
    assert_eq!(rejected.dispatch_ms, None);
    std::fs::remove_file(dir.join("reject-billing")).unwrap();
    std::fs::write(dir.join("credits-enabled"), "").unwrap();
    const CREDITS: &str = "claude-sdk-credits-command";
    browser
        .request(
            "POST",
            "/api/commands",
            send_command(CREDITS, "Do not use credits"),
        )
        .await;
    let rejected = wait_for(&host, CREDITS, |r| r.phase == Phase::Failed).await;
    assert_eq!(rejected.dispatch_ms, None);
    assert!(rejected.detail.contains("usage credits are enabled"));
    std::fs::write(dir.join("reject-billing"), "").unwrap();
    assert_inputs(&dir, true);
    std::fs::remove_file(dir.join("reject-billing")).unwrap();
    std::fs::remove_file(dir.join("credits-enabled")).unwrap();
    assert_new_grep_review(&host, &browser, SESSION, "changed-grep", "Changed search").await;

    let search = dir.join("project/search");
    let original = dir.join("project/original-search");
    std::fs::rename(&search, &original).unwrap();
    std::fs::create_dir(&search).unwrap();
    assert_new_grep_review(
        &host,
        &browser,
        SESSION,
        "replaced-grep-target",
        "Repeat search",
    )
    .await;
    std::fs::remove_dir(&search).unwrap();
    std::fs::rename(&original, &search).unwrap();

    const OTHER_SESSION: &str = "other-claude-session";
    browser
        .request(
            "POST",
            "/api/sessions",
            json!({
                "api": API, "id": OTHER_SESSION, "title": "Isolated Claude authority",
                "members": {"lead": assignment}
            }),
        )
        .await;
    assert_new_grep_review(
        &host,
        &browser,
        OTHER_SESSION,
        "other-session-grep",
        "Repeat search",
    )
    .await;

    // A newly admitted turn can resume after the CLI changes. The exact
    // previous Grep grant stays bound to the executable that issued it.
    let executable = dir.join(RUNNER);
    let old_digest = file_digest(&executable).unwrap();
    let mut upgraded = std::fs::read(&executable).unwrap();
    upgraded.extend_from_slice(b"\n# Upgraded CLI fixture\n");
    std::fs::write(&executable, upgraded).unwrap();
    let new_digest = file_digest(&executable).unwrap();
    assert_ne!(old_digest, new_digest);
    const UPGRADED: &str = "claude-sdk-after-upgrade";
    assert_new_grep_review(&host, &browser, SESSION, UPGRADED, "Repeat search").await;
    assert_eq!(host.receipt(UPGRADED).unwrap().thread, first.thread);
    let native = host
        .store
        .lock()
        .unwrap()
        .session_by_id(SESSION)
        .unwrap()
        .native
        .unwrap();
    assert_eq!(native.provenance.unwrap().executable, new_digest);

    const PENDING_REVOKE: &str = "pending-revoke-grep";
    browser
        .request(
            "POST",
            "/api/commands",
            send_command(PENDING_REVOKE, "Changed search"),
        )
        .await;
    let pending = wait_for(&host, PENDING_REVOKE, |r| !r.decisions.is_empty()).await;
    assert_eq!(pending.decisions[0].state, DecisionState::Pending);
    browser
        .request(
            "POST",
            &format!("/api/sessions/{SESSION}/grants/revoke"),
            Value::Null,
        )
        .await;
    let revoked = wait_for(&host, PENDING_REVOKE, |r| r.phase == Phase::Completed).await;
    assert_eq!(revoked.text, "Search denied");
    assert_eq!(revoked.decisions[0].state, DecisionState::Invalidated);
    assert_new_grep_review(&host, &browser, SESSION, "revoked-grep", "Repeat search").await;
    browser
        .request("POST", "/api/commands", send_command("choose-any", "Choose Any"))
        .await;
    let pending = wait_for(&host, "choose-any", |r| !r.decisions.is_empty()).await;
    let [decision] = pending.decisions.as_slice() else {
        panic!("Expected one pending Grep request");
    };
    assert_eq!(decision.state, DecisionState::Pending);
    let presentation = crate::permission_policy::view(decision).unwrap();
    let options = presentation["options"].as_array().unwrap();
    assert_eq!(options[0]["kind"], "exact");
    let any = options.iter().find(|o| o["kind"] == "workspace_grep").unwrap();
    browser
        .request(
            "POST",
            &format!("/api/decisions/{}/responses", decision.id),
            json!({"api":API, "command_id":Uuid::new_v4().to_string(),
                "expected_revision":decision.revision, "response":{"type":"allow_session"},
                "scope_option_id":any["id"]}),
        )
        .await;
    wait_for(&host, "choose-any", |r| r.phase == Phase::Completed).await;
    browser
        .request(
            "POST",
            "/api/commands",
            send_command("any-grep-reuse", "Search a different workspace file"),
        )
        .await;
    let reused = wait_for(&host, "any-grep-reuse", |r| r.phase == Phase::Completed).await;
    assert_eq!(reused.text, "Follow-up finished");
    assert_eq!(
        reused.decisions[0].native.as_ref().unwrap().resolution_provenance,
        Some(deck2_shared::PermissionProvenance::ReusedGrant {
            source_decision: decision.id.clone(),
        })
    );
    assert_new_grep_review(&host, &browser, OTHER_SESSION, "any-other-session", "Repeat search").await;
    browser
        .request(
            "POST",
            "/api/commands",
            send_command("any-outside-grep", "Search outside the workspace"),
        )
        .await;
    let outside = wait_for(&host, "any-outside-grep", |r| r.phase == Phase::Completed).await;
    assert_eq!(outside.text, "Search denied");
    assert!(outside.decisions.is_empty());
    // Ordinary multi-step flow from a clean grant state. The user always picks
    // the broadest offered reusable option; counts are the prompts actually shown.
    browser
        .request("POST", &format!("/api/sessions/{SESSION}/grants/revoke"), Value::Null)
        .await;
    browser
        .request("POST", "/api/commands", send_command("ordinary-flow", "Ordinary flow"))
        .await;
    let mut prompted: Vec<String> = vec![];
    let flow = loop {
        let receipt = wait_for(&host, "ordinary-flow", |r| {
            r.phase == Phase::Completed
                || r.decisions.iter().any(|d| d.state == DecisionState::Pending)
        })
        .await;
        let Some(decision) = receipt
            .decisions
            .iter()
            .find(|d| d.state == DecisionState::Pending)
        else {
            break receipt;
        };
        let workspace = browser.request("GET", "/api/workspace", Value::Null).await;
        let shown = workspace["receipts"].as_array().unwrap().iter()
            .find(|v| v["id"] == "ordinary-flow").unwrap()["decisions"]
            .as_array().unwrap().iter().find(|v| v["id"] == decision.id).unwrap().clone();
        let options = shown["presentation"]["permission_policy"]["options"].as_array().cloned().unwrap_or_default();
        let tool = shown["presentation"]["details"]["tool"].as_str().unwrap_or("?").to_owned();
        let protected = shown["presentation"]["details"].to_string().contains("reset --hard");
        let broad = options.last().filter(|o| o["kind"] != "exact");
        prompted.push(format!("{tool}:{}", broad.map_or("exact-only", |o| o["kind"].as_str().unwrap())));
        let mut body = json!({"api":API, "command_id":Uuid::new_v4().to_string(),
            "expected_revision":decision.revision,
            "response":{"type": if protected {"deny"} else {"allow_session"}}});
        if !protected && let Some(o) = broad.or(options.first()) {
            body["scope_option_id"] = o["id"].clone();
        }
        browser
            .request("POST", &format!("/api/decisions/{}/responses", decision.id), body)
            .await;
    };
    let reused = flow.decisions.iter().filter(|d| matches!(d.native.as_ref().unwrap().resolution_provenance, Some(deck2_shared::PermissionProvenance::ReusedGrant { .. }))).count();
    assert_eq!(
        prompted,
        ["Read:workspace_read", "Glob:workspace_read", "Grep:workspace_grep", "Bash:bash_prefix", "Bash:exact-only"]
    );
    assert_eq!((flow.decisions.len(), reused), (8, 3));
    for (mode, id) in [
        ("relay", "direct-claude-relay"),
        ("yolo", "direct-claude-yolo"),
    ] {
        let target = dir.join("project/nested/direct.txt");
        if target.exists() {
            std::fs::remove_file(&target).unwrap();
        }
        host.store
            .lock()
            .unwrap()
            .set_approvals(SESSION, mode)
            .unwrap();
        browser
            .request(
                "POST",
                "/api/commands",
                send_command(id, "Direct workspace edits"),
            )
            .await;
        let receipt = wait_for(&host, id, |r| {
            r.phase == Phase::Completed || !r.decisions.is_empty()
        })
        .await;
        assert!(
            receipt.decisions.is_empty(),
            "Ordinary Claude writes must apply directly"
        );
        assert_eq!(
            std::fs::read_to_string(target).unwrap(),
            "after\n".repeat(11000)
        );
        assert!(!dir.join("escape.txt").exists());
    }
    host.store
        .lock()
        .unwrap()
        .set_trust(&host.project, false)
        .unwrap();
    const INCOMPATIBLE: &str = "claude-sdk-changed-namespace";
    browser
        .request(
            "POST",
            "/api/commands",
            send_command(INCOMPATIBLE, "Do not deliver across namespaces"),
        )
        .await;
    let rejected = wait_for(&host, INCOMPATIBLE, |r| r.phase == Phase::Failed).await;
    assert_eq!(rejected.dispatch_ms, None);

    const UNTRUSTED: &str = "direct-claude-untrusted";
    let mut command = send_command(UNTRUSTED, "Untrusted workspace edit");
    command["fresh"] = json!(true);
    browser.request("POST", "/api/commands", command).await;
    let receipt = wait_for(&host, UNTRUSTED, |r| {
        r.phase == Phase::Completed || !r.decisions.is_empty()
    })
    .await;
    assert!(receipt.decisions.is_empty());
    assert!(!dir.join("project/untrusted.txt").exists());
}

fn assert_reused_grep(source_turn: &Receipt, later_turn: &Receipt) {
    let [decision] = later_turn.decisions.as_slice() else {
        panic!("Expected one recorded Grep invocation");
    };
    assert_eq!(decision.state, DecisionState::Delivered);
    assert!(decision.grant_consumed);
    assert_eq!(
        decision.native.as_ref().unwrap().resolution_provenance,
        Some(deck2_shared::PermissionProvenance::ReusedGrant {
            source_decision: source_turn.decisions[2].id.clone(),
        })
    );
}

async fn assert_new_grep_review(
    host: &App,
    browser: &Browser,
    session: &str,
    id: &str,
    prompt: &str,
) {
    let mut command = send_command(id, prompt);
    command["session"] = json!(session);
    browser.request("POST", "/api/commands", command).await;
    let receipt = wait_for(host, id, |r| !r.decisions.is_empty()).await;
    let decision = &receipt.decisions[0];
    assert_eq!(decision.state, DecisionState::Pending);
    browser
        .request(
            "POST",
            &format!("/api/decisions/{}/responses", decision.id),
            json!({
                "api": API, "command_id": Uuid::new_v4().to_string(),
                "expected_revision": decision.revision, "response": {"type":"deny"}
            }),
        )
        .await;
    let completed = wait_for(host, id, |r| r.phase == Phase::Completed).await;
    assert_eq!(completed.text, "Search denied");
    assert!(!completed.decisions[0].grant_consumed);
}

fn assert_inputs(dir: &Path, explicit_stop: bool) {
    let wire = std::fs::read_to_string(dir.join("wire")).unwrap();
    let frames = wire
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .collect::<Vec<_>>();
    // Host loss can close the SDK input pipe before the old process exits.
    // Both that interrupt and an explicit Stop belong to the original turn.
    let interrupts: Vec<_> = frames
        .iter()
        .filter(|frame| frame["message"]["request"]["subtype"] == "interrupt")
        .collect();
    assert!(interrupts.iter().all(|frame| frame["resume"] == false));
    if explicit_stop {
        assert!(!interrupts.is_empty());
    }
    let users: Vec<_> = frames
        .iter()
        .filter(|frame| frame["message"]["type"] == "user")
        .collect();
    assert_eq!(users.len(), 2);
    assert!(!frames.iter().any(|frame| {
        let reply = &frame["message"]["response"];
        reply["request_id"] == "permission-hold" && reply["response"]["behavior"] == "allow"
    }));
    assert_eq!(
        std::fs::read_to_string(dir.join("project/deny.txt")).unwrap(),
        "First line\nbefore\n"
    );
    assert_eq!(users[0]["message"]["message"]["content"], "First turn");
    assert_eq!(users[1]["message"]["message"]["content"], "Follow up");
    assert_eq!(users[0]["resume"], false);
    assert_eq!(users[1]["resume"], true);
    assert_eq!(users[0]["thread"], users[1]["thread"]);
    for user in users {
        assert_eq!(
            user["model"],
            if explicit_stop {
                json!("sonnet")
            } else {
                Value::Null
            }
        );
        assert_eq!(
            user["effort"],
            if explicit_stop {
                json!("high")
            } else {
                Value::Null
            }
        );
    }
}

// Oracle: independently admitted Claude and Codex members are separate native
// processes, so they must run together and leave the Lead free for the user.
async fn verify_parallel(host: &App, dir: &Path) {
    host.store.lock().unwrap().select_project_folder_with_trust(host.project.as_str(), true).unwrap();
    let browser = Browser::open(host).await;
    browser.request("POST", "/api/sessions", json!({
        "api":API,"id":SESSION,"title":"Parallel members","members":{
            "lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"},
            "investigate":{"runnerId":"codex","modelId":"gpt-6.1-sol"},
            "quality":{"runnerId":"codex","modelId":"gpt-6.1-sol"},
            "apply-deep":{"runnerId":"codex","modelId":"gpt-6.1-sol"},
        }
    })).await;
    for (revision, member) in [(1, "investigate"), (2, "quality")] {
        browser.request("POST", &format!("/api/sessions/{SESSION}/assignments"), json!({
            "api":API,"memberId":member,"expectedRevision":revision,
            "assignment":{"runnerId":"claude","modelId":"sonnet","thinking":"high"},
        })).await;
    }
    browser.request("POST", "/api/commands", send_command("delegates-three", "Delegate fixture parallel")).await;
    wait_for(host, "delegates-three", |r| r.phase == Phase::Completed).await;
    let ids: Vec<String> = std::fs::read_to_string(dir.join("parallel-tasks")).unwrap().lines().map(str::to_owned).collect();
    assert_eq!(ids.len(), 3);
    let pids = timeout(Duration::from_secs(8), async {
        loop {
            let store = host.store.lock().unwrap();
            let attempts: Vec<_> = ids.iter().map(|id| store.task(id).unwrap().attempts[0].clone()).collect();
            if attempts.iter().all(|a| a.phase == Phase::Running && a.native_pid.is_some()) {
                return attempts.iter().map(|a| a.native_pid.unwrap() as i32).collect::<Vec<_>>();
            }
            drop(store);
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("two Claude members and one Codex member never ran at the same time");
    let distinct: HashSet<_> = pids.iter().collect();
    assert_eq!(distinct.len(), 3, "each member owns its own native process");
    assert!(pids.iter().all(|pid| !process_group_stopped(*pid)), "all three processes are alive together");
    let claude_running = || std::fs::read_dir(&dir).unwrap().filter_map(Result::ok).filter(|e| e.file_name().to_string_lossy().starts_with("member-running-")).count();
    timeout(Duration::from_secs(8), async {
        while claude_running() < 2 || !dir.join("codex-member-running").is_file() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("both Claude native sessions and the Codex turn must be live together");
    assert_eq!(claude_running(), 2, "two distinct Claude native sessions");
    assert!(dir.join("codex-member-running").is_file());
    // The Lead is free: a new user message dispatches while all members run.
    browser.request("POST", "/api/commands", send_command("lead-stays-free", "Answer while members run")).await;
    wait_for(host, "lead-stays-free", |r| r.phase == Phase::Completed).await;
    assert!(ids.iter().all(|id| host.store.lock().unwrap().task(id).unwrap().attempts[0].phase == Phase::Running));
    let project = dir.join("project");
    member_git(&project, &["-c", "core.fsmonitor=false", "commit", "--only", "--allow-empty", "-m", "after-start commit"]);
    std::fs::write(project.join("after-start.txt"), "new after dispatch\n").unwrap();
    std::fs::write(dir.join("release-member"), "").unwrap();
    std::fs::write(dir.join("release-parallel"), "").unwrap();
    timeout(Duration::from_secs(10), async {
        loop {
            if ids.iter().all(|id| host.store.lock().unwrap().task(id).unwrap().attempts[0].phase == Phase::Completed) { return; }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.expect("parallel members did not settle");
}

#[tokio::test]
async fn claude_and_codex_members_run_simultaneously_while_lead_stays_free() {
    if BRIDGE.is_empty() {
        eprintln!("Build the embedded SDK first with bun run build");
        return;
    }
    run_member_fixture("codex", "parallel").await;
}

async fn member_state(browser: &Browser, session: &str, matches: impl Fn(&Value) -> bool) -> Value {
    timeout(Duration::from_secs(10), async {
        loop {
            let workspace = browser.request("GET", "/api/workspace", Value::Null).await;
            if let Some(task) = workspace["tasks"]
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["session"] == session && matches(t))
            {
                return task.clone();
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("Claude member state did not arrive")
}

async fn member_outcome(host: &App, task: &Value) -> Receipt {
    timeout(Duration::from_secs(10), async {
        loop {
            let outcomes = host
                .store
                .lock()
                .unwrap()
                .all()
                .unwrap()
                .into_iter()
                .filter(|r| {
                    r.continuation
                        .as_ref()
                        .is_some_and(|c| task["id"] == c.task)
                })
                .collect::<Vec<_>>();
            assert!(outcomes.len() <= 1);
            if let Some(outcome) = outcomes.into_iter().next() {
                let terminal = |r: &Receipt| !r.phase.active() && r.phase != Phase::Queued;
                let outcome = wait_for(host, &outcome.id, |r| {
                    r.phase == Phase::Running || terminal(r)
                })
                .await;
                if outcome.phase == Phase::Running && is_receipt(&outcome) {
                    let dir = Path::new(&host.project).parent().unwrap();
                    let task = task["id"].as_str().unwrap();
                    std::fs::write(dir.join(format!("claude-member-outcome-{task}")), "").unwrap();
                }
                return wait_for(host, &outcome.id, terminal).await;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("Exactly one Claude member outcome")
}

// Protects runner admission, member-scoped authority and its result lifecycle.
// Both Leads delegate through their native transports. Only native processes
// are fakes; the browser API, scheduler, MCP, store and Claude SDK are real.
#[tokio::test]
async fn claude_sdk_member_assignments_and_outcomes() {
    let Some(dir) = std::env::var_os("DECK2_MEMBER_FIXTURE").map(PathBuf::from) else {
        if BRIDGE.is_empty() {
            eprintln!("Build the embedded SDK first with bun run build");
            return;
        }
        for (runner, stage) in [("codex", "normal"), ("claude", "normal"), ("claude", "crash")] {
            run_member_fixture(runner, stage).await;
        }
        return;
    };
    let runner = std::env::var("DECK2_MEMBER_LEAD").unwrap();
    let host = app(&dir);
    let stage = std::env::var("DECK2_MEMBER_STAGE").unwrap_or_default();
    if stage == "parallel" {
        verify_parallel(&host, &dir).await;
        return;
    }
    if stage == "investigate-resume" {
        verify_investigate_resume(&host, &dir).await;
        return;
    }
    if stage == "guidance" {
        verify_guidance(&host, &dir, &runner).await;
        return;
    }
    if stage == "resume" {
        verify_member_resume(host, &dir, &runner).await;
        return;
    }
    if stage == "apply" {
        verify_bash(&host, &dir, &runner).await;
        return;
    }
    if stage == "restart" {
        let task = std::fs::read_to_string(dir.join("claude-member-complete")).unwrap();
        let a = &host.store.lock().unwrap().task(&task).unwrap().attempts[0].clone();
        assert_eq!(a.phase, Phase::Uncertain);
        let pid = a.native_pid.unwrap() as i32;
        assert!(!process_group_stopped(pid));
        host.pump_queue();
        assert_eq!(
            host.store.lock().unwrap().task(&task).unwrap().attempts[0].phase,
            Phase::Uncertain
        );
        std::fs::write(dir.join("release-member-after-restart"), "").unwrap();
        let outcome = member_outcome(&host, &json!({"id":task})).await;
        assert_eq!(outcome.phase, Phase::Completed, "{}", outcome.detail);
        assert_eq!(outcome.text, "Observed interrupted Claude member");
        let mut store = host.store.lock().unwrap();
        let settled = &store.task(&task).unwrap().attempts[0].clone();
        assert_eq!(settled.phase, Phase::Failed);
        assert!(settled.report.is_none() && settled.settled_ms.is_some());
        assert!(process_group_stopped(pid));
        store.enqueue_task_outcome(&task, &a.id).unwrap();
        assert_eq!(
            store
                .all()
                .unwrap()
                .iter()
                .filter(|r| r.continuation.is_some())
                .count(),
            1
        );
        assert_eq!(
            member_dispatches(&dir, a.native_session.as_deref().unwrap()),
            1
        );
        return;
    }
    host.store
        .lock()
        .unwrap()
        .select_project_folder_with_trust(host.project.as_str(), true)
        .unwrap();
    let browser = Browser::open(&host).await;
    browser.request("POST", "/api/sessions", json!({
        "api":API,"id":SESSION,"title":"Claude member fixture","members":{
            "lead":{"runnerId":runner,"modelId":if runner == RUNNER {"default"} else {"gpt-6.1-sol"}},
            "investigate":{"runnerId":"codex","modelId":"gpt-6.1-sol"},
        }
    })).await;
    let assigned = browser
        .request(
            "POST",
            &format!("/api/sessions/{SESSION}/assignments"),
            json!({
                "api":API,"memberId":"investigate","expectedRevision":1,
                "assignment":{"runnerId":"claude","modelId":"sonnet","thinking":"high"},
            }),
        )
        .await;
    assert_eq!(
        assigned["contract"]["members"]["investigate"]["thinking"],
        "high"
    );

    let id = "delegates-claude-member";
    let prompt = if runner == RUNNER {
        "delegate-claude-member"
    } else {
        "Delegate fixture investigate member"
    };
    browser
        .request("POST", "/api/commands", send_command(id, prompt))
        .await;
    if runner == RUNNER {
        wait_for(&host, id, |r| r.phase == Phase::Running).await;
        std::fs::write(dir.join("claude-member-lead-complete"), "").unwrap();
    }
    let origin = wait_for(&host, id, |r| r.phase == Phase::Completed).await;
    let running = member_state(&browser, SESSION, |t| {
        t["attempts"][0]["phase"] == "running"
            && t["attempts"][0]["first_output_ms"].is_number()
            && dir.join("member-scoped").is_file()
    })
    .await;
    assert_eq!(running["attempts"][0]["phase"], "running");
    let a = &running["attempts"][0];
    assert_eq!(a["provenance"]["runner"], RUNNER);
    assert_eq!(
        a["provenance"]["content"],
        digest(
            crate::session_roles::Role::packaged_instructions("investigate")
                .unwrap()
                .as_bytes()
        )
    );
    assert_eq!(a["configuration"]["native"]["runner"], RUNNER);
    assert_eq!(a["requested_model"], "sonnet");
    assert_eq!(a["observed_model"], "fixture-model");
    let native_session = std::fs::read_to_string(dir.join("member-scoped")).unwrap();
    assert_eq!(a["native_session"], native_session);
    assert_ne!(origin.thread.as_deref(), Some(native_session.as_str()));
    let task = running["id"].as_str().unwrap();
    let attempt = a["id"].as_str().unwrap();
    let exchanges = browser
        .request(
            "GET",
            &format!("/api/sessions/{SESSION}/tasks/{task}/attempts/{attempt}/exchanges?limit=32"),
            Value::Null,
        )
        .await;
    assert!(
        exchanges["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|message| message["role"] == "investigate" && message["text"] == "Partial")
    );

    if stage == "crash" {
        println!("Ready for Claude member host loss");
        std::future::pending::<()>().await;
    }
    let project = dir.join("project");
    member_git(&project, &["-c", "core.fsmonitor=false", "commit", "--only", "--allow-empty", "-m", "after-start commit"]);
    std::fs::write(project.join("after-start.txt"), "new after dispatch\n").unwrap();
    std::fs::write(dir.join("release-member"), "").unwrap();
    let outcome = member_outcome(&host, &running).await;
    assert_eq!(outcome.phase, Phase::Completed, "{}", outcome.detail);
    assert_eq!(outcome.thread, origin.thread);
    {
        let mut store = host.store.lock().unwrap();
        let completed = store.task(task).unwrap();
        let a = &completed.attempts[0];
        assert_eq!(a.report.as_ref().unwrap().text, "Claude member report");
        assert_eq!(a.treatments.len(), 1);
        assert!(a.settled_ms.is_some());
        assert!(process_group_stopped(a.native_pid.unwrap() as i32));
        store.enqueue_task_outcome(task, attempt).unwrap();
        store.enqueue_task_outcome(task, attempt).unwrap();
    }

    if runner == RUNNER {
        std::fs::remove_file(dir.join("member-scoped")).unwrap();
        browser
            .request(
                "POST",
                "/api/commands",
                send_command("lead-starts-member-stop", "delegate-claude-member-stop"),
            )
            .await;
        wait_for(&host, "lead-starts-member-stop", |r| {
            r.phase == Phase::Running
        })
        .await;
        std::fs::write(dir.join("claude-member-lead-stop"), "").unwrap();
        wait_for(&host, "lead-starts-member-stop", |r| {
            r.phase == Phase::Completed
        })
        .await;
        let running_stop = member_state(&browser, SESSION, |t| {
            t["id"] != task && dir.join("member-scoped").is_file()
        })
        .await;
        let cancelled_task = running_stop["id"].as_str().unwrap();
        let cancelled_attempt = running_stop["attempts"][0]["id"].as_str().unwrap();
        browser
            .request(
                "POST",
                &format!("/api/tasks/{cancelled_task}/attempts/{cancelled_attempt}/cancel"),
                json!({"api":API}),
            )
            .await;
        let cancelled = member_state(&browser, SESSION, |t| {
            t["id"] == cancelled_task && t["attempts"][0]["phase"] == "cancelled"
        })
        .await;
        assert!(dir.join("grant-revoked").is_file());
        assert!(cancelled["attempts"][0]["report"].is_null());
        assert!(process_group_stopped(
            cancelled["attempts"][0]["native_pid"].as_i64().unwrap() as i32
        ));
        let stop_outcome = member_outcome(&host, &cancelled).await;
        assert_eq!(stop_outcome.phase, Phase::Completed);
        assert_eq!(stop_outcome.text, "Observed stopped Claude member");
    }

    // Confirm durable provenance and that duplicate notification does not create
    // another native dispatch after reopening the state database.
    drop(browser);
    drop(host);
    let reopened = app(&dir);
    reopened.pump_queue();
    assert_eq!(member_outcome(&reopened, &running).await.id, outcome.id);
    assert_eq!(
        reopened.store.lock().unwrap().task(task).unwrap().attempts[0]
            .native_session
            .as_deref(),
        Some(native_session.as_str())
    );
    assert_eq!(member_dispatches(&dir, &native_session), 1);
}

#[tokio::test]
async fn claude_sdk_bash_approvals_and_outcomes() {
    if BRIDGE.is_empty() {
        eprintln!("Build the embedded SDK first with bun run build");
        return;
    }
    for runner in ["codex", "claude"] {
        run_member_fixture(runner, "apply").await;
    }
}

// The real SDK must use --resume with the previously acknowledged member
// session. The fixture's correction value exists only in that transcript.
#[tokio::test]
async fn codex_lead_resumes_claude_member() {
    if !BRIDGE.is_empty() {
        run_member_fixture("codex", "resume").await;
    }
}

// Protects live Lead guidance to a running Claude member through the real SDK
// bridge. Only the native processes are fixtures: no subscription is used.
#[tokio::test]
async fn codex_lead_guides_running_claude_member() {
    if !BRIDGE.is_empty() {
        run_member_fixture("codex", "guidance").await;
    }
}

#[tokio::test]
async fn claude_lead_guides_running_claude_member() {
    if !BRIDGE.is_empty() {
        run_member_fixture("claude", "guidance").await;
    }
}

#[tokio::test]
async fn claude_lead_resumes_claude_member() {
    if !BRIDGE.is_empty() {
        run_member_fixture("claude", "resume").await;
    }
}

#[tokio::test]
async fn claude_lead_resumes_adopted_investigation() {
    if BRIDGE.is_empty() {
        eprintln!("Build the embedded SDK first with bun run build");
        return;
    }
    run_member_fixture("claude", "investigate-resume").await;
}

async fn verify_investigate_resume(host: &App, dir: &Path) {
    host.store.lock().unwrap().select_project_folder_with_trust(&host.project, true).unwrap();
    let browser = Browser::open(host).await;
    browser.request("POST", "/api/sessions", json!({
        "api":API, "id":SESSION, "title":"Adopted investigation continuation",
        "members":{
            "lead":{"runnerId":"claude","modelId":"default"},
            "investigate":{"runnerId":"claude","modelId":"sonnet","thinking":"high"},
        },
    })).await;
    let first = resume_fixture_step(host, &browser, "seed", None, 1, Phase::Completed).await;
    assert_eq!(first.treatments.last().unwrap().disposition, "adopted");
    let task = std::fs::read_to_string(dir.join("resume-task")).unwrap();
    let thread = first.native_session.as_deref().unwrap();
    let key: String = host.project.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let transcript = dir.join(".claude/projects").join(key).join(format!("{thread}.jsonl"));
    let entry: Value = serde_json::from_str(&std::fs::read_to_string(&transcript).unwrap()).unwrap();
    let secret = entry["context"].as_str().unwrap();
    assert!(!first.report.as_ref().unwrap().text.contains(secret));

    for (step, number) in [("correct", 2), ("native", 3)] {
        let corrected = resume_fixture_step(host, &browser, step, Some(&task), number, Phase::Completed).await;
        assert_eq!(corrected.native_session.as_deref(), Some(thread));
        assert_ne!(corrected.authority, first.authority);
        assert_eq!(corrected.report.unwrap().text, secret);
        assert_eq!(member_dispatches(dir, thread), number);
    }

    std::fs::remove_file(transcript).unwrap();
    let missing = resume_fixture_step(host, &browser, "native", Some(&task), 4, Phase::Failed).await;
    assert!(missing.dispatch_ms.is_none());
    assert!(missing.report.is_none());
    assert_eq!(missing.treatments.len(), 1);
    assert_eq!(missing.treatments[0].disposition, "followup_required");
    assert!(missing.treatments[0].report.is_none());
    assert_eq!(member_dispatches(dir, thread), 3);
}

async fn verify_member_resume(host: App, dir: &Path, runner: &str) {
    host.store.lock().unwrap().select_project_folder_with_trust(&host.project, true).unwrap();
    let browser = Browser::open(&host).await;
    browser.request("POST", "/api/sessions", json!({
        "api":API, "id":SESSION, "title":"Claude member continuation fixture",
        "members":{
            "lead":{"runnerId":runner,"modelId":if runner == RUNNER {"default"} else {"gpt-6.1-sol"}},
            "apply-fast":{"runnerId":"claude","modelId":"sonnet","thinking":"high"},
        },
    })).await;
    let first = resume_fixture_step(&host, &browser, "seed", None, 1, Phase::Completed).await;
    let task = std::fs::read_to_string(dir.join("resume-task")).unwrap();
    let thread = first.native_session.as_ref().unwrap();
    assert_eq!(std::fs::read_to_string(dir.join("project/continuity.txt")).unwrap(), "first");

    drop(browser);
    drop(host);
    let host = app(dir);
    let browser = Browser::open(&host).await;
    let corrected = resume_fixture_step(&host, &browser, "correct", Some(&task), 2, Phase::Completed).await;
    assert_eq!(corrected.native_session.as_ref(), Some(thread));
    assert_ne!(corrected.authority, first.authority);
    assert_eq!(std::fs::read_to_string(dir.join("project/continuity.txt")).unwrap(), "context-from-transcript");
    assert_eq!(member_dispatches(dir, thread), 2);
    assert_ne!(corrected.native_message, first.native_message);
    if runner != RUNNER {
        return;
    }

    let read_selection = |a: &deck2_shared::TaskAttempt| {
        serde_json::from_str::<Value>(a.structured.as_deref().unwrap()).unwrap()["selection"].clone()
    };
    let fresh = resume_fixture_step(&host, &browser, "fresh", Some(&task), 3, Phase::Completed).await;
    assert_ne!(fresh.native_session.as_ref(), Some(thread));
    assert_eq!(read_selection(&fresh)["reason"], "forced-fresh");

    let assigned = browser.request("POST", &format!("/api/sessions/{SESSION}/assignments"), json!({
        "api":API, "memberId":"apply-fast", "expectedRevision":1,
        "assignment":{"runnerId":"claude","modelId":"sonnet","thinking":"low"},
    })).await;
    assert_eq!(assigned["contract"]["members"]["apply-fast"]["thinking"], "low");
    // The active session assignment cannot replace the recorded task assignment.
    // Change the disposable executable to exercise a genuine binding mismatch.
    use std::io::Write as _;
    writeln!(std::fs::OpenOptions::new().append(true).open(dir.join(RUNNER)).unwrap(),
        "# fixture executable identity changed").unwrap();
    let changed = resume_fixture_step(&host, &browser, "mismatch", Some(&task), 4, Phase::Completed).await;
    assert_ne!(changed.native_session, fresh.native_session);
    assert_eq!(read_selection(&changed)["reason"], "native-binding-mismatch");
    assert_eq!(changed.configuration.as_ref().unwrap().session_contract.as_ref().unwrap()
        .members["apply-fast"].thinking.as_deref(), Some("high"));

    let project = dir.join("project");
    let key: String = project.to_str().unwrap().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let transcript = |a: &deck2_shared::TaskAttempt| {
        dir.join(".claude/projects").join(&key).join(format!("{}.jsonl", a.native_session.as_deref().unwrap()))
    };
    std::fs::remove_file(transcript(&changed)).unwrap();
    let missing = resume_fixture_step(&host, &browser, "missing", Some(&task), 5, Phase::Completed).await;
    assert_ne!(missing.native_session, changed.native_session);
    assert_eq!(read_selection(&missing)["reason"], "native-session-not-found");
    assert_eq!(member_dispatches(dir, missing.native_session.as_deref().unwrap()), 1);

    let unavailable = transcript(&missing);
    let contents = std::fs::read(&unavailable).unwrap();
    std::fs::write(&unavailable, "corrupt").unwrap();
    let corrupt = resume_fixture_step(&host, &browser, "corrupt", Some(&task), 6, Phase::Failed).await;
    assert!(corrupt.dispatch_ms.is_none());
    assert_eq!(read_selection(&corrupt)["reason"], "native-transcript-unavailable");
    assert_eq!(member_dispatches(dir, missing.native_session.as_deref().unwrap()), 1);
    std::fs::write(&unavailable, contents).unwrap();

    let seed = resume_fixture_step(&host, &browser, "fresh", Some(&task), 7, Phase::Completed).await;
    let foreign = resume_fixture_step(&host, &browser, "foreign", Some(&task), 8, Phase::Failed).await;
    assert!(foreign.dispatch_ms.is_some());
    assert!(foreign.native_session.is_none() && foreign.report.is_none());
    assert_eq!(member_dispatches(dir, seed.native_session.as_deref().unwrap()), 2);
    assert_eq!(std::fs::read_to_string(project.join("continuity.txt")).unwrap(), "fresh");
    let wire = std::fs::read_to_string(dir.join("wire")).unwrap();
    assert_eq!(wire.lines().filter(|line| {
        let row: Value = serde_json::from_str(line).unwrap();
        row["message"]["type"] == "user" && row["message"]["message"]["content"]
            .as_str().is_some_and(|prompt| prompt.ends_with("continuity-foreign"))
    }).count(), 1);
}

async fn resume_fixture_step(
    host: &App, browser: &Browser, step: &str, task: Option<&str>, number: usize, expected: Phase,
) -> deck2_shared::TaskAttempt {
    let prompt = format!("member-resume-{step}");
    let id = format!("{prompt}-{number}");
    browser.request("POST", "/api/commands", send_command(&id, &prompt)).await;
    let dir = Path::new(&host.project).parent().unwrap();
    let claude_lead = std::env::var("DECK2_MEMBER_LEAD").as_deref() == Ok(RUNNER);
    if claude_lead {
        wait_for(host, &id, |r| r.phase == Phase::Running).await;
        std::fs::write(dir.join(format!("resume-lead-{step}")), "").unwrap();
    }
    let lead = wait_for(host, &id, |r| !r.phase.active() && r.phase != Phase::Queued).await;
    assert_eq!(lead.phase, Phase::Completed, "{step}: {}", lead.detail);
    let row = member_state(browser, SESSION, |t| {
        task.is_none_or(|task| t["id"] == task)
            && t["attempts"][number - 1]["settled_ms"].is_number()
    }).await;
    let task = row["id"].as_str().unwrap();
    let a = host.store.lock().unwrap().task(task).unwrap().attempts[number - 1].clone();
    assert_eq!(a.phase, expected, "{step}: {}", a.detail);
    let outcome = timeout(Duration::from_secs(10), async {
        loop {
            if let Some(r) = host.store.lock().unwrap().all().unwrap().into_iter().find(
                |r| r.continuation.as_ref().is_some_and(|c| c.task == task && c.attempt == a.id)
            ) { break r.id; }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.unwrap();
    if claude_lead {
        wait_for(host, &outcome, |r| r.phase == Phase::Running).await;
        std::fs::write(dir.join(format!("resume-outcome-{number}")), "").unwrap();
    }
    let completed = wait_for(host, &outcome, |r| !r.phase.active() && r.phase != Phase::Queued).await;
    assert_eq!(completed.phase, Phase::Completed, "{}", completed.detail);
    assert_eq!(host.store.lock().unwrap().all().unwrap().iter().filter(|r|
        r.continuation.as_ref().is_some_and(|c| c.task == task && c.attempt == a.id)
    ).count(), 1);
    host.store.lock().unwrap().task(task).unwrap().attempts[number - 1].clone()
}

async fn run_member_fixture(runner: &str, stage: &str) {
    let dir = tempfile::tempdir().unwrap();
    let node = node_runtime().unwrap().canonicalize().unwrap();
    symlink(node, dir.path().join("node")).unwrap();
    let cli = dir.path().join(RUNNER);
    std::fs::write(&cli, include_str!("../tests/fake_claude_sdk.py")).unwrap();
    std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap();
    let codex = dir.path().join("codex");
    std::fs::write(
        &codex,
        include_str!("../tests/fake_session_native.py").replacen(
            "#!/usr/bin/env python3",
            "#!/usr/bin/python3",
            1,
        ),
    )
    .unwrap();
    std::fs::set_permissions(&codex, std::fs::Permissions::from_mode(0o700)).unwrap();
    let primary = dir.path().join("primary");
    std::fs::create_dir(&primary).unwrap();
    member_git(&primary, &["init", "-b", "main"]);
    std::fs::write(primary.join("CLAUDE.md"), "Fixture only.").unwrap();
    std::fs::write(primary.join("tracked.txt"), "base\n").unwrap();
    member_git(&primary, &["add", "."]);
    member_git(&primary, &["commit", "-m", "base commit"]);
    member_git(&primary, &["worktree", "add", "-b", "linked", "../project"]);
    let project = dir.path().join("project");
    if matches!(stage, "resume" | "investigate-resume") {
        std::fs::write(dir.path().join("resume-fixture"), "").unwrap();
    }
    if stage == "investigate-resume" {
        std::fs::write(dir.path().join("investigate-resume-fixture"), "").unwrap();
    }
    if stage == "parallel" {
        std::fs::write(dir.path().join("parallel-fixture"), "").unwrap();
    }
    if stage == "apply" {
        std::fs::write(dir.path().join("apply-fixture"), "").unwrap();
        std::fs::write(project.join("Makefile"),
            "test:\n\t@test \"$$(cat expected.txt)\" = edited\n\t@echo test-passed\n"
        ).unwrap();
    }
    member_git(&primary, &["commit", "--allow-empty", "-m", "main-only commit"]);
    member_git(&project, &["commit", "--allow-empty", "-m", "linked-only commit"]);
    std::fs::write(project.join("tracked.txt"), "updated\n").unwrap();
    std::fs::write(project.join("untracked.txt"), "new\n").unwrap();
    std::fs::write(primary.join("primary-only.txt"), "not assigned").unwrap();
    std::fs::write(project.join("staged.txt"), "staged\n").unwrap();
    member_git(&project, &["add", "staged.txt"]);
    let helper = dir.path().join("git-helper");
    std::fs::write(&helper, format!("#!/bin/sh\ntouch '{}'\n", dir.path().join("unexpected-git-helper").display())).unwrap();
    std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o700)).unwrap();
    member_git(&primary, &["config", "core.fsmonitor", helper.to_str().unwrap()]);
    let command = |stage: &str| {
        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "claude::tests::claude_sdk_member_assignments_and_outcomes", "--nocapture"])
            .env_clear()
            .env("DECK2_MEMBER_FIXTURE", dir.path())
            .env("DECK2_MEMBER_LEAD", runner)
            .env("DECK2_MEMBER_STAGE", stage)
            .env("HOME", dir.path())
            .env("PATH", dir.path())
            .kill_on_drop(true);
        command
    };
    let stage = if stage == "crash" {
        std::fs::write(dir.path().join("member-crash"), "").unwrap();
        let mut child = command("crash").stdout(Stdio::piped()).spawn().unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        timeout(Duration::from_secs(15), async {
            while let Some(line) = lines.next_line().await.unwrap() {
                if line == "Ready for Claude member host loss" {
                    return;
                }
            }
            panic!("Claude member fixture exited before the member was running");
        })
        .await
        .unwrap();
        child.kill().await.unwrap();
        "restart"
    } else {
        stage
    };
    let result = command(stage).output().await.unwrap();
    assert!(
        result.status.success(),
        "{runner}/{stage}: {}\n{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr),
        std::fs::read_to_string(dir.path().join("fixture-error")).unwrap_or_default(),
    );
}

async fn resolve_bash(
    host: &App, browser: &Browser, origin: &str, command: Option<&str>, allow: bool,
) {
    let receipt = timeout(Duration::from_secs(10), async {
        loop {
            let receipt = host.receipt(origin).unwrap();
            if receipt.decisions.iter().any(|d| d.state == DecisionState::Pending) {
                return receipt;
            }
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
    }).await.expect("Native Bash should enter Deck's review flow");
    let decision = receipt.decisions.iter().find(|d| d.state == DecisionState::Pending).unwrap();
    let issued: Value = serde_json::from_str(&decision.native.as_ref().unwrap().parameters).unwrap();
    let plain = issued["_meta"]["tool_params"]["command"].as_str().is_some_and(crate::permission_bounds::bash_reusable);
    assert_eq!(decision.native.as_ref().unwrap().identity.is_some(), plain, "only plain Bash is host-identified for session consent");
    if let Some(command) = command {
        let parameters: Value = serde_json::from_str(&decision.native.as_ref().unwrap().parameters).unwrap();
        assert_eq!(parameters["_meta"]["tool_params"]["command"], command);
    }
    browser.request("POST", &format!("/api/decisions/{}/responses", decision.id), json!({
        "api":API, "command_id":Uuid::new_v4().to_string(), "expected_revision":decision.revision,
        "response":{"type":if allow {"allow_once"} else {"deny"}},
    })).await;
}

// Protects single-use Bash consent, both delegation paths and owned teardown.
// The external CLI wire fixture starts real make and shell processes after SDK
// authorization. Installed Claude Code is exercised separately.
async fn verify_bash(host: &App, dir: &Path, runner: &str) {
    host.store.lock().unwrap().select_project_folder_with_trust(&host.project, true).unwrap();
    let browser = Browser::open(host).await;
    browser.request("POST", "/api/sessions", json!({
        "api":API, "id":SESSION, "title":"Claude Bash fixture",
        "members":{
            "lead":{"runnerId":runner,"modelId":if runner == RUNNER {"default"} else {"gpt-6.1-sol"}},
            "apply-fast":{"runnerId":"claude","modelId":"sonnet","thinking":"high"},
        },
    })).await;
    let root = "apply-fixture-origin";
    let prompt = if runner == RUNNER { "delegate-claude-apply" } else { "Delegate fixture apply-fast member" };
    browser.request("POST", "/api/commands", send_command(root, prompt)).await;
    if runner == RUNNER {
        wait_for(host, root, |r| r.phase == Phase::Running).await;
        std::fs::write(dir.join("claude-apply-lead-running"), "").unwrap();
    }
    let origin = wait_for(host, root, |r| r.phase == Phase::Completed).await;
    resolve_bash(host, &browser, root, Some("touch should-not-exist"), false).await;
    resolve_bash(host, &browser, root, Some("make test"), true).await;
    // Two related member Bash requests: choose the offered family on the first.
    {
        let receipt = timeout(Duration::from_secs(10), async { loop {
            let r = host.receipt(root).unwrap();
            if r.decisions.iter().any(|d| d.state == DecisionState::Pending && d.id != "") && r.decisions.iter().filter(|d| d.state == DecisionState::Pending).count() > 0 { return r; }
            tokio::time::sleep(Duration::from_millis(15)).await;
        }}).await.unwrap();
        let d = receipt.decisions.iter().find(|d| d.state == DecisionState::Pending).unwrap();
        let shown = browser.request("GET", "/api/workspace", Value::Null).await["receipts"].as_array().unwrap().iter()
            .find(|v| v["id"] == root).unwrap()["decisions"].as_array().unwrap().iter().find(|v| v["id"] == d.id).unwrap().clone();
        let options = shown["presentation"]["permission_policy"]["options"].as_array().cloned().unwrap_or_default();
        let family = options.last().filter(|o| o["kind"] != "exact").expect("member Bash should offer a family option").clone();
        assert_eq!(family["kind"], "bash_prefix");
        browser.request("POST", &format!("/api/decisions/{}/responses", d.id), json!({
            "api":API, "command_id":Uuid::new_v4().to_string(), "expected_revision":d.revision,
            "response":{"type":"allow_session"}, "scope_option_id":family["id"].clone(),
        })).await;
        let delegated = member_state(&browser, SESSION, |task| task["owner"] == "apply-fast").await;
        let task = delegated["id"].as_str().unwrap().to_owned();
        let outcome = member_outcome(host, &json!({"id":task})).await;
        assert_eq!(outcome.phase, Phase::Completed, "{}", outcome.detail);
        let r = host.receipt(root).unwrap();
        let cargo: Vec<_> = r.decisions.iter().filter(|d| d.native.as_ref().is_some_and(|n| n.parameters.contains("cargo test"))).collect();
        let reused = cargo.iter().filter(|d| matches!(d.native.as_ref().unwrap().resolution_provenance, Some(deck2_shared::PermissionProvenance::ReusedGrant { .. }))).count();
        eprintln!("MEMBER-BASH-COUNTS visible_prompts=1 cargo_decisions={} reused={reused}", cargo.len());
        assert_eq!((cargo.len(), reused), (2, 1));
    }
    let delegated = member_state(&browser, SESSION, |task| task["owner"] == "apply-fast").await;
    let task = delegated["id"].as_str().unwrap().to_owned();
    let outcome = member_outcome(host, &json!({"id":task})).await;
    assert_eq!(outcome.phase, Phase::Completed, "{}", outcome.detail);
    assert_eq!(outcome.thread, origin.thread);
    assert!(!dir.join("project/should-not-exist").exists());
    assert!(!dir.join("project/unsafe").exists());
    {
        let mut store = host.store.lock().unwrap();
        let attempt = store.task(&task).unwrap().attempts.remove(0);
        assert_eq!(attempt.report.unwrap().text, "make test exited 0: test-passed");
        assert!(process_group_stopped(attempt.native_pid.unwrap() as i32));
        store.enqueue_task_outcome(&task, &attempt.id).unwrap();
        store.enqueue_task_outcome(&task, &attempt.id).unwrap();
        assert_eq!(store.all().unwrap().iter().filter(|r| r.continuation.as_ref().is_some_and(|c| c.task == task)).count(), 1);
    }
    if runner != RUNNER {
        return;
    }
    browser.request("POST", "/api/commands", send_command("direct-claude-bash", "lead-make")).await;
    resolve_bash(host, &browser, "direct-claude-bash", Some("make test"), true).await;
    assert_eq!(wait_for(host, "direct-claude-bash", |r| r.phase == Phase::Completed).await.text,
        "make test exited 0: test-passed");

    let other = "bash-independent";
    browser.request("POST", "/api/sessions", json!({
        "api":API, "id":other, "title":"Independent session",
        "members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}},
    })).await;
    let mut independent = send_command("other-session", "Waiting-policy hold bash-independent");
    independent["session"] = json!(other);
    browser.request("POST", "/api/commands", independent).await;
    wait_for(host, "other-session", |r| r.phase == Phase::Running).await;
    browser.request("POST", "/api/commands", send_command("stop-claude-bash", "lead-bash-hold")).await;
    resolve_bash(host, &browser, "stop-claude-bash", None, true).await;
    let descendant = timeout(Duration::from_secs(8), async {
        loop {
            if let Ok(pid) = std::fs::read_to_string(dir.join("bash-descendant"))
                && let Ok(pid) = pid.trim().parse::<i32>() {
                    return pid;
                }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.unwrap();
    assert!(descendant > 1 && !absent(descendant));
    browser.request("POST", "/api/commands/stop-claude-bash/cancel", Value::Null).await;
    let stopped = wait_for(host, "stop-claude-bash", |r| r.phase == Phase::Cancelled).await;
    assert!(absent(descendant));
    assert!(process_group_stopped(stopped.native_pid.unwrap() as i32));
    assert_eq!(host.receipt("other-session").unwrap().phase, Phase::Running);
    std::fs::write(dir.join("release-bash-independent"), "").unwrap();
    wait_for(host, "other-session", |r| r.phase == Phase::Completed).await;
}

// The fixture Lead executes the tool calls this test writes, over its own
// authenticated session MCP transport.
async fn drive(dir: &Path, serial: &mut usize, name: &str, arguments: Value) -> Value {
    let request = dir.join(format!("drive-{serial}.json"));
    let output = dir.join(format!("drive-{serial}.out"));
    *serial += 1;
    let staged = request.with_extension("stage");
    std::fs::write(&staged, json!({"name":name,"arguments":arguments}).to_string()).unwrap();
    std::fs::rename(staged, &request).unwrap();
    timeout(Duration::from_secs(30), async {
        loop {
            if let Ok(text) = std::fs::read_to_string(&output) {
                return serde_json::from_str::<Value>(&text).unwrap();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("Lead fixture did not answer")
}

// A tool-level error is returned as such; success is the tool's JSON body.
fn driven(reply: &Value) -> Result<Value, String> {
    let result = reply.get("result").unwrap_or(reply);
    let text = result["content"][0]["text"].as_str().unwrap_or("").to_owned();
    if reply.get("error").is_some() || result["isError"] == true {
        return Err(text);
    }
    Ok(serde_json::from_str(&text).unwrap())
}

fn wire_rows(dir: &Path) -> Vec<Value> {
    std::fs::read_to_string(dir.join("wire")).unwrap().lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|row| row["message"]["type"] == "user")
        .collect()
}

fn steers(dir: &Path, thread: &str) -> Vec<Value> {
    wire_rows(dir).into_iter()
        .filter(|row| row["thread"] == thread && row["message"]["priority"] == "next")
        .collect()
}

// Oracle: the member's own native session receives the Lead's correction once,
// the original dispatch is never repeated, and every other target is refused.
async fn verify_guidance(host: &App, dir: &Path, runner: &str) {
    host.store.lock().unwrap().select_project_folder_with_trust(host.project.as_str(), true).unwrap();
    let browser = Browser::open(host).await;
    browser.request("POST", "/api/sessions", json!({
        "api":API,"id":SESSION,"title":"Member guidance","members":{
            "lead":{"runnerId":runner,"modelId":if runner == RUNNER {"default"} else {"gpt-6.1-sol"}},
            "investigate":{"runnerId":"codex","modelId":"gpt-6.1-sol"},
            "quality":{"runnerId":"codex","modelId":"gpt-6.1-sol"},
        }
    })).await;
    crate::member_guidance::set_confirm_window_for_test(1500);
    for (revision, member) in [(1, "investigate"), (2, "quality")] {
        browser.request("POST", &format!("/api/sessions/{SESSION}/assignments"), json!({
            "api":API,"memberId":member,"expectedRevision":revision,
            "assignment":{"runnerId":"claude","modelId":"sonnet","thinking":"high"},
        })).await;
    }
    browser.request("POST", "/api/commands", send_command("drives-lead", "Drive Lead tools")).await;
    wait_for(host, "drives-lead", |r| r.phase == Phase::Running).await;
    timeout(Duration::from_secs(8), async { while !dir.join("drive-lead").is_file() { tokio::time::sleep(Duration::from_millis(10)).await; } })
        .await.expect("Lead fixture is not driving tools");
    let mut n = 0;
    let first = driven(&drive(dir, &mut n, "deck_delegate", json!({"agent":"investigate","task":"Hold Claude member for guidance"})).await).unwrap();
    let second = driven(&drive(dir, &mut n, "deck_delegate", json!({"agent":"quality","task":"Hold Claude member for withheld guidance"})).await).unwrap();
    let (first, second) = (first["taskId"].as_str().unwrap().to_owned(), second["taskId"].as_str().unwrap().to_owned());
    let attempt = |task: &str| host.store.lock().unwrap().task(task).unwrap().attempts[0].clone();
    timeout(Duration::from_secs(15), async {
        loop {
            let ready = |task: &str| { let a = attempt(task); a.phase == Phase::Running && a.guidance_open && dir.join(format!("member-running-{}", a.native_session.clone().unwrap_or_default())).is_file() };
            if ready(&first) && ready(&second) { return; }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.expect("both Claude members must be running and open to guidance");
    let (a, b) = (attempt(&first), attempt(&second));
    let (a_thread, b_thread) = (a.native_session.clone().unwrap(), b.native_session.clone().unwrap());
    assert_ne!(a_thread, b_thread);
    assert_eq!(a.native_message.as_deref(), Some(a.id.as_str()));
    let args = |task: &str, att: &str, thread: &str, turn: &str, text: &str| json!({
        "taskId":task,"attemptId":att,"threadId":thread,"expectedTurnId":turn,
        "commandId":Uuid::new_v4().to_string(),"text":text});
    let status = |reply: &Value| driven(reply).unwrap()["status"].as_str().unwrap().to_owned();

    // Wrong or stale targets never reach any native process.
    for wrong in [
        args(&first, &a.id, &b_thread, &a.id, "wrong thread"),
        args(&first, &a.id, &a_thread, &b.id, "wrong turn"),
        args(&first, &Uuid::new_v4().to_string(), &a_thread, &a.id, "wrong attempt"),
        args(&second, &a.id, &a_thread, &a.id, "wrong task"),
        args("unknown-task", &a.id, &a_thread, &a.id, "unknown task"),
    ] {
        assert_eq!(status(&drive(dir, &mut n, "deck_task_guide", wrong).await), "undelivered");
    }
    assert!(wire_rows(dir).iter().all(|row| row["message"]["priority"] != "next"));

    // A correction reaches only the addressed member, once, and retries are idempotent.
    let correction = args(&first, &a.id, &a_thread, &a.id, "Use the v2 schema");
    let accepted = driven(&drive(dir, &mut n, "deck_task_guide", correction.clone()).await).unwrap();
    assert_eq!(accepted["status"], "accepted");
    assert_eq!(accepted["threadId"], a_thread);
    assert_eq!(status(&drive(dir, &mut n, "deck_task_guide", correction.clone()).await), "accepted");
    let mut changed = correction.clone();
    changed["text"] = json!("Use the v3 schema");
    assert!(driven(&drive(dir, &mut n, "deck_task_guide", changed).await).is_err());
    let delivered = steers(dir, &a_thread);
    assert_eq!(delivered.len(), 1, "accepted guidance is written once");
    let message = &delivered[0]["message"];
    assert_eq!(message["uuid"], correction["commandId"]);
    assert_eq!(message["session_id"], json!(a_thread));
    assert!(message["message"]["content"].as_str().unwrap().starts_with("Deck live guidance from Lead"));
    assert!(steers(dir, &b_thread).is_empty(), "the other member is isolated");

    let settled = timeout(Duration::from_secs(10), async {
        loop {
            let a = attempt(&first);
            if a.phase == Phase::Completed { return a; }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.expect("corrected member did not complete");
    let report = &settled.report.as_ref().unwrap().text;
    assert_eq!(report, "Claude member report corrected: Use the v2 schema");
    assert_eq!(report.matches("v2 schema").count(), 1);
    assert_eq!(settled.id, a.id);
    assert_eq!(settled.native_session, a.native_session);
    assert_eq!(settled.native_pid, a.native_pid);
    assert!(!settled.guidance_open);
    assert_eq!(settled.guidance.len(), 1);
    assert_eq!(settled.guidance[0].input.state, SteeringState::Accepted);
    let original = wire_rows(dir).into_iter().filter(|row| row["thread"] == json!(a_thread) && row["message"]["priority"] != "next").count();
    assert_eq!(original, 1, "the assignment is never replayed");
    // Late guidance after settlement is a definite non-delivery.
    assert_eq!(status(&drive(dir, &mut n, "deck_task_guide", args(&first, &a.id, &a_thread, &a.id, "too late")).await), "undelivered");
    assert_eq!(steers(dir, &a_thread).len(), 1);

    // The second member never consumes its input: delivery is truthfully unknown.
    let withheld = args(&second, &b.id, &b_thread, &b.id, "echo-withheld please change course");
    assert_eq!(status(&drive(dir, &mut n, "deck_task_guide", withheld.clone()).await), "unknown");
    assert_eq!(status(&drive(dir, &mut n, "deck_task_guide", withheld.clone()).await), "unknown");
    assert_eq!(steers(dir, &b_thread).len(), 1, "unknown guidance is never replayed");
    assert_eq!(status(&drive(dir, &mut n, "deck_task_guide", args(&second, &b.id, &b_thread, &b.id, "after unknown")).await), "undelivered");
    let uncorrected = timeout(Duration::from_secs(10), async {
        loop {
            let b = attempt(&second);
            if b.phase == Phase::Completed { return b; }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.expect("withheld member did not complete");
    assert_eq!(uncorrected.report.as_ref().unwrap().text, "Claude member report uncorrected");
    assert_eq!(uncorrected.guidance[0].input.state, SteeringState::Uncertain);
    assert!(steers(dir, &a_thread).iter().all(|row| row["message"]["uuid"] != withheld["commandId"]));
    assert_eq!(steers(dir, &a_thread).len(), 1);

    // A receipt that lands after the window reconciles the exact input on the
    // same attempt. The caller sees "unknown" first and is never replayed to.
    let third = driven(&drive(dir, &mut n, "deck_delegate", json!({"agent":"investigate","task":"Hold Claude member for delayed guidance"})).await).unwrap()["taskId"].as_str().unwrap().to_owned();
    timeout(Duration::from_secs(15), async {
        loop {
            let c = attempt(&third);
            if c.phase == Phase::Running && c.guidance_open && dir.join(format!("member-running-{}", c.native_session.clone().unwrap_or_default())).is_file() { return; }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.expect("delayed member must be running and open to guidance");
    let c = attempt(&third);
    let c_thread = c.native_session.clone().unwrap();
    assert_ne!(c_thread, a_thread);
    let delayed = args(&third, &c.id, &c_thread, &c.id, "Use the delayed v4 schema");
    assert_eq!(status(&drive(dir, &mut n, "deck_task_guide", delayed.clone()).await), "unknown");
    let held = attempt(&third);
    assert_eq!(held.phase, Phase::Running);
    assert_eq!(held.guidance[0].input.state, SteeringState::Uncertain, "a foreign receipt settles nothing");
    std::fs::write(dir.join("release-delayed-echo"), "").unwrap();
    let late = timeout(Duration::from_secs(10), async {
        loop {
            let c = attempt(&third);
            if c.phase == Phase::Completed { return c; }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.expect("delayed member did not complete");
    assert_eq!(late.guidance[0].input.state, SteeringState::Accepted);
    assert_eq!((late.id.as_str(), late.native_session.as_deref()), (c.id.as_str(), Some(c_thread.as_str())));
    assert_eq!(late.report.as_ref().unwrap().text, "Claude member report delayed: Use the delayed v4 schema");
    assert_eq!(steers(dir, &c_thread).len(), 1, "late receipts never replay the input");
    assert_eq!(status(&drive(dir, &mut n, "deck_task_guide", delayed.clone()).await), "accepted");
    assert_eq!(steers(dir, &c_thread).len(), 1);
    let exchange = browser.request("GET", &format!("/api/sessions/{SESSION}/tasks/{third}/attempts/{}/exchanges?limit=32", c.id), Value::Null).await;
    let rows: Vec<_> = exchange["messages"].as_array().unwrap().iter().filter(|m| m["source"] == "lead-guidance").map(|m| m["delivery"].as_str().unwrap()).collect();
    assert_eq!(rows, ["accepted"]);

    // The public exchange shows each Lead input with its truthful delivery.
    for (task, att, text, delivery) in [(&first, &a.id, "Use the v2 schema", "accepted"), (&second, &b.id, "echo-withheld please change course", "unknown")] {
        let exchange = browser.request("GET", &format!("/api/sessions/{SESSION}/tasks/{task}/attempts/{att}/exchanges?limit=32"), Value::Null).await;
        let rows: Vec<_> = exchange["messages"].as_array().unwrap().iter().filter(|m| m["source"] == "lead-guidance").map(|m| (m["role"].as_str().unwrap(), m["delivery"].as_str().unwrap(), m["text"].as_str().unwrap())).collect();
        assert_eq!(rows, [("lead", delivery, text)]);
    }
    assert!(host.receipt("drives-lead").unwrap().decisions.is_empty(), "guidance resolves no decision");
    std::fs::write(dir.join("drive-stop"), "").unwrap();
    wait_for(host, "drives-lead", |r| r.phase == Phase::Completed).await;
}

fn member_git(root: &Path, args: &[&str]) {
    let output = std::process::Command::new("/usr/bin/git")
        .current_dir(root)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .args(["-c", "user.name=Deck Fixture", "-c", "user.email=deck@example.invalid"])
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "{args:?}: {}", String::from_utf8_lossy(&output.stderr));
}

fn member_dispatches(dir: &Path, native_session: &str) -> usize {
    std::fs::read_to_string(dir.join("wire"))
        .unwrap()
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|row| row["thread"] == native_session && row["message"]["type"] == "user")
        .count()
}

// Protects Codex session consent: choosing the offered argv_prefix family on the
// first native commandExecution approval releases a related second approval
// without a second visible prompt. The oracle is the native wire reply log.
#[tokio::test]
async fn codex_command_family_consent_is_reused_over_native_wire() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("project")).unwrap();
    let codex = dir.path().join("codex");
    std::fs::write(&codex, include_str!("../tests/fake_session_native.py").replacen("#!/usr/bin/env python3", "#!/usr/bin/python3", 1)).unwrap();
    std::fs::set_permissions(&codex, std::fs::Permissions::from_mode(0o700)).unwrap();
    let host = app(dir.path());
    host.store.lock().unwrap().select_project_folder_with_trust(&host.project, true).unwrap();
    let browser = Browser::open(&host).await;
    browser.request("POST", "/api/sessions", json!({"api":API,"id":SESSION,"title":"Codex family",
        "members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).await;
    let root = "codex-family";
    browser.request("POST", "/api/commands", send_command(root, "Native cargo pair")).await;
    let mut prompts = 0;
    let receipt = loop {
        let r = wait_for(&host, root, |r| r.phase == Phase::Completed || r.decisions.iter().any(|d| d.state == DecisionState::Pending)).await;
        let Some(d) = r.decisions.iter().find(|d| d.state == DecisionState::Pending) else { break r };
        prompts += 1;
        let shown = browser.request("GET", "/api/workspace", Value::Null).await["receipts"].as_array().unwrap().iter()
            .find(|v| v["id"] == root).unwrap()["decisions"].as_array().unwrap().iter().find(|v| v["id"] == d.id).unwrap().clone();
        let options = shown["presentation"]["permission_policy"]["options"].as_array().cloned().unwrap_or_default();
        let family = options.iter().find(|o| o["kind"] == "argv_prefix").unwrap_or_else(|| panic!("no argv_prefix in {options:?}"));
        browser.request("POST", &format!("/api/decisions/{}/responses", d.id), json!({"api":API,
            "command_id":Uuid::new_v4().to_string(),"expected_revision":d.revision,
            "response":{"type":"allow_session"},"scope_option_id":family["id"].clone()})).await;
    };
    let reused = receipt.decisions.iter().filter(|d| matches!(d.native.as_ref().unwrap().resolution_provenance, Some(deck2_shared::PermissionProvenance::ReusedGrant { .. }))).count();
    let wire = std::fs::read_to_string(dir.path().join("cargo-replies")).unwrap();
    eprintln!("CODEX-COUNTS visible_prompts={prompts} decisions={} reused={reused} wire={wire:?}", receipt.decisions.len());
    assert_eq!((prompts, receipt.decisions.len(), reused), (1, 2, 1));
    assert_eq!(wire.lines().count(), 2);
    assert!(wire.lines().all(|l| l.contains("accept")), "{wire}");
}
