use std::path::{Component, Path, PathBuf};

use deck2_shared::{
    Decision, DecisionResponse, DecisionState, NativeApproval, NativeTransport, Phase,
    ProjectBinding, Receipt,
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{Store, server::App};

pub(crate) const METHOD: &str = "session/request_permission";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ToolIdentity {
    Session,
    External,
    Native,
}

pub(super) enum Permission {
    Deny,
    Allow,
    Review(String),
}

pub(super) fn outcome(options: &Value, allow: bool) -> Value {
    let kind = if allow { "allow_once" } else { "reject_once" };
    let options = options.as_array().map(Vec::as_slice).unwrap_or_default();
    // Select an option only when its ID is unique in this request; a shared
    // ID could make a denial read as approval, so answer with `cancelled`.
    match options
        .iter()
        .find(|option| option["kind"] == kind)
        .and_then(|option| {
            option["optionId"]
                .as_str()
                .filter(|id| crate::agy::valid_id(id, 128))
        })
        .filter(|id| {
            options
                .iter()
                .filter(|option| option["optionId"] == *id)
                .count()
                == 1
        }) {
        Some(id) => json!({"outcome":{"outcome":"selected","optionId":id}}),
        None => json!({"outcome":{"outcome":"cancelled"}}),
    }
}

// Agy reports native write_file with Path in rawInput and repeats it in
// locations and diff content. Require all supplied path evidence to agree so
// a benign location cannot mask a different target.
fn workspace_write(tool: &Value, project: &ProjectBinding) -> bool {
    let name = tool["name"].as_str().unwrap_or_default();
    let write = match name {
        "write_file" => "Write",
        "replace_file_content" | "multi_replace_file_content" | "replace" => "Edit",
        _ => return false,
    };
    let paths = |input: &Value| -> Vec<String> {
        ["Path", "TargetFile", "path", "file_path"]
            .iter()
            .filter_map(|key| input.get(key))
            .map(|path| path.as_str().unwrap_or_default().to_owned())
            .collect()
    };
    let mut targets = paths(&tool["rawInput"]);
    if targets.is_empty() {
        return false;
    }
    targets.extend(paths(&tool["args"]));
    for key in ["locations", "content"] {
        targets.extend(
            tool[key]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|item| key == "locations" || item["type"] == "diff")
                .map(|item| item["path"].as_str().unwrap_or_default().to_owned()),
        );
    }
    let root = Path::new(&project.root);
    let target = root.join(&targets[0]);
    targets.iter().all(|path| {
        !path.is_empty()
            && !path.chars().any(char::is_control)
            && root.join(path) == target
            && crate::claude::approval::workspace_write_target(
                &json!({"tool":write,"file_path":path}),
                project,
            )
    })
}

pub(super) fn member_workspace_permission(
    tool: &Value,
    project: &ProjectBinding,
    can_write: bool,
) -> bool {
    let kind = tool["kind"].as_str().unwrap_or_default();
    if kind == "edit" {
        return can_write && workspace_write(tool, project);
    }
    let name = tool["name"].as_str();
    let read_file = kind == "read" && matches!(name, Some("view_file" | "read_file"));
    let list = kind == "read" && matches!(name, Some("list_directory" | "list_dir"));
    let search = kind == "search"
        && matches!(
            name,
            Some("grep_search" | "find_by_name" | "glob" | "search_files")
        );
    if !read_file && !list && !search {
        return false;
    }
    let raw = tool.get("rawInput").or_else(|| tool.get("args"));
    let Some(fields) = raw.and_then(|raw| review_fields(kind, raw)) else {
        return false;
    };
    if tool.get("args").is_some_and(|args| {
        review_fields(kind, args).is_none_or(|args| {
            args.iter()
                .any(|(key, value)| fields.get(key) != Some(value))
        })
    }) {
        return false;
    }
    let root = Path::new(&project.root);
    let inside = |path: &str| {
        displayable_path(path, Some(root)).is_some()
            && root.join(path).canonicalize().is_ok_and(|target| {
                target.starts_with(root)
                    && if read_file {
                        target.is_file()
                    } else {
                        target.is_dir()
                    }
            })
    };
    let paths = fields.iter().filter(|(key, _)| {
        matches!(
            key.as_str(),
            "Path"
                | "path"
                | "AbsolutePath"
                | "SearchPath"
                | "DirectoryPath"
                | "TargetFile"
                | "file_path"
        )
    });
    (!read_file || paths.clone().next().is_some())
        && paths
            .into_iter()
            .all(|(_, path)| path.as_str().is_some_and(inside))
        && tool["locations"]
            .as_array()
            .into_iter()
            .flatten()
            .all(|item| item["path"].as_str().is_some_and(inside))
        && fields
            .iter()
            .filter(|(key, _)| {
                matches!(key.as_str(), "Includes" | "Excludes")
                    || name == Some("find_by_name") && key.as_str() == "Pattern"
            })
            .flat_map(|(_, value)| {
                value
                    .as_array()
                    .map(Vec::as_slice)
                    .unwrap_or(std::slice::from_ref(value))
            })
            .all(|pattern| {
                pattern.as_str().is_some_and(|value| {
                    !value.contains(['/', '\\', ':', '{', '}']) && value != ".."
                })
            })
}

