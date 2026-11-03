use crate::cloud_sync::{CloudBackupMetadata, OneDriveAuthState, OneDriveSyncService};
use crate::db::{
    Annotation, BookRecord, Bookmark, CloudSyncPayload, DatabaseManager, ReadingProgress,
};
use crate::scanner;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

pub struct AppState {
    pub db: DatabaseManager,
    pub cloud_sync: OneDriveSyncService,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSystemInfo {
    pub current_version: String,
    pub database_path: String,
    pub covers_dir: String,
    pub database_size_bytes: u64,
    pub retain_data_on_uninstall_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_notes: String,
    pub download_url: Option<String>,
}

#[tauri::command]
pub fn get_library_books(state: State<'_, AppState>) -> Result<Vec<BookRecord>, String> {
    state.db.get_all_books().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_book_file(
    file_path: String,
    state: State<'_, AppState>,
) -> Result<BookRecord, String> {
    let path = PathBuf::from(&file_path);
    let extracted =
        scanner::extract_book_metadata(&path, &state.db.covers_dir).map_err(|e| e.to_string())?;
    state.db.upsert_book(&extracted).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_mobi_book(file_path: String) -> Result<crate::mobi_engine::MobiDocumentPayload, String> {
    let path = PathBuf::from(&file_path);
    let safe = scanner::validate_local_path(&path).map_err(|e| e.to_string())?;
    crate::mobi_engine::load_mobi_document(&safe)
}

#[tauri::command]
pub fn scan_local_library(
    directory_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<BookRecord>, String> {
    let path = PathBuf::from(&directory_path);
    let discovered =
        scanner::scan_directory(&path, &state.db.covers_dir).map_err(|e| e.to_string())?;
    let mut persisted_books = Vec::with_capacity(discovered.len());
    for book in &discovered {
        let saved = state.db.upsert_book(book).map_err(|e| e.to_string())?;
        persisted_books.push(saved);
    }
    Ok(persisted_books)
}

#[tauri::command]
pub fn toggle_book_favorite(
    book_id: String,
    is_favorite: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .db
        .set_book_favorite(&book_id, is_favorite)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_book_tags(
    book_id: String,
    tags: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .db
        .update_book_tags(&book_id, &tags)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_reading_progress(
    progress: ReadingProgress,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .db
        .save_reading_progress(&progress)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_reading_progress(
    book_id: String,
    state: State<'_, AppState>,
) -> Result<Option<ReadingProgress>, String> {
    state
        .db
        .get_reading_progress(&book_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_annotation(
    annotation: Annotation,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .db
        .upsert_annotation(&annotation)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_annotation(
    annotation_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .db
        .delete_annotation(&annotation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_book_annotations(
    book_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Annotation>, String> {
    state
        .db
        .get_book_annotations(&book_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_bookmark(bookmark: Bookmark, state: State<'_, AppState>) -> Result<(), String> {
    state
        .db
        .upsert_bookmark(&bookmark)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_bookmark(bookmark_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .db
        .delete_bookmark(&bookmark_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_book_bookmarks(
    book_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Bookmark>, String> {
    state
        .db
        .get_book_bookmarks(&book_id)
        .map_err(|e| e.to_string())
}

// ============================================================================
// App Updates, Local Data Retention & Uninstall Data Management Commands
// ============================================================================

#[tauri::command]
pub fn get_app_system_info(state: State<'_, AppState>) -> Result<AppSystemInfo, String> {
    let size = std::fs::metadata(&state.db.db_path)
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(AppSystemInfo {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        database_path: state.db.db_path.to_string_lossy().to_string(),
        covers_dir: state.db.covers_dir.to_string_lossy().to_string(),
        database_size_bytes: size,
        retain_data_on_uninstall_default: true,
    })
}

#[tauri::command]
pub async fn check_for_app_updates(
    github_repo: Option<String>,
) -> Result<UpdateCheckResult, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let repo_or_url = github_repo
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "FEMAG/AuraReader".to_string());

    // Support either a full URL or a "OWNER/REPO" GitHub repository slug
    let api_url = if repo_or_url.starts_with("http://") || repo_or_url.starts_with("https://") {
        repo_or_url
    } else {
        format!(
            "https://api.github.com/repos/{}/releases/latest",
            repo_or_url.trim_matches('/')
        )
    };

    let client = reqwest::Client::builder()
        .user_agent("AuraReader-Updater/1.0 (by FEMAG)")
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    match client.get(&api_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                // 1. Parse GitHub Releases API format (`tag_name`, `body`, `assets`)
                // OR 2. Parse Tauri `latest.json` format (`version`, `notes`, `platforms` / `url`)
                let raw_version = json["tag_name"]
                    .as_str()
                    .or_else(|| json["version"].as_str())
                    .unwrap_or(&current);
                let latest = raw_version.trim_start_matches('v').to_string();

                let notes = json["body"]
                    .as_str()
                    .or_else(|| json["notes"].as_str())
                    .unwrap_or("New GitHub release available.")
                    .to_string();

                // Locate Windows installer (.exe or .msi) in GitHub release assets or Tauri manifest
                let mut download_url = json["url"]
                    .as_str()
                    .or_else(|| json["platforms"]["windows-x86_64"]["url"].as_str())
                    .map(|s| s.to_string());

                if download_url.is_none() {
                    if let Some(assets) = json["assets"].as_array() {
                        for asset in assets {
                            let name = asset["name"].as_str().unwrap_or("").to_ascii_lowercase();
                            if name.ends_with("-setup.exe")
                                || name.ends_with(".exe")
                                || name.ends_with(".msi")
                            {
                                download_url = asset["browser_download_url"]
                                    .as_str()
                                    .map(|s| s.to_string());
                                break;
                            }
                        }
                    }
                }

                return Ok(UpdateCheckResult {
                    update_available: latest != current,
                    current_version: current,
                    latest_version: latest,
                    release_notes: notes,
                    download_url,
                });
            }
        }
        _ => {}
    }

    Ok(UpdateCheckResult {
        current_version: current.clone(),
        latest_version: current,
        update_available: false,
        release_notes: "You are running the latest version from GitHub Releases.".to_string(),
        download_url: None,
    })
}

/// Downloads the update installer binary after creating an automatic pre-update SQLite snapshot,
/// then launches the installer so the upgrade completes while preserving user data.
#[tauri::command]
pub async fn download_and_install_update(
    download_url: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // 1. Create automatic pre-update safety backup of the SQLite database
    let parent_dir = state
        .db
        .db_path
        .parent()
        .ok_or_else(|| "Invalid app data directory".to_string())?;
    let safety_backup_path = parent_dir.join("aurareader_pre_update_backup.sqlite");
    state
        .db
        .create_atomic_snapshot(&safety_backup_path)
        .map_err(|e| format!("Failed to create pre-update DB backup: {}", e))?;

    // 2. Download the installer executable into app_data_dir/updates
    let updates_dir = parent_dir.join("updates");
    std::fs::create_dir_all(&updates_dir).map_err(|e| e.to_string())?;
    let installer_path = updates_dir.join("AuraReader_Update_Setup.exe");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download update installer: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Update server returned HTTP {}",
            resp.status().as_u16()
        ));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&installer_path, &bytes)
        .await
        .map_err(|e| format!("Failed to save update installer: {}", e))?;

    // 3. Launch the Windows NSIS update installer
    std::process::Command::new(&installer_path)
        .spawn()
        .map_err(|e| format!("Failed to launch update installer: {}", e))?;

    Ok(safety_backup_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn export_local_database_snapshot(
    destination_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let dst = PathBuf::from(&destination_path);
    state
        .db
        .create_atomic_snapshot(&dst)
        .map_err(|e| e.to_string())?;
    Ok(dst.to_string_lossy().to_string())
}

#[tauri::command]
pub fn import_local_database_snapshot(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<CloudSyncPayload, String> {
    let src = PathBuf::from(&source_path);
    state
        .db
        .restore_from_snapshot(&src)
        .map_err(|e| e.to_string())?;
    state.db.export_sync_payload().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn wipe_all_local_data(state: State<'_, AppState>) -> Result<(), String> {
    state.db.clear_all_data().map_err(|e| e.to_string())?;
    if state.db.covers_dir.exists() {
        let _ = std::fs::remove_dir_all(&state.db.covers_dir);
        let _ = std::fs::create_dir_all(&state.db.covers_dir);
    }
    Ok(())
}

// ============================================================================
// Cloud Backup Commands (Microsoft OneDrive OAuth 2.0 + Graph API)
// ============================================================================

#[tauri::command]
pub fn get_onedrive_status(state: State<'_, AppState>) -> Result<OneDriveAuthState, String> {
    Ok(state.cloud_sync.get_status())
}

#[tauri::command]
pub async fn connect_onedrive_oauth(
    access_token: String,
    refresh_token: Option<String>,
    account_email: String,
    expires_in_seconds: i64,
    state: State<'_, AppState>,
) -> Result<OneDriveAuthState, String> {
    let expires_at = Utc::now() + Duration::seconds(expires_in_seconds);
    state.cloud_sync.set_credentials(
        access_token,
        refresh_token,
        account_email,
        expires_at,
    );
    Ok(state.cloud_sync.get_status())
}

#[tauri::command]
pub fn disconnect_onedrive(state: State<'_, AppState>) -> Result<OneDriveAuthState, String> {
    state.cloud_sync.disconnect();
    Ok(state.cloud_sync.get_status())
}

#[tauri::command]
pub async fn trigger_onedrive_backup(
    state: State<'_, AppState>,
) -> Result<CloudBackupMetadata, String> {
    state
        .cloud_sync
        .upload_backup(&state.db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_onedrive_backup(
    state: State<'_, AppState>,
) -> Result<CloudSyncPayload, String> {
    state
        .cloud_sync
        .restore_backup(&state.db)
        .await
        .map_err(|e| e.to_string())
}
