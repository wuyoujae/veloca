import { app } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;

export interface AppUpdateStatus {
  bytesPerSecond: number | null;
  checkedAt: number | null;
  currentVersion: string;
  downloadedBytes: number | null;
  errorMessage?: string;
  hasUpdate: boolean;
  latestVersion: string | null;
  publishedAt: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'current' | 'unavailable';
  totalBytes: number | null;
  updatePercent: number | null;
}

interface UpdaterProgressInfo {
  bytesPerSecond?: number;
  percent?: number;
  total?: number;
  transferred?: number;
}

interface UpdaterReleaseInfo {
  files?: Array<{ url?: string }>;
  path?: string;
  releaseDate?: string;
  releaseName?: string | null;
  tag?: string;
  version?: string;
}

type UpdateStatusListener = (status: AppUpdateStatus) => void;

const githubRepositoryUrl = 'https://github.com/wuyoujae/veloca';
const releaseUrl = `${githubRepositoryUrl}/releases/latest`;
const listeners = new Set<UpdateStatusListener>();

let initialized = false;
let currentStatus: AppUpdateStatus = {
  bytesPerSecond: null,
  checkedAt: null,
  currentVersion: app.getVersion(),
  downloadedBytes: null,
  hasUpdate: false,
  latestVersion: null,
  publishedAt: null,
  releaseName: null,
  releaseUrl: null,
  status: 'idle',
  totalBytes: null,
  updatePercent: null
};

function toUpdateInfo(info: UpdaterReleaseInfo): Pick<
  AppUpdateStatus,
  'latestVersion' | 'publishedAt' | 'releaseName' | 'releaseUrl'
> {
  return {
    latestVersion: info.version ?? info.tag?.replace(/^v/i, '') ?? null,
    publishedAt: info.releaseDate ?? null,
    releaseName: info.releaseName ?? info.version ?? info.tag ?? null,
    releaseUrl
  };
}

function setUpdateStatus(nextStatus: Partial<AppUpdateStatus>): AppUpdateStatus {
  currentStatus = {
    ...currentStatus,
    ...nextStatus,
    currentVersion: app.getVersion()
  };

  for (const listener of listeners) {
    listener(currentStatus);
  }

  return currentStatus;
}

async function downloadAvailableUpdate(): Promise<void> {
  if (currentStatus.status === 'downloading' || currentStatus.status === 'downloaded') {
    return;
  }

  setUpdateStatus({
    bytesPerSecond: null,
    downloadedBytes: null,
    errorMessage: undefined,
    hasUpdate: true,
    status: 'downloading',
    totalBytes: null,
    updatePercent: 0
  });

  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    setUpdateStatus({
      errorMessage: error instanceof Error ? error.message : 'Unable to download the update.',
      hasUpdate: true,
      status: 'unavailable'
    });
  }
}

export function initializeAutoUpdates(): void {
  if (initialized) {
    return;
  }

  initialized = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus({
      checkedAt: Date.now(),
      errorMessage: undefined,
      status: 'checking'
    });
  });

  autoUpdater.on('update-available', (info: UpdaterReleaseInfo) => {
    setUpdateStatus({
      ...toUpdateInfo(info),
      errorMessage: undefined,
      hasUpdate: true,
      status: 'available'
    });

    void downloadAvailableUpdate();
  });

  autoUpdater.on('download-progress', (progress: UpdaterProgressInfo) => {
    setUpdateStatus({
      bytesPerSecond: progress.bytesPerSecond ?? null,
      downloadedBytes: progress.transferred ?? null,
      hasUpdate: true,
      status: 'downloading',
      totalBytes: progress.total ?? null,
      updatePercent: Number.isFinite(progress.percent) ? Math.round(progress.percent ?? 0) : null
    });
  });

  autoUpdater.on('update-downloaded', (event: UpdaterReleaseInfo) => {
    setUpdateStatus({
      ...toUpdateInfo(event),
      bytesPerSecond: null,
      downloadedBytes: currentStatus.totalBytes,
      errorMessage: undefined,
      hasUpdate: true,
      status: 'downloaded',
      updatePercent: 100
    });
  });

  autoUpdater.on('update-not-available', (info: UpdaterReleaseInfo) => {
    setUpdateStatus({
      ...toUpdateInfo(info),
      errorMessage: undefined,
      hasUpdate: false,
      status: 'current',
      updatePercent: null
    });
  });

  autoUpdater.on('error', (error) => {
    setUpdateStatus({
      errorMessage: error.message,
      status: 'unavailable'
    });
  });
}

export function onUpdateStatusChanged(listener: UpdateStatusListener): () => void {
  listeners.add(listener);
  listener(currentStatus);

  return () => {
    listeners.delete(listener);
  };
}

export async function checkForAppUpdates(): Promise<AppUpdateStatus> {
  initializeAutoUpdates();

  if (!app.isPackaged) {
    return setUpdateStatus({
      checkedAt: Date.now(),
      errorMessage: 'Automatic updates are available only in a packaged Veloca build.',
      hasUpdate: false,
      status: 'unavailable'
    });
  }

  if (currentStatus.status === 'downloading' || currentStatus.status === 'downloaded') {
    return currentStatus;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    return setUpdateStatus({
      checkedAt: Date.now(),
      errorMessage: error instanceof Error ? error.message : 'Unable to check for updates.',
      hasUpdate: false,
      status: 'unavailable'
    });
  }

  return currentStatus;
}

export function installDownloadedAppUpdate(): AppUpdateStatus {
  if (currentStatus.status !== 'downloaded') {
    throw new Error('No downloaded update is ready to install.');
  }

  autoUpdater.quitAndInstall(false, true);
  return currentStatus;
}
