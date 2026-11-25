use std::{
    io::ErrorKind,
    os::unix::fs::MetadataExt,
    path::{Component, Path, PathBuf},
};

use deck2_shared::{
    Decision, DecisionResponse, DecisionState, NativeApproval, NativeTransport, Phase,
    ProjectBinding, Receipt,
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{Store, now};

pub(crate) const METHOD: &str = "claude/canUseTool";

fn reviewable(parameters: &Value) -> bool {
    let input = &parameters["input"];
    matches!(parameters["tool"].as_str(), Some("Read" | "Glob" | "Grep"))
        && input.as_object().is_some_and(|fields| {
            fields.iter().all(|(key, value)| {
                !key.is_empty()
                    && key
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
                    && (value.as_bool().is_some()
                        || value.as_number().is_some()
                        || value.as_str().is_some_and(|s| {
                            // Keep the exact effect visible in Deck's redacted action display.
                            let lower = s.to_ascii_lowercase();
                            !["api-key", "access-key", "access_key"]
                                .iter()
                                .any(|word| lower.contains(word))
                                && !s.contains("://")
                                && !(s.contains('=') && (s.contains('?') || s.contains('&')))
                        }))
            })
        })
        && input.to_string().len() <= 2500
        && crate::execution_view::bounded(input, 0) == *input
}

fn target_field(params: &Value) -> &'static str {
    if params["tool"] == "Read" {
        "file_path"
    } else {
        "path"
    }
}

fn project_target(params: &Value, project: &ProjectBinding) -> Option<PathBuf> {
    let input = &params["input"];
    let root = Path::new(&project.root);
    let read = params["tool"] == "Read";
    let field = target_field(params);
    let path = match input.get(field) {
        Some(path) => match path.as_str().filter(|p| !p.is_empty()) {
            Some(path) => root.join(path),
            None => return None,
        },
        None if !read => root.to_owned(),
        None => return None,
    };
    if params["tool"] == "Glob"
        && input["pattern"].as_str().is_none_or(|pattern| {
            // The search path sets the scope. Glob accepts relative patterns.
            Path::new(pattern).is_absolute()
                || pattern.contains(['{', '}', '\\'])
                || Path::new(pattern)
                    .components()
                    .any(|c| c == Component::ParentDir)
        })
    {
        return None;
    }
    let path = path.canonicalize().ok()?;
    (path.starts_with(root)
        && path
            .metadata()
            .is_ok_and(|m| m.is_file() || !read && m.is_dir()))
    .then_some(path)
}

fn target_identity(params: &Value, target: &Path) -> Option<String> {
    let keys: &[&str] = match params["tool"].as_str()? {
        "Read" => &["file_path", "offset", "limit", "pages", "allow_large"],
        "Glob" => &["path", "pattern"],
        "Grep" => &[
            "path",
            "pattern",
            "glob",
            "output_mode",
            "-A",
            "-B",
            "-C",
            "context",
            "-n",
            "-i",
            "-o",
            "type",
            "head_limit",
            "offset",
            "multiline",
        ],
        _ => return None,
    };
    if !params["input"]
        .as_object()?
        .keys()
        .all(|key| keys.contains(&key.as_str()))
        || (params["tool"] != "Read" && !params["input"]["pattern"].is_string())
    {
        return None;
    }
    let metadata = target.metadata().ok()?;
    if !(metadata.is_dir() || metadata.is_file() && metadata.nlink() == 1) {
        return None;
    }
    Some(
        json!({"path":target.to_str()?, "device":metadata.dev(), "inode":metadata.ino()})
            .to_string(),
    )
}

pub(crate) fn permission_material(d: &Decision) -> Option<Value> {
    let native = d.native.as_ref()?;
    let target: Value = serde_json::from_str(native.identity.as_ref()?).ok()?;
    if !target["path"]
        .as_str()
        .is_some_and(|path| Path::new(path).is_absolute())
        || !target["device"].is_u64()
        || !target["inode"].is_u64()
    {
        return None;
    }
    let params: Value = serde_json::from_str(&native.parameters).ok()?;
    Some(
        json!({"category":"claude_workspace_read", "tool":params["tool"], "input":params["input"], "target":target}),
    )
}

pub(super) fn workspace_read_permit(event: &Value, project: &ProjectBinding) -> Option<Value> {
    // Auto-allowed Grep patterns are passed to the tool without rendering a
    // review. Keep display checks on the other fields and on prompted requests.
    let mut display_check = event.clone();
    if event["tool"] == "Grep" {
        event["input"]["pattern"].as_str()?;
        if event["input"].to_string().len() > 2500 {
            return None;
        }
        display_check["input"]["pattern"] = json!("");
    }
    if !reviewable(&display_check) {
        return None;
    }
    let target = project_target(event, project)?;
    target_identity(event, &target)?;
    let mut input = event["input"].clone();
    input[target_field(event)] = json!(target.to_str()?);
    Some(json!({"input": input}))
}

