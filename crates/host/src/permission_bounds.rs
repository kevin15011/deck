//! Bounded host policies for reusable permissions.
use deck2_shared::{Decision, PermissionScope, PermissionScopeOption};
use serde_json::{Value, json};
use std::path::{Component, Path, PathBuf};

mod bash;

pub(crate) fn bash_reusable(command: &str, root: &Path, cwd: &Path) -> bool {
    bash::reusable(command, root, cwd)
}

pub(crate) fn claude_bash_requires_fresh_review(command: &str, root: &Path) -> bool {
    bash::visible_protected_git(command, root, root)
}

pub(crate) fn codex_native_prefix_reusable(request: &Value, prefix: &[&str]) -> bool {
    let cwd = request["cwd"].as_str().map(Path::new).unwrap_or(Path::new("/"));
    if !request["command"].as_str().is_some_and(|command| bash_reusable(command, cwd, cwd)) {
        return false;
    }
    let [head, args @ ..] = prefix else { return false };
    let executable = Path::new(head).file_name().and_then(|name| name.to_str());
    // Codex applies persistent prefixes without Deck checking the wrapped command.
    if executable == Some("rtk") { return false; }
    if executable == Some("git") {
        // Codex can apply a persisted prefix without consulting Deck. Each
        // argument after a permitted Git read verb stays part of that verb.
        return bash::git_words(args, cwd, cwd).is_some_and(|args| {
            args.first().is_some_and(|sub| matches!(*sub, "status" | "diff" | "log" | "show"))
                // A shorter prefix could be extended with output or helper options.
                && args.get(1) == Some(&"--")
        });
    }
    bash::simple_command(prefix, cwd, cwd)
}

