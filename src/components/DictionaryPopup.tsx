import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface DictionaryPhonetic {
  text?: string;
  audio?: string;
}

export interface DictionaryDefinitionItem {
  definition: string;
  example?: string;
  synonyms?: string[];
  antonyms?: string[];
}

export interface DictionaryMeaning {
  partOfSpeech: string;
  definitions: DictionaryDefinitionItem[];
  synonyms?: string[];
}

export interface DictionaryEntry {
  word: string;
  phonetic?: string;
  phonetics?: DictionaryPhonetic[];
  meanings: DictionaryMeaning[];
}

interface DictionaryPopupProps {
  selectedText: string;
  anchorPosition?: { x: number; y: number };
  onClose: () => void;
}

export function extractLookupWord(raw: string): string | null {
  const trimmed = raw
    .trim()
    .replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, "");
  if (!trimmed) return null;
  if (/^[a-zA-Z]+(-[a-zA-Z]+)?$/.test(trimmed) && trimmed.length >= 2) {
    return trimmed.toLowerCase();
  }
  return null;
}

const CARD_WIDTH = 368;
const CARD_MAX_HEIGHT = 350;

function computeInitialPosition(anchor?: { x: number; y: number }): {
  x: number;
  y: number;
} {
  const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const winH = typeof window !== "undefined" ? window.innerHeight : 800;

  const rawX = anchor ? anchor.x - CARD_WIDTH / 2 : (winW - CARD_WIDTH) / 2;
  const rawY = anchor ? anchor.y + 24 : 140;

  // Clamp so the entire card is always fully visible inside the window
  const clampedX = Math.max(16, Math.min(winW - CARD_WIDTH - 16, rawX));
  const clampedY = Math.max(60, Math.min(winH - CARD_MAX_HEIGHT - 20, rawY));

  return { x: clampedX, y: clampedY };
}

