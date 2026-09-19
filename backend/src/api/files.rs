use axum::{
    extract::{Multipart, Path, Query, State},
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tracing::info;

use crate::{
    auth::RequireAuth,
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    jobs::{enqueue_job, VideoJobPayload},
    media::MediaProcessor,
    models::{ApiResponse, Media, MediaResponse, PaginatedResponse},
    security::sign_private_url,
    storage::{LocalStorageProvider, StorageProvider},
};

#[derive(Clone)]
pub struct FilesState {
    pub pool: DbPool,
    pub storage: LocalStorageProvider,
    pub config: Arc<AppConfig>,
}

#[derive(Debug, Deserialize)]
pub struct ListFilesQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    #[serde(rename = "type")]
    pub media_type: Option<String>,
    pub folder_id: Option<String>,
    pub tag: Option<String>,
    pub visibility: Option<String>,
    pub search: Option<String>,
    pub sort: Option<String>, // "newest", "oldest", "largest", "smallest", "filename"
    pub trash: Option<bool>,  // if true, returns soft-deleted files
}

#[derive(Debug, Deserialize)]
pub struct UpdateMediaRequest {
    pub filename: Option<String>,
    pub folder_id: Option<String>,
    pub visibility: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct BulkOperationRequest {
    pub ids: Vec<String>,
    pub action: String, // "delete", "restore", "permanent_delete", "move", "visibility"
    pub target_folder_id: Option<String>,
    pub target_visibility: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SignPrivateRequest {
    pub expires_seconds: Option<i64>, // e.g. 3600 (1 hour)
}

#[derive(Debug, Deserialize, Default)]
pub struct DeleteFileQuery {
    pub permanent: Option<bool>,
    pub cleanup_empty_folder: Option<bool>,
}

pub fn router(pool: DbPool, storage: LocalStorageProvider, config: Arc<AppConfig>) -> Router {
    let state = FilesState {
        pool,
        storage,
        config,
    };

    Router::new()
        .route("/", post(upload_file).get(list_files))
        .route("/bulk", post(bulk_operations))
        .route("/{id}", get(get_file).patch(update_file).delete(soft_delete_file))
        .route("/{id}/content", put(replace_file_content))
        .route("/{id}/restore", post(restore_file))
        .route("/{id}/permanent", delete(permanent_delete_file))
        .route("/{id}/sign-private", post(sign_private_file))
        .with_state(state)
}

async fn upload_file(
    State(state): State<FilesState>,
    RequireAuth(identity): RequireAuth,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:write") {
        return Err(AppError::Forbidden("Permission files:write required".into()));
    }

    let mut original_filename = String::new();
    let mut file_bytes = Vec::new();
    let mut thumbnail_bytes: Option<Vec<u8>> = None;
    let mut client_width: Option<i64> = None;
    let mut client_height: Option<i64> = None;
    let mut client_duration: Option<f64> = None;
    let mut folder_id: Option<String> = None;
    let mut alias: Option<String> = None;
    let mut visibility = "public".to_string();
    let mut duplicate_mode = "allow".to_string(); // "allow" | "reject" | "reuse"
    let mut tags: Vec<String> = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart parse error: {}", e)))?
    {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "folder_id" | "folder" => {
                let val = field.text().await.unwrap_or_default();
                if !val.trim().is_empty() {
                    folder_id = Some(val.trim().to_string());
                }
            }
            "alias" => {
                let val = field.text().await.unwrap_or_default();
                if !val.trim().is_empty() {
                    alias = Some(val.trim().trim_start_matches('/').to_string());
                }
            }
            "visibility" => {
                let val = field.text().await.unwrap_or_default();
                if val == "private" || val == "public" {
                    visibility = val;
                }
            }
            "duplicate_mode" => {
                let val = field.text().await.unwrap_or_default();
                if !val.trim().is_empty() {
                    duplicate_mode = val.trim().to_lowercase();
                }
            }
            "tags" => {
                let val = field.text().await.unwrap_or_default();
                for t in val.split(',') {
                    let clean = t.trim().to_lowercase();
                    if !clean.is_empty() {
                        tags.push(clean);
                    }
                }
            }
            "width" => {
                let val = field.text().await.unwrap_or_default();
                if let Ok(w) = val.trim().parse::<i64>() {
                    client_width = Some(w);
                }
            }
            "height" => {
                let val = field.text().await.unwrap_or_default();
                if let Ok(h) = val.trim().parse::<i64>() {
                    client_height = Some(h);
                }
            }
            "duration" => {
                let val = field.text().await.unwrap_or_default();
                if let Ok(d) = val.trim().parse::<f64>() {
                    client_duration = Some(d);
                }
            }
            "thumbnail" => {
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("Error reading thumbnail bytes: {}", e)))?;
                if !bytes.is_empty() {
                    thumbnail_bytes = Some(bytes.to_vec());
                }
            }
            "file" => {
                original_filename = field
                    .file_name()
                    .unwrap_or("unnamed_file")
                    .to_string();
                file_bytes = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("Error reading file bytes: {}", e)))?
                    .to_vec();
            }
            _ => {}
        }
    }

    if file_bytes.is_empty() {
        return Err(AppError::BadRequest("No file uploaded or file is empty".into()));
    }

    // Compute SHA-256
    let sha256_hash = {
        let mut hasher = Sha256::new();
        hasher.update(&file_bytes);
        hex::encode(hasher.finalize())
    };

    // Duplicate detection check
    if duplicate_mode == "reject" || duplicate_mode == "reuse" {
        let existing: Option<Media> = sqlx::query_as(
            "SELECT * FROM media WHERE sha256 = ? AND deleted_at IS NULL LIMIT 1"
        )
        .bind(&sha256_hash)
        .fetch_optional(&state.pool)
        .await?;

        if let Some(existing_media) = existing {
            if duplicate_mode == "reject" {
                return Err(AppError::Conflict("File with identical SHA-256 already exists".into()));
            } else {
                let res = format_media_response(&state.pool, &existing_media, &state.config).await?;
                return Ok(Json(ApiResponse::ok(res)));
            }
        }
    }

    // Detect MIME and media type
    let (mime_type, extension, media_type) =
        MediaProcessor::detect_type(&file_bytes, &original_filename);

    // Validate size limits
    if media_type == "image" && file_bytes.len() as u64 > state.config.max_image_size {
        return Err(AppError::PayloadTooLarge(format!(
            "Maximum image upload size is {} MB",
            state.config.max_image_size / 1024 / 1024
        )));
    } else if media_type == "video" && file_bytes.len() as u64 > state.config.max_video_size {
        return Err(AppError::PayloadTooLarge(format!(
            "Maximum video upload size is {} GB",
            state.config.max_video_size / 1024 / 1024 / 1024
        )));
    }

    // Generate public ID (clean 8-character hex/nanoid) and media ID
    let media_id = format!("med_{}", uuid::Uuid::new_v4().simple());
    let public_id = hex::encode(&rand::random::<[u8; 4]>());

    let sanitized_filename = if original_filename.is_empty() {
        format!("{}.{}", public_id, extension)
    } else {
        original_filename.clone()
    };

    // Generate safe storage path and write file
    let storage_path =
        LocalStorageProvider::generate_storage_path(&media_type, &public_id, &extension);
    state.storage.write_file(&storage_path, &file_bytes).await?;

    let file_size = file_bytes.len() as i64;
    let mut width: Option<i64> = client_width;
    let mut height: Option<i64> = client_height;
    let duration: Option<f64> = client_duration;
    let video_codec: Option<String> = None;
    let audio_codec: Option<String> = None;
    let bitrate: Option<i64> = None;
    let frame_rate: Option<f64> = None;

    if media_type == "image" {
        if let Ok(meta) = MediaProcessor::extract_image_metadata(&file_bytes) {
            width = Some(meta.width as i64);
            height = Some(meta.height as i64);
        }
    }

    // Persist thumbnail directly (from client canvas or pure Rust image resize)
    let thumb_relative = format!("generated/thumbnails/{}.jpg", public_id);
    if let Some(t_bytes) = thumbnail_bytes {
        let _ = state.storage.write_file(&thumb_relative, &t_bytes).await;
    } else if media_type == "image" {
        if let Ok((resized, _)) = MediaProcessor::transform_image(
            &file_bytes,
            &crate::media::TransformParams {
                width: Some(400),
                height: Some(400),
                fit: Some("cover".to_string()),
                format: Some("jpeg".to_string()),
                quality: Some(85),
                ..Default::default()
            },
        ) {
            let _ = state.storage.write_file(&thumb_relative, &resized).await;
        }
    } else if media_type == "video" && (width.is_none() || height.is_none()) {
        // Fallback: only enqueue background job if client was unable to supply dimensions
        let payload = serde_json::to_value(VideoJobPayload {
            media_id: media_id.clone(),
            storage_path: storage_path.clone(),
            public_id: public_id.clone(),
        })
        .unwrap();
        let _ = enqueue_job(&state.pool, "video_process", &payload).await;
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Insert Media into Database
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
    .bind(&sanitized_filename)
    .bind(&original_filename)
    .bind(&extension)
    .bind(&mime_type)
    .bind(&media_type)
    .bind(&storage_path)
    .bind(file_size)
    .bind(width)
    .bind(height)
    .bind(duration)
    .bind(&video_codec)
    .bind(&audio_codec)
    .bind(bitrate)
    .bind(frame_rate)
    .bind(&sha256_hash)
    .bind(&visibility)
    .bind(&folder_id)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await?;

    // Handle Tags
    for tag_name in &tags {
        let tag_id = format!("tag_{}", uuid::Uuid::new_v4().simple());
        let _ = sqlx::query("INSERT INTO tags (id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING")
            .bind(&tag_id)
            .bind(tag_name)
            .execute(&state.pool)
            .await;

        let actual_tag_id: String = sqlx::query_scalar("SELECT id FROM tags WHERE name = ?")
            .bind(tag_name)
            .fetch_one(&state.pool)
            .await
            .unwrap_or(tag_id);

        let _ = sqlx::query("INSERT INTO media_tags (media_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
            .bind(&media_id)
            .bind(&actual_tag_id)
            .execute(&state.pool)
            .await;
    }

    // Handle Alias if provided
    if let Some(alias_path) = &alias {
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

    let media = Media {
        id: media_id,
        public_id,
        filename: sanitized_filename,
        original_filename,
        extension,
        mime_type,
        media_type,
        storage_provider: "local".to_string(),
        storage_path,
        file_size,
        width,
        height,
        duration,
        video_codec,
        audio_codec,
        bitrate,
        frame_rate,
        sha256: sha256_hash,
        visibility,
        folder_id,
        created_at: now.clone(),
        updated_at: now,
        deleted_at: None,
    };

    let response = format_media_response(&state.pool, &media, &state.config).await?;
    info!("Uploaded media {} ({}) successfully.", media.id, media.public_id);
    Ok(Json(ApiResponse::ok(response)))
}

async fn list_files(
    State(state): State<FilesState>,
    RequireAuth(identity): RequireAuth,
    Query(query): Query<ListFilesQuery>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:read") {
        return Err(AppError::Forbidden("Permission files:read required".into()));
    }

    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);

    let mut sql = "SELECT * FROM media WHERE ".to_string();
    let mut count_sql = "SELECT COUNT(*) FROM media WHERE ".to_string();

    let mut conditions = Vec::new();

    // Trash filter
    if query.trash.unwrap_or(false) {
        conditions.push("deleted_at IS NOT NULL".to_string());
    } else {
        conditions.push("deleted_at IS NULL".to_string());
    }

    // Media type filter
    if let Some(m_type) = &query.media_type {
        if m_type == "image" || m_type == "video" {
            conditions.push(format!("media_type = '{}'", m_type));
        }
    }

    // Folder filter
    if let Some(f_id) = &query.folder_id {
        if f_id == "root" || f_id == "none" {
            conditions.push("folder_id IS NULL".to_string());
        } else {
            conditions.push(format!("folder_id = '{}'", f_id.replace('\'', "''")));
        }
    }

    // Visibility filter
    if let Some(vis) = &query.visibility {
        conditions.push(format!("visibility = '{}'", vis.replace('\'', "''")));
    }

    // Search filter
    if let Some(search) = &query.search {
        let clean_search = search.trim().replace('\'', "''");
        if !clean_search.is_empty() {
            conditions.push(format!(
                "(filename LIKE '%{0}%' OR original_filename LIKE '%{0}%' OR public_id LIKE '%{0}%')",
                clean_search
            ));
        }
    }

    // Tag filter
    if let Some(tag_name) = &query.tag {
        let clean_tag = tag_name.trim().replace('\'', "''");
        if !clean_tag.is_empty() {
            conditions.push(format!(
                "id IN (SELECT media_id FROM media_tags JOIN tags ON media_tags.tag_id = tags.id WHERE tags.name = '{}')",
                clean_tag
            ));
        }
    }

    let where_clause = conditions.join(" AND ");
    sql.push_str(&where_clause);
    count_sql.push_str(&where_clause);

    // Sorting
    let order_by = match query.sort.as_deref() {
        Some("oldest") => "ORDER BY created_at ASC",
        Some("largest") => "ORDER BY file_size DESC",
        Some("smallest") => "ORDER BY file_size ASC",
        Some("filename") => "ORDER BY filename ASC",
        _ => "ORDER BY created_at DESC", // default "newest"
    };

    sql.push_str(&format!(" {} LIMIT {} OFFSET {}", order_by, limit, offset));

    let total: i64 = sqlx::query_scalar(&count_sql)
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);

    let media_rows: Vec<Media> = sqlx::query_as(&sql).fetch_all(&state.pool).await?;

    let mut items = Vec::new();
    for m in &media_rows {
        items.push(format_media_response(&state.pool, m, &state.config).await?);
    }

    let has_more = offset + (items.len() as i64) < total;

    Ok(Json(ApiResponse::ok(PaginatedResponse {
        items,
        total,
        limit,
        offset,
        has_more,
    })))
}

