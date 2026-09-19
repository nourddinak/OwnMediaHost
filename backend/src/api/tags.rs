use axum::{extract::State, response::IntoResponse, routing::get, Json, Router};
use serde::Serialize;
use std::sync::Arc;

use crate::{
    auth::RequireAuth,
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    models::ApiResponse,
};

#[derive(Clone)]
pub struct TagsState {
    pub pool: DbPool,
    pub config: Arc<AppConfig>,
}

#[derive(Debug, Serialize)]
pub struct TagWithCount {
    pub id: String,
    pub name: String,
    pub count: i64,
}

pub fn router(pool: DbPool, config: Arc<AppConfig>) -> Router {
    let state = TagsState { pool, config };
    Router::new().route("/", get(list_tags)).with_state(state)
}

async fn list_tags(
    State(state): State<TagsState>,
    RequireAuth(identity): RequireAuth,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:read") {
        return Err(AppError::Forbidden("Permission files:read required".into()));
    }

    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        r#"
        SELECT tags.id, tags.name, COUNT(media_tags.media_id) as count
        FROM tags
        LEFT JOIN media_tags ON tags.id = media_tags.tag_id
        LEFT JOIN media ON media_tags.media_id = media.id AND media.deleted_at IS NULL
        GROUP BY tags.id, tags.name
        ORDER BY count DESC, tags.name ASC
        "#
    )
    .fetch_all(&state.pool)
    .await?;

    let tags: Vec<TagWithCount> = rows
        .into_iter()
        .map(|(id, name, count)| TagWithCount { id, name, count })
        .collect();

    Ok(Json(ApiResponse::ok(tags)))
}
