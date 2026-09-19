use async_trait::async_trait;
use std::path::PathBuf;
use tokio::fs::{self, File};
use tokio::io::AsyncWriteExt;

use crate::errors::AppError;

#[async_trait]
pub trait StorageProvider: Send + Sync {
    async fn write_file(&self, relative_path: &str, data: &[u8]) -> Result<u64, AppError>;
    async fn delete_file(&self, relative_path: &str) -> Result<(), AppError>;
    async fn prune_empty_parent_dirs(&self, relative_path: &str) -> Result<(), AppError>;
    async fn file_exists(&self, relative_path: &str) -> Result<bool, AppError>;
    fn get_full_path(&self, relative_path: &str) -> Result<PathBuf, AppError>;
}

#[derive(Clone, Debug)]
pub struct LocalStorageProvider {
    root_dir: PathBuf,
}

impl LocalStorageProvider {
    pub fn new(root_dir: PathBuf) -> Result<Self, AppError> {
        // Ensure root structure exists
        let subdirs = [
            "originals/images",
            "originals/videos",
            "generated/thumbnails",
            "database",
        ];

        for sub in subdirs {
            let path = root_dir.join(sub);
            std::fs::create_dir_all(&path)?;
        }

        Ok(Self { root_dir })
    }

    /// Generates a safe partitioned relative path:
    /// e.g. "originals/images/2026/09/7f/7fd92abc.jpg"
    pub fn generate_storage_path(media_type: &str, public_id: &str, extension: &str) -> String {
        let now = chrono::Utc::now();
        let year = now.format("%Y").to_string();
        let month = now.format("%m").to_string();

        let prefix = if public_id.len() >= 2 {
            &public_id[..2]
        } else {
            "00"
        };

        let subfolder = if media_type == "video" {
            "originals/videos"
        } else {
            "originals/images"
        };

        format!(
            "{}/{}/{}/{}/{}.{}",
            subfolder, year, month, prefix, public_id, extension
        )
    }

    /// Verifies that a path does not escape the storage root
    pub fn sanitize_path(&self, relative_path: &str) -> Result<PathBuf, AppError> {
        let clean = relative_path.replace('\\', "/");
        if clean.contains("..") || clean.starts_with('/') {
            return Err(AppError::Forbidden("Path traversal attempt detected".into()));
        }

        let full_path = self.root_dir.join(clean);
        Ok(full_path)
    }
}

#[async_trait]
impl StorageProvider for LocalStorageProvider {
    async fn write_file(&self, relative_path: &str, data: &[u8]) -> Result<u64, AppError> {
        let target_path = self.sanitize_path(relative_path)?;

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let mut file = File::create(&target_path).await?;
        file.write_all(data).await?;
        file.flush().await?;

        Ok(data.len() as u64)
    }

    async fn delete_file(&self, relative_path: &str) -> Result<(), AppError> {
        let target_path = self.sanitize_path(relative_path)?;
        if target_path.exists() {
            fs::remove_file(&target_path).await?;
        }
        Ok(())
    }

    async fn prune_empty_parent_dirs(&self, relative_path: &str) -> Result<(), AppError> {
        let target_path = self.sanitize_path(relative_path)?;
        let mut current = target_path.parent();
        while let Some(dir) = current {
            if dir == self.root_dir
                || dir == self.root_dir.join("originals")
                || dir == self.root_dir.join("originals/images")
                || dir == self.root_dir.join("originals/videos")
                || dir == self.root_dir.join("generated")
                || dir == self.root_dir.join("generated/thumbnails")
                || dir == self.root_dir.join("temporary")
            {
                break;
            }

            match std::fs::read_dir(dir) {
                Ok(mut entries) => {
                    if entries.next().is_none() {
                        let _ = fs::remove_dir(dir).await;
                        current = dir.parent();
                    } else {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        Ok(())
    }

    async fn file_exists(&self, relative_path: &str) -> Result<bool, AppError> {
        let target_path = self.sanitize_path(relative_path)?;
        Ok(target_path.exists())
    }

    fn get_full_path(&self, relative_path: &str) -> Result<PathBuf, AppError> {
        self.sanitize_path(relative_path)
    }
}
