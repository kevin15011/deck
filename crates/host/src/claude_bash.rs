//! Relay native Claude Bash approval requests and track cancellation.

use deck2_shared::ProjectBinding;
use futures_util::{
    future::{AbortHandle, Abortable, BoxFuture},
    stream::{FuturesUnordered, StreamExt},
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{server::App, session_mcp::Bridge};

fn reviewed_args(event: &Value) -> Option<Value> {
    let input = &event["input"];
    if event["tool"] != "Bash"
        || !input.as_object()?.keys().all(|key| {
            matches!(
                key.as_str(),
                "command"
                    | "description"
                    | "timeout"
                    | "run_in_background"
                    | "dangerouslyDisableSandbox"
            )
        })
        || ["run_in_background", "dangerouslyDisableSandbox"]
            .into_iter()
            .any(|key| input.get(key).is_some_and(|value| value != false))
        || input
            .get("timeout")
            .is_some_and(|value| !value.as_u64().is_some_and(|ms| (1..=600_000).contains(&ms)))
    {
        return None;
    }
    let command = input["command"]
        .as_str()
        .filter(|command| !command.trim().is_empty())?;
    let item = event["tool_use_id"].as_str().filter(|id| {
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    })?;
    let action = json!({"command":command, "timeout":input["timeout"]});
    // Only authorize an action whose entire command can be rendered for review.
    if crate::execution_view::bounded(&action, 0) != action {
        return None;
    }
    Some(json!({"tool_name":"Bash", "input":action, "tool_use_id":item}))
}

type Reply = (String, bool);

#[derive(Default)]
pub(super) struct Decisions<'a> {
    pending: FuturesUnordered<BoxFuture<'a, Reply>>,
    requests: std::collections::HashMap<String, AbortHandle>,
}

impl<'a> Decisions<'a> {
    pub(super) fn request(
        &mut self,
        event: &Value,
        app: &'a App,
        scope: Option<(&'a Bridge, &'a ProjectBinding)>,
    ) -> Result<(), String> {
        let request = event["request"]
            .as_str()
            .filter(|id| Uuid::parse_str(id).is_ok())
            .ok_or("Invalid Claude Bash request ID")?
            .to_owned();
        if self.requests.contains_key(&request) {
            return Err("Duplicate Claude Bash request ID".into());
        }
        let (cancel, registration) = AbortHandle::new_pair();
        self.requests.insert(request.clone(), cancel);
        let args = reviewed_args(event);
        self.pending.push(Box::pin(async move {
            let allow = Abortable::new(
                async {
                    match (scope, args) {
                        (Some((bridge, project)), Some(args)) => {
                            bridge.approve_claude_bash(app, project, &args).await
                        }
                        _ => false,
                    }
                },
                registration,
            )
            .await
            .unwrap_or(false);
            (request, allow)
        }));
        Ok(())
    }

    pub(super) fn withdraw(&self, event: &Value) {
        if let Some(cancel) = event["request"]
            .as_str()
            .and_then(|id| self.requests.get(id))
        {
            cancel.abort();
        }
    }

    pub(super) async fn next(&mut self) -> Reply {
        if let Some(reply) = self.pending.next().await {
            self.requests.remove(&reply.0);
            reply
        } else {
            std::future::pending().await
        }
    }
}