pub(crate) fn correlate_files(d: &mut Decision) {
    if let Some(n) = &mut d.native
        && let Ok(p) = serde_json::from_str::<Value>(&n.parameters)
        && let Some(changes) = p.get("changes").filter(|c| c.is_array())
    {
        n.file_proposal = Some(crate::tasks::digest(changes.to_string().as_bytes()));
    }
}
fn only(v: &Value, keys: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|o| o.keys().all(|k| keys.contains(&k.as_str())))
}
// Reject ambiguous lexical paths, then resolve every existing ancestor. Missing
// leaves are permitted for creates; no unresolved symlink (including dangling).
fn canonical(path: &str, cwd: &Path) -> Option<PathBuf> {
    let p = Path::new(path);
    if path.is_empty()
        || path.chars().any(|c| c.is_control())
        || p.components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
    {
        return None;
    }
    let p = if p.is_absolute() {
        p.to_path_buf()
    } else {
        cwd.join(p)
    };
    let mut existing = p.as_path();
    let mut missing = Vec::new();
    loop {
        match std::fs::symlink_metadata(existing) {
            Ok(_) => break,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                missing.push(existing.file_name()?.to_owned());
                existing = existing.parent()?;
            }
            Err(_) => return None,
        }
    }
    let mut resolved = std::fs::canonicalize(existing).ok()?;
    if !missing.is_empty() && !resolved.is_dir() {
        return None;
    }
    for leaf in missing.into_iter().rev() {
        resolved.push(leaf);
    }
    Some(resolved)
}
fn safe_path(path: &str, cwd: &Path, project: &Path) -> Option<String> {
    let p = canonical(path, cwd)?;
    let rel = p.strip_prefix(project).ok()?;
    if rel.as_os_str().is_empty()
        || rel.components().any(|c| {
            matches!(
                c.as_os_str().to_str(),
                Some(".git" | ".deck" | ".tools" | ".atl")
            )
        })
    {
        return None;
    }
    p.to_str().map(str::to_owned)
}
fn project(s: &PermissionScope) -> Option<PathBuf> {
    std::fs::canonicalize(s.actor["project"]["root"].as_str()?).ok()
}
fn cwd(p: &Value, root: &Path) -> Option<PathBuf> {
    match p.get("cwd") {
        None | Some(Value::Null) => Some(root.to_path_buf()),
        Some(Value::String(s)) => std::fs::canonicalize(s).ok().filter(|p| p.is_dir()),
        _ => None,
    }
}
fn without(v: &Value, keys: &[&str]) -> Value {
    let mut v = v.clone();
    if let Some(o) = v.as_object_mut() {
        for k in keys {
            o.remove(*k);
        }
    }
    v
}
fn option(
    s: &PermissionScope,
    kind: &str,
    label: &str,
    description: String,
    bounds: Value,
) -> PermissionScopeOption {
    let id = format!(
        "scope-v1-{}",
        crate::tasks::digest(
            json!([1, s.actor, s.issuer, kind, bounds])
                .to_string()
                .as_bytes()
        )
    );
    PermissionScopeOption {
        id,
        kind: kind.into(),
        label: label.into(),
        description,
        bounds,
    }
}
#[derive(Clone)]
struct Files {
    endpoints: Vec<String>,
    operations: Vec<String>,
    context: Value,
}
fn files(d: &Decision, s: &PermissionScope) -> Option<Files> {
    let p = &s.material["request"];
    let changes = p["changes"]
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 32)?;
    if d.native.as_ref()?.file_proposal.as_deref()
        != Some(&crate::tasks::digest(p["changes"].to_string().as_bytes()))
        || !only(p, &["changes", "cwd", "grantRoot", "paths"])
        || !p["grantRoot"].is_null()
        || !p["paths"].is_null()
    {
        return None;
    }
    let root = project(s)?;
    let cwd = cwd(p, &root)?;
    let mut endpoints = Vec::new();
    let mut operations = Vec::new();
    for c in changes {
        if !only(c, &["path", "kind", "diff"])
            || !c["diff"].is_string()
            || !only(&c["kind"], &["type", "move_path"])
        {
            return None;
        }
        endpoints.push(safe_path(c["path"].as_str()?, &cwd, &root)?);
        let kind = c["kind"]["type"].as_str()?;
        let op = match (kind, c["kind"].get("move_path").filter(|v| !v.is_null())) {
            ("update", Some(dest)) => {
                endpoints.push(safe_path(dest.as_str()?, &cwd, &root)?);
                "move"
            }
            ("update", None) => "update",
            ("add", None) => "create",
            ("delete", None) => "delete",
            _ => return None,
        };
        operations.push(op.into());
    }
    endpoints.sort();
    endpoints.dedup();
    operations.sort();
    operations.dedup();
    Some(Files {
        endpoints,
        operations,
        context: without(p, &["changes"]),
    })
}
// A deliberately small whole-command decoder: no quotes, escapes, shell syntax,
// assignments, stdin, wrappers or arbitrary flags. Only cargo test is registered.
fn cargo_test(p: &Value) -> Option<Vec<String>> {
    if !only(
        p,
        &[
            "command",
            "cwd",
            "environment",
            "environmentId",
            "kind",
            "additionalPermissions",
            "networkApprovalContext",
            "proposedExecpolicyAmendment",
            "availableDecisions",
            "commandActions",
            "proposedNetworkPolicyAmendments",
            "startedAtMs",
            "approvalId",
        ],
    ) || !p["approvalId"].is_null()
        || !p["proposedNetworkPolicyAmendments"].is_null()
        || !(p["kind"].is_null() || p["kind"] == "command")
        || p["proposedExecpolicyAmendment"] != json!(["cargo", "test"])
    {
        return None;
    }
    let command = p["command"].as_str()?;
    if command.len() > 4096
        || command
            .bytes()
            .any(|b| !b.is_ascii_alphanumeric() && !b" _-:.=".contains(&b))
    {
        return None;
    }
    let argv: Vec<_> = command
        .split_ascii_whitespace()
        .map(str::to_owned)
        .collect();
    if argv.len() < 2 || argv.len() > 64 || argv[0] != "cargo" || argv[1] != "test" {
        return None;
    }
    let mut harness = false;
    let mut expect_name = false;
    for a in &argv[2..] {
        if expect_name {
            if a.starts_with('-')
                || !a
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            {
                return None;
            }
            expect_name = false;
            continue;
        }
        if harness {
            if !matches!(
                a.as_str(),
                "--nocapture" | "--exact" | "--ignored" | "--include-ignored"
            ) && !a
                .strip_prefix("--test-threads=")
                .is_some_and(|s| s.parse::<u16>().is_ok_and(|n| n > 0))
                && (a.starts_with('-')
                    || !a
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_:".contains(&b)))
            {
                return None;
            }
        } else {
            match a.as_str() {
                "--" => harness = true,
                "-p" | "--package" | "--test" | "--bin" => expect_name = true,
                "--workspace" | "--lib" | "--bins" | "--tests" | "--all-targets" | "--locked"
                | "--offline" => {}
                _ if !a.starts_with('-')
                    && a.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_:".contains(&b)) => {}
                _ => return None,
            }
        }
    }
    if expect_name {
        return None;
    }
    Some(argv)
}
fn command_bounds(s: &PermissionScope) -> Option<Value> {
    let p = &s.material["request"];
    cargo_test(p)?;
    // Exact execution context, including the lexical cwd and every permission field.
    let root = project(s)?;
    let resolved = cwd(p, &root)?;
    if !resolved.starts_with(&root) {
        return None;
    }
    Some(
        json!({"prefix":["cargo","test"],"cwd":resolved,"context":without(p,&["command","commandActions","startedAtMs"])}),
    )
}
fn profile(s: &PermissionScope) -> Option<Value> {
    let p = &s.material["request"];
    if !only(p, &["permissions", "cwd", "environmentId", "startedAtMs"])
        || !only(&p["permissions"], &["network", "fileSystem"])
    {
        return None;
    }
    let root = project(s)?;
    let cwd = cwd(p, &root)?;
    let perm = &p["permissions"];
    let network = if perm["network"].is_null() {
        false
    } else {
        if !only(&perm["network"], &["enabled"]) {
            return None;
        }
        match &perm["network"]["enabled"] {
            Value::Null => false,
            Value::Bool(b) => *b,
            _ => return None,
        }
    };
    let mut read = Vec::new();
    let mut write = Vec::new();
    let fs = &perm["fileSystem"];
    if !fs.is_null() {
        if !only(fs, &["read", "write", "entries", "globScanMaxDepth"])
            || !fs["globScanMaxDepth"].is_null()
        {
            return None;
        }
        for (key, list) in [("read", &mut read), ("write", &mut write)] {
            if let Some(paths) = fs[key].as_array() {
                if paths.len() > 32 {
                    return None;
                }
                for p in paths {
                    list.push(safe_path(p.as_str()?, &cwd, &root)?);
                }
            } else if !fs[key].is_null() {
                return None;
            }
        }
        if let Some(entries) = fs["entries"].as_array() {
            if entries.len() > 32 {
                return None;
            }
            for e in entries {
                if !only(e, &["access", "path"])
                    || !only(&e["path"], &["type", "path"])
                    || e["path"]["type"] != "path"
                {
                    return None;
                }
                let path = safe_path(e["path"]["path"].as_str()?, &cwd, &root)?;
                match e["access"].as_str()? {
                    "read" => read.push(path),
                    "write" => write.push(path),
                    _ => return None,
                }
            }
        } else if !fs["entries"].is_null() {
            return None;
        }
    }
    read.sort();
    read.dedup();
    write.sort();
    write.dedup();
    if read.len() + write.len() > 32 {
        return None;
    }
    Some(
        json!({"network":network,"read":read,"write":write,"context":without(p,&["permissions","startedAtMs"])}),
    )
}
// Claude's Read, Glob and Grep are the only tools that reach a Lead prompt with
// a reusable scope. Each "Any" varies only its own target/pattern fields; every
// other input stays exact. Grep keeps its original kind and bounds so earlier
// grants remain valid.
fn workspace_tool(s: &PermissionScope) -> Option<(&'static str, Value)> {
    if s.material["category"] != "claude_workspace_read" {
        return None;
    }
    let (kind, varying): (&'static str, &[&str]) = match s.material["tool"].as_str()? {
        "Grep" => (
            "workspace_grep",
            &["pattern", "path", "output_mode", "-A", "-B", "-C", "context", "-n", "head_limit", "offset"],
        ),
        "Glob" => ("workspace_read", &["pattern", "path"]),
        "Read" => ("workspace_read", &["file_path", "offset", "limit", "pages"]),
        _ => return None,
    };
    let root = Path::new(s.actor["project"]["root"].as_str()?);
    // Admission and release validate the canonical target and its identity.
    // Reuse can vary that target within the same admitted project.
    let target = Path::new(s.material["target"]["path"].as_str()?);
    if !root.is_absolute() || !target.starts_with(root) {
        return None;
    }
    let context = without(&s.material["input"], varying);
    Some((
        kind,
        if kind == "workspace_grep" {
            json!({"root":root,"context":context})
        } else {
            json!({"root":root,"tool":s.material["tool"],"context":context})
        },
    ))
}

const BASH_FAMILIES: &[&[&str]] = &[
    &["cargo", "test"],
    &["cargo", "check"],
    &["cargo", "build"],
    &["cargo", "clippy"],
    &["bun", "test"],
    &["git", "status"],
    &["git", "diff"],
    &["git", "log"],
    &["git", "show"],
];
const BASH_DENIED_FLAGS: &[&str] = &[
    "--config", "--manifest-path", "--target-dir", "--output", "--ext-diff", "--textconv",
    "--git-dir", "--work-tree", "--exec-path", "--preload", "--cwd", "--exec", "-c", "-C", "-Z",
];
fn plain_words(command: &str) -> bool {
    command.chars().all(|c| c == ' ' || c.is_ascii_alphanumeric() || "_./:=+@%,-".contains(c))
}
fn bash_command(s: &PermissionScope) -> Option<&str> {
    let p = &s.material["request"];
    if s.material["category"] != "relay" || p["toolName"] != "Bash" {
        return None;
    }
    let args = p["_meta"]["tool_params"].as_object()?;
    if !args.keys().all(|k| k == "command" || k == "timeout") {
        return None;
    }
    args.get("command")?.as_str()
}
fn bash_prefix(command: &str, root: &Path) -> Option<[&'static str; 2]> {
    if !plain_words(command) {
        return None;
    }
    let t: Vec<&str> = command.split_whitespace().collect();
    let (head, args) = t.split_first()?;
    let args = if *head == "git" { bash::git_words(args, root, root)? } else { args };
    let (sub, rest) = args.split_first()?;
    let family = BASH_FAMILIES.iter().find(|f| *head == f[0] && *sub == f[1])?;
    if rest.iter().any(|a| {
        BASH_DENIED_FLAGS.iter().any(|f| a == f || a.starts_with(&format!("{f}=")))
            || a.starts_with("--config")
    }) {
        return None;
    }
    Some([family[0], family[1]])
}
fn bash_bounds(s: &PermissionScope) -> Vec<(&'static str, Value)> {
    let Some(command) = bash_command(s) else { return vec![] };
    let Some(root) = s.actor["project"]["root"].as_str().map(Path::new).filter(|p| p.is_absolute()) else { return vec![] };
    if claude_bash_requires_fresh_review(command, root) {
        return vec![];
    }
    if !bash_reusable(command, root, root) {
        return vec![("bash_any", json!({"root":root}))];
    }
    let mut out = vec![];
    if plain_words(command) && command.len() <= 2000 {
        out.push(("bash_command", json!({"root":root,"command":command})));
    }
    if let Some(prefix) = bash_prefix(command, root) {
        out.push(("bash_prefix", json!({"root":root,"prefix":prefix})));
    }
    out.push(("bash_any", json!({"root":root})));
    out
}

// Require a separately safe concrete action both when offering a grant and
// when matching it. Bounds contain only the context permitted to stay fixed.
pub(crate) fn fresh_command_required(s: &PermissionScope) -> bool {
    let p = &s.material["request"];
    let root = s.actor["project"]["root"].as_str().map(Path::new);
    if s.material["category"] == "command" {
        let dir = p["cwd"].as_str().map(Path::new);
        return !root.zip(dir).zip(p["command"].as_str()).is_some_and(|((root, dir), command)| {
            bash_reusable(command, root, dir)
        });
    }
    if s.material["category"] == "relay" {
        if p["toolName"] == "Bash" {
            return bash_bounds(s).is_empty();
        }
        if p["toolName"] == "command" {
            return !root.zip(p["_meta"]["tool_params"]["command"].as_str()).is_some_and(|(root, command)| {
                bash_reusable(command, root, root)
            });
        }
    }
    false
}

fn project_any(d: &Decision, s: &PermissionScope) -> Option<(Value, &'static str)> {
    let p = &s.material["request"];
    let root = project(s)?;
    let category = s.material["category"].as_str()?;
    let (context, description) = match category {
        "files" => (files(d, s)?.context, "Any Codex patch in this project, including creates, changes, moves and deletes."),
        "command" => {
            if !cwd(p, &root)?.starts_with(&root)
                || !only(p, &["command", "cwd", "environment", "environmentId", "kind", "additionalPermissions",
                    "networkApprovalContext", "proposedExecpolicyAmendment", "availableDecisions", "commandActions",
                    "proposedNetworkPolicyAmendments", "startedAtMs", "approvalId"])
                || !(p["kind"].is_null() || p["kind"] == "command")
                || !p["approvalId"].is_null() || !p["networkApprovalContext"].is_null()
                || !p["proposedNetworkPolicyAmendments"].is_null()
                || !(p["additionalPermissions"].is_null()
                    || p["additionalPermissions"] == json!({"network":false})
                    || p["additionalPermissions"] == json!({"network":{"enabled":false}}))
                || fresh_command_required(s)
            {
                return None;
            }
            (without(p, &["command","commandActions","startedAtMs","proposedExecpolicyAmendment","availableDecisions"]),
                "Any classifiable Codex command in this working directory with the same execution settings. Protected Git operations require separate review.")
        }
        "permissions" => {
            if !cwd(p, &root)?.starts_with(&root) {
                return None;
            }
            let profile = profile(s)?;
            if profile["network"] != false {
                return None;
            }
            (profile["context"].clone(), "Any supported file read or write capability within this project with the same execution settings. Network access requires separate review.")
        }
        "relay" if p["toolName"] == "command" => {
            let input = &p["_meta"]["tool_params"];
            if !only(input, &["command"]) || fresh_command_required(s) {
                return None;
            }
            let mut context = p.clone();
            context["_meta"]["tool_params"] = json!({});
            (context, "Any classifiable command relayed for this project. Protected Git operations require separate review.")
        }
        _ => return None,
    };
    Some((json!({"root":root,"category":category,"context":context}), description))
}

pub(crate) fn claude_mcp_tool(tool: &str) -> bool {
    tool.strip_prefix("mcp__")
        .and_then(|name| name.split_once("__"))
        .is_some_and(|(server, name)| !server.is_empty() && server != "deck-session"
            && !name.is_empty() && tool.len() <= 128
            && tool.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b)))
}

