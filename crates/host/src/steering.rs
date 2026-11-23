use crate::Store;
use crate::server::{App, problem};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use deck2_shared::{
    Mode, Phase, QueuedSteeringSource, Receipt, SteeringCommand, SteeringReceipt, SteeringState,
};
use serde::Deserialize;
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QueuedSteering {
    id: String,
    session: String,
    thread_id: String,
    expected_turn_id: String,
    queued_source: QueuedSteeringSource,
}

pub(crate) async fn submit(
    State(app): State<App>,
    Path(root): Path<String>,
    Json(command): Json<SteeringCommand>,
) -> Response {
    admit(&app, &root, command, None)
}

pub(crate) async fn submit_queued(
    State(app): State<App>,
    Path(root): Path<String>,
    Json(body): Json<QueuedSteering>,
) -> Response {
    let command = SteeringCommand {
        id: body.id,
        session: body.session,
        thread_id: body.thread_id,
        expected_turn_id: body.expected_turn_id,
        text: String::new(),
    };
    admit(&app, &root, command, Some(body.queued_source))
}

/// Only the Claude bridge carries images in a live message. Codex's live turn
/// input is text-only, so a queued message with images stays queued there.
fn lead_accepts_images(root: &Receipt) -> bool {
    root.configuration
        .as_ref()
        .and_then(|c| c.session_contract.as_ref())
        .and_then(|c| c.members.get("lead"))
        .is_some_and(|lead| lead.runner_id == crate::claude::RUNNER)
}

fn eligible_queue(root: &Receipt, source: &Receipt) -> bool {
    source.id != root.id
        && source.session == root.session
        && source.mode == Mode::SessionV1
        && source.phase == Phase::Queued
        && source.dispatch_ms.is_none()
        && source.recalled_ms.is_none()
        && source.steered_to.is_none()
        && !source.cancel_requested
        && !source.fresh
        && !source.attempt.is_empty()
        && (source.attachments.is_empty() || lead_accepts_images(root))
        && source.continuation.is_none()
        && (!source.prompt.trim().is_empty() || !source.attachments.is_empty())
        && source
            .configuration
            .as_ref()
            .and_then(|c| c.session_contract.as_ref())
            .zip(
                root.configuration
                    .as_ref()
                    .and_then(|c| c.session_contract.as_ref()),
            )
            .is_some_and(|(source, root)| source.generation == root.generation)
}

fn accepts_steering(root: &Receipt) -> bool {
    root.can_steer
        && !closing(root)
        && root.steering.len() < MAX_INPUTS_PER_TURN
        && !root.steering.iter().any(|input| {
            matches!(
                input.state,
                SteeringState::Pending | SteeringState::Dispatching
            )
        })
}

pub(crate) fn eligible_queue_ids(
    store: &Store,
    receipts: &[Receipt],
) -> Result<Vec<String>, String> {
    let roots: Vec<_> = receipts
        .iter()
        .filter(|root| accepts_steering(root))
        .collect();
    let mut ids = Vec::new();
    for source in receipts {
        if roots.iter().any(|root| eligible_queue(root, source))
            && !decision_reply(store, &source.id)?
        {
            ids.push(source.id.clone());
        }
    }
    Ok(ids)
}

fn decision_reply(store: &Store, id: &str) -> Result<bool, String> {
    store
        .conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM decision_replies WHERE prompt=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(|_| "Cannot verify queued decision reply ownership".into())
}

