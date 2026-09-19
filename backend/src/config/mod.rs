use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub app_env: String,
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub media_root: PathBuf,
    pub public_base_url: String,
    pub max_image_size: u64,
    pub max_video_size: u64,
    pub default_chunk_size: u64,
    pub jwt_secret: String,
    pub cookie_secret: String,
    pub api_key_pepper: String,
    pub transform_signing_key: String,
    pub private_url_signing_key: String,
    pub admin_email: String,
    pub admin_password: String,
    pub allowed_origins: Vec<String>,
    pub max_transform_width: u32,
    pub max_transform_height: u32,
    pub max_transform_pixels: u64,
    pub allowed_transform_formats: Vec<String>,
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub imgproxy_url: Option<String>,
}

impl AppConfig {
    pub fn from_env() -> Self {
        // Load .env if present
        let _ = dotenvy::dotenv();

        let app_env = std::env::var("APP_ENV").unwrap_or_else(|_| "development".to_string());
        let host = std::env::var("APP_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let port = std::env::var("APP_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(8080);

        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://storage/database/media.db?mode=rwc".to_string());

        let media_root = PathBuf::from(
            std::env::var("MEDIA_ROOT").unwrap_or_else(|_| "./storage".to_string()),
        );

        let public_base_url = std::env::var("PUBLIC_BASE_URL")
            .unwrap_or_else(|_| format!("http://localhost:{}", port));

        let max_image_size = std::env::var("MAX_IMAGE_SIZE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(50 * 1024 * 1024); // 50MB

        let max_video_size = std::env::var("MAX_VIDEO_SIZE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(5 * 1024 * 1024 * 1024); // 5GB

        let default_chunk_size = std::env::var("DEFAULT_CHUNK_SIZE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(10 * 1024 * 1024); // 10MB

        let jwt_secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "default_insecure_jwt_secret_change_in_production_32b".to_string());

        let cookie_secret = std::env::var("COOKIE_SECRET")
            .unwrap_or_else(|_| "default_insecure_cookie_secret_change_in_production".to_string());

        let api_key_pepper = std::env::var("API_KEY_PEPPER")
            .unwrap_or_else(|_| "default_api_key_pepper_secret_change_in_production".to_string());

        let transform_signing_key = std::env::var("TRANSFORM_SIGNING_KEY")
            .unwrap_or_else(|_| "default_transform_signing_key_secret_change_in_prod".to_string());

        let private_url_signing_key = std::env::var("PRIVATE_URL_SIGNING_KEY")
            .unwrap_or_else(|_| "default_private_url_signing_key_secret_change_prod".to_string());

        let admin_email = std::env::var("ADMIN_EMAIL")
            .map(|s| s.trim().to_lowercase())
            .unwrap_or_else(|_| "admin@ownmediahost.local".to_string());

        let admin_password = std::env::var("ADMIN_PASSWORD")
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| "AdminSecurePass2026!".to_string());

        let allowed_origins = std::env::var("ALLOWED_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:5173,http://localhost:8080".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let max_transform_width = std::env::var("MAX_TRANSFORM_WIDTH")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(4096);

        let max_transform_height = std::env::var("MAX_TRANSFORM_HEIGHT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(4096);

        let max_transform_pixels = std::env::var("MAX_TRANSFORM_PIXELS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(16_777_216); // 16 megapixels

        let allowed_transform_formats = std::env::var("ALLOWED_TRANSFORM_FORMATS")
            .unwrap_or_else(|_| "jpeg,png,webp,gif".to_string())
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect();

        let ffmpeg_path = std::env::var("FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".to_string());
        let ffprobe_path = std::env::var("FFPROBE_PATH").unwrap_or_else(|_| "ffprobe".to_string());

        let imgproxy_url = std::env::var("IMGPROXY_URL")
            .ok()
            .filter(|s| !s.trim().is_empty());

        Self {
            app_env,
            host,
            port,
            database_url,
            media_root,
            public_base_url,
            max_image_size,
            max_video_size,
            default_chunk_size,
            jwt_secret,
            cookie_secret,
            api_key_pepper,
            transform_signing_key,
            private_url_signing_key,
            admin_email,
            admin_password,
            allowed_origins,
            max_transform_width,
            max_transform_height,
            max_transform_pixels,
            allowed_transform_formats,
            ffmpeg_path,
            ffprobe_path,
            imgproxy_url,
        }
    }
}
