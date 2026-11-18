//! A persistent loopback transport is not an attempt credential. Trusted native
//! call events bind each invocation to one immutable turn before any forwarding.
use axum::{
    Json, Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode, Uri},
    routing::post,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

pub(crate) struct Transport {
    pub config: Value,
    state: Arc<StateData>,
    task: tokio::task::JoinHandle<()>,
}
struct StateData {
    token: String,
    binding: Mutex<Binding>,
    changed: tokio::sync::Notify,
    client: reqwest::Client,
    #[cfg(test)]
    waiting: tokio::sync::Notify,
}
impl Drop for Transport {
    fn drop(&mut self) {
        self.deactivate();
        self.task.abort();
    }
}
impl Transport {
    pub(crate) async fn start() -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "Cannot bind epoch MCP")?;
        let token = crate::server::secret();
        let config = json!({"enabled":true,"url":format!("http://{}/mcp",listener.local_addr().map_err(|_|"Epoch MCP unavailable")?),"http_headers":{"Authorization":format!("Bearer {token}")}});
        let state = Arc::new(StateData {
            token,
            binding: Mutex::new(Binding::default()),
            changed: tokio::sync::Notify::new(),
            client: reqwest::Client::new(),
            #[cfg(test)]
            waiting: tokio::sync::Notify::new(),
        });
        let router = Router::new()
            .route("/mcp", post(forward))
            .route("/codebase", post(forward))
            .layer(axum::extract::DefaultBodyLimit::max(65536))
            .with_state(state.clone());
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        Ok(Self {
            config,
            state,
            task,
        })
    }
    pub(crate) fn bind(&self, config: &Value) {
        let mut b = self.state.binding.lock().unwrap();
        b.generation += 1;
        b.config = Some(config.clone());
        b.gate.close();
        self.state.changed.notify_waiters();
    }
    pub(crate) fn deactivate(&self) {
        let mut b = self.state.binding.lock().unwrap();
        b.generation += 1;
        b.config = None;
        b.gate.close();
        self.state.changed.notify_waiters();
    }
    pub(crate) fn arm(&self, thread: &str) {
        self.state.binding.lock().unwrap().gate.arm(thread);
    }
    pub(crate) fn confirm(&self, thread: &str, turn: &str) {
        self.state
            .binding
            .lock()
            .unwrap()
            .gate
            .confirm(thread, turn);
        self.state.changed.notify_waiters();
    }
    pub(crate) fn observe(&self, v: &Value) {
        let mut b = self.state.binding.lock().unwrap();
        if b.config.is_some() {
            b.gate.observe(v);
        }
        self.state.changed.notify_waiters();
    }
}
async fn forward(
    State(s): State<Arc<StateData>>,
    headers: HeaderMap,
    uri: Uri,
    body: Bytes,
) -> (StatusCode, Json<Value>) {
    let denied = || {
        (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"No matching live native invocation"})),
        )
    };
    if headers.get_all("authorization").iter().count() != 1
        || headers.get("authorization").and_then(|v| v.to_str().ok())
            != Some(format!("Bearer {}", s.token).as_str())
    {
        return (StatusCode::UNAUTHORIZED, Json(json!({})));
    }
    let value = match unique_json(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error":"Invalid or duplicate JSON fields"})),
            );
        }
    };
    let (generation, binding) = {
        let b = s.binding.lock().unwrap();
        let Some(config) = b.config.clone() else {
            return denied();
        };
        (b.generation, config)
    };
    if value["method"] == "tools/call" {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(1);
        loop {
            let changed = s.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let decision = {
                let mut b = s.binding.lock().unwrap();
                if b.generation != generation || b.config.is_none() {
                    return denied();
                }
                b.gate.admit(
                    if uri.path() == "/codebase" {
                        "codebase-memory"
                    } else {
                        "deck-session"
                    },
                    &value["params"],
                )
            };
            match decision {
                Ok(true) => break,
                Err(_) => return denied(),
                Ok(false) => {}
            }
            #[cfg(test)]
            s.waiting.notify_one();
            if tokio::time::timeout_at(deadline, changed).await.is_err() {
                return denied();
            }
        }
    } else if !matches!(
        value["method"].as_str(),
        Some("initialize" | "notifications/initialized" | "tools/list" | "ping")
    ) {
        return denied();
    }
    if s.binding.lock().unwrap().generation != generation {
        return denied();
    }
    let Some(url) = binding["url"].as_str() else {
        return denied();
    };
    let Some(auth) = binding["http_headers"]["Authorization"].as_str() else {
        return denied();
    };
    let result = s
        .client
        .post(url.replace("/mcp", uri.path()))
        .header("authorization", auth)
        .json(&value)
        .timeout(std::time::Duration::from_secs(15 * 60 + 1))
        .send()
        .await;
    match result {
        Ok(r) => {
            let status = r.status();
            match r.json::<Value>().await {
                Ok(v) => (status, Json(v)),
                Err(_) => denied(),
            }
        }
        Err(_) => denied(),
    }
}

