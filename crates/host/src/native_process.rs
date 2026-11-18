//! One reader and RPC namespace per retained Codex process. Thread routes are
//! explicit; the UI's selected session is never a routing or authority input.
use super::*;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use tokio::sync::{mpsc, oneshot};
type Events = mpsc::Receiver<Result<Value, String>>;
struct Route {
    transport: std::sync::Weak<transport::Transport>,
    events: Option<mpsc::Sender<Result<Value, String>>>,
    closed: bool,
    bound: bool,
    loading: bool,
}
struct Pending {
    reply: oneshot::Sender<Result<Value, String>>,
    route: Option<String>,
}
pub(super) struct Process {
    pub pid: u32,
    writer: tokio::sync::Mutex<ChildStdin>,
    child: tokio::sync::Mutex<Child>,
    next: AtomicU64,
    failed: AtomicBool,
    closing: AtomicBool,
    routes: Mutex<HashMap<String, Route>>,
    pending: Mutex<HashMap<String, Pending>>,
    // The native auth exclusion belongs to the process, including retirement.
    owner: Mutex<Option<Arc<dyn Send + Sync>>>,
    reader: Mutex<Option<tokio::task::JoinHandle<()>>>,
}
impl Process {
    pub fn start(
        child: Child,
        input: ChildStdin,
        mut lines: BufReader<ChildStdout>,
        mut partial: Vec<u8>,
        owner: Option<Arc<dyn Send + Sync>>,
    ) -> Arc<Self> {
        let process = Arc::new(Self {
            pid: child.id().expect("spawned native PID"),
            writer: tokio::sync::Mutex::new(input),
            child: tokio::sync::Mutex::new(child),
            next: AtomicU64::new(0),
            failed: AtomicBool::new(false),
            closing: AtomicBool::new(false),
            routes: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            owner: Mutex::new(owner),
            reader: Mutex::new(None),
        });
        let weak = Arc::downgrade(&process);
        let task = tokio::spawn(async move {
            loop {
                let value = transport::read_value(&mut lines, &mut partial).await;
                let Some(p) = weak.upgrade() else { break };
                match value {
                    Ok(v) => {
                        if p.route(v).await.is_err() {
                            p.fail();
                            break;
                        }
                    }
                    Err(_) => {
                        p.fail();
                        break;
                    }
                }
            }
        });
        *process.reader.lock().unwrap() = Some(task);
        process
    }
    pub fn reservation(&self) -> Option<Arc<dyn Send + Sync>> {
        self.owner.lock().unwrap().clone()
    }
    pub fn alive(&self) -> bool {
        !self.failed.load(Ordering::SeqCst) && !self.closing.load(Ordering::SeqCst)
    }
    pub fn fail(&self) {
        if !self.failed.swap(true, Ordering::SeqCst) {
            unsafe {
                libc::kill(-(self.pid as i32), libc::SIGKILL);
            }
        }
        for route in self.routes.lock().unwrap().values_mut() {
            if let Some(t) = route.transport.upgrade() {
                t.deactivate();
            }
            if let Some(tx) = route.events.take() {
                let _ = tx.try_send(Err("Shared native process lost; no input replayed".into()));
            }
        }
        for (_, pending) in self.pending.lock().unwrap().drain() {
            let _ = pending
                .reply
                .send(Err("Shared native process lost; no input replayed".into()));
        }
    }
    pub async fn terminate(&self) -> Result<(), String> {
        self.fail();
        self.child
            .lock()
            .await
            .wait()
            .await
            .map_err(|_| "Cannot observe shared native termination")?;
        reap_group(self.pid).await?;
        self.owner.lock().unwrap().take();
        Ok(())
    }
    pub fn reserve(&self, route: &str) -> Result<(), String> {
        let mut routes = self.routes.lock().unwrap();
        if !self.alive() || routes.contains_key(route) {
            return Err("Native thread reservation unavailable".into());
        }
        routes.insert(
            route.into(),
            Route {
                transport: std::sync::Weak::new(),
                events: None,
                closed: false,
                bound: false,
                loading: false,
            },
        );
        Ok(())
    }
    #[cfg(test)]
    pub fn route_count(&self) -> usize {
        self.routes.lock().unwrap().len()
    }
    pub fn empty(&self) -> bool {
        self.routes.lock().unwrap().is_empty()
    }
    pub fn attach(
        &self,
        route: &str,
        transport: &Arc<transport::Transport>,
    ) -> Result<Events, String> {
        if !self.alive() {
            return Err("Shared native process lost".into());
        }
        let (tx, rx) = mpsc::channel(256);
        let mut routes = self.routes.lock().unwrap();
        if !self.alive() { return Err("Shared native process is retiring".into()); }
        let r = routes.entry(route.into()).or_insert_with(|| Route {
            transport: Arc::downgrade(transport),
            events: None,
            closed: false,
            bound: false,
            loading: false,
        });
        if r.closed || r.events.is_some() {
            return Err("Native thread closed or already leased".into());
        }
        r.transport = Arc::downgrade(transport);
        r.events = Some(tx);
        Ok(rx)
    }
    pub fn park(&self, route: &str) {
        if let Some(r) = self.routes.lock().unwrap().get_mut(route) {
            r.events = None;
        }
    }
    pub fn loaded(&self, route: &str) -> bool {
        self.alive()
            && self
                .routes
                .lock()
                .unwrap()
                .get(route)
                .is_some_and(|r| !r.closed)
    }
    pub fn bound(&self, route: &str) -> Result<bool, String> {
        let routes = self.routes.lock().unwrap();
        let r = routes
            .get(route)
            .ok_or("Native route ownership unavailable")?;
        if r.loading {
            return Err("Native thread creation did not settle".into());
        }
        Ok(r.bound)
    }
    pub fn closed(&self, route: &str) -> bool {
        self.routes
            .lock()
            .unwrap()
            .get(route)
            .is_some_and(|r| r.closed)
    }
    pub fn forget(&self, route: &str) {
        let mut routes = self.routes.lock().unwrap();
        routes.remove(route);
        // Serialize the final route removal with reserve/attach. There is no
        // window in which an empty process can accept a route before it exits.
        if routes.is_empty() { self.closing.store(true, Ordering::SeqCst); }
    }
    pub async fn write(&self, v: Value) -> Result<(), String> {
        if !self.alive() {
            return Err("Shared native process lost".into());
        }
        let mut bytes = serde_json::to_vec(&v).map_err(|_| "Protocol encoding failed")?;
        bytes.push(b'\n');
        self.writer
            .lock()
            .await
            .write_all(&bytes)
            .await
            .map_err(|_| {
                self.fail();
                "Native pipe write failed; delivery may be uncertain".into()
            })
    }
    pub async fn request(
        &self,
        method: &str,
        params: Value,
        route: Option<&str>,
    ) -> Result<Value, String> {
        if matches!(method, "thread/start" | "thread/resume") {
            let mut routes = self.routes.lock().unwrap();
            let r = routes
                .get_mut(route.ok_or("Native load route missing")?)
                .ok_or("Native load route unavailable")?;
            if r.bound && (method == "thread/start" || params["threadId"].as_str() != route) {
                return Err("Loaded native route must retire before thread replacement".into());
            }
            r.loading = true;
        }
        let id = format!("deck-rpc-{}", self.next.fetch_add(1, Ordering::SeqCst));
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(
            id.clone(),
            Pending {
                reply: tx,
                route: route.map(str::to_owned),
            },
        );
        if let Err(e) = self
            .write(json!({"id":id,"method":method,"params":params}))
            .await
        {
            self.pending.lock().unwrap().remove(&id);
            return Err(e);
        }
        let result = tokio::time::timeout(Duration::from_secs(30), rx).await;
        self.pending.lock().unwrap().remove(&id);
        match result {
            Ok(Ok(v)) => v,
            _ => {
                self.fail();
                Err("Native RPC did not settle; shared process retired without replay".into())
            }
        }
    }
    async fn route(&self, v: Value) -> Result<(), String> {
        if v.get("method").is_none() {
            let id = v["id"].as_str().unwrap_or("");
            let pending = self.pending.lock().unwrap().remove(id);
            if let Some(pending) = pending {
                if let Some(route) = &pending.route {
                    // Bind the native identity before releasing the start reply.
                    if let Some(thread) = v["result"]["thread"]["id"].as_str() {
                        let mut routes = self.routes.lock().unwrap();
                        if let Some(r) = routes.get_mut(route) {
                            r.bound = true;
                            r.loading = false;
                        }
                        if thread != route {
                            if routes.contains_key(thread) {
                                return Err("Duplicate native thread identity".into());
                            }
                            if let Some(r) = routes.remove(route) {
                                routes.insert(thread.into(), r);
                            }
                        }
                    } else if v.get("error").is_some()
                        && let Some(r) = self.routes.lock().unwrap().get_mut(route)
                    {
                        r.loading = false;
                    }
                }
                let _ = pending.reply.send(Ok(v));
            }
            return Ok(()); // Late/duplicate/interrupt replies cannot become events.
        }
        let thread = v["params"]["threadId"]
            .as_str()
            .or_else(|| v["params"]["thread"]["id"].as_str());
        let request = v.get("id").is_some();
        let delivered = {
            let mut routes = self.routes.lock().unwrap();
            if let Some(route) = thread.and_then(|id| routes.get_mut(id)) {
                if v["method"] == "thread/closed" {
                    route.closed = true;
                    if let Some(t) = route.transport.upgrade() {
                        t.deactivate();
                    }
                }
                if let Some(t) = route.transport.upgrade() {
                    t.observe(&v);
                }
                if let Some(tx) = &route.events {
                    tx.try_send(Ok(v.clone()))
                        .map_err(|_| "Native thread event overflow")?;
                    true
                } else {
                    false
                }
            } else {
                false
            }
        };
        if request && !delivered {
            self.write(json!({"id":v["id"],"error":{"code":-32600,"message":"No matching live Deck thread attempt"}})).await?;
        }
        Ok(())
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        self.fail();
        if let Some(reader) = self.reader.lock().unwrap().take() {
            reader.abort();
        }
        // Retain auth exclusion if no runtime can prove process settlement.
        let owner = self.owner.lock().unwrap().take();
        if owner.is_some() {
            std::mem::forget(owner);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    async fn fixture() -> (tempfile::TempDir, Arc<Process>) {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("native");
        std::fs::write(&binary, r#"#!/usr/bin/env python3
import sys,json
for line in sys.stdin:
 v=json.loads(line)
 if 'method' not in v:continue
 p=v.get('params',{})
 if v['method']=='flood':
  for i in range(300):print(json.dumps({'method':'item/started','params':{'threadId':p['threadId'],'sequence':i}}),flush=True)
 print(json.dumps({'id':v['id'],'result':p}),flush=True)
"#).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut native = Native::start(&binary).await.unwrap();
        let p = Process::start(
            native.child.take().unwrap(),
            native.input.take().unwrap(),
            native.lines.take().unwrap(),
            vec![],
            None,
        );
        native.group = None;
        (dir, p)
    }
    // Protects last-route retirement against a racing new thread reservation.
    #[tokio::test]
    async fn last_route_retirement_closes_process_admission_atomically() {
        let (_dir,p)=fixture().await;
        p.reserve("last").unwrap();
        p.forget("last");
        let rejected=p.reserve("racing-load").is_err();
        p.terminate().await.unwrap();
        assert!(rejected, "new load entered a process whose last route was already retired");
    }
    // Oracle: process-wide RPC IDs and explicit native thread identity route
    // events independently, even with identical per-thread tool/call identities.
    #[tokio::test]
    async fn rpc_and_event_routes_never_use_current_selection() {
        let (_dir, p) = fixture().await;
        let a = Arc::new(transport::Transport::start().await.unwrap());
        let b = Arc::new(transport::Transport::start().await.unwrap());
        let mut ar = p.attach("a", &a).unwrap();
        let mut br = p.attach("b", &b).unwrap();
        let (x, y) = tokio::join!(
            p.request("probe", json!({"marker":"a"}), None),
            p.request("probe", json!({"marker":"b"}), None)
        );
        assert_eq!(x.unwrap()["result"]["marker"], "a");
        assert_eq!(y.unwrap()["result"]["marker"], "b");
        let event = |thread: &str| json!({"method":"item/started","params":{"threadId":thread,"turnId":"same-turn","item":{"id":"same-call","type":"mcpToolCall","server":"deck-session","tool":"deck_task_list","arguments":{}}}});
        p.route(event("b")).await.unwrap();
        p.route(event("a")).await.unwrap();
        assert_eq!(ar.recv().await.unwrap().unwrap()["params"]["threadId"], "a");
        assert_eq!(br.recv().await.unwrap().unwrap()["params"]["threadId"], "b");
        p.park("a");
        p.route(event("a")).await.unwrap();
        p.route(json!({"id":"late","method":"item/tool/call","params":{"threadId":"a","turnId":"same-turn"}})).await.unwrap();
        p.route(json!({"id":"missing","method":"item/tool/call","params":{}}))
            .await
            .unwrap();
        p.route(json!({"id":"deck-rpc-0","result":{"marker":"duplicate"}}))
            .await
            .unwrap();
        assert!(
            br.try_recv().is_err(),
            "late/unmatched/duplicate input crossed routes"
        );
        let mut resumed = p.attach("a", &a).unwrap();
        assert!(
            resumed.try_recv().is_err(),
            "idle events were accumulated for the next attempt"
        );
        p.terminate().await.unwrap();
    }
    // Oracle: a bounded reader must fail the affected process closed on
    // overflow; another process group remains healthy and receives no replay.
    #[tokio::test]
    async fn reader_overflow_invalidates_group_and_preserves_other_group() {
        let (_dir, p) = fixture().await;
        let (_other_dir, other) = fixture().await;
        let t = Arc::new(transport::Transport::start().await.unwrap());
        let _a = p.attach("a", &t).unwrap();
        let _b = p.attach("b", &t).unwrap();
        assert!(
            p.request("flood", json!({"threadId":"a"}), None)
                .await
                .is_err()
        );
        assert!(!p.loaded("a") && !p.loaded("b"));
        assert!(p.request("probe", json!({}), None).await.is_err());
        assert_eq!(
            other
                .request("probe", json!({"marker":"still-live"}), None)
                .await
                .unwrap()["result"]["marker"],
            "still-live"
        );
        p.terminate().await.unwrap();
        other.terminate().await.unwrap();
    }
    // Default process reader -> retained endpoint -> fake external effect.
    // Identical calls from A and B must require each thread's trusted event;
    // parking A cannot lend B authority to A's delayed direct/managed calls.
    #[tokio::test]
    async fn thread_events_authorize_only_their_own_direct_and_managed_endpoints() {
        use axum::{
            Json, Router,
            extract::State,
            http::{HeaderMap, StatusCode},
            routing::post,
        };
        let (_dir, p) = fixture().await;
        let effects = Arc::new(Mutex::new(Vec::<String>::new()));
        let target = Router::new()
            .route(
                "/mcp",
                post(
                    |State(e): State<Arc<Mutex<Vec<String>>>>, h: HeaderMap| async move {
                        e.lock()
                            .unwrap()
                            .push(h["authorization"].to_str().unwrap().to_owned());
                        Json(json!({"result":{}}))
                    },
                ),
            )
            .route(
                "/codebase",
                post(
                    |State(e): State<Arc<Mutex<Vec<String>>>>, h: HeaderMap| async move {
                        e.lock()
                            .unwrap()
                            .push(h["authorization"].to_str().unwrap().to_owned());
                        Json(json!({"result":{}}))
                    },
                ),
            )
            .with_state(effects.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, target).await.unwrap() });
        let a = Arc::new(transport::Transport::start().await.unwrap());
        let b = Arc::new(transport::Transport::start().await.unwrap());
        let _ar = p.attach("a", &a).unwrap();
        let _br = p.attach("b", &b).unwrap();
        let event = |thread: &str, server: &str| json!({"method":"item/started","params":{"threadId":thread,"turnId":"same-turn","item":{"id":"same-call","type":"mcpToolCall","server":server,"tool":"read","arguments":{}}}});
        let params = |thread: &str| json!({"name":"read","arguments":{},"_meta":{"callId":"same-call","threadId":thread,"sessionId":thread,"x-codex-turn-metadata":{"turn_id":"same-turn","thread_id":thread,"session_id":thread}}});
        async fn call(t: &transport::Transport, endpoint: &str, params: Value) -> StatusCode {
            reqwest::Client::new()
                .post(t.config["url"].as_str().unwrap().replace("/mcp", endpoint))
                .header(
                    "authorization",
                    t.config["http_headers"]["Authorization"].as_str().unwrap(),
                )
                .json(&json!({"id":1,"method":"tools/call","params":params}))
                .send()
                .await
                .unwrap()
                .status()
        }
        a.bind(&json!({"url":url,"http_headers":{"Authorization":"Bearer A"}}));
        a.arm("a");
        p.route(
            json!({"method":"turn/started","params":{"threadId":"a","turn":{"id":"same-turn"}}}),
        )
        .await
        .unwrap();
        a.confirm("a", "same-turn");
        p.route(event("a", "deck-session")).await.unwrap();
        assert_eq!(call(&a, "/mcp", params("a")).await, StatusCode::OK);
        a.deactivate();
        p.park("a");
        b.bind(&json!({"url":url,"http_headers":{"Authorization":"Bearer B"}}));
        b.arm("b");
        p.route(
            json!({"method":"turn/started","params":{"threadId":"b","turn":{"id":"same-turn"}}}),
        )
        .await
        .unwrap();
        b.confirm("b", "same-turn");
        p.route(event("a", "codebase-memory")).await.unwrap();
        assert_eq!(
            call(&a, "/codebase", params("a")).await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(&b, "/codebase", params("a")).await,
            StatusCode::FORBIDDEN
        );
        p.route(event("b", "codebase-memory")).await.unwrap();
        assert_eq!(call(&b, "/codebase", params("b")).await, StatusCode::OK);
        assert_eq!(
            call(&b, "/codebase", params("b")).await,
            StatusCode::FORBIDDEN
        );
        b.deactivate();
        assert_eq!(call(&b, "/mcp", params("b")).await, StatusCode::FORBIDDEN);
        assert_eq!(*effects.lock().unwrap(), vec!["Bearer A", "Bearer B"]);
        p.terminate().await.unwrap();
        server.abort();
    }
}
