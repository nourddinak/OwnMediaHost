pub mod activity;
pub mod aliases;
pub mod auth;
pub mod delivery;
pub mod files;
pub mod folders;
pub mod keys;
pub mod settings;
pub mod storage_stats;
pub mod system;
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
    pub config: Arc<AppConfig>,
    pub start_time: std::time::Instant,
}

pub fn create_router(
    pool: DbPool,
    storage: LocalStorageProvider,
    config: Arc<AppConfig>,
) -> Router {
    let state = AppState {
        pool: pool.clone(),
        config: config.clone(),
        start_time: std::time::Instant::now(),
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
        .nest("/aliases", aliases::crud_router(pool.clone(), storage.clone(), config.clone()))
        .nest("/system", system::router(pool.clone(), config.clone()));

    let delivery_routes = delivery::router(pool.clone(), storage.clone(), config.clone());
    let alias_routes = aliases::delivery_router(pool.clone(), storage.clone(), config.clone());

    Router::new()
        // Root status endpoints
        .route("/", get(api_root))
        .route("/api", get(api_root))
        .route("/api/v1/", get(api_v1_root))
        // Health endpoints
        .route("/health", get({
            let state_clone = state.clone();
            move || health_check(state_clone)
        }))
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

async fn health_check(state: AppState) -> impl IntoResponse {
    let query_start = std::time::Instant::now();
    let db_ok = sqlx::query("SELECT 1").execute(&state.pool).await.is_ok();
    let db_latency_ms = (query_start.elapsed().as_micros() as f64) / 1000.0;

    let media_count: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(file_size), 0) FROM media WHERE deleted_at IS NULL"
    )
    .fetch_one(&state.pool)
    .await
    .unwrap_or((0, 0));

    let uptime_secs = state.start_time.elapsed().as_secs();

    let disks = sysinfo::Disks::new_with_refreshed_list();
    let (disk_total, disk_available) = if let Some(disk) = disks.list().first() {
        (disk.total_space(), disk.available_space())
    } else {
        (0, 0)
    };

    (
        [(axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
        Json(serde_json::json!({
            "status": if db_ok { "operational" } else { "degraded" },
            "version": env!("CARGO_PKG_VERSION"),
            "app_env": state.config.app_env,
            "uptime_seconds": uptime_secs,
            "database": {
                "status": if db_ok { "connected" } else { "error" },
                "query_latency_ms": db_latency_ms,
                "total_media_count": media_count.0,
                "total_media_bytes": media_count.1
            },
            "storage": {
                "total_disk_bytes": disk_total,
                "available_disk_bytes": disk_available
            }
        })),
    )
}

async fn health_live() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
        "live",
    )
}