async fn get_file(
    State(state): State<FilesState>,
    RequireAuth(identity): RequireAuth,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:read") {
        return Err(AppError::Forbidden("Permission files:read required".into()));
    }

    let media: Media = sqlx::query_as(
        "SELECT * FROM media WHERE id = ? OR public_id = ?"
    )
    .bind(&id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Media with id {} not found", id)))?;

    let response = format_media_response(&state.pool, &media, &state.config).await?;
    Ok(Json(ApiResponse::ok(response)))
}

/// In-place file replacement: Updates file content while preserving ID, public_id, and aliases!
async fn replace_file_content(
    State(state): State<FilesState>,
    RequireAuth(identity): RequireAuth,
    Path(id): Path<String>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:write") {
        return Err(AppError::Forbidden("Permission files:write required".into()));
    }

    let media: Media = sqlx::query_as("SELECT * FROM media WHERE id = ? OR public_id = ?")
        .bind(&id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Media with id {} not found", id)))?;

    let mut new_bytes = Vec::new();
    let mut new_filename = media.filename.clone();
    let mut new_thumbnail_bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {}", e)))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" {
            if let Some(fname) = field.file_name() {
                new_filename = fname.to_string();
            }
            new_bytes = field
                .bytes()
                .await
                .map_err(|e| AppError::BadRequest(format!("Read bytes error: {}", e)))?
                .to_vec();
        } else if name == "thumbnail" {
            let bytes = field
                .bytes()
                .await
                .map_err(|e| AppError::BadRequest(format!("Read thumbnail bytes error: {}", e)))?;
            if !bytes.is_empty() {
                new_thumbnail_bytes = Some(bytes.to_vec());
            }
        }
    }

    if new_bytes.is_empty() {
        return Err(AppError::BadRequest("No replacement file provided".into()));
    }

    let (new_mime, new_ext, new_type) = MediaProcessor::detect_type(&new_bytes, &new_filename);

    let new_sha256 = {
        let mut hasher = Sha256::new();
        hasher.update(&new_bytes);
        hex::encode(hasher.finalize())
    };

    // Overwrite physical file at storage_path
    state.storage.write_file(&media.storage_path, &new_bytes).await?;

    let mut width = media.width;
    let mut height = media.height;

    if new_type == "image" {
        if let Ok(meta) = MediaProcessor::extract_image_metadata(&new_bytes) {
            width = Some(meta.width as i64);
            height = Some(meta.height as i64);
        }
    }

    // Update thumbnail
    let thumb_relative = format!("generated/thumbnails/{}.jpg", media.public_id);
    if let Some(t_bytes) = new_thumbnail_bytes {
        let _ = state.storage.write_file(&thumb_relative, &t_bytes).await;
    } else if new_type == "image" {
        if let Ok((resized, _)) = MediaProcessor::transform_image(
            &new_bytes,
            &crate::media::TransformParams {
                width: Some(400),
                height: Some(400),
                fit: Some("cover".to_string()),
                format: Some("jpeg".to_string()),
                quality: Some(85),
                ..Default::default()
            },
        ) {
            let _ = state.storage.write_file(&thumb_relative, &resized).await;
        }
    }

    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "UPDATE media SET file_size = ?, mime_type = ?, extension = ?, sha256 = ?, width = ?, height = ?, updated_at = ? WHERE id = ?"
    )
    .bind(new_bytes.len() as i64)
    .bind(&new_mime)
    .bind(&new_ext)
    .bind(&new_sha256)
    .bind(width)
    .bind(height)
    .bind(&now)
    .bind(&media.id)
    .execute(&state.pool)
    .await?;

    let updated_media: Media = sqlx::query_as("SELECT * FROM media WHERE id = ?")
        .bind(&media.id)
        .fetch_one(&state.pool)
        .await?;

    let response = format_media_response(&state.pool, &updated_media, &state.config).await?;
    info!("Replaced content for media {} successfully.", media.id);
    Ok(Json(ApiResponse::ok(response)))
}

