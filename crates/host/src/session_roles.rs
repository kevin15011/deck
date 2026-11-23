//! Packaged Deck role content delivered through supported session interfaces.
//! Native profiles never supply Deck role/plugin authority.
use crate::tasks::digest;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs::OpenOptions,
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
pub(crate) const CONFIG_CHANGED: &str = "Native execution configuration changed during the turn";

#[derive(Clone)]
pub struct Role {
    pub instructions: String,
    pub sandbox: Option<String>,
    pub hooks: Vec<(String, String)>,
    files: BTreeMap<PathBuf, String>,
    catalog_policy: Option<String>,
    pub fallback: bool,
    pub model: Option<String>,
    pub effort: Option<String>,
}
pub(crate) fn read(path: &Path, max: u64) -> Result<String, String> {
    for parent in path.ancestors().skip(1) {
        let m = std::fs::symlink_metadata(parent).map_err(|_| "Native role parent unavailable")?;
        if !m.is_dir()
            || (m.mode() & 0o022 != 0 && !(m.uid() == 0 && m.mode() & 0o1000 != 0))
            || (m.uid() != 0 && m.uid() != unsafe { libc::geteuid() })
        {
            return Err("Unsafe native role parent".into());
        }
    }
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Native role file unavailable")?;
    let before = file
        .metadata()
        .map_err(|_| "Native role identity unavailable")?;
    if !before.is_file()
        || before.len() > max
        || before.mode() & 0o022 != 0
        || before.uid() != unsafe { libc::geteuid() }
    {
        return Err("Unsafe native role file".into());
    }
    let mut body = String::new();
    let mut file = file;
    (&mut file)
        .take(max + 1)
        .read_to_string(&mut body)
        .map_err(|_| "Native role is not bounded UTF-8")?;
    let after = file.metadata().map_err(|_| "Native role changed")?;
    let current = std::fs::symlink_metadata(path).map_err(|_| "Native role replaced")?;
    if body.len() as u64 != before.len()
        || before.ino() != current.ino()
        || before.dev() != current.dev()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime_nsec() != after.ctime_nsec()
        || before.mtime() != after.mtime()
        || before.ctime() != after.ctime()
    {
        return Err("Native role changed during capture".into());
    }
    Ok(body)
}
// Registration makes a plugin catalog discoverable. The plugins table separately
// selects executable plugins. Keep referenced catalogs (including profiles) bound.
fn catalog_policy(body: &str) -> Option<String> {
    fn references_catalog(value: &toml::Value, suffix: &str) -> bool {
        match value {
            toml::Value::Table(table) => table
                .iter()
                .any(|(key, v)| key.ends_with(suffix) || references_catalog(v, suffix)),
            toml::Value::Array(values) => values.iter().any(|v| references_catalog(v, suffix)),
            toml::Value::String(s) => s.ends_with(suffix),
            _ => false,
        }
    }

    let mut config: toml::Value = toml::from_str(body).ok()?;
    // Codex itself records this state while it runs (project trust on a
    // first thread, UI notices, hook trust). A running process never reloads
    // it and Deck pins hook trust at launch and re-verifies hooks live, so it
    // must never revoke an attempt or a retained runtime.
    let table = config.as_table_mut()?;
    for runtime in ["projects", "tui", "notice"] {
        table.remove(runtime);
    }
    if let Some(toml::Value::Table(hooks)) = table.get_mut("hooks") {
        hooks.remove("state");
        if hooks.is_empty() {
            table.remove("hooks");
        }
    }
    if let Some(catalogs) = config.as_table_mut()?.remove("marketplaces") {
        let mut catalogs = catalogs.as_table()?.clone();
        catalogs.retain(|name, _| references_catalog(&config, &format!("@{name}")));
        if !catalogs.is_empty() {
            config
                .as_table_mut()?
                .insert("marketplaces".into(), toml::Value::Table(catalogs));
        }
    }
    Some(digest(format!("{config:?}").as_bytes()))
}

