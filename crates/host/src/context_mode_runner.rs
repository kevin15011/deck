//! Context Mode owns its hook trust setup. Codex owns the plugin and its MCP registration.
use super::{INSTALL, home, run, runners};
use crate::{
    native::Native,
    server::{ProjectState, problem},
};
use axum::{
    Json,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Path as FsPath, PathBuf},
    time::Duration,
};
use tokio::process::Command;

pub(crate) const PLUGIN: &str = "context-mode@context-mode";
const MARKET: &str = "context-mode";
const SOURCE: &str = "mksglu/context-mode";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum State {
    NotInstalled,
    Installed,
    Incomplete,
    Standalone,
    MigrationAvailable,
    Conflict,
    Disabled,
    CheckFailed,
}

struct Status {
    state: State,
    version: Option<semver::Version>,
    detail: &'static str,
}

impl Status {
    fn new(state: State, detail: &'static str) -> Self {
        Self {
            state,
            version: None,
            detail,
        }
    }
}

// Native lists collapse same-name registrations. Inspect user intent before
// asking Codex which transport won, including explicitly disabled entries.
fn context_name(value: &str) -> bool {
    value
        .split(|c: char| matches!(c, '/' | '\\' | '@' | ':' | ' ' | '\t' | '"' | '\''))
        .any(|part| matches!(part, "context-mode" | "context_mode" | "context-mode.cmd"))
}

pub(crate) fn context_server(name: &str, spec: &Value) -> bool {
    context_name(name)
        || ["command", "url"]
            .iter()
            .any(|key| spec[key].as_str().is_some_and(context_name))
        || spec["args"]
            .as_array()
            .is_some_and(|args| args.iter().any(|v| v.as_str().is_some_and(context_name)))
}

fn official_source(source: &str) -> bool {
    let repo = source.strip_prefix("https://github.com/").unwrap_or(source);
    repo.strip_suffix(".git")
        .unwrap_or(repo)
        .eq_ignore_ascii_case(SOURCE)
}

fn managed_market(market: &Value) -> bool {
    market["source_type"] == "git"
        && market["source"].as_str().is_some_and(official_source)
        && market["ref"].is_null()
        && market["ref_name"].is_null()
        && (market["sparse_paths"].is_null()
            || market["sparse_paths"].as_array().is_some_and(Vec::is_empty))
}

fn plugin_features_enabled(config: &Value) -> bool {
    ["plugins", "hooks", "plugin_hooks"]
        .iter()
        .all(|key| config["features"][key] != false)
}

async fn config(root: &FsPath) -> Result<Value, String> {
    let Some(body) = runners::read(&root.join("config.toml")).await? else {
        return Ok(json!({}));
    };
    toml::from_str(&body).map_err(|_| "Cannot parse Codex configuration".into())
}

pub(crate) async fn configured() -> bool {
    let Ok(root) = home().and_then(|p| runners::codex_home(&p)) else {
        return false;
    };
    configured_at(&root).await
}

pub(crate) async fn configured_at(root: &FsPath) -> bool {
    config(root).await.is_ok_and(|config| {
        config["plugins"][PLUGIN]["enabled"] == true
            && plugin_features_enabled(&config)
            && managed_market(&config["marketplaces"][MARKET])
    })
}

pub(crate) fn plugin_hook(hook: &Value) -> bool {
    hook["source"] == "plugin" && hook["pluginId"] == PLUGIN
}

fn hooks_ready(hooks: &[Value]) -> bool {
    let own: Vec<_> = hooks.iter().filter(|hook| plugin_hook(hook)).collect();
    !own.is_empty()
        && own
            .iter()
            .all(|hook| hook["enabled"] == true && hook["trustStatus"] == "trusted")
}

const MIGRATION_FILE: &str = ".deck-context-mode-migration.json";

fn marketplace_root(root: &FsPath) -> PathBuf {
    root.join(".tmp/marketplaces").join(MARKET)
}

pub(crate) async fn passive_marketplace_source() -> Option<String> {
    let root = home().and_then(|home| runners::codex_home(&home)).ok()?;
    passive_source(&root).await
}

async fn passive_source(root: &FsPath) -> Option<String> {
    let config = config(root).await.ok()?;
    // Codex automatically upgrades Git marketplaces at app-server startup.
    // Keep resolution on its existing checkout while making this one a local
    // source for the process. Native config on disk remains the Git source.
    managed_market(&config["marketplaces"][MARKET])
        .then(|| serde_json::to_string(&marketplace_root(root)).ok())
        .flatten()
}

fn legacy_server(spec: &Value) -> bool {
    spec.as_object().is_some_and(|spec| spec.len() == 2)
        && spec["command"].as_str().is_some_and(|command| {
            let path = FsPath::new(command);
            (command == MARKET || path.is_absolute())
                && path.file_name().is_some_and(|name| name == MARKET)
        })
        && spec["args"] == json!(["mcp"])
}

async fn read_json(path: &FsPath) -> Result<Value, String> {
    match runners::read(path).await? {
        Some(body) => {
            serde_json::from_str(&body).map_err(|_| format!("Cannot parse {}", path.display()))
        }
        None => Ok(Value::Null),
    }
}

fn node_command(command: &str) -> bool {
    let path = FsPath::new(command);
    command == "node" || path.is_absolute() && path.file_name().is_some_and(|n| n == "node")
}

fn bundle_hook(command: &str, bundle: &FsPath) -> bool {
    let Some(prefix) = command.strip_suffix(" --agent codex") else {
        return false;
    };
    let script = bundle.join("hook.mjs");
    let Some(script) = script.to_str() else {
        return false;
    };
    [
        format!(" \"{script}\""),
        format!(" '{script}'"),
        format!(" {script}"),
    ]
    .iter()
    .filter_map(|suffix| prefix.strip_suffix(suffix))
    .any(|node| {
        let unquoted = node
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| node.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(node);
        node_command(unquoted)
            && (node != unquoted || !node.contains(char::is_whitespace))
            && !unquoted.contains([';', '|', '&', '$', '`', '<', '>', '\n', '\r', '"', '\''])
    })
}

