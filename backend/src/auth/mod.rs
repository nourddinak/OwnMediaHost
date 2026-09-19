use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts},
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::sync::Arc;

use crate::{
    config::AppConfig,
    database::DbPool,
    errors::AppError,
    models::{ApiKey, User},
};

type HmacSha256 = Hmac<Sha256>;

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Password hashing failed: {}", e)))?
        .to_string();
    Ok(hash)
}

pub fn verify_password(password: &str, password_hash: &str) -> Result<bool, AppError> {
    let parsed_hash = PasswordHash::new(password_hash)
        .map_err(|e| AppError::Internal(format!("Invalid stored password hash: {}", e)))?;
    let argon2 = Argon2::default();
    Ok(argon2.verify_password(password.as_bytes(), &parsed_hash).is_ok())
}

/// Generates a new API key with `mk_live_` prefix and returns (public_prefix, secret_full_key, key_hash)
pub fn generate_api_key(pepper: &str) -> (String, String, String) {
    let raw_secret: String = (0..32)
        .map(|_| {
            let idx = rand::random::<u8>() % 62;
            match idx {
                0..=25 => (b'a' + idx) as char,
                26..=51 => (b'A' + (idx - 26)) as char,
                _ => (b'0' + (idx - 52)) as char,
            }
        })
        .collect();

    let prefix = format!("mk_live_{}", &raw_secret[..8]);
    let full_key = format!("mk_live_{}", raw_secret);
    let hash = hash_api_key(&full_key, pepper);

    (prefix, full_key, hash)
}

pub fn hash_api_key(full_key: &str, pepper: &str) -> String {
    use sha2::Digest;
    let mut hasher = Sha256::new();
    hasher.update(full_key.as_bytes());
    hasher.update(pepper.as_bytes());
    hex::encode(hasher.finalize())
}

