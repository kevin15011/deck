//! Codex dedicated-member protocol and process settlement. Canonical admission
//! and result persistence remain in session_tasks.
use crate::{
    server::App,
    session_tasks::{cancelled, handoff, update, validate_authority, validate_original_task},
    tasks::digest,
};
use deck2_shared::Phase;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};
pub(crate) async fn run(app: &App, task: &str, attempt: &str) -> Result<(), String> {
    let t = app.store.lock().unwrap().task(task)?;
    let session = t.session.clone();
    let a = t
        .attempts
        .iter()
        .find(|a| a.id == attempt)
        .ok_or("Attempt missing")?;
    let authority = t.authority_root(a).to_string();
    let assignment = a
        .configuration
        .as_ref()
        .and_then(|s| s.session_contract.as_ref())
        .and_then(|c| c.members.get(&t.owner))
        .ok_or("Immutable assignment missing")?;
    let binding = a
        .configuration
        .as_ref()
        .and_then(|s| s.runner.as_ref())
        .ok_or("Admitted runner missing")?;
    if digest(&std::fs::read(&binding.path).map_err(|_| "Member executable missing")?)
        != a.provenance.executable
    {
        return Err("Member executable changed".into());
    }
    let (_, version) = crate::native::qualify_version(Path::new(&binding.path)).await?;
    let supports_guidance = version >= semver::Version::new(0, 170, 0);
    validate_original_task(app, &t)?;
    let bridge = crate::session_mcp::Bridge::start_member(app, task, attempt).await?;
    let role = crate::session_roles::Role::at(&app.native_role_root.lock().unwrap(), &t.owner)?;
    bridge.set_role(role.clone());
    let artifacts = app.artifact_root()?;
    let approvals = a
        .configuration
        .as_ref()
        .and_then(|s| s.session_contract.as_ref())
        .ok_or("Admitted contract missing")?
        .approvals
        .clone();
    let mut native = crate::native::Native::start_member(
        Path::new(&binding.path),
        &t.owner,
        assignment,
        bridge.config.clone(),
        role,
    )
    .await?;
    native.set_approval_mode(&approvals);
    native.bind_codebase(&bridge, artifacts);
    native.bind_external_tools(app)?;
    let execution = async {
        {
            let app = app.clone();
            let task = task.to_owned();
            let attempt = attempt.to_owned();
            native.track_process(std::sync::Arc::new(move |pid| {
                update(&app, &task, &attempt, |a| a.native_pid = Some(pid))?;
                app.history
                    .lock()
                    .map_err(|_| "Original ownership unavailable")?
                    .track_process(pid)
            }))?;
        }
        app.check_original_context(&session)?;
        validate_original_task(app, &t)?;
        let mut selection = crate::session_continuity::launch(app, &t, a)?;
        let predecessor = crate::session_continuity::predecessor(&t, a);
        let resume = if selection["continuity"] == "native" {
            predecessor["nativeSessionId"].as_str()
        } else {
            None
        };
        update(app, task, attempt, |a| {
            let mut state: Value =
                serde_json::from_str(a.structured.as_deref().unwrap_or("{}")).unwrap();
            state["selection"] = selection.clone();
            a.structured = Some(state.to_string());
        })?;
        if a.structured
            .as_deref()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .is_some_and(|s| s["continuity"] == "native")
            && selection["continuity"] != "native"
        {
            return Err(format!(
                "Native override refused: {}",
                selection["reason"].as_str().unwrap()
            ));
        }
        let prepared = native.prepare_member(&app.project, resume).await;
        let (thread, _, model) = match prepared {
            Err(e) if e == "native-session-not-found" && resume.is_some() => {
                selection["continuity"] = json!("reseeded");
                selection["reason"] = json!("native-session-not-found");
                update(app, task, attempt, |a| {
                    let mut state: Value =
                        serde_json::from_str(a.structured.as_deref().unwrap_or("{}")).unwrap();
                    state["selection"] = selection.clone();
                    a.structured = Some(state.to_string());
                })?;
                native.prepare_member(&app.project, None).await?
            }
            other => other?,
        };
        validate_original_task(app, &t)?;
        let launch_prompt = {
            let current = app.store.lock().unwrap().task(task)?;
            let current_attempt = current
                .attempts
                .iter()
                .find(|a| a.id == attempt)
                .ok_or("Attempt missing")?;
            handoff(
                &current,
                current_attempt,
                selection["continuity"] != "native",
            )?
        };
        app.check_original_context(&session)?;
        {
            let store = app.store.lock().unwrap();
            let mut current = store.task(task)?;
            let origin = store.get(&authority)?.ok_or("Origin missing")?;
            let active = current
                .attempts
                .iter()
                .find(|a| a.id == attempt)
                .ok_or("Attempt missing")?;
            validate_authority(&store, &current, active)?;
            let a = current
                .attempts
                .iter_mut()
                .find(|a| a.id == attempt)
                .ok_or("Attempt missing")?;
            if origin.cancel_requested || a.cancel_requested || a.phase != Phase::Preparing {
                return Err("Member cancelled before input claim".into());
            }
            a.native_session = Some(thread.clone());
            a.observed_model = Some(model);
            a.phase = Phase::Dispatching;
            a.dispatch_ms = Some(crate::now());
            store.save_task(&current)?;
        }
        let (permissions, approval_policy, _) = native.permission_policy(false);
        let ack=native.request("turn/start",native.turn_assignment(json!({"threadId":thread,"input":[{"type":"text","text":launch_prompt}],"permissions":permissions,"approvalPolicy":approval_policy,"approvalsReviewer":"user"}))).await?;
        let turn = ack["turn"]["id"]
            .as_str()
            .ok_or("Member turn acknowledgment missing")?
            .to_string();
        update(app, task, attempt, |a| {
            a.native_message = Some(turn.clone());
            if !a.cancel_requested {
                a.phase = Phase::Running;
                a.guidance_open = supports_guidance;
            }
            a.acknowledgment_ms = Some(crate::now());
        })?;
  let mut report=String::new();
  let mut proposals=std::collections::HashMap::<String,Value>::new();
  let mut revoked_replies=std::collections::HashSet::new();
  let mut steering: Option<(String, deck2_shared::SteeringCommand, tokio::time::Instant)> = None;
  let mut controls = tokio::time::interval(Duration::from_millis(100));
  controls.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
  loop {
   native.verify_role()?;
   let current=app.store.lock().unwrap().task(task)?;
   let active=current.attempts.iter().find(|a|a.id==attempt&&a.phase.active()&&!a.cancel_requested)
       .ok_or("Member was cancelled; outcome requires process settlement")?;
   let guidance_pending=active.guidance_open && active.guidance.iter().any(|g|
       g.input.state==deck2_shared::SteeringState::Pending);
   for d in app.receipt(&authority)?.decisions.iter().filter(|d|d.task.as_deref()==Some(task)&&d.attempt==attempt&&d.generation==a.generation&&d.thread==thread&&d.turn==turn) {
    if let Some(reply)=crate::codex_protocol::revoked_reply(d)? && revoked_replies.insert(d.id.clone()) {
     native.write(json!({"id":serde_json::from_str::<Value>(&d.request).map_err(|_|"Corrupt revoked member request")?,"result":reply})).await?;
    }
   }
   let decisions = app.receipt(&authority)?.decisions;
   let pending=decisions.into_iter().filter(|d|d.task.as_deref()==Some(task)&&d.attempt==attempt&&matches!(d.state,deck2_shared::DecisionState::Pending|deck2_shared::DecisionState::Responded)&&d.native.as_ref().is_none_or(|n|n.method!="deck/approve")).collect::<Vec<_>>();
   for d in pending {
    if !native.check_mcp_response(app,&authority,&d).await? { continue; }
    app.check_original_context(&session)?;
    let response=app.store.lock().unwrap().authorize_member_response(&authority,&d.id,task,attempt)?;
    if let Some(d)=response {
     native.write(json!({"id":serde_json::from_str::<Value>(&d.request).map_err(|_|"Corrupt member request identity")?,"result":crate::codex_protocol::native_reply(&d)?})).await?;
     app.change(&authority,|r|{if let Some(d)=r.decisions.iter_mut().find(|v|v.id==d.id){d.state=deck2_shared::DecisionState::Delivered;d.delivered_ms=Some(crate::now());}})?;
    }
   }
   let value=tokio::select!{
       biased;
       v=native.read()=>v?,
       _=controls.tick()=>{
        if steering.as_ref().is_some_and(|(_,_,deadline)| tokio::time::Instant::now() >= *deadline) {
         let (_,command,_) = steering.take().unwrap();
         crate::member_guidance::resolve(app,task,attempt,&command,None)?;
        }
        if guidance_pending && steering.is_none()
            && let Some(command) = crate::member_guidance::claim(app,task,attempt,&thread,&turn)? {
         let rpc = format!("deck-steer-{}",uuid::Uuid::new_v4());
         native.steer_member(&rpc,&command).await?;
         steering = Some((rpc,command,tokio::time::Instant::now()+Duration::from_secs(10)));
        }
        continue;
       }
   };
   if value.get("method").is_none() && steering.as_ref()
       .is_some_and(|(rpc,_,_)|value["id"].as_str()==Some(rpc)) {
    let (_,command,_) = steering.take().unwrap();
    crate::member_guidance::resolve(app,task,attempt,&command,Some(&value))?;
    continue;
   }
   let p=&value["params"];
   if value.get("id").is_some()&&value.get("method").is_some(){
    let method=value["method"].as_str().unwrap_or("");
    native.verify_role()?;
    if p["threadId"]!=thread||p["turnId"]!=turn{return Err("Foreign member request identity".into());}
    if matches!(t.owner.as_str(),"investigate"|"quality") && crate::codex_protocol::native_method(method) {
     let mut caller=app.receipt(&authority)?;caller.phase=Phase::Running;caller.attempt=attempt.into();caller.generation=a.generation.clone();caller.thread=Some(thread.clone());caller.turn=Some(turn.clone());
     let mut decision=crate::codex_protocol::native_decision(&caller,&a.generation,&thread,&turn,&value)?;
     let permitted=method=="mcpServer/elicitation/request"&&native.readonly_mcp_permitted(p)&&native.verify_mcp_approval_source(&thread,p).await?;
     if permitted {
      native.verify_role()?;
      app.check_original_context(&session)?;
      let store=app.store.lock().map_err(|_|"State lock failed")?;
      let current=store.task(task)?;
      let active=current.attempts.iter().find(|a|a.id==attempt&&a.phase==Phase::Running&&!a.cancel_requested)
       .ok_or("Member approval attempt no longer live")?;
      validate_authority(&store,&current,active)?;
      if store.get(&authority)?.is_none_or(|root|root.cancel_requested) {
       return Err("Member approval origin no longer live".into());
      }
     }
     decision.resolution=Some(deck2_shared::Resolve{api:deck2_shared::API,command_id:uuid::Uuid::new_v4().to_string(),expected_revision:decision.revision,response:if permitted{deck2_shared::DecisionResponse::AllowOnce}else{deck2_shared::DecisionResponse::Deny}});
     native.write(json!({"id":value["id"],"result":crate::codex_protocol::native_reply(&decision)?})).await?;continue;
    }
    if !matches!(t.owner.as_str(),"investigate"|"quality") && crate::codex_protocol::native_method(method) {
     if method=="mcpServer/elicitation/request" && !native.verify_mcp_approval_source(&thread,p).await? {return Err("Unknown member MCP approval source".into());}
     let mut caller=app.receipt(&authority)?;caller.phase=Phase::Running;caller.attempt=attempt.into();caller.generation=a.generation.clone();caller.thread=Some(thread.clone());caller.turn=Some(turn.clone());
     let mut request=value.clone();
     let proposal = if method=="item/fileChange/requestApproval" {p["itemId"].as_str().and_then(|id|proposals.remove(id))} else {None};
     if let Some(item)=&proposal {request["params"]["changes"]=item["changes"].clone();}
     let mut d=crate::codex_protocol::native_decision(&caller,&a.generation,&thread,&turn,&request)?;d.task=Some(task.into());
     if proposal.is_some() {crate::permission_bounds::correlate_files(&mut d);}
     app.store.lock().unwrap().bind_permission(&mut d)?;
     if method=="mcpServer/elicitation/request" && native.coordination_mcp_permitted(p,&bridge) {
      crate::permission_policy::intrinsic(&mut d);
      d.detail="Intrinsic configured-team coordination; host authorization remains enforced".into();
      d.resolution=Some(deck2_shared::Resolve{api:deck2_shared::API,command_id:uuid::Uuid::new_v4().to_string(),expected_revision:d.revision,response:deck2_shared::DecisionResponse::AllowOnce});
      d.state=deck2_shared::DecisionState::Responded;
     }
     if d.state==deck2_shared::DecisionState::Pending { app.store.lock().unwrap().reuse_permission(&mut d)?; }
     app.change(&authority,|r|r.decisions.push(d))?;continue;
    }
    native.write(json!({"id":value["id"],"error":{"code":-32601,"message":"Member native approval relay not yet qualified"}})).await?;return Err("Member requested an unqualified approval boundary".into());}
   app.observe_quota(&value)?;
   if crate::observations::handles(&value) {
    update(app,task,attempt,|a| {if !a.cancel_requested {crate::observations::observe(&mut a.context,&value,&thread,&turn,attempt,a.observed_model.as_deref());crate::codex_protocol::observe_input(a,&value);}})?;
    continue;
   }
   if crate::observations::advances(&value) {update(app,task,attempt,|a|{crate::observations::observe(&mut a.context,&value,&thread,&turn,attempt,a.observed_model.as_deref());crate::codex_protocol::observe_input(a,&value);})?;}
   if p.get("threadId").is_some_and(|id|id!=&json!(thread))||p.get("turnId").is_some_and(|id|id!=&json!(turn)){return Err("Foreign member event identity".into());}
   if matches!(value["method"].as_str(), Some("item/started" | "item/completed")) {
    app.record_activity(&authority,task,attempt,&thread,&turn,&value);
   }
   if value["method"]=="item/started" && p["item"]["type"]=="fileChange" {
    if p["threadId"]!=thread || p["turnId"]!=turn {return Err("Uncorrelated member file proposal".into());}
    let id=p["item"]["id"].as_str().ok_or("Member file proposal lacks identity")?;
    if proposals.len()>=16 || proposals.insert(id.into(),p["item"].clone()).is_some() {return Err("Member file proposal correlation invalid".into());}
   }
   if value["method"]=="item/agentMessage/delta"{report.push_str(p["delta"].as_str().ok_or("Missing member delta")?);if report.len()>1024*1024{return Err("Member report exceeds bound".into());}update(app,task,attempt,|a|a.text=report.clone())?;}
   if value["method"]=="turn/completed"{if p["turn"]["id"]!=turn{return Err("Foreign member completion".into());}let phase=match p["turn"]["status"].as_str(){Some("completed")=>Phase::Completed,Some("interrupted")=>Phase::Cancelled,Some("failed")=>Phase::Failed,_=>return Err("Unknown member terminal status".into())};return Ok((phase,report));}
  }
    };
    let result: Result<(Phase, String), String> = tokio::select! {
        result=execution => result,
        _=cancelled(app,task,attempt) => Err("Member cancelled during preparation or execution".into()),
    };
    // Close at the observed protocol boundary, before process cleanup can block.
    let closed = if supports_guidance {
        update(app, task, attempt, crate::member_guidance::close)
    } else {
        Ok(())
    };
    native
        .terminate()
        .await
        .map_err(|e| format!("member_cleanup_uncertain:{e}"))?;
    closed?;
    if result.is_err() {
        update(app, task, attempt, |a| a.settled_ms = Some(crate::now()))?;
    }
    let (phase, report) = result?;
    app.change(&authority, |r| {
        for d in r
            .decisions
            .iter_mut()
            .filter(|d| d.task.as_deref() == Some(task) && d.attempt == attempt)
        {
            if d.state == deck2_shared::DecisionState::Delivered {
                d.state = deck2_shared::DecisionState::Settled;
            } else if matches!(
                d.state,
                deck2_shared::DecisionState::Pending | deck2_shared::DecisionState::Responded
            ) {
                d.state = deck2_shared::DecisionState::Invalidated;
            }
        }
    })?;
    update(app, task, attempt, |a| {
        let mut state: Value =
            serde_json::from_str(a.structured.as_deref().unwrap_or("{}")).unwrap();
        if phase == Phase::Completed && !a.context.compacted && state["requestInput"].is_object() {
            state["requestInput"]["final"] = json!(true);
        } else {
            state["requestInput"] = Value::Null;
        }
        a.structured = Some(state.to_string());
        a.phase = phase;
        a.settled_ms = Some(crate::now());
        a.report = Some(deck2_shared::TaskReport {
            attempt: attempt.into(),
            digest: digest(report.as_bytes()),
            text: report,
        });
        a.detail =
            "Native member and process settled; report is evidence, not independent verification"
                .into();
    })
}

