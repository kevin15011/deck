//! Session consent is actor-bound host authority, never a native persistent cache.
//! Explicit host-offered bounds coexist with safe legacy exact consent.
use crate::Store;
use deck2_shared::{
    Decision, DecisionResponse, DecisionState, NativeTransport, PermissionProvenance,
    PermissionScope,
};
use serde_json::{Value, json};

impl Store {
    pub(crate) fn resolve_scope(
        &mut self,
        id: &str,
        response: &deck2_shared::Resolve,
        selection: Option<&str>,
    ) -> Result<Decision, crate::decisions::ResolveError> {
        let Some(selected) = selection else {
            return self.resolve(id, response);
        };
        let d = self
            .all()?
            .into_iter()
            .flat_map(|r| r.decisions)
            .find(|d| d.id == id)
            .ok_or("Unknown decision")?;
        let recorded = d.native.as_ref().and_then(|n| n.permission.as_ref());
        if d.resolution.is_some() {
            // Retry equality uses immutable admission evidence, even after
            // restart or revocation changes the currently available authority.
            return self.resolve_selected(id, response, selection);
        }
        let scope = self.permission_scope(&d)?.ok_or(crate::decisions::ResolveError::InvalidScope)?;
        if !self.permission_current(&d)?
            || response.response != DecisionResponse::AllowSession
            || response.expected_revision != d.revision
            || recorded.is_none_or(|p| !same_scope(p, &scope))
            || (selected != scope.option_id
                && !recorded.is_some_and(|p| {
                    p.options
                        .iter()
                        .any(|o| o.id == selected && scope.options.contains(o))
                }))
        {
            return Err(crate::decisions::ResolveError::InvalidScope);
        }
        self.resolve_selected(
            id,
            response,
            if selected == scope.option_id {
                None
            } else {
                Some(selected)
            },
        )
    }
    /// Reconstruct exclusively from persisted admission, not a caller's actor claim.
    pub(crate) fn permission_scope(&self, d: &Decision) -> Result<Option<PermissionScope>, String> {
        let Some(n) = &d.native else { return Ok(None) };
        if !d.questions.is_empty() || d.file.is_some() || n.identity.is_none() {
            return Ok(None);
        }
        if !matches!(
            n.transport,
            Some(NativeTransport::CodexJsonRpc | NativeTransport::DeckMcp | NativeTransport::ClaudeSdk)
        ) {
            return Ok(None);
        }
        crate::native_approval::validate_native(d)?;
        let Some(material) = crate::native_approval::permission_material(d) else {
            return Ok(None);
        };
        let root = self.get(&d.command)?.ok_or("Permission origin missing")?;
        if root.session != d.session || root.mode != deck2_shared::Mode::SessionV1 {
            return Ok(None);
        }
        let (role, snapshot) = if let Some(id) = &d.task {
            let Ok(t) = self.task(id) else {
                return Ok(None);
            };
            let Some(a) = t
                .attempts
                .iter()
                .find(|a| a.id == d.attempt && a.generation == d.generation)
            else {
                return Ok(None);
            };
            if t.session != d.session || t.authority_root(a) != d.command {
                return Ok(None);
            }
            (t.owner, a.configuration.clone())
        } else {
            if d.attempt != root.attempt
                || d.generation != root.generation
                || root.thread.as_deref() != Some(&d.thread)
                || root.turn.as_deref() != Some(&d.turn)
            {
                return Ok(None);
            }
            ("lead".into(), root.configuration.clone())
        };
        let Some(snapshot) = snapshot else {
            return Ok(None);
        };
        let Some(c) = &snapshot.session_contract else {
            return Ok(None);
        };
        let Some(assignment) = c.members.get(&role) else {
            return Ok(None);
        };
        // Read-only members can reuse user-granted MCP consent. Their workspace
        // and other relay permissions retain their existing adapter restrictions.
        if matches!(role.as_str(), "investigate" | "quality")
            && !(assignment.runner_id == crate::claude::RUNNER
                && material["category"] == "relay"
                && material["request"]["toolName"].as_str()
                    .is_some_and(crate::permission_bounds::claude_mcp_tool))
        {
            return Ok(None);
        }
        if n.transport == Some(NativeTransport::ClaudeSdk)
            && (role != "lead" || assignment.runner_id != crate::claude::RUNNER)
        {
            return Ok(None);
        }
        if snapshot.project.id.is_empty()
            || !crate::session_contract::MEMBERS.contains(&role.as_str())
        {
            return Ok(None);
        }
        let actor = json!({"project":snapshot.project,"session":d.session,"generation":c.generation,"revocation":c.grants_revoked_at,"role":role,"assignment_revision":c.revision,"assignment":assignment,"lead_task":c.lead_task});
        // Stable admission evidence, not PID, native thread, task text or MCP URL/secret.
        let issuer = json!({"transport":n.transport,"native":snapshot.native,"runner":snapshot.runner,"codex_executable":snapshot.codex_executable,"definitions":snapshot.definitions,"exclusions":snapshot.exclusions,"configuration_revision":snapshot.revision,"selection":snapshot.selection,"graph":snapshot.cbm,"helper":snapshot.helper});
        let option_id = format!(
            "exact-v1-{}",
            crate::tasks::digest(json!([1, actor, issuer, material]).to_string().as_bytes())
        );
        let mut scope = PermissionScope {
            options: Vec::new(),
            selected_option: None,
            version: 1,
            actor,
            issuer,
            material,
            option_id,
        };
        if crate::permission_bounds::fresh_command_required(&scope) {
            return Ok(None);
        }
        scope.options = crate::permission_bounds::options(d, &scope);
        Ok(Some(scope))
    }
    pub(crate) fn bind_permission(&self, d: &mut Decision) -> Result<(), String> {
        let scope = self.permission_scope(d)?;
        if let Some(n) = &mut d.native {
            n.permission = scope;
        }
        Ok(())
    }
    /// Current authority is checked again under the Store lock at dispatch intent.
    pub(crate) fn permission_current(&self, d: &Decision) -> Result<bool, String> {
        let Some(scope) = self.permission_scope(d)? else {
            // Existing OpenCode behavior is not promoted to new cross-runner scope.
            return Ok(d.native.as_ref().is_none_or(|n| n.permission.is_none())); // No reusable scope: ordinary one-action checks still apply.
        };
        let s = self.session_by_id(&d.session)?;
        let Some(c) = s.contract else {
            return Ok(false);
        };
        if scope.issuer["transport"] == json!(NativeTransport::ClaudeSdk)
            && !self.trusted_project(&self.execution_project(&d.session)?.root)?
        {
            return Ok(false);
        }
        if scope.actor["generation"] != c.generation
            || scope.actor["revocation"] != c.grants_revoked_at
            || scope.actor["lead_task"] != c.lead_task
            || scope.actor["project"] != json!(self.execution_project(&d.session)?)
        {
            return Ok(false);
        }
        if let Some(recorded) = d.native.as_ref().and_then(|n| n.permission.as_ref()) {
            if !same_scope(recorded, &scope)
                || recorded.selected_option.is_some()
                    && !crate::permission_bounds::contains(d, recorded, &scope, d, &scope)
            {
                return Ok(false);
            }
            if let Some(PermissionProvenance::ReusedGrant { source_decision }) = d
                .native
                .as_ref()
                .and_then(|n| n.resolution_provenance.as_ref())
            {
                return Ok(self.grant_source(d)?.as_deref() == Some(source_decision));
            }
        }
        Ok(true)
    }
    /// Only original delivered explicit consent activates a grant. Automatic
    /// AllowOnce replies never extend consent or become another grant source.
    pub(crate) fn grant_source(&self, d: &Decision) -> Result<Option<String>, String> {
        let Some(wanted) = self.permission_scope(d)? else {
            return Ok(None);
        };
        let s = self.session_by_id(&d.session)?;
        let Some(c) = s.contract else { return Ok(None) };
        if wanted.actor["generation"] != c.generation
            || wanted.actor["revocation"] != c.grants_revoked_at
            || wanted.actor["lead_task"] != c.lead_task
            || wanted.actor["project"] != json!(self.execution_project(&d.session)?)
        {
            return Ok(None);
        }
        for r in self.all()?.into_iter().filter(|r| r.session == d.session) {
            for source in r.decisions {
                if !matches!(
                    source.state,
                    DecisionState::Delivered | DecisionState::Settled
                ) || source.delivered_ms.is_none()
                    || source
                        .resolution
                        .as_ref()
                        .is_none_or(|r| r.response != DecisionResponse::AllowSession)
                {
                    continue;
                }
                let Ok(Some(reconstructed)) = self.permission_scope(&source) else {
                    continue;
                };
                let recorded = source.native.as_ref().and_then(|n| n.permission.as_ref());
                if source.native.as_ref().is_some_and(|n| n.transport == Some(NativeTransport::ClaudeSdk))
                    && (!source.grant_consumed || recorded.is_none())
                {
                    continue;
                }
                if let Some(recorded) = recorded
                    && (source
                        .native
                        .as_ref()
                        .and_then(|n| n.resolution_provenance.as_ref())
                        != Some(&PermissionProvenance::User)
                        || !same_scope(recorded, &reconstructed))
                {
                    continue;
                }
                if let Some(recorded) = recorded
                    && recorded.selected_option.is_some()
                {
                    if recorded.actor == wanted.actor
                        && recorded.issuer == wanted.issuer
                        && crate::permission_bounds::contains(
                            &source,
                            recorded,
                            &reconstructed,
                            d,
                            &wanted,
                        )
                    {
                        return Ok(Some(source.id));
                    }
                    continue;
                }
                // The admitted actor includes the exact assignment and its revision.
                // Legacy and bare AllowSession also require the retained native identity.
                if source.native.as_ref().and_then(|n| n.identity.as_ref())
                    == d.native.as_ref().and_then(|n| n.identity.as_ref())
                    && same_scope(&reconstructed, &wanted)
                {
                    return Ok(Some(source.id));
                }
            }
        }
        Ok(None)
    }
    pub(crate) fn reuse_permission(&self, d: &mut Decision) -> Result<bool, String> {
        let Some(source_decision) = self.grant_source(d)? else {
            return Ok(false);
        };
        self.bind_permission(d)?;
        if let Some(n) = &mut d.native {
            n.resolution_provenance = Some(PermissionProvenance::ReusedGrant {
                source_decision: source_decision.clone(),
            });
        }
        d.resolution = Some(deck2_shared::Resolve {
            api: deck2_shared::API,
            command_id: uuid::Uuid::new_v4().to_string(),
            expected_revision: d.revision,
            response: DecisionResponse::AllowOnce,
        });
        d.state = DecisionState::Responded;
        d.detail = "Automatic reply from delivered session consent; no new user consent".into();
        Ok(true)
    }
    /// Reconsider already-open requests only after consent becomes delivered.
    /// Denied/resolved decisions are never overwritten.
    pub(crate) fn reconsider_permission(&mut self, root: &str, id: &str) -> Result<(), String> {
        let mut r = self.get(root)?.ok_or("Permission origin missing")?;
        if r.cancel_requested {
            return Ok(());
        }
        if let Some(d) = r
            .decisions
            .iter_mut()
            .find(|d| d.id == id && d.state == DecisionState::Pending)
            && self.reuse_permission(d)?
        {
            self.save(&mut r)?;
        }
        Ok(())
    }
}
fn same_scope(a: &PermissionScope, b: &PermissionScope) -> bool {
    a.version == 1
        && b.version == 1
        && a.actor == b.actor
        && a.issuer == b.issuer
        && a.material == b.material
        && a.option_id == b.option_id
}
pub(crate) fn intrinsic(d: &mut Decision) {
    if let Some(n) = &mut d.native {
        n.resolution_provenance = Some(PermissionProvenance::Intrinsic);
    }
}
/// Bounded additive UI contract: opaque selection, never client-authored scopes.
pub(crate) fn view(d: &Decision) -> Option<Value> {
    let p = d.native.as_ref()?.permission.as_ref()?;
    let expected = format!(
        "exact-v1-{}",
        crate::tasks::digest(
            json!([1, p.actor, p.issuer, p.material])
                .to_string()
                .as_bytes()
        )
    );
    if p.version != 1
        || p.option_id != expected
        || p.actor["role"]
            .as_str()
            .is_none_or(|r| !crate::session_contract::MEMBERS.contains(&r))
        || !matches!(
            p.material["category"].as_str(),
            Some(
                "command"
                    | "files"
                    | "permissions"
                    | "mcp"
                    | "relay"
                    | "claude_workspace_read"
                    | "historical_delegation_role"
            )
        )
    {
        return None;
    }
    let lifetime = "Valid for the matching admitted assignment and revision across reconnects and host restart until revoked or the session authority is replaced.";
    let exact_description = if p.material["category"] == "claude_workspace_read" {
        "Exact Claude tool, inputs and workspace target for this actor."
    } else {
        "Exact material request for this actor."
    };
    let mut options = vec![
        json!({"id":p.option_id,"kind":"exact","category":p.material["category"],"label":"This exact request","description":format!("{exact_description} {lifetime}"),"survives_host_restart":true,"revocation":"deck_session","lifetime":"canonical_session","actor":p.actor["role"]}),
    ];
    let fresh = crate::permission_bounds::options(d, p);
    for o in &p.options {
        if fresh.contains(o) {
            options.push(json!({"id":o.id,"kind":o.kind,"category":p.material["category"],"label":o.label,"description":format!("{} {lifetime}",o.description),"actor":p.actor["role"],"lifetime":"canonical_session","survives_host_restart":true,"revocation":"deck_session"}));
        }
    }
    Some(
        json!({"version":1,"options":options,"selected_option_id":p.selected_option,"provenance":d.native.as_ref()?.resolution_provenance,
        "unsupported":if fresh.is_empty(){json!(["No broader effect policy is qualified for this request; session consent stays exact."])}else{json!([])}}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use deck2_shared::{API, Phase, Receipt, Resolve};
    fn request(
        s: &Store,
        r: &Receipt,
        task: Option<&str>,
        id: u64,
        method: &str,
        mut params: Value,
    ) -> Decision {
        let mut caller = r.clone();
        if let Some(id) = task {
            let t = s.task(id).unwrap();
            let a = t.attempts.last().unwrap();
            caller.attempt = a.id.clone();
            caller.generation = a.generation.clone();
            caller.thread = a.native_session.clone();
            caller.turn = a.native_message.clone();
        }
        params["threadId"] = json!(caller.thread);
        params["turnId"] = json!(caller.turn);
        let mut d = crate::codex_protocol::native_decision(
            &caller,
            &caller.generation,
            caller.thread.as_deref().unwrap(),
            caller.turn.as_deref().unwrap(),
            &json!({"id":id,"method":method,"params":params}),
        )
        .unwrap();
        d.task = task.map(str::to_owned);
        s.bind_permission(&mut d).unwrap();
        d
    }
    fn command() -> Value {
        json!({"itemId":"one","command":"cargo test","cwd":"/project","environment":{"MODE":"test"},"additionalPermissions":{"network":false}})
    }
    fn add(s: &mut Store, d: &Decision) {
        let mut r = s.get(&d.command).unwrap().unwrap();
        r.decisions.push(d.clone());
        s.save(&mut r).unwrap();
    }
    fn consent(s: &mut Store, d: &Decision) {
        let option = d
            .native
            .as_ref()
            .unwrap()
            .permission
            .as_ref()
            .unwrap()
            .option_id
            .clone();
        consent_selected(s, d, &option);
    }
    fn consent_selected(s: &mut Store, d: &Decision, option: &str) {
        add(s, d);
        let response = Resolve {
            api: API,
            command_id: uuid::Uuid::new_v4().to_string(),
            expected_revision: d.revision,
            response: DecisionResponse::AllowSession,
        };
        s.resolve_scope(&d.id, &response, Some(option)).unwrap();
        assert!(
            !s.session_grant(d).unwrap(),
            "recorded consent is not delivery"
        );
        if let Some(task) = &d.task {
            s.authorize_member_response(&d.command, &d.id, task, &d.attempt)
                .unwrap()
                .unwrap();
        } else {
            s.authorize_response(&d.command, &d.id, &d.generation)
                .unwrap()
                .unwrap();
        }
        assert!(
            !s.session_grant(d).unwrap(),
            "dispatch intent is not delivery"
        );
        let mut r = s.get(&d.command).unwrap().unwrap();
        let current = r.decisions.iter_mut().find(|v| v.id == d.id).unwrap();
        current.state = DecisionState::Delivered;
        current.delivered_ms = Some(crate::now());
        s.save(&mut r).unwrap();
        assert_eq!(s.grant_source(d).unwrap(), Some(d.id.clone()));
    }
    fn member(s: &mut Store, r: &Receipt, role: &str, call: &str) -> String {
        let id = crate::session_tasks::tool(
            s,
            &r.id,
            "deck_delegate",
            &json!({"agent":role,"task":"Permission fixture"}),
            call,
        )
        .unwrap()["taskId"]
            .as_str()
            .unwrap()
            .to_string();
        let mut t = s.task(&id).unwrap();
        let a = t.attempts.last_mut().unwrap();
        a.phase = Phase::Running;
        a.native_session = Some("member-thread".into());
        a.native_message = Some("member-turn".into());
        s.save_task(&t).unwrap();
        id
    }
    // Oracle: explicit delivered consent authorizes exactly the admitted actor
    // and complete action. A changed correlation may vary; effects may not.
    #[tokio::test]
    async fn exact_scope_is_actor_isolated_and_material_complete() {
        let (_dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let first = request(
            &s,
            &r,
            None,
            1,
            "item/commandExecution/requestApproval",
            command(),
        );
        consent(&mut s, &first);
        let mut next = request(
            &s,
            &r,
            None,
            2,
            "item/commandExecution/requestApproval",
            command(),
        );
        assert!(s.reuse_permission(&mut next).unwrap());
        assert_eq!(
            next.native.as_ref().unwrap().resolution_provenance,
            Some(PermissionProvenance::ReusedGrant {
                source_decision: first.id.clone()
            })
        );
        assert_eq!(
            next.resolution.as_ref().unwrap().response,
            DecisionResponse::AllowOnce
        );
        for (key, value) in [
            ("environment", json!({"MODE":"production"})),
            ("additionalPermissions", json!({"network":true})),
            ("cwd", json!("/other")),
            ("executionKind", json!("shell")),
            ("unknownFuturePermission", json!(true)),
        ] {
            let mut p = command();
            p[key] = value;
            assert!(
                !s.session_grant(&request(
                    &s,
                    &r,
                    None,
                    3,
                    "item/commandExecution/requestApproval",
                    p
                ))
                .unwrap(),
                "changed {key}"
            );
        }
        let task = member(&mut s, &r, "apply-deep", "member-a");
        let child = request(
            &s,
            &r,
            Some(&task),
            4,
            "item/commandExecution/requestApproval",
            command(),
        );
        assert!(
            !s.session_grant(&child).unwrap(),
            "Lead consent cannot flow to a member"
        );
        consent(&mut s, &child);
        let mut t = s.task(&task).unwrap();
        t.attempts[0].phase = Phase::Completed;
        s.save_task(&t).unwrap();
        let task2 = member(&mut s, &r, "apply-deep", "member-b");
        let mut later = request(
            &s,
            &r,
            Some(&task2),
            5,
            "item/commandExecution/requestApproval",
            command(),
        );
        assert!(
            s.reuse_permission(&mut later).unwrap(),
            "same configured actor across tasks can reuse"
        );
        add(&mut s, &later);
        s.revoke_session_grants(&r.session).unwrap();
        assert!(
            s.authorize_member_response(&r.id, &later.id, &task2, &later.attempt)
                .unwrap()
                .is_none()
        );
    }
    #[tokio::test]
    async fn pending_reuse_denial_and_final_revocation_are_serialized() {
        let (_dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let first = request(
            &s,
            &r,
            None,
            1,
            "item/commandExecution/requestApproval",
            command(),
        );
        let pending = request(
            &s,
            &r,
            None,
            2,
            "item/commandExecution/requestApproval",
            command(),
        );
        add(&mut s, &pending);
        let denied = request(
            &s,
            &r,
            None,
            3,
            "item/commandExecution/requestApproval",
            command(),
        );
        add(&mut s, &denied);
        s.resolve(
            &denied.id,
            &Resolve {
                api: API,
                command_id: "explicit-denial".into(),
                expected_revision: 1,
                response: DecisionResponse::Deny,
            },
        )
        .unwrap();
        consent(&mut s, &first);
        let released = s
            .authorize_response(&r.id, &pending.id, &r.generation)
            .unwrap()
            .unwrap();
        assert!(matches!(
            released.native.unwrap().resolution_provenance,
            Some(PermissionProvenance::ReusedGrant { .. })
        ));
        let denied = s
            .authorize_response(&r.id, &denied.id, &r.generation)
            .unwrap()
            .unwrap();
        assert_eq!(denied.resolution.unwrap().response, DecisionResponse::Deny);
        let mut next = request(
            &s,
            &r,
            None,
            4,
            "item/commandExecution/requestApproval",
            command(),
        );
        s.reuse_permission(&mut next).unwrap();
        add(&mut s, &next);
        s.revoke_session_grants(&r.session).unwrap();
        assert!(
            s.authorize_response(&r.id, &next.id, &r.generation)
                .unwrap()
                .is_none()
        );
        let recorded = s
            .get(&r.id)
            .unwrap()
            .unwrap()
            .decisions
            .into_iter()
            .find(|d| d.id == first.id)
            .unwrap();
        let response = recorded.resolution.as_ref().unwrap();
        let option = &recorded
            .native
            .as_ref()
            .unwrap()
            .permission
            .as_ref()
            .unwrap()
            .option_id;
        assert!(
            s.resolve_scope(&first.id, response, Some(option)).is_ok(),
            "exact response retry must remain idempotent after revocation"
        );
        assert!(
            s.authorize_response(&r.id, &first.id, &r.generation)
                .unwrap()
                .is_none(),
            "retry never releases old RPC"
        );
    }
    // Oracle R127-Q01: intrinsic origin is durable audit data, including when
    // dispatch has no delivery acknowledgement. Restart must never invent origin
    // for historical records or replay an uncertain native RPC.
    #[tokio::test]
    async fn intrinsic_dispatch_reopen_retains_origin_and_legacy_absence() {
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let mut d = request(&s, &r, None, 81, "mcpServer/elicitation/request", json!({
            "serverName":"deck-session", "toolName":"deck_delegate", "mode":"form",
            "requestedSchema":{"type":"object","properties":{}},
            "_meta":{"codex_approval_kind":"mcp_tool_call","tool_params":{"agent":"apply-deep","task":"Inspect"}}
        }));
        intrinsic(&mut d);
        d.resolution = Some(Resolve { api: API, command_id: "intrinsic-reply".into(), expected_revision: d.revision, response: DecisionResponse::AllowOnce });
        d.state = DecisionState::Responded;
        add(&mut s, &d);
        let dispatched = s.authorize_response(&r.id, &d.id, &r.generation).unwrap().unwrap();
        assert_eq!(dispatched.state, DecisionState::Dispatching);
        assert!(dispatched.dispatch_ms.is_some());
        assert!(dispatched.delivered_ms.is_none());
        assert_eq!(dispatched.native.as_ref().unwrap().resolution_provenance, Some(PermissionProvenance::Intrinsic));
        let persisted = s.get(&r.id).unwrap().unwrap();
        assert_eq!(persisted.decisions[0], dispatched);
        for legacy in [false, true] {
            let db = dir.path().join(if legacy { "legacy-origin.db" } else { "intrinsic-origin.db" });
            s.conn.backup("main", &db, None).unwrap();
            if legacy {
                // Historical JSON genuinely omits the field; this is not null.
                let conn = rusqlite::Connection::open(&db).unwrap();
                conn.execute("UPDATE receipts SET body=json_remove(body,'$.decisions[0].native.resolution_provenance') WHERE id=?1", [&r.id]).unwrap();
            }
            let mut reopened = Store::open(&db, &s.project).unwrap();
            let recovered = reopened.get(&r.id).unwrap().unwrap();
            assert_eq!(recovered.phase, Phase::Uncertain);
            let observed = &recovered.decisions[0];
            assert_eq!(observed.state, DecisionState::Uncertain);
            assert_eq!(observed.dispatch_ms, dispatched.dispatch_ms);
            assert!(observed.delivered_ms.is_none());
            assert_eq!(observed.native.as_ref().unwrap().resolution_provenance, if legacy { None } else { Some(PermissionProvenance::Intrinsic) });
            assert!(reopened.authorize_response(&r.id, &d.id, &r.generation).unwrap().is_none());
            assert!(reopened.grant_source(observed).unwrap().is_none());
            drop(reopened);
            let reopened = Store::open(&db, &s.project).unwrap();
            assert_eq!(reopened.get(&r.id).unwrap().unwrap().decisions, recovered.decisions);
        }
    }

    #[tokio::test]
    async fn delivered_scope_survives_host_restart_without_replaying_old_request() {
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let first = request(
            &s,
            &r,
            None,
            1,
            "item/commandExecution/requestApproval",
            command(),
        );
        consent(&mut s, &first);
        let pending = request(
            &s,
            &r,
            None,
            2,
            "item/commandExecution/requestApproval",
            command(),
        );
        add(&mut s, &pending);
        let task = member(&mut s, &r, "apply-deep", "restart-member");
        let child = request(
            &s,
            &r,
            Some(&task),
            3,
            "item/commandExecution/requestApproval",
            command(),
        );
        consent(&mut s, &child);
        let db = dir.path().join("restart.db");
        s.conn.backup("main", &db, None).unwrap();
        let mut reopened = Store::open(&db, &s.project).unwrap();
        assert!(
            reopened.session_grant(&first).unwrap(),
            "delivered consent was lost on restart"
        );
        assert!(
            reopened
                .authorize_response(&r.id, &pending.id, &r.generation)
                .unwrap()
                .is_none(),
            "old RPC must not replay"
        );
        assert!(
            reopened.session_grant(&child).unwrap(),
            "delivered member consent survives restart"
        );
        assert!(
            matches!(
                reopened.authorize_member_response(&r.id, &child.id, &task, &child.attempt),
                Err(_) | Ok(None)
            ),
            "old member RPC must not replay"
        );
        let source = reopened.get(&r.id).unwrap().unwrap();
        assert_eq!(source.decisions[0].state, DecisionState::Delivered);
        assert_eq!(source.decisions[1].state, DecisionState::Invalidated);
        let mut session = reopened.session_by_id(&r.session).unwrap();
        session.contract.as_mut().unwrap().generation += 1;
        reopened.save_session(&session).unwrap();
        assert!(
            !reopened.session_grant(&first).unwrap(),
            "true canonical reseed invalidates consent"
        );
    }
    #[tokio::test]
    async fn legacy_and_scope_selection_fail_closed_without_widening() {
        let (_dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let first = request(
            &s,
            &r,
            None,
            1,
            "item/commandExecution/requestApproval",
            command(),
        );
        add(&mut s, &first);
        let response = Resolve {
            api: API,
            command_id: "select-exact-scope".into(),
            expected_revision: 1,
            response: DecisionResponse::AllowSession,
        };
        assert!(
            s.resolve_scope(&first.id, &response, Some("invented-prefix-scope"))
                .is_err()
        );
        let option = &first
            .native
            .as_ref()
            .unwrap()
            .permission
            .as_ref()
            .unwrap()
            .option_id;
        s.resolve_scope(&first.id, &response, Some(option)).unwrap();
        let mut r = s.get(&r.id).unwrap().unwrap();
        let n = r.decisions[0].native.as_mut().unwrap();
        n.permission = None;
        n.resolution_provenance = None;
        r.decisions[0].state = DecisionState::Delivered;
        r.decisions[0].delivered_ms = Some(crate::now());
        s.save(&mut r).unwrap();
        assert!(
            s.session_grant(&first).unwrap(),
            "provable exact legacy consent remains exact"
        );
        let mut unsafe_material = command();
        unsafe_material["environment"] = json!({"MODE":"production"});
        assert!(
            !s.session_grant(&request(
                &s,
                &r,
                None,
                2,
                "item/commandExecution/requestApproval",
                unsafe_material
            ))
            .unwrap()
        );
        let mut missing = r.clone();
        missing.decisions[0].task = Some("missing-original-actor".into());
        // Inject legacy evidence without a task ledger row; public writes reject it.
        s.conn
            .execute(
                "UPDATE receipts SET body=?1 WHERE id=?2",
                rusqlite::params![serde_json::to_string(&missing).unwrap(), r.id],
            )
            .unwrap();
        assert!(
            !s.session_grant(&first).unwrap(),
            "missing actor must not be guessed as Lead"
        );
        let mut unknown = r.clone();
        unknown.decisions[0].native.as_mut().unwrap().permission =
            first.native.as_ref().unwrap().permission.clone();
        unknown.decisions[0]
            .native
            .as_mut()
            .unwrap()
            .permission
            .as_mut()
            .unwrap()
            .version = 99;
        s.conn
            .execute(
                "UPDATE receipts SET body=?1 WHERE id=?2",
                rusqlite::params![serde_json::to_string(&unknown).unwrap(), r.id],
            )
            .unwrap();
        assert!(
            !s.session_grant(&first).unwrap(),
            "unknown version cannot authorize"
        );
        let mut pending = request(
            &s,
            &r,
            None,
            40,
            "item/commandExecution/requestApproval",
            command(),
        );
        pending
            .native
            .as_mut()
            .unwrap()
            .permission
            .as_mut()
            .unwrap()
            .version = 99;
        let shown = crate::execution_view::decision(&pending);
        assert!(
            shown["responses"]
                .as_array()
                .unwrap()
                .contains(&json!("allow_once"))
        );
        assert!(
            !shown["responses"]
                .as_array()
                .unwrap()
                .contains(&json!("allow_session"))
        );
        add(&mut s, &pending);
        s.resolve(
            &pending.id,
            &Resolve {
                api: API,
                command_id: "unsupported-scope-explicit-once".into(),
                expected_revision: 1,
                response: DecisionResponse::AllowOnce,
            },
        )
        .expect("unsupported scope must not disable an otherwise valid per-action response");
        assert!(
            s.authorize_response(&r.id, &pending.id, &r.generation)
                .unwrap()
                .is_some()
        );
        assert!(!s.session_grant(&pending).unwrap());
    }
    #[tokio::test]
    async fn exact_categories_reject_changed_material_and_uncertain_sources() {
        let (_dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let cases = [
            (
                "item/fileChange/requestApproval",
                json!({"itemId":"f1","changes":[{"path":"/project/a","kind":{"type":"update"},"diff":"first"}]}),
                "changes",
                json!([{"path":"/project/outside","kind":{"type":"delete"},"diff":"first"}]),
            ),
            (
                "item/permissions/requestApproval",
                json!({"permissions":{"network":{"enabled":false}},"cwd":"/project"}),
                "permissions",
                json!({"network":{"enabled":true}}),
            ),
            (
                "mcpServer/elicitation/request",
                json!({"serverName":"configured","toolName":"read","mode":"form","requestedSchema":{"type":"object","properties":{}},"_meta":{"codex_approval_kind":"mcp_tool_call","tool_params":{"resource_id":"one"},"schemaIdentity":"v1"}}),
                "_meta",
                json!({"codex_approval_kind":"mcp_tool_call","tool_params":{"resource_id":"two"},"schemaIdentity":"v1"}),
            ),
        ];
        for (i, (method, params, key, value)) in cases.into_iter().enumerate() {
            let id = 100 + i as u64 * 10;
            let source = request(&s, &r, None, id, method, params.clone());
            consent(&mut s, &source);
            assert!(
                s.session_grant(&request(&s, &r, None, id + 1, method, params.clone()))
                    .unwrap()
            );
            let mut changed = params;
            changed[key] = value;
            assert!(
                !s.session_grant(&request(&s, &r, None, id + 2, method, changed))
                    .unwrap()
            );
            let mut stored = s.get(&r.id).unwrap().unwrap();
            stored
                .decisions
                .iter_mut()
                .find(|d| d.id == source.id)
                .unwrap()
                .state = DecisionState::Uncertain;
            s.save(&mut stored).unwrap();
            assert!(
                !s.session_grant(&source).unwrap(),
                "uncertain response is not consent"
            );
        }
    }

    #[tokio::test]
    async fn assignment_edits_preserve_admitted_consent_and_fence_new_admissions() {
        let (_dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let task = member(&mut s, &r, "apply-deep", "assignment-member");
        let method = "item/commandExecution/requestApproval";
        let lead_grant = request(&s, &r, None, 200, method, command());
        let member_grant = request(&s, &r, Some(&task), 201, method, command());
        consent(&mut s, &lead_grant);
        consent(&mut s, &member_grant);
        let lead_pending = request(&s, &r, None, 202, method, command());
        let member_pending = request(&s, &r, Some(&task), 203, method, command());
        add(&mut s, &lead_pending);
        add(&mut s, &member_pending);

        let changed = s.assign_member(
            &r.session,
            "apply-deep",
            deck2_shared::MemberAssignment {
                runner_id: "codex".into(),
                model_id: "recorded-worker".into(),
                thinking: Some("high".into()),
            },
            1,
        ).unwrap();
        assert_eq!(changed.contract.unwrap().revision, 2);
        let stale_reply = Resolve {
            api: API,
            command_id: "stale-selected-scope".into(),
            expected_revision: lead_grant.revision,
            response: DecisionResponse::AllowSession,
        };
        let scope = lead_grant.native.as_ref().unwrap().permission.as_ref().unwrap();
        assert!(s.resolve_scope(&lead_grant.id, &stale_reply, Some(&scope.option_id)).is_err());
        let lead_release = s.authorize_response(&r.id, &lead_pending.id, &r.generation)
            .unwrap().unwrap();
        let member_release = s.authorize_member_response(&r.id, &member_pending.id, &task, &member_pending.attempt)
            .unwrap().unwrap();
        for (released, grant) in [(lead_release, lead_grant), (member_release, member_grant)] {
            assert_eq!(
                released.native.unwrap().resolution_provenance,
                Some(PermissionProvenance::ReusedGrant { source_decision: grant.id }),
            );
        }

        let mut settled = s.get(&r.id).unwrap().unwrap();
        settled.phase = Phase::Completed;
        s.save(&mut settled).unwrap();
        let mut settled = s.task(&task).unwrap();
        settled.attempts[0].phase = Phase::Completed;
        settled.attempts[0].settled_ms = Some(crate::now());
        s.save_task(&settled).unwrap();
        let submit = serde_json::from_value(json!({"api":API,"id":"new-assignment-root","session":r.session,
            "mode":"session_v1","prompt":"Fresh work after the assignment changed"})).unwrap();
        let mut fresh = s.admit(&submit).unwrap();
        fresh.phase = Phase::Running;
        fresh.thread = Some("fresh-thread".into());
        fresh.turn = Some("fresh-turn".into());
        s.save(&mut fresh).unwrap();
        let fresh_task = member(&mut s, &fresh, "apply-deep", "new-assignment-member");
        let fresh_lead = request(&s, &fresh, None, 204, method, command());
        let fresh_member = request(&s, &fresh, Some(&fresh_task), 205, method, command());
        assert!(!s.session_grant(&fresh_lead).unwrap());
        assert!(!s.session_grant(&fresh_member).unwrap());
    }

    #[tokio::test]
    async fn quality_regression_project_retrust_does_not_restore_grants() {
        let (_dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut store = app.store.lock().unwrap();
        store.set_trust(&app.project, true).unwrap();
        let mut root = store.get("coordination-root").unwrap().unwrap();
        let method = "item/commandExecution/requestApproval";
        let grant = request(&store, &root, None, 1, method, command());
        consent(&mut store, &grant);
        root = store.get(&root.id).unwrap().unwrap();
        root.phase = Phase::Completed;
        store.save(&mut root).unwrap();

        store.set_trust(&app.project, false).unwrap();
        store.set_trust(&app.project, true).unwrap();
        let submit = serde_json::from_value(json!({"api":API,"id":"retrusted-project-root",
            "session":root.session,"mode":"session_v1","prompt":"Fresh request after re-trusting"})).unwrap();
        let mut fresh = store.admit(&submit).unwrap();
        fresh.phase = Phase::Running;
        fresh.thread = Some("fresh-thread".into());
        fresh.turn = Some("fresh-turn".into());
        store.save(&mut fresh).unwrap();
        let wanted = request(&store, &fresh, None, 2, method, command());
        assert_eq!(store.grant_source(&wanted).unwrap(), None);
    }

    #[tokio::test]
    async fn profile_revocation_interrupts_only_affected_active_owners() {
        let (_dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let task = member(&mut s, &r, "apply-deep", "profile-member");
        let profile = json!({"permissions":{"network":{"enabled":true}},"cwd":"/project"});
        let child = request(
            &s,
            &r,
            Some(&task),
            1,
            "item/permissions/requestApproval",
            profile.clone(),
        );
        consent(&mut s, &child);
        let lead = request(&s, &r, None, 2, "item/permissions/requestApproval", profile);
        consent(&mut s, &lead);
        s.revoke_session_grants(&r.session).unwrap();
        assert!(
            s.get(&r.id).unwrap().unwrap().cancel_requested,
            "expanded Lead turn must be interrupted"
        );
        assert!(
            s.task(&task).unwrap().attempts[0].cancel_requested,
            "expanded member turn must be interrupted"
        );
        assert!(!s.session_grant(&child).unwrap());
        assert!(!s.session_grant(&lead).unwrap());
    }
    #[tokio::test]
    async fn unknown_material_fields_cannot_collide_with_host_descriptor_fields() {
        let (_dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let params = json!({"serverName":"configured","toolName":"read","mode":"form","requestedSchema":{"type":"object","properties":{}},"_meta":{"codex_approval_kind":"mcp_tool_call","tool_params":{"resource":"one"}},"resolvedToolName":"material-one"});
        let source = request(
            &s,
            &r,
            None,
            301,
            "mcpServer/elicitation/request",
            params.clone(),
        );
        consent(&mut s, &source);
        let mut changed = params;
        changed["resolvedToolName"] = json!("material-two");
        assert!(
            !s.session_grant(&request(
                &s,
                &r,
                None,
                302,
                "mcpServer/elicitation/request",
                changed
            ))
            .unwrap(),
            "unknown native field was overwritten by host normalization"
        );
        let params = json!({"itemId":"f1","changes":[{"path":"/project/a","kind":{"type":"update"},"diff":"first"}],"proposal":{"id":"material-one"}});
        let source = request(
            &s,
            &r,
            None,
            303,
            "item/fileChange/requestApproval",
            params.clone(),
        );
        consent(&mut s, &source);
        let mut changed = params;
        changed["proposal"]["id"] = json!("material-two");
        assert!(
            !s.session_grant(&request(
                &s,
                &r,
                None,
                304,
                "item/fileChange/requestApproval",
                changed
            ))
            .unwrap(),
            "unknown nested native ID was stripped as correlation"
        );
    }
    // Protects: changing patch text inside explicitly selected file scope can
    // reuse consent; legacy bare AllowSession must remain exact.
    #[tokio::test]
    async fn bounded_file_scope_is_explicit_and_contains_changed_patch() {
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let path = dir.path().join("bounded.rs");
        std::fs::write(&path, "before").unwrap();
        let mut d = request(
            &s,
            &r,
            None,
            801,
            "item/fileChange/requestApproval",
            json!({"itemId":"file","changes":[{"path":path,"kind":{"type":"update"},"diff":"one"}]}),
        );
        crate::permission_bounds::correlate_files(&mut d);
        s.bind_permission(&mut d).unwrap();
        let shown = view(&d).unwrap();
        assert!(
            shown["options"]
                .as_array()
                .unwrap()
                .iter()
                .any(|o| o["kind"] == "file_set"),
            "host must offer an explicit finite-file scope"
        );
        let option = option(&d, "file_set");
        consent_selected(&mut s, &d, &option);
        let mut changed = d.clone();
        changed.id = uuid::Uuid::new_v4().to_string();
        changed.request = "802".into();
        changed.state = DecisionState::Pending;
        changed.resolution = None;
        let n = changed.native.as_mut().unwrap();
        let mut p: Value = serde_json::from_str(&n.parameters).unwrap();
        p["changes"][0]["diff"] = json!("different patch");
        n.parameters = p.to_string();
        crate::permission_bounds::correlate_files(&mut changed);
        s.bind_permission(&mut changed).unwrap();
        assert!(
            s.reuse_permission(&mut changed).unwrap(),
            "selected files permit changed patch"
        );
        add(&mut s, &changed);
        assert!(
            s.authorize_response(&r.id, &changed.id, &r.generation)
                .unwrap()
                .is_some()
        );
    }

    fn option(d: &Decision, kind: &str) -> String {
        view(d).unwrap()["options"]
            .as_array()
            .unwrap()
            .iter()
            .find(|o| o["kind"] == kind)
            .unwrap_or_else(|| panic!("missing {kind} option"))
            .get("id")
            .unwrap()
            .as_str()
            .unwrap()
            .into()
    }
    fn file_request(
        s: &Store,
        r: &Receipt,
        task: Option<&str>,
        id: u64,
        path: &std::path::Path,
        op: &str,
        dest: Option<&std::path::Path>,
    ) -> Decision {
        let mut d = request(
            s,
            r,
            task,
            id,
            "item/fileChange/requestApproval",
            json!({"itemId":"file","changes":[{"path":path,"kind":{"type":op,"move_path":dest},"diff":format!("patch-{id}")}]}),
        );
        crate::permission_bounds::correlate_files(&mut d);
        s.bind_permission(&mut d).unwrap();
        d
    }
    // Oracle: only disclosed operations/paths may vary; both move endpoints,
    // member ownership and fresh symlink resolution are effect boundaries.
    #[tokio::test]
    async fn bounded_files_reject_paths_operations_missing_proposals_and_release_races() {
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let folder = dir.path().join("src");
        std::fs::create_dir(&folder).unwrap();
        let path = folder.join("a.rs");
        let other = folder.join("b.rs");
        std::fs::write(&path, "a").unwrap();
        std::fs::write(&other, "b").unwrap();
        let task = member(&mut s, &r, "apply-deep", "files-member");
        let first = file_request(&s, &r, Some(&task), 810, &path, "update", None);
        consent_selected(&mut s, &first, &option(&first, "folder"));
        let later = file_request(&s, &r, Some(&task), 811, &other, "update", None);
        assert!(s.session_grant(&later).unwrap());
        for (id, p, op, dest) in [
            (812, dir.path().join("outside"), "update", None),
            (813, other.clone(), "delete", None),
            (814, other.clone(), "add", None),
            (815, path.clone(), "update", Some(other.clone())),
        ] {
            assert!(
                !s.session_grant(&file_request(
                    &s,
                    &r,
                    Some(&task),
                    id,
                    &p,
                    op,
                    dest.as_deref()
                ))
                .unwrap()
            );
        }
        let lead = file_request(&s, &r, None, 816, &path, "update", None);
        assert!(
            !s.session_grant(&lead).unwrap(),
            "member consent cannot authorize lead"
        );
        let mut missing = later.clone();
        missing.native.as_mut().unwrap().file_proposal = None;
        s.bind_permission(&mut missing).unwrap();
        assert!(
            !s.session_grant(&missing).unwrap(),
            "uncorrelated proposal cannot reuse a path scope"
        );
        // The stored candidate must be checked again at release after lookup.
        let mut next = file_request(&s, &r, Some(&task), 817, &other, "update", None);
        assert!(s.reuse_permission(&mut next).unwrap());
        add(&mut s, &next);
        let external = tempfile::tempdir().unwrap();
        let outside = external.path().join("escape");
        std::fs::write(&outside, "x").unwrap();
        std::fs::remove_file(&other).unwrap();
        std::os::unix::fs::symlink(&outside, &other).unwrap();
        assert!(
            s.authorize_member_response(&r.id, &next.id, &task, &next.attempt)
                .unwrap()
                .is_none(),
            "symlink switch after lookup must block release"
        );
        let finite = file_request(&s, &r, None, 818, &path, "update", None);
        consent_selected(&mut s, &finite, &option(&finite, "file_set"));
        let inside = folder.join("new.rs");
        std::fs::write(&inside, "new").unwrap();
        assert!(
            !s.session_grant(&file_request(&s, &r, None, 819, &inside, "update", None))
                .unwrap()
        );
        let moving = file_request(&s, &r, None, 820, &path, "update", Some(&inside));
        consent_selected(&mut s, &moving, &option(&moving, "folder"));
        assert!(
            s.session_grant(&file_request(
                &s,
                &r,
                None,
                821,
                &inside,
                "update",
                Some(&path)
            ))
            .unwrap()
        );
        assert!(
            !s.session_grant(&file_request(
                &s,
                &r,
                None,
                822,
                &path,
                "update",
                Some(&dir.path().join("escape.rs"))
            ))
            .unwrap()
        );
        // Legacy bare selection remains exact even though broader options exist.
        let exact = file_request(&s, &r, None, 823, &inside, "add", None);
        consent(&mut s, &exact);
        assert!(
            !s.session_grant(&file_request(&s, &r, None, 824, &inside, "add", None))
                .unwrap()
        );
    }
    #[tokio::test]
    async fn capability_subsets_reject_network_write_unknown_deny_and_environment_escalation() {
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let folder = dir.path().join("capabilities");
        std::fs::create_dir(&folder).unwrap();
        let p = json!({"cwd":dir.path(),"environmentId":"local","startedAtMs":1,"permissions":{"network":{"enabled":false},"fileSystem":{"read":[folder]}}});
        let first = request(
            &s,
            &r,
            None,
            830,
            "item/permissions/requestApproval",
            p.clone(),
        );
        consent_selected(&mut s, &first, &option(&first, "capability_subset"));
        let mut child = p.clone();
        child["startedAtMs"] = json!(2);
        child["permissions"]["fileSystem"]["read"] = json!([folder.join("new.rs")]);
        assert!(
            s.session_grant(&request(
                &s,
                &r,
                None,
                831,
                "item/permissions/requestApproval",
                child.clone()
            ))
            .unwrap()
        );
        for changed in [
            {
                let mut p = child.clone();
                p["permissions"]["network"]["enabled"] = json!(true);
                p
            },
            {
                let mut p = child.clone();
                p["permissions"]["fileSystem"]["write"] = json!([folder]);
                p
            },
            {
                let mut p = child.clone();
                p["permissions"]["unknown"] = json!(true);
                p
            },
            {
                let mut p = child.clone();
                p["permissions"]["fileSystem"]["entries"] =
                    json!([{"access":"deny","path":{"type":"path","path":folder}}]);
                p
            },
            {
                let mut p = child.clone();
                p["environmentId"] = json!("other");
                p
            },
            {
                let mut p = child.clone();
                p["permissions"]["fileSystem"]["read"] = json!([dir.path()]);
                p
            },
        ] {
            assert!(
                !s.session_grant(&request(
                    &s,
                    &r,
                    None,
                    832,
                    "item/permissions/requestApproval",
                    changed
                ))
                .unwrap()
            );
        }
        let mut network = p;
        network["permissions"]["network"]["enabled"] = json!(true);
        let first = request(
            &s,
            &r,
            None,
            833,
            "item/permissions/requestApproval",
            network.clone(),
        );
        consent_selected(&mut s, &first, &option(&first, "capability_subset"));
        network["permissions"] = json!({});
        assert!(
            s.session_grant(&request(
                &s,
                &r,
                None,
                834,
                "item/permissions/requestApproval",
                network
            ))
            .unwrap()
        );
    }
    #[tokio::test]
    async fn project_any_command_reuses_without_crossing_protected_boundaries() {
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let method = "item/commandExecution/requestApproval";
        let first = request(&s, &r, None, 846, method,
            json!({"command":"cargo check","cwd":dir.path()}));
        consent_selected(&mut s, &first, &option(&first, "project_any"));
        for (command, reusable) in [
            ("printf done", true),
            ("git -C . status || echo retry", true),
            ("git checkout -- f", false),
            ("echo ready | git stash drop", false),
            ("git -C / status", false),
        ] {
            let next = request(&s, &r, None, 847, method, json!({"command":command,"cwd":dir.path()}));
            assert_eq!(s.session_grant(&next).unwrap(), reusable, "{command}");
            if !reusable {
                assert!(next.native.unwrap().permission.is_none());
            }
        }
        let outside = request(&s, &r, None, 848, method, json!({"command":"printf done","cwd":"/"}));
        assert!(!s.session_grant(&outside).unwrap());
        let network = request(&s, &r, None, 849, method,
            json!({"command":"printf done","cwd":dir.path(),"additionalPermissions":{"network":{"enabled":true}}}));
        assert!(!s.session_grant(&network).unwrap());
    }

    #[tokio::test]
    async fn qualified_argv_scope_decodes_whole_command_and_preserves_context() {
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let p = json!({"command":"cargo test --lib","cwd":dir.path(),"environment":{"MODE":"test"},"proposedExecpolicyAmendment":["cargo","test"],"additionalPermissions":{"network":{"enabled":false}},"kind":"command"});
        let first = request(
            &s,
            &r,
            None,
            840,
            "item/commandExecution/requestApproval",
            p.clone(),
        );
        consent_selected(&mut s, &first, &option(&first, "argv_prefix"));
        for text in [
            "cargo test --workspace",
            "cargo test --test integration test_filter -- --nocapture --test-threads=1",
        ] {
            let mut next = p.clone();
            next["command"] = json!(text);
            assert!(
                s.session_grant(&request(
                    &s,
                    &r,
                    None,
                    841,
                    "item/commandExecution/requestApproval",
                    next
                ))
                .unwrap()
            );
        }
        for text in [
            "cargo test; touch x",
            "cargo test && cargo publish",
            "cargo test $(id)",
            "sh -c cargo test",
            "env cargo test",
            "cargo test > x",
            "cargo test --config x",
            "cargo test --manifest-path x",
            "cargo test -- --test-threads=0",
            "cargo test --test -p",
            "cargo test\nwhoami",
            "cargo test --features x",
            "cargo test -- --format json",
        ] {
            let mut next = p.clone();
            next["command"] = json!(text);
            assert!(
                !s.session_grant(&request(
                    &s,
                    &r,
                    None,
                    842,
                    "item/commandExecution/requestApproval",
                    next
                ))
                .unwrap(),
                "{text}"
            );
        }
        for (key, value) in [
            ("environment", json!({"MODE":"prod"})),
            ("cwd", json!(dir.path().join("different"))),
            ("additionalPermissions", json!({"network":{"enabled":true}})),
            ("kind", json!("stdin")),
            ("unknown", json!(true)),
        ] {
            let mut next = p.clone();
            next[key] = value;
            assert!(
                !s.session_grant(&request(
                    &s,
                    &r,
                    None,
                    843,
                    "item/commandExecution/requestApproval",
                    next
                ))
                .unwrap()
            );
        }
        let source = s
            .get(&r.id)
            .unwrap()
            .unwrap()
            .decisions
            .into_iter()
            .find(|d| d.id == first.id)
            .unwrap();
        let response = source.resolution.as_ref().unwrap().clone();
        let selected = source
            .native
            .as_ref()
            .unwrap()
            .permission
            .as_ref()
            .unwrap()
            .selected_option
            .as_ref()
            .unwrap()
            .clone();
        s.revoke_session_grants(&r.session).unwrap();
        assert!(
            s.resolve_scope(&first.id, &response, Some(&selected))
                .is_ok()
        );
        assert!(!s.session_grant(&first).unwrap());
    }

    #[tokio::test]
    async fn selected_scope_persists_without_redelivery_and_unknown_tools_stay_exact() {
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let path = dir.path().join("restart.rs");
        std::fs::write(&path, "first").unwrap();
        let first = file_request(&s, &r, None, 850, &path, "update", None);
        let selected = option(&first, "file_set");
        consent_selected(&mut s, &first, &selected);
        let stored = s
            .get(&r.id)
            .unwrap()
            .unwrap()
            .decisions
            .into_iter()
            .find(|d| d.id == first.id)
            .unwrap();
        assert!(
            s.resolve_scope(
                &first.id,
                stored.resolution.as_ref().unwrap(),
                Some(&option(&first, "folder"))
            )
            .is_err(),
            "UUID cannot change selected scope"
        );
        let next = file_request(&s, &r, None, 851, &path, "update", None);
        assert!(s.session_grant(&next).unwrap());
        let db = dir.path().join("bounded-reopen.db");
        s.conn.backup("main", &db, None).unwrap();
        let reopened = Store::open(&db, &s.project).unwrap();
        assert!(reopened.session_grant(&next).unwrap());
        let stored = reopened
            .get(&r.id)
            .unwrap()
            .unwrap()
            .decisions
            .into_iter()
            .find(|d| d.id == first.id)
            .unwrap();
        assert_eq!(
            stored.native.as_ref().unwrap().resolution_provenance,
            Some(PermissionProvenance::User)
        );
        assert_eq!(
            stored
                .native
                .as_ref()
                .unwrap()
                .permission
                .as_ref()
                .unwrap()
                .selected_option
                .as_ref(),
            Some(&selected)
        );
        {
            let method = "mcpServer/elicitation/request";
            let p = json!({"serverName":"configured","toolName":"search","mode":"form","requestedSchema":{"type":"object","properties":{}},"_meta":{"codex_approval_kind":"mcp_tool_call","tool_params":{"query":"one","id":"resource"},"schemaIdentity":"v1"}});
            let first = request(&s, &r, None, 852, method, p.clone());
            let v = view(&first).unwrap();
            assert_eq!(v["options"].as_array().unwrap().len(), 1);
            consent(&mut s, &first);
            let mut changed = p;
            changed["_meta"]["tool_params"]["query"] = json!("two");
            assert!(
                !s.session_grant(&request(&s, &r, None, 853, method, changed))
                    .unwrap()
            );
        }
    }
    // R129-Q01: scope is immutable UUID payload, omission and explicit exact
    // are equivalent, and retries return evidence rather than release effects.
    #[tokio::test]
    async fn scope_retry_payload_is_immutable_across_http_restart_and_revocation() {
        use axum::{body::Body, http::Request};
        use http_body_util::BodyExt;
        use tower::ServiceExt;
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let router = crate::server::router(app.clone());
        let auth = router.clone().oneshot(Request::post("/auth")
            .header("host", "127.0.0.1:32123")
            .header("origin", "http://127.0.0.1:32123")
            .body(Body::from(app.issue_launch())).unwrap()).await.unwrap();
        let cookie = auth.headers()["set-cookie"].to_str().unwrap()
            .split(';').next().unwrap().to_owned();
        let mut cases = Vec::new();
        {
            let mut s = app.store.lock().unwrap();
            let r = s.get("coordination-root").unwrap().unwrap();
            let path = dir.path().join("retry.rs");
            std::fs::write(&path, "first").unwrap();
            for (i, kind) in ["file_set", "omitted", "exact"].into_iter().enumerate() {
                let d = file_request(&s, &r, None, 900+i as u64, &path, "update", None);
                let exact = option(&d, "exact");
                let broad = option(&d, "file_set");
                let selection = match kind { "file_set" => Some(broad.as_str()), "exact" => Some(exact.as_str()), _ => None };
                add(&mut s, &d);
                let response = Resolve { api: API, command_id: uuid::Uuid::new_v4().to_string(), expected_revision: d.revision, response: DecisionResponse::AllowSession };
                s.resolve_scope(&d.id, &response, selection).unwrap();
                s.authorize_response(&r.id, &d.id, &r.generation).unwrap().unwrap();
                let mut receipt = s.get(&r.id).unwrap().unwrap();
                let stored = receipt.decisions.iter_mut().find(|v| v.id == d.id).unwrap();
                stored.state = DecisionState::Delivered;
                stored.delivered_ms = Some(crate::now());
                s.save(&mut receipt).unwrap();
                cases.push((d, response, exact, broad, kind == "file_set"));
            }
        }
        for stage in 0..3 {
            if stage == 1 {
                let mut s = app.store.lock().unwrap();
                let db = dir.path().join("retry.db");
                s.conn.backup("main", &db, None).unwrap();
                *s = Store::open(&db, &s.project).unwrap();
            } else if stage == 2 {
                let mut s = app.store.lock().unwrap();
                s.revoke_session_grants(&cases[0].0.session).unwrap();
            }
            for (d, response, exact, broad, is_broad) in &cases {
                let before = app.store.lock().unwrap().get(&d.command).unwrap().unwrap();
                let stored = before.decisions.iter().find(|v| v.id == d.id).unwrap();
                for selection in [None, Some(exact.as_str()), Some(broad.as_str())] {
                    let mut payload = serde_json::to_value(response).unwrap();
                    if let Some(id) = selection { payload["scope_option_id"] = json!(id); }
                    let result = router.clone().oneshot(Request::post(format!("/api/decisions/{}/responses", d.id))
                        .header("host", "127.0.0.1:32123")
                        .header("origin", "http://127.0.0.1:32123")
                        .header("cookie", &cookie).header("content-type", "application/json")
                        .body(Body::from(payload.to_string())).unwrap()).await.unwrap();
                    let equivalent = *is_broad == (selection == Some(broad.as_str()));
                    assert_eq!(result.status().as_u16(), if equivalent {200} else {409}, "stage={stage} broad={is_broad} selection={selection:?}");
                    if equivalent {
                        let body = result.into_body().collect().await.unwrap().to_bytes();
                        assert_eq!(serde_json::from_slice::<Decision>(&body).unwrap(), *stored);
                    }
                    let mut s = app.store.lock().unwrap();
                    assert_eq!(s.get(&d.command).unwrap().unwrap(), before, "retry mutated durable evidence");
                    assert!(s.authorize_response(&d.command, &d.id, &d.generation).unwrap().is_none(), "retry released old RPC");
                }
                let mut s = app.store.lock().unwrap();
                let other = cases.iter().find(|(other, ..)| other.id != d.id).unwrap();
                assert!(s.resolve_scope(&other.0.id, response, None).is_err(), "global UUID cannot bind another decision");
                let mut changed = response.clone(); changed.response = DecisionResponse::Deny;
                assert!(s.resolve_scope(&d.id, &changed, None).is_err(), "UUID cannot change response kind");
            }
        }
    }

    // UI27-Q01: only durable terminal evidence frees a retained browser UUID.
    #[tokio::test]
    async fn terminal_scope_rejection_is_exact_durable_and_fenced() {
        use axum::{body::Body, http::Request};
        use http_body_util::BodyExt;
        use tower::ServiceExt;
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let router = crate::server::router(app.clone());
        let auth = router.clone().oneshot(Request::post("/auth")
            .header("host", "127.0.0.1:32123").header("origin", "http://127.0.0.1:32123")
            .body(Body::from(app.issue_launch())).unwrap()).await.unwrap();
        let cookie = auth.headers()["set-cookie"].to_str().unwrap().split(';').next().unwrap().to_owned();
        let d = {
            let mut s = app.store.lock().unwrap();
            let r = s.get("coordination-root").unwrap().unwrap();
            let path = dir.path().join("rejected.rs"); std::fs::write(&path, "first").unwrap();
            let d = file_request(&s, &r, None, 950, &path, "update", None);
            add(&mut s, &d); d
        };
        let payload = json!({"api":API,"command_id":uuid::Uuid::new_v4().to_string(),
            "expected_revision":d.revision,"response":{"type":"allow_session"},"scope_option_id":"stale-option"});
        let send = |tail: &str, body: Value, authenticated: bool| {
            let req = Request::post(format!("/api/decisions/{}/responses{}", d.id, tail))
                .header("host", "127.0.0.1:32123").header("origin", "http://127.0.0.1:32123")
                .header("cookie", if authenticated {cookie.as_str()} else {""})
                .header("content-type", "application/json").body(Body::from(body.to_string())).unwrap();
            let router = router.clone();
            async move { let r = router.oneshot(req).await.unwrap(); let status=r.status().as_u16();
                let bytes=r.into_body().collect().await.unwrap().to_bytes();
                (status, serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null)) }
        };
        assert_ne!(send("/reconcile",payload.clone(),true).await.1["code"], "permission_response_not_accepted", "absence is not evidence");
        assert_eq!(send("",payload.clone(),false).await.0,403);
        let (status, proof) = send("",payload.clone(),true).await;
        assert_eq!(status,409); assert_eq!(proof["code"],"permission_response_not_accepted");
        assert_eq!(proof["submission"],payload); assert_eq!(proof["terminal"],true);
        assert_eq!(proof["accepted_response"],Value::Null);
        assert_eq!(send("/reconcile",payload.clone(),true).await.1,proof);
        for key in ["scope_option_id","expected_revision","response","extra"] {
            let mut changed=payload.clone(); changed[key]=match key {"expected_revision"=>json!(99),"response"=>json!({"type":"deny"}),_=>json!("different")};
            assert_ne!(send("/reconcile",changed.clone(),true).await.1["code"],proof["code"]);
            assert_ne!(send("",changed,true).await.1["code"],proof["code"]);
        }
        // A valid exact scope under the rejected UUID must remain fenced.
        let mut corrected=payload.clone(); corrected["scope_option_id"]=json!(option(&d,"exact"));
        assert_ne!(send("",corrected.clone(),true).await.1["code"],proof["code"]);
        {
            let mut s=app.store.lock().unwrap();
            let body: Resolve=serde_json::from_value(json!({"api":API,"command_id":payload["command_id"],"expected_revision":d.revision,"response":{"type":"allow_session"}})).unwrap();
            assert!(s.resolve(&d.id,&body).is_err(),"generic admission cannot bypass fence");
            s.revoke_session_grants(&d.session).unwrap();
            let db=dir.path().join("rejection.db");s.conn.backup("main",&db,None).unwrap();
            *s=Store::open(&db,&s.project).unwrap();
        }
        assert_eq!(send("/reconcile",payload.clone(),true).await.1,proof);
        assert_eq!(send("",payload,true).await.1,proof);
        corrected["command_id"]=json!(uuid::Uuid::new_v4().to_string());
        corrected["response"]=json!({"type":"deny"});corrected.as_object_mut().unwrap().remove("scope_option_id");
        assert_ne!(send("",corrected,true).await.1["code"],proof["code"]);
    }

    #[tokio::test]
    async fn terminal_rejection_cannot_certify_acceptance_uncertainty_or_failed_commit() {
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let path = dir.path().join("proof.rs"); std::fs::write(&path,"before").unwrap();
        for (i, case) in ["accepted", "uncertain", "failed-write", "failed-commit", "null", "extra", "nested", "wrong-api", "wrong-id"].into_iter().enumerate() {
            let d = file_request(&s,&r,None,1000+i as u64,&path,"update",None); add(&mut s,&d);
            let mut body=json!({"api":API,"command_id":uuid::Uuid::new_v4().to_string(),"expected_revision":d.revision,
                "response":{"type":"allow_session"},"scope_option_id":"stale"});
            match case {
                "accepted" => { let mut accepted=body.clone();accepted["scope_option_id"]=json!(option(&d,"exact"));s.resolve_submission(&d.id,&accepted).unwrap(); },
                "uncertain" => { let mut receipt=s.get(&d.command).unwrap().unwrap();let item=receipt.decisions.iter_mut().find(|v|v.id==d.id).unwrap(); item.state=DecisionState::Uncertain;item.dispatch_ms=Some(crate::now());s.save(&mut receipt).unwrap(); },
                "failed-write" => s.conn.execute_batch("CREATE TEMP TRIGGER fail_rejection BEFORE INSERT ON permission_rejections BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap(),
                "failed-commit" => s.conn.execute_batch("PRAGMA foreign_keys=ON; CREATE TEMP TABLE rejection_parent(id INTEGER PRIMARY KEY); CREATE TEMP TABLE rejection_failure(id INTEGER REFERENCES rejection_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TEMP TRIGGER fail_rejection_commit AFTER INSERT ON permission_rejections BEGIN INSERT INTO rejection_failure VALUES (1); END;").unwrap(),
                "null" => body["scope_option_id"]=Value::Null,
                "extra" => body["extra"]=Value::Null,
                "nested" => body["response"]["extra"]=Value::Null,
                "wrong-api" => body["api"]=json!(0),
                "wrong-id" => body["command_id"]=json!("bad"),
                _=> unreachable!(),
            }
            let before=s.get(&d.command).unwrap().unwrap();
            assert!(s.resolve_submission(&d.id,&body).is_err(),"{case}");
            assert!(s.reconcile_permission(&d.id,&body).is_err(),"false proof: {case}");
            assert_eq!(s.get(&d.command).unwrap().unwrap(),before,"mutated {case}");
            if case=="failed-write" { s.conn.execute_batch("DROP TRIGGER fail_rejection").unwrap(); }
            if case=="failed-commit" { assert!(s.conn.is_autocommit());s.conn.execute_batch("DROP TRIGGER fail_rejection_commit").unwrap(); }
        }
    }
    // Competing payloads under one UUID: whichever reaches the serialized
    // boundary first determines whether there is acceptance or terminal rejection.
    #[tokio::test]
    async fn rejection_and_admission_race_has_one_durable_winner() {
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        for round in 0..8 {
            let (d, stale, valid) = {
                let mut s=app.store.lock().unwrap();let r=s.get("coordination-root").unwrap().unwrap();
                let path=dir.path().join(format!("race-{round}.rs")); std::fs::write(&path,"before").unwrap();
                let d=file_request(&s,&r,None,1100+round,&path,"update",None); add(&mut s,&d);
                let stale=json!({"api":API,"command_id":uuid::Uuid::new_v4().to_string(),"expected_revision":d.revision,
                    "response":{"type":"allow_session"},"scope_option_id":"stale"});
                let mut valid=stale.clone();valid["scope_option_id"]=json!(option(&d,"exact"));(d,stale,valid)
            };
            let barrier=std::sync::Barrier::new(2);
            let (a,b)=std::thread::scope(|scope| {
                let a=scope.spawn(|| {barrier.wait();app.store.lock().unwrap().resolve_submission(&d.id,&stale).is_ok()});
                let b=scope.spawn(|| {barrier.wait();app.store.lock().unwrap().resolve_submission(&d.id,&valid).is_ok()});
                (a.join().unwrap(),b.join().unwrap())
            });
            assert!(!a);
            let mut s=app.store.lock().unwrap();
            let proof=s.reconcile_permission(&d.id,&stale);
            assert_eq!(proof.is_ok(),!b);
            assert_eq!(s.resolve_submission(&d.id,&valid).is_ok(),b);
            assert!(s.resolve_submission(&d.id,&stale).is_err());
            if !b {
                let mut corrected=valid.clone();corrected["command_id"]=json!(uuid::Uuid::new_v4().to_string());
                corrected["response"]=json!({"type":"deny"});corrected.as_object_mut().unwrap().remove("scope_option_id");
                assert!(s.resolve_submission(&d.id,&corrected).is_ok());
                assert!(s.reconcile_permission(&d.id,&stale).is_err(),"no proof once another UUID accepted");
                assert!(s.resolve_submission(&d.id,&valid).is_err());
            }
        }
    }

    // Oracle: a browser can only select an option offered for this immutable
    // decision, even when it learns another freshly computed valid option ID.
    #[tokio::test]
    async fn recomputed_but_unoffered_scope_cannot_replace_original_offer() {
        let (dir, app, _bridge) = crate::session_mcp::tests::fixture().await;
        let mut s = app.store.lock().unwrap();
        let r = s.get("coordination-root").unwrap().unwrap();
        let a = dir.path().join("original");
        let b = dir.path().join("replacement");
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();
        for p in [&a, &b] {
            std::fs::write(p.join("a.rs"), "a").unwrap();
        }
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&a, &link).unwrap();
        let d = file_request(&s, &r, None, 860, &link.join("a.rs"), "update", None);
        add(&mut s, &d);
        let old = option(&d, "file_set");
        std::fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink(&b, &link).unwrap();
        let fresh = s
            .permission_scope(&d)
            .unwrap()
            .unwrap()
            .options
            .into_iter()
            .find(|o| o.kind == "file_set")
            .unwrap();
        assert_ne!(fresh.id, old);
        let response = Resolve {
            api: API,
            command_id: uuid::Uuid::new_v4().to_string(),
            expected_revision: d.revision,
            response: DecisionResponse::AllowSession,
        };
        assert!(
            s.resolve_scope(&d.id, &response, Some(&fresh.id)).is_err(),
            "newly valid but never offered ID cannot select scope"
        );
        let current = s
            .get(&r.id)
            .unwrap()
            .unwrap()
            .decisions
            .into_iter()
            .find(|v| v.id == d.id)
            .unwrap();
        assert_eq!(current.state, DecisionState::Pending);
        assert!(current.resolution.is_none());
    }
}