fn admit(
    app: &App,
    root: &str,
    mut command: SteeringCommand,
    queued_source: Option<QueuedSteeringSource>,
) -> Response {
    if (queued_source.is_none() && (command.text.trim().is_empty() || command.text.len() > 16384))
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
            "The selected Lead turn has ended or can no longer receive live input.",
        )
    };
    let active = app.active.lock().unwrap();
    let history = app.history.lock().unwrap();
    let mut store = app.store.lock().unwrap();
    let mut receipt = match store.get(root) {
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
        if queued_source.is_some() {
            command.text = existing.command.text.clone();
        }
        return if existing.command == command && existing.queued_source == queued_source {
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
        || active.get(root).is_none_or(|owner| *owner.borrow())
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
    if !accepts_steering(&receipt) {
        return problem(
            StatusCode::CONFLICT,
            "steering_busy",
            "The Lead turn cannot accept another live message yet.",
        );
    }
    if let Some(source) = &queued_source {
        if crate::web_identity::authorize().is_err() {
            return problem(
                StatusCode::FORBIDDEN,
                "device-required",
                "Device access ended",
            );
        }
        let ineligible = || {
            problem(
                StatusCode::CONFLICT,
                "queue_moved",
                "This message is no longer eligible for live delivery. Check the queue and conversation.",
            )
        };
        let queued = match store.get(&source.id) {
            Ok(Some(queued))
                if queued.attempt == source.attempt && eligible_queue(&receipt, &queued) =>
            {
                queued
            }
            Ok(_) => return ineligible(),
            Err(e) => return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e),
        };
        match decision_reply(&store, &queued.id) {
            Ok(false) => command.text = queued.prompt,
            Ok(true) => return ineligible(),
            Err(e) => return problem(StatusCode::SERVICE_UNAVAILABLE, "storage", e),
        }
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
        queued_source,
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

/// Hold the source slot in the same SQLite savepoint as its live receipt.
/// Definite failure returns the original row to FIFO; an uncertain write consumes it.
pub(crate) fn sync_queued_sources(
    store: &mut Store,
    root: &Receipt,
    prior: Option<&Receipt>,
) -> Result<(), String> {
    for input in &root.steering {
        let Some(source) = &input.queued_source else {
            continue;
        };
        let previous = prior.and_then(|root| {
            root.steering
                .iter()
                .find(|old| old.command.id == input.command.id)
        });
        if previous.is_some_and(|old| old.state == input.state) {
            continue;
        }
        let mut queued = store.get(&source.id)?.ok_or("Missing queued live source")?;
        if queued.attempt != source.attempt
            || queued.session != root.session
            || queued.prompt != input.command.text
        {
            return Err("Queued live source identity changed".into());
        }
        if previous.is_none() {
            if !eligible_queue(root, &queued) || input.state != SteeringState::Pending {
                return Err("Queued live source cannot be reserved".into());
            }
            queued.steered_to = Some(root.id.clone());
            queued.phase = Phase::Cancelled;
        } else if queued.steered_to.as_deref() != Some(root.id.as_str())
            || queued.phase != Phase::Cancelled
        {
            return Err("Queued live reservation is missing".into());
        }
        queued.detail = match input.state {
            SteeringState::Pending => "Queued message reserved for live delivery",
            SteeringState::Dispatching => continue,
            SteeringState::Accepted => "Queued message delivered to the current turn",
            SteeringState::Uncertain => "Live delivery could not be confirmed. This message will not be sent again automatically.",
            SteeringState::Rejected => {
                queued.steered_to = None;
                queued.phase = Phase::Queued;
                "Live delivery was rejected. Message is back in the queue."
            }
        }.into();
        store.save(&mut queued)?;
    }
    Ok(())
}

/// Commit the write fence with the same store lock used by Stop. The native
/// expected-turn precondition covers a settlement that Deck has yet to read.
pub(crate) fn claim(
    app: &App,
    root: &str,
    thread: &str,
    turn: &str,
) -> Result<Option<SteeringCommand>, String> {
    Ok(claim_input(app, root, thread, turn)?.map(|input| input.command))
}

/// Same fence as `claim`, also returning where the text came from.
pub(crate) fn claim_input(
    app: &App,
    root: &str,
    thread: &str,
    turn: &str,
) -> Result<Option<SteeringReceipt>, String> {
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
        let claimed = input.clone();
        store.save(&mut receipt)?;
        Ok(Some(claimed))
    })();
    if result.is_err() {
        app.storage_failed();
    }
    result
}

/// Images that belong to a queued message being sent live. Bytes are re-read
/// from private storage and must still match the admitted identity.
pub(crate) fn queued_images(
    app: &App,
    input: &SteeringReceipt,
) -> Result<Vec<(deck2_shared::ImageAttachment, Vec<u8>)>, String> {
    let Some(source) = &input.queued_source else {
        return Ok(Vec::new());
    };
    let store = app.store.lock().map_err(|_| "State lock failed")?;
    let queued = store.get(&source.id)?.ok_or("Queued live source missing")?;
    if queued.attempt != source.attempt || queued.session != input.command.session {
        return Err("Queued live source identity changed".into());
    }
    queued
        .attachments
        .iter()
        .map(|expected| {
            let (stored, bytes) = store.image(&queued.session, &expected.id)?;
            if &stored != expected {
                return Err("Admitted image integrity changed".into());
            }
            Ok((stored, bytes))
        })
        .collect()
}

