use crate::db::BookRecord;
use chrono::Utc;
use epub::doc::EpubDoc;
use lopdf::Document as PdfDocument;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Error, Debug)]
pub enum ScannerError {
    #[error("Path validation failed: unauthorized or invalid path")]
    UnauthorizedPath,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Unsupported file format")]
    UnsupportedFormat,
}

pub fn validate_local_path(target: &Path) -> Result<PathBuf, ScannerError> {
    let canonical = target.canonicalize().map_err(|_| ScannerError::UnauthorizedPath)?;
    if !canonical.exists() {
        return Err(ScannerError::UnauthorizedPath);
    }
    Ok(canonical)
}

fn compute_book_fingerprint(path: &Path) -> Result<String, std::io::Error> {
    let file = File::open(path)?;
    let file_len = file.metadata()?.len();
    let mut reader = BufReader::new(file);
    let mut buffer = vec![0u8; 1024 * 1024];
    let bytes_read = reader.read(&mut buffer)?;

    let mut hasher = Sha256::new();
    hasher.update(&buffer[..bytes_read]);
    hasher.update(file_len.to_le_bytes());
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn scan_directory(
    dir_path: &Path,
    covers_dir: &Path,
) -> Result<Vec<BookRecord>, ScannerError> {
    let safe_root = validate_local_path(dir_path)?;
    let mut discovered_books = Vec::new();

    for entry in WalkDir::new(&safe_root)
        .follow_links(false)
        .max_depth(5)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            match ext.to_ascii_lowercase().as_str() {
                "epub" | "pdf" | "mobi" | "azw" => {
                    if let Ok(record) = extract_book_metadata(path, covers_dir) {
                        discovered_books.push(record);
                    }
                }
                _ => continue,
            }
        }
    }

    Ok(discovered_books)
}

pub fn extract_book_metadata(
    file_path: &Path,
    covers_dir: &Path,
) -> Result<BookRecord, ScannerError> {
    let safe_path = validate_local_path(file_path)?;
    let ext = safe_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .ok_or(ScannerError::UnsupportedFormat)?;

    let file_hash = compute_book_fingerprint(&safe_path)?;
    let fallback_title = safe_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled Document")
        .to_string();

    let folder_path = safe_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    match ext.as_str() {
        "epub" => extract_epub_metadata(&safe_path, folder_path, file_hash, fallback_title, covers_dir),
        "pdf" => extract_pdf_metadata(&safe_path, folder_path, file_hash, fallback_title),
        "mobi" | "azw" => extract_mobi_metadata(&safe_path, folder_path, file_hash, fallback_title, covers_dir),
        _ => Err(ScannerError::UnsupportedFormat),
    }
}

fn extract_epub_metadata(
    path: &Path,
    folder_path: String,
    file_hash: String,
    fallback_title: String,
    covers_dir: &Path,
) -> Result<BookRecord, ScannerError> {
    let doc = EpubDoc::new(path);
    let (title, author, publisher, spine_len, cover_path) = match doc {
        Ok(mut epub) => {
            let title = epub
                .mdata("title")
                .map(|m| m.value.clone())
                .unwrap_or(fallback_title);
            let author = epub.mdata("creator").map(|m| m.value.clone());
            let publisher = epub.mdata("publisher").map(|m| m.value.clone());
            let spine = Some(epub.spine.len() as i32);

            // Extract embedded EPUB cover image to local covers cache
            let extracted_cover = epub.get_cover().and_then(|(cover_bytes, mime)| {
                let ext = if mime.contains("png") { "png" } else { "jpg" };
                let out_path = covers_dir.join(format!("{}.{}", file_hash, ext));
                std::fs::write(&out_path, cover_bytes)
                    .ok()
                    .map(|_| out_path.to_string_lossy().to_string())
            });

            (title, author, publisher, spine, extracted_cover)
        }
        Err(_) => (fallback_title, None, None, None, None),
    };

    Ok(BookRecord {
        id: Uuid::new_v4().to_string(),
        file_hash,
        file_path: path.to_string_lossy().to_string(),
        folder_path,
        format: "EPUB".to_string(),
        title,
        author,
        publisher,
        page_count: spine_len,
        cover_path,
        is_favorite: false,
        tags: Vec::new(),
        progress_pct: 0.0,
        added_at: Utc::now().to_rfc3339(),
        last_opened_at: None,
    })
}

fn extract_pdf_metadata(
    path: &Path,
    folder_path: String,
    file_hash: String,
    fallback_title: String,
) -> Result<BookRecord, ScannerError> {
    let page_count = PdfDocument::load(path)
        .ok()
        .map(|doc| doc.get_pages().len() as i32);

    Ok(BookRecord {
        id: Uuid::new_v4().to_string(),
        file_hash,
        file_path: path.to_string_lossy().to_string(),
        folder_path,
        format: "PDF".to_string(),
        title: fallback_title,
        author: None,
        publisher: None,
        page_count,
        cover_path: None,
        is_favorite: false,
        tags: Vec::new(),
        progress_pct: 0.0,
        added_at: Utc::now().to_rfc3339(),
        last_opened_at: None,
    })
}

fn extract_mobi_metadata(
    path: &Path,
    folder_path: String,
    file_hash: String,
    fallback_title: String,
    covers_dir: &Path,
) -> Result<BookRecord, ScannerError> {
    let summary = crate::mobi_engine::extract_mobi_summary(path, &file_hash, covers_dir).ok();

    let title = summary
        .as_ref()
        .and_then(|s| s.title.clone())
        .unwrap_or(fallback_title);
    let author = summary.as_ref().and_then(|s| s.author.clone());
    let publisher = summary.as_ref().and_then(|s| s.publisher.clone());
    let page_count = summary.as_ref().and_then(|s| s.estimated_pages);
    let cover_path = summary.and_then(|s| s.cover_path);

    Ok(BookRecord {
        id: Uuid::new_v4().to_string(),
        file_hash,
        file_path: path.to_string_lossy().to_string(),
        folder_path,
        format: "MOBI".to_string(),
        title,
        author,
        publisher,
        page_count,
        cover_path,
        is_favorite: false,
        tags: Vec::new(),
        progress_pct: 0.0,
        added_at: Utc::now().to_rfc3339(),
        last_opened_at: None,
    })
}
