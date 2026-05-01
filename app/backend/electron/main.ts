import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  net,
  protocol,
  shell,
  type OpenDialogOptions
} from 'electron';
import { basename, dirname, join } from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { closeDatabase, getDatabase } from '../database/connection';
import {
  getAiBaseUrl,
  getAiApiKey,
  getAiModel,
  getAiContextWindow,
  getAutoSave,
  getTheme,
  setAiConfig,
  setAutoSave,
  setTheme,
  type AiModelConfig,
  type ThemeMode
} from '../services/settings-store';
import {
  getRemoteDatabaseConfig,
  listAvailableRemoteRegions,
  provisionRemoteVelocaProject,
  saveRemoteDatabaseConfig,
  testRemoteDatabaseConnection,
  type RemoteDatabaseConfigInput
} from '../services/remote-database-service';
import {
  completeGitHubBinding,
  getGitHubAuthStatus,
  startGitHubBinding,
  unbindGitHubAccount
} from '../services/github-auth-service';
import {
  createAgentSession,
  inheritAgentSessions,
  listAgentSessions,
  sendAgentMessage,
  streamAgentMessage,
  type AgentRuntimeContext,
  type AgentSendMessageRequest
} from '../services/agent-service';
import {
  addWorkspaceFolders,
  createDatabaseWorkspace,
  createWorkspaceEntry,
  deactivateFilesystemDocumentProvenance,
  deleteWorkspaceEntry,
  deleteDocumentProvenanceSnapshot,
  duplicateWorkspaceEntry,
  getWorkspaceSnapshot,
  pasteWorkspaceEntry,
  readDocumentProvenanceSnapshot,
  readMarkdownFile,
  readWorkspaceAssetBinary,
  readWorkspaceAssetMeta,
  removeWorkspaceFolder,
  renameWorkspaceEntry,
  resolveWorkspaceAsset,
  saveMarkdownFileAs,
  saveMarkdownFile,
  saveDocumentProvenanceSnapshot,
  saveWorkspaceAsset,
  validateWorkspacePath,
  type DocumentProvenanceSnapshot,
  type WorkspaceSnapshot
} from '../services/workspace-service';
import {
  commitAndPushVersionChanges,
  ensureVersionRepository,
  getVersionManagerStatus,
  listManagedChanges,
  markWorkspaceVersionConfigRemoved,
  syncMarkdownFile
} from '../services/version-manager-service';

interface WatchedMarkdownFile {
  timer: ReturnType<typeof setTimeout> | null;
  watcher: FSWatcher;
}

const markdownWatchersByWindow = new Map<number, Map<string, WatchedMarkdownFile>>();

function closeMarkdownWatchers(windowId: number): void {
  const watchers = markdownWatchersByWindow.get(windowId);

  if (!watchers) {
    return;
  }

  for (const watchedFile of watchers.values()) {
    if (watchedFile.timer) {
      clearTimeout(watchedFile.timer);
    }

    watchedFile.watcher.close();
  }

  markdownWatchersByWindow.delete(windowId);
}

function sendWatchedMarkdownFileChange(window: BrowserWindow, filePath: string): void {
  if (window.isDestroyed()) {
    return;
  }

  try {
    const file = readMarkdownFile(filePath);
    window.webContents.send('workspace:markdown-file-changed', {
      file,
      path: filePath,
      status: 'changed'
    });
  } catch {
    window.webContents.send('workspace:markdown-file-changed', {
      path: filePath,
      status: 'unavailable'
    });
  }
}

function scheduleWatchedMarkdownFileChange(window: BrowserWindow, filePath: string): void {
  const watchers = markdownWatchersByWindow.get(window.id);
  const watchedFile = watchers?.get(filePath);

  if (!watchedFile) {
    return;
  }

  if (watchedFile.timer) {
    clearTimeout(watchedFile.timer);
  }

  watchedFile.timer = setTimeout(() => {
    watchedFile.timer = null;
    sendWatchedMarkdownFileChange(window, filePath);
  }, 120);
}