pub(crate) fn workspace_write_target(event: &Value, project: &ProjectBinding) -> bool {
    let tool = event["tool"].as_str();
    if !matches!(tool, Some("Edit" | "Write")) {
        return false;
    }
    let Some(path) = event["file_path"]
        .as_str()
        .filter(|path| !path.is_empty() && path.len() <= 4096)
    else {
        return false;
    };
    let root = Path::new(&project.root);
    let path = root.join(path);
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    let mut components = relative.components().peekable();
    if components.peek().is_none() {
        return false;
    }
    let mut target = root.to_path_buf();
    // Walk without following symlinks, including existing ancestors of a new file.
    while let Some(component) = components.next() {
        let Component::Normal(name) = component else {
            return false;
        };
        if matches!(
            name.to_str(),
            None | Some(".git" | ".claude" | ".deck" | ".tools" | ".atl")
        ) {
            return false;
        }
        target.push(name);
        let last = components.peek().is_none();
        match target.symlink_metadata() {
            Ok(meta) if last && meta.is_file() && meta.nlink() == 1 => return true,
            Ok(meta) if !last && meta.is_dir() => continue,
            Err(error) if error.kind() == ErrorKind::NotFound && tool == Some("Write") => {
                if last {
                    return true;
                }
            }
            _ => return false,
        }
    }
    false
}

// Only used when validating persisted decisions from the reviewed-edit bridge.
const MAX_EDIT_TEXT: usize = 65536;

