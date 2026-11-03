import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ReaderProvider, useReader } from "./context/ReaderContext";
import { ReaderWorkspace } from "./components/ReaderWorkspace";
import { BookshelfView } from "./components/BookshelfView";
import { CloudBackupSettings } from "./components/CloudBackupSettings";
import { useBookshelf } from "./hooks/useBookshelf";
import { BookRecord } from "./types/reader";

const AuraReaderShell: React.FC = () => {
  const { activeBook, openBook } = useReader();
  const bookshelf = useBookshelf();
  const [activeView, setActiveView] = useState<
    "bookshelf" | "reader" | "cloud"
  >("bookshelf");
  const [isLibrarySidebarOpen, setIsLibrarySidebarOpen] = useState(true);

  const handleSelectBook = async (book: BookRecord) => {
    await openBook(book);
    setActiveView("reader");
    // Auto-collapse the left library rail when entering the reader so the book has full width
    setIsLibrarySidebarOpen(false);
  };

  const handleSwitchView = (nextView: "bookshelf" | "reader" | "cloud") => {
    if (nextView === "bookshelf") {
      bookshelf.refreshLibrary();
      setIsLibrarySidebarOpen(true);
    }
    setActiveView(nextView);
  };

  const handleImportFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "E-Books & Documents", extensions: ["epub", "pdf"] }],
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

  const handleScanFolder = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      await invoke<BookRecord[]>("scan_local_library", { directoryPath: dir });
      await bookshelf.refreshLibrary();
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Left Navigation & Quick-Library Rail */}
      <aside
        className={`${
          isLibrarySidebarOpen ? "w-60" : "w-14"
        } flex shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-card)] transition-all duration-200`}
      >
        <div className="flex h-13 items-center justify-between border-b border-[var(--border-color)] px-3.5">
          {isLibrarySidebarOpen && (
            <div className="flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]"
                style={{ boxShadow: "0 0 8px var(--accent-glow)" }}
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

          <button
            onClick={() =>
              handleSwitchView(activeView === "cloud" ? "bookshelf" : "cloud")
            }
            title="OneDrive Cloud Backup & Settings"
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              activeView === "cloud"
                ? "bg-[var(--accent)] text-slate-950 shadow-xs"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            }`}
          >
            <span>☁</span>
            {isLibrarySidebarOpen && <span>Cloud Backup</span>}
          </button>
        </div>

        {isLibrarySidebarOpen && (
          <>
            <div className="grid grid-cols-2 gap-2 p-3">
              <button
                onClick={handleImportFile}
                className="rounded-lg bg-[var(--accent)] px-2.5 py-2 text-xs font-semibold text-slate-950 shadow-xs transition hover:bg-[var(--accent-hover)]"
              >
                + Open File
              </button>
              <button
                onClick={handleScanFolder}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-2 text-xs font-medium text-[var(--text-primary)] transition hover:border-[var(--accent)]"
              >
                Scan Folder
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
      </aside>

      {/* Main Content Area */}
      <div className="min-w-0 flex-1 overflow-hidden">
        {activeView === "bookshelf" ? (
          <BookshelfView
            bookshelf={bookshelf}
            onSelectBook={handleSelectBook}
            onImportFile={handleImportFile}
            onScanFolder={handleScanFolder}
          />
        ) : activeView === "cloud" ? (
          <div className="flex h-full items-center justify-center p-8">
            <CloudBackupSettings />
          </div>
        ) : (
          <ReaderWorkspace
            onBackToLibrary={() => handleSwitchView("bookshelf")}
            onOpenCloudSettings={() => handleSwitchView("cloud")}
          />
        )}
      </div>
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
