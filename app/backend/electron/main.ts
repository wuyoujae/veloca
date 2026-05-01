import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
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
  getAppearanceSettings,
  getAutoSave,
  getShortcutSettings,
  getTheme,
  getTypographySettings,
  normalizeEditorFontSize,
  setAiConfig,
  setAppearanceSettings,
  setAutoSave,
  setShortcutSettings,
  setTheme,
  setTypographySettings,
  type AiModelConfig,
  type AppearanceSettings,
  type ShortcutSettings,
  type ThemeMode,
  type TypographySettings
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
import {
  getRemoteSyncConfig,
  getRemoteSyncStatus,
  markRemoteDatabaseWorkspaceDirty,
  markRemoteMarkdownOpened,
  markRemoteMarkdownSaved,
  markRemotePathDeleted,
  runRemoteSync,
  runRemoteSyncInBackground,
  saveRemoteSyncConfig,
  type RemoteSyncConfig
} from '../services/remote-sync-service';
import { getAppInfo, listOpenSourceComponents } from '../services/app-info-service';
import {
  checkForAppUpdates,
  initializeAutoUpdates,
  installDownloadedAppUpdate,
  onUpdateStatusChanged
} from '../services/auto-update-service';

const agentStreamControllers = new Map<string, AbortController>();

interface WatchedMarkdownFile {
  timer: ReturnType<typeof setTimeout> | null;
  watcher: FSWatcher;
}

const markdownWatchersByWindow = new Map<number, Map<string, WatchedMarkdownFile>>();
const customWindowControlPlatforms = new Set<NodeJS.Platform>(['win32', 'linux']);
let mainWindow: BrowserWindow | null = null;
let focusVelocaShortcutCache = '';
let openAiPanelShortcutCache = '';
let registeredFocusVelocaShortcut = '';

function normalizeShortcutKeyLabel(key: string): string | null {
  const trimmedKey = key.trim();
  const lowerKey = trimmedKey.toLowerCase();

  if (!trimmedKey || ['meta', 'control', 'ctrl', 'shift', 'alt', 'option', 'fn', 'fnlock'].includes(lowerKey)) {
    return null;
  }

  const namedKeys: Record<string, string> = {
    ' ': 'Space',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    arrowup: 'ArrowUp',
    backspace: 'Backspace',
    del: 'Delete',
    delete: 'Delete',
    end: 'End',
    enter: 'Enter',
    escape: 'Esc',
    esc: 'Esc',
    home: 'Home',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    return: 'Enter',
    space: 'Space',
    spacebar: 'Space',
    tab: 'Tab'
  };

  if (namedKeys[lowerKey]) {
    return namedKeys[lowerKey];
  }

  if (/^f\d{1,2}$/i.test(trimmedKey)) {
    return trimmedKey.toUpperCase();
  }

  if (trimmedKey.length === 1) {
    return trimmedKey.toUpperCase();
  }

  return trimmedKey[0].toUpperCase() + trimmedKey.slice(1);
}

function doesShortcutMatchInput(
  shortcut: string,
  input: { alt: boolean; control: boolean; key: string; meta: boolean; shift: boolean }
): boolean {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return false;
  }

  const required = {
    alt: false,
    ctrl: false,
    meta: false,
    shift: false
  };
  let requiredKey = '';

  for (const part of parts) {
    const lowerPart = part.toLowerCase();

    if (lowerPart === 'command' || lowerPart === 'cmd' || lowerPart === 'meta') {
      required.meta = true;
    } else if (lowerPart === 'ctrl' || lowerPart === 'control') {
      required.ctrl = true;
    } else if (lowerPart === 'alt' || lowerPart === 'option') {
      required.alt = true;
    } else if (lowerPart === 'shift') {
      required.shift = true;
    } else {
      requiredKey = normalizeShortcutKeyLabel(part) ?? '';
    }
  }

  return Boolean(
    requiredKey &&
      requiredKey === normalizeShortcutKeyLabel(input.key) &&
      required.meta === input.meta &&
      required.ctrl === input.control &&
      required.alt === input.alt &&
      required.shift === input.shift
  );
}

