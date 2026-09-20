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

    let deploy_mode = map.get("deploy_mode").cloned().unwrap_or_else(|| {
        std::env::var("DEPLOY_MODE").unwrap_or_else(|_| "unified".to_string())
    });

    if deploy_mode == "unified" {
        map.insert("deploy_mode".to_string(), "unified".to_string());
        map.remove("frontend_domain");
        map.remove("backend_domain");
        let domain_clean = map.get("domain")
            .filter(|s| !s.is_empty())
            .map(|d| d.trim().trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/').to_string());
        if let Some(clean) = domain_clean {
            map.insert("domain".to_string(), clean.clone());
            map.insert("public_base_url".to_string(), format!("https://{}", clean));
        }
    } else {
        if !map.contains_key("frontend_domain") {
            map.insert("frontend_domain".to_string(), std::env::var("FRONTEND_DOMAIN").unwrap_or_default());
        }
        if !map.contains_key("backend_domain") {
            map.insert("backend_domain".to_string(), std::env::var("BACKEND_DOMAIN").unwrap_or_default());
        }
        if !map.contains_key("domain") {
            map.insert("domain".to_string(), std::env::var("DOMAIN").unwrap_or_default());
        }
        if !map.contains_key("public_base_url") {
            map.insert("public_base_url".to_string(), std::env::var("PUBLIC_BASE_URL").unwrap_or_default());
        }
    }
    if !map.contains_key("status_page_url") {
        map.insert("status_page_url".to_string(), std::env::var("STATUS_PAGE_URL").unwrap_or_default());
    }

    Ok(Json(ApiResponse::ok(map)))
}

async fn update_settings(
    State(state): State<SettingsState>,
    RequireAdmin(_admin): RequireAdmin,
    Json(req): Json<UpdateSettingsRequest>,
) -> Result<impl IntoResponse, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let is_unified = req.settings.get("deploy_mode").map(|m| m == "unified").unwrap_or(false);

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

    if is_unified {
        let _ = sqlx::query("DELETE FROM settings WHERE key IN ('frontend_domain', 'backend_domain')")
            .execute(&state.pool)
            .await;
    }

    state.settings_cache.update_batch(&req.settings).await;

    // Synchronize settings to active .env file on the host
    sync_settings_to_env_file(&req.settings);

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

fn extract_origin(val: &str) -> String {
    let trimmed = val.trim();
    if let Some((proto, rest)) = trimmed.split_once("://") {
        let host = rest.split(['/', '?', '#']).next().unwrap_or("");
        format!("{}://{}", proto, host)
    } else if !trimmed.is_empty() {
        let host = trimmed.split(['/', '?', '#']).next().unwrap_or("");
        format!("https://{}", host)
    } else {
        String::new()
    }
}

fn sync_settings_to_env_file(settings: &HashMap<String, String>) {
    let candidates = [
        "/etc/ownmediahost/ownmediahost.env",
        ".env",
        "backend/.env",
        "../.env",
    ];

    let env_path = candidates.iter().find(|p| std::path::Path::new(p).exists());
    let Some(path_str) = env_path else {
        tracing::debug!("No writable environment file found for settings synchronization.");
        return;
    };
    let path = std::path::Path::new(path_str);

    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Failed to read env file for sync {}: {}", path.display(), e);
            return;
        }
    };

    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    let mut env_updates = HashMap::new();
    let is_unified = settings.get("deploy_mode").map(|m| m == "unified").unwrap_or(false);

    if is_unified {
        env_updates.insert("DEPLOY_MODE", "unified".to_string());
        if let Some(v) = settings.get("domain") {
            let clean = v.trim().trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/');
            env_updates.insert("DOMAIN", clean.to_string());
            env_updates.insert("PUBLIC_BASE_URL", format!("https://{}", clean));
        }
        env_updates.insert("FRONTEND_DOMAIN", String::new());
        env_updates.insert("BACKEND_DOMAIN", String::new());
    } else {
        if let Some(v) = settings.get("deploy_mode") {
            env_updates.insert("DEPLOY_MODE", v.clone());
        }
        if let Some(v) = settings.get("domain") {
            env_updates.insert("DOMAIN", v.clone());
        }
        if let Some(v) = settings.get("frontend_domain") {
            env_updates.insert("FRONTEND_DOMAIN", v.clone());
        }
        if let Some(v) = settings.get("backend_domain") {
            env_updates.insert("BACKEND_DOMAIN", v.clone());
        }
        if let Some(v) = settings.get("public_base_url") {
            env_updates.insert("PUBLIC_BASE_URL", v.clone());
        }
    }
    if let Some(v) = settings.get("status_page_url") {
        env_updates.insert("STATUS_PAGE_URL", v.clone());
    }

    // Map origins to allow in CORS
    let mut new_origins = Vec::new();
    if let Some(fd) = settings.get("frontend_domain").filter(|s| !s.is_empty()) {
        let origin = extract_origin(fd);
        if !origin.is_empty() {
            new_origins.push(origin);
        }
    }
    if let Some(su) = settings.get("status_page_url").filter(|s| !s.is_empty()) {
        let origin = extract_origin(su);
        if !origin.is_empty() {
            new_origins.push(origin);
        }
    }

    for (env_key, new_val) in &env_updates {
        let mut found = false;
        for line in &mut lines {
            let trimmed = line.trim();
            if trimmed.starts_with(&format!("{}=", env_key)) || trimmed.starts_with(&format!("export {}=", env_key)) {
                *line = format!("{}={}", env_key, new_val);
                found = true;
                break;
            }
        }
        if !found {
            lines.push(format!("{}={}", env_key, new_val));
        }
    }

    if !new_origins.is_empty() {
        let mut found = false;
        for line in &mut lines {
            let trimmed = line.trim();
            if trimmed.starts_with("ALLOWED_ORIGINS=") || trimmed.starts_with("export ALLOWED_ORIGINS=") {
                let prefix = if trimmed.starts_with("export ") { "export ALLOWED_ORIGINS=" } else { "ALLOWED_ORIGINS=" };
                let current_raw = trimmed.trim_start_matches("export ").trim_start_matches("ALLOWED_ORIGINS=").trim_matches('"');
                if current_raw == "*" {
                    found = true;
                    break;
                }
                let mut current_origins: Vec<String> = current_raw
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();

                for no in &new_origins {
                    if !current_origins.contains(no) {
                        current_origins.push(no.clone());
                    }
                }
                *line = format!("{}\"{}\"", prefix, current_origins.join(","));
                found = true;
                break;
            }
        }
        if !found {
            lines.push(format!("ALLOWED_ORIGINS=\"{}\"", new_origins.join(",")));
        }
    }

    let updated_content = lines.join("\n") + "\n";
    if let Err(e) = std::fs::write(path, updated_content) {
        tracing::warn!("Failed to write updated env to {}: {}", path.display(), e);
    } else {
        tracing::info!("Successfully synchronized settings to environment file: {}", path.display());
    }
}
