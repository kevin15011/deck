//! RTK owns all writes. Deck invokes and observes its global runner integrations.
use super::{INSTALL, Tool, home, run};
use crate::server::{App, problem};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    path::{Path as FsPath, PathBuf},
    time::Duration,
};

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Integration {
    Installed,
    NotInstalled,
    Incomplete,
    CheckFailed,
}
#[derive(Serialize)]
pub(super) struct RunnerStatus {
    id: &'static str,
    state: Integration,
}

pub(super) fn codex_home(home: &FsPath) -> Result<PathBuf, String> {
    match std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
        Some(p) => {
            let p = PathBuf::from(p);
            if !p.is_absolute() {
                return Err("Codex home must be an absolute path".into());
            }
            Ok(p)
        }
        None => Ok(home.join(".codex")),
    }
}
pub(super) fn claude_home(home: &FsPath) -> Result<PathBuf, String> {
    let root = std::env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"));
    if !root.is_absolute() {
        return Err("Claude Code configuration directory must be absolute".into());
    }
    Ok(root)
}

pub(super) fn agy_plugin_root(home: &FsPath) -> PathBuf {
    home.join(".gemini/config/plugins/rtk")
}

#[derive(Clone, Copy)]
enum Runner {
    Codex,
    Claude,
    Agy,
}

impl Runner {
    fn id(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Agy => "agy",
        }
    }

    fn root(self, home: &FsPath) -> Result<PathBuf, String> {
        match self {
            Self::Codex => codex_home(home),
            Self::Claude => claude_home(home),
            Self::Agy => Ok(agy_plugin_root(home)),
        }
    }

    fn command(self, home: &FsPath, root: &FsPath) -> tokio::process::Command {
        let mut command = tokio::process::Command::new(Tool::Rtk.executable(home));
        command.env("HOME", home).env("NO_COLOR", "1").current_dir(home);
        match self {
            Self::Codex => {
                command.env("CODEX_HOME", root);
            }
            Self::Claude => {
                command.env("CLAUDE_CONFIG_DIR", root);
            }
            Self::Agy => {}
        }
        command
    }

    async fn observe(self, home: &FsPath, root: &FsPath) -> Result<Integration, String> {
        if matches!(self, Self::Codex) {
            return detect(root).await;
        }
        if matches!(self, Self::Agy) {
            return detect_agy(root).await;
        }
        if !Tool::Rtk.executable(home).is_file() {
            return Ok(Integration::NotInstalled);
        }
        let mut cmd = self.command(home, root);
        cmd.args(["init", "--show"]);
        let output = run(cmd, Duration::from_secs(8)).await?;
        let report = std::str::from_utf8(&output).map_err(|_| "RTK status is not UTF-8")?;
        let line = |name: &str| {
            report
                .lines()
                .take_while(|line| *line != "Usage:")
                .find_map(|line| {
                    let (status, field) = line.split_once(' ')?;
                    field.strip_prefix(name).map(|value| (status, value.trim()))
                })
                .ok_or("RTK returned an unrecognized Claude Code status")
        };
        let hook = line("Hook:")?;
        let instructions = line("RTK.md:")?;
        let global = line("Global (~/.claude/CLAUDE.md):")?;
        let settings = line("settings.json:")?;
        let config: serde_json::Value = match read(&root.join("settings.json")).await? {
            Some(text) if !text.trim().is_empty() => {
                serde_json::from_str(text.trim_start_matches('\u{feff}'))
                    .map_err(|_| "Claude Code settings could not be read")?
            }
            _ => serde_json::Value::Null,
        };
        if [hook, instructions, global]
            .iter()
            .all(|(status, _)| *status == "[--]")
            && !settings.1.starts_with("RTK hooks configured")
        {
            return Ok(Integration::NotInstalled);
        }
        if hook == ("[ok]", "rtk hook claude (native binary command)")
            && instructions.0 == "[ok]"
            && global == ("[ok]", "@RTK.md reference")
            && settings.1.starts_with("RTK hooks configured")
            && config["disableAllHooks"] != true
        {
            Ok(Integration::Installed)
        } else {
            Ok(Integration::Incomplete)
        }
    }

    async fn status(self, home: &FsPath) -> RunnerStatus {
        let state = match self.root(home) {
            Ok(root) => self
                .observe(home, &root)
                .await
                .unwrap_or(Integration::CheckFailed),
            Err(_) => Integration::CheckFailed,
        };
        RunnerStatus {
            id: self.id(),
            state,
        }
    }

    async fn apply(
        self,
        home: &FsPath,
        root: &FsPath,
        action: Action,
    ) -> Result<(RunnerStatus, Vec<serde_json::Value>), String> {
        if !Tool::Rtk.executable(home).is_file() {
            return Err("Install RTK before configuring a runner".into());
        }
        let before = self.snapshot(root).await?;
        let mut cmd = self.command(home, root);
        cmd.args(["init", "-g"]);
        if matches!(self, Self::Codex) {
            cmd.arg("--codex");
        } else if matches!(self, Self::Agy) {
            cmd.args(["--agent", "antigravity"]);
        }
        if matches!(action, Action::Remove) {
            cmd.arg("--uninstall");
        } else if matches!(self, Self::Claude) {
            cmd.arg("--auto-patch");
        }
        run(cmd, Duration::from_secs(20)).await?;
        let observed = self.observe(home, root).await?;
        let expected = if matches!(action, Action::Remove) {
            Integration::NotInstalled
        } else {
            Integration::Installed
        };
        if observed != expected {
            return Err("RTK finished, but the requested integration state could not be verified. Refresh the status and check RTK before retrying.".into());
        }
        let after = self.snapshot(root).await?;
        let changes = before.iter().zip(after.iter()).filter(|(a,b)| a.1 != b.1)
            .map(|(a,b)| json!({"path":a.0,"change":if a.1.is_none(){"created"}else if b.1.is_none(){"removed"}else{"modified"}})).collect();
        Ok((
            RunnerStatus {
                id: self.id(),
                state: observed,
            },
            changes,
        ))
    }

    // Hash only the documented runner files. RTK owns the writes.
    async fn snapshot(self, root: &FsPath) -> Result<Vec<(PathBuf, Option<Vec<u8>>)>, String> {
        let names: &[&str] = match self {
            Self::Codex => &[
                "AGENTS.md",
                "RTK.md",
                "hooks.json",
                "hooks.json.bak",
                "config.toml",
            ],
            Self::Claude => &[
                "CLAUDE.md",
                "RTK.md",
                "settings.json",
                "settings.json.bak",
                "hooks/rtk-rewrite.sh",
            ],
            Self::Agy => &["plugin.json", "hooks.json", "rules/AGENTS.md"],
        };
        let mut result = Vec::new();
        for name in names {
            let path = root.join(name);
            let hash = read(&path)
                .await?
                .map(|body| Sha256::digest(body.as_bytes()).to_vec());
            result.push((path, hash));
        }
        Ok(result)
    }
}
const OWNED: &str =
    "<!-- rtk-owned: written by `rtk init --codex`, removed by `rtk init --codex --uninstall` -->";
