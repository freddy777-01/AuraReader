import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ePub, { Book as EpubBook, NavItem, Rendition } from "epubjs";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { THEME_PALETTES, useReader } from "../context/ReaderContext";
import {
  Annotation,
  Bookmark,
  HighlightColor,
  MobiDocumentPayload,
  NormalizedRect,
  ThemeMode,
} from "../types/reader";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const HIGHLIGHT_HEX: Record<HighlightColor, string> = {
  amber: "#f59e0b",
  emerald: "#10b981",
  sky: "#0ea5e9",
  rose: "#f43f5e",
};

export interface TocEntry {
  id: string;
  label: string;
  href: string; // EPUB href or PDF "page:<n>"
  pageNumber?: number;
  subitems?: TocEntry[];
}

export interface VirtualPageCard {
  pageNumber: number;
  label: string;
  locator: string; // EPUB CFI / spine href or PDF "page:<n>"
}

function buildEpubContentStylesheet(mode: ThemeMode): string {
  const palette = THEME_PALETTES[mode];
  return `
    html, body {
      background-color: ${palette.bgCard} !important;
      color: ${palette.textPrimary} !important;
      font-family: 'Merriweather', Georgia, serif !important;
      line-height: 1.75 !important;
      padding: 0 12px !important;
      transition: background-color 150ms ease, color 150ms ease !important;
    }
    p, span, div, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6 {
      color: inherit !important;
      background-color: transparent !important;
    }
    a, a:link, a:visited {
      color: ${palette.accent} !important;
    }
    img, svg, video, canvas {
      max-width: 100% !important;
      height: auto !important;
      filter: ${
        mode === "night" ? "brightness(0.92) contrast(1.03)" : "none"
      } !important;
      mix-blend-mode: normal !important;
    }
  `;
}

function resolveTargetPdfPage(
  locator: string,
  explicitPage?: number | null
): number {
  if (explicitPage && explicitPage >= 1) return explicitPage;
  if (locator.startsWith("page:")) {
    const parsed = parseInt(locator.replace("page:", ""), 10);
    if (!Number.isNaN(parsed) && parsed >= 1) return parsed;
  }
  return 1;
}

function mapEpubNavItems(items: NavItem[]): TocEntry[] {
  return items.map((item, idx) => ({
    id: item.id || `${item.href}-${idx}`,
    label: item.label.trim(),
    href: item.href,
    subitems: item.subitems ? mapEpubNavItems(item.subitems) : [],
  }));
}

interface ReaderWorkspaceProps {
  onBackToLibrary?: () => void;
  onOpenCloudSettings?: () => void;
}