const INTEGRATION: &str = "app-server/session-mcp-member-v1";

// A host restart leaves dispatched Codex members uncertain. When the Lead has
// queued input and the member's recorded process group is provably gone, the
// reservation is released once: the outcome stays unknown, partial output and
// decisions are kept, and the assignment never replays. A live or unrecorded
// process keeps ownership (see Store::explain_member_wait).
pub(crate) fn settle_recovered(
    store: &mut crate::Store,
    live: &std::collections::HashSet<String>,
) -> Result<bool, String> {
    let waiting: std::collections::HashSet<String> = store
        .pending_receipts()?
        .into_iter()
        .filter(|r| r.phase == Phase::Queued && r.mode == deck2_shared::Mode::SessionV1)
        .map(|r| r.session)
        .collect();
    let mut retry = false;
    for mut task in store.tasks()? {
        if !waiting.contains(&task.session) {
            continue;
        }
        for index in 0..task.attempts.len() {
            let a = &task.attempts[index];
            if a.phase != Phase::Uncertain
                || a.provenance.integration != INTEGRATION
                || live.contains(&a.id)
            {
                continue;
            }
            let Some(pid) = a.native_pid.and_then(|p| i32::try_from(p).ok()).filter(|p| *p > 1)
            else {
                continue;
            };
            if !crate::claude::process_group_stopped(pid) {
                retry = true;
                continue;
            }
            let a = &mut task.attempts[index];
            a.phase = Phase::Failed;
            a.settled_ms = Some(crate::now());
            a.detail = "Host restarted and the previous Codex member process stopped without a confirmed result. Outcome unknown; the assignment will never replay.".into();
            let attempt = a.id.clone();
            save_recovered(store, &task, &attempt)?;
        }
    }
    Ok(retry)
}

