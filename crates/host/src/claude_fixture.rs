//! Claude stream-json continuity with an in-memory native transport. No host
//! build can select this transport or use it to launch the Claude executable.
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

use deck2_shared::{
    AdmissionSnapshot, Mode, NativeBinding, NativeProvenance, NativeRunner, Phase,
    Receipt, RunnerBinding,
};
use serde_json::Value;
use tokio::sync::{mpsc, watch};
use uuid::Uuid;

use crate::{Store, now, server::App, tasks::digest};

pub(crate) const RUNNER: &str = "claude";
const PROTOCOL: &str = "stream-json";

pub(crate) fn bind(snapshot: &mut AdmissionSnapshot) {
    let native = binding(&snapshot.project.id);
    snapshot.runner = Some(native.executable.clone());
    snapshot.native = Some(native);
}

fn binding(project: &str) -> NativeBinding {
    let executable = RunnerBinding {
        path: "/deck2-test-transport/claude".into(),
        executable: digest(b"claude-fixture-transport"),
        ownership: "external_unknown".into(),
        model: None,
        qualification: "isolated-fixture".into(),
        catalog: None,
    };
    NativeBinding {
        runner: NativeRunner::Claude,
        protocol: PROTOCOL.into(),
        version: "fixture".into(),
        executable,
        storage: digest(project.as_bytes()),
        configuration: digest(b"no-tools"),
        role: digest(b"lead"),
    }
}

pub(crate) fn admitted(snapshot: &AdmissionSnapshot) -> bool {
    snapshot
        .session_contract
        .as_ref()
        .and_then(|c| c.members.get("lead"))
        .is_some_and(|lead| lead.runner_id == RUNNER)
        && snapshot.native.as_ref().is_some_and(|n| {
            n.runner == NativeRunner::Claude
                && snapshot.runner.as_ref() == Some(&n.executable)
                && *n == binding(&snapshot.project.id)
        })
}

pub(crate) fn is_admitted(receipt: &Receipt) -> bool {
    receipt.mode == Mode::SessionV1 && receipt.configuration.as_ref().is_some_and(admitted)
}

struct Invocation {
    receipt: String,
    attempt: String,
    prompt: String,
    thread: String,
    resume: bool,
    frames: mpsc::Sender<Value>,
    interrupt: watch::Receiver<bool>,
}

#[derive(Clone)]
pub(crate) struct Transport {
    calls: mpsc::Sender<Invocation>,
    settled: Arc<Mutex<HashSet<String>>>,
}

impl Transport {
    // A fixture can attest that the old transport is gone independently of
    // its result. Only that exact attempt can release its recovered slot.
    pub(crate) fn settle_waiting_roots(
        &self,
        store: &mut Store,
        live: &HashSet<String>,
    ) -> Result<(), String> {
        let rows = store.all()?;
        let settled = self.settled.lock().unwrap();
        for mut r in rows
            .iter()
            .filter(|r| {
                r.phase == Phase::Uncertain
                    && is_admitted(r)
                    && !live.contains(&r.id)
                    && settled.contains(&r.attempt)
                    && rows
                        .iter()
                        .any(|q| q.phase == Phase::Queued && q.session == r.session)
            })
            .cloned()
        {
            r.phase = Phase::Failed;
            r.detail = "The previous fixture transport settled. Its outcome is unknown.".into();
            store.save(&mut r)?;
        }
        Ok(())
    }
}