pub(crate) fn codex_policy_key(path: &Path) -> Result<String, String> {
    let body = match std::fs::symlink_metadata(path) {
        Ok(_) => read(path, 1024 * 1024)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => return Err("Native configuration unavailable".into()),
    };
    Ok(catalog_policy(&body).unwrap_or_else(|| digest(body.as_bytes())))
}
impl Role {
    pub fn load(member: &str) -> Result<Self, String> {
        let root = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".codex")))
            .ok_or("Native home unavailable")?;
        Self::at(&root, member)
    }
    pub(crate) fn packaged_instructions(member: &str) -> Result<String, String> {
        if !crate::session_contract::MEMBERS.contains(&member) {
            return Err("Unknown canonical role".into());
        }
        static PACKAGED: std::sync::OnceLock<Result<Value, String>> = std::sync::OnceLock::new();
        let roles = PACKAGED
            .get_or_init(|| {
                serde_json::from_str(include_str!("../assets/session-roles.json"))
                    .map_err(|_| "Invalid packaged canonical roles".into())
            })
            .as_ref()
            .map_err(Clone::clone)?;
        Ok(format!(
            "{}\n\n{}\n\n{}",
            roles[member]["agentBody"]
                .as_str()
                .ok_or("Canonical role missing")?,
            roles[member]["skillBody"]
                .as_str()
                .ok_or("Canonical skill missing")?,
            crate::session_skills::GUIDANCE
        ))
    }

    pub fn at(root: &Path, member: &str) -> Result<Self, String> {
        let instructions = Self::packaged_instructions(member)?;
        let config = root.join("config.toml");
        let mut files = BTreeMap::new();
        let body = match std::fs::symlink_metadata(&config) {
            Ok(_) => Some(read(&config, 1024 * 1024)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("Native configuration unavailable".into()),
        };
        files.insert(
            config,
            body.as_ref()
                .map_or_else(|| "absent".into(), |s| digest(s.as_bytes())),
        );
        let catalog_policy = catalog_policy(body.as_deref().unwrap_or(""));
        Ok(Self {
            instructions,
            sandbox: matches!(member, "investigate" | "quality").then(|| "read-only".into()),
            hooks: vec![],
            files,
            catalog_policy,
            fallback: true,
            model: None,
            effort: None,
        })
    }
    pub fn opencode(root: &Path, member: &str) -> Result<Self, String> {
        let mut role = Self::at(root, member)?;
        role.catalog_policy = None;
        Ok(role)
    }
    pub fn verify(&self) -> Result<(), String> {
        for (path, hash) in &self.files {
            let body = match std::fs::symlink_metadata(path) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound && hash == "absent" => continue,
                Ok(_) => read(path, 1024 * 1024)?,
                _ => return Err("Native configuration unavailable during execution".into()),
            };
            if digest(body.as_bytes()) == *hash {
                continue;
            }
            if self.catalog_policy.is_some() && catalog_policy(&body) == self.catalog_policy {
                continue;
            }
            return Err(CONFIG_CHANGED.into());
        }
        Ok(())
    }
    pub fn identity(&self) -> String {
        digest(
            serde_json::to_string(&(
                &self.instructions,
                &self.sandbox,
                &self.hooks,
                &self.model,
                &self.effort,
                &self.files,
            ))
            .unwrap_or_default()
            .as_bytes(),
        )
    }
}

