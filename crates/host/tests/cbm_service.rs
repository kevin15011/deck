use deck2::cbm_service::{Service, Snapshot};
use std::os::unix::fs::PermissionsExt;
// Protects whole-index scope authorization and source freshness, rather than row filtering.
#[test]
fn prepared_scope_cannot_disclose_foreign_or_changed_source() {
    let project = tempfile::tempdir().unwrap();
    let store = tempfile::tempdir().unwrap();
    std::fs::set_permissions(store.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(
        project.path().join("one.rs"),
        "fn caller(){handler()}\nfn handler(){}\n",
    )
    .unwrap();
    std::fs::write(project.path().join("private.rs"), "fn secret(){}\n").unwrap();
    let snapshot =
        Snapshot::capture(project.path(), &["one.rs".into(), "private.rs".into()]).unwrap();
    assert!(
        snapshot
            .authorize(project.path(), &["one.rs".into()])
            .is_err()
    );
    assert!(
        snapshot
            .authorize(project.path(), &["one.rs".into(), "private.rs".into()])
            .is_ok()
    );
    let narrow = Snapshot::capture(project.path(), &["one.rs".into()]).unwrap();
    let service = Service::create(store.path(), &narrow, "0.12.0").unwrap();
    std::fs::write(project.path().join("one.rs"), "fn changed(){}\n").unwrap();
    assert!(
        narrow
            .authorize(project.path(), &["one.rs".into()])
            .is_err()
    );
    assert_eq!(service.record().unwrap().snapshot, narrow.digest);
}
// Protects two-host admission vs maintenance serialization and conservative unknown ownership.
#[test]
fn retained_reservations_defer_maintenance_and_block_later_admissions() {
    let project = tempfile::tempdir().unwrap();
    let store = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("one.rs"), "fn handler(){}\n").unwrap();
    let snapshot = Snapshot::capture(project.path(), &["one.rs".into()]).unwrap();
    std::fs::set_permissions(store.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let a = Service::create(store.path(), &snapshot, "0.12.0").unwrap();
    let b = Service::open(store.path(), &a.id).unwrap();
    a.mark_ready().unwrap();
    a.reserve("host-a", "root-a", &snapshot.digest, 1, "0.12.0")
        .unwrap();
    b.reserve("host-b", "root-b", &snapshot.digest, 1, "0.12.0")
        .unwrap();
    assert!(!a.begin_maintenance("operation-1").unwrap());
    assert!(
        b.reserve("host-c", "root-c", &snapshot.digest, 1, "0.12.0")
            .is_err()
    );
    a.release("host-a", "root-a").unwrap();
    assert!(!a.begin_maintenance("operation-1").unwrap());
    assert!(b.begin_maintenance("operation-2").is_err());
    b.release("host-b", "root-b").unwrap();
    assert!(a.begin_maintenance("operation-1").unwrap());
    assert!(!a.record().unwrap().admission_open);
}

// A host can pause after validating a binding while another host completes
// maintenance. The reservation gate must validate that exact generation again.
#[test]
fn paused_admission_cannot_reserve_a_replaced_generation() {
    let project = tempfile::tempdir().unwrap();
    let store = tempfile::tempdir().unwrap();
    std::fs::set_permissions(store.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(project.path().join("handler.rs"), "fn handler(){}\n").unwrap();
    let snapshot = Snapshot::capture(project.path(), &["handler.rs".into()]).unwrap();
    let service = Service::create(store.path(), &snapshot, "0.12.0").unwrap();
    service.mark_ready().unwrap();
    let admitted = service.record().unwrap();
    // Fake only the completed native effect; the journal and file gate are real.
    let release = deck2::cbm_artifacts::release("0.12.1").unwrap();
    let mut next = service.record().unwrap();
    next.version = release.version;
    next.executable = release.executable;
    next.catalog = release.catalog;
    next.state_format = 3;
    next.generation += 1;
    service.save(&next).unwrap();
    assert!(
        service
            .reserve(
                "paused-host",
                "paused-root",
                &snapshot.digest,
                admitted.generation,
                &admitted.version
            )
            .is_err(),
        "Paused {} generation {} must not acquire a replacement binding",
        admitted.version,
        admitted.generation
    );
    assert!(service.record().unwrap().reservations.is_empty());
}