// Settlement, decision cleanup and the Lead's outcome notice commit together.
fn save_recovered(store: &mut crate::Store, task: &deck2_shared::Task, attempt: &str) -> Result<(), String> {
    store
        .conn
        .execute_batch("SAVEPOINT codex_member_recovery")
        .map_err(|_| "Cannot begin Codex member recovery")?;
    let result = (|| {
        store.save_normal_task(task)?;
        let a = task.attempts.iter().find(|a| a.id == attempt).ok_or("Member attempt missing")?;
        if let Some(mut root) = store.get(task.authority_root(a))? {
            let mut changed = false;
            for d in root
                .decisions
                .iter_mut()
                .filter(|d| d.task.as_deref() == Some(task.id.as_str()) && d.attempt == attempt)
            {
                match d.state {
                    deck2_shared::DecisionState::Pending | deck2_shared::DecisionState::Responded => {
                        d.state = deck2_shared::DecisionState::Invalidated;
                        d.detail = "Member process stopped; no outstanding reply may authorize another attempt".into();
                        changed = true;
                    }
                    deck2_shared::DecisionState::Delivered => {
                        d.state = deck2_shared::DecisionState::Settled;
                        changed = true;
                    }
                    _ => {}
                }
            }
            if changed {
                store.save(&mut root)?;
            }
        }
        if let Err(error) = store.enqueue_task_outcome(&task.id, attempt) {
            let mut task = task.clone();
            let a = task.attempts.iter_mut().find(|a| a.id == attempt).ok_or("Member attempt missing")?;
            a.detail.push_str(&format!(" Lead continuation unavailable: {error}"));
            store.save_normal_task(&task)?;
        }
        store
            .conn
            .execute_batch("RELEASE codex_member_recovery")
            .map_err(|_| "Cannot commit Codex member recovery".into())
    })();
    if result.is_err() {
        let _ = store
            .conn
            .execute_batch("ROLLBACK TO codex_member_recovery; RELEASE codex_member_recovery");
    }
    result
}
