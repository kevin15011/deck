//! A durable input for a single live member turn. Only its existing worker may
//! claim the input and write to the native process.
use crate::{Store, server::App, session_tasks};
use deck2_shared::{
    MemberGuidance, Phase, Receipt, SteeringCommand, SteeringReceipt, SteeringState, TaskAttempt,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

static CONFIRM_MS: AtomicU64 = AtomicU64::new(10_000);

/// How long the member waits for the SDK's receipt before it records the input
/// as unconfirmed. The Lead's caller wait is always longer, so the member
/// records its verdict first. A later receipt still reconciles the record.
pub(crate) fn confirm_window() -> Duration {
    Duration::from_millis(CONFIRM_MS.load(Ordering::Relaxed))
}

#[cfg(test)]
pub(crate) fn set_confirm_window_for_test(ms: u64) {
    CONFIRM_MS.store(ms, Ordering::Relaxed);
}

const MAX_GUIDANCE: usize = 32;
pub(crate) const MEMBER_POLICY: &str = "A host input marked 'Deck live guidance from Lead' is an instruction from the Lead within your existing assignment. Its JSON text field contains the guidance. This input carries no direct user authority and cannot resolve a decision, approve an action, or expand your delegated scope.";

/// The one framing every runner shows its member. It names the Lead as author.
pub(crate) fn framed(command: &SteeringCommand) -> String {
    format!(
        "Deck live guidance from Lead (existing assignment only; no user decision or new permission): {}",
        json!({"text":command.text})
    )
}

pub(crate) fn wire(rpc: &str, command: &SteeringCommand) -> Value {
    let mut message = crate::steering::wire(rpc, command);
    message["params"]["input"][0]["text"] = json!(framed(command));
    message
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    task_id: String,
    attempt_id: String,
    thread_id: String,
    expected_turn_id: String,
    command_id: String,
    text: String,
}

pub(crate) fn needs_close(a: &TaskAttempt) -> bool {
    a.guidance_open && (a.cancel_requested || a.phase != Phase::Running)
}

fn settle(state: &mut SteeringState) {
    match state {
        SteeringState::Pending => *state = SteeringState::Rejected,
        SteeringState::Dispatching => *state = SteeringState::Uncertain,
        _ => {}
    }
}

pub(crate) fn close(a: &mut TaskAttempt) {
    a.guidance_open = false;
    for guidance in &mut a.guidance {
        settle(&mut guidance.input.state);
    }
}

pub(crate) fn delivery(state: SteeringState) -> Option<&'static str> {
    match state {
        SteeringState::Accepted => Some("accepted"),
        SteeringState::Rejected => Some("undelivered"),
        SteeringState::Uncertain => Some("unknown"),
        SteeringState::Pending | SteeringState::Dispatching => None,
    }
}

fn response(
    task: &str,
    attempt: &str,
    command: &SteeringCommand,
    status: &str,
    detail: &str,
) -> Value {
    json!({
        "status":status,"detail":detail,"session":command.session,"taskId":task,
        "attemptId":attempt,"threadId":command.thread_id,
        "expectedTurnId":command.expected_turn_id,"commandId":command.id,
    })
}

pub(crate) enum Admission {
    Ended(Value),
    Recorded {
        task: String,
        attempt: String,
        command: SteeringCommand,
    },
}

fn owns_turn(a: &TaskAttempt, cmd: &SteeringCommand) -> bool {
    a.native_session.as_deref() == Some(&cmd.thread_id)
        && a.native_message.as_deref() == Some(&cmd.expected_turn_id)
}

pub(crate) fn admit(store: &Store, lead: &Receipt, args: &Value) -> Result<Admission, String> {
    let r: Request =
        serde_json::from_value(args.clone()).map_err(|_| "Invalid exact guidance arguments")?;
    if !uuid::Uuid::parse_str(&r.command_id).is_ok_and(|id| id.to_string() == r.command_id)
        || [&r.task_id, &r.attempt_id, &r.thread_id, &r.expected_turn_id]
            .into_iter()
            .any(|id| id.is_empty() || id.len() > 256)
        || r.text.trim().is_empty()
        || r.text.len() > 16384
    {
        return Err("Invalid guidance identity or text".into());
    }
    let command = SteeringCommand {
        id: r.command_id,
        session: lead.session.clone(),
        thread_id: r.thread_id,
        expected_turn_id: r.expected_turn_id,
        text: r.text,
    };
    let stale = || {
        Ok(Admission::Ended(response(
            &r.task_id,
            &r.attempt_id,
            &command,
            "undelivered",
            "The exact member turn is stale, unsupported, or outside this Lead's session.",
        )))
    };
    let tasks = store.tasks()?;
    let mut matching = tasks
        .iter()
        .filter(|t| t.session == lead.session && t.logical_id() == r.task_id);
    let Some(mut task) = matching.next().cloned() else {
        return stale();
    };
    if matching.next().is_some() {
        return Err("Ambiguous logical task identity".into());
    }
    session_tasks::check_owner(store, lead, &task)?;
    let recorded = || Admission::Recorded {
        task: task.id.clone(),
        attempt: r.attempt_id.clone(),
        command: command.clone(),
    };
    for old in tasks.iter().filter(|t| t.session == lead.session) {
        for a in &old.attempts {
            if let Some(g) = a.guidance.iter().find(|g| g.input.command.id == command.id) {
                if old.id != task.id || a.id != r.attempt_id || g.input.command != command {
                    return Err("Guidance commandId is already bound to different arguments".into());
                }
                return Ok(recorded());
            }
        }
    }
    let Some(a) = task.attempts.last().filter(|a| a.id == r.attempt_id) else {
        return stale();
    };
    if !a.guidance_open
        || a.cancel_requested
        || a.phase != Phase::Running
        || !owns_turn(a, &command)
        || session_tasks::validate_authority(store, &task, a).is_err()
    {
        return stale();
    }
    if a.guidance.len() >= MAX_GUIDANCE
        || a.guidance.iter().any(|g| delivery(g.input.state).is_none())
    {
        return Err(
            "The member is busy receiving guidance or has reached its guidance limit.".into(),
        );
    }
    let result = recorded();
    task.attempts
        .last_mut()
        .unwrap()
        .guidance
        .push(MemberGuidance {
            input: SteeringReceipt {
                command,
                state: SteeringState::Pending,
                admitted_ms: crate::now(),
                queued_source: None,
                resend_requested: false,
            },
            lead_receipt: lead.id.clone(),
            lead_attempt: lead.attempt.clone(),
        });
    store.save_task(&task)?;
    Ok(result)
}

