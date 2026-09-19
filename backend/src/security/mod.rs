use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

type HmacSha256 = Hmac<Sha256>;

/// Generates an HMAC-SHA256 signature for image transformation parameters
pub fn sign_transformation(
    signing_key: &str,
    public_id: &str,
    width: Option<u32>,
    height: Option<u32>,
    fit: Option<&str>,
    format: Option<&str>,
    quality: Option<u8>,
    blur: Option<f32>,
    rotation: Option<u32>,
) -> String {
    let payload = format!(
        "{}:{}:{}:{}:{}:{}:{}:{}",
        public_id,
        width.unwrap_or(0),
        height.unwrap_or(0),
        fit.unwrap_or("cover"),
        format.unwrap_or("original"),
        quality.unwrap_or(85),
        blur.unwrap_or(0.0),
        rotation.unwrap_or(0),
    );

    let mut mac = HmacSha256::new_from_slice(signing_key.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(payload.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Verifies whether the provided HMAC-SHA256 signature matches the transformation parameters
pub fn verify_transformation_signature(
    signing_key: &str,
    signature: &str,
    public_id: &str,
    width: Option<u32>,
    height: Option<u32>,
    fit: Option<&str>,
    format: Option<&str>,
    quality: Option<u8>,
    blur: Option<f32>,
    rotation: Option<u32>,
) -> bool {
    let expected = sign_transformation(
        signing_key,
        public_id,
        width,
        height,
        fit,
        format,
        quality,
        blur,
        rotation,
    );
    // Constant-time compare or direct hex compare
    expected.eq_ignore_ascii_case(signature)
}

/// Generates a signed temporary private URL
pub fn sign_private_url(signing_key: &str, public_id: &str, expires: i64) -> String {
    let payload = format!("{}:{}", public_id, expires);
    let mut mac = HmacSha256::new_from_slice(signing_key.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(payload.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Verifies whether a private URL signature is valid and unexpired
pub fn verify_private_url(signing_key: &str, signature: &str, public_id: &str, expires: i64) -> bool {
    if expires < chrono::Utc::now().timestamp() {
        return false;
    }

    let expected = sign_private_url(signing_key, public_id, expires);
    expected.eq_ignore_ascii_case(signature)
}

/// Simple in-memory rate limiter per IP / key
pub struct RateLimiter {
    requests: Mutex<HashMap<String, Vec<Instant>>>,
    max_requests: usize,
    window_secs: u64,
}

impl RateLimiter {
    pub fn new(max_requests: usize, window_secs: u64) -> Self {
        Self {
            requests: Mutex::new(HashMap::new()),
            max_requests,
            window_secs,
        }
    }

    pub fn check(&self, key: &str) -> bool {
        let mut map = self.requests.lock().unwrap();
        let now = Instant::now();
        let window = std::time::Duration::from_secs(self.window_secs);

        let timestamps = map.entry(key.to_string()).or_default();
        timestamps.retain(|&t| now.duration_since(t) < window);

        if timestamps.len() >= self.max_requests {
            false
        } else {
            timestamps.push(now);
            true
        }
    }
}
