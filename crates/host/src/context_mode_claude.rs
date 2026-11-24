use super::{
    Action, MARKET, Outcome, PLUGIN, SOURCE, State, Status, context_server, official_source,
    read_json,
};
use crate::external_tools::{home, run, runners::claude_home};
use serde::Deserialize;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;

pub(super) struct Runner {
    home: PathBuf,
    root: PathBuf,
    binary: PathBuf,
}

struct Observation {
    status: Status,
    marketplace: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Plugin {
    id: String,
    scope: String,
    version: Option<String>,
    enabled: bool,
    #[serde(default)]
    errors: Vec<String>,
}

impl Runner {
    pub(super) fn for_host() -> Result<Self, String> {
        let home = home()?;
        Ok(Self {
            root: claude_home(&home)?,
            home,
            binary: crate::runner_management::path_tool("claude")
                .map_err(|_| "Install Claude Code and make it available on the Deck host PATH.")?,
        })
    }

    async fn command(&self, args: &[&str], seconds: u64) -> Result<Vec<u8>, String> {
        let mut cmd = Command::new(&self.binary);
        cmd.args(args)
            .env("HOME", &self.home)
            .env("CLAUDE_CONFIG_DIR", &self.root)
            .env("NO_COLOR", "1")
            .current_dir(&self.home);
        run(cmd, Duration::from_secs(seconds))
            .await
            .map_err(|error| {
                format!(
                    "Claude Code could not run `claude {}`. {error}",
                    args.join(" ")
                )
            })
    }

    async fn marketplace(&self) -> Result<Option<bool>, String> {
        let output = self
            .command(&["plugin", "marketplace", "list", "--json"], 8)
            .await?;
        let rows: Vec<Value> = serde_json::from_slice(&output)
            .map_err(|_| "Claude Code returned an invalid marketplace inventory")?;
        if rows.iter().any(|row| !row["name"].is_string()) {
            return Err("Claude Code returned an invalid marketplace entry".into());
        }
        let mut matches = rows.iter().filter(|row| row["name"] == MARKET);
        Ok(matches.next().map(|row| {
            let source = match row["source"].as_str() {
                Some("github") => row["repo"].as_str(),
                Some("git") => row["url"].as_str(),
                _ => None,
            };
            source.is_some_and(official_source)
                && row["ref"].is_null()
                && row["path"].is_null()
                && matches.next().is_none()
        }))
    }

    async fn standalone_server(path: &Path) -> Result<bool, String> {
        let config = read_json(path).await?;
        Ok(config["mcpServers"]
            .as_object()
            .into_iter()
            .flatten()
            .any(|(name, spec)| context_server(name, spec)))
    }

    async fn observe(&self) -> Result<Observation, String> {
        let output = self.command(&["plugin", "list", "--json"], 8).await?;
        let plugins: Vec<Plugin> = serde_json::from_slice(&output)
            .map_err(|_| "Claude Code returned an invalid plugin inventory")?;
        let marketplace = self.marketplace().await?;
        let installed: Vec<_> = plugins
            .iter()
            .filter(|plugin| plugin.id == PLUGIN || plugin.id.starts_with("context-mode@"))
            .collect();
        let settings = read_json(&self.root.join("settings.json")).await?;
        let standalone = Self::standalone_server(&self.home.join(".claude.json")).await?
            || Self::standalone_server(&self.root.join(".claude.json")).await?;
        let status = match installed.as_slice() {
            _ if marketplace == Some(false) => Status::new(
                State::Conflict,
                "Review the custom Context Mode marketplace in Claude Code before continuing.",
            ),
            [] if standalone => Status::new(
                State::Standalone,
                "Claude Code has a standalone Context Mode MCP registration. Review it before installing the plugin.",
            ),
            [] => Status::new(
                State::NotInstalled,
                "Official Claude Code plugin is available to install.",
            ),
            [plugin] if plugin.id == PLUGIN && plugin.scope == "user" && !standalone => {
                if marketplace != Some(true) {
                    Status::new(
                        State::Conflict,
                        "The Context Mode plugin lacks its official marketplace in Claude Code.",
                    )
                } else if !plugin.enabled || settings["disableAllHooks"] == true {
                    Status::new(
                        State::Disabled,
                        "Enable the Context Mode plugin and hooks in Claude Code before continuing.",
                    )
                } else if !plugin.errors.is_empty() {
                    Status::new(
                        State::CheckFailed,
                        "Claude Code reported a Context Mode plugin error. Check `claude plugin list` for details.",
                    )
                } else {
                    let version = plugin
                        .version
                        .as_deref()
                        .and_then(|version| semver::Version::parse(version).ok())
                        .ok_or("Claude Code did not report a valid Context Mode version")?;
                    Status {
                        version: Some(version),
                        ..Status::new(
                            State::Installed,
                            "Claude Code reports the official user plugin enabled.",
                        )
                    }
                }
            }
            _ => Status::new(
                State::Conflict,
                "Review the overlapping or non-user Context Mode registrations in Claude Code before continuing.",
            ),
        };
        Ok(Observation {
            status,
            marketplace: marketplace == Some(true),
        })
    }