function getOpenAiPanelShortcut(): string {
  if (!openAiPanelShortcutCache) {
    openAiPanelShortcutCache = getShortcutSettings(process.platform).openAiPanel;
  }

  return openAiPanelShortcutCache;
}

function getFocusVelocaShortcut(): string {
  if (!focusVelocaShortcutCache) {
    focusVelocaShortcutCache = getShortcutSettings(process.platform).focusVeloca;
  }

  return focusVelocaShortcutCache;
}

function focusVelocaWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  app.focus();
  mainWindow.focus();
}

function registerFocusVelocaShortcut(): void {
  if (registeredFocusVelocaShortcut) {
    globalShortcut.unregister(registeredFocusVelocaShortcut);
    registeredFocusVelocaShortcut = '';
  }

  const shortcut = getFocusVelocaShortcut();

  if (!shortcut) {
    return;
  }

  if (globalShortcut.register(shortcut, focusVelocaWindow)) {
    registeredFocusVelocaShortcut = shortcut;
  } else {
    console.warn(`Veloca failed to register focus shortcut: ${shortcut}`);
  }
}

function applyShortcutSettings(settings: ShortcutSettings): void {
  focusVelocaShortcutCache = settings.focusVeloca;
  openAiPanelShortcutCache = settings.openAiPanel;
  registerFocusVelocaShortcut();
}

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
  const useCustomWindowControls = customWindowControlPlatforms.has(process.platform);
  const createdWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 620,
    title: 'Veloca',
    icon: nativeImage.createFromPath(join(__dirname, '../../resources/icon.png')),
    backgroundColor: '#09090b',
    show: false,
    autoHideMenuBar: useCustomWindowControls,
    ...(useCustomWindowControls
      ? {
          frame: false
        }
      : {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 13 }
        }),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow = createdWindow;

  const showWindowWhenReady = () => {
    if (!createdWindow.isDestroyed() && !createdWindow.isVisible()) {
      createdWindow.show();
    }
  };

  const sendMaximizedState = () => {
    if (!createdWindow.isDestroyed()) {
      createdWindow.webContents.send('window:maximized-changed', createdWindow.isMaximized());
    }
  };

  if (useCustomWindowControls) {
    createdWindow.setMenuBarVisibility(false);
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    createdWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    createdWindow.loadFile(join(__dirname, '../../frontend/index.html'));
  }

  createdWindow.once('ready-to-show', showWindowWhenReady);
  createdWindow.webContents.once('did-finish-load', () => {
    setTimeout(showWindowWhenReady, 80);
  });
  createdWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Veloca failed to load renderer ${validatedURL}: ${errorCode} ${errorDescription}`);
    showWindowWhenReady();
  });
  createdWindow.on('maximize', sendMaximizedState);
  createdWindow.on('unmaximize', sendMaximizedState);

  createdWindow.webContents.on('before-input-event', (event, input) => {
    const normalizedKey = input.key.toLowerCase();
    const normalizedCode = input.code.toLowerCase();
    const isFnKey =
      normalizedKey === 'fn' ||
      normalizedCode === 'fn' ||
      normalizedKey === 'fnlock' ||
      normalizedCode === 'fnlock';
    const isOpenAiPanelShortcut = doesShortcutMatchInput(getOpenAiPanelShortcut(), input);
    const isFocusVelocaShortcut = doesShortcutMatchInput(getFocusVelocaShortcut(), input);

    if (input.type !== 'keyDown' || input.isAutoRepeat || (!isFnKey && !isOpenAiPanelShortcut && !isFocusVelocaShortcut)) {
      return;
    }

    event.preventDefault();

    if (isFnKey || isOpenAiPanelShortcut) {
      createdWindow.webContents.send('agent:open-palette');
      return;
    }

    focusVelocaWindow();
  });

  createdWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.info(`[Veloca Renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  createdWindow.on('closed', () => {
    closeMarkdownWatchers(createdWindow.id);

    if (mainWindow === createdWindow) {
      mainWindow = null;
    }
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
  const isRemoteSyncConfig = (config: RemoteSyncConfig): boolean => {
    return Boolean(
      config &&
        typeof config.autoSyncEnabled === 'boolean' &&
        typeof config.pullOnStartup === 'boolean' &&
        typeof config.pushOnSave === 'boolean' &&
        typeof config.syncLocalOpenedMarkdown === 'boolean' &&
        typeof config.syncDatabaseWorkspaces === 'boolean' &&
        typeof config.syncAssets === 'boolean' &&
        typeof config.syncProvenance === 'boolean' &&
        typeof config.syncDeletes === 'boolean' &&
        config.conflictPolicy === 1
    );
  };
  const isShortcutSettings = (settings: ShortcutSettings): boolean => {
    return Boolean(
      settings &&
        typeof settings.focusVeloca === 'string' &&
        settings.focusVeloca.trim().length > 0 &&
        typeof settings.newBlankFile === 'string' &&
        settings.newBlankFile.trim().length > 0 &&
        typeof settings.openAiPanel === 'string' &&
        settings.openAiPanel.trim().length > 0 &&
        typeof settings.redo === 'string' &&
        settings.redo.trim().length > 0 &&
        typeof settings.toggleSourceMode === 'string' &&
        settings.toggleSourceMode.trim().length > 0 &&
        typeof settings.undo === 'string' &&
        settings.undo.trim().length > 0
    );
  };
  const isTypographySettings = (settings: TypographySettings): boolean => {
    return Boolean(settings && typeof settings.editorFontSize === 'number' && Number.isFinite(settings.editorFontSize));
  };
  const isAppearanceSettings = (settings: AppearanceSettings): boolean => {
    return Boolean(
      settings &&
        ['system', 'en', 'zh-CN'].includes(settings.language) &&
        ['comfortable', 'compact', 'spacious'].includes(settings.density) &&
        ['system', 'full', 'reduced'].includes(settings.motion)
    );
  };

  ipcMain.handle('settings:get-theme', () => getTheme());
  ipcMain.handle('settings:get-appearance-settings', () => getAppearanceSettings());
  ipcMain.handle('app:get-info', () => getAppInfo());
  ipcMain.handle('app:check-for-updates', () => checkForAppUpdates());
  ipcMain.handle('app:install-update', () => installDownloadedAppUpdate());
  ipcMain.handle('app:list-open-source-components', () => listOpenSourceComponents());
  ipcMain.handle('app:open-external', async (_event, url: string) => {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'https:') {
      throw new Error('Veloca only opens secure external links.');
    }

    await shell.openExternal(parsedUrl.toString());
  });
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) {
      return false;
    }

    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }

    return window.isMaximized();
  });
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });
  ipcMain.handle('settings:set-theme', (_event, theme: ThemeMode) => {
    if (theme !== 'dark' && theme !== 'light') {
      return getTheme();
    }

    return setTheme(theme);
  });
  ipcMain.handle('settings:set-appearance-settings', (_event, settings: AppearanceSettings) => {
    if (!isAppearanceSettings(settings)) {
      throw new Error('Invalid appearance settings.');
    }

    return setAppearanceSettings(settings);
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
  ipcMain.handle('settings:get-shortcut-settings', () => {
    const settings = getShortcutSettings(process.platform);
    applyShortcutSettings(settings);
    return settings;
  });
  ipcMain.handle('settings:set-shortcut-settings', (_event, settings: ShortcutSettings) => {
    if (!isShortcutSettings(settings)) {
      throw new Error('Invalid shortcut settings.');
    }

    const savedSettings = setShortcutSettings({
      focusVeloca: settings.focusVeloca.trim(),
      newBlankFile: settings.newBlankFile.trim(),
      openAiPanel: settings.openAiPanel.trim(),
      redo: settings.redo.trim(),
      toggleSourceMode: settings.toggleSourceMode.trim(),
      undo: settings.undo.trim()
    });
    applyShortcutSettings(savedSettings);
    return savedSettings;
  });
  ipcMain.handle('settings:get-typography-settings', () => {
    return getTypographySettings();
  });
  ipcMain.handle('settings:set-typography-settings', (_event, settings: TypographySettings) => {
    if (!isTypographySettings(settings)) {
      throw new Error('Invalid typography settings.');
    }

    return setTypographySettings({
      editorFontSize: normalizeEditorFontSize(settings.editorFontSize)
    });
  });
  ipcMain.handle('settings:get-remote-config', () => {
    return getRemoteDatabaseConfig();
  });
  ipcMain.handle('settings:get-remote-sync-config', () => {
    return getRemoteSyncConfig();
  });
  ipcMain.handle('settings:save-remote-sync-config', (_event, config: RemoteSyncConfig) => {
    if (!isRemoteSyncConfig(config)) {
      throw new Error('Invalid remote sync configuration.');
    }

    return saveRemoteSyncConfig(config);
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
  ipcMain.handle('remote:list-available-regions', () => {
    return listAvailableRemoteRegions();
  });
  ipcMain.handle('remote:test-connection', () => {
    return testRemoteDatabaseConnection();
  });
  ipcMain.handle('remote:get-sync-status', () => {
    return getRemoteSyncStatus();
  });
  ipcMain.handle('remote:sync-now', () => {
    return runRemoteSync('manual');
  });
  ipcMain.handle('remote:retry-failed-sync', () => {
    return runRemoteSync('retry');
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
    const controller = new AbortController();

    agentStreamControllers.get(requestId)?.abort();
    agentStreamControllers.set(requestId, controller);

    void streamAgentMessage(
      request,
      (message) => {
        if (sender.isDestroyed() || controller.signal.aborted) {
          return;
        }

        sender.send('agent:message-event', {
          ...message,
          requestId
        });
      },
      {
        onWorkspaceChanged: broadcastWorkspaceChanged
      },
      controller.signal
    ).finally(() => {
      if (agentStreamControllers.get(requestId) === controller) {
        agentStreamControllers.delete(requestId);
      }
    });
  });
  ipcMain.on('agent:cancel-message-stream', (_event, requestId: string) => {
    if (!requestId || typeof requestId !== 'string') {
      return;
    }

    const controller = agentStreamControllers.get(requestId);

    controller?.abort();
    agentStreamControllers.delete(requestId);
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
    const result = createDatabaseWorkspace(name);
    markRemoteDatabaseWorkspaceDirty();
    runRemoteSyncInBackground('save');
    return result;
  });
  ipcMain.handle('workspace:read-markdown', (_event, filePath: string) => {
    const file = readMarkdownFile(filePath);
    markRemoteMarkdownOpened(file);
    runRemoteSyncInBackground('save');
    return file;
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
    markRemoteMarkdownSaved(file);

    if (file.path.startsWith('veloca-db://')) {
      markRemoteDatabaseWorkspaceDirty(file.workspaceFolderId);
    }

    try {
      await syncMarkdownFile(file.path);
    } catch (error) {
      console.error('Veloca version sync failed after saving markdown.', error);
    }

    runRemoteSyncInBackground('save');
    return file;
  });
  ipcMain.handle('workspace:save-markdown-as', async (_event, parentPath: string, name: string, content: string) => {
    const result = saveMarkdownFileAs(parentPath, name, content);
    markRemoteMarkdownSaved(result.file);

    if (result.file.path.startsWith('veloca-db://')) {
      markRemoteDatabaseWorkspaceDirty(result.file.workspaceFolderId);
    }

    try {
      await syncMarkdownFile(result.file.path);
    } catch (error) {
      console.error('Veloca version sync failed after saving markdown as.', error);
    }

    runRemoteSyncInBackground('save');
    return result;
  });
  ipcMain.handle('workspace:read-provenance', (_event, documentKey: string) => {
    return readDocumentProvenanceSnapshot(documentKey);
  });
  ipcMain.handle('workspace:save-provenance', (_event, snapshot: DocumentProvenanceSnapshot) => {
    const saved = saveDocumentProvenanceSnapshot(snapshot);
    markRemoteDatabaseWorkspaceDirty(saved.workspaceFolderId);
    runRemoteSyncInBackground('save');
    return saved;
  });
  ipcMain.handle('workspace:delete-provenance', (_event, documentKey: string) => {
    deleteDocumentProvenanceSnapshot(documentKey);
    runRemoteSyncInBackground('save');
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
    const asset = saveWorkspaceAsset(documentPath, payload);

    if (documentPath.startsWith('veloca-db://')) {
      markRemoteDatabaseWorkspaceDirty();
    }

    runRemoteSyncInBackground('save');
    return asset;
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
      const result = createWorkspaceEntry(parentPath, entryType, name);

      if (parentPath.startsWith('veloca-db://')) {
        markRemoteDatabaseWorkspaceDirty();
        runRemoteSyncInBackground('save');
      }

      return result;
    }
  );
  ipcMain.handle('workspace:rename-entry', (_event, filePath: string, name: string) => {
    const result = renameWorkspaceEntry(filePath, name);

    if (filePath.startsWith('veloca-db://')) {
      markRemoteDatabaseWorkspaceDirty();
    }

    runRemoteSyncInBackground('save');
    return result;
  });
  ipcMain.handle('workspace:duplicate-entry', (_event, filePath: string) => {
    const result = duplicateWorkspaceEntry(filePath);

    if (filePath.startsWith('veloca-db://')) {
      markRemoteDatabaseWorkspaceDirty();
      runRemoteSyncInBackground('save');
    }

    return result;
  });
  ipcMain.handle(
    'workspace:paste-entry',
    (_event, sourcePath: string, targetFolderPath: string, mode: 'copy' | 'cut') => {
      const result = pasteWorkspaceEntry(sourcePath, targetFolderPath, mode);

      if (sourcePath.startsWith('veloca-db://') || targetFolderPath.startsWith('veloca-db://')) {
        markRemoteDatabaseWorkspaceDirty();
        runRemoteSyncInBackground('save');
      }

      return result;
    }
  );
  ipcMain.handle('workspace:delete-entry', async (_event, filePath: string) => {
    if (filePath.startsWith('veloca-db://')) {
      const snapshot = deleteWorkspaceEntry(filePath);
      markRemoteDatabaseWorkspaceDirty();
      runRemoteSyncInBackground('save');
      return snapshot;
    }

    const resolvedPath = validateWorkspacePath(filePath);
    deactivateFilesystemDocumentProvenance(resolvedPath);
    markRemotePathDeleted(resolvedPath);
    await shell.trashItem(resolvedPath);
    runRemoteSyncInBackground('save');
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

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusVelocaWindow();
  });

  app.whenReady().then(() => {
    getDatabase();
    registerIpcHandlers();
    applyShortcutSettings(getShortcutSettings(process.platform));
    registerAssetProtocol();
    initializeAutoUpdates();
    onUpdateStatusChanged((status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('app:update-status', status);
        }
      }
    });
    createMainWindow();
    runRemoteSyncInBackground('startup');

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        runRemoteSyncInBackground('startup');
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (registeredFocusVelocaShortcut) {
    globalShortcut.unregister(registeredFocusVelocaShortcut);
  }

  closeDatabase();
});