fn claude_mcp_bounds(s: &PermissionScope) -> Option<&str> {
    let tool = s.material["request"]["toolName"].as_str()?;
    (s.material["category"] == "relay"
        && s.actor["assignment"]["runnerId"] == crate::claude::RUNNER
        && claude_mcp_tool(tool))
        .then_some(tool)
}

pub(crate) fn options(d: &Decision, s: &PermissionScope) -> Vec<PermissionScopeOption> {
    let mut out = Vec::new();
    match s.material["category"].as_str() {
        Some("files") => {
            if let Some(f) = files(d, s) {
                let description = format!(
                    "Operations: {}. Files: {}. Both move endpoints must fit; patch contents may vary.",
                    f.operations.join(", "),
                    f.endpoints.join(", ")
                );
                out.push(option(
                    s,
                    "file_set",
                    "These files and operations",
                    description,
                    json!({"paths":f.endpoints,"operations":f.operations,"context":f.context}),
                ));
                let parents: Vec<_> = f
                    .endpoints
                    .iter()
                    .filter_map(|p| Path::new(p).parent())
                    .collect();
                if let Some(parent) = parents
                    .first()
                    .filter(|p| parents.iter().all(|other| other == *p))
                {
                    out.push(option(s,"folder","This folder and operations",format!("Operations: {} under {} recursively, including both move endpoints. Other operations need consent.",f.operations.join(", "),parent.display()),json!({"folder":parent,"operations":f.operations,"context":f.context})));
                }
            }
        }
        Some("command") => {
            if let Some(bounds) = command_bounds(s) {
                out.push(option(s,"argv_prefix","Cargo tests in this directory",format!("cargo test in {}. Test filters, package/test targets and supported test flags may vary. Runs project test code; environment, execution kind, network and extra permissions stay exact. No shell syntax, wrappers, configuration or manifest overrides.",bounds["cwd"].as_str().unwrap_or("")),bounds));
            }
        }
        Some("permissions") => {
            if let Some(bounds) = profile(s) {
                out.push(option(s,"capability_subset","These capabilities or fewer",format!("Network access: {}. Read paths: {}. Write paths: {}. Paths or descendants may be requested; read never authorizes write. Execution environment stays exact.",bounds["network"],bounds["read"],bounds["write"]),bounds));
            }
        }
        Some("claude_workspace_read") => {
            if let Some((kind, bounds)) = workspace_tool(s) {
                let root = bounds["root"].as_str().unwrap_or_default();
                let tool = s.material["tool"].as_str().unwrap_or_default();
                out.push(option(
                    s,
                    kind,
                    "Any",
                    if kind == "workspace_grep" {
                        format!("Claude Grep with any pattern and permitted target under {root}. Other search options stay the same.")
                    } else {
                        format!("Claude {tool} with any file or pattern under {root}. Other options stay the same.")
                    },
                    bounds,
                ));
            }
        }
        Some("relay") => {
            if let Some(tool) = claude_mcp_bounds(s) {
                out.push(option(
                    s,
                    "mcp_tool_any",
                    "Any for this tool",
                    format!("Allow {tool} with any arguments in this session."),
                    json!({"tool":tool}),
                ));
            }
            for (kind, bounds) in bash_bounds(s) {
                let root = bounds["root"].as_str().unwrap_or_default();
                if kind == "bash_any" {
                    out.push(option(s, kind, "Any", format!("Any Claude Bash command in {root}. Commands that visibly discard or rewrite Git work still require separate review."), bounds));
                } else if kind == "bash_command" {
                    out.push(option(s, kind, "This command, any timeout", format!("Claude Bash running exactly this command in {root}. Only the timeout may vary."), bounds));
                } else {
                    let prefix = bounds["prefix"].as_array().map(|p| p.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default();
                    out.push(option(s, kind, "Same command family", format!("Claude Bash `{prefix}` in {root} with other plain arguments. No shell syntax, config or path overrides; timeout may vary."), bounds));
                }
            }
        }
        _ => {}
    }
    if let Some((bounds, description)) = project_any(d, s) {
        out.push(option(s, "project_any", "Any", description.into(), bounds));
    }
    // Never hide scope bounds through display truncation/redaction. Such requests
    // keep their exact option and ordinary action review, without broader choices.
    out.retain(|o| o.description.len() <= 3000
        && (o.kind == "mcp_tool_any" || display_safe(&o.description)));
    out
}
fn display_safe(s: &str) -> bool {
    !s.chars()
        .any(|c| c.is_control() || matches!(c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}'))
        && !crate::execution_view::sensitive_text(s)
}
fn subset(wanted: &Value, allowed: &Value) -> bool {
    wanted.as_array().is_some_and(|w| {
        allowed.as_array().is_some_and(|a| {
            w.iter().all(|p| {
                p.as_str().is_some_and(|p| {
                    a.iter()
                        .any(|r| r.as_str().is_some_and(|r| Path::new(p).starts_with(r)))
                })
            })
        })
    })
}
/// Reconstruct the offered option from original material before containment.
/// This also re-resolves file symlinks at the final release boundary.
pub(crate) fn contains(
    source: &Decision,
    recorded: &PermissionScope,
    reconstructed: &PermissionScope,
    wanted: &Decision,
    scope: &PermissionScope,
) -> bool {
    let Some(id) = &recorded.selected_option else {
        return false;
    };
    let Some(offered) = recorded.options.iter().find(|o| &o.id == id) else {
        return false;
    };
    if !options(source, reconstructed).contains(offered) {
        return false;
    }
    let b = &offered.bounds;
    match offered.kind.as_str() {
        "file_set" | "folder" => files(wanted, scope).is_some_and(|f| {
            f.context == b["context"]
                && f.operations.iter().all(|op| {
                    b["operations"]
                        .as_array()
                        .is_some_and(|a| a.contains(&json!(op)))
                })
                && f.endpoints.iter().all(|p| {
                    if offered.kind == "folder" {
                        b["folder"]
                            .as_str()
                            .is_some_and(|folder| Path::new(p).starts_with(folder))
                    } else {
                        b["paths"].as_array().is_some_and(|a| a.contains(&json!(p)))
                    }
                })
        }),
        "argv_prefix" => command_bounds(scope).as_ref() == Some(b),
        "project_any" => project_any(wanted, scope).is_some_and(|(bounds, _)| &bounds == b),
        "workspace_grep" | "workspace_read" => {
            workspace_tool(scope).is_some_and(|(kind, bounds)| kind == offered.kind && &bounds == b)
        }
        "mcp_tool_any" => claude_mcp_bounds(scope) == b["tool"].as_str(),
        "bash_command" | "bash_prefix" | "bash_any" => bash_bounds(scope)
            .iter()
            .any(|(kind, bounds)| *kind == offered.kind && bounds == b),
        "capability_subset" => profile(scope).is_some_and(|p| {
            p["context"] == b["context"]
                && (p["network"] != true || b["network"] == true)
                && subset(&p["read"], &b["read"])
                && subset(&p["write"], &b["write"])
        }),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scope(tool: &str, input: Value, target: &str) -> PermissionScope {
        PermissionScope {
            options: vec![],
            selected_option: None,
            version: 1,
            actor: json!({"project":{"root":"/work"},"role":"lead"}),
            issuer: json!({}),
            material: json!({"category":"claude_workspace_read","tool":tool,"input":input,"target":{"path":target}}),
            option_id: String::new(),
        }
    }
    // Oracle: "Any" varies only the tool's own pattern/target fields, never another
    // option, tool or the workspace boundary. Fails if one grant crosses tools.
    #[test]
    fn any_varies_only_the_tools_own_target_within_the_workspace() {
        let read = |p: &str, extra: Value| {
            let mut i = json!({"file_path":p});
            i["limit"] = extra;
            workspace_tool(&scope("Read", i, p)).unwrap()
        };
        assert_eq!(read("/work/a", json!(10)), read("/work/b", json!(10)));
        assert_eq!(read("/work/a", json!(10)), read("/work/a", json!(11)));
        let glob = |pat: &str, path: &str| {
            workspace_tool(&scope("Glob", json!({"pattern":pat,"path":path}), path)).unwrap()
        };
        assert_eq!(glob("*.rs", "/work/x"), glob("*.ts", "/work/y"));
        let grep = |pat: &str, mode: &str| {
            workspace_tool(&scope("Grep", json!({"pattern":pat,"output_mode":mode}), "/work")).unwrap()
        };
        assert_eq!(grep("a", "content").0, "workspace_grep");
        assert_eq!(grep("a", "content"), grep("b", "content"));
        assert_eq!(grep("a", "content"), grep("a", "count"));
        let allow_large = |v: bool| workspace_tool(&scope("Read", json!({"file_path":"/work/a","allow_large":v}), "/work/a")).unwrap();
        assert_ne!(allow_large(true).1, allow_large(false).1);
        // A Read grant is not a Glob grant, even with identical remaining inputs.
        assert_ne!(read("/work/a", json!(1)).1["tool"], glob("*", "/work").1["tool"]);
        assert!(workspace_tool(&scope("Read", json!({"file_path":"/etc/p"}), "/etc/p")).is_none());
        assert!(workspace_tool(&scope("Edit", json!({}), "/work/a")).is_none());
    }

    fn bash(command: &str) -> PermissionScope {
        let mut s = scope("Bash", json!({}), "/work");
        s.material = json!({"category":"relay","request":{"toolName":"Bash","_meta":{"tool_params":{"command":command,"timeout":5}}}});
        s
    }
    #[test]
    fn bash_any_is_reconstructed_for_each_command_in_the_project() {
        let root = std::env::current_dir().unwrap();
        let bounds = |command: &str| {
            let mut scope = bash(command);
            scope.actor["project"]["root"] = json!(root);
            bash_bounds(&scope)
        };
        let any = |command: &str| bounds(command).into_iter().find(|(kind, _)| *kind == "bash_any");
        let grant = any("echo ready").expect("offer Any for a plain command");
        // Any Bash use (user decision): commands the classifier cannot auto-allow
        // still offer Any, and only Any; visible protected Git never does.
        for command in ["cargo test && rm -rf /", "printf -v PATH '%s' tools; git status",
            "ionice -c3 rm -rf src", "cd / && git status", "cd .. && echo ready",
            "sed -i s/a/b/ f", "find . -delete", "awk '{print}' f", "rtk rm -rf src",
            "python3 -c 'print(1)'", "echo ready >> notes.md", "cat > f <<'EOF'\nbody\nEOF"] {
            assert_eq!(bounds(command), vec![grant.clone()], "{command}");
        }
        for command in ["git status", "printf done", "(git status && echo ready) | cat",
            "cat <<EOF\ntask-disk-image\nEOF", "git branch --list", "rtk git tag --list", "git stash list"] {
            assert_eq!(any(command), Some(grant.clone()), "{command}");
        }
        for command in ["git reset --hard", "git checkout -- f", "git clean -fd",
            "git stash drop", "echo ready; git stash pop", "(git status || git tag -d x)",
            "cat <<EOF\n$(git reset --hard)\nEOF",
            "cat <<'EOF'\n$(git reset --hard)\nEOF", "git branch -D x",
            "git tag --list 'git stash pop'", "git stash clear",
            // Wrappers that launch another program must not smuggle protected Git.
            "setsid git reset --hard", "stdbuf -o0 git clean -fd", "watch git stash drop",
            "flock /tmp/l git checkout -- f", "rtk git reset --hard",
            "python3 -c 'import os; os.system(\"git reset --hard\")'", "/usr/bin/git push -f",
            "g=git; $g rebase main", "git commit --amend -m x"] {
            assert!(bounds(command).is_empty(), "{command}");
        }
        // The automatic path stays narrow: these are neither auto-allowed nor
        // given exact or family scopes.
        for command in ["sed -n 1e/bin/sh f", "sed s/a/b/w/tmp/x f", "find . -execdir sh -c x ;",
            "find . -fprint /tmp/x", "cargo test && rm -rf /"] {
            assert!(!bash_reusable(command, &root, &root), "{command}");
        }
        for command in ["sed -n 1,80p src/a.rs", "sed -n '120,$p' f", "find . -name '*.rs'",
            "find src -type f -newer Cargo.toml", "rtk git status", "rtk cargo test -p deck2"] {
            assert_eq!(any(command), Some(grant.clone()), "{command}");
        }
        // Changing into a project directory keeps the command classifiable.
        assert_eq!(any("cd src && git status"), Some(grant.clone()));
        assert_eq!(any("cd . && echo ready"), Some(grant.clone()));
        let family = |command: &str| bounds(command).into_iter().find(|(kind, _)| *kind == "bash_prefix");
        assert_eq!(family("git -C . git-status"), None);
        assert_eq!(family("git -C . status"), family("git status"));
        assert!(family("git status").is_some());
        assert_eq!(bounds("git -C / status"), vec![grant.clone()]);
    }

    // Oracle: only plain family commands get a prefix; protected Git and shell
    // syntax never widen. Fails if a destructive or chained command is offered reuse.
    #[test]
    fn bash_reuse_is_bounded_to_plain_families_and_unprotected_commands() {
        let kinds = |c: &str| bash_bounds(&bash(c)).into_iter().map(|b| b.0).filter(|kind| *kind != "bash_any").collect::<Vec<_>>();
        assert_eq!(kinds("cargo test -p x foo"), ["bash_command", "bash_prefix"]);
        assert_eq!(bash_bounds(&bash("cargo test a")).into_iter().find(|b| b.0 == "bash_prefix"), bash_bounds(&bash("cargo test b --lib")).into_iter().find(|b| b.0 == "bash_prefix"));
        assert!(kinds("cargo test && rm -rf /").is_empty());
        assert!(kinds("echo $(id)").is_empty());
        assert_eq!(kinds("git commit -m"), ["bash_command"]);
        assert_eq!(kinds("git add src/a.rs"), ["bash_command"]);
        assert_eq!(kinds("git branch"), ["bash_command"]);
        assert!(kinds("git branch -D x").is_empty());
        assert!(kinds("git -c core.pager=x status").is_empty());
        assert_eq!(kinds("cargo test --config x=y"), ["bash_command"]);
        assert!(kinds("git diff --output=x").is_empty());
        assert_eq!(kinds("npm publish"), ["bash_command"]);
        for c in ["git reset --hard", "git clean -fd", "git stash drop", "git restore f", "git checkout -- f"] {
            assert!(kinds(c).is_empty(), "{c}");
        }
    }
}