#[derive(Default)]
struct Binding {
    generation: u64,
    config: Option<Value>,
    gate: Gate,
}

// serde_json normally keeps the last duplicate object key. At this trust
// boundary that would erase conflicting call/turn metadata before validation.
fn unique_json(bytes: &[u8]) -> Result<Value, serde_json::Error> {
    use serde::de::{Deserialize, Deserializer, Error, MapAccess, SeqAccess, Visitor};
    struct Unique(Value);
    impl<'de> Deserialize<'de> for Unique {
        fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
            struct V;
            impl<'de> Visitor<'de> for V {
                type Value = Unique;
                fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                    f.write_str("JSON without duplicate object keys")
                }
                fn visit_bool<E: Error>(self, v: bool) -> Result<Unique, E> {
                    Ok(Unique(json!(v)))
                }
                fn visit_i64<E: Error>(self, v: i64) -> Result<Unique, E> {
                    Ok(Unique(json!(v)))
                }
                fn visit_u64<E: Error>(self, v: u64) -> Result<Unique, E> {
                    Ok(Unique(json!(v)))
                }
                fn visit_f64<E: Error>(self, v: f64) -> Result<Unique, E> {
                    Ok(Unique(json!(v)))
                }
                fn visit_str<E: Error>(self, v: &str) -> Result<Unique, E> {
                    Ok(Unique(json!(v)))
                }
                fn visit_unit<E: Error>(self) -> Result<Unique, E> {
                    Ok(Unique(Value::Null))
                }
                fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Unique, A::Error> {
                    let mut out = vec![];
                    while let Some(v) = a.next_element::<Unique>()? {
                        out.push(v.0);
                    }
                    Ok(Unique(Value::Array(out)))
                }
                fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Unique, A::Error> {
                    let mut out = serde_json::Map::new();
                    while let Some((k, v)) = a.next_entry::<String, Unique>()? {
                        if out.insert(k, v.0).is_some() {
                            return Err(A::Error::custom("Duplicate object key"));
                        }
                    }
                    Ok(Unique(Value::Object(out)))
                }
            }
            d.deserialize_any(V)
        }
    }
    serde_json::from_slice::<Unique>(bytes).map(|u| u.0)
}

type Invocation = (String, String, String, Value);

