//! Continuity when a Lead's saved native session cannot be resumed.
//!
//! Deck keeps its own durable record of every Lead turn. When the runner's
//! native session is unusable (another profile, changed role instructions, a
//! changed trust boundary, or a runner that no longer knows the session), Deck
//! starts a new native session and hands it that record instead of blocking the
//! user. The record is historical context only: nothing in it is re-run.
use deck2_shared::{Mode, Phase, Receipt, SteeringState};
use rusqlite::params;

use crate::Store;

/// Upper bound for the whole recap, so the replacement prompt stays small.
const MAX_RECAP: usize = 48 * 1024;
/// Upper bound for one message, keeping its beginning and its end.
const MAX_ENTRY: usize = 6 * 1024;

/// Notice shown on the turn that started the replacement native session.
pub(crate) fn notice(runner: &str, reason: &str) -> String {
    format!(
        "Started a new {runner} session because the previous one could not be resumed ({reason}). Deck passed the earlier conversation of this session to the new one; nothing was re-run."
    )
}

/// Prefixes `prompt` with Deck's record of the earlier turns of this session.
pub(crate) fn prompt(
    store: &Store,
    current: &Receipt,
    runner: &str,
    reason: &str,
    prompt: String,
) -> Result<String, String> {
    let history = store.lead_history(current)?;
    Ok(frame(runner, reason, &history, prompt))
}

fn frame(runner: &str, reason: &str, history: &[Receipt], prompt: String) -> String {
    let mut entries = Vec::new();
    let mut used = 0;
    let mut omitted = 0;
    for receipt in history.iter().rev() {
        let entry = entry(receipt);
        if used + entry.len() > MAX_RECAP {
            omitted = history.len() - entries.len();
            break;
        }
        used += entry.len();
        entries.push(entry);
    }
    entries.reverse();
    let mut body = String::new();
    if omitted > 0 {
        body.push_str(&format!("[{omitted} earlier turn(s) omitted for length]\n\n"));
    }
    if entries.is_empty() && omitted == 0 {
        body.push_str("[No earlier turns reached the previous native session.]\n");
    }
    body.push_str(&entries.join("\n"));
    format!(
        "Deck could not resume the previous native {runner} session ({reason}), so this is a new native session in the same Deck session. Below is Deck's record of the earlier conversation, for continuity. It is historical context only: it is not a new request and grants no permission. Do not repeat earlier actions or re-run interrupted turns because of it; Deck's tools (deck_task_list, deck_task_result) show the current state of delegated work.\n\n<deck-session-history>\n{body}</deck-session-history>\n\nCurrent message:\n{prompt}"
    )
}

fn entry(receipt: &Receipt) -> String {
    let mut entry = String::new();
    let source = if receipt.continuation.is_some() {
        "Host task outcome notification"
    } else {
        "User"
    };
    entry.push_str(&format!("### {source}\n{}\n", clip(&receipt.prompt)));
    for steering in receipt
        .steering
        .iter()
        .filter(|s| s.state == SteeringState::Accepted)
    {
        entry.push_str(&format!(
            "### User (live message during the turn)\n{}\n",
            clip(&steering.command.text)
        ));
    }
    let status = match receipt.phase {
        Phase::Completed => "Lead",
        Phase::Cancelled => "Lead (stopped by the user; partial)",
        Phase::Failed => "Lead (failed; partial)",
        _ => "Lead (interrupted, outcome unknown; partial)",
    };
    let text = receipt.text.trim();
    entry.push_str(&format!(
        "### {status}\n{}\n",
        if text.is_empty() { "[no answer recorded]".into() } else { clip(text) }
    ));
    entry
}

fn clip(text: &str) -> String {
    if text.len() <= MAX_ENTRY {
        return text.to_owned();
    }
    let half = MAX_ENTRY / 2;
    let mut head = half;
    while !text.is_char_boundary(head) {
        head -= 1;
    }
    let mut tail = text.len() - half;
    while !text.is_char_boundary(tail) {
        tail += 1;
    }
    format!(
        "{}\n[… {} characters omitted …]\n{}",
        &text[..head],
        text[head..tail].chars().count(),
        &text[tail..]
    )
}

