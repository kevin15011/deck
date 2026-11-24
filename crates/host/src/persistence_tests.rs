//! S5B-Q01: the predecessor must never deserialize and rewrite helper provenance.
use crate::{Store, configuration::Assignment};
use deck2_shared::{API, Mode, Phase, ScopedSubmit};
use rusqlite::Connection;

fn schema(s: &Store) -> String {
    s.conn
        .query_row("SELECT value FROM meta WHERE key='schema'", [], |r| {
            r.get(0)
        })
        .unwrap()
}
fn legacy(s: &Store, version: &str) {
    // The predecessor fixtures have no connected-session event ledger.
    s.conn.execute_batch("DROP TABLE projects; UPDATE sessions SET body=json_remove(body,'$.project'); UPDATE receipts SET body=json_remove(body,'$.configuration.project'); UPDATE tasks SET body=json_set(body,'$.attempts',json((SELECT json_group_array(json_remove(value,'$.configuration.project')) FROM json_each(tasks.body,'$.attempts')))); DROP TABLE decision_replies; DROP TABLE decision_commands; DROP TABLE session_decisions; DROP TABLE session_events").unwrap();
    s.conn
        .execute("UPDATE meta SET value=?1 WHERE key='schema'", [version])
        .unwrap();
    s.conn
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")
        .unwrap();
}
// Oracle: the installed predecessor understands through schema15. Explicit task
// numbers and original bindings must publish an incompatible boundary first.
#[test]
fn new_store_has_incompatible_schema_boundary() {
    let s = Store::open_memory("/fixture").unwrap();
    assert_eq!(schema(&s), "18");
}
// Oracle: migration preserves historical bytes, queued selection and child
// follow-up authority; restart may mark dispatched work uncertain, never replay it.
#[test]
fn schema_five_migration_retains_helper_history_and_attempts() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.db");
    let mut s = Store::open(&path, "/fixture").unwrap();
    s.register_assignment(Assignment {
        runner: "opencode 1.19.1".into(),
        model: "provider/model".into(),
        executable: "digest".into(),
        content: "policy".into(),
    })
    .unwrap();
    let mut c = s.configuration().unwrap();
    c.revision += 1;
    c.helper = Some(deck2_shared::HelperSelection {
        version: "1.2.0".into(),
        executable: "a".repeat(64),
        catalog: "b".repeat(64),
    });
    s.save_configuration(&c).unwrap();
    let mut root = s
        .admit(&ScopedSubmit {
            attachments: Vec::new(),
            api: API,
            id: "running-root".into(),
            session: s.session.clone(),
            prompt: "inspect".into(),
            mode: Mode::Team,
            queue: false,
            fresh: true,
        })
        .unwrap();
    root.phase = Phase::Running;
    root.generation = "gen".into();
    root.thread = Some("thread".into());
    root.turn = Some("turn".into());
    s.save(&mut root).unwrap();
    let queued = s
        .admit(&ScopedSubmit {
            attachments: Vec::new(),
            api: API,
            id: "queued-root".into(),
            session: s.session.clone(),
            prompt: "inspect later".into(),
            mode: Mode::Team,
            queue: true,
            fresh: true,
        })
        .unwrap();
    let authority = crate::tasks::Authority {
        root: root.id.clone(),
        attempt: root.attempt.clone(),
        generation: root.generation.clone(),
        thread: "thread".into(),
        turn: "turn".into(),
    };
    let provenance = deck2_shared::NativeProvenance {
        runner: "opencode 1.19.1".into(),
        integration: "fixture".into(),
        executable: "digest".into(),
        storage: "owned".into(),
        content: "policy".into(),
    };
    let op:crate::tasks::Operation=serde_json::from_value(serde_json::json!({"prompt":"inspect","scope":["src/lib.rs"],"acceptance":"source evidence"})).unwrap();
    let delegated = s
        .task_operation(
            &authority,
            "delegate",
            "deck_delegate",
            &op,
            &provenance,
            "provider/model",
        )
        .unwrap();
    let task = delegated["task"].as_str().unwrap();
    let attempt = delegated["attempt"].as_str().unwrap();
    s.settle_task(task, attempt, Phase::Completed, "evidence", "settled")
        .unwrap();
    let report = s.task(task).unwrap().attempts[0]
        .report
        .as_ref()
        .unwrap()
        .digest
        .clone();
    let op:crate::tasks::Operation=serde_json::from_value(serde_json::json!({"task":task,"attempt":attempt,"report":report,"disposition":"followup_required","reason":"check","prompt":"more"})).unwrap();
    s.task_operation(
        &authority,
        "treat",
        "deck_task_treat",
        &op,
        &provenance,
        "provider/model",
    )
    .unwrap();
    s.task_operation(
        &authority,
        "followup",
        "deck_task_followup",
        &op,
        &provenance,
        "provider/model",
    )
    .unwrap();
    let old_task = s.task(task).unwrap();
    let snapshot = s
        .capture_snapshot(
            &root.id,
            task,
            attempt,
            "compact",
            "src/lib.rs",
            "fn source() {}".into(),
            c.helper.clone().unwrap(),
        )
        .unwrap();
    let history: Vec<(i64, String)> = s
        .conn
        .prepare("SELECT revision,body FROM configurations ORDER BY revision")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    legacy(&s, "5");
    drop(s);
    let s = Store::open(&path, "/fixture").unwrap();
    assert_eq!(schema(&s), "18");
    assert_eq!(s.configuration().unwrap(), c);
    let after: Vec<(i64, String)> = s
        .conn
        .prepare("SELECT revision,body FROM configurations ORDER BY revision")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(history, after);
    assert_eq!(s.get(&queued.id).unwrap().unwrap(), queued);
    let running = s.get(&root.id).unwrap().unwrap();
    assert_eq!(running.configuration, root.configuration);
    assert_eq!(running.phase, Phase::Uncertain);
    let new_task = s.task(task).unwrap();
    assert_eq!(new_task.attempts.len(), 2);
    for (a, b) in old_task.attempts.iter().zip(&new_task.attempts) {
        assert_eq!(a.configuration, b.configuration);
        assert_eq!(a.report, b.report);
        assert_eq!(a.treatments, b.treatments);
        assert_eq!(a.provenance, b.provenance);
    }
    assert_eq!(
        s.read_snapshot(&snapshot.id, Some(attempt)).unwrap(),
        snapshot
    );
    assert!(s.queue_paused().unwrap());
}
// Oracle: all schema initialization is atomic, even a late failure at version
// publication after configuration/snapshot creation. Physical bytes stay intact.
#[test]
fn late_migration_failure_rolls_back_all_initialization() {
    for version in ["4", "5"] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        let s = Store::open(&path, "/fixture").unwrap();
        s.conn.execute_batch("DROP TABLE read_snapshots; DROP TABLE snapshot_views; DROP TABLE snapshot_accesses;").unwrap();
        if version == "4" {
            s.conn.execute_batch("DROP TABLE management_operations; DROP TABLE configuration_plans; DROP TABLE configurations; DROP TABLE definitions;").unwrap();
        }
        legacy(&s, version);
        s.conn.execute_batch("CREATE TRIGGER fail_six BEFORE UPDATE ON meta WHEN NEW.key='schema' AND NEW.value='18' BEGIN SELECT RAISE(ABORT,'late fault'); END;").unwrap();
        drop(s);
        let before = std::fs::read(&path).unwrap();
        assert!(
            Store::open(&path, "/fixture").is_err(),
            "migration must reach version boundary"
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("DROP TRIGGER fail_six").unwrap();
        drop(conn);
        let s = Store::open(&path, "/fixture").unwrap();
        assert_eq!(schema(&s), "18");
        assert!(s.configuration().unwrap().helper.is_none());
    }
}
// Oracle: schema 6 promises snapshot tables. Missing tables and future versions
// must fail during read-only inspection, without creating or repairing anything.
#[test]
fn incompatible_or_incomplete_state_is_rejected_without_mutation() {
    for version in ["6", "7"] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        let s = Store::open(&path, "/fixture").unwrap();
        s.conn.execute_batch("DROP TABLE read_snapshots").unwrap();
        legacy(&s, version);
        drop(s);
        let before = std::fs::read(&path).unwrap();
        assert!(Store::open(&path, "/fixture").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}

// Oracle: migration is not recovery/replay of management work. Every durable
// operation phase and reviewed intent survives verbatim, including uncertainty.
#[test]
fn schema_five_migration_preserves_every_helper_operation_phase() {
    use crate::{configuration::ApplyRequest, managed_tools::ReviewRequest};
    for phase in [
        "accepted",
        "downloading",
        "validating",
        "published_not_selected",
        "recovery_required",
        "applied",
        "cancelled",
        "stale",
        "failed",
        "denied",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.db");
        let mut s = Store::open(&path, "/fixture").unwrap();
        s.set_trust("/fixture", true).unwrap();
        let p = s
            .plan_helper(
                &ReviewRequest {
                    api: API,
                    expected_revision: s.configuration().unwrap().revision,
                    version: "1.2.0".into(),
                },
                "owned-artifacts",
            )
            .unwrap();
        s.accept_helper(
            &p.id,
            &ApplyRequest {
                api: API,
                operation_id: "retained-operation".into(),
                allow: phase != "denied",
            },
            "owned-artifacts",
        )
        .unwrap();
        if phase == "applied" {
            s.helper_progress(
                "retained-operation",
                "published_not_selected",
                true,
                "verified",
            )
            .unwrap();
            s.activate_helper("retained-operation", "owned-artifacts")
                .unwrap();
        } else if !["accepted", "denied"].contains(&phase) {
            s.helper_progress(
                "retained-operation",
                phase,
                phase == "published_not_selected",
                "retained evidence",
            )
            .unwrap();
        }
        let op = s.operation("retained-operation").unwrap();
        let c = s.configuration().unwrap();
        legacy(&s, "5");
        drop(s);
        let s = Store::open(&path, "/fixture").unwrap();
        assert_eq!(schema(&s), "18");
        assert_eq!(s.configuration().unwrap(), c);
        assert_eq!(s.helper_plan(&p.id).unwrap(), p);
        assert_eq!(s.operation("retained-operation").unwrap(), op);
    }
}

// ORDINARY-Q01: every image-capable schema must refuse corrupt persisted state
// before writable recovery. Oracle: image/session/receipt identity is immutable;
// rejection must preserve all database bytes, never repair or delete rows.
#[test]
fn image_state_corruption_is_refused_before_writes() {
    let mut failures = Vec::new();
    for version in ["10", "11"] {
        for fault in [
            "metadata",
            "image-session",
            "missing-reference",
            "foreign-reference",
            "images-table",
            "cancellations-table",
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("state.db");
            let mut s = Store::open(&path, "/fixture").unwrap();
            let session = s.session.clone();
            let bytes = include_bytes!("../../../scripts/fixtures/ordinary-image.png");
            let image = s
                .upload_image(
                    &session,
                    "image-upload",
                    crate::images::validate(bytes).unwrap(),
                    bytes,
                )
                .unwrap();
            s.admit(&ScopedSubmit {
                api: API,
                id: "image-command".into(),
                session,
                prompt: "Inspect".into(),
                mode: Mode::ReadOnly,
                attachments: vec![image.id.clone()],
                fresh: true,
                queue: true,
            })
            .unwrap();
            match fault {
                "metadata" => {
                    s.conn
                        .execute("UPDATE images SET metadata='{}'", [])
                        .unwrap();
                }
                "image-session" => {
                    s.conn
                        .execute("UPDATE images SET session='missing-session'", [])
                        .unwrap();
                }
                "missing-reference" => {
                    s.conn.execute("DELETE FROM images", []).unwrap();
                }
                "foreign-reference" => {
                    s.create_session(&deck2_shared::SessionCommand {
            project_id: None,
                        members: None,
                        approvals: None,
                        api: API,
                        id: "other-session".into(),
                        title: "Other".into(),
                    })
                    .unwrap();
                    s.conn
                        .execute("UPDATE images SET session='other-session'", [])
                        .unwrap();
                }
                "images-table" => {
                    s.conn.execute_batch("DROP TABLE images").unwrap();
                }
                "cancellations-table" => {
                    s.conn
                        .execute_batch("DROP TABLE image_cancellations")
                        .unwrap();
                }
                _ => unreachable!(),
            }
            legacy(&s, version);
            drop(s);
            let before = std::fs::read(&path).unwrap();
            let refused = Store::open(&path, "/fixture").is_err();
            if !refused || std::fs::read(&path).unwrap() != before {
                failures.push(format!("{version}/{fault}: refused={refused}"));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "corrupt state accepted or mutated: {failures:?}"
    );
}

// ORIGINAL-TASK-02: positional schema15 tasks retain their report/provenance and
// can acquire a later Lead authority without renumbering or replaying old work.
#[test]
fn schema_fifteen_task_numbers_and_current_authority_migrate_without_replay() {
    use serde_json::json;
    let dir=tempfile::tempdir().unwrap();let project=dir.path().to_str().unwrap();let path=dir.path().join("state.db");
    let mut s=Store::open(&path,project).unwrap();s.register_codex("a".repeat(64)).unwrap();
    let c=serde_json::from_value(json!({"api":API,"id":"legacy-task-session","title":"Fixture","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"},"investigate":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();s.create_session(&c).unwrap();
    let input=serde_json::from_value(json!({"api":API,"id":"legacy-task-lead","session":"legacy-task-session","mode":"session_v1","prompt":"Coordinate"})).unwrap();let mut r=s.admit(&input).unwrap();r.phase=Phase::Running;s.save(&mut r).unwrap();
    let delegated=crate::session_tasks::tool(&mut s,&r.id,"deck_delegate",&json!({"agent":"investigate","task":"Inspect"}),"legacy-task-call").unwrap();let id=delegated["taskId"].as_str().unwrap().to_string();
    let mut t=s.task(&id).unwrap();let a=&mut t.attempts[0];a.phase=Phase::Completed;a.report=Some(deck2_shared::TaskReport {attempt:a.id.clone(),digest:crate::tasks::digest(b"preserved"),text:"preserved".into()});s.save_normal_task(&t).unwrap();r.phase=Phase::Completed;s.save(&mut r).unwrap();
    // Model the real predecessor encoding, not a newly numbered execution row.
    s.conn.execute_batch("UPDATE tasks SET body=json_remove(body,'$.attempts[0].number','$.attempts[0].authority'); UPDATE task_calls SET result=json_remove(result,'$.internalTaskId'); UPDATE meta SET value='15' WHERE key='schema';").unwrap();drop(s);
    let mut s=Store::open(&path,project).unwrap();assert_eq!(schema(&s),"18");let old=s.task(&id).unwrap();assert_eq!(old.number(0),1);assert!(old.attempts[0].authority.is_none());assert_eq!(old.attempts[0].report,t.attempts[0].report);assert_eq!(old.attempts[0].provenance,t.attempts[0].provenance);
    let input=serde_json::from_value(json!({"api":API,"id":"legacy-task-later","session":"legacy-task-session","mode":"session_v1","prompt":"Continue"})).unwrap();let mut r=s.admit(&input).unwrap();r.phase=Phase::Running;s.save(&mut r).unwrap();
    let continued=crate::session_tasks::tool(&mut s,&r.id,"deck_delegate",&json!({"agent":"investigate","continueTaskId":id,"task":"Continue"}),"legacy-task-next").unwrap();assert_eq!(continued["taskId"],id);assert_eq!(continued["attempt"],2);let now=s.task(&id).unwrap();assert_eq!(now.number(0),1);assert_eq!(now.number(1),2);assert_eq!(now.authority_root(&now.attempts[1]),r.id);assert_eq!(now.root,"legacy-task-lead");crate::session_tasks::inspect_events(&s.conn).unwrap();
}

// ASSIGN-06: schema16 cannot resume an evolved source context. Publish schema17
// only after every original generation is populated, and roll back late failure.
#[test]
fn assignment_schema16_migration_and_rollback_preserve_original_generation() {
    let f=tempfile::tempdir().unwrap();let path=f.path().join("state.db");let project=f.path().to_str().unwrap();
    let mut s=Store::open(&path,project).unwrap();
    let c=serde_json::from_value(serde_json::json!({"api":API,"id":"migration-original","title":"Original","members":{"lead":{"runnerId":"codex","modelId":"openai-codex/gpt-6.1-sol"}}})).unwrap();
    let mut session=s.create_session(&c).unwrap();session.contract.as_mut().unwrap().generation=7;
    session.original=Some(deck2_shared::OriginalContext {fingerprint:"a".repeat(64),task:session.contract.as_ref().unwrap().lead_task.clone(),attempt:3,thread:"12345678-1234-1234-1234-123456789abc".into(),model:"openai-codex/gpt-6.1-sol".into()});
    session.original_generation=Some(7);s.save_session(&session).unwrap();
    s.conn.execute_batch("UPDATE sessions SET body=json_remove(body,'$.original_generation'); UPDATE meta SET value='16' WHERE key='schema'; CREATE TRIGGER assignment_migration_fault BEFORE UPDATE ON meta WHEN NEW.key='schema' AND NEW.value='18' BEGIN SELECT RAISE(ABORT,'late fault'); END; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;").unwrap();
    drop(s);let before=std::fs::read(&path).unwrap();assert!(Store::open(&path,project).is_err());assert_eq!(std::fs::read(&path).unwrap(),before);
    let conn=Connection::open(&path).unwrap();assert_eq!(conn.query_row("SELECT value FROM meta WHERE key='schema'",[],|r|r.get::<_,String>(0)).unwrap(),"16");conn.execute_batch("DROP TRIGGER assignment_migration_fault").unwrap();drop(conn);
    let mut s=Store::open(&path,project).unwrap();assert_eq!(schema(&s),"18");assert_eq!(s.session_by_id(&session.id).unwrap(),session);
    let a=serde_json::from_value(serde_json::json!({"runnerId":"codex","modelId":"recorded-worker","thinking":"high"})).unwrap();
    let evolved=s.assign_member(&session.id,"lead",a,1).unwrap();assert_eq!(evolved.original_generation,Some(7));assert_eq!(evolved.contract.as_ref().unwrap().generation,8);
    drop(s);let s=Store::open(&path,project).unwrap();assert_eq!(s.session_by_id(&session.id).unwrap(),evolved);
}

// OPENCODE-06 oracle: recognized Codex legacy contexts gain only a transport
// discriminator. Unknown legacy admissions must not acquire storage/executable/
// configuration authority. This does not qualify OpenCode session admission.
#[test]
fn schema17_runner_identity_migrates_atomically_without_inventing_authority() {
    use serde_json::{Value, json};
    let f = tempfile::tempdir().unwrap();
    let path = f.path().join("state.db");
    let project = f.path().to_str().unwrap();
    let mut s = Store::open(&path, project).unwrap();
    let id = s.session.clone();
    s.bind_native(&id, "legacy-codex-thread", Mode::ReadOnly, deck2_shared::NativeRunner::Codex).unwrap();
    s.register_codex("a".repeat(64)).unwrap();
    let c = serde_json::from_value(json!({"api":API,"id":"transport-session","title":"Transport","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap();
    s.create_session(&c).unwrap();
    let input = serde_json::from_value(json!({"api":API,"id":"transport-receipt","session":"transport-session","mode":"session_v1","prompt":"Coordinate"})).unwrap();
    let mut receipt = s.admit(&input).unwrap();
    receipt.phase = Phase::Running;
    receipt.thread = Some("native".into()); receipt.turn = Some("turn".into());
    let mut decision = crate::session_contract::native_decision(&receipt, &receipt.generation, "native", "turn", &json!({"id":1,"method":"item/commandExecution/requestApproval","params":{"threadId":"native","turnId":"turn","command":"fixture"}})).unwrap();
    decision.state = deck2_shared::DecisionState::Settled;
    receipt.decisions.push(decision); receipt.phase = Phase::Completed;
    s.save(&mut receipt).unwrap();
    s.conn.execute_batch("UPDATE receipts SET body=json_remove(body,'$.decisions[0].native.transport') WHERE id='transport-receipt'").unwrap();

    // Exact predecessor encoding, including an unknown restricted admission.
    s.conn.execute_batch("UPDATE sessions SET body=json_remove(body,'$.native.runner'); UPDATE meta SET value='17' WHERE key='schema'; CREATE TRIGGER opencode_migration_fault BEFORE UPDATE ON meta WHEN NEW.key='schema' AND NEW.value='18' BEGIN SELECT RAISE(ABORT,'late fault'); END; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;").unwrap();
    let old: String = s.conn.query_row("SELECT body FROM sessions WHERE id=?1", [&id], |r|r.get(0)).unwrap();
    drop(s);
    let before = std::fs::read(&path).unwrap();
    assert!(Store::open(&path, project).is_err(), "schema18 publication must be transactional");
    assert_eq!(std::fs::read(&path).unwrap(), before);
    let c = Connection::open(&path).unwrap();
    assert_eq!(c.query_row("SELECT value FROM meta WHERE key='schema'", [], |r|r.get::<_,String>(0)).unwrap(), "17");
    assert_eq!(c.query_row("SELECT body FROM sessions WHERE id=?1", [&id], |r|r.get::<_,String>(0)).unwrap(), old);
    c.execute_batch("DROP TRIGGER opencode_migration_fault").unwrap(); drop(c);
    let s = Store::open(&path, project).unwrap();
    assert_eq!(schema(&s), "18");
    let encoded = serde_json::to_value(s.session_by_id(&id).unwrap()).unwrap();
    assert_eq!(encoded["native"]["runner"], "codex");
    assert_eq!(encoded["native"]["thread"], "legacy-codex-thread");
    assert!(encoded["native"]["provenance"].is_null());
    let mut original: Value = serde_json::from_str(&old).unwrap();
    original["native"]["runner"] = json!("codex");
    assert_eq!(encoded, original);
    let migrated = s.get(&receipt.id).unwrap().unwrap();
    assert_eq!(migrated, receipt, "migration must retain decisions, observations, prompts and admission evidence");
    assert!(migrated.configuration.as_ref().unwrap().native.is_none(), "migration must not invent native storage or executable admission evidence");

    drop(s);
    let s = Store::open(&path, project).unwrap();
    assert_eq!(serde_json::to_value(s.session_by_id(&id).unwrap()).unwrap(), encoded);
    s.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;").unwrap();
    drop(s);
    for (name, sql) in [
        ("namespace", "UPDATE sessions SET body=json_remove(body,'$.native.runner') WHERE json_type(body,'$.native')='object'"),
        ("transport", "UPDATE receipts SET body=json_set(body,'$.decisions[0].native.transport','opencode_http') WHERE id='transport-receipt'"),
        ("admission", "UPDATE receipts SET body=json_set(body,'$.configuration.native',json('{\"runner\":\"opencode\"}')) WHERE id='transport-receipt'"),
    ] {
        let corrupt = f.path().join(format!("{name}.db"));
        std::fs::copy(&path, &corrupt).unwrap();
        let conn = Connection::open(&corrupt).unwrap(); conn.execute_batch(sql).unwrap(); drop(conn);
        let before = std::fs::read(&corrupt).unwrap();
        assert!(Store::open(&corrupt, project).is_err(), "corrupt {name} must fail before recovery");
        assert_eq!(std::fs::read(&corrupt).unwrap(), before, "corrupt {name} was mutated");
    }

}

#[test]
fn codex_command_projection_withholds_continued_credentials() {
    use serde_json::json;

    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_str().unwrap();
    let mut store = Store::open(&dir.path().join("state.db"), root).unwrap();
    store.register_codex("a".repeat(64)).unwrap();
    store.create_session(&serde_json::from_value(json!({
        "api": API, "id": "codex-command-session", "title": "Command fixture",
        "members": {"lead": {"runnerId": "codex", "modelId": "gpt-6.1-sol"}}
    })).unwrap()).unwrap();
    let mut receipt = store.admit(&serde_json::from_value(json!({
        "api": API, "id": "codex-command-receipt", "session": "codex-command-session",
        "mode": "session_v1", "prompt": "Command fixture"
    })).unwrap()).unwrap();
    receipt.phase = Phase::Running;
    receipt.thread = Some("thread".into());
    receipt.turn = Some("turn".into());
    let decision = crate::codex_protocol::native_decision(
        &receipt, &receipt.generation, "thread", "turn", &json!({
            "id": 1, "method": "item/commandExecution/requestApproval",
            "params": {"threadId": "thread", "turnId": "turn", "cwd": root,
                "command": "fixture --clientSecret\\\n   \"FIXTURE_QUOTED_SENTINEL two words\""}
        }),
    ).unwrap();
    let view = crate::execution_view::decision(&decision);
    // Chromium uses this exact host projection as the Codex card's presentation.
    println!("CODEX_DOCK_PROJECTION={view}");
    assert_eq!(view["kind"], "command");
    assert_eq!(view["details"]["cwd"], root);
    assert!(!view.to_string().contains("FIXTURE_QUOTED_SENTINEL"));
}

// protects: Q92-01 exact retained persistent scope, projection/reply equality,
// independent host rejection and revision authority. Oracle: accepted UI20 contract;
// fails if prose authorizes a grant or a stale/unsupported scope reaches native reply.
#[test]
fn persistent_scope_projection_and_reply_share_retained_authority() {
    use serde_json::{json, Value};
    use deck2_shared::{DecisionResponse, Resolve};
    let f = tempfile::tempdir().unwrap();
    let mut s = Store::open(&f.path().join("state.db"), f.path().to_str().unwrap()).unwrap();
    s.register_codex("a".repeat(64)).unwrap();
    s.create_session(&serde_json::from_value(json!({"api":API,"id":"persistent-session","title":"Scope","members":{"lead":{"runnerId":"codex","modelId":"gpt-6.1-sol"}}})).unwrap()).unwrap();
    let mut r=s.admit(&serde_json::from_value(json!({"api":API,"id":"persistent-receipt","session":"persistent-session","mode":"session_v1","prompt":"Scope fixture"})).unwrap()).unwrap();
    r.phase=Phase::Running;r.thread=Some("thread".into());r.turn=Some("turn".into());
    let scope=json!(["git","-C","project path","status","--"]);
    std::fs::create_dir(f.path().join("project path")).unwrap();
    let mut d=crate::codex_protocol::native_decision(&r,&r.generation,"thread","turn",&json!({"id":1,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread","turnId":"turn","command":"git -C 'project path' status --","cwd":f.path(),"proposedExecpolicyAmendment":scope}})).unwrap();
    let view=crate::execution_view::decision(&d);
    assert_eq!(view["persistent_grant"]["prefix"],scope);
    assert_eq!(view["persistent_grant"]["persistence"],"across_sessions");
    assert_eq!(view["persistent_grant"]["revocation"],"outside_deck");
    r.decisions.push(d.clone());s.save(&mut r).unwrap();
    let mut reply=Resolve{api:API,command_id:"persistent-response".into(),expected_revision:d.revision+1,response:DecisionResponse::AllowAlways};
    assert!(s.resolve(&d.id,&reply).is_err());
    reply.expected_revision=d.revision;
    s.resolve(&d.id,&reply).unwrap();
    d=s.get(&r.id).unwrap().unwrap().decisions[0].clone();
    let wire=crate::codex_protocol::native_reply(&d).unwrap();
    assert_eq!(wire["decision"]["acceptWithExecpolicyAmendment"]["execpolicy_amendment"],view["persistent_grant"]["prefix"]);
    let mut changed=s.get(&r.id).unwrap().unwrap();
    let native=changed.decisions[0].native.as_mut().unwrap();
    let mut params:Value=serde_json::from_str(&native.parameters).unwrap();
    params["proposedExecpolicyAmendment"]=json!(["git"]);native.parameters=params.to_string();
    assert!(s.save(&mut changed).is_err(), "same decision cannot silently change scope");
    assert_eq!(s.get(&r.id).unwrap().unwrap().decisions[0].native,d.native);
    let mut wrapper = crate::codex_protocol::native_decision(&r, &r.generation, "thread", "turn", &json!({
        "id":2,"method":"item/commandExecution/requestApproval","params":{
            "threadId":"thread","turnId":"turn","command":"rtk git status","cwd":f.path(),
            "proposedExecpolicyAmendment":["rtk"]
        }
    })).unwrap();
    let view = crate::execution_view::decision(&wrapper);
    assert!(view["persistent_grant"].is_null());
    assert!(!view["responses"].as_array().unwrap().contains(&json!("allow_always")));
    wrapper.resolution = Some(Resolve { response: DecisionResponse::AllowAlways, ..reply.clone() });
    assert!(crate::codex_protocol::native_reply(&wrapper).is_err());

    // Invalid partitions retain forged historical prose, proving it grants no authority.
    for bad in [Value::Null,json!([]),json!([""]),json!([42]),json!(["x\n"]),json!(["git"]),json!(["git","-C","project path"]),json!(["\u{202e}x"]),json!(["Bearer credential"]),json!(["https://user:pass@host"]),json!(["https://host/?%74oken=credential"]),json!(["token=credential"]),json!(["?key=credential"]),json!(["&sig=credential"]),json!(["Basic credential"]),json!(["accesskey=credential"]),json!(vec!["x"; 129]),json!(["x".repeat(8192)])] {
        let mut invalid=d.clone();
        let n=invalid.native.as_mut().unwrap();
        let mut p:Value=serde_json::from_str(&n.parameters).unwrap();p["proposedExecpolicyAmendment"]=bad;n.parameters=p.to_string();n.always_note=Some("forged authority".into());
        assert!(crate::execution_view::decision(&invalid)["persistent_grant"].is_null());
        assert!(crate::codex_protocol::native_reply(&invalid).is_err());
        invalid.id=uuid::Uuid::new_v4().to_string();invalid.state=deck2_shared::DecisionState::Pending;invalid.resolution=None;
        let mut current=s.get(&r.id).unwrap().unwrap();current.decisions.push(invalid.clone());s.save(&mut current).unwrap();
        reply.command_id=uuid::Uuid::new_v4().to_string();reply.expected_revision=invalid.revision;
        assert!(s.resolve(&invalid.id,&reply).is_err());
    }
}