export const ReaderWorkspace: React.FC<ReaderWorkspaceProps> = ({
  onBackToLibrary,
  onOpenCloudSettings,
}) => {
  const {
    activeBook,
    progress,
    annotations,
    bookmarks,
    activeSelection,
    isDrawerOpen,
    themeMode,
    themePalette,
    fontSizePct,
    readingFlow,
    pageSpread,
    pdfScale,
    pdfSmartInvert,
    updateProgress,
    setActiveSelection,
    createOrUpdateAnnotation,
    removeAnnotation,
    toggleCurrentBookmark,
    removeBookmark,
    setThemeMode,
    setFontSizePct,
    setReadingFlow,
    setPageSpread,
    setPdfScale,
    setPdfSmartInvert,
    setIsDrawerOpen,
  } = useReader();

  const viewportScrollRef = useRef<HTMLElement | null>(null);
  const epubContainerRef = useRef<HTMLDivElement | null>(null);
  const epubBookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const activeThemeRef = useRef<ThemeMode>(themeMode);
  activeThemeRef.current = themeMode;

  const pdfPageWrapperRef = useRef<HTMLDivElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfTextLayerRef = useRef<HTMLDivElement | null>(null);
  const pendingPdfScrollYRef = useRef<number | null>(null);

  const [currentLocator, setCurrentLocator] = useState<string>("");
  const [currentChapterTitle, setCurrentChapterTitle] = useState<string>("");
  const [currentVirtualPage, setCurrentVirtualPage] = useState<number>(1);
  const [totalVirtualPages, setTotalVirtualPages] = useState<number>(1);
  const [pageJumpInput, setPageJumpInput] = useState<string>("1");

  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [virtualPages, setVirtualPages] = useState<VirtualPageCard[]>([]);
  const [mobiPages, setMobiPages] = useState<string[]>([]);

  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [selectedHighlightColor, setSelectedHighlightColor] =
    useState<HighlightColor>("amber");
  const [bookmarkNoteDraft, setBookmarkNoteDraft] = useState<string>("");
  const [showBookmarkPopover, setShowBookmarkPopover] =
    useState<boolean>(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState<boolean>(false);

  const currentVirtualPageRef = useRef<number>(1);
  currentVirtualPageRef.current = currentVirtualPage;
  const currentLocatorRef = useRef<string>("");
  currentLocatorRef.current = currentLocator;
  const annotationsRef = useRef<Annotation[]>(annotations);
  annotationsRef.current = annotations;

  const [drawerTab, setDrawerTab] = useState<
    "toc" | "pages" | "highlights" | "bookmarks"
  >("toc");

  useEffect(() => {
    setPageJumpInput(String(currentVirtualPage));
  }, [currentVirtualPage]);

  // Sync saved reading progress when a book finishes hydrating from SQLite
  useEffect(() => {
    if (!progress || !activeBook) return;
    if (activeBook.format === "EPUB" && renditionRef.current) {
      renditionRef.current.display(progress.locator);
    } else if (activeBook.format === "PDF" || activeBook.format === "MOBI") {
      const savedPage = resolveTargetPdfPage(
        progress.locator,
        progress.pdfPage
      );
      setCurrentVirtualPage(savedPage);
      setCurrentLocator(`page:${savedPage}`);
    }
  }, [progress?.bookId]);

  const activeBookmark = useMemo(
    () => bookmarks.find((b) => b.locator === currentLocator),
    [bookmarks, currentLocator]
  );

  // ==========================================================================
  // Unified Next / Prev Page & Direct Page / Percentage Jump Handlers
  // ==========================================================================
  const handlePrevPage = useCallback(() => {
    if (!activeBook) return;
    if (activeBook.format === "EPUB" && renditionRef.current) {
      renditionRef.current.prev();
    } else if (
      (activeBook.format === "PDF" || activeBook.format === "MOBI") &&
      currentVirtualPage > 1
    ) {
      const prev = Math.max(1, currentVirtualPage - 1);
      setCurrentVirtualPage(prev);
      updateProgress(
        `page:${prev}`,
        (prev / Math.max(1, totalVirtualPages)) * 100,
        prev
      );
    }
  }, [activeBook, currentVirtualPage, totalVirtualPages, updateProgress]);

  const handleNextPage = useCallback(() => {
    if (!activeBook) return;
    if (activeBook.format === "EPUB" && renditionRef.current) {
      renditionRef.current.next();
    } else if (
      (activeBook.format === "PDF" || activeBook.format === "MOBI") &&
      currentVirtualPage < totalVirtualPages
    ) {
      const next = Math.min(totalVirtualPages, currentVirtualPage + 1);
      setCurrentVirtualPage(next);
      updateProgress(
        `page:${next}`,
        (next / Math.max(1, totalVirtualPages)) * 100,
        next
      );
    }
  }, [activeBook, currentVirtualPage, totalVirtualPages, updateProgress]);

  const handleJumpToPageNumber = useCallback(
    (targetPage: number) => {
      if (!activeBook) return;
      const clamped = Math.min(
        Math.max(1, targetPage),
        Math.max(1, totalVirtualPages)
      );
      setCurrentVirtualPage(clamped);

      if (activeBook.format === "PDF" || activeBook.format === "MOBI") {
        setCurrentLocator(`page:${clamped}`);
        updateProgress(
          `page:${clamped}`,
          (clamped / Math.max(1, totalVirtualPages)) * 100,
          clamped
        );
      } else if (activeBook.format === "EPUB" && renditionRef.current) {
        const epubBook = epubBookRef.current;
        const pageCard = virtualPages.find((p) => p.pageNumber === clamped);
        if (pageCard) {
          renditionRef.current.display(pageCard.locator);
        } else if (
          epubBook &&
          epubBook.locations &&
          epubBook.locations.length() > 0
        ) {
          const pct = (clamped - 1) / Math.max(1, totalVirtualPages - 1);
          const cfi = epubBook.locations.cfiFromPercentage(pct);
          if (cfi) renditionRef.current.display(cfi);
        }
      }
    },
    [activeBook, totalVirtualPages, updateProgress, virtualPages]
  );

  // Global keyboard arrow navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        handlePrevPage();
      } else if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        handleNextPage();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlePrevPage, handleNextPage]);

  // ==========================================================================
  // Exact Sidebar Jump Navigation (Highlights, Bookmarks & TOC)
  // ==========================================================================
  const jumpToAnnotation = useCallback(
    async (ann: Annotation) => {
      if (!activeBook) return;
      setFocusedItemId(ann.id);
      setTimeout(() => setFocusedItemId(null), 2200);

      if (activeBook.format === "EPUB" && renditionRef.current) {
        await renditionRef.current.display(ann.locator);
        setCurrentLocator(ann.locator);
      } else if (activeBook.format === "MOBI") {
        const targetPage = resolveTargetPdfPage(ann.locator, ann.pageNumber);
        handleJumpToPageNumber(targetPage);
      } else if (activeBook.format === "PDF") {
        const targetPage = resolveTargetPdfPage(ann.locator, ann.pageNumber);
        let firstRectY: number | null = null;
        if (ann.rectsJson) {
          try {
            const rects = JSON.parse(ann.rectsJson) as NormalizedRect[];
            if (rects.length > 0) firstRectY = rects[0].y;
          } catch {
            firstRectY = null;
          }
        }

        if (targetPage !== currentVirtualPage) {
          pendingPdfScrollYRef.current = firstRectY ?? 0;
          setCurrentVirtualPage(targetPage);
          updateProgress(
            `page:${targetPage}`,
            (targetPage / Math.max(1, totalVirtualPages)) * 100,
            targetPage
          );
        } else if (
          firstRectY !== null &&
          pdfPageWrapperRef.current &&
          viewportScrollRef.current
        ) {
          const pageHeight = pdfPageWrapperRef.current.clientHeight;
          const targetPixelY = (firstRectY / 100) * pageHeight;
          viewportScrollRef.current.scrollTo({
            top: Math.max(0, targetPixelY - 80),
            behavior: "smooth",
          });
        }
      }
    },
    [activeBook, currentVirtualPage, totalVirtualPages, updateProgress]
  );

  const jumpToBookmark = useCallback(
    async (bm: Bookmark) => {
      if (!activeBook) return;
      setFocusedItemId(bm.id);
      setTimeout(() => setFocusedItemId(null), 2200);

      if (activeBook.format === "EPUB" && renditionRef.current) {
        await renditionRef.current.display(bm.locator);
        setCurrentLocator(bm.locator);
      } else if (activeBook.format === "MOBI") {
        const targetPage = resolveTargetPdfPage(bm.locator, bm.pageNumber);
        handleJumpToPageNumber(targetPage);
      } else if (activeBook.format === "PDF") {
        const targetPage = resolveTargetPdfPage(bm.locator, bm.pageNumber);
        pendingPdfScrollYRef.current = 0;
        setCurrentVirtualPage(targetPage);
        updateProgress(
          `page:${targetPage}`,
          (targetPage / Math.max(1, totalVirtualPages)) * 100,
          targetPage
        );
      }
    },
    [activeBook, totalVirtualPages, updateProgress]
  );

  const jumpToTocEntry = useCallback(
    (entry: TocEntry) => {
      if (!activeBook) return;
      if (activeBook.format === "EPUB" && renditionRef.current) {
        renditionRef.current.display(entry.href);
        setCurrentChapterTitle(entry.label);
      } else if (
        (activeBook.format === "PDF" || activeBook.format === "MOBI") &&
        entry.pageNumber
      ) {
        handleJumpToPageNumber(entry.pageNumber);
        setCurrentChapterTitle(entry.label);
      }
    },
    [activeBook, handleJumpToPageNumber]
  );

  // ==========================================================================
  // 0. MOBI Engine: Decompress PalmDOC Records, Paginate & Extract TOC
  // ==========================================================================
  useEffect(() => {
    if (!activeBook || activeBook.format !== "MOBI") {
      setMobiPages([]);
      return;
    }

    let isCancelled = false;
    invoke<MobiDocumentPayload>("load_mobi_book", {
      filePath: activeBook.filePath,
    })
      .then((payload) => {
        if (isCancelled) return;
        const pages = payload.pages.length > 0 ? payload.pages : [""];
        setMobiPages(pages);
        setTotalVirtualPages(pages.length);

        const savedPage = progress
          ? resolveTargetPdfPage(progress.locator, progress.pdfPage)
          : 1;
        const startPage = Math.min(Math.max(1, savedPage), pages.length);
        setCurrentVirtualPage(startPage);
        setCurrentLocator(`page:${startPage}`);

        setVirtualPages(
          pages.map((_, idx) => ({
            pageNumber: idx + 1,
            label: `Page ${idx + 1}`,
            locator: `page:${idx + 1}`,
          }))
        );

        setTocEntries(
          payload.chapters.map((ch) => ({
            id: `mobi-ch-${ch.index}`,
            label: ch.title,
            href: `page:${ch.startPage}`,
            pageNumber: ch.startPage,
          }))
        );
      })
      .catch(console.error);

    return () => {
      isCancelled = true;
    };
  }, [activeBook?.id]);

  // ==========================================================================
  // 1. EPUB.js Engine: TOC Extraction, Locations Generation, Flow & Spreads
  // ==========================================================================
  useEffect(() => {
    if (!activeBook || activeBook.format !== "EPUB" || !epubContainerRef.current)
      return;

    let isDestroyed = false;
    epubContainerRef.current.innerHTML = "";

    const assetUrl = convertFileSrc(activeBook.filePath);
    const book: EpubBook = ePub(assetUrl);
    epubBookRef.current = book;

    const rendition = book.renderTo(epubContainerRef.current, {
      width: "100%",
      height: "100%",
      flow: readingFlow === "scrolled" ? "scrolled-doc" : "paginated",
      spread:
        readingFlow === "scrolled"
          ? "none"
          : pageSpread === "single"
          ? "none"
          : "auto",
    });
    renditionRef.current = rendition;

    const applyEpubHighlights = (targetRendition: Rendition) => {
      annotationsRef.current.forEach((ann) => {
        try {
          targetRendition.annotations.remove(ann.locator, "highlight");
        } catch {
          // Ignore if not yet registered
        }
        try {
          targetRendition.annotations.add(
            "highlight",
            ann.locator,
            { id: ann.id },
            undefined,
            "aura-epub-highlight",
            {
              fill: HIGHLIGHT_HEX[ann.color],
              "fill-opacity":
                activeThemeRef.current === "night" ? "0.42" : "0.35",
              "mix-blend-mode":
                activeThemeRef.current === "night" ? "screen" : "multiply",
            }
          );
        } catch {
          // Ignore invalid CFI range
        }
      });
    };

    const captureEpubSelectionFromContents = (
      contents: any,
      fallbackCfi?: string,
      mouseEvent?: MouseEvent
    ): boolean => {
      const win = contents?.window as Window | undefined;
      const sel = win?.getSelection?.();
      const range =
        sel && !sel.isCollapsed && sel.rangeCount > 0
          ? sel.getRangeAt(0)
          : fallbackCfi
          ? contents?.range?.(fallbackCfi)
          : null;

      const text = (sel?.toString() || range?.toString() || "").trim();
      if (!text || !range) return false;

      let cfiRange = fallbackCfi || "";
      if (!cfiRange) {
        try {
          cfiRange = contents.cfiFromRange(range);
        } catch {
          cfiRange = currentLocatorRef.current || "";
        }
      }
      if (!cfiRange) return false;

      const containerRect =
        epubContainerRef.current?.getBoundingClientRect() ?? {
          left: 160,
          top: 80,
          right: window.innerWidth - 40,
          bottom: window.innerHeight - 60,
          width: window.innerWidth - 200,
          height: window.innerHeight - 140,
        };

      const rect = range.getBoundingClientRect();
      const iframeEl = contents?.document?.defaultView
        ?.frameElement as HTMLElement | null;
      const iframeRect = iframeEl?.getBoundingClientRect() ?? containerRect;

      const rawX =
        mouseEvent &&
        typeof mouseEvent.clientX === "number" &&
        mouseEvent.clientX > 0
          ? iframeRect.left + mouseEvent.clientX
          : iframeRect.left + rect.left + rect.width / 2;
      const rawY =
        mouseEvent &&
        typeof mouseEvent.clientY === "number" &&
        mouseEvent.clientY > 0
          ? iframeRect.top + mouseEvent.clientY - 16
          : iframeRect.top + rect.top - 14;

      const minX = Math.max(210, containerRect.left + 140);
      const maxX = Math.min(window.innerWidth - 210, containerRect.right - 140);
      const clampedX = Math.max(minX, Math.min(maxX, rawX));

      const minY = Math.max(76, containerRect.top + 42);
      const maxY = Math.min(
        window.innerHeight - 76,
        containerRect.bottom - 42
      );
      const clampedY = Math.max(minY, Math.min(maxY, rawY));

      setActiveSelection({
        locator: cfiRange,
        text,
        pageNumber: currentVirtualPageRef.current,
        popoverPosition: {
          x: clampedX,
          y: clampedY,
        },
      });
      return true;
    };

    rendition.hooks.content.register((contents: any) => {
      const doc: Document = contents.document;
      let styleEl = doc.getElementById(
        "aura-theme-style"
      ) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = doc.createElement("style");
        styleEl.id = "aura-theme-style";
        doc.head.appendChild(styleEl);
      }
      styleEl.textContent = buildEpubContentStylesheet(activeThemeRef.current);

      // Listen directly inside the EPUB iframe for text selection & right-click
      doc.addEventListener("mouseup", (e: MouseEvent) => {
        setTimeout(() => {
          captureEpubSelectionFromContents(contents, undefined, e);
        }, 25);
      });

      doc.addEventListener("contextmenu", (e: MouseEvent) => {
        const hasSelection = captureEpubSelectionFromContents(
          contents,
          undefined,
          e
        );
        if (hasSelection) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
    });

    rendition.on("rendered", () => {
      if (!isDestroyed) {
        applyEpubHighlights(rendition);
      }
    });

    rendition.themes.fontSize(`${fontSizePct}%`);
    rendition.display(progress?.locator || undefined);

    // Extract Table of Contents (TOC)
    book.loaded.navigation.then((nav) => {
      if (isDestroyed) return;
      const mappedToc = mapEpubNavItems(nav.toc);
      setTocEntries(mappedToc);
    });

    // Generate indexed EPUB locations so percentage (0..100%) and virtual pages work accurately
    book.ready
      .then(() => book.locations.generate(1200))
      .then((locations: string[]) => {
        if (isDestroyed) return;
        const total = Math.max(1, locations.length);
        setTotalVirtualPages(total);
        const cards: VirtualPageCard[] = locations.map((cfi, i) => ({
          pageNumber: i + 1,
          label: `Page ${i + 1}`,
          locator: cfi,
        }));
        setVirtualPages(cards);
      })
      .catch(() => {
        // Fallback to spine sections if locations fail
        const spineItems = (book.spine as any)?.spineItems ?? [];
        const total = Math.max(1, spineItems.length);
        setTotalVirtualPages(total);
        setVirtualPages(
          spineItems.map((item: any, i: number) => ({
            pageNumber: i + 1,
            label: `Section ${i + 1}`,
            locator: item.href,
          }))
        );
      });

    rendition.on("relocated", (location: any) => {
      if (isDestroyed) return;
      const cfi: string = location.start.cfi;
      setCurrentLocator(cfi);

      let pct = (location.start.percentage ?? 0) * 100;
      if (
        (!pct || Number.isNaN(pct)) &&
        book.locations &&
        book.locations.length() > 0
      ) {
        pct = book.locations.percentageFromCfi(cfi) * 100;
      } else if (
        (!pct || Number.isNaN(pct)) &&
        location.start.index !== undefined
      ) {
        const spineLen = Math.max(
          1,
          ((book.spine as any)?.spineItems?.length ?? 1) - 1
        );
        pct = (location.start.index / spineLen) * 100;
      }

      const totalLocs =
        book.locations && book.locations.length() > 0
          ? book.locations.length()
          : Math.max(1, (book.spine as any)?.spineItems?.length ?? 1);
      const locIdx =
        book.locations && book.locations.length() > 0
          ? book.locations.locationFromCfi(cfi)
          : location.start.index ?? 0;

      const currentPageNum = Math.min(
        totalLocs,
        Math.max(1, (typeof locIdx === "number" ? locIdx : 0) + 1)
      );
      setCurrentVirtualPage(currentPageNum);
      setTotalVirtualPages(totalLocs);

      updateProgress(cfi, Math.max(0, Math.min(100, pct || 0)));
    });

    // Enable keyboard arrow navigation inside the EPUB iframe
    rendition.on("keyup", (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") rendition.prev();
      if (e.key === "ArrowRight") rendition.next();
    });

    rendition.on("selected", (cfiRange: string, contents: any) => {
      captureEpubSelectionFromContents(contents, cfiRange);
    });

    return () => {
      isDestroyed = true;
      book.destroy();
      epubBookRef.current = null;
      renditionRef.current = null;
    };
  }, [activeBook?.id, readingFlow, pageSpread]);

  // Synchronize live theme & font-size updates across mounted EPUB iframe contents
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || activeBook?.format !== "EPUB") return;

    rendition.themes.fontSize(`${fontSizePct}%`);
    const contentsList = (rendition as any).getContents?.() ?? [];
    contentsList.forEach((contents: any) => {
      const doc: Document = contents.document;
      let styleEl = doc.getElementById(
        "aura-theme-style"
      ) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = doc.createElement("style");
        styleEl.id = "aura-theme-style";
        doc.head.appendChild(styleEl);
      }
      styleEl.textContent = buildEpubContentStylesheet(themeMode);
    });
  }, [themeMode, fontSizePct, activeBook?.format]);

  // Paint saved SQLite highlights onto EPUB CFI ranges
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || activeBook?.format !== "EPUB") return;

    annotations.forEach((ann) => {
      try {
        rendition.annotations.remove(ann.locator, "highlight");
      } catch {
        // Ignore if not yet registered
      }
      try {
        rendition.annotations.add(
          "highlight",
          ann.locator,
          { id: ann.id },
          undefined,
          "aura-epub-highlight",
          {
            fill: HIGHLIGHT_HEX[ann.color],
            "fill-opacity":
              focusedItemId === ann.id
                ? "0.68"
                : themeMode === "night"
                ? "0.42"
                : "0.35",
            "mix-blend-mode": themeMode === "night" ? "screen" : "multiply",
          }
        );
      } catch {
        // Ignore invalid CFI range
      }
    });
  }, [annotations, activeBook?.format, themeMode, focusedItemId]);

  // ==========================================================================
  // 2. PDF.js Engine: Metadata/Outline TOC, Page Cards & Text Layer
  // ==========================================================================
  useEffect(() => {
    if (!activeBook || activeBook.format !== "PDF") return;

    let isCancelled = false;
    const initPdfMetadata = async () => {
      const assetUrl = convertFileSrc(activeBook.filePath);
      const pdfDoc = await pdfjsLib.getDocument(assetUrl).promise;
      if (isCancelled) return;

      const numPages = pdfDoc.numPages;
      setTotalVirtualPages(numPages);

      // Populate Pages Grid view
      const cards: VirtualPageCard[] = Array.from(
        { length: numPages },
        (_, idx) => ({
          pageNumber: idx + 1,
          label: `Page ${idx + 1}`,
          locator: `page:${idx + 1}`,
        })
      );
      setVirtualPages(cards);

      // Extract PDF Outline (Table of Contents) if embedded
      const outline = await pdfDoc.getOutline();
      if (!isCancelled && outline && outline.length > 0) {
        const resolvedToc: TocEntry[] = [];
        for (let i = 0; i < outline.length; i++) {
          const item = outline[i];
          let pageNum = 1;
          try {
            const dest =
              typeof item.dest === "string"
                ? await pdfDoc.getDestination(item.dest)
                : item.dest;
            if (Array.isArray(dest) && dest[0]) {
              const pageIdx = await pdfDoc.getPageIndex(dest[0]);
              pageNum = pageIdx + 1;
            }
          } catch {
            pageNum = i + 1;
          }
          resolvedToc.push({
            id: `pdf-toc-${i}`,
            label: item.title || `Section ${i + 1}`,
            href: `page:${pageNum}`,
            pageNumber: pageNum,
          });
        }
        setTocEntries(resolvedToc);
      } else if (!isCancelled) {
        setTocEntries([]);
      }
    };

    initPdfMetadata();
    return () => {
      isCancelled = true;
    };
  }, [activeBook?.id]);

  useEffect(() => {
    if (
      !activeBook ||
      activeBook.format !== "PDF" ||
      !pdfCanvasRef.current ||
      !pdfTextLayerRef.current
    )
      return;

    let isCancelled = false;
    const targetPage = currentVirtualPage;
    setCurrentLocator(`page:${targetPage}`);

    const renderPdfWithTextLayer = async () => {
      const assetUrl = convertFileSrc(activeBook.filePath);
      const pdfDoc = await pdfjsLib.getDocument(assetUrl).promise;
      if (isCancelled) return;

      const clampedPage = Math.min(Math.max(1, targetPage), pdfDoc.numPages);
      const page = await pdfDoc.getPage(clampedPage);
      const viewport = page.getViewport({ scale: pdfScale });

      const offscreen = document.createElement("canvas");
      offscreen.width = viewport.width;
      offscreen.height = viewport.height;
      const offCtx = offscreen.getContext("2d")!;

      await page.render({ canvasContext: offCtx, viewport }).promise;
      if (isCancelled || !pdfCanvasRef.current || !pdfTextLayerRef.current)
        return;

      const visibleCanvas = pdfCanvasRef.current;
      visibleCanvas.width = viewport.width;
      visibleCanvas.height = viewport.height;
      visibleCanvas.getContext("2d")!.drawImage(offscreen, 0, 0);

      const textLayerDiv = pdfTextLayerRef.current;
      textLayerDiv.innerHTML = "";
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;

      const textContent = await page.getTextContent();
      if (isCancelled) return;

      const textLayer = new TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      await textLayer.render();

      if (
        pendingPdfScrollYRef.current !== null &&
        viewportScrollRef.current &&
        pdfPageWrapperRef.current
      ) {
        const yPct = pendingPdfScrollYRef.current;
        pendingPdfScrollYRef.current = null;
        const targetPixelY =
          (yPct / 100) * pdfPageWrapperRef.current.clientHeight;
        viewportScrollRef.current.scrollTo({
          top: Math.max(0, targetPixelY - 80),
          behavior: "smooth",
        });
      }
    };

    renderPdfWithTextLayer();
    return () => {
      isCancelled = true;
    };
  }, [activeBook?.id, currentVirtualPage, pdfScale]);

  const handlePdfMouseUp = () => {
    if (activeBook?.format !== "PDF" || !pdfPageWrapperRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    const range = selection.getRangeAt(0);
    const wrapperRect = pdfPageWrapperRef.current.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects());

    const normalizedRects: NormalizedRect[] = clientRects
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({
        x: ((r.left - wrapperRect.left) / wrapperRect.width) * 100,
        y: ((r.top - wrapperRect.top) / wrapperRect.height) * 100,
        width: (r.width / wrapperRect.width) * 100,
        height: (r.height / wrapperRect.height) * 100,
      }));

    if (normalizedRects.length === 0) return;

    const firstRect = clientRects[0];
    setActiveSelection({
      locator: `page:${currentVirtualPage}`,
      text: selectedText,
      pageNumber: currentVirtualPage,
      rects: normalizedRects,
      popoverPosition: {
        x: firstRect.left + firstRect.width / 2,
        y: Math.max(64, firstRect.top - 12),
      },
    });

    selection.removeAllRanges();
  };

  const currentPagePdfAnnotations = useMemo(() => {
    if (activeBook?.format !== "PDF") return [];
    return annotations
      .filter((a) => a.pageNumber === currentVirtualPage && a.rectsJson)
      .map((a) => ({
        ...a,
        rects: JSON.parse(a.rectsJson!) as NormalizedRect[],
      }));
  }, [annotations, activeBook?.format, currentVirtualPage]);

  if (!activeBook) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)] text-sm text-[var(--text-secondary)]">
        Select a book from the Bookshelf to begin reading.
      </div>
    );
  }

  const displayPercentage = Math.round(
    progress?.percentage ||
      (totalVirtualPages > 1
        ? ((currentVirtualPage - 1) / (totalVirtualPages - 1)) * 100
        : 0)
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] transition-colors duration-200">
      {/* Main Reading Column */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Clean Minimalist Reader Header */}
        <header className="relative z-40 flex h-13 shrink-0 items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-card)] px-4">
          {/* Left: Back to Bookshelf + Book Title */}
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {onBackToLibrary && (
              <button
                onClick={onBackToLibrary}
                title="Back to Bookshelf Library"
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--accent)]"
              >
                <span>←</span>
                <span className="hidden sm:inline">Library</span>
              </button>
            )}

            <span className="shrink-0 rounded bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-bold text-[var(--accent)]">
              {activeBook.format}
            </span>

            <div className="min-w-0 flex-1">
              <h1
                title={activeBook.title}
                className="truncate font-[family-name:var(--font-serif)] text-xs font-semibold sm:text-sm"
              >
                {activeBook.title}
              </h1>
              {currentChapterTitle && (
                <p className="truncate text-[10px] text-[var(--text-secondary)]">
                  {currentChapterTitle}
                </p>
              )}
            </div>
          </div>

          {/* Right: Bookmark, Contents/Pages/Notebook Drawer Toggle, & Unified Settings Menu */}
          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            {/* Quick-Toggle Bookmark Button + Optional Note Popover */}
            <div className="relative flex shrink-0 items-center">
              <button
                onClick={() => {
                  if (!currentLocator) return;
                  const defaultLabel =
                    activeBook.format === "PDF"
                      ? `Page ${currentVirtualPage}`
                      : `Page ${currentVirtualPage} (${displayPercentage}%)`;
                  toggleCurrentBookmark({
                    locator: currentLocator,
                    pageNumber: currentVirtualPage,
                    label: defaultLabel,
                  });
                }}
                className={`flex items-center gap-1 rounded-l-lg border px-2.5 py-1 text-xs font-medium transition ${
                  activeBookmark
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                    : "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--accent)]"
                }`}
              >
                <span>{activeBookmark ? "★ Bookmarked" : "☆ Bookmark"}</span>
              </button>
              <button
                title="Add or edit bookmark note"
                onClick={() => {
                  setBookmarkNoteDraft(activeBookmark?.note ?? "");
                  setShowBookmarkPopover(!showBookmarkPopover);
                  setShowSettingsMenu(false);
                }}
                className="rounded-r-lg border border-l-0 border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                ✎
              </button>

              {showBookmarkPopover && (
                <div className="absolute top-10 right-0 z-50 w-64 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 shadow-2xl">
                  <p className="mb-2 text-xs font-semibold text-[var(--text-primary)]">
                    Bookmark Location Note
                  </p>
                  <textarea
                    rows={2}
                    value={bookmarkNoteDraft}
                    onChange={(e) => setBookmarkNoteDraft(e.target.value)}
                    placeholder="Optional note for this bookmark..."
                    className="w-full rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] p-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => setShowBookmarkPopover(false)}
                      className="px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        if (!currentLocator) return;
                        const label = `Page ${currentVirtualPage} (${displayPercentage}%)`;
                        await toggleCurrentBookmark({
                          locator: currentLocator,
                          pageNumber: currentVirtualPage,
                          label,
                          note: bookmarkNoteDraft,
                        });
                        setShowBookmarkPopover(false);
                      }}
                      className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-[var(--accent-hover)]"
                    >
                      Save Bookmark
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Drawer Buttons: Contents, Pages, Highlights */}
            <button
              onClick={() => {
                if (isDrawerOpen && drawerTab === "toc") {
                  setIsDrawerOpen(false);
                } else {
                  setDrawerTab("toc");
                  setIsDrawerOpen(true);
                }
              }}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                isDrawerOpen && (drawerTab === "toc" || drawerTab === "pages")
                  ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--accent)]"
              }`}
            >
              ☰ Contents & Pages
            </button>

            <button
              onClick={() => {
                if (
                  isDrawerOpen &&
                  (drawerTab === "highlights" || drawerTab === "bookmarks")
                ) {
                  setIsDrawerOpen(false);
                } else {
                  setDrawerTab("highlights");
                  setIsDrawerOpen(true);
                }
              }}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                isDrawerOpen &&
                (drawerTab === "highlights" || drawerTab === "bookmarks")
                  ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--accent)]"
              }`}
            >
              Notebook ({annotations.length + bookmarks.length})
            </button>

            {/* Unified Reader Settings Menu (Aa / ⚙) */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSettingsMenu(!showSettingsMenu);
                  setShowBookmarkPopover(false);
                }}
                title="Reading Appearance, Navigation Mode & Settings"
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                  showSettingsMenu
                    ? "border-[var(--accent)] bg-[var(--accent)] text-slate-950"
                    : "border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--accent)]"
                }`}
              >
                <span>Aa</span>
                <span>⚙</span>
              </button>

              {showSettingsMenu && (
                <div className="absolute top-10 right-0 z-50 w-72 space-y-4 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-2">
                    <span className="text-xs font-bold tracking-wider uppercase">
                      Reader Settings
                    </span>
                    <button
                      onClick={() => setShowSettingsMenu(false)}
                      className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      ✕
                    </button>
                  </div>

                  {/* 1. Theme Mode */}
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text-secondary)]">
                      Color Theme
                    </label>
                    <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-[var(--bg-elevated)] p-1">
                      {(["light", "sepia", "night"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setThemeMode(mode)}
                          className={`rounded-lg py-1.5 text-xs font-semibold capitalize transition ${
                            themeMode === mode
                              ? "bg-[var(--accent)] text-slate-950 shadow-xs"
                              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 2. Navigation / Flow Mode */}
                  {(activeBook.format === "EPUB" ||
                    activeBook.format === "MOBI") && (
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text-secondary)]">
                        Navigation Mode
                      </label>
                      <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[var(--bg-elevated)] p-1">
                        <button
                          onClick={() => setReadingFlow("paginated")}
                          className={`rounded-lg py-1.5 text-xs font-semibold transition ${
                            readingFlow === "paginated"
                              ? "bg-[var(--accent)] text-slate-950"
                              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          Paginated
                        </button>
                        <button
                          onClick={() => setReadingFlow("scrolled")}
                          className={`rounded-lg py-1.5 text-xs font-semibold transition ${
                            readingFlow === "scrolled"
                              ? "bg-[var(--accent)] text-slate-950"
                              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          Continuous Scroll
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 3. Page Spread (Single vs Two-Page) */}
                  {activeBook.format === "EPUB" &&
                    readingFlow === "paginated" && (
                      <div>
                        <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text-secondary)]">
                          Page Layout
                        </label>
                        <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[var(--bg-elevated)] p-1">
                          <button
                            onClick={() => setPageSpread("single")}
                            className={`rounded-lg py-1.5 text-xs font-semibold transition ${
                              pageSpread === "single"
                                ? "bg-[var(--accent)] text-slate-950"
                                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            }`}
                          >
                            Single Page
                          </button>
                          <button
                            onClick={() => setPageSpread("auto")}
                            className={`rounded-lg py-1.5 text-xs font-semibold transition ${
                              pageSpread === "auto"
                                ? "bg-[var(--accent)] text-slate-950"
                                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            }`}
                          >
                            Two-Page Spread
                          </button>
                        </div>
                      </div>
                    )}

                  {/* 4. Font Size / PDF Zoom */}
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold text-[var(--text-secondary)]">
                      {activeBook.format === "PDF"
                        ? `PDF Zoom (${Math.round(pdfScale * 100)}%)`
                        : `Font Size (${fontSizePct}%)`}
                    </label>
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--bg-elevated)] p-1">
                      <button
                        onClick={() => {
                          if (activeBook.format === "PDF") {
                            setPdfScale(
                              Math.max(0.8, Number((pdfScale - 0.15).toFixed(2)))
                            );
                          } else {
                            setFontSizePct(Math.max(75, fontSizePct - 10));
                          }
                        }}
                        className="flex-1 rounded-lg py-1 text-xs font-bold hover:bg-[var(--bg-card)]"
                      >
                        A−
                      </button>
                      <span className="px-2 text-xs font-semibold">
                        {activeBook.format === "PDF"
                          ? `${Math.round(pdfScale * 100)}%`
                          : `${fontSizePct}%`}
                      </span>
                      <button
                        onClick={() => {
                          if (activeBook.format === "PDF") {
                            setPdfScale(
                              Math.min(2.5, Number((pdfScale + 0.15).toFixed(2)))
                            );
                          } else {
                            setFontSizePct(Math.min(175, fontSizePct + 10));
                          }
                        }}
                        className="flex-1 rounded-lg py-1 text-xs font-bold hover:bg-[var(--bg-card)]"
                      >
                        A+
                      </button>
                    </div>
                  </div>

                  {/* 5. PDF Smart Dark Invert Toggle */}
                  {activeBook.format === "PDF" && themeMode === "night" && (
                    <label className="flex cursor-pointer items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">
                        PDF Smart Dark Canvas
                      </span>
                      <input
                        type="checkbox"
                        checked={pdfSmartInvert}
                        onChange={(e) => setPdfSmartInvert(e.target.checked)}
                        className="accent-[var(--accent)]"
                      />
                    </label>
                  )}

                  {/* 6. Cloud Backup Shortcut */}
                  {onOpenCloudSettings && (
                    <div className="border-t border-[var(--border-color)] pt-3">
                      <button
                        onClick={() => {
                          setShowSettingsMenu(false);
                          onOpenCloudSettings();
                        }}
                        className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] py-2 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent)]"
                      >
                        ☁ OneDrive Cloud Backup
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Floating Selection Popover for Instant EPUB, PDF & MOBI Highlighting */}
        {activeSelection && (
          <div
            style={
              activeSelection.popoverPosition
                ? {
                    left: `${activeSelection.popoverPosition.x}px`,
                    top: `${activeSelection.popoverPosition.y}px`,
                  }
                : undefined
            }
            className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-2 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 shadow-2xl"
          >
            <div className="flex items-center gap-1.5">
              {(["amber", "emerald", "sky", "rose"] as HighlightColor[]).map(
                (color) => (
                  <button
                    key={color}
                    title={`Highlight in ${color}`}
                    onClick={() => {
                      setSelectedHighlightColor(color);
                      createOrUpdateAnnotation(
                        activeSelection.locator,
                        activeSelection.text,
                        color,
                        noteDraft || undefined,
                        activeSelection.pageNumber,
                        activeSelection.rects
                      ).then(() => {
                        setNoteDraft("");
                        const contentsList =
                          (renditionRef.current as any)?.getContents?.() ?? [];
                        contentsList.forEach((c: any) =>
                          c.window?.getSelection?.()?.removeAllRanges()
                        );
                      });
                    }}
                    className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                      selectedHighlightColor === color
                        ? "scale-110 ring-2 ring-[var(--text-primary)]"
                        : "border-white/25"
                    }`}
                    style={{ backgroundColor: HIGHLIGHT_HEX[color] }}
                  />
                )
              )}
            </div>

            <input
              type="text"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  createOrUpdateAnnotation(
                    activeSelection.locator,
                    activeSelection.text,
                    selectedHighlightColor,
                    noteDraft || undefined,
                    activeSelection.pageNumber,
                    activeSelection.rects
                  ).then(() => {
                    setNoteDraft("");
                    const contentsList =
                      (renditionRef.current as any)?.getContents?.() ?? [];
                    contentsList.forEach((c: any) =>
                      c.window?.getSelection?.()?.removeAllRanges()
                    );
                  });
                }
              }}
              placeholder="Add note (optional)..."
              className="w-40 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />

            <button
              onClick={() => {
                createOrUpdateAnnotation(
                  activeSelection.locator,
                  activeSelection.text,
                  selectedHighlightColor,
                  noteDraft || undefined,
                  activeSelection.pageNumber,
                  activeSelection.rects
                ).then(() => {
                  setNoteDraft("");
                  const contentsList =
                    (renditionRef.current as any)?.getContents?.() ?? [];
                  contentsList.forEach((c: any) =>
                    c.window?.getSelection?.()?.removeAllRanges()
                  );
                });
              }}
              className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-slate-950 transition hover:bg-[var(--accent-hover)]"
            >
              Highlight
            </button>

            <button
              title="Copy selected text"
              onClick={() => {
                navigator.clipboard?.writeText(activeSelection.text);
                setActiveSelection(null);
              }}
              className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Copy
            </button>

            <button
              onClick={() => setActiveSelection(null)}
              className="px-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              ✕
            </button>
          </div>
        )}

        {/* Document Reading Surface with Left/Right Edge Page-Turn Zones */}
        <main
          ref={viewportScrollRef}
          className="relative flex flex-1 items-start justify-center overflow-auto px-10 py-4"
        >
          {/* Left Margin Click-to-Turn Zone */}
          {readingFlow === "paginated" && (
            <button
              onClick={handlePrevPage}
              title="Previous Page (←)"
              className="group fixed top-16 bottom-14 left-0 z-20 flex w-10 items-center justify-center text-lg text-[var(--text-secondary)] opacity-0 transition hover:bg-[var(--bg-elevated)]/50 hover:opacity-100"
            >
              ‹
            </button>
          )}

          {activeBook.format === "EPUB" ? (
            <div
              ref={epubContainerRef}
              style={{ backgroundColor: themePalette.bgCard }}
              className={`h-full w-full ${
                pageSpread === "single" ? "max-w-3xl" : "max-w-5xl"
              } overflow-hidden rounded-xl border border-[var(--border-color)] shadow-sm transition-colors duration-150`}
            />
          ) : activeBook.format === "MOBI" ? (
            <div
              onContextMenu={(e) => {
                if (window.getSelection()?.toString().trim()) {
                  e.preventDefault();
                }
              }}
              onMouseUp={() => {
                const selection = window.getSelection();
                if (!selection || selection.isCollapsed) return;
                const text = selection.toString().trim();
                if (!text) return;
                const rect = selection.getRangeAt(0).getBoundingClientRect();
                setActiveSelection({
                  locator: `page:${currentVirtualPage}`,
                  text,
                  pageNumber: currentVirtualPage,
                  popoverPosition: {
                    x: Math.max(
                      210,
                      Math.min(window.innerWidth - 210, rect.left + rect.width / 2)
                    ),
                    y: Math.max(76, rect.top - 14),
                  },
                });
              }}
              style={{
                backgroundColor: themePalette.bgCard,
                fontSize: `${fontSizePct}%`,
              }}
              className="w-full max-w-3xl rounded-xl border border-[var(--border-color)] p-8 font-[family-name:var(--font-serif)] leading-relaxed shadow-sm"
            >
              {readingFlow === "scrolled" ? (
                <div className="space-y-8">
                  {mobiPages.map((htmlPage, idx) => (
                    <article
                      key={idx}
                      className="border-b border-[var(--border-color)]/50 pb-6 last:border-none"
                      dangerouslySetInnerHTML={{ __html: htmlPage }}
                    />
                  ))}
                </div>
              ) : (
                <article
                  dangerouslySetInnerHTML={{
                    __html: mobiPages[currentVirtualPage - 1] ?? "",
                  }}
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div
                ref={pdfPageWrapperRef}
                onContextMenu={(e) => {
                  if (window.getSelection()?.toString().trim()) {
                    e.preventDefault();
                  }
                }}
                onMouseUp={handlePdfMouseUp}
                style={{ backgroundColor: themePalette.bgCard }}
                className="relative select-text overflow-hidden rounded-lg border border-[var(--border-color)] shadow-xl"
              >
                <canvas
                  ref={pdfCanvasRef}
                  className="block transition-filter duration-200"
                  style={{
                    filter:
                      themeMode === "night" && pdfSmartInvert
                        ? "invert(0.88) hue-rotate(180deg) contrast(0.96) brightness(0.96)"
                        : themeMode === "sepia"
                        ? "sepia(0.28) brightness(0.97)"
                        : "none",
                  }}
                />

                {/* Persistent PDF Highlight Overlay Layer */}
                <div className="pointer-events-none absolute inset-0 z-10">
                  {currentPagePdfAnnotations.map((ann) =>
                    ann.rects.map((rect, idx) => (
                      <div
                        key={`${ann.id}-${idx}`}
                        style={{
                          left: `${rect.x}%`,
                          top: `${rect.y}%`,
                          width: `${rect.width}%`,
                          height: `${rect.height}%`,
                          backgroundColor: HIGHLIGHT_HEX[ann.color],
                          opacity:
                            focusedItemId === ann.id
                              ? 0.65
                              : themeMode === "night"
                              ? 0.38
                              : 0.32,
                          mixBlendMode:
                            themeMode === "night" ? "screen" : "multiply",
                        }}
                        className={`absolute rounded-[2px] transition-all duration-300 ${
                          focusedItemId === ann.id
                            ? "ring-2 ring-[var(--accent)]"
                            : ""
                        }`}
                      />
                    ))
                  )}
                </div>

                {/* Transparent Selectable PDF.js Text Layer */}
                <div
                  ref={pdfTextLayerRef}
                  className="pdf-text-layer absolute inset-0 z-20 opacity-25 selection:bg-[var(--accent)]/35"
                />
              </div>
            </div>
          )}

          {/* Right Margin Click-to-Turn Zone */}
          {readingFlow === "paginated" && (
            <button
              onClick={handleNextPage}
              title="Next Page (→)"
              className="group fixed top-16 bottom-14 z-20 flex w-10 items-center justify-center text-lg text-[var(--text-secondary)] opacity-0 transition hover:bg-[var(--bg-elevated)]/50 hover:opacity-100"
              style={{ right: isDrawerOpen ? "20rem" : "0" }}
            >
              ›
            </button>
          )}
        </main>

        {/* Bottom Interactive Navigation & Scrubber Bar */}
        <footer className="z-30 flex h-11 shrink-0 items-center justify-between gap-4 border-t border-[var(--border-color)] bg-[var(--bg-card)] px-4 text-xs">
          {/* Prev / Next Buttons */}
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={handlePrevPage}
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-medium hover:border-[var(--accent)]"
            >
              ◀ Prev
            </button>
            <button
              onClick={handleNextPage}
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-medium hover:border-[var(--accent)]"
            >
              Next ▶
            </button>
          </div>

          {/* Interactive Progress Scrubber Slider */}
          <div className="flex flex-1 items-center gap-3">
            <input
              type="range"
              min={1}
              max={Math.max(1, totalVirtualPages)}
              value={currentVirtualPage}
              onChange={(e) => handleJumpToPageNumber(Number(e.target.value))}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-[var(--bg-elevated)] accent-[var(--accent)]"
            />
            <span className="w-10 text-right font-semibold text-[var(--accent)]">
              {displayPercentage}%
            </span>
          </div>

          {/* Direct Page Jump Input ("Page [ 12 ] of 169") */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = parseInt(pageJumpInput, 10);
              if (!Number.isNaN(parsed)) {
                handleJumpToPageNumber(parsed);
              }
            }}
            className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"
          >
            <span>Page</span>
            <input
              type="text"
              value={pageJumpInput}
              onChange={(e) => setPageJumpInput(e.target.value)}
              className="w-12 rounded border border-[var(--border-color)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-center font-semibold text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
            <span>of {totalVirtualPages}</span>
          </form>
        </footer>
      </div>

      {/* Unified Right Inspector Drawer: Contents (TOC) | Pages | Highlights | Bookmarks */}
      {isDrawerOpen && (
        <aside className="flex w-80 shrink-0 flex-col border-l border-[var(--border-color)] bg-[var(--bg-card)]">
          <div className="grid grid-cols-4 border-b border-[var(--border-color)] text-[11px] font-semibold">
            <button
              onClick={() => setDrawerTab("toc")}
              className={`py-3 text-center transition ${
                drawerTab === "toc"
                  ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Contents
            </button>
            <button
              onClick={() => setDrawerTab("pages")}
              className={`py-3 text-center transition ${
                drawerTab === "pages"
                  ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Pages ({totalVirtualPages})
            </button>
            <button
              onClick={() => setDrawerTab("highlights")}
              className={`py-3 text-center transition ${
                drawerTab === "highlights"
                  ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Notes ({annotations.length})
            </button>
            <button
              onClick={() => setDrawerTab("bookmarks")}
              className={`py-3 text-center transition ${
                drawerTab === "bookmarks"
                  ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              Marks ({bookmarks.length})
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {/* TAB 1: TABLE OF CONTENTS */}
            {drawerTab === "toc" && (
              <div className="space-y-1">
                {tocEntries.length === 0 ? (
                  <p className="p-2 text-xs text-[var(--text-secondary)]">
                    No embedded Table of Contents found. Switch to the{" "}
                    <button
                      onClick={() => setDrawerTab("pages")}
                      className="font-semibold text-[var(--accent)] underline"
                    >
                      Pages
                    </button>{" "}
                    tab to browse all pages directly.
                  </p>
                ) : (
                  tocEntries.map((entry) => (
                    <div key={entry.id} className="space-y-1">
                      <button
                        onClick={() => jumpToTocEntry(entry)}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"
                      >
                        <span className="truncate">{entry.label}</span>
                        {entry.pageNumber && (
                          <span className="ml-2 shrink-0 text-[10px] text-[var(--text-secondary)]">
                            p. {entry.pageNumber}
                          </span>
                        )}
                      </button>

                      {entry.subitems && entry.subitems.length > 0 && (
                        <div className="ml-3 space-y-0.5 border-l border-[var(--border-color)] pl-2">
                          {entry.subitems.map((sub) => (
                            <button
                              key={sub.id}
                              onClick={() => jumpToTocEntry(sub)}
                              className="block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"
                            >
                              {sub.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 2: VISUAL PAGES GRID VIEW */}
            {drawerTab === "pages" && (
              <div className="grid grid-cols-3 gap-2">
                {virtualPages.map((pg) => {
                  const isCurrent = pg.pageNumber === currentVirtualPage;
                  const hasHighlight = annotations.some(
                    (a) =>
                      a.pageNumber === pg.pageNumber || a.locator === pg.locator
                  );
                  const hasBookmark = bookmarks.some(
                    (b) =>
                      b.pageNumber === pg.pageNumber || b.locator === pg.locator
                  );

                  return (
                    <button
                      key={pg.pageNumber}
                      onClick={() => handleJumpToPageNumber(pg.pageNumber)}
                      className={`group relative flex h-20 flex-col items-center justify-center rounded-xl border p-2 transition ${
                        isCurrent
                          ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)] shadow-xs"
                          : "border-[var(--border-color)] bg-[var(--bg-elevated)]/50 text-[var(--text-primary)] hover:border-[var(--accent)]"
                      }`}
                    >
                      <span className="font-[family-name:var(--font-serif)] text-sm font-bold">
                        {pg.pageNumber}
                      </span>
                      <span className="mt-0.5 text-[10px] text-[var(--text-secondary)]">
                        Page
                      </span>

                      {/* Indicators for pages with Bookmarks or Highlights */}
                      <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
                        {hasBookmark && (
                          <span
                            title="Bookmarked Page"
                            className="text-[10px] text-[var(--accent)]"
                          >
                            ★
                          </span>
                        )}
                        {hasHighlight && (
                          <span
                            title="Contains Highlights"
                            className="h-2 w-2 rounded-full bg-emerald-500"
                          />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* TAB 3: HIGHLIGHTS & NOTES */}
            {drawerTab === "highlights" && (
              <div className="space-y-2.5">
                {annotations.length === 0 ? (
                  <p className="p-2 text-xs text-[var(--text-secondary)]">
                    Select any text in the EPUB or PDF to save a persistent
                    SQLite highlight.
                  </p>
                ) : (
                  annotations.map((ann) => (
                    <div
                      key={ann.id}
                      onClick={() => jumpToAnnotation(ann)}
                      className={`group cursor-pointer rounded-lg border p-3 transition ${
                        focusedItemId === ann.id
                          ? "border-[var(--accent)] bg-[var(--accent)]/15"
                          : "border-[var(--border-color)] bg-[var(--bg-elevated)]/60 hover:border-[var(--accent)]/60"
                      }`}
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{
                              backgroundColor: HIGHLIGHT_HEX[ann.color],
                            }}
                          />
                          {ann.pageNumber && (
                            <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                              Page {ann.pageNumber}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAnnotation(ann.id);
                          }}
                          className="text-[11px] text-[var(--text-secondary)] opacity-0 transition group-hover:opacity-100 hover:text-rose-500"
                        >
                          Delete
                        </button>
                      </div>
                      <blockquote className="border-l-2 border-[var(--accent)] pl-2.5 font-[family-name:var(--font-serif)] text-xs italic text-[var(--text-primary)]">
                        "{ann.selectedText}"
                      </blockquote>
                      {ann.note && (
                        <p className="mt-2 text-xs text-[var(--text-secondary)]">
                          {ann.note}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 4: BOOKMARKS */}
            {drawerTab === "bookmarks" && (
              <div className="space-y-2.5">
                {bookmarks.length === 0 ? (
                  <p className="p-2 text-xs text-[var(--text-secondary)]">
                    Click the ☆ Bookmark button in the toolbar to bookmark your
                    current reading position.
                  </p>
                ) : (
                  bookmarks.map((bm) => (
                    <div
                      key={bm.id}
                      onClick={() => jumpToBookmark(bm)}
                      className={`group cursor-pointer rounded-lg border p-3 transition ${
                        focusedItemId === bm.id
                          ? "border-[var(--accent)] bg-[var(--accent)]/15"
                          : "border-[var(--border-color)] bg-[var(--bg-elevated)]/60 hover:border-[var(--accent)]/60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--accent)]">
                          ★ {bm.label}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeBookmark(bm.id);
                          }}
                          className="text-[11px] text-[var(--text-secondary)] opacity-0 transition group-hover:opacity-100 hover:text-rose-500"
                        >
                          Remove
                        </button>
                      </div>
                      {bm.note && (
                        <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                          {bm.note}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
};
