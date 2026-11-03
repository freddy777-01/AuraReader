export type BookFormat = "EPUB" | "PDF" | "MOBI";

export interface MobiChapter {
  index: number;
  title: string;
  startPage: number;
}

export interface MobiDocumentPayload {
  title: string;
  author?: string | null;
  publisher?: string | null;
  pages: string[];
  chapters: MobiChapter[];
}

export type HighlightColor = "amber" | "emerald" | "sky" | "rose";

export type ThemeMode = "light" | "sepia" | "night";

export type BookshelfViewMode = "grid" | "list";

export type BookshelfSortBy =
  | "recent"
  | "title_asc"
  | "author_asc"
  | "progress_desc"
  | "added_desc";

export type BookshelfGroupBy = "none" | "author" | "folder" | "tag";

export interface BookRecord {
  id: string;
  fileHash: string;
  filePath: string;
  folderPath: string;
  format: BookFormat;
  title: string;
  author?: string | null;
  publisher?: string | null;
  pageCount?: number | null;
  coverPath?: string | null;
  isFavorite: boolean;
  tags: string[];
  progressPct: number;
  addedAt: string;
  lastOpenedAt?: string | null;
  isTemporary?: boolean;
}

export interface ReadingProgress {
  bookId: string;
  locator: string; // EPUB CFI string or PDF "page:<n>"
  percentage: number;
  pdfPage?: number | null;
  updatedAt: string;
}

/**
 * Percentage-normalized rectangle (0..100 of page viewport width/height)
 * so PDF text-layer highlights scale accurately at any zoom factor.
 */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Annotation {
  id: string;
  bookId: string;
  locator: string; // EPUB CFI range or PDF "page:<n>"
  rectsJson?: string | null; // JSON-encoded NormalizedRect[] for PDF highlights
  selectedText: string;
  note?: string | null;
  color: HighlightColor;
  pageNumber?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Bookmark {
  id: string;
  bookId: string;
  locator: string; // EPUB CFI or PDF "page:<n>"
  pageNumber?: number | null;
  label: string;
  note?: string | null;
  createdAt: string;
}

export interface OneDriveAuthState {
  isConnected: boolean;
  accountEmail?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: string | null;
  lastSyncedAt?: string | null;
}

export interface CloudBackupMetadata {
  backupId: string;
  fileName: string;
  sizeBytes: number;
  lastModifiedAt: string;
  annotationsCount: number;
  booksCount: number;
}

export interface CloudSyncPayload {
  exportedAt: string;
  appVersion: string;
  books: BookRecord[];
  progress: ReadingProgress[];
  annotations: Annotation[];
  bookmarks: Bookmark[];
}