fn has_unrecognized_hooks(hooks: &Value, bundle: Option<&Bundle>) -> bool {
    hooks
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(_, groups)| groups.as_array())
        .flatten()
        .filter_map(|group| group["hooks"].as_array())
        .flatten()
        .any(|hook| {
            hook["command"].as_str().is_some_and(|cmd| {
                context_name(cmd) && !bundle.is_some_and(|b| bundle_hook(cmd, &b.path))
            })
        })
}

fn verify_hook_inventory(hooks: &[Value], bundle: &FsPath) -> Result<(), String> {
    for hook in hooks
        .iter()
        .filter(|h| !plugin_hook(h) && h["enabled"] == true && h["trustStatus"] == "trusted")
    {
        let Some(command) = hook["command"].as_str().filter(|cmd| context_name(cmd)) else {
            continue;
        };
        if !bundle_hook(command, bundle) {
            return Err(
                "Deck could not identify the source of an enabled Context Mode hook.".into(),
            );
        }
        if hook["eventName"].is_string()
            && hooks.iter().any(|other| {
                plugin_hook(other)
                    && other["enabled"] == true
                    && other["trustStatus"] == "trusted"
                    && other["eventName"] == hook["eventName"]
                    && other["matcher"] == hook["matcher"]
            })
        {
            return Err("Codex reports enabled user and plugin Context Mode hooks for the same event and matcher.".into());
        }
    }
    Ok(())
}

async fn catalog_version(root: &FsPath) -> Result<Option<semver::Version>, String> {
    let index = read_json(&root.join(".agents/plugins/marketplace.json")).await?;
    if index.is_null() {
        return Ok(None);
    }
    let source = index["plugins"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|entry| entry["name"] == MARKET)
        .filter(|_| index["name"] == MARKET)
        .filter(|entry| entry["source"]["source"] == "local")
        .and_then(|entry| entry["source"]["path"].as_str())
        .map(FsPath::new)
        .filter(|path| {
            path.components().all(|part| {
                matches!(
                    part,
                    std::path::Component::CurDir | std::path::Component::Normal(_)
                )
            })
        })
        .ok_or("The cached official marketplace has no valid Context Mode plugin source")?;
    let canonical_root = tokio::fs::canonicalize(root)
        .await
        .map_err(|_| "The cached Context Mode marketplace is unavailable")?;
    let bundle = tokio::fs::canonicalize(root.join(source))
        .await
        .map_err(|_| "The cached Context Mode marketplace bundle is unavailable")?;
    if !bundle.starts_with(canonical_root) {
        return Err("The cached Context Mode marketplace bundle is outside its checkout".into());
    }
    manifest_version(&bundle).await.map(Some)
}

struct Bundle {
    version: semver::Version,
    path: PathBuf,
    hooks: Vec<String>,
}

async fn installed_bundle(root: &FsPath) -> Result<Option<Bundle>, String> {
    let cache = root.join("plugins/cache").join(MARKET).join(MARKET);
    let mut versions = match tokio::fs::read_dir(&cache).await {
        Ok(versions) => versions,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Cannot read the Context Mode plugin cache".into()),
    };
    let mut active: Option<semver::Version> = None;
    while let Some(entry) = versions
        .next_entry()
        .await
        .map_err(|_| "Cannot inspect plugin versions")?
    {
        if !entry.file_type().await.is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == "local" {
            return Err("Codex is using a local override for the Context Mode plugin".into());
        }
        if let Ok(version) = semver::Version::parse(&name)
            && active.as_ref().is_none_or(|prior| &version > prior)
        {
            active = Some(version);
        }
    }
    let Some(version) = active else {
        return Ok(None);
    };
    let bundle = cache.join(version.to_string());
    if manifest_version(&bundle).await.ok().as_ref() != Some(&version)
        || !bundle.join("cli.mjs").is_file()
        || !bundle.join("server.mjs").is_file()
    {
        return Ok(None);
    }
    let mcp = read_json(&bundle.join(".codex-plugin/mcp.json")).await?;
    let server = &mcp["mcpServers"][MARKET];
    if server["command"] != "node"
        || server["args"] != json!(["./server.mjs", "--agent", "codex"])
        || server["cwd"] != "."
    {
        return Ok(None);
    }
    let hooks = read_json(&bundle.join(".codex-plugin/hooks.json")).await?;
    let Some(events) = hooks["hooks"].as_object() else {
        return Ok(None);
    };
    let mut keys = Vec::new();
    for (event, groups) in events {
        let event = match event.as_str() {
            "PreToolUse" => "pre_tool_use",
            "PostToolUse" => "post_tool_use",
            "SessionStart" => "session_start",
            "SessionEnd" => "session_end",
            "PreCompact" => "pre_compact",
            "PostCompact" => "post_compact",
            "UserPromptSubmit" => "user_prompt_submit",
            "Stop" => "stop",
            _ => return Ok(None),
        };
        for (group, entry) in groups.as_array().into_iter().flatten().enumerate() {
            for (index, _) in entry["hooks"].as_array().into_iter().flatten().enumerate() {
                keys.push(format!(
                    "{PLUGIN}:.codex-plugin/hooks.json:{event}:{group}:{index}"
                ));
            }
        }
    }
    if keys.is_empty() {
        return Ok(None);
    }
    let bundle = tokio::fs::canonicalize(bundle)
        .await
        .map_err(|_| "Cannot resolve the Context Mode bundle")?;
    Ok(Some(Bundle {
        version,
        path: bundle,
        hooks: keys,
    }))
}

fn hooks_approved(state: &Value, hooks: &[String]) -> bool {
    hooks.iter().all(|key| {
        state[key]["enabled"] != false
            && state[key]["trusted_hash"]
                .as_str()
                .is_some_and(|hash| !hash.is_empty())
    })
}

struct Runner {
    home: PathBuf,
    root: PathBuf,
    binary: PathBuf,
}

struct Observation {
    status: Status,
    marketplace: bool,
    bundle: Option<Bundle>,
    catalog_version: Option<semver::Version>,
    legacy: Option<Value>,
}

