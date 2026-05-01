import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AiModelConfig, ShortcutSettings, ThemeMode } from '../services/settings-store';
import type {
  RemoteDatabaseConfigInput,
  RemoteDatabaseConfigView,
  RemoteProjectProvisionResult,
  RemoteRegionOption
} from '../services/remote-database-service';
import type { RemoteSyncConfig, RemoteSyncStatus } from '../services/remote-sync-service';
import type { GitHubAuthStatus, GitHubDeviceBinding } from '../services/github-auth-service';
import type {
  VersionCommitResult,
  VersionManagedChange,
  VersionManagerStatus,
  VersionSyncResult
} from '../services/version-manager-service';
import type {
  AgentInheritSessionsResult,
  AgentRuntimeContext,
  AgentSendMessageRequest,
  AgentSendMessageResponse,
  AgentStoredSession,
  AgentStreamEvent
} from '../services/agent-service';
import type {
  AppInfo,
  OpenSourceComponent,
  UpdateCheckResult
} from '../services/app-info-service';
import type {
  FileOperationResult,
  DocumentProvenanceSnapshot,
  MarkdownFileContent,
  SaveMarkdownFileAsResult,
  WorkspaceAssetPayload,
  WorkspaceResolvedAsset,
  WorkspaceSnapshot
} from '../services/workspace-service';

interface WatchedMarkdownFileChange {
  file?: MarkdownFileContent;
  path: string;
  status: 'changed' | 'unavailable';
}

