import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Annotation,
  BookRecord,
  Bookmark,
  HighlightColor,
  NormalizedRect,
  ReadingProgress,
  ThemeMode,
} from "../types/reader";
import { useDocumentAnnotations } from "../hooks/useDocumentAnnotations";

export type ReadingFlowMode = "paginated" | "scrolled";
export type PageSpreadMode = "single" | "auto";

export interface ActiveSelection {
  locator: string; // EPUB CFI range or PDF "page:<n>"
  text: string;
  pageNumber?: number;
  rects?: NormalizedRect[]; // Normalized bounding boxes for PDF text selection
  popoverPosition?: { x: number; y: number };
}

export interface ThemePalette {
  bgPrimary: string;
  bgCard: string;
  bgElevated: string;
  borderColor: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentHover: string;
  accentGlow: string;
  shellBg: string;
  canvasBg: string;
  linkColor: string;
}

export const THEME_PALETTES: Record<ThemeMode, ThemePalette> = {
  light: {
    bgPrimary: "#f8fafc",
    bgCard: "#ffffff",
    bgElevated: "#f1f5f9",
    borderColor: "#e2e8f0",
    textPrimary: "#1e293b",
    textSecondary: "#64748b",
    accent: "#f59e0b",
    accentHover: "#d97706",
    accentGlow: "rgba(245, 158, 11, 0.35)",
    shellBg: "#f8fafc",
    canvasBg: "#ffffff",
    linkColor: "#d97706",
  },
  sepia: {
    bgPrimary: "#f4ecd8",
    bgCard: "#f8f1e4",
    bgElevated: "#eadfc8",
    borderColor: "#dccbb0",
    textPrimary: "#433422",
    textSecondary: "#78644c",
    accent: "#d97706",
    accentHover: "#b45309",
    accentGlow: "rgba(217, 119, 6, 0.35)",
    shellBg: "#f4ecd8",
    canvasBg: "#f8f1e4",
    linkColor: "#b45309",
  },
  night: {
    bgPrimary: "#090a0f",
    bgCard: "#10131d",
    bgElevated: "#161a29",
    borderColor: "#1e2438",
    textPrimary: "#f1f5f9",
    textSecondary: "#94a3b8",
    accent: "#f59e0b",
    accentHover: "#fbbf24",
    accentGlow: "rgba(255, 183, 3, 0.4)",
    shellBg: "#090a0f",
    canvasBg: "#10131d",
    linkColor: "#fbbf24",
  },
};

interface ReaderContextValue {
  // Active document & hydrated SQLite state
  activeBook: BookRecord | null;
  progress: ReadingProgress | null;
  annotations: Annotation[];
  bookmarks: Bookmark[];
  activeSelection: ActiveSelection | null;
  isDrawerOpen: boolean;

  // Synchronized Global Night Mode, Typography & Flow Settings
  themeMode: ThemeMode;
  themePalette: ThemePalette;
  fontSizePct: number;
  readingFlow: ReadingFlowMode;
  pageSpread: PageSpreadMode;
  pdfScale: number;
  pdfSmartInvert: boolean;

  // Actions
  openBook: (book: BookRecord) => Promise<void>;
  closeBook: () => void;
  updateProgress: (
    locator: string,
    percentage: number,
    pdfPage?: number
  ) => Promise<void>;
  setActiveSelection: (selection: ActiveSelection | null) => void;
  createOrUpdateAnnotation: (
    locator: string,
    selectedText: string,
    color: HighlightColor,
    note?: string,
    pageNumber?: number,
    rects?: NormalizedRect[],
    existingId?: string
  ) => Promise<Annotation>;
  removeAnnotation: (annotationId: string) => Promise<void>;
  toggleCurrentBookmark: (params: {
    locator: string;
    label: string;
    pageNumber?: number;
    note?: string;
  }) => Promise<{ added: boolean; bookmark?: Bookmark }>;
  removeBookmark: (bookmarkId: string) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
  setFontSizePct: (size: number) => void;
  setReadingFlow: (flow: ReadingFlowMode) => void;
  setPageSpread: (spread: PageSpreadMode) => void;
  setPdfScale: (scale: number) => void;
  setPdfSmartInvert: (enabled: boolean) => void;
  setIsDrawerOpen: (open: boolean) => void;
  refreshActiveBookState: () => Promise<void>;
}