function setWatchedMarkdownFiles(window: BrowserWindow, filePaths: string[]): void {
  const uniquePaths = new Set(
    filePaths.filter((filePath) => typeof filePath === 'string' && !filePath.startsWith('veloca-db://'))
  );
  let watchers = markdownWatchersByWindow.get(window.id);

  if (!watchers) {
    watchers = new Map();
    markdownWatchersByWindow.set(window.id, watchers);
  }

  for (const [filePath, watchedFile] of watchers) {
    if (uniquePaths.has(filePath)) {
      continue;
    }

    if (watchedFile.timer) {
      clearTimeout(watchedFile.timer);
    }

    watchedFile.watcher.close();
    watchers.delete(filePath);
  }

  for (const filePath of uniquePaths) {
    if (watchers.has(filePath)) {
      continue;
    }

    try {
      readMarkdownFile(filePath);
      const watcher = watch(dirname(filePath), (_eventType, changedName) => {
        if (!changedName || changedName.toString() === basename(filePath)) {
          scheduleWatchedMarkdownFileChange(window, filePath);
        }
      });
      watchers.set(filePath, {
        timer: null,
        watcher
      });
    } catch {
      // Invalid or unavailable workspace paths are ignored until the renderer sends a fresh watch list.
    }
  }
}

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 620,
    title: 'Veloca',
    icon: nativeImage.createFromPath(join(__dirname, '../../resources/icon.png')),
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

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.info(`[Veloca Renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.on('closed', () => {
    closeMarkdownWatchers(mainWindow.id);
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
  ipcMain.handle('settings:get-ai-config', () => {
    return {
      baseUrl: getAiBaseUrl() ?? '',
      apiKey: getAiApiKey() ?? '',
      model: getAiModel() ?? '',
      contextWindow: getAiContextWindow() ?? 0
    };
  });
  ipcMain.handle('settings:set-ai-config', (_event, config: AiModelConfig) => {
    if (
      !config ||
      typeof config.baseUrl !== 'string' ||
      typeof config.apiKey !== 'string' ||
      typeof config.model !== 'string' ||
      typeof config.contextWindow !== 'number' ||
      config.contextWindow <= 0
    ) {
      throw new Error('Invalid AI model configuration.');
    }

    return setAiConfig(config);
  });
  ipcMain.handle('settings:get-remote-config', () => {
    return getRemoteDatabaseConfig();
  });
  ipcMain.handle('settings:save-remote-config', (_event, config: RemoteDatabaseConfigInput) => {
    if (
      !config ||
      typeof config.organizationSlug !== 'string' ||
      typeof config.region !== 'string' ||
      (config.personalAccessToken !== undefined && typeof config.personalAccessToken !== 'string') ||
      (config.databasePassword !== undefined && typeof config.databasePassword !== 'string')
    ) {
      throw new Error('Invalid remote database configuration.');
    }

    return saveRemoteDatabaseConfig(config);
  });
  ipcMain.handle('remote:create-veloca-project', (_event, config: RemoteDatabaseConfigInput) => {
    if (
      !config ||
      typeof config.organizationSlug !== 'string' ||
      typeof config.region !== 'string' ||
      (config.personalAccessToken !== undefined && typeof config.personalAccessToken !== 'string') ||
      (config.databasePassword !== undefined && typeof config.databasePassword !== 'string')
    ) {
      throw new Error('Invalid remote database configuration.');
    }

    return provisionRemoteVelocaProject(config);
  });
  ipcMain.handle('remote:list-available-regions', (_event, config: RemoteDatabaseConfigInput) => {
    if (
      !config ||
      typeof config.organizationSlug !== 'string' ||
      typeof config.region !== 'string' ||
      (config.personalAccessToken !== undefined && typeof config.personalAccessToken !== 'string') ||
      (config.databasePassword !== undefined && typeof config.databasePassword !== 'string')
    ) {
      throw new Error('Invalid remote database configuration.');
    }

    return listAvailableRemoteRegions(config);
  });
  ipcMain.handle('remote:test-connection', () => {
    return testRemoteDatabaseConnection();
  });
  ipcMain.handle('github:get-status', () => getGitHubAuthStatus());
  ipcMain.handle('github:start-binding', async () => {
    const binding = await startGitHubBinding();
    await shell.openExternal(binding.verificationUri);

    return binding;
  });
  ipcMain.handle('github:complete-binding', (_event, sessionId: string) => {
    return completeGitHubBinding(sessionId);
  });
  ipcMain.handle('github:unbind', () => {
    return unbindGitHubAccount();
  });
  ipcMain.handle('github:open-verification-url', async (_event, url: string) => {
    if (url !== 'https://github.com/login/device') {
      throw new Error('Only the GitHub device verification URL can be opened.');
    }

    await shell.openExternal(url);
  });
  ipcMain.handle('agent:send-message', (_event, request: AgentSendMessageRequest) => {
    return sendAgentMessage(request, {
      onWorkspaceChanged: broadcastWorkspaceChanged
    });
  });
  ipcMain.handle('agent:list-sessions', (_event, context: AgentRuntimeContext | undefined) => {
    return listAgentSessions(context);
  });
  ipcMain.handle('agent:create-session', (_event, context: AgentRuntimeContext | undefined) => {
    return createAgentSession(context);
  });
  ipcMain.handle(
    'agent:inherit-sessions',
    (
      _event,
      sourceContext: AgentRuntimeContext | undefined,
      targetContext: AgentRuntimeContext | undefined
    ) => {
      return inheritAgentSessions(sourceContext, targetContext);
    }
  );
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
  ipcMain.handle('workspace:set-markdown-watch-paths', (event, filePaths: string[]) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window || !Array.isArray(filePaths)) {
      return;
    }

    setWatchedMarkdownFiles(window, filePaths);
  });
  ipcMain.handle('workspace:save-markdown', async (_event, filePath: string, content: string) => {
    const file = saveMarkdownFile(filePath, content);

    try {
      await syncMarkdownFile(file.path);
    } catch (error) {
      console.error('Veloca version sync failed after saving markdown.', error);
    }

    return file;
  });
  ipcMain.handle('workspace:save-markdown-as', async (_event, parentPath: string, name: string, content: string) => {
    const result = saveMarkdownFileAs(parentPath, name, content);

    try {
      await syncMarkdownFile(result.file.path);
    } catch (error) {
      console.error('Veloca version sync failed after saving markdown as.', error);
    }

    return result;
  });
  ipcMain.handle('workspace:read-provenance', (_event, documentKey: string) => {
    return readDocumentProvenanceSnapshot(documentKey);
  });
  ipcMain.handle('workspace:save-provenance', (_event, snapshot: DocumentProvenanceSnapshot) => {
    return saveDocumentProvenanceSnapshot(snapshot);
  });
  ipcMain.handle('workspace:delete-provenance', (_event, documentKey: string) => {
    deleteDocumentProvenanceSnapshot(documentKey);
  });
  ipcMain.handle('version-manager:get-status', () => getVersionManagerStatus());
  ipcMain.handle('version-manager:ensure-repository', () => ensureVersionRepository());
  ipcMain.handle('version-manager:sync-markdown-file', (_event, filePath: string) => {
    return syncMarkdownFile(filePath);
  });
  ipcMain.handle('version-manager:list-managed-changes', () => listManagedChanges());
  ipcMain.handle('version-manager:commit-and-push', (_event, message: string) => {
    return commitAndPushVersionChanges(message);
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
    deactivateFilesystemDocumentProvenance(resolvedPath);
    await shell.trashItem(resolvedPath);
    return getWorkspaceSnapshot();
  });
  ipcMain.handle('workspace:remove-folder', (_event, workspaceFolderId: string) => {
    markWorkspaceVersionConfigRemoved(workspaceFolderId);
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
