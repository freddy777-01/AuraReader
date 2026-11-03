import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ReaderProvider, useReader } from "./context/ReaderContext";
import { ReaderWorkspace } from "./components/ReaderWorkspace";
import { BookshelfView } from "./components/BookshelfView";
import { CloudBackupSettings } from "./components/CloudBackupSettings";
import { AboutModal } from "./components/AboutModal";
import { useBookshelf } from "./hooks/useBookshelf";
import { BookRecord } from "./types/reader";

const AuraReaderShell: React.FC = () => {
  const { activeBook, openBook } = useReader();
  const bookshelf = useBookshelf();
  const [activeView, setActiveView] = useState<
    "bookshelf" | "reader" | "settings"
  >("bookshelf");
  const [isLibrarySidebarOpen, setIsLibrarySidebarOpen] = useState(true);
  const [isScanningFolder, setIsScanningFolder] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  const handleSelectBook = async (book: BookRecord) => {
    await openBook(book);
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

  const handleImportFile = async () => {
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
      await bookshelf.refreshLibrary();
      await openBook(savedBook);
      setActiveView("reader");
      setIsLibrarySidebarOpen(false);
    }
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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Left Navigation & Quick-Library Rail */}
      <aside
        className={`${
          isLibrarySidebarOpen ? "w-60" : "w-14"
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
            {/* Single Full-Width + Open File Button */}
            <div className="p-3">
              <button
                onClick={handleImportFile}
                className="w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-slate-950 shadow-xs transition hover:bg-[var(--accent-hover)]"
              >
                + Open File
              </button>
            </div>

            <div className="px-3 py-1 text-[11px] font-semibold tracking-wider text-[var(--text-secondary)] uppercase">
              Recent Books ({bookshelf.books.length})
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto p-2">
              {bookshelf.books.map((book) => {
                const isSelected =
                  activeBook?.id === book.id && activeView === "reader";
                return (
                  <button
                    key={book.id}
                    onClick={() => handleSelectBook(book)}
                    className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition ${
                      isSelected
                        ? "border border-[var(--accent)]/40 bg-[var(--accent)]/15 text-[var(--accent)]"
                        : "hover:bg-[var(--bg-elevated)]"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold">
                        {book.isFavorite ? "★ " : ""}
                        {book.title}
                      </span>
                      <span className="shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-secondary)]">
                        {Math.round(book.progressPct || 0)}%
                      </span>
                    </div>
                    {book.author && (
                      <span className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                        {book.author}
                      </span>
                    )}
                  </button>
                );
              })}
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
            onImportFile={handleImportFile}
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
          />
        )}
      </div>

      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
        appName="AuraReader"
        version="v1.0.0"
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
