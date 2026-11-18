//! Read-only native inputs. Digests contain no credential values; no native
//! profile, installation or conversation directory is created or rewritten.
use super::*;
use crate::tasks::digest;
use deck2_shared::{AdmissionSnapshot, NativeBinding, NativeRunner, RunnerBinding};
use std::{
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
};

pub fn executable() -> Result<PathBuf, String> {
    let name = std::env::var_os("DECK2_OPENCODE").unwrap_or_else(|| "opencode".into());
    let path = PathBuf::from(&name);
    let path = if path.is_absolute() {
        path
    } else {
        std::env::var_os("PATH")
            .and_then(|p| {
                std::env::split_paths(&p)
                    .map(|p| p.join(&name))
                    .find(|p| p.is_file())
            })
            .ok_or("OpenCode executable unavailable")?
    };
    let path = path
        .canonicalize()
        .map_err(|_| "OpenCode executable unavailable")?;
    let m = path
        .metadata()
        .map_err(|_| "OpenCode executable unavailable")?;
    if !m.is_file() || m.len() > 512 * 1024 * 1024 || m.permissions().mode() & 0o111 == 0 {
        return Err("Invalid OpenCode executable".into());
    }
    Ok(path)
}
pub fn root() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("Native home unavailable")?;
    Ok(std::env::var_os("OPENCODE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(home).join(".config"))
                .join("opencode")
        }))
}
pub fn storage() -> Result<String, String> {
    let home = std::env::var_os("HOME").ok_or("Native home unavailable")?;
    let path = std::env::var_os("OPENCODE_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(home).join(".local/share"))
                .join("opencode/opencode.db")
        });
    let path = if path.is_absolute() {
        path
    } else {
        return Err("Relative native storage is unsupported".into());
    };
    // The database may not exist until native startup. Bind its canonical parent
    // chain, without binding a database inode that native legitimately replaces.
    let mut parent = path.as_path();
    while !parent.exists() {
        parent = parent.parent().ok_or("Native storage root unavailable")?;
    }
    let m = parent
        .metadata()
        .map_err(|_| "Native storage identity unavailable")?;
    let resolved = parent
        .canonicalize()
        .map_err(|_| "Native storage cannot be resolved")?
        .join(
            path.strip_prefix(parent)
                .map_err(|_| "Native storage identity invalid")?,
        );
    Ok(digest(
        format!("{}:{}:{}", resolved.display(), m.dev(), unsafe {
            libc::geteuid()
        })
        .as_bytes(),
    ))
}
/// JSONC lexical normalization, preserving strings and rejecting unterminated
/// comments/strings. serde performs structural validation.
pub fn jsonc(raw: &str) -> Result<Value, String> {
    let b = raw.as_bytes();
    let mut out = b.to_vec();
    let mut i = 0;
    let mut string = false;
    while i < b.len() {
        if string {
            if b[i] == b'\\' {
                i += 2;
                continue;
            }
            if b[i] == b'"' {
                string = false;
            }
            i += 1;
            continue;
        }
        if b[i] == b'"' {
            string = true;
            i += 1;
            continue;
        }
        if b[i..].starts_with(b"//") {
            while i < b.len() && b[i] != b'\n' {
                out[i] = b' ';
                i += 1;
            }
            continue;
        }
        if b[i..].starts_with(b"/*") {
            out[i] = b' ';
            out[i + 1] = b' ';
            i += 2;
            loop {
                if i + 1 >= b.len() {
                    return Err("Unterminated native config comment".into());
                }
                if b[i..].starts_with(b"*/") {
                    out[i] = b' ';
                    out[i + 1] = b' ';
                    i += 2;
                    break;
                }
                if b[i] != b'\n' {
                    out[i] = b' ';
                }
                i += 1;
            }
            continue;
        }
        i += 1;
    }
    if string {
        return Err("Unterminated native config string".into());
    }
    let mut i = 0;
    let mut string = false;
    while i < out.len() {
        if string {
            if out[i] == b'\\' {
                i += 2;
                continue;
            }
            if out[i] == b'"' {
                string = false;
            }
        } else if out[i] == b'"' {
            string = true;
        } else if out[i] == b',' {
            let mut j = i + 1;
            while j < out.len() && out[j].is_ascii_whitespace() {
                j += 1;
            }
            if j < out.len() && matches!(out[j], b'}' | b']') {
                out[i] = b' ';
            }
        }
        i += 1;
    }
    serde_json::from_slice(&out).map_err(|_| "Native JSONC configuration invalid".into())
}
pub fn merge(base: &mut Value, next: Value) {
    if let (Some(a), Some(b)) = (base.as_object_mut(), next.as_object()) {
        for (k, v) in b {
            if let Some(old) = a.get_mut(k) {
                merge(old, v.clone());
            } else {
                a.insert(k.clone(), v.clone());
            }
        }
    } else {
        *base = next;
    }
}