    pub(super) async fn status(&self) -> Result<Status, String> {
        Ok(self.observe().await?.status)
    }

    pub(super) async fn apply(&self, action: Action) -> Result<(Status, Outcome), String> {
        let before = self.observe().await?;
        match (action, before.status.state) {
            (Action::Install, State::Installed) => return Ok((before.status, Outcome::Current)),
            (Action::Install, State::NotInstalled) => {
                if !before.marketplace {
                    self.command(&["plugin", "marketplace", "add", SOURCE], 90)
                        .await?;
                    if self.marketplace().await? != Some(true) {
                        return Err(
                            "Claude Code did not register the official Context Mode marketplace."
                                .into(),
                        );
                    }
                }
                self.command(&["plugin", "install", PLUGIN], 90).await?;
            }
            (Action::Update, State::Installed) => {
                self.command(&["plugin", "update", PLUGIN], 90).await?;
            }
            _ => return Err(before.status.detail.into()),
        }
        let after = self.status().await?;
        if after.state != State::Installed || after.version < before.status.version {
            return Err(format!(
                "Claude Code could not verify the requested Context Mode installation. {}",
                after.detail
            ));
        }
        let outcome = match action {
            Action::Install => Outcome::Installed,
            Action::Update if after.version == before.status.version => Outcome::Current,
            Action::Update => Outcome::Updated,
            Action::Migrate => unreachable!(),
        };
        Ok((after, outcome))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Request, StatusCode},
    };
    use serde_json::json;
    use std::{fs, os::unix::fs::PermissionsExt};
    use tower::ServiceExt;

    fn fake(path: &Path, script: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, script).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    async fn request(
        router: &Router,
        cookie: &str,
        path: &str,
        action: Option<&str>,
        expected: StatusCode,
    ) -> Value {
        let req = Request::builder()
            .method(if action.is_some() { "POST" } else { "GET" })
            .uri(path)
            .header("host", "127.0.0.1:12345")
            .header("origin", "http://127.0.0.1:12345")
            .header("cookie", cookie)
            .header("content-type", "application/json")
            .body(Body::from(
                action
                    .map(|action| json!({"api":deck2_shared::API,"action":action}).to_string())
                    .unwrap_or_default(),
            ))
            .unwrap();
        let response = router.clone().oneshot(req).await.unwrap();
        let status = response.status();
        let body = to_bytes(response.into_body(), 32 * 1024).await.unwrap();
        assert_eq!(status, expected, "{}", String::from_utf8_lossy(&body));
        serde_json::from_slice(&body).unwrap()
    }

