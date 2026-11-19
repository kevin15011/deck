use super::*;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use std::sync::{Arc, Mutex};

fn selection(id: &str, thinking: Option<&str>) -> MemberAssignment {
    MemberAssignment {
        runner_id: "opencode".into(),
        model_id: id.into(),
        thinking: thinking.map(str::to_owned),
    }
}
fn inventory() -> Vec<Model> {
    parse_models("a/model/revision\n{\"providerID\":\"a\",\"variants\":{\"fast/native\":{},\"deep\":{}},\"name\":\"Quoted } braces {\"}\nb/model/revision\n{\"providerID\":\"b\",\"variants\":{\"slow\":{}}}\n").unwrap()
}
fn turn() -> Turn {
    Turn::new(Invocation {
        session: "ses_native_opaque".into(),
        message: "msg_caller".into(),
        agent: "deck-apply-deep".into(),
    })
    .unwrap()
}
fn claim(t: &mut Turn) -> Dispatch {
    t.claim(
        &resolve(
            &inventory(),
            &selection("a/model/revision", Some("fast/native")),
        )
        .unwrap(),
        "Current role",
        vec![json!({"type":"text","text":"Execute fixture"})],
        |_| Ok(()),
    )
    .unwrap()
}
fn info(id: &str, parent: &str) -> Value {
    json!({"type":"message.updated","properties":{"info":{"sessionID":"ses_native_opaque","id":id,"role":"assistant","parentID":parent}}})
}
fn delta(id: &str) -> Value {
    json!({"type":"message.part.delta","properties":{"sessionID":"ses_native_opaque","messageID":id,"delta":"Exact current output"}})
}

// Protects OPENCODE-01. Native inventory is the oracle, including a provider
// literally named opencode; fail on alias ambiguity or separator truncation.
#[test]
fn catalog_preserves_ids_variants_and_refuses_ambiguous_legacy_aliases() {
    let mut models = inventory();
    let a = resolve(
        &models,
        &selection("opencode/a/model/revision", Some("fast/native")),
    )
    .unwrap();
    assert_eq!(
        (&*a.provider, &*a.model, a.variant.as_deref()),
        ("a", "model/revision", Some("fast/native"))
    );
    assert_eq!(
        resolve(&models, &selection("b/model/revision", Some("off")))
            .unwrap()
            .variant,
        None
    );
    for (id, level) in [
        ("missing/model", None),
        ("a/model/revision", Some("slow")),
        ("a/model/revision", Some("")),
    ] {
        assert!(resolve(&models, &selection(id, level)).is_err());
    }
    models.push(Model {
        provider: "opencode".into(),
        model: "a/model/revision".into(),
        variants: vec![],
    });
    assert!(resolve(&models, &selection("opencode/a/model/revision", None)).is_err());
    assert!(
        resolve(
            &models,
            &MemberAssignment {
                runner_id: "codex".into(),
                model_id: "a/model/revision".into(),
                thinking: None
            }
        )
        .is_err()
    );
}

#[test]
fn catalog_is_all_or_nothing_with_bounded_untrusted_records() {
    for text in [
        "a/m\n{}",
        "a/m\n{\"providerID\":\"b\",\"variants\":{}}",
        "a/m\n{\"providerID\":\"a\",\"variants\":[]}\n",
        "a/m\n{\"providerID\":\"a\",\"variants\":{}}\na/m\n{\"providerID\":\"a\",\"variants\":{}}",
        "a/m\n{\"providerID\":\"a\",\"variants\":{}} trailing-log",
        "a/m\n{\"providerID\":\"a\",\"variants\":{\"bad\\nname\":{}}}",
    ] {
        assert!(parse_models(text).is_err(), "{text}");
    }
    assert!(parse_models(&"x".repeat(MAX_BODY + 1)).is_err());
    assert!(parse_models("").unwrap().is_empty());
}

