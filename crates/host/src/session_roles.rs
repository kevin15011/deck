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
#[derive(Clone)]
pub struct Role {
    pub instructions: String,
    pub sandbox: Option<String>,
    pub hooks: Vec<(String, String)>,
    files: BTreeMap<PathBuf, String>,
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
impl Role {
    pub fn load(member: &str) -> Result<Self, String> {
        let root = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".codex")))
            .ok_or("Native home unavailable")?;
        Self::at(&root, member)
    }
    pub fn at(root: &Path, member: &str) -> Result<Self, String> {
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
        let config = root.join("config.toml");
        let mut files = BTreeMap::new();
        match std::fs::symlink_metadata(&config) {
            Ok(_) => {
                files.insert(
                    config,
                    digest(read(&root.join("config.toml"), 1024 * 1024)?.as_bytes()),
                );
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                files.insert(config, "absent".into());
            }
            Err(_) => return Err("Native configuration unavailable".into()),
        }
        Ok(Self {
            instructions: format!(
                "{}\n\n{}\n\n{}",
                roles[member]["agentBody"]
                    .as_str()
                    .ok_or("Canonical role missing")?,
                roles[member]["skillBody"]
                    .as_str()
                    .ok_or("Canonical skill missing")?,
                crate::session_skills::GUIDANCE
            ),
            sandbox: matches!(member, "investigate" | "quality").then(|| "read-only".into()),
            hooks: vec![],
            files,
            fallback: true,
            model: None,
            effort: None,
        })
    }
    pub fn opencode(root: &Path, member: &str) -> Result<Self, String> {
        Self::at(root, member)
    }
    pub fn verify(&self) -> Result<(), String> {
        for (path, hash) in &self.files {
            if hash == "absent" {
                if !matches!(std::fs::symlink_metadata(path),Err(e) if e.kind()==std::io::ErrorKind::NotFound)
                {
                    return Err("Native configuration changed during execution".into());
                }
                continue;
            }
            if digest(read(path, 16 * 1024 * 1024)?.as_bytes()) != *hash {
                return Err("Native role generation changed during execution".into());
            }
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
        std::fs::write(d.path().join("config.toml"), "# native policy changed").unwrap();
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
