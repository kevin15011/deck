//! Explicit native member selection. Domain scheduling consumes only the
//! returned resource profile; protocol/process policy remains behind this edge.
use crate::tasks::digest;
use deck2_shared::{
    AdmissionSnapshot, MemberAssignment, NativeProvenance, NativeRunner, Task, TaskAttempt,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Integration {
    Codex,
    OpenCode,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ExecutionProfile {
    IndependentDedicated,
    ExclusiveDelegated,
}
impl Integration {
    pub(crate) fn select(runner: &str) -> Result<Self, String> {
        match runner {
            "codex" => Ok(Self::Codex),
            "opencode" => Ok(Self::OpenCode),
            _ => Err("Assigned member integration is unavailable; no fallback".into()),
        }
    }
    pub(crate) fn concurrent_lead(self) -> bool {
        match self { Self::Codex => true, Self::OpenCode => false }
    }
    pub(crate) fn profile(self) -> ExecutionProfile {
        match self {
            Self::Codex => ExecutionProfile::IndependentDedicated,
            Self::OpenCode => ExecutionProfile::ExclusiveDelegated,
        }
    }
    pub(crate) fn provenance(
        self,
        s: &mut AdmissionSnapshot,
        a: &MemberAssignment,
        member: &str,
        trusted: bool,
    ) -> Result<NativeProvenance, String> {
        let (runner, integration, executable, storage) = match self {
            Self::Codex => {
                if a.runner_id != "codex"
                    || s.native
                        .as_ref()
                        .is_some_and(|n| n.runner != NativeRunner::Codex)
                {
                    return Err("Codex assignment/binding mismatch".into());
                }
                (
                    "codex 0.166.0",
                    "app-server/session-mcp-member-v1",
                    s.codex_executable
                        .clone()
                        .ok_or("Admitted Codex executable missing")?,
                    "Native-owned session storage".into(),
                )
            }
            Self::OpenCode => {
                crate::connected_opencode::source::bind(s, a, member, trusted)?;
                let n = s
                    .native
                    .as_ref()
                    .ok_or("Admitted OpenCode binding missing")?;
                (
                    "opencode 1.19.1",
                    "http-sse/session-mcp-member-v1",
                    n.executable.executable.clone(),
                    n.storage.clone(),
                )
            }
        };
        Ok(NativeProvenance {
            runner: runner.into(),
            integration: integration.into(),
            executable,
            storage,
            content: digest(
                format!("{member}{}", include_str!("../assets/session-roles.json")).as_bytes(),
            ),
        })
    }
    pub(crate) fn for_receipt(r: &deck2_shared::Receipt) -> Result<Self, String> {
        let s = r.configuration.as_ref().ok_or("Root admission missing")?;
        let selected = if r.mode == deck2_shared::Mode::SessionV1 {
            Self::select(
                &s.session_contract
                    .as_ref()
                    .and_then(|c| c.members.get("lead"))
                    .ok_or("Immutable Lead assignment missing")?
                    .runner_id,
            )?
        } else if s.codex_executable.is_some() {
            // Versioned legacy Codex admission, never inferred from a model name.
            Self::Codex
        } else {
            return Err("Legacy root integration evidence unavailable".into());
        };
        match selected {
            Self::Codex
                if s.codex_executable.is_some()
                    && s.native
                        .as_ref()
                        .is_none_or(|n| n.runner == NativeRunner::Codex) =>
            {
                Ok(selected)
            }
            Self::OpenCode if crate::connected_opencode::admitted(s) => Ok(selected),
            _ => Err("Root native evidence does not match its selected integration".into()),
        }
    }
    pub(crate) fn for_attempt(t: &Task, a: &TaskAttempt) -> Result<Self, String> {
        let s = a.configuration.as_ref().ok_or("Member admission missing")?;
        let assignment = s
            .session_contract
            .as_ref()
            .and_then(|c| c.members.get(&t.owner))
            .ok_or("Immutable member assignment missing")?;
        let selected = Self::select(&assignment.runner_id)?;
        if assignment.model_id != a.requested_model {
            return Err("Member model differs from immutable assignment".into());
        }
        let valid = match selected {
            Self::Codex => {
                a.provenance.runner == "codex 0.166.0"
                    && a.provenance.integration == "app-server/session-mcp-member-v1"
                    && s.codex_executable.as_ref() == Some(&a.provenance.executable)
                    && s.native
                        .as_ref()
                        .is_none_or(|n| n.runner == NativeRunner::Codex)
            }
            Self::OpenCode => {
                crate::connected_opencode::admitted(s)
                    && a.provenance.runner == "opencode 1.19.1"
                    && a.provenance.integration == "http-sse/session-mcp-member-v1"
                    && s.native
                        .as_ref()
                        .is_some_and(|n| n.executable.executable == a.provenance.executable)
            }
        };
        if !valid {
            return Err("Member native evidence does not match its selected integration".into());
        }
        Ok(selected)
    }
}
pub(crate) fn profile(t: &Task, a: &TaskAttempt) -> Result<ExecutionProfile, String> {
    Ok(Integration::for_attempt(t, a)?.profile())
}

/// Selection is explicit even when only one integration is delivery-qualified.
pub(crate) fn resolve_model(
    models: &serde_json::Value,
    a: &MemberAssignment,
    fallback: Option<&str>,
) -> Result<(String, Option<String>), String> {
    match Integration::select(&a.runner_id)? {
        Integration::Codex => crate::codex_protocol::resolve_model(models, a, fallback),
        Integration::OpenCode => crate::connected_opencode::resolve_public_model(models, a),
    }
}

/// Read compatibility does not reconstruct unknown historical launch authority.
pub(crate) fn snapshot_runner_matches(
    s: &AdmissionSnapshot,
    c: &crate::configuration::Configuration,
) -> bool {
    (s.runner == c.runner || crate::connected_opencode::admitted(s))
        && s.codex_executable == c.codex_executable
}
