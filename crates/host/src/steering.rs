use crate::server::{App, problem};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use deck2_shared::{Mode, Phase, Receipt, SteeringCommand, SteeringReceipt, SteeringState};
use serde_json::{Value, json};

const MAX_INPUTS_PER_TURN: usize = 32;

fn closing(receipt: &Receipt) -> bool {
    receipt.cancel_requested || receipt.phase != Phase::Running
}

pub(crate) fn settle_owned_input(receipt: &mut Receipt) {
    if !closing(receipt) {
        return;
    }
    receipt.can_steer = false;
    for input in &mut receipt.steering {
        match input.state {
            SteeringState::Pending => input.state = SteeringState::Rejected,
            SteeringState::Dispatching if !receipt.phase.active() => {
                input.state = SteeringState::Uncertain;
            }
            _ => {}
        }
    }
}

fn owns_turn(root: &Receipt, command: &SteeringCommand) -> bool {
    root.session == command.session
        && root.thread.as_deref() == Some(command.thread_id.as_str())
        && root.turn.as_deref() == Some(command.expected_turn_id.as_str())
}

pub(crate) fn accepted_event(receipt: &Receipt, input: &SteeringReceipt) -> Value {
    json!({
        "type": "prompt.steered",
        "role": "user",
        "promptId": input.command.id,
        "receiptId": receipt.id,
        "threadId": input.command.thread_id,
        "turnId": input.command.expected_turn_id,
        "text": input.command.text,
        "at_ms": input.admitted_ms,
    })
}

pub(crate) fn matches_accepted_event(receipt: &Receipt, input_id: &str, event: &Value) -> bool {
    receipt.steering.iter().any(|input| {
        input.state == SteeringState::Accepted
            && input.command.id == input_id
            && owns_turn(receipt, &input.command)
            && accepted_event(receipt, input) == *event
    })
}

pub(crate) async fn submit(
    State(app): State<App>,
    Path(root): Path<String>,
    Json(command): Json<SteeringCommand>,
) -> Response {
    if command.text.trim().is_empty()
        || command.text.len() > 16384
        || command.id.len() != 36
        || !uuid::Uuid::parse_str(&command.id).is_ok_and(|id| id.to_string() == command.id)
    {
        return problem(
            StatusCode::BAD_REQUEST,
            "steering_invalid",
            "Invalid live message",
        );
    }
    let stale = || {
        problem(
            StatusCode::CONFLICT,
            "steering_stale",
            "The selected Lead turn has ended or can no longer receive live input. Your draft is kept.",
        )
    };
    let active = app.active.lock().unwrap();
    let history = app.history.lock().unwrap();
    let mut store = app.store.lock().unwrap();
    let mut receipt = match store.get(&root) {
        Ok(Some(receipt)) if owns_turn(&receipt, &command) => receipt,
        Ok(_) => return stale(),
        Err(e) => return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e),
    };
    if let Some(existing) = receipt
        .steering
        .iter()
        .find(|input| input.command.id == command.id)
    {
        if crate::web_identity::authorize().is_err() {
            return problem(
                StatusCode::FORBIDDEN,
                "device-required",
                "Device access ended",
            );
        }
        return if existing.command == command {
            Json(existing).into_response()
        } else {
            problem(
                StatusCode::CONFLICT,
                "steering_conflict",
                "This live message ID already belongs to different input",
            )
        };
    }
    if !receipt.can_steer
        || closing(&receipt)
        || receipt.mode != Mode::SessionV1
        || active.get(&root).is_none_or(|owner| *owner.borrow())
        || !app.persistence_available()
        || app
            .shutdown_requested
            .load(std::sync::atomic::Ordering::SeqCst)
    {
        return stale();
    }
    if let Err(e) = store.session_by_id(&receipt.session).and_then(|session| {
        store.execution_project(&session.id)?;
        history.check_context(&session)
    }) {
        return problem(StatusCode::CONFLICT, "steering_context", e);
    }
    if receipt.steering.len() >= MAX_INPUTS_PER_TURN
        || receipt.steering.iter().any(|input| {
            matches!(
                input.state,
                SteeringState::Pending | SteeringState::Dispatching
            )
        })
    {
        return problem(
            StatusCode::CONFLICT,
            "steering_busy",
            "The Lead turn cannot accept another live message yet. Your draft is kept.",
        );
    }
    let used_elsewhere = store.conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM receipts, json_each(receipts.body, '$.steering') WHERE json_extract(json_each.value, '$.id') = ?1)",
        [&command.id],
        |row| row.get::<_, bool>(0),
    );
    match used_elsewhere {
        Ok(false) => {}
        Ok(true) => {
            return problem(
                StatusCode::CONFLICT,
                "steering_conflict",
                "This live message ID already belongs to a different turn",
            );
        }
        Err(_) => {
            return problem(
                StatusCode::SERVICE_UNAVAILABLE,
                "storage",
                "Cannot check live message identity",
            );
        }
    }
    if let Some(r) = crate::web_identity::effect_denied() {
        return r;
    }
    let input = SteeringReceipt {
        command,
        state: SteeringState::Pending,
        admitted_ms: crate::now(),
    };
    receipt.steering.push(input.clone());
    if let Err(e) = store.save(&mut receipt) {
        drop(store);
        drop(history);
        drop(active);
        app.storage_failed();
        return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e);
    }
    (StatusCode::ACCEPTED, Json(input)).into_response()
}