#[derive(Default)]
struct Gate {
    active: Option<(String, String)>,
    expected: Option<String>,
    started: bool,
    confirmed: Option<(String, String)>,
    turns: BTreeSet<(String, String)>,
    calls: BTreeMap<(String, String), Option<Invocation>>,
    consumed: BTreeSet<(String, String)>,
}
impl Gate {
    fn close(&mut self) {
        self.active = None;
        self.expected = None;
        self.confirmed = None;
        self.calls.clear();
        self.consumed.clear();
    }
    fn arm(&mut self, thread: &str) {
        self.close();
        self.expected = Some(thread.into());
        self.started = false;
    }
    fn confirm(&mut self, thread: &str, turn: &str) {
        if self.expected.as_deref() == Some(thread) && self.confirmed.is_none() {
            self.confirmed = Some((thread.into(), turn.into()));
        } else {
            self.close();
        }
    }
    fn observe(&mut self, v: &Value) {
        let p = &v["params"];
        if v["method"] == "turn/started" {
            let Some((thread, turn)) = p["threadId"].as_str().zip(p["turn"]["id"].as_str()) else {
                return;
            };
            if self.expected.as_deref() != Some(thread)
                || self.turns.contains(&(thread.into(), turn.into()))
            {
                return;
            }
            if self.started || self.turns.len() >= 4096 {
                self.close();
                return;
            }
            self.started = true;
            self.turns.insert((thread.into(), turn.into()));
            self.active = Some((thread.into(), turn.into()));
        } else if v["method"] == "turn/completed" {
            if self
                .active
                .as_ref()
                .is_some_and(|(t, u)| p["threadId"] == *t && p["turn"]["id"] == *u)
            {
                self.active = None;
            }
        } else if v["method"] == "item/started" && p["item"]["type"] == "mcpToolCall" {
            let i = &p["item"];
            if let (Some(thread), Some(turn), Some(call), Some(server), Some(tool)) = (
                p["threadId"].as_str(),
                p["turnId"].as_str(),
                i["id"].as_str(),
                i["server"].as_str(),
                i["tool"].as_str(),
            ) {
                if self
                    .active
                    .as_ref()
                    .is_none_or(|(t, u)| t != thread || u != turn)
                {
                    return;
                }
                let key = (thread.into(), call.into());
                let entry = (
                    turn.into(),
                    server.into(),
                    tool.into(),
                    i["arguments"].clone(),
                );
                if self.calls.len() >= 4096 {
                    self.active = None;
                    return;
                }
                match self.calls.entry(key) {
                    std::collections::btree_map::Entry::Occupied(mut e) => {
                        e.insert(None);
                    }
                    std::collections::btree_map::Entry::Vacant(e) => {
                        e.insert(Some(entry));
                    }
                }
            }
        }
    }
    // Ok(false) is the sole waitable case: HTTP may race stdout delivery. Every
    // other inconsistency fails closed, before a fresh attempt endpoint is used.
    fn admit(&mut self, server: &str, p: &Value) -> Result<bool, String> {
        let m = &p["_meta"];
        let ctx = &m["x-codex-turn-metadata"];
        let (Some(thread), Some(turn), Some(call)) = (
            m["threadId"].as_str(),
            ctx["turn_id"].as_str(),
            m["callId"].as_str(),
        ) else {
            return Err("Missing native call identity".into());
        };
        if thread.is_empty()
            || turn.is_empty()
            || call.is_empty()
            || m["sessionId"] != thread
            || ctx["thread_id"] != thread
            || ctx["session_id"] != thread
        {
            return Err("Conflicting native call identity".into());
        }
        // The host correlates the current turn/start RPC response before any
        // effect. A trusted but unmatched notification cannot bind a new attempt.
        if self.expected.as_deref() != Some(thread) {
            return Err("Thread is not armed".into());
        }
        let Some((t, u)) = &self.confirmed else {
            return Ok(false);
        };
        if t != thread || u != turn {
            return Err("Call differs from acknowledged turn".into());
        }
        if self.active.is_none() && !self.started {
            return Ok(false);
        }
        if self
            .active
            .as_ref()
            .is_none_or(|(t, u)| t != thread || u != turn)
        {
            return Err("Native call is not in the active turn".into());
        }
        let key = (thread.into(), call.into());
        if self.consumed.contains(&key) {
            return Err("Native call already consumed".into());
        }
        let Some(entry) = self.calls.get(&key) else {
            return Ok(false);
        };
        if entry.as_ref().is_none_or(|(u, s, n, a)| {
            u != turn || s != server || p["name"] != *n || p["arguments"] != *a
        }) {
            return Err("Native call differs from trusted event".into());
        }
        self.consumed.insert(key);
        Ok(true)
    }
}

