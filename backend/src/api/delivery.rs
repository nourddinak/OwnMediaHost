use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use serde::Deserialize;
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio_util::io::ReaderStream;

use crate::{
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    models::Media,
    security::verify_private_url,
    storage::{LocalStorageProvider, StorageProvider},
};

#[derive(Clone)]
pub struct DeliveryState {
    pub pool: DbPool,
    pub storage: LocalStorageProvider,
    pub config: Arc<AppConfig>,
}

#[derive(Debug, Deserialize)]
pub struct PrivateQuery {
    pub expires: Option<i64>,
    pub signature: Option<String>,
}

pub fn router(pool: DbPool, storage: LocalStorageProvider, config: Arc<AppConfig>) -> Router {
    let state = DeliveryState {
        pool,
        storage,
        config,
    };

    Router::new()
        .route("/f/{public_id}/{filename}", get(deliver_public_file))
        .route("/f/{public_id}", get(deliver_public_file_short))
        .route("/thumbnails/{public_id}", get(deliver_thumbnail))
        .route("/private/{public_id}", get(deliver_private_file))
        .with_state(state)
}

async fn deliver_public_file_short(
    State(state): State<DeliveryState>,
    headers: HeaderMap,
    Path(public_id): Path<String>,
) -> Result<Response, AppError> {
    deliver_media_by_public_id(&state, &headers, &public_id, false).await
}

async fn deliver_public_file(
    State(state): State<DeliveryState>,
    headers: HeaderMap,
    Path((public_id, _filename)): Path<(String, String)>,
) -> Result<Response, AppError> {
    deliver_media_by_public_id(&state, &headers, &public_id, false).await
}

async fn deliver_private_file(
    State(state): State<DeliveryState>,
    headers: HeaderMap,
    Path(public_id): Path<String>,
    Query(query): Query<PrivateQuery>,
) -> Result<Response, AppError> {
    let Some(expires) = query.expires else {
        return Err(AppError::Forbidden("Missing 'expires' parameter".into()));
    };
    let Some(signature) = query.signature else {
        return Err(AppError::Forbidden("Missing 'signature' parameter".into()));
    };

    let valid = verify_private_url(
        &state.config.private_url_signing_key,
        &signature,
        &public_id,
        expires,
    );

    if !valid {
        return Err(AppError::Forbidden("Invalid or expired signed URL".into()));
    }

    deliver_media_by_public_id(&state, &headers, &public_id, true).await
}

async fn deliver_thumbnail(
    State(state): State<DeliveryState>,
    headers: HeaderMap,
    Path(public_id): Path<String>,
) -> Result<Response, AppError> {
    let clean_id = public_id
        .trim_end_matches(".jpg")
        .trim_end_matches(".jpeg")
        .trim_end_matches(".webp");

    let thumb_jpg = format!("generated/thumbnails/{}.jpg", clean_id);
    if state.storage.file_exists(&thumb_jpg).await? {
        let full_path = state.storage.get_full_path(&thumb_jpg)?;
        return serve_file_with_range(&full_path, "image/jpeg", &headers, true).await;
    }

    let thumb_webp = format!("generated/thumbnails/{}.webp", clean_id);
    if state.storage.file_exists(&thumb_webp).await? {
        let full_path = state.storage.get_full_path(&thumb_webp)?;
        return serve_file_with_range(&full_path, "image/webp", &headers, true).await;
    }

    // Fallback: If it's an image, deliver the original image file
    deliver_media_by_public_id(&state, &headers, clean_id, false).await
}

async fn deliver_media_by_public_id(
    state: &DeliveryState,
    headers: &HeaderMap,
    public_id: &str,
    is_private_access: bool,
) -> Result<Response, AppError> {
    let media: Media = sqlx::query_as("SELECT * FROM media WHERE public_id = ? AND deleted_at IS NULL")
        .bind(public_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Media {} not found", public_id)))?;

    if media.visibility == "private" && !is_private_access {
        return Err(AppError::Forbidden(
            "Access denied: media is private. Please generate a signed temporary URL.".into(),
        ));
    }

    let full_path = state.storage.get_full_path(&media.storage_path)?;
    serve_file_with_range(&full_path, &media.mime_type, headers, !is_private_access).await
}

/// Robust file delivery supporting HTTP Range requests (206 Partial Content) and caching headers
pub async fn serve_file_with_range(
    file_path: &std::path::Path,
    mime_type: &str,
    request_headers: &HeaderMap,
    is_immutable: bool,
) -> Result<Response, AppError> {
    if !file_path.exists() {
        return Err(AppError::NotFound("Physical file not found".into()));
    }

    let mut file = File::open(file_path).await?;
    let metadata = file.metadata().await?;
    let file_size = metadata.len();

    // Check for Range header: "Range: bytes=start-end"
    if let Some(range_header) = request_headers.get(header::RANGE) {
        if let Ok(range_str) = range_header.to_str() {
            if let Some(spec) = range_str.strip_prefix("bytes=") {
                let parts: Vec<&str> = spec.split('-').collect();
                if parts.len() == 2 {
                    let start_opt = parts[0].parse::<u64>().ok();
                    let end_opt = parts[1].parse::<u64>().ok();

                    let (start, end) = match (start_opt, end_opt) {
                        (Some(s), Some(e)) => (s, e.min(file_size - 1)),
                        (Some(s), None) => (s, file_size - 1),
                        (None, Some(e)) => {
                            let s = file_size.saturating_sub(e);
                            (s, file_size - 1)
                        }
                        (None, None) => (0, file_size - 1),
                    };

                    if start <= end && start < file_size {
                        let length = end - start + 1;
                        file.seek(SeekFrom::Start(start)).await?;

                        let stream = ReaderStream::new(file.take(length));
                        let body = Body::from_stream(stream);

                        let resp = Response::builder()
                            .status(StatusCode::PARTIAL_CONTENT)
                            .header(header::CONTENT_TYPE, mime_type)
                            .header(header::ACCEPT_RANGES, "bytes")
                            .header(
                                header::CONTENT_RANGE,
                                format!("bytes {}-{}/{}", start, end, file_size),
                            )
                            .header(header::CONTENT_LENGTH, length.to_string())
                            .body(body)
                            .unwrap();

                        return Ok(resp);
                    }
                }
            }
        }
    }

    // Standard 200 OK delivery (zero whole-file memory buffering)
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let cache_control = if is_immutable {
        "public, max-age=86400, must-revalidate"
    } else {
        "public, max-age=3600, must-revalidate"
    };

    let resp = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, file_size.to_string())
        .header(header::CACHE_CONTROL, cache_control)
        .body(body)
        .unwrap();

    Ok(resp)
}
