use axum::{
    extract::{Path, State},
    response::IntoResponse,
    routing::{delete, get},
    Json, Router,
};
use serde::Deserialize;
use std::sync::Arc;
use tracing::info;

use crate::{
    auth::{generate_api_key, RequireAdmin},
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    models::{ApiKey, ApiKeyPublic, ApiResponse},
};

#[derive(Clone)]
pub struct KeysState {
    pub pool: DbPool,
    pub config: Arc<AppConfig>,
}

#[derive(Debug, Deserialize)]
pub struct CreateKeyRequest {
    pub name: String,
    pub permissions: Vec<String>,
    pub expires_days: Option<i64>,
}

pub fn router(pool: DbPool, config: Arc<AppConfig>) -> Router {
    let state = KeysState { pool, config };

    Router::new()
        .route("/", get(list_keys).post(create_key))
        .route("/{id}", delete(revoke_key))
        .with_state(state)
}

async fn list_keys(
    State(state): State<KeysState>,
    RequireAdmin(_admin): RequireAdmin,
) -> Result<impl IntoResponse, AppError> {
    let keys: Vec<ApiKey> = sqlx::query_as(
        "SELECT * FROM api_keys ORDER BY created_at DESC"
    )
    .fetch_all(&state.pool)
    .await?;

    let items: Vec<ApiKeyPublic> = keys
        .into_iter()
        .map(|k| {
            let perms: Vec<String> = k
                .permissions
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            ApiKeyPublic {
                id: k.id,
                name: k.name,
                key_prefix: k.key_prefix,
                permissions: perms,
                last_used_at: k.last_used_at,
                expires_at: k.expires_at,
                revoked_at: k.revoked_at,
                created_at: k.created_at,
                secret_key: None,
            }
        })
        .collect();

    Ok(Json(ApiResponse::ok(items)))
}

async fn create_key(
    State(state): State<KeysState>,
    RequireAdmin(_admin): RequireAdmin,
    Json(req): Json<CreateKeyRequest>,
) -> Result<impl IntoResponse, AppError> {
    let clean_name = req.name.trim();
    if clean_name.is_empty() {
        return Err(AppError::BadRequest("Key name cannot be empty".into()));
    }

    let (prefix, secret_full_key, key_hash) = generate_api_key(&state.config.api_key_pepper);
    let id = format!("key_{}", uuid::Uuid::new_v4().simple());
    let now = chrono::Utc::now();
    let created_at = now.to_rfc3339();

    let expires_at = req.expires_days.map(|days| {
        (now + chrono::Duration::days(days)).to_rfc3339()
    });

    let perms_str = req.permissions.join(",");

    sqlx::query(
        r#"
        INSERT INTO api_keys (
            id, name, key_prefix, key_hash, permissions, expires_at, created_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?
        )
        "#
    )
    .bind(&id)
    .bind(clean_name)
    .bind(&prefix)
    .bind(&key_hash)
    .bind(&perms_str)
    .bind(&expires_at)
    .bind(&created_at)
    .execute(&state.pool)
    .await?;

    info!("Created API key {} ({})", clean_name, prefix);

    Ok(Json(ApiResponse::ok(ApiKeyPublic {
        id,
        name: clean_name.to_string(),
        key_prefix: prefix,
        permissions: req.permissions,
        last_used_at: None,
        expires_at,
        revoked_at: None,
        created_at,
        secret_key: Some(secret_full_key), // Given only once!
    })))
}

async fn revoke_key(
    State(state): State<KeysState>,
    RequireAdmin(_admin): RequireAdmin,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let res = sqlx::query(
        "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL"
    )
    .bind(&now)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("API key not found or already revoked".into()));
    }

    info!("Revoked API key {}", id);
    Ok(Json(ApiResponse::ok("API key revoked successfully")))
}