async fn update_file(
    State(state): State<FilesState>,
    RequireAuth(identity): RequireAuth,
    Path(id): Path<String>,
    Json(req): Json<UpdateMediaRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:write") {
        return Err(AppError::Forbidden("Permission files:write required".into()));
    }

    let media: Media = sqlx::query_as("SELECT * FROM media WHERE id = ? OR public_id = ?")
        .bind(&id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Media with id {} not found", id)))?;

    let now = chrono::Utc::now().to_rfc3339();

    if let Some(fname) = req.filename {
        sqlx::query("UPDATE media SET filename = ?, updated_at = ? WHERE id = ?")
            .bind(&fname)
            .bind(&now)
            .bind(&media.id)
            .execute(&state.pool)
            .await?;
    }

    if let Some(folder_id) = req.folder_id {
        let f_id = if folder_id.trim().is_empty() || folder_id == "root" {
            None
        } else {
            Some(folder_id)
        };
        sqlx::query("UPDATE media SET folder_id = ?, updated_at = ? WHERE id = ?")
            .bind(&f_id)
            .bind(&now)
            .bind(&media.id)
            .execute(&state.pool)
            .await?;
    }

    if let Some(vis) = req.visibility {
        if vis == "public" || vis == "private" {
            sqlx::query("UPDATE media SET visibility = ?, updated_at = ? WHERE id = ?")
                .bind(&vis)
                .bind(&now)
                .bind(&media.id)
                .execute(&state.pool)
                .await?;
        }
    }

    if let Some(tags) = req.tags {
        // Remove existing tags
        sqlx::query("DELETE FROM media_tags WHERE media_id = ?")
            .bind(&media.id)
            .execute(&state.pool)
            .await?;

        // Add new tags
        for t in tags {
            let clean = t.trim().to_lowercase();
            if clean.is_empty() {
                continue;
            }
            let tag_id = format!("tag_{}", uuid::Uuid::new_v4().simple());
            let _ = sqlx::query("INSERT INTO tags (id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING")
                .bind(&tag_id)
                .bind(&clean)
                .execute(&state.pool)
                .await;

            let actual_id: String = sqlx::query_scalar("SELECT id FROM tags WHERE name = ?")
                .bind(&clean)
                .fetch_one(&state.pool)
                .await
                .unwrap_or(tag_id);

            let _ = sqlx::query("INSERT INTO media_tags (media_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
                .bind(&media.id)
                .bind(&actual_id)
                .execute(&state.pool)
                .await;
        }
    }

    let updated: Media = sqlx::query_as("SELECT * FROM media WHERE id = ?")
        .bind(&media.id)
        .fetch_one(&state.pool)
        .await?;

    let res = format_media_response(&state.pool, &updated, &state.config).await?;
    Ok(Json(ApiResponse::ok(res)))
}

async fn purge_media_artifacts(
    state: &FilesState,
    media: &Media,
    cleanup_empty_folder: bool,
) -> Result<(), AppError> {
    // 1. Delete physical original file from disk
    let _ = state.storage.delete_file(&media.storage_path).await;

    // 2. Prune empty parent directories on disk (e.g. originals/images/YYYY/MM/prefix)
    let _ = state.storage.prune_empty_parent_dirs(&media.storage_path).await;

    // 3. Delete thumbnails (jpg, webp, and directory if any)
    let thumb_jpg = format!("generated/thumbnails/{}.jpg", media.public_id);
    let thumb_webp = format!("generated/thumbnails/{}.webp", media.public_id);
    let _ = state.storage.delete_file(&thumb_jpg).await;
    let _ = state.storage.delete_file(&thumb_webp).await;
    let _ = state.storage.delete_dir(&format!("generated/thumbnails/{}", media.public_id)).await;

    // 4. Delete transformed cached images and folder for this public_id
    let _ = state.storage.delete_dir(&format!("generated/transformed/{}", media.public_id)).await;

    // 5. Clean up associated folder in DB if requested and this was the last media item
    if cleanup_empty_folder {
        if let Some(ref folder_id) = media.folder_id {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM media WHERE folder_id = ? AND id != ?"
            )
            .bind(folder_id)
            .bind(&media.id)
            .fetch_one(&state.pool)
            .await
            .unwrap_or(1);

            if count == 0 {
                info!("Auto-cleaning empty folder {} after media deletion", folder_id);
                let _ = sqlx::query("DELETE FROM folders WHERE id = ?")
                    .bind(folder_id)
                    .execute(&state.pool)
                    .await;
            }
        }
    }

    // 6. Delete database record (cascades to media_tags, aliases)
    sqlx::query("DELETE FROM media WHERE id = ?")
        .bind(&media.id)
        .execute(&state.pool)
        .await?;

    // 7. Clean up orphan tags that have no media remaining
    let _ = sqlx::query("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM media_tags)")
        .execute(&state.pool)
        .await;

    Ok(())
}