pub fn configuration(project: &str, trusted: bool) -> Result<String, String> {
    let mut files = BTreeMap::new();
    let mut total = 0;
    fn capture(
        path: &Path,
        files: &mut BTreeMap<String, String>,
        total: &mut usize,
        depth: u8,
    ) -> Result<(), String> {
        if depth > 24 || files.len() > 4096 || *total > 16 * 1024 * 1024 {
            return Err("Native source inspection limit".into());
        }
        let m = match std::fs::symlink_metadata(path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                files.insert(path.to_string_lossy().into_owned(), "absent".into());
                return Ok(());
            }
            Err(_) => return Err("Native source unavailable".into()),
        };
        if m.is_symlink() {
            return Err("Native configuration symlink cannot be attested".into());
        }
        if m.is_dir() {
            files.insert(path.to_string_lossy().into_owned(), "directory".into());
            for e in std::fs::read_dir(path).map_err(|_| "Native source unavailable")? {
                capture(
                    &e.map_err(|_| "Native source unavailable")?.path(),
                    files,
                    total,
                    depth + 1,
                )?;
            }
        } else {
            let text = crate::session_roles::read(path, 1024 * 1024)?;
            if matches!(
                path.file_name().and_then(|s| s.to_str()),
                Some("config.json" | "opencode.json" | "opencode.jsonc")
            ) && jsonc(&text)?["mcp"]
                .as_object()
                .is_some_and(|m| m.contains_key("deck"))
            {
                return Err("Native Deck MCP configuration conflict".into());
            }
            *total += text.len();
            files.insert(path.to_string_lossy().into_owned(), digest(text.as_bytes()));
        }
        Ok(())
    }
    let root = root()?;
    if !trusted {
        for name in ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR"] {
            if let Some(path) = std::env::var_os(name) {
                let path = PathBuf::from(path);
                let path = if path.is_absolute() {
                    path
                } else {
                    Path::new(project).join(path)
                };
                if path.starts_with(project)
                    || path.canonicalize().is_ok_and(|p| p.starts_with(project))
                {
                    return Err(
                        "Explicit OpenCode project configuration requires project trust".into(),
                    );
                }
            }
        }
    }
    for dir in [root.clone(), PathBuf::from("/etc/opencode")] {
        for name in [
            "config.json",
            "opencode.json",
            "opencode.jsonc",
            "plugins",
            "plugin",
            "agents",
            "agent",
            "modes",
            "mode",
            "skills",
            "prompts",
            "deck",
            "package.json",
            "bun.lock",
        ] {
            capture(&dir.join(name), &mut files, &mut total, 0)?;
        }
    }
    if let Some(p) = std::env::var_os("OPENCODE_CONFIG") {
        capture(Path::new(&p), &mut files, &mut total, 0)?;
    }
    if trusted {
        let mut p = Some(Path::new(project));
        while let Some(dir) = p {
            for name in ["opencode.json", "opencode.jsonc", ".opencode"] {
                let path = dir.join(name);
                if name == ".opencode" {
                    for item in [
                        "opencode.json",
                        "opencode.jsonc",
                        "plugins",
                        "plugin",
                        "agents",
                        "agent",
                        "modes",
                        "mode",
                        "skills",
                        "prompts",
                        "deck",
                    ] {
                        capture(&path.join(item), &mut files, &mut total, 0)?;
                    }
                } else {
                    capture(&path, &mut files, &mut total, 0)?;
                }
            }
            p = dir.parent();
        }
    }
    // Hash the effective environment rather than copying credentials into state.
    // Native may read provider-specific variables with arbitrary names.
    let env = std::env::vars_os()
        .filter(|(k, _)| !matches!(k.to_str(), Some("SHLVL" | "_")))
        .map(|(k, v)| {
            (
                k.to_string_lossy().into_owned(),
                digest(v.as_encoded_bytes()),
            )
        })
        .collect::<BTreeMap<_, _>>();
    Ok(digest(
        serde_json::to_vec(&(project, trusted, files, env))
            .unwrap()
            .as_slice(),
    ))
}
pub fn bind(
    snapshot: &mut AdmissionSnapshot,
    assignment: &MemberAssignment,
    member: &str,
    trusted: bool,
) -> Result<(), String> {
    if assignment.runner_id != "opencode" {
        return Ok(());
    }
    let path = executable()?;
    let executable = digest(&std::fs::read(&path).map_err(|_| "OpenCode executable unavailable")?);
    let role = crate::session_roles::Role::opencode(&root()?, member)?;
    let binding = RunnerBinding {
        path: path.to_string_lossy().into_owned(),
        executable,
        ownership: "external_unknown".into(),
        model: None,
        qualification: "deck2-opencode-1.19.1-http-sse-v1".into(),
        catalog: None,
    };
    snapshot.native = Some(NativeBinding {
        runner: NativeRunner::Opencode,
        protocol: "http-sse".into(),
        version: "1.19.1".into(),
        executable: binding.clone(),
        storage: storage()?,
        configuration: configuration(&snapshot.project.root, trusted)?,
        role: role.identity(),
    });
    snapshot.runner = Some(binding);
    Ok(())
}

pub async fn inventory(project: &str, trusted: bool) -> Result<Vec<Model>, String> {
    let path = executable()?;
    let role = crate::session_roles::Role::opencode(&root()?, "lead")?;
    let before = configuration(project, trusted)?;
    let version = crate::native::command_probe(&path, &["--version"]).await?;
    if String::from_utf8_lossy(&version).trim() != "1.19.1" {
        return Err("Unsupported ordinary OpenCode version".into());
    }
    let out =
        crate::native::command_probe_at(&path, &["models", "--verbose"], Some((project, trusted)))
            .await?;
    role.verify()?;
    if configuration(project, trusted)? != before {
        return Err("OpenCode configuration changed during discovery".into());
    }
    parse_models(std::str::from_utf8(&out).map_err(|_| "Native model output invalid")?)
}