#[cfg(test)]
mod tests {
    // Plug-and-play: arbitrary legacy materialization must neither become
    // executable authority nor block packaged Deck content in a clean profile.
    #[test]
    fn packaged_roles_ignore_global_deck_materialization() {
        let d = tempfile::tempdir().unwrap();
        let clean = super::Role::at(d.path(), "lead").unwrap();
        std::fs::create_dir(d.path().join("deck")).unwrap();
        std::fs::write(d.path().join("deck/manifest.json"), "broken legacy receipt").unwrap();
        let with_legacy = super::Role::at(d.path(), "lead").unwrap();
        assert_eq!(clean.identity(), with_legacy.identity());
        assert!(with_legacy.hooks.is_empty());
        std::fs::write(d.path().join("config.toml"), "sandbox_mode = 'read-only'").unwrap();
        assert!(
            with_legacy.verify().is_err(),
            "Native policy changes still revoke held preparation"
        );
        assert_ne!(
            super::Role::at(d.path(), "lead").unwrap().identity(),
            super::Role::opencode(d.path(), "quality")
                .unwrap()
                .identity()
        );
        assert_eq!(
            std::fs::read_to_string(d.path().join("deck/manifest.json")).unwrap(),
            "broken legacy receipt"
        );
    }
    #[test]
    fn registering_an_unused_catalog_preserves_running_roles() {
        let home = tempfile::tempdir().unwrap();
        let path = home.path().join("config.toml");
        let base = "approval_policy = 'on-request'\n";
        std::fs::write(&path, base).unwrap();
        let lead = super::Role::at(home.path(), "lead").unwrap();
        let member = super::Role::at(home.path(), "apply-fast").unwrap();
        let registered = format!("{base}[marketplaces.tools]\nsource = '/catalog'\n");
        std::fs::write(&path, &registered).unwrap();
        lead.verify().unwrap();
        member.verify().unwrap();
        let active = format!("{registered}[plugins.'sample@tools']\nenabled = true\n");
        std::fs::write(&path, &active).unwrap();
        assert!(lead.verify().is_err());
        let selected = super::Role::at(home.path(), "lead").unwrap();
        std::fs::write(&path, active.replace("/catalog", "/different")).unwrap();
        assert!(selected.verify().is_err());
    }

    // Codex records trust for a project the first time it opens a thread
    // there, mid-attempt. That bookkeeping must never fail the turn.
    #[test]
    fn codex_runtime_bookkeeping_preserves_running_roles() {
        let home = tempfile::tempdir().unwrap();
        let path = home.path().join("config.toml");
        let base = "approval_policy = 'on-request'\n[projects.'/a']\ntrust_level = 'trusted'\n";
        std::fs::write(&path, base).unwrap();
        let lead = super::Role::at(home.path(), "lead").unwrap();
        let key = super::codex_policy_key(&path).unwrap();
        let written = format!(
            "{base}[projects.'/new']\ntrust_level = 'trusted'\n[tui.model_availability_nux]\nseen = 1\n\
             [notice]\nhide = true\n[hooks.state.'x:stop:0:0']\ntrusted_hash = 'h'\n"
        );
        std::fs::write(&path, &written).unwrap();
        lead.verify().unwrap();
        assert_eq!(super::codex_policy_key(&path).unwrap(), key);
        std::fs::write(&path, format!("{written}[mcp_servers.extra]\ncommand = 'x'\n")).unwrap();
        assert!(lead.verify().is_err(), "Native MCP changes still revoke the attempt");
    }
    #[test]
    fn parses_native_role_toml_without_executing_it() {
        let raw = "name = 'deck-lead'\ndeveloper_instructions = 'Canonical role'\nsandbox_mode = 'read-only'\n";
        let parsed: Result<toml::Value, _> = toml::from_str(raw);
        assert!(parsed.is_ok(), "{}", parsed.unwrap_err().message());
    }
    #[test]
    #[ignore = "explicit read-only native role qualification"]
    fn selected_native_role_parser_diagnostic() {
        let root = std::env::var_os("CODEX_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::path::PathBuf::from(std::env::var_os("HOME").unwrap()).join(".codex")
            });
        let raw = super::read(&root.join("agents/deck-lead.toml"), 1024 * 1024).unwrap();
        let parsed: Result<toml::Value, _> = toml::from_str(&raw);
        if let Err(error) = parsed {
            panic!(
                "Native parser category: {}; byte span: {:?}",
                error.message(),
                error.span()
            );
        }
        let role = super::Role::at(&root, "lead").unwrap();
        role.verify().unwrap();
        println!(
            "Native role snapshot: fallback={}, hooks={}, files={}",
            role.fallback,
            role.hooks.len(),
            role.files.len()
        );
    }
}
