use deck2::{
    cbm_artifacts::{Artifacts, release},
    cbm_runtime::control,
    cbm_service::{Service, Snapshot},
};
use serde_json::json;
use std::{
    os::unix::fs::PermissionsExt,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
// Exact local binaries are opt-in: no network and no personal daemon/profile effects.
// Exercises default packaged supervisor composition, not the Python prototype.
#[test]
#[ignore = "requires explicitly qualified local CBM archives and Linux namespaces"]
fn actual_rust_supervisor_prepares_and_queries_scoped_index() {
    let input = std::env::var("DECK2_CBM_QUALIFIED").expect("qualified artifact directory");
    let evidence = std::path::Path::new(&input)
        .parent()
        .unwrap()
        .join("s5c-production");
    std::fs::create_dir_all(&evidence).unwrap();
    let store = tempfile::Builder::new()
        .prefix("native-")
        .tempdir_in(&evidence)
        .unwrap();
    let project = tempfile::tempdir().unwrap();
    std::fs::set_permissions(store.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let a = Artifacts::open(store.path()).unwrap();
    for v in ["0.12.0", "0.12.1"] {
        a.publish(
            &release(v).unwrap(),
            &std::fs::read(std::path::Path::new(&input).join(v).join("archive.tar.gz")).unwrap(),
        )
        .unwrap();
    }
    std::fs::write(
        project.path().join("handler.py"),
        "def handler(value):\n    return value + 42\n\ndef caller():\n    return handler(1)\n",
    )
    .unwrap();
    std::fs::write(project.path().join("Dockerfile"), "FROM nginx\n").unwrap();
    let snap =
        Snapshot::capture(project.path(), &["handler.py".into(), "Dockerfile".into()]).unwrap();
    let s = Service::create(store.path(), &snap, "0.12.0").unwrap();
    let log = std::fs::File::create(store.path().join("supervisor.log")).unwrap();
    let mut child = Command::new(packaged_binary())
        .args([
            "cbm-supervisor",
            "--store",
            store.path().to_str().unwrap(),
            "--service",
            &s.id,
            "--verification-pause-after",
            "diagnostics",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(log)
        .spawn()
        .unwrap();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        (|| -> Result<(), String> {
            let until = Instant::now() + Duration::from_secs(60);
            while !s.path.join("control.sock").exists() {
                if child.try_wait().unwrap().is_some() {
                    return Err(
                        std::fs::read_to_string(store.path().join("supervisor.log")).unwrap()
                    );
                }
                if Instant::now() > until {
                    return Err("supervisor start timeout".into());
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            let prepared = control(&s.path, &json!({"action":"prepare"}))?;
            eprintln!("prepared {prepared}");
            // Seed real owned ADR/configuration state. Runtime reads it through native
            // health and must retain it in both migration and paired restoration.
            let c = rusqlite::Connection::open(s.path.join("state/cache/scope-repo.db"))
                .map_err(|e| e.to_string())?;
            c.execute(
            "INSERT INTO project_summaries VALUES('scope-repo',?1,'','2026-11-11','2026-11-11')",
            ["# Production qualification\nRetain this scoped decision across migration."],
        )
        .map_err(|e| e.to_string())?;
            drop(c);
            let c = rusqlite::Connection::open(s.path.join("state/cache/_config.db"))
                .map_err(|e| e.to_string())?;
            c.execute(
            "INSERT INTO config(key,value) VALUES('auto_index_limit','1234') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [],
        )
        .map_err(|e| e.to_string())?;
            drop(c);
            let locks = lock_identity(&s)?;
            s.reserve("host-a", "root-a", &snap.digest, 1, "0.12.0")?;
            let found = control(
                &s.path,
                &json!({"action":"query","host":"host-a","root":"root-a","tool":"search_graph","arguments":{"name_pattern":"handler"}}),
            )?;
            assert!(found.to_string().contains("handler"));
            eprintln!("graph {found}");
            let coverage = control(
                &s.path,
                &json!({"action":"query","host":"host-a","root":"root-a","tool":"check_index_coverage","arguments":{}}),
            )?;
            assert!(coverage.to_string().contains("handler.py"), "{coverage}");
            let b = Service::open(store.path(), &s.id)?;
            b.reserve("host-b", "root-b", &snap.digest, 1, "0.12.0")?;
            let deferred = control(
                &s.path,
                &json!({"action":"update","version":"0.12.1","operation":"native-update"}),
            )?;
            assert_eq!(deferred["phase"], "deferred");
            let still_live = control(
                &s.path,
                &json!({"action":"query","host":"host-a","root":"root-a","tool":"trace_path","arguments":{"function_name":"handler","direction":"inbound"}}),
            )?;
            assert!(still_live.to_string().contains("caller"));
            s.release("host-a", "root-a")?;
            b.release("host-b", "root-b")?;
            let updated = control(
                &s.path,
                &json!({"action":"update","version":"0.12.1","operation":"native-update"}),
            )?;
            eprintln!("update {updated}");
            assert_eq!(updated["phase"], "committed", "activation reply: {updated}");
            assert_eq!(s.record()?.version, "0.12.1");
            assert_eq!(graph_format(&s)?, 3);
            s.reserve("host-a", "updated-root", &snap.digest, 2, "0.12.1")?;
            let image = control(
                &s.path,
                &json!({"action":"query","host":"host-a","root":"updated-root","tool":"search_graph","arguments":{"name_pattern":"nginx"}}),
            )?;
            assert!(image.to_string().contains("__image__nginx"));
            s.release("host-a", "updated-root")?;
            assert_eq!(lock_identity(&s)?, locks);
            let recovered = control(
                &s.path,
                &json!({"action":"recover","operation":"native-update"}),
            )?;
            eprintln!("recovery {recovered}");
            assert_eq!(recovered["phase"], "recovered");
            assert_eq!(s.record()?.version, "0.12.0");
            let again = control(
                &s.path,
                &json!({"action":"recover","operation":"native-update"}),
            )?;
            assert_eq!(again["phase"], "recovered");
            assert!(s.record()?.admission_open);
            assert_eq!(lock_identity(&s)?, locks);
            let c = rusqlite::Connection::open(s.path.join("state/cache/scope-repo.db"))
                .map_err(|e| e.to_string())?;
            let adr: String = c
                .query_row(
                    "SELECT summary FROM project_summaries WHERE project='scope-repo'",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            assert!(adr.contains("Retain this scoped decision"));
            drop(c);
            let mut cases = vec![
                json!({"case":"two-host deferral, real update, paired restoration and repeat","passed":true}),
            ];
            let suite_start = Instant::now();
            for scenario in [
                "intent",
                "intent-config-failure",
                "intent-adr-eof",
                "draining",
                "prepared",
                "migrated",
            ] {
                let phase = if scenario.starts_with("intent") {
                    "intent"
                } else {
                    scenario
                };
                child.kill().map_err(|e| e.to_string())?;
                child.wait().map_err(|e| e.to_string())?;
                assert!(s.check_supervisor().is_err());
                child = launch(store.path(), &s.id, Some(phase))?;
                ready(&s, &mut child)?;
                control(&s.path, &json!({"action":"prepare"}))?;
                let operation = format!("interrupted-{scenario}");
                let path = s.path.clone();
                let op = operation.clone();
                let request = std::thread::spawn(move || {
                    control(
                        &path,
                        &json!({"action":"update","version":"0.12.1","operation":op}),
                    )
                });
                let pid = paused(&s, &child, &operation, phase)?;
                if phase == "migrated" {
                    assert_eq!(graph_format(&s)?, 3);
                }
                if scenario == "intent-config-failure" {
                    let config = s.path.join("state/cache/_config.db");
                    std::fs::rename(&config, s.path.join("retained-config.db"))
                        .map_err(|e| e.to_string())?;
                    s.directory
                        .write(&format!("verification-resume-{operation}"), b"resume")?;
                    assert_eq!(unsafe { libc::kill(pid, libc::SIGCONT) }, 0);
                    assert!(
                        request
                            .join()
                            .map_err(|_| "metadata control thread failed")?
                            .is_err()
                    );
                    assert_eq!(s.record()?.maintenance.unwrap().phase, "intent");
                    assert!(!s.record()?.admission_open);
                    std::fs::rename(s.path.join("retained-config.db"), &config)
                        .map_err(|e| e.to_string())?;
                    let restored =
                        control(&s.path, &json!({"action":"recover","operation":operation}))?;
                    assert_eq!(restored["phase"], "recovered");
                    assert!(s.record()?.admission_open);
                    cases.push(json!({"case":scenario,"passed":true,"recovery":restored}));
                    continue;
                }
                if scenario == "intent-adr-eof" {
                    let children =
                        std::fs::read_to_string(format!("/proc/{pid}/task/{pid}/children"))
                            .map_err(|e| e.to_string())?;
                    let mut killed = 0;
                    for native in children.split_whitespace() {
                        let cmd = std::fs::read(format!("/proc/{native}/cmdline"))
                            .map_err(|e| e.to_string())?;
                        if cmd == b"/cbm\0" {
                            assert_eq!(
                                unsafe { libc::kill(native.parse().unwrap(), libc::SIGKILL) },
                                0
                            );
                            killed += 1;
                        }
                    }
                    assert_eq!(killed, 1, "Exact owned stdio client identity required");
                    s.directory
                        .write(&format!("verification-resume-{operation}"), b"resume")?;
                    assert_eq!(unsafe { libc::kill(pid, libc::SIGCONT) }, 0);
                    assert!(
                        request
                            .join()
                            .map_err(|_| "ADR control thread failed")?
                            .is_err()
                    );
                    assert_eq!(s.record()?.maintenance.unwrap().phase, "intent");
                    assert!(!s.record()?.admission_open);
                    let restored =
                        control(&s.path, &json!({"action":"recover","operation":operation}))?;
                    assert_eq!(restored["phase"], "recovered");
                    assert!(s.record()?.admission_open);
                    cases.push(json!({"case":scenario,"passed":true,"recovery":restored}));
                    continue;
                }
                child.kill().map_err(|e| e.to_string())?;
                child.wait().map_err(|e| e.to_string())?;
                assert!(
                    request
                        .join()
                        .map_err(|_| "control thread failed")?
                        .is_err()
                );
                assert!(!s.record()?.admission_open);
                child = launch(store.path(), &s.id, None)?;
                ready(&s, &mut child)?;
                let restored =
                    control(&s.path, &json!({"action":"recover","operation":operation}))?;
                assert_eq!(restored["phase"], "recovered");
                assert_eq!(graph_format(&s)?, 2);
                let repeated =
                    control(&s.path, &json!({"action":"recover","operation":operation}))?;
                assert_eq!(repeated["phase"], "recovered");
                cases.push(
                    json!({"case":phase,"namespace_init":pid,"passed":true,"recovery":restored}),
                );
                std::fs::write(
                    store.path().join("cases.json"),
                    serde_json::to_vec_pretty(&cases).unwrap(),
                )
                .map_err(|e| e.to_string())?;
            }
            // Actual failure after candidate selection: only the owned candidate configuration is changed.
            child.kill().map_err(|e| e.to_string())?;
            child.wait().map_err(|e| e.to_string())?;
            child = launch(store.path(), &s.id, Some("candidate-selected"))?;
            ready(&s, &mut child)?;
            control(&s.path, &json!({"action":"prepare"}))?;
            let path = s.path.clone();
            let request = std::thread::spawn(move || {
                control(
                    &path,
                    &json!({"action":"update","version":"0.12.1","operation":"failed-health"}),
                )
            });
            let init = paused(&s, &child, "failed-health", "candidate-selected")?;
            let config = rusqlite::Connection::open(s.path.join("state/cache/_config.db"))
                .map_err(|e| e.to_string())?;
            config
                .execute("UPDATE config SET value='true' WHERE key='auto_watch'", [])
                .map_err(|e| e.to_string())?;
            drop(config);
            s.directory
                .write("verification-resume-failed-health", b"resume")?;
            assert_eq!(unsafe { libc::kill(init, libc::SIGCONT) }, 0);
            let failed = request
                .join()
                .map_err(|_| "health control thread failed")??;
            assert_eq!(failed["phase"], "recovered");
            assert_eq!(failed["activation"], "failed");
            assert_eq!(graph_format(&s)?, 2);
            cases.push(json!({"case":"actual candidate health failure and automatic paired recovery","passed":true,"outcome":failed}));
            for restore_phase in ["restored-cache", "recovered"] {
                let operation = format!("restore-interruption-{restore_phase}");
                // Interrupt a real restoration after its cache rename and durable phase.
                child.kill().map_err(|e| e.to_string())?;
                child.wait().map_err(|e| e.to_string())?;
                child = launch(store.path(), &s.id, None)?;
                ready(&s, &mut child)?;
                control(&s.path, &json!({"action":"prepare"}))?;
                let updated = control(
                    &s.path,
                    &json!({"action":"update","version":"0.12.1","operation":operation}),
                )?;
                assert_eq!(updated["phase"], "committed", "activation reply: {updated}");
                child.kill().map_err(|e| e.to_string())?;
                child.wait().map_err(|e| e.to_string())?;
                child = launch(store.path(), &s.id, Some(restore_phase))?;
                ready(&s, &mut child)?;
                let path = s.path.clone();
                let request_operation = operation.clone();
                let request = std::thread::spawn(move || {
                    control(
                        &path,
                        &json!({"action":"recover","operation":request_operation}),
                    )
                });
                paused(&s, &child, &operation, restore_phase)?;
                assert!(!s.record()?.admission_open);
                assert_eq!(graph_format(&s)?, 2);
                child.kill().map_err(|e| e.to_string())?;
                child.wait().map_err(|e| e.to_string())?;
                assert!(
                    request
                        .join()
                        .map_err(|_| "restore control thread failed")?
                        .is_err()
                );
                child = launch(store.path(), &s.id, None)?;
                ready(&s, &mut child)?;
                let restored =
                    control(&s.path, &json!({"action":"recover","operation":operation}))?;
                assert_eq!(restored["phase"], "recovered");
                assert_eq!(graph_format(&s)?, 2);
                let repeated =
                    control(&s.path, &json!({"action":"recover","operation":operation}))?;
                assert_eq!(repeated["phase"], "recovered");
                assert!(
                    s.record()?.admission_open,
                    "repeated recovery must reopen admissions after native old-pair health"
                );
                assert_eq!(s.record()?.phase, "ready");
                cases.push(json!({"case":format!("interrupted {restore_phase}, failed evidence retained and repeated recovery"),"passed":true,"outcome":restored}));
            }
            std::fs::write(
            store.path().join("cases.json"),
            serde_json::to_vec_pretty(
                &json!({"cases":cases,"fault_suite_seconds":suite_start.elapsed().as_secs_f64()}),
            )
            .unwrap(),
        )
        .map_err(|e| e.to_string())?;
            Ok(())
        })()
    }));
    let _ = child.kill();
    let _ = child.wait();
    eprintln!("Preserved native fixture {}", store.path().display());
    let result = match result {
        Ok(result) => result,
        Err(failure) => {
            let path = store.keep();
            eprintln!("Preserved failed native fixture {}", path.display());
            std::panic::resume_unwind(failure);
        }
    };
    if let Err(e) = result {
        let path = store.keep();
        panic!(
            "{e}\nPreserved {}\n{}",
            path.display(),
            std::fs::read_to_string(path.join("supervisor.log")).unwrap()
        )
    }
    let _ = store.keep();
}

fn launch(
    store: &std::path::Path,
    id: &str,
    pause: Option<&str>,
) -> Result<std::process::Child, String> {
    let log = std::fs::OpenOptions::new()
        .append(true)
        .open(store.join("supervisor.log"))
        .map_err(|e| e.to_string())?;
    let mut cmd = Command::new(packaged_binary());
    cmd.args([
        "cbm-supervisor",
        "--store",
        store.to_str().unwrap(),
        "--service",
        id,
    ]);
    cmd.args(["--verification-pause-after", pause.unwrap_or("diagnostics")]);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(log)
        .spawn()
        .map_err(|e| e.to_string())
}
fn ready(s: &Service, child: &mut std::process::Child) -> Result<(), String> {
    let end = Instant::now() + Duration::from_secs(60);
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Err("supervisor exited".into());
        }
        if s.check_supervisor().is_ok() && control(&s.path, &json!({"action":"status"})).is_ok() {
            return Ok(());
        }
        if Instant::now() > end {
            return Err("supervisor readiness deadline".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn paused(
    s: &Service,
    child: &std::process::Child,
    operation: &str,
    phase: &str,
) -> Result<i32, String> {
    let end = Instant::now() + Duration::from_secs(100);
    loop {
        let children =
            std::fs::read_to_string(format!("/proc/{}/task/{}/children", child.id(), child.id()))
                .map_err(|e| e.to_string())?;
        if let Some(init) = children
            .split_whitespace()
            .next()
            .and_then(|v| v.parse::<i32>().ok())
            && s.path
                .join(format!("verification-paused-{operation}-{phase}"))
                .exists()
        {
            assert_eq!(unsafe { libc::kill(init, libc::SIGSTOP) }, 0);
            let j = serde_json::to_value(s.record()?.maintenance).map_err(|e| e.to_string())?;
            if phase == "intent" {
                assert!(
                    !s.path
                        .join(format!("maintenance-{operation}.json"))
                        .exists()
                );
                assert!(!s.path.join(format!("backup-{operation}")).exists());
            }
            if j["phase"] != phase {
                return Err(format!("unexpected stopped phase {j}"));
            }
            return Ok(init);
        }
        if Instant::now() > end {
            return Err(format!("checkpoint {phase} deadline"));
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn graph_format(s: &Service) -> Result<i64, String> {
    let c = rusqlite::Connection::open_with_flags(
        s.path.join("state/cache/scope-repo.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;
    c.query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

fn lock_identity(s: &Service) -> Result<std::collections::BTreeMap<String, (u64, u64)>, String> {
    use std::os::unix::fs::MetadataExt;
    let mut locks = std::collections::BTreeMap::new();
    for entry in
        std::fs::read_dir(s.path.join("runtime/cbm-daemon-0")).map_err(|e| e.to_string())?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().extension().and_then(|s| s.to_str()) == Some("lock") {
            let m = entry.metadata().map_err(|e| e.to_string())?;
            locks.insert(
                entry.file_name().to_string_lossy().into_owned(),
                (m.dev(), m.ino()),
            );
        }
    }
    assert!(!locks.is_empty());
    Ok(locks)
}

fn packaged_binary() -> std::ffi::OsString {
    std::env::var_os("DECK2_CBM_BINARY").unwrap_or_else(|| env!("CARGO_BIN_EXE_deck2").into())
}
