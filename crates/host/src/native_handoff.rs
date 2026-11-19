//! Release only an idle restoration of the admitted thread, through Codex's local
//! daemon protocol. Other clients retain their own subscriptions and writer.
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_tungstenite::{WebSocketStream, tungstenite::Message};

pub(super) const BUSY: &str = "Codex still has this conversation loaded for another Codex client. Finish active turns and close the thread there before retrying in Deck. Restarting Codex can reload the same thread. Your history is preserved.";

struct Client<S> {
    socket: WebSocketStream<S>,
    sequence: u64,
}

impl<S: AsyncRead + AsyncWrite + Unpin> Client<S> {
    async fn send(&mut self, message: Value) -> Option<()> {
        self.socket
            .send(Message::text(message.to_string()))
            .await
            .ok()
    }

    async fn request(&mut self, method: &str, params: Value) -> Option<Value> {
        self.sequence += 1;
        self.send(json!({"id":self.sequence, "method":method, "params":params}))
            .await?;
        while let Some(frame) = self.socket.next().await {
            if let Message::Text(text) = frame.ok()? {
                let reply: Value = serde_json::from_str(&text).ok()?;
                if reply["id"] == self.sequence && reply.get("method").is_none() {
                    return reply.get("result").cloned();
                }
            }
        }
        None
    }

    async fn loaded(&mut self, thread: &str) -> Option<bool> {
        let mut cursor = Value::Null;
        for _ in 0..16 {
            let page = self
                .request("thread/loaded/list", json!({"limit":100,"cursor":cursor}))
                .await?;
            if page["data"]
                .as_array()?
                .iter()
                .any(|id| id.as_str() == Some(thread))
            {
                return Some(true);
            }
            cursor = page.get("nextCursor")?.clone();
            if cursor.is_null() {
                return Some(false);
            }
        }
        None
    }

    async fn release(&mut self, thread: &str, project: &str) -> Option<()> {
        self.request("initialize", json!({"clientInfo":{"name":"deck2","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}})).await?;
        self.send(json!({"method":"initialized","params":{}}))
            .await?;
        if !self.loaded(thread).await? {
            return None;
        }
        let read = self
            .request(
                "thread/read",
                json!({"threadId":thread,"includeTurns":false}),
            )
            .await?;
        if read["thread"]["id"] != thread
            || read["thread"]["cwd"] != project
            || !matches!(
                read["thread"]["status"]["type"].as_str(),
                Some("idle" | "notLoaded")
            )
        {
            return None;
        }
        let resumed = self.request("thread/resume", json!({"threadId":thread,"excludeTurns":true,"config":{"thread_unload_delay_secs":0}})).await?;
        if resumed["thread"]["id"] != thread {
            return None;
        }
        let removed = self
            .request("thread/unsubscribe", json!({"threadId":thread}))
            .await?;
        if removed["status"] != "unsubscribed" {
            return None;
        }
        for _ in 0..20 {
            if !self.loaded(thread).await? {
                return Some(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        None
    }
}

pub(super) async fn release_idle(binary: &Path, thread: &str, project: &str) -> bool {
    // The native CLI resolves its own control socket. The proxy only transports
    // WebSocket frames. Closing it never terminates the shared daemon.
    let Ok(mut child) = tokio::process::Command::new(binary)
        .args(["app-server", "proxy"])
        .env_remove("CODEX_REMOTE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
    else {
        return false;
    };
    let result = tokio::time::timeout(Duration::from_secs(12), async {
        let pipe = tokio::io::join(child.stdout.take()?, child.stdin.take()?);
        let (socket, _) = tokio_tungstenite::client_async("ws://localhost/", pipe)
            .await
            .ok()?;
        Client {
            socket,
            sequence: 0,
        }
        .release(thread, project)
        .await
    })
    .await;
    let _ = child.kill().await;
    matches!(result, Ok(Some(())))
}

#[cfg(test)]
mod tests {
    use super::*;

    // The native daemon can retain an idle thread after every client exits.
    // Only a confirmed last unsubscribe permits a second preparation.
    #[tokio::test]
    async fn handoff_requires_matching_idle_thread_and_confirmed_unload() {
        for (cwd, status, stays_loaded, expected) in [
            ("/work", "idle", false, true),
            ("/elsewhere", "idle", false, false),
            ("/work", "active", false, false),
            ("/work", "idle", true, false),
        ] {
            let (a, b) = tokio::io::duplex(65536);
            let server = tokio::spawn(async move {
                let mut ws = tokio_tungstenite::accept_async(b).await.unwrap();
                let mut removed = false;
                while let Some(Ok(Message::Text(data))) = ws.next().await {
                    let req: Value = serde_json::from_str(&data).unwrap();
                    let result = match req["method"].as_str().unwrap() {
                        "initialize" => json!({}),
                        "initialized" => continue,
                        "thread/loaded/list" => {
                            json!({"data":if removed && !stays_loaded {vec![]} else {vec!["original"]},"nextCursor":null})
                        }
                        "thread/read" => {
                            json!({"thread":{"id":"original","cwd":cwd,"status":{"type":status}}})
                        }
                        "thread/resume" => {
                            assert_eq!((cwd, status), ("/work", "idle"));
                            assert_eq!(req["params"]["threadId"], "original");
                            json!({"thread":{"id":"original"}})
                        }
                        "thread/unsubscribe" => {
                            assert_eq!(req["params"]["threadId"], "original");
                            removed = true;
                            json!({"status":"unsubscribed"})
                        }
                        method => panic!("unexpected RPC {method}"),
                    };
                    ws.send(Message::text(
                        json!({"id":req["id"],"result":result}).to_string(),
                    ))
                    .await
                    .unwrap();
                }
            });
            let (socket, _) = tokio_tungstenite::client_async("ws://localhost/", a)
                .await
                .unwrap();
            assert_eq!(
                Client {
                    socket,
                    sequence: 0
                }
                .release("original", "/work")
                .await
                .is_some(),
                expected
            );
            server.await.unwrap();
        }
    }
}