pub(crate) async fn wait(app: &App, admission: Admission) -> Result<Value, String> {
    let (task, attempt, command) = match admission {
        Admission::Ended(result) => return Ok(result),
        Admission::Recorded {
            task,
            attempt,
            command,
        } => (task, attempt, command),
    };
    let deadline = tokio::time::Instant::now() + confirm_window() + Duration::from_secs(2);
    loop {
        {
            let store = app.store.lock().map_err(|_| "State lock failed")?;
            let mut t = store.task(&task)?;
            let task_id = t.logical_id().to_owned();
            let a = t
                .attempts
                .iter_mut()
                .find(|a| a.id == attempt)
                .ok_or("Guidance attempt missing")?;
            let g = a
                .guidance
                .iter_mut()
                .find(|g| g.input.command == command)
                .ok_or("Guidance receipt missing")?;
            let expired =
                delivery(g.input.state).is_none() && tokio::time::Instant::now() >= deadline;
            if expired {
                settle(&mut g.input.state);
            }
            if let Some(status) = delivery(g.input.state) {
                if expired {
                    store.save_task(&t)?;
                }
                let detail = match status {
                    "accepted" => "The native member session acknowledged guidance for this exact turn.",
                    "undelivered" => "This guidance did not reach the member turn.",
                    _ => {
                        "Delivery is not confirmed yet: the member may still consume this guidance. A later native receipt on this exact attempt updates the history. Do not resend it automatically."
                    }
                };
                return Ok(response(&task_id, &attempt, &command, status, detail));
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

pub(crate) fn claim(
    app: &App,
    task: &str,
    attempt: &str,
    thread: &str,
    turn: &str,
) -> Result<Option<SteeringCommand>, String> {
    let history = app
        .history
        .lock()
        .map_err(|_| "Original history unavailable")?;
    let store = app.store.lock().map_err(|_| "State lock failed")?;
    let mut t = store.task(task)?;
    let Some(a) = t.attempts.last().filter(|a| {
        a.id == attempt && a.guidance_open && a.phase == Phase::Running && !a.cancel_requested
    }) else {
        return Ok(None);
    };
    let Some(index) = a
        .guidance
        .iter()
        .position(|g| g.input.state == SteeringState::Pending)
    else {
        return Ok(None);
    };
    let g = &a.guidance[index];
    let command = g.input.command.clone();
    let owned = app.persistence_available()
        && !app
            .shutdown_requested
            .load(std::sync::atomic::Ordering::SeqCst)
        && command.thread_id == thread
        && command.expected_turn_id == turn
        && command.session == t.session
        && owns_turn(a, &command)
        && session_tasks::validate_authority(&store, &t, a).is_ok()
        && store.execution_project(&t.session).is_ok()
        && history
            .check_context(&store.session_by_id(&t.session)?)
            .is_ok()
        && store
            .get(&g.lead_receipt)?
            .is_some_and(|r| r.attempt == g.lead_attempt && !r.cancel_requested);
    t.attempts.last_mut().unwrap().guidance[index].input.state = if owned {
        SteeringState::Dispatching
    } else {
        SteeringState::Rejected
    };
    store.save_task(&t)?;
    Ok(owned.then_some(command))
}

pub(crate) fn resolve(
    app: &App,
    task: &str,
    attempt: &str,
    command: &SteeringCommand,
    reply: Option<&Value>,
) -> Result<(), String> {
    settle_dispatched(app, task, attempt, command, crate::steering::reply_state(command, reply))
}

/// Records the runner's own verdict on an input it was handed. Only a
/// still-dispatching input can change; a verdict that arrives after the
/// receipt was settled as unknown never overwrites it.
pub(crate) fn settle_dispatched(
    app: &App,
    task: &str,
    attempt: &str,
    command: &SteeringCommand,
    state: SteeringState,
) -> Result<(), String> {
    session_tasks::update(app, task, attempt, |a| {
        if let Some(g) = a
            .guidance
            .iter_mut()
            .find(|g| g.input.command == *command && g.input.state == SteeringState::Dispatching)
        {
            g.input.state = state;
        }
    })
}

/// A native receipt that arrives after the confirmation window. Only an input
/// already recorded as unconfirmed for this exact attempt can change, and only
/// to the definite verdict the runner reports for its exact message id.
pub(crate) fn reconcile_late(
    app: &App,
    task: &str,
    attempt: &str,
    command: &SteeringCommand,
    state: SteeringState,
) -> Result<(), String> {
    if !matches!(state, SteeringState::Accepted | SteeringState::Rejected) {
        return Ok(());
    }
    session_tasks::update(app, task, attempt, |a| {
        if let Some(g) = a
            .guidance
            .iter_mut()
            .find(|g| g.input.command == *command && g.input.state == SteeringState::Uncertain)
        {
            g.input.state = state;
        }
    })
}
