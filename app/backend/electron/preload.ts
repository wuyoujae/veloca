import { contextBridge, ipcRenderer } from 'electron';
import type { ThemeMode } from '../services/settings-store';

contextBridge.exposeInMainWorld('veloca', {
  settings: {
    getTheme: () => ipcRenderer.invoke('settings:get-theme') as Promise<ThemeMode>,
    setTheme: (theme: ThemeMode) => ipcRenderer.invoke('settings:set-theme', theme) as Promise<ThemeMode>
  },
  app: {
    platform: process.platform
  }
});