impl Runner {
    fn for_app(app: &crate::server::App) -> Result<Self, String> {
        let home = home()?;
        let root = runners::codex_home(&home)?;
        let binary = app.selected_binary()?;
        Ok(Self { home, root, binary })
    }

    fn command(&self, binary: &FsPath) -> Command {
        let mut cmd = Command::new(binary);
        cmd.env("HOME", &self.home)
            .env("CODEX_HOME", &self.root)
            .env("NO_COLOR", "1")
            .current_dir(&self.home);
        cmd
    }

    async fn codex(&self, args: &[&str], seconds: u64, failure: &str) -> Result<Vec<u8>, String> {
        let mut cmd = self.command(&self.binary);
        cmd.args(args);
        run(cmd, Duration::from_secs(seconds))
            .await
            .map_err(|error| format!("{failure} {error}"))
    }

    async fn observe(&self) -> Result<Observation, String> {
        // Native inventory can initialize auth, start an app-server, or refresh
        // plugin caches. Settings reads the persisted configuration and bundles only.
        let config = config(&self.root).await?;
        let market = &config["marketplaces"][MARKET];
        let marketplace = !market.is_null();
        let plugin = &config["plugins"][PLUGIN];
        let mut observed = Observation {
            status: Status::new(
                State::NotInstalled,
                "Official Codex plugin is available to install.",
            ),
            marketplace,
            bundle: None,
            catalog_version: None,
            legacy: None,
        };
        let other_plugin = config["plugins"].as_object().is_some_and(|plugins| {
            plugins
                .keys()
                .any(|id| id != PLUGIN && id.starts_with("context-mode@"))
        });
        let servers: Vec<_> = config["mcp_servers"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(name, spec)| context_server(name, spec))
            .collect();

        let legacy = match servers.as_slice() {
            [(name, spec)] if name.as_str() == MARKET && legacy_server(spec) => Some(*spec),
            _ => None,
        };

        if other_plugin || marketplace && !managed_market(market) {
            observed.status = Status::new(
                State::Conflict,
                "Another Context Mode plugin or a custom marketplace registration needs review in Codex.",
            );
            return Ok(observed);
        }
        if !plugin_features_enabled(&config) || plugin["enabled"] == false {
            observed.status = Status::new(
                State::Disabled,
                "Codex has disabled the plugin or hooks. Enable them there before continuing.",
            );
            return Ok(observed);
        }
        let local = if plugin["enabled"] == true && managed_market(market) {
            installed_bundle(&self.root).await?
        } else {
            None
        };
        let same_server = match (servers.as_slice(), local.as_ref()) {
            ([(name, spec)], Some(bundle)) if name.as_str() == MARKET => {
                spec["enabled"] != false && bundle_server(spec, &bundle.path).await
            }
            _ => false,
        };
        let standalone = !servers.is_empty() && !same_server;
        let user_hooks = read_json(&self.root.join("hooks.json")).await?;
        if has_unrecognized_hooks(&config["hooks"], local.as_ref())
            || has_unrecognized_hooks(&user_hooks["hooks"], local.as_ref())
        {
            observed.status = Status::new(
                State::CheckFailed,
                "Deck could not identify the source of a configured Context Mode hook. Review its command in Codex.",
            );
            return Ok(observed);
        }

        if standalone {
            let pending = read_json(&self.root.join(MIGRATION_FILE)).await?;
            let can_migrate = managed_market(market)
                && legacy.is_some_and(|spec| {
                    (plugin.is_null() && pending.is_null()) || &pending == spec
                });
            if can_migrate {
                observed.legacy = legacy.cloned();
                observed.status = Status::new(
                    State::MigrationAvailable,
                    "Install the official plugin and replace the old Codex MCP entry. A failed migration can be retried here.",
                );
            } else {
                observed.status = if plugin.is_null() {
                    Status::new(
                        State::Standalone,
                        "Codex has a standalone Context Mode MCP registration that Deck cannot safely migrate.",
                    )
                } else if matches!(servers.as_slice(), [(name, _)] if name.as_str() == MARKET)
                    && legacy.is_none()
                {
                    Status::new(
                        State::CheckFailed,
                        "Deck could not match the configured Context Mode MCP entry to the installed plugin. Review its command and arguments in Codex.",
                    )
                } else {
                    Status::new(
                        State::Conflict,
                        "Codex has overlapping Context Mode registrations. Review them before continuing.",
                    )
                };
                return Ok(observed);
            }
        }

        if marketplace {
            observed.catalog_version = catalog_version(&marketplace_root(&self.root)).await?;
        }
        if plugin.is_null() {
            return Ok(observed);
        }
        if !marketplace
            || plugin["enabled"] != true
            || plugin["mcp_servers"][MARKET]["enabled"] == false
        {
            observed.status = Status::new(
                State::Conflict,
                "The Context Mode plugin lacks its official marketplace or its MCP server is disabled.",
            );
            return Ok(observed);
        }
        if let Some(bundle) = local {
            if !standalone {
                observed.status = if hooks_approved(&config["hooks"]["state"], &bundle.hooks) {
                    Status::new(
                        State::Installed,
                        "The native plugin and its hook approvals are present in Codex.",
                    )
                } else {
                    Status::new(
                        State::Incomplete,
                        "Finish setup to verify and trust the native hooks.",
                    )
                };
                observed.status.version = Some(bundle.version.clone());
            }
            observed.bundle = Some(bundle);
        } else if !standalone {
            observed.status = Status::new(
                State::Incomplete,
                "Codex configuration references the plugin, but its installed bundle or MCP declaration is incomplete.",
            );
        }
        Ok(observed)
    }

