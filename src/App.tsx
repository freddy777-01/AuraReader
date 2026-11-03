import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ReaderProvider, useReader } from "./context/ReaderContext";
import { ReaderWorkspace } from "./components/ReaderWorkspace";
import { BookshelfView } from "./components/BookshelfView";
import { CloudBackupSettings } from "./components/CloudBackupSettings";
import { AboutModal } from "./components/AboutModal";
import { useBookshelf } from "./hooks/useBookshelf";
import { BookRecord } from "./types/reader";

const QUICK_HISTORY_STORAGE_KEY = "aura_recent_quick_files";
const OPENED_LIB_STORAGE_KEY = "aura_opened_library_timestamps";

function normalizeFilePath(p: string): string {
  return p.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").toLowerCase();
}

const AuraReaderShell: React.FC = () => {
  const { activeBook, openBook } = useReader();
  const bookshelf = useBookshelf();
  const [activeView, setActiveView] = useState<
    "bookshelf" | "reader" | "settings"
  >("bookshelf");
  const [isLibrarySidebarOpen, setIsLibrarySidebarOpen] = useState(true);
  const [isScanningFolder, setIsScanningFolder] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  // Persistent history of Quick-Opened files (not in Library)
  const [recentQuickFiles, setRecentQuickFiles] = useState<BookRecord[]>(() => {
    try {
      const raw = localStorage.getItem(QUICK_HISTORY_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as BookRecord[]) : [];
    } catch {
      return [];
    }
  });

  // Track explicit open timestamps for Library books
  const [openedLibTimestamps, setOpenedLibTimestamps] = useState<
    Record<string, string>
  >(() => {
    try {
      const raw = localStorage.getItem(OPENED_LIB_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem(
      QUICK_HISTORY_STORAGE_KEY,
      JSON.stringify(recentQuickFiles)
    );
  }, [recentQuickFiles]);

  useEffect(() => {
    localStorage.setItem(
      OPENED_LIB_STORAGE_KEY,
      JSON.stringify(openedLibTimestamps)
    );
  }, [openedLibTimestamps]);

  const recordLibraryBookOpened = (bookId: string) => {
    const now = new Date().toISOString();
    setOpenedLibTimestamps((prev) => ({ ...prev, [bookId]: now }));
  };

  const handleSelectBook = async (book: BookRecord) => {
    if (book.isTemporary) {
      const now = new Date().toISOString();
      const updatedTemp: BookRecord = { ...book, lastOpenedAt: now };
      setRecentQuickFiles((prev) => [
        updatedTemp,
        ...prev.filter(
          (item) =>
            normalizeFilePath(item.filePath) !==
            normalizeFilePath(book.filePath)
        ),
      ]);
      await openBook(updatedTemp);
    } else {
      recordLibraryBookOpened(book.id);
      await openBook(book);
    }
    setActiveView("reader");
    setIsLibrarySidebarOpen(false);
  };

  const handleSwitchView = (nextView: "bookshelf" | "reader" | "settings") => {
    if (nextView === "bookshelf") {
      bookshelf.refreshLibrary();
      setIsLibrarySidebarOpen(true);
    }
    setActiveView(nextView);
  };

  // "+ Open File" in Sidebar -> Opens in Quick-View Mode & records in Recent History
  const handleQuickOpenFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "E-Books & Documents",
          extensions: ["epub", "pdf", "mobi", "azw"],
        },
      ],
    });
    if (typeof selected === "string") {
      const normSelected = normalizeFilePath(selected);
      const existingBook = bookshelf.books.find(
        (b) => normalizeFilePath(b.filePath) === normSelected
      );

      if (existingBook) {
        recordLibraryBookOpened(existingBook.id);
        await openBook(existingBook);
      } else {
        const ext = selected.split(".").pop()?.toLowerCase() || "pdf";
        const format =
          ext === "epub"
            ? "EPUB"
            : ext === "mobi" || ext === "azw"
            ? "MOBI"
            : "PDF";
        const rawFileName =
          selected.replace(/\\/g, "/").split("/").pop() || "Document";
        const cleanTitle = rawFileName.replace(/\.(epub|pdf|mobi|azw)$/i, "");
        const now = new Date().toISOString();

        const tempBook: BookRecord = {
          id: `temp-${Date.now()}`,
          fileHash: "temporary",
          filePath: selected,
          folderPath: "Quick View",
          format,
          title: cleanTitle,
          author: null,
          publisher: null,
          pageCount: null,
          coverPath: null,
          isFavorite: false,
          tags: [],
          progressPct: 0,
          addedAt: now,
          lastOpenedAt: now,
          isTemporary: true,
        };

        setRecentQuickFiles((prev) => [
          tempBook,
          ...prev.filter(
            (item) => normalizeFilePath(item.filePath) !== normSelected
          ),
        ]);
        await openBook(tempBook);
      }
      setActiveView("reader");
      setIsLibrarySidebarOpen(false);
    }
  };

  // "+ Add Book" on Bookshelf -> Directly imports into permanent SQLite Library
  const handleAddBookToLibrary = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "E-Books & Documents",
          extensions: ["epub", "pdf", "mobi", "azw"],
        },
      ],
    });
    if (typeof selected === "string") {
      const savedBook = await invoke<BookRecord>("import_book_file", {
        filePath: selected,
      });
      const normSelected = normalizeFilePath(selected);
      setRecentQuickFiles((prev) =>
        prev.filter((item) => normalizeFilePath(item.filePath) !== normSelected)
      );
      recordLibraryBookOpened(savedBook.id);
      await bookshelf.refreshLibrary();
      await openBook(savedBook);
      setActiveView("reader");
      setIsLibrarySidebarOpen(false);
    }
  };

  const handleRemoveQuickHistoryItem = (
    e: React.MouseEvent,
    filePath: string
  ) => {
    e.stopPropagation();
    const norm = normalizeFilePath(filePath);
    setRecentQuickFiles((prev) =>
      prev.filter((item) => normalizeFilePath(item.filePath) !== norm)
    );
  };

  const handleClearRecentHistory = () => {
    setRecentQuickFiles([]);
    setOpenedLibTimestamps({});
  };

  const handleScanFolder = async (): Promise<number> => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setIsScanningFolder(true);
      try {
        const scanned = await invoke<BookRecord[]>("scan_local_library", {
          directoryPath: dir,
        });
        await bookshelf.refreshLibrary();
        return scanned.length;
      } finally {
        setIsScanningFolder(false);
      }
    }
    return 0;
  };

  // Combine recently opened Library books + Quick-Opened files, sorted by last opened time
  const recentlyOpenedItems = useMemo(() => {
    const libPathSet = new Set(
      bookshelf.books.map((b) => normalizeFilePath(b.filePath))
    );

    const openedLibraryBooks: BookRecord[] = bookshelf.books
      .filter(
        (b) =>
          Boolean(b.lastOpenedAt) ||
          (b.progressPct ?? 0) > 0 ||
          Boolean(openedLibTimestamps[b.id])
      )
      .map((b) => ({
        ...b,
        isTemporary: false,
        lastOpenedAt:
          openedLibTimestamps[b.id] &&
          (!b.lastOpenedAt || openedLibTimestamps[b.id] > b.lastOpenedAt)
            ? openedLibTimestamps[b.id]
            : b.lastOpenedAt || b.addedAt,
      }));

    const validQuickFiles: BookRecord[] = recentQuickFiles
      .filter((q) => !libPathSet.has(normalizeFilePath(q.filePath)))
      .map((q) => ({
        ...q,
        isTemporary: true,
      }));

    return [...openedLibraryBooks, ...validQuickFiles].sort((a, b) => {
      const timeA = a.lastOpenedAt || a.addedAt || "";
      const timeB = b.lastOpenedAt || b.addedAt || "";
      return timeB.localeCompare(timeA);
    });
  }, [bookshelf.books, recentQuickFiles, openedLibTimestamps]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Left Navigation & Quick-Library Rail */}
      <aside
        className={`${
          isLibrarySidebarOpen ? "w-64" : "w-14"
        } flex shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-card)] transition-all duration-200`}
      >
        {/* Brand Header */}
        <div className="flex h-13 items-center justify-between border-b border-[var(--border-color)] px-3.5">
          {isLibrarySidebarOpen && (
            <div className="flex items-center gap-2.5">
              <img
                src="/app-icon.png"
                alt="AuraReader Icon"
                className="h-6 w-6 shrink-0 rounded-md object-contain drop-shadow-xs"
              />
              <span className="text-xs font-bold tracking-wider uppercase">
                AuraReader
              </span>
            </div>
          )}
          <button
            onClick={() => setIsLibrarySidebarOpen(!isLibrarySidebarOpen)}
            title="Toggle Sidebar"
            className="rounded p-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            {isLibrarySidebarOpen ? "◀" : "▶"}
          </button>
        </div>

        {/* Primary View Navigation */}
        <div className="space-y-1 border-b border-[var(--border-color)] p-2">
          <button
            onClick={() => handleSwitchView("bookshelf")}
            title="Bookshelf Library"
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              activeView === "bookshelf"
                ? "bg-[var(--accent)] text-slate-950 shadow-xs"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            }`}
          >
            <span>📚</span>
            {isLibrarySidebarOpen && <span>Bookshelf Library</span>}
          </button>

          {activeBook && (
            <button
              onClick={() => handleSwitchView("reader")}
              title="Now Reading"
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                activeView === "reader"
                  ? "bg-[var(--accent)] text-slate-950 shadow-xs"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span>📖</span>
              {isLibrarySidebarOpen && (
                <span className="truncate">Now Reading</span>
              )}
            </button>
          )}
        </div>

        {isLibrarySidebarOpen && (
          <>
            {/* Single Full-Width + Open File Button (Quick-View by default) */}
            <div className="p-3">
              <button
                onClick={handleQuickOpenFile}
                className="w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-slate-950 shadow-xs transition hover:bg-[var(--accent-hover)]"
              >
                + Open File
              </button>
            </div>

            {/* Recently Opened Header + Clear History Action */}
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-[11px] font-semibold tracking-wider text-[var(--text-secondary)] uppercase">
                Recently Opened ({recentlyOpenedItems.length})
              </span>
              {recentQuickFiles.length > 0 && (
                <button
                  onClick={handleClearRecentHistory}
                  title="Clear quick-opened file history"
                  className="text-[10px] font-semibold text-[var(--text-secondary)] transition hover:text-rose-500"
                >
                  Clear Quick
                </button>
              )}
            </div>

            {/* Recently Opened List (Differentiating Library vs Quick-Opened Files) */}
            <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
              {recentlyOpenedItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border-color)] p-4 text-center text-[11px] text-[var(--text-secondary)]">
                  No recently opened files yet. Open a book from your Bookshelf
                  or click <strong>+ Open File</strong> for quick viewing.
                </div>
              ) : (
                recentlyOpenedItems.map((book) => {
                  const isSelected =
                    activeBook &&
                    normalizeFilePath(activeBook.filePath) ===
                      normalizeFilePath(book.filePath) &&
                    activeView === "reader";

                  return (
                    <div
                      key={book.id}
                      onClick={() => handleSelectBook(book)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          handleSelectBook(book);
                        }
                      }}
                      className={`group flex w-full cursor-pointer flex-col items-start rounded-xl border px-3 py-2 text-left transition ${
                        isSelected
                          ? "border-[var(--accent)]/50 bg-[var(--accent)]/15 text-[var(--accent)]"
                          : "border-transparent hover:border-[var(--border-color)] hover:bg-[var(--bg-elevated)]"
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-1.5">
                        <span className="truncate text-xs font-semibold">
                          {book.isFavorite ? "★ " : ""}
                          {book.title}
                        </span>

                        {book.isTemporary ? (
                          <button
                            onClick={(e) =>
                              handleRemoveQuickHistoryItem(e, book.filePath)
                            }
                            title="Remove from recent history"
                            className="shrink-0 rounded px-1 py-0.5 text-[10px] text-[var(--text-secondary)] opacity-70 transition hover:bg-rose-500/15 hover:text-rose-500 group-hover:opacity-100"
                          >
                            ✕
                          </button>
                        ) : (
                          <span className="shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-secondary)]">
                            {Math.round(book.progressPct || 0)}%
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex w-full items-center justify-between gap-2">
                        <span className="truncate text-[10px] text-[var(--text-secondary)]">
                          {book.author || book.format}
                        </span>

                        {book.isTemporary ? (
                          <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-sky-500">
                            Quick File
                          </span>
                        ) : (
                          <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-500">
                            In Library
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* Pinned Bottom Settings & About Buttons */}
        <div className="mt-auto flex items-center gap-1.5 border-t border-[var(--border-color)] p-2.5">
          <button
            onClick={() =>
              handleSwitchView(
                activeView === "settings" ? "bookshelf" : "settings"
              )
            }
            title="Settings, Folder Sync & Cloud Backup"
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
              activeView === "settings"
                ? "bg-[var(--accent)] text-slate-950 shadow-xs"
                : "border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--accent)]"
            }`}
          >
            <span>⚙</span>
            {isLibrarySidebarOpen && <span>Settings</span>}
          </button>

          {isLibrarySidebarOpen && (
            <button
              onClick={() => setIsAboutOpen(true)}
              title="About AuraReader"
              className="flex items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              ℹ
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="min-w-0 flex-1 overflow-hidden">
        {activeView === "bookshelf" ? (
          <BookshelfView
            bookshelf={bookshelf}
            onSelectBook={handleSelectBook}
            onImportFile={handleAddBookToLibrary}
            onScanFolder={() => handleSwitchView("settings")}
          />
        ) : activeView === "settings" ? (
          <div className="h-full overflow-y-auto p-6 sm:p-8">
            <CloudBackupSettings
              totalBooksCount={bookshelf.books.length}
              scannedFolders={bookshelf.availableFolders}
              isScanningFolder={isScanningFolder}
              onScanLocalFolder={handleScanFolder}
            />
          </div>
        ) : (
          <ReaderWorkspace
            onBackToLibrary={() => handleSwitchView("bookshelf")}
            onOpenCloudSettings={() => handleSwitchView("settings")}
            onSavedToLibrary={(savedBook) => {
              if (savedBook) {
                const norm = normalizeFilePath(savedBook.filePath);
                setRecentQuickFiles((prev) =>
                  prev.filter(
                    (item) => normalizeFilePath(item.filePath) !== norm
                  )
                );
                recordLibraryBookOpened(savedBook.id);
              }
              bookshelf.refreshLibrary();
            }}
          />
        )}
      </div>

      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
        appName="AuraReader"
        version="v1.0.2"
        creatorName="FEMAG"
      />
    </div>
  );
};

export default function App() {
  return (
    <ReaderProvider>
      <AuraReaderShell />
    </ReaderProvider>
  );
}
