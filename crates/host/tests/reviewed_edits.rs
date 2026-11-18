// Protects S2's explicit mode admission; the oracle is the accepted S2 contract.
#[test]
fn reviewed_mode_is_an_explicit_command_contract() {
    let value = serde_json::json!({"api":1,"id":"reviewed-command","prompt":"Edit example.txt","mode":"reviewed_edit"});
    assert!(
        serde_json::from_value::<deck2_shared::Submit>(value).is_ok(),
        "Reviewed edits require an explicit admitted mode, separate from per-action approval"
    );
}

use deck2::{Store, decisions::text_file};
use deck2_shared::{
    API, Decision, DecisionResponse, DecisionState, FileEffect, Mode, Phase, Resolve, Submit,
};
fn fixture() -> (tempfile::TempDir, Store, String) {
    let root = tempfile::tempdir().unwrap();
    let project = root.path().to_str().unwrap();
    let path = root.path().join("example.txt");
    std::fs::write(&path, "before\n").unwrap();
    let mut store = Store::open(&root.path().join("state.db"), project).unwrap();
    store.set_trust(project, true).unwrap();
    let mut r = store
        .accept(&Submit {
            attachments: Vec::new(),
            api: API,
            id: "review-command".into(),
            prompt: "edit".into(),
            mode: Mode::ReviewedEdit,
        })
        .unwrap();
    r.phase = Phase::Running;
    r.generation = "generation".into();
    r.thread = Some("thread".into());
    r.turn = Some("turn".into());
    r.decisions.push(Decision {
        task: None,
        native: None,
        id: "decision-1".into(),
        session: store.session.clone(),
        command: r.id.clone(),
        attempt: r.attempt.clone(),
        generation: r.generation.clone(),
        thread: "thread".into(),
        turn: "turn".into(),
        item: "item".into(),
        request: "42".into(),
        revision: 1,
        state: DecisionState::Pending,
        file: Some(FileEffect {
            identity: Some(
                deck2::decisions::file_identity(project, path.to_str().unwrap()).unwrap(),
            ),
            path: path.to_str().unwrap().into(),
            before: "before\n".into(),
            diff: "@@ -1 +1 @@\n-before\n+after\n".into(),
            after: None,
            native_status: None,
            snapshot_error: None,
        }),
        questions: vec![],
        resolution: None,
        dispatch_ms: None,
        delivered_ms: None,
        grant_consumed: false,
        detail: String::new(),
    });
    store.save(&mut r).unwrap();
    (root, store, path.to_str().unwrap().into())
}
fn response() -> Resolve {
    Resolve {
        api: API,
        command_id: "response-command".into(),
        expected_revision: 1,
        response: DecisionResponse::AllowOnce,
    }
}
#[test]
fn exact_response_identity_is_durable_and_release_happens_once() {
    let (_root, mut s, _) = fixture();
    let response = response();
    s.resolve("decision-1", &response).unwrap();
    assert!(!s.get("review-command").unwrap().unwrap().decisions[0].grant_consumed);
    assert!(s.resolve("wrong-decision", &response).is_err());
    let mut conflict = response.clone();
    conflict.response = DecisionResponse::Deny;
    assert!(s.resolve("decision-1", &conflict).is_err());
    assert!(
        s.authorize_response("review-command", "decision-1", "old-generation")
            .unwrap()
            .is_none()
    );
    let released = s
        .authorize_response("review-command", "decision-1", "generation")
        .unwrap()
        .unwrap();
    assert!(released.grant_consumed && released.dispatch_ms.is_some());
    assert_eq!(
        s.resolve("decision-1", &response).unwrap().state,
        DecisionState::Dispatching
    );
    assert!(
        s.authorize_response("review-command", "decision-1", "generation")
            .unwrap()
            .is_none()
    );
}
#[test]
fn stale_revision_cancel_revoke_and_changed_target_never_release() {
    for case in ["revision", "cancel", "revoke", "target", "attempt"] {
        let (_root, mut s, path) = fixture();
        let mut response = response();
        if case == "revision" {
            response.expected_revision = 2;
            assert!(s.resolve("decision-1", &response).is_err());
            continue;
        }
        s.resolve("decision-1", &response).unwrap();
        match case {
            "cancel" => {
                s.request_cancel("review-command").unwrap();
            }
            "revoke" => {
                let p = s.project.clone();
                s.set_trust(&p, false).unwrap();
            }
            "target" => std::fs::write(&path, "user edits\n").unwrap(),
            "attempt" => {
                let mut r = s.get("review-command").unwrap().unwrap();
                r.attempt = "other-attempt".into();
                s.save(&mut r).unwrap();
            }
            _ => unreachable!(),
        }
        assert!(
            !matches!(
                s.authorize_response("review-command", "decision-1", "generation"),
                Ok(Some(_))
            ),
            "{case} released permission"
        );
        assert!(!s.get("review-command").unwrap().unwrap().decisions[0].grant_consumed);
    }
}
#[test]
fn restart_never_replays_response_intent_and_rejects_old_connection() {
    for dispatched in [false, true] {
        let (root, mut s, _) = fixture();
        s.resolve("decision-1", &response()).unwrap();
        if dispatched {
            s.authorize_response("review-command", "decision-1", "generation")
                .unwrap();
        }
        let project = s.project.clone();
        drop(s);
        let mut s = Store::open(&root.path().join("state.db"), &project).unwrap();
        assert_eq!(
            s.get("review-command").unwrap().unwrap().phase,
            Phase::Uncertain
        );
        assert!(
            s.authorize_response("review-command", "decision-1", "generation")
                .unwrap()
                .is_none()
        );
        let decision = &s.get("review-command").unwrap().unwrap().decisions[0];
        assert_eq!(
            decision.state,
            if dispatched {
                DecisionState::Uncertain
            } else {
                DecisionState::Invalidated
            }
        );
    }
}
#[test]
fn file_scope_rejects_links_binary_and_oversized_targets() {
    use std::os::unix::fs::symlink;
    let (root, s, path) = fixture();
    let link = root.path().join("link");
    symlink(&path, &link).unwrap();
    assert!(text_file(&s.project, link.to_str().unwrap()).is_err());
    assert!(text_file(&s.project, "/etc/passwd").is_err());
    std::fs::write(&path, b"binary\0").unwrap();
    assert!(text_file(&s.project, &path).is_err());
    std::fs::write(&path, vec![b'x'; 65537]).unwrap();
    assert!(text_file(&s.project, &path).is_err());
}