const ReaderContext = createContext<ReaderContextValue | undefined>(undefined);

export const ReaderProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [activeBook, setActiveBook] = useState<BookRecord | null>(null);
  const [activeSelection, setActiveSelection] =
    useState<ActiveSelection | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(true);

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem("aura_theme_mode") as ThemeMode) || "night";
  });
  const [fontSizePct, setFontSizePct] = useState<number>(() => {
    const saved = Number(localStorage.getItem("aura_font_size"));
    return saved >= 70 && saved <= 180 ? saved : 105;
  });
  const [readingFlow, setReadingFlow] = useState<ReadingFlowMode>(() => {
    return (
      (localStorage.getItem("aura_reading_flow") as ReadingFlowMode) ||
      "paginated"
    );
  });
  const [pageSpread, setPageSpread] = useState<PageSpreadMode>(() => {
    return (
      (localStorage.getItem("aura_page_spread") as PageSpreadMode) || "single"
    );
  });
  const [pdfScale, setPdfScale] = useState<number>(1.4);
  const [pdfSmartInvert, setPdfSmartInvert] = useState<boolean>(true);

  const {
    progress,
    annotations,
    bookmarks,
    persistProgress,
    saveHighlight,
    removeHighlight,
    toggleBookmark,
    removeBookmark,
    reloadDocumentState,
  } = useDocumentAnnotations(activeBook?.id ?? null);

  const themePalette = THEME_PALETTES[themeMode];

  // Persist user reader settings
  useEffect(() => {
    localStorage.setItem("aura_font_size", String(fontSizePct));
  }, [fontSizePct]);

  useEffect(() => {
    localStorage.setItem("aura_reading_flow", readingFlow);
  }, [readingFlow]);

  useEffect(() => {
    localStorage.setItem("aura_page_spread", pageSpread);
  }, [pageSpread]);

  // Synchronize global data-theme attribute, class list, and CSS custom properties
  useEffect(() => {
    localStorage.setItem("aura_theme_mode", themeMode);
    const root = document.documentElement;
    root.classList.remove("light", "sepia", "dark");
    if (themeMode === "night") {
      root.classList.add("dark");
      root.setAttribute("data-theme", "dark");
    } else {
      root.classList.add(themeMode);
      root.setAttribute("data-theme", themeMode);
    }
    root.style.backgroundColor = themePalette.bgPrimary;
  }, [themeMode, themePalette]);

  const openBook = useCallback(async (book: BookRecord) => {
    setActiveSelection(null);
    setActiveBook(book);
  }, []);

  const closeBook = useCallback(() => {
    setActiveBook(null);
    setActiveSelection(null);
  }, []);

  const createOrUpdateAnnotation = useCallback(
    async (
      locator: string,
      selectedText: string,
      color: HighlightColor,
      note?: string,
      pageNumber?: number,
      rects?: NormalizedRect[],
      existingId?: string
    ) => {
      const saved = await saveHighlight({
        locator,
        selectedText,
        color,
        note,
        pageNumber,
        rects,
        existingId,
      });
      setActiveSelection(null);
      return saved;
    },
    [saveHighlight]
  );

  const value = useMemo<ReaderContextValue>(
    () => ({
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
      openBook,
      closeBook,
      updateProgress: persistProgress,
      setActiveSelection,
      createOrUpdateAnnotation,
      removeAnnotation: removeHighlight,
      toggleCurrentBookmark: toggleBookmark,
      removeBookmark,
      setThemeMode,
      setFontSizePct,
      setReadingFlow,
      setPageSpread,
      setPdfScale,
      setPdfSmartInvert,
      setIsDrawerOpen,
      refreshActiveBookState: reloadDocumentState,
    }),
    [
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
      openBook,
      closeBook,
      persistProgress,
      createOrUpdateAnnotation,
      removeHighlight,
      toggleBookmark,
      removeBookmark,
      reloadDocumentState,
    ]
  );

  return (
    <ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>
  );
};

export const useReader = (): ReaderContextValue => {
  const ctx = useContext(ReaderContext);
  if (!ctx) {
    throw new Error("useReader must be used within a ReaderProvider");
  }
  return ctx;
};
