use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn verifier() -> Command {
    Command::new(env!("CARGO_BIN_EXE_prooflane-verify-release"))
}

#[test]
fn accepts_release_probe_signed_by_the_embedded_key() {
    let output = verifier()
        .arg(fixture("prooflane-release-probe.txt"))
        .arg(fixture("prooflane-release-probe.txt.sig"))
        .output()
        .expect("release verifier should start");

    assert!(
        output.status.success(),
        "verifier rejected signed fixture: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn rejects_tampered_release_probe() {
    let temp = tempfile::tempdir().expect("temp dir should be created");
    let tampered = temp.path().join("tampered.txt");
    fs::write(&tampered, b"tampered release payload\n").expect("fixture should be writable");

    let output = verifier()
        .arg(tampered)
        .arg(fixture("prooflane-release-probe.txt.sig"))
        .output()
        .expect("release verifier should start");

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("signature verification failed"));
}

#[test]
fn requires_an_asset_and_signature_path() {
    let output = verifier().output().expect("release verifier should start");

    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("Usage:"));
}
