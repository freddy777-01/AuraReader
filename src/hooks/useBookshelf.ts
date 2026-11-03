import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BookFormat,
  BookRecord,
  BookshelfGroupBy,
  BookshelfSortBy,
  BookshelfViewMode,
} from "../types/reader";

export interface BookshelfGroup {
  groupTitle: string;
  books: BookRecord[];
}

export function useBookshelf() {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Filter & Sort state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [onlyFavorites, setOnlyFavorites] = useState<boolean>(false);
  const [selectedAuthor, setSelectedAuthor] = useState<string>("ALL");
  const [selectedTag, setSelectedTag] = useState<string>("ALL");
  const [selectedFolder, setSelectedFolder] = useState<string>("ALL");
  const [selectedFormat, setSelectedFormat] = useState<"ALL" | BookFormat>(
    "ALL"
  );
  const [sortBy, setSortBy] = useState<BookshelfSortBy>("recent");
  const [groupBy, setGroupBy] = useState<BookshelfGroupBy>("none");
  const [viewMode, setViewMode] = useState<BookshelfViewMode>("grid");

  const refreshLibrary = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await invoke<BookRecord[]>("get_library_books");
      setBooks(result);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  // Optimistic Favorite toggle backed by SQLite
  const toggleFavorite = useCallback(
    async (bookId: string) => {
      const target = books.find((b) => b.id === bookId);
      if (!target) return;
      const nextFav = !target.isFavorite;

      setBooks((prev) =>
        prev.map((b) =>
          b.id === bookId ? { ...b, isFavorite: nextFav } : b
        )
      );

      await invoke("toggle_book_favorite", {
        bookId,
        isFavorite: nextFav,
      });
    },
    [books]
  );

  // Optimistic Tag addition/removal backed by SQLite
  const addTagToBook = useCallback(
    async (bookId: string, rawTag: string) => {
      const trimmed = rawTag.trim();
      if (!trimmed) return;
      const target = books.find((b) => b.id === bookId);
      if (!target) return;
      if (
        target.tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())
      ) {
        return;
      }

      const nextTags = [...target.tags, trimmed];
      setBooks((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, tags: nextTags } : b))
      );
      await invoke("update_book_tags", { bookId, tags: nextTags });
    },
    [books]
  );

  const removeTagFromBook = useCallback(
    async (bookId: string, tagToRemove: string) => {
      const target = books.find((b) => b.id === bookId);
      if (!target) return;
      const nextTags = target.tags.filter((t) => t !== tagToRemove);

      setBooks((prev) =>
        prev.map((b) => (b.id === bookId ? { ...b, tags: nextTags } : b))
      );
      await invoke("update_book_tags", { bookId, tags: nextTags });
    },
    [books]
  );

  // Distinct facets extracted from the book collection
  const availableAuthors = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => {
      set.add(b.author?.trim() || "Unknown Author");
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [books]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => b.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [books]);

  const availableFolders = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => {
      if (b.folderPath) set.add(b.folderPath);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [books]);

  // Filtered + Sorted collection
  const filteredAndSortedBooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const filtered = books.filter((book) => {
      if (onlyFavorites && !book.isFavorite) return false;
      if (selectedFormat !== "ALL" && book.format !== selectedFormat) {
        return false;
      }

      const normalizedAuthor = book.author?.trim() || "Unknown Author";
      if (selectedAuthor !== "ALL" && normalizedAuthor !== selectedAuthor) {
        return false;
      }

      if (selectedTag !== "ALL" && !book.tags.includes(selectedTag)) {
        return false;
      }

      if (selectedFolder !== "ALL" && book.folderPath !== selectedFolder) {
        return false;
      }

      if (q) {
        const matchesTitle = book.title.toLowerCase().includes(q);
        const matchesAuthor = normalizedAuthor.toLowerCase().includes(q);
        const matchesTag = book.tags.some((t) => t.toLowerCase().includes(q));
        const matchesFolder = book.folderPath.toLowerCase().includes(q);
        if (!matchesTitle && !matchesAuthor && !matchesTag && !matchesFolder) {
          return false;
        }
      }

      return true;
    });

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case "title_asc":
          return a.title.localeCompare(b.title);
        case "author_asc": {
          const authA = a.author?.trim() || "Unknown Author";
          const authB = b.author?.trim() || "Unknown Author";
          return authA.localeCompare(authB) || a.title.localeCompare(b.title);
        }
        case "progress_desc":
          return b.progressPct - a.progressPct;
        case "added_desc":
          return b.addedAt.localeCompare(a.addedAt);
        case "recent":
        default: {
          const dateA = a.lastOpenedAt || a.addedAt;
          const dateB = b.lastOpenedAt || b.addedAt;
          return dateB.localeCompare(dateA);
        }
      }
    });
  }, [
    books,
    searchQuery,
    onlyFavorites,
    selectedFormat,
    selectedAuthor,
    selectedTag,
    selectedFolder,
    sortBy,
  ]);

  // Grouped view sections (None, By Author, By Folder, or By Tag)
  const groupedSections = useMemo<BookshelfGroup[]>(() => {
    if (groupBy === "none") {
      return [{ groupTitle: "All Matching Books", books: filteredAndSortedBooks }];
    }

    const map = new Map<string, BookRecord[]>();
    filteredAndSortedBooks.forEach((book) => {
      if (groupBy === "author") {
        const key = book.author?.trim() || "Unknown Author";
        map.set(key, [...(map.get(key) ?? []), book]);
      } else if (groupBy === "folder") {
        const key = book.folderPath || "Uncategorized Folder";
        map.set(key, [...(map.get(key) ?? []), book]);
      } else if (groupBy === "tag") {
        if (book.tags.length === 0) {
          map.set("Untagged", [...(map.get("Untagged") ?? []), book]);
        } else {
          book.tags.forEach((t) => {
            map.set(t, [...(map.get(t) ?? []), book]);
          });
        }
      }
    });

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([groupTitle, groupBooks]) => ({
        groupTitle,
        books: groupBooks,
      }));
  }, [filteredAndSortedBooks, groupBy]);

  const resetFilters = useCallback(() => {
    setSearchQuery("");
    setOnlyFavorites(false);
    setSelectedAuthor("ALL");
    setSelectedTag("ALL");
    setSelectedFolder("ALL");
    setSelectedFormat("ALL");
  }, []);

  return {
    books,
    filteredAndSortedBooks,
    groupedSections,
    isLoading,
    // Filter & sort states
    searchQuery,
    onlyFavorites,
    selectedAuthor,
    selectedTag,
    selectedFolder,
    selectedFormat,
    sortBy,
    groupBy,
    viewMode,
    // Facet options
    availableAuthors,
    availableTags,
    availableFolders,
    // Setters & actions
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
    refreshLibrary,
    toggleFavorite,
    addTagToBook,
    removeTagFromBook,
  };
}

