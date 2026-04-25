import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  type OpenDialogOptions
} from 'electron';
import { join } from 'node:path';
import { closeDatabase, getDatabase } from '../database/connection';
import {
  getAutoSave,
  getTheme,
  setAutoSave,
  setTheme,
  type ThemeMode
} from '../services/settings-store';
import {
  createAgentSession,
  listAgentSessions,
  sendAgentMessage,
  streamAgentMessage,
  type AgentSendMessageRequest
} from '../services/agent-service';
import {
  addWorkspaceFolders,
  createDatabaseWorkspace,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  duplicateWorkspaceEntry,
  getWorkspaceSnapshot,
  pasteWorkspaceEntry,
  readMarkdownFile,
  readWorkspaceAssetBinary,
  readWorkspaceAssetMeta,
  removeWorkspaceFolder,
  renameWorkspaceEntry,
  resolveWorkspaceAsset,
  saveMarkdownFile,
  saveWorkspaceAsset,
  validateWorkspacePath,
  type WorkspaceSnapshot
} from '../services/workspace-service';

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 620,
    title: 'Veloca',
    backgroundColor: '#09090b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 13 },
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../../frontend/index.html'));
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const normalizedKey = input.key.toLowerCase();
    const normalizedCode = input.code.toLowerCase();
    const isFnKey =
      normalizedKey === 'fn' ||
      normalizedCode === 'fn' ||
      normalizedKey === 'fnlock' ||
      normalizedCode === 'fnlock';

    if (input.type !== 'keyDown' || input.isAutoRepeat || !isFnKey) {
      return;
    }

    event.preventDefault();
    mainWindow.webContents.send('agent:open-palette');
  });
}

function registerIpcHandlers(): void {
  const broadcastWorkspaceChanged = (snapshot: WorkspaceSnapshot) => {

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('workspace:changed', snapshot);
      }
    }

    return snapshot;
  };

  ipcMain.handle('settings:get-theme', () => getTheme());
  ipcMain.handle('settings:set-theme', (_event, theme: ThemeMode) => {
    if (theme !== 'dark' && theme !== 'light') {
      return getTheme();
    }

    return setTheme(theme);
  });
  ipcMain.handle('settings:get-auto-save', () => getAutoSave());
  ipcMain.handle('settings:set-auto-save', (_event, enabled: boolean) => {
    return setAutoSave(Boolean(enabled));
  });
  ipcMain.handle('agent:send-message', (_event, request: AgentSendMessageRequest) => {
    return sendAgentMessage(request, {
      onWorkspaceChanged: broadcastWorkspaceChanged
    });
  });
  ipcMain.handle('agent:list-sessions', () => {
    return listAgentSessions();
  });
  ipcMain.handle('agent:create-session', () => {
    return createAgentSession();
  });
  ipcMain.on('agent:send-message-stream', (event, requestId: string, request: AgentSendMessageRequest) => {
    if (!requestId || typeof requestId !== 'string') {
      return;
    }

    const sender = event.sender;

    void streamAgentMessage(
      request,
      (message) => {
        if (sender.isDestroyed()) {
          return;
        }

        sender.send('agent:message-event', {
          ...message,
          requestId
        });
      },
      {
        onWorkspaceChanged: broadcastWorkspaceChanged
      }
    );
  });
  ipcMain.handle('workspace:get', () => getWorkspaceSnapshot());
  ipcMain.handle('workspace:add-folder', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const dialogOptions: OpenDialogOptions = {
      title: 'Add Folder to Workspace',
      properties: ['openDirectory', 'multiSelections']
    };
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return getWorkspaceSnapshot();
    }

    return addWorkspaceFolders(result.filePaths);
  });
  ipcMain.handle('workspace:create-database-workspace', (_event, name: string) => {
    return createDatabaseWorkspace(name);
  });
  ipcMain.handle('workspace:read-markdown', (_event, filePath: string) => {
    return readMarkdownFile(filePath);
  });
  ipcMain.handle('workspace:save-markdown', (_event, filePath: string, content: string) => {
    return saveMarkdownFile(filePath, content);
  });
  ipcMain.handle('workspace:save-asset', (_event, documentPath: string, payload) => {
    return saveWorkspaceAsset(documentPath, payload);
  });
  ipcMain.handle('workspace:resolve-asset', (_event, documentPath: string, assetPath: string) => {
    return resolveWorkspaceAsset(documentPath, assetPath);
  });
  ipcMain.handle('workspace:read-asset-meta', (_event, documentPath: string, assetPath: string) => {
    return readWorkspaceAssetMeta(documentPath, assetPath);
  });
  ipcMain.handle(
    'workspace:create-entry',
    (_event, parentPath: string, entryType: 'file' | 'folder', name: string) => {
      return createWorkspaceEntry(parentPath, entryType, name);
    }
  );
  ipcMain.handle('workspace:rename-entry', (_event, filePath: string, name: string) => {
    return renameWorkspaceEntry(filePath, name);
  });
  ipcMain.handle('workspace:duplicate-entry', (_event, filePath: string) => {
    return duplicateWorkspaceEntry(filePath);
  });
  ipcMain.handle(
    'workspace:paste-entry',
    (_event, sourcePath: string, targetFolderPath: string, mode: 'copy' | 'cut') => {
      return pasteWorkspaceEntry(sourcePath, targetFolderPath, mode);
    }
  );
  ipcMain.handle('workspace:delete-entry', async (_event, filePath: string) => {
    if (filePath.startsWith('veloca-db://')) {
      return deleteWorkspaceEntry(filePath);
    }

    const resolvedPath = validateWorkspacePath(filePath);
    await shell.trashItem(resolvedPath);
    return getWorkspaceSnapshot();
  });
  ipcMain.handle('workspace:remove-folder', (_event, workspaceFolderId: string) => {
    return removeWorkspaceFolder(workspaceFolderId);
  });
  ipcMain.handle('workspace:reveal', (_event, filePath: string) => {
    const resolvedPath = validateWorkspacePath(filePath);
    shell.showItemInFolder(resolvedPath);
  });
  ipcMain.handle('workspace:open-path', (_event, filePath: string) => {
    const resolvedPath = validateWorkspacePath(filePath);
    return shell.openPath(resolvedPath);
  });
  ipcMain.handle('workspace:copy-path', (_event, filePath: string) => {
    const resolvedPath = validateWorkspacePath(filePath);
    clipboard.writeText(resolvedPath);
  });
}

function registerAssetProtocol(): void {
  protocol.handle('veloca-asset', async (request) => {
    const requestUrl = new URL(request.url);
    const documentPath = requestUrl.searchParams.get('documentPath');
    const assetPath = requestUrl.searchParams.get('assetPath');

    if (!documentPath || !assetPath) {
      return new Response('Invalid asset request.', { status: 400 });
    }

    try {
      const asset = resolveWorkspaceAsset(documentPath, assetPath);

      if (asset.isExternal) {
        return net.fetch(asset.url);
      }

      const binary = readWorkspaceAssetBinary(documentPath, assetPath);

      return new Response(new Uint8Array(binary.buffer), {
        headers: {
          'Content-Length': String(binary.byteSize),
          'Content-Type': binary.mimeType
        }
      });
    } catch {
      return new Response('Asset not found.', { status: 404 });
    }
  });
}

app.whenReady().then(() => {
  getDatabase();
  registerIpcHandlers();
  registerAssetProtocol();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  closeDatabase();
});
