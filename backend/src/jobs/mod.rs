use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, warn};

use crate::{
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    media::MediaProcessor,
    models::{Job, Media},
    storage::{LocalStorageProvider, StorageProvider},
};

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoJobPayload {
    pub media_id: String,
    pub storage_path: String,
    pub public_id: String,
}

pub fn spawn_job_worker(pool: DbPool, storage: LocalStorageProvider, config: Arc<AppConfig>) {
    // 1. Worker loop for asynchronous jobs
    let pool_worker = pool.clone();
    let storage_worker = storage.clone();
    let config_worker = config.clone();
    tokio::spawn(async move {
        info!("Background job worker started.");
        loop {
            // Check for next queued job
            match fetch_and_process_next_job(&pool_worker, &storage_worker, &config_worker).await {
                Ok(true) => {
                    // Processed a job, check immediately for next
                    continue;
                }
                Ok(false) => {
                    // No job queued, sleep for a short interval
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
                Err(e) => {
                    warn!("Error during job processing: {}", e);
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        }
    });

    // 2. Periodic background maintenance task (hourly)
    let pool_cleanup = pool;
    tokio::spawn(async move {
        // Initial delay before first sweep
        tokio::time::sleep(Duration::from_secs(10)).await;
        let empty_payload = serde_json::json!({});
        let _ = enqueue_job(&pool_cleanup, "cleanup_expired", &empty_payload).await;

        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            let _ = enqueue_job(&pool_cleanup, "cleanup_expired", &empty_payload).await;
        }
    });
}

pub async fn enqueue_job(
    pool: &DbPool,
    job_type: &str,
    payload: &serde_json::Value,
) -> Result<String, AppError> {
    let id = format!("job_{}", uuid::Uuid::new_v4().simple());
    let payload_str = payload.to_string();

    sqlx::query(
        "INSERT INTO jobs (id, job_type, payload, status) VALUES (?, ?, ?, 'queued')"
    )
    .bind(&id)
    .bind(job_type)
    .bind(&payload_str)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(format!("Failed to enqueue job: {}", e)))?;

    Ok(id)
}

async fn fetch_and_process_next_job(
    pool: &DbPool,
    storage: &LocalStorageProvider,
    config: &AppConfig,
) -> Result<bool, AppError> {
    // Atomically find and mark a job as processing
    let now = chrono::Utc::now().to_rfc3339();
    let job: Option<Job> = sqlx::query_as(
        "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
    )
    .fetch_optional(pool)
    .await?;

    let Some(job) = job else {
        return Ok(false);
    };

    // Mark as processing
    let update_res = sqlx::query(
        "UPDATE jobs SET status = 'processing', started_at = ? WHERE id = ? AND status = 'queued'"
    )
    .bind(&now)
    .bind(&job.id)
    .execute(pool)
    .await?;

    if update_res.rows_affected() == 0 {
        return Ok(false);
    }

    info!("Processing job {} of type {}", job.id, job.job_type);

    let result = match job.job_type.as_str() {
        "video_process" => process_video_job(pool, storage, config, &job.payload).await,
        "cleanup_expired" => process_cleanup_job(pool, storage).await,
        _ => Err(AppError::BadRequest(format!("Unknown job type: {}", job.job_type))),
    };

    let completed_at = chrono::Utc::now().to_rfc3339();
    match result {
        Ok(_) => {
            sqlx::query("UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = ?")
                .bind(&completed_at)
                .bind(&job.id)
                .execute(pool)
                .await?;
            info!("Job {} completed successfully.", job.id);
        }
        Err(e) => {
            let err_msg = e.to_string();
            let new_retries = job.retry_count + 1;
            let new_status = if new_retries >= job.max_retries {
                "failed"
            } else {
                "queued" // retry
            };

            sqlx::query(
                "UPDATE jobs SET status = ?, retry_count = ?, error_message = ?, completed_at = ? WHERE id = ?"
            )
            .bind(new_status)
            .bind(new_retries)
            .bind(&err_msg)
            .bind(&completed_at)
            .bind(&job.id)
            .execute(pool)
            .await?;
            error!("Job {} failed: {}", job.id, err_msg);
        }
    }

    Ok(true)
}

async fn process_video_job(
    pool: &DbPool,
    storage: &LocalStorageProvider,
    config: &AppConfig,
    payload_str: &str,
) -> Result<(), AppError> {
    let payload: VideoJobPayload = serde_json::from_str(payload_str)
        .map_err(|e| AppError::BadRequest(format!("Invalid video job payload: {}", e)))?;

    let video_full_path = match storage.get_full_path(&payload.storage_path) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("Video file path not found for job: {}", e);
            return Ok(());
        }
    };

    // 1. Extract metadata via ffprobe if available
    let meta = match MediaProcessor::extract_video_metadata(&config.ffprobe_path, &video_full_path).await {
        Ok(m) => m,
        Err(e) => {
            tracing::debug!("Optional ffprobe metadata skipped: {}", e);
            crate::media::VideoMetadata::default()
        }
    };

    // 2. Generate thumbnail via ffmpeg only if client thumbnail does not already exist
    let thumb_relative_path = format!("generated/thumbnails/{}.jpg", payload.public_id);
    if !storage.file_exists(&thumb_relative_path).await.unwrap_or(false) {
        if let Ok(thumb_full_path) = storage.get_full_path(&thumb_relative_path) {
            let _ = MediaProcessor::generate_video_thumbnail(
                &config.ffmpeg_path,
                &video_full_path,
                &thumb_full_path,
            )
            .await;
        }
    }

    // 3. Update media row with any extracted metadata without overwriting existing client values
    if meta.width.is_some() || meta.height.is_some() || meta.duration.is_some() {
        let _ = sqlx::query(
            "UPDATE media SET width = COALESCE(width, ?), height = COALESCE(height, ?), duration = COALESCE(duration, ?), video_codec = COALESCE(video_codec, ?), audio_codec = COALESCE(audio_codec, ?), bitrate = COALESCE(bitrate, ?), frame_rate = COALESCE(frame_rate, ?), updated_at = ? WHERE id = ?"
        )
        .bind(meta.width)
        .bind(meta.height)
        .bind(meta.duration)
        .bind(&meta.video_codec)
        .bind(&meta.audio_codec)
        .bind(meta.bitrate)
        .bind(meta.frame_rate)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(&payload.media_id)
        .execute(pool)
        .await;
    }

    Ok(())
}

async fn process_cleanup_job(pool: &DbPool, storage: &LocalStorageProvider) -> Result<(), AppError> {
    let now = chrono::Utc::now();

    // 1. Clean trash based on trash_retention_days setting
    let retention_days_str = crate::api::settings::get_setting_or_default(pool, "trash_retention_days", "30").await;
    let retention_days: i64 = retention_days_str.trim().parse().unwrap_or(30).clamp(1, 365);
    let trash_cutoff = (now - chrono::Duration::days(retention_days)).to_rfc3339();

    let expired_media: Vec<Media> = sqlx::query_as(
        "SELECT * FROM media WHERE deleted_at IS NOT NULL AND deleted_at < ?"
    )
    .bind(&trash_cutoff)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    for m in expired_media {
        info!("Auto-purging expired trash media {} (deleted at {:?})", m.id, m.deleted_at);
        let _ = crate::api::files::purge_media_artifacts_internal(pool, storage, &m, true).await;
    }

    // 3. Prune api_logs older than 7 days
    let log_cutoff = (now - chrono::Duration::days(7)).to_rfc3339();
    let _ = sqlx::query("DELETE FROM api_logs WHERE created_at < ?")
        .bind(&log_cutoff)
        .execute(pool)
        .await;

    Ok(())
}