    async fn apply(&self, action: Action) -> Result<(Status, Outcome), String> {
        let before = self.observe().await?;
        let state = before.status.state;
        if matches!(
            state,
            State::Standalone | State::Conflict | State::Disabled | State::CheckFailed
        ) {
            return Err(before.status.detail.into());
        }
        if matches!(action, Action::Migrate) != (state == State::MigrationAvailable) {
            return Err("Refresh Context Mode in Settings and use the action shown there.".into());
        }
        if matches!(action, Action::Install) && state == State::Installed {
            return Ok((before.status, Outcome::Current));
        }
        match action {
            Action::Install => {
                tokio::fs::create_dir_all(&self.root)
                    .await
                    .map_err(|_| "Cannot create the Codex home")?;
                if !before.marketplace {
                    self.codex(
                        &["plugin", "marketplace", "add", SOURCE],
                        90,
                        "Could not add the official Context Mode marketplace.",
                    )
                    .await?;
                }
                if before.bundle.is_none() {
                    self.codex(
                        &["plugin", "add", PLUGIN],
                        90,
                        "Could not install the Context Mode plugin.",
                    )
                    .await?;
                }
            }
            Action::Migrate => {
                let legacy = before
                    .legacy
                    .as_ref()
                    .ok_or("The legacy registration changed")?;
                let bundle_current = before
                    .bundle
                    .as_ref()
                    .is_some_and(|bundle| Some(&bundle.version) == before.catalog_version.as_ref());
                self.migrate(legacy, bundle_current).await?;
            }
            Action::Update => {
                if state != State::Installed {
                    return Err("Complete the native plugin setup before updating.".into());
                }
                self.codex(
                    &["plugin", "marketplace", "upgrade", MARKET],
                    90,
                    "Could not refresh the Context Mode marketplace.",
                )
                .await?;
            }
        }

        let current = self.observe().await?;
        if current.status.state == State::NotInstalled {
            return Err(
                "Codex finished the command but did not expose the native plugin registration."
                    .into(),
            );
        }
        if !matches!(current.status.state, State::Installed | State::Incomplete) {
            return Err(current.status.detail.into());
        }
        let bundle = current
            .bundle
            .as_ref()
            .ok_or("Codex did not expose the native plugin registration after the command.")?;
        if current.status.version != current.catalog_version
            || before
                .status
                .version
                .as_ref()
                .zip(current.status.version.as_ref())
                .is_some_and(|(old, new)| new < old)
        {
            return Err(
                "The requested Context Mode version could not be verified in Codex.".into(),
            );
        }
        let hooks = self.verify_registration(&bundle.path).await?;
        let needs_hook_setup = !hooks_ready(&hooks);
        let after = if needs_hook_setup {
            self.setup(&bundle.path).await?;
            if !hooks_ready(&self.verify_registration(&bundle.path).await?) {
                return Err("Context Mode hook setup could not be verified in Codex.".into());
            }
            let after = self.observe().await?;
            if after.status.state != State::Installed
                || after.bundle.as_ref().map(|bundle| &bundle.path) != Some(&bundle.path)
            {
                return Err(format!(
                    "Context Mode setup could not be verified. {}",
                    after.status.detail
                ));
            }
            after
        } else {
            current
        };
        if after.status.state != State::Installed {
            return Err(
                "Codex hook approvals could not be verified in local configuration.".into(),
            );
        }
        let outcome = match action {
            Action::Install | Action::Migrate => Outcome::Installed,
            Action::Update
                if !needs_hook_setup && before.status.version == after.status.version =>
            {
                Outcome::Current
            }
            Action::Update => Outcome::Updated,
        };
        Ok((after.status, outcome))
    }

    async fn migrate(&self, legacy: &Value, bundle_present: bool) -> Result<(), String> {
        let path = tokio::fs::canonicalize(self.root.join("config.toml"))
            .await
            .map_err(|_| "Cannot resolve the Codex configuration")?;
        if !bundle_present {
            Native::check_legacy_context_mode(&self.binary, &self.home, &path, legacy, false)
                .await?;
        }
        // Record the one known entry before installing. A failed or interrupted
        // plugin command may leave both registrations. Only this saved intent
        // permits the migration to resume in that state.
        let journal = self.root.join(MIGRATION_FILE);
        if read_json(&journal).await?.is_null() {
            use std::io::Write;
            let mut saved = tempfile::NamedTempFile::new_in(&self.root)
                .map_err(|_| "Cannot start the Context Mode migration")?;
            saved
                .write_all(legacy.to_string().as_bytes())
                .and_then(|()| saved.as_file().sync_all())
                .map_err(|_| "Cannot save the legacy Context Mode registration")?;
            saved
                .persist_noclobber(&journal)
                .map_err(|_| "The Context Mode migration changed. Refresh Settings and retry.")?;
        }
        if !bundle_present {
            self.codex(
                &["plugin", "add", PLUGIN],
                90,
                "Could not install the Context Mode plugin. The legacy MCP entry is still available.",
            ).await?;
        }
        let current = self.observe().await?;
        if current.status.state != State::MigrationAvailable
            || current.legacy.as_ref() != Some(legacy)
            || !current
                .bundle
                .as_ref()
                .is_some_and(|bundle| Some(&bundle.version) == current.catalog_version.as_ref())
        {
            return Err("The native plugin or legacy entry could not be verified. Refresh Settings before retrying.".into());
        }
        Native::check_legacy_context_mode(&self.binary, &self.home, &path, legacy, true).await?;
        if !config(&self.root).await?["mcp_servers"][MARKET].is_null() {
            return Err(
                "Codex did not remove the legacy entry. Retry the migration from Settings.".into(),
            );
        }
        tokio::fs::remove_file(&journal)
            .await
            .map_err(|_| "The entry was migrated. Refresh Settings to continue plugin setup.")?;
        Ok(())
    }

    async fn verify_registration(&self, bundle: &FsPath) -> Result<Vec<Value>, String> {
        let inventory = self
            .codex(
                &["mcp", "list", "--json"],
                8,
                "Codex could not verify the native MCP registration.",
            )
            .await?;
        let servers: Vec<Value> = serde_json::from_slice(&inventory)
            .map_err(|_| "Codex returned an invalid MCP inventory")?;
        match matching_registration(&servers, bundle).await {
            Registration::Native => {},
            Registration::Missing => return Err("Codex did not expose an enabled Context Mode MCP registration.".into()),
            Registration::Conflict => return Err("Codex exposed multiple enabled Context Mode MCP registrations.".into()),
            Registration::Unrecognized => return Err("Deck could not match the reported MCP command to the installed Context Mode bundle.".into()),
        }
        let hooks = Native::inspect_context_mode_hooks(&self.binary, &self.home).await?;
        verify_hook_inventory(&hooks, bundle)?;
        Ok(hooks)
    }

