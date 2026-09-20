use axum::{
    extract::{Query, State},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::{
    auth::RequireAdmin,
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    models::ApiResponse,
};

#[derive(Clone)]
pub struct SystemState {
    pub pool: DbPool,
    pub config: Arc<AppConfig>,
    pub update_cache: Arc<RwLock<Option<(Instant, UpdateCheckResponse)>>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct UpdateCheckResponse {
    pub has_update: bool,
    pub release_ready: bool,
    pub is_building: bool,
    pub current_commit: String,
    pub current_short_commit: String,
    pub latest_commit: String,
    pub latest_short_commit: String,
    pub release_commit: String,
    pub release_short_commit: String,
    pub commit_message: String,
    pub author: String,
    pub published_at: String,
    pub release_url: String,
    pub release_tag: String,
    pub checked_at: String,
}

#[derive(Serialize)]
pub struct UpdateStatusResponse {
    pub running: bool,
    pub success: bool,
    pub log: String,
}

#[derive(Deserialize)]
pub struct CheckQuery {
    pub force: Option<bool>,
}

pub fn router(pool: DbPool, config: Arc<AppConfig>) -> Router {
    let state = SystemState {
        pool,
        config,
        update_cache: Arc::new(RwLock::new(None)),
    };
    Router::new()
        .route("/trigger-update", post(trigger_update))
        .route("/update-status", get(get_update_status))
        .route("/update-check", get(check_for_updates))
        .route("/version", get(get_version_info))
        .with_state(state)
}

fn get_trigger_path(config: &AppConfig) -> PathBuf {
    let prod_path = PathBuf::from("/var/lib/ownmediahost/storage/update.trigger");
    if prod_path.parent().map(|p| p.exists()).unwrap_or(false) {
        prod_path
    } else {
        config.media_root.join("update.trigger")
    }
}

fn get_log_path(config: &AppConfig) -> PathBuf {
    let prod_path = PathBuf::from("/var/lib/ownmediahost/storage/update.log");
    if prod_path.parent().map(|p| p.exists()).unwrap_or(false) {
        prod_path
    } else {
        config.media_root.join("update.log")
    }
}

async fn get_installed_commit(state: &SystemState) -> String {
    // 1. Check SQLite settings
    if let Ok(Some(commit)) = sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key='installed_commit'"
    )
    .fetch_optional(&state.pool)
    .await
    {
        if !commit.trim().is_empty() {
            return commit.trim().to_string();
        }
    }

    // 2. Check /etc/ownmediahost/version.json
    for path in ["/etc/ownmediahost/version.json", "/var/lib/ownmediahost/storage/version.json"] {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(c) = json.get("commit").and_then(|v| v.as_str()) {
                    if !c.trim().is_empty() {
                        return c.trim().to_string();
                    }
                }
            }
        }
    }

    // 3. Check environment variable
    if let Ok(c) = std::env::var("COMMIT_HASH") {
        if !c.trim().is_empty() {
            return c.trim().to_string();
        }
    }

    // 4. Default to repository latest known commit
    "cb3f833d21a250846382273d06a6b0cab4bde0aa".to_string()
}

async fn get_version_info(
    State(state): State<SystemState>,
) -> Result<impl IntoResponse, AppError> {
    let current_commit = get_installed_commit(&state).await;
    let short_commit = if current_commit.len() >= 7 {
        current_commit[..7].to_string()
    } else {
        current_commit.clone()
    };

    Ok(Json(ApiResponse::ok(serde_json::json!({
        "app_name": "OwnMediaHost",
        "version": env!("CARGO_PKG_VERSION"),
        "commit": current_commit,
        "short_commit": short_commit,
    }))))
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: Option<String>,
    html_url: Option<String>,
    published_at: Option<String>,
    body: Option<String>,
}

#[derive(Deserialize)]
struct GitHubCommitWrapper {
    sha: String,
    commit: GitHubCommitDetail,
    author: Option<GitHubAuthor>,
}

#[derive(Deserialize)]
struct GitHubCommitDetail {
    message: String,
}

#[derive(Deserialize)]
struct GitHubAuthor {
    login: Option<String>,
}

