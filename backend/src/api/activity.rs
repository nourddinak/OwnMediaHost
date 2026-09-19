use axum::{
    extract::{Query, State},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::{
    auth::RequireAdmin,
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    models::{ApiLog, ApiResponse, PaginatedResponse},
};

#[derive(Clone)]
pub struct ActivityState {
    pub pool: DbPool,
    #[allow(dead_code)]
    pub config: Arc<AppConfig>,
}

#[derive(Debug, Deserialize)]
pub struct ActivityQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub fn router(pool: DbPool, config: Arc<AppConfig>) -> Router {
    let state = ActivityState { pool, config };
    Router::new().route("/", get(list_activity)).with_state(state)
}

async fn list_activity(
    State(state): State<ActivityState>,
    RequireAdmin(_admin): RequireAdmin,
    Query(query): Query<ActivityQuery>,
) -> Result<impl IntoResponse, AppError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM api_logs")
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);

    let logs: Vec<ApiLog> = sqlx::query_as(
        "SELECT * FROM api_logs ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    let has_more = offset + (logs.len() as i64) < total;

    Ok(Json(ApiResponse::ok(PaginatedResponse {
        items: logs,
        total,
        limit,
        offset,
        has_more,
    })))
}