export const DictionaryPopup: React.FC<DictionaryPopupProps> = ({
  selectedText,
  anchorPosition,
  onClose,
}) => {
  const initialWord =
    selectedText
      .trim()
      .split(/\s+/)[0]
      ?.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, "")
      .toLowerCase() || "";

  const [lookupWord, setLookupWord] = useState<string>(initialWord);
  const [entries, setEntries] = useState<DictionaryEntry[] | null>(null);
  const [sourceType, setSourceType] = useState<"cache" | "online" | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Draggable position state (top-left x, y in viewport coordinates)
  const [position, setPosition] = useState<{ x: number; y: number }>(() =>
    computeInitialPosition(anchorPosition)
  );
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  useEffect(() => {
    setPosition(computeInitialPosition(anchorPosition));
  }, [anchorPosition?.x, anchorPosition?.y]);

  useEffect(() => {
    const nextWord =
      selectedText
        .trim()
        .split(/\s+/)[0]
        ?.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, "")
        .toLowerCase() || "";
    if (nextWord) {
      setLookupWord(nextWord);
    }
  }, [selectedText]);

  useEffect(() => {
    if (!lookupWord) return;
    let isCancelled = false;

    const fetchDefinition = async () => {
      setIsLoading(true);
      setErrorMsg(null);
      setEntries(null);
      setSourceType(null);

      try {
        // 1. Always check local SQLite `word_cache` first
        const cachedJson = await invoke<string | null>(
          "get_cached_dictionary_word",
          { word: lookupWord }
        );

        if (cachedJson) {
          if (isCancelled) return;
          const parsed = JSON.parse(cachedJson) as DictionaryEntry[];
          setEntries(parsed);
          setSourceType("cache");
          setIsLoading(false);
          return;
        }

        // 2. Check network connectivity before calling Free Dictionary API
        if (!navigator.onLine) {
          if (isCancelled) return;
          setErrorMsg(
            `Offline mode: "${lookupWord}" is not stored in your local SQLite dictionary cache yet.`
          );
          setIsLoading(false);
          return;
        }

        // 3. Fetch from Free Dictionary API
        const res = await fetch(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(
            lookupWord
          )}`
        );

        if (!res.ok) {
          if (isCancelled) return;
          setErrorMsg(`No dictionary definition found for "${lookupWord}".`);
          setIsLoading(false);
          return;
        }

        const data = (await res.json()) as DictionaryEntry[];
        if (isCancelled) return;

        if (Array.isArray(data) && data.length > 0) {
          setEntries(data);
          setSourceType("online");

          // Save into local SQLite `word_cache` for future offline lookups
          await invoke("save_cached_dictionary_word", {
            word: lookupWord,
            payloadJson: JSON.stringify(data),
          }).catch(() => {});
        } else {
          setErrorMsg(`No dictionary definition found for "${lookupWord}".`);
        }
      } catch {
        if (!isCancelled) {
          setErrorMsg(
            `Could not retrieve definition for "${lookupWord}". Check your connection.`
          );
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchDefinition();
    return () => {
      isCancelled = true;
    };
  }, [lookupWord]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Do not start dragging if clicking a button inside the header
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragOffsetRef.current = {
      dx: e.clientX - position.x,
      dy: e.clientY - position.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const nextX = Math.max(
      8,
      Math.min(winW - CARD_WIDTH - 8, e.clientX - dragOffsetRef.current.dx)
    );
    const nextY = Math.max(
      8,
      Math.min(winH - 120, e.clientY - dragOffsetRef.current.dy)
    );
    setPosition({ x: nextX, y: nextY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture was already released
    }
  };

  const primaryEntry = entries?.[0];
  const phoneticText =
    primaryEntry?.phonetic ||
    primaryEntry?.phonetics?.find((p) => p.text)?.text ||
    "";
  const audioUrl =
    primaryEntry?.phonetics?.find((p) => p.audio && p.audio.trim().length > 0)
      ?.audio || "";

  return (
    <div
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${CARD_WIDTH}px`,
      }}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 flex flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl"
    >
      {/* Draggable Header: Word, Phonetics, Audio & Cache Badge */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title="Drag to move dictionary card"
        className={`flex select-none items-start justify-between gap-2 rounded-t-2xl border-b border-[var(--border-color)] bg-[var(--bg-elevated)]/50 px-4 py-3 ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)] opacity-60">
              ⠿
            </span>
            <h3 className="font-[family-name:var(--font-serif)] text-base font-bold capitalize">
              {primaryEntry?.word || lookupWord}
            </h3>

            {phoneticText && (
              <span className="font-mono text-xs text-[var(--accent)]">
                {phoneticText}
              </span>
            )}

            {audioUrl && (
              <button
                onClick={() => {
                  const audio = new Audio(audioUrl);
                  audio.play().catch(() => {});
                }}
                title="Listen to pronunciation"
                className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-slate-950"
              >
                🔊
              </button>
            )}
          </div>

          <div className="mt-1 flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-[var(--text-secondary)] uppercase">
              📖 Dictionary • Drag to Move
            </span>
            {sourceType === "cache" && (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-500">
                ⚡ Offline Cache
              </span>
            )}
            {sourceType === "online" && (
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-sky-500">
                🌐 Cached to SQLite
              </span>
            )}
          </div>
        </div>

        <button
          onClick={onClose}
          title="Close dictionary"
          className="rounded-lg p-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          ✕
        </button>
      </div>

      {/* Scrollable Body: All Meanings & Definitions */}
      <div className="max-h-64 space-y-3 overflow-y-auto p-4 text-xs">
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-[var(--text-secondary)]">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            <span>Looking up &ldquo;{lookupWord}&rdquo;...</span>
          </div>
        ) : errorMsg ? (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3 text-[var(--text-secondary)]">
            {errorMsg}
          </div>
        ) : primaryEntry ? (
          primaryEntry.meanings.map((meaning, mIdx) => (
            <div
              key={`${meaning.partOfSpeech}-${mIdx}`}
              className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3"
            >
              <span className="inline-block rounded bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-bold tracking-wider text-[var(--accent)] uppercase">
                {meaning.partOfSpeech}
              </span>

              <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed">
                {meaning.definitions.map((def, dIdx) => (
                  <li key={dIdx} className="text-[var(--text-primary)]">
                    <span>{def.definition}</span>
                    {def.example && (
                      <p className="mt-0.5 font-[family-name:var(--font-serif)] text-[11px] italic text-[var(--text-secondary)]">
                        &ldquo;{def.example}&rdquo;
                      </p>
                    )}
                  </li>
                ))}
              </ol>

              {meaning.synonyms && meaning.synonyms.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-[var(--border-color)] pt-1.5">
                  <span className="text-[10px] font-semibold text-[var(--text-secondary)]">
                    Synonyms:
                  </span>
                  {meaning.synonyms.slice(0, 6).map((syn) => (
                    <button
                      key={syn}
                      onClick={() => setLookupWord(syn.toLowerCase())}
                      className="rounded bg-[var(--bg-card)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)] hover:underline"
                    >
                      {syn}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : null}
      </div>
    </div>
  );
};
