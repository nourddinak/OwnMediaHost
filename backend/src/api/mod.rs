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
    response::{Html, IntoResponse, Response},
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

    let api_v1: Router = Router::new()
        .nest("/auth", auth::router(pool.clone(), config.clone()))
        .nest("/files", files::router(pool.clone(), storage.clone(), config.clone()))
        .nest("/folders", folders::router(pool.clone(), config.clone()))
        .nest("/tags", tags::router(pool.clone()))
        .nest("/keys", keys::router(pool.clone(), config.clone()))
        .nest("/storage", storage_stats::router(pool.clone(), storage.clone(), config.clone()))
        .nest("/activity", activity::router(pool.clone(), config.clone()))
        .nest("/settings", settings::router(pool.clone(), config.clone()))
        .route("/openapi.json", get(openapi_spec));

    let delivery_routes = delivery::router(pool.clone(), storage.clone(), config.clone());
    let alias_routes = aliases::router(pool.clone(), storage.clone(), config.clone());

    Router::new()
        // Root status endpoint
        .route("/", get(api_root))
        // Health endpoints
        .route("/health", get(health_check))
        .route("/health/live", get(health_live))
        .route("/health/ready", get({
            let state_clone = state.clone();
            move || health_ready(state_clone)
        }))
        // API Documentation
        .route("/docs", get(swagger_ui))
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
        "documentation": "/docs",
        "health": "/health",
        "api_v1": "/api/v1"
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
        || path.starts_with("/health")
        || path.starts_with("/docs")
        || path == "/openapi.json";

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

async fn swagger_ui() -> Html<&'static str> {
    Html(r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OwnMediaHost API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #090909; color: #fff; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui { filter: invert(88%) hue-rotate(180deg); }
    .swagger-ui .microlight { filter: invert(100%) hue-rotate(180deg); }
  </style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
  window.onload = () => {
    window.ui = SwaggerUIBundle({
      url: '/api/v1/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset
      ],
      layout: "BaseLayout"
    });
  };
</script>
</body>
</html>"#)
}

async fn openapi_spec() -> impl IntoResponse {
    Json(serde_json::json!({
        "openapi": "3.0.3",
        "info": {
            "title": "OwnMediaHost API",
            "version": "1.0.0",
            "description": "Production-ready, self-hosted personal media infrastructure platform."
        },
        "servers": [
            { "url": "/api/v1", "description": "API v1 root" }
        ],
        "paths": {
            "/files": {
                "post": {
                    "summary": "Upload a media file (streaming multipart)",
                    "responses": { "200": { "description": "Media uploaded" } }
                },
                "get": {
                    "summary": "List media assets with filtering and pagination",
                    "responses": { "200": { "description": "List of media files" } }
                }
            },
            "/files/{id}": {
                "get": { "summary": "Get media details by ID or public ID" },
                "patch": { "summary": "Update media metadata" },
                "delete": { "summary": "Move media to trash (soft-delete)" }
            },
            "/files/{id}/content": {
                "put": { "summary": "In-place file replacement preserving ID, public ID, and aliases" }
            },
            "/files/{id}/restore": {
                "post": { "summary": "Restore media from trash" }
            },
            "/files/{id}/permanent": {
                "delete": { "summary": "Permanently delete media from disk and database" }
            },
            "/uploads": {
                "post": { "summary": "Initialize resumable chunked upload session" }
            },
            "/uploads/{id}": {
                "patch": { "summary": "Upload single chunk" },
                "delete": { "summary": "Abort resumable upload session" }
            },
            "/uploads/{id}/complete": {
                "post": { "summary": "Complete and assemble chunked upload" }
            },
            "/aliases": {
                "get": { "summary": "List all vanity aliases" },
                "post": { "summary": "Create vanity alias" }
            },
            "/keys": {
                "get": { "summary": "List API keys" },
                "post": { "summary": "Generate new scoped API key" }
            },
            "/storage/stats": {
                "get": { "summary": "Get real disk space and breakdown statistics" }
            }
        }
    }))
}
