use axum::{
    extract::State,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::{
    auth::RequireAdmin,
    database::DbPool,
    errors::AppError,
    models::{ApiResponse, Setting},
};

#[derive(Clone, Default)]
pub struct SettingsCache {
    inner: Arc<RwLock<HashMap<String, String>>>,
}

impl SettingsCache {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn get_or_default(&self, pool: &DbPool, key: &str, default: &str) -> String {
        {
            let map = self.inner.read().await;
            if let Some(val) = map.get(key) {
                return val.clone();
            }
        }
        let val = get_setting_or_default(pool, key, default).await;
        let mut map = self.inner.write().await;
        map.insert(key.to_string(), val.clone());
        val
    }

    pub async fn update_batch(&self, settings: &HashMap<String, String>) {
        let mut map = self.inner.write().await;
        for (k, v) in settings {
            map.insert(k.clone(), v.clone());
        }
    }
}

#[derive(Clone)]
pub struct SettingsState {
    pub pool: DbPool,
    pub settings_cache: SettingsCache,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSettingsRequest {
    pub settings: HashMap<String, String>,
}

pub fn router(pool: DbPool, settings_cache: SettingsCache) -> Router {
    let state = SettingsState { pool, settings_cache };
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

    for (k, v) in &req.settings {
        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
        )
        .bind(k)
        .bind(v)
        .bind(&now)
        .execute(&state.pool)
        .await?;
    }

    state.settings_cache.update_batch(&req.settings).await;

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
