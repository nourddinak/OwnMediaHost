use axum::{
    extract::State,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::info;

use crate::{
    auth::RequireAdmin,
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    models::{ApiResponse, Setting},
};

#[derive(Clone)]
pub struct SettingsState {
    pub pool: DbPool,
    #[allow(dead_code)]
    pub config: Arc<AppConfig>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    pub settings: HashMap<String, String>,
}

pub fn router(pool: DbPool, config: Arc<AppConfig>) -> Router {
    let state = SettingsState { pool, config };
    Router::new()
        .route("/", get(get_settings).patch(update_settings))
        .with_state(state)
}

async fn get_settings(
    State(state): State<SettingsState>,
    RequireAdmin(_admin): RequireAdmin,
) -> Result<impl IntoResponse, AppError> {
    let rows: Vec<Setting> = sqlx::query_as("SELECT * FROM settings ORDER BY key ASC")
        .fetch_all(&state.pool)
        .await?;

    let mut map = HashMap::new();
    for r in rows {
        map.insert(r.key, r.value);
    }

    Ok(Json(ApiResponse::ok(map)))
}

async fn update_settings(
    State(state): State<SettingsState>,
    RequireAdmin(_admin): RequireAdmin,
    Json(req): Json<UpdateSettingsRequest>,
) -> Result<impl IntoResponse, AppError> {
    let now = chrono::Utc::now().to_rfc3339();

    for (k, v) in req.settings {
        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
        )
        .bind(&k)
        .bind(&v)
        .bind(&now)
        .execute(&state.pool)
        .await?;
    }

    info!("Settings updated successfully.");
    Ok(Json(ApiResponse::ok("Settings updated successfully")))
}

pub async fn get_setting_or_default(pool: &DbPool, key: &str, default: &str) -> String {
    sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .unwrap_or(None)
        .unwrap_or_else(|| default.to_string())
}