pub(super) async fn read(path: &FsPath) -> Result<Option<String>, String> {
    use tokio::io::AsyncReadExt;
    match tokio::fs::metadata(path).await {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Ok(m) if m.is_file() && m.len() <= 1024 * 1024 => {}
        _ => return Err("Cannot safely inspect runner configuration".into()),
    }
    let file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Cannot read runner configuration".into()),
    };
    let mut bytes = vec![];
    file.take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "Cannot read runner configuration")?;
    if bytes.len() > 1024 * 1024 {
        return Err("runner configuration exceeds its inspection limit".into());
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "runner configuration is not UTF-8".into())
}
async fn detect(root: &FsPath) -> Result<Integration, String> {
    let document = read(&root.join("RTK.md"))
        .await?
        .is_some_and(|s| s.starts_with(OWNED));
    let reference = format!("@{}", root.join("RTK.md").display());
    let agents = read(&root.join("AGENTS.md")).await?.is_some_and(|s| {
        s.lines()
            .any(|l| l.trim() == reference || l.trim() == "@RTK.md")
    });
    let hook = if let Some(text) = read(&root.join("hooks.json")).await? {
        let value: serde_json::Value =
            serde_json::from_str(&text).map_err(|_| "Codex hooks could not be read")?;
        value
            .pointer("/hooks/PreToolUse")
            .and_then(|v| v.as_array())
            .is_some_and(|entries| {
                entries.iter().any(|entry| {
                    entry["matcher"] == "Bash"
                        && entry["hooks"].as_array().is_some_and(|hooks| {
                            hooks
                                .iter()
                                .any(|h| h["type"] == "command" && h["command"] == "rtk hook codex")
                        })
                })
            })
    } else {
        false
    };
    Ok(match (document, agents, hook) {
        (true, true, true) => Integration::Installed,
        (false, false, false) => Integration::NotInstalled,
        _ => Integration::Incomplete,
    })
}
async fn detect_agy(root: &FsPath) -> Result<Integration, String> {
    let plugin = if let Some(text) = read(&root.join("plugin.json")).await? {
        let value: serde_json::Value =
            serde_json::from_str(&text).map_err(|_| "Antigravity RTK plugin.json could not be read")?;
        value["name"] == "rtk"
    } else {
        false
    };
    let hook = if let Some(text) = read(&root.join("hooks.json")).await? {
        let value: serde_json::Value =
            serde_json::from_str(&text).map_err(|_| "Antigravity RTK hooks.json could not be read")?;
        value["rtk-rewrite"]["enabled"] != false
            && value
                .pointer("/rtk-rewrite/PreToolUse")
                .and_then(|v| v.as_array())
                .is_some_and(|entries| {
                    entries.iter().any(|entry| {
                        entry["matcher"] == "run_command"
                            && entry["hooks"].as_array().is_some_and(|hooks| {
                                hooks.iter().any(|h| {
                                    h["type"] == "command"
                                        && h["command"] == "rtk hook antigravity"
                                })
                            })
                    })
                })
    } else {
        false
    };
    let rules = read(&root.join("rules/AGENTS.md"))
        .await?
        .is_some_and(|s| !s.trim().is_empty());
    Ok(match (plugin, hook, rules) {
        (true, true, true) => Integration::Installed,
        (false, false, false) => Integration::NotInstalled,
        _ => Integration::Incomplete,
    })
}
pub(super) async fn statuses(home: &FsPath) -> Vec<RunnerStatus> {
    let (codex, claude, agy) = tokio::join!(
        Runner::Codex.status(home),
        Runner::Claude.status(home),
        Runner::Agy.status(home)
    );
    vec![codex, claude, agy]
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    api: u32,
    action: Action,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Action {
    Install,
    Update,
    Remove,
}

pub async fn change(
    State(app): State<App>,
    Path(runner): Path<String>,
    Json(r): Json<Request>,
) -> Response {
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }
    if r.api != deck2_shared::API {
        return problem(StatusCode::BAD_REQUEST, "api", "Unsupported API");
    }
    let runner = match runner.as_str() {
        "codex" => Runner::Codex,
        "claude" => Runner::Claude,
        "agy" => Runner::Agy,
        _ => {
            return problem(
                StatusCode::BAD_REQUEST,
                "rtk_runner",
                "This runner is not supported by RTK settings",
            );
        }
    };
    if !app.persistence_available() {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage",
            "Tool settings are unavailable",
        );
    }
    let _gate = match INSTALL.try_lock() {
        Ok(g) => g,
        Err(_) => {
            return problem(
                StatusCode::CONFLICT,
                "tool_busy",
                "Another tool change is running",
            );
        }
    };
    let result = async {
        let home = home()?;
        let root = runner.root(&home)?;
        runner.apply(&home, &root, r.action).await
    }
    .await;
    match result {
        Ok((runner, changes)) => {
            Json(json!({"api":deck2_shared::API,"runner":runner,"changes":changes})).into_response()
        }
        Err(e) => problem(StatusCode::CONFLICT, "rtk_runner_failed", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Protects serialization with binary installation; refusal must precede effects.
    #[tokio::test]
    async fn external_tools_rtk_runner_serialization() {
        let d = tempfile::tempdir().unwrap();
        let store = crate::Store::open_memory(d.path().to_str().unwrap()).unwrap();
        let app = App::new(
            store,
            "127.0.0.1:1234".into(),
            "/missing".into(),
            None,
            "admin".into(),
            "recover".into(),
        );
        let _gate = INSTALL.lock().await;
        let response = change(
            State(app),
            Path("codex".into()),
            Json(Request {
                api: deck2_shared::API,
                action: Action::Install,
            }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }
    // Protects RTK ownership detection, including unrelated hooks and partial installs.
    // Oracle: all three upstream components are needed; unrelated files are inert.
    #[tokio::test]
    async fn external_tools_rtk_runner_detection() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        assert_eq!(detect(root).await.unwrap(), Integration::NotInstalled);
        std::fs::write(
            root.join("hooks.json"),
            r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo keep"}]}]}}"#,
        )
        .unwrap();
        std::fs::write(root.join("AGENTS.md"), "User instructions").unwrap();
        std::fs::write(root.join("RTK.md"), "User document").unwrap();
        assert_eq!(detect(root).await.unwrap(), Integration::NotInstalled);
        std::fs::write(root.join("RTK.md"), OWNED).unwrap();
        assert_eq!(detect(root).await.unwrap(), Integration::Incomplete);
        std::fs::write(
            root.join("AGENTS.md"),
            format!("User instructions\n@{}\n", root.join("RTK.md").display()),
        )
        .unwrap();
        std::fs::write(root.join("hooks.json"),r#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"rtk hook codex"}]}]}}"#).unwrap();
        assert_eq!(detect(root).await.unwrap(), Integration::Installed);
        std::fs::write(root.join("hooks.json"), "malformed").unwrap();
        assert!(detect(root).await.is_err());
    }

    #[tokio::test]
    async fn external_tools_rtk_agy_detection() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        assert_eq!(detect_agy(root).await.unwrap(), Integration::NotInstalled);
        std::fs::write(root.join("plugin.json"), r#"{"name":"rtk"}"#).unwrap();
        assert_eq!(detect_agy(root).await.unwrap(), Integration::Incomplete);
        std::fs::create_dir_all(root.join("rules")).unwrap();
        std::fs::write(root.join("rules/AGENTS.md"), "# Command output\n").unwrap();
        std::fs::write(
            root.join("hooks.json"),
            r#"{"rtk-rewrite":{"enabled":true,"PreToolUse":[{"matcher":"run_command","hooks":[{"type":"command","command":"rtk hook antigravity"}]}]}}"#,
        )
        .unwrap();
        assert_eq!(detect_agy(root).await.unwrap(), Integration::Installed);
        std::fs::write(root.join("hooks.json"), "malformed").unwrap();
        assert!(detect_agy(root).await.is_err());
    }
}
