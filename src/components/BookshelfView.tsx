import React, { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  BookFormat,
  BookRecord,
  BookshelfGroupBy,
  BookshelfSortBy,
} from "../types/reader";
import { useBookshelf } from "../hooks/useBookshelf";
import { useReader } from "../context/ReaderContext";

interface BookshelfViewProps {
  bookshelf: ReturnType<typeof useBookshelf>;
  onSelectBook: (book: BookRecord) => void;
  onImportFile: () => void;
  onScanFolder: () => void;
}

const COVER_GRADIENTS = [
  "from-amber-600 via-orange-700 to-slate-950",
  "from-slate-700 via-slate-800 to-slate-950",
  "from-emerald-700 via-teal-800 to-slate-950",
  "from-sky-700 via-indigo-800 to-slate-950",
  "from-rose-700 via-amber-800 to-slate-950",
];

function getGradientForHash(hash: string): string {
  const code = hash.charCodeAt(0) + (hash.charCodeAt(1) || 0);
  return COVER_GRADIENTS[code % COVER_GRADIENTS.length];
}

function getFolderDisplayName(folderPath: string): string {
  if (!folderPath) return "Local Root";
  const clean = folderPath.replace(/^\\\\\?\\/, "");
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2
    ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
    : parts[parts.length - 1] || clean;
}