fn edit_text(text: &str) -> bool {
    text.len() <= MAX_EDIT_TEXT
        && !text.is_empty()
        && text.chars().all(|c| {
            matches!(c, '\n' | '\t')
                || !c.is_control()
                    && !matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
}

// Interpret only a single literal replacement. Reject ambiguous overlapping
// matches as well as conventional duplicate matches.
fn replacement(input: &Value, before: &str) -> Option<String> {
    if !input.as_object()?.keys().all(|key| {
        matches!(
            key.as_str(),
            "file_path" | "old_string" | "new_string" | "replace_all"
        )
    }) || input.get("replace_all").is_some_and(|value| value != false)
        || !edit_text(before)
    {
        return None;
    }
    let old = input["old_string"].as_str().filter(|old| !old.is_empty())?;
    let new = input["new_string"]
        .as_str()
        .filter(|new| new.is_empty() || edit_text(new))?;
    let start = before.find(old)?;
    if old == new || before[start + old.chars().next()?.len_utf8()..].contains(old) {
        return None;
    }
    let after = before.replacen(old, new, 1);
    edit_text(&after).then_some(after)
}

// Show only the changed span, using newline markers so a newline-only edit
// remains visible in the same review component as other native file changes.
fn proposal_diff(before: &str, after: &str) -> String {
    let before: Vec<_> = before.split_inclusive('\n').collect();
    let after: Vec<_> = after.split_inclusive('\n').collect();
    let start = before
        .iter()
        .zip(&after)
        .take_while(|(a, b)| a == b)
        .count();
    let suffix = before[start..]
        .iter()
        .rev()
        .zip(after[start..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let before = &before[start..before.len() - suffix];
    let after = &after[start..after.len() - suffix];
    let mut diff = format!(
        "@@ -{},{} +{},{} @@\n",
        start + usize::from(!before.is_empty()),
        before.len(),
        start + usize::from(!after.is_empty()),
        after.len()
    );
    for (prefix, lines) in [('-', before), ('+', after)] {
        for line in lines {
            diff.push(prefix);
            diff.push_str(line);
            if !line.ends_with('\n') {
                diff.push_str("\n\\ No newline at end of file\n");
            }
        }
    }
    diff
}

pub(super) enum Permission {
    Denied,
    Allowed(Value),
    Review(String),
}

pub(super) fn record(
    store: &mut Store,
    receipt: &mut Receipt,
    project: &ProjectBinding,
    event: &Value,
    request: &str,
) -> Result<Permission, String> {
    let Some(item) = tool_use_id(event) else {
        return Ok(Permission::Denied);
    };
    if !lead_permission_current(store, receipt)?
        || receipt
            .decisions
            .iter()
            .any(|d| d.item == item || d.request == request)
        || !project_current(store, receipt, project)?
    {
        return Ok(Permission::Denied);
    }
    let admitted = receipt
        .configuration
        .as_ref()
        .and_then(|c| c.session_contract.as_ref());
    let thread = receipt.thread.as_deref().ok_or("Claude thread missing")?;
    let turn = receipt
        .turn
        .as_deref()
        .ok_or("Claude approval turn missing")?;
    if admitted.is_some_and(|contract| contract.approvals == "relay")
        && let Some(permit) = workspace_read_permit(event, project)
    {
        return Ok(Permission::Allowed(permit));
    }
    if crate::native_approval::at_capacity(receipt) {
        return Ok(Permission::Denied);
    }
    let params = json!({
        "thread": thread, "turn": turn, "item": item, "request": request,
        "tool": event["tool"], "input": event["input"],
    });
    if !reviewable(&params) {
        return Ok(Permission::Denied);
    }
    let Some(target) = project_target(&params, project) else {
        return Ok(Permission::Denied);
    };
    let id = Uuid::new_v4().to_string();
    let mut decision = Decision {
        id: id.clone(),
        native: Some(NativeApproval {
            transport: Some(NativeTransport::ClaudeSdk),
            method: METHOD.into(),
            summary: format!("Claude Code requests {}", event["tool"].as_str().unwrap()),
            parameters: params.to_string(),
            file_proposal: None,
            resolution_provenance: None,
            permission: None,
            identity: target_identity(&params, &target),
            always_note: None,
        }),
        task: None,
        session: receipt.session.clone(),
        command: receipt.id.clone(),
        attempt: receipt.attempt.clone(),
        generation: receipt.generation.clone(),
        thread: thread.into(),
        turn: turn.into(),
        item: item.into(),
        request: request.into(),
        revision: 1,
        state: DecisionState::Pending,
        file: None,
        questions: vec![],
        resolution: None,
        dispatch_ms: None,
        delivered_ms: None,
        grant_consumed: false,
        detail: "Review the Claude Code tool request.".into(),
    };
    if !store.reuse_permission(&mut decision)? {
        store.bind_permission(&mut decision)?;
    }
    receipt.decisions.push(decision);
    store.save(receipt)?;
    Ok(Permission::Review(id))
}

pub(crate) fn validate(d: &Decision) -> Result<(), String> {
    let n = d.native.as_ref().ok_or("Claude approval missing")?;
    if n.method != METHOD
        || n.parameters.len()
            > if d.file.is_some() {
                4 * MAX_EDIT_TEXT + 4096
            } else {
                4096
            }
        || n.file_proposal.is_some()
        || (d.file.is_some() && (n.identity.is_some() || n.permission.is_some()))
        || d.task.is_some()
        || !d.questions.is_empty()
    {
        return Err("Invalid Claude approval".into());
    }
    let p: Value =
        serde_json::from_str(&n.parameters).map_err(|_| "Invalid Claude approval parameters")?;
    if p["thread"] != d.thread
        || p["turn"] != d.turn
        || p["item"] != d.item
        || p["request"] != d.request
        || Uuid::parse_str(&d.request).is_err()
    {
        return Err("Claude approval identity mismatch".into());
    }
    let valid = match &d.file {
        Some(file) => {
            p["tool"] == "Edit"
                && p["input"]["file_path"] == file.path
                && file.identity.is_some()
                && replacement(&p["input"], &file.before)
                    .is_some_and(|after| proposal_diff(&file.before, &after) == file.diff)
        }
        None => {
            reviewable(&p)
                && n.identity
                    .as_ref()
                    .is_none_or(|_| permission_material(d).is_some())
        }
    };
    if !valid {
        return Err("Invalid Claude tool proposal".into());
    }
    Ok(())
}

pub(crate) fn action_view(n: &NativeApproval) -> Option<(&'static str, Value)> {
    let p: Value = serde_json::from_str(&n.parameters).ok()?;
    Some((
        "claude_tool_call",
        json!({"tool": p["tool"], "input": p["input"]}),
    ))
}

pub(super) fn project_current(
    store: &Store,
    r: &Receipt,
    project: &ProjectBinding,
) -> Result<bool, String> {
    Ok(store.execution_project(&r.session)? == *project && store.trusted_project(&project.root)?)
}

pub(crate) fn lead_permission_current(store: &Store, receipt: &Receipt) -> Result<bool, String> {
    if receipt.phase != Phase::Running || receipt.cancel_requested {
        return Ok(false);
    }
    let session = store.session_by_id(&receipt.session)?;
    let admitted = receipt
        .configuration
        .as_ref()
        .and_then(|c| c.session_contract.as_ref());
    Ok(admitted
        .zip(session.contract.as_ref())
        .is_some_and(|(then, current)| {
            then.generation == current.generation
                && then.revision == current.revision
                && then.grants_revoked_at == current.grants_revoked_at
                && then.lead_task == current.lead_task
        }))
}

pub(super) fn lead_yolo_current(
    store: &Store,
    receipt: &Receipt,
    project: &ProjectBinding,
) -> Result<bool, String> {
    Ok(lead_permission_current(store, receipt)?
        && project_current(store, receipt, project)?
        && super::is_receipt(receipt)
        && receipt
            .configuration
            .as_ref()
            .and_then(|snapshot| snapshot.session_contract.as_ref())
            .is_some_and(|contract| contract.approvals == "yolo"))
}

pub(super) fn is_yolo_tool(event: &Value) -> bool {
    event["tool"].as_str().is_some_and(|tool| {
        matches!(tool, "Read" | "Glob" | "Grep" | "Edit" | "Write" | "Bash")
            || crate::permission_bounds::claude_mcp_tool(tool)
    })
}

pub(super) fn tool_use_id(event: &Value) -> Option<&str> {
    event["tool_use_id"].as_str().filter(|id| {
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    })
}

pub(super) fn release(d: &Decision, project: &ProjectBinding) -> Option<Value> {
    if !matches!(
        d.resolution.as_ref()?.response,
        DecisionResponse::AllowOnce | DecisionResponse::AllowSession
    ) {
        return None;
    }
    let native = d.native.as_ref()?;
    let params: Value = serde_json::from_str(&native.parameters).ok()?;
    if d.file.is_some() {
        // Old edit approvals remain readable but cannot authorize a new effect.
        return None;
    }
    let target = project_target(&params, project)?;
    if let Some(identity) = &native.identity
        && target_identity(&params, &target).as_ref() != Some(identity)
    {
        return None;
    }
    let mut input = params["input"].clone();
    let field = target_field(&params);
    if input.get(field).is_some() {
        // Pass the resolved target rather than making the SDK follow the reviewed alias again.
        input[field] = json!(target.to_str()?);
    }
    Some(json!({"input": input}))
}

pub(super) fn settle(r: &mut Receipt) {
    crate::decisions::invalidate_native_attempt(
        r,
        "Claude Code stopped before permission release.",
    );
    for d in &mut r.decisions {
        if d.state == DecisionState::Dispatching {
            d.state = DecisionState::Uncertain;
            d.detail = "Claude Code stopped before response delivery was confirmed.".into();
        }
    }
}

pub(super) fn invalidate(r: &mut Receipt, id: &str) {
    if let Some(d) = r.decisions.iter_mut().find(|d| {
        d.id == id && matches!(d.state, DecisionState::Pending | DecisionState::Responded)
    }) {
        d.state = DecisionState::Invalidated;
        d.detail = "Claude Code withdrew the permission request.".into();
    }
}

pub(super) fn delivered(r: &mut Receipt, id: &str, allowed: bool) {
    if let Some(d) = r
        .decisions
        .iter_mut()
        .find(|d| d.id == id && d.state == DecisionState::Dispatching)
    {
        d.state = DecisionState::Delivered;
        d.delivered_ms = Some(now());
        d.grant_consumed = allowed;
        d.detail = if !allowed
            && d.resolution.as_ref().is_some_and(|r| {
                matches!(
                    r.response,
                    DecisionResponse::AllowOnce | DecisionResponse::AllowSession
                )
            }) {
            "The target changed after review. Deck denied the native request."
        } else {
            "Response sent to the Claude SDK bridge. Tool outcome is unconfirmed."
        }
        .into();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacing_a_grep_target_changes_the_persisted_grant_identity() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("search");
        std::fs::create_dir(&target).unwrap();
        let request = json!({"tool":"Grep","input":{"path":target,"pattern":"Fixture"}});
        let original = target_identity(&request, &target).unwrap();

        std::fs::rename(&target, dir.path().join("original-search")).unwrap();
        std::fs::create_dir(&target).unwrap();

        assert_ne!(target_identity(&request, &target).unwrap(), original);
    }

    #[test]
    fn quality_regression_grep_url_literal_uses_canonical_project_path() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let project = ProjectBinding {
            id: "fixture".into(),
            root: root.to_str().unwrap().into(),
            identity: None,
        };
        let permit = workspace_read_permit(
            &json!({"tool":"Grep", "input":{"path":root, "pattern":"https://"}}),
            &project,
        ).unwrap();
        assert_eq!(permit["input"], json!({"path":root,"pattern":"https://"}));
    }
}
