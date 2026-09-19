use axum::{extract::State, response::IntoResponse, routing::get, Json, Router};
use serde::Serialize;
use std::path::Path;
use sysinfo::Disks;

use crate::{
    auth::RequireAuth,
    database::DbPool,
    errors::AppError,
    models::ApiResponse,
    storage::{LocalStorageProvider, StorageProvider},
};

#[derive(Clone)]
pub struct StorageStatsState {
    pub pool: DbPool,
    pub storage: LocalStorageProvider,
}

#[derive(Debug, Serialize)]
pub struct StorageStatsResponse {
    pub total_disk_bytes: u64,
    pub available_disk_bytes: u64,
    pub used_disk_bytes: u64,
    pub media_storage_bytes: u64,
    pub images_usage_bytes: u64,
    pub videos_usage_bytes: u64,
    pub thumbnails_usage_bytes: u64,
    pub total_files_count: i64,
    pub total_images_count: i64,
    pub total_videos_count: i64,
    pub total_trash_count: i64,
}

pub fn router(pool: DbPool, storage: LocalStorageProvider) -> Router {
    let state = StorageStatsState {
        pool,
        storage,
    };
    Router::new().route("/stats", get(get_storage_stats)).with_state(state)
}

async fn get_storage_stats(
    State(state): State<StorageStatsState>,
    RequireAuth(identity): RequireAuth,
) -> Result<impl IntoResponse, AppError> {
    if !identity.is_admin() && !identity.has_permission("admin") {
        return Err(AppError::Forbidden("Admin permission required".into()));
    }

    // 1. Get real filesystem disk statistics via sysinfo
    let disks = Disks::new_with_refreshed_list();
    let mut total_disk_bytes = 0u64;
    let mut available_disk_bytes = 0u64;

    if let Some(disk) = disks.list().first() {
        total_disk_bytes = disk.total_space();
        available_disk_bytes = disk.available_space();
    }

    let used_disk_bytes = total_disk_bytes.saturating_sub(available_disk_bytes);

    // 2. Single conditional aggregation instead of 4 separate COUNT queries
    let counts: (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT \
            COUNT(CASE WHEN deleted_at IS NULL THEN 1 END), \
            COUNT(CASE WHEN media_type = 'image' AND deleted_at IS NULL THEN 1 END), \
            COUNT(CASE WHEN media_type = 'video' AND deleted_at IS NULL THEN 1 END), \
            COUNT(CASE WHEN deleted_at IS NOT NULL THEN 1 END) \
         FROM media"
    )
    .fetch_one(&state.pool)
    .await
    .unwrap_or((0, 0, 0, 0));

    let (total_files_count, total_images_count, total_videos_count, total_trash_count) = counts;

    // 3. Compute directory sizes off the Tokio worker thread via spawn_blocking
    let images_path = state.storage.get_full_path("originals/images").unwrap_or_default();
    let videos_path = state.storage.get_full_path("originals/videos").unwrap_or_default();
    let thumbs_path = state.storage.get_full_path("generated/thumbnails").unwrap_or_default();

    let (images_usage_bytes, videos_usage_bytes, thumbnails_usage_bytes) =
        tokio::task::spawn_blocking(move || {
            (
                calculate_dir_size(&images_path),
                calculate_dir_size(&videos_path),
                calculate_dir_size(&thumbs_path),
            )
        })
        .await
        .unwrap_or((0, 0, 0));

    let media_storage_bytes = images_usage_bytes + videos_usage_bytes + thumbnails_usage_bytes;

    Ok(Json(ApiResponse::ok(StorageStatsResponse {
        total_disk_bytes,
        available_disk_bytes,
        used_disk_bytes,
        media_storage_bytes,
        images_usage_bytes,
        videos_usage_bytes,
        thumbnails_usage_bytes,
        total_files_count,
        total_images_count,
        total_videos_count,
        total_trash_count,
    })))
}

fn calculate_dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total += meta.len();
                } else if meta.is_dir() {
                    total += calculate_dir_size(&entry.path());
                }
            }
        }
    }
    total
}