async fn soft_delete_file(
    State(state): State<FilesState>,
    RequireAuth(identity): RequireAuth,
    Path(id): Path<String>,
    Query(query): Query<DeleteFileQuery>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:delete") {
        return Err(AppError::Forbidden("Permission files:delete required".into()));
    }

    if query.permanent.unwrap_or(false) {
        let media: Option<Media> = sqlx::query_as("SELECT * FROM media WHERE id = ? OR public_id = ?")
            .bind(&id)
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;

        let Some(media) = media else {
            return Err(AppError::NotFound("Media not found".into()));
        };

        purge_media_artifacts(&state, &media, query.cleanup_empty_folder.unwrap_or(true)).await?;
        info!("Media {} permanently purged with all related artifacts.", media.id);
        return Ok(Json(ApiResponse::ok("Media and all related artifacts permanently deleted")));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let res = sqlx::query(
        "UPDATE media SET deleted_at = ? WHERE (id = ? OR public_id = ?) AND deleted_at IS NULL"
    )
    .bind(&now)
    .bind(&id)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Media not found or already in trash".into()));
    }

    if query.cleanup_empty_folder.unwrap_or(false) {
        let media: Option<Media> = sqlx::query_as("SELECT * FROM media WHERE id = ? OR public_id = ?")
            .bind(&id)
            .bind(&id)
            .fetch_optional(&state.pool)
            .await?;
        if let Some(m) = media {
            if let Some(ref folder_id) = m.folder_id {
                let remaining: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM media WHERE folder_id = ? AND deleted_at IS NULL"
                )
                .bind(folder_id)
                .fetch_one(&state.pool)
                .await
                .unwrap_or(1);
                if remaining == 0 {
                    let _ = sqlx::query("DELETE FROM folders WHERE id = ?").bind(folder_id).execute(&state.pool).await;
                }
            }
        }
    }

    info!("Media {} moved to trash.", id);
    Ok(Json(ApiResponse::ok("Media moved to trash")))
}

