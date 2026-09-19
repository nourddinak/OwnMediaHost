use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Pool, Sqlite,
};
use std::str::FromStr;
use tracing::info;

use crate::{
    auth::{hash_password, verify_password},
    config::AppConfig,
    errors::AppError,
    models::User,
};

pub type DbPool = Pool<Sqlite>;

pub async fn init_db(config: &AppConfig) -> Result<DbPool, AppError> {
    // Ensure parent directory exists for SQLite database file
    if let Some(path_str) = config.database_url.strip_prefix("sqlite://") {
        let clean_path = path_str.split('?').next().unwrap_or(path_str);
        let path = std::path::Path::new(clean_path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let connect_opts = SqliteConnectOptions::from_str(&config.database_url)
        .map_err(|e| AppError::Internal(format!("Invalid database connection options: {}", e)))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal)
        .busy_timeout(std::time::Duration::from_secs(10))
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(20)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect_with(connect_opts)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to connect to database: {}", e)))?;

    // Run migrations
    run_migrations(&pool).await?;

    // Seed default settings and initial admin if not existing
    seed_initial_data(&pool, config).await?;

    info!("Database initialized successfully with WAL mode and foreign keys.");
    Ok(pool)
}

async fn run_migrations(pool: &DbPool) -> Result<(), AppError> {
    info!("Running database migrations...");
    let schema_sql = include_str!("../../migrations/001_initial_schema.sql");

    // Execute schema statements in batch
    sqlx::raw_sql(schema_sql)
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(format!("Migration failed: {}", e)))?;

    info!("Database migrations applied.");
    Ok(())
}

async fn seed_initial_data(pool: &DbPool, config: &AppConfig) -> Result<(), AppError> {
    let clean_email = config.admin_email.trim().to_lowercase();
    let clean_password = config.admin_password.trim();

    // Check if any admin user exists
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    if user_count == 0 {
        info!("No administrator found. Seeding initial admin user...");
        let user_id = format!("usr_{}", uuid::Uuid::new_v4().simple());
        let password_hash = hash_password(clean_password)?;

        sqlx::query(
            "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)"
        )
        .bind(&user_id)
        .bind(&clean_email)
        .bind(&password_hash)
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to seed admin user: {}", e)))?;

        info!("Initial administrator created with email: {}", clean_email);
    } else if !clean_password.is_empty() {
        // Automatically synchronize admin password from environment file if changed
        let existing_user: Option<User> = sqlx::query_as(
            "SELECT * FROM users WHERE LOWER(TRIM(email)) = ?"
        )
        .bind(&clean_email)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

        if let Some(user) = existing_user {
            let matches = verify_password(clean_password, &user.password_hash).unwrap_or(false);
            if !matches {
                info!("Synchronizing administrator password from environment configuration for {}...", clean_email);
                let new_hash = hash_password(clean_password)?;
                sqlx::query("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                    .bind(&new_hash)
                    .bind(&user.id)
                    .execute(pool)
                    .await
                    .map_err(|e| AppError::Internal(format!("Failed to sync admin password: {}", e)))?;
                info!("Administrator password successfully synced with environment configuration.");
            }
        }
    }

    // Default settings
    let default_settings = [
        ("max_image_size", config.max_image_size.to_string()),
        ("max_video_size", config.max_video_size.to_string()),
        ("default_visibility", "public".to_string()),
        ("duplicate_handling", "allow".to_string()), // allow | reject | reuse
        ("trash_retention_days", "30".to_string()),
        ("allowed_image_formats", "jpeg,png,webp,gif".to_string()),
        ("allowed_video_formats", "mp4,webm,mov,mkv".to_string()),
    ];

    for (k, v) in default_settings {
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING"
        )
        .bind(k)
        .bind(&v)
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to seed setting {}: {}", k, e)))?;
    }

    Ok(())
}