#[test]
fn question_answers_are_not_file_grants_and_project_trust_is_not_a_grant() {
    let (_root, mut s, _) = fixture();
    assert!(!s.get("review-command").unwrap().unwrap().decisions[0].grant_consumed);
    let mut r = s.get("review-command").unwrap().unwrap();
    r.decisions[0].file = None;
    r.decisions[0].questions = vec![deck2_shared::Question {
        multiple: false,
        id: "question".into(),
        header: "Choice".into(),
        question: "Which?".into(),
        options: vec![],
    }];
    s.save(&mut r).unwrap();
    assert!(s.resolve("decision-1", &response()).is_err());
    let mut response = response();
    response.response = DecisionResponse::Answers(std::collections::BTreeMap::from([(
        "question".into(),
        vec!["answer".into()],
    )]));
    s.resolve("decision-1", &response).unwrap();
    let released = s
        .authorize_response("review-command", "decision-1", "generation")
        .unwrap()
        .unwrap();
    assert!(!released.grant_consumed);
}
#[test]
fn recognized_migration_rolls_back_on_failure_without_journal_changes() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("state.db");
    let s = Store::open(&path, "/project").unwrap();
    drop(s);
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("PRAGMA journal_mode=DELETE; DROP TABLE projects; DROP TABLE decision_replies; DROP TABLE decision_commands; DROP TABLE session_decisions; DROP TABLE session_events; DROP TABLE sessions; DROP TABLE tasks; DROP TABLE task_calls; DROP TABLE configurations; DROP TABLE configuration_plans; DROP TABLE management_operations; DROP TABLE definitions; DROP TABLE read_snapshots; DROP TABLE snapshot_views; DROP TABLE snapshot_accesses; DELETE FROM meta WHERE key IN ('trusted','host','queue_paused'); UPDATE meta SET value='1' WHERE key='schema'; CREATE TRIGGER fail_migration BEFORE UPDATE ON meta BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
    drop(conn);
    let before = std::fs::read(&path).unwrap();
    assert!(Store::open(&path, "/project").is_err());
    assert_eq!(std::fs::read(&path).unwrap(), before);
    let conn = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row("SELECT value FROM meta WHERE key='schema'", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "1"
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM meta WHERE key='trusted'", [], |r| r
            .get::<_, u32>(
            0
        ))
        .unwrap(),
        0
    );
    assert_eq!(
        conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "delete"
    );
    conn.execute_batch("DROP TRIGGER fail_migration").unwrap();
    drop(conn);
    let store = Store::open(&path, "/project").unwrap();
    assert!(!store.trusted().unwrap());
}

