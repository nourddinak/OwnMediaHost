use axum::{
    extract::{Path, State},
    response::IntoResponse,
    routing::{get, patch},
    Json, Router,
};
use serde::Deserialize;
use std::sync::Arc;
use tracing::info;

use crate::{
    auth::RequireAuth,
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    models::{ApiResponse, Folder, FolderWithCount},
};

#[derive(Clone)]
pub struct FoldersState {
    pub pool: DbPool,
    #[allow(dead_code)]
    pub config: Arc<AppConfig>,
}

#[derive(Debug, Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateFolderRequest {
    pub name: Option<String>,
    pub parent_id: Option<String>,
}

pub fn router(pool: DbPool, config: Arc<AppConfig>) -> Router {
    let state = FoldersState { pool, config };

    Router::new()
        .route("/", get(list_folders).post(create_folder))
        .route("/{id}", patch(update_folder).delete(delete_folder))
        .with_state(state)
}

async fn list_folders(
    State(state): State<FoldersState>,
    RequireAuth(identity): RequireAuth,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("folders:read") && !identity.has_permission("files:read") {
        return Err(AppError::Forbidden("Permission folders:read required".into()));
    }

    let result: Vec<FolderWithCount> = sqlx::query_as(
        r#"
        SELECT 
            f.id,
            f.name,
            f.parent_id,
            COALESCE(COUNT(m.id), 0) as media_count,
            f.created_at,
            f.updated_at
        FROM folders f
        LEFT JOIN media m ON m.folder_id = f.id AND m.deleted_at IS NULL
        GROUP BY f.id
        ORDER BY f.name ASC
        "#
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(ApiResponse::ok(result)))
}

async fn create_folder(
    State(state): State<FoldersState>,
    RequireAuth(identity): RequireAuth,
    Json(req): Json<CreateFolderRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("folders:write") {
        return Err(AppError::Forbidden("Permission folders:write required".into()));
    }

    let clean_name = req.name.trim();
    if clean_name.is_empty() {
        return Err(AppError::BadRequest("Folder name cannot be empty".into()));
    }

    let parent_id = req.parent_id.filter(|p| !p.trim().is_empty() && p != "root");

    let id = format!("fld_{}", uuid::Uuid::new_v4().simple());
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO folders (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(clean_name)
    .bind(&parent_id)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await?;

    info!("Created folder {} ({})", clean_name, id);
    Ok(Json(ApiResponse::ok(FolderWithCount {
        id,
        name: clean_name.to_string(),
        parent_id,
        media_count: 0,
        created_at: now.clone(),
        updated_at: now,
    })))
}

async fn update_folder(
    State(state): State<FoldersState>,
    RequireAuth(identity): RequireAuth,
    Path(id): Path<String>,
    Json(req): Json<UpdateFolderRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("folders:write") {
        return Err(AppError::Forbidden("Permission folders:write required".into()));
    }

    let now = chrono::Utc::now().to_rfc3339();

    if let Some(name) = req.name {
        let clean = name.trim();
        if !clean.is_empty() {
            sqlx::query("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?")
                .bind(clean)
                .bind(&now)
                .bind(&id)
                .execute(&state.pool)
                .await?;
        }
    }

    if let Some(parent) = req.parent_id {
        let p_id = if parent == "root" || parent.trim().is_empty() {
            None
        } else {
            // Prevent circular parenting
            if parent == id {
                return Err(AppError::BadRequest("Folder cannot be its own parent".into()));
            }
            Some(parent)
        };

        sqlx::query("UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ?")
            .bind(&p_id)
            .bind(&now)
            .bind(&id)
            .execute(&state.pool)
            .await?;
    }

    let folder: Folder = sqlx::query_as("SELECT * FROM folders WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM media WHERE folder_id = ? AND deleted_at IS NULL"
    )
    .bind(&id)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    Ok(Json(ApiResponse::ok(FolderWithCount {
        id: folder.id,
        name: folder.name,
        parent_id: folder.parent_id,
        media_count: count,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
    })))
}

async fn delete_folder(
    State(state): State<FoldersState>,
    RequireAuth(identity): RequireAuth,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("folders:write") {
        return Err(AppError::Forbidden("Permission folders:write required".into()));
    }

    // Move any media in this folder to root (folder_id = NULL)
    sqlx::query("UPDATE media SET folder_id = NULL WHERE folder_id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;

    let res = sqlx::query("DELETE FROM folders WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Folder not found".into()));
    }

    info!("Deleted folder {}", id);
    Ok(Json(ApiResponse::ok("Folder deleted successfully")))
}
