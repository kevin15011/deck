//! Ordinary native CBM composition using Deck-owned session helpers.
//! Explicit capability intent and native/personal restrictions remain authoritative.
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub(crate) struct Selection {
    pub spec: Value,
    files: Vec<(PathBuf, String)>,
    directory: Option<(PathBuf, PathBuf)>,
}
impl Selection {
    /// Deck owns the helper; no native profile or Deck1 marker is required.
    /// Absence of project intent uses Deck's standard enabled capability. An
    /// explicit project/runner disablement always wins, including native policy.
    pub fn scoped(
        project: &Path,
        effective: &Value,
        helper: &Path,
    ) -> Result<Option<Self>, String> {
        let path = project.join(".deck/config.json");
        let (config, hash) = match std::fs::symlink_metadata(&path) {
            Ok(_) => {
                let body = crate::session_roles::read(&path, 1024 * 1024)?;
                (
                    serde_json::from_str::<Value>(&body)
                        .map_err(|_| "Deck capability intent invalid")?,
                    crate::tasks::digest(body.as_bytes()),
                )
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (json!({}), "absent".into()),
            Err(_) => return Err("Deck capability intent unavailable".into()),
        };
        let intent = &config["capabilities"]["codebase-memory"];
        if !config.is_object()
            || [&config["capabilities"], intent, &intent["runners"]]
                .iter()
                .any(|v| !v.is_null() && !v.is_object())
        {
            return Err("Deck capability intent invalid".into());
        }
        for v in [&intent["enabled"], &intent["runners"]["codex"]] {
            if !v.is_null() && !v.is_boolean() {
                return Err("Deck capability intent invalid".into());
            }
        }
        if !intent["runners"]["codex"]
            .as_bool()
            .or(intent["enabled"].as_bool())
            .unwrap_or(true)
        {
            return Ok(None);
        }
        if !helper.is_absolute() {
            return Err("Deck-owned CBM helper path must be absolute".into());
        }
        let active = &effective["codebase-memory"];
        if active["enabled"] != false && active.as_object().is_some_and(|m| !m.is_empty()) {
            // Preserve personal integrations: never replace another executable,
            // URL, arguments or environment with Deck's helper silently.
            if active["command"].as_str() != helper.to_str() || !active["url"].is_null() {
                if intent["enabled"].is_null() && intent["runners"]["codex"].is_null() {
                    return Ok(None);
                }
                return Err("Personal codebase-memory conflicts with the selected Deck helper; choose one in session settings".into());
            }
        }
        let files = vec![(path, hash)];
        if active["enabled"] == false {
            return Ok(Some(Self {
                spec: active.clone(),
                files,
                directory: None,
            }));
        }
        let mut spec = if active.is_object() {
            active.clone()
        } else {
            json!({})
        };
        spec["command"] = json!(helper);
        if spec["args"].is_null() {
            spec["args"] = json!([]);
        }
        if spec["env"].is_null() {
            spec["env"] = json!({});
        }
        if spec["enabled"].is_null() {
            spec["enabled"] = json!(true);
        }
        if spec
            .get("environment_id")
            .filter(|v| !v.is_null())
            .is_some_and(|v| v.as_str() != Some("local"))
        {
            return Err("Managed CBM requires a local native environment".into());
        }
        let directory = match spec.get("cwd").filter(|v| !v.is_null()) {
            None => project.to_path_buf(),
            Some(v) => {
                let text = v
                    .as_str()
                    .filter(|s| !s.is_empty() && !s.chars().any(char::is_control))
                    .ok_or("Managed CBM working directory invalid")?;
                let path = Path::new(text);
                if path.is_absolute() {
                    path.into()
                } else {
                    std::env::current_dir()
                        .map_err(|_| "Native working directory unavailable")?
                        .join(path)
                }
            }
        };
        let bound = directory
            .canonicalize()
            .ok()
            .filter(|p| p.is_dir())
            .ok_or("Managed CBM working directory unavailable")?;
        spec["cwd"] = json!(bound);
        spec["environment_id"] = json!("local");
        Ok(Some(Self {
            spec,
            files,
            directory: Some((directory, bound)),
        }))
    }
    pub fn helper_path_at(root: &Path) -> Result<PathBuf, String> {
        if let Some(path) = std::env::var_os("DECK2_CBM_BINARY") {
            return Ok(PathBuf::from(path));
        }
        let release = crate::cbm_artifacts::release("0.12.1")?;
        Ok(root
            .join("cbm-artifacts")
            .join(release.executable)
            .join("codebase-memory-mcp"))
    }
    pub fn generation(&self) -> String {
        crate::tasks::digest(serde_json::to_string(&self.files).unwrap().as_bytes())
    }
    pub fn verify(&self) -> Result<(), String> {
        if let Some((directory, bound)) = &self.directory
            && (directory.canonicalize().ok().as_ref() != Some(bound) || !bound.is_dir())
        {
            return Err("Managed CBM working directory changed during execution".into());
        }
        for (path, hash) in &self.files {
            if hash == "absent" {
                if !matches!(std::fs::symlink_metadata(path), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
                {
                    return Err("Managed CBM selection changed during execution".into());
                }
                continue;
            }
            if crate::tasks::digest(crate::session_roles::read(path, 1024 * 1024)?.as_bytes())
                != *hash
            {
                return Err("Managed CBM selection changed during execution".into());
            }
        }
        Ok(())
    }
}

/// The native MCP loader owns the client process, in the attempt's supervised
/// process tree. Never join an account daemon's rendezvous. Retain the runtime
/// until that tree has drained, using the same ownership rule as image files.
pub(crate) struct Backend {
    pub spec: Value,
    selection: Selection,
    runtime: Option<tempfile::TempDir>,
    binary: (PathBuf, String),
}
impl Backend {
    pub fn prepare(selection: Selection) -> Result<Self, String> {
        let command = selection.spec["command"]
            .as_str()
            .ok_or("Managed CBM stdio command unavailable")?;
        let command = Path::new(command);
        if !command.is_absolute() {
            return Err("Managed CBM command is not pinned".into());
        }
        let identity = verify_binary(command)?;
        let binary = (command.to_path_buf(), identity);
        selection.verify()?;
        let runtime = tempfile::Builder::new()
            .prefix("d2cb-")
            .tempdir_in("/tmp")
            .map_err(|_| "Cannot allocate CBM runtime")?;
        let mut spec = selection.spec.clone();
        spec["enabled"] = json!(true);
        if !spec["env"].is_object() {
            spec["env"] = json!({});
        }
        spec["env"]["CBM_RUNTIME_DIR"] = json!(runtime.path());
        spec["required"] = json!(false);
        Ok(Self {
            spec,
            selection,
            runtime: Some(runtime),
            binary,
        })
    }
    pub fn bind(
        &mut self,
        project: &Path,
        config: &Value,
        slot: &std::sync::Arc<std::sync::Mutex<Option<crate::session_freshness::Binding>>>,
        read_only: bool,
    ) -> Result<(), String> {
        let guard =
            crate::session_freshness::Guard::bind(project, &self.spec, self.selection.clone())?;
        *slot.lock().unwrap() = Some(crate::session_freshness::Binding {
            guard,
            selection: self.selection.clone(),
            policy: self.spec.clone(),
            read_only,
        });
        self.spec["command"] =
            json!(std::env::current_exe().map_err(|_| "Host executable unavailable")?);
        self.spec["args"] = json!(["codebase-bridge"]);
        bridge_authorization(&mut self.spec, config)?;
        self.spec["env"]["DECK_CBM_ENDPOINT"] = json!(
            config["url"]
                .as_str()
                .ok_or("Session MCP missing")?
                .replace("/mcp", "/codebase")
        );
        Ok(())
    }
    pub fn verify(&self) -> Result<(), String> {
        self.selection.verify()?;
        if binary_identity(&self.binary.0)? != self.binary.1 {
            return Err("Managed CBM executable changed during execution".into());
        }
        Ok(())
    }
    pub fn retain(&mut self) -> Option<PathBuf> {
        self.runtime.take().map(tempfile::TempDir::keep)
    }
}
impl Drop for Backend {
    fn drop(&mut self) {
        // Only an observed native-tree settlement may remove this namespace.
        if let Some(runtime) = self.runtime.take() {
            let _ = runtime.keep();
        }
    }
}
// Lead uses a stable literal transport header; restricted members keep their
// private credential in native's environment. Never serialize a null credential
// or retain a personal value of this reserved variable in a member's stdio env.
fn bridge_authorization(spec: &mut Value, config: &Value) -> Result<(), String> {
    const KEY: &str = "DECK2_SESSION_AUTHORIZATION";
    let env = spec["env"].as_object_mut().ok_or("Managed MCP environment invalid")?;
    env.remove(KEY);
    match (config["http_headers"]["Authorization"].as_str(), config["env_http_headers"]["Authorization"].as_str()) {
        (Some(auth), None) if auth.starts_with("Bearer ") && auth.len() > 7 => {
            env.insert(KEY.into(), json!(auth));
        }
        (None, Some(KEY)) => {
            let mut vars = match spec.get("env_vars") {
                None | Some(Value::Null) => vec![],
                Some(Value::Array(vars)) if vars.iter().all(Value::is_string) => vars.clone(),
                _ => return Err("Managed MCP environment selection invalid".into()),
            };
            if !vars.iter().any(|v| v == KEY) { vars.push(json!(KEY)); }
            spec["env_vars"] = json!(vars);
        }
        _ => return Err("Managed MCP authorization source is missing or conflicting".into()),
    }
    Ok(())
}

#[cfg(test)]
mod bridge_authority_tests {
    use super::*;
    // Oracle: each native transport has exactly one current credential source;
    // inherited personal values cannot override a restricted member's secret.
    #[test]
    fn literal_and_environment_authority_remain_distinct_and_unambiguous() {
        let initial = json!({"env":{"DECK2_SESSION_AUTHORIZATION":"Bearer stale","UNRELATED":"kept"},"env_vars":["PATH"]});
        let mut lead = initial.clone();
        bridge_authorization(&mut lead, &json!({"http_headers":{"Authorization":"Bearer current"}})).unwrap();
        assert_eq!(lead["env"]["DECK2_SESSION_AUTHORIZATION"], "Bearer current");
        let mut member = initial.clone();
        bridge_authorization(&mut member, &json!({"env_http_headers":{"Authorization":"DECK2_SESSION_AUTHORIZATION"}})).unwrap();
        assert!(member["env"].get("DECK2_SESSION_AUTHORIZATION").is_none());
        assert_eq!(member["env"]["UNRELATED"], "kept");
        assert!(member["env_vars"].as_array().unwrap().iter().any(|v|v=="DECK2_SESSION_AUTHORIZATION"));
        for bad in [json!({}), json!({"env_http_headers":{"Authorization":"OTHER"}}), json!({"http_headers":{"Authorization":"Bearer current"},"env_http_headers":{"Authorization":"DECK2_SESSION_AUTHORIZATION"}})] {
            assert!(bridge_authorization(&mut initial.clone(), &bad).is_err());
        }
    }
}

fn binary_identity(path: &Path) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;
    let m = std::fs::symlink_metadata(path).map_err(|_| "Managed CBM identity unavailable")?;
    if !m.is_file() {
        return Err("Managed CBM integrity failed".into());
    }
    Ok(format!(
        "{}:{}:{}:{}:{}:{}:{}:{}:{}",
        m.dev(),
        m.ino(),
        m.len(),
        m.mode(),
        m.uid(),
        m.mtime(),
        m.mtime_nsec(),
        m.ctime(),
        m.ctime_nsec()
    ))
}
fn verify_binary(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::{
        io::Read,
        os::unix::fs::{MetadataExt, OpenOptionsExt},
    };
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Managed CBM executable unavailable")?;
    let before = file.metadata().map_err(|_| "CBM identity unavailable")?;
    let identity = binary_identity(path)?;
    let release = crate::cbm_artifacts::release("0.12.1")?;
    let expected = if before.len() == release.executable_bytes {
        release.executable
    } else if before.len() == 331387792 {
        "6761236d038de87bf49da5695dd52d7928180d814624d4ceb8d8e849ba07f4c8".into()
    } else {
        return Err("Managed CBM executable unsupported".into());
    };
    if !before.is_file() || before.mode() & 0o022 != 0 || before.mode() & 0o111 == 0 {
        return Err("Managed CBM integrity failed".into());
    }
    let mut file = file.take(before.len() + 1);
    let mut hash = Sha256::new();
    let mut chunk = [0; 65536];
    loop {
        let n = file
            .read(&mut chunk)
            .map_err(|_| "CBM verification failed")?;
        if n == 0 {
            break;
        }
        hash.update(&chunk[..n]);
    }
    let after = std::fs::symlink_metadata(path).map_err(|_| "CBM replaced")?;
    if format!("{:x}", hash.finalize()) != expected
        || before.ino() != after.ino()
        || before.dev() != after.dev()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
        return Err("Managed CBM integrity failed".into());
    }
    if binary_identity(path)? != identity {
        return Err("Managed CBM integrity failed".into());
    }
    Ok(identity)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(enabled: bool) -> (tempfile::TempDir, PathBuf, Value) {
        let dir = tempfile::tempdir().unwrap();
        let native = dir.path().join("native");
        std::fs::create_dir_all(&native).unwrap();
        std::fs::create_dir_all(dir.path().join(".deck")).unwrap();
        std::fs::write(
            dir.path().join(".deck/config.json"),
            json!({"capabilities":{"codebase-memory":{"enabled":enabled}}}).to_string(),
        )
        .unwrap();
        std::fs::write(native.join("config.toml"),"# deck-codex-mcp:codebase-memory\n[mcp_servers.codebase-memory]\ncommand = '/fixture/cbm'\n").unwrap();
        (
            dir,
            native,
            json!({"codebase-memory":{"command":"/fixture/cbm","args":[],"env":{}}}),
        )
    }
    // The ordinary session must select a Deck helper without a native profile
    // marker. Intent and effective native restrictions remain authoritative.
    #[test]
    fn scoped_selection_without_native_materialization() {
        let d = tempfile::tempdir().unwrap();
        let helper = d.path().join("owned-helper");
        let selection = Selection::scoped(d.path(), &json!({}), &helper)
            .unwrap()
            .unwrap();
        assert_eq!(selection.spec["command"], json!(helper));
        selection.verify().unwrap();
        assert!(!d.path().join(".deck").exists());
        assert!(Selection::scoped(d.path(), &json!({"codebase-memory":{"command":"/personal/helper","enabled_tools":["search_graph"]}}), &helper).unwrap().is_none(), "Default selection must preserve personal native integration");
        std::fs::create_dir(d.path().join(".deck")).unwrap();
        std::fs::write(
            d.path().join(".deck/config.json"),
            r#"{"capabilities":{"codebase-memory":{"enabled":false}}}"#,
        )
        .unwrap();
        assert!(
            selection.verify().is_err(),
            "new intent invalidates a held selection"
        );
        assert!(
            Selection::scoped(d.path(), &json!({}), &helper)
                .unwrap()
                .is_none()
        );
        std::fs::write(
            d.path().join(".deck/config.json"),
            r#"{"capabilities":{"codebase-memory":{"enabled":true,"runners":{"codex":false}}}}"#,
        )
        .unwrap();
        assert!(
            Selection::scoped(d.path(), &json!({}), &helper)
                .unwrap()
                .is_none()
        );
        std::fs::write(
            d.path().join(".deck/config.json"),
            r#"{"capabilities":{"codebase-memory":{"enabled":true}}}"#,
        )
        .unwrap();
        assert!(
            Selection::scoped(
                d.path(),
                &json!({"codebase-memory":{"command":"/personal/helper"}}),
                &helper
            )
            .is_err()
        );
        let disabled = Selection::scoped(
            d.path(),
            &json!({"codebase-memory":{"enabled":false}}),
            &helper,
        )
        .unwrap()
        .unwrap();
        assert_eq!(disabled.spec["enabled"], false);
    }
    // Oracle: explicit canonical intent and Deck ownership select the override;
    // personal integrations, disabled intent and changed native layers never do.
    #[test]
    fn selection_respects_intent_ownership_conflicts_and_generation() {
        let (dir, native, mut effective) = fixture(false);
        assert!(
            Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
                .unwrap()
                .is_none()
        );
        let intent = dir.path().join(".deck/config.json");
        std::fs::write(
            &intent,
            r#"{"capabilities":{"codebase-memory":{"enabled":true,"runners":{"codex":false}}}}"#,
        )
        .unwrap();
        assert!(
            Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
                .unwrap()
                .is_none()
        );
        std::fs::write(
            &intent,
            r#"{"capabilities":{"codebase-memory":{"enabled":true}}}"#,
        )
        .unwrap();
        let selected = Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
            .unwrap()
            .unwrap();
        selected.verify().unwrap();
        effective["codebase-memory"]["enabled"] = json!(false);
        effective["codebase-memory"]["enabled_tools"] = json!(["search_graph"]);
        let narrowed = Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
            .unwrap()
            .unwrap();
        assert_eq!(narrowed.spec["enabled"], false);
        assert_eq!(narrowed.spec["enabled_tools"], json!(["search_graph"]));
        effective["codebase-memory"]["enabled"] = json!(true);
        effective["codebase-memory"]["command"] = json!("/other/cbm");
        assert!(Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm")).is_err());
        std::fs::write(
            native.join("config.toml"),
            "[mcp_servers.codebase-memory]\ncommand='/fixture/cbm'\n",
        )
        .unwrap();
        selected.verify().unwrap(); // Native Deck1 markers are not selection authority.
        std::fs::write(
            &intent,
            r#"{"capabilities":{"codebase-memory":{"enabled":false}}}"#,
        )
        .unwrap();
        assert!(selected.verify().is_err());
        assert!(
            Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn malformed_intent_and_unsafe_paths_fail_closed_without_writes() {
        let (dir, native, effective) = fixture(true);
        let path = dir.path().join(".deck/config.json");
        std::fs::write(
            &path,
            r#"{"capabilities":{"codebase-memory":{"enabled":"yes"}}}"#,
        )
        .unwrap();
        for invalid in [
            json!([]),
            json!({"capabilities":[]}),
            json!({"capabilities":{"codebase-memory":true}}),
            json!({"capabilities":{"codebase-memory":{"runners":[]}}}),
        ] {
            std::fs::write(&path, invalid.to_string()).unwrap();
            assert!(Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm")).is_err());
        }
        let before = std::fs::read(&path).unwrap();
        assert!(Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm")).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink(native.join("config.toml"), &path).unwrap();
        assert!(Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm")).is_err());
    }
    // Protect effective native policy and local execution identity at selection.
    #[test]
    fn disabled_selection_skips_live_directory_validation_but_keeps_integrity_checks() {
        let (dir, native, mut effective) = fixture(true);
        let missing = dir.path().join("removed-cwd");
        let source = format!(
            "# deck-codex-mcp:codebase-memory\n[mcp_servers.codebase-memory]\ncommand='/fixture/cbm'\ncwd={}\n",
            json!(missing)
        );
        std::fs::write(native.join("config.toml"), &source).unwrap();
        effective["codebase-memory"]["enabled"] = json!(false);
        effective["codebase-memory"]["cwd"] = json!(missing);
        let selected = Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
            .expect("Disabled server must not require a live working directory")
            .unwrap();
        assert_eq!(selected.spec, effective["codebase-memory"]);
        selected.verify().unwrap();
        effective["codebase-memory"]["command"] = json!("/foreign/cbm");
        assert_eq!(
            Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
                .unwrap()
                .unwrap()
                .spec["enabled"],
            false
        );
        std::fs::write(native.join("config.toml"), source + "# changed\n").unwrap();
        selected.verify().unwrap();
        std::fs::write(dir.path().join(".deck/config.json"), "{}").unwrap();
        assert!(selected.verify().is_err());
    }
    #[test]
    fn effective_policy_replaces_user_policy_without_losing_tool_settings() {
        let (dir, native, mut effective) = fixture(true);
        std::fs::write(native.join("config.toml"), "# deck-codex-mcp:codebase-memory\n[mcp_servers.codebase-memory]\ncommand='/fixture/cbm'\ndefault_tools_approval_mode='approve'\n[mcp_servers.codebase-memory.tools.search_graph]\napproval_mode='approve'\noutput_token_limit=9000\n").unwrap();
        let active = &mut effective["codebase-memory"];
        active["default_tools_approval_mode"] = json!("prompt");
        active["tools"] =
            json!({"search_graph":{"approval_mode":"prompt","output_token_limit":512}});
        active["enabled_tools"] = json!(["search_graph"]);
        active["disabled_tools"] = json!(["delete_project"]);
        active["omit_tools_from"] = json!(["code_mode"]);
        let selection = Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
            .unwrap()
            .unwrap();
        for key in [
            "default_tools_approval_mode",
            "tools",
            "enabled_tools",
            "disabled_tools",
            "omit_tools_from",
        ] {
            assert_eq!(
                selection.spec[key], effective["codebase-memory"][key],
                "{key}"
            );
        }
    }
    #[test]
    fn managed_execution_preserves_admitted_local_directory_and_environment() {
        let (dir, native, mut effective) = fixture(true);
        let selected = Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
            .unwrap()
            .unwrap();
        assert_eq!(
            selected.spec["cwd"],
            json!(dir.path().canonicalize().unwrap())
        );
        assert_eq!(selected.spec["environment_id"], "local");
        effective["codebase-memory"]["cwd"] = json!(dir.path().join("."));
        effective["codebase-memory"]["environment_id"] = json!("local");
        Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
            .unwrap()
            .unwrap()
            .verify()
            .unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        effective["codebase-memory"]["cwd"] = json!(dir.path().join("sub"));
        assert_eq!(
            Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
                .unwrap()
                .unwrap()
                .spec["cwd"],
            json!(dir.path().join("sub"))
        );
        std::fs::write(native.join("config.toml"), format!("# deck-codex-mcp:codebase-memory\n[mcp_servers.codebase-memory]\ncommand='/fixture/cbm'\ncwd={}\nenvironment_id='local'\n", json!(dir.path().join("sub")))).unwrap();
        let selected = Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
            .unwrap()
            .unwrap();
        assert_eq!(
            selected.spec["cwd"],
            json!(dir.path().join("sub").canonicalize().unwrap())
        );
        for env in [json!("remote"), json!(""), json!(7)] {
            effective["codebase-memory"]["environment_id"] = env;
            assert!(Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm")).is_err());
        }
        effective["codebase-memory"]["environment_id"] = json!("local");
        effective["codebase-memory"]["cwd"] = json!(dir.path().join("missing"));
        assert!(Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm")).is_err());
    }
    #[test]
    fn remote_launch_is_refused_and_admitted_local_cwd_is_preserved() {
        let (dir, native, mut effective) = fixture(true);
        effective["codebase-memory"]["environment_id"] = json!("remote-fixture");
        assert!(Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm")).is_err());
        effective["codebase-memory"]["environment_id"] = json!("local");
        effective["codebase-memory"]["cwd"] = json!(native);
        assert!(Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm")).is_ok());
    }
    #[test]
    fn explicit_relative_directory_uses_process_cwd_and_retargeting_is_detected() {
        let (dir, native, mut effective) = fixture(true);
        std::fs::write(native.join("config.toml"), "# deck-codex-mcp:codebase-memory\n[mcp_servers.codebase-memory]\ncommand='/fixture/cbm'\ncwd='.'\n").unwrap();
        effective["codebase-memory"]["cwd"] = json!(std::env::current_dir().unwrap());
        let selected = Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
            .unwrap()
            .unwrap();
        assert_eq!(
            selected.spec["cwd"],
            json!(std::env::current_dir().unwrap().canonicalize().unwrap())
        );
        let link = dir.path().join("cwd-link");
        std::os::unix::fs::symlink(dir.path(), &link).unwrap();
        std::fs::write(native.join("config.toml"), format!("# deck-codex-mcp:codebase-memory\n[mcp_servers.codebase-memory]\ncommand='/fixture/cbm'\ncwd={}\n",json!(link))).unwrap();
        effective["codebase-memory"]["cwd"] = json!(link);
        let selected = Selection::scoped(dir.path(), &effective, Path::new("/fixture/cbm"))
            .unwrap()
            .unwrap();
        selected.verify().unwrap();
        std::fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink(&native, &link).unwrap();
        assert!(selected.verify().is_err());
    }
    // Native executable qualification is reused, not a new version campaign.
    #[test]
    #[ignore = "explicit qualified CBM executable; no process or personal daemon access"]
    fn real_binary_gets_private_distinct_runtime_per_attempt() {
        let binary = std::env::var("DECK2_CBM_BINARY").unwrap();
        let (dir, native, _) = fixture(true);
        std::fs::write(
            native.join("config.toml"),
            format!(
                "# deck-codex-mcp:codebase-memory\n[mcp_servers.codebase-memory]\ncommand={}\n",
                json!(binary)
            ),
        )
        .unwrap();
        let effective = json!({"codebase-memory":{"command":binary}});
        let mut a = Backend::prepare(
            Selection::scoped(dir.path(), &effective, Path::new(&binary))
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        let mut b = Backend::prepare(
            Selection::scoped(dir.path(), &effective, Path::new(&binary))
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert_ne!(
            a.spec["env"]["CBM_RUNTIME_DIR"],
            b.spec["env"]["CBM_RUNTIME_DIR"]
        );
        for backend in [&mut a, &mut b] {
            backend.verify().unwrap();
            std::fs::remove_dir_all(backend.retain().unwrap()).unwrap();
        }
    }
}
#[cfg(test)]
mod freshness_tests {
    use super::*;
    use crate::session_freshness::{Binding, Guard};
    use std::sync::Arc;
    fn git(root: &Path, args: &[&str]) {
        assert!(
            std::process::Command::new("git")
                .arg("-C")
                .arg(root)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
    fn setup() -> (tempfile::TempDir, Value) {
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        for path in ["cache", "config", "data", "native-runtime", "home"] {
            std::fs::create_dir(root.join(path)).unwrap();
        }
        git(root, &["init", "-q"]);
        git(root, &["config", "user.email", "fixture@example.invalid"]);
        git(root, &["config", "user.name", "Fixture"]);
        std::fs::write(root.join(".gitignore"),"cache/\nold-cache/\nconfig/\ndata/\nnative-runtime/\nhome/\nforeign\nrefresh-gate\nquery-change\nrefresh-change\nquery-gate\nquery-started\n").unwrap();
        std::fs::write(root.join("handler.rs"), "fn original_symbol() {}\n").unwrap();
        git(root, &["add", "."]);
        git(root, &["commit", "-qm", "initial"]);
        std::fs::write(root.join("cache/existing"), "").unwrap();
        let spec = json!({"command":"/usr/bin/python3","args":[format!("{}/tests/fake_codebase.py",env!("CARGO_MANIFEST_DIR"))],"cwd":root,"env":{"HOME":root.join("home"),"CBM_CACHE_DIR":root.join("cache"),"XDG_CONFIG_HOME":root.join("config"),"XDG_DATA_HOME":root.join("data"),"XDG_CACHE_HOME":root.join("cache"),"CBM_RUNTIME_DIR":root.join("native-runtime"),"FIXTURE_ROOT":root}});
        (d, spec)
    }
    fn bind(root: &Path, spec: &Value) -> Arc<Guard> {
        Guard::bind(
            root,
            spec,
            Selection {
                spec: spec.clone(),
                files: vec![],
                directory: None,
            },
        )
        .unwrap()
    }
    async fn current(g: &Guard, pattern: &str) -> Value {
        for _ in 0..300 {
            let r = g
                .call(
                    "search_graph",
                    json!({"name_pattern":pattern,"format":"json"}),
                )
                .await
                .unwrap();
            if r["isError"] != true {
                return r;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        panic!(
            "Never reached current graph: {}",
            g.fallback("test-deadline")
        )
    }
    // Oracle: failed startup owns the entire private group until every descendant is reaped.
    #[tokio::test]
    async fn startup_failures_settle_owned_descendants() {
        let mut failures = vec![];
        for phase in [
            "initialize",
            "protocol",
            "version",
            "tools/list",
            "inventory-shape",
            "healthy",
        ] {
            let (d, mut spec) = setup();
            spec["env"]["FIXTURE_FAILURE"] = json!(phase);
            let g = bind(d.path(), &spec);
            let epoch = g.fallback("probe")["structuredContent"]["freshness"]["connectionEpoch"]
                .as_str()
                .unwrap()
                .to_owned();
            g.close().await;
            let pids: Vec<i32> =
                serde_json::from_slice(&std::fs::read(d.path().join("cache/owned-pids")).unwrap())
                    .unwrap();
            let gone = unsafe { libc::kill(-pids[0], 0) } < 0
                && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH);
            let pids_gone = pids
                .iter()
                .all(|p| !Path::new(&format!("/proc/{p}")).exists());
            if !gone || !pids_gone || Path::new(&epoch).exists() {
                failures.push(format!(
                    "{phase}: group_gone={gone}, pids_gone={pids_gone}, runtime_exists={}",
                    Path::new(&epoch).exists()
                ));
            }
            println!(
                "startup_probe phase={phase} group_gone={gone} pids_gone={pids_gone} runtime_exists={}",
                Path::new(&epoch).exists()
            );
            // Reap only the synthetic owned group after the predecessor observation.
            unsafe {
                libc::kill(-pids[0], libc::SIGKILL);
                while libc::waitpid(-pids[0], std::ptr::null_mut(), 0) > 0 {}
            }
            assert!(
                pids.iter()
                    .all(|p| !Path::new(&format!("/proc/{p}")).exists())
            );
        }
        assert!(failures.is_empty(), "{}", failures.join("; "));
    }
    // Oracle: unavailable wait confirmation must retain the runtime and block conflicting reuse.
    #[tokio::test]
    async fn unconfirmed_startup_retains_lease_and_runtime() {
        if std::env::var_os("DECK2_UNCONFIRMED_PROBE").is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "session_codebase::freshness_tests::unconfirmed_startup_retains_lease_and_runtime", "--nocapture"])
                .env("DECK2_UNCONFIRMED_PROBE", "1").output().unwrap();
            assert!(
                output.status.success(),
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
        let (d, mut spec) = setup();
        spec["env"]["FIXTURE_FAILURE"] = json!("initialize");
        // This subprocess exits after the probe. Keep auto-reaping active so that
        // adopted descendants exiting after the direct child are reaped too.
        // Auto-reaping denies the production worker waitpid confirmation (ECHILD).
        assert_ne!(
            unsafe { libc::signal(libc::SIGCHLD, libc::SIG_IGN) },
            libc::SIG_ERR
        );
        let g = bind(d.path(), &spec);
        g.close().await;
        let evidence = g.fallback("probe")["structuredContent"]["freshness"].clone();
        assert_eq!(evidence["state"], "failed");
        let diagnostic = g.call("list_projects", json!({})).await.unwrap();
        assert_eq!(
            diagnostic["structuredContent"]["freshness"]["reason"],
            "private-group-settlement-unconfirmed"
        );
        let epoch = Path::new(evidence["connectionEpoch"].as_str().unwrap());
        assert!(epoch.exists());
        assert!(Arc::ptr_eq(&g, &bind(d.path(), &spec)));
        let mut changed = spec.clone();
        changed["env"]["DIFFERENT_LAUNCH"] = json!("new");
        assert!(
            Guard::bind(
                d.path(),
                &changed,
                Selection {
                    spec: changed.clone(),
                    files: vec![],
                    directory: None
                }
            )
            .is_err()
        );
        let pids: Vec<i32> =
            serde_json::from_slice(&std::fs::read(d.path().join("cache/owned-pids")).unwrap())
                .unwrap();
        for _ in 0..100 {
            if pids
                .iter()
                .all(|p| !Path::new(&format!("/proc/{p}")).exists())
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        let remaining: Vec<_> = pids
            .iter()
            .filter_map(|pid| {
                let stat = std::fs::read_to_string(format!("/proc/{pid}/stat"));
                match stat {
                    Err(error)
                        if error.kind() == std::io::ErrorKind::NotFound
                            || error.raw_os_error() == Some(libc::ESRCH) =>
                    {
                        None
                    }
                    Err(error) => Some((*pid, error.to_string())),
                    Ok(stat) => {
                        // The command name can contain spaces and closing parentheses.
                        let state = stat
                            .rsplit_once(") ")
                            .and_then(|(_, fields)| fields.split_whitespace().next());
                        Some((*pid, state.unwrap_or("unknown").to_owned()))
                    }
                }
            })
            .collect();
        assert!(
            remaining.is_empty(),
            "Fixture PIDs still present: {remaining:?}"
        );
        std::fs::remove_dir_all(epoch).unwrap(); // Remove only this test's deliberately retained evidence.
    }
    // Isolate inherited environment in a child test process; never mutate the test runner's HOME.
    #[tokio::test]
    async fn inherited_cache_environment() {
        if std::env::var_os("DECK2_INHERITED_CACHE_PROBE").is_none() {
            let mut failures = vec![];
            for mode in ["absent", "shadow", "empty-inherited", "empty-explicit"] {
                let (d, mut spec) = setup();
                spec["env"].as_object_mut().unwrap().remove("CBM_CACHE_DIR");
                if mode != "absent" {
                    let home_cache = d.path().join("home/.cache/codebase-memory-mcp");
                    std::fs::create_dir_all(&home_cache).unwrap();
                    std::fs::write(home_cache.join("existing"), "").unwrap();
                }
                if mode == "empty-explicit" {
                    spec["env"]["CBM_CACHE_DIR"] = json!("");
                }
                let output = std::process::Command::new(std::env::current_exe().unwrap())
                    .args([
                        "--exact",
                        "session_codebase::freshness_tests::inherited_cache_environment",
                        "--nocapture",
                    ])
                    .env("DECK2_INHERITED_CACHE_PROBE", spec.to_string())
                    .env("DECK2_CACHE_PROBE_MODE", mode)
                    .env(
                        "CBM_CACHE_DIR",
                        if mode == "empty-inherited" {
                            std::ffi::OsString::new()
                        } else {
                            d.path().join("cache").into_os_string()
                        },
                    )
                    .output()
                    .unwrap();
                if !output.status.success() {
                    failures.push(format!(
                        "{mode}: {}{}",
                        String::from_utf8_lossy(&output.stdout),
                        String::from_utf8_lossy(&output.stderr)
                    ));
                }
            }
            assert!(failures.is_empty(), "{}", failures.join("\n"));
            return;
        }
        let spec: Value =
            serde_json::from_str(&std::env::var("DECK2_INHERITED_CACHE_PROBE").unwrap()).unwrap();
        let root = Path::new(spec["cwd"].as_str().unwrap());
        let g = bind(root, &spec);
        let mode = std::env::var("DECK2_CACHE_PROBE_MODE").unwrap();
        let actual_cache = if mode.starts_with("empty-") {
            root.join("home/.cache/codebase-memory-mcp")
        } else {
            root.join("cache")
        };
        let result = current(&g, "original_symbol").await;
        let reported_store = result["_meta"]["deckCodebaseFreshness"]["storage"].clone();
        if mode == "absent" {
            assert_eq!(reported_store, json!(actual_cache));
            g.close().await;
            return;
        }
        // Replace the actual store with identical graph/generation bytes. Source and status
        // remain unchanged; only physical-store validation can reject this query.
        std::fs::rename(&actual_cache, root.join("old-cache")).unwrap();
        std::fs::create_dir(&actual_cache).unwrap();
        for file in std::fs::read_dir(root.join("old-cache")).unwrap() {
            let file = file.unwrap();
            std::fs::copy(file.path(), actual_cache.join(file.file_name())).unwrap();
        }
        let response = g.call("search_graph", json!({})).await;
        g.close().await;
        println!(
            "cache_probe mode={mode} reported_store_matches={} replacement_withheld={}",
            reported_store == json!(actual_cache),
            response
                .as_ref()
                .is_err_and(|e| e == "storage-identity-changed")
        );
        assert!(
            reported_store == json!(actual_cache)
                && response
                    .as_ref()
                    .is_err_and(|e| e == "storage-identity-changed"),
            "actual store must be identified and replacement withheld: {response:?}"
        );
        // Explicit environment still overrides the inherited cache value.
        let mut explicit = spec.clone();
        explicit["env"]["CBM_CACHE_DIR"] = json!(root.join("old-cache"));
        let g = bind(root, &explicit);
        current(&g, "original_symbol").await;
        g.close().await;
    }
    // Protect sharing, current source/path results, clean offline commits and scoped reads.
    #[tokio::test]
    async fn shared_refresh_queries_and_clean_reconnect() {
        let (d, spec) = setup();
        let root = d.path();
        let g = bind(root, &spec);
        let member = bind(root, &spec);
        assert!(Arc::ptr_eq(&g, &member));
        assert_eq!(
            current(&g, "original_symbol").await["structuredContent"]["nodes"][0]["name"],
            "original_symbol"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("cache/effects"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        let rebound = bind(root, &spec);
        current(&rebound, "original_symbol").await;
        assert_eq!(
            std::fs::read_to_string(root.join("cache/effects"))
                .unwrap()
                .lines()
                .count(),
            1,
            "A new consumer of the warm unchanged connection must not reindex"
        );
        drop(rebound);
        std::fs::write(root.join("handler.rs"), "fn new_symbol() {}\n").unwrap();
        let stale = g.call("search_graph", json!({})).await.unwrap();
        assert_eq!(stale["structuredContent"]["sourceFallback"], true);
        std::fs::rename(root.join("handler.rs"), root.join("renamed.rs")).unwrap();
        let warm = bind(root, &spec);
        current(&warm, "new_symbol").await;
        drop(warm);
        let now = current(&member, ".*").await;
        assert_eq!(
            now["structuredContent"]["nodes"],
            json!([{"name":"new_symbol","file_path":"renamed.rs"}])
        );
        std::fs::remove_file(root.join("renamed.rs")).unwrap();
        assert_eq!(
            current(&g, ".*").await["structuredContent"]["nodes"],
            json!([])
        );
        assert_eq!(
            g.call("search_graph", json!({"project":"foreign"}))
                .await
                .unwrap()["structuredContent"]["sourceFallback"],
            true
        );
        assert_eq!(
            g.call("search_graph", json!({"repo_path":"/foreign"}))
                .await
                .unwrap()["structuredContent"]["sourceFallback"],
            true
        );
        let selection = Selection {
            spec: spec.clone(),
            files: vec![],
            directory: None,
        };
        let b = Binding {
            guard: g.clone(),
            selection,
            policy: json!({"enabled_tools":["search_graph"],"disabled_tools":["delete_project"]}),
            read_only: true,
        };
        assert!(
            b.request(
                &json!({"method":"tools/call","params":{"name":"index_repository","arguments":{}}})
            )
            .await
            .is_err()
        );
        let inventory = b.request(&json!({"method":"tools/list"})).await.unwrap();
        assert_eq!(inventory["tools"].as_array().unwrap().len(), 1);
        drop(b);
        g.close().await;
        drop(g);
        drop(member);
        std::fs::write(root.join("offline.rs"), "fn offline_symbol() {}\n").unwrap();
        git(root, &["add", "-A"]);
        git(root, &["commit", "-qm", "offline-clean"]);
        let reconnected = bind(root, &spec);
        assert_eq!(
            current(&reconnected, ".*").await["structuredContent"]["nodes"],
            json!([{"name":"offline_symbol","file_path":"offline.rs"}])
        );
        reconnected.close().await;
    }
    // Oracle: responses observed across source mutation must never escape as current.
    #[tokio::test]
    async fn changed_during_query_refresh_and_missing_or_foreign_index_fallback() {
        let (d, spec) = setup();
        let root = d.path();
        let g = bind(root, &spec);
        current(&g, ".*").await;
        std::fs::write(root.join("query-change"), "").unwrap();
        let result = g.call("search_graph", json!({})).await.unwrap();
        assert_eq!(result["structuredContent"]["sourceFallback"], true);
        assert_eq!(
            current(&g, ".*").await["structuredContent"]["nodes"][0]["name"],
            "changed_during_query"
        );
        drop(g);
        std::fs::write(root.join("refresh-change"), "").unwrap();
        std::fs::write(root.join("handler.rs"), "fn trigger_refresh() {}\n").unwrap();
        let g = bind(root, &spec);
        assert_eq!(
            current(&g, ".*").await["structuredContent"]["nodes"][0]["name"],
            "changed_during_refresh"
        );
        drop(g);
        let before = std::fs::read(root.join("cache/effects")).unwrap();
        std::fs::write(root.join("foreign"), "").unwrap();
        let foreign = bind(root, &spec);
        foreign.list().await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert_eq!(
            foreign.call("search_graph", json!({})).await.unwrap()["structuredContent"]["sourceFallback"],
            true
        );
        assert_eq!(before, std::fs::read(root.join("cache/effects")).unwrap());
        drop(foreign);
        std::fs::remove_file(root.join("foreign")).unwrap();
        std::fs::remove_file(root.join("cache/existing")).unwrap();
        let missing = bind(root, &spec);
        missing.list().await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert_eq!(
            missing.call("search_graph", json!({})).await.unwrap()["structuredContent"]["sourceFallback"],
            true
        );
        assert_eq!(before, std::fs::read(root.join("cache/effects")).unwrap());
        missing.close().await;
    }
    // Cancellation releases a consumer, but an already-started mutation retains its worker lease.
    #[tokio::test]
    async fn cancelled_consumer_does_not_release_maintenance_lease() {
        let (d, spec) = setup();
        let root = d.path();
        std::fs::write(root.join("refresh-gate"), "").unwrap();
        let g = bind(root, &spec);
        g.list().await.unwrap();
        for _ in 0..200 {
            if root.join("cache/effects").exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert!(root.join("cache/effects").exists());
        let weak = Arc::downgrade(&g);
        drop(g);
        let joined = bind(root, &spec);
        assert!(Arc::ptr_eq(
            &weak.upgrade().expect("Maintenance retains ownership"),
            &joined
        ));
        std::fs::remove_file(root.join("refresh-gate")).unwrap();
        for _ in 0..200 {
            if root.join("cache/graph.json").exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert!(
            root.join("cache/graph.json").exists(),
            "Started mutation must settle even after consumer cancellation"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("cache/effects"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        joined.close().await;
        drop(joined);
    }
    #[tokio::test]
    async fn revoked_queued_mutation_has_no_effect() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let (d, spec) = setup();
        let root = d.path();
        let g = bind(root, &spec);
        current(&g, ".*").await;
        let before = std::fs::read(root.join("cache/effects")).unwrap();
        std::fs::write(root.join("query-gate"), "").unwrap();
        let reader = g.clone();
        let read = tokio::spawn(async move { reader.call("search_graph", json!({})).await });
        for _ in 0..200 {
            if root.join("query-started").exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert!(root.join("query-started").exists());
        let active = Arc::new(AtomicBool::new(true));
        let check = active.clone();
        let b = Binding {
            guard: g.clone(),
            selection: Selection {
                spec: spec.clone(),
                files: vec![],
                directory: None,
            },
            policy: spec,
            read_only: false,
        };
        let mutation = tokio::spawn(async move {
            b.request_authorized(
                &json!({"method":"tools/call","params":{"name":"index_repository","arguments":{}}}),
                Some(Arc::new(move || check.load(Ordering::SeqCst))),
            )
            .await
        });
        tokio::task::yield_now().await;
        active.store(false, Ordering::SeqCst);
        std::fs::remove_file(root.join("query-gate")).unwrap();
        read.await.unwrap().unwrap();
        assert!(mutation.await.unwrap().is_err());
        assert_eq!(before, std::fs::read(root.join("cache/effects")).unwrap());
        g.close().await;
    }
    // Production transport -> production attempt bridge -> queued managed
    // effect: revocation at that final edge must prevent the mutation.
    #[tokio::test]
    async fn retained_managed_forwarding_rechecks_revocation_before_effect() {
        let (d, spec) = setup();
        let root = d.path();
        let g = bind(root, &spec);
        current(&g, ".*").await;
        let before = std::fs::read(root.join("cache/effects")).unwrap();
        let (_scope, app, bridge) = crate::session_mcp::tests::fixture().await;
        *bridge.codebase().lock().unwrap() = Some(Binding {guard:g.clone(), selection:Selection {spec:spec.clone(),files:vec![],directory:None}, policy:spec, read_only:false});
        let t = crate::native::transport::Transport::start().await.unwrap();
        t.bind(&bridge.config); t.arm("thread");
        t.observe(&json!({"method":"turn/started","params":{"threadId":"thread","turn":{"id":"turn"}}}));
        t.confirm("thread","turn");
        t.observe(&json!({"method":"item/started","params":{"threadId":"thread","turnId":"turn","item":{"type":"mcpToolCall","id":"mutation","server":"codebase-memory","tool":"index_repository","arguments":{}}}}));
        std::fs::write(root.join("query-gate"), "").unwrap();
        let reader=g.clone();
        let read=tokio::spawn(async move {reader.call("search_graph", json!({})).await});
        tokio::time::timeout(std::time::Duration::from_secs(3),async {while !root.join("query-started").exists() {tokio::task::yield_now().await;}}).await.unwrap();
        let request=reqwest::Client::new().post(t.config["url"].as_str().unwrap().replace("/mcp","/codebase"))
            .header("authorization",t.config["http_headers"]["Authorization"].as_str().unwrap())
            .json(&json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"index_repository","arguments":{},"_meta":{"threadId":"thread","sessionId":"thread","callId":"mutation","x-codex-turn-metadata":{"thread_id":"thread","session_id":"thread","turn_id":"turn"}}}})).send();
        tokio::pin!(request);
        // Observe actual enqueue after the bridge's initial live check. Revoke
        // only then; the worker's final authority check protects the effect.
        tokio::select! { _ = &mut request => panic!("effect escaped backend barrier"), _ = g.mutation_queued.notified() => {} }
        app.store.lock().unwrap().revoke_session_grants("coordination-session").unwrap();
        std::fs::remove_file(root.join("query-gate")).unwrap();
        read.await.unwrap().unwrap();
        let response=request.await.unwrap();
        let status=response.status();
        let body=response.json::<Value>().await.unwrap();
        assert!(status == axum::http::StatusCode::FORBIDDEN || body.get("error").is_some() || body["result"]["isError"]==true, "revoked mutation accepted: {body}");
        assert_eq!(before, std::fs::read(root.join("cache/effects")).unwrap());
        g.close().await;
    }
    #[tokio::test]
    #[ignore = "explicit isolated native executable witness; DECK2_CBM_BINARY required"]
    async fn actual_native_freshness_journey() {
        let (d, mut spec) = setup();
        let root = d.path();
        let binary = std::env::var("DECK2_CBM_BINARY").unwrap();
        verify_binary(Path::new(&binary)).unwrap();
        spec["command"] = json!(binary);
        spec["args"] = json!([]);
        let project = crate::session_freshness::project_name(root.to_str().unwrap());
        let mut seed = crate::cbm_runtime::Client::native(&spec).unwrap();
        let indexed=seed.rpc("tools/call",json!({"name":"index_repository","arguments":{"repo_path":root,"name":project,"mode":"full","async":false}}),std::time::Duration::from_secs(120)).unwrap();
        assert_ne!(indexed["isError"], true, "{indexed}");
        drop(seed);
        let g = bind(root, &spec);
        let first = current(&g, "original_symbol").await;
        assert!(first.to_string().contains("original_symbol"), "{first}");
        std::fs::write(root.join("handler.rs"), "fn replacement_symbol() {}\n").unwrap();
        std::fs::rename(root.join("handler.rs"), root.join("renamed.rs")).unwrap();
        let new = current(&g, ".*symbol").await;
        assert!(new.to_string().contains("replacement_symbol"), "{new}");
        assert!(!new.to_string().contains("original_symbol"), "{new}");
        std::fs::remove_file(root.join("renamed.rs")).unwrap();
        let deleted = current(&g, "replacement_symbol").await;
        assert!(
            !deleted
                .to_string()
                .contains("\"name\":\"replacement_symbol\""),
            "{deleted}"
        );
        g.close().await;
        drop(g);
        std::fs::write(root.join("offline.rs"), "fn offline_symbol() {}\n").unwrap();
        git(root, &["add", "-A"]);
        git(root, &["commit", "-qm", "offline-clean"]);
        let g = bind(root, &spec);
        let offline = current(&g, "offline_symbol").await;
        assert!(offline.to_string().contains("offline_symbol"), "{offline}");
        let started = std::time::Instant::now();
        for _ in 0..20 {
            let result = g
                .call("search_graph", json!({"name_pattern":"offline_symbol"}))
                .await
                .unwrap();
            assert_ne!(result["isError"], true);
        }
        println!("warm_graph_20_ms={}", started.elapsed().as_millis());
        println!(
            "Isolated actual-native graph journey: {}",
            json!({"first":first,"replacement":new,"deleted":deleted,"offline":offline})
        );
        g.close().await;
    }
}
