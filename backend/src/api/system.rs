use axum::{
    extract::State,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};

use crate::{
    auth::RequireAdmin,
    config::AppConfig,
    errors::AppError,
    models::ApiResponse,
};

#[derive(Clone)]
pub struct SystemState {
    pub config: Arc<AppConfig>,
}

#[derive(Serialize)]
pub struct UpdateStatusResponse {
    pub running: bool,
    pub success: bool,
    pub log: String,
}

pub fn router(config: Arc<AppConfig>) -> Router {
    let state = SystemState { config };
    Router::new()
        .route("/trigger-update", post(trigger_update))
        .route("/update-status", get(get_update_status))
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

async fn trigger_update(
    State(state): State<SystemState>,
    RequireAdmin(_admin): RequireAdmin,
) -> Result<impl IntoResponse, AppError> {
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
