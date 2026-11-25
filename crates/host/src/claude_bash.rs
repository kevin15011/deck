//! Relay native Claude Bash and MCP approval requests and track cancellation.

use deck2_shared::ProjectBinding;
use futures_util::{
    future::{AbortHandle, Abortable, BoxFuture},
    stream::{FuturesUnordered, StreamExt},
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{server::App, session_mcp::Bridge};

fn reviewed_args(event: &Value) -> Result<Value, &'static str> {
    let input = event["input"]
        .as_object()
        .ok_or("Bash input must be an object")?;
    if event["tool"] != "Bash"
        || !input.keys().all(|key| {
            matches!(
                key.as_str(),
                "command"
                    | "description"
                    | "timeout"
                    | "run_in_background"
                    | "dangerouslyDisableSandbox"
            )
        })
    {
        return Err("Unrecognized Bash tool or input field");
    }
    if input
        .get("run_in_background")
        .is_some_and(|value| value != false)
    {
        return Err("Deck requires Bash to run in the foreground");
    }
    if input
        .get("dangerouslyDisableSandbox")
        .is_some_and(|value| value != false)
    {
        return Err("Deck does not authorize Bash sandbox overrides");
    }
    if input
        .get("timeout")
        .is_some_and(|value| !value.as_u64().is_some_and(|ms| (1..=600_000).contains(&ms)))
    {
        return Err("Bash timeout must be between 1 and 600000 ms");
    }
    let command = input
        .get("command")
        .and_then(Value::as_str)
        .filter(|command| !command.trim().is_empty())
        .ok_or("Bash command is empty or is not a string")?;
    let item = event["tool_use_id"]
        .as_str()
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        })
        .ok_or("Invalid Bash tool-use ID")?;
    let action = json!({"command":command, "timeout":input.get("timeout")});
    if action.to_string().len() > 16_384 {
        return Err("Bash input exceeds Deck's 16384-byte permission relay limit");
    }
    if crate::execution_view::sensitive_bash(command) {
        return Err(
            "Bash command contains a potential credential and cannot be displayed for exact review",
        );
    }
    Ok(json!({"tool_name":"Bash", "input":action, "tool_use_id":item}))
}

type Reply = (String, Result<(), String>);

pub(super) fn reply(request: String, result: Result<(), String>) -> Value {
    json!({"type":"permission_reply","request":request,"allowed":result.is_ok(),
        "permit":result.is_ok().then(|| json!({})), "reason":result.err()})
}

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
        bridge: &'a Bridge,
        bash_project: Option<&'a ProjectBinding>,
    ) -> Result<(), String> {
        let request = event["request"]
            .as_str()
            .filter(|id| Uuid::parse_str(id).is_ok())
            .ok_or("Invalid Claude relay request ID")?
            .to_owned();
        if self.requests.contains_key(&request) {
            return Err("Duplicate Claude relay request ID".into());
        }
        let (cancel, registration) = AbortHandle::new_pair();
        self.requests.insert(request.clone(), cancel);
        let mcp = event["type"] == "mcp_permission";
        let args = if mcp {
            Ok(json!({"tool_name":event["tool"], "input":event["input"], "tool_use_id":event["tool_use_id"]}))
        } else {
            reviewed_args(event)
        };
        self.pending.push(Box::pin(async move {
            let result = Abortable::new(
                async {
                    let args = args?;
                    if mcp {
                        bridge.approve_claude_mcp(app, &args, bash_project).await
                    } else {
                        let project = bash_project.ok_or("Bash permission requires a trusted project")?;
                        bridge.approve_claude_bash(app, project, &args).await
                    }
                },
                registration,
            )
            .await
            .unwrap_or_else(|_| Err("Permission request was withdrawn".into()));
            (request, result)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_that_cannot_be_presented_do_not_expose_their_contents() {
        for (command, reason) in [
            ("echo sk-fixture-credential".into(), "credential"),
            ("fixture --clientSecret FIXTURE_PUBLIC_SENTINEL".into(), "credential"),
            ("fixture --clientSecret\\\n   FIXTURE_CONTINUED_SENTINEL".into(), "credential"),
            ("fixture --client-secret 'fixture value'".into(), "credential"),
            ("echo ".to_owned() + &"x".repeat(17000), "16384"),
        ] {
            let event = json!({"tool":"Bash","input":{"command":command},"tool_use_id":"test"});
            let error = reviewed_args(&event).unwrap_err();
            assert!(error.contains(reason));
            let response = reply("request".to_owned(), Err(error.into()));
            assert_eq!(response["allowed"], false);
            assert!(!response.to_string().contains(&command));
        }
    }

    #[test]
    fn review_accepts_complete_bash_commands_with_line_breaks_and_ordinary_words() {
        for command in [
            "cat <<'EOF'\ntask-disk-image\nEOF".into(),
            "git commit -m 'first line\nsecond line'".into(),
            "printf '%s' \\\n   ordinary-value".into(),
            format!("echo task-disk-{}", "x".repeat(2000)),
        ] {
            let event = json!({"tool":"Bash","input":{"command":command},"tool_use_id":"test"});
            assert_eq!(
                reviewed_args(&event).expect("command should reach review")["input"]["command"],
                command,
            );
        }
    }
}
