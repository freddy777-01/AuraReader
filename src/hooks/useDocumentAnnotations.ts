import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Annotation,
  Bookmark,
  HighlightColor,
  NormalizedRect,
  ReadingProgress,
} from "../types/reader";

/**
 * Dedicated hook & service layer for fetching, caching, and mutating
 * a document's reading progress, highlights (EPUB CFI / PDF bounding boxes),
 * and bookmarks in local SQLite.
 */
export function useDocumentAnnotations(bookId: string | null) {
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const reloadDocumentState = useCallback(async () => {
    if (!bookId) {
      setProgress(null);
      setAnnotations([]);
      setBookmarks([]);
      return;
    }

    setIsLoading(true);
    try {
      const [savedProgress, savedAnnotations, savedBookmarks] =
        await Promise.all([
          invoke<ReadingProgress | null>("get_reading_progress", { bookId }),
          invoke<Annotation[]>("get_book_annotations", { bookId }),
          invoke<Bookmark[]>("get_book_bookmarks", { bookId }),
        ]);
      setProgress(savedProgress);
      setAnnotations(savedAnnotations);
      setBookmarks(savedBookmarks);
    } finally {
      setIsLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    reloadDocumentState();
  }, [reloadDocumentState]);

  const persistProgress = useCallback(
    async (locator: string, percentage: number, pdfPage?: number) => {
      if (!bookId) return;
      const payload: ReadingProgress = {
        bookId,
        locator,
        percentage: Math.min(100, Math.max(0, percentage)),
        pdfPage: pdfPage ?? null,
        updatedAt: new Date().toISOString(),
      };
      setProgress(payload);
      await invoke("save_reading_progress", { progress: payload });
    },
    [bookId]
  );

  const saveHighlight = useCallback(
    async (params: {
      locator: string;
      selectedText: string;
      color: HighlightColor;
      note?: string;
      pageNumber?: number;
      rects?: NormalizedRect[];
      existingId?: string;
    }): Promise<Annotation> => {
      if (!bookId) {
        throw new Error("Cannot save highlight without an active bookId");
      }

      const now = new Date().toISOString();
      const annotation: Annotation = {
        id: params.existingId ?? crypto.randomUUID(),
        bookId,
        locator: params.locator,
        rectsJson: params.rects ? JSON.stringify(params.rects) : null,
        selectedText: params.selectedText,
        note: params.note ?? null,
        color: params.color,
        pageNumber: params.pageNumber ?? null,
        createdAt: now,
        updatedAt: now,
      };

      // Optimistic UI update before SQLite commit
      setAnnotations((prev) => {
        const idx = prev.findIndex((a) => a.id === annotation.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = annotation;
          return copy;
        }
        return [...prev, annotation];
      });

      await invoke("save_annotation", { annotation });
      return annotation;
    },
    [bookId]
  );

  const removeHighlight = useCallback(async (annotationId: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== annotationId));
    await invoke("delete_annotation", { annotationId });
  }, []);

  const toggleBookmark = useCallback(
    async (params: {
      locator: string;
      label: string;
      pageNumber?: number;
      note?: string;
    }): Promise<{ added: boolean; bookmark?: Bookmark }> => {
      if (!bookId) return { added: false };

      const existing = bookmarks.find((b) => b.locator === params.locator);
      if (existing && !params.note) {
        setBookmarks((prev) => prev.filter((b) => b.id !== existing.id));
        await invoke("delete_bookmark", { bookmarkId: existing.id });
        return { added: false };
      }

      const bookmark: Bookmark = {
        id: existing?.id ?? crypto.randomUUID(),
        bookId,
        locator: params.locator,
        pageNumber: params.pageNumber ?? null,
        label: params.label,
        note: params.note ?? existing?.note ?? null,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };

      setBookmarks((prev) => {
        const filtered = prev.filter((b) => b.locator !== bookmark.locator);
        return [bookmark, ...filtered];
      });

      await invoke("save_bookmark", { bookmark });
      return { added: true, bookmark };
    },
    [bookId, bookmarks]
  );

  const removeBookmark = useCallback(async (bookmarkId: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
    await invoke("delete_bookmark", { bookmarkId });
  }, []);

  return {
    progress,
    annotations,
    bookmarks,
    isLoading,
    persistProgress,
    saveHighlight,
    removeHighlight,
    toggleBookmark,
    removeBookmark,
    reloadDocumentState,
  };
}