// Protects OPENCODE-04: session and exact parent are independent requirements.
// Earlier output cannot acquire authority from later messages or late completion.
#[test]
fn parts_wait_for_current_parent_and_replay_only_once() {
    let mut t = turn();
    let _dispatch = claim(&mut t);
    assert!(t.event(delta("assistant_a")).unwrap().is_empty());
    let accepted = t.event(info("assistant_a", "msg_caller")).unwrap();
    assert_eq!(accepted.len(), 2);
    assert_eq!(accepted[1], delta("assistant_a"));
    assert_eq!(t.event(info("assistant_a", "msg_caller")).unwrap().len(), 1);
    assert!(t.event(delta("old")).unwrap().is_empty());
    assert!(t.event(info("old", "msg_previous")).unwrap().is_empty());
    assert!(t.event(info("old", "msg_caller")).unwrap().is_empty());
    let mut foreign = delta("assistant_a");
    foreign["properties"]["sessionID"] = json!("other");
    assert!(t.event(foreign).unwrap().is_empty());
    let foreign_part = json!({"type":"message.part.updated","properties":{"sessionID":"ses_native_opaque","part":{"sessionID":"foreign","messageID":"assistant_a","type":"text","text":"foreign"}}});
    assert!(
        t.event(foreign_part).unwrap().is_empty(),
        "Every declared session identity must agree"
    );
    let conflicting_message = json!({"type":"message.part.delta","properties":{"sessionID":"ses_native_opaque","messageID":"old","part":{"sessionID":"ses_native_opaque","messageID":"assistant_a"},"delta":"foreign"}});
    assert!(
        t.event(conflicting_message).unwrap().is_empty(),
        "Every declared message identity must agree"
    );
    t.close();
    assert!(t.event(delta("assistant_a")).unwrap().is_empty());
}

#[test]
fn unclassified_permissions_never_gain_later_authority_and_requests_are_exact() {
    let mut t = turn();
    let _dispatch = claim(&mut t);
    let p = json!({"type":"permission.asked","properties":{"sessionID":"ses_native_opaque","id":"permission_a","tool":{"messageID":"assistant_a"},"permission":"bash","patterns":["fixture"]}});
    assert!(t.event(p.clone()).unwrap().is_empty());
    t.event(info("assistant_a", "msg_caller")).unwrap();
    assert_eq!(t.event(p.clone()).unwrap(), vec![p.clone()]);
    assert!(t.event(p).unwrap().is_empty());
    let q = json!({"type":"question.asked","properties":{"sessionID":"ses_native_opaque","id":"question_a","tool":{"messageID":"old"}}});
    assert!(t.event(q).unwrap().is_empty());
    for i in 0..128 {
        assert!(t.event(delta(&format!("unknown{i}"))).unwrap().is_empty());
    }
    assert_eq!(
        t.event(delta("overflow")).unwrap_err(),
        "opencode-pending-limit"
    );
}

#[test]
fn session_scope_never_silently_becomes_native_permanent_scope() {
    use deck2_shared::DecisionResponse::*;
    assert_eq!(
        permission_reply(&AllowSession, false, true, true),
        json!({"reply":"once"})
    );
    assert_eq!(
        permission_reply(&AllowAlways, false, true, false),
        json!({"reply":"reject"})
    );
    assert_eq!(
        permission_reply(&AllowAlways, false, false, true),
        json!({"reply":"reject"})
    );
    assert_eq!(
        permission_reply(&AllowAlways, false, true, true),
        json!({"reply":"always"})
    );
    for choice in [AllowOnce, AllowSession, AllowAlways, Deny] {
        assert_eq!(
            permission_reply(&choice, true, true, true),
            json!({"reply":"reject"})
        );
    }
}

