use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::{
    auth::{create_session_token, verify_password, AuthIdentity, RequireAuth},
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    models::{ApiResponse, User},
};

#[derive(Clone)]
pub struct AuthState {
    pub pool: DbPool,
    pub config: Arc<AppConfig>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub user: UserPublic,
    pub token: String,
}

#[derive(Debug, Serialize)]
pub struct UserPublic {
    pub id: String,
    pub email: String,
    pub created_at: String,
}

pub fn router(pool: DbPool, config: Arc<AppConfig>) -> Router {
    let state = AuthState { pool, config };
    Router::new()
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/me", get(me))
        .with_state(state)
}

async fn login(
    State(state): State<AuthState>,
    Json(req): Json<LoginRequest>,
) -> Result<impl IntoResponse, AppError> {
    let clean_email = req.email.trim().to_lowercase();
    let clean_password = req.password.trim();

    let user: Option<User> = sqlx::query_as("SELECT * FROM users WHERE LOWER(TRIM(email)) = ?")
        .bind(&clean_email)
        .fetch_optional(&state.pool)
        .await?;

    let Some(user) = user else {
        tracing::warn!("Failed login attempt: no user found for email '{}'", clean_email);
        return Err(AppError::Unauthorized("Invalid email or password".into()));
    };

    let valid = verify_password(clean_password, &user.password_hash)?;
    if !valid {
        tracing::warn!("Failed login attempt: incorrect password for email '{}'", clean_email);
        return Err(AppError::Unauthorized("Invalid email or password".into()));
    }

    let token = create_session_token(&user.id, &state.config.cookie_secret);

    let is_secure = state.config.public_base_url.starts_with("https") || state.config.app_env == "production";
    let cookie = if is_secure {
        format!(
            "ownmediahost_session={}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age={}",
            token,
            7 * 24 * 60 * 60
        )
    } else {
        format!(
            "ownmediahost_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
            token,
            7 * 24 * 60 * 60
        )
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie).map_err(|e| AppError::Internal(e.to_string()))?,
    );

    let res = ApiResponse::ok(LoginResponse {
        user: UserPublic {
            id: user.id,
            email: user.email,
            created_at: user.created_at,
        },
        token,
    });

    Ok((headers, Json(res)))
}

async fn logout() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_static("ownmediahost_session=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0"),
    );
    headers.append(
        header::SET_COOKIE,
        HeaderValue::from_static("ownmediahost_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"),
    );
    headers.append(
        header::SET_COOKIE,
        HeaderValue::from_static("selfmedia_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"),
    );

    (headers, Json(ApiResponse::ok("Logged out successfully")))
}

async fn me(RequireAuth(identity): RequireAuth) -> Result<impl IntoResponse, AppError> {
    match identity {
        AuthIdentity::Admin(user) => Ok(Json(ApiResponse::ok(serde_json::json!({
            "type": "admin",
            "user": {
                "id": user.id,
                "email": user.email,
                "created_at": user.created_at
            }
        })))),
        AuthIdentity::ApiKey { api_key, scopes } => Ok(Json(ApiResponse::ok(serde_json::json!({
            "type": "api_key",
            "key": {
                "id": api_key.id,
                "name": api_key.name,
                "key_prefix": api_key.key_prefix,
                "scopes": scopes
            }
        })))),
    }
}
