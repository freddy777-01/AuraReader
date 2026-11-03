use chrono::{DateTime, Utc};
use rusqlite::{backup, params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Database lock poisoned")]
    LockError,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookRecord {
    pub id: String,
    pub file_hash: String,
    pub file_path: String,
    pub folder_path: String,
    pub format: String, // "EPUB" | "PDF"
    pub title: String,
    pub author: Option<String>,
    pub publisher: Option<String>,
    pub page_count: Option<i32>,
    pub cover_path: Option<String>,
    pub is_favorite: bool,
    pub tags: Vec<String>,
    pub progress_pct: f64,
    pub added_at: String,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    pub book_id: String,
    pub locator: String, // EPUB CFI string or PDF "page:<n>"
    pub percentage: f64,
    pub pdf_page: Option<i32>,
    pub updated_at: String,
}

/// Normalized bounding rectangle (0.0..=100.0 percentage of page width/height)
/// so PDF highlights remain resolution- and zoom-independent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub book_id: String,
    pub locator: String,            // EPUB CFI range or PDF "page:<n>"
    pub rects_json: Option<String>, // Serialized Vec<NormalizedRect> for PDF text-layer boxes
    pub selected_text: String,
    pub note: Option<String>,
    pub color: String, // "amber" | "emerald" | "sky" | "rose"
    pub page_number: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub book_id: String,
    pub locator: String, // EPUB CFI or PDF "page:<n>"
    pub page_number: Option<i32>,
    pub label: String,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncPayload {
    pub exported_at: DateTime<Utc>,
    pub app_version: String,
    pub books: Vec<BookRecord>,
    pub progress: Vec<ReadingProgress>,
    pub annotations: Vec<Annotation>,
    pub bookmarks: Vec<Bookmark>,
}

pub struct DatabaseManager {
    pub db_path: PathBuf,
    pub covers_dir: PathBuf,
    conn: Mutex<Connection>,
}

impl DatabaseManager {
    pub fn new(app_data_dir: &Path) -> Result<Self, DbError> {
        std::fs::create_dir_all(app_data_dir)?;
        let covers_dir = app_data_dir.join("covers");
        std::fs::create_dir_all(&covers_dir)?;

        let db_path = app_data_dir.join("aurareader_library.sqlite");
        let conn = Connection::open(&db_path)?;

        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        let manager = Self {
            db_path,
            covers_dir,
            conn: Mutex::new(conn),
        };
        manager.run_migrations()?;
        Ok(manager)
    }

    fn run_migrations(&self) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY,
                file_hash TEXT NOT NULL UNIQUE,
                file_path TEXT NOT NULL,
                folder_path TEXT NOT NULL DEFAULT '',
                format TEXT NOT NULL CHECK(format IN ('EPUB', 'PDF', 'MOBI')),
                title TEXT NOT NULL,
                author TEXT,
                publisher TEXT,
                page_count INTEGER,
                cover_path TEXT,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                tags_json TEXT NOT NULL DEFAULT '[]',
                added_at TEXT NOT NULL,
                last_opened_at TEXT
            );

            CREATE TABLE IF NOT EXISTS reading_progress (
                book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
                locator TEXT NOT NULL,
                percentage REAL NOT NULL DEFAULT 0.0 CHECK(percentage >= 0.0 AND percentage <= 100.0),
                pdf_page INTEGER,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS annotations (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                locator TEXT NOT NULL,
                rects_json TEXT,
                selected_text TEXT NOT NULL,
                note TEXT,
                color TEXT NOT NULL DEFAULT 'amber',
                page_number INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_annotations_book_id ON annotations(book_id);
            CREATE INDEX IF NOT EXISTS idx_annotations_book_page ON annotations(book_id, page_number);

            CREATE TABLE IF NOT EXISTS bookmarks (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                locator TEXT NOT NULL,
                page_number INTEGER,
                label TEXT NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(book_id, locator)
            );

            CREATE INDEX IF NOT EXISTS idx_bookmarks_book_id ON bookmarks(book_id);
            ",
        )?;

        // Idempotent column migrations for existing databases created in earlier sessions
        let _ = conn.execute(
            "ALTER TABLE books ADD COLUMN folder_path TEXT NOT NULL DEFAULT ''",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE books ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE books ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'",
            [],
        );

        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_books_favorite ON books(is_favorite)",
            [],
        );
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_books_author ON books(author)",
            [],
        );

        // Upgrade existing `books` table CHECK constraint if it was created before MOBI support
        let table_sql: Option<String> = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='books'",
                [],
                |r| r.get(0),
            )
            .optional()?;

        if let Some(sql_def) = table_sql {
            if !sql_def.contains("'MOBI'") {
                conn.pragma_update(None, "foreign_keys", "OFF")?;
                conn.execute_batch(
                    "
                    BEGIN TRANSACTION;
                    CREATE TABLE books_new (
                        id TEXT PRIMARY KEY,
                        file_hash TEXT NOT NULL UNIQUE,
                        file_path TEXT NOT NULL,
                        folder_path TEXT NOT NULL DEFAULT '',
                        format TEXT NOT NULL CHECK(format IN ('EPUB', 'PDF', 'MOBI')),
                        title TEXT NOT NULL,
                        author TEXT,
                        publisher TEXT,
                        page_count INTEGER,
                        cover_path TEXT,
                        is_favorite INTEGER NOT NULL DEFAULT 0,
                        tags_json TEXT NOT NULL DEFAULT '[]',
                        added_at TEXT NOT NULL,
                        last_opened_at TEXT
                    );
                    INSERT INTO books_new (
                        id, file_hash, file_path, folder_path, format, title, author,
                        publisher, page_count, cover_path, is_favorite, tags_json, added_at, last_opened_at
                    )
                    SELECT
                        id, file_hash, file_path, folder_path, format, title, author,
                        publisher, page_count, cover_path, is_favorite, tags_json, added_at, last_opened_at
                    FROM books;
                    DROP TABLE books;
                    ALTER TABLE books_new RENAME TO books;
                    CREATE INDEX IF NOT EXISTS idx_books_favorite ON books(is_favorite);
                    CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
                    COMMIT;
                    ",
                )?;
                conn.pragma_update(None, "foreign_keys", "ON")?;
            }
        }

        Ok(())
    }

    fn map_book_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<BookRecord> {
        let is_fav_int: i32 = r.get(10)?;
        let tags_raw: String = r.get(11)?;
        let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();
        let file_path: String = r.get(2)?;
        let stored_folder: String = r.get(3)?;
        let folder_path = if stored_folder.is_empty() {
            Path::new(&file_path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default()
        } else {
            stored_folder
        };

        Ok(BookRecord {
            id: r.get(0)?,
            file_hash: r.get(1)?,
            file_path,
            folder_path,
            format: r.get(4)?,
            title: r.get(5)?,
            author: r.get(6)?,
            publisher: r.get(7)?,
            page_count: r.get(8)?,
            cover_path: r.get(9)?,
            is_favorite: is_fav_int != 0,
            tags,
            progress_pct: r.get::<_, Option<f64>>(12)?.unwrap_or(0.0),
            added_at: r.get(13)?,
            last_opened_at: r.get(14)?,
        })
    }

    /// Inserts or updates a book by `file_hash` and returns the canonical persisted `BookRecord`
    /// along with its joined reading progress percentage, favorite status, and tags.
    pub fn upsert_book(&self, book: &BookRecord) -> Result<BookRecord, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        let tags_json = serde_json::to_string(&book.tags).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO books (
                id, file_hash, file_path, folder_path, format, title, author, publisher,
                page_count, cover_path, is_favorite, tags_json, added_at, last_opened_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(file_hash) DO UPDATE SET
                file_path = excluded.file_path,
                folder_path = excluded.folder_path,
                title = excluded.title,
                author = COALESCE(excluded.author, books.author),
                cover_path = COALESCE(excluded.cover_path, books.cover_path),
                last_opened_at = COALESCE(excluded.last_opened_at, books.last_opened_at)",
            params![
                book.id,
                book.file_hash,
                book.file_path,
                book.folder_path,
                book.format,
                book.title,
                book.author,
                book.publisher,
                book.page_count,
                book.cover_path,
                if book.is_favorite { 1 } else { 0 },
                tags_json,
                book.added_at,
                book.last_opened_at
            ],
        )?;

        let mut stmt = conn.prepare(
            "SELECT
                b.id, b.file_hash, b.file_path, b.folder_path, b.format, b.title,
                b.author, b.publisher, b.page_count, b.cover_path, b.is_favorite,
                b.tags_json, rp.percentage, b.added_at, b.last_opened_at
             FROM books b
             LEFT JOIN reading_progress rp ON rp.book_id = b.id
             WHERE b.file_hash = ?1",
        )?;
        let persisted = stmt.query_row(params![book.file_hash], Self::map_book_row)?;
        Ok(persisted)
    }

    pub fn get_all_books(&self) -> Result<Vec<BookRecord>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        let mut stmt = conn.prepare(
            "SELECT
                b.id, b.file_hash, b.file_path, b.folder_path, b.format, b.title,
                b.author, b.publisher, b.page_count, b.cover_path, b.is_favorite,
                b.tags_json, rp.percentage, b.added_at, b.last_opened_at
             FROM books b
             LEFT JOIN reading_progress rp ON rp.book_id = b.id
             ORDER BY COALESCE(b.last_opened_at, b.added_at) DESC",
        )?;
        let rows = stmt.query_map([], Self::map_book_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn set_book_favorite(&self, book_id: &str, is_favorite: bool) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        conn.execute(
            "UPDATE books SET is_favorite = ?1 WHERE id = ?2",
            params![if is_favorite { 1 } else { 0 }, book_id],
        )?;
        Ok(())
    }

    pub fn update_book_tags(&self, book_id: &str, tags: &[String]) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        let tags_json = serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE books SET tags_json = ?1 WHERE id = ?2",
            params![tags_json, book_id],
        )?;
        Ok(())
    }

    pub fn save_reading_progress(&self, progress: &ReadingProgress) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        conn.execute(
            "INSERT INTO reading_progress (book_id, locator, percentage, pdf_page, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(book_id) DO UPDATE SET
                locator = excluded.locator,
                percentage = excluded.percentage,
                pdf_page = excluded.pdf_page,
                updated_at = excluded.updated_at",
            params![
                progress.book_id,
                progress.locator,
                progress.percentage,
                progress.pdf_page,
                progress.updated_at
            ],
        )?;
        conn.execute(
            "UPDATE books SET last_opened_at = ?1 WHERE id = ?2",
            params![progress.updated_at, progress.book_id],
        )?;
        Ok(())
    }

    pub fn get_reading_progress(&self, book_id: &str) -> Result<Option<ReadingProgress>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        let mut stmt = conn.prepare(
            "SELECT book_id, locator, percentage, pdf_page, updated_at
             FROM reading_progress WHERE book_id = ?1",
        )?;
        stmt.query_row(params![book_id], |row| {
            Ok(ReadingProgress {
                book_id: row.get(0)?,
                locator: row.get(1)?,
                percentage: row.get(2)?,
                pdf_page: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .optional()
        .map_err(DbError::from)
    }

    pub fn upsert_annotation(&self, ann: &Annotation) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        conn.execute(
            "INSERT INTO annotations (id, book_id, locator, rects_json, selected_text, note, color, page_number, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
                rects_json = excluded.rects_json,
                note = excluded.note,
                color = excluded.color,
                updated_at = excluded.updated_at",
            params![
                ann.id,
                ann.book_id,
                ann.locator,
                ann.rects_json,
                ann.selected_text,
                ann.note,
                ann.color,
                ann.page_number,
                ann.created_at,
                ann.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_annotation(&self, annotation_id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        conn.execute("DELETE FROM annotations WHERE id = ?1", params![annotation_id])?;
        Ok(())
    }

    pub fn get_book_annotations(&self, book_id: &str) -> Result<Vec<Annotation>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        let mut stmt = conn.prepare(
            "SELECT id, book_id, locator, rects_json, selected_text, note, color, page_number, created_at, updated_at
             FROM annotations WHERE book_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![book_id], |row| {
            Ok(Annotation {
                id: row.get(0)?,
                book_id: row.get(1)?,
                locator: row.get(2)?,
                rects_json: row.get(3)?,
                selected_text: row.get(4)?,
                note: row.get(5)?,
                color: row.get(6)?,
                page_number: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn upsert_bookmark(&self, bookmark: &Bookmark) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        conn.execute(
            "INSERT INTO bookmarks (id, book_id, locator, page_number, label, note, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(book_id, locator) DO UPDATE SET
                label = excluded.label,
                note = excluded.note",
            params![
                bookmark.id,
                bookmark.book_id,
                bookmark.locator,
                bookmark.page_number,
                bookmark.label,
                bookmark.note,
                bookmark.created_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_bookmark(&self, bookmark_id: &str) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![bookmark_id])?;
        Ok(())
    }

    pub fn get_book_bookmarks(&self, book_id: &str) -> Result<Vec<Bookmark>, DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        let mut stmt = conn.prepare(
            "SELECT id, book_id, locator, page_number, label, note, created_at
             FROM bookmarks WHERE book_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![book_id], |row| {
            Ok(Bookmark {
                id: row.get(0)?,
                book_id: row.get(1)?,
                locator: row.get(2)?,
                page_number: row.get(3)?,
                label: row.get(4)?,
                note: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
    }

    pub fn create_atomic_snapshot(&self, snapshot_path: &Path) -> Result<(), DbError> {
        let src_conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        let mut dst_conn = Connection::open(snapshot_path)?;
        let backup = backup::Backup::new(&src_conn, &mut dst_conn)?;
        backup.run_to_completion(100, Duration::from_millis(25), None)?;
        Ok(())
    }

    pub fn restore_from_snapshot(&self, snapshot_path: &Path) -> Result<(), DbError> {
        let mut dst_conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        let src_conn = Connection::open(snapshot_path)?;
        let backup = backup::Backup::new(&src_conn, &mut dst_conn)?;
        backup.run_to_completion(100, Duration::from_millis(25), None)?;
        Ok(())
    }

    pub fn clear_all_data(&self) -> Result<(), DbError> {
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;
        conn.execute_batch(
            "
            DELETE FROM annotations;
            DELETE FROM bookmarks;
            DELETE FROM reading_progress;
            DELETE FROM books;
            VACUUM;
            ",
        )?;
        Ok(())
    }

    pub fn export_sync_payload(&self) -> Result<CloudSyncPayload, DbError> {
        let books = self.get_all_books()?;
        let conn = self.conn.lock().map_err(|_| DbError::LockError)?;

        let mut prog_stmt = conn.prepare(
            "SELECT book_id, locator, percentage, pdf_page, updated_at FROM reading_progress",
        )?;
        let progress = prog_stmt
            .query_map([], |r| {
                Ok(ReadingProgress {
                    book_id: r.get(0)?,
                    locator: r.get(1)?,
                    percentage: r.get(2)?,
                    pdf_page: r.get(3)?,
                    updated_at: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut ann_stmt = conn.prepare(
            "SELECT id, book_id, locator, rects_json, selected_text, note, color, page_number, created_at, updated_at FROM annotations",
        )?;
        let annotations = ann_stmt
            .query_map([], |r| {
                Ok(Annotation {
                    id: r.get(0)?,
                    book_id: r.get(1)?,
                    locator: r.get(2)?,
                    rects_json: r.get(3)?,
                    selected_text: r.get(4)?,
                    note: r.get(5)?,
                    color: r.get(6)?,
                    page_number: r.get(7)?,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut bm_stmt = conn.prepare(
            "SELECT id, book_id, locator, page_number, label, note, created_at FROM bookmarks",
        )?;
        let bookmarks = bm_stmt
            .query_map([], |r| {
                Ok(Bookmark {
                    id: r.get(0)?,
                    book_id: r.get(1)?,
                    locator: r.get(2)?,
                    page_number: r.get(3)?,
                    label: r.get(4)?,
                    note: r.get(5)?,
                    created_at: r.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(CloudSyncPayload {
            exported_at: Utc::now(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            books,
            progress,
            annotations,
            bookmarks,
        })
    }
}
