// Auto-update ("update mode"): checks the project's GitHub Releases for a newer
// build and, when enabled, pulls it in the background so the user only has to
// restart. Backed by electron-updater, which reads the same GitHub coordinates
// declared in electron-builder.yml and consumes the `latest*.yml` metadata the
// release workflow publishes alongside each installer.
import { app } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import type { UpdateStatus } from "../shared/api";

let listener: ((status: UpdateStatus) => void) | null = null;
let wired = false;
// Mirrors the AppSettings.autoUpdate toggle: when true, an available update is
// downloaded without an explicit click.
let autoDownload = true;

let status: UpdateStatus = {
  state: "idle",
  currentVersion: app.getVersion(),
};

function emit(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch };
  listener?.(status);
}

// Updates only work from a packaged build — in dev there is no app-update.yml,
// and electron-updater would throw. Surface that as a distinct "disabled" state
// rather than a scary error.
function isSupported(): boolean {
  return app.isPackaged;
}

function releaseNotesText(info: UpdateInfo): string | undefined {
  const notes = info.releaseNotes;
  if (typeof notes === "string") return notes;
  if (Array.isArray(notes))
    return notes
      .map((n) => n.note ?? "")
      .join("\n\n")
      .trim();
  return undefined;
}

function wire(): void {
  if (wired) return;
  wired = true;

  autoUpdater.autoDownload = autoDownload;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => emit({ state: "checking", error: undefined }));
  autoUpdater.on("update-available", (info: UpdateInfo) =>
    emit({
      // When auto-download is on, electron-updater starts fetching immediately.
      state: autoDownload ? "downloading" : "available",
      newVersion: info.version,
      releaseNotes: releaseNotesText(info),
      progressPercent: autoDownload ? 0 : undefined,
    }),
  );
  autoUpdater.on("update-not-available", () =>
    emit({ state: "not-available", newVersion: undefined, releaseNotes: undefined }),
  );
  autoUpdater.on("download-progress", (p: ProgressInfo) =>
    emit({ state: "downloading", progressPercent: Math.round(p.percent) }),
  );
  autoUpdater.on("update-downloaded", (info: UpdateInfo) =>
    emit({ state: "downloaded", newVersion: info.version, progressPercent: 100 }),
  );
  autoUpdater.on("error", (err: Error) =>
    emit({ state: "error", error: err?.message ?? String(err) }),
  );
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

// The renderer subscribes through a single listener; main.ts fans it out to all
// windows, matching the test-loop / agent-event pattern.
export function onUpdateStatus(cb: (status: UpdateStatus) => void): void {
  listener = cb;
}

export function initAutoUpdater(opts: { autoUpdate: boolean }): void {
  autoDownload = opts.autoUpdate;
  if (!isSupported()) {
    emit({ state: "disabled" });
    return;
  }
  wire();
  if (opts.autoUpdate) void checkForUpdates();
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!isSupported()) {
    emit({ state: "disabled" });
    return status;
  }
  wire();
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    emit({ state: "error", error: err instanceof Error ? err.message : String(err) });
  }
  return status;
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!isSupported()) {
    emit({ state: "disabled" });
    return status;
  }
  wire();
  try {
    emit({ state: "downloading", progressPercent: 0 });
    await autoUpdater.downloadUpdate();
  } catch (err) {
    emit({ state: "error", error: err instanceof Error ? err.message : String(err) });
  }
  return status;
}

export function quitAndInstallUpdate(): void {
  if (!isSupported()) return;
  // isSilent=false, isForceRunAfter=true — show the installer UI, relaunch when done.
  autoUpdater.quitAndInstall(false, true);
}

// Called when the user flips the auto-update toggle in Settings.
export function setAutoUpdate(enabled: boolean): void {
  autoDownload = enabled;
  if (wired) autoUpdater.autoDownload = enabled;
}
