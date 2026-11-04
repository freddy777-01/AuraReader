import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { open as openInBrowser } from "@tauri-apps/plugin-shell";
import {
  CloudBackupMetadata,
  CloudSyncPayload,
  OneDriveAuthState,
} from "../types/reader";
import { useReader } from "../context/ReaderContext";
import { AboutModal } from "./AboutModal";

interface AppSystemInfo {
  currentVersion: string;
  databasePath: string;
  coversDir: string;
  databaseSizeBytes: number;
  retainDataOnUninstallDefault: boolean;
}

interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes: string;
  downloadUrl?: string | null;
}

interface CloudBackupSettingsProps {
  totalBooksCount?: number;
  scannedFolders?: string[];
  isScanningFolder?: boolean;
  onScanLocalFolder?: () => Promise<number>;
}

export const CloudBackupSettings: React.FC<CloudBackupSettingsProps> = ({
  totalBooksCount = 0,
  scannedFolders = [],
  isScanningFolder = false,
  onScanLocalFolder,
}) => {
  const { refreshActiveBookState, closeBook, themeMode, setThemeMode } =
    useReader();
  const [activeSection, setActiveSection] = useState<
    "library" | "cloud" | "updates"
  >("library");
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);

  const [authState, setAuthState] = useState<OneDriveAuthState | null>(null);
  const [sysInfo, setSysInfo] = useState<AppSystemInfo | null>(null);
  const OFFICIAL_GITHUB_REPO = "freddy777-01/AuraReader";
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const [lastBackupMeta, setLastBackupMeta] =
    useState<CloudBackupMetadata | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const refreshSystemMetadata = () => {
    invoke<OneDriveAuthState>("get_onedrive_status")
      .then(setAuthState)
      .catch(console.error);
    invoke<AppSystemInfo>("get_app_system_info")
      .then(setSysInfo)
      .catch(console.error);
  };

  useEffect(() => {
    refreshSystemMetadata();
  }, []);

  // 1. Scan & Sync Local Folder
  const handleTriggerFolderScan = async () => {
    if (!onScanLocalFolder) return;
    setStatusBanner(null);
    try {
      const count = await onScanLocalFolder();
      if (count > 0) {
        refreshSystemMetadata();
        setStatusBanner({
          type: "success",
          message: `Synced ${count} books (EPUB, PDF, MOBI) from the selected folder into your library.`,
        });
      }
    } catch (err) {
      setStatusBanner({ type: "error", message: String(err) });
    }
  };

  // 2. Check for App Updates via GitHub Releases API
  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    setStatusBanner(null);
    const repo = OFFICIAL_GITHUB_REPO;
    try {
      const currentVer = (sysInfo?.currentVersion ?? "1.0.0").replace(
        /^v/i,
        ""
      );
      const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
      const response = await fetch(apiUrl, {
        headers: { Accept: "application/vnd.github+json" },
      });

      if (response.ok) {
        const data = await response.json();
        const latestVer = String(data.tag_name || currentVer).replace(
          /^v/i,
          ""
        );
        const assets: Array<{ name?: string; browser_download_url?: string }> =
          Array.isArray(data.assets) ? data.assets : [];
        const installerAsset = assets.find((a) => {
          const n = (a.name || "").toLowerCase();
          return n.endsWith("-setup.exe") || n.endsWith(".exe") || n.endsWith(".msi");
        });
        const downloadUrl =
          installerAsset?.browser_download_url ||
          data.html_url ||
          `https://github.com/${repo}/releases/latest`;

        const isNewer = latestVer !== currentVer;
        const result: UpdateCheckResult = {
          currentVersion: currentVer,
          latestVersion: latestVer,
          updateAvailable: isNewer,
          releaseNotes:
            data.name ||
            data.body?.split("\n")?.[0] ||
            `Release v${latestVer}`,
          downloadUrl,
        };
        setUpdateInfo(result);
        setStatusBanner({
          type: "success",
          message: result.updateAvailable
            ? `Update Available: AuraReader v${result.latestVersion} is ready to download.`
            : `AuraReader v${result.currentVersion} is up to date.`,
        });
      } else {
        // Fallback to Rust backend check
        const res = await invoke<UpdateCheckResult>("check_for_app_updates", {
          githubRepo: repo,
        });
        setUpdateInfo(res);
        setStatusBanner({
          type: "success",
          message: res.updateAvailable
            ? `Update Available: AuraReader v${res.latestVersion} is ready to download.`
            : `AuraReader v${res.currentVersion} is up to date.`,
        });
      }
    } catch (err) {
      setStatusBanner({ type: "error", message: String(err) });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // 3. Local Backup Export / Import & Factory Reset
  const handleExportLocalSnapshot = async () => {
    try {
      const target = await save({
        defaultPath: "aurareader_backup.db",
        filters: [{ name: "AuraReader Backup", extensions: ["db", "backup"] }],
      });
      if (typeof target === "string") {
        await invoke<string>("export_local_database_snapshot", {
          destinationPath: target,
        });
        setStatusBanner({
          type: "success",
          message: "Library backup exported successfully.",
        });
      }
    } catch (err) {
      setStatusBanner({ type: "error", message: String(err) });
    }
  };

  const handleImportLocalSnapshot = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "AuraReader Backup",
            extensions: ["db", "backup", "sqlite"],
          },
        ],
      });
      if (typeof selected === "string") {
        const payload = await invoke<CloudSyncPayload>(
          "import_local_database_snapshot",
          {
            sourcePath: selected,
          }
        );
        await refreshActiveBookState();
        refreshSystemMetadata();
        setStatusBanner({
          type: "success",
          message: `Restored ${payload.books.length} books and ${payload.annotations.length} highlights from backup.`,
        });
      }
    } catch (err) {
      setStatusBanner({ type: "error", message: String(err) });
    }
  };

  const handleWipeAllLocalData = async () => {
    try {
      await invoke("wipe_all_local_data");
      closeBook();
      setConfirmWipe(false);
      refreshSystemMetadata();
      setStatusBanner({
        type: "success",
        message:
          "All local library records, highlights, bookmarks, and cached covers have been permanently deleted.",
      });
    } catch (err) {
      setStatusBanner({ type: "error", message: String(err) });
    }
  };

  // 4. OneDrive Cloud Sync
  const handleManualBackup = async () => {
    setIsSyncing(true);
    setStatusBanner(null);
    try {
      const metadata = await invoke<CloudBackupMetadata>(
        "trigger_onedrive_backup"
      );
      setLastBackupMeta(metadata);
      const updatedStatus = await invoke<OneDriveAuthState>(
        "get_onedrive_status"
      );
      setAuthState(updatedStatus);
      setStatusBanner({
        type: "success",
        message: `Backed up ${metadata.booksCount} books and ${metadata.annotationsCount} highlights (${(
          metadata.sizeBytes / 1024
        ).toFixed(1)} KB) to OneDrive AppFolder.`,
      });
    } catch (err) {
      setStatusBanner({ type: "error", message: String(err) });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRestoreFromCloud = async () => {
    setIsSyncing(true);
    setStatusBanner(null);
    try {
      const payload = await invoke<CloudSyncPayload>("restore_onedrive_backup");
      await refreshActiveBookState();
      refreshSystemMetadata();
      setStatusBanner({
        type: "success",
        message: `Restored library state (${payload.books.length} books, ${payload.annotations.length} highlights) from OneDrive snapshot.`,
      });
    } catch (err) {
      setStatusBanner({ type: "error", message: String(err) });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    const state = await invoke<OneDriveAuthState>("disconnect_onedrive");
    setAuthState(state);
    setStatusBanner({
      type: "success",
      message: "Disconnected from Microsoft OneDrive.",
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {/* Settings Header & Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-color)] pb-4">
        <div>
          <h1 className="font-[family-name:var(--font-serif)] text-lg font-bold">
            Settings & Application Center
          </h1>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Sync local book folders, manage backups, check updates, and view
            app details.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-1">
          {(
            [
              { id: "library", label: "📁 Library & Data" },
              { id: "cloud", label: "☁ OneDrive Sync" },
              { id: "updates", label: "🔄 Updates" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveSection(tab.id);
                setStatusBanner(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeSection === tab.id
                  ? "bg-[var(--accent)] text-slate-950 shadow-xs"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {tab.label}
            </button>
          ))}

          <button
            onClick={() => setIsAboutModalOpen(true)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"
          >
            ℹ About AuraReader
          </button>
        </div>
      </div>

      {statusBanner && (
        <div
          className={`rounded-xl px-4 py-3 text-xs font-medium ${
            statusBanner.type === "success"
              ? "bg-emerald-500/15 text-emerald-500"
              : "bg-rose-500/15 text-rose-500"
          }`}
        >
          {statusBanner.message}
        </div>
      )}

      {/* ====================================================================
          TAB 1: LIBRARY FOLDER SYNC, APPEARANCE & DATA RETENTION
         ==================================================================== */}
      {activeSection === "library" && (
        <div className="space-y-6">
          {/* Local Folder Scanner / Sync Card */}
          <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold">
                  Sync Local Book Folders
                </h2>
                <p className="mt-1 max-w-xl text-xs text-[var(--text-secondary)]">
                  Scan any folder on your computer to automatically index{" "}
                  <strong>.epub</strong>, <strong>.pdf</strong>, and{" "}
                  <strong>.mobi</strong> e-books, extract cover art, and sync
                  them into your Bookshelf.
                </p>
              </div>

              <button
                disabled={isScanningFolder}
                onClick={handleTriggerFolderScan}
                className="flex shrink-0 items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-slate-950 shadow-xs transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                <span>📁</span>
                <span>
                  {isScanningFolder
                    ? "Scanning Folder..."
                    : "Scan Folder to Sync Books"}
                </span>
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 text-xs">
              <div className="flex items-center justify-between font-medium">
                <span className="text-[var(--text-secondary)]">
                  Total Indexed Books:
                </span>
                <span className="font-bold text-[var(--accent)]">
                  {totalBooksCount} books across {scannedFolders.length} folders
                </span>
              </div>

              {scannedFolders.length > 0 && (
                <div className="mt-3 border-t border-[var(--border-color)] pt-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold text-[var(--text-secondary)] uppercase">
                    Synced Source Directories:
                  </p>
                  <div className="max-h-28 space-y-1 overflow-y-auto">
                    {scannedFolders.slice(0, 12).map((folder) => (
                      <div
                        key={folder}
                        className="truncate rounded bg-[var(--bg-card)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-secondary)]"
                      >
                        {folder.replace(/^\\\\\?\\/, "")}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Global Appearance Theme Card */}
          <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold">
                  Global Theme & Appearance
                </h2>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Choose the default reading and interface color palette across
                  AuraReader.
                </p>
              </div>

              <div className="flex items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-1">
                {(["light", "sepia", "night"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setThemeMode(mode)}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold capitalize transition ${
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
          </section>

          {/* Data Retention, Backup Export & Complete Wipe */}
          <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 shadow-xs">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold">
                  Library Backup & Data Management
                </h2>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Your library, reading progress, highlights, and bookmarks are
                  saved locally on your device so reinstalling or upgrading
                  retains your reading history by default.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-500">
                Retained by Default
              </span>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                onClick={handleExportLocalSnapshot}
                className="rounded-xl bg-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-xs transition hover:bg-[var(--accent-hover)]"
              >
                Export Local Backup
              </button>
              <button
                onClick={handleImportLocalSnapshot}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--accent)]"
              >
                Import Local Backup
              </button>

              {!confirmWipe ? (
                <button
                  onClick={() => setConfirmWipe(true)}
                  className="ml-auto rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-500 transition hover:bg-rose-500 hover:text-white"
                >
                  Complete Data Wipe...
                </button>
              ) : (
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs font-semibold text-rose-500">
                    Delete all local data?
                  </span>
                  <button
                    onClick={handleWipeAllLocalData}
                    className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-500"
                  >
                    Yes, Wipe Everything
                  </button>
                  <button
                    onClick={() => setConfirmWipe(false)}
                    className="rounded-lg border border-[var(--border-color)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ====================================================================
          TAB 2: MICROSOFT ONEDRIVE CLOUD BACKUP
         ==================================================================== */}
      {activeSection === "cloud" && (
        <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 shadow-xs">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold">
                Cloud Backup & Cross-Device Sync (Microsoft OneDrive)
              </h2>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Securely backs up your library, reading progress, highlights,
                and bookmarks to your personal Microsoft OneDrive account so you
                can restore them anytime.
              </p>
            </div>

            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                authState?.isConnected
                  ? "bg-emerald-500/15 text-emerald-500"
                  : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  authState?.isConnected ? "bg-emerald-500" : "bg-slate-400"
                }`}
              />
              {authState?.isConnected ? "Connected" : "Not Connected"}
            </span>
          </div>

          <div className="mt-5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 text-xs">
            {authState?.isConnected ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-[var(--text-primary)]">
                    Account: {authState.accountEmail}
                  </p>
                  <p className="mt-0.5 text-[var(--text-secondary)]">
                    Last Synced:{" "}
                    {authState.lastSyncedAt
                      ? new Date(authState.lastSyncedAt).toLocaleString()
                      : "Never synced in this session"}
                  </p>
                </div>
                <button
                  onClick={handleDisconnect}
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent)]"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <p className="text-[var(--text-secondary)]">
                  Sign in with your Microsoft account to enable cloud backup.
                </p>
                <button
                  onClick={async () => {
                    const next = await invoke<OneDriveAuthState>(
                      "connect_onedrive_oauth",
                      {
                        accessToken: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...",
                        refreshToken: "M.R3_BAY...",
                        accountEmail: "reader@femag.io",
                        expiresInSeconds: 3600,
                      }
                    );
                    setAuthState(next);
                  }}
                  className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-slate-950 shadow-xs transition hover:bg-[var(--accent-hover)]"
                >
                  Connect Microsoft OneDrive
                </button>
              </div>
            )}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              disabled={!authState?.isConnected || isSyncing}
              onClick={handleManualBackup}
              className="flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-slate-950 shadow-xs transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSyncing
                ? "Syncing with OneDrive..."
                : "Backup Library & Highlights"}
            </button>

            <button
              disabled={!authState?.isConnected || isSyncing}
              onClick={handleRestoreFromCloud}
              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 py-2.5 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Restore Library from OneDrive
            </button>
          </div>

          {lastBackupMeta && (
            <div className="mt-4 text-[11px] text-[var(--text-secondary)]">
              Latest Remote Snapshot: <strong>{lastBackupMeta.fileName}</strong>{" "}
              • {lastBackupMeta.booksCount} books •{" "}
              {lastBackupMeta.annotationsCount} annotations
            </div>
          )}
        </section>
      )}

      {/* ====================================================================
          TAB 3: APPLICATION UPDATES
         ==================================================================== */}
      {activeSection === "updates" && (
        <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold">
                  Application Updates
                </h2>
                <span className="rounded-full bg-[var(--accent)]/15 px-2.5 py-0.5 text-xs font-bold text-[var(--accent)]">
                  v{sysInfo?.currentVersion ?? "1.0.0"}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Check for new versions of AuraReader. Your library, reading
                progress, and highlights are automatically preserved when
                upgrading.
              </p>
            </div>

            <button
              disabled={isCheckingUpdate}
              onClick={handleCheckUpdates}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-slate-950 shadow-xs transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {isCheckingUpdate ? "Checking..." : "Check for Updates"}
            </button>
          </div>

          {updateInfo && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 text-xs">
              <div>
                <p className="font-semibold">
                  Latest Release: v{updateInfo.latestVersion}{" "}
                  {updateInfo.updateAvailable ? (
                    <span className="ml-1.5 rounded bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                      Update Available
                    </span>
                  ) : (
                    <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-500">
                      Up to Date
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[var(--text-secondary)]">
                  {updateInfo.releaseNotes}
                </p>
              </div>

              {updateInfo.updateAvailable && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={async () => {
                      const targetUrl =
                        updateInfo.downloadUrl ||
                        `https://github.com/${OFFICIAL_GITHUB_REPO}/releases/latest`;
                      try {
                        await openInBrowser(targetUrl);
                      } catch {
                        window.open(targetUrl, "_blank");
                      }
                    }}
                    className="rounded-xl bg-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-xs transition hover:bg-[var(--accent-hover)]"
                  >
                    Download & Upgrade
                  </button>

                  {updateInfo.downloadUrl && (
                    <button
                      disabled={isInstallingUpdate}
                      onClick={async () => {
                        setIsInstallingUpdate(true);
                        setStatusBanner(null);
                        try {
                          await invoke<string>("download_and_install_update", {
                            downloadUrl: updateInfo.downloadUrl,
                          });
                          setStatusBanner({
                            type: "success",
                            message:
                              "Pre-update backup saved and installer launched.",
                          });
                        } catch (err) {
                          setStatusBanner({
                            type: "error",
                            message: String(err),
                          });
                        } finally {
                          setIsInstallingUpdate(false);
                        }
                      }}
                      className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {isInstallingUpdate
                        ? "Backing Up & Downloading..."
                        : "Auto-Backup & Install"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* About Modal Popup */}
      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
        appName="AuraReader"
        version={`v${sysInfo?.currentVersion ?? "1.0.0"}`}
        creatorName="FEMAG"
      />
    </div>
  );
};
