use crate::db::{CloudSyncPayload, DatabaseManager, DbError};
use chrono::{DateTime, Utc};
use reqwest::{header, Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;
use thiserror::Error;

const GRAPH_BASE_URL: &str = "https://graph.microsoft.com/v1.0/me/drive/special/approot";

#[derive(Error, Debug)]
pub enum CloudSyncError {
    #[error("Database error: {0}")]
    Database(#[from] DbError),
    #[error("Network / Graph API error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("Not authenticated with Microsoft OneDrive")]
    NotAuthenticated,
    #[error("OneDrive Graph API returned HTTP {0}: {1}")]
    GraphApiError(u16, String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneDriveAuthState {
    pub is_connected: bool,
    pub account_email: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_synced_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudBackupMetadata {
    pub backup_id: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub last_modified_at: String,
    pub annotations_count: usize,
    pub books_count: usize,
}

pub struct OneDriveSyncService {
    http_client: Client,
    auth_state: RwLock<OneDriveAuthState>,
    temp_dir: PathBuf,
}

impl OneDriveSyncService {
    pub fn new(temp_dir: PathBuf) -> Self {
        Self {
            http_client: Client::new(),
            auth_state: RwLock::new(OneDriveAuthState {
                is_connected: false,
                account_email: None,
                access_token: None,
                refresh_token: None,
                expires_at: None,
                last_synced_at: None,
            }),
            temp_dir,
        }
    }

    pub fn set_credentials(
        &self,
        access_token: String,
        refresh_token: Option<String>,
        account_email: String,
        expires_at: DateTime<Utc>,
    ) {
        if let Ok(mut guard) = self.auth_state.write() {
            guard.is_connected = true;
            guard.access_token = Some(access_token);
            guard.refresh_token = refresh_token;
            guard.account_email = Some(account_email);
            guard.expires_at = Some(expires_at);
        }
    }

    pub fn disconnect(&self) {
        if let Ok(mut guard) = self.auth_state.write() {
            *guard = OneDriveAuthState {
                is_connected: false,
                account_email: None,
                access_token: None,
                refresh_token: None,
                expires_at: None,
                last_synced_at: None,
            };
        }
    }

    pub fn get_status(&self) -> OneDriveAuthState {
        self.auth_state
            .read()
            .map(|g| g.clone())
            .unwrap_or(OneDriveAuthState {
                is_connected: false,
                account_email: None,
                access_token: None,
                refresh_token: None,
                expires_at: None,
                last_synced_at: None,
            })
    }

    fn bearer_token(&self) -> Result<String, CloudSyncError> {
        let guard = self
            .auth_state
            .read()
            .map_err(|_| CloudSyncError::NotAuthenticated)?;
        guard
            .access_token
            .clone()
            .ok_or(CloudSyncError::NotAuthenticated)
    }

    /// Performs a dual-artifact backup to OneDrive `AppRoot` (`Files.ReadWrite.AppFolder` scope):
    /// 1. `aurareader_backup.sqlite`: Atomic SQLite snapshot for full database disaster recovery.
    /// 2. `aurareader_highlights.json`: Structured JSON payload for cross-device merge & inspection.
    pub async fn upload_backup(
        &self,
        db: &DatabaseManager,
    ) -> Result<CloudBackupMetadata, CloudSyncError> {
        let token = self.bearer_token()?;
        std::fs::create_dir_all(&self.temp_dir)?;

        // 1. Create atomic SQLite backup snapshot
        let snapshot_path = self.temp_dir.join("aurareader_backup.sqlite");
        db.create_atomic_snapshot(&snapshot_path)?;
        let sqlite_bytes = tokio::fs::read(&snapshot_path).await?;
        let sqlite_size = sqlite_bytes.len() as u64;

        // 2. Upload SQLite snapshot to OneDrive AppFolder
        let db_upload_url = format!("{}:/aurareader_backup.sqlite:/content", GRAPH_BASE_URL);
        let db_resp = self
            .http_client
            .put(&db_upload_url)
            .bearer_auth(&token)
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .body(sqlite_bytes)
            .send()
            .await?;

        if !db_resp.status().is_success() {
            let status = db_resp.status().as_u16();
            let err_body = db_resp.text().await.unwrap_or_default();
            return Err(CloudSyncError::GraphApiError(status, err_body));
        }

        // 3. Export & upload portable JSON payload of highlights and reading positions
        let payload = db.export_sync_payload()?;
        let json_bytes = serde_json::to_vec_pretty(&payload)?;
        let json_upload_url = format!("{}:/aurareader_highlights.json:/content", GRAPH_BASE_URL);

        let json_resp = self
            .http_client
            .put(&json_upload_url)
            .bearer_auth(&token)
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_bytes)
            .send()
            .await?;

        if !json_resp.status().is_success() {
            let status = json_resp.status().as_u16();
            let err_body = json_resp.text().await.unwrap_or_default();
            return Err(CloudSyncError::GraphApiError(status, err_body));
        }

        let graph_item: serde_json::Value = json_resp.json().await?;
        let now = Utc::now();

        if let Ok(mut guard) = self.auth_state.write() {
            guard.last_synced_at = Some(now);
        }

        // Clean up local temporary snapshot
        let _ = tokio::fs::remove_file(&snapshot_path).await;

        Ok(CloudBackupMetadata {
            backup_id: graph_item["id"]
                .as_str()
                .unwrap_or("onedrive-approot")
                .to_string(),
            file_name: "aurareader_backup.sqlite + aurareader_highlights.json".to_string(),
            size_bytes: sqlite_size,
            last_modified_at: now.to_rfc3339(),
            annotations_count: payload.annotations.len(),
            books_count: payload.books.len(),
        })
    }

    /// Downloads the SQLite backup snapshot and/or JSON payload from OneDrive AppFolder
    /// and atomically restores the local database state.
    pub async fn restore_backup(
        &self,
        db: &DatabaseManager,
    ) -> Result<CloudSyncPayload, CloudSyncError> {
        let token = self.bearer_token()?;
        std::fs::create_dir_all(&self.temp_dir)?;

        // 1. Download SQLite binary snapshot from OneDrive AppFolder
        let db_download_url = format!("{}:/aurareader_backup.sqlite:/content", GRAPH_BASE_URL);
        let db_resp = self
            .http_client
            .get(&db_download_url)
            .bearer_auth(&token)
            .send()
            .await?;

        if db_resp.status() == StatusCode::NOT_FOUND {
            return Err(CloudSyncError::GraphApiError(
                404,
                "No existing AuraReader backup found in OneDrive AppFolder.".to_string(),
            ));
        } else if !db_resp.status().is_success() {
            let status = db_resp.status().as_u16();
            let body = db_resp.text().await.unwrap_or_default();
            return Err(CloudSyncError::GraphApiError(status, body));
        }

        let sqlite_bytes = db_resp.bytes().await?;
        let restore_snapshot_path = self.temp_dir.join("aurareader_restore_temp.sqlite");
        tokio::fs::write(&restore_snapshot_path, &sqlite_bytes).await?;

        // 2. Atomically restore into live SQLite database via rusqlite online backup API
        db.restore_from_snapshot(&restore_snapshot_path)?;
        let _ = tokio::fs::remove_file(&restore_snapshot_path).await;

        if let Ok(mut guard) = self.auth_state.write() {
            guard.last_synced_at = Some(Utc::now());
        }

        // 3. Return the freshly restored library & highlight payload to hydrate React state immediately
        let restored_payload = db.export_sync_payload()?;
        Ok(restored_payload)
    }
}