pub(crate) async fn lead(
    app: &App,
    id: &str,
    cancel: &mut watch::Receiver<bool>,
    transport: Transport,
) -> Result<(), String> {
    let (receipt, thread, resume, provenance) = {
        let r = app.receipt(id)?;
        app.check_original_context(&r.session)?;
        let mut store = app.store.lock().unwrap();
        let s = store.session_by_id(&r.session)?;
        store.execution_project(&r.session)?;
        let mut r = store.get(id)?.ok_or("Fixture receipt missing")?;
        if r.cancel_requested || *cancel.borrow() {
            r.phase = Phase::Cancelled;
            return store.save(&mut r);
        }
        if r.phase != Phase::Accepted
            || !is_admitted(&r)
            || !r.attachments.is_empty()
            || r.continuation.is_some()
        {
            return Err("Fixture Lead input unavailable".into());
        }
        let binding = r.configuration.as_ref().unwrap().native.as_ref().unwrap();
        let provenance = NativeProvenance {
            runner: "claude fixture".into(),
            integration: PROTOCOL.into(),
            executable: binding.executable.executable.clone(),
            storage: binding.storage.clone(),
            content: binding.role.clone(),
        };
        let resume = if r.fresh { None } else { s.native };
        if resume.as_ref().is_some_and(|c| {
            c.runner != Some(NativeRunner::Claude)
                || c.provenance.as_ref() != Some(&provenance)
                || Uuid::parse_str(&c.thread).is_err()
        }) {
            return Err("Fixture context belongs to a different native namespace".into());
        }
        let thread = resume
            .as_ref()
            .map(|c| c.thread.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        r.phase = Phase::Dispatching;
        r.dispatch_ms = Some(now());
        r.generation = Uuid::new_v4().to_string();
        r.thread = Some(thread.clone());
        store.save(&mut r)?;
        (r, thread, resume.is_some(), provenance)
    };
    let (tx, mut frames) = mpsc::channel(16);
    let (interrupt, stop) = watch::channel(false);
    transport
        .calls
        .send(Invocation {
            receipt: receipt.id,
            attempt: receipt.attempt,
            prompt: receipt.prompt,
            thread: thread.clone(),
            resume,
            frames: tx,
            interrupt: stop,
        })
        .await
        .map_err(|_| "Fixture input delivery is uncertain")?;

    let mut initialized = false;
    let mut interrupted = false;
    let mut result = None;
    loop {
        let frame = tokio::select! {
            biased;
            _ = cancel.wait_for(|requested| *requested), if !interrupted => {
                interrupted = true;
                interrupt.send_replace(true);
                continue;
            }
            frame = frames.recv() => frame,
        };
        let Some(frame) = frame else { break };
        if frame["session_id"].as_str() != Some(&thread) || result.is_some() {
            return Err("Fixture stream identity or result sequence changed".into());
        }
        match (frame["type"].as_str(), frame["subtype"].as_str()) {
            (Some("system"), Some("init")) if !initialized => {
                crate::claude::confirm_context(app, id, &thread, provenance.clone(), None, false)?;
                initialized = true;
            }
            (Some("stream_event"), _) if initialized => {
                let event = &frame["event"];
                if event["type"] == "content_block_delta" && event["delta"]["type"] == "text_delta"
                {
                    let text = event["delta"]["text"]
                        .as_str()
                        .ok_or("Invalid fixture text delta")?;
                    app.change(id, |r| {
                        r.first_output_ms.get_or_insert_with(now);
                        r.text.push_str(text);
                    })?;
                }
            }
            (Some("result"), Some("success")) if initialized && frame["is_error"] == false => {
                result = Some((
                    Phase::Completed,
                    Some(
                        frame["result"]
                            .as_str()
                            .ok_or("Invalid fixture result")?
                            .to_owned(),
                    ),
                ));
            }
            (Some("result"), Some("error_during_execution"))
                if initialized && interrupted && frame["is_error"] == true =>
            {
                result = Some((Phase::Cancelled, None));
            }
            (Some("result"), _) | (Some("system"), Some("init")) => {
                return Err("Fixture native result or initialization is uncertain".into());
            }
            _ => {}
        }
    }
    let (phase, text) = result.ok_or("Fixture disconnected before reporting its outcome")?;
    app.change(id, |r| {
        r.phase = phase;
        if let Some(text) = text {
            r.text = text;
        }
        r.detail = "Fixture native result and transport settled.".into();
    })
}

#[cfg(test)]
#[path = "claude_fixture_tests.rs"]
mod tests;