export const BookshelfView: React.FC<BookshelfViewProps> = ({
  bookshelf,
  onSelectBook,
  onImportFile,
  onScanFolder,
}) => {
  const { themeMode, setThemeMode } = useReader();
  const {
    books,
    filteredAndSortedBooks,
    groupedSections,
    searchQuery,
    onlyFavorites,
    selectedAuthor,
    selectedTag,
    selectedFolder,
    selectedFormat,
    sortBy,
    groupBy,
    viewMode,
    availableAuthors,
    availableTags,
    availableFolders,
    setSearchQuery,
    setOnlyFavorites,
    setSelectedAuthor,
    setSelectedTag,
    setSelectedFolder,
    setSelectedFormat,
    setSortBy,
    setGroupBy,
    setViewMode,
    resetFilters,
    toggleFavorite,
    addTagToBook,
    removeTagFromBook,
  } = bookshelf;

  const [activeTagInputBookId, setActiveTagInputBookId] = useState<
    string | null
  >(null);
  const [newTagDraft, setNewTagDraft] = useState<string>("");

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    onlyFavorites ||
    selectedAuthor !== "ALL" ||
    selectedTag !== "ALL" ||
    selectedFolder !== "ALL" ||
    selectedFormat !== "ALL";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Minimalist Top Toolbar: Search, View Toggles, Sort & Theme */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-card)] px-6 py-3.5">
        <div className="flex items-center gap-3">
          <h1 className="font-[family-name:var(--font-serif)] text-base font-bold tracking-tight">
            Bookshelf
          </h1>
          <span className="rounded-full bg-[var(--accent)]/15 px-2.5 py-0.5 text-xs font-semibold text-[var(--accent)]">
            {filteredAndSortedBooks.length} of {books.length}
          </span>
        </div>

        {/* Search Input */}
        <div className="relative max-w-md min-w-[220px] flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, author, #tag, or folder..."
            className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1.5 pr-8 pl-3.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] transition focus:border-[var(--accent)] focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              ✕
            </button>
          )}
        </div>

        {/* Right Controls: Sort Dropdown, Group By, Grid/List Toggle & Theme */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as BookshelfSortBy)}
            className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="recent">Sort: Recently Read</option>
            <option value="title_asc">Sort: Title (A–Z)</option>
            <option value="author_asc">Sort: Author (A–Z)</option>
            <option value="progress_desc">Sort: Reading Progress (%)</option>
            <option value="added_desc">Sort: Date Added</option>
          </select>

          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as BookshelfGroupBy)}
            className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="none">Group: None</option>
            <option value="author">Group by Author</option>
            <option value="folder">Group by Folder</option>
            <option value="tag">Group by Tag</option>
          </select>

          {/* Grid vs. List View Toggle */}
          <div className="flex items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                viewMode === "grid"
                  ? "bg-[var(--accent)] text-slate-950 shadow-xs"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              ⊞ Grid
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                viewMode === "list"
                  ? "bg-[var(--accent)] text-slate-950 shadow-xs"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              ☰ List
            </button>
          </div>

          {/* Theme Switcher */}
          <div className="flex items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] p-0.5">
            {(["light", "sepia", "night"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setThemeMode(mode)}
                className={`rounded-md px-2 py-1 text-xs font-medium capitalize transition ${
                  themeMode === mode
                    ? "bg-[var(--accent)] font-semibold text-slate-950"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <button
            onClick={onImportFile}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-xs transition hover:bg-[var(--accent-hover)]"
          >
            + Add Book
          </button>
        </div>
      </header>

      {/* Secondary Filter Bar: Favorites, Format, Author, Tag, Folder */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-elevated)]/60 px-6 py-2.5 text-xs">
        <button
          onClick={() => setOnlyFavorites(!onlyFavorites)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition ${
            onlyFavorites
              ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
              : "border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <span>{onlyFavorites ? "★" : "☆"}</span>
          <span>Favorites</span>
        </button>

        {(["ALL", "EPUB", "PDF"] as Array<"ALL" | BookFormat>).map((fmt) => (
          <button
            key={fmt}
            onClick={() => setSelectedFormat(fmt)}
            className={`rounded-full px-2.5 py-1 font-medium transition ${
              selectedFormat === fmt
                ? "bg-[var(--accent)]/15 font-semibold text-[var(--accent)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {fmt === "ALL" ? "All Formats" : fmt}
          </button>
        ))}

        <div className="mx-1 h-4 w-px bg-[var(--border-color)]" />

        <select
          value={selectedAuthor}
          onChange={(e) => setSelectedAuthor(e.target.value)}
          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
        >
          <option value="ALL">All Authors ({availableAuthors.length})</option>
          {availableAuthors.map((author) => (
            <option key={author} value={author}>
              Author: {author}
            </option>
          ))}
        </select>

        <select
          value={selectedTag}
          onChange={(e) => setSelectedTag(e.target.value)}
          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
        >
          <option value="ALL">All Tags ({availableTags.length})</option>
          {availableTags.map((tag) => (
            <option key={tag} value={tag}>
              #{tag}
            </option>
          ))}
        </select>

        <select
          value={selectedFolder}
          onChange={(e) => setSelectedFolder(e.target.value)}
          className="max-w-[220px] truncate rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
        >
          <option value="ALL">All Folders ({availableFolders.length})</option>
          {availableFolders.map((folder) => (
            <option key={folder} value={folder}>
              📁 {getFolderDisplayName(folder)}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="ml-auto text-xs font-semibold text-[var(--accent)] hover:underline"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Main Scrollable Bookshelf Canvas */}
      <div className="flex-1 space-y-8 overflow-y-auto p-6">
        {books.length === 0 ? (
          <div className="mx-auto my-16 flex max-w-md flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--bg-card)] p-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)]/15 text-xl text-[var(--accent)]">
              📚
            </div>
            <h2 className="font-[family-name:var(--font-serif)] text-sm font-semibold">
              Your Bookshelf is Empty
            </h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Import individual EPUB or PDF files or scan a local e-book
              directory to populate your bookshelf with covers and reading
              progress.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={onImportFile}
                className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-slate-950 shadow-xs hover:bg-[var(--accent-hover)]"
              >
                + Open EPUB / PDF
              </button>
              <button
                onClick={onScanFolder}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent)]"
              >
                Scan Local Folder
              </button>
            </div>
          </div>
        ) : filteredAndSortedBooks.length === 0 ? (
          <div className="my-16 text-center text-xs text-[var(--text-secondary)]">
            No books match your active filters.{" "}
            <button
              onClick={resetFilters}
              className="font-semibold text-[var(--accent)] underline"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          groupedSections.map((section) => (
            <section key={section.groupTitle} className="space-y-4">
              {groupBy !== "none" && (
                <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-2">
                  <h2 className="text-xs font-bold tracking-wider text-[var(--text-secondary)] uppercase">
                    {groupBy === "folder"
                      ? `📁 ${getFolderDisplayName(section.groupTitle)}`
                      : groupBy === "tag"
                      ? `#${section.groupTitle}`
                      : section.groupTitle}
                  </h2>
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    {section.books.length}{" "}
                    {section.books.length === 1 ? "book" : "books"}
                  </span>
                </div>
              )}

              {viewMode === "grid" ? (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {section.books.map((book) => {
                    const pct = Math.round(book.progressPct || 0);
                    return (
                      <div
                        key={book.id}
                        onClick={() => onSelectBook(book)}
                        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-xs transition duration-200 hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-lg"
                      >
                        {/* Book Cover Thumbnail Area */}
                        <div
                          className={`relative flex h-52 w-full flex-col justify-between overflow-hidden bg-gradient-to-br p-4 text-white ${getGradientForHash(
                            book.fileHash
                          )}`}
                        >
                          {book.coverPath && (
                            <img
                              src={convertFileSrc(book.coverPath)}
                              alt={book.title}
                              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          )}

                          {/* Top Badges: Format & Favorite Star Button */}
                          <div className="relative z-10 flex items-center justify-between">
                            <span className="rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase backdrop-blur-xs">
                              {book.format}
                            </span>

                            <button
                              title={
                                book.isFavorite
                                  ? "Remove from Favorites"
                                  : "Add to Favorites"
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(book.id);
                              }}
                              className={`flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-xs transition ${
                                book.isFavorite
                                  ? "bg-[var(--accent)] text-slate-950 shadow-sm"
                                  : "bg-black/40 text-white/80 hover:bg-black/65 hover:text-[var(--accent)]"
                              }`}
                            >
                              {book.isFavorite ? "★" : "☆"}
                            </button>
                          </div>

                          {/* Stylized Serif Cover Fallback when no embedded cover */}
                          {!book.coverPath && (
                            <div className="relative z-10 my-auto">
                              <p className="line-clamp-3 font-[family-name:var(--font-serif)] text-sm font-bold leading-snug drop-shadow-xs">
                                {book.title}
                              </p>
                              {book.author && (
                                <p className="mt-1 truncate text-[11px] text-white/80">
                                  {book.author}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Bottom Folder Badge */}
                          <div className="relative z-10 flex items-center justify-between text-[10px] text-white/85">
                            <span className="max-w-full truncate rounded bg-black/45 px-1.5 py-0.5 backdrop-blur-xs">
                              📁 {getFolderDisplayName(book.folderPath)}
                            </span>
                          </div>
                        </div>

                        {/* Card Body: Title, Author, Tags & Progress Bar */}
                        <div className="flex flex-1 flex-col justify-between p-3.5">
                          <div>
                            <h3
                              title={book.title}
                              className="line-clamp-1 font-[family-name:var(--font-serif)] text-xs font-semibold text-[var(--text-primary)]"
                            >
                              {book.title}
                            </h3>
                            <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                              {book.author || "Unknown Author"}
                            </p>

                            {/* Custom User Tags + Inline Add Tag Pill */}
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="mt-2.5 flex flex-wrap items-center gap-1"
                            >
                              {book.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]"
                                >
                                  #{tag}
                                  <button
                                    onClick={() =>
                                      removeTagFromBook(book.id, tag)
                                    }
                                    className="hover:text-rose-500"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}

                              {activeTagInputBookId === book.id ? (
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    addTagToBook(book.id, newTagDraft);
                                    setNewTagDraft("");
                                    setActiveTagInputBookId(null);
                                  }}
                                  className="inline-flex items-center"
                                >
                                  <input
                                    autoFocus
                                    type="text"
                                    value={newTagDraft}
                                    onChange={(e) =>
                                      setNewTagDraft(e.target.value)
                                    }
                                    onBlur={() => setActiveTagInputBookId(null)}
                                    placeholder="tag..."
                                    className="w-16 rounded border border-[var(--accent)] bg-transparent px-1.5 py-0.5 text-[10px] focus:outline-none"
                                  />
                                </form>
                              ) : (
                                <button
                                  onClick={() => {
                                    setNewTagDraft("");
                                    setActiveTagInputBookId(book.id);
                                  }}
                                  className="rounded border border-dashed border-[var(--border-color)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                                >
                                  + Tag
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Reading Progress Bar */}
                          <div className="mt-3.5 pt-2">
                            <div className="mb-1 flex items-center justify-between text-[10px] font-medium text-[var(--text-secondary)]">
                              <span>
                                {pct === 0
                                  ? "Not started"
                                  : pct >= 100
                                  ? "Completed"
                                  : "Reading Progress"}
                              </span>
                              <span className="font-semibold text-[var(--accent)]">
                                {pct}%
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                              <div
                                className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                                style={{
                                  width: `${pct}%`,
                                  boxShadow:
                                    pct > 0
                                      ? "0 0 8px var(--accent-glow)"
                                      : "none",
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-color)] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)]">
                  {section.books.map((book) => {
                    const pct = Math.round(book.progressPct || 0);
                    return (
                      <div
                        key={book.id}
                        onClick={() => onSelectBook(book)}
                        className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 transition hover:bg-[var(--bg-elevated)]"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(book.id);
                            }}
                            className={`text-sm ${
                              book.isFavorite
                                ? "text-[var(--accent)]"
                                : "text-[var(--text-secondary)] hover:text-[var(--accent)]"
                            }`}
                          >
                            {book.isFavorite ? "★" : "☆"}
                          </button>

                          <span className="shrink-0 rounded bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-bold text-[var(--accent)]">
                            {book.format}
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="truncate font-[family-name:var(--font-serif)] text-xs font-semibold text-[var(--text-primary)]">
                              {book.title}
                            </p>
                            <p className="truncate text-[11px] text-[var(--text-secondary)]">
                              {book.author || "Unknown Author"} • 📁{" "}
                              {getFolderDisplayName(book.folderPath)}
                            </p>
                          </div>
                        </div>

                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="hidden flex-wrap items-center gap-1 md:flex"
                        >
                          {book.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] text-[var(--accent)]"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>

                        <div className="flex w-36 shrink-0 items-center gap-2.5">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                            <div
                              className="h-full rounded-full bg-[var(--accent)]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-[11px] font-semibold text-[var(--accent)]">
                            {pct}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
};
