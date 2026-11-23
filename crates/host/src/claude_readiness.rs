use std::{
    ffi::OsString,
    fs::File,
    io::{ErrorKind, Read},
    path::{Path, PathBuf},
};
use tokio::process::Command;

use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};

use crate::server::App;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Status {
    NotInstalled,
    SignedOut,
    OtherProviderOrBilling,
    EnvironmentOverride,
    ConfigurationOverride,
    ProjectConfigurationOverride,
    RuntimeUnavailable,
    SubscriptionSignedIn,
    Unknown,
}

#[derive(Serialize)]
pub(crate) struct Readiness {
    status: Status,
    execution_available: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthStatus {
    logged_in: bool,
    auth_method: Option<String>,
    api_provider: Option<String>,
    subscription_type: Option<String>,
}

fn classify(success: bool, output: &[u8], has_override: bool) -> Status {
    let Ok(auth) = serde_json::from_slice::<AuthStatus>(output) else {
        return Status::Unknown;
    };
    if !auth.logged_in {
        return Status::SignedOut;
    }
    if !success {
        return Status::Unknown;
    }
    if has_override {
        return Status::EnvironmentOverride;
    }
    match (auth.api_provider.as_deref(), auth.auth_method.as_deref()) {
        (Some("firstParty"), Some("claude.ai")) => {}
        (Some(provider), _) if provider != "firstParty" => return Status::OtherProviderOrBilling,
        (_, Some("console" | "api_key" | "apiKey")) => return Status::OtherProviderOrBilling,
        _ => return Status::Unknown,
    }
    match auth.subscription_type.as_deref() {
        Some("pro" | "max" | "ultra" | "team" | "enterprise") => Status::SubscriptionSignedIn,
        Some("free") => Status::OtherProviderOrBilling,
        _ => Status::Unknown,
    }
}

// These apply to the CLI probe and the SDK's native subprocess.
pub(crate) const SETTINGS: &str = r#"{"disableClaudeAiConnectors":true,"disableAllHooks":true,"autoMemoryEnabled":false,"forceLoginMethod":"claudeai","attribution":{"commit":""}}"#;

pub(crate) struct Launch {
    home: PathBuf,
    env: Vec<(&'static str, OsString)>,
    cwd: PathBuf,
    trusted: bool,
}

impl Launch {
    pub(crate) fn new(project: Option<&Path>) -> Result<Self, Status> {
        if [
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_CUSTOM_HEADERS",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "CLAUDE_CODE_USE_FOUNDRY",
            "CLAUDE_CODE_USE_GATEWAY",
        ]
        .iter()
        .any(|key| std::env::var_os(key).is_some_and(|value| !value.is_empty()))
        {
            return Err(Status::EnvironmentOverride);
        }
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .ok_or(Status::Unknown)?;
        let env = [
            "HOME",
            "PATH",
            "LANG",
            "LC_ALL",
            "USER",
            "LOGNAME",
            "DBUS_SESSION_BUS_ADDRESS",
            "XDG_RUNTIME_DIR",
            "CLAUDE_CONFIG_DIR",
        ]
        .into_iter()
        .filter_map(|key| std::env::var_os(key).map(|value| (key, value)))
        .collect();
        let launch = Self {
            home,
            env,
            cwd: project.unwrap_or(Path::new("/")).into(),
            trusted: project.is_some(),
        };
        launch.verify_policy()?;
        Ok(launch)
    }

    pub(crate) fn storage(&self) -> Result<PathBuf, Status> {
        let root = self
            .env
            .iter()
            .find(|(key, _)| *key == "CLAUDE_CONFIG_DIR")
            .map(|(_, value)| PathBuf::from(value))
            .unwrap_or_else(|| self.home.join(".claude"));
        if !root.is_absolute() {
            return Err(Status::ConfigurationOverride);
        }
        match root.canonicalize() {
            Ok(path) => Ok(path),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(root),
            Err(_) => Err(Status::ConfigurationOverride),
        }
    }

    pub(crate) fn verify_policy(&self) -> Result<(), Status> {
        // Managed settings still apply in safe mode. A managed extension,
        // helper or environment setting cannot inherit Deck launch authority.
        for path in [
            "/etc/claude-code/managed-settings.json",
            "/etc/claude-code/managed-settings.d",
            "/etc/claude-code/managed-mcp.json",
        ] {
            match std::fs::symlink_metadata(path) {
                Err(e) if e.kind() == ErrorKind::NotFound => {}
                _ => return Err(Status::ConfigurationOverride),
            }
        }
        self.verify_launch_settings()
    }