/// Settle a live message from an explicit state. Rejected and accepted are
/// final. A late acknowledgment may still upgrade an unconfirmed message while
/// the owning attempt keeps running.
pub(crate) fn settle(
    app: &App,
    root: &str,
    id: &str,
    state: SteeringState,
) -> Result<(), String> {
    app.change(root, |receipt| {
        if let Some(input) = receipt.steering.iter_mut().find(|input| {
            input.command.id == id
                && (input.state == SteeringState::Dispatching
                    || (state == SteeringState::Accepted && input.state == SteeringState::Uncertain))
        }) {
            input.state = state;
        }
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_steering_reservation_rolls_back_and_recovers_without_replay() {
        for dispatched in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let project = dir.path().to_str().unwrap();
            let path = dir.path().join("state.db");
            let mut store = Store::open(&path, project).unwrap();
            store.register_codex("a".repeat(64)).unwrap();
            let session = "steering-session";
            store
                .create_session(
                    &serde_json::from_value(json!({
                        "api":deck2_shared::API, "id":session, "title":"Fixture",
                        "members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}
                    }))
                    .unwrap(),
                )
                .unwrap();
            let mut admit = |id: &str, queue| {
                store.admit(&serde_json::from_value(json!({
                "api":deck2_shared::API, "id":id, "session":session, "mode":"session_v1",
                "prompt":id, "queue":queue,
            })).unwrap()).unwrap()
            };
            let mut root = admit("running-root", false);
            let first = admit("first-in-queue", true);
            let selected = admit("selected-in-queue", true);
            let last = admit("last-in-queue", true);
            root.phase = Phase::Running;
            root.thread = Some("thread".into());
            root.turn = Some("turn".into());
            root.can_steer = true;
            store.save(&mut root).unwrap();
            let prior = root.clone();
            root.steering.push(SteeringReceipt {
                command: SteeringCommand {
                    id: uuid::Uuid::new_v4().to_string(),
                    session: session.into(),
                    thread_id: "thread".into(),
                    expected_turn_id: "turn".into(),
                    text: selected.prompt.clone(),
                },
                state: SteeringState::Pending,
                admitted_ms: crate::now(),
                queued_source: Some(QueuedSteeringSource {
                    id: selected.id.clone(),
                    attempt: selected.attempt.clone(),
                }),
            });

            // A source-row write failure rolls back the root's outer savepoint.
            store
                .conn
                .execute_batch(
                    "CREATE TRIGGER source_failure BEFORE UPDATE ON receipts
                WHEN new.id='selected-in-queue' BEGIN SELECT RAISE(ABORT,'test fault'); END",
                )
                .unwrap();
            assert!(store.save(&mut root).is_err());
            assert_eq!(store.get(&root.id).unwrap().unwrap(), prior);
            assert_eq!(store.get(&selected.id).unwrap().unwrap(), selected);
            store
                .conn
                .execute_batch("DROP TRIGGER source_failure")
                .unwrap();
            root.revision = prior.revision;
            store.save(&mut root).unwrap();
            assert!(
                store
                    .recall_input(session, &selected.id, &selected.attempt)
                    .is_err()
            );
            assert!(store.claim_next().unwrap().is_none());
            if dispatched {
                root.steering[0].state = SteeringState::Dispatching;
                store.save(&mut root).unwrap();
            }
            drop(store);

            let mut store = Store::open(&path, project).unwrap();
            let root = store.get(&root.id).unwrap().unwrap();
            let source = store.get(&selected.id).unwrap().unwrap();
            assert_eq!(source.attempt, selected.attempt);
            let mut expected = vec![first.id];
            if dispatched {
                assert_eq!(root.steering[0].state, SteeringState::Uncertain);
                assert_eq!(source.steered_to.as_deref(), Some(root.id.as_str()));
                assert_eq!(source.phase, Phase::Cancelled);
            } else {
                assert_eq!(root.steering[0].state, SteeringState::Rejected);
                assert_eq!(source.steered_to, None);
                assert_eq!(source.phase, Phase::Queued);
                expected.push(selected.id);
            }
            expected.push(last.id);
            assert!(
                store.claim_next().unwrap().is_none(),
                "retain interrupted root ownership"
            );
            store.recover().unwrap();
            for expected in expected {
                let mut claimed = store.claim_next().unwrap().unwrap();
                assert_eq!(claimed.id, expected);
                claimed.phase = Phase::Completed;
                store.save(&mut claimed).unwrap();
            }
            assert!(store.claim_next().unwrap().is_none());
        }
    }

    #[test]
    fn queued_images_stay_queued_when_the_lead_cannot_carry_them() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_str().unwrap();
        let mut store = Store::open(&dir.path().join("state.db"), project).unwrap();
        store.register_codex("a".repeat(64)).unwrap();
        let session = "image-steering-session";
        store
            .create_session(
                &serde_json::from_value(json!({
                    "api":deck2_shared::API, "id":session, "title":"Fixture",
                    "members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}
                }))
                .unwrap(),
            )
            .unwrap();
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(4, 4)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let bytes = png.into_inner();
        let meta = crate::images::validate(&bytes).unwrap();
        let image = store.upload_image(session, "upload-codex-image", meta, &bytes).unwrap();
        let mut admit = |id: &str, prompt: &str, queue: bool, attachments: Vec<String>| {
            store
                .admit(&serde_json::from_value(json!({
                    "api":deck2_shared::API, "id":id, "session":session, "mode":"session_v1",
                    "prompt":prompt, "queue":queue, "attachments":attachments,
                })).unwrap())
                .unwrap()
        };
        let mut root = admit("running-root", "work", false, vec![]);
        let with_image = admit("image-only", "", true, vec![image.id.clone()]);
        root.phase = Phase::Running;
        root.thread = Some("thread".into());
        root.turn = Some("turn".into());
        root.can_steer = true;
        store.save(&mut root).unwrap();
        assert!(!with_image.attachments.is_empty());
        assert!(!eligible_queue(&root, &with_image), "Codex live input is text-only");
        assert_eq!(eligible_queue_ids(&store, &[root.clone(), with_image.clone()]).unwrap(), Vec::<String>::new());
        assert_eq!(store.get(&with_image.id).unwrap().unwrap().phase, Phase::Queued);
    }
}