    async fn setup(&self, bundle: &FsPath) -> Result<(), String> {
        // The official bundle includes the vendor CLI. Use the same Codex
        // executable for its discovery/checks as Deck used for installation.
        let bin_dir = tempfile::tempdir().map_err(|_| "Setup scratch directory unavailable")?;
        let binary = tokio::fs::canonicalize(&self.binary)
            .await
            .map_err(|_| "Selected Codex is unavailable")?;
        std::os::unix::fs::symlink(binary, bin_dir.path().join("codex"))
            .map_err(|_| "Cannot bind Context Mode setup to the selected Codex")?;
        let inherited_path = std::env::var_os("PATH").unwrap_or_default();
        let path = std::env::join_paths(
            std::iter::once(bin_dir.path().to_owned())
                .chain(std::env::split_paths(&inherited_path)),
        )
        .map_err(|_| "Context Mode setup PATH is invalid")?;
        let mut cmd = self.command(FsPath::new("node"));
        cmd.env("PATH", path).arg(bundle.join("cli.mjs")).args([
            "setup",
            "--agents",
            "codex",
            "--yes",
            "--no-input",
            "--json",
        ]);
        let output = run(cmd, Duration::from_secs(120)).await
            .map_err(|error| format!("Context Mode hook setup failed. Check that the Deck host can run the Node version required by Context Mode. {error}"))?;
        let result: Value = serde_json::from_slice(&output)
            .map_err(|_| "Context Mode returned an invalid setup result")?;
        if result["exitCode"] != 0
            || !result["agents"].as_array().is_some_and(|agents| {
                agents.len() == 1 && agents[0]["id"] == "codex" && agents[0]["status"] == "PASS"
            })
        {
            return Err("Context Mode did not verify the Codex hook setup.".into());
        }
        Ok(())
    }
}

async fn manifest_version(root: &FsPath) -> Result<semver::Version, String> {
    let body = runners::read(&root.join(".codex-plugin/plugin.json"))
        .await?
        .ok_or("The Context Mode plugin manifest is missing")?;
    let manifest: Value =
        serde_json::from_str(&body).map_err(|_| "Invalid Context Mode plugin manifest")?;
    manifest["version"]
        .as_str()
        .filter(|_| manifest["name"] == MARKET)
        .and_then(|v| semver::Version::parse(v).ok())
        .ok_or("Invalid Context Mode manifest version".into())
}

#[derive(Debug, PartialEq, Eq)]
enum Registration {
    Missing,
    Native,
    Conflict,
    Unrecognized,
}

async fn bundle_server(spec: &Value, bundle: &FsPath) -> bool {
    if !spec["url"].is_null() || !spec["command"].as_str().is_some_and(node_command) {
        return false;
    }
    let Some(args) = spec["args"].as_array() else {
        return false;
    };
    if args.len() != 3 || args[1] != "--agent" || args[2] != "codex" {
        return false;
    }
    let Some(script) = args[0].as_str().map(FsPath::new) else {
        return false;
    };
    let path = if script.is_absolute() {
        script.to_owned()
    } else if let Some(cwd) = spec["cwd"]
        .as_str()
        .map(FsPath::new)
        .filter(|p| p.is_absolute())
    {
        cwd.join(script)
    } else {
        return false;
    };
    tokio::fs::canonicalize(path)
        .await
        .is_ok_and(|p| p == bundle.join("server.mjs"))
}

