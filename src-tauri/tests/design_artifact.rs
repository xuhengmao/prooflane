use codeg_lib::commands::design::{validate_create_input, validate_design_name};
use codeg_lib::db::error::DbError;
use codeg_lib::db::service::design_artifact_service;
use codeg_lib::db::test_helpers::fresh_in_memory_db;
use codeg_lib::models::{CreateDesignArtifact, SaveDesignRevision};
use sea_orm::{ConnectionTrait, DbBackend, Statement};

fn create_input(name: &str) -> CreateDesignArtifact {
    CreateDesignArtifact {
        name: name.to_owned(),
        kind: "page".to_owned(),
        project_folder_id: None,
        document: serde_json::json!({
            "schemaVersion": 1,
            "pages": [{ "id": "page-1", "type": "page" }]
        }),
    }
}

#[test]
fn command_validation_rejects_invalid_names_kinds_and_documents() {
    assert!(matches!(
        validate_design_name("   "),
        Err(DbError::Validation(_))
    ));
    assert!(matches!(
        validate_design_name(&"a".repeat(121)),
        Err(DbError::Validation(_))
    ));

    let mut unknown_kind = create_input("首页");
    unknown_kind.kind = "poster".to_owned();
    assert!(matches!(
        validate_create_input(&unknown_kind),
        Err(DbError::Validation(_))
    ));

    let mut mismatched_schema = create_input("首页");
    mismatched_schema.document["schemaVersion"] = serde_json::json!(2);
    assert!(matches!(
        validate_create_input(&mismatched_schema),
        Err(DbError::Validation(_))
    ));
}

#[tokio::test]
async fn migration_creates_artifact_and_revision_tables() {
    let db = fresh_in_memory_db().await;

    for table in ["design_artifact", "design_revision"] {
        let rows = db
            .conn
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                format!("PRAGMA table_info({table})"),
            ))
            .await
            .expect("read design schema");

        assert!(!rows.is_empty(), "{table} must exist after migration");
    }
}

#[tokio::test]
async fn create_persists_an_initial_revision() {
    let db = fresh_in_memory_db().await;

    let created = design_artifact_service::create(&db.conn, create_input("控制台"))
        .await
        .expect("create artifact");
    let detail = design_artifact_service::get(&db.conn, &created.id)
        .await
        .expect("load artifact");

    assert_eq!(detail.artifact.name, "控制台");
    assert_eq!(detail.artifact.status, "draft");
    assert_eq!(detail.revision.id, created.current_revision_id);
    assert_eq!(detail.revision.revision_number, 1);
    assert_eq!(detail.revision.schema_version, 1);
    assert_eq!(detail.revision.document["pages"][0]["id"], "page-1");
}

#[tokio::test]
async fn duplicate_owns_an_independent_revision() {
    let db = fresh_in_memory_db().await;
    let source = design_artifact_service::create(&db.conn, create_input("首页"))
        .await
        .expect("create source");

    let copy = design_artifact_service::duplicate(&db.conn, &source.id)
        .await
        .expect("duplicate artifact");
    let source_detail = design_artifact_service::get(&db.conn, &source.id)
        .await
        .expect("load source");
    let copy_detail = design_artifact_service::get(&db.conn, &copy.id)
        .await
        .expect("load copy");

    assert_ne!(copy.id, source.id);
    assert_ne!(copy.current_revision_id, source.current_revision_id);
    assert_eq!(copy.name, "首页 副本");
    assert_eq!(
        copy_detail.revision.document,
        source_detail.revision.document
    );
    assert_eq!(copy_detail.revision.revision_number, 1);
}

#[tokio::test]
async fn rename_trims_the_name_and_preserves_the_revision() {
    let db = fresh_in_memory_db().await;
    let created = design_artifact_service::create(&db.conn, create_input("旧名称"))
        .await
        .expect("create artifact");

    let renamed = design_artifact_service::rename(&db.conn, &created.id, "  新名称  ")
        .await
        .expect("rename artifact");

    assert_eq!(renamed.name, "新名称");
    assert_eq!(renamed.current_revision_id, created.current_revision_id);
}

#[tokio::test]
async fn save_creates_a_child_revision_and_advances_the_artifact() {
    let db = fresh_in_memory_db().await;
    let created = design_artifact_service::create(&db.conn, create_input("设置"))
        .await
        .expect("create artifact");

    let saved = design_artifact_service::save_revision(
        &db.conn,
        SaveDesignRevision {
            artifact_id: created.id.clone(),
            expected_revision_id: created.current_revision_id.clone(),
            schema_version: 1,
            document: serde_json::json!({
                "schemaVersion": 1,
                "pages": [{ "id": "page-2", "type": "page" }]
            }),
        },
    )
    .await
    .expect("save revision");

    assert_ne!(saved.revision.id, created.current_revision_id);
    assert_eq!(saved.artifact.current_revision_id, saved.revision.id);
    assert_eq!(saved.artifact.status, "active");
    assert_eq!(
        saved.revision.parent_revision_id.as_deref(),
        Some(created.current_revision_id.as_str())
    );
    assert_eq!(saved.revision.revision_number, 2);
    assert_eq!(saved.revision.document["pages"][0]["id"], "page-2");
}

#[tokio::test]
async fn archive_restore_and_soft_delete_have_distinct_visibility() {
    let db = fresh_in_memory_db().await;
    let created = design_artifact_service::create(&db.conn, create_input("流程"))
        .await
        .expect("create artifact");

    let archived = design_artifact_service::set_archived(&db.conn, &created.id, true)
        .await
        .expect("archive artifact");
    assert_eq!(archived.status, "archived");
    assert!(design_artifact_service::list(&db.conn, false)
        .await
        .expect("list active")
        .is_empty());
    assert_eq!(
        design_artifact_service::list(&db.conn, true)
            .await
            .expect("list archived")
            .len(),
        1
    );

    let restored = design_artifact_service::set_archived(&db.conn, &created.id, false)
        .await
        .expect("restore artifact");
    assert_eq!(restored.status, "active");

    design_artifact_service::soft_delete(&db.conn, &created.id)
        .await
        .expect("soft delete artifact");
    assert!(design_artifact_service::list(&db.conn, true)
        .await
        .expect("list after delete")
        .is_empty());
    assert!(matches!(
        design_artifact_service::get(&db.conn, &created.id).await,
        Err(DbError::NotFound(_))
    ));
}

#[tokio::test]
async fn stale_revision_save_is_rejected_without_writing_a_row() {
    let db = fresh_in_memory_db().await;
    let created = design_artifact_service::create(&db.conn, create_input("设置"))
        .await
        .expect("create artifact");
    let stale_revision_id = "stale-revision".to_owned();

    let result = design_artifact_service::save_revision(
        &db.conn,
        SaveDesignRevision {
            artifact_id: created.id.clone(),
            expected_revision_id: stale_revision_id,
            schema_version: 1,
            document: serde_json::json!({
                "schemaVersion": 1,
                "pages": [{ "id": "new-page", "type": "page" }]
            }),
        },
    )
    .await;

    assert!(matches!(result, Err(DbError::Conflict(_))));
    let count: i64 = db
        .conn
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT COUNT(*) AS count FROM design_revision WHERE artifact_id = '{}'",
                created.id
            ),
        ))
        .await
        .expect("count revisions")
        .expect("count row")
        .try_get("", "count")
        .expect("count value");
    assert_eq!(count, 1);
}
