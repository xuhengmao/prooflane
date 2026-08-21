use super::package::{
    ast_sha256, load_package, save_package, validate_manifest, PackageError, PackageManifest,
};
use std::fs;
use tempfile::tempdir;

fn manifest(ast: &[u8]) -> PackageManifest {
    PackageManifest {
        format_version: 1,
        design_id: "design-1".into(),
        ast_sha256: ast_sha256(ast),
        asset_refs: vec!["assets/logo.png".into()],
    }
}

#[test]
fn saves_and_loads_an_atomic_package() {
    let root = tempdir().expect("tempdir");
    let path = root.path().join("example.proofdesign");
    let ast = br#"{"version":1,"revision":"r1","nodes":[]}"#;
    let receipt = save_package(&path, &manifest(ast), ast).expect("save");
    let loaded = load_package(&path).expect("load");
    assert_eq!(loaded.manifest.design_id, "design-1");
    assert_eq!(loaded.ast, ast);
    assert_eq!(receipt, loaded.receipt);
    assert!(path.join("assets").is_dir());
}

#[test]
fn rejects_hash_mismatch_and_path_escape() {
    let ast = br#"{}"#;
    let mut invalid = manifest(ast);
    invalid.ast_sha256 = "0".repeat(64);
    assert_eq!(
        validate_manifest(&invalid, ast),
        Err(PackageError::HashMismatch)
    );
    let mut escaped = manifest(ast);
    escaped.asset_refs = vec!["../secret".into()];
    assert_eq!(
        validate_manifest(&escaped, ast),
        Err(PackageError::InvalidPath)
    );
}

#[test]
fn rejects_unknown_manifest_fields_and_missing_package_entries() {
    let root = tempdir().expect("tempdir");
    let path = root.path().join("unknown.proofdesign");
    fs::create_dir_all(path.join("assets")).expect("assets");
    for directory in ["snapshots", "history", "previews"] {
        fs::create_dir(path.join(directory)).expect("directory");
    }
    fs::write(
        path.join("manifest.json"),
        br#"{"formatVersion":1,"designId":"d","astSha256":"0000000000000000000000000000000000000000000000000000000000000000","assetRefs":[],"unknown":true}"#,
    )
    .expect("manifest");
    fs::write(
        path.join("design.ast.json"),
        br#"{"version":1,"revision":"r","nodes":[]}"#,
    )
    .expect("ast");
    assert!(matches!(load_package(&path), Err(PackageError::Json(_))));
    fs::remove_file(path.join("manifest.json")).expect("remove");
    assert!(matches!(
        load_package(&path),
        Err(PackageError::MissingEntry(_))
    ));
}

#[test]
fn failed_validation_keeps_the_previous_package() {
    let root = tempdir().expect("tempdir");
    let path = root.path().join("stable.proofdesign");
    let ast = br#"{"version":1,"revision":"r1","nodes":[]}"#;
    save_package(&path, &manifest(ast), ast).expect("initial save");
    let mut invalid = manifest(br#"{"version":1,"revision":"r2","nodes":[]}"#);
    invalid.ast_sha256 = "0".repeat(64);
    assert_eq!(
        save_package(
            &path,
            &invalid,
            br#"{"version":1,"revision":"r2","nodes":[]}"#
        ),
        Err(PackageError::HashMismatch)
    );
    assert_eq!(
        load_package(&path).expect("old package").receipt.revision,
        "r1"
    );
}
