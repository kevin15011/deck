use serde::{Deserialize, Serialize};
pub const API: u32 = 7;
pub const POLICY: &str = "deck2-readonly-v1";
/// Native startup observations; host wall time, not provider or browser latency.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct StartupTiming {
    pub process_reused: bool,
    #[serde(default)]
    pub thread_reused: bool,
    pub admission_ms: u64,
    pub bridge_role_ms: u64,
    pub provenance_ms: u64,
    pub tool_preparation_ms: u64,
    pub version_ms: u64,
    pub qualification_cached: bool,
    pub process_spawn_ms: u64,
    pub initialization_ms: u64,
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub claude_stages_ms: std::collections::BTreeMap<String, u64>,
    pub configuration_model_ms: u64,
    pub thread_ms: u64,
    pub thread_method: String,
    pub mcp_readiness_ms: u64,
    pub mcp_status_requests: u64,
    pub mcp_inventory_ms: u64,
    pub mcp_initial_page_ms: u64,
    pub mcp_pagination_ms: u64,
    pub mcp_retry_rpc_ms: u64,
    pub mcp_inventory_validation_ms: u64,
    pub mcp_inventory_passes: u64,
    pub mcp_inventory_entries: u64,
    pub mcp_session_status_ms: u64,
    pub mcp_suppression_ms: u64,
    pub mcp_retry_wait_ms: u64,
    pub mcp_local_verify_ms: u64,
    /// Admission lock waits in the submit handler (monotonic microseconds).
    pub submit_lock_wait_us: u64,
    pub submit_active_wait_us: u64,
    pub submit_history_wait_us: u64,
    pub submit_store_wait_us: u64,
    /// Handler entry until every admission lock was held.
    pub submit_lock_span_us: u64,
    /// Static tag of the dominant traced holder; `untraced` when none overlapped.
    pub submit_blocker: String,
    pub submit_blocker_us: u64,
    /// Store/receipt lock waits observed by the running command before dispatch.
    pub run_lock_wait_us: u64,
    pub run_lock_acquisitions: u64,
    /// Nested inside `bridge_role_ms` / `native_acquire_ms`.
    pub bridge_start_ms: u64,
    pub reuse_take_ms: u64,
    /// Process reuse checkout plus any cold process start.
    pub native_acquire_ms: u64,
    /// Thread/tool/MCP readiness (`prepare_attempt`).
    pub prepare_ms: u64,
    /// `handshake_ms` minus the disjoint phases above; unmeasured time.
    pub other_ms: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Queued,
    Accepted,
    Preparing,
    Dispatching,
    Running,
    Cancelling,
    Completed,
    Cancelled,
    Failed,
    Uncertain,
}
impl Phase {
    pub fn active(&self) -> bool {
        matches!(
            self,
            Self::Accepted | Self::Preparing | Self::Dispatching | Self::Running | Self::Cancelling
        )
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Submit {
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(default)]
    pub mode: Mode,
    pub api: u32,
    pub id: String,
    pub prompt: String,
}
/// Native thread acknowledgement, bound to the model in the same response.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct EffectiveReasoning {
    pub model: String,
    pub effort: String,
    pub source: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Receipt {
    #[serde(default)]
    pub context: ContextState,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub can_steer: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steering: Vec<SteeringReceipt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub continuation: Option<OutcomeContinuation>,
    #[serde(default)]
    pub attachments: Vec<ImageAttachment>,
    #[serde(default)]
    pub configuration: Option<AdmissionSnapshot>,
    #[serde(default)]
    pub session: String,
    #[serde(default)]
    pub fresh: bool,
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub attempt: String,
    #[serde(default)]
    pub generation: String,
    #[serde(default)]
    pub cancel_requested: bool,
    /// Unread input retracted from conversation; audit receipt is retained.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recalled_ms: Option<u64>,
    /// A queued receipt reserved or consumed by live delivery to this root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steered_to: Option<String>,
    #[serde(default)]
    pub decisions: Vec<Decision>,
    pub id: String,
    pub prompt: String,
    pub phase: Phase,
    pub text: String,
    pub detail: String,
    pub native_pid: Option<u32>,
    #[serde(default)]
    pub requested_model: Option<String>,
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<EffectiveReasoning>,
    #[serde(default)]
    pub local_tool_calls: u32,
    pub thread: Option<String>,
    pub turn: Option<String>,
    pub accepted_ms: u64,
    pub handshake_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub startup_timing: Option<StartupTiming>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_startup_retry: Option<StartupRetry>,
    pub dispatch_ms: Option<u64>,
    #[serde(default)]
    pub acknowledgment_ms: Option<u64>,
    pub first_output_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub message_times: Vec<MessageTime>,
    pub revision: u64,
    pub policy: String,
    pub runner: String,
    pub delivery: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct StartupRetry {
    pub retries: u8,
    pub after_ms: u64,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SteeringState {
    Pending,
    Dispatching,
    Accepted,
    Rejected,
    Uncertain,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SteeringCommand {
    pub id: String,
    pub session: String,
    pub thread_id: String,
    pub expected_turn_id: String,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueuedSteeringSource {
    pub id: String,
    pub attempt: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SteeringReceipt {
    #[serde(flatten)]
    pub command: SteeringCommand,
    pub state: SteeringState,
    pub admitted_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queued_source: Option<QueuedSteeringSource>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub resend_requested: bool,
}
/// A Deck Lead's scoped instruction, independent of user steering and decisions.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemberGuidance {
    pub input: SteeringReceipt,
    pub lead_receipt: String,
    pub lead_attempt: String,
}
/// First delivered text of a native assistant item. Offsets index browser UTF-16 strings.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MessageTime {
    pub start: usize,
    pub at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<MessageKind>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind { Progress, Answer }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Workspace {
    pub host_id: String,
    pub sessions: Vec<Session>,
    pub queue_paused: bool,
    pub steering_unavailable: String,
    pub trusted: bool,
    pub api: u32,
    pub session: String,
    pub project: String,
    pub runner: String,
    pub availability: Option<String>,
    pub receipts: Vec<Receipt>,
    pub tasks: Vec<Task>,
    pub team_availability: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Problem {
    pub code: String,
    pub message: String,
    pub correlation: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    ReadOnly,
    ReviewedEdit,
    Developer,
    Team,
    OrdinaryReadOnlyV1,
    OrdinaryReviewedV1,
    SessionV1,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DecisionState {
    Pending,
    Responded,
    Dispatching,
    Delivered,
    Settled,
    Invalidated,
    Uncertain,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "type", content = "answers")]
pub enum DecisionResponse {
    AllowOnce,
    AllowSession,
    AllowAlways,
    Deny,
    Answers(std::collections::BTreeMap<String, Vec<String>>),
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Resolve {
    pub api: u32,
    pub command_id: String,
    pub expected_revision: u64,
    pub response: DecisionResponse,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct QuestionOption {
    pub label: String,
    pub description: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Question {
    #[serde(default)]
    pub multiple: bool,
    pub id: String,
    pub header: String,
    pub question: String,
    pub options: Vec<QuestionOption>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileEffect {
    #[serde(default)]
    pub identity: Option<String>,
    pub path: String,
    pub diff: String,
    pub before: String,
    pub after: Option<String>,
    pub native_status: Option<String>,
    #[serde(default)]
    pub snapshot_error: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Decision {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native: Option<NativeApproval>,
    pub id: String,
    pub session: String,
    pub command: String,
    pub attempt: String,
    pub generation: String,
    pub thread: String,
    pub turn: String,
    pub item: String,
    pub request: String,
    pub revision: u64,
    pub state: DecisionState,
    pub file: Option<FileEffect>,
    pub questions: Vec<Question>,
    pub resolution: Option<Resolve>,
    pub dispatch_ms: Option<u64>,
    pub delivered_ms: Option<u64>,
    pub grant_consumed: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeContext {
    /// Absent only in pre-schema18 state. Absence never authorizes dispatch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runner: Option<NativeRunner>,
    #[serde(default)]
    pub provenance: Option<NativeProvenance>,
    pub thread: String,
    pub mode: Mode,
}
/// Durable recorded root and filesystem identity. Empty only while reading legacy schema.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectBinding {
    pub id: String,
    pub root: String,
    pub identity: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Session {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_generation: Option<u64>,
    #[serde(default)]
    pub project: ProjectBinding,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original: Option<OriginalContext>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract: Option<SessionContract>,
    pub id: String,
    pub title: String,
    pub native: Option<NativeContext>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct OriginalContext {
    pub fingerprint: String,
    pub task: String,
    pub attempt: u64,
    pub thread: String,
    pub model: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionCommand {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub members: Option<std::collections::BTreeMap<String, MemberAssignment>>,
    #[serde(default)]
    pub approvals: Option<String>,
    pub api: u32,
    pub id: String,
    pub title: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScopedSubmit {
    #[serde(default)]
    pub attachments: Vec<String>,
    pub api: u32,
    pub id: String,
    pub prompt: String,
    #[serde(default)]
    pub mode: Mode,
    pub session: String,
    #[serde(default)]
    pub queue: bool,
    #[serde(default)]
    pub fresh: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeProvenance {
    pub runner: String,
    pub integration: String,
    pub executable: String,
    pub storage: String,
    pub content: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Task {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original: Option<OriginalTaskBinding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structured: Option<String>,
    pub id: String,
    pub session: String,
    pub root: String,
    pub parent_attempt: String,
    pub owner: String,
    pub scope: Vec<String>,
    pub acceptance: String,
    pub revision: u32,
    pub attempts: Vec<TaskAttempt>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskAttempt {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub guidance_open: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub guidance: Vec<MemberGuidance>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_dismissal: Option<FailureDismissal>,
    /// Zero is the legacy positional encoding; new admissions always write a number.
    #[serde(default)]
    pub number: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authority: Option<AttemptAuthority>,
    #[serde(default)]
    pub context: ContextState,
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structured: Option<String>,
    #[serde(default)]
    pub configuration: Option<AdmissionSnapshot>,
    #[serde(default)]
    pub preparation_ms: Option<u64>,
    #[serde(default)]
    pub tool_connection_ms: Option<u64>,
    pub id: String,
    pub prompt: String,
    pub source_report: Option<String>,
    pub phase: Phase,
    pub detail: String,
    pub requested_model: String,
    pub observed_model: Option<String>,
    pub provenance: NativeProvenance,
    pub native_session: Option<String>,
    pub native_message: Option<String>,
    pub generation: String,
    pub accepted_ms: u64,
    pub dispatch_ms: Option<u64>,
    pub acknowledgment_ms: Option<u64>,
    pub first_output_ms: Option<u64>,
    pub settled_ms: Option<u64>,
    pub cancel_requested: bool,
    pub report: Option<TaskReport>,
    pub treatments: Vec<Treatment>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AttemptAuthority {
    pub root: String,
    pub attempt: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OriginalTaskBinding {
    pub source: String,
    pub task_id: String,
    pub display_id: String,
    pub fingerprint: String,
    pub capture_seq: u64,
    pub maximum: u64,
    pub lead: String,
    pub assignment: MemberAssignment,
    pub role: String,
    pub continuity_role: String,
    pub predecessor: serde_json::Value,
    pub claims: serde_json::Value,
    pub handoff: String,
}
impl Task {
    pub fn logical_id(&self) -> &str {
        self.original
            .as_ref()
            .map(|o| o.task_id.as_str())
            .unwrap_or(&self.id)
    }
    pub fn number(&self, index: usize) -> u64 {
        let a = &self.attempts[index];
        if a.number > 0 {
            a.number
        } else {
            index as u64 + 1
        }
    }
    pub fn attempt_index(&self, number: u64) -> Option<usize> {
        self.attempts
            .iter()
            .enumerate()
            .position(|(i, _)| self.number(i) == number)
    }
    pub fn authority_root<'a>(&'a self, a: &'a TaskAttempt) -> &'a str {
        a.authority
            .as_ref()
            .map(|r| r.root.as_str())
            .unwrap_or(&self.root)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FailureDismissal {
    pub command_id: String,
    pub at_ms: u64,
    pub revision: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskReport {
    pub attempt: String,
    pub digest: String,
    pub text: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Treatment {
    pub report: Option<String>,
    pub lead_attempt: String,
    pub disposition: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Definition {
    pub digest: String,
    pub name: String,
    pub body: String,
    pub source: String,
    pub owner: String,
    pub kind: String,
    pub roles: Vec<String>,
    pub modes: Vec<String>,
    pub required_resources: Vec<String>,
}
/// Immutable executable and ordinary-model policy admitted for one execution.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RunnerBinding {
    pub path: String,
    pub executable: String,
    pub ownership: String,
    pub model: Option<String>,
    pub qualification: String,
    pub catalog: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdmissionSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native: Option<NativeBinding>,
    #[serde(default)]
    pub project: ProjectBinding,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_contract: Option<SessionContract>,
    #[serde(default)]
    pub selection: Option<SelectionIdentity>,
    #[serde(default)]
    pub cbm: Option<GraphBinding>,
    #[serde(default)]
    pub runner: Option<RunnerBinding>,
    #[serde(default)]
    pub helper: Option<HelperSelection>,
    pub codex_executable: Option<String>,
    pub revision: u64,
    pub definitions: Vec<String>,
    pub investigator: Option<Assignment>,
    pub exclusions: Vec<String>,
    pub delivery_observed: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Assignment {
    pub runner: String,
    pub model: String,
    pub executable: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HelperSelection {
    pub version: String,
    pub executable: String,
    pub catalog: String,
}

impl Mode {
    pub fn editing(&self) -> bool {
        matches!(
            self,
            Self::ReviewedEdit | Self::Developer | Self::OrdinaryReviewedV1
        )
    }
}

/// Explicitly prepared optional graph; scoped-read fallback is part of this admitted contract.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct GraphBinding {
    pub store: String,
    pub service: String,
    pub snapshot: String,
    pub generation: u64,
    pub version: String,
}

/// Immutable server-owned image identity. Bytes and native paths never enter polling.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ImageAttachment {
    pub id: String,
    pub digest: String,
    pub mime: String,
    pub size: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SelectionIdentity {
    pub session: String,
    pub revision: u64,
}
impl Mode {
    pub fn ordinary(&self) -> bool {
        matches!(self, Self::OrdinaryReadOnlyV1 | Self::OrdinaryReviewedV1)
    }
}

/// Original session assignments. Missing contract means historical restricted
/// authority, never implicit permission to use the connected session path.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MemberAssignment {
    pub runner_id: String,
    pub model_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SessionContract {
    #[serde(default)]
    pub grants_revoked_at: u64,
    pub version: u32,
    pub revision: u64,
    pub members: std::collections::BTreeMap<String, MemberAssignment>,
    pub approvals: String,
    pub generation: u64,
    pub lead_task: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NativeApproval {
    /// Host correlation proof; never read from native approval parameters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_proposal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution_provenance: Option<PermissionProvenance>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<PermissionScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<NativeTransport>,
    pub method: String,
    pub parameters: String,
    pub summary: String,
    pub identity: Option<String>,
    pub always_note: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OutcomeContinuation {
    pub task: String,
    pub attempt: String,
    pub source_seq: i64,
    pub origin: String,
}

/// Sanitized current-request context; counters are never cumulative session accounting.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextState {
    pub observation: Option<ContextReading>,
    pub compacted: bool,
    #[serde(default)]
    pub compacting: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextReading {
    pub basis: String,
    pub tokens: Option<u64>,
    pub capacity: Option<u64>,
    pub native_thread_id: String,
    pub native_turn_id: String,
    pub attempt: String,
    pub model_id: Option<String>,
    pub observed_ms: u64,
}

/// Native ID namespaces and approval protocols are disjoint even when IDs match.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeRunner {
    Codex,
    Opencode,
    Claude,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeTransport {
    CodexJsonRpc,
    OpencodeHttp,
    DeckMcp,
    ClaudeSdk,
}
/// Exact launch evidence. Storage is a native namespace identity, never credentials.
/// Migration cannot reconstruct this authority from a historical model label.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NativeBinding {
    pub runner: NativeRunner,
    pub protocol: String,
    pub version: String,
    pub executable: RunnerBinding,
    pub storage: String,
    pub configuration: String,
    pub role: String,
}

/// Host-owned scope evidence. Unknown versions remain readable but cannot grant.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PermissionScope {
    pub version: u32,
    pub actor: serde_json::Value,
    pub issuer: serde_json::Value,
    pub material: serde_json::Value,
    pub option_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<PermissionScopeOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_option: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PermissionScopeOption {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub description: String,
    pub bounds: serde_json::Value,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PermissionProvenance {
    User,
    ReusedGrant { source_decision: String },
    Intrinsic,
}