/// Creates a signed session token for admin users
pub fn create_session_token(user_id: &str, cookie_secret: &str) -> String {
    let expires = (chrono::Utc::now() + chrono::Duration::days(7)).timestamp();
    let payload = format!("{}:{}", user_id, expires);

    let mut mac = HmacSha256::new_from_slice(cookie_secret.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(payload.as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());

    format!("{}:{}:{}", user_id, expires, sig)
}

pub fn verify_session_token(token: &str, cookie_secret: &str) -> Option<String> {
    let parts: Vec<&str> = token.split(':').collect();
    if parts.len() != 3 {
        return None;
    }

    let user_id = parts[0];
    let expires: i64 = parts[1].parse().ok()?;
    let signature = parts[2];

    if expires < chrono::Utc::now().timestamp() {
        return None;
    }

    let payload = format!("{}:{}", user_id, expires);
    let mut mac = HmacSha256::new_from_slice(cookie_secret.as_bytes()).ok()?;
    mac.update(payload.as_bytes());

    let expected_sig = hex::encode(mac.finalize().into_bytes());
    if expected_sig == signature {
        Some(user_id.to_string())
    } else {
        None
    }
}

// Axum Authentication Context
#[derive(Clone, Debug)]
pub enum AuthIdentity {
    Admin(User),
    ApiKey {
        api_key: ApiKey,
        scopes: Vec<String>,
    },
}

impl AuthIdentity {
    pub fn is_admin(&self) -> bool {
        match self {
            AuthIdentity::Admin(_) => true,
            AuthIdentity::ApiKey { scopes, .. } => scopes.iter().any(|s| s == "admin"),
        }
    }

    pub fn has_permission(&self, permission: &str) -> bool {
        match self {
            AuthIdentity::Admin(_) => true,
            AuthIdentity::ApiKey { scopes, .. } => {
                scopes.iter().any(|s| s == "admin" || s == permission)
            }
        }
    }

    pub fn api_key_id(&self) -> Option<String> {
        match self {
            AuthIdentity::Admin(_) => None,
            AuthIdentity::ApiKey { api_key, .. } => Some(api_key.id.clone()),
        }
    }
}

pub struct RequireAuth(pub AuthIdentity);

impl<S> FromRequestParts<S> for RequireAuth
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // Extract database pool and config from extensions
        let pool = parts
            .extensions
            .get::<DbPool>()
            .cloned()
            .ok_or_else(|| AppError::Internal("Database pool not found in request".into()))?;
        let config = parts
            .extensions
            .get::<Arc<AppConfig>>()
            .cloned()
            .ok_or_else(|| AppError::Internal("AppConfig not found in request".into()))?;

        // 1. Check Authorization header: Bearer <key_or_token>
        if let Some(auth_val) = parts.headers.get(header::AUTHORIZATION) {
            if let Ok(auth_str) = auth_val.to_str() {
                if let Some(token) = auth_str.strip_prefix("Bearer ") {
                    let token = token.trim();

                    // Check if it's an API Key
                    if token.starts_with("mk_live_") {
                        let hash = hash_api_key(token, &config.api_key_pepper);
                        let key_res: Option<ApiKey> = sqlx::query_as(
                            "SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL"
                        )
                        .bind(&hash)
                        .fetch_optional(&pool)
                        .await
                        .map_err(|e| AppError::Internal(format!("DB error verifying key: {}", e)))?;

                        if let Some(api_key) = key_res {
                            // Check expiration
                            if let Some(exp) = &api_key.expires_at {
                                if let Ok(exp_dt) = chrono::DateTime::parse_from_rfc3339(exp) {
                                    if exp_dt < chrono::Utc::now() {
                                        return Err(AppError::Unauthorized("API key has expired".into()));
                                    }
                                }
                            }

                            // Update last used asynchronously
                            let key_id = api_key.id.clone();
                            let pool_clone = pool.clone();
                            tokio::spawn(async move {
                                let now = chrono::Utc::now().to_rfc3339();
                                let _ = sqlx::query("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
                                    .bind(now)
                                    .bind(key_id)
                                    .execute(&pool_clone)
                                    .await;
                            });

                            let scopes: Vec<String> = api_key
                                .permissions
                                .split(',')
                                .map(|s| s.trim().to_string())
                                .collect();

                            return Ok(RequireAuth(AuthIdentity::ApiKey { api_key, scopes }));
                        } else {
                            return Err(AppError::Unauthorized("Invalid or revoked API key".into()));
                        }
                    }

                    // Check if it's a bearer session token
                    if let Some(user_id) = verify_session_token(token, &config.cookie_secret) {
                        let user: Option<User> = sqlx::query_as("SELECT * FROM users WHERE id = ?")
                            .bind(&user_id)
                            .fetch_optional(&pool)
                            .await
                            .map_err(|e| AppError::Internal(format!("DB error finding user: {}", e)))?;

                        if let Some(u) = user {
                            return Ok(RequireAuth(AuthIdentity::Admin(u)));
                        }
                    }
                }
            }
        }

        // 2. Check Cookie: ownmediahost_session=<token> (or legacy selfmedia_session)
        if let Some(cookie_val) = parts.headers.get(header::COOKIE) {
            if let Ok(cookie_str) = cookie_val.to_str() {
                for cookie in cookie_str.split(';') {
                    let parts_c: Vec<&str> = cookie.trim().splitn(2, '=').collect();
                    if parts_c.len() == 2 && (parts_c[0] == "ownmediahost_session" || parts_c[0] == "selfmedia_session") {
                        let token = parts_c[1];
                        if let Some(user_id) = verify_session_token(token, &config.cookie_secret) {
                            let user: Option<User> = sqlx::query_as("SELECT * FROM users WHERE id = ?")
                                .bind(&user_id)
                                .fetch_optional(&pool)
                                .await
                                .map_err(|e| AppError::Internal(format!("DB error finding user: {}", e)))?;

                            if let Some(u) = user {
                                return Ok(RequireAuth(AuthIdentity::Admin(u)));
                            }
                        }
                    }
                }
            }
        }

        Err(AppError::Unauthorized("Authentication required".into()))
    }
}

pub struct RequireAdmin(pub User);

impl<S> FromRequestParts<S> for RequireAdmin
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let auth = RequireAuth::from_request_parts(parts, state).await?;
        match auth.0 {
            AuthIdentity::Admin(u) => Ok(RequireAdmin(u)),
            AuthIdentity::ApiKey { .. } => Err(AppError::Forbidden("Administrator access required".into())),
        }
    }
}