#[derive(Clone, Default)]
struct Wire {
    calls: Arc<Mutex<Vec<Value>>>,
    saved: Arc<Mutex<Option<Invocation>>>,
}
async fn message(
    State(s): State<Wire>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    use base64::Engine;
    assert_eq!(
        headers["authorization"].to_str().unwrap(),
        format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode("opencode:fixture-secret")
        )
    );
    assert_eq!(id, "ses_native_opaque");
    assert_eq!(
        s.saved.lock().unwrap().as_ref().unwrap().message,
        body["messageID"]
    );
    s.calls.lock().unwrap().push(body.clone());
    assert_eq!(
        body["model"],
        json!({"providerID":"a","modelID":"model/revision"})
    );
    assert_eq!(body["variant"], "fast/native");
    assert_eq!(body["agent"], "deck-apply-deep");
    (
        StatusCode::OK,
        Json(
            json!({"info":{"sessionID":id,"id":"assistant_owned","role":"assistant","parentID":body["messageID"]},"parts":[{"sessionID":id,"messageID":"assistant_owned","type":"text","text":"Exact owned report"}]}),
        ),
    )
}
async fn server(router: Router) -> (Client, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let std::net::SocketAddr::V4(addr) = listener.local_addr().unwrap() else {
        panic!()
    };
    let client = Client::new(addr, "fixture-secret".into()).unwrap();
    let handle = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (client, handle)
}

// Actual HTTP, independent wire oracle: fail on any wrong native selection or
// request before persistence. No real native/model execution is asserted.
#[tokio::test]
async fn http_dispatch_uses_exact_wire_after_durable_caller_and_never_twice() {
    let state = Wire::default();
    let (client, server) = server(
        Router::new()
            .route("/session/{id}/message", post(message))
            .with_state(state.clone()),
    )
    .await;
    let mut t = turn();
    let s = resolve(
        &inventory(),
        &selection("a/model/revision", Some("fast/native")),
    )
    .unwrap();
    let dispatch = t
        .claim(
            &s,
            "Role",
            vec![json!({"type":"text","text":"fixture"})],
            |i| {
                *state.saved.lock().unwrap() = Some(i.clone());
                Ok(())
            },
        )
        .unwrap();
    let response = dispatch.send(&client).await.unwrap();
    assert_eq!(t.result(&response).unwrap(), "Exact owned report");
    assert!(matches!(
        t.claim(
            &s,
            "Role",
            vec![json!({"type":"text","text":"retry"})],
            |_| panic!("must not retry")
        ),
        Err(Failure::AlreadyDispatched)
    ));
    assert_eq!(state.calls.lock().unwrap().len(), 1);
    server.abort();
}

#[tokio::test]
async fn quiet_turn_can_complete_after_ten_minutes() {
    let entered = Arc::new(tokio::sync::Notify::new());
    let finish = Arc::new(tokio::sync::Notify::new());
    let handler_entered = entered.clone();
    let handler_finish = finish.clone();
    let (client, server) = server(Router::new().route(
        "/session/{id}/message",
        post(move || async move {
            handler_entered.notify_one();
            handler_finish.notified().await;
            Json(json!({"completed": true}))
        }),
    ))
    .await;
    let dispatch = claim(&mut turn());
    let response = tokio::spawn(async move { dispatch.send(&client).await });
    entered.notified().await;
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(601)).await;
    tokio::time::resume();
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert!(!response.is_finished());
    finish.notify_one();
    assert_eq!(response.await.unwrap().unwrap()["completed"], true);
    server.abort();
}

#[tokio::test]
async fn lookup_classifies_only_lookup_404_as_absence() {
    async fn lookup(Path(id): Path<String>) -> (StatusCode, Json<Value>) {
        match id.as_str() {
            "absent" => (StatusCode::NOT_FOUND, Json(json!({}))),
            "denied" => (StatusCode::UNAUTHORIZED, Json(json!({}))),
            "foreign" => (StatusCode::OK, Json(json!({"id":"other"}))),
            _ => (StatusCode::OK, Json(json!({"id":id}))),
        }
    }
    let (client, server) = server(Router::new().route("/session/{id}", get(lookup))).await;
    assert_eq!(client.lookup("absent").await, Err(Failure::MissingSession));
    assert_eq!(client.lookup("denied").await, Err(Failure::Http(401)));
    assert_eq!(client.lookup("foreign").await, Err(Failure::Uncorrelated));
    assert_eq!(
        client.lookup("ses_opaque").await.unwrap()["id"],
        "ses_opaque"
    );
    assert_eq!(client.lookup("../other").await, Err(Failure::InvalidBody));
    server.abort();
}