#[test]
fn failed_intent_persistence_never_consumes_a_grant() {
    let (root, mut store, _) = fixture();
    store.resolve("decision-1", &response()).unwrap();
    let conn = rusqlite::Connection::open(root.path().join("state.db")).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_intent BEFORE UPDATE ON receipts BEGIN SELECT RAISE(ABORT,'injected disk failure'); END;").unwrap();
    assert!(
        store
            .authorize_response("review-command", "decision-1", "generation")
            .is_err()
    );
    let r = store.get("review-command").unwrap().unwrap();
    assert!(!r.decisions[0].grant_consumed);
    assert!(r.decisions[0].dispatch_ms.is_none());
    assert_eq!(r.decisions[0].state, DecisionState::Responded);
}

// S3 ownership is the receipt's conversation, not the legacy default session.
#[test]
fn reviewed_effect_in_another_conversation_keeps_its_own_authority() {
    let (_root, mut s, _) = fixture();
    let other = s
        .create_session(&deck2_shared::SessionCommand {
            project_id: None,
            members: None,
            approvals: None,
            api: API,
            id: "session-second".into(),
            title: "Second".into(),
        })
        .unwrap();
    let mut r = s.get("review-command").unwrap().unwrap();
    r.session = other.id.clone();
    r.decisions[0].session = other.id.clone();
    s.save(&mut r).unwrap();
    s.resolve("decision-1", &response()).unwrap();
    let released = s
        .authorize_response("review-command", "decision-1", "generation")
        .unwrap()
        .unwrap();
    assert_eq!(released.session, other.id);
    assert!(released.grant_consumed);
    assert!(
        s.authorize_response("review-command", "decision-1", "generation")
            .unwrap()
            .is_none()
    );
}
// Protects ordinary-session file identity after asynchronous specialist work.
// Oracle: approval for an inode cannot authorize a replacement, even with equal bytes.
#[test]
fn ordinary_replacement_with_identical_bytes_never_releases() {
    let (_root, mut s, path) = fixture();
    let mut r = s.get("review-command").unwrap().unwrap();
    r.mode = Mode::OrdinaryReviewedV1;
    s.save(&mut r).unwrap();
    s.resolve("decision-1", &response()).unwrap();
    std::fs::rename(&path, format!("{path}.original")).unwrap();
    std::fs::write(&path, "before\n").unwrap();
    assert!(
        s.authorize_response("review-command", "decision-1", "generation")
            .unwrap()
            .is_none()
    );
    assert!(!s.get("review-command").unwrap().unwrap().decisions[0].grant_consumed);
}
// Oracle: a reviewed grant waits for child cleanup, and a released effect excludes
// new child work until native effect settlement. Unknown cleanup keeps exclusion.
#[test]
fn ordinary_effect_waits_for_specialist_settlement_and_rechecks_target() {
    for uncertain in [false, true] {
        let (_root, mut s, path) = fixture();
        let mut r = s.get("review-command").unwrap().unwrap();
        r.phase = Phase::Completed;
        s.save(&mut r).unwrap();
        let config = s.configuration().unwrap();
        let assignment = deck2_shared::Assignment {
            runner: "codex 0.166.0".into(),
            model: "gpt-6.1-sol".into(),
            executable: "fixture".into(),
            content: "fixture".into(),
        };
        let selection = s
            .save_ordinary_selection(
                &r.session,
                0,
                Mode::OrdinaryReviewedV1,
                config,
                Some(assignment.clone()),
            )
            .unwrap();
        r.mode = Mode::OrdinaryReviewedV1;
        r.phase = Phase::Running;
        r.configuration = Some(selection.snapshot);
        s.save(&mut r).unwrap();
        let authority = deck2::tasks::Authority {
            root: r.id.clone(),
            attempt: r.attempt.clone(),
            generation: r.generation.clone(),
            thread: "thread".into(),
            turn: "turn".into(),
        };
        let native = deck2_shared::NativeProvenance {
            runner: assignment.runner,
            integration: "fixture".into(),
            executable: assignment.executable,
            content: assignment.content,
            storage: "fixture".into(),
        };
        let op=serde_json::from_value(serde_json::json!({"scope":["example.txt"],"acceptance":"Inspect current source", "prompt":"Read example.txt"})).unwrap();
        let child = s
            .task_operation(
                &authority,
                "delegate-call",
                "deck_delegate",
                &op,
                &native,
                "gpt-6.1-sol",
            )
            .unwrap();
        s.resolve("decision-1", &response()).unwrap();
        assert!(
            s.authorize_response(&r.id, "decision-1", "generation")
                .unwrap()
                .is_none()
        );
        let task = child["task"].as_str().unwrap();
        let attempt = child["attempt"].as_str().unwrap();
        s.settle_task(
            task,
            attempt,
            if uncertain {
                Phase::Uncertain
            } else {
                Phase::Completed
            },
            "Exact report",
            "cleanup result",
        )
        .unwrap();
        if uncertain {
            assert!(
                s.authorize_response(&r.id, "decision-1", "generation")
                    .unwrap()
                    .is_none()
            );
        } else {
            // Trust and file identities are checked after child settlement.
            std::fs::write(&path, "changed during investigation\n").unwrap();
            assert!(
                s.authorize_response(&r.id, "decision-1", "generation")
                    .unwrap()
                    .is_none()
            );
            assert!(!s.get(&r.id).unwrap().unwrap().decisions[0].grant_consumed);
        }
    }
}
// The same response boundary applies to ordinary permissions; trust is never a grant.
#[test]
fn ordinary_permission_denial_revocation_and_foreign_generation_remain_enforced() {
    for case in ["allow", "deny", "read_only", "revoke", "cancel", "foreign"] {
        let (_root, mut s, _path) = fixture();
        let mut r = s.get("review-command").unwrap().unwrap();
        r.mode = if case == "read_only" {
            Mode::OrdinaryReadOnlyV1
        } else {
            Mode::OrdinaryReviewedV1
        };
        s.save(&mut r).unwrap();
        let mut response = response();
        if case == "deny" {
            response.response = DecisionResponse::Deny;
        }
        s.resolve("decision-1", &response).unwrap();
        if case == "revoke" {
            let p = s.project.clone();
            s.set_trust(&p, false).unwrap();
        }
        if case == "cancel" {
            s.request_cancel(&r.id).unwrap();
        }
        let result = s.authorize_response(
            &r.id,
            "decision-1",
            if case == "foreign" {
                "foreign"
            } else {
                "generation"
            },
        );
        if case == "read_only" {
            assert!(result.is_err());
        } else if case == "allow" || case == "deny" {
            assert_eq!(result.unwrap().unwrap().grant_consumed, case == "allow");
        } else {
            assert!(result.unwrap().is_none());
        }
    }
}