pub(super) async fn read_value(
    lines: &mut tokio::io::BufReader<tokio::process::ChildStdout>,
    partial: &mut Vec<u8>,
) -> Result<Value, String> {
    use tokio::io::AsyncBufReadExt;
    loop {
        let buf = lines
            .fill_buf()
            .await
            .map_err(|_| "Native transport failed")?;
        if buf.is_empty() {
            return Err("Native exited before settlement".into());
        }
        let count = buf
            .iter()
            .position(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(buf.len());
        if partial.len() + count > 2 * 1024 * 1024 {
            return Err("Native event exceeded the 2 MiB limit".into());
        }
        let done = buf[count - 1] == b'\n';
        partial.extend_from_slice(&buf[..count]);
        lines.consume(count);
        if done {
            break;
        }
    }
    unique_json(&std::mem::take(partial))
        .map_err(|_| "Malformed native event; no replay is safe".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(turn: &str) -> Value {
        json!({"method":"item/started","params":{"threadId":"thread","turnId":turn,"item":{"type":"mcpToolCall","id":"call","server":"deck-session","tool":"deck_session_history","arguments":{"after":1}}}})
    }
    fn request(turn: &str) -> Value {
        json!({"name":"deck_session_history","arguments":{"after":1},"_meta":{"callId":"call","threadId":"thread","sessionId":"thread","x-codex-turn-metadata":{"turn_id":turn,"thread_id":"thread","session_id":"thread"}}})
    }
    // Oracle: metadata alone cannot mint authority; only one exact trusted item
    // in the current turn can be consumed, with no late-A rebinding during B.
    #[test]
    fn immutable_call_binding_rejects_idle_late_conflicting_and_duplicate_calls() {
        let mut g = Gate::default();
        let a = request("A");
        assert!(g.admit("deck-session", &a).is_err());
        g.arm("thread");
        g.observe(
            &json!({"method":"turn/started","params":{"threadId":"thread","turn":{"id":"A"}}}),
        );
        g.confirm("thread", "A");
        assert!(!g.admit("deck-session", &a).unwrap());
        g.observe(&event("A"));
        assert!(g.admit("deck-session", &a).unwrap());
        assert!(g.admit("deck-session", &a).is_err());
        g.observe(
            &json!({"method":"turn/completed","params":{"threadId":"thread","turn":{"id":"A"}}}),
        );
        assert!(g.admit("deck-session", &a).is_err());
        g.arm("thread");
        g.observe(
            &json!({"method":"turn/started","params":{"threadId":"thread","turn":{"id":"B"}}}),
        );
        g.confirm("thread", "B");
        assert!(g.admit("deck-session", &a).is_err());
        g.observe(&event("B"));
        let mut b = request("B");
        b["arguments"] = json!({"after":2});
        assert!(g.admit("deck-session", &b).is_err());
        assert!(g.admit("codebase-memory", &request("B")).is_err());
        g.observe(&event("B"));
        assert!(g.admit("deck-session", &request("B")).is_err());
    }
    // A repeated or out-of-order trusted notification cannot reopen a settled
    // turn or erase one-shot consumption. A foreign completion cannot close B.
    #[test]
    fn reordered_turn_notifications_cannot_reactivate_authority() {
        let mut g = Gate::default();
        let start = |turn| json!({"method":"turn/started","params":{"threadId":"thread","turn":{"id":turn}}});
        let done = |turn| json!({"method":"turn/completed","params":{"threadId":"thread","turn":{"id":turn}}});
        g.arm("thread");
        g.observe(&start("A"));
        g.confirm("thread", "A");
        g.observe(&event("A"));
        assert!(g.admit("deck-session", &request("A")).unwrap());
        g.observe(&start("A"));
        assert!(g.admit("deck-session", &request("A")).is_err());
        g.observe(&done("A"));
        g.observe(&start("A"));
        assert!(g.admit("deck-session", &request("A")).is_err());
        g.arm("thread");
        g.confirm("thread", "B");
        g.observe(&start("A"));
        g.observe(&event("A"));
        assert!(g.admit("deck-session", &request("A")).is_err());
        g.observe(&start("B"));
        g.observe(&done("A"));
        g.observe(&event("B"));
        assert!(g.admit("deck-session", &request("B")).unwrap());
    }
    #[test]
    fn event_and_rpc_acknowledgement_must_match_before_forwarding() {
        let mut g = Gate::default();
        g.arm("thread");
        g.observe(
            &json!({"method":"turn/started","params":{"threadId":"thread","turn":{"id":"A"}}}),
        );
        g.observe(&event("A"));
        assert!(!g.admit("deck-session", &request("A")).unwrap());
        g.confirm("thread", "B");
        assert!(g.admit("deck-session", &request("A")).is_err());
        assert!(g.admit("deck-session", &request("B")).is_err());
    }
    #[test]
    fn duplicate_metadata_cannot_be_hidden_by_json_parsing() {
        assert!(unique_json(br#"{"params":{"_meta":{"callId":"a","callId":"b"}}}"#).is_err());
        assert!(unique_json(br#"{"arguments":{"p":1,"p":2}}"#).is_err());
        assert_eq!(
            unique_json(br#"{"p":[true,null,1,"text",{}]}"#).unwrap(),
            json!({"p":[true,null,1,"text",{}]})
        );
    }
    // Exercise the real HTTP routing path, including event/HTTP ordering, idle
    // and late-request denial, and immutable binding across attempt rotation.
    #[tokio::test]
    async fn transport_forwards_only_one_exact_call_to_the_bound_attempt() {
        use axum::routing::post;
        use std::sync::atomic::{AtomicUsize, Ordering};
        let count = Arc::new(AtomicUsize::new(0));
        let effects = count.clone();
        let target = Router::new().route(
            "/{path}",
            post(move || {
                let effects = effects.clone();
                async move {
                    effects.fetch_add(1, Ordering::SeqCst);
                    Json(json!({"result":{"ok":true}}))
                }
            }),
        );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        let target_task = tokio::spawn(async move { axum::serve(l, target).await.unwrap() });
        let t = Transport::start().await.unwrap();
        let auth = t.config["http_headers"]["Authorization"].as_str().unwrap();
        let url = t.config["url"].as_str().unwrap();
        let client = reqwest::Client::new();
        let call = |url: String, params: Value| {
            client
                .post(url)
                .header("authorization", auth)
                .json(&json!({"id":1,"method":"tools/call","params":params}))
                .send()
        };
        assert_eq!(
            call(url.into(), request("A")).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        for endpoint in ["/mcp", "/codebase"] {
            let response = client.post(url.replace("/mcp", endpoint))
                .header("authorization", auth)
                .header("content-type", "application/json")
                .body(r#"{"id":1,"method":"tools/call","params":{"_meta":{"callId":"A","callId":"B"}}}"#)
                .send().await.unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        }
        t.bind(&json!({"url":format!("http://{addr}/mcp"),"http_headers":{"Authorization":"Bearer attempt-A"}}));
        t.arm("thread");
        t.observe(
            &json!({"method":"turn/started","params":{"threadId":"thread","turn":{"id":"A"}}}),
        );
        t.confirm("thread", "A");
        let sending = call(url.into(), request("A"));
        let delivery = async {
            tokio::task::yield_now().await;
            t.observe(&event("A"));
        };
        let (response, ()) = tokio::join!(sending, delivery);
        assert_eq!(response.unwrap().status(), StatusCode::OK);
        assert_eq!(
            call(url.into(), request("A")).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        let mut delayed = request("A");
        delayed["_meta"]["callId"] = json!("delayed");
        let pending = call(url.into(), delayed);
        tokio::pin!(pending);
        tokio::select! {
            _ = t.state.waiting.notified() => {},
            _ = &mut pending => panic!("unmatched request settled before test barrier"),
        }
        t.deactivate();
        assert_eq!(
            call(url.into(), request("A")).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        t.bind(&json!({"url":format!("http://{addr}/mcp"),"http_headers":{"Authorization":"Bearer attempt-B"}}));
        t.arm("thread");
        t.observe(
            &json!({"method":"turn/started","params":{"threadId":"thread","turn":{"id":"B"}}}),
        );
        t.confirm("thread", "B");
        assert_eq!(
            call(url.into(), request("A")).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            pending.await.unwrap().status(),
            StatusCode::FORBIDDEN,
            "an A waiter must not acquire B's authority"
        );
        let mut managed = event("B");
        managed["params"]["item"]["server"] = json!("codebase-memory");
        t.observe(&managed);
        assert_eq!(
            call(url.replace("/mcp", "/codebase"), request("B"))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert_eq!(count.load(Ordering::SeqCst), 2);
        target_task.abort();
    }
}
