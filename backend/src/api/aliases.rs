use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    routing::{get, patch},
    Json, Router,
};
use serde::Deserialize;
use std::sync::Arc;
use tracing::info;

use crate::{
    api::delivery::serve_file_with_range,
    auth::RequireAuth,
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    models::{Alias, AliasResponse, ApiResponse, Media},
    storage::{LocalStorageProvider, StorageProvider},
};

#[derive(Clone)]
pub struct AliasesState {
    pub pool: DbPool,
    pub storage: LocalStorageProvider,
    pub config: Arc<AppConfig>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAliasRequest {
    pub alias_path: String,
    pub media_id: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAliasRequest {
    pub media_id: String,
}

pub fn crud_router(pool: DbPool, storage: LocalStorageProvider, config: Arc<AppConfig>) -> Router {
    let state = AliasesState {
        pool,
        storage,
        config,
    };

    Router::new()
        .route("/", get(list_aliases).post(create_alias))
        .route("/{id}", patch(update_alias).delete(delete_alias))
        .with_state(state)
}

pub fn delivery_router(pool: DbPool, storage: LocalStorageProvider, config: Arc<AppConfig>) -> Router {
    let state = AliasesState {
        pool,
        storage,
        config,
    };

    Router::new()
        .route("/a/{*alias_path}", get(resolve_and_deliver_alias))
        .with_state(state)
}

async fn resolve_and_deliver_alias(
    State(state): State<AliasesState>,
    headers: HeaderMap,
    Path(alias_path): Path<String>,
) -> Result<Response, AppError> {
    let clean_path = alias_path.trim_start_matches('/').trim_end_matches('/');

    let alias: Alias = sqlx::query_as("SELECT * FROM aliases WHERE alias_path = ?")
        .bind(clean_path)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Alias '{}' not found", clean_path)))?;

    let media: Media = sqlx::query_as("SELECT * FROM media WHERE id = ? AND deleted_at IS NULL")
        .bind(&alias.media_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Underlying media item not found".into()))?;

    if media.visibility == "private" {
        return Err(AppError::Forbidden("Alias points to a private media item".into()));
    }

    let full_path = state.storage.get_full_path(&media.storage_path)?;
    // Use must-revalidate for aliases so replacements take effect promptly
    serve_file_with_range(&full_path, &media.mime_type, &headers, false).await
}

async fn list_aliases(
    State(state): State<AliasesState>,
    RequireAuth(identity): RequireAuth,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("aliases:read") && !identity.has_permission("files:read") {
        return Err(AppError::Forbidden("Permission aliases:read required".into()));
    }

    #[derive(sqlx::FromRow)]
    struct AliasWithMediaRow {
        id: String,
        alias_path: String,
        media_id: String,
        media_public_id: Option<String>,
        media_filename: Option<String>,
        created_at: String,
        updated_at: String,
    }

    let rows: Vec<AliasWithMediaRow> = sqlx::query_as(
        r#"
        SELECT 
            a.id,
            a.alias_path,
            a.media_id,
            m.public_id as media_public_id,
            m.filename as media_filename,
            a.created_at,
            a.updated_at
        FROM aliases a
        LEFT JOIN media m ON a.media_id = m.id
        ORDER BY a.created_at DESC
        "#
    )
    .fetch_all(&state.pool)
    .await?;

    let items: Vec<AliasResponse> = rows
        .into_iter()
        .map(|r| {
            let url = format!("{}/a/{}", state.config.public_base_url, r.alias_path);
            AliasResponse {
                id: r.id,
                alias_path: r.alias_path,
                media_id: r.media_id,
                media_public_id: r.media_public_id.unwrap_or_else(|| "unknown".into()),
                media_filename: r.media_filename.unwrap_or_else(|| "unknown".into()),
                url,
                created_at: r.created_at,
                updated_at: r.updated_at,
            }
        })
        .collect();

    Ok(Json(ApiResponse::ok(items)))
}

async fn create_alias(
    State(state): State<AliasesState>,
    RequireAuth(identity): RequireAuth,
    Json(req): Json<CreateAliasRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("aliases:write") {
        return Err(AppError::Forbidden("Permission aliases:write required".into()));
    }

    let clean_path = req.alias_path.trim().trim_start_matches('/').trim_end_matches('/').to_string();
    if clean_path.is_empty() {
        return Err(AppError::BadRequest("alias_path cannot be empty".into()));
    }

    // Reserved paths prevention
    if clean_path.starts_with("api")
        || clean_path.starts_with("f/")
        || clean_path.starts_with("i/")
        || clean_path.starts_with("dashboard")
        || clean_path.starts_with("thumbnails")
        || clean_path.contains("..")
    {
        return Err(AppError::BadRequest("Forbidden or reserved alias path".into()));
    }

    // Verify media exists
    let media: Media = sqlx::query_as("SELECT * FROM media WHERE id = ? OR public_id = ?")
        .bind(&req.media_id)
        .bind(&req.media_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Target media item not found".into()))?;

    let id = format!("als_{}", uuid::Uuid::new_v4().simple());
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO aliases (id, alias_path, media_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(alias_path) DO UPDATE SET media_id = excluded.media_id, updated_at = excluded.updated_at"
    )
    .bind(&id)
    .bind(&clean_path)
    .bind(&media.id)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await?;

    let url = format!("{}/a/{}", state.config.public_base_url, clean_path);
    info!("Created alias /a/{} -> media {}", clean_path, media.id);

    Ok(Json(ApiResponse::ok(AliasResponse {
        id,
        alias_path: clean_path,
        media_id: media.id,
        media_public_id: media.public_id,
        media_filename: media.filename,
        url,
        created_at: now.clone(),
        updated_at: now,
    })))
}

async fn update_alias(
    State(state): State<AliasesState>,
    RequireAuth(identity): RequireAuth,
    Path(id): Path<String>,
    Json(req): Json<UpdateAliasRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("aliases:write") {
        return Err(AppError::Forbidden("Permission aliases:write required".into()));
    }

    let media: Media = sqlx::query_as("SELECT * FROM media WHERE id = ? OR public_id = ?")
        .bind(&req.media_id)
        .bind(&req.media_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("Target media item not found".into()))?;

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE aliases SET media_id = ?, updated_at = ? WHERE id = ?")
        .bind(&media.id)
        .bind(&now)
        .bind(&id)
        .execute(&state.pool)
        .await?;

    let alias: Alias = sqlx::query_as("SELECT * FROM aliases WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.pool)
        .await?;

    let url = format!("{}/a/{}", state.config.public_base_url, alias.alias_path);
    Ok(Json(ApiResponse::ok(AliasResponse {
        id: alias.id,
        alias_path: alias.alias_path,
        media_id: media.id,
        media_public_id: media.public_id,
        media_filename: media.filename,
        url,
        created_at: alias.created_at,
        updated_at: alias.updated_at,
    })))
}

async fn delete_alias(
    State(state): State<AliasesState>,
    RequireAuth(identity): RequireAuth,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("aliases:write") {
        return Err(AppError::Forbidden("Permission aliases:write required".into()));
    }

    let res = sqlx::query("DELETE FROM aliases WHERE id = ? OR alias_path = ?")
        .bind(&id)
        .bind(&id)
        .execute(&state.pool)
        .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Alias not found".into()));
    }

    Ok(Json(ApiResponse::ok("Alias deleted successfully")))
}