    // Protects the public settings routes and effective Claude home resolution.
    // Only vendor commands may create integration files. State comes from their inventories.
    #[tokio::test]
    async fn claude_tools_use_official_commands_through_settings() {
        const CHILD: &str = "DECK2_CLAUDE_TOOLS_TEST_HOME";
        let Some(home) = std::env::var_os(CHILD).map(PathBuf::from) else {
            let dir = tempfile::Builder::new()
                .prefix("deck-claude-tools-")
                .tempdir()
                .unwrap();
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .env_clear()
                .env("HOME", dir.path())
                .env("TMPDIR", std::env::temp_dir())
                .env("CLAUDE_CONFIG_DIR", dir.path().join("custom-claude"))
                .env("CODEX_HOME", dir.path().join("custom-codex"))
                .env("PATH", dir.path().join(".local/bin"))
                .env(CHILD, dir.path())
                .args(["--exact", "external_tools::context_mode::claude::tests::claude_tools_use_official_commands_through_settings", "--nocapture"])
                .output().unwrap();
            assert!(
                output.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        };
        let root = home.join("custom-claude");
        assert!(home.is_absolute() && home.starts_with(std::env::temp_dir()));
        assert_eq!(std::env::var_os("HOME").as_deref(), Some(home.as_os_str()));
        assert_eq!(
            std::env::var_os("CLAUDE_CONFIG_DIR").as_deref(),
            Some(root.as_os_str())
        );
        fs::create_dir(&root).unwrap();
        let bin = home.join(".local/bin");
        fake(
            &bin.join("claude"),
            r#"#!/usr/bin/python3
import json, os, sys
from pathlib import Path
home = Path(os.environ['HOME'])
root = Path(os.environ['CLAUDE_CONFIG_DIR'])
assert root == home / 'custom-claude' and Path.cwd() == home
args = sys.argv[1:]
market, plugins = root / 'marketplaces', root / 'plugins'
with (home / 'claude-calls').open('a') as log:
    log.write(' '.join(args) + '\n')
if args == ['plugin', 'list', '--json']:
    print(plugins.read_text() if plugins.exists() else '[]')
elif args == ['plugin', 'marketplace', 'list', '--json']:
    print(market.read_text() if market.exists() else '[]')
elif args == ['plugin', 'marketplace', 'add', 'mksglu/context-mode']:
    market.write_text(json.dumps([{'name':'context-mode','source':'github','repo':'mksglu/context-mode'}]))
elif args in [['plugin','install','context-mode@context-mode'], ['plugin','update','context-mode@context-mode']]:
    assert market.exists()
    if (home / 'claude-no-effect').exists(): sys.exit()
    plugins.write_text(json.dumps([{'id':'context-mode@context-mode','scope':'user','enabled':True,'version':'2.2.2' if args[1] == 'install' else '2.2.3'}]))
else:
    raise AssertionError(args)
"#,
        );
        fake(
            &bin.join("rtk"),
            r#"#!/usr/bin/python3
import os, sys
from pathlib import Path
home = Path(os.environ['HOME'])
root = Path(os.environ['CLAUDE_CONFIG_DIR'])
assert root == home / 'custom-claude' and Path.cwd() == home
with (home / 'rtk-calls').open('a') as log:
    log.write(' '.join(sys.argv[1:]) + '\n')
rtk = root / 'RTK.md'
settings = root / 'settings.json'
claude = root / 'CLAUDE.md'
if sys.argv[1:] == ['init', '--show']:
    if rtk.exists():
        print('[ok] Hook: rtk hook claude (native binary command)')
        print('[ok] RTK.md: fixture')
        print('[ok] Global (~/.claude/CLAUDE.md): @RTK.md reference')
        print('[ok] settings.json: RTK hooks configured (PreToolUse)')
    else:
        print('[--] Hook: not found')
        print('[--] RTK.md: not found')
        print('[--] Global (~/.claude/CLAUDE.md): not found')
        print('[warn] settings.json: PreToolUse hook missing')
elif sys.argv[1:] == ['init', '-g', '--auto-patch']:
    rtk.write_text('refreshed' if rtk.exists() else 'installed')
    settings.write_text('{}')
    claude.write_text('@RTK.md\n')
elif sys.argv[1:] == ['init', '-g', '--uninstall']:
    rtk.unlink()
    claude.unlink()
else:
    raise AssertionError(sys.argv[1:])
"#,
        );
        let store = crate::Store::open_memory(home.to_str().unwrap()).unwrap();
        let app = crate::server::App::new(
            store,
            "127.0.0.1:12345".into(),
            "/unused".into(),
            None,
            "admin".into(),
            "recover".into(),
        );
        let auth = crate::server::router(app.clone())
            .oneshot(
                Request::post("/auth")
                    .header("host", "127.0.0.1:12345")
                    .header("origin", "http://127.0.0.1:12345")
                    .body(Body::from(app.issue_launch()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let cookie = auth.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap();
        let router = crate::server::router(app);
        let cm = "/api/tools/context-mode/runners/claude";
        let rtk = "/api/tools/rtk/runners/claude";
        let ok = StatusCode::OK;
        assert_eq!(
            request(&router, cookie, cm, None, ok).await["state"],
            "not_installed"
        );
        fs::write(home.join("claude-no-effect"), "").unwrap();
        request(&router, cookie, cm, Some("install"), StatusCode::CONFLICT).await;
        fs::remove_file(home.join("claude-no-effect")).unwrap();
        assert_eq!(
            request(&router, cookie, cm, Some("install"), ok).await["version"],
            "2.2.2"
        );
        let updated = request(&router, cookie, cm, Some("update"), ok).await;
        assert_eq!(updated["version"], "2.2.3");
        assert_eq!(updated["outcome"], "updated");

        let plugins = root.join("plugins");
        let installed = fs::read_to_string(&plugins).unwrap();
        fs::write(&plugins, installed.replace("true", "false")).unwrap();
        assert_eq!(
            request(&router, cookie, cm, None, ok).await["state"],
            "disabled"
        );
        fs::write(
            &plugins,
            installed.replace("context-mode@context-mode", "context-mode@foreign"),
        )
        .unwrap();
        assert_eq!(
            request(&router, cookie, cm, None, ok).await["state"],
            "conflict"
        );
        request(&router, cookie, cm, Some("install"), StatusCode::CONFLICT).await;
        let commands = fs::read_to_string(home.join("claude-calls")).unwrap();
        assert_eq!(
            commands
                .lines()
                .filter(|line| !line.contains("list"))
                .collect::<Vec<_>>(),
            [
                "plugin marketplace add mksglu/context-mode",
                "plugin install context-mode@context-mode",
                "plugin install context-mode@context-mode",
                "plugin update context-mode@context-mode",
            ]
        );

        for action in ["install", "update", "remove"] {
            let result = request(&router, cookie, rtk, Some(action), ok).await;
            assert_eq!(
                result["runner"],
                json!({"id":"claude","state":if action == "remove" {"not_installed"} else {"installed"}})
            );
            assert!(
                result["changes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|change| change["path"] == root.join("RTK.md").to_str().unwrap())
            );
        }
        assert_eq!(
            fs::read_to_string(home.join("rtk-calls")).unwrap(),
            concat!(
                "init -g --auto-patch\ninit --show\n",
                "init -g --auto-patch\ninit --show\n",
                "init -g --uninstall\ninit --show\n",
            )
        );
    }
}
