use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    response::IntoResponse,
    routing::{patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio::fs::{self, File};
use tokio::io::AsyncReadExt;
use tracing::info;

use crate::{
    api::files::format_media_response,
    auth::RequireAuth,
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    jobs::{enqueue_job, VideoJobPayload},
    media::MediaProcessor,
    models::{ApiResponse, Media, UploadSession},
    storage::{LocalStorageProvider, StorageProvider},
};

#[derive(Clone)]
pub struct UploadsState {
    pub pool: DbPool,
    pub storage: LocalStorageProvider,
    pub config: Arc<AppConfig>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSessionRequest {
    pub filename: String,
    pub total_size: i64,
    pub mime_type: Option<String>,
    pub chunk_size: Option<i64>,
    pub folder_id: Option<String>,
    pub visibility: Option<String>,
    pub alias: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UploadChunkQuery {
    pub chunk_index: i64,
}

#[derive(Debug, Serialize)]
pub struct CreateSessionResponse {
    pub session_id: String,
    pub chunk_size: i64,
    pub total_chunks: i64,
    pub expires_at: String,
}

#[derive(Debug, Serialize)]
pub struct ChunkProgressResponse {
    pub session_id: String,
    pub chunk_index: i64,
    pub uploaded_size: i64,
    pub total_size: i64,
    pub progress_percent: f64,
}

pub fn router(pool: DbPool, storage: LocalStorageProvider, config: Arc<AppConfig>) -> Router {
    let state = UploadsState {
        pool,
        storage,
        config,
    };

    Router::new()
        .route("/", post(create_session))
        .route("/{id}", patch(upload_chunk).delete(abort_session))
        .route("/{id}/complete", post(complete_session))
        .layer(DefaultBodyLimit::disable())
        .with_state(state)
}

async fn create_session(
    State(state): State<UploadsState>,
    RequireAuth(identity): RequireAuth,
    Json(req): Json<CreateSessionRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:write") {
        return Err(AppError::Forbidden("Permission files:write required".into()));
    }

    if req.total_size <= 0 {
        return Err(AppError::BadRequest("total_size must be positive".into()));
    }

    if req.total_size as u64 > state.config.max_video_size {
        return Err(AppError::PayloadTooLarge(format!(
            "Total upload size exceeds maximum allowed ({} GB)",
            state.config.max_video_size / 1024 / 1024 / 1024
        )));
    }

    let chunk_size = req
        .chunk_size
        .unwrap_or(state.config.default_chunk_size as i64)
        .clamp(512 * 1024, 100 * 1024 * 1024); // 512KB to 100MB

    let total_chunks = (req.total_size + chunk_size - 1) / chunk_size;

    let session_id = format!("ses_{}", uuid::Uuid::new_v4().simple());
    let expires_at = (chrono::Utc::now() + chrono::Duration::hours(24)).to_rfc3339();
    let now = chrono::Utc::now().to_rfc3339();

    // Create session chunk directory
    let chunk_dir = format!("temporary/chunks/{}", session_id);
    let chunk_full_path = state.storage.get_full_path(&chunk_dir)?;
    fs::create_dir_all(&chunk_full_path).await?;

    let mime_type = req
        .mime_type
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let visibility = req.visibility.unwrap_or_else(|| "public".to_string());

    sqlx::query(
        r#"
        INSERT INTO upload_sessions (
            id, original_filename, mime_type, total_size, uploaded_size,
            chunk_size, total_chunks, uploaded_chunks, folder_id, visibility,
            alias, expires_at, created_at
        ) VALUES (
            ?, ?, ?, ?, 0,
            ?, ?, '[]', ?, ?,
            ?, ?, ?
        )
        "#
    )
    .bind(&session_id)
    .bind(&req.filename)
    .bind(&mime_type)
    .bind(req.total_size)
    .bind(chunk_size)
    .bind(total_chunks)
    .bind(&req.folder_id)
    .bind(&visibility)
    .bind(&req.alias)
    .bind(&expires_at)
    .bind(&now)
    .execute(&state.pool)
    .await?;

    info!("Created resumable upload session {} for {}", session_id, req.filename);
    Ok(Json(ApiResponse::ok(CreateSessionResponse {
        session_id,
        chunk_size,
        total_chunks,
        expires_at,
    })))
}

async fn upload_chunk(
    State(state): State<UploadsState>,
    RequireAuth(identity): RequireAuth,
    Path(session_id): Path<String>,
    Query(query): Query<UploadChunkQuery>,
    body: Bytes,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:write") {
        return Err(AppError::Forbidden("Permission files:write required".into()));
    }

    let session: UploadSession = sqlx::query_as("SELECT * FROM upload_sessions WHERE id = ?")
        .bind(&session_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Upload session {} not found", session_id)))?;

    if query.chunk_index < 0 || query.chunk_index >= session.total_chunks {
        return Err(AppError::BadRequest(format!(
            "Invalid chunk index {}. Must be between 0 and {}",
            query.chunk_index,
            session.total_chunks - 1
        )));
    }

    // Write chunk file
    let chunk_path = format!("temporary/chunks/{}/{}", session_id, query.chunk_index);
    state.storage.write_file(&chunk_path, &body).await?;

    // Update session uploaded chunks
    let mut uploaded_chunks: Vec<i64> =
        serde_json::from_str(&session.uploaded_chunks).unwrap_or_default();
    if !uploaded_chunks.contains(&query.chunk_index) {
        uploaded_chunks.push(query.chunk_index);
        uploaded_chunks.sort();
    }

    let new_uploaded_size = (session.uploaded_size + body.len() as i64).min(session.total_size);
    let uploaded_chunks_json = serde_json::to_string(&uploaded_chunks).unwrap();

    sqlx::query(
        "UPDATE upload_sessions SET uploaded_size = ?, uploaded_chunks = ? WHERE id = ?"
    )
    .bind(new_uploaded_size)
    .bind(&uploaded_chunks_json)
    .bind(&session_id)
    .execute(&state.pool)
    .await?;

    let progress_percent = (new_uploaded_size as f64 / session.total_size as f64 * 100.0).min(100.0);

    Ok(Json(ApiResponse::ok(ChunkProgressResponse {
        session_id,
        chunk_index: query.chunk_index,
        uploaded_size: new_uploaded_size,
        total_size: session.total_size,
        progress_percent,
    })))
}

async fn complete_session(
    State(state): State<UploadsState>,
    RequireAuth(identity): RequireAuth,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:write") {
        return Err(AppError::Forbidden("Permission files:write required".into()));
    }

    let session: UploadSession = sqlx::query_as("SELECT * FROM upload_sessions WHERE id = ?")
        .bind(&session_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Upload session {} not found", session_id)))?;

    let uploaded_chunks: Vec<i64> =
        serde_json::from_str(&session.uploaded_chunks).unwrap_or_default();

    // Verify all chunks uploaded
    for i in 0..session.total_chunks {
        if !uploaded_chunks.contains(&i) {
            return Err(AppError::BadRequest(format!(
                "Missing chunk {} of {}",
                i, session.total_chunks
            )));
        }
    }

    // Assemble chunks into final file
    let chunk_dir = format!("temporary/chunks/{}", session_id);
    let chunk_full_dir = state.storage.get_full_path(&chunk_dir)?;

    let mut assembled_bytes = Vec::with_capacity(session.total_size as usize);
    let mut hasher = Sha256::new();

    for i in 0..session.total_chunks {
        let chunk_file_path = chunk_full_dir.join(i.to_string());
        let mut f = File::open(&chunk_file_path).await?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).await?;
        hasher.update(&buf);
        assembled_bytes.extend_from_slice(&buf);
    }

    let sha256_hash = hex::encode(hasher.finalize());

    // Clean up temporary chunks
    let _ = fs::remove_dir_all(&chunk_full_dir).await;

    // Detect MIME and media type
    let (mime_type, extension, media_type) =
        MediaProcessor::detect_type(&assembled_bytes, &session.original_filename);

    let media_id = format!("med_{}", uuid::Uuid::new_v4().simple());
    let public_id = hex::encode(&rand::random::<[u8; 4]>());

    let storage_path =
        LocalStorageProvider::generate_storage_path(&media_type, &public_id, &extension);
    state
        .storage
        .write_file(&storage_path, &assembled_bytes)
        .await?;

    let mut width: Option<i64> = None;
    let mut height: Option<i64> = None;
    let duration: Option<f64> = None;
    let video_codec: Option<String> = None;
    let audio_codec: Option<String> = None;
    let bitrate: Option<i64> = None;
    let frame_rate: Option<f64> = None;

    if media_type == "image" {
        if let Ok(meta) = MediaProcessor::extract_image_metadata(&assembled_bytes) {
            width = Some(meta.width as i64);
            height = Some(meta.height as i64);
        }
    } else if media_type == "video" {
        let payload = serde_json::to_value(VideoJobPayload {
            media_id: media_id.clone(),
            storage_path: storage_path.clone(),
            public_id: public_id.clone(),
        })
        .unwrap();
        let _ = enqueue_job(&state.pool, "video_process", &payload).await;
    }

    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        r#"
        INSERT INTO media (
            id, public_id, filename, original_filename, extension, mime_type, media_type,
            storage_provider, storage_path, file_size, width, height, duration,
            video_codec, audio_codec, bitrate, frame_rate, sha256, visibility,
            folder_id, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?,
            'local', ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?
        )
        "#
    )
    .bind(&media_id)
    .bind(&public_id)
    .bind(&session.original_filename)
    .bind(&session.original_filename)
    .bind(&extension)
    .bind(&mime_type)
    .bind(&media_type)
    .bind(&storage_path)
    .bind(assembled_bytes.len() as i64)
    .bind(width)
    .bind(height)
    .bind(duration)
    .bind(&video_codec)
    .bind(&audio_codec)
    .bind(bitrate)
    .bind(frame_rate)
    .bind(&sha256_hash)
    .bind(&session.visibility)
    .bind(&session.folder_id)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await?;

    // Handle alias if specified in session
    if let Some(alias_path) = &session.alias {
        let alias_id = format!("als_{}", uuid::Uuid::new_v4().simple());
        let _ = sqlx::query(
            "INSERT INTO aliases (id, alias_path, media_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(alias_path) DO UPDATE SET media_id = excluded.media_id, updated_at = excluded.updated_at"
        )
        .bind(&alias_id)
        .bind(alias_path)
        .bind(&media_id)
        .bind(&now)
        .bind(&now)
        .execute(&state.pool)
        .await;
    }

    // Delete completed session
    let _ = sqlx::query("DELETE FROM upload_sessions WHERE id = ?")
        .bind(&session_id)
        .execute(&state.pool)
        .await;

    let media = Media {
        id: media_id,
        public_id,
        filename: session.original_filename.clone(),
        original_filename: session.original_filename,
        extension,
        mime_type,
        media_type,
        storage_provider: "local".to_string(),
        storage_path,
        file_size: assembled_bytes.len() as i64,
        width,
        height,
        duration,
        video_codec,
        audio_codec,
        bitrate,
        frame_rate,
        sha256: sha256_hash,
        visibility: session.visibility,
        folder_id: session.folder_id,
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
    };

    let response = format_media_response(&state.pool, &media, &state.config).await?;
    info!("Resumable upload {} completed successfully.", media.id);
    Ok(Json(ApiResponse::ok(response)))
}

async fn abort_session(
    State(state): State<UploadsState>,
    RequireAuth(identity): RequireAuth,
    Path(session_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:write") {
        return Err(AppError::Forbidden("Permission files:write required".into()));
    }

    let chunk_dir = format!("temporary/chunks/{}", session_id);
    if let Ok(path) = state.storage.get_full_path(&chunk_dir) {
        let _ = fs::remove_dir_all(path).await;
    }

    sqlx::query("DELETE FROM upload_sessions WHERE id = ?")
        .bind(&session_id)
        .execute(&state.pool)
        .await?;

    info!("Aborted upload session {}", session_id);
    Ok(Json(ApiResponse::ok("Upload session cancelled and cleaned up")))
}