async fn restore_file(
    State(state): State<FilesState>,
    RequireAuth(identity): RequireAuth,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:write") {
        return Err(AppError::Forbidden("Permission files:write required".into()));
    }

    let res = sqlx::query(
        "UPDATE media SET deleted_at = NULL WHERE (id = ? OR public_id = ?) AND deleted_at IS NOT NULL"
    )
    .bind(&id)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Media not found in trash".into()));
    }

    info!("Media {} restored from trash.", id);
    Ok(Json(ApiResponse::ok("Media restored from trash")))
}

async fn permanent_delete_file(
    State(state): State<FilesState>,
    RequireAuth(identity): RequireAuth,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:delete") {
        return Err(AppError::Forbidden("Permission files:delete required".into()));
    }

    let media: Option<Media> = sqlx::query_as("SELECT * FROM media WHERE id = ? OR public_id = ?")
        .bind(&id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?;

    let Some(media) = media else {
        return Err(AppError::NotFound("Media not found".into()));
    };

    purge_media_artifacts(&state, &media, true).await?;

    info!("Media {} and all related artifacts permanently deleted.", media.id);
    Ok(Json(ApiResponse::ok("Media and all related artifacts permanently deleted")))
}

async fn bulk_operations(
    State(state): State<FilesState>,
    RequireAuth(identity): RequireAuth,
    Json(req): Json<BulkOperationRequest>,
) -> Result<impl IntoResponse, AppError> {
    if req.ids.is_empty() {
        return Ok(Json(ApiResponse::ok("No items selected")));
    }

    let now = chrono::Utc::now().to_rfc3339();

    match req.action.as_str() {
        "delete" => {
            if !identity.has_permission("files:delete") {
                return Err(AppError::Forbidden("Permission files:delete required".into()));
            }
            for id in &req.ids {
                let _ = sqlx::query("UPDATE media SET deleted_at = ? WHERE id = ? OR public_id = ?")
                    .bind(&now)
                    .bind(id)
                    .bind(id)
                    .execute(&state.pool)
                    .await;
            }
        }
        "restore" => {
            if !identity.has_permission("files:write") {
                return Err(AppError::Forbidden("Permission files:write required".into()));
            }
            for id in &req.ids {
                let _ = sqlx::query("UPDATE media SET deleted_at = NULL WHERE id = ? OR public_id = ?")
                    .bind(id)
                    .bind(id)
                    .execute(&state.pool)
                    .await;
            }
        }
        "permanent_delete" => {
            if !identity.has_permission("files:delete") {
                return Err(AppError::Forbidden("Permission files:delete required".into()));
            }
            for id in &req.ids {
                let media: Option<Media> = sqlx::query_as("SELECT * FROM media WHERE id = ? OR public_id = ?")
                    .bind(id)
                    .bind(id)
                    .fetch_optional(&state.pool)
                    .await?;
                if let Some(m) = media {
                    let _ = purge_media_artifacts(&state, &m, true).await;
                }
            }
        }
        "move" => {
            if !identity.has_permission("files:write") {
                return Err(AppError::Forbidden("Permission files:write required".into()));
            }
            let f_id = req.target_folder_id.filter(|f| f != "root" && !f.is_empty());
            for id in &req.ids {
                let _ = sqlx::query("UPDATE media SET folder_id = ?, updated_at = ? WHERE id = ? OR public_id = ?")
                    .bind(&f_id)
                    .bind(&now)
                    .bind(id)
                    .bind(id)
                    .execute(&state.pool)
                    .await;
            }
        }
        "visibility" => {
            if !identity.has_permission("files:write") {
                return Err(AppError::Forbidden("Permission files:write required".into()));
            }
            if let Some(vis) = req.target_visibility {
                for id in &req.ids {
                    let _ = sqlx::query("UPDATE media SET visibility = ?, updated_at = ? WHERE id = ? OR public_id = ?")
                        .bind(&vis)
                        .bind(&now)
                        .bind(id)
                        .bind(id)
                        .execute(&state.pool)
                        .await;
                }
            }
        }
        _ => return Err(AppError::BadRequest(format!("Unknown bulk action: {}", req.action))),
    }

    Ok(Json(ApiResponse::ok("Bulk operation completed successfully")))
}

