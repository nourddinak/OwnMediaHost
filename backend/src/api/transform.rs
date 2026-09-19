use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;

use crate::{
    auth::RequireAuth,
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    media::{MediaProcessor, TransformParams},
    models::{ApiResponse, Media},
    security::{sign_transformation, verify_transformation_signature},
    storage::{LocalStorageProvider, StorageProvider},
};

#[derive(Clone)]
pub struct TransformState {
    pub pool: DbPool,
    pub storage: LocalStorageProvider,
    pub config: Arc<AppConfig>,
}

#[derive(Debug, Deserialize)]
pub struct TransformQuery {
    pub id: String, // media public_id
    pub w: Option<u32>,
    pub h: Option<u32>,
    pub fit: Option<String>,
    pub format: Option<String>,
    pub q: Option<u8>,
    pub blur: Option<f32>,
    pub rot: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct SignTransformRequest {
    pub public_id: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fit: Option<String>,
    pub format: Option<String>,
    pub quality: Option<u8>,
    pub blur: Option<f32>,
    pub rotation: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct SignTransformResponse {
    pub url: String,
    pub signature: String,
}

pub fn router(pool: DbPool, storage: LocalStorageProvider, config: Arc<AppConfig>) -> Router {
    let state = TransformState {
        pool,
        storage,
        config,
    };

    Router::new()
        .route("/i/{signature}", get(serve_transformed_image))
        .route("/api/v1/transform/sign", post(generate_signed_transform_url))
        .with_state(state)
}

async fn serve_transformed_image(
    State(state): State<TransformState>,
    Path(signature): Path<String>,
    Query(query): Query<TransformQuery>,
) -> Result<Response, AppError> {
    // 1. Validate signature
    let is_valid = verify_transformation_signature(
        &state.config.transform_signing_key,
        &signature,
        &query.id,
        query.w,
        query.h,
        query.fit.as_deref(),
        query.format.as_deref(),
        query.q,
        query.blur,
        query.rot,
    );

    if !is_valid {
        return Err(AppError::Forbidden("Invalid transformation signature".into()));
    }

    // 2. Validate bounds and security limits
    if let Some(w) = query.w {
        if w > state.config.max_transform_width {
            return Err(AppError::BadRequest(format!(
                "Width exceeds maximum allowed of {}",
                state.config.max_transform_width
            )));
        }
    }
    if let Some(h) = query.h {
        if h > state.config.max_transform_height {
            return Err(AppError::BadRequest(format!(
                "Height exceeds maximum allowed of {}",
                state.config.max_transform_height
            )));
        }
    }
    if let (Some(w), Some(h)) = (query.w, query.h) {
        if (w as u64) * (h as u64) > state.config.max_transform_pixels {
            return Err(AppError::BadRequest("Total pixel count exceeds allowed limit".into()));
        }
    }

    let target_format = query.format.clone().unwrap_or_else(|| "webp".to_string());
    if !state.config.allowed_transform_formats.contains(&target_format.to_lowercase()) {
        return Err(AppError::BadRequest(format!(
            "Format {} is not allowed",
            target_format
        )));
    }

    // 3. Compute cache key
    let cache_key = {
        let mut hasher = Sha256::new();
        let payload = format!(
            "{}:{}:{}:{}:{}:{}:{}:{}",
            query.id,
            query.w.unwrap_or(0),
            query.h.unwrap_or(0),
            query.fit.as_deref().unwrap_or("cover"),
            target_format,
            query.q.unwrap_or(85),
            query.blur.unwrap_or(0.0),
            query.rot.unwrap_or(0)
        );
        hasher.update(payload.as_bytes());
        hex::encode(hasher.finalize())
    };

    let cache_rel_path = format!("generated/transformed/{}/{}.{}", query.id, cache_key, target_format);
    let legacy_cache_path = format!("generated/transformed/{}.{}", cache_key, target_format);

    // 4. Serve from cache if available (supports modern per-media directory and legacy flat files)
    let cached_bytes = if state.storage.file_exists(&cache_rel_path).await? {
        Some(state.storage.read_file(&cache_rel_path).await?)
    } else if state.storage.file_exists(&legacy_cache_path).await? {
        Some(state.storage.read_file(&legacy_cache_path).await?)
    } else {
        None
    };

    if let Some(cached_bytes) = cached_bytes {
        let mime = match target_format.as_str() {
            "webp" => "image/webp",
            "png" => "image/png",
            "gif" => "image/gif",
            _ => "image/jpeg",
        };

        return Ok(Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
            .header(header::CONTENT_LENGTH, cached_bytes.len().to_string())
            .body(Body::from(cached_bytes))
            .unwrap());
    }

    // 5. Fetch media record to locate original
    let media: Media = sqlx::query_as("SELECT * FROM media WHERE public_id = ? AND deleted_at IS NULL")
        .bind(&query.id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Media {} not found", query.id)))?;

    if media.media_type != "image" {
        return Err(AppError::BadRequest("Transformations only supported for images".into()));
    }

    let original_bytes = state.storage.read_file(&media.storage_path).await?;

    let transform_params = TransformParams {
        width: query.w,
        height: query.h,
        fit: query.fit,
        format: Some(target_format.clone()),
        quality: query.q,
        blur: query.blur,
        rotation: query.rot,
    };

    let (transformed_bytes, mime_type) =
        MediaProcessor::transform_image(&original_bytes, &transform_params)?;

    // Cache transformed image asynchronously
    let storage_clone = state.storage.clone();
    let cache_path_clone = cache_rel_path.clone();
    let bytes_clone = transformed_bytes.clone();
    tokio::spawn(async move {
        let _ = storage_clone.write_file(&cache_path_clone, &bytes_clone).await;
    });

    let resp = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_type)
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header(header::CONTENT_LENGTH, transformed_bytes.len().to_string())
        .body(Body::from(transformed_bytes))
        .unwrap();

    Ok(resp)
}

async fn generate_signed_transform_url(
    State(state): State<TransformState>,
    RequireAuth(identity): RequireAuth,
    Json(req): Json<SignTransformRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("transform:sign") && !identity.has_permission("files:read") {
        return Err(AppError::Forbidden("Permission transform:sign required".into()));
    }

    let sig = sign_transformation(
        &state.config.transform_signing_key,
        &req.public_id,
        req.width,
        req.height,
        req.fit.as_deref(),
        req.format.as_deref(),
        req.quality,
        req.blur,
        req.rotation,
    );

    let mut query_params = vec![format!("id={}", req.public_id)];
    if let Some(w) = req.width {
        query_params.push(format!("w={}", w));
    }
    if let Some(h) = req.height {
        query_params.push(format!("h={}", h));
    }
    if let Some(fit) = &req.fit {
        query_params.push(format!("fit={}", fit));
    }
    if let Some(fmt) = &req.format {
        query_params.push(format!("format={}", fmt));
    }
    if let Some(q) = req.quality {
        query_params.push(format!("q={}", q));
    }
    if let Some(b) = req.blur {
        query_params.push(format!("blur={}", b));
    }
    if let Some(r) = req.rotation {
        query_params.push(format!("rot={}", r));
    }

    let signed_url = format!(
        "{}/i/{}?{}",
        state.config.public_base_url,
        sig,
        query_params.join("&")
    );

    Ok(Json(ApiResponse::ok(SignTransformResponse {
        url: signed_url,
        signature: sig,
    })))
}