async fn check_for_updates(
    State(state): State<SystemState>,
    Query(query): Query<CheckQuery>,
    RequireAdmin(_admin): RequireAdmin,
) -> Result<impl IntoResponse, AppError> {
    let force = query.force.unwrap_or(false);

    // 1. Check in-memory cache (60s TTL)
    if !force {
        let cache = state.update_cache.read().await;
        if let Some((cached_at, ref res)) = *cache {
            if cached_at.elapsed() < Duration::from_secs(60) {
                return Ok(Json(ApiResponse::ok(res.clone())));
            }
        }
    }

    let current_commit = get_installed_commit(&state).await;
    let current_short_commit = if current_commit.len() >= 7 {
        current_commit[..7].to_string()
    } else {
        current_commit.clone()
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build HTTP client: {}", e)))?;

    // 2. Fetch latest commit on main
    let commit_req = client
        .get("https://api.github.com/repos/nourddinak/OwnMediaHost/commits/main")
        .header("User-Agent", "OwnMediaHost-Updater/0.1.0")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await;

    // 3. Fetch latest published release
    let release_req = client
        .get("https://api.github.com/repos/nourddinak/OwnMediaHost/releases/latest")
        .header("User-Agent", "OwnMediaHost-Updater/0.1.0")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await;

    let mut latest_commit = current_commit.clone();
    let mut commit_message = "No remote commit information".to_string();
    let mut author = "nourddinak".to_string();

    if let Ok(resp) = commit_req {
        if resp.status().is_success() {
            if let Ok(commit_data) = resp.json::<GitHubCommitWrapper>().await {
                latest_commit = commit_data.sha;
                commit_message = commit_data.commit.message.lines().next().unwrap_or("").to_string();
                if let Some(auth) = commit_data.author {
                    if let Some(l) = auth.login {
                        author = l;
                    }
                }
            }
        }
    }

    let mut release_commit = String::new();
    let mut release_url = "https://github.com/nourddinak/OwnMediaHost/releases/tag/latest".to_string();
    let mut release_tag = "latest".to_string();
    let mut published_at = chrono::Utc::now().to_rfc3339();

    if let Ok(resp) = release_req {
        if resp.status().is_success() {
            if let Ok(rel_data) = resp.json::<GitHubRelease>().await {
                if let Some(tag) = rel_data.tag_name {
                    release_tag = tag;
                }
                if let Some(url) = rel_data.html_url {
                    release_url = url;
                }
                if let Some(pub_at) = rel_data.published_at {
                    published_at = pub_at;
                }
                if let Some(body) = rel_data.body {
                    // Extract commit hash from release body: "- **Commit**: `([a-f0-9]+)`"
                    for line in body.lines() {
                        if line.contains("**Commit**") || line.contains("Commit:") {
                            if let Some(idx) = line.find('`') {
                                let rest = &line[idx + 1..];
                                if let Some(end_idx) = rest.find('`') {
                                    release_commit = rest[..end_idx].trim().to_string();
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let latest_short_commit = if latest_commit.len() >= 7 {
        latest_commit[..7].to_string()
    } else {
        latest_commit.clone()
    };

    let release_short_commit = if release_commit.len() >= 7 {
        release_commit[..7].to_string()
    } else {
        release_commit.clone()
    };

    // A release is ready if the latest published release matches the latest commit on main
    let release_ready = !release_commit.is_empty() && (
        release_commit == latest_commit ||
        latest_commit.starts_with(&release_commit) ||
        release_commit.starts_with(&latest_commit)
    );

    // Has a new commit on main branch that is not installed on this instance
    let new_commit_on_main = !current_commit.is_empty() &&
        !latest_commit.is_empty() &&
        current_commit != latest_commit &&
        !current_commit.starts_with(&latest_short_commit) &&
        !latest_commit.starts_with(&current_short_commit);

    // Is CI/CD currently compiling and packaging?
    // If a new commit is on main, but the release doesn't have it yet, CI is actively building.
    let is_building = new_commit_on_main && !release_ready;

    // The user can ONLY update when the new release build has 100% finished,
    // published release assets, and release_ready is verified!
    let has_update = release_ready &&
        new_commit_on_main &&
        !release_commit.is_empty() &&
        current_commit != release_commit &&
        !current_commit.starts_with(&release_short_commit) &&
        !release_commit.starts_with(&current_short_commit);

    let checked_at = chrono::Utc::now().to_rfc3339();

    let response = UpdateCheckResponse {
        has_update,
        release_ready,
        is_building,
        current_commit,
        current_short_commit,
        latest_commit,
        latest_short_commit,
        release_commit,
        release_short_commit,
        commit_message,
        author,
        published_at,
        release_url,
        release_tag,
        checked_at,
    };

    // Save to cache
    {
        let mut cache = state.update_cache.write().await;
        *cache = Some((Instant::now(), response.clone()));
    }

    Ok(Json(ApiResponse::ok(response)))
}

async fn trigger_update(
    State(state): State<SystemState>,
    RequireAdmin(_admin): RequireAdmin,
) -> Result<impl IntoResponse, AppError> {
    // Safety check: Prevent updating while release is still compiling in CI/CD
    {
        let cache = state.update_cache.read().await;
        if let Some((_, ref info)) = *cache {
            if info.is_building || (!info.release_ready && info.latest_commit != info.current_commit) {
                return Err(AppError::BadRequest(
                    "Cannot trigger update: GitHub Actions release build is still in progress. Please wait for the build to finish.".into()
                ));
            }
        }
    }

    let log_path = get_log_path(&state.config);
    let trigger_path = get_trigger_path(&state.config);

    if trigger_path.exists() {
        return Err(AppError::Conflict("An update is already queued or in progress".into()));
    }

    let lock_path = std::path::Path::new("/tmp/ownmediahost-update.lock");
    if lock_path.exists() {
        if let Ok(pid_str) = std::fs::read_to_string(lock_path) {
            if let Ok(pid) = pid_str.trim().parse::<u32>() {
                let s = sysinfo::System::new_with_specifics(
                    sysinfo::RefreshKind::nothing().with_processes(sysinfo::ProcessRefreshKind::everything())
                );
                if s.process(sysinfo::Pid::from_u32(pid)).is_some() {
                    return Err(AppError::Conflict("An update process is already actively running on the host".into()));
                }
            }
        }
    }

    if let Some(parent) = trigger_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let timestamp = chrono::Utc::now().to_rfc3339();
    let initial_log = format!("[{}] Background server update and routing sync initiated via Web UI.\n", timestamp);
    if let Err(e) = std::fs::write(&log_path, initial_log) {
        warn!("Failed to initialize update log at {}: {}", log_path.display(), e);
    }

    if let Err(e) = std::fs::write(&trigger_path, &timestamp) {
        warn!("Failed to write trigger file at {}: {}", trigger_path.display(), e);
        return Err(AppError::Internal(format!("Failed to signal system update: {}", e)));
    }

    info!("System update triggered via {}. Log: {}", trigger_path.display(), log_path.display());
    Ok(Json(ApiResponse::ok("Server update initiated successfully")))
}

async fn get_update_status(
    State(state): State<SystemState>,
    RequireAdmin(_admin): RequireAdmin,
) -> Result<impl IntoResponse, AppError> {
    let log_path = get_log_path(&state.config);
    let trigger_path = get_trigger_path(&state.config);

    let log_content = std::fs::read_to_string(&log_path).unwrap_or_else(|_| "No update log found.\n".to_string());

    let lines: Vec<&str> = log_content.lines().collect();
    let trimmed_log = if lines.len() > 80 {
        lines[lines.len() - 80..].join("\n")
    } else {
        log_content.clone()
    };

    let trigger_exists = trigger_path.exists();
    let success = log_content.contains("successfully updated and running")
        || log_content.contains("OwnMediaHost successfully updated");

    let running = trigger_exists || (!success && !log_content.contains("failed") && lines.len() > 1);

    Ok(Json(ApiResponse::ok(UpdateStatusResponse {
        running,
        success,
        log: trimmed_log,
    })))
}
