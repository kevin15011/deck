//! Terminal rejection evidence is separate from consent and never authorizes work.
//! Store's exclusive mutex serializes this boundary with all response admission.
use crate::{Store, decisions::ResolveError};
use deck2_shared::{API, Decision, DecisionResponse, Resolve};
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};

impl Store {
    pub(crate) fn init_permission_rejections(&self) -> Result<(), String> {
        self.conn.execute_batch("CREATE TABLE IF NOT EXISTS permission_rejections (command_id TEXT PRIMARY KEY, decision_id TEXT NOT NULL, submission TEXT NOT NULL);")
            .map_err(|_| "Cannot initialize terminal permission rejections".into())
    }
    pub(crate) fn rejected_response_id(&self, command: &str) -> Result<bool, String> {
        self.conn
            .query_row(
                "SELECT 1 FROM permission_rejections WHERE command_id=?1",
                [command],
                |_| Ok(()),
            )
            .optional()
            .map(|r| r.is_some())
            .map_err(|_| "Cannot read terminal rejection fence".into())
    }
    fn rejection(&self, command: &str) -> Result<Option<(String, Value)>, String> {
        let row: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT decision_id,submission FROM permission_rejections WHERE command_id=?1",
                [command],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|_| "Cannot read terminal rejection")?;
        row.map(|(id, body)| {
            Ok((
                id,
                serde_json::from_str(&body).map_err(|_| "Corrupt terminal rejection")?,
            ))
        })
        .transpose()
    }
    fn unaccepted_decision(&self, id: &str, command: &str) -> Result<Decision, String> {
        let all = self.all()?;
        if all.iter().flat_map(|r| &r.decisions).any(|d| {
            d.resolution
                .as_ref()
                .is_some_and(|v| v.command_id == command)
        }) {
            return Err("Response command identity conflicts".into());
        }
        let d = all
            .into_iter()
            .flat_map(|r| r.decisions)
            .find(|d| d.id == id)
            .ok_or("Unknown decision")?;
        // A dispatch/uncertain decision can never certify no acceptance.
        if d.resolution.is_some()
            || d.dispatch_ms.is_some()
            || d.delivered_ms.is_some()
            || matches!(
                d.state,
                deck2_shared::DecisionState::Responded
                    | deck2_shared::DecisionState::Dispatching
                    | deck2_shared::DecisionState::Delivered
                    | deck2_shared::DecisionState::Settled
                    | deck2_shared::DecisionState::Uncertain
            )
        {
            return Err("Decision may already have accepted a response".into());
        }
        Ok(d)
    }
    pub(crate) fn reconcile_permission(&self, id: &str, value: &Value) -> Result<Value, String> {
        if !self.conn.is_autocommit() {
            return Err("Rejection durability unavailable during transaction".into());
        }
        let (body, selection) = parse(value)?;
        if body.response != DecisionResponse::AllowSession
            || selection.as_deref().is_none_or(str::is_empty)
        {
            return Err("No scoped terminal rejection".into());
        }
        self.unaccepted_decision(id, &body.command_id)?;
        let (recorded_id, recorded) = self
            .rejection(&body.command_id)?
            .ok_or("No terminal rejection evidence")?;
        if recorded_id != id || recorded != *value {
            return Err("Response command identity conflicts".into());
        }
        Ok(
            json!({"api":API,"code":"permission_response_not_accepted","decision_id":id,
            "submission":recorded,"accepted_response":null,"terminal":true}),
        )
    }
    pub(crate) fn resolve_submission(
        &mut self,
        id: &str,
        value: &Value,
    ) -> Result<Decision, ResolveError> {
        let (body, selection) = parse(value)?;
        // Fence before scope recomputation and before any normal admission path.
        if self.rejected_response_id(&body.command_id)? {
            return Err(ResolveError::TerminalRejection);
        }
        // SAVEPOINT also composes with receipt/event persistence. The host mutex
        // protects reads, admission, tombstone creation and commit as one boundary.
        self.conn
            .execute_batch("SAVEPOINT permission_submission")
            .map_err(|_| "Cannot begin permission admission")?;
        let result = self.resolve_scope(id, &body, selection.as_deref());
        let rejection = if matches!(result, Err(ResolveError::InvalidScope)) {
            (|| -> Result<(), String> {
                if body.api != API
                    || !crate::decisions::valid_id(&body.command_id)
                    || body.response != DecisionResponse::AllowSession
                    || selection.as_deref().is_none_or(str::is_empty)
                {
                    return Err("Invalid scoped identity".into());
                }
                let d = self.unaccepted_decision(id, &body.command_id)?;
                if d.native
                    .as_ref()
                    .and_then(|n| n.permission.as_ref())
                    .is_none()
                    || !d.questions.is_empty()
                    || d.file.is_some()
                {
                    return Err("No admitted permission scope".into());
                }
                self.conn.execute("INSERT INTO permission_rejections(command_id,decision_id,submission) VALUES (?1,?2,?3)",
                    params![body.command_id,id,value.to_string()]).map_err(|_| "Cannot persist terminal rejection")?;
                Ok(())
            })()
        } else {
            Ok(())
        };
        if let Err(e) = rejection {
            let _ = self
                .conn
                .execute_batch("ROLLBACK TO permission_submission; RELEASE permission_submission");
            return Err(e.into());
        }
        if let Err(_e) = self.conn.execute_batch("RELEASE permission_submission") {
            let _ = self
                .conn
                .execute_batch("ROLLBACK TO permission_submission; RELEASE permission_submission");
            return Err("Cannot commit permission admission".into());
        }
        if matches!(result, Err(ResolveError::InvalidScope)) {
            Err(ResolveError::TerminalRejection)
        } else {
            result
        }
    }
}

// Exact shape is required: serde's enum decoder otherwise tolerates unknown
// nested fields. Do not lose unknown fields or absent/null distinctions in proof.
fn parse(value: &Value) -> Result<(Resolve, Option<String>), String> {
    let mut core = value.clone();
    let selected = core
        .as_object_mut()
        .ok_or("Invalid response")?
        .remove("scope_option_id");
    let selection = match selected {
        None => None,
        Some(Value::String(s)) => Some(s),
        _ => return Err("Invalid scope option".into()),
    };
    let body: Resolve = serde_json::from_value(core.clone()).map_err(|_| "Invalid response")?;
    if serde_json::to_value(&body).map_err(|_| "Invalid response")? != core {
        return Err("Noncanonical response fields".into());
    }
    Ok((body, selection))
}
