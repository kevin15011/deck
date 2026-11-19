//! OpenCode wire boundary for connected sessions. This does not authorize a
//! launch: the host must attest native configuration, persist the invocation,
//! and retain the process/MCP reservation through settlement before using it.
//! No credential discovery, native installation, or provider fallback lives here.
use deck2_shared::MemberAssignment;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    time::Duration,
};

const MAX_BODY: usize = 8 * 1024 * 1024;
const MAX_EVENT: usize = 256 * 1024;

fn token(s: &str, max: usize) -> bool {
    !s.is_empty() && s.trim() == s && s.len() <= max && !s.chars().any(char::is_control)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Model {
    pub provider: String,
    pub model: String,
    pub variants: Vec<String>,
}
impl Model {
    pub fn id(&self) -> String {
        format!("{}/{}", self.provider, self.model)
    }
}

/// Parse the native identifier + JSON sequence all-or-nothing. Membership and
/// variants come from native output, never a provider name or an auth file.
pub fn parse_models(mut source: &str) -> Result<Vec<Model>, String> {
    if source.len() > MAX_BODY {
        return Err("opencode-model-output-limit".into());
    }
    let mut models = BTreeMap::new();
    while !source.trim().is_empty() {
        source = source.trim_start();
        let (id, rest) = source
            .split_once('\n')
            .ok_or("opencode-model-output-invalid")?;
        let id = id.trim_end_matches('\r');
        let (provider, model) = id.split_once('/').ok_or("opencode-model-output-invalid")?;
        if !token(id, 512)
            || !token(provider, 512)
            || !token(model, 512)
            || models.contains_key(id)
            || models.len() >= 10000
        {
            return Err("opencode-model-output-invalid".into());
        }
        let rest = rest.trim_start();
        if !rest.starts_with('{') {
            return Err("opencode-model-output-invalid".into());
        }
        let mut stream = serde_json::Deserializer::from_str(rest).into_iter::<Value>();
        let value = stream
            .next()
            .ok_or("opencode-model-output-invalid")?
            .map_err(|_| "opencode-model-output-invalid")?;
        let bytes = stream.byte_offset();
        if bytes > MAX_EVENT || value["providerID"] != provider {
            return Err("opencode-model-output-invalid".into());
        }
        let variants = value["variants"]
            .as_object()
            .ok_or("opencode-model-variants-invalid")?;
        if variants.len() > 64 || variants.keys().any(|v| !token(v, 128)) {
            return Err("opencode-model-variants-invalid".into());
        }
        models.insert(
            id.to_owned(),
            Model {
                provider: provider.into(),
                model: model.into(),
                variants: variants.keys().cloned().collect(),
            },
        );
        source = &rest[bytes..];
    }
    Ok(models.into_values().collect())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Selection {
    pub provider: String,
    pub model: String,
    pub variant: Option<String>,
}
pub fn resolve(models: &[Model], assignment: &MemberAssignment) -> Result<Selection, String> {
    if assignment.runner_id != "opencode" {
        return Err("opencode-runner-mismatch".into());
    }
    let legacy = assignment.model_id.strip_prefix("opencode/");
    let matches = models
        .iter()
        .filter(|m| m.id() == assignment.model_id || legacy.is_some_and(|id| m.id() == id))
        .collect::<Vec<_>>();
    let [model] = matches.as_slice() else {
        return Err("opencode-model-unavailable-or-ambiguous".into());
    };
    let variant = assignment.thinking.as_deref().filter(|v| *v != "off");
    if variant.is_some_and(|v| !model.variants.iter().any(|a| a == v)) {
        return Err("opencode-variant-unavailable".into());
    }
    Ok(Selection {
        provider: model.provider.clone(),
        model: model.model.clone(),
        variant: variant.map(str::to_owned),
    })
}

/// A caller-created identity is durable before HTTP dispatch. Opaque native IDs
/// are path segments, never UUIDs and never arbitrary URL/path input.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Invocation {
    pub session: String,
    pub message: String,
    pub agent: String,
}
impl Invocation {
    fn validate(&self) -> Result<(), String> {
        if [&self.session, &self.message, &self.agent].iter().any(|s| {
            !token(s, 256)
                || !s
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        }) {
            return Err("opencode-invocation-invalid".into());
        }
        Ok(())
    }
    pub fn body(
        &self,
        selection: &Selection,
        system: &str,
        parts: Vec<Value>,
    ) -> Result<Value, String> {
        self.validate()?;
        if !token(&selection.provider, 512)
            || !token(&selection.model, 512)
            || system.len() > MAX_BODY
            || parts.is_empty()
        {
            return Err("opencode-input-invalid".into());
        }
        for p in &parts {
            match p["type"].as_str() {
                Some("text") if p["text"].is_string() => {}
                Some("file") => {
                    use base64::Engine;
                    let mime = p["mime"].as_str().ok_or("opencode-image-invalid")?;
                    let url = p["url"]
                        .as_str()
                        .filter(|s| s.len() <= 7 * 1024 * 1024)
                        .ok_or("opencode-image-invalid")?;
                    let encoded = url
                        .strip_prefix(&format!("data:{mime};base64,"))
                        .ok_or("opencode-image-invalid")?;
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(encoded)
                        .map_err(|_| "opencode-image-invalid")?;
                    if crate::images::validate(&bytes)?.mime != mime {
                        return Err("opencode-image-type-mismatch".into());
                    }
                }
                _ => return Err("opencode-input-invalid".into()),
            }
        }
        let mut body = json!({"messageID":self.message,"agent":self.agent,"system":system,"model":{"providerID":selection.provider,"modelID":selection.model},"parts":parts});
        if let Some(v) = &selection.variant {
            if !token(v, 128) || v == "off" {
                return Err("opencode-variant-invalid".into());
            }
            body["variant"] = json!(v);
        }
        if body.to_string().len() > MAX_BODY {
            return Err("opencode-input-limit".into());
        }
        Ok(body)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Failure {
    MissingSession,
    Http(u16),
    Transport,
    InvalidBody,
    BodyLimit,
    Uncorrelated,
    Native,
    AlreadyDispatched,
    Persistence,
}

/// Authenticated loopback only, with redirects and ambient proxies disabled.
/// This layer never retries a POST; a dispatch value is consumed on send.
pub struct Client {
    client: reqwest::Client,
    base: String,
    password: String,
}
impl Client {
    pub fn new(endpoint: std::net::SocketAddrV4, password: String) -> Result<Self, Failure> {
        if !endpoint.ip().is_loopback() || endpoint.port() == 0 || password.is_empty() {
            return Err(Failure::Transport);
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| Failure::Transport)?;
        Ok(Self {
            client,
            base: format!("http://{endpoint}"),
            password,
        })
    }
    async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, Failure> {
        let timeout = if method == reqwest::Method::POST && path.ends_with("/message") {
            None
        } else if method == reqwest::Method::GET {
            Some(Duration::from_secs(5))
        } else {
            Some(Duration::from_secs(600))
        };
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.base))
            .basic_auth("opencode", Some(&self.password));
        if let Some(timeout) = timeout {
            request = request.timeout(timeout);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let mut response = request.send().await.map_err(|_| Failure::Transport)?;
        if !response.status().is_success() {
            return Err(Failure::Http(response.status().as_u16()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Failure::Transport)? {
            if chunk.len() > MAX_BODY - bytes.len() {
                return Err(Failure::BodyLimit);
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| Failure::InvalidBody)
    }
    pub async fn lookup(&self, session: &str) -> Result<Value, Failure> {
        Invocation {
            session: session.into(),
            message: "validation".into(),
            agent: "validation".into(),
        }
        .validate()
        .map_err(|_| Failure::InvalidBody)?;
        let result = self
            .request(reqwest::Method::GET, &format!("/session/{session}"), None)
            .await;
        match result {
            Err(Failure::Http(404)) => Err(Failure::MissingSession),
            Ok(v) if v["id"] != session => Err(Failure::Uncorrelated),
            other => other,
        }
    }
}

/// One owned POST. Dispatch becomes irreversible before polling the HTTP future;
/// cancellation, a lost response or an uncertain acknowledgment cannot retry it.
pub struct Turn {
    invocation: Invocation,
    dispatched: bool,
    closed: bool,
    assistants: BTreeSet<String>,
    rejected: BTreeSet<String>,
    pending: Vec<Value>,
    pending_bytes: usize,
    seen_requests: BTreeSet<String>,
}
pub struct Dispatch {
    invocation: Invocation,
    body: Value,
}
impl Dispatch {
    /// Consuming dispatch prevents a retry even when its response is lost.
    pub async fn send(self, client: &Client) -> Result<Value, Failure> {
        client
            .request(
                reqwest::Method::POST,
                &format!("/session/{}/message", self.invocation.session),
                Some(self.body),
            )
            .await
    }
}
impl Turn {
    pub fn new(invocation: Invocation) -> Result<Self, String> {
        invocation.validate()?;
        Ok(Self {
            invocation,
            dispatched: false,
            closed: false,
            assistants: BTreeSet::new(),
            rejected: BTreeSet::new(),
            pending: vec![],
            pending_bytes: 0,
            seen_requests: BTreeSet::new(),
        })
    }
    pub fn close(&mut self) {
        self.closed = true;
        self.pending.clear();
        self.pending_bytes = 0;
    }
    pub fn claim(
        &mut self,
        selection: &Selection,
        system: &str,
        parts: Vec<Value>,
        persist: impl FnOnce(&Invocation) -> Result<(), String>,
    ) -> Result<Dispatch, Failure> {
        if self.closed || self.dispatched {
            return Err(Failure::AlreadyDispatched);
        }
        let body = self
            .invocation
            .body(selection, system, parts)
            .map_err(|_| Failure::InvalidBody)?;
        persist(&self.invocation).map_err(|_| Failure::Persistence)?;
        self.dispatched = true;
        Ok(Dispatch {
            invocation: self.invocation.clone(),
            body,
        })
    }
    fn owned_assistant(&self, info: &Value) -> bool {
        info["sessionID"] == self.invocation.session
            && info["parentID"] == self.invocation.message
            && info["role"] == "assistant"
            && info["id"].as_str().is_some_and(|s| {
                token(s, 256) && s != self.invocation.message && !self.rejected.contains(s)
            })
    }
    pub fn result(&mut self, result: &Value) -> Result<String, Failure> {
        if self.closed || !self.dispatched {
            return Err(Failure::Uncorrelated);
        }
        // One POST has one terminal response. Even an invalid/foreign response
        // ends this turn's delivery authority; it cannot be repaired by a later
        // completion while retaining old native permission requests.
        self.close();
        if !self.owned_assistant(&result["info"]) {
            return Err(Failure::Uncorrelated);
        }
        if !result["info"]["error"].is_null() {
            return Err(Failure::Native);
        }
        let parts = result["parts"].as_array().ok_or(Failure::InvalidBody)?;
        let mut report = String::new();
        for part in parts {
            if part["sessionID"] != self.invocation.session
                || part["messageID"] != result["info"]["id"]
            {
                return Err(Failure::Uncorrelated);
            }
            if part["type"] == "text" {
                report.push_str(part["text"].as_str().ok_or(Failure::InvalidBody)?);
                if report.len() > 1024 * 1024 {
                    return Err(Failure::BodyLimit);
                }
            }
        }
        Ok(report)
    }
    /// Correlation precedes output/decision delivery. Events arriving before the
    /// assistant's parent identity are bounded and replayed once after identity.
    pub fn event(&mut self, raw: Value) -> Result<Vec<Value>, String> {
        if self.closed || !self.dispatched {
            return Ok(vec![]);
        }
        if raw.to_string().len() > MAX_EVENT {
            return Err("opencode-event-limit".into());
        }
        let p = &raw["properties"];
        let sessions = [
            p.get("sessionID"),
            p["info"].get("sessionID"),
            p["part"].get("sessionID"),
            p["tool"].get("sessionID"),
        ];
        if sessions.iter().all(Option::is_none)
            || sessions
                .into_iter()
                .flatten()
                .any(|sid| sid.as_str() != Some(&self.invocation.session))
        {
            return Ok(vec![]);
        }
        let kind = raw["type"].as_str().unwrap_or("");
        if kind == "message.updated" {
            let info = &p["info"];
            let Some(id) = info["id"]
                .as_str()
                .filter(|s| token(s, 256))
                .map(str::to_owned)
            else {
                return Ok(vec![]);
            };
            if self.assistants.len() + self.rejected.len() >= 1024 {
                return Err("opencode-message-limit".into());
            }
            if !self.owned_assistant(info) {
                self.rejected.insert(id.clone());
                self.pending
                    .retain(|e| event_message(e) != Some(id.as_str()));
                self.pending_bytes = self.pending.iter().map(|e| e.to_string().len()).sum();
                return Ok(vec![]);
            }
            self.assistants.insert(id.clone());
            let pending = std::mem::take(&mut self.pending);
            self.pending_bytes = 0;
            let mut out = vec![raw];
            for event in pending {
                if event_message(&event) == Some(id.as_str()) {
                    out.extend(self.event(event)?);
                } else {
                    self.pending_bytes += event.to_string().len();
                    self.pending.push(event);
                }
            }
            return Ok(out);
        }
        let Some(message) = event_message(&raw) else {
            return Ok(vec![]);
        };
        if self.rejected.contains(message) || message == self.invocation.message {
            return Ok(vec![]);
        }
        if !self.assistants.contains(message) {
            // Do not queue permission/question requests: a previous native
            // request must never acquire authority from a later identity update.
            if matches!(kind, "message.part.updated" | "message.part.delta") {
                let bytes = raw.to_string().len();
                if self.pending.len() >= 128 || self.pending_bytes + bytes > MAX_EVENT {
                    return Err("opencode-pending-limit".into());
                }
                self.pending_bytes += bytes;
                self.pending.push(raw);
            }
            return Ok(vec![]);
        }
        if matches!(kind, "permission.asked" | "question.asked") {
            let Some(id) = p["id"].as_str().filter(|s| token(s, 256)) else {
                return Ok(vec![]);
            };
            if self.seen_requests.len() >= 256 {
                return Err("opencode-request-limit".into());
            }
            if !self.seen_requests.insert(id.into()) {
                return Ok(vec![]);
            }
        } else if !matches!(kind, "message.part.updated" | "message.part.delta") {
            return Ok(vec![]);
        }
        Ok(vec![raw])
    }
}
fn event_message(event: &Value) -> Option<&str> {
    let p = &event["properties"];
    let mut selected = None;
    for value in [
        p["part"].get("messageID"),
        p.get("messageID"),
        p["tool"].get("messageID"),
    ]
    .into_iter()
    .flatten()
    {
        let id = value.as_str().filter(|s| token(s, 256))?;
        if selected.is_some_and(|previous| previous != id) {
            return None;
        }
        selected = Some(id);
    }
    selected
}

/// Native denies win. Deck session grants have only native once scope.
pub fn permission_reply(
    response: &deck2_shared::DecisionResponse,
    native_denied: bool,
    supports_always: bool,
    permanent_consent: bool,
) -> Value {
    use deck2_shared::DecisionResponse::*;
    let reply = match response {
        _ if native_denied => "reject",
        AllowAlways if supports_always && permanent_consent => "always",
        AllowOnce | AllowSession => "once",
        _ => "reject",
    };
    json!({"reply":reply})
}

#[cfg(test)]
mod tests;

pub(crate) mod execution;
pub(crate) mod runtime;
pub(crate) mod source;

/// The only non-Codex override allowed by legacy configuration snapshots.
pub(crate) fn admitted(s: &deck2_shared::AdmissionSnapshot) -> bool {
    s.session_contract.is_some()
        && s.native.as_ref().is_some_and(|n| {
            n.runner == deck2_shared::NativeRunner::Opencode
                && n.protocol == "http-sse"
                && n.version == "1.19.1"
                && n.executable.qualification == "deck2-opencode-1.19.1-http-sse-v1"
                && n.executable.ownership == "external_unknown"
                && n.executable.catalog.is_none()
                && n.executable.model.is_none()
                && s.runner.as_ref() == Some(&n.executable)
                && crate::native_identity::validate_binding(n).is_ok()
        })
}

#[cfg(test)]
mod composed_tests;

/// Resolve the normalized public inventory using this integration's model IDs.
pub(crate) fn resolve_public_model(models: &Value, a: &MemberAssignment) -> Result<(String, Option<String>), String> {
        let inventory=models.as_array().ok_or("Model inventory missing")?.iter().map(|m|{
            let id=m["modelId"].as_str().ok_or("Invalid model ID")?;
            let (provider,model)=id.split_once('/').ok_or("Invalid provider/model ID")?;
            Ok(crate::connected_opencode::Model{provider:provider.into(),model:model.into(),variants:m["thinkingLevels"].as_array().ok_or("Variant inventory missing")?.iter().filter_map(|v|v.as_str().map(str::to_owned)).collect()})
        }).collect::<Result<Vec<_>,String>>()?;
        let selected=crate::connected_opencode::resolve(&inventory,a)?;
        Ok((format!("{}/{}",selected.provider,selected.model),selected.variant))
}
