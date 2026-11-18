use deck2::cbm_artifacts::{Artifacts, release};
use std::os::unix::fs::PermissionsExt;
// Protects exact catalog/ownership: unknown releases and preexisting foreign artifacts
// cannot be adopted or overwritten. Oracle: S5C-ARTIFACT.
#[test]
fn rejects_unknown_release_and_foreign_publication() {
    assert!(release("latest").is_err());
    let r = release("0.12.0").unwrap();
    let tmp = tempfile::tempdir().unwrap();
    std::fs::set_permissions(tmp.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let a = Artifacts::open(tmp.path()).unwrap();
    let foreign = tmp.path().join("cbm-artifacts").join(&r.executable);
    std::fs::create_dir(&foreign).unwrap();
    std::fs::write(foreign.join("foreign"), b"retained").unwrap();
    assert!(a.publish(&r, &[]).is_err());
    assert_eq!(std::fs::read(foreign.join("foreign")).unwrap(), b"retained");
}
