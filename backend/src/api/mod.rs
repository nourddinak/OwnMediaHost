pub mod activity;
pub mod aliases;
pub mod auth;
pub mod delivery;
pub mod files;
pub mod folders;
pub mod keys;
pub mod settings;
pub mod storage_stats;
pub mod tags;

use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use std::sync::Arc;
use std::time::Instant;

use crate::{
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    models::ApiResponse,
    storage::LocalStorageProvider,
};

#[derive(Clone)]
pub struct AppState {
    pub pool: DbPool,
}

pub fn create_router(
    pool: DbPool,
    storage: LocalStorageProvider,
    config: Arc<AppConfig>,
) -> Router {
    let state = AppState {
        pool: pool.clone(),
    };

    let settings_cache = settings::SettingsCache::new();

    let api_v1: Router = Router::new()
        .route("/", get(api_v1_root))
        .nest("/auth", auth::router(pool.clone(), config.clone()))
        .nest("/files", files::router(pool.clone(), storage.clone(), config.clone(), settings_cache.clone()))
        .nest("/folders", folders::router(pool.clone()))
        .nest("/tags", tags::router(pool.clone()))
        .nest("/keys", keys::router(pool.clone(), config.clone()))
        .nest("/storage", storage_stats::router(pool.clone(), storage.clone()))
        .nest("/activity", activity::router(pool.clone()))
        .nest("/settings", settings::router(pool.clone(), settings_cache))
        .nest("/aliases", aliases::crud_router(pool.clone(), storage.clone(), config.clone()));

    let delivery_routes = delivery::router(pool.clone(), storage.clone(), config.clone());
    let alias_routes = aliases::delivery_router(pool.clone(), storage.clone(), config.clone());

    Router::new()
        // Root status endpoints
        .route("/", get(api_root))
        .route("/api", get(api_root))
        .route("/api/v1/", get(api_v1_root))
        // Health endpoints
        .route("/health", get(health_check))
        .route("/health/live", get(health_live))
        .route("/health/ready", get({
            let state_clone = state.clone();
            move || health_ready(state_clone)
        }))
        // Static delivery and aliases (all Router<()>)
        .merge(delivery_routes)
        .merge(alias_routes)
        // Main API v1 (Router<()>)
        .nest("/api/v1", api_v1)
        .layer(DefaultBodyLimit::disable())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            activity_logging_middleware,
        ))
}

async fn api_root() -> impl IntoResponse {
    Json(serde_json::json!({
        "name": "OwnMediaHost API",
        "version": env!("CARGO_PKG_VERSION"),
        "status": "operational",
        "health": "/health",
        "api_v1": "/api/v1"
    }))
}

async fn api_v1_root() -> impl IntoResponse {
    Json(serde_json::json!({
        "name": "OwnMediaHost API v1",
        "version": "1.0",
        "status": "operational",
        "health": "/health",
        "endpoints": {
            "auth": "/api/v1/auth",
            "files": "/api/v1/files",
            "folders": "/api/v1/folders",
            "tags": "/api/v1/tags",
            "keys": "/api/v1/keys",
            "storage": "/api/v1/storage",
            "activity": "/api/v1/activity",
            "settings": "/api/v1/settings"
        }
    }))
}

async fn health_check() -> impl IntoResponse {
    Json(ApiResponse::ok("OwnMediaHost is healthy"))
}

async fn health_live() -> impl IntoResponse {
    (StatusCode::OK, "live")
}

async fn health_ready(state: AppState) -> Result<impl IntoResponse, AppError> {
    let _ = sqlx::query("SELECT 1").execute(&state.pool).await?;
    Ok(Json(ApiResponse::ok("ready")))
}

async fn activity_logging_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let start = Instant::now();
    let request_id = format!("req_{}", uuid::Uuid::new_v4().simple());

    let method = req.method().to_string();
    let path = req.uri().path().to_string();

    let mut response = next.run(req).await;

    let latency_ms = start.elapsed().as_secs_f64() * 1000.0;
    let status_code = response.status().as_u16() as i64;

    if let Ok(val) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert("X-Request-ID", val);
    }

    let is_excluded = path.starts_with("/f/")
        || path.starts_with("/thumbnails/")
        || path.starts_with("/a/")
        || path.starts_with("/health");

    if !is_excluded {
        let pool = state.pool.clone();
        let req_id_clone = request_id.clone();
        let method_clone = method.clone();
        let path_clone = path.clone();
        let now = chrono::Utc::now().to_rfc3339();

        tokio::spawn(async move {
            let log_id = format!("log_{}", uuid::Uuid::new_v4().simple());
            let _ = sqlx::query(
                "INSERT INTO api_logs (id, request_id, method, path, status_code, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&log_id)
            .bind(&req_id_clone)
            .bind(&method_clone)
            .bind(&path_clone)
            .bind(status_code)
            .bind(latency_ms)
            .bind(&now)
            .execute(&pool)
            .await;
        });
    }

    response
}



#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use sqlx::sqlite::SqlitePoolOptions;
    use std::path::PathBuf;
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_routes_exist() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();

        // Run migrations
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS api_logs (
                id TEXT PRIMARY KEY,
                request_id TEXT NOT NULL,
                method TEXT NOT NULL,
                path TEXT NOT NULL,
                status_code INTEGER NOT NULL,
                latency_ms REAL NOT NULL,
                created_at TEXT NOT NULL
            );",
        )
        .execute(&pool)
        .await
        .unwrap();

        let storage_dir = tempfile::tempdir().unwrap();
        let storage = LocalStorageProvider::new(storage_dir.path().to_path_buf()).unwrap();
        let config = Arc::new(AppConfig {
            app_env: "test".to_string(),
            host: "127.0.0.1".to_string(),
            port: 5002,
            database_url: "sqlite::memory:".to_string(),
            media_root: PathBuf::from("./target/test_storage"),
            public_base_url: "http://localhost:5002".to_string(),
            max_image_size: 10_000_000,
            max_video_size: 10_000_000,
            allowed_image_formats: vec!["jpeg".to_string(), "png".to_string()],
            allowed_video_formats: vec!["mp4".to_string()],
            cookie_secret: "test_secret_32_bytes_long_123456".to_string(),
            api_key_pepper: "test_pepper_32_bytes_long_123456".to_string(),
            private_url_signing_key: "test_key_32_bytes_long_123456789".to_string(),
            admin_email: "admin@test.com".to_string(),
            admin_password: "testpassword123".to_string(),
            allowed_origins: vec!["*".to_string()],
            ffmpeg_path: "".to_string(),
            ffprobe_path: "".to_string(),
        });

        let app = create_router(pool, storage, config);

        let endpoints = vec!["/", "/api", "/api/v1", "/api/v1/", "/health"];
        for path in endpoints {
            let req = Request::builder()
                .uri(path)
                .method("GET")
                .body(Body::empty())
                .unwrap();

            let response = app.clone().oneshot(req).await.unwrap();
            assert_eq!(
                response.status(),
                StatusCode::OK,
                "Failed on path: {}",
                path
            );
        }
    }
}
