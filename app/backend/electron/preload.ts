import { contextBridge, ipcRenderer } from 'electron';
import type { ThemeMode } from '../services/settings-store';
import type {
  FileOperationResult,
  MarkdownFileContent,
  WorkspaceAssetPayload,
  WorkspaceResolvedAsset,
  WorkspaceSnapshot
} from '../services/workspace-service';

contextBridge.exposeInMainWorld('veloca', {
  settings: {
    getTheme: () => ipcRenderer.invoke('settings:get-theme') as Promise<ThemeMode>,
    setTheme: (theme: ThemeMode) => ipcRenderer.invoke('settings:set-theme', theme) as Promise<ThemeMode>,
    getAutoSave: () => ipcRenderer.invoke('settings:get-auto-save') as Promise<boolean>,
    setAutoSave: (enabled: boolean) =>
      ipcRenderer.invoke('settings:set-auto-save', enabled) as Promise<boolean>
  },
  workspace: {
    get: () => ipcRenderer.invoke('workspace:get') as Promise<WorkspaceSnapshot>,
    addFolder: () => ipcRenderer.invoke('workspace:add-folder') as Promise<WorkspaceSnapshot>,
    createDatabaseWorkspace: (name: string) =>
      ipcRenderer.invoke('workspace:create-database-workspace', name) as Promise<FileOperationResult>,
    readMarkdown: (filePath: string) =>
      ipcRenderer.invoke('workspace:read-markdown', filePath) as Promise<MarkdownFileContent>,
    saveMarkdown: (filePath: string, content: string) =>
      ipcRenderer.invoke('workspace:save-markdown', filePath, content) as Promise<MarkdownFileContent>,
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
    copyPath: (filePath: string) => ipcRenderer.invoke('workspace:copy-path', filePath) as Promise<void>
  },
  app: {
    platform: process.platform
  }
});
