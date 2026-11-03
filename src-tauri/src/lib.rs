pub mod cloud_sync;
pub mod commands;
pub mod db;
pub mod scanner;

use cloud_sync::OneDriveSyncService;
use commands::AppState;
use db::DatabaseManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app_data_dir");
            let temp_dir = app_data_dir.join("cloud_staging");

            let db = DatabaseManager::new(&app_data_dir)
                .expect("Failed to initialize AuraReader SQLite database");
            let cloud_sync = OneDriveSyncService::new(temp_dir);

            app.manage(AppState { db, cloud_sync });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_library_books,
            commands::import_book_file,
            commands::scan_local_library,
            commands::toggle_book_favorite,
            commands::update_book_tags,
            commands::save_reading_progress,
            commands::get_reading_progress,
            commands::save_annotation,
            commands::delete_annotation,
            commands::get_book_annotations,
            commands::save_bookmark,
            commands::delete_bookmark,
            commands::get_book_bookmarks,
            commands::get_app_system_info,
            commands::check_for_app_updates,
            commands::download_and_install_update,
            commands::export_local_database_snapshot,
            commands::import_local_database_snapshot,
            commands::wipe_all_local_data,
            commands::get_onedrive_status,
            commands::connect_onedrive_oauth,
            commands::disconnect_onedrive,
            commands::trigger_onedrive_backup,
            commands::restore_onedrive_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AuraReader Tauri application");
}
