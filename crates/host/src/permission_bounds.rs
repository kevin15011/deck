//! Bounded host policies. No arbitrary shell families or third-party tool projections.
use deck2_shared::{Decision, PermissionScope, PermissionScopeOption};
use serde_json::{Value, json};
use std::path::{Component, Path, PathBuf};

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
/// A Bash command that may be remembered for the session. Only plain words
/// qualify (no quoting, expansion, chaining, redirection or globs). Git needs a
/// recognised subcommand without global options; verbs that discard work
/// (reset, restore, clean, checkout, rebase, push, ...) and destructive forms of
/// stash/branch/tag never qualify and need fresh informed confirmation.
pub(crate) fn bash_reusable(command: &str) -> bool {
    if command.is_empty() || command.len() > 2000 || !plain_words(command) {
        return false;
    }
    let t: Vec<&str> = command.split_whitespace().collect();
    if t.first() != Some(&"git") {
        return true;
    }
    let Some(sub) = t.get(1) else { return false };
    let rest = &t[2..];
    let destructive_flag = |flags: &[&str]| rest.iter().any(|a| flags.contains(a) || a.starts_with("--force") || a.starts_with("--delete"));
    match *sub {
        "status" | "diff" | "log" | "show" | "add" | "commit" | "fetch" | "blame" | "ls-files"
        | "rev-parse" | "describe" => !destructive_flag(&["--amend"]) || *sub != "commit",
        "branch" => !destructive_flag(&["-d", "-D", "-m", "-M", "-f", "-c", "-C"]),
        "tag" => !destructive_flag(&["-d", "-f"]),
        "stash" => matches!(rest.first().copied(), None | Some("list") | Some("show") | Some("push")),
        _ => false,
    }
}
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
    let command = args.get("command")?.as_str()?;
    bash_reusable(command).then_some(command)
}
fn bash_prefix(command: &str) -> Option<[&'static str; 2]> {
    if !plain_words(command) {
        return None;
    }
    let t: Vec<&str> = command.split(' ').filter(|t| !t.is_empty()).collect();
    let family = BASH_FAMILIES.iter().find(|f| t.len() >= 2 && t[0] == f[0] && t[1] == f[1])?;
    if t.iter().skip(2).any(|a| {
        BASH_DENIED_FLAGS.iter().any(|f| a == f || a.starts_with(&format!("{f}=")))
            || a.starts_with("--config")
    }) {
        return None;
    }
    Some([family[0], family[1]])
}
fn bash_bounds(s: &PermissionScope) -> Vec<(&'static str, Value)> {
    let Some(command) = bash_command(s) else { return vec![] };
    let Some(root) = s.actor["project"]["root"].as_str() else { return vec![] };
    let mut out = vec![("bash_command", json!({"root":root,"command":command}))];
    if let Some(prefix) = bash_prefix(command) {
        out.push(("bash_prefix", json!({"root":root,"prefix":prefix})));
    }
    out
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
            for (kind, bounds) in bash_bounds(s) {
                let root = bounds["root"].as_str().unwrap_or_default();
                if kind == "bash_command" {
                    out.push(option(s, kind, "This command, any timeout", format!("Claude Bash running exactly this command in {root}. Only the timeout may vary."), bounds));
                } else {
                    let prefix = bounds["prefix"].as_array().map(|p| p.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default();
                    out.push(option(s, kind, "Same command family", format!("Claude Bash `{prefix}` in {root} with other plain arguments. No shell syntax, config or path overrides; timeout may vary."), bounds));
                }
            }
        }
        _ => {} // No third-party/relay effect registry is admitted by this product.
    }
    // Never hide scope bounds through display truncation/redaction. Such requests
    // keep their exact option and ordinary action review, without broader choices.
    out.retain(|o| o.description.len() <= 3000 && display_safe(&o.description));
    out
}
fn display_safe(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    !s.chars()
        .any(|c| c.is_control() || matches!(c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}'))
        && ![
            "bearer ",
            "basic ",
            "authorization",
            "token=",
            "token:",
            "api_key",
            "apikey",
            "password",
            "passwd",
            "secret",
            "sk-",
        ]
        .iter()
        .any(|p| lower.contains(p))
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
        "workspace_grep" | "workspace_read" => {
            workspace_tool(scope).is_some_and(|(kind, bounds)| kind == offered.kind && &bounds == b)
        }
        "bash_command" | "bash_prefix" => bash_bounds(scope)
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
    // Oracle: only plain family commands get a prefix; protected Git and shell
    // syntax never widen. Fails if a destructive or chained command is offered reuse.
    #[test]
    fn bash_reuse_is_bounded_to_plain_families_and_unprotected_commands() {
        let kinds = |c: &str| bash_bounds(&bash(c)).into_iter().map(|b| b.0).collect::<Vec<_>>();
        assert_eq!(kinds("cargo test -p x foo"), ["bash_command", "bash_prefix"]);
        assert_eq!(bash_bounds(&bash("cargo test a")).pop(), bash_bounds(&bash("cargo test b --lib")).pop());
        assert!(kinds("cargo test && rm -rf /").is_empty());
        assert!(kinds("echo $(id)").is_empty());
        assert_eq!(kinds("git commit -m"), ["bash_command"]);
        assert_eq!(kinds("git add src/a.rs"), ["bash_command"]);
        assert_eq!(kinds("git branch"), ["bash_command"]);
        assert!(kinds("git branch -D x").is_empty());
        assert!(kinds("git -c core.pager=x status").is_empty());
        assert_eq!(kinds("cargo test --config x=y"), ["bash_command"]);
        assert_eq!(kinds("git diff --output=x"), ["bash_command"]);
        assert_eq!(kinds("npm publish"), ["bash_command"]);
        for c in ["git reset --hard", "git clean -fd", "git stash drop", "git restore f", "git checkout -- f"] {
            assert!(kinds(c).is_empty(), "{c}");
        }
    }
}