contextBridge.exposeInMainWorld('veloca', {
  settings: {
    getTheme: () => ipcRenderer.invoke('settings:get-theme') as Promise<ThemeMode>,
    setTheme: (theme: ThemeMode) => ipcRenderer.invoke('settings:set-theme', theme) as Promise<ThemeMode>,
    getAutoSave: () => ipcRenderer.invoke('settings:get-auto-save') as Promise<boolean>,
    setAutoSave: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-auto-save', enabled) as Promise<boolean>,
    getAiConfig: () => ipcRenderer.invoke('settings:get-ai-config') as Promise<AiModelConfig>,
    setAiConfig: (config: AiModelConfig) =>
      ipcRenderer.invoke('settings:set-ai-config', config) as Promise<AiModelConfig>,
    getShortcutSettings: () => ipcRenderer.invoke('settings:get-shortcut-settings') as Promise<ShortcutSettings>,
    setShortcutSettings: (settings: ShortcutSettings) =>
      ipcRenderer.invoke('settings:set-shortcut-settings', settings) as Promise<ShortcutSettings>,
    getRemoteConfig: () => ipcRenderer.invoke('settings:get-remote-config') as Promise<RemoteDatabaseConfigView>,
    getRemoteSyncConfig: () => ipcRenderer.invoke('settings:get-remote-sync-config') as Promise<RemoteSyncConfig>,
    saveRemoteConfig: (config: RemoteDatabaseConfigInput) =>
      ipcRenderer.invoke('settings:save-remote-config', config) as Promise<RemoteDatabaseConfigView>,
    saveRemoteSyncConfig: (config: RemoteSyncConfig) =>
      ipcRenderer.invoke('settings:save-remote-sync-config', config) as Promise<RemoteSyncConfig>
  },
  remote: {
    createVelocaProject: (config: RemoteDatabaseConfigInput) =>
      ipcRenderer.invoke('remote:create-veloca-project', config) as Promise<RemoteProjectProvisionResult>,
    getSyncStatus: () => ipcRenderer.invoke('remote:get-sync-status') as Promise<RemoteSyncStatus>,
    listAvailableRegions: (config: RemoteDatabaseConfigInput) =>
      ipcRenderer.invoke('remote:list-available-regions', config) as Promise<RemoteRegionOption[]>,
    retryFailedSync: () => ipcRenderer.invoke('remote:retry-failed-sync') as Promise<RemoteSyncStatus>,
    syncNow: () => ipcRenderer.invoke('remote:sync-now') as Promise<RemoteSyncStatus>,
    testConnection: () => ipcRenderer.invoke('remote:test-connection') as Promise<RemoteDatabaseConfigView>
  },
  workspace: {
    get: () => ipcRenderer.invoke('workspace:get') as Promise<WorkspaceSnapshot>,
    addFolder: () => ipcRenderer.invoke('workspace:add-folder') as Promise<WorkspaceSnapshot>,
    createDatabaseWorkspace: (name: string) =>
      ipcRenderer.invoke('workspace:create-database-workspace', name) as Promise<FileOperationResult>,
    readMarkdown: (filePath: string) =>
      ipcRenderer.invoke('workspace:read-markdown', filePath) as Promise<MarkdownFileContent>,
    watchMarkdownFiles: (filePaths: string[]) =>
      ipcRenderer.invoke('workspace:set-markdown-watch-paths', filePaths) as Promise<void>,
    saveMarkdown: (filePath: string, content: string) =>
      ipcRenderer.invoke('workspace:save-markdown', filePath, content) as Promise<MarkdownFileContent>,
    saveMarkdownAs: (parentPath: string, name: string, content: string) =>
      ipcRenderer.invoke('workspace:save-markdown-as', parentPath, name, content) as Promise<SaveMarkdownFileAsResult>,
    readProvenance: (documentKey: string) =>
      ipcRenderer.invoke('workspace:read-provenance', documentKey) as Promise<DocumentProvenanceSnapshot | null>,
    saveProvenance: (snapshot: DocumentProvenanceSnapshot) =>
      ipcRenderer.invoke('workspace:save-provenance', snapshot) as Promise<DocumentProvenanceSnapshot>,
    deleteProvenance: (documentKey: string) =>
      ipcRenderer.invoke('workspace:delete-provenance', documentKey) as Promise<void>,
    saveAsset: (documentPath: string, payload: WorkspaceAssetPayload) =>
      ipcRenderer.invoke('workspace:save-asset', documentPath, payload) as Promise<WorkspaceResolvedAsset>,
    resolveAsset: (documentPath: string, assetPath: string) =>
      ipcRenderer.invoke('workspace:resolve-asset', documentPath, assetPath) as Promise<WorkspaceResolvedAsset>,
    readAssetMeta: (documentPath: string, assetPath: string) =>
      ipcRenderer.invoke('workspace:read-asset-meta', documentPath, assetPath) as Promise<WorkspaceResolvedAsset>,
    createEntry: (parentPath: string, entryType: 'file' | 'folder', name: string) =>
      ipcRenderer.invoke('workspace:create-entry', parentPath, entryType, name) as Promise<FileOperationResult>,
    renameEntry: (filePath: string, name: string) =>
      ipcRenderer.invoke('workspace:rename-entry', filePath, name) as Promise<FileOperationResult>,
    duplicateEntry: (filePath: string) =>
      ipcRenderer.invoke('workspace:duplicate-entry', filePath) as Promise<FileOperationResult>,
    pasteEntry: (sourcePath: string, targetFolderPath: string, mode: 'copy' | 'cut') =>
      ipcRenderer.invoke('workspace:paste-entry', sourcePath, targetFolderPath, mode) as Promise<FileOperationResult>,
    deleteEntry: (filePath: string) =>
      ipcRenderer.invoke('workspace:delete-entry', filePath) as Promise<WorkspaceSnapshot>,
    removeFolder: (workspaceFolderId: string) =>
      ipcRenderer.invoke('workspace:remove-folder', workspaceFolderId) as Promise<WorkspaceSnapshot>,
    reveal: (filePath: string) => ipcRenderer.invoke('workspace:reveal', filePath) as Promise<void>,
    openPath: (filePath: string) => ipcRenderer.invoke('workspace:open-path', filePath) as Promise<string>,
    copyPath: (filePath: string) => ipcRenderer.invoke('workspace:copy-path', filePath) as Promise<void>,
    onChanged: (callback: (snapshot: WorkspaceSnapshot) => void) => {
      const listener = (_event: IpcRendererEvent, snapshot: WorkspaceSnapshot) => callback(snapshot);

      ipcRenderer.on('workspace:changed', listener);

      return () => ipcRenderer.removeListener('workspace:changed', listener);
    },
    onMarkdownFileChanged: (callback: (change: WatchedMarkdownFileChange) => void) => {
      const listener = (_event: IpcRendererEvent, change: WatchedMarkdownFileChange) => callback(change);

      ipcRenderer.on('workspace:markdown-file-changed', listener);

      return () => ipcRenderer.removeListener('workspace:markdown-file-changed', listener);
    }
  },
  app: {
    checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates') as Promise<UpdateCheckResult>,
    getInfo: () => ipcRenderer.invoke('app:get-info') as Promise<AppInfo>,
    listOpenSourceComponents: () =>
      ipcRenderer.invoke('app:list-open-source-components') as Promise<OpenSourceComponent[]>,
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url) as Promise<void>,
    platform: process.platform
  },
  windowControls: {
    close: () => ipcRenderer.invoke('window:close') as Promise<void>,
    isMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<boolean>,
    onMaximizedChange: (callback: (maximized: boolean) => void) => {
      const listener = (_event: IpcRendererEvent, maximized: boolean) => callback(maximized);

      ipcRenderer.on('window:maximized-changed', listener);

      return () => ipcRenderer.removeListener('window:maximized-changed', listener);
    }
  },
  github: {
    getStatus: () => ipcRenderer.invoke('github:get-status') as Promise<GitHubAuthStatus>,
    startBinding: () => ipcRenderer.invoke('github:start-binding') as Promise<GitHubDeviceBinding>,
    completeBinding: (sessionId: string) =>
      ipcRenderer.invoke('github:complete-binding', sessionId) as Promise<GitHubAuthStatus>,
    unbind: () => ipcRenderer.invoke('github:unbind') as Promise<GitHubAuthStatus>,
    openVerificationUrl: (url: string) => ipcRenderer.invoke('github:open-verification-url', url) as Promise<void>
  },
  versionManager: {
    getStatus: () => ipcRenderer.invoke('version-manager:get-status') as Promise<VersionManagerStatus>,
    ensureRepository: () =>
      ipcRenderer.invoke('version-manager:ensure-repository') as Promise<VersionManagerStatus>,
    syncMarkdownFile: (filePath: string) =>
      ipcRenderer.invoke('version-manager:sync-markdown-file', filePath) as Promise<VersionSyncResult>,
    listManagedChanges: () =>
      ipcRenderer.invoke('version-manager:list-managed-changes') as Promise<VersionManagedChange[]>,
    commitAndPush: (message: string) =>
      ipcRenderer.invoke('version-manager:commit-and-push', message) as Promise<VersionCommitResult>
  },
  agent: {
    listSessions: (context?: AgentRuntimeContext) =>
      ipcRenderer.invoke('agent:list-sessions', context) as Promise<AgentStoredSession[]>,
    createSession: (context?: AgentRuntimeContext) =>
      ipcRenderer.invoke('agent:create-session', context) as Promise<AgentStoredSession>,
    inheritSessions: (sourceContext?: AgentRuntimeContext, targetContext?: AgentRuntimeContext) =>
      ipcRenderer.invoke(
        'agent:inherit-sessions',
        sourceContext,
        targetContext
      ) as Promise<AgentInheritSessionsResult>,
    sendMessage: (payload: AgentSendMessageRequest) =>
      ipcRenderer.invoke('agent:send-message', payload) as Promise<AgentSendMessageResponse>,
    streamMessage: (payload: AgentSendMessageRequest, callback: (event: AgentStreamEvent) => void) => {
      const requestId = `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const listener = (_event: IpcRendererEvent, event: AgentStreamEvent & { requestId?: string }) => {
        if (event.requestId !== requestId) {
          return;
        }

        callback(event);
      };

      ipcRenderer.on('agent:message-event', listener);
      ipcRenderer.send('agent:send-message-stream', requestId, payload);

      return () => ipcRenderer.removeListener('agent:message-event', listener);
    },
    onOpenPalette: (callback: () => void) => {
      const listener = () => callback();

      ipcRenderer.on('agent:open-palette', listener);

      return () => ipcRenderer.removeListener('agent:open-palette', listener);
    }
  }
});