async fn sign_private_file(
    State(state): State<FilesState>,
    RequireAuth(identity): RequireAuth,
    Path(id): Path<String>,
    Json(req): Json<SignPrivateRequest>,
) -> Result<impl IntoResponse, AppError> {
    if !identity.has_permission("files:read") {
        return Err(AppError::Forbidden("Permission files:read required".into()));
    }

    let media: Media = sqlx::query_as("SELECT * FROM media WHERE id = ? OR public_id = ?")
        .bind(&id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Media with id {} not found", id)))?;

    let duration_secs = req.expires_seconds.unwrap_or(3600).clamp(10, 30 * 24 * 3600);
    let expires = chrono::Utc::now().timestamp() + duration_secs;

    let signature = sign_private_url(&state.config.private_url_signing_key, &media.public_id, expires);
    let signed_url = format!(
        "{}/private/{}?expires={}&signature={}",
        state.config.public_base_url, media.public_id, expires, signature
    );

    Ok(Json(ApiResponse::ok(serde_json::json!({
        "url": signed_url,
        "expires_at": chrono::DateTime::from_timestamp(expires, 0).map(|dt| dt.to_rfc3339()),
        "expires_seconds": duration_secs
    }))))
}

pub async fn format_media_response(
    pool: &DbPool,
    m: &Media,
    config: &AppConfig,
) -> Result<MediaResponse, AppError> {
    let url = if m.visibility == "private" {
        format!("{}/private/{}", config.public_base_url, m.public_id)
    } else {
        format!("{}/f/{}/{}", config.public_base_url, m.public_id, m.filename)
    };

    let thumbnail_url = if m.media_type == "video" {
        Some(format!("{}/thumbnails/{}.jpg", config.public_base_url, m.public_id))
    } else {
        Some(format!("{}/f/{}/{}", config.public_base_url, m.public_id, m.filename))
    };

    let tags: Vec<String> = sqlx::query_scalar(
        "SELECT tags.name FROM tags JOIN media_tags ON tags.id = media_tags.tag_id WHERE media_tags.media_id = ?"
    )
    .bind(&m.id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let aliases: Vec<String> = sqlx::query_scalar(
        "SELECT alias_path FROM aliases WHERE media_id = ?"
    )
    .bind(&m.id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let folder_name: Option<String> = if let Some(f_id) = &m.folder_id {
        sqlx::query_scalar("SELECT name FROM folders WHERE id = ?")
            .bind(f_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None)
    } else {
        None
    };

    Ok(MediaResponse {
        id: m.id.clone(),
        public_id: m.public_id.clone(),
        filename: m.filename.clone(),
        original_filename: m.original_filename.clone(),
        extension: m.extension.clone(),
        mime_type: m.mime_type.clone(),
        media_type: m.media_type.clone(),
        file_size: m.file_size,
        width: m.width,
        height: m.height,
        duration: m.duration,
        video_codec: m.video_codec.clone(),
        audio_codec: m.audio_codec.clone(),
        bitrate: m.bitrate,
        frame_rate: m.frame_rate,
        sha256: m.sha256.clone(),
        visibility: m.visibility.clone(),
        folder_id: m.folder_id.clone(),
        folder_name,
        url,
        thumbnail_url,
        tags,
        aliases,
        created_at: m.created_at.clone(),
        updated_at: m.updated_at.clone(),
        deleted_at: m.deleted_at.clone(),
    })
}
