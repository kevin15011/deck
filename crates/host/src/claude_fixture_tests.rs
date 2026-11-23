use super::*;
use deck2_shared::API;
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

fn open(dir: &Path, transport: &Transport) -> App {
    let app = App::new(
        Store::open(&dir.join("state.db"), dir.to_str().unwrap()).unwrap(),
        "127.0.0.1:32121".into(),
        dir.join("absent-codex"),
        Some("Codex absent".into()),
        "admin".into(),
        "recover".into(),
    );
    *app.scope_root.lock().unwrap() = Some(dir.join("scopes"));
    *app.claude_transport.lock().unwrap() = Some(transport.clone());
    app
}

fn admit(app: &App, id: &str, prompt: &str) {
    let command = serde_json::from_value(json!({
        "api": API, "id": id, "session": "claude-fixture-session",
        "prompt": prompt, "mode": "session_v1", "queue": true, "fresh": false
    }))
    .unwrap();
    assert_eq!(
        app.store.lock().unwrap().admit(&command).unwrap().phase,
        Phase::Queued
    );
}

async fn call(calls: &mut mpsc::Receiver<Invocation>, receipt: &str) -> Invocation {
    let invocation = tokio::time::timeout(Duration::from_secs(3), calls.recv())
        .await
        .expect("Deck did not pump the queued turn")
        .unwrap();
    assert_eq!(invocation.receipt, receipt);
    invocation
}

async fn wait_for(app: &App, id: &str, condition: impl Fn(&Receipt) -> bool) -> Receipt {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let r = app.receipt(id).unwrap();
            if condition(&r) {
                return r;
            }
            assert!(
                r.phase.active(),
                "Unexpected settlement: {:?} {}",
                r.phase,
                r.detail
            );
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("Fixture receipt did not reach the requested state")
}

async fn init(invocation: &Invocation) {
    invocation
        .frames
        .send(json!({
            "type": "system", "subtype": "init", "session_id": invocation.thread,
        }))
        .await
        .unwrap();
}

// Protects exact-once input, output before settlement, and durable native
// namespace across an interrupted session and a host restart.
#[tokio::test]
async fn lead_streams_interrupts_and_restarts_without_replay() {
    const NAME: &str = "claude_fixture::tests::lead_streams_interrupts_and_restarts_without_replay";
    let Some(dir) = std::env::var_os("DECK2_CLAUDE_FIXTURE_CHILD").map(PathBuf::from) else {
        let d = tempfile::tempdir().unwrap();
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", NAME, "--nocapture"])
            .env_clear()
            .env("DECK2_CLAUDE_FIXTURE_CHILD", d.path())
            .env("HOME", d.path())
            .env("CODEX_HOME", d.path().join("codex"))
            .output()
            .unwrap();
        assert!(
            child.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&child.stdout),
            String::from_utf8_lossy(&child.stderr)
        );
        assert!(String::from_utf8_lossy(&child.stdout).contains("1 passed"));
        return;
    };
    let (tx, mut calls) = mpsc::channel(4);
    let transport = Transport {
        calls: tx,
        settled: Arc::default(),
    };
    let app = open(&dir, &transport);
    let session = serde_json::from_value(json!({
        "api": API, "id": "claude-fixture-session", "title": "Fixture",
        "members": {"lead": {"runnerId": RUNNER, "modelId": "fixture"}}
    }))
    .unwrap();
    app.store.lock().unwrap().create_session(&session).unwrap();

    let first = "claude-first-input";
    admit(&app, first, "First message");
    app.pump_queue();
    let mut invocation = call(&mut calls, first).await;
    assert!(!invocation.resume);
    let thread = invocation.thread.clone();
    init(&invocation).await;
    invocation.frames.send(json!({
        "type": "stream_event", "session_id": thread,
        "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "partial"}}
    })).await.unwrap();
    let r = wait_for(&app, first, |r| {
        r.phase == Phase::Running && r.text == "partial"
    })
    .await;
    assert_eq!(r.attempt, invocation.attempt);
    assert_eq!(r.thread.as_deref(), Some(thread.as_str()));

    app.store.lock().unwrap().request_cancel(first).unwrap();
    app.active.lock().unwrap()[first].send(true).unwrap();
    tokio::time::timeout(
        Duration::from_secs(3),
        invocation.interrupt.wait_for(|v| *v),
    )
    .await
    .unwrap()
    .unwrap();
    invocation
        .frames
        .send(json!({
            "type":"system","subtype":"thinking_tokens","session_id":thread,
        }))
        .await
        .unwrap();
    invocation
        .frames
        .send(json!({
            "type":"result","subtype":"error_during_execution","is_error":true,"session_id":thread,
        }))
        .await
        .unwrap();

    let second = "claude-second-input";
    admit(&app, second, "Next message");
    app.pump_queue();
    assert_eq!(app.receipt(second).unwrap().phase, Phase::Queued);
    assert!(calls.try_recv().is_err());
    drop(invocation);
    let invocation = call(&mut calls, second).await;
    assert_eq!(app.receipt(first).unwrap().phase, Phase::Cancelled);
    assert_eq!(app.receipt(first).unwrap().text, "partial");
    assert!(invocation.resume);
    assert_eq!(invocation.thread, thread);
    init(&invocation).await;
    invocation.frames.send(json!({
        "type":"result","subtype":"success","is_error":false,"session_id":thread,"result":"Second answer",
    })).await.unwrap();
    drop(invocation);
    wait_for(&app, second, |r| r.phase == Phase::Completed).await;

    // Take an owned worker handle so the test can model abrupt host loss.
    let lost = "claude-lost-input";
    admit(&app, lost, "Interrupted by host loss");
    assert_eq!(
        app.store.lock().unwrap().claim_next().unwrap().unwrap().id,
        lost
    );
    let (_stop, cancel) = watch::channel(false);
    let worker = tokio::spawn(crate::native::run(
        app.clone(),
        lost.into(),
        dir.join("absent-codex"),
        cancel,
    ));
    let invocation = call(&mut calls, lost).await;
    init(&invocation).await;
    let lost_attempt = wait_for(&app, lost, |r| r.phase == Phase::Running)
        .await
        .attempt;

    let queued = "claude-queued-input";
    admit(&app, queued, "Continue after host restart");
    worker.abort();
    assert!(worker.await.unwrap_err().is_cancelled());
    drop(app);

    let app = open(&dir, &transport);
    app.pump_queue();
    assert_eq!(app.receipt(lost).unwrap().phase, Phase::Uncertain);
    assert_eq!(app.receipt(queued).unwrap().phase, Phase::Queued);
    assert!(calls.try_recv().is_err());

    // External proof of transport shutdown, separate from the lost result.
    drop(invocation);
    transport.settled.lock().unwrap().insert(lost_attempt);
    app.pump_queue();
    let invocation = call(&mut calls, queued).await;
    assert_eq!(invocation.prompt, "Continue after host restart");
    assert_eq!(invocation.thread, thread);
    assert!(invocation.resume);
    assert_eq!(app.receipt(lost).unwrap().phase, Phase::Failed);
    assert!(app.receipt(lost).unwrap().text.is_empty());
    init(&invocation).await;
    invocation.frames.send(json!({
        "type":"result","subtype":"success","is_error":false,"session_id":thread,"result":"Resumed answer",
    })).await.unwrap();
    drop(invocation);
    assert_eq!(
        wait_for(&app, queued, |r| r.phase == Phase::Completed)
            .await
            .text,
        "Resumed answer"
    );
    app.pump_queue();
    assert!(calls.try_recv().is_err());
}
