use fast_image_resize::images::Image;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, Resizer};
use image::{DynamicImage, GenericImageView, ImageFormat};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;
use tracing::warn;

use crate::errors::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageMetadata {
    pub width: u32,
    pub height: u32,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoMetadata {
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub bitrate: Option<i64>,
    pub frame_rate: Option<f64>,
}

#[derive(Debug, Clone, Default)]
pub struct TransformParams {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fit: Option<String>,      // "cover", "contain", "fill", "inside"
    pub format: Option<String>,   // "webp", "jpeg", "png", "gif", "original"
    pub quality: Option<u8>,      // 1 - 100
    pub blur: Option<f32>,        // radius (e.g. 0.5 - 20.0)
    pub rotation: Option<u32>,    // 90, 180, 270
}

pub struct MediaProcessor;

impl MediaProcessor {
    /// Detect genuine MIME type and media type from file byte signature
    pub fn detect_type(data: &[u8], filename: &str) -> (String, String, String) {
        let detected = infer::get(data);
        let ext_from_name = Path::new(filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if let Some(kind) = detected {
            let mime = kind.mime_type().to_string();
            let ext = kind.extension().to_string();
            let media_type = if mime.starts_with("video/") {
                "video".to_string()
            } else if mime.starts_with("image/") {
                "image".to_string()
            } else {
                "other".to_string()
            };
            (mime, ext, media_type)
        } else {
            // Fallback for types not recognized by infer (e.g. certain webm/mkv containers)
            let (mime, media_type) = match ext_from_name.as_str() {
                "jpg" | "jpeg" => ("image/jpeg".to_string(), "image".to_string()),
                "png" => ("image/png".to_string(), "image".to_string()),
                "webp" => ("image/webp".to_string(), "image".to_string()),
                "gif" => ("image/gif".to_string(), "image".to_string()),
                "avif" => ("image/avif".to_string(), "image".to_string()),
                "mp4" => ("video/mp4".to_string(), "video".to_string()),
                "webm" => ("video/webm".to_string(), "video".to_string()),
                "mov" => ("video/quicktime".to_string(), "video".to_string()),
                "mkv" => ("video/x-matroska".to_string(), "video".to_string()),
                _ => ("application/octet-stream".to_string(), "other".to_string()),
            };
            let ext = if ext_from_name.is_empty() { "bin".to_string() } else { ext_from_name };
            (mime, ext, media_type)
        }
    }

    /// Extract image dimensions and format
    pub fn extract_image_metadata(data: &[u8]) -> Result<ImageMetadata, AppError> {
        let img = image::load_from_memory(data)
            .map_err(|e| AppError::BadRequest(format!("Invalid image file format: {}", e)))?;
        let (width, height) = img.dimensions();

        let format = image::guess_format(data)
            .map(|f| format!("{:?}", f).to_lowercase())
            .unwrap_or_else(|_| "unknown".to_string());

        Ok(ImageMetadata {
            width,
            height,
            format,
        })
    }

    /// High-performance image transformation using SIMD resizing
    pub fn transform_image(
        original_data: &[u8],
        params: &TransformParams,
    ) -> Result<(Vec<u8>, String), AppError> {
        let mut img = image::load_from_memory(original_data)
            .map_err(|e| AppError::BadRequest(format!("Failed to decode image: {}", e)))?;

        // 1. Rotation if specified
        if let Some(deg) = params.rotation {
            img = match deg {
                90 => img.rotate90(),
                180 => img.rotate180(),
                270 => img.rotate270(),
                _ => img,
            };
        }

        // 2. Blur if specified
        if let Some(radius) = params.blur {
            if radius > 0.1 {
                img = img.blur(radius);
            }
        }

        // 3. Resize if width or height requested
        let (src_w, src_h) = img.dimensions();
        let target_w = params.width.unwrap_or(src_w);
        let target_h = params.height.unwrap_or(src_h);

        if (target_w != src_w || target_h != src_h) && target_w > 0 && target_h > 0 {
            let fit = params.fit.as_deref().unwrap_or("cover");

            let (calc_w, calc_h) = match fit {
                "contain" => {
                    let ratio_w = target_w as f64 / src_w as f64;
                    let ratio_h = target_h as f64 / src_h as f64;
                    let ratio = ratio_w.min(ratio_h);
                    (
                        (src_w as f64 * ratio).round().max(1.0) as u32,
                        (src_h as f64 * ratio).round().max(1.0) as u32,
                    )
                }
                "inside" => {
                    if src_w <= target_w && src_h <= target_h {
                        (src_w, src_h)
                    } else {
                        let ratio_w = target_w as f64 / src_w as f64;
                        let ratio_h = target_h as f64 / src_h as f64;
                        let ratio = ratio_w.min(ratio_h);
                        (
                            (src_w as f64 * ratio).round().max(1.0) as u32,
                            (src_h as f64 * ratio).round().max(1.0) as u32,
                        )
                    }
                }
                "fill" => (target_w, target_h),
                _ => {
                    // "cover" default
                    let ratio_w = target_w as f64 / src_w as f64;
                    let ratio_h = target_h as f64 / src_h as f64;
                    let ratio = ratio_w.max(ratio_h);
                    let scaled_w = (src_w as f64 * ratio).round().max(1.0) as u32;
                    let scaled_h = (src_h as f64 * ratio).round().max(1.0) as u32;
                    (scaled_w, scaled_h)
                }
            };

            // Fast SIMD resize
            let rgba = img.to_rgba8();
            let src_image = Image::from_vec_u8(
                src_w,
                src_h,
                rgba.into_raw(),
                PixelType::U8x4,
            ).map_err(|e| AppError::Internal(format!("Fast resize image alloc error: {}", e)))?;

            let mut dst_image = Image::new(calc_w, calc_h, PixelType::U8x4);
            let mut resizer = Resizer::new();
            resizer
                .resize(
                    &src_image,
                    &mut dst_image,
                    &fast_image_resize::ResizeOptions::new().resize_alg(ResizeAlg::Convolution(
                        FilterType::Lanczos3,
                    )),
                )
                .map_err(|e| AppError::Internal(format!("Resize execution error: {}", e)))?;

            let resized_rgba = image::RgbaImage::from_raw(calc_w, calc_h, dst_image.into_vec())
                .ok_or_else(|| AppError::Internal("Failed to reconstruct resized image".into()))?;

            let mut resized_dynamic = DynamicImage::ImageRgba8(resized_rgba);

            // If fit == "cover", crop to target_w x target_h centered
            if fit == "cover" && (calc_w > target_w || calc_h > target_h) {
                let crop_x = if calc_w > target_w { (calc_w - target_w) / 2 } else { 0 };
                let crop_y = if calc_h > target_h { (calc_h - target_h) / 2 } else { 0 };
                resized_dynamic = resized_dynamic.crop_imm(crop_x, crop_y, target_w, target_h);
            }

            img = resized_dynamic;
        }

        // 4. Encode to target format
        let target_fmt = params.format.as_deref().unwrap_or("original");
        let (output_format, mime_type) = match target_fmt {
            "webp" => (ImageFormat::WebP, "image/webp"),
            "jpeg" | "jpg" => (ImageFormat::Jpeg, "image/jpeg"),
            "png" => (ImageFormat::Png, "image/png"),
            "gif" => (ImageFormat::Gif, "image/gif"),
            _ => (ImageFormat::WebP, "image/webp"), // Default high-efficiency format
        };

        let mut output_bytes = Vec::new();
        let mut cursor = Cursor::new(&mut output_bytes);

        if output_format == ImageFormat::Jpeg {
            let quality = params.quality.unwrap_or(85).clamp(1, 100);
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
            encoder
                .encode_image(&img)
                .map_err(|e| AppError::Internal(format!("JPEG encoding error: {}", e)))?;
        } else {
            img.write_to(&mut cursor, output_format)
                .map_err(|e| AppError::Internal(format!("Image encoding error: {}", e)))?;
        }

        Ok((output_bytes, mime_type.to_string()))
    }

    /// Extract video metadata using ffprobe directly without shell execution
    pub async fn extract_video_metadata(
        ffprobe_bin: &str,
        video_path: &Path,
    ) -> Result<VideoMetadata, AppError> {
        let output = Command::new(ffprobe_bin)
            .args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                video_path.to_str().unwrap_or(""),
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to execute ffprobe: {}", e)))?;

        if !output.status.success() {
            let err_str = String::from_utf8_lossy(&output.stderr);
            warn!("ffprobe warning/failure: {}", err_str);
            return Ok(VideoMetadata::default());
        }

        let json_val: serde_json::Value = serde_json::from_slice(&output.stdout)
            .map_err(|e| AppError::Internal(format!("Failed to parse ffprobe json: {}", e)))?;

        let mut meta = VideoMetadata::default();

        // Extract duration and bitrate from format
        if let Some(format_obj) = json_val.get("format") {
            if let Some(dur_str) = format_obj.get("duration").and_then(|d| d.as_str()) {
                meta.duration = dur_str.parse::<f64>().ok();
            }
            if let Some(br_str) = format_obj.get("bit_rate").and_then(|b| b.as_str()) {
                meta.bitrate = br_str.parse::<i64>().ok();
            }
        }

        // Extract video and audio stream information
        if let Some(streams) = json_val.get("streams").and_then(|s| s.as_array()) {
            for stream in streams {
                let codec_type = stream.get("codec_type").and_then(|t| t.as_str()).unwrap_or("");
                if codec_type == "video" && meta.video_codec.is_none() {
                    meta.video_codec = stream.get("codec_name").and_then(|c| c.as_str()).map(|s| s.to_string());
                    meta.width = stream.get("width").and_then(|w| w.as_i64());
                    meta.height = stream.get("height").and_then(|h| h.as_i64());

                    if let Some(r_frame_rate) = stream.get("r_frame_rate").and_then(|r| r.as_str()) {
                        let parts: Vec<&str> = r_frame_rate.split('/').collect();
                        if parts.len() == 2 {
                            if let (Ok(num), Ok(den)) = (parts[0].parse::<f64>(), parts[1].parse::<f64>()) {
                                if den > 0.0 {
                                    meta.frame_rate = Some(num / den);
                                }
                            }
                        }
                    }
                } else if codec_type == "audio" && meta.audio_codec.is_none() {
                    meta.audio_codec = stream.get("codec_name").and_then(|c| c.as_str()).map(|s| s.to_string());
                }
            }
        }

        Ok(meta)
    }

    /// Generate video thumbnail frame at 1s timestamp using ffmpeg
    pub async fn generate_video_thumbnail(
        ffmpeg_bin: &str,
        video_path: &Path,
        thumbnail_output_path: &Path,
    ) -> Result<(), AppError> {
        if let Some(parent) = thumbnail_output_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let output = Command::new(ffmpeg_bin)
            .args([
                "-y",
                "-ss",
                "00:00:01",
                "-i",
                video_path.to_str().unwrap_or(""),
                "-vframes",
                "1",
                "-q:v",
                "2",
                thumbnail_output_path.to_str().unwrap_or(""),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to execute ffmpeg: {}", e)))?;

        if !output.status.success() {
            let err_str = String::from_utf8_lossy(&output.stderr);
            warn!("ffmpeg thumbnail generation warning: {}", err_str);
        }

        Ok(())
    }
}
