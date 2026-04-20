import { contextBridge, ipcRenderer } from 'electron';
import type { ThemeMode } from '../services/settings-store';
import type {
  MarkdownFileContent,
  WorkspaceSnapshot
} from '../services/workspace-service';

contextBridge.exposeInMainWorld('veloca', {
  settings: {
    getTheme: () => ipcRenderer.invoke('settings:get-theme') as Promise<ThemeMode>,
    setTheme: (theme: ThemeMode) => ipcRenderer.invoke('settings:set-theme', theme) as Promise<ThemeMode>
  },
  workspace: {
    get: () => ipcRenderer.invoke('workspace:get') as Promise<WorkspaceSnapshot>,
    addFolder: () => ipcRenderer.invoke('workspace:add-folder') as Promise<WorkspaceSnapshot>,
    readMarkdown: (filePath: string) =>
      ipcRenderer.invoke('workspace:read-markdown', filePath) as Promise<MarkdownFileContent>
  },
  app: {
    platform: process.platform
  }
});