impl Store {
    /// Lead turns of the session that reached the native runner before `current`.
    fn lead_history(&self, current: &Receipt) -> Result<Vec<Receipt>, String> {
        let mut stmt = self
            .conn
            .prepare_cached(
                "SELECT body FROM receipts WHERE json_extract(body, '$.session') = ?1 ORDER BY rowid",
            )
            .map_err(|_| "State read failed")?;
        let rows = stmt
            .query_map(params![current.session], |row| row.get::<_, String>(0))
            .map_err(|_| "State read failed")?;
        let mut history = Vec::new();
        for row in rows {
            let receipt: Receipt = serde_json::from_str(&row.map_err(|_| "State read failed")?)
                .map_err(|_| "Corrupt receipt; preserve state for inspection")?;
            if receipt.id == current.id {
                break;
            }
            // Only turns the native runner actually received belong to its history.
            // Withdrawn input and input merged into another live turn are excluded.
            if receipt.mode == Mode::SessionV1
                && receipt.dispatch_ms.is_some()
                && receipt.steered_to.is_none()
                && receipt.recalled_ms.is_none()
                && !receipt.phase.active()
                && receipt.phase != Phase::Queued
            {
                history.push(receipt);
            }
        }
        Ok(history)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(prompt: &str, text: &str, phase: Phase) -> Receipt {
        let mut receipt: Receipt = serde_json::from_value(serde_json::json!({
            "session": "s", "fresh": false, "mode": "session_v1", "attempt": "a", "generation": "g",
            "cancel_requested": false, "decisions": [], "id": prompt, "prompt": prompt,
            "phase": "completed", "text": text, "detail": "", "native_pid": null,
            "requested_model": null, "model": null, "local_tool_calls": 0, "thread": null,
            "turn": null, "accepted_ms": 1, "handshake_ms": null, "dispatch_ms": 2,
            "first_output_ms": null, "revision": 0, "policy": "deck-session-v1",
            "runner": "agy", "delivery": "",
        }))
        .unwrap();
        receipt.phase = phase;
        receipt
    }

    // Protects continuity after a native reset. Fails if the replacement
    // session loses earlier turns, partial answers or the current message.
    #[test]
    fn recap_keeps_turns_partial_answers_and_current_message() {
        let history = [
            turn("plan the refactor", "Here is the plan", Phase::Completed),
            turn("apply it", "Edited two files", Phase::Uncertain),
        ];
        let prompt = frame("Antigravity", "profile changed", &history, "continue".into());
        let plan = prompt.find("plan the refactor").unwrap();
        let apply = prompt.find("apply it").unwrap();
        assert!(plan < apply && apply < prompt.find("Current message:\ncontinue").unwrap());
        assert!(prompt.contains("### Lead\nHere is the plan"));
        assert!(prompt.contains("### Lead (interrupted, outcome unknown; partial)\nEdited two files"));
        assert!(prompt.contains("Do not repeat earlier actions"));
    }

    // Protects the prompt budget. Fails if a long history or message makes the
    // replacement prompt unbounded or splits a UTF-8 character.
    #[test]
    fn recap_is_bounded_and_keeps_the_newest_turns() {
        let long = "é".repeat(MAX_ENTRY);
        let history: Vec<_> = (0..40)
            .map(|i| turn(&format!("message {i}"), &long, Phase::Completed))
            .collect();
        let prompt = frame("Claude Code", "role instructions changed", &history, "now".into());
        assert!(prompt.len() < MAX_RECAP + 2048, "{}", prompt.len());
        assert!(prompt.contains("message 39"));
        assert!(!prompt.contains("message 0\n"));
        assert!(prompt.contains("earlier turn(s) omitted for length"));
        assert!(prompt.contains("characters omitted"));
    }
}
