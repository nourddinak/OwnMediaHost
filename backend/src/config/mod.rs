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
    pub allowed_image_formats: Vec<String>,
    pub allowed_video_formats: Vec<String>,
    pub cookie_secret: String,
    pub api_key_pepper: String,
    pub private_url_signing_key: String,
    pub admin_email: String,
    pub admin_password: String,
    pub allowed_origins: Vec<String>,
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
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

        let allowed_image_formats = std::env::var("ALLOWED_IMAGE_FORMATS")
            .unwrap_or_else(|_| "jpeg,jpg,png,webp,gif,avif,svg,bmp,ico,tiff,heic".to_string())
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect();

        let allowed_video_formats = std::env::var("ALLOWED_VIDEO_FORMATS")
            .unwrap_or_else(|_| "mp4,webm,mov,mkv,avi,wmv,flv,m4v,ts,3gp".to_string())
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect();

        let cookie_secret = std::env::var("COOKIE_SECRET")
            .unwrap_or_else(|_| "default_insecure_cookie_secret_change_in_production".to_string());

        let api_key_pepper = std::env::var("API_KEY_PEPPER")
            .unwrap_or_else(|_| "default_api_key_pepper_secret_change_in_production".to_string());

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

        let ffmpeg_path = std::env::var("FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".to_string());
        let ffprobe_path = std::env::var("FFPROBE_PATH").unwrap_or_else(|_| "ffprobe".to_string());

        Self {
            app_env,
            host,
            port,
            database_url,
            media_root,
            public_base_url,
            max_image_size,
            max_video_size,
            allowed_image_formats,
            allowed_video_formats,
            cookie_secret,
            api_key_pepper,
            private_url_signing_key,
            admin_email,
            admin_password,
            allowed_origins,
            ffmpeg_path,
            ffprobe_path,
        }
    }
}