    fn verify_launch_settings(&self) -> Result<(), Status> {
        empty_settings(&self.storage()?.join("remote-settings.json"))?;
        if self.trusted {
            // The CLI and SDK select only the project source, resolved from
            // the launch directory. Ancestors may supply CLAUDE.md, but they
            // do not supply the shared settings file for this session.
            empty_settings(&self.cwd.join(".claude/settings.json"))
                .map_err(|_| Status::ProjectConfigurationOverride)?;
        }
        Ok(())
    }

    pub(crate) fn command(&self, binary: &Path) -> Command {
        let mut cmd = Command::new(binary);
        cmd.env_clear()
            .envs(self.env.iter().map(|(key, value)| (key, value)))
            .env("DISABLE_AUTOUPDATER", "1")
            .env("CLAUDE_CODE_DISABLE_BACKGROUND_TASKS", "1")
            .current_dir(&self.cwd);
        cmd
    }

    pub(crate) fn sources(&self) -> &str {
        if self.trusted { "project" } else { "" }
    }

    pub(crate) async fn status(&self, binary: &Path) -> Status {
        let mut cmd = self.command(binary);
        cmd.args([
            "--setting-sources",
            self.sources(),
            "--strict-mcp-config",
            "--mcp-config",
            r#"{"mcpServers":{}}"#,
            "--settings",
            SETTINGS,
            "--disable-slash-commands",
        ]);
        if !self.trusted {
            cmd.arg("--safe-mode");
        }
        cmd.args(["auth", "status", "--json"]);
        match crate::native::claude_auth_probe(cmd).await {
            Ok((success, output)) => classify(success, &output, false),
            Err(_) => Status::Unknown,
        }
    }
}

fn empty_settings(path: &Path) -> Result<(), Status> {
    use std::os::unix::fs::OpenOptionsExt;
    let file = match File::options()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
    {
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Ok(file) if file.metadata().is_ok_and(|metadata| metadata.is_file()) => file,
        _ => return Err(Status::ConfigurationOverride),
    };
    let mut bytes = Vec::new();
    file.take(64 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|_| Status::ConfigurationOverride)?;
    let settings: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(&bytes).map_err(|_| Status::ConfigurationOverride)?;
    if settings.is_empty() {
        Ok(())
    } else {
        Err(Status::ConfigurationOverride)
    }
}

impl Status {
    pub(crate) fn message(&self) -> &'static str {
        match self {
            Self::NotInstalled => "Claude Code is missing from the host PATH.",
            Self::SignedOut => "Run claude auth login --claudeai on the host.",
            Self::OtherProviderOrBilling => {
                "Claude Code requires a first-party Claude subscription sign-in."
            }
            Self::EnvironmentOverride => {
                "Remove Claude authentication or provider overrides from the Deck host environment."
            }
            Self::ConfigurationOverride => {
                "Check the host's Claude config directory and managed settings with your administrator."
            }
            Self::ProjectConfigurationOverride => {
                "Choose a project without shared Claude settings, or review its .claude/settings.json."
            }
            Self::RuntimeUnavailable => {
                "The Claude Agent SDK bridge requires Node.js 22 or later on the host PATH."
            }
            Self::SubscriptionSignedIn => "Claude Code subscription sign-in is verified.",
            Self::Unknown => "Deck could not verify the Claude Code subscription sign-in.",
        }
    }
}

pub(crate) async fn inspect(binary: &Path) -> Status {
    match Launch::new(None) {
        Ok(launch) => launch.status(binary).await,
        Err(status) => status,
    }
}

pub(crate) async fn readiness(State(app): State<App>) -> Json<Readiness> {
    let status = match crate::runner_management::installed_path(&app, "claude") {
        Ok(binary) => inspect(&binary).await,
        Err(_) => Status::NotInstalled,
    };
    Json(Readiness {
        execution_available: status == Status::SubscriptionSignedIn
            && crate::claude::node_runtime().is_ok(),
        status,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn trusted_project_settings_are_scoped_to_the_launch_directory() {
        let home = tempfile::tempdir().unwrap();
        let ancestor = home.path().join("projects");
        let cwd = ancestor.join("repo");
        let user = home.path().join(".claude");
        let shared = cwd.join(".claude/settings.json");
        let remote = user.join("remote-settings.json");
        for settings in [
            user.join("settings.json"),
            ancestor.join(".claude/settings.json"),
            cwd.join(".claude/settings.local.json"),
        ] {
            std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
            std::fs::write(settings, r#"{"disableAllHooks":true}"#).unwrap();
        }
        let launch = Launch {
            home: home.path().into(),
            env: vec![],
            cwd,
            trusted: true,
        };

        assert_eq!(launch.verify_launch_settings(), Ok(()));
        std::fs::write(&shared, "{}").unwrap();
        assert_eq!(launch.verify_launch_settings(), Ok(()));
        std::fs::write(&shared, r#"{"disableAllHooks":true}"#).unwrap();
        assert_eq!(
            launch.verify_launch_settings(),
            Err(Status::ProjectConfigurationOverride),
        );
        std::fs::remove_file(shared).unwrap();
        std::fs::write(remote, r#"{"disableAllHooks":true}"#).unwrap();
        assert_eq!(
            launch.verify_launch_settings(),
            Err(Status::ConfigurationOverride),
        );
    }

    #[tokio::test]
    async fn auth_probe_projects_only_supported_status() {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("claude");
        for (code, body, has_override, expected) in [
            (
                0,
                r#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"team","email":"private","token":"private"}"#,
                false,
                Status::SubscriptionSignedIn,
            ),
            (
                0,
                r#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"team"}"#,
                true,
                Status::EnvironmentOverride,
            ),
            (1, r#"{"loggedIn":false}"#, false, Status::SignedOut),
            (
                1,
                r#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"pro"}"#,
                false,
                Status::Unknown,
            ),
            (
                0,
                r#"{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty","subscriptionType":null}"#,
                false,
                Status::OtherProviderOrBilling,
            ),
            (
                0,
                r#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"bedrock","subscriptionType":"team"}"#,
                false,
                Status::OtherProviderOrBilling,
            ),
            (
                0,
                r#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"unrecognized"}"#,
                false,
                Status::Unknown,
            ),
            (
                0,
                r#"{"loggedIn":false,"loggedIn":true}"#,
                false,
                Status::Unknown,
            ),
            (2, r#"{"loggedIn":false}"#, false, Status::Unknown),
        ] {
            std::fs::write(
                &binary,
                format!("#!/bin/sh\n[ \"$*\" = 'auth status --json' ] && [ \"$PWD\" = / ] || exit 90\necho private >&2\nprintf '%s' '{body}'\nexit {code}\n"),
            ).unwrap();
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
            let mut command = Command::new(&binary);
            command.current_dir("/").args(["auth", "status", "--json"]);
            let status = match crate::native::claude_auth_probe(command).await {
                Ok((success, bytes)) => classify(success, &bytes, has_override),
                Err(_) => Status::Unknown,
            };
            assert_eq!(status, expected);
            let public = serde_json::to_value(Readiness {
                status,
                execution_available: false,
            })
            .unwrap();
            assert_eq!(public.as_object().unwrap().len(), 2);
            assert!(!public.to_string().contains("private"));
        }
    }

    // Exercise the normal router and the host PATH lookup. The isolated child
    // can only find the fake CLI and has no native account environment.
    #[tokio::test]
    async fn authenticated_settings_route_observes_host_path() {
        use axum::{
            body::Body,
            http::{Request, StatusCode, header},
        };
        use http_body_util::BodyExt;
        use tower::ServiceExt;

        const NAME: &str =
            "claude_readiness::tests::authenticated_settings_route_observes_host_path";
        const ROUTE: &str = "/api/runners/claude/readiness";
        let Some(dir) =
            std::env::var_os("DECK2_CLAUDE_READINESS_CHILD").map(std::path::PathBuf::from)
        else {
            let d = tempfile::tempdir().unwrap();
            let child = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", NAME, "--nocapture"])
                .env_clear()
                .env("DECK2_CLAUDE_READINESS_CHILD", d.path())
                .env("HOME", d.path())
                .env("PATH", d.path())
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
        let host = "127.0.0.1:32122";
        let app = App::new(
            crate::Store::open_memory(dir.to_str().unwrap()).unwrap(),
            host.into(),
            dir.join("absent-codex"),
            Some("Codex absent".into()),
            "admin".into(),
            "recover".into(),
        );
        let router = crate::server::router(app.clone());
        let get = |cookie: &str| {
            Request::get(ROUTE)
                .header(header::HOST, host)
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap()
        };
        let auth = router
            .clone()
            .oneshot(
                Request::post("/auth")
                    .header(header::HOST, host)
                    .header(header::ORIGIN, format!("http://{host}"))
                    .body(Body::from(app.issue_launch()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let cookie = auth.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap();
        assert_eq!(
            router.clone().oneshot(get("")).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );

        for expected in [Status::NotInstalled, Status::SubscriptionSignedIn] {
            if expected == Status::SubscriptionSignedIn {
                let exe = dir.join("claude");
                std::fs::write(&exe, r#"#!/bin/sh
case "$*" in *' auth status --json') ;; *) exit 90 ;; esac
printf '%s' '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"team","email":"private"}'
"#).unwrap();
                std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o700)).unwrap();
            }
            let res = router.clone().oneshot(get(cookie)).await.unwrap();
            assert_eq!(res.status(), StatusCode::OK);
            assert_eq!(res.headers()[header::CACHE_CONTROL], "no-store");
            let body = res.into_body().collect().await.unwrap().to_bytes();
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
                serde_json::to_value(Readiness {
                    status: expected,
                    execution_available: false
                })
                .unwrap()
            );
        }
    }
}