/// Commit the write fence with the same store lock used by Stop. The native
/// expected-turn precondition covers a settlement that Deck has yet to read.
pub(crate) fn claim(
    app: &App,
    root: &str,
    thread: &str,
    turn: &str,
) -> Result<Option<SteeringCommand>, String> {
    if !app.persistence_available() {
        return Ok(None);
    }
    let result = (|| {
        let mut store = app.store.lock().map_err(|_| "State lock failed")?;
        let mut receipt = store.get(root)?.ok_or("Missing live turn receipt")?;
        if !receipt.can_steer || closing(&receipt) {
            return Ok(None);
        }
        let Some(input) = receipt
            .steering
            .iter_mut()
            .find(|input| input.state == SteeringState::Pending)
        else {
            return Ok(None);
        };
        if input.command.thread_id != thread || input.command.expected_turn_id != turn {
            return Err("Live input does not belong to this native turn".into());
        }
        input.state = SteeringState::Dispatching;
        let command = input.command.clone();
        store.save(&mut receipt)?;
        Ok(Some(command))
    })();
    if result.is_err() {
        app.storage_failed();
    }
    result
}

pub(crate) fn wire(id: &str, command: &SteeringCommand) -> Value {
    json!({
        "id": id,
        "method": "turn/steer",
        "params": {
            "threadId": command.thread_id,
            "expectedTurnId": command.expected_turn_id,
            "clientUserMessageId": command.id,
            "input": [{"type":"text","text":command.text}],
        },
    })
}

pub(crate) fn reply_state(command: &SteeringCommand, reply: Option<&Value>) -> SteeringState {
    match reply {
        Some(value)
            if value.get("error").is_none()
                && value["result"]["turnId"] == command.expected_turn_id =>
        {
            SteeringState::Accepted
        }
        Some(value)
            if value.get("result").is_none() && value["error"]["code"].as_i64().is_some() =>
        {
            SteeringState::Rejected
        }
        _ => SteeringState::Uncertain,
    }
}

pub(crate) fn resolve(
    app: &App,
    root: &str,
    command: &SteeringCommand,
    reply: Option<&Value>,
) -> Result<(), String> {
    let state = reply_state(command, reply);
    app.change(root, |receipt| {
        if let Some(input) = receipt
            .steering
            .iter_mut()
            .find(|input| input.command == *command && input.state == SteeringState::Dispatching)
        {
            input.state = state;
        }
    })
}
