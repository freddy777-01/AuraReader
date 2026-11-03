import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  CloudBackupMetadata,
  CloudSyncPayload,
  OneDriveAuthState,
} from "../types/reader";
import { useReader } from "../context/ReaderContext";

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

export const CloudBackupSettings: React.FC = () => {
  const { refreshActiveBookState, closeBook } = useReader();
  const [authState, setAuthState] = useState<OneDriveAuthState | null>(null);
  const [sysInfo, setSysInfo] = useState<AppSystemInfo | null>(null);
  const [githubRepo, setGithubRepo] = useState<string>(() => {
    return localStorage.getItem("aura_github_repo") || "FEMAG/AuraReader";
  });
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

  // 1. Check for App Updates via GitHub Releases
  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    setStatusBanner(null);
    localStorage.setItem("aura_github_repo", githubRepo.trim());
    try {
      const res = await invoke<UpdateCheckResult>("check_for_app_updates", {
        githubRepo: githubRepo.trim(),
      });
      setUpdateInfo(res);
      setStatusBanner({
        type: "success",
        message: res.updateAvailable
          ? `GitHub Release v${res.latestVersion} found — ${res.releaseNotes}`
          : `AuraReader v${res.currentVersion} is up to date with ${githubRepo}.`,
      });
    } catch (err) {
      setStatusBanner({ type: "error", message: String(err) });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // 2. Local SQLite Snapshot Export / Import & Factory Reset
  const handleExportLocalSnapshot = async () => {
    try {
      const target = await save({
        defaultPath: "aurareader_backup.sqlite",
        filters: [{ name: "SQLite Database", extensions: ["sqlite", "db"] }],
      });
      if (typeof target === "string") {
        const savedPath = await invoke<string>(
          "export_local_database_snapshot",
          {
            destinationPath: target,
          }
        );
        setStatusBanner({
          type: "success",
          message: `Exported portable SQLite snapshot to ${savedPath}`,
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
        filters: [{ name: "SQLite Database", extensions: ["sqlite", "db"] }],
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
          message: `Restored ${payload.books.length} books and ${payload.annotations.length} highlights from local snapshot.`,
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
          "All local SQLite library records, highlights, bookmarks, and cached covers have been permanently deleted.",
      });
    } catch (err) {
      setStatusBanner({ type: "error", message: String(err) });
    }
  };

  // 3. OneDrive Cloud Sync
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
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 overflow-y-auto py-4 pr-2">
      {/* CARD 1: GitHub Releases OTA Updates & Version Status */}
      <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 text-[var(--text-primary)] shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold">
                GitHub Releases Auto-Updater
              </h2>
              <span className="rounded-full bg-[var(--accent)]/15 px-2.5 py-0.5 text-xs font-bold text-[var(--accent)]">
                v{sysInfo?.currentVersion ?? "0.1.0"}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Checks your GitHub repository's{" "}
              <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--accent)]">
                /releases/latest
              </code>{" "}
              for new Windows installers, backs up your SQLite library first, and
              launches the update automatically.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="owner/repo (e.g. FEMAG/AuraReader)"
              className="w-48 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
            <button
              disabled={isCheckingUpdate}
              onClick={handleCheckUpdates}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-slate-950 shadow-xs transition hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {isCheckingUpdate ? "Checking..." : "Check GitHub Releases"}
            </button>
          </div>
        </div>

        {updateInfo && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3.5 text-xs">
            <div>
              <p className="font-semibold">
                Latest Release: v{updateInfo.latestVersion}{" "}
                {updateInfo.updateAvailable ? (
                  <span className="ml-1.5 rounded bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                    New Version Available
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

            {updateInfo.updateAvailable && updateInfo.downloadUrl && (
              <button
                disabled={isInstallingUpdate}
                onClick={async () => {
                  setIsInstallingUpdate(true);
                  setStatusBanner(null);
                  try {
                    const backupPath = await invoke<string>(
                      "download_and_install_update",
                      {
                        downloadUrl: updateInfo.downloadUrl,
                      }
                    );
                    setStatusBanner({
                      type: "success",
                      message: `Pre-update SQLite backup saved (${backupPath}) and installer launched.`,
                    });
                  } catch (err) {
                    setStatusBanner({ type: "error", message: String(err) });
                  } finally {
                    setIsInstallingUpdate(false);
                  }
                }}
                className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-500 disabled:opacity-50"
              >
                {isInstallingUpdate
                  ? "Backing Up & Downloading..."
                  : "Download & Install Update"}
              </button>
            )}
          </div>
        )}
      </section>

      {/* CARD 2: Uninstall Data Retention, Local Snapshot Export & Complete Wipe */}
      <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 text-[var(--text-primary)] shadow-xs">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold">
              Data Retention & Uninstall Behavior
            </h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Your SQLite library, reading progress, highlights, and bookmarks
              are stored in your Windows user profile{" "}
              <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--accent)]">
                AppData\Roaming\io.femag.aurareader
              </code>{" "}
              outside the application installation folder.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-500">
            Retained by Default
          </span>
        </div>

        <div className="mt-4 space-y-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-4 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-[var(--text-secondary)]">
              SQLite Database Path:
            </span>
            <code className="max-w-md truncate text-[11px] text-[var(--text-primary)]">
              {sysInfo?.databasePath ?? "Loading..."}
            </code>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium text-[var(--text-secondary)]">
              Database Size:
            </span>
            <span className="font-semibold">
              {sysInfo
                ? `${(sysInfo.databaseSizeBytes / 1024).toFixed(1)} KB`
                : "0 KB"}
            </span>
          </div>
          <p className="pt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            • <strong>Keep Data on Reinstall:</strong> When you uninstall or
            upgrade AuraReader, leaving <em>"Delete application data"</em>{" "}
            unchecked in the Windows NSIS uninstaller keeps this SQLite database
            so reinstalling later automatically resumes with all your books,
            highlights, and bookmarks.
            <br />• <strong>Complete Delete Option:</strong> You can check{" "}
            <em>"Delete application data"</em> during uninstall, or use{" "}
            <strong>Complete Data Wipe</strong> below at any time.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleExportLocalSnapshot}
            className="rounded-xl bg-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-xs transition hover:bg-[var(--accent-hover)]"
          >
            Export Local Backup (.sqlite)
          </button>
          <button
            onClick={handleImportLocalSnapshot}
            className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:border-[var(--accent)]"
          >
            Import Local Backup (.sqlite)
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

      {/* CARD 3: Microsoft OneDrive Cloud Backup */}
      <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 text-[var(--text-primary)] shadow-xs">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-[family-name:var(--font-serif)] text-base font-semibold">
              Cloud Backup & Cross-Device Sync (Microsoft OneDrive)
            </h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Securely exports an atomic SQLite snapshot and JSON highlight
              payload to your isolated OneDrive{" "}
              <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--accent)]">
                Apps/AuraReader
              </code>{" "}
              folder via Microsoft Graph API.
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
                Sign in with Microsoft OAuth 2.0 (PKCE) to enable cloud backup.
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
            Latest Remote Snapshot: <strong>{lastBackupMeta.fileName}</strong> •{" "}
            {lastBackupMeta.booksCount} books •{" "}
            {lastBackupMeta.annotationsCount} annotations
          </div>
        )}
      </section>

      {statusBanner && (
        <div
          className={`rounded-xl px-4 py-3 text-xs ${
            statusBanner.type === "success"
              ? "bg-emerald-500/15 text-emerald-500"
              : "bg-rose-500/15 text-rose-500"
          }`}
        >
          {statusBanner.message}
        </div>
      )}
    </div>
  );
};