async fn matching_registration(servers: &[Value], bundle: &FsPath) -> Registration {
    let mut enabled = servers.iter().filter(|s| {
        s["enabled"] == true
            && s["name"]
                .as_str()
                .is_some_and(|name| context_server(name, &s["transport"]))
    });
    let Some(server) = enabled.next() else {
        return Registration::Missing;
    };
    if enabled.next().is_some() {
        return Registration::Conflict;
    }
    if server["name"] == MARKET
        && server["transport"]["type"] == "stdio"
        && bundle_server(&server["transport"], bundle).await
    {
        Registration::Native
    } else {
        Registration::Unrecognized
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Action {
    Install,
    Migrate,
    Update,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum Outcome {
    Installed,
    Updated,
    Current,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    api: u32,
    action: Action,
}

fn success(status: Status, outcome: Option<Outcome>) -> Response {
    // Version is serialized as a semver string for Settings.
    Json(json!({"api":deck2_shared::API, "state":status.state, "version":status.version.map(|v| v.to_string()),
        "detail":status.detail, "outcome":outcome})).into_response()
}

pub async fn inspect(ProjectState(app): ProjectState<crate::server::App>) -> Response {
    let result = async { Runner::for_app(&app)?.observe().await }.await;
    match result {
        Ok(observed) => success(observed.status, None),
        Err(error) => Json(json!({"api":deck2_shared::API, "state":State::CheckFailed,
            "version":null, "detail":error, "outcome":null}))
        .into_response(),
    }
}

pub async fn change(
    ProjectState(app): ProjectState<crate::server::App>,
    Path(runner): Path<String>,
    Json(request): Json<Request>,
) -> Response {
    if let Some(response) = crate::web_identity::effect_denied() {
        return response;
    }
    if request.api != deck2_shared::API {
        return problem(StatusCode::BAD_REQUEST, "api", "Unsupported API");
    }
    if runner != "codex" {
        return problem(
            StatusCode::BAD_REQUEST,
            "context_mode_runner",
            "Context Mode settings support Codex.",
        );
    }
    if !app.persistence_available() {
        return problem(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage",
            "Tool settings are unavailable",
        );
    }
    let Ok(_gate) = INSTALL.try_lock() else {
        return problem(
            StatusCode::CONFLICT,
            "tool_busy",
            "Another tool change is running",
        );
    };
    match async { Runner::for_app(&app)?.apply(request.action).await }.await {
        Ok((status, outcome)) => success(status, Some(outcome)),
        Err(error) => problem(StatusCode::CONFLICT, "tool_change_failed", error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn runner(home: &FsPath, binary: PathBuf) -> Runner {
        Runner {
            home: home.to_owned(),
            root: home.join("custom-codex"),
            binary,
        }
    }

    // Protects the Settings entry point for the old Deck-owned MCP registration.
    #[tokio::test]
    async fn context_mode_offers_legacy_migration_without_running_codex() {
        let home = tempfile::tempdir().unwrap();
        let runner = runner(home.path(), home.path().join("must-not-run"));
        std::fs::create_dir(&runner.root).unwrap();
        let fixture = r#"
[marketplaces.context-mode]
source_type = "git"
source = "https://github.com/mksglu/context-mode.git"
[mcp_servers.context-mode]
command = "/fixture/bin/context-mode"
args = ["mcp"]
[mcp_servers.other]
command = "other"
"#;
        let config = runner.root.join("config.toml");
        std::fs::write(&config, fixture).unwrap();
        let status = runner.observe().await.unwrap().status;
        assert_eq!(
            serde_json::to_value(status.state).unwrap(),
            "migration_available"
        );
        assert_eq!(std::fs::read_to_string(config).unwrap(), fixture);
    }

    // Protects the user-authorized migration across lost command acknowledgments and a
    // rejected versioned write. The fixture never runs Codex, Node, Git, or a package manager.
    #[tokio::test]
    async fn context_mode_migration_retries_without_reinstalling_or_replacing_other_servers() {
        use std::fs;
        let home = tempfile::tempdir().unwrap();
        let binary = home.path().join("codex");
        let runner = runner(home.path(), binary.clone());
        let catalog = marketplace_root(&runner.root);
        let cache = runner
            .root
            .join("plugins/cache/context-mode/context-mode/2.2.1");
        let manifest = r#"{"name":"context-mode","version":"2.2.1"}"#;
        fs::create_dir_all(catalog.join(".agents/plugins")).unwrap();
        fs::create_dir_all(catalog.join("plugin/.codex-plugin")).unwrap();
        fs::create_dir_all(cache.join(".codex-plugin")).unwrap();
        fs::write(catalog.join(".agents/plugins/marketplace.json"), r#"{"name":"context-mode","plugins":[{"name":"context-mode","source":{"source":"local","path":"./plugin"}}]}"#).unwrap();
        fs::write(catalog.join("plugin/.codex-plugin/plugin.json"), manifest).unwrap();
        fs::write(cache.join(".codex-plugin/plugin.json"), manifest).unwrap();
        fs::write(cache.join(".codex-plugin/mcp.json"), r#"{"mcpServers":{"context-mode":{"command":"node","args":["./server.mjs","--agent","codex"],"cwd":"."}}}"#).unwrap();
        fs::write(
            cache.join(".codex-plugin/hooks.json"),
            r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"verified-command"}]}]}}"#,
        )
        .unwrap();
        fs::write(cache.join("cli.mjs"), "").unwrap();
        fs::write(cache.join("server.mjs"), "").unwrap();
        let original = r#"[marketplaces.context-mode]
source_type = "git"
source = "https://github.com/mksglu/context-mode.git"

[mcp_servers.context-mode]
command = "/fixture/bin/context-mode"
args = ["mcp"]

# Independent server
[mcp_servers.personal]
command = "keep"
args = ["this"]
"#;
        let file = runner.root.join("config.toml");
        fs::write(&file, original).unwrap();
        fs::write(home.path().join("data"), "preserve opaque data").unwrap();
        fs::write(&binary, r#"#!/usr/bin/python3
import hashlib, json, sys, tomllib
from pathlib import Path
home = Path(__file__).parent
root = home / 'custom-codex'
file = root / 'config.toml'
args = sys.argv[1:]
with (home / 'commands').open('a') as log:
    log.write(' '.join(args[:3]) + '\n')
if args == ['plugin', 'add', 'context-mode@context-mode']:
    assert (root / '.deck-context-mode-migration.json').exists()
    assert '[mcp_servers.context-mode]' in file.read_text()
    with file.open('a') as config:
        config.write('''
[plugins."context-mode@context-mode"]
enabled = true
[hooks.state."context-mode@context-mode:.codex-plugin/hooks.json:stop:0:0"]
trusted_hash = "sha256:fixture"
''')
    sys.exit(1)  # Installation happened but command acknowledgment was lost.
if args == ['mcp', 'list', '--json']:
    print(json.dumps([{'name':'context-mode','enabled':True,'transport':{
        'type':'stdio','command':'node','args':['./server.mjs','--agent','codex'],
        'cwd':str(root / 'plugins/cache/context-mode/context-mode/2.2.1')}}]))
    sys.exit()
assert args[0] == 'app-server'
for line in sys.stdin:
    request = json.loads(line)
    method = request['method']
    if method == 'initialized':
        continue
    body = file.read_text()
    version = hashlib.sha256(body.encode()).hexdigest()
    if method == 'initialize':
        result = {'userAgent':'deck2/0.170.0'}
    elif method == 'config/read':
        assert request['params']['includeLayers']
        layers = [{'name':{'type':'user','file':str(file)},'version':version,
                   'config':tomllib.loads(body)}]
        if (home / 'foreign-layer').exists():
            layers.append({'name':{'type':'system'},'config':{
                'mcp_servers':{'context-mode':{'url':'https://example.invalid/mcp'}}}})
        result = {'layers':layers}
    elif method == 'config/value/write':
        params = request['params']
        assert params == {'keyPath':'mcp_servers.context-mode','value':None,
            'mergeStrategy':'replace','expectedVersion':version,'filePath':str(file)}
        with (home / 'writes').open('a') as log:
            log.write('write\n')
        if (home / 'reject').exists():
            print(json.dumps({'id':request['id'],'error':{'code':-1,'message':'version conflict'}}), flush=True)
            continue
        start = body.index('[mcp_servers.context-mode]')
        end = body.index('# Independent server')
        file.write_text(body[:start] + body[end:])
        result = {'status':'ok'}
    elif method == 'hooks/list':
        result = {'data':[{'cwd':str(home),'errors':[],'hooks':[{
            'source':'plugin','pluginId':'context-mode@context-mode',
            'enabled':True,'trustStatus':'trusted'}]}]}
    else:
        raise AssertionError(method)
    print(json.dumps({'id':request['id'],'result':result}), flush=True)
"#).unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();

        for _ in 0..2 {
            assert_eq!(
                runner.observe().await.unwrap().status.state,
                State::MigrationAvailable
            );
        }
        assert_eq!(fs::read_to_string(&file).unwrap(), original);
        assert!(!home.path().join("commands").exists());
        assert!(!runner.root.join(MIGRATION_FILE).exists());
        let source = passive_source(&runner.root).await.unwrap();
        assert_eq!(serde_json::from_str::<PathBuf>(&source).unwrap(), catalog);
        for wrong_action in [Action::Install, Action::Update] {
            assert!(runner.apply(wrong_action).await.is_err());
        }
        assert!(!home.path().join("commands").exists());

        fs::write(home.path().join("foreign-layer"), "").unwrap();
        assert!(runner.apply(Action::Migrate).await.is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), original);
        assert!(!runner.root.join(MIGRATION_FILE).exists());
        fs::remove_file(home.path().join("foreign-layer")).unwrap();

        assert!(runner.apply(Action::Migrate).await.is_err());
        assert_eq!(
            runner.observe().await.unwrap().status.state,
            State::MigrationAvailable
        );
        assert_eq!(
            fs::read_to_string(&file).unwrap().lines().next(),
            original.lines().next()
        );
        assert!(!config(&runner.root).await.unwrap()["mcp_servers"][MARKET].is_null());

        fs::write(home.path().join("foreign-layer"), "").unwrap();
        assert!(runner.apply(Action::Migrate).await.is_err());
        assert!(!home.path().join("writes").exists());
        fs::remove_file(home.path().join("foreign-layer")).unwrap();

        fs::write(home.path().join("reject"), "").unwrap();
        let before_rejection = fs::read_to_string(&file).unwrap();
        assert!(runner.apply(Action::Migrate).await.is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), before_rejection);
        assert_eq!(
            runner.observe().await.unwrap().status.state,
            State::MigrationAvailable
        );
        fs::remove_file(home.path().join("reject")).unwrap();

        let (status, _) = runner.apply(Action::Migrate).await.unwrap();
        assert_eq!(status.state, State::Installed);
        assert!(!runner.root.join(MIGRATION_FILE).exists());
        assert!(
            !fs::read_to_string(&file)
                .unwrap()
                .contains("[mcp_servers.context-mode]")
        );
        assert!(fs::read_to_string(&file).unwrap().contains(
            "# Independent server\n[mcp_servers.personal]\ncommand = \"keep\"\nargs = [\"this\"]"
        ));
        assert_eq!(
            fs::read_to_string(home.path().join("data")).unwrap(),
            "preserve opaque data"
        );
        let commands = fs::read_to_string(home.path().join("commands")).unwrap();
        assert_eq!(commands.matches("plugin add").count(), 1);
        assert!(!commands.contains("plugin list"));
        assert!(!commands.contains("marketplace"));
        assert_eq!(
            runner.observe().await.unwrap().status.state,
            State::Installed
        );
        assert_eq!(
            fs::read_to_string(home.path().join("commands")).unwrap(),
            commands
        );
    }

    #[tokio::test]
    async fn context_mode_distinguishes_resolved_plugin_paths_from_duplicates() {
        let temp = tempfile::tempdir().unwrap();
        let bundle = temp.path().canonicalize().unwrap().join("context-mode/2.2.1");
        std::fs::create_dir_all(&bundle).unwrap();
        let script = bundle.join("server.mjs");
        std::fs::write(&script, "").unwrap();
        let mut row = json!({"name":MARKET,"enabled":true,"transport":{"type":"stdio",
            "command":"/opt/node/bin/node","args":[script,"--agent","codex"]}});
        assert_eq!(
            matching_registration(&[row.clone()], &bundle).await,
            Registration::Native
        );
        assert_eq!(
            matching_registration(&[row.clone(), row.clone()], &bundle).await,
            Registration::Conflict
        );
        row["transport"]["args"][0] = json!("other.mjs");
        assert_eq!(
            matching_registration(&[row], &bundle).await,
            Registration::Unrecognized
        );
        let hook = format!(
            "\"/opt/node/bin/node\" \"{}/hook.mjs\" --agent codex",
            bundle.display()
        );
        assert!(bundle_hook(&hook, &bundle));
        assert!(!bundle_hook(&format!("{hook} && other-command"), &bundle));
        let plugin = json!({"source":"plugin","pluginId":PLUGIN,"enabled":true,"trustStatus":"trusted","eventName":"preToolUse","matcher":"Bash"});
        let mut user = json!({"source":"user","enabled":false,"trustStatus":"trusted","eventName":"preToolUse","matcher":"Bash","command":hook});
        assert!(verify_hook_inventory(&[plugin.clone(), user.clone()], &bundle).is_ok());
        user["enabled"] = json!(true);
        assert!(
            verify_hook_inventory(&[plugin.clone(), user.clone()], &bundle)
                .unwrap_err()
                .contains("same event")
        );
        user["matcher"] = json!("Edit");
        assert!(verify_hook_inventory(&[plugin, user], &bundle).is_ok());
    }

    // Protects installer ownership. An aliased standalone server can be
    // shadowed in native inventory, but setup must preserve its config bytes.
    #[tokio::test]
    async fn context_mode_standalone_and_duplicate_block_install_and_update() {
        let home = tempfile::tempdir().unwrap();
        let runner = runner(home.path(), home.path().join("must-not-run"));
        std::fs::create_dir(&runner.root).unwrap();
        let standalone =
            "[mcp_servers.personal]\ncommand = 'npx'\nargs = ['-y', 'context-mode@latest']\n";
        for (suffix, expected) in [
            ("", State::Standalone),
            (
                "\n[plugins.'context-mode@context-mode']\nenabled = true\n",
                State::Conflict,
            ),
        ] {
            let fixture = format!("{standalone}{suffix}");
            let config = runner.root.join("config.toml");
            std::fs::write(&config, &fixture).unwrap();
            assert_eq!(runner.observe().await.unwrap().status.state, expected);
            for action in [Action::Install, Action::Update, Action::Migrate] {
                let error = runner.apply(action).await.err().unwrap();
                assert!(error.contains("registration"));
                assert_eq!(std::fs::read_to_string(&config).unwrap(), fixture);
            }
        }
    }

    // Protects the command boundary. A vendor process exiting zero without
    // installing anything must yield a conflict, not a success response.
    #[tokio::test]
    async fn context_mode_vendor_success_requires_native_state() {
        let home = tempfile::tempdir().unwrap();
        let binary = home.path().join("codex");
        std::fs::write(
            &binary,
            r#"#!/bin/sh
case "$1 $2" in
  'plugin list') printf '%s\n' '{"installed":[]}' ;;
  'mcp list') printf '%s\n' '[]' ;;
  'plugin marketplace') test "$3 $4" = 'add mksglu/context-mode' ;;
  'plugin add') test "$3" = 'context-mode@context-mode' ;;
  *) exit 1 ;;