async fn health_ready(state: AppState) -> Result<impl IntoResponse, AppError> {
    let _ = sqlx::query("SELECT 1").execute(&state.pool).await?;
    Ok((
        [(axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
        Json(ApiResponse::ok("ready")),
    ))
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

    #[tokio::test]
    async fn test_private_media_delivery() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();

        // Create tables
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

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS media (
                id TEXT PRIMARY KEY NOT NULL,
                public_id TEXT UNIQUE NOT NULL,
                filename TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                extension TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                media_type TEXT NOT NULL,
                storage_provider TEXT NOT NULL DEFAULT 'local',
                storage_path TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                width INTEGER,
                height INTEGER,
                duration REAL,
                video_codec TEXT,
                audio_codec TEXT,
                bitrate INTEGER,
                frame_rate REAL,
                sha256 TEXT NOT NULL,
                visibility TEXT NOT NULL DEFAULT 'public',
                folder_id TEXT,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                deleted_at TEXT
            );",
        )
        .execute(&pool)
        .await
        .unwrap();

        let storage_dir = tempfile::tempdir().unwrap();
        let file_path = storage_dir.path().join("secret.png");
        tokio::fs::write(&file_path, b"fake-png-content").await.unwrap();

        sqlx::query(
            "INSERT INTO media (id, public_id, filename, original_filename, extension, mime_type, media_type, storage_path, file_size, sha256, visibility)
             VALUES ('m1', 'priv_abc', 'secret.png', 'secret.png', 'png', 'image/png', 'image', 'secret.png', 16, 'dummy', 'private')"
        )
        .execute(&pool)
        .await
        .unwrap();

        let storage = LocalStorageProvider::new(storage_dir.path().to_path_buf()).unwrap();
        let signing_key = "test_key_32_bytes_long_123456789".to_string();
        let config = Arc::new(AppConfig {
            app_env: "test".to_string(),
            host: "127.0.0.1".to_string(),
            port: 5002,
            database_url: "sqlite::memory:".to_string(),
            media_root: storage_dir.path().to_path_buf(),
            public_base_url: "http://localhost:5002".to_string(),
            max_image_size: 10_000_000,
            max_video_size: 10_000_000,
            allowed_image_formats: vec!["jpeg".to_string(), "png".to_string()],
            allowed_video_formats: vec!["mp4".to_string()],
            cookie_secret: "test_secret_32_bytes_long_123456".to_string(),
            api_key_pepper: "test_pepper_32_bytes_long_123456".to_string(),
            private_url_signing_key: signing_key.clone(),
            admin_email: "admin@test.com".to_string(),
            admin_password: "testpassword123".to_string(),
            allowed_origins: vec!["*".to_string()],
            ffmpeg_path: "".to_string(),
            ffprobe_path: "".to_string(),
        });

        let app = create_router(pool, storage, config);

        // 1. Public endpoint (/f/...) must reject private media with 403 Forbidden
        let req_public = Request::builder()
            .uri("/f/priv_abc/secret.png")
            .method("GET")
            .body(Body::empty())
            .unwrap();
        let resp_public = app.clone().oneshot(req_public).await.unwrap();
        assert_eq!(resp_public.status(), StatusCode::FORBIDDEN);

        // 2. Direct private endpoint (/private/{id}) WITHOUT expiration must deliver 200 OK
        let req_priv_direct = Request::builder()
            .uri("/private/priv_abc")
            .method("GET")
            .body(Body::empty())
            .unwrap();
        let resp_priv_direct = app.clone().oneshot(req_priv_direct).await.unwrap();
        assert_eq!(resp_priv_direct.status(), StatusCode::OK);

        // 3. Private endpoint with filename (/private/{id}/{filename}) must deliver 200 OK
        let req_priv_fn = Request::builder()
            .uri("/private/priv_abc/secret.png")
            .method("GET")
            .body(Body::empty())
            .unwrap();
        let resp_priv_fn = app.clone().oneshot(req_priv_fn).await.unwrap();
        assert_eq!(resp_priv_fn.status(), StatusCode::OK);

        // 4. Valid unexpired Signed URL must deliver 200 OK
        let future_expires = chrono::Utc::now().timestamp() + 3600;
        let valid_sig = crate::security::sign_private_url(&signing_key, "priv_abc", future_expires);
        let req_signed_valid = Request::builder()
            .uri(format!("/private/priv_abc?expires={}&signature={}", future_expires, valid_sig))
            .method("GET")
            .body(Body::empty())
            .unwrap();
        let resp_signed_valid = app.clone().oneshot(req_signed_valid).await.unwrap();
        assert_eq!(resp_signed_valid.status(), StatusCode::OK);

        // 5. Expired Signed URL must be rejected with 403 Forbidden
        let past_expires = chrono::Utc::now().timestamp() - 60;
        let expired_sig = crate::security::sign_private_url(&signing_key, "priv_abc", past_expires);
        let req_signed_expired = Request::builder()
            .uri(format!("/private/priv_abc?expires={}&signature={}", past_expires, expired_sig))
            .method("GET")
            .body(Body::empty())
            .unwrap();
        let resp_signed_expired = app.clone().oneshot(req_signed_expired).await.unwrap();
        assert_eq!(resp_signed_expired.status(), StatusCode::FORBIDDEN);

        // 6. Invalid signature must be rejected with 403 Forbidden
        let req_signed_invalid = Request::builder()
            .uri(format!("/private/priv_abc?expires={}&signature=tampered_signature", future_expires))
            .method("GET")
            .body(Body::empty())
            .unwrap();
        let resp_signed_invalid = app.clone().oneshot(req_signed_invalid).await.unwrap();
        assert_eq!(resp_signed_invalid.status(), StatusCode::FORBIDDEN);
    }
}
