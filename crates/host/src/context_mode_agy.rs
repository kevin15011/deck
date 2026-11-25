use super::{Action, Outcome, State, Status, context_server, read_json};
use crate::external_tools::{home, run};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;

const SERVER_NAME: &str = "context-mode";
const MCP_CONFIG_REL: &str = ".gemini/config/mcp_config.json";

pub(super) struct Runner {
    home: PathBuf,
    binary: PathBuf,
}

impl Runner {
    pub(super) fn for_host() -> Result<Self, String> {
        let home = home()?;
        let binary = crate::runner_management::path_tool("agy")
            .map_err(|_| "Install Antigravity and make `agy` available on the Deck host PATH.")?;
        Ok(Self { home, binary })
    }

    fn config_path(&self) -> PathBuf {
        self.home.join(MCP_CONFIG_REL)
    }

    async fn command(&self, args: &[&str], seconds: u64) -> Result<Vec<u8>, String> {
        let mut cmd = Command::new(&self.binary);
        cmd.args(args)
            .env("HOME", &self.home)
            .env("NO_COLOR", "1")
            .current_dir(&self.home);
        run(cmd, Duration::from_secs(seconds))
            .await
            .map_err(|error| {
                format!(
                    "Antigravity could not run `agy {}`. {error}",
                    args.join(" ")
                )
            })
    }

    fn managed_spec(spec: &Value) -> bool {
        let command = spec["command"].as_str().unwrap_or_default();
        let args = spec["args"].as_array();
        let is_npx = command == "npx"
            && args.is_some_and(|a| {
                a.len() == 2
                    && a[0].as_str() == Some("-y")
                    && a[1].as_str() == Some(SERVER_NAME)
            });
        let is_direct = (command == SERVER_NAME
            || Path::new(command)
                .file_name()
                .is_some_and(|name| name == SERVER_NAME))
            && args.is_none_or(Vec::is_empty);
        is_npx || is_direct
    }

    async fn observe(&self) -> Result<Status, String> {
        let config = read_json(&self.config_path()).await?;
        let servers = match &config {
            Value::Null => return Ok(Status::new(
                State::NotInstalled,
                "Registers the Context Mode MCP server (`npx -y context-mode`) in Antigravity.",
            )),
            Value::Object(map) => match map.get("mcpServers") {
                None | Some(Value::Null) => return Ok(Status::new(
                    State::NotInstalled,
                    "Registers the Context Mode MCP server (`npx -y context-mode`) in Antigravity.",
                )),
                Some(Value::Object(servers)) => servers,
                Some(_) => {
                    return Err("Antigravity MCP configuration has an invalid mcpServers table."
                        .into());
                }
            },
            _ => return Err("Antigravity MCP configuration is not a JSON object.".into()),
        };

        let matches: Vec<(&String, &Value)> = servers
            .iter()
            .filter(|(name, spec)| context_server(name, spec))
            .collect();

        Ok(match matches.as_slice() {
            [] => Status::new(
                State::NotInstalled,
                "Registers the Context Mode MCP server (`npx -y context-mode`) in Antigravity.",
            ),
            [(name, spec)] if name.as_str() == SERVER_NAME && Self::managed_spec(spec) => {
                if spec["disabled"] == true {
                    Status::new(
                        State::Disabled,
                        "Enable the Context Mode MCP server in Antigravity (`agy mcp enable context-mode`).",
                    )
                } else {
                    Status::new(
                        State::Installed,
                        "Antigravity has the Context Mode MCP server registered and enabled.",
                    )
                }
            }
            _ => Status::new(
                State::Conflict,
                "Review the custom or overlapping Context Mode MCP entries in Antigravity before continuing.",
            ),
        })
    }

    pub(super) async fn status(&self) -> Result<Status, String> {
        self.observe().await
    }

    pub(super) async fn apply(&self, action: Action) -> Result<(Status, Outcome), String> {
        let before = self.observe().await?;
        match action {
            Action::Install => {
                if !matches!(before.state, State::NotInstalled | State::Incomplete) {
                    return Err(before.detail.into());
                }
            }
            Action::Update => {
                if !matches!(before.state, State::Installed | State::Stale) {
                    return Err(before.detail.into());
                }
            }
            Action::Migrate => {
                return Err("Context Mode migration only applies to Codex.".into());
            }
        }
        self.command(
            &["mcp", "add", SERVER_NAME, "--", "npx", "-y", SERVER_NAME],
            20,
        )
        .await?;
        let after = self.observe().await?;
        if after.state != State::Installed {
            return Err("Antigravity finished `agy mcp add`, but the Context Mode MCP registration could not be verified.".into());
        }
        let outcome = if matches!(action, Action::Install) {
            Outcome::Installed
        } else {
            Outcome::Updated
        };
        Ok((after, outcome))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn fake_agy(dir: &Path) -> PathBuf {
        let bin = dir.join("fake-agy");
        std::fs::write(
            &bin,
            r#"#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
cfg = pathlib.Path(os.environ["HOME"]) / ".gemini/config/mcp_config.json"
if args[:3] == ["mcp", "add", "context-mode"]:
    cfg.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(cfg.read_text()) if cfg.exists() else {}
    servers = data.setdefault("mcpServers", {})
    servers["context-mode"] = {"command": "npx", "args": ["-y", "context-mode"], "disabled": False}
    cfg.write_text(json.dumps(data, indent=2))
    sys.exit(0)
sys.exit(1)
"#,
        )
        .unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o700)).unwrap();
        bin
    }

    #[tokio::test]
    async fn agy_context_mode_install_disabled_and_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        let runner = Runner {
            home: home.clone(),
            binary: fake_agy(dir.path()),
        };

        assert_eq!(runner.status().await.unwrap().state, State::NotInstalled);

        let (installed, outcome) = runner.apply(Action::Install).await.unwrap();
        assert_eq!(installed.state, State::Installed);
        assert!(matches!(outcome, Outcome::Installed));

        let (updated, outcome) = runner.apply(Action::Update).await.unwrap();
        assert_eq!(updated.state, State::Installed);
        assert!(matches!(outcome, Outcome::Updated));

        // Disabled entry surfaces cleanly and refuses update.
        let cfg = home.join(MCP_CONFIG_REL);
        std::fs::write(
            &cfg,
            r#"{"mcpServers":{"context-mode":{"command":"npx","args":["-y","context-mode"],"disabled":true}}}"#,
        )
        .unwrap();
        assert_eq!(runner.status().await.unwrap().state, State::Disabled);
        assert!(runner.apply(Action::Update).await.is_err());

        // Custom overlapping entry surfaces as Conflict.
        std::fs::write(
            &cfg,
            r#"{"mcpServers":{"my-cm":{"command":"context-mode","args":["--custom"]}}}"#,
        )
        .unwrap();
        assert_eq!(runner.status().await.unwrap().state, State::Conflict);

        // Malformed JSON fails closed.
        std::fs::write(&cfg, "{bad json").unwrap();
        assert!(runner.status().await.is_err());
    }
}