esac
"#,
        )
        .unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        let runner = runner(home.path(), binary);
        std::fs::create_dir(&runner.root).unwrap();
        assert_eq!(
            runner.observe().await.unwrap().status.state,
            State::NotInstalled
        );
        assert!(
            runner
                .apply(Action::Install)
                .await
                .err()
                .unwrap()
                .contains("native plugin registration")
        );
    }

    // The operator supplies the real executable. The subprocess owns the only
    // HOME and CODEX_HOME it can touch and inherits no saved Codex credentials.
    #[tokio::test]
    #[ignore = "uses the official marketplace and real Codex and Node"]
    async fn context_mode_isolated_native_lifecycle() {
        const CHILD: &str = "DECK2_CONTEXT_MODE_TEST_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let binary = std::env::var_os("DECK2_CONTEXT_MODE_TEST_CODEX")
                .expect("Set DECK2_CONTEXT_MODE_TEST_CODEX to an absolute Codex executable");
            let dir = tempfile::Builder::new()
                .prefix("deck-context-mode-test-")
                .tempdir()
                .unwrap();
            std::fs::write(dir.path().join(".fixture"), "disposable").unwrap();
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .env_clear()
                .env("PATH", std::env::var_os("PATH").unwrap_or_default())
                .args([
                    "--exact",
                    "external_tools::context_mode::tests::context_mode_isolated_native_lifecycle",
                    "--ignored",
                    "--nocapture",
                ])
                .env(CHILD, dir.path())
                .env("DECK2_CONTEXT_MODE_TEST_CODEX", binary)
                .env("HOME", dir.path())
                .env("CODEX_HOME", dir.path().join("custom-codex"))
                .env("XDG_CONFIG_HOME", dir.path().join("config"))
                .env("XDG_DATA_HOME", dir.path().join("data"))
                .env("XDG_CACHE_HOME", dir.path().join("cache"))
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .current_dir(dir.path())
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            println!("{}", String::from_utf8_lossy(&output.stdout));
            return;
        }
        let home = PathBuf::from(std::env::var_os(CHILD).unwrap());
        let binary = PathBuf::from(std::env::var_os("DECK2_CONTEXT_MODE_TEST_CODEX").unwrap());
        assert!(home.is_absolute() && binary.is_absolute());
        assert!(home.starts_with(std::env::temp_dir()));
        assert!(
            home.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("deck-context-mode-test-")
        );
        assert_eq!(
            std::fs::read_to_string(home.join(".fixture")).unwrap(),
            "disposable"
        );
        assert_eq!(std::env::var_os("HOME").as_deref(), Some(home.as_os_str()));
        assert_eq!(
            std::env::var_os("CODEX_HOME").as_deref(),
            Some(home.join("custom-codex").as_os_str())
        );
        let runner = runner(&home, binary.clone());
        let project = home.to_str().unwrap();
        let store = crate::Store::open_memory(project).unwrap();
        let app = crate::server::App::new(
            store,
            "127.0.0.1:1234".into(),
            binary.clone(),
            None,
            "admin".into(),
            "recover".into(),
        );
        async fn body(response: Response) -> Value {
            let status = response.status();
            let data = axum::body::to_bytes(response.into_body(), 1024 * 1024)
                .await
                .unwrap();
            let value: Value = serde_json::from_slice(&data).unwrap();
            assert_eq!(status, StatusCode::OK, "{value}");
            value
        }
        let read = body(inspect(ProjectState(app.clone())).await).await;
        assert_eq!(read["state"], "not_installed");
        let send = |action| {
            change(
                ProjectState(app.clone()),
                Path("codex".into()),
                Json(Request {
                    api: deck2_shared::API,
                    action,
                }),
            )
        };
        let installed = body(send(Action::Install).await).await;
        assert_eq!(installed["state"], "installed");
        assert_eq!(installed["outcome"], "installed");
        assert!(configured().await);
        println!("verified native plugin {}", installed["version"]);
        let updated = body(send(Action::Update).await).await;
        assert_eq!(updated["state"], "installed");
        assert!(matches!(
            updated["outcome"].as_str(),
            Some("current" | "updated")
        ));

        // Exercise the production member launch flags and the native trust
        // inventory. This requires neither an account nor a model request.
        let assignment = deck2_shared::MemberAssignment {
            runner_id: "codex".into(),
            model_id: "fixture".into(),
            thinking: None,
        };
        for (member, enabled) in [("apply-deep", true), ("quality", false)] {
            let role = crate::session_roles::Role::at(&runner.root, member).unwrap();
            let mut native = Native::start_member(&binary, member, &assignment, json!({}), role)
                .await
                .unwrap();
            native.initialize().await.unwrap();
            let hooks = native
                .request("hooks/list", json!({"cwds":[project]}))
                .await
                .unwrap();
            let ready = hooks["data"][0]["hooks"]
                .as_array()
                .is_some_and(|hooks| hooks_ready(hooks));
            native.terminate().await.unwrap();
            assert_eq!(ready, enabled, "{member} native hook policy");
        }
        println!("verified native hook load for Apply Deep and isolation for Quality");
    }
}