fn shell_command(input: &Value) -> Option<&str> {
    input["CommandLine"]
        .as_str()
        .or_else(|| input["command"].as_str())
}

const HIDDEN_PATH: &str = "[path outside project or not displayable]";
const HIDDEN_PATTERNS: &str = "[patterns hidden]";
const REVIEW_INPUT_LIMIT: usize = 3500;

fn review_tool_name(name: &str) -> bool {
    crate::agy::valid_id(name, 128) && !name.starts_with("mcp_") && !name.contains([':', '/'])
}

fn safe_review_text(text: &str, multiline: bool) -> bool {
    !text.is_empty()
        && text.len() <= REVIEW_INPUT_LIMIT
        && !text.chars().any(|ch| {
            ch.is_control() && !(multiline && matches!(ch, '\t' | '\n' | '\r'))
                || matches!(ch, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
        && !crate::execution_view::sensitive_bash(text)
}

fn displayable_path(text: &str, root: Option<&Path>) -> Option<PathBuf> {
    if text.contains(['%', ':', '@', '\\'])
        || text.trim_start().starts_with("//")
        || !safe_review_text(text, false)
    {
        return None;
    }
    let mut normalized = PathBuf::new();
    for part in Path::new(text).components() {
        match part {
            Component::RootDir | Component::Normal(_) => normalized.push(part.as_os_str()),
            Component::CurDir => {}
            // A parent component can resolve differently through a symlink.
            Component::Prefix(_) | Component::ParentDir => return None,
        }
    }
    if normalized.is_absolute()
        && !root.is_some_and(|root| root.is_absolute() && normalized.starts_with(root))
    {
        return None;
    }
    if normalized.as_os_str().is_empty() {
        normalized.push(".");
    }
    Some(normalized)
}

fn hidden_query(text: &str) -> Value {
    json!(format!(
        "[query hidden] ({} characters)",
        text.chars().count()
    ))
}

fn token_shaped(text: &str) -> bool {
    let base64url = |ch: char| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_');
    text.split(|ch| !base64url(ch) && !matches!(ch, '+' | '/'))
        .any(|run| run.len() >= 24)
        || text.split(|ch| !base64url(ch) && ch != '.').any(|run| {
            // A compact JWT typically starts with a base64url-encoded JSON object.
            let mut segments = run.trim_matches('.').split('.');
            matches!(
                (segments.next(), segments.next(), segments.next(), segments.next()),
                (Some(header), Some(payload), Some(signature), None)
                    if (header.starts_with("ey") || header.starts_with("ew"))
                        && header.len() >= 4
                        && !payload.is_empty()
                        && !signature.is_empty()
            )
        })
}

fn review_query(text: &str, bearer: Option<&str>) -> Value {
    if text.chars().count() <= 200
        && text
            .chars()
            .all(|ch| ch.is_alphanumeric() || " _-.*?[]()|^$+{},\\".contains(ch))
        && safe_review_text(text, false)
        && !bearer.is_some_and(|bearer| text.contains(bearer))
        && !token_shaped(text)
    {
        json!(text)
    } else {
        hidden_query(text)
    }
}

fn review_path(text: &str, root: Option<&Path>, bearer: Option<&str>) -> Value {
    if bearer.is_some_and(|bearer| text.contains(bearer)) || text.split('/').any(token_shaped) {
        return json!(HIDDEN_PATH);
    }
    match displayable_path(text, root) {
        Some(path) => json!(path),
        None => json!(HIDDEN_PATH),
    }
}

fn project_read_search(input: &mut Value, root: Option<&Path>, bearer: Option<&str>) {
    let raw = input.take();
    let fields = raw.as_object().expect("review fields validated");
    let project = |hide_details| {
        Value::Object(
            fields
                .iter()
                .map(|(field, value)| {
                    let projected = match (field.as_str(), value) {
                        ("Includes" | "Excludes", Value::Array(items)) => {
                            if hide_details || items.len() > 32 {
                                json!([HIDDEN_PATTERNS])
                            } else {
                                Value::Array(
                                    items
                                        .iter()
                                        .map(|item| {
                                            let text =
                                                item.as_str().expect("review list item validated");
                                            if text.contains(['/', '\\'])
                                                && !text.contains(['*', '?', '[', ']', '{', '}'])
                                            {
                                                review_path(text, root, bearer)
                                            } else {
                                                review_query(text, bearer)
                                            }
                                        })
                                        .collect(),
                                )
                            }
                        }
                        ("Query" | "query" | "Pattern" | "pattern", Value::String(text)) => {
                            if hide_details {
                                hidden_query(text)
                            } else {
                                review_query(text, bearer)
                            }
                        }
                        (_, Value::String(_)) if hide_details => json!(HIDDEN_PATH),
                        (_, Value::String(text)) => review_path(text, root, bearer),
                        _ => value.clone(),
                    };
                    (field.clone(), projected)
                })
                .collect(),
        )
    };
    *input = project(false);
    if input.to_string().len() > REVIEW_INPUT_LIMIT {
        *input = project(true);
    }
}

fn fetch_origin(url: &reqwest::Url) -> Option<String> {
    (matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
        .then(|| format!("{}/…", url.origin().ascii_serialization()))
}

fn review_fields(kind: &str, input: &Value) -> Option<serde_json::Map<String, Value>> {
    let mut fields = serde_json::Map::new();
    let read_search = matches!(kind, "read" | "search");
    for (key, value) in input.as_object()? {
        let field = match (kind, key.as_str()) {
            ("execute", "CommandLine" | "command") => "CommandLine",
            ("execute", "Cwd" | "cwd") => "Cwd",
            ("execute", "WaitMsBeforeAsync" | "SafeToAutoRun") => key,
            ("fetch", "Url" | "url" | "URL") => "Url",
            (
                "read" | "search",
                "Path" | "path" | "AbsolutePath" | "SearchPath" | "DirectoryPath" | "TargetFile"
                | "file_path",
            )
            | (
                "search",
                "Query" | "query" | "Pattern" | "pattern" | "Includes" | "Excludes"
                | "CaseInsensitive" | "MatchPerLine" | "IsRegex" | "FindingsLimit",
            )
            | ("read", "StartLine" | "EndLine" | "Offset" | "Limit") => key,
            _ => return None,
        };
        let safe_text = |text: &str| read_search || safe_review_text(text, field == "CommandLine");
        let allowed = match field {
            "Url" => value.as_str().is_some_and(|text| {
                safe_text(text)
                    && (text.starts_with("https://") || text.starts_with("http://"))
                    && !text.contains(['?', '#', '\\', '@'])
            }),
            "Includes" | "Excludes" => value.as_array().is_some_and(|items| {
                items
                    .iter()
                    .all(|item| item.as_str().is_some_and(safe_text))
            }),
            "CaseInsensitive" | "MatchPerLine" | "IsRegex" | "SafeToAutoRun" => value.is_boolean(),
            "StartLine" | "EndLine" | "Offset" | "Limit" | "FindingsLimit"
            | "WaitMsBeforeAsync" => value.as_u64().is_some(),
            _ => value.as_str().is_some_and(safe_text),
        };
        if !allowed || fields.insert(field.to_owned(), value.clone()).is_some() {
            return None;
        }
    }
    Some(fields)
}

fn review_input(tool: &Value, project: &ProjectBinding, bearer: Option<&str>) -> Option<Value> {
    let name = tool["name"]
        .as_str()
        .filter(|name| review_tool_name(name))?;
    let kind = tool["kind"].as_str()?;
    let raw = tool.get("rawInput");
    let args = tool.get("args");
    let input = review_fields(kind, raw.or(args)?)?;
    if !input.values().any(Value::is_string) {
        return None;
    }
    if let Some(args) = args.filter(|_| raw.is_some())
        && review_fields(kind, args)?
            .iter()
            .any(|(key, value)| input.get(key) != Some(value))
    {
        return None;
    }
    let mut input = Value::Object(input);
    if !matches!(kind, "read" | "search") && input.to_string().len() > REVIEW_INPUT_LIMIT {
        return None;
    }
    match kind {
        "execute" if matches!(name, "run_command" | "run_shell_command") => {
            let command = shell_command(&input)?;
            if bearer.is_some_and(|bearer| command.contains(bearer)) {
                return None;
            }
        }
        "fetch" => {
            let url = reqwest::Url::parse(input["Url"].as_str()?).ok()?;
            if !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return None;
            }
            // Any path segment can carry a credential. Keep only the origin
            // for review, after checking the unredacted argument copies agree.
            input["Url"] = json!(fetch_origin(&url)?);
        }
        "read" | "search" => {
            project_read_search(&mut input, Some(Path::new(&project.root)), bearer);
        }
        _ => return None,
    }
    Some(json!({"tool":name,"input":input,"kind":kind}))
}

pub(super) fn member_shell_args(
    tool: &Value,
    project: &ProjectBinding,
    item: &str,
    bearer: &str,
) -> Option<Value> {
    if tool["kind"] != "execute" {
        return None;
    }
    let args = review_input(tool, project, None)?;
    let input = &args["input"];
    if input
        .get("Cwd")
        .is_some_and(|cwd| cwd.as_str() != Some(&project.root))
    {
        return None;
    }
    let command = shell_command(input)?;
    if command.contains(bearer) || token_shaped(command) {
        return None;
    }
    Some(json!({"tool_name":"Bash","input":{"command":command},"tool_use_id":item}))
}

fn current(store: &Store, receipt: &Receipt, project: &ProjectBinding) -> Result<bool, String> {
    if receipt.phase != Phase::Running
        || receipt.cancel_requested
        || store.execution_project(&receipt.session)? != *project
    {
        return Ok(false);
    }
    let session = store.session_by_id(&receipt.session)?;
    Ok(receipt
        .configuration
        .as_ref()
        .and_then(|s| s.session_contract.as_ref())
        .zip(session.contract.as_ref())
        .is_some_and(|(admitted, current)| {
            admitted.generation == current.generation
                && admitted.revision == current.revision
                && admitted.grants_revoked_at == current.grants_revoked_at
                && admitted.lead_task == current.lead_task
                && admitted.members.get("lead") == current.members.get("lead")
        }))
}

pub(super) fn record(
    app: &App,
    root: &Receipt,
    project: &ProjectBinding,
    (request, item): (&str, &str),
    tool: &Value,
    tool_identity: ToolIdentity,
    bearer: Option<&str>,
) -> Result<Permission, String> {
    let mut store = app.store.lock().map_err(|_| "State lock failed")?;
    let mut receipt = store.get(&root.id)?.ok_or("Antigravity receipt missing")?;
    if !current(&store, &receipt, project)? {
        return Ok(Permission::Deny);
    }
    if tool_identity == ToolIdentity::Session {
        // The bridge authenticates and authorizes the actual MCP call.
        return Ok(Permission::Allow);
    }
    if !store.trusted_project(&project.root)? {
        return Ok(Permission::Deny);
    }
    if tool_identity == ToolIdentity::External {
        return Ok(Permission::Allow);
    }
    // A foreign MCP identity cannot inherit native YOLO authority.
    if tool["name"]
        .as_str()
        .is_some_and(|name| name.starts_with("mcp_"))
    {
        return Ok(Permission::Deny);
    }
    if crate::agy::lead_yolo(&receipt) || workspace_write(tool, project) {
        return Ok(Permission::Allow);
    }
    let Some(mut params) = review_input(tool, project, bearer) else {
        return Ok(Permission::Deny);
    };
    if crate::native_approval::at_capacity(&receipt) {
        return Ok(Permission::Deny);
    }
    let thread = receipt.thread.clone().ok_or("Antigravity thread missing")?;
    let turn = receipt.turn.clone().ok_or("Antigravity turn missing")?;
    params["identity"] = json!([thread, turn, item, request]);
    let id = Uuid::new_v4().to_string();
    let decision = Decision {
        id: id.clone(),
        native: Some(NativeApproval {
            transport: Some(NativeTransport::AgyAcp),
            method: METHOD.into(),
            summary: format!(
                "Antigravity requests {}",
                params["tool"].as_str().unwrap_or_default()
            ),
            parameters: params.to_string(),
            file_proposal: None,
            resolution_provenance: None,
            permission: None,
            identity: None,
            always_note: None,
        }),
        task: None,
        session: receipt.session.clone(),
        command: receipt.id.clone(),
        attempt: receipt.attempt.clone(),
        generation: receipt.generation.clone(),
        thread,
        turn,
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
        detail: "Review the Antigravity tool request.".into(),
    };
    validate(&decision)?;
    receipt.decisions.push(decision);
    store.save(&mut receipt)?;
    Ok(Permission::Review(id))
}

pub(crate) fn validate(decision: &Decision) -> Result<(), String> {
    let native = decision
        .native
        .as_ref()
        .ok_or("Antigravity approval missing")?;
    if native.method != METHOD
        || native.parameters.len() > 4600
        || native.permission.is_some()
        || native.identity.is_some()
        || native.file_proposal.is_some()
        || native.always_note.is_some()
        || decision.file.is_some()
        || !decision.questions.is_empty()
        || decision.task.is_some()
    {
        return Err("Invalid Antigravity approval".into());
    }
    let params: Value =
        serde_json::from_str(&native.parameters).map_err(|_| "Invalid Antigravity approval")?;
    if params["identity"]
        != json!([
            decision.thread,
            decision.turn,
            decision.item,
            decision.request
        ])
        || !params["tool"]
            .as_str()
            .is_some_and(|name| crate::agy::valid_id(name, 128))
        || !params["input"].is_object()
    {
        return Err("Antigravity approval identity mismatch".into());
    }
    Ok(())
}

pub(crate) fn action_view(
    native: &NativeApproval,
    project: Option<&ProjectBinding>,
) -> Option<(&'static str, Value)> {
    let params: Value = serde_json::from_str(&native.parameters).ok()?;
    let kind = params["kind"].as_str()?;
    let tool = params["tool"]
        .as_str()
        .filter(|name| review_tool_name(name))?;
    // Older envelopes can contain full URLs or extra fields. Project only the
    // fetch origin or the same allowlisted arguments used to record new reviews.
    let input = match kind {
        "fetch" => {
            let url = ["Url", "url", "URL"]
                .iter()
                .find_map(|key| params["input"][*key].as_str())?;
            json!({"Url":fetch_origin(&reqwest::Url::parse(url).ok()?)?})
        }
        "execute" | "read" | "search" => {
            let mut input = Value::Object(review_fields(kind, &params["input"])?);
            if matches!(kind, "read" | "search") {
                // Current and historical Deck bearers have the token shape
                // checked here. The public view needs no live credentials.
                project_read_search(
                    &mut input,
                    project.map(|binding| Path::new(&binding.root)),
                    None,
                );
            }
            input
        }
        _ => return None,
    };
    if kind == "execute" {
        let command = shell_command(&input)?;
        return Some((
            "bash",
            json!({
                "tool":tool,
                "command":crate::execution_view::bash_display(command),
                "input":crate::execution_view::bounded(&input, 0)
            }),
        ));
    }
    Some(("agy_tool_call", json!({"tool":tool,"input":input})))
}

pub(super) fn claim(
    store: &mut Store,
    receipt: &mut Receipt,
    project: &ProjectBinding,
    id: &str,
) -> Result<Option<bool>, String> {
    if !current(store, receipt, project)? || !store.trusted_project(&project.root)? {
        if invalidate(
            receipt,
            id,
            "Antigravity permission authority changed before release.",
        ) {
            store.save(receipt)?;
        }
        return Ok(Some(false));
    }
    let state = receipt
        .decisions
        .iter()
        .find(|d| d.id == id)
        .map(|d| &d.state);
    match state {
        Some(DecisionState::Invalidated) | None => return Ok(Some(false)),
        Some(DecisionState::Responded) => {}
        _ => return Ok(None),
    }
    Ok(store
        .authorize_response(&receipt.id, id, &receipt.generation)?
        .map(|d| {
            d.resolution
                .is_some_and(|r| r.response == DecisionResponse::AllowOnce)
        }))
}

pub(super) fn invalidate(receipt: &mut Receipt, id: &str, reason: &str) -> bool {
    if let Some(decision) = receipt.decisions.iter_mut().find(|d| {
        d.id == id && matches!(d.state, DecisionState::Pending | DecisionState::Responded)
    }) {
        decision.state = DecisionState::Invalidated;
        decision.detail = reason.into();
        return true;
    }
    false
}

pub(super) fn delivered(receipt: &mut Receipt, id: &str, allow: bool) {
    if let Some(decision) = receipt
        .decisions
        .iter_mut()
        .find(|d| d.id == id && d.state == DecisionState::Dispatching)
    {
        decision.state = DecisionState::Delivered;
        decision.delivered_ms = Some(crate::now());
        decision.grant_consumed = allow;
        decision.detail = "Response sent to Antigravity. Tool outcome is unconfirmed.".into();
    }
}

pub(super) fn settle(receipt: &mut Receipt) {
    crate::decisions::invalidate_native_attempt(
        receipt,
        "Antigravity stopped before permission release.",
    );
    for decision in &mut receipt.decisions {
        if decision.state == DecisionState::Dispatching {
            decision.state = DecisionState::Uncertain;
            decision.detail = "Antigravity stopped before response delivery was confirmed.".into();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agy_permission_outcome_cancels_ambiguous_option_ids() {
        // Protects ACP permission replies. Fails if a denial or approval is
        // sent with an option ID that the request also uses for another kind.
        let distinct = json!([
            {"optionId": "allow", "kind": "allow_once"},
            {"optionId": "deny", "kind": "reject_once"},
        ]);
        assert_eq!(
            outcome(&distinct, true),
            json!({"outcome":{"outcome":"selected","optionId":"allow"}})
        );
        assert_eq!(
            outcome(&distinct, false),
            json!({"outcome":{"outcome":"selected","optionId":"deny"}})
        );
        let shared = json!([
            {"optionId": "same", "kind": "allow_once"},
            {"optionId": "same", "kind": "reject_once"},
        ]);
        let cancelled = json!({"outcome":{"outcome":"cancelled"}});
        assert_eq!(outcome(&shared, false), cancelled);
        assert_eq!(outcome(&shared, true), cancelled);
        assert_eq!(outcome(&Value::Null, false), cancelled);
    }

    #[test]
    fn agy_review_rejects_fetch_credentials() {
        let review = |input: Value| {
            review_input(
                &json!({"name":"read_url_content","kind":"fetch","rawInput":input}),
                &ProjectBinding::default(),
                None,
            )
        };
        assert!(
            review(json!({"Url":"https://example.invalid/page",
            "Headers":{"X-Fake":"AGY_FIXTURE_PLANTED_VALUE"}}))
            .is_none()
        );
        assert!(review(json!({"Url":"https://example.invalid/page?opaque=hidden"})).is_none());
        assert!(review(json!({"Url":"https://account:hidden@example.invalid/page"})).is_none());
        assert!(review(json!({"Url":"https://example.invalid/page"})).is_some());
    }
    #[test]
    fn agy_read_and_search_review_projects_only_displayable_values() {
        // Protects read/search review and persistence. Fails if an unsafe
        // value is retained or if redaction prevents a Decision.
        let project = ProjectBinding {
            root: "/project".into(),
            ..Default::default()
        };
        let review = |kind, input| {
            review_input(
                &json!({"name":"fixture_search","kind":kind,"rawInput":input}),
                &project,
                None,
            )
            .map(|params| params["input"].clone())
        };

        let encoded = "https%3A%2F%2Fhost%2Ftoken";
        let read = review("read", json!({"Path":encoded})).expect("encoded path needs review");
        assert!(!read.to_string().contains(encoded));
        for path in [
            "HtTpS://host/private-path",
            "data:text/plain,private",
            "file:/private",
            "//host/private",
            "user:pass@host/private",
            "/project-other/private",
            "/project/../private",
            "../private",
        ] {
            let read = review("read", json!({"Path":path})).expect("redacted path needs review");
            assert!(!read.to_string().contains(path));
        }
        let search = review(
            "search",
            json!({
                "Path":"src//./lib.rs",
                "SearchPath":"/project/src//./lib.rs",
                "Query":"café (文字|42)",
                "Includes":["*.txt","src//lib.rs","src//*.rs",encoded],
            }),
        )
        .expect("project paths and queries need review");
        assert_eq!(search["Path"], "src/lib.rs");
        assert_eq!(search["SearchPath"], "/project/src/lib.rs");
        assert_eq!(search["Query"], "café (文字|42)");
        assert_eq!(search["Includes"][0], "*.txt");
        assert_eq!(search["Includes"][1], "src/lib.rs");
        assert!(!search.to_string().contains("src//*.rs"));
        assert!(!search.to_string().contains(encoded));

        for query in [
            encoded.to_owned(),
            "prefix HTTPS://host/private".into(),
            "data:private".into(),
            "//host/private".into(),
            "user@host".into(),
            "f".repeat(201),
        ] {
            let search = review("search", json!({"Query":query})).expect("query needs review");
            assert!(!search.to_string().contains(&query));
            assert!(
                search["Query"]
                    .as_str()
                    .unwrap()
                    .contains(&query.chars().count().to_string())
            );
        }
    }
}
