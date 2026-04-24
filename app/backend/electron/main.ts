import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  net,
  protocol,
  screen,
  shell,
  type Input,
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
  validateWorkspacePath
} from '../services/workspace-service';

interface AgentWindowAnchor {
  mode: 'center' | 'selection';
  x: number;
  y: number;
}

const agentWindowMargin = 8;
const agentWindowTopInset = 16;
const agentWindowTargetWidth = 820;
const agentWindowTargetHeight = 700;

let mainWindowRef: BrowserWindow | null = null;
let agentWindowRef: BrowserWindow | null = null;
let lastAgentShortcutAt = 0;

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

function createMainWindow(): BrowserWindow {
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
    if (!isAgentShortcutInput(input)) {
      return;
    }

    event.preventDefault();
    requestAgentOpenFromRenderer(mainWindow);
  });

  mainWindow.on('closed', () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }

    if (agentWindowRef && !agentWindowRef.isDestroyed()) {
      agentWindowRef.close();
    }
  });

  mainWindowRef = mainWindow;
  return mainWindow;
}

function createAgentWindow(): BrowserWindow {
  const agentWindow = new BrowserWindow({
    width: agentWindowTargetWidth,
    height: agentWindowTargetHeight,
    minWidth: 420,
    minHeight: 360,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Veloca Agent',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  agentWindow.setAlwaysOnTop(true, 'floating');

  if (process.env.ELECTRON_RENDERER_URL) {
    agentWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/agent.html`);
  } else {
    agentWindow.loadFile(join(__dirname, '../../frontend/agent.html'));
  }

  agentWindow.on('closed', () => {
    if (agentWindowRef === agentWindow) {
      agentWindowRef = null;
    }
  });

  agentWindowRef = agentWindow;
  return agentWindow;
}

function getAgentWindowBounds(sourceWindow: BrowserWindow | null, anchor?: AgentWindowAnchor) {
  const sourceBounds = sourceWindow?.isDestroyed() ? null : sourceWindow?.getBounds();
  const fallbackPoint = sourceBounds
    ? {
        x: sourceBounds.x + sourceBounds.width / 2,
        y: sourceBounds.y + Math.min(180, Math.max(92, sourceBounds.height * 0.22))
      }
    : screen.getCursorScreenPoint();
  const targetPoint = anchor ?? {
    mode: 'center' as const,
    x: fallbackPoint.x,
    y: fallbackPoint.y
  };
  const display = screen.getDisplayNearestPoint({
    x: Math.round(targetPoint.x),
    y: Math.round(targetPoint.y)
  });
  const workArea = display.workArea;
  const width = Math.max(420, Math.min(agentWindowTargetWidth, workArea.width - agentWindowMargin * 2));
  const height = Math.max(360, Math.min(agentWindowTargetHeight, workArea.height - agentWindowMargin * 2));
  const preferredX = targetPoint.x - width / 2;
  const preferredY = targetPoint.y - agentWindowTopInset;

  return {
    x: Math.round(
      clampNumber(preferredX, workArea.x + agentWindowMargin, workArea.x + workArea.width - width - agentWindowMargin)
    ),
    y: Math.round(
      clampNumber(preferredY, workArea.y + agentWindowMargin, workArea.y + workArea.height - height - agentWindowMargin)
    ),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function showAgentWindow(sourceWindow: BrowserWindow | null, anchor?: AgentWindowAnchor): void {
  const agentWindow = agentWindowRef && !agentWindowRef.isDestroyed() ? agentWindowRef : createAgentWindow();
  const bounds = getAgentWindowBounds(sourceWindow, anchor);

  agentWindow.setBounds(bounds, false);
  agentWindow.show();
  agentWindow.focus();
}

function requestAgentOpenFromRenderer(sourceWindow: BrowserWindow): void {
  const now = Date.now();

  if (now - lastAgentShortcutAt < 180) {
    return;
  }

  lastAgentShortcutAt = now;
  sourceWindow.webContents.send('agent:request-open');
}

function isAgentShortcutInput(input: Input): boolean {
  const normalizedKey = input.key.toLowerCase();
  const normalizedCode = input.code.toLowerCase();

  return (
    normalizedKey === 'fn' ||
    normalizedCode === 'fn' ||
    ((input.meta || input.control) && normalizedKey === 'j')
  );
}

function registerAgentShortcuts(): void {
  const shortcuts = ['CommandOrControl+J', 'Fn'];

  for (const shortcut of shortcuts) {
    try {
      globalShortcut.register(shortcut, () => {
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
          requestAgentOpenFromRenderer(mainWindowRef);
          return;
        }

        showAgentWindow(null);
      });
    } catch {
      // Some platforms do not expose Fn as an Electron accelerator.
    }
  }
}

function registerIpcHandlers(): void {
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
  ipcMain.handle('agent:open', (event, anchor?: AgentWindowAnchor) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindowRef;
    showAgentWindow(sourceWindow, anchor);
  });
  ipcMain.handle('agent:close', () => {
    if (agentWindowRef && !agentWindowRef.isDestroyed()) {
      agentWindowRef.hide();
    }
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
  registerAgentShortcuts();
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
  globalShortcut.unregisterAll();
  closeDatabase();
});