#[tokio::test]
async fn missing_acknowledgment_cannot_resend_and_persistence_failure_sends_nothing() {
    use tokio::io::AsyncReadExt;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let std::net::SocketAddr::V4(addr) = listener.local_addr().unwrap() else {
        panic!()
    };
    let client = Client::new(addr, "fixture-secret".into()).unwrap();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut headers = Vec::new();
        while !headers.ends_with(b"\r\n\r\n") {
            assert!(headers.len() < 8192);
            headers.push(socket.read_u8().await.unwrap());
        }
        let header = String::from_utf8(headers).unwrap();
        let len = header
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(str::trim)
                    .map(|n| n.parse::<usize>().unwrap())
            })
            .unwrap();
        assert!(len < 8192);
        let mut body = vec![0; len];
        socket.read_exact(&mut body).await.unwrap();
        tx.send(serde_json::from_slice::<Value>(&body).unwrap())
            .unwrap();
        // The external edge consumed the body; deliberately lose every response
        // byte. This is an actual missing acknowledgment, not an HTTP error.
        drop(socket);
    });
    let mut t = turn();
    let s = resolve(&inventory(), &selection("a/model/revision", None)).unwrap();
    assert!(matches!(
        t.claim(
            &s,
            "Role",
            vec![json!({"type":"text","text":"fixture"})],
            |_| Err("storage failure".into())
        ),
        Err(Failure::Persistence)
    ));
    let dispatch = t
        .claim(
            &s,
            "Role",
            vec![json!({"type":"text","text":"fixture"})],
            |_| Ok(()),
        )
        .unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(3), dispatch.send(&client))
            .await
            .unwrap(),
        Err(Failure::Transport)
    );
    assert_eq!(rx.await.unwrap()["messageID"], "msg_caller");
    assert!(matches!(
        t.claim(
            &s,
            "Role",
            vec![json!({"type":"text","text":"retry"})],
            |_| panic!()
        ),
        Err(Failure::AlreadyDispatched)
    ));
    server.await.unwrap();
}

#[test]
fn images_use_validated_inline_native_parts_without_external_urls() {
    use base64::Engine;
    let t = turn();
    let s = resolve(&inventory(), &selection("a/model/revision", None)).unwrap();
    let bytes = include_bytes!("../../../../scripts/fixtures/ordinary-image.png");
    let valid = json!({"type":"file","mime":"image/png","filename":"fixture.png","url":format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(bytes))});
    let body = t.invocation.body(&s, "Role", vec![valid.clone()]).unwrap();
    assert_eq!(body["parts"][0], valid);
    for url in [
        "https://example.invalid/image.png",
        "file:///private/image.png",
        "data:image/png;base64,broken",
    ] {
        assert!(
            t.invocation
                .body(
                    &s,
                    "Role",
                    vec![json!({"type":"file","mime":"image/png","url":url})]
                )
                .is_err()
        );
    }
}

#[test]
fn final_report_requires_exact_parent_and_all_text_part_owners() {
    let mut t = turn();
    let _dispatch = claim(&mut t);
    let mut response = json!({"info":{"sessionID":"ses_native_opaque","id":"assistant_a","role":"assistant","parentID":"msg_old"},"parts":[]});
    assert_eq!(t.result(&response), Err(Failure::Uncorrelated));
    assert!(
        t.event(info("assistant_a", "msg_caller"))
            .unwrap()
            .is_empty(),
        "An invalid final HTTP response must terminate event authority"
    );
    let mut t = turn();
    let _dispatch = claim(&mut t);
    response["info"]["parentID"] = json!("msg_caller");
    response["parts"] = json!([{"sessionID":"ses_native_opaque","messageID":"foreign","type":"text","text":"must not report"}]);
    assert_eq!(t.result(&response), Err(Failure::Uncorrelated));
    assert!(
        t.event(info("assistant_a", "msg_caller"))
            .unwrap()
            .is_empty()
    );
    let mut t = turn();
    let _dispatch = claim(&mut t);
    response["parts"][0]["messageID"] = json!("assistant_a");
    assert_eq!(t.result(&response).unwrap(), "must not report");
    assert_eq!(t.result(&response), Err(Failure::Uncorrelated));
}
