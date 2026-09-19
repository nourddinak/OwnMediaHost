use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

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
