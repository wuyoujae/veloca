import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection, TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import { createPortal } from 'react-dom';
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  FilePlus,
  Folder,
  FolderPlus,
  GitBranch,
  Github,
  Grid3X3,
  Info,
  ListTree,
  LoaderCircle,
  Maximize2,
  MoreHorizontal,
  Moon,
  Minus,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  Save,
  MoreVertical,
  Settings,
  Scissors,
  Sun,
  Table2,
  Trash2,
  Unlink,
  X
} from 'lucide-react';
import { marked } from 'marked';
import 'katex/dist/katex.min.css';
import {
  MEDIA_LIMITS,
  buildMediaInsertContent,
  buildMediaNodeFromUrl,
  createAiProvenanceDocument,
  createRichEditorExtensions,
  extractFirstMediaUrl,
  getAiProvenanceRangesFromEditor,
  getActiveTableInfo,
  getEditorMarkdown,
  hydrateDocumentAssets,
  insertActiveTableColumn,
  insertActiveTableRow,
  insertMermaidBlockFromCommand,
  isAudioUrl,
  isImageUrl,
  isVideoUrl,
  resizeActiveTable,
  transformMarkdownForEditor,
  transformMarkdownFromEditor,
  type WorkspaceAssetPayload,
  type WorkspaceResolvedAsset
} from './rich-markdown';
import {
  buildAiMarkdownInsertionPatch,
  filterValidAiProvenanceRanges,
  relocateAiProvenanceRanges,
  shiftAiProvenanceRangesForPatch,
  updateAiProvenanceRangesForSourceEdit,
  type AiGeneratedMarkdownRange,
  type AiMarkdownInsertionPatch,
  type AiProvenanceSnapshotV2,
  type MarkdownSelectionRange
} from './ai-insert';
import {
  AgentPalette,
  type AgentPaletteAnchor,
  type AgentRuntimeContext,
  type AgentWorkspaceType
} from './agent-palette';
import { createTranslator, resolveLanguage, type AppLanguage, type Translator } from './i18n';

type ThemeMode = 'dark' | 'light';
type InterfaceDensity = 'comfortable' | 'compact' | 'spacious';
type MotionPreference = 'system' | 'full' | 'reduced';
type SidebarTab = 'files' | 'outline' | 'git';
type SettingsPanel = 'editor' | 'appearance' | 'typography' | 'shortcuts' | 'aiModel' | 'remote' | 'account' | 'about';
type SaveStatus = 'failed' | 'saved' | 'saving' | 'unsaved';
type SaveActionState = 'idle' | 'saving' | 'success';
type DocumentViewMode = 'rendered' | 'source';
type ToastType = 'success' | 'info';
const defaultEditorFontSize = 16;
const minimumEditorFontSize = 13;
const maximumEditorFontSize = 48;
const defaultAppearanceSettings: AppearanceSettings = {
  density: 'comfortable',
  language: 'system',
  motion: 'system'
};
const appLanguageOptions: AppLanguage[] = ['system', 'en', 'zh-CN'];
const interfaceDensityOptions: InterfaceDensity[] = ['comfortable', 'compact', 'spacious'];
const motionPreferenceOptions: MotionPreference[] = ['system', 'full', 'reduced'];
const aiInsertLogPrefix = '[Veloca AI Insert]';
const remoteSettingsLogPrefix = '[Veloca Remote Settings]';
const remoteCredentialMask = '********';
const defaultAppInfo: AppInfo = {
  githubUrl: 'https://github.com/wuyoujae/veloca',
  license: 'MIT',
  logoDataUrl: '',
  name: 'Veloca',
  version: '0.0.0'
};

function getUpdateSummary(status: UpdateCheckResult | null, t: Translator): string {
  if (!status) {
    return t('about.update.default');
  }

  if (status.status === 'checking') {
    return t('about.update.checking');
  }

  if (status.status === 'available') {
    return t('about.update.versionAvailable', { version: status.latestVersion ?? '' });
  }

  if (status.status === 'downloading') {
    return t('about.update.downloading', { percent: status.updatePercent === null ? '' : ` ${status.updatePercent}%` });
  }

  if (status.status === 'downloaded') {
    return t('about.update.downloaded', { version: status.latestVersion ?? '' });
  }

  if (status.status === 'current') {
    return t('about.update.versionCurrent', { version: status.currentVersion });
  }

  if (status.status === 'unavailable') {
    return status.errorMessage ?? t('about.update.unavailable');
  }

  return t('about.update.default');
}

function logAiInsertDebug(message: string, details?: Record<string, unknown>): void {
  console.info(aiInsertLogPrefix, message, details ?? {});
}

function logRemoteSettingsDebug(message: string, details?: Record<string, unknown>): void {
  console.info(remoteSettingsLogPrefix, message, details ?? {});
}

function getDefaultOpenAiPanelShortcut(platform: string): string {
  return platform === 'darwin' ? 'Command+J' : 'Ctrl+J';
}

function getFallbackShortcutSettings(platform: string): ShortcutSettings {
  return {
    openAiPanel: getDefaultOpenAiPanelShortcut(platform)
  };
}

function normalizeEditorFontSize(fontSize: number): number {
  if (!Number.isFinite(fontSize)) {
    return defaultEditorFontSize;
  }

  return Math.round(clampNumber(fontSize, minimumEditorFontSize, maximumEditorFontSize));
}

function applyEditorFontSize(fontSize: number): void {
  document.documentElement.style.setProperty('--editor-font-size', `${normalizeEditorFontSize(fontSize)}px`);
}

function normalizeAppLanguage(language: string | null | undefined): AppLanguage {
  return language === 'en' || language === 'zh-CN' ? language : 'system';
}

function normalizeInterfaceDensity(density: string | null | undefined): InterfaceDensity {
  return density === 'compact' || density === 'spacious' ? density : 'comfortable';
}

function normalizeMotionPreference(motion: string | null | undefined): MotionPreference {
  return motion === 'full' || motion === 'reduced' ? motion : 'system';
}

function normalizeAppearanceSettings(settings: Partial<AppearanceSettings>): AppearanceSettings {
  return {
    density: normalizeInterfaceDensity(settings.density),
    language: normalizeAppLanguage(settings.language),
    motion: normalizeMotionPreference(settings.motion)
  };
}

function applyAppearanceSettings(settings: AppearanceSettings): void {
  const normalizedSettings = normalizeAppearanceSettings(settings);

  document.documentElement.lang = resolveLanguage(normalizedSettings.language);
  document.documentElement.dataset.language = normalizedSettings.language;
  document.documentElement.dataset.density = normalizedSettings.density;
  document.documentElement.dataset.motion = normalizedSettings.motion;
}

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

function getShortcutFromKeyboardEvent(event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>): string | null {
  const key = normalizeShortcutKeyLabel(event.key);

  if (!key) {
    return null;
  }

  const modifiers = [
    event.metaKey ? 'Command' : '',
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : ''
  ].filter(Boolean);

  if (!modifiers.length) {
    return null;
  }

  return [...modifiers, key].join('+');
}

function doesShortcutMatchKeyboardEvent(shortcut: string, event: KeyboardEvent): boolean {
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
      requiredKey === normalizeShortcutKeyLabel(event.key) &&
      required.meta === event.metaKey &&
      required.ctrl === event.ctrlKey &&
      required.alt === event.altKey &&
      required.shift === event.shiftKey
  );
}

interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  description: string;
}

interface AppInfo {
  githubUrl: string;
  license: string;
  logoDataUrl: string;
  name: string;
  version: string;
}

interface UpdateCheckResult {
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

interface OpenSourceComponent {
  homepage: string;
  license: string;
  name: string;
  repositoryUrl: string;
  version: string;
}

interface AiModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow: number;
}

interface ShortcutSettings {
  openAiPanel: string;
}

interface TypographySettings {
  editorFontSize: number;
}

interface AppearanceSettings {
  density: InterfaceDensity;
  language: AppLanguage;
  motion: MotionPreference;
}

type RemoteDatabaseStatus = 'notConfigured' | 'configured' | 'creating' | 'waiting' | 'initialized' | 'failed';
type RemoteInputField = keyof RemoteDatabaseConfigInput;

interface RemoteDatabaseConfigInput {
  databasePassword?: string;
  organizationSlug: string;
  personalAccessToken?: string;
  region: string;
}

interface RemoteDatabaseConfigView {
  databaseHost: string;
  databasePasswordSaved: boolean;
  initializedAt: number | null;
  lastError: string;
  organizationSlug: string;
  patSaved: boolean;
  projectName: string;
  projectRef: string;
  projectUrl: string;
  publishableKeySaved: boolean;
  region: string;
  secretKeySaved: boolean;
  status: RemoteDatabaseStatus;
  statusCode: number;
  updatedAt: number | null;
}

interface RemoteProjectProvisionResult {
  config: RemoteDatabaseConfigView;
  reusedExistingProject: boolean;
}

interface RemoteRegionOption {
  code: string;
  label: string;
  name: string;
  provider: string;
  recommended: boolean;
  status: string;
  type: 'smartGroup' | 'specific';
}

interface RemoteSyncConfig {
  autoSyncEnabled: boolean;
  conflictPolicy: 1;
  pullOnStartup: boolean;
  pushOnSave: boolean;
  syncAssets: boolean;
  syncDatabaseWorkspaces: boolean;
  syncDeletes: boolean;
  syncLocalOpenedMarkdown: boolean;
  syncProvenance: boolean;
}

interface RemoteSyncStatus {
  conflictCount: number;
  failedCount: number;
  lastError: string;
  lastRunAt: number | null;
  pendingPullCount: number;
  pendingPushCount: number;
  running: boolean;
  syncedCount: number;
}

const defaultRemoteRegionData: Array<[code: string, name: string]> = [
  ['us-east-1', 'East US (North Virginia)'],
  ['us-east-2', 'East US (Ohio)'],
  ['us-west-1', 'West US (North California)'],
  ['us-west-2', 'West US (Oregon)'],
  ['ca-central-1', 'Canada (Central)'],
  ['eu-west-1', 'West EU (Ireland)'],
  ['eu-west-2', 'West Europe (London)'],
  ['eu-west-3', 'West EU (Paris)'],
  ['eu-central-1', 'Central EU (Frankfurt)'],
  ['eu-central-2', 'Central Europe (Zurich)'],
  ['eu-north-1', 'North EU (Stockholm)'],
  ['ap-south-1', 'South Asia (Mumbai)'],
  ['ap-southeast-1', 'Southeast Asia (Singapore)'],
  ['ap-southeast-2', 'Oceania (Sydney)'],
  ['ap-northeast-1', 'Northeast Asia (Tokyo)'],
  ['ap-northeast-2', 'Northeast Asia (Seoul)'],
  ['sa-east-1', 'South America (Sao Paulo)']
];
const defaultRemoteRegionOptions: RemoteRegionOption[] = defaultRemoteRegionData.map(([code, name]) => ({
  code,
  label: `${name} - ${code}`,
  name,
  provider: 'AWS',
  recommended: code === 'us-east-1',
  status: '',
  type: 'specific'
}));

interface WorkspaceTreeNode {
  id: string;
  name: string;
  type: 'folder' | 'file';
  source: 'filesystem' | 'database';
  path: string;
  relativePath: string;
  workspaceFolderId: string;
  children?: WorkspaceTreeNode[];
}

interface WorkspaceSnapshot {
  folders: Array<{
    id: string;
    name: string;
    path: string;
    createdAt: number;
  }>;
  tree: WorkspaceTreeNode[];
  totalMarkdownFiles: number;
}

interface MarkdownFileContent {
  path: string;
  name: string;
  content: string;
  relativePath: string;
  workspaceFolderId: string;
}

interface WatchedMarkdownFileChange {
  file?: MarkdownFileContent;
  path: string;
  status: 'changed' | 'unavailable';
}

interface MarkdownSection {
  id: string;
  level: number;
  title: string;
}

interface FileClipboard {
  mode: 'copy' | 'cut';
  path: string;
  name: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: WorkspaceTreeNode;
}

interface NameDialogState {
  description: string;
  mode: 'database-workspace';
  placeholder: string;
  submitLabel: string;
  title: string;
}

interface EditingNodeState {
  originalName: string;
  path: string;
  value: string;
}

interface OpenEditorTab {
  file: MarkdownFileContent;
  draftContent: string;
  isUntitled?: boolean;
  provenanceMarkdownHash?: string | null;
  provenanceSnapshotJson?: string | null;
  savedContent: string;
  status: SaveStatus;
}

interface DocumentProvenanceSnapshot {
  documentKey: string;
  documentPath: string;
  markdownHash: string;
  snapshotJson: string;
  workspaceFolderId: string;
  workspaceType: 'database' | 'filesystem';
}

interface CursorRestoreRequest {
  filePath: string;
  mode: DocumentViewMode;
  offset: number;
  sequence: number;
}

interface SaveLocationDialogState {
  fileName: string;
  filePath: string;
  selectedFolderPath: string | null;
}

interface SaveLocationOption {
  depth: number;
  id: string;
  name: string;
  path: string;
  relativePath: string;
  source: 'database' | 'filesystem';
}

interface GitHubAccountProfile {
  avatarUrl: string;
  connectedAt: number;
  id: number;
  login: string;
  name: string | null;
  profileUrl: string;
}

interface GitHubAuthStatus {
  account: GitHubAccountProfile | null;
  connected: boolean;
  configured: boolean;
  hasVersionManagementScope: boolean;
  requiresRebindForVersionManagement: boolean;
  scopes: string[];
}

interface GitHubDeviceBinding {
  expiresAt: number;
  interval: number;
  scope: string;
  sessionId: string;
  userCode: string;
  verificationUri: string;
}

interface VersionRepositoryStatus {
  htmlUrl: string;
  localPath: string;
  name: string;
  owner: string;
  private: boolean;
  remoteUrl: string;
}

interface VersionManagedChange {
  filePath: string;
  kind: 'added' | 'deleted' | 'modified';
  relativePath: string;
  shadowPath: string;
  workspaceFolderId: string;
}

interface VersionWorkspaceConfig {
  displayName: string;
  managedFileCount: number;
  shadowPrefix: string;
  sourceRootPath: string;
  status: number;
  workspaceFolderId: string;
}

interface VersionManagerStatus {
  changes: VersionManagedChange[];
  github: GitHubAuthStatus;
  managedFileCount: number;
  pendingChangeCount: number;
  repository: VersionRepositoryStatus | null;
  shadowRepositoryReady: boolean;
  workspaceConfigs: VersionWorkspaceConfig[];
}

type SplitPanePaths = [string, string];
type EditorTabGroup = string[];
type TabDropIntent = 'insert-left' | 'insert-right' | 'merge';

interface TabDropCue {
  groupIndex: number;
  intent: TabDropIntent;
}

const saveActionSuccessDurationMs = 1200;
const defaultDocumentViewMode: DocumentViewMode = 'rendered';
const sourceCursorMarkerPrefix = 'VELOCASOURCECURSOR';
const untitledFilePathPrefix = 'veloca-unsaved://';
const sidebarDefaultWidth = 300;
const sidebarMinimumWidth = 148;
const sidebarMaximumWidth = 420;
const sidebarTextMinimumWidth = 292;
const versionManagerSidebarTabVisible = false;
const emptyGitHubStatus: GitHubAuthStatus = {
  account: null,
  connected: false,
  configured: false,
  hasVersionManagementScope: false,
  requiresRebindForVersionManagement: false,
  scopes: []
};

const createEmptyVersionManagerStatus = (github: GitHubAuthStatus = emptyGitHubStatus): VersionManagerStatus => ({
  changes: [],
  github,
  managedFileCount: 0,
  pendingChangeCount: 0,
  repository: null,
  shadowRepositoryReady: false,
  workspaceConfigs: []
});

const emptyWorkspace: WorkspaceSnapshot = {
  folders: [],
  tree: [],
  totalMarkdownFiles: 0
};

const emptyRemoteConfig: RemoteDatabaseConfigView = {
  databaseHost: '',
  databasePasswordSaved: false,
  initializedAt: null,
  lastError: '',
  organizationSlug: '',
  patSaved: false,
  projectName: 'veloca',
  projectRef: '',
  projectUrl: '',
  publishableKeySaved: false,
  region: 'us-east-1',
  secretKeySaved: false,
  status: 'notConfigured',
  statusCode: 0,
  updatedAt: null
};

const defaultRemoteSyncConfig: RemoteSyncConfig = {
  autoSyncEnabled: true,
  conflictPolicy: 1,
  pullOnStartup: true,
  pushOnSave: true,
  syncAssets: true,
  syncDatabaseWorkspaces: true,
  syncDeletes: true,
  syncLocalOpenedMarkdown: true,
  syncProvenance: true
};

const emptyRemoteSyncStatus: RemoteSyncStatus = {
  conflictCount: 0,
  failedCount: 0,
  lastError: '',
  lastRunAt: null,
  pendingPullCount: 0,
  pendingPushCount: 0,
  running: false,
  syncedCount: 0
};

const normalizeTabGroup = (paths: string[]): EditorTabGroup => Array.from(new Set(paths)).slice(0, 2);

const getTabGroupKey = (paths: string[]): string => JSON.stringify([...new Set(paths)].sort());

const areTabGroupsEqual = (left: EditorTabGroup[], right: EditorTabGroup[]) => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftGroup, groupIndex) => {
    const rightGroup = right[groupIndex];

    if (!rightGroup || leftGroup.length !== rightGroup.length) {
      return false;
    }

    return leftGroup.every((path, pathIndex) => path === rightGroup[pathIndex]);
  });
};

marked.setOptions({
  async: false,
  breaks: false,
  gfm: true
});

const agentPaletteWidth = 760;
const agentPromptMinimumHeight = 188;
const agentCanvasMinimumHeight = 280;
const agentViewportGutter = 16;
const agentSelectionGap = 12;
const agentSelectionHighlightName = 'veloca-agent-selection';
const agentPromptEdgeGap = 24;
const agentSelectionViewportGap = 24;

interface AgentPaletteAnchorOptions {
  canvasOpen?: boolean;
}

interface CssHighlightRegistry {
  delete: (name: string) => boolean;
  set: (name: string, highlight: unknown) => void;
}

type CssHighlightConstructor = new (...ranges: Range[]) => unknown;

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

function getAgentViewportRect(range?: Range | null): DOMRect | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const selectionScrollContainer = range ? getSelectionScrollContainer(range) : null;
  const editorElement =
    selectionScrollContainer ??
    document.querySelector<HTMLElement>('.editor-scroll-area:not(.is-split-view), .editor-scroll-area') ??
    document.querySelector<HTMLElement>('.editor-container');

  return editorElement?.getBoundingClientRect() ?? null;
}

function getCssHighlightRegistry(): CssHighlightRegistry | null {
  if (typeof CSS === 'undefined') {
    return null;
  }

  return (CSS as unknown as { highlights?: CssHighlightRegistry }).highlights ?? null;
}

function getCssHighlightConstructor(): CssHighlightConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return (window as unknown as { Highlight?: CssHighlightConstructor }).Highlight ?? null;
}

function clearAgentSelectionHighlight(): void {
  getCssHighlightRegistry()?.delete(agentSelectionHighlightName);
}

function applyAgentSelectionHighlight(range: Range | null): void {
  clearAgentSelectionHighlight();

  if (!range) {
    return;
  }

  const highlightRegistry = getCssHighlightRegistry();
  const HighlightConstructor = getCssHighlightConstructor();

  if (!highlightRegistry || !HighlightConstructor) {
    return;
  }

  highlightRegistry.set(agentSelectionHighlightName, new HighlightConstructor(range.cloneRange()));
}

function getAgentPaletteWidth(editorRect: DOMRect | null): number {
  const viewportWidth = typeof window === 'undefined' ? agentPaletteWidth : window.innerWidth;
  const maxViewportWidth = Math.max(280, viewportWidth - agentViewportGutter * 2);
  const maxEditorWidth = editorRect ? Math.max(280, editorRect.width - agentViewportGutter * 2) : maxViewportWidth;

  return Math.min(agentPaletteWidth, maxViewportWidth, maxEditorWidth);
}

function getAgentPaletteCenterLeft(editorRect: DOMRect | null, width: number): number {
  if (typeof window === 'undefined' || !editorRect) {
    return width / 2;
  }

  const halfWidth = width / 2;
  const editorCenter = editorRect.left + editorRect.width / 2;
  const viewportLeft = clampNumber(editorCenter, halfWidth + agentViewportGutter, window.innerWidth - halfWidth - agentViewportGutter);

  return clampNumber(viewportLeft, editorRect.left + halfWidth, editorRect.right - halfWidth);
}

function getAgentPaletteMaxTop(editorRect: DOMRect | null, options: AgentPaletteAnchorOptions = {}): number {
  if (typeof window === 'undefined') {
    return 140;
  }

  const safetyHeight = agentPromptMinimumHeight + (options.canvasOpen ? agentCanvasMinimumHeight : 0);
  const viewportBottom = window.innerHeight - safetyHeight - agentPromptEdgeGap;
  const editorBottom = editorRect ? editorRect.bottom - safetyHeight - agentPromptEdgeGap : viewportBottom;

  return Math.min(viewportBottom, editorBottom);
}

function getDefaultAgentPaletteAnchor(
  range?: Range | null,
  options: AgentPaletteAnchorOptions = {}
): AgentPaletteAnchor {
  if (typeof window === 'undefined') {
    return {
      left: agentPaletteWidth / 2,
      mode: 'center',
      top: 140,
      width: agentPaletteWidth
    };
  }

  const editorRect = getAgentViewportRect(range);
  const width = getAgentPaletteWidth(editorRect);
  const baseTop = editorRect
    ? editorRect.top + clampNumber(editorRect.height * 0.14, 76, 132)
    : clampNumber(window.innerHeight * 0.22, 92, 180);
  const minTop = editorRect ? editorRect.top + 54 : 54;
  const maxTop = Math.max(minTop, getAgentPaletteMaxTop(editorRect, options));

  return {
    left: getAgentPaletteCenterLeft(editorRect, width),
    mode: 'center',
    top: clampNumber(baseTop, minTop, maxTop),
    width
  };
}

function getElementFromNode(node: Node | null): Element | null {
  if (!node) {
    return null;
  }

  return node instanceof Element ? node : node.parentElement;
}

function getActiveEditorSelectionRange(): Range | null {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim()) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const selectionElement = getElementFromNode(range.commonAncestorContainer);

  if (!selectionElement?.closest('.veloca-editor')) {
    return null;
  }

  return range;
}

function getAgentWorkspaceType(activeFile: MarkdownFileContent | null, workspace: WorkspaceSnapshot): AgentWorkspaceType {
  if (!activeFile) {
    return 'none';
  }

  if (isUntitledFilePath(activeFile.path)) {
    return 'none';
  }

  const activeNode = findNodeByPath(workspace.tree, activeFile.path);

  if (activeNode?.source === 'database' || activeFile.path.startsWith('veloca-db://')) {
    return 'database';
  }

  if (activeNode?.source === 'filesystem' || workspace.folders.some((folder) => folder.id === activeFile.workspaceFolderId)) {
    return 'filesystem';
  }

  return 'none';
}

function isUntitledFilePath(filePath: string): boolean {
  return filePath.startsWith(untitledFilePathPrefix);
}

function getDatabaseEntryId(filePath: string): string | null {
  return filePath.startsWith('veloca-db://entry/') ? filePath.replace('veloca-db://entry/', '') : null;
}

function getDocumentProvenanceKey(file: MarkdownFileContent): string | null {
  const databaseEntryId = getDatabaseEntryId(file.path);

  if (databaseEntryId) {
    return `database:${databaseEntryId}`;
  }

  if (!file.workspaceFolderId || !file.relativePath || isUntitledFilePath(file.path)) {
    return null;
  }

  return `filesystem:${file.workspaceFolderId}:${file.relativePath}`;
}

function getDocumentProvenanceWorkspaceType(file: MarkdownFileContent): 'database' | 'filesystem' | null {
  return getDatabaseEntryId(file.path) ? 'database' : file.workspaceFolderId ? 'filesystem' : null;
}

function hashMarkdownContent(content: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

interface LegacyAiProvenanceSnapshot {
  snapshot: JSONContent;
  version: 1;
}

type StoredAiProvenanceSnapshot = LegacyAiProvenanceSnapshot | AiProvenanceSnapshotV2;

function parseStoredAiProvenanceSnapshot(snapshotJson?: string | null): StoredAiProvenanceSnapshot | null {
  if (!snapshotJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(snapshotJson) as unknown;

    if (isJsonDoc(parsed)) {
      return {
        snapshot: normalizeAiGeneratedSnapshot(parsed),
        version: 1
      };
    }

    if (!isRecord(parsed) || parsed.version !== 2 || typeof parsed.markdownHash !== 'string') {
      return null;
    }

    const ranges = Array.isArray(parsed.ranges)
      ? parsed.ranges.flatMap((range) => {
          const normalized = normalizeAiProvenanceRange(range);
          return normalized ? [normalized] : [];
        })
      : [];

    if (!ranges.length) {
      return null;
    }

    return {
      markSnapshot: isJsonDoc(parsed.markSnapshot) ? normalizeAiGeneratedSnapshot(parsed.markSnapshot) : null,
      markdownHash: parsed.markdownHash,
      ranges,
      snapshot: isJsonDoc(parsed.snapshot) ? normalizeAiGeneratedSnapshot(parsed.snapshot) : null,
      version: 2
    };
  } catch {
    return null;
  }
}

function normalizeAiGeneratedSnapshot(node: JSONContent, insideAiBlock = false): JSONContent {
  const nextInsideAiBlock = insideAiBlock || node.type === 'velocaAiGeneratedBlock';
  const nextInsideCodeBlock = node.type === 'codeBlock';

  if (nextInsideAiBlock && node.type === 'text' && !nextInsideCodeBlock) {
    const marks = node.marks ?? [];
    const hasGeneratedMark = marks.some((mark) => mark.type === 'velocaAiGenerated');
    const hasEditedMark = marks.some((mark) => mark.type === 'velocaAiEdited');

    if (!hasGeneratedMark && !hasEditedMark) {
      return {
        ...node,
        marks: [...marks, { type: 'velocaAiGenerated' }]
      };
    }
  }

  if (!node.content?.length) {
    return node;
  }

  return {
    ...node,
    content: node.content.map((child) =>
      normalizeAiGeneratedSnapshot(child, nextInsideAiBlock && node.type !== 'codeBlock')
    )
  };
}

function documentSnapshotHasAiProvenance(snapshot: JSONContent | null): boolean {
  if (!snapshot) {
    return false;
  }

  if (
    snapshot.type === 'velocaAiGeneratedBlock' ||
    snapshot.marks?.some((mark) => mark.type === 'velocaAiEdited' || mark.type === 'velocaAiGenerated')
  ) {
    return true;
  }

  return Boolean(snapshot.content?.some((child) => documentSnapshotHasAiProvenance(child)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJsonDoc(value: unknown): value is JSONContent {
  return isRecord(value) && value.type === 'doc';
}

function normalizeAiProvenanceRange(value: unknown): AiGeneratedMarkdownRange | null {
  if (!isRecord(value)) {
    return null;
  }

  const start = typeof value.start === 'number' ? value.start : Number.NaN;
  const end = typeof value.end === 'number' ? value.end : Number.NaN;
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now();

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(createdAt) ||
    typeof value.rawMarkdown !== 'string' ||
    typeof value.rawMarkdownHash !== 'string' ||
    typeof value.sourceMessageId !== 'string'
  ) {
    return null;
  }

  return {
    createdAt,
    editedRanges: normalizeAiEditedRanges(value.editedRanges, Math.max(0, end - start)),
    end,
    id: typeof value.id === 'string' && value.id ? value.id : createAiProvenanceId('range'),
    provenanceId:
      typeof value.provenanceId === 'string' && value.provenanceId
        ? value.provenanceId
        : createAiProvenanceId('ai'),
    rawMarkdown: value.rawMarkdown,
    rawMarkdownHash: value.rawMarkdownHash,
    sourceMessageId: value.sourceMessageId,
    start
  };
}

function normalizeAiEditedRanges(value: unknown, rawMarkdownLength: number): MarkdownSelectionRange[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const ranges = value
    .flatMap((range) => {
      if (!isRecord(range)) {
        return [];
      }

      const from = typeof range.from === 'number' ? range.from : Number.NaN;
      const to = typeof range.to === 'number' ? range.to : Number.NaN;

      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        return [];
      }

      return [
        {
          from: clampNumber(from, 0, rawMarkdownLength),
          to: clampNumber(to, 0, rawMarkdownLength)
        }
      ];
    })
    .filter((range) => range.to > range.from)
    .sort((left, right) => left.from - right.from);

  return ranges.length ? ranges : undefined;
}

function createAiProvenanceId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getAiProvenanceRangesForContent(
  content: string,
  snapshotJson?: string | null
): AiGeneratedMarkdownRange[] {
  const parsed = parseStoredAiProvenanceSnapshot(snapshotJson);

  if (!parsed || parsed.version !== 2) {
    return [];
  }

  const exactRanges = filterValidAiProvenanceRanges(content, parsed.ranges);

  if (exactRanges.length) {
    return exactRanges;
  }

  return relocateAiProvenanceRanges(content, parsed.ranges);
}

function buildAiProvenanceSnapshotFields(
  content: string,
  ranges: AiGeneratedMarkdownRange[],
  snapshot: JSONContent | null,
  markSnapshot: JSONContent | null = null
): Pick<OpenEditorTab, 'provenanceMarkdownHash' | 'provenanceSnapshotJson'> {
  const validRanges = filterValidAiProvenanceRanges(content, ranges);

  if (!validRanges.length) {
    return {
      provenanceMarkdownHash: null,
      provenanceSnapshotJson: null
    };
  }

  const markdownHash = hashMarkdownContent(content);
  const payload: AiProvenanceSnapshotV2 = {
    markSnapshot,
    markdownHash,
    ranges: validRanges,
    snapshot,
    version: 2
  };

  return {
    provenanceMarkdownHash: markdownHash,
    provenanceSnapshotJson: JSON.stringify(payload)
  };
}

function normalizePersistedProvenanceForContent(
  content: string,
  storedMarkdownHash: string,
  snapshotJson?: string | null
): Pick<OpenEditorTab, 'provenanceMarkdownHash' | 'provenanceSnapshotJson'> {
  const parsed = parseStoredAiProvenanceSnapshot(snapshotJson);
  const markdownHash = hashMarkdownContent(content);

  if (!parsed) {
    return {
      provenanceMarkdownHash: null,
      provenanceSnapshotJson: null
    };
  }

  if (parsed.version === 1) {
    return storedMarkdownHash === markdownHash && documentSnapshotHasAiProvenance(parsed.snapshot)
      ? {
          provenanceMarkdownHash: markdownHash,
          provenanceSnapshotJson: snapshotJson ?? null
        }
      : {
          provenanceMarkdownHash: null,
          provenanceSnapshotJson: null
        };
  }

  const ranges =
    parsed.markdownHash === markdownHash
      ? filterValidAiProvenanceRanges(content, parsed.ranges)
      : relocateAiProvenanceRanges(content, parsed.ranges);

  return buildAiProvenanceSnapshotFields(
    content,
    ranges,
    parsed.markdownHash === markdownHash ? parsed.snapshot : null,
    parsed.markdownHash === markdownHash ? null : (parsed.snapshot ?? parsed.markSnapshot ?? null)
  );
}

function insertTemporaryTextIntoAiProvenanceRanges(
  ranges: AiGeneratedMarkdownRange[],
  offset: number,
  text: string
): AiGeneratedMarkdownRange[] {
  if (!ranges.length || !text) {
    return ranges;
  }

  return ranges.map((range) => {
    if (range.end <= offset) {
      return range;
    }

    if (range.start >= offset) {
      return {
        ...range,
        end: range.end + text.length,
        start: range.start + text.length
      };
    }

    const rawOffset = offset - range.start;
    const rawMarkdown = `${range.rawMarkdown.slice(0, rawOffset)}${text}${range.rawMarkdown.slice(rawOffset)}`;

    return {
      ...range,
      end: range.end + text.length,
      rawMarkdown,
      rawMarkdownHash: hashMarkdownContent(rawMarkdown)
    };
  });
}

function updateAiProvenanceForSourceContentChange(
  previousContent: string,
  nextContent: string,
  snapshotJson?: string | null
): Pick<OpenEditorTab, 'provenanceMarkdownHash' | 'provenanceSnapshotJson'> | undefined {
  const parsed = parseStoredAiProvenanceSnapshot(snapshotJson);

  if (!parsed || parsed.version !== 2) {
    return undefined;
  }

  const ranges = updateAiProvenanceRangesForSourceEdit(previousContent, nextContent, parsed.ranges);

  return buildAiProvenanceSnapshotFields(nextContent, ranges, null, parsed.snapshot ?? parsed.markSnapshot ?? null);
}

function getAgentWorkspaceRootPath(
  activeFile: MarkdownFileContent | null,
  workspace: WorkspaceSnapshot,
  workspaceType: AgentWorkspaceType
): string | undefined {
  if (!activeFile) {
    return undefined;
  }

  if (workspaceType === 'database') {
    return `veloca-db://root/${activeFile.workspaceFolderId}`;
  }

  if (workspaceType === 'filesystem') {
    return workspace.folders.find((folder) => folder.id === activeFile.workspaceFolderId)?.path;
  }

  return undefined;
}

function buildAgentRuntimeContext(
  activeFile: MarkdownFileContent | null,
  workspace: WorkspaceSnapshot,
  selectionRange: Range | null
): AgentRuntimeContext {
  const candidateWorkspaceType = getAgentWorkspaceType(activeFile, workspace);
  const workspaceRootPath = getAgentWorkspaceRootPath(activeFile, workspace, candidateWorkspaceType);
  const workspaceType = workspaceRootPath ? candidateWorkspaceType : 'none';
  const selectedText = selectionRange?.toString().trim();

  return {
    brainstormSessionKey:
      workspaceType === 'none' && activeFile && isUntitledFilePath(activeFile.path) ? activeFile.path : undefined,
    currentFilePath: workspaceType === 'none' ? undefined : activeFile?.path,
    selectedText: selectedText || undefined,
    workspaceRootPath: workspaceType === 'none' ? undefined : workspaceRootPath,
    workspaceType
  };
}

function getCollapsedSelectionEndpointRect(range: Range, collapseToStart: boolean): DOMRect | null {
  const endpointRange = range.cloneRange();
  endpointRange.collapse(collapseToStart);

  const endpointRects = Array.from(endpointRange.getClientRects())
    .filter((rect) => rect.height > 0)
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const endpointRect = collapseToStart ? endpointRects[0] : endpointRects.at(-1);

  if (endpointRect) {
    return endpointRect;
  }

  const boundingRect = endpointRange.getBoundingClientRect();

  return boundingRect.height > 0 ? boundingRect : null;
}

function getSelectionTextLineRects(range: Range): DOMRect[] {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);

  if (rects.length <= 1) {
    return rects;
  }

  const sortedHeights = rects.map((rect) => rect.height).sort((left, right) => left - right);
  const lowerMedianHeight = sortedHeights[Math.floor((sortedHeights.length - 1) / 2)];
  const maxTextLineHeight = Math.max(36, Math.min(84, lowerMedianHeight * 2.5));
  const textLineRects = rects.filter((rect) => rect.height <= maxTextLineHeight);
  const stableRects = textLineRects.length > 0 ? textLineRects : rects;

  return stableRects.sort((left, right) => left.top - right.top || left.left - right.left);
}

function getLastSelectionLineRect(range: Range): DOMRect | null {
  const endpointRect = getCollapsedSelectionEndpointRect(range, false);

  if (endpointRect) {
    return endpointRect;
  }

  const rects = getSelectionTextLineRects(range);

  return rects.reduce<DOMRect | null>((current, rect) => {
    if (!current || rect.bottom > current.bottom || (Math.abs(rect.bottom - current.bottom) < 1 && rect.right > current.right)) {
      return rect;
    }

    return current;
  }, null);
}

function getFirstSelectionLineRect(range: Range): DOMRect | null {
  const endpointRect = getCollapsedSelectionEndpointRect(range, true);

  if (endpointRect) {
    return endpointRect;
  }

  const rects = getSelectionTextLineRects(range);

  return rects[0] ?? null;
}

function getSelectionScrollContainer(range: Range): HTMLElement | null {
  const selectionElement = getElementFromNode(range.commonAncestorContainer);
  const scrollContainer = selectionElement?.closest('.editor-pane-scroll, .editor-scroll-area');

  return scrollContainer instanceof HTMLElement ? scrollContainer : null;
}

function getAgentPaletteAnchor(
  rangeOverride?: Range | null,
  options: AgentPaletteAnchorOptions = {}
): AgentPaletteAnchor {
  const range = rangeOverride === undefined ? getActiveEditorSelectionRange() : rangeOverride;
  const rect = range ? getLastSelectionLineRect(range) : null;
  const defaultAnchor = getDefaultAgentPaletteAnchor(range, options);

  if (!rect) {
    return defaultAnchor;
  }

  const editorRect = getAgentViewportRect(range);
  const minTop = editorRect ? editorRect.top + 54 : 54;
  const maxTop = Math.max(minTop, getAgentPaletteMaxTop(editorRect, options));

  return {
    ...defaultAnchor,
    mode: 'selection',
    top: clampNumber(rect.bottom + agentSelectionGap, minTop, maxTop)
  };
}

function scrollSelectionIntoAgentPosition(rangeOverride?: Range | null): boolean {
  const range = rangeOverride === undefined ? getActiveEditorSelectionRange() : rangeOverride;

  if (!range) {
    return false;
  }

  const rect = getLastSelectionLineRect(range);
  const scrollContainer = getSelectionScrollContainer(range);

  if (!rect || !scrollContainer) {
    return false;
  }

  const defaultAnchor = getDefaultAgentPaletteAnchor(range, { canvasOpen: true });
  const targetLastLineBottom = defaultAnchor.top - agentSelectionGap;
  const scrollDelta = rect.bottom - targetLastLineBottom;

  if (Math.abs(scrollDelta) < 4) {
    return false;
  }

  scrollContainer.scrollBy({
    behavior: 'auto',
    top: scrollDelta
  });

  return true;
}

function relaxSelectionAfterCanvasClose(rangeOverride?: Range | null): boolean {
  const range = rangeOverride === undefined ? getActiveEditorSelectionRange() : rangeOverride;

  if (!range) {
    return false;
  }

  const firstRect = getFirstSelectionLineRect(range);
  const lastRect = getLastSelectionLineRect(range);
  const scrollContainer = getSelectionScrollContainer(range);
  const editorRect = getAgentViewportRect(range);

  if (!firstRect || !lastRect || !scrollContainer || !editorRect) {
    return false;
  }

  const safeSelectionTop = editorRect.top + agentSelectionViewportGap;
  const currentPromptTop = getAgentPaletteAnchor(range).top;
  const maxPromptTop = Math.max(editorRect.top + 54, getAgentPaletteMaxTop(editorRect));
  const neededDownForSelection = Math.max(0, safeSelectionTop - firstRect.top);
  const availableDownForPrompt = Math.max(0, maxPromptTop - currentPromptTop);
  const scrollDownDistance = Math.min(neededDownForSelection, availableDownForPrompt);

  if (scrollDownDistance < 4) {
    return false;
  }

  scrollContainer.scrollBy({
    behavior: 'auto',
    top: -scrollDownDistance
  });

  return true;
}

export function App(): JSX.Element {
  const appPlatform = window.veloca?.app.platform ?? 'darwin';
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [sidebarWidth, setSidebarWidth] = useState(sidebarDefaultWidth);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(emptyWorkspace);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [openTabs, setOpenTabs] = useState<OpenEditorTab[]>([]);
  const [tabGroups, setTabGroups] = useState<EditorTabGroup[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const [documentViewModesByPath, setDocumentViewModesByPath] = useState<Record<string, DocumentViewMode>>({});
  const [cursorRestoreRequest, setCursorRestoreRequest] = useState<CursorRestoreRequest | null>(null);
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [agentPaletteOpen, setAgentPaletteOpen] = useState(false);
  const [agentPaletteAnchor, setAgentPaletteAnchor] = useState<AgentPaletteAnchor>(() => getDefaultAgentPaletteAnchor());
  const [agentRuntimeContext, setAgentRuntimeContext] = useState<AgentRuntimeContext>({ workspaceType: 'none' });
  const [saveActionStatesByPath, setSaveActionStatesByPath] = useState<Record<string, SaveActionState>>({});
  const [draggingTabIndex, setDraggingTabIndex] = useState<number | null>(null);
  const [draggingGroupIndex, setDraggingGroupIndex] = useState<number | null>(null);
  const [tabDropCue, setTabDropCue] = useState<TabDropCue | null>(null);
  const [isSplitViewEnabled, setIsSplitViewEnabled] = useState(false);
  const [splitAfterIndex, setSplitAfterIndex] = useState<number | null>(null);
  const [splitPanePaths, setSplitPanePaths] = useState<SplitPanePaths | null>(null);
  const [splitPaneRatio, setSplitPaneRatio] = useState(50);
  const [documentContent, setDocumentContent] = useState('');
  const [activeHeadingId, setActiveHeadingId] = useState<string>('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>('editor');
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [nameDialogValue, setNameDialogValue] = useState('');
  const [saveLocationDialog, setSaveLocationDialog] = useState<SaveLocationDialogState | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);
  const [editingNode, setEditingNode] = useState<EditingNodeState | null>(null);
  const [lineNumbers, setLineNumbers] = useState(true);
  const focusMode = false;
  const [autoSave, setAutoSave] = useState(true);
  const [editorFontSize, setEditorFontSize] = useState(defaultEditorFontSize);
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>(defaultAppearanceSettings);
  const [shortcutSettings, setShortcutSettings] = useState<ShortcutSettings>(() =>
    getFallbackShortcutSettings(appPlatform)
  );
  const [recordingShortcutAction, setRecordingShortcutAction] = useState<keyof ShortcutSettings | null>(null);
  const [aiConfig, setAiConfig] = useState<AiModelConfig>({
    baseUrl: '',
    apiKey: '',
    model: '',
    contextWindow: 128000
  });
  const [aiConfigLoading, setAiConfigLoading] = useState(false);
  const [remoteConfig, setRemoteConfig] = useState<RemoteDatabaseConfigView>(emptyRemoteConfig);
  const [remoteInput, setRemoteInput] = useState<RemoteDatabaseConfigInput>({
    databasePassword: '',
    organizationSlug: '',
    personalAccessToken: '',
    region: 'us-east-1'
  });
  const [remoteSyncConfig, setRemoteSyncConfig] = useState<RemoteSyncConfig>(defaultRemoteSyncConfig);
  const [remoteSyncStatus, setRemoteSyncStatus] = useState<RemoteSyncStatus>(emptyRemoteSyncStatus);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteSyncLoading, setRemoteSyncLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [githubStatus, setGithubStatus] = useState<GitHubAuthStatus>(emptyGitHubStatus);
  const [githubBinding, setGithubBinding] = useState<GitHubDeviceBinding | null>(null);
  const [githubAuthLoading, setGithubAuthLoading] = useState(false);
  const [versionStatus, setVersionStatus] = useState<VersionManagerStatus>(() => createEmptyVersionManagerStatus());
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionCommitMessage, setVersionCommitMessage] = useState('');
  const [appInfo, setAppInfo] = useState<AppInfo>(defaultAppInfo);
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckResult | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [licenseDialogOpen, setLicenseDialogOpen] = useState(false);
  const [openSourceComponents, setOpenSourceComponents] = useState<OpenSourceComponent[]>([]);
  const [openSourceLoading, setOpenSourceLoading] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileClipboard, setFileClipboard] = useState<FileClipboard | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const activeTabRef = useRef<OpenEditorTab | null>(null);
  const activeTabPathRef = useRef<string | null>(null);
  const documentContentRef = useRef(documentContent);
  const openTabsRef = useRef<OpenEditorTab[]>([]);
  const outlineFilePathRef = useRef<string | null>(null);
  const openTabPathsRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveActionStatesRef = useRef<Record<string, SaveActionState>>({});
  const saveActionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const cursorRestoreSequenceRef = useRef(0);
  const renderedEditorHandlesRef = useRef<Map<string, MarkdownEditorHandle>>(new Map());
  const sourceEditorHandlesRef = useRef<Map<string, SourceMarkdownEditorHandle>>(new Map());
  const editorTabsRef = useRef<HTMLDivElement>(null);
  const editorTabElementByPathRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const splitEditorGridRef = useRef<HTMLDivElement>(null);
  const agentSelectionRangeRef = useRef<Range | null>(null);
  const workspaceChangedHandlerRef = useRef<(snapshot: WorkspaceSnapshot) => void>(() => {});
  const watchedMarkdownFileChangeHandlerRef = useRef<(change: WatchedMarkdownFileChange) => void>(() => {});
  const headerMenuButtonRef = useRef<HTMLButtonElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const openAiPanelShortcutButtonRef = useRef<HTMLButtonElement>(null);
  const editorFontSizeSaveTimerRef = useRef<number | null>(null);
  const pendingEditorFontSizeRef = useRef<number | null>(null);
  const updateReadyToastKeyRef = useRef<string>('');
  const resolvedLanguage = useMemo(() => resolveLanguage(appearanceSettings.language), [appearanceSettings.language]);
  const t = useMemo(() => createTranslator(resolvedLanguage), [resolvedLanguage]);
  const getAppLanguageLabel = (language: AppLanguage) => {
    if (language === 'en') {
      return t('settings.options.english');
    }

    if (language === 'zh-CN') {
      return t('settings.options.zhCn');
    }

    return t('settings.options.systemDefault');
  };
  const getInterfaceDensityLabel = (density: InterfaceDensity) => {
    if (density === 'compact') {
      return t('settings.options.compact');
    }

    if (density === 'spacious') {
      return t('settings.options.spacious');
    }

    return t('settings.options.comfortable');
  };
  const getMotionPreferenceLabel = (motion: MotionPreference) => {
    if (motion === 'full') {
      return t('settings.options.fullMotion');
    }

    if (motion === 'reduced') {
      return t('settings.options.reducedMotion');
    }

    return t('settings.options.systemDefault');
  };

  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.file.path === activeTabPath) ?? null,
    [activeTabPath, openTabs]
  );
  const activeFile = activeTab?.file ?? null;
  const usesCustomWindowControls = appPlatform === 'win32' || appPlatform === 'linux';
  const activeSaveActionState = activeTabPath ? saveActionStatesByPath[activeTabPath] ?? 'idle' : 'idle';
  const activeDocumentViewMode = activeTabPath
    ? documentViewModesByPath[activeTabPath] ?? defaultDocumentViewMode
    : defaultDocumentViewMode;
  const visibleSidebarTab = sidebarTab === 'git' && !versionManagerSidebarTabVisible ? 'files' : sidebarTab;
  const isSidebarTabCompact = sidebarWidth < sidebarTextMinimumWidth;
  const sidebarClassName = [
    'sidebar',
    isSidebarCollapsed ? 'collapsed' : '',
    isSidebarTabCompact ? 'compact' : '',
    isSidebarResizing ? 'resizing' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const openTabByPath = useMemo(() => {
    return new Map(openTabs.map((tab) => [tab.file.path, tab]));
  }, [openTabs]);
  const visibleTabGroups = useMemo(() => {
    return tabGroups
      .map((group) => normalizeTabGroup(group.filter((path) => openTabByPath.has(path))))
      .filter((group) => group.length > 0);
  }, [openTabByPath, tabGroups]);
  const sections = useMemo(() => {
    return parseMarkdownSections(documentContent, activeFile?.name ?? 'Untitled');
  }, [activeFile?.name, documentContent]);

  const saveLocationOptions = useMemo(() => {
    return getSaveLocationOptions(workspace.tree);
  }, [workspace.tree]);

  const wordCount = useMemo(() => {
    return documentContent.trim().split(/\s+/).filter(Boolean).length;
  }, [documentContent]);

  const splitPaneTabs = useMemo(() => {
    if (!isSplitViewEnabled || !splitPanePaths) {
      return null;
    }

    const leftTab = openTabByPath.get(splitPanePaths[0]);
    const rightTab = openTabByPath.get(splitPanePaths[1]);

    if (!leftTab || !rightTab || leftTab.file.path === rightTab.file.path) {
      return null;
    }

    return [leftTab, rightTab] as const;
  }, [isSplitViewEnabled, openTabByPath, splitPanePaths]);

  const positionAgentPalette = useCallback(() => {
    const selectionRange = agentSelectionRangeRef.current;

    setAgentPaletteAnchor(getAgentPaletteAnchor(selectionRange));
  }, []);

  const moveAgentPaletteForCanvasOpen = useCallback(() => {
    const selectionRange = agentSelectionRangeRef.current;

    if (scrollSelectionIntoAgentPosition(selectionRange)) {
      window.requestAnimationFrame(() => {
        setAgentPaletteAnchor(getAgentPaletteAnchor(selectionRange, { canvasOpen: true }));
      });
      return;
    }

    setAgentPaletteAnchor(getAgentPaletteAnchor(selectionRange, { canvasOpen: true }));
  }, []);

  const relaxAgentPaletteAfterCanvasClose = useCallback(() => {
    const selectionRange = agentSelectionRangeRef.current;

    if (relaxSelectionAfterCanvasClose(selectionRange)) {
      window.requestAnimationFrame(() => {
        setAgentPaletteAnchor(getAgentPaletteAnchor(selectionRange));
      });
      return;
    }

    setAgentPaletteAnchor(getAgentPaletteAnchor(selectionRange));
  }, []);

  const openAgentPalette = useCallback(() => {
    const selectionRange = getActiveEditorSelectionRange()?.cloneRange() ?? null;

    agentSelectionRangeRef.current = selectionRange;
    setAgentRuntimeContext(buildAgentRuntimeContext(activeFile, workspace, selectionRange));
    applyAgentSelectionHighlight(selectionRange);
    setAgentPaletteOpen(true);
    setIsHeaderMenuOpen(false);
    setContextMenu(null);
    setAgentPaletteAnchor(getAgentPaletteAnchor(selectionRange));
    window.requestAnimationFrame(positionAgentPalette);
  }, [activeFile, positionAgentPalette, workspace]);

  const setFileSaveActionState = (filePath: string, nextState: SaveActionState) => {
    const current = saveActionStatesRef.current;

    if (nextState === 'idle') {
      if (!current[filePath]) {
        return;
      }

      const next = { ...current };
      delete next[filePath];
      saveActionStatesRef.current = next;
      setSaveActionStatesByPath(next);
      return;
    }

    if (current[filePath] === nextState) {
      return;
    }

    const next = { ...current, [filePath]: nextState };
    saveActionStatesRef.current = next;
    setSaveActionStatesByPath(next);
  };

  const clearFileSaveActionTimer = (filePath: string) => {
    const timer = saveActionTimersRef.current.get(filePath);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    saveActionTimersRef.current.delete(filePath);
  };

  const clearFileSaveAction = (filePath: string) => {
    clearFileSaveActionTimer(filePath);
    setFileSaveActionState(filePath, 'idle');
  };

  const clearAllFileSaveActions = () => {
    saveActionTimersRef.current.forEach((timer) => clearTimeout(timer));
    saveActionTimersRef.current.clear();
    saveActionStatesRef.current = {};
    setSaveActionStatesByPath({});
  };

  const pruneFileSaveActions = (livePaths: Set<string>) => {
    saveActionTimersRef.current.forEach((timer, filePath) => {
      if (!livePaths.has(filePath)) {
        clearTimeout(timer);
        saveActionTimersRef.current.delete(filePath);
      }
    });

    const current = saveActionStatesRef.current;
    const next: Record<string, SaveActionState> = {};
    let changed = false;

    for (const [filePath, state] of Object.entries(current)) {
      if (livePaths.has(filePath)) {
        next[filePath] = state;
      } else {
        changed = true;
      }
    }

    if (changed) {
      saveActionStatesRef.current = next;
      setSaveActionStatesByPath(next);
    }
  };

  const beginFileSaveAction = (filePath: string) => {
    clearFileSaveActionTimer(filePath);
    setFileSaveActionState(filePath, 'saving');
  };

  const completeFileSaveAction = (filePath: string) => {
    clearFileSaveActionTimer(filePath);

    if (!openTabPathsRef.current.has(filePath)) {
      setFileSaveActionState(filePath, 'idle');
      return;
    }

    setFileSaveActionState(filePath, 'success');

    const timer = setTimeout(() => {
      saveActionTimersRef.current.delete(filePath);

      if (saveActionStatesRef.current[filePath] === 'success') {
        setFileSaveActionState(filePath, 'idle');
      }
    }, saveActionSuccessDurationMs);

    saveActionTimersRef.current.set(filePath, timer);
  };

  const refreshVersionManagerStatus = async () => {
    if (!window.veloca?.versionManager) {
      return;
    }

    const status = await window.veloca.versionManager.getStatus();
    setVersionStatus(status);
    setGithubStatus(status.github);
  };

  const applyGitHubStatus = (status: GitHubAuthStatus) => {
    setGithubStatus(status);
    setVersionStatus((current) => ({
      ...current,
      github: status
    }));
  };

  useEffect(() => {
    window.veloca?.settings.getTheme().then((storedTheme) => {
      applyTheme(storedTheme);
      setTheme(storedTheme);
    });
    window.veloca?.settings.getAppearanceSettings().then((settings) => {
      const nextSettings = normalizeAppearanceSettings(settings);
      setAppearanceSettings(nextSettings);
      applyAppearanceSettings(nextSettings);
    });
    window.veloca?.settings.getAutoSave().then(setAutoSave);
    window.veloca?.settings.getTypographySettings().then((settings) => {
      const nextFontSize = normalizeEditorFontSize(settings.editorFontSize);
      setEditorFontSize(nextFontSize);
      applyEditorFontSize(nextFontSize);
    });
    window.veloca?.settings.getShortcutSettings().then(setShortcutSettings);
    window.veloca?.settings.getAiConfig().then((config) => {
      if (config.baseUrl || config.apiKey || config.model || config.contextWindow > 0) {
        setAiConfig(config);
      }
    });
    window.veloca?.settings.getRemoteConfig().then((config) => {
      applyRemoteConfig(config);
    });
    window.veloca?.settings.getRemoteSyncConfig().then(setRemoteSyncConfig);
    window.veloca?.remote.getSyncStatus().then(setRemoteSyncStatus);
    window.veloca?.github.getStatus().then(applyGitHubStatus);
    void refreshVersionManagerStatus();

    if (!window.veloca) {
      const fallbackTheme = localStorage.getItem('veloca-theme') === 'light' ? 'light' : 'dark';
      const fallbackAutoSave = localStorage.getItem('veloca-auto-save') !== 'false';
      const fallbackEditorFontSize = normalizeEditorFontSize(
        Number(localStorage.getItem('veloca-editor-font-size')) || defaultEditorFontSize
      );
      const fallbackAppearanceSettings = {
        density: normalizeInterfaceDensity(localStorage.getItem('veloca-interface-density')),
        language: normalizeAppLanguage(localStorage.getItem('veloca-app-language')),
        motion: normalizeMotionPreference(localStorage.getItem('veloca-motion-preference'))
      };
      const fallbackShortcutSettings = getFallbackShortcutSettings(appPlatform);
      applyTheme(fallbackTheme);
      applyAppearanceSettings(fallbackAppearanceSettings);
      applyEditorFontSize(fallbackEditorFontSize);
      setTheme(fallbackTheme);
      setAppearanceSettings(fallbackAppearanceSettings);
      setAutoSave(fallbackAutoSave);
      setEditorFontSize(fallbackEditorFontSize);
      setShortcutSettings({
        openAiPanel: localStorage.getItem('veloca-shortcut-open-ai-panel') ?? fallbackShortcutSettings.openAiPanel
      });
      setAiConfig({
        baseUrl: localStorage.getItem('veloca-ai-base-url') ?? '',
        apiKey: localStorage.getItem('veloca-ai-api-key') ?? '',
        model: localStorage.getItem('veloca-ai-model') ?? '',
        contextWindow: Number(localStorage.getItem('veloca-ai-context-window')) || 128000
      });
    }
  }, [appPlatform]);

  useEffect(() => {
    if (!usesCustomWindowControls || !window.veloca?.windowControls) {
      return;
    }

    void window.veloca.windowControls.isMaximized().then(setIsWindowMaximized);
    return window.veloca.windowControls.onMaximizedChange(setIsWindowMaximized);
  }, [usesCustomWindowControls]);

  useEffect(() => {
    if (recordingShortcutAction !== 'openAiPanel') {
      return;
    }

    window.requestAnimationFrame(() => openAiPanelShortcutButtonRef.current?.focus());
  }, [recordingShortcutAction]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    activeTabPathRef.current = activeTabPath;
  }, [activeTabPath]);

  useEffect(() => {
    openTabsRef.current = openTabs;
    const livePaths = new Set(openTabs.map((tab) => tab.file.path));
    openTabPathsRef.current = livePaths;
    pruneFileSaveActions(livePaths);
    setDocumentViewModesByPath((current) => {
      const next: Record<string, DocumentViewMode> = {};

      for (const [filePath, mode] of Object.entries(current)) {
        if (livePaths.has(filePath)) {
          next[filePath] = mode;
        }
      }

      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });

    setTabGroups((current) => {
      const seenKeys = new Set<string>();
      const nextGroups: EditorTabGroup[] = [];

      for (const group of current) {
        const nextGroup = normalizeTabGroup(group.filter((path) => livePaths.has(path)));
        const nextKey = getTabGroupKey(nextGroup);

        if (!nextGroup.length || seenKeys.has(nextKey)) {
          continue;
        }

        seenKeys.add(nextKey);
        nextGroups.push(nextGroup);
      }

      return areTabGroupsEqual(current, nextGroups) ? current : nextGroups;
    });
  }, [openTabs]);

  useEffect(() => {
    const watchedPaths = openTabs
      .filter((tab) => !tab.isUntitled && !isUntitledFilePath(tab.file.path))
      .map((tab) => tab.file.path);

    void window.veloca?.workspace.watchMarkdownFiles(watchedPaths);
  }, [openTabs]);

  useEffect(() => {
    if (!splitPanePaths) {
      return;
    }

    const openPaths = new Set(openTabs.map((tab) => tab.file.path));
    const splitStillValid =
      splitPanePaths[0] !== splitPanePaths[1] &&
      openPaths.has(splitPanePaths[0]) &&
      openPaths.has(splitPanePaths[1]);

    if (splitStillValid) {
      return;
    }

    setIsSplitViewEnabled(false);
    setSplitPanePaths(null);
    setSplitAfterIndex(null);
    setTabDropCue(null);
  }, [openTabs, splitPanePaths]);

  useEffect(() => {
    if (!activeTabPath) {
      return;
    }

    requestAnimationFrame(() => {
      scrollTabIntoView(activeTabPath);
    });
  }, [activeTabPath, openTabs.length]);

  useEffect(() => {
    documentContentRef.current = documentContent;
  }, [documentContent]);

  useEffect(() => {
    if (agentPaletteOpen) {
      return;
    }

    agentSelectionRangeRef.current = null;
    clearAgentSelectionHighlight();
  }, [agentPaletteOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        setIsHeaderMenuOpen(false);
        setAgentPaletteOpen(false);
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    const openOnAgentShortcut = (event: KeyboardEvent) => {
      if (isAppInputShortcutTarget(event.target)) {
        return;
      }

      const isFnKey = event.key === 'Fn' || event.code === 'Fn';
      const isConfiguredShortcut = doesShortcutMatchKeyboardEvent(shortcutSettings.openAiPanel, event);

      if (!isFnKey && !isConfiguredShortcut) {
        return;
      }

      event.preventDefault();
      openAgentPalette();
    };

    window.addEventListener('keydown', openOnAgentShortcut);
    return () => window.removeEventListener('keydown', openOnAgentShortcut);
  }, [openAgentPalette, shortcutSettings.openAiPanel]);

  useEffect(() => {
    return window.veloca?.agent.onOpenPalette(openAgentPalette);
  }, [openAgentPalette]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    window.veloca?.github.getStatus().then(applyGitHubStatus);
    void refreshVersionManagerStatus();
  }, [settingsOpen]);

  useEffect(() => {
    if (sidebarTab !== 'git') {
      return;
    }

    void refreshVersionManagerStatus();
  }, [sidebarTab]);

  useEffect(() => {
    if (!settingsOpen || settingsPanel !== 'remote') {
      return;
    }

    const refreshRemoteSyncStatus = () => {
      window.veloca?.remote.getSyncStatus().then(setRemoteSyncStatus);
    };
    const timer = window.setInterval(refreshRemoteSyncStatus, 4000);

    refreshRemoteSyncStatus();

    return () => window.clearInterval(timer);
  }, [settingsOpen, settingsPanel]);

  useEffect(() => {
    if (!agentPaletteOpen) {
      return;
    }

    const repositionAgentPalette = () => positionAgentPalette();

    window.addEventListener('resize', repositionAgentPalette);
    return () => window.removeEventListener('resize', repositionAgentPalette);
  }, [agentPaletteOpen, positionAgentPalette]);

  useEffect(() => {
    const logWindowError = (event: ErrorEvent) => {
      console.error('[Veloca Renderer Error]', {
        column: event.colno,
        filename: event.filename,
        line: event.lineno,
        message: event.message,
        stack: event.error instanceof Error ? event.error.stack : undefined
      });
    };
    const logUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;

      console.error('[Veloca Renderer Unhandled Rejection]', {
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
      });
    };

    window.addEventListener('error', logWindowError);
    window.addEventListener('unhandledrejection', logUnhandledRejection);

    return () => {
      window.removeEventListener('error', logWindowError);
      window.removeEventListener('unhandledrejection', logUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null);
    const closeHeaderMenu = (event: Event) => {
      const target = (event.target as Node | null) ?? null;

      if (!target) {
        setIsHeaderMenuOpen(false);
        setContextMenu(null);
        return;
      }

      if (
        headerMenuButtonRef.current &&
        (headerMenuButtonRef.current.contains(target) || headerMenuRef.current?.contains(target))
      ) {
        return;
      }

      setIsHeaderMenuOpen(false);
      setContextMenu(null);
    };

    window.addEventListener('mousedown', closeContextMenu);
    window.addEventListener('mousedown', closeHeaderMenu);
    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('resize', closeHeaderMenu);

    return () => {
      window.removeEventListener('mousedown', closeContextMenu);
      window.removeEventListener('mousedown', closeHeaderMenu);
      window.removeEventListener('resize', closeContextMenu);
      window.removeEventListener('resize', closeHeaderMenu);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (editorFontSizeSaveTimerRef.current) {
        window.clearTimeout(editorFontSizeSaveTimerRef.current);
        editorFontSizeSaveTimerRef.current = null;
      }

      if (pendingEditorFontSizeRef.current !== null) {
        void window.veloca?.settings.setTypographySettings({
          editorFontSize: pendingEditorFontSizeRef.current
        });
        pendingEditorFontSizeRef.current = null;
      }

      saveActionTimersRef.current.forEach((timer) => clearTimeout(timer));
      saveActionTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const nextFilePath = activeFile?.path ?? null;
    const fileChanged = outlineFilePathRef.current !== nextFilePath;
    outlineFilePathRef.current = nextFilePath;

    setActiveHeadingId((currentHeadingId) => {
      if (!sections.length) {
        return '';
      }

      if (fileChanged) {
        return sections[0].id;
      }

      return sections.some((section) => section.id === currentHeadingId)
        ? currentHeadingId
        : sections[0].id;
    });
  }, [activeFile?.path, sections]);

  const applyTheme = (nextTheme: ThemeMode) => {
    document.documentElement.dataset.theme = nextTheme;
  };

  const startSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebarWidth;

    setIsSidebarResizing(true);

    const resizeSidebar = (moveEvent: PointerEvent) => {
      setSidebarWidth(clampNumber(startWidth + moveEvent.clientX - startX, sidebarMinimumWidth, sidebarMaximumWidth));
    };

    const stopResize = () => {
      setIsSidebarResizing(false);
      window.removeEventListener('pointermove', resizeSidebar);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };

    window.addEventListener('pointermove', resizeSidebar);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  };

  const resizeSidebarWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }

    event.preventDefault();

    if (event.key === 'Home') {
      setSidebarWidth(sidebarMinimumWidth);
      return;
    }

    if (event.key === 'End') {
      setSidebarWidth(sidebarMaximumWidth);
      return;
    }

    const direction = event.key === 'ArrowRight' ? 1 : -1;
    setSidebarWidth((currentWidth) => clampNumber(currentWidth + direction * 16, sidebarMinimumWidth, sidebarMaximumWidth));
  };

  const updateTheme = async (nextTheme: ThemeMode) => {
    applyTheme(nextTheme);
    setTheme(nextTheme);
    localStorage.setItem('veloca-theme', nextTheme);

    await window.veloca?.settings.setTheme(nextTheme);
    showToast({
      type: 'success',
      title: t('toast.appearance.updatedTitle'),
      description: t('toast.appearance.themeDescription', {
        theme: nextTheme === 'dark' ? t('common.dark') : t('common.light')
      })
    });
  };

  const updateAppearanceSettings = async (nextPartialSettings: Partial<AppearanceSettings>) => {
    const nextSettings = normalizeAppearanceSettings({
      ...appearanceSettings,
      ...nextPartialSettings
    });

    setAppearanceSettings(nextSettings);
    applyAppearanceSettings(nextSettings);
    localStorage.setItem('veloca-app-language', nextSettings.language);
    localStorage.setItem('veloca-interface-density', nextSettings.density);
    localStorage.setItem('veloca-motion-preference', nextSettings.motion);

    await window.veloca?.settings.setAppearanceSettings(nextSettings);
    showToast({
      type: 'success',
      title: t('toast.appearance.updatedTitle'),
      description: t('toast.appearance.savedDescription')
    });
  };

  const updateAutoSave = async (enabled: boolean) => {
    setAutoSave(enabled);
    localStorage.setItem('veloca-auto-save', enabled ? 'true' : 'false');
    await window.veloca?.settings.setAutoSave(enabled);
    showToast({
      type: 'success',
      title: t('toast.editor.updatedTitle'),
      description: t('toast.editor.autoSaveDescription', {
        state: enabled ? t('value.enabled') : t('value.disabled')
      })
    });
  };

  const commitEditorFontSize = (fontSize: number) => {
    const nextFontSize = normalizeEditorFontSize(fontSize);
    pendingEditorFontSizeRef.current = nextFontSize;

    if (editorFontSizeSaveTimerRef.current) {
      window.clearTimeout(editorFontSizeSaveTimerRef.current);
    }

    editorFontSizeSaveTimerRef.current = window.setTimeout(() => {
      editorFontSizeSaveTimerRef.current = null;
      void window.veloca?.settings.setTypographySettings({
        editorFontSize: nextFontSize
      });
      pendingEditorFontSizeRef.current = null;
    }, 220);
  };

  const updateEditorFontSize = (fontSize: number) => {
    const nextFontSize = normalizeEditorFontSize(fontSize);

    setEditorFontSize(nextFontSize);
    applyEditorFontSize(nextFontSize);
    localStorage.setItem('veloca-editor-font-size', String(nextFontSize));
    commitEditorFontSize(nextFontSize);
  };

  const resetEditorFontSize = () => {
    updateEditorFontSize(defaultEditorFontSize);
  };

  const updateShortcutSettings = async (settings: ShortcutSettings) => {
    setShortcutSettings(settings);
    localStorage.setItem('veloca-shortcut-open-ai-panel', settings.openAiPanel);
    await window.veloca?.settings.setShortcutSettings(settings);
    showToast({
      type: 'success',
      title: t('toast.shortcut.updatedTitle'),
      description: t('toast.shortcut.description', { shortcut: settings.openAiPanel })
    });
  };

  const recordOpenAiPanelShortcut = async (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      setRecordingShortcutAction(null);
      return;
    }

    const shortcut = getShortcutFromKeyboardEvent(event);

    if (!shortcut) {
      return;
    }

    await updateShortcutSettings({
      ...shortcutSettings,
      openAiPanel: shortcut
    });
    setRecordingShortcutAction(null);
  };

  const resetOpenAiPanelShortcut = async () => {
    setRecordingShortcutAction(null);
    await updateShortcutSettings({
      ...shortcutSettings,
      openAiPanel: getDefaultOpenAiPanelShortcut(appPlatform)
    });
  };

  const updateAiConfig = async (config: AiModelConfig) => {
    setAiConfig(config);
    localStorage.setItem('veloca-ai-base-url', config.baseUrl);
    localStorage.setItem('veloca-ai-api-key', config.apiKey);
    localStorage.setItem('veloca-ai-model', config.model);
    localStorage.setItem('veloca-ai-context-window', String(config.contextWindow));
    await window.veloca?.settings.setAiConfig(config);
    showToast({
      type: 'success',
      title: t('toast.ai.updatedTitle'),
      description: t('toast.ai.updatedDescription')
    });
  };

  const applyRemoteConfig = (config: RemoteDatabaseConfigView) => {
    setRemoteConfig(config);
    setRemoteInput((current) => ({
      ...current,
      databasePassword: config.databasePasswordSaved ? remoteCredentialMask : '',
      organizationSlug: config.organizationSlug || current.organizationSlug,
      personalAccessToken: config.patSaved ? remoteCredentialMask : '',
      region: config.region || current.region || 'us-east-1'
    }));
  };

  const getRemoteConfigSubmission = (): RemoteDatabaseConfigInput => ({
    ...remoteInput,
    databasePassword: remoteInput.databasePassword === remoteCredentialMask ? undefined : remoteInput.databasePassword,
    personalAccessToken:
      remoteInput.personalAccessToken === remoteCredentialMask ? undefined : remoteInput.personalAccessToken
  });

  const clearMaskedRemoteInputField = (field: 'databasePassword' | 'personalAccessToken') => {
    setRemoteInput((current) => {
      if (current[field] !== remoteCredentialMask) {
        return current;
      }

      return {
        ...current,
        [field]: ''
      };
    });
  };

  const restoreMaskedRemoteInputField = (field: 'databasePassword' | 'personalAccessToken') => {
    const saved = field === 'databasePassword' ? remoteConfig.databasePasswordSaved : remoteConfig.patSaved;

    if (!saved) {
      return;
    }

    setRemoteInput((current) => {
      if ((current[field] ?? '').trim()) {
        return current;
      }

      return {
        ...current,
        [field]: remoteCredentialMask
      };
    });
  };

  const updateRemoteInputField = (field: RemoteInputField, value: string, source: 'change' | 'paste') => {
    logRemoteSettingsDebug('field update', {
      field,
      length: value.length,
      source
    });
    setRemoteInput((current) => ({
      ...current,
      [field]: value
    }));
  };

  const pasteRemoteInputField = (
    field: RemoteInputField,
    event: ReactClipboardEvent<HTMLInputElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const input = event.currentTarget;
    const pastedText = event.clipboardData.getData('text/plain');
    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    const nextValue = `${input.value.slice(0, selectionStart)}${pastedText}${input.value.slice(selectionEnd)}`;

    logRemoteSettingsDebug('manual paste', {
      field,
      nextLength: nextValue.length,
      pastedLength: pastedText.length,
      selectionEnd,
      selectionStart
    });
    updateRemoteInputField(field, nextValue, 'paste');
  };

  const saveRemoteConfig = async () => {
    if (!window.veloca?.settings || remoteLoading) {
      return;
    }

    setRemoteLoading(true);

    try {
      const config = await window.veloca.settings.saveRemoteConfig(getRemoteConfigSubmission());
      applyRemoteConfig(config);
      showToast({
        type: 'success',
        title: 'Remote Settings Saved',
        description: 'Supabase remote configuration was encrypted and saved locally.'
      });
    } catch (error) {
      showToast({
        type: 'info',
        title: 'Remote Settings Failed',
        description: getErrorDescription(error, 'Veloca could not save the Supabase configuration.')
      });
    } finally {
      setRemoteLoading(false);
    }
  };

  const createRemoteVelocaProject = async () => {
    if (!window.veloca?.remote || remoteLoading) {
      return;
    }

    setRemoteLoading(true);
    setRemoteConfig((current) => ({
      ...current,
      lastError: '',
      status: 'creating',
      statusCode: 2
    }));

    try {
      const result = await window.veloca.remote.createVelocaProject(getRemoteConfigSubmission());
      applyRemoteConfig(result.config);
      showToast({
        type: 'success',
        title: result.reusedExistingProject ? 'Remote Project Connected' : 'Remote Project Created',
        description: result.reusedExistingProject
          ? 'Veloca reused the existing Supabase project and initialized the cloud tables.'
          : 'Veloca created the Supabase project and initialized the cloud tables.'
      });
    } catch (error) {
      const nextConfig = await window.veloca.settings.getRemoteConfig();
      applyRemoteConfig(nextConfig);
      showToast({
        type: 'info',
        title: 'Remote Setup Failed',
        description: getErrorDescription(error, 'Veloca could not create or initialize the Supabase project.')
      });
    } finally {
      setRemoteLoading(false);
    }
  };

  const testRemoteConnection = async () => {
    if (!window.veloca?.remote || remoteLoading) {
      return;
    }

    setRemoteLoading(true);

    try {
      const config = await window.veloca.remote.testConnection();
      applyRemoteConfig(config);
      showToast({
        type: 'success',
        title: 'Remote Connected',
        description: 'Veloca reached the Supabase project successfully.'
      });
    } catch (error) {
      showToast({
        type: 'info',
        title: 'Remote Test Failed',
        description: getErrorDescription(error, 'Veloca could not connect to the Supabase project.')
      });
    } finally {
      setRemoteLoading(false);
    }
  };

  const updateRemoteSyncConfig = (field: keyof RemoteSyncConfig, value: boolean) => {
    setRemoteSyncConfig((current) => ({
      ...current,
      [field]: value
    }));
  };

  const saveRemoteSyncSettings = async () => {
    if (!window.veloca?.settings || remoteSyncLoading) {
      return;
    }

    setRemoteSyncLoading(true);

    try {
      const config = await window.veloca.settings.saveRemoteSyncConfig(remoteSyncConfig);
      setRemoteSyncConfig(config);
      showToast({
        type: 'success',
        title: 'Remote Sync Saved',
        description: 'Remote sync preferences have been saved locally.'
      });
    } catch (error) {
      showToast({
        type: 'info',
        title: 'Remote Sync Failed',
        description: getErrorDescription(error, 'Veloca could not save remote sync preferences.')
      });
    } finally {
      setRemoteSyncLoading(false);
    }
  };

  const runRemoteSyncAction = async (mode: 'manual' | 'retry') => {
    if (!window.veloca?.remote || remoteSyncLoading) {
      return;
    }

    setRemoteSyncLoading(true);

    try {
      const status =
        mode === 'retry' ? await window.veloca.remote.retryFailedSync() : await window.veloca.remote.syncNow();
      setRemoteSyncStatus(status);
      if (status.lastError) {
        showToast({
          type: 'info',
          title: 'Remote Sync Failed',
          description: status.lastError
        });
        return;
      }

      showToast({
        type: 'success',
        title: mode === 'retry' ? 'Remote Retry Finished' : 'Remote Sync Finished',
        description: 'Veloca updated the remote sync queue status.'
      });
    } catch (error) {
      showToast({
        type: 'info',
        title: 'Remote Sync Failed',
        description: getErrorDescription(error, 'Veloca could not complete remote sync.')
      });
    } finally {
      setRemoteSyncLoading(false);
    }
  };

  const bindGitHubAccount = async () => {
    if (!window.veloca?.github || githubAuthLoading) {
      return;
    }

    setGithubAuthLoading(true);

    try {
      const binding = await window.veloca.github.startBinding();
      setGithubBinding(binding);
      showToast({
        type: 'info',
        title: 'GitHub Authorization Started',
        description: `Enter ${binding.userCode} in the GitHub page that just opened.`
      });

      const status = await window.veloca.github.completeBinding(binding.sessionId);
      applyGitHubStatus(status);
      setGithubBinding(null);
      void refreshVersionManagerStatus();
      showToast({
        type: 'success',
        title: 'GitHub Account Bound',
        description: status.account ? `Connected as ${status.account.login}.` : 'GitHub account connected.'
      });
    } catch (error) {
      showToast({
        type: 'info',
        title: 'GitHub Binding Failed',
        description: error instanceof Error ? error.message : 'Unable to bind GitHub account.'
      });
    } finally {
      setGithubAuthLoading(false);
    }
  };

  const unbindGitHubAccount = async () => {
    if (!window.veloca?.github || githubAuthLoading) {
      return;
    }

    setGithubAuthLoading(true);

    try {
      const status = await window.veloca.github.unbind();
      applyGitHubStatus(status);
      setGithubBinding(null);
      setVersionStatus(createEmptyVersionManagerStatus(status));
      showToast({
        type: 'success',
        title: 'GitHub Account Unbound',
        description: 'The local GitHub token has been removed from Veloca.'
      });
    } catch (error) {
      showToast({
        type: 'info',
        title: 'GitHub Unbind Failed',
        description: error instanceof Error ? error.message : 'Unable to unbind GitHub account.'
      });
    } finally {
      setGithubAuthLoading(false);
    }
  };

  const openGitHubVerificationPage = async () => {
    if (!githubBinding || !window.veloca?.github) {
      return;
    }

    await window.veloca.github.openVerificationUrl(githubBinding.verificationUri);
  };

  const openAccountSettings = () => {
    setSettingsPanel('about');
    setSettingsOpen(true);
    void refreshVersionManagerStatus();
  };

  const ensureVersionRepository = async () => {
    if (!window.veloca?.versionManager || versionLoading) {
      return;
    }

    setVersionLoading(true);

    try {
      const status = await window.veloca.versionManager.ensureRepository();
      setVersionStatus(status);
      setGithubStatus(status.github);
      showToast({
        type: 'success',
        title: 'Version Repository Ready',
        description: `${status.repository?.owner ?? 'GitHub'}/veloca-version-manager is ready.`
      });
    } catch (error) {
      showToast({
        type: 'info',
        title: 'Version Repository Not Ready',
        description: error instanceof Error ? error.message : 'Unable to prepare the GitHub repository.'
      });
    } finally {
      setVersionLoading(false);
    }
  };

  const commitAndPushVersionChanges = async () => {
    if (!window.veloca?.versionManager || versionLoading) {
      return;
    }

    setVersionLoading(true);

    try {
      const result = await window.veloca.versionManager.commitAndPush(versionCommitMessage);
      setVersionStatus(result.status);
      setGithubStatus(result.status.github);

      if (result.pushed) {
        setVersionCommitMessage('');
      }

      showToast({
        type: result.pushed ? 'success' : 'info',
        title: result.pushed ? 'Version Pushed' : 'No Version Changes',
        description: result.pushed
          ? `Commit ${result.commitOid?.slice(0, 8) ?? ''} has been pushed.`
          : 'There are no Veloca-managed markdown changes to commit.'
      });
    } catch (error) {
      showToast({
        type: 'info',
        title: 'Version Push Failed',
        description: error instanceof Error ? error.message : 'Unable to commit and push version changes.'
      });
    } finally {
      setVersionLoading(false);
    }
  };

  const clearSaveTimer = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  };

  const clearSplitView = () => {
    setIsSplitViewEnabled(false);
    setSplitPanePaths(null);
    setSplitAfterIndex(null);
    setTabDropCue(null);
    setSplitPaneRatio(50);
  };

  const getDocumentViewMode = (filePath: string): DocumentViewMode => {
    return documentViewModesByPath[filePath] ?? defaultDocumentViewMode;
  };

  const getEditorShellElement = (filePath: string): HTMLElement | null => {
    const editorShells = document.querySelectorAll<HTMLElement>('[data-file-path]');

    for (const shell of editorShells) {
      if (shell.dataset.filePath === filePath) {
        return shell;
      }
    }

    return null;
  };

  const getEditorScrollPosition = (filePath: string): number | null => {
    const scrollContainer = getEditorShellElement(filePath)?.closest<HTMLElement>(
      '.editor-pane-scroll, .editor-scroll-area'
    );

    return scrollContainer?.scrollTop ?? null;
  };

  const restoreEditorScrollPosition = (filePath: string, scrollTop: number | null) => {
    if (scrollTop === null) {
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const scrollContainer = getEditorShellElement(filePath)?.closest<HTMLElement>(
          '.editor-pane-scroll, .editor-scroll-area'
        );

        if (scrollContainer) {
          scrollContainer.scrollTop = scrollTop;
        }
      });
    });
  };

  const loadDocumentProvenance = async (
    file: MarkdownFileContent
  ): Promise<Pick<OpenEditorTab, 'provenanceMarkdownHash' | 'provenanceSnapshotJson'>> => {
    const documentKey = getDocumentProvenanceKey(file);

    if (!documentKey || !window.veloca?.workspace.readProvenance) {
      return {
        provenanceMarkdownHash: null,
        provenanceSnapshotJson: null
      };
    }

    const snapshot = await window.veloca.workspace.readProvenance(documentKey);

    if (!snapshot) {
      return {
        provenanceMarkdownHash: null,
        provenanceSnapshotJson: null
      };
    }

    return normalizePersistedProvenanceForContent(file.content, snapshot.markdownHash, snapshot.snapshotJson);
  };

  const persistDocumentProvenance = async (
    file: MarkdownFileContent,
    content: string,
    fallback?: Pick<OpenEditorTab, 'provenanceMarkdownHash' | 'provenanceSnapshotJson'>,
    snapshotOverride?: JSONContent | null
  ): Promise<Pick<OpenEditorTab, 'provenanceMarkdownHash' | 'provenanceSnapshotJson'>> => {
    const documentKey = getDocumentProvenanceKey(file);
    const workspaceType = getDocumentProvenanceWorkspaceType(file);

    if (!documentKey || !workspaceType || !window.veloca?.workspace) {
      return {
        provenanceMarkdownHash: null,
        provenanceSnapshotJson: null
      };
    }

    const markdownHash = hashMarkdownContent(content);
    const renderedHandle = renderedEditorHandlesRef.current.get(file.path);
    const editorSnapshot = snapshotOverride ?? renderedHandle?.getProvenanceSnapshot() ?? null;
    const renderedRanges = renderedHandle?.getAiProvenanceRanges(content) ?? [];
    const fallbackProvenance =
      fallback?.provenanceMarkdownHash === markdownHash
        ? parseStoredAiProvenanceSnapshot(fallback.provenanceSnapshotJson)
        : null;

    if (renderedRanges.length) {
      const provenance = buildAiProvenanceSnapshotFields(content, renderedRanges, editorSnapshot);

      if (!provenance.provenanceSnapshotJson) {
        await window.veloca.workspace.deleteProvenance(documentKey);
        return provenance;
      }

      await window.veloca.workspace.saveProvenance({
        documentKey,
        documentPath: file.path,
        markdownHash,
        snapshotJson: provenance.provenanceSnapshotJson,
        workspaceFolderId: file.workspaceFolderId,
        workspaceType
      });

      return provenance;
    }

    if (fallbackProvenance?.version === 2) {
      const provenance = buildAiProvenanceSnapshotFields(
        content,
        fallbackProvenance.ranges,
        editorSnapshot ?? fallbackProvenance.snapshot,
        fallbackProvenance.markSnapshot ?? null
      );

      if (!provenance.provenanceSnapshotJson) {
        await window.veloca.workspace.deleteProvenance(documentKey);
        return provenance;
      }

      await window.veloca.workspace.saveProvenance({
        documentKey,
        documentPath: file.path,
        markdownHash,
        snapshotJson: provenance.provenanceSnapshotJson,
        workspaceFolderId: file.workspaceFolderId,
        workspaceType
      });

      return provenance;
    }

    const fallbackSnapshot = fallbackProvenance?.version === 1 ? fallbackProvenance.snapshot : null;
    const snapshot = editorSnapshot ?? fallbackSnapshot;

    if (!documentSnapshotHasAiProvenance(snapshot)) {
      await window.veloca.workspace.deleteProvenance(documentKey);
      return {
        provenanceMarkdownHash: null,
        provenanceSnapshotJson: null
      };
    }

    const snapshotJson = JSON.stringify(snapshot);
    const payload: DocumentProvenanceSnapshot = {
      documentKey,
      documentPath: file.path,
      markdownHash,
      snapshotJson,
      workspaceFolderId: file.workspaceFolderId,
      workspaceType
    };

    await window.veloca.workspace.saveProvenance(payload);

    return {
      provenanceMarkdownHash: markdownHash,
      provenanceSnapshotJson: snapshotJson
    };
  };

  const updateTabProvenanceSnapshot = (
    filePath: string,
    content: string,
    snapshot: JSONContent | null,
    renderedRanges?: AiGeneratedMarkdownRange[]
  ) => {
    let provenanceMarkdownHash: string | null = null;
    let provenanceSnapshotJson: string | null = null;
    const targetTab = openTabs.find((tab) => tab.file.path === filePath);
    const ranges = renderedRanges?.length
      ? renderedRanges
      : getAiProvenanceRangesForContent(content, targetTab?.provenanceSnapshotJson);
    const v2Provenance = buildAiProvenanceSnapshotFields(content, ranges, snapshot);

    if (v2Provenance.provenanceSnapshotJson) {
      provenanceMarkdownHash = v2Provenance.provenanceMarkdownHash ?? null;
      provenanceSnapshotJson = v2Provenance.provenanceSnapshotJson;
    } else if (documentSnapshotHasAiProvenance(snapshot)) {
      provenanceMarkdownHash = hashMarkdownContent(content);
      provenanceSnapshotJson = JSON.stringify(snapshot);
    }

    setOpenTabs((current) => {
      const nextTabs = current.map((tab) =>
        tab.file.path === filePath
          ? {
              ...tab,
              provenanceMarkdownHash,
              provenanceSnapshotJson
            }
          : tab
      );

      activeTabRef.current = nextTabs.find((tab) => tab.file.path === filePath) ?? activeTabRef.current;
      return nextTabs;
    });
  };

  const getCursorOffsetForViewMode = (filePath: string, mode: DocumentViewMode): number | null => {
    if (mode === 'source') {
      return sourceEditorHandlesRef.current.get(filePath)?.getCursorOffset() ?? null;
    }

    return renderedEditorHandlesRef.current.get(filePath)?.getCursorMarkdownOffset() ?? null;
  };

  const getCursorRestoreProps = (filePath: string, mode: DocumentViewMode) => {
    if (cursorRestoreRequest?.filePath !== filePath || cursorRestoreRequest.mode !== mode) {
      return {
        onCursorRestoreComplete: undefined,
        restoreCursorOffset: null,
        restoreCursorSequence: null
      };
    }

    return {
      onCursorRestoreComplete: (sequence: number) => {
        setCursorRestoreRequest((current) => (current?.sequence === sequence ? null : current));
      },
      restoreCursorOffset: cursorRestoreRequest.offset,
      restoreCursorSequence: cursorRestoreRequest.sequence
    };
  };

  const toggleActiveDocumentViewMode = () => {
    if (!activeTabPath) {
      return;
    }

    const targetPath = activeTabPath;
    const currentMode = getDocumentViewMode(targetPath);
    const nextMode: DocumentViewMode = currentMode === 'rendered' ? 'source' : 'rendered';
    let cursorOffset: number | null = null;
    let scrollTop: number | null = null;

    try {
      const renderedHandle = currentMode === 'rendered' ? renderedEditorHandlesRef.current.get(targetPath) : null;

      if (renderedHandle?.hasRenderedEdits()) {
        const latestRenderedMarkdown = renderedHandle.getMarkdownContent();
        const latestRenderedRanges = renderedHandle.getAiProvenanceRanges(latestRenderedMarkdown);
        const shouldSkipEmptyFlush = !latestRenderedMarkdown.trim() && documentContentRef.current.trim();

        if (!shouldSkipEmptyFlush) {
          updateTabProvenanceSnapshot(
            targetPath,
            latestRenderedMarkdown,
            renderedHandle.getProvenanceSnapshot(),
            latestRenderedRanges
          );
        }

        if (!shouldSkipEmptyFlush && latestRenderedMarkdown !== documentContentRef.current) {
          updateTabDocumentContent(targetPath, latestRenderedMarkdown);
        }
      }
    } catch (error) {
      console.info('[Veloca Source Toggle]', 'Markdown flush failed', error);
    }

    try {
      cursorOffset = getCursorOffsetForViewMode(targetPath, currentMode);
    } catch (error) {
      console.info('[Veloca Source Toggle]', 'Cursor restore failed', error);
    }

    try {
      scrollTop = getEditorScrollPosition(targetPath);
    } catch (error) {
      console.info('[Veloca Source Toggle]', 'Scroll capture failed', error);
    }

    if (typeof cursorOffset === 'number') {
      cursorRestoreSequenceRef.current += 1;
      setCursorRestoreRequest({
        filePath: targetPath,
        mode: nextMode,
        offset: cursorOffset,
        sequence: cursorRestoreSequenceRef.current
      });
    }

    setDocumentViewModesByPath((current) => ({
      ...current,
      [targetPath]: nextMode
    }));
    restoreEditorScrollPosition(targetPath, scrollTop);
  };

  const updateTabProvenanceFields = (
    filePath: string,
    provenance: Pick<OpenEditorTab, 'provenanceMarkdownHash' | 'provenanceSnapshotJson'>
  ) => {
    setOpenTabs((current) => {
      const nextTabs = current.map((tab) =>
        tab.file.path === filePath
          ? {
              ...tab,
              ...provenance
            }
          : tab
      );

      activeTabRef.current = nextTabs.find((tab) => tab.file.path === filePath) ?? activeTabRef.current;
      return nextTabs;
    });
  };

  const applyAiProvenanceToRenderedEditor = (
    filePath: string,
    content: string,
    ranges: AiGeneratedMarkdownRange[],
    attempt = 0
  ) => {
    const handle = renderedEditorHandlesRef.current.get(filePath);
    logAiInsertDebug('looking for rendered editor handle for provenance apply', {
      attempt,
      filePath,
      hasHandle: Boolean(handle),
      renderedHandlePaths: Array.from(renderedEditorHandlesRef.current.keys()),
      sourceHandlePaths: Array.from(sourceEditorHandlesRef.current.keys())
    });

    if (!handle) {
      if (attempt < 20) {
        window.setTimeout(
          () => applyAiProvenanceToRenderedEditor(filePath, content, ranges, attempt + 1),
          50
        );
        return;
      }

      showToast({
        type: 'info',
        title: 'Insert Failed',
        description: 'The rendered editor is not ready yet.'
      });
      return;
    }

    const snapshot = handle.applyAiProvenanceContent(content, ranges);

    if (!snapshot) {
      showToast({
        type: 'info',
        title: 'Insert Failed',
        description: 'The AI response was inserted, but the rendered provenance could not be restored.'
      });
      return;
    }

    updateTabProvenanceFields(filePath, buildAiProvenanceSnapshotFields(content, ranges, snapshot));
  };

  const getAiInsertSelectionRange = (
    filePath: string,
    mode: DocumentViewMode,
    fallbackContentLength: number
  ): MarkdownSelectionRange => {
    const range =
      mode === 'source'
        ? sourceEditorHandlesRef.current.get(filePath)?.getSelectionRange()
        : renderedEditorHandlesRef.current.get(filePath)?.getMarkdownSelectionRange();

    return (
      range ?? {
        from: fallbackContentLength,
        to: fallbackContentLength
      }
    );
  };

  const createAiGeneratedMarkdownRange = (
    messageId: string,
    patch: AiMarkdownInsertionPatch
  ): AiGeneratedMarkdownRange => ({
    createdAt: Date.now(),
    end: patch.inserted.to,
    id: createAiProvenanceId('range'),
    provenanceId: createAiProvenanceId('ai'),
    rawMarkdown: patch.normalizedMarkdown,
    rawMarkdownHash: hashMarkdownContent(patch.normalizedMarkdown),
    sourceMessageId: messageId,
    start: patch.inserted.from
  });

  const insertAiAnswerIntoMarkdownSource = (
    filePath: string,
    answer: string,
    messageId: string,
    currentMode: DocumentViewMode
  ): boolean => {
    const targetTab = openTabs.find((tab) => tab.file.path === filePath);
    const currentContent = filePath === activeTabPath ? documentContentRef.current : targetTab?.draftContent ?? '';
    const selectionRange = getAiInsertSelectionRange(filePath, currentMode, currentContent.length);
    const patch = buildAiMarkdownInsertionPatch(currentContent, answer, selectionRange);

    if (!patch) {
      showToast({
        type: 'info',
        title: 'Insert Failed',
        description: 'The AI response is empty or could not be inserted.'
      });
      return false;
    }

    const existingRanges = getAiProvenanceRangesForContent(currentContent, targetTab?.provenanceSnapshotJson);
    const shiftedRanges = shiftAiProvenanceRangesForPatch(
      existingRanges,
      patch.replaced,
      patch.content.length - currentContent.length + (patch.replaced.to - patch.replaced.from)
    );
    const ranges = filterValidAiProvenanceRanges(patch.content, [
      ...shiftedRanges,
      createAiGeneratedMarkdownRange(messageId, patch)
    ]);
    const snapshot = renderedEditorHandlesRef.current.get(filePath)?.applyAiProvenanceContent(patch.content, ranges) ?? null;
    const provenance = buildAiProvenanceSnapshotFields(patch.content, ranges, snapshot);

    updateTabDocumentContent(filePath, patch.content, provenance);

    if (!snapshot) {
      applyAiProvenanceToRenderedEditor(filePath, patch.content, ranges);
    }

    showToast({
      type: 'success',
      title: 'Inserted',
      description: 'The AI response has been inserted into the document.'
    });

    return true;
  };

  const handleInsertAiAnswer = (answer: string, messageId: string, targetFilePath?: string) => {
    const targetPath =
      targetFilePath && openTabPathsRef.current.has(targetFilePath) ? targetFilePath : activeTabPath;
    const targetTab = targetPath ? openTabs.find((tab) => tab.file.path === targetPath) ?? null : null;

    logAiInsertDebug('App insert handler entered', {
      activeTabPath,
      answerLength: answer.length,
      hasActiveTab: Boolean(activeTab),
      hasTargetTab: Boolean(targetTab),
      messageId,
      targetFilePath,
      targetPath
    });

    if (!targetPath) {
      showToast({
        type: 'info',
        title: 'Insert Failed',
        description: 'Open a document before inserting an AI response.'
      });
      return;
    }

    if (!answer.trim()) {
      showToast({
        type: 'info',
        title: 'Insert Failed',
        description: 'The AI response is empty.'
      });
      return;
    }

    const currentMode = getDocumentViewMode(targetPath);
    logAiInsertDebug('resolved insert target', {
      currentMode,
      targetPath
    });

    const inserted = insertAiAnswerIntoMarkdownSource(targetPath, answer, messageId, currentMode);

    if (inserted && currentMode === 'source') {
      setDocumentViewModesByPath((current) => ({
        ...current,
        [targetPath]: 'rendered'
      }));
    }
  };

  const ensureTabGroup = (paths: string[], insertIndex?: number) => {
    const nextGroup = normalizeTabGroup(paths);
    const nextKey = getTabGroupKey(nextGroup);

    setTabGroups((current) => {
      if (!nextGroup.length || current.some((group) => getTabGroupKey(group) === nextKey)) {
        return current;
      }

      const nextGroups = [...current];
      const boundedIndex =
        typeof insertIndex === 'number' ? Math.max(0, Math.min(insertIndex, nextGroups.length)) : nextGroups.length;
      nextGroups.splice(boundedIndex, 0, nextGroup);
      return nextGroups;
    });
  };

  const activateEditorTab = (tab: OpenEditorTab, groupPaths: string[] = [tab.file.path]) => {
    const nextGroup = normalizeTabGroup(groupPaths);
    const nextGroupKey = getTabGroupKey(nextGroup);

    setActiveGroupKey(nextGroupKey);

    if (nextGroup.length > 1) {
      setIsSplitViewEnabled(true);
      setSplitPanePaths([nextGroup[0], nextGroup[1]]);
    } else {
      setIsSplitViewEnabled(false);
      setSplitPanePaths(null);
      setSplitAfterIndex(null);
      setTabDropCue(null);
    }

    activeTabRef.current = tab;
    documentContentRef.current = tab.draftContent;
    setActiveTabPath(tab.file.path);
    setDocumentContent(tab.draftContent);
    setSaveStatus(tab.status);
    setSidebarTab('files');
    scrollTabIntoView(tab.file.path);
  };

  const requestSaveLocation = (tab: OpenEditorTab) => {
    const defaultFolderPath =
      saveLocationOptions.find((option) => option.path === saveLocationDialog?.selectedFolderPath)?.path ??
      saveLocationOptions[0]?.path ??
      null;

    setIsHeaderMenuOpen(false);
    setSaveLocationDialog({
      fileName: tab.file.name || 'Untitled.md',
      filePath: tab.file.path,
      selectedFolderPath: defaultFolderPath
    });
  };

  const saveCurrentDocument = async (options: { promptForLocation?: boolean } = {}) => {
    const tab = activeTabRef.current;
    const content = documentContentRef.current;
    const shouldPromptForLocation = options.promptForLocation ?? true;

    if (!tab || !window.veloca) {
      setSaveStatus('saved');
      return true;
    }

    const filePath = tab.file.path;

    if (tab.isUntitled || isUntitledFilePath(filePath)) {
      if (shouldPromptForLocation) {
        requestSaveLocation(tab);
      }

      return false;
    }

    if (saveActionStatesRef.current[filePath] === 'saving') {
      return false;
    }

    clearSaveTimer();
    beginFileSaveAction(filePath);

    if (activeTabRef.current?.file.path === filePath) {
      setSaveStatus('saving');
    }

    setOpenTabs((current) =>
      current.map((currentTab) =>
        currentTab.file.path === filePath ? { ...currentTab, status: 'saving' } : currentTab
      )
    );

    try {
      const savedFile = await window.veloca.workspace.saveMarkdown(filePath, content);
      const provenance = await persistDocumentProvenance(savedFile, content, tab);

      setOpenTabs((current) =>
        current.map((currentTab) =>
          currentTab.file.path === filePath
            ? {
                ...currentTab,
                file: { ...currentTab.file, ...savedFile },
                ...provenance,
                savedContent: content,
                status: currentTab.draftContent === content ? 'saved' : 'unsaved'
              }
            : currentTab
        )
      );

      completeFileSaveAction(filePath);

      if (activeTabRef.current?.file.path === filePath) {
        setSaveStatus(documentContentRef.current === content ? 'saved' : 'unsaved');
      }

      void refreshVersionManagerStatus();

      return true;
    } catch {
      clearFileSaveAction(filePath);

      if (activeTabRef.current?.file.path === filePath) {
        setSaveStatus('failed');
      }

      setOpenTabs((current) =>
        current.map((currentTab) =>
          currentTab.file.path === filePath ? { ...currentTab, status: 'failed' } : currentTab
        )
      );
      showToast({
        type: 'info',
        title: 'Save Failed',
        description: 'Veloca could not save the current markdown file.'
      });
      return false;
    }
  };

  const submitSaveLocation = async () => {
    if (!saveLocationDialog || !window.veloca || savingLocation) {
      return;
    }

    const fileName = saveLocationDialog.fileName.trim();
    const parentPath = saveLocationDialog.selectedFolderPath;

    if (!fileName || !parentPath) {
      return;
    }

    const sourceTab = openTabs.find((tab) => tab.file.path === saveLocationDialog.filePath);

    if (!sourceTab) {
      setSaveLocationDialog(null);
      return;
    }

    const content =
      activeTabRef.current?.file.path === sourceTab.file.path ? documentContentRef.current : sourceTab.draftContent;
    const sourcePath = sourceTab.file.path;
    const sourceAgentContext = buildAgentRuntimeContext(sourceTab.file, workspace, null);
    const isSavingActiveTab = activeTabRef.current?.file.path === sourcePath;
    const sourceProvenanceSnapshot = renderedEditorHandlesRef.current.get(sourcePath)?.getProvenanceSnapshot() ?? null;

    setSavingLocation(true);
    beginFileSaveAction(sourcePath);
    setOpenTabs((current) =>
      current.map((tab) => (tab.file.path === sourcePath ? { ...tab, status: 'saving' } : tab))
    );

    if (isSavingActiveTab) {
      setSaveStatus('saving');
    }

    try {
      const result = await window.veloca.workspace.saveMarkdownAs(parentPath, fileName, content);
      const savedFile = result.file;
      const provenance = await persistDocumentProvenance(savedFile, content, sourceTab, sourceProvenanceSnapshot);
      const targetAgentContext = buildAgentRuntimeContext(savedFile, result.snapshot, null);

      try {
        await window.veloca.agent.inheritSessions(sourceAgentContext, targetAgentContext);
      } catch {
        showToast({
          type: 'info',
          title: 'Agent History Not Moved',
          description: 'The file was saved, but its temporary Agent session could not be inherited.'
        });
      }

      setWorkspace(result.snapshot);
      openWorkspaceRoots(result.snapshot.tree);
      openTabPathsRef.current = new Set(
        [...openTabPathsRef.current].map((path) => (path === sourcePath ? savedFile.path : path))
      );

      setTabGroups((current) =>
        current.map((group) => normalizeTabGroup(group.map((path) => (path === sourcePath ? savedFile.path : path))))
      );

      const nextActiveGroup = splitPanePaths?.includes(sourcePath)
        ? normalizeTabGroup(splitPanePaths.map((path) => (path === sourcePath ? savedFile.path : path)))
        : [savedFile.path];

      if (splitPanePaths?.includes(sourcePath)) {
        const nextSplitPanePaths = splitPanePaths.map((path) =>
          path === sourcePath ? savedFile.path : path
        ) as SplitPanePaths;

        setSplitPanePaths(nextSplitPanePaths);
      }

      setDocumentViewModesByPath((current) => {
        const next = { ...current };

        if (current[sourcePath]) {
          next[savedFile.path] = current[sourcePath];
          delete next[sourcePath];
        }

        return next;
      });

      setOpenTabs((current) => {
        const nextTabs = current.map((tab) =>
          tab.file.path === sourcePath
            ? {
                ...tab,
                file: savedFile,
                draftContent: content,
                isUntitled: false,
                ...provenance,
                savedContent: content,
                status: 'saved' as SaveStatus
              }
            : tab
        );

        activeTabRef.current = nextTabs.find((tab) => tab.file.path === savedFile.path) ?? activeTabRef.current;
        return nextTabs;
      });

      documentContentRef.current = content;
      setActiveGroupKey(getTabGroupKey(nextActiveGroup));
      setActiveTabPath(savedFile.path);
      setDocumentContent(content);
      setSaveStatus('saved');
      if (isSavingActiveTab) {
        setAgentRuntimeContext(targetAgentContext);
      }
      ensureTabGroup([savedFile.path]);
      setSaveLocationDialog(null);
      completeFileSaveAction(sourcePath);
      clearFileSaveAction(sourcePath);
      showToast({
        type: 'success',
        title: 'File Saved',
        description: savedFile.relativePath
      });
      void refreshVersionManagerStatus();
    } catch {
      clearFileSaveAction(sourcePath);
      setOpenTabs((current) =>
        current.map((tab) => (tab.file.path === sourcePath ? { ...tab, status: 'failed' } : tab))
      );

      if (activeTabRef.current?.file.path === sourcePath) {
        setSaveStatus('failed');
      }

      showToast({
        type: 'info',
        title: 'Save Failed',
        description: 'Choose a workspace folder and a valid markdown file name.'
      });
    } finally {
      setSavingLocation(false);
    }
  };

  const updateTabDocumentContent = (
    filePath: string,
    content: string,
    provenance?: Pick<OpenEditorTab, 'provenanceMarkdownHash' | 'provenanceSnapshotJson'>
  ) => {
    const targetTab = openTabs.find((tab) => tab.file.path === filePath);
    const nextStatus: SaveStatus =
      targetTab && !targetTab.isUntitled && !isUntitledFilePath(filePath) && content === targetTab.savedContent
        ? 'saved'
        : 'unsaved';

    if (nextStatus === 'unsaved' && saveActionStatesRef.current[filePath] === 'success') {
      clearFileSaveAction(filePath);
    }

    documentContentRef.current = content;
    setActiveTabPath(filePath);
    setDocumentContent(content);
    setSaveStatus(nextStatus);

    setOpenTabs((current) => {
      const nextTabs = current.map((tab) =>
        tab.file.path === filePath
          ? {
              ...tab,
              draftContent: content,
              ...(provenance ?? {}),
              status: (
                !tab.isUntitled && !isUntitledFilePath(tab.file.path) && content === tab.savedContent
                  ? 'saved'
                  : 'unsaved'
              ) as SaveStatus
            }
          : tab
      );

      activeTabRef.current = nextTabs.find((tab) => tab.file.path === filePath) ?? activeTabRef.current;
      return nextTabs;
    });
  };

  const updateTabSourceDocumentContent = (filePath: string, content: string) => {
    const targetTab = openTabs.find((tab) => tab.file.path === filePath);
    const provenance = targetTab
      ? updateAiProvenanceForSourceContentChange(targetTab.draftContent, content, targetTab.provenanceSnapshotJson)
      : undefined;

    updateTabDocumentContent(filePath, content, provenance);
  };

  const updateDocumentContent = (content: string) => {
    if (!activeTabPath) {
      return;
    }

    updateTabDocumentContent(activeTabPath, content);
  };

  const updateSourceDocumentContent = (content: string) => {
    if (!activeTabPath) {
      return;
    }

    updateTabSourceDocumentContent(activeTabPath, content);
  };

  const loadWorkspace = async () => {
    if (!window.veloca) {
      setLoadingWorkspace(false);
      return;
    }

    setLoadingWorkspace(true);

    try {
      const snapshot = await window.veloca.workspace.get();
      setWorkspace(snapshot);
      openWorkspaceRoots(snapshot.tree);

      const nextFile = activeTab
        ? findFileNodeByPath(snapshot.tree, activeTab.file.path) ?? findFirstFile(snapshot.tree)
        : findFirstFile(snapshot.tree);

      if (nextFile) {
        await readMarkdownFile(nextFile.path);
      } else {
        openTabPathsRef.current = new Set<string>();
        activeTabRef.current = null;
        documentContentRef.current = '';
        setActiveTabPath(null);
        setActiveGroupKey(null);
        setDocumentContent('');
        setSaveStatus('saved');
        clearAllFileSaveActions();
        clearSplitView();
      }
    } catch {
      showToast({
        type: 'info',
        title: 'Workspace Unavailable',
        description: 'Unable to load workspace folders.'
      });
    } finally {
      setLoadingWorkspace(false);
    }
  };

  const addWorkspaceFolder = async () => {
    if (!window.veloca) {
      showToast({
        type: 'info',
        title: 'Desktop Runtime Required',
        description: 'Folder loading is available in the Electron app.'
      });
      return;
    }

    try {
      const snapshot = await window.veloca.workspace.addFolder();
      await refreshWorkspaceAfterOperation(snapshot);

      showToast({
        type: 'success',
        title: 'Workspace Updated',
        description: `${snapshot.totalMarkdownFiles} markdown file${
          snapshot.totalMarkdownFiles === 1 ? '' : 's'
        } loaded.`
      });
    } catch {
      showToast({
        type: 'info',
        title: 'Folder Not Added',
        description: 'Veloca could not load that folder.'
      });
    }
  };

  const createDatabaseWorkspace = async () => {
    setNameDialogValue('');
    setNameDialog({
      mode: 'database-workspace',
      title: 'New Workspace',
      description: 'Create a workspace stored in SQLite without choosing a system folder.',
      placeholder: 'Workspace name',
      submitLabel: 'Create'
    });
  };

  const submitDatabaseWorkspace = async () => {
    if (!window.veloca) {
      return;
    }

    const name = nameDialogValue.trim();

    if (!name) {
      return;
    }

    try {
      const result = await window.veloca.workspace.createDatabaseWorkspace(name);
      await refreshWorkspaceAfterOperation(result.snapshot, result.path);
      showToast({
        type: 'success',
        title: 'Database Workspace Created',
        description: name
      });
      closeNameDialog();
    } catch {
      showToast({
        type: 'info',
        title: 'Create Failed',
        description: 'Unable to create that database workspace.'
      });
    }
  };

  const refreshWorkspaceAfterOperation = async (
    snapshot: WorkspaceSnapshot,
    selectedPath?: string,
    renamedPath?: string
  ) => {
    setWorkspace(snapshot);
    openWorkspaceRoots(snapshot.tree);
    const nextTabs = syncOpenTabsWithSnapshot(snapshot, renamedPath, selectedPath);

    if (nextTabs.length === 0) {
      openTabPathsRef.current = new Set<string>();
      activeTabRef.current = null;
      documentContentRef.current = '';
      setOpenTabs([]);
      setTabGroups([]);
      setActiveTabPath(null);
      setActiveGroupKey(null);
      setDocumentContent('');
      setSaveStatus('saved');
      clearAllFileSaveActions();
      clearSplitView();
      return;
    }

    openTabPathsRef.current = new Set(nextTabs.map((tab) => tab.file.path));
    pruneFileSaveActions(openTabPathsRef.current);
    setOpenTabs(nextTabs);

    if (selectedPath && renamedPath) {
      setTabGroups((current) => {
        const seenKeys = new Set<string>();
        const nextGroups: EditorTabGroup[] = [];

        for (const group of current) {
          const nextGroup = normalizeTabGroup(group.map((path) => (path === renamedPath ? selectedPath : path)));
          const nextKey = getTabGroupKey(nextGroup);

          if (seenKeys.has(nextKey)) {
            continue;
          }

          seenKeys.add(nextKey);
          nextGroups.push(nextGroup);
        }

        return nextGroups;
      });
    }

    if (selectedPath) {
      const selectedNode = findNodeByPath(snapshot.tree, selectedPath);

      if (selectedNode?.type === 'file') {
        const selectedTab = nextTabs.find((tab) => tab.file.path === selectedPath);

        if (selectedTab) {
          ensureTabGroup([selectedPath]);
          activateEditorTab(selectedTab, [selectedPath]);
          return;
        }

        await readMarkdownFile(selectedPath);
        return;
      }
    }

    if (activeTabPath && findFileNodeByPath(snapshot.tree, activeTabPath)) {
      const activeTabItem = nextTabs.find((tab) => tab.file.path === activeTabPath);

      if (!activeTabItem) {
        setActiveTabPath(null);
      } else {
        activateEditorTab(activeTabItem, splitPanePaths?.includes(activeTabPath) ? splitPanePaths : [activeTabPath]);
      }

      if (activeTabItem) {
        return;
      }
    }

    const nextFile = nextTabs[0];

    if (nextFile) {
      ensureTabGroup([nextFile.file.path]);
      activateEditorTab(nextFile, [nextFile.file.path]);
    } else {
      setActiveTabPath(null);
      setActiveGroupKey(null);
      setDocumentContent('');
      setSaveStatus('saved');
    }
  };

  const applyWatchedMarkdownFileChange = async (change: WatchedMarkdownFileChange) => {
    if (change.status !== 'changed' || !change.file) {
      return;
    }

    const changedFile = change.file;
    const targetTab = openTabsRef.current.find((tab) => tab.file.path === change.path);

    if (!targetTab || targetTab.isUntitled || isUntitledFilePath(targetTab.file.path)) {
      return;
    }

    if (changedFile.content === targetTab.draftContent) {
      return;
    }

    if (targetTab.status === 'unsaved' || targetTab.draftContent !== targetTab.savedContent) {
      showToast({
        type: 'info',
        title: 'External Changes Detected',
        description: `${targetTab.file.name} changed on disk, but Veloca kept your unsaved edits.`
      });
      return;
    }

    const scrollTop =
      activeTabPathRef.current === changedFile.path ? getEditorScrollPosition(changedFile.path) : null;
    const provenance = await loadDocumentProvenance(changedFile);
    const latestTargetTab = openTabsRef.current.find((tab) => tab.file.path === changedFile.path);

    if (
      !latestTargetTab ||
      latestTargetTab.isUntitled ||
      isUntitledFilePath(latestTargetTab.file.path) ||
      latestTargetTab.status === 'unsaved' ||
      latestTargetTab.draftContent !== latestTargetTab.savedContent ||
      latestTargetTab.draftContent === changedFile.content
    ) {
      return;
    }

    setOpenTabs((current) => {
      const currentTab = current.find((tab) => tab.file.path === changedFile.path);

      if (
        !currentTab ||
        currentTab.isUntitled ||
        isUntitledFilePath(currentTab.file.path) ||
        currentTab.status === 'unsaved' ||
        currentTab.draftContent !== currentTab.savedContent ||
        currentTab.draftContent === changedFile.content
      ) {
        return current;
      }

      const nextTabs = current.map((tab) =>
        tab.file.path === changedFile.path
          ? {
              ...tab,
              file: changedFile,
              draftContent: changedFile.content,
              ...provenance,
              savedContent: changedFile.content,
              status: 'saved' as SaveStatus
            }
          : tab
      );

      activeTabRef.current = nextTabs.find((tab) => tab.file.path === activeTabPathRef.current) ?? activeTabRef.current;
      return nextTabs;
    });

    if (activeTabPathRef.current === changedFile.path) {
      documentContentRef.current = changedFile.content;
      setDocumentContent(changedFile.content);
      setSaveStatus('saved');
      restoreEditorScrollPosition(changedFile.path, scrollTop);
    }

    showToast({
      type: 'success',
      title: 'File Updated',
      description: `${changedFile.name} was reloaded from disk.`
    });
  };

  workspaceChangedHandlerRef.current = (snapshot) => {
    void refreshWorkspaceAfterOperation(snapshot);
  };

  watchedMarkdownFileChangeHandlerRef.current = (change) => {
    void applyWatchedMarkdownFileChange(change);
  };

  useEffect(() => {
    const unsubscribe = window.veloca?.workspace.onChanged((snapshot) => {
      workspaceChangedHandlerRef.current(snapshot);
    });

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const unsubscribe = window.veloca?.workspace.onMarkdownFileChanged((change) => {
      watchedMarkdownFileChangeHandlerRef.current(change);
    });

    return () => {
      unsubscribe?.();
      void window.veloca?.workspace.watchMarkdownFiles([]);
    };
  }, []);

  const syncOpenTabsWithSnapshot = (
    snapshot: WorkspaceSnapshot,
    renamedFromPath?: string,
    renamedToPath?: string
  ): OpenEditorTab[] => {
    const files: WorkspaceTreeNode[] = [];

    const collectFiles = (nodes: WorkspaceTreeNode[]) => {
      for (const node of nodes) {
        if (node.type === 'file') {
          files.push(node);
        }

        if (node.children?.length) {
          collectFiles(node.children);
        }
      }
    };

    collectFiles(snapshot.tree);

    const nodesByPath = new Map(files.map((file) => [file.path, file]));
    const renamedTarget = renamedFromPath && renamedToPath ? nodesByPath.get(renamedToPath) : undefined;

    return openTabs
      .map((tab) => {
        if (tab.isUntitled || isUntitledFilePath(tab.file.path)) {
          return tab;
        }

        if (tab.file.path === renamedFromPath && renamedTarget) {
          return {
            ...tab,
            file: {
              ...tab.file,
              path: renamedToPath,
              name: renamedTarget.name,
              relativePath: renamedTarget.relativePath,
              workspaceFolderId: renamedTarget.workspaceFolderId
            }
          };
        }

        const liveNode = nodesByPath.get(tab.file.path);

        if (!liveNode) {
          return null;
        }

        if (
          liveNode.name === tab.file.name &&
          liveNode.relativePath === tab.file.relativePath &&
          liveNode.workspaceFolderId === tab.file.workspaceFolderId
        ) {
          return tab;
        }

        return {
          ...tab,
          file: {
            ...tab.file,
            name: liveNode.name,
            relativePath: liveNode.relativePath,
            workspaceFolderId: liveNode.workspaceFolderId
          }
        };
      })
      .filter(Boolean) as OpenEditorTab[];
  };

  const setFolderOpen = (folderId: string) => {
    setOpenFolders((current) => ({
      ...current,
      [folderId]: true
    }));
  };

  const scrollTabIntoView = (filePath: string) => {
    requestAnimationFrame(() => {
      const tabElement = editorTabElementByPathRef.current.get(filePath);

      if (!tabElement) {
        return;
      }

      tabElement.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth'
      });
    });
  };

  const readMarkdownFile = async (filePath: string) => {
    if (!window.veloca) {
      return false;
    }

    const existingTab = openTabs.find((tab) => tab.file.path === filePath);

    if (existingTab) {
      ensureTabGroup([filePath]);
      activateEditorTab(existingTab, [filePath]);
      return true;
    }

    setLoadingFile(true);

    try {
      const file = await window.veloca.workspace.readMarkdown(filePath);
      const provenance = await loadDocumentProvenance(file);
      const nextTab: OpenEditorTab = {
        file,
        draftContent: file.content,
        ...provenance,
        savedContent: file.content,
        status: 'saved'
      };

      openTabPathsRef.current = new Set([...openTabPathsRef.current, filePath]);
      setOpenTabs((current) => [...current, nextTab]);
      ensureTabGroup([filePath]);
      activateEditorTab(nextTab, [filePath]);
      return true;
    } catch {
      showToast({
        type: 'info',
        title: 'File Not Loaded',
        description: 'Only markdown files inside the current workspace can be opened.'
      });
      return false;
    } finally {
      setLoadingFile(false);
    }
  };

  const closeTab = async (filePath: string) => {
    const targetTab = openTabs.find((tab) => tab.file.path === filePath);

    if (!targetTab) {
      return;
    }

    if (targetTab.status === 'unsaved' || targetTab.isUntitled || isUntitledFilePath(targetTab.file.path)) {
      const shouldDiscard = window.confirm(
        `Discard unsaved changes to "${targetTab.file.name}" before closing?`
      );

      if (!shouldDiscard) {
        return;
      }
    }

    const currentTabs = openTabs;
    const remainingTabs = currentTabs.filter((tab) => tab.file.path !== filePath);

    openTabPathsRef.current = new Set(remainingTabs.map((tab) => tab.file.path));
    clearFileSaveAction(filePath);
    setOpenTabs(remainingTabs);
    setTabGroups((current) =>
      current
        .map((group) => normalizeTabGroup(group.filter((path) => path !== filePath)))
        .filter((group) => group.length > 0)
    );

    if (splitPanePaths?.includes(filePath)) {
      clearSplitView();
    }

    if (activeTabPath !== filePath) {
      return;
    }

    if (!remainingTabs.length) {
      activeTabRef.current = null;
      documentContentRef.current = '';
      setActiveTabPath(null);
      setDocumentContent('');
      setSaveStatus('saved');
      return;
    }

    const targetIndex = currentTabs.findIndex((tab) => tab.file.path === filePath);
    const fallbackTab = remainingTabs[targetIndex] ?? remainingTabs[targetIndex - 1] ?? remainingTabs[0];

    activeTabRef.current = fallbackTab;
    documentContentRef.current = fallbackTab.draftContent;
    setActiveTabPath(fallbackTab.file.path);
    setDocumentContent(fallbackTab.draftContent);
    setSaveStatus(fallbackTab.status);
  };

  const closeActiveTab = async () => {
    if (!activeTabPath) {
      return;
    }

    await closeTab(activeTabPath);
  };

  const closeAllTabs = async () => {
    if (!openTabs.length) {
      return;
    }

    const hasUnsavedChanges = openTabs.some(
      (tab) => tab.status === 'unsaved' || tab.isUntitled || isUntitledFilePath(tab.file.path)
    );

    if (hasUnsavedChanges && !window.confirm('Close all tabs and discard all unsaved changes?')) {
      return;
    }

    openTabPathsRef.current = new Set<string>();
    activeTabRef.current = null;
    documentContentRef.current = '';
    setOpenTabs([]);
    setTabGroups([]);
    setActiveGroupKey(null);
    setActiveTabPath(null);
    setDocumentContent('');
    setSaveStatus('saved');
    clearAllFileSaveActions();
    clearSplitView();
    setDraggingTabIndex(null);
    setDraggingGroupIndex(null);
    setTabDropCue(null);
  };

  const createNewMarkdownFile = () => {
    if (!saveLocationOptions.length) {
      showToast({
        type: 'info',
        title: 'No workspace',
        description: 'Open or create a workspace before creating new files.'
      });
      return;
    }

    const filePath = `${untitledFilePathPrefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const nextTab: OpenEditorTab = {
      file: {
        path: filePath,
        name: 'Untitled.md',
        content: '',
        relativePath: 'Unsaved',
        workspaceFolderId: ''
      },
      draftContent: '',
      isUntitled: true,
      savedContent: '',
      status: 'unsaved'
    };

    openTabPathsRef.current = new Set([...openTabPathsRef.current, filePath]);
    setOpenTabs((current) => [...current, nextTab]);
    ensureTabGroup([filePath]);
    activateEditorTab(nextTab, [filePath]);
  };

  const saveAllOpenTabs = async () => {
    if (!window.veloca || !openTabs.length) {
      return;
    }

    const untitledTabs = openTabs.filter(
      (tab) => tab.status === 'unsaved' && (tab.isUntitled || isUntitledFilePath(tab.file.path))
    );
    const unsavedTabs = openTabs.filter(
      (tab) => tab.status === 'unsaved' && !tab.isUntitled && !isUntitledFilePath(tab.file.path)
    );

    if (!unsavedTabs.length) {
      if (untitledTabs.length) {
        showToast({
          type: 'info',
          title: 'Save Location Required',
          description: 'Untitled files need to be saved individually first.'
        });
      }
      return;
    }

    setOpenTabs((current) =>
      current.map((tab) =>
        tab.status === 'unsaved' && !tab.isUntitled && !isUntitledFilePath(tab.file.path)
          ? { ...tab, status: 'saving' }
          : tab
      )
    );

    const nextTabs = [...openTabs];

    for (const tab of unsavedTabs) {
      try {
        const savedFile = await window.veloca.workspace.saveMarkdown(tab.file.path, tab.draftContent);
        const provenance = await persistDocumentProvenance(savedFile, tab.draftContent, tab);
        const targetIndex = nextTabs.findIndex((item) => item.file.path === tab.file.path);

        if (targetIndex >= 0) {
          nextTabs[targetIndex] = {
            ...nextTabs[targetIndex],
            file: { ...nextTabs[targetIndex].file, ...savedFile },
            ...provenance,
            savedContent: tab.draftContent,
            status: 'saved'
          };
        }
      } catch {
        const targetIndex = nextTabs.findIndex((item) => item.file.path === tab.file.path);

        if (targetIndex >= 0) {
          nextTabs[targetIndex] = { ...nextTabs[targetIndex], status: 'failed' };
        }
      }
    }

    setOpenTabs(nextTabs);

    if (activeTabPath) {
      const activeTabAfter = nextTabs.find((tab) => tab.file.path === activeTabPath);

      if (activeTabAfter) {
        setSaveStatus(activeTabAfter.status);
      } else {
        setSaveStatus('saved');
      }
    } else {
      setSaveStatus('saved');
    }

    void refreshVersionManagerStatus();
  };

  const enableSplitView = (
    leftTab: OpenEditorTab,
    rightTab: OpenEditorTab,
    dividerIndex: number,
    activePath = rightTab.file.path
  ) => {
    if (leftTab.file.path === rightTab.file.path) {
      return;
    }

    ensureTabGroup([leftTab.file.path, rightTab.file.path]);
    setIsSplitViewEnabled(true);
    setSplitPanePaths([leftTab.file.path, rightTab.file.path]);
    setSplitAfterIndex(Math.max(1, Math.min(dividerIndex, openTabs.length - 1)));
    setSplitPaneRatio(50);
    activateEditorTab(activePath === leftTab.file.path ? leftTab : rightTab, [leftTab.file.path, rightTab.file.path]);
  };

  const setSplitEditorMode = () => {
    if (isSplitViewEnabled) {
      clearSplitView();
      setIsHeaderMenuOpen(false);
      return;
    }

    const activeIndex = openTabs.findIndex((tab) => tab.file.path === activeTabPath);

    if (activeIndex < 0 || openTabs.length < 2) {
      setIsHeaderMenuOpen(false);
      return;
    }

    const neighborIndex = openTabs[activeIndex + 1] ? activeIndex + 1 : activeIndex - 1;
    const neighborTab = openTabs[neighborIndex];
    const activeTabItem = openTabs[activeIndex];

    if (activeTabItem && neighborTab) {
      enableSplitView(
        activeTabItem,
        neighborTab,
        Math.min(activeIndex + 1, openTabs.length - 1),
        activeTabItem.file.path
      );
    }

    setIsHeaderMenuOpen(false);
  };

  const handleSaveCurrentDocument = async () => {
    if (!activeFile || activeSaveActionState === 'saving') {
      return;
    }

    await saveCurrentDocument();
  };

  const reorderTabGroups = (sourceIndex: number, targetIndex: number) => {
    if (sourceIndex === targetIndex) {
      return;
    }

    const boundedTarget = Math.max(0, Math.min(targetIndex, visibleTabGroups.length));
    const nextGroups = [...visibleTabGroups];
    const movedGroup = nextGroups.splice(sourceIndex, 1)[0];

    if (!movedGroup) {
      return;
    }

    const insertionIndex = sourceIndex < boundedTarget ? boundedTarget - 1 : boundedTarget;
    nextGroups.splice(insertionIndex, 0, movedGroup);
    setTabGroups(nextGroups);
  };

  const canMergeTabGroups = (sourceGroupIndex: number | null, targetGroupIndex: number) => {
    if (sourceGroupIndex === null || sourceGroupIndex === targetGroupIndex) {
      return false;
    }

    const sourceGroup = visibleTabGroups[sourceGroupIndex];
    const targetGroup = visibleTabGroups[targetGroupIndex];

    if (!sourceGroup || !targetGroup) {
      return false;
    }

    return new Set([...targetGroup, ...sourceGroup]).size === 2;
  };

  const getTabDragIntent = (event: DragEvent<HTMLDivElement>): TabDropIntent => {
    const rect = event.currentTarget.getBoundingClientRect();
    const percentage = (event.clientX - rect.left) / rect.width;

    if (percentage < 0.25) {
      return 'insert-left';
    }

    if (percentage > 0.75) {
      return 'insert-right';
    }

    return 'merge';
  };

  const getTabInsertIntent = (
    event: DragEvent<HTMLDivElement>
  ): Extract<TabDropIntent, 'insert-left' | 'insert-right'> => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;

    return relativeX < rect.width / 2 ? 'insert-left' : 'insert-right';
  };

  const resolveTabDropIntent = (event: DragEvent<HTMLDivElement>, targetGroupIndex: number): TabDropIntent => {
    const intent = getTabDragIntent(event);

    if (intent === 'merge' && !canMergeTabGroups(draggingGroupIndex, targetGroupIndex)) {
      return getTabInsertIntent(event);
    }

    return intent;
  };

  const mergeTabGroupsByIndex = (sourceGroupIndex: number, targetGroupIndex: number) => {
    if (sourceGroupIndex === targetGroupIndex) {
      return;
    }

    const sourceGroup = visibleTabGroups[sourceGroupIndex];
    const targetGroup = visibleTabGroups[targetGroupIndex];

    if (!sourceGroup || !targetGroup) {
      return;
    }

    const nextGroup = normalizeTabGroup([...targetGroup, ...sourceGroup]);
    const nextGroupKey = getTabGroupKey(nextGroup);
    const sourceTab = draggingTabIndex !== null ? openTabs[draggingTabIndex] : null;
    const tabToActivate =
      sourceTab && nextGroup.includes(sourceTab.file.path)
        ? sourceTab
        : openTabByPath.get(nextGroup[0]) ?? null;

    if (nextGroup.length < 2) {
      return;
    }

    const existingGroup = visibleTabGroups.find((group) => getTabGroupKey(group) === nextGroupKey);

    if (existingGroup) {
      if (tabToActivate) {
        activateEditorTab(tabToActivate, existingGroup);
      }

      return;
    }

    setTabGroups((current) => {
      const nextGroups: EditorTabGroup[] = [];

      current.forEach((group, groupIndex) => {
        if (groupIndex === targetGroupIndex) {
          nextGroups.push(nextGroup);
          return;
        }

        if (groupIndex === sourceGroupIndex || getTabGroupKey(group) === nextGroupKey) {
          return;
        }

        nextGroups.push(group);
      });

      return nextGroups;
    });

    setIsSplitViewEnabled(true);
    setSplitPanePaths([nextGroup[0], nextGroup[1]]);
    setSplitPaneRatio(50);
    if (tabToActivate) {
      activateEditorTab(tabToActivate, nextGroup);
    }
  };

  const startSplitPaneResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const gridElement = splitEditorGridRef.current;

    if (!gridElement) {
      return;
    }

    const resizeFromPointer = (clientX: number) => {
      const rect = gridElement.getBoundingClientRect();
      const nextRatio = ((clientX - rect.left) / rect.width) * 100;
      setSplitPaneRatio(Math.min(78, Math.max(22, nextRatio)));
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      resizeFromPointer(pointerEvent.clientX);
    };

    const stopResize = () => {
      document.body.classList.remove('is-resizing-split-pane');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };

    resizeFromPointer(event.clientX);
    document.body.classList.add('is-resizing-split-pane');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  };

  const onTabDragStart = (event: DragEvent<HTMLDivElement>, index: number, groupIndex: number) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    setDraggingTabIndex(index);
    setDraggingGroupIndex(groupIndex);
    setTabDropCue(null);
  };

  const onTabDragOver = (event: DragEvent<HTMLDivElement>, groupIndex: number) => {
    if (draggingGroupIndex === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (draggingGroupIndex === groupIndex) {
      setTabDropCue(null);
      return;
    }

    const intent = resolveTabDropIntent(event, groupIndex);
    event.dataTransfer.dropEffect = 'move';
    setTabDropCue({ groupIndex, intent });
  };

  const onTabDragLeave = (event: DragEvent<HTMLDivElement>, groupIndex: number) => {
    const relatedTarget = event.relatedTarget;

    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    setTabDropCue((current) => (current?.groupIndex === groupIndex ? null : current));
  };

  const onTabDrop = (event: DragEvent<HTMLDivElement>, groupIndex: number) => {
    event.preventDefault();
    event.stopPropagation();

    if (draggingGroupIndex === null) {
      return;
    }

    const intent =
      tabDropCue?.groupIndex === groupIndex ? tabDropCue.intent : resolveTabDropIntent(event, groupIndex);

    if (intent === 'merge') {
      mergeTabGroupsByIndex(draggingGroupIndex, groupIndex);
    } else {
      reorderTabGroups(draggingGroupIndex, intent === 'insert-right' ? groupIndex + 1 : groupIndex);
    }

    setDraggingTabIndex(null);
    setDraggingGroupIndex(null);
    setTabDropCue(null);
  };

  const onTabDragEnd = () => {
    setDraggingTabIndex(null);
    setDraggingGroupIndex(null);
    setTabDropCue(null);
  };

  const onTabsDropToEnd = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (draggingTabIndex === null || draggingGroupIndex === null) {
      return;
    }

    reorderTabGroups(draggingGroupIndex, visibleTabGroups.length);
    setDraggingTabIndex(null);
    setDraggingGroupIndex(null);
    setTabDropCue(null);
  };

  const onTabsDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (draggingGroupIndex === null) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setTabDropCue({ groupIndex: visibleTabGroups.length, intent: 'insert-right' });
  };

  const openWorkspaceRoots = (tree: WorkspaceTreeNode[]) => {
    setOpenFolders((current) => {
      const next = { ...current };

      for (const folder of tree) {
        next[folder.id] = true;
      }

      return next;
    });
  };

  const toggleFolder = (folderId: string) => {
    setOpenFolders((current) => ({
      ...current,
      [folderId]: !current[folderId]
    }));
  };

  const selectHeading = (headingId: string) => {
    setActiveHeadingId(headingId);
    const headingIndex = sections.findIndex((section) => section.id === headingId);

    window.requestAnimationFrame(() => {
      const activeEditorRoot = activeFile?.path
        ? Array.from(document.querySelectorAll<HTMLElement>('.veloca-editor')).find(
            (element) => element.dataset.filePath === activeFile.path
          )
        : null;
      const headingRoot = activeEditorRoot ?? document;
      const editorHeadings = headingRoot.querySelectorAll<HTMLElement>(
        '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6'
      );
      const targetHeading = headingIndex >= 0 ? editorHeadings[headingIndex] : null;

      targetHeading?.scrollIntoView({
        block: 'start',
        behavior: 'smooth'
      });
    });
  };

  const openContextMenu = (event: MouseEvent, node: WorkspaceTreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      node
    });
  };

  const createEntry = async (node: WorkspaceTreeNode, entryType: 'file' | 'folder') => {
    if (!window.veloca) {
      return;
    }

    const defaultName = entryType === 'file' ? 'Untitled.md' : 'New Folder';
    setFolderOpen(node.id);

    try {
      const result = await window.veloca.workspace.createEntry(node.path, entryType, defaultName);
      await refreshWorkspaceAfterOperation(result.snapshot, result.path);

      if (result.path) {
        const createdNode = findNodeByPath(result.snapshot.tree, result.path);
        setEditingNode({
          originalName: createdNode?.name ?? defaultName,
          path: result.path,
          value: createdNode?.name ?? defaultName
        });
      }
    } catch {
      showToast({
        type: 'info',
        title: 'Create Failed',
        description: `Unable to create that ${entryType}.`
      });
    }
  };

  const renameEntry = async (node: WorkspaceTreeNode) => {
    setEditingNode({
      originalName: node.name,
      path: node.path,
      value: node.name
    });
  };

  const submitNameDialog = async () => {
    if (!nameDialog || !window.veloca) {
      return;
    }

    const name = nameDialogValue.trim();

    if (!name) {
      return;
    }

    if (nameDialog.mode === 'database-workspace') {
      await submitDatabaseWorkspace();
    }
  };

  const closeNameDialog = () => {
    setNameDialog(null);
    setNameDialogValue('');
  };

  const updateEditingNodeName = (value: string) => {
    setEditingNode((current) => (current ? { ...current, value } : current));
  };

  const cancelInlineRename = () => {
    setEditingNode(null);
  };

  const commitInlineRename = async () => {
    if (!editingNode || !window.veloca) {
      return;
    }

    const nextName = editingNode.value.trim();
    const currentEditingNode = editingNode;
    setEditingNode(null);

    if (!nextName || nextName === currentEditingNode.originalName) {
      return;
    }

    try {
      const result = await window.veloca.workspace.renameEntry(currentEditingNode.path, nextName);
      await refreshWorkspaceAfterOperation(result.snapshot, result.path, currentEditingNode.path);
    } catch {
      showToast({
        type: 'info',
        title: 'Rename Failed',
        description: 'A file or folder with that name may already exist.'
      });
    }
  };

  const duplicateEntry = async (node: WorkspaceTreeNode) => {
    if (!window.veloca) {
      return;
    }

    try {
      const result = await window.veloca.workspace.duplicateEntry(node.path);
      await refreshWorkspaceAfterOperation(result.snapshot, result.path);
    } catch {
      showToast({
        type: 'info',
        title: 'Duplicate Failed',
        description: 'Unable to duplicate that item.'
      });
    }
  };

  const pasteEntry = async (targetFolder: WorkspaceTreeNode) => {
    if (!window.veloca || !fileClipboard || targetFolder.type !== 'folder') {
      return;
    }

    try {
      const result = await window.veloca.workspace.pasteEntry(
        fileClipboard.path,
        targetFolder.path,
        fileClipboard.mode
      );
      await refreshWorkspaceAfterOperation(result.snapshot, result.path);

      if (fileClipboard.mode === 'cut') {
        setFileClipboard(null);
      }
    } catch {
      showToast({
        type: 'info',
        title: 'Paste Failed',
        description: 'Unable to paste the selected item here.'
      });
    }
  };

  const deleteEntry = async (node: WorkspaceTreeNode) => {
    if (!window.veloca || !window.confirm(`Move "${node.name}" to Trash?`)) {
      return;
    }

    try {
      const snapshot = await window.veloca.workspace.deleteEntry(node.path);
      await refreshWorkspaceAfterOperation(snapshot);
    } catch {
      showToast({
        type: 'info',
        title: 'Delete Failed',
        description: 'Unable to move that item to Trash.'
      });
    }
  };

  const removeWorkspaceFolder = async (node: WorkspaceTreeNode) => {
    if (!window.veloca) {
      return;
    }

    try {
      const snapshot = await window.veloca.workspace.removeFolder(node.workspaceFolderId);
      await refreshWorkspaceAfterOperation(snapshot);
    } catch {
      showToast({
        type: 'info',
        title: 'Workspace Not Removed',
        description: 'Unable to remove that folder from the workspace.'
      });
    }
  };

  const revealEntry = async (node: WorkspaceTreeNode) => {
    await window.veloca?.workspace.reveal(node.path);
  };

  const openEntry = async (node: WorkspaceTreeNode) => {
    await window.veloca?.workspace.openPath(node.path);
  };

  const copyEntryPath = async (node: WorkspaceTreeNode) => {
    await window.veloca?.workspace.copyPath(node.path);
    showToast({
      type: 'success',
      title: 'Path Copied',
      description: node.path
    });
  };

  const showToast = (message: Omit<ToastMessage, 'id'>) => {
    const id = Date.now();
    setToasts((current) => [...current, { ...message, id }]);
    window.setTimeout(() => dismissToast(id), 3200);
  };

  const dismissToast = (id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const openExternalLink = async (url: string) => {
    if (!url) {
      return;
    }

    try {
      await window.veloca?.app.openExternal(url);
    } catch (error) {
      showToast({
        type: 'info',
        title: 'Unable to Open Link',
        description: error instanceof Error ? error.message : 'Veloca could not open the external link.'
      });
    }
  };

  const checkForAppUpdates = async (source: 'automatic' | 'manual') => {
    if (!window.veloca?.app.checkForUpdates) {
      return;
    }

    setUpdateChecking(true);

    try {
      const result = await window.veloca.app.checkForUpdates();
      setUpdateStatus(result);

      if (result.status === 'available' || result.status === 'downloading') {
        showToast({
          type: 'info',
          title: t('toast.update.downloadStartedTitle'),
          description: t('toast.update.downloadStartedDescription', { version: result.latestVersion ?? 'update' })
        });
      } else if (result.status === 'downloaded') {
        showToast({
          type: 'success',
          title: t('toast.update.readyTitle'),
          description: t('toast.update.readyDescription')
        });
      } else if (source === 'manual' && result.status === 'current') {
        showToast({
          type: 'success',
          title: t('toast.update.currentTitle'),
          description: t('toast.update.currentDescription', { version: result.currentVersion })
        });
      } else if (source === 'manual') {
        showToast({
          type: 'info',
          title: t('toast.update.checkFailedTitle'),
          description: result.errorMessage ?? t('toast.update.checkFailedDescription')
        });
      }
    } finally {
      setUpdateChecking(false);
    }
  };

  const installDownloadedUpdate = async () => {
    if (!window.veloca?.app.installUpdate) {
      return;
    }

    setUpdateInstalling(true);

    try {
      await window.veloca.app.installUpdate();
    } catch (error) {
      setUpdateInstalling(false);
      showToast({
        type: 'info',
        title: 'Update Install Failed',
        description: error instanceof Error ? error.message : 'Veloca could not restart into the downloaded update.'
      });
    }
  };

  const openLicenseDialog = async () => {
    setLicenseDialogOpen(true);

    if (openSourceComponents.length > 0 || openSourceLoading) {
      return;
    }

    setOpenSourceLoading(true);

    try {
      const components = await window.veloca?.app.listOpenSourceComponents();
      setOpenSourceComponents(components ?? []);
    } catch (error) {
      showToast({
        type: 'info',
        title: t('toast.licenses.loadFailedTitle'),
        description: error instanceof Error ? error.message : t('toast.licenses.loadFailedDescription')
      });
    } finally {
      setOpenSourceLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadAppInfo = async () => {
      try {
        const info = await window.veloca?.app.getInfo();

        if (!cancelled && info) {
          setAppInfo(info);
        }
      } catch {
        // The static fallback keeps About Veloca usable if the backend is unavailable.
      }
    };

    void loadAppInfo();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return window.veloca?.app.onUpdateStatus?.((status) => {
      setUpdateStatus(status);
      setUpdateChecking(status.status === 'checking');

      const readyToastKey = `${status.latestVersion ?? 'unknown'}-${status.status}`;
      if (status.status === 'downloaded' && updateReadyToastKeyRef.current !== readyToastKey) {
        updateReadyToastKeyRef.current = readyToastKey;
        showToast({
          type: 'success',
          title: t('toast.update.readyTitle'),
          description: t('toast.update.readyDescription')
        });
      }
    });
  }, []);

  useEffect(() => {
    void checkForAppUpdates('automatic');
  }, []);

  useEffect(() => {
    if (!autoSave || saveStatus !== 'unsaved' || !activeTabPath || activeSaveActionState === 'saving') {
      return undefined;
    }

    clearSaveTimer();
    saveTimerRef.current = setTimeout(() => {
      void saveCurrentDocument({ promptForLocation: false });
    }, 800);

    return clearSaveTimer;
  }, [activeSaveActionState, activeTabPath, autoSave, documentContent, saveStatus]);

  useEffect(() => {
    const saveOnShortcut = (event: KeyboardEvent) => {
      if (isAppInputShortcutTarget(event.target)) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveCurrentDocument();
      }
    };

    window.addEventListener('keydown', saveOnShortcut);
    return () => window.removeEventListener('keydown', saveOnShortcut);
  }, []);

  const renderSplitEditorPane = (tab: OpenEditorTab, panePosition: 'left' | 'right') => {
    const isActivePane = tab.file.path === activeTabPath;
    const paneContent = isActivePane ? documentContent : tab.draftContent;
    const viewMode = getDocumentViewMode(tab.file.path);
    const restoreProps = getCursorRestoreProps(tab.file.path, viewMode);

    return (
      <section
        className={`split-editor-pane ${panePosition}${isActivePane ? ' active' : ''}`}
        key={tab.file.path}
        onMouseDown={() => {
          if (!isActivePane) {
            activateEditorTab(tab, splitPanePaths ?? [tab.file.path]);
          }
        }}
      >
        <div className="split-editor-pane-header">
          <span className="split-editor-pane-title">
            <FileText size={13} />
            <span>{tab.file.name}</span>
          </span>
          <span className={tab.status === 'unsaved' ? 'split-editor-pane-dirty is-dirty' : 'split-editor-pane-dirty'} />
        </div>
        <div className="editor-pane-scroll">
          <article className={focusMode ? 'markdown-body split-pane-body focus-mode' : 'markdown-body split-pane-body'}>
            {viewMode === 'source' ? (
              <SourceMarkdownEditor
                content={paneContent}
                filePath={tab.file.path}
                ref={(handle) => {
                  if (handle) {
                    sourceEditorHandlesRef.current.set(tab.file.path, handle);
                    return;
                  }

                  sourceEditorHandlesRef.current.delete(tab.file.path);
                }}
                onChange={(content) => updateTabSourceDocumentContent(tab.file.path, content)}
                {...restoreProps}
              />
            ) : (
              <MarkdownEditor
                content={paneContent}
                filePath={tab.file.path}
                provenanceMarkdownHash={tab.provenanceMarkdownHash}
                provenanceSnapshotJson={tab.provenanceSnapshotJson}
                ref={(handle) => {
                  if (handle) {
                    renderedEditorHandlesRef.current.set(tab.file.path, handle);
                    return;
                  }

                  renderedEditorHandlesRef.current.delete(tab.file.path);
                }}
                theme={theme}
                onChange={(content) => updateTabDocumentContent(tab.file.path, content)}
                onToast={showToast}
                {...restoreProps}
              />
            )}
          </article>
        </div>
      </section>
    );
  };

  return (
    <div className="app-shell">
      <header
        className={usesCustomWindowControls ? 'titlebar custom-titlebar' : 'titlebar'}
        aria-label={t('app.window.titlebar')}
      >
        {usesCustomWindowControls && (
          <>
            <div className="titlebar-content">
              <span className="titlebar-brand">Veloca</span>
              {activeFile && (
                <>
                  <span className="titlebar-divider" aria-hidden="true" />
                  <span className="titlebar-document">{activeFile.name}</span>
                </>
              )}
            </div>
            <div className="window-controls" aria-label={t('app.window.controls')}>
              <button
                className="window-control-btn"
                type="button"
                aria-label={t('app.window.minimizeWindow')}
                title={t('app.window.minimize')}
                onClick={() => void window.veloca?.windowControls?.minimize()}
              >
                <Minus size={15} />
              </button>
              <button
                className="window-control-btn"
                type="button"
                aria-label={isWindowMaximized ? t('app.window.restoreWindow') : t('app.window.maximizeWindow')}
                title={isWindowMaximized ? t('app.window.restore') : t('app.window.maximize')}
                onClick={() => {
                  const toggleResult = window.veloca?.windowControls?.toggleMaximize();
                  void toggleResult?.then(setIsWindowMaximized);
                }}
              >
                {isWindowMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button
                className="window-control-btn close"
                type="button"
                aria-label={t('app.window.closeWindow')}
                title={t('app.window.close')}
                onClick={() => void window.veloca?.windowControls?.close()}
              >
                <X size={15} />
              </button>
            </div>
          </>
        )}
      </header>

      <div className="app-layout">
        <aside
          className={sidebarClassName}
          style={isSidebarCollapsed ? undefined : { minWidth: sidebarWidth, width: sidebarWidth }}
          aria-hidden={isSidebarCollapsed}
        >
          <div className="sidebar-header">
            <div className="sidebar-header-controls">
              <span className="sidebar-header-spacer" aria-hidden="true" />
              <div className="tabs-list sidebar-tabs-list">
                <button
                  className={visibleSidebarTab === 'files' ? 'tab-trigger active' : 'tab-trigger'}
                  type="button"
                  title={t('app.sidebar.files')}
                  onClick={() => setSidebarTab('files')}
                >
                  <FileText size={14} />
                  <span className="tab-trigger-label">{t('app.sidebar.files')}</span>
                </button>
                <button
                  className={visibleSidebarTab === 'outline' ? 'tab-trigger active' : 'tab-trigger'}
                  type="button"
                  title={t('app.sidebar.outline')}
                  onClick={() => setSidebarTab('outline')}
                >
                  <ListTree size={14} />
                  <span className="tab-trigger-label">{t('app.sidebar.outline')}</span>
                </button>
                {versionManagerSidebarTabVisible && (
                  <button
                    className={visibleSidebarTab === 'git' ? 'tab-trigger active' : 'tab-trigger'}
                    type="button"
                    title={t('app.sidebar.git')}
                    onClick={() => setSidebarTab('git')}
                  >
                    <GitBranch size={14} />
                    <span className="tab-trigger-label">Git</span>
                    {versionStatus.pendingChangeCount > 0 && <span className="tab-status-dot" aria-hidden="true" />}
                  </button>
                )}
              </div>
              <button
                className="sidebar-toggle-btn"
                type="button"
                aria-label={t('app.sidebar.collapse')}
                onClick={() => setIsSidebarCollapsed(true)}
              >
                <PanelLeftClose size={15} />
              </button>
            </div>
          </div>

          <div className="sidebar-content">
            {visibleSidebarTab === 'files' ? (
              <FileTree
                activeFilePath={activeFile?.path ?? ''}
                editingNode={editingNode}
                loading={loadingWorkspace}
                openFolders={openFolders}
                tree={workspace.tree}
                onAddFolder={addWorkspaceFolder}
                onCancelInlineRename={cancelInlineRename}
                onCommitInlineRename={commitInlineRename}
                onCreateDatabaseWorkspace={createDatabaseWorkspace}
                onContextMenu={openContextMenu}
                onEditingNodeChange={updateEditingNodeName}
                onFileSelect={readMarkdownFile}
                onFolderToggle={toggleFolder}
              />
            ) : visibleSidebarTab === 'outline' ? (
              <OutlinePanel
                activeFile={activeFile}
                activeHeadingId={activeHeadingId}
                sections={sections}
                onHeadingSelect={selectHeading}
              />
            ) : (
              <GitVersionPanel
                commitMessage={versionCommitMessage}
                loading={versionLoading}
                status={versionStatus}
                onCommitAndPush={commitAndPushVersionChanges}
                onCommitMessageChange={setVersionCommitMessage}
                onEnsureRepository={ensureVersionRepository}
                onOpenAccountSettings={openAccountSettings}
                onRefresh={() => void refreshVersionManagerStatus()}
              />
            )}
          </div>

          <div className="sidebar-footer">
            <button className="nav-btn" type="button" onClick={() => setSettingsOpen(true)}>
              <Settings size={16} />
              <span>{t('app.settings')}</span>
            </button>
          </div>
          <div
            className="sidebar-resize-handle"
            role="separator"
            tabIndex={0}
            aria-label={t('app.sidebar.resize')}
            aria-orientation="vertical"
            aria-valuemax={sidebarMaximumWidth}
            aria-valuemin={sidebarMinimumWidth}
            aria-valuenow={sidebarWidth}
            onDoubleClick={() => setSidebarWidth(sidebarDefaultWidth)}
            onKeyDown={resizeSidebarWithKeyboard}
            onPointerDown={startSidebarResize}
          />
        </aside>

        {isSidebarCollapsed && (
          <div className="sidebar-restore-rail" aria-label={t('app.sidebar.collapsed')}>
            <div className="tabs-list sidebar-restore-tabs">
              <button
                className="tab-trigger sidebar-toggle-trigger active"
                type="button"
                aria-label="Expand sidebar"
                onClick={() => setIsSidebarCollapsed(false)}
              >
                <PanelLeftOpen size={15} />
              </button>
            </div>
          </div>
        )}

        <main className="editor-container">
          <header className="editor-header">
            <div
              className="editor-tabs"
              onDragOver={onTabsDragOver}
              onDrop={onTabsDropToEnd}
              onWheel={(event) => {
                if (event.deltaY === 0) {
                  return;
                }

                const scrollTarget = editorTabsRef.current;

                if (!scrollTarget) {
                  return;
                }

                scrollTarget.scrollLeft += event.deltaY;
                event.preventDefault();
              }}
              ref={editorTabsRef}
            >
              {visibleTabGroups.length > 0 &&
                visibleTabGroups.map((groupPaths, groupIndex) => {
                  const groupTabs = groupPaths
                    .map((path) => openTabByPath.get(path))
                    .filter(Boolean) as OpenEditorTab[];
                  const groupKey = getTabGroupKey(groupPaths);
                  const groupHasActive = activeGroupKey === groupKey;
                  const groupDropIntent =
                    draggingGroupIndex !== groupIndex && tabDropCue?.groupIndex === groupIndex
                      ? tabDropCue.intent
                      : null;

                  if (!groupTabs.length) {
                    return null;
                  }

                  if (groupTabs.length > 1) {
                    const splitTabIndexes = groupTabs.map((splitTab) =>
                      openTabs.findIndex((item) => item.file.path === splitTab.file.path)
                    );
                    const isDraggingSplitGroup = draggingGroupIndex === groupIndex;

                    return (
                      <div className="editor-tab-wrapper editor-split-tab-wrapper" key={groupKey}>
                        <div
                          className={[
                            'editor-split-tab-group',
                            groupHasActive ? 'has-active' : '',
                            isDraggingSplitGroup ? 'is-dragging' : '',
                            groupDropIntent === 'merge' ? 'drag-merge' : '',
                            groupDropIntent === 'insert-left' ? 'drag-insert-left' : '',
                            groupDropIntent === 'insert-right' ? 'drag-insert-right' : ''
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onDragLeave={(event) => onTabDragLeave(event, groupIndex)}
                          onDragOver={(event) => onTabDragOver(event, groupIndex)}
                          onDrop={(event) => onTabDrop(event, groupIndex)}
                          ref={(element) => {
                            for (const splitTab of groupTabs) {
                              if (!element) {
                                editorTabElementByPathRef.current.delete(splitTab.file.path);
                                continue;
                              }

                              editorTabElementByPathRef.current.set(splitTab.file.path, element);
                            }
                          }}
                        >
                          {groupTabs.map((splitTab, paneIndex) => {
                            const tabIndex = splitTabIndexes[paneIndex];
                            const isActiveSplitTab = splitTab.file.path === activeTabPath && groupHasActive;

                            return (
                              <div
                                aria-label={splitTab.file.name}
                                aria-selected={isActiveSplitTab}
                                className={[
                                  'editor-split-tab-item',
                                  paneIndex === 0 ? 'left' : 'right',
                                  isActiveSplitTab ? 'active' : '',
                                  draggingTabIndex === tabIndex && draggingGroupIndex === groupIndex ? 'dragging' : ''
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                data-tab-path={splitTab.file.path}
                                draggable
                                key={splitTab.file.path}
                                onClick={() => {
                                  if (!isActiveSplitTab || !isSplitViewEnabled) {
                                    activateEditorTab(splitTab, groupPaths);
                                  }
                                }}
                                onDragEnd={onTabDragEnd}
                                onDragStart={(event) => onTabDragStart(event, tabIndex, groupIndex)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    activateEditorTab(splitTab, groupPaths);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                                title={splitTab.file.relativePath}
                              >
                                <FileText className="editor-tab-icon" size={13} />
                                <span className="editor-tab-name">{splitTab.file.name}</span>
                                <span
                                  className={
                                    splitTab.status === 'unsaved'
                                      ? 'editor-tab-dirty is-dirty'
                                      : 'editor-tab-dirty'
                                  }
                                />
                                <button
                                  aria-label={`Close ${splitTab.file.name}`}
                                  className="editor-tab-close"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void closeTab(splitTab.file.path);
                                  }}
                                  onMouseDown={(event) => event.preventDefault()}
                                  type="button"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  const tab = groupTabs[0];
                  const index = openTabs.findIndex((item) => item.file.path === tab.file.path);
                  const isActive = tab.file.path === activeTabPath;

                  return (
                    <div className="editor-tab-wrapper" key={groupKey}>
                      <div
                        aria-label={tab.file.name}
                        aria-selected={isActive}
                        className={[
                          'editor-tab',
                          isActive && groupHasActive ? 'active' : '',
                          draggingTabIndex === index && draggingGroupIndex === groupIndex ? 'dragging' : '',
                          groupDropIntent === 'merge' ? 'drag-merge' : '',
                          groupDropIntent === 'insert-left' ? 'drag-insert-left' : '',
                          groupDropIntent === 'insert-right' ? 'drag-insert-right' : ''
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        data-tab-path={tab.file.path}
                        draggable
                        ref={(element) => {
                          if (!element) {
                            editorTabElementByPathRef.current.delete(tab.file.path);
                            return;
                          }

                          editorTabElementByPathRef.current.set(tab.file.path, element);
                        }}
                        onClick={() => {
                          if (!isActive || !groupHasActive) {
                            activateEditorTab(tab, groupPaths);
                          }
                        }}
                        onDragEnd={onTabDragEnd}
                        onDragLeave={(event) => onTabDragLeave(event, groupIndex)}
                        onDragOver={(event) => onTabDragOver(event, groupIndex)}
                        onDragStart={(event) => onTabDragStart(event, index, groupIndex)}
                        onDrop={(event) => onTabDrop(event, groupIndex)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();

                            if (!isActive || !groupHasActive) {
                              activateEditorTab(tab, groupPaths);
                            }
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        title={tab.file.relativePath}
                      >
                        <FileText className="editor-tab-icon" size={13} />
                        <span className="editor-tab-name">{tab.file.name}</span>
                        <span
                          className={
                            tab.status === 'unsaved' ? 'editor-tab-dirty is-dirty' : 'editor-tab-dirty'
                          }
                        />
                        <button
                          aria-label={`Close ${tab.file.name}`}
                          className="editor-tab-close"
                          onClick={(event) => {
                            event.stopPropagation();
                            void closeTab(tab.file.path);
                          }}
                          onMouseDown={(event) => event.preventDefault()}
                          type="button"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}

              {draggingGroupIndex !== null && tabDropCue?.groupIndex === visibleTabGroups.length ? (
                <span className="editor-tab-drop-indicator editor-tab-drop-indicator-end" />
              ) : null}
            </div>

            <div className="editor-actions">
              <button
                className="editor-action-btn editor-action-btn-view"
                disabled={!activeFile}
                title={activeDocumentViewMode === 'rendered' ? 'Switch to Source Mode' : 'Switch to Rendered Mode'}
                type="button"
                onClick={toggleActiveDocumentViewMode}
                aria-label={activeDocumentViewMode === 'rendered' ? 'Switch to Source Mode' : 'Switch to Rendered Mode'}
              >
                {activeDocumentViewMode === 'rendered' ? (
                  <Code2 className="editor-action-icon" size={14} />
                ) : (
                  <FileText className="editor-action-icon" size={14} />
                )}
              </button>

              <button
                className="editor-action-btn"
                title="Open Agent Panel"
                type="button"
                onClick={() => openAgentPalette()}
                aria-label="Open Agent Panel"
              >
                <Bot className="editor-action-icon" size={14} />
              </button>

              <button
                className={`editor-action-btn editor-action-btn-save ${
                  activeSaveActionState === 'saving'
                    ? 'is-saving'
                    : activeSaveActionState === 'success'
                      ? 'is-success'
                      : ''
                }`}
                disabled={!activeFile || activeSaveActionState === 'saving'}
                title="Save"
                type="button"
                onClick={() => void handleSaveCurrentDocument()}
                aria-label={`Save (${getSaveButtonLabel(saveStatus, autoSave)})`}
              >
                {activeSaveActionState === 'saving' ? (
                  <LoaderCircle className="editor-action-icon spinning" size={14} />
                ) : activeSaveActionState === 'success' ? (
                  <CheckCircle2 className="editor-action-icon is-success" size={14} />
                ) : (
                  <Save className="editor-action-icon" size={14} />
                )}
              </button>

              <button
                className="editor-action-btn"
                title="New File"
                type="button"
                onClick={() => void createNewMarkdownFile()}
              >
                <FilePlus className="editor-action-icon" size={14} />
              </button>

              <button
                ref={headerMenuButtonRef}
                className="editor-action-btn"
                title="More Actions"
                type="button"
                onClick={() => {
                  setIsHeaderMenuOpen((current) => !current);
                }}
              >
                <MoreVertical className="editor-action-icon" size={14} />
              </button>

              {isHeaderMenuOpen && (
                <div className="editor-header-menu editor-action-menu" ref={headerMenuRef}>
                  <button
                    className="editor-header-menu-item"
                    type="button"
                    onClick={() => {
                      setIsHeaderMenuOpen(false);
                      setSplitEditorMode();
                    }}
                  >
                    <span className="editor-header-menu-label">
                      <Grid3X3 className="editor-header-menu-icon" size={14} />
                      <span className="editor-header-menu-text">Split Editor Right</span>
                    </span>
                    <span className="editor-header-menu-shortcut">Cmd+\</span>
                  </button>
                  <div className="editor-header-menu-separator" />
                  <button
                    className="editor-header-menu-item"
                    type="button"
                    onClick={() => {
                      setIsHeaderMenuOpen(false);
                      void saveAllOpenTabs();
                    }}
                  >
                    <span className="editor-header-menu-label">
                      <Save className="editor-header-menu-icon" size={14} />
                      <span className="editor-header-menu-text">Save All</span>
                    </span>
                    <span className="editor-header-menu-shortcut">⌥ Cmd+S</span>
                  </button>
                  <button
                    className="editor-header-menu-item"
                    type="button"
                    onClick={() => {
                      setIsHeaderMenuOpen(false);
                      void closeActiveTab();
                    }}
                  >
                    <span className="editor-header-menu-label">
                      <X className="editor-header-menu-icon" size={14} />
                      <span className="editor-header-menu-text">Close Active Editor</span>
                    </span>
                    <span className="editor-header-menu-shortcut">Cmd+W</span>
                  </button>
                  <button
                    className="editor-header-menu-item text-danger"
                    type="button"
                    onClick={() => {
                      setIsHeaderMenuOpen(false);
                      void closeAllTabs();
                    }}
                  >
                    <span className="editor-header-menu-label">
                      <Trash2 className="editor-header-menu-icon" size={14} />
                      <span className="editor-header-menu-text">Close All Editors</span>
                    </span>
                    <span className="editor-header-menu-shortcut">⇧ Cmd+W</span>
                  </button>
                </div>
              )}
            </div>
          </header>

          <section
            className={[
              splitPaneTabs ? 'editor-scroll-area is-split-view' : 'editor-scroll-area',
              agentPaletteOpen ? 'has-agent-overlay' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label="Markdown editor preview"
          >
            {splitPaneTabs ? (
              <div
                className="split-editor-grid"
                ref={splitEditorGridRef}
                style={{
                  gridTemplateColumns: `minmax(180px, ${splitPaneRatio}fr) 10px minmax(180px, ${100 - splitPaneRatio}fr)`
                }}
              >
                {renderSplitEditorPane(splitPaneTabs[0], 'left')}
                <button
                  aria-label="Resize split editors"
                  className="split-editor-resize-handle"
                  type="button"
                  onPointerDown={startSplitPaneResize}
                >
                  <span />
                </button>
                {renderSplitEditorPane(splitPaneTabs[1], 'right')}
              </div>
            ) : activeFile ? (
              <article className={focusMode ? 'markdown-body focus-mode' : 'markdown-body'}>
                {activeDocumentViewMode === 'source' ? (
                  <SourceMarkdownEditor
                    content={documentContent}
                    filePath={activeFile.path}
                    ref={(handle) => {
                      if (handle) {
                        sourceEditorHandlesRef.current.set(activeFile.path, handle);
                        return;
                      }

                      sourceEditorHandlesRef.current.delete(activeFile.path);
                    }}
                    onChange={updateSourceDocumentContent}
                    {...getCursorRestoreProps(activeFile.path, 'source')}
                  />
                ) : (
                  <MarkdownEditor
                    content={documentContent}
                    filePath={activeFile.path}
                    provenanceMarkdownHash={activeTab?.provenanceMarkdownHash}
                    provenanceSnapshotJson={activeTab?.provenanceSnapshotJson}
                    ref={(handle) => {
                      if (handle) {
                        renderedEditorHandlesRef.current.set(activeFile.path, handle);
                        return;
                      }

                      renderedEditorHandlesRef.current.delete(activeFile.path);
                    }}
                    theme={theme}
                    onChange={updateDocumentContent}
                    onToast={showToast}
                    {...getCursorRestoreProps(activeFile.path, 'rendered')}
                  />
                )}
                {loadingFile && <div className="loading-state">Loading file...</div>}
              </article>
            ) : (
              <div className="empty-editor-state">
                <FileText size={24} />
                <h1>No Markdown Loaded</h1>
                <p>Add a workspace folder to recursively load its markdown files.</p>
                <div className="empty-editor-actions">
                  <button className="primary-action" type="button" onClick={addWorkspaceFolder}>
                    <FolderPlus size={16} />
                    Add Folder
                  </button>
                  <button className="secondary-action" type="button" onClick={createDatabaseWorkspace}>
                    <FilePlus size={16} />
                    New Database Workspace
                  </button>
                </div>
              </div>
            )}
          </section>

          <footer className="statusbar">
            <span>{getSaveStatusLabel(saveStatus)}</span>
            <span>{wordCount} Words</span>
            <span>{documentContent.length} Characters</span>
            <span>UTF-8</span>
          </footer>

          <AgentPalette
            context={agentRuntimeContext}
            language={resolvedLanguage}
            onInsertAnswer={handleInsertAiAnswer}
            onCanvasClose={relaxAgentPaletteAfterCanvasClose}
            onCanvasOpen={moveAgentPaletteForCanvasOpen}
            onToast={showToast}
            position={agentPaletteAnchor}
            visible={agentPaletteOpen}
          />
        </main>
      </div>

      {settingsOpen && (
        <div className="settings-overlay open" onMouseDown={() => setSettingsOpen(false)}>
          <section
            className="settings-window"
            aria-label={t('app.settings')}
            onMouseDown={(event) => event.stopPropagation()}
            onPaste={(event) => event.stopPropagation()}
          >
            <aside className="settings-sidebar">
              <h2 className="settings-title">{t('app.settings')}</h2>
              <button
                className={settingsPanel === 'editor' ? 'settings-nav-item active' : 'settings-nav-item'}
                type="button"
                onClick={() => setSettingsPanel('editor')}
              >
                {t('nav.editor')}
              </button>
              <button
                className={settingsPanel === 'appearance' ? 'settings-nav-item active' : 'settings-nav-item'}
                type="button"
                onClick={() => setSettingsPanel('appearance')}
              >
                {t('nav.appearance')}
              </button>
              <button
                className={settingsPanel === 'typography' ? 'settings-nav-item active' : 'settings-nav-item'}
                type="button"
                onClick={() => setSettingsPanel('typography')}
              >
                {t('nav.typography')}
              </button>
              <button
                className={settingsPanel === 'shortcuts' ? 'settings-nav-item active' : 'settings-nav-item'}
                type="button"
                onClick={() => setSettingsPanel('shortcuts')}
              >
                {t('nav.shortcuts')}
              </button>
              <button
                className={settingsPanel === 'aiModel' ? 'settings-nav-item active' : 'settings-nav-item'}
                type="button"
                onClick={() => setSettingsPanel('aiModel')}
              >
                {t('nav.aiModel')}
              </button>
              <button
                className={settingsPanel === 'remote' ? 'settings-nav-item active' : 'settings-nav-item'}
                type="button"
                onClick={() => setSettingsPanel('remote')}
              >
                {t('nav.remote')}
              </button>
              <span className="settings-spacer" />
              <button
                className={settingsPanel === 'about' ? 'settings-nav-item active' : 'settings-nav-item'}
                type="button"
                onClick={() => setSettingsPanel('about')}
              >
                <span>{t('nav.about')}</span>
                {updateStatus && ['available', 'downloading', 'downloaded'].includes(updateStatus.status) && (
                  <span className="settings-nav-badge">
                    {updateStatus.status === 'downloaded' ? t('common.ready') : t('common.new')}
                  </span>
                )}
              </button>
            </aside>

            <div className="settings-content-wrapper">
              <button
                className="settings-close-btn"
                type="button"
                aria-label={t('common.closeSettings')}
                onClick={() => setSettingsOpen(false)}
              >
                <X size={20} />
              </button>

              <div className="settings-scroll-area">
                {settingsPanel === 'editor' && (
                  <>
                    <h3 className="settings-section-title">{t('settings.editor.title')}</h3>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.editor.fontFamily')}</span>
                        <span className="setting-desc">{t('settings.editor.fontFamilyDesc')}</span>
                      </div>
                      <select className="shadcn-select" defaultValue="inter">
                        <option value="inter">Inter</option>
                        <option value="system">{t('common.system')}</option>
                        <option value="mono">JetBrains Mono</option>
                      </select>
                    </div>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.editor.autoSave')}</span>
                        <span className="setting-desc">{t('settings.editor.autoSaveDesc')}</span>
                      </div>
                      <Switch checked={autoSave} onChange={updateAutoSave} />
                    </div>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.editor.lineNumbers')}</span>
                        <span className="setting-desc">{t('settings.editor.lineNumbersDesc')}</span>
                      </div>
                      <Switch checked={lineNumbers} onChange={setLineNumbers} />
                    </div>

                  </>
                )}
                {settingsPanel === 'appearance' && (
                  <>
                    <h3 className="settings-section-title">{t('nav.appearance')}</h3>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.appearance.language')}</span>
                        <span className="setting-desc">{t('settings.appearance.languageDesc')}</span>
                      </div>
                      <select
                        className="shadcn-select appearance-select"
                        value={appearanceSettings.language}
                        onChange={(event) =>
                          void updateAppearanceSettings({ language: event.currentTarget.value as AppLanguage })
                        }
                        aria-label={t('settings.appearance.language')}
                      >
                        {appLanguageOptions.map((option) => (
                          <option key={option} value={option}>
                            {getAppLanguageLabel(option)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.appearance.theme')}</span>
                        <span className="setting-desc">{t('settings.appearance.themeDesc')}</span>
                      </div>
                      <div className="theme-toggle" role="group" aria-label={t('settings.appearance.theme')}>
                        <button
                          className={theme === 'dark' ? 'theme-option active' : 'theme-option'}
                          type="button"
                          onClick={() => void updateTheme('dark')}
                        >
                          <Moon size={15} />
                          {t('common.dark')}
                        </button>
                        <button
                          className={theme === 'light' ? 'theme-option active' : 'theme-option'}
                          type="button"
                          onClick={() => void updateTheme('light')}
                        >
                          <Sun size={15} />
                          {t('common.light')}
                        </button>
                      </div>
                    </div>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.appearance.density')}</span>
                        <span className="setting-desc">{t('settings.appearance.densityDesc')}</span>
                      </div>
                      <select
                        className="shadcn-select appearance-select"
                        value={appearanceSettings.density}
                        onChange={(event) =>
                          void updateAppearanceSettings({ density: event.currentTarget.value as InterfaceDensity })
                        }
                        aria-label={t('settings.appearance.density')}
                      >
                        {interfaceDensityOptions.map((option) => (
                          <option key={option} value={option}>
                            {getInterfaceDensityLabel(option)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.appearance.motion')}</span>
                        <span className="setting-desc">{t('settings.appearance.motionDesc')}</span>
                      </div>
                      <select
                        className="shadcn-select appearance-select"
                        value={appearanceSettings.motion}
                        onChange={(event) =>
                          void updateAppearanceSettings({ motion: event.currentTarget.value as MotionPreference })
                        }
                        aria-label={t('settings.appearance.motion')}
                      >
                        {motionPreferenceOptions.map((option) => (
                          <option key={option} value={option}>
                            {getMotionPreferenceLabel(option)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <p className="settings-panel-hint">
                      {t('settings.appearance.languageHint')}
                    </p>
                  </>
                )}
                {settingsPanel === 'typography' && (
                  <>
                    <h3 className="settings-section-title">{t('nav.typography')}</h3>

                    <div className="setting-row typography-setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.typography.editorFontSize')}</span>
                        <span className="setting-desc">{t('settings.typography.editorFontSizeDesc')}</span>
                      </div>
                      <div className="typography-control">
                        <span
                          className="typography-preview-glyph"
                          style={{ fontSize: `${editorFontSize}px` }}
                          aria-label={t('settings.typography.preview', { size: editorFontSize })}
                        >
                          字
                        </span>
                        <div className="typography-size-control">
                          <div className="typography-size-header">
                            <span>{minimumEditorFontSize}px</span>
                            <strong>{editorFontSize}px</strong>
                            <span>{maximumEditorFontSize}px</span>
                          </div>
                          <input
                            className="typography-size-slider"
                            type="range"
                            min={minimumEditorFontSize}
                            max={maximumEditorFontSize}
                            step={1}
                            value={editorFontSize}
                            aria-label={t('settings.typography.sizeSlider')}
                            onChange={(event) => updateEditorFontSize(Number(event.currentTarget.value))}
                          />
                          <div className="typography-size-actions">
                            <input
                              className="settings-text-input typography-size-input"
                              type="number"
                              min={minimumEditorFontSize}
                              max={maximumEditorFontSize}
                              step={1}
                              value={editorFontSize}
                              aria-label={t('settings.typography.sizeInput')}
                              onChange={(event) => updateEditorFontSize(Number(event.currentTarget.value))}
                            />
                            <button className="secondary-action" type="button" onClick={resetEditorFontSize}>
                              {t('common.reset')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <p className="settings-panel-hint">
                      {t('settings.typography.fontSizeHint', { size: defaultEditorFontSize })}
                    </p>
                  </>
                )}
                {settingsPanel === 'shortcuts' && (
                  <>
                    <h3 className="settings-section-title">{t('nav.shortcuts')}</h3>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.shortcuts.openAiPanel')}</span>
                        <span className="setting-desc">{t('settings.shortcuts.openAiPanelDesc')}</span>
                      </div>
                      <div className="shortcut-control">
                        <button
                          ref={openAiPanelShortcutButtonRef}
                          className={
                            recordingShortcutAction === 'openAiPanel'
                              ? 'shortcut-record-button recording'
                              : 'shortcut-record-button'
                          }
                          type="button"
                          aria-label={t('settings.shortcuts.recordOpenAiPanel')}
                          onClick={() => setRecordingShortcutAction('openAiPanel')}
                          onKeyDown={
                            recordingShortcutAction === 'openAiPanel' ? recordOpenAiPanelShortcut : undefined
                          }
                        >
                          {recordingShortcutAction === 'openAiPanel' ? (
                            <span>{t('settings.shortcuts.pressKeys')}</span>
                          ) : (
                            <kbd>{shortcutSettings.openAiPanel}</kbd>
                          )}
                        </button>
                        <button
                          className="shortcut-reset-button"
                          type="button"
                          title={t('settings.shortcuts.resetDefault')}
                          aria-label={t('settings.shortcuts.resetOpenAiPanel')}
                          onClick={resetOpenAiPanelShortcut}
                        >
                          <RefreshCw size={14} />
                        </button>
                      </div>
                    </div>

                    <p className="settings-panel-hint">
                      {t('settings.shortcuts.defaultHint', { shortcut: getDefaultOpenAiPanelShortcut(appPlatform) })}
                    </p>
                  </>
                )}
                {settingsPanel === 'aiModel' && (
                  <>
                    <h3 className="settings-section-title">{t('nav.aiModel')}</h3>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.ai.apiBaseUrl')}</span>
                        <span className="setting-desc">{t('settings.ai.apiBaseDesc')}</span>
                      </div>
                      <input
                        className="settings-text-input"
                        type="text"
                        placeholder="https://api.openai.com/v1"
                        value={aiConfig.baseUrl}
                        onChange={(e) => setAiConfig({ ...aiConfig, baseUrl: e.target.value })}
                        spellCheck={false}
                      />
                    </div>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.ai.apiKey')}</span>
                        <span className="setting-desc">{t('settings.ai.apiKeyDesc')}</span>
                      </div>
                      <input
                        className="settings-text-input"
                        type="password"
                        placeholder="sk-..."
                        value={aiConfig.apiKey}
                        onChange={(e) => setAiConfig({ ...aiConfig, apiKey: e.target.value })}
                        spellCheck={false}
                      />
                    </div>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.ai.model')}</span>
                        <span className="setting-desc">{t('settings.ai.modelDesc')}</span>
                      </div>
                      <input
                        className="settings-text-input"
                        type="text"
                        placeholder="google/gemini-3.1-flash-lite-preview"
                        value={aiConfig.model}
                        onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                        spellCheck={false}
                      />
                    </div>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">{t('settings.ai.contextWindow')}</span>
                        <span className="setting-desc">{t('settings.ai.contextWindowDesc')}</span>
                      </div>
                      <input
                        className="settings-text-input short"
                        type="number"
                        min={1024}
                        max={2000000}
                        step={1000}
                        placeholder="128000"
                        value={aiConfig.contextWindow || ''}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          if (val > 0 && Number.isFinite(val)) {
                            setAiConfig({ ...aiConfig, contextWindow: val });
                          } else if (e.target.value === '') {
                            setAiConfig({ ...aiConfig, contextWindow: 0 });
                          }
                        }}
                      />
                    </div>

                    <div className="settings-panel-footer">
                      <button
                        className="primary-action"
                        type="button"
                        disabled={aiConfigLoading}
                        onClick={async () => {
                          setAiConfigLoading(true);
                          try {
                            await updateAiConfig(aiConfig);
                          } finally {
                            setAiConfigLoading(false);
                          }
                        }}
                      >
                        {aiConfigLoading ? (
                          <LoaderCircle className="spinning" size={15} />
                        ) : (
                          <Save size={15} />
                        )}
                        {t('settings.ai.save')}
                      </button>
                    </div>

                    <p className="settings-panel-hint">
                      {t('settings.ai.hint')}
                    </p>
                  </>
                )}
                {settingsPanel === 'remote' && (
                  <>
                    <h3 className="settings-section-title">{t('nav.remote')}</h3>

                    <div className="account-provider-panel">
                      <div className="account-provider-header">
                        <div className="account-provider-title">
                          <Database size={18} />
                          <span>Supabase</span>
                        </div>
                        <span className={remoteConfig.status === 'initialized' ? 'account-status connected' : 'account-status'}>
                          {getRemoteStatusLabel(remoteConfig.status, t)}
                        </span>
                      </div>

                      <div className="remote-status-grid">
                        <div className="remote-status-item">
                          <span>{t('settings.remote.project')}</span>
                          <strong>{remoteConfig.projectRef || t('settings.remote.notCreated')}</strong>
                        </div>
                        <div className="remote-status-item">
                          <span>{t('settings.remote.databaseHost')}</span>
                          <strong>{remoteConfig.databaseHost || t('settings.remote.notAvailable')}</strong>
                        </div>
                        <div className="remote-status-item">
                          <span>{t('settings.remote.credentials')}</span>
                          <strong>{getRemoteCredentialSummary(remoteConfig, t)}</strong>
                        </div>
                      </div>

                      {remoteConfig.projectUrl && (
                        <a
                          className="remote-project-link"
                          href={remoteConfig.projectUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ExternalLink size={14} />
                          {t('settings.remote.openProject')}
                        </a>
                      )}

                      {remoteConfig.lastError && (
                        <div className="settings-warning">
                          {remoteConfig.lastError}
                        </div>
                      )}

                      <div className="setting-row compact">
                        <div className="setting-info">
                          <span className="setting-label">{t('settings.remote.personalAccessToken')}</span>
                          <span className="setting-desc">{t('settings.remote.personalAccessTokenDesc')}</span>
                        </div>
                        <input
                          className="settings-text-input"
                          type="password"
                          placeholder={remoteConfig.patSaved ? t('settings.remote.savedToken') : 'sbp_...'}
                          value={remoteInput.personalAccessToken ?? ''}
                          onChange={(event) =>
                            updateRemoteInputField('personalAccessToken', event.currentTarget.value, 'change')
                          }
                          onBlur={() => restoreMaskedRemoteInputField('personalAccessToken')}
                          onFocus={() => clearMaskedRemoteInputField('personalAccessToken')}
                          onPaste={(event) => pasteRemoteInputField('personalAccessToken', event)}
                          spellCheck={false}
                        />
                      </div>

                      <div className="setting-row compact">
                        <div className="setting-info">
                          <span className="setting-label">{t('settings.remote.organizationSlug')}</span>
                          <span className="setting-desc">{t('settings.remote.organizationSlugDesc')}</span>
                        </div>
                        <input
                          className="settings-text-input"
                          type="text"
                          placeholder="your-org"
                          value={remoteInput.organizationSlug}
                          onChange={(event) =>
                            updateRemoteInputField('organizationSlug', event.currentTarget.value, 'change')
                          }
                          onPaste={(event) => pasteRemoteInputField('organizationSlug', event)}
                          spellCheck={false}
                        />
                      </div>

                      <div className="setting-row compact">
                        <div className="setting-info">
                          <span className="setting-label">{t('settings.remote.region')}</span>
                          <span className="setting-desc">{t('settings.remote.regionDesc')}</span>
                        </div>
                        <div className="remote-region-control">
                          <select
                            className="shadcn-select remote-region-select"
                            value={remoteInput.region}
                            onChange={(event) => updateRemoteInputField('region', event.currentTarget.value, 'change')}
                          >
                            {getRemoteRegionSelectOptions(defaultRemoteRegionOptions, remoteInput.region).map((region) => (
                              <option key={region.code} value={region.code}>
                                {region.label}
                              </option>
                            ))}
                          </select>
                          <input
                            className="settings-text-input remote-region-custom-input"
                            type="text"
                            placeholder={t('settings.remote.regionPlaceholder')}
                            value={remoteInput.region}
                            onChange={(event) => updateRemoteInputField('region', event.currentTarget.value, 'change')}
                            onPaste={(event) => pasteRemoteInputField('region', event)}
                            spellCheck={false}
                          />
                        </div>
                      </div>

                      <div className="setting-row compact">
                        <div className="setting-info">
                          <span className="setting-label">{t('settings.remote.databasePassword')}</span>
                          <span className="setting-desc">{t('settings.remote.databasePasswordDesc')}</span>
                        </div>
                        <input
                          className="settings-text-input"
                          type="password"
                          placeholder={
                            remoteConfig.databasePasswordSaved
                              ? t('settings.remote.savedPassword')
                              : t('settings.remote.strongDatabasePassword')
                          }
                          value={remoteInput.databasePassword ?? ''}
                          onChange={(event) =>
                            updateRemoteInputField('databasePassword', event.currentTarget.value, 'change')
                          }
                          onBlur={() => restoreMaskedRemoteInputField('databasePassword')}
                          onFocus={() => clearMaskedRemoteInputField('databasePassword')}
                          onPaste={(event) => pasteRemoteInputField('databasePassword', event)}
                          spellCheck={false}
                        />
                      </div>

                      <div className="account-actions">
                        <button
                          className="secondary-action"
                          type="button"
                          disabled={remoteLoading}
                          onClick={() => void saveRemoteConfig()}
                        >
                          {remoteLoading ? <LoaderCircle className="spinning" size={15} /> : <Save size={15} />}
                          {t('common.save')}
                        </button>
                        <button
                          className="secondary-action"
                          type="button"
                          disabled={remoteLoading || remoteConfig.status !== 'initialized'}
                          onClick={() => void testRemoteConnection()}
                        >
                          <RefreshCw className={remoteLoading ? 'spinning' : ''} size={15} />
                          {t('common.test')}
                        </button>
                        <button
                          className="primary-action"
                          type="button"
                          disabled={remoteLoading || !canSubmitRemoteConfig(remoteInput, remoteConfig)}
                          onClick={() => void createRemoteVelocaProject()}
                        >
                          {remoteLoading ? <LoaderCircle className="spinning" size={15} /> : <Database size={15} />}
                          {t('settings.remote.createConnect')}
                        </button>
                      </div>
                    </div>

                    <div className="account-provider-panel remote-sync-panel">
                      <div className="account-provider-header">
                        <div className="account-provider-title">
                          <RefreshCw size={18} />
                          <span>{t('settings.remote.sync')}</span>
                        </div>
                        <span className={remoteSyncStatus.failedCount > 0 ? 'account-status' : 'account-status connected'}>
                          {remoteSyncStatus.running
                            ? t('settings.remote.syncing')
                            : remoteSyncStatus.failedCount > 0
                              ? t('settings.remote.needsRetry')
                              : t('common.ready')}
                        </span>
                      </div>

                      <div className="remote-status-grid">
                        <div className="remote-status-item">
                          <span>{t('settings.remote.pendingPush')}</span>
                          <strong>{remoteSyncStatus.pendingPushCount}</strong>
                        </div>
                        <div className="remote-status-item">
                          <span>{t('settings.remote.conflicts')}</span>
                          <strong>{remoteSyncStatus.conflictCount}</strong>
                        </div>
                        <div className="remote-status-item">
                          <span>{t('settings.remote.failed')}</span>
                          <strong>{remoteSyncStatus.failedCount}</strong>
                        </div>
                        <div className="remote-status-item">
                          <span>{t('settings.remote.lastSync')}</span>
                          <strong>{formatRemoteSyncTime(remoteSyncStatus.lastRunAt, t)}</strong>
                        </div>
                      </div>

                      {remoteSyncStatus.lastError && (
                        <div className="settings-warning">
                          {remoteSyncStatus.lastError}
                        </div>
                      )}

                      <div className="remote-sync-options">
                        <label className="remote-sync-option">
                          <input
                            type="checkbox"
                            checked={remoteSyncConfig.autoSyncEnabled}
                            onChange={(event) => updateRemoteSyncConfig('autoSyncEnabled', event.currentTarget.checked)}
                          />
                          <span>
                            <strong>{t('settings.remote.syncAuto')}</strong>
                            <small>{t('settings.remote.syncAutoDesc')}</small>
                          </span>
                        </label>
                        <label className="remote-sync-option">
                          <input
                            type="checkbox"
                            checked={remoteSyncConfig.pullOnStartup}
                            onChange={(event) => updateRemoteSyncConfig('pullOnStartup', event.currentTarget.checked)}
                          />
                          <span>
                            <strong>{t('settings.remote.syncPullStartup')}</strong>
                            <small>{t('settings.remote.syncPullStartupDesc')}</small>
                          </span>
                        </label>
                        <label className="remote-sync-option">
                          <input
                            type="checkbox"
                            checked={remoteSyncConfig.pushOnSave}
                            onChange={(event) => updateRemoteSyncConfig('pushOnSave', event.currentTarget.checked)}
                          />
                          <span>
                            <strong>{t('settings.remote.syncPushSave')}</strong>
                            <small>{t('settings.remote.syncPushSaveDesc')}</small>
                          </span>
                        </label>
                        <label className="remote-sync-option">
                          <input
                            type="checkbox"
                            checked={remoteSyncConfig.syncLocalOpenedMarkdown}
                            onChange={(event) =>
                              updateRemoteSyncConfig('syncLocalOpenedMarkdown', event.currentTarget.checked)
                            }
                          />
                          <span>
                            <strong>{t('settings.remote.syncLocal')}</strong>
                            <small>{t('settings.remote.syncLocalDesc')}</small>
                          </span>
                        </label>
                        <label className="remote-sync-option disabled">
                          <input type="checkbox" checked={remoteSyncConfig.syncDatabaseWorkspaces} disabled />
                          <span>
                            <strong>{t('settings.remote.syncDatabase')}</strong>
                            <small>{t('settings.remote.syncDatabaseDesc')}</small>
                          </span>
                        </label>
                        <label className="remote-sync-option">
                          <input
                            type="checkbox"
                            checked={remoteSyncConfig.syncAssets}
                            onChange={(event) => updateRemoteSyncConfig('syncAssets', event.currentTarget.checked)}
                          />
                          <span>
                            <strong>{t('settings.remote.syncAssets')}</strong>
                            <small>{t('settings.remote.syncAssetsDesc')}</small>
                          </span>
                        </label>
                        <label className="remote-sync-option">
                          <input
                            type="checkbox"
                            checked={remoteSyncConfig.syncProvenance}
                            onChange={(event) => updateRemoteSyncConfig('syncProvenance', event.currentTarget.checked)}
                          />
                          <span>
                            <strong>{t('settings.remote.syncProvenance')}</strong>
                            <small>{t('settings.remote.syncProvenanceDesc')}</small>
                          </span>
                        </label>
                        <label className="remote-sync-option">
                          <input
                            type="checkbox"
                            checked={remoteSyncConfig.syncDeletes}
                            onChange={(event) => updateRemoteSyncConfig('syncDeletes', event.currentTarget.checked)}
                          />
                          <span>
                            <strong>{t('settings.remote.syncDeletes')}</strong>
                            <small>{t('settings.remote.syncDeletesDesc')}</small>
                          </span>
                        </label>
                      </div>

                      <div className="remote-sync-policy">
                        {t('settings.remote.conflictPolicy')} <strong>{t('settings.remote.keepBoth')}</strong>
                      </div>

                      <div className="account-actions">
                        <button
                          className="secondary-action"
                          type="button"
                          disabled={remoteSyncLoading}
                          onClick={() => void saveRemoteSyncSettings()}
                        >
                          {remoteSyncLoading ? <LoaderCircle className="spinning" size={15} /> : <Save size={15} />}
                          {t('settings.remote.saveSync')}
                        </button>
                        <button
                          className="secondary-action"
                          type="button"
                          disabled={remoteSyncLoading || remoteConfig.status !== 'initialized'}
                          onClick={() => void runRemoteSyncAction('manual')}
                        >
                          <RefreshCw className={remoteSyncLoading ? 'spinning' : ''} size={15} />
                          {t('settings.remote.manualSync')}
                        </button>
                        <button
                          className="secondary-action"
                          type="button"
                          disabled={remoteSyncLoading || remoteSyncStatus.failedCount === 0}
                          onClick={() => void runRemoteSyncAction('retry')}
                        >
                          <RefreshCw className={remoteSyncLoading ? 'spinning' : ''} size={15} />
                          {t('settings.remote.retryFailed')}
                        </button>
                      </div>
                    </div>
                  </>
                )}
                {settingsPanel === 'account' && (
                  <>
                    <h3 className="settings-section-title">Account</h3>

                    <div className="account-provider-panel">
                      <div className="account-provider-header">
                        <div className="account-provider-title">
                          <Github size={18} />
                          <span>GitHub</span>
                        </div>
                        <span className={githubStatus.connected ? 'account-status connected' : 'account-status'}>
                          {githubStatus.connected ? 'Connected' : 'Not Connected'}
                        </span>
                      </div>

                      {githubStatus.connected && githubStatus.account ? (
                        <div className="github-account-card">
                          <img
                            className="github-account-avatar"
                            src={githubStatus.account.avatarUrl}
                            alt=""
                          />
                          <div className="github-account-info">
                            <span className="github-account-name">
                              {githubStatus.account.name ?? githubStatus.account.login}
                            </span>
                            <span className="github-account-login">@{githubStatus.account.login}</span>
                          </div>
                          <a
                            className="github-profile-link"
                            href={githubStatus.account.profileUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <ExternalLink size={14} />
                          </a>
                        </div>
                      ) : (
                        <div className="github-empty-state">
                          <Github size={22} />
                          <span>Connect GitHub to enable Veloca version management authorization.</span>
                        </div>
                      )}

                      {githubBinding && (
                        <div className="github-device-code">
                          <span className="github-device-code-label">Verification Code</span>
                          <strong>{githubBinding.userCode}</strong>
                          <button className="secondary-action" type="button" onClick={openGitHubVerificationPage}>
                            <ExternalLink size={14} />
                            Open GitHub
                          </button>
                        </div>
                      )}

                      {!githubStatus.configured && (
                        <div className="settings-warning">
                          Set VELOCA_GITHUB_CLIENT_ID in .env before binding a GitHub account.
                        </div>
                      )}

                      {githubStatus.connected && githubStatus.requiresRebindForVersionManagement && (
                        <div className="settings-warning">
                          Version management needs GitHub repo permission. Rebind GitHub to create and push to the
                          private veloca-version-manager repository.
                        </div>
                      )}

                      <div className="account-actions">
                        {githubStatus.connected ? (
                          <>
                            {githubStatus.requiresRebindForVersionManagement && (
                              <button
                                className="primary-action"
                                type="button"
                                disabled={!githubStatus.configured || githubAuthLoading}
                                onClick={bindGitHubAccount}
                              >
                                {githubAuthLoading ? (
                                  <RefreshCw className="spinning" size={15} />
                                ) : (
                                  <Github size={15} />
                                )}
                                Rebind GitHub
                              </button>
                            )}
                            <button
                              className="secondary-action danger"
                              type="button"
                              disabled={githubAuthLoading}
                              onClick={unbindGitHubAccount}
                            >
                              <Unlink size={15} />
                              Unbind GitHub
                            </button>
                          </>
                        ) : (
                          <button
                            className="primary-action"
                            type="button"
                            disabled={!githubStatus.configured || githubAuthLoading}
                            onClick={bindGitHubAccount}
                          >
                            {githubAuthLoading ? <RefreshCw className="spinning" size={15} /> : <Github size={15} />}
                            {githubAuthLoading ? 'Waiting for Authorization' : 'Bind GitHub'}
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {settingsPanel === 'about' && (
                  <>
                    <div className="about-hero">
                      {appInfo.logoDataUrl ? (
                        <img className="about-logo" src={appInfo.logoDataUrl} alt="Veloca" />
                      ) : (
                        <div className="about-logo-fallback">V</div>
                      )}
                      <div className="about-title-block">
                        <h3>Veloca</h3>
                        <span>{t('about.subtitle')}</span>
                      </div>
                    </div>

                    {updateStatus &&
                      ['available', 'downloading', 'downloaded'].includes(updateStatus.status) && (
                      <div className="settings-update-banner">
                        <div>
                          <strong>
                            {updateStatus.status === 'downloaded'
                              ? t('about.update.ready', { version: updateStatus.latestVersion ?? '' })
                              : t('about.update.available', { version: updateStatus.latestVersion ?? '' })}
                          </strong>
                          <span>{getUpdateSummary(updateStatus, t)}</span>
                          {updateStatus.status === 'downloading' && (
                            <span className="settings-update-progress">
                              <span style={{ width: `${updateStatus.updatePercent ?? 0}%` }} />
                            </span>
                          )}
                        </div>
                        {updateStatus.status === 'downloaded' ? (
                          <button
                            className="primary-action"
                            type="button"
                            disabled={updateInstalling}
                            onClick={() => void installDownloadedUpdate()}
                          >
                            {updateInstalling ? <LoaderCircle className="spinning" size={14} /> : <RefreshCw size={14} />}
                            {t('about.restartUpdate')}
                          </button>
                        ) : updateStatus.releaseUrl ? (
                          <button
                            className="secondary-action"
                            type="button"
                            onClick={() => void openExternalLink(updateStatus.releaseUrl ?? '')}
                          >
                            <ExternalLink size={14} />
                            {t('about.openRelease')}
                          </button>
                        ) : null}
                      </div>
                        )}

                    <div className="about-info-grid">
                      <div className="about-info-item">
                        <span>{t('about.version')}</span>
                        <strong>{appInfo.version}</strong>
                      </div>
                      <div className="about-info-item">
                        <span>{t('about.license')}</span>
                        <strong>{appInfo.license}</strong>
                      </div>
                      <div className="about-info-item wide">
                        <span>{t('about.github')}</span>
                        <button
                          className="about-link-button"
                          type="button"
                          onClick={() => void openExternalLink(appInfo.githubUrl)}
                        >
                          {appInfo.githubUrl}
                          <ExternalLink size={13} />
                        </button>
                      </div>
                    </div>

                    <div className="about-action-list">
                      <button
                        className="about-action-row"
                        type="button"
                        disabled={updateChecking}
                        onClick={() => void checkForAppUpdates('manual')}
                      >
                        <span className="about-action-icon">
                          {updateStatus?.status === 'downloading' ? (
                            <Download size={16} />
                          ) : (
                            <RefreshCw className={updateChecking ? 'spinning' : ''} size={16} />
                          )}
                        </span>
                        <span className="about-action-copy">
                          <strong>{t('about.action.checkUpdates')}</strong>
                          <small>
                            {updateStatus ? getUpdateSummary(updateStatus, t) : t('about.action.inspectReleases')}
                          </small>
                        </span>
                        <ChevronRight size={16} />
                      </button>

                      {updateStatus?.status === 'downloaded' && (
                        <button
                          className="about-action-row"
                          type="button"
                          disabled={updateInstalling}
                          onClick={() => void installDownloadedUpdate()}
                        >
                          <span className="about-action-icon">
                            {updateInstalling ? <LoaderCircle className="spinning" size={16} /> : <RefreshCw size={16} />}
                          </span>
                          <span className="about-action-copy">
                            <strong>{t('about.action.restartUpdate')}</strong>
                            <small>{t('about.action.restartDesc')}</small>
                          </span>
                          <ChevronRight size={16} />
                        </button>
                      )}

                      <button className="about-action-row" type="button" onClick={() => void openLicenseDialog()}>
                        <span className="about-action-icon">
                          <FileText size={16} />
                        </span>
                        <span className="about-action-copy">
                          <strong>{t('about.action.openLicenses')}</strong>
                          <small>
                            {openSourceComponents.length
                              ? t('about.componentsUsedShort', { count: openSourceComponents.length })
                              : t('about.componentsViewShort')}
                          </small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    </div>

                    {updateStatus?.status === 'current' && (
                      <p className="settings-panel-hint">
                        {t('about.currentVersion', { version: updateStatus.currentVersion })}
                      </p>
                    )}
                    {updateStatus?.status === 'unavailable' && (
                      <p className="settings-panel-hint">
                        {t('about.unavailable', {
                          message: updateStatus.errorMessage ?? t('about.update.errorFallback')
                        })}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {licenseDialogOpen && (
        <div className="license-dialog-overlay" onMouseDown={() => setLicenseDialogOpen(false)}>
          <section
            className="license-dialog"
            aria-label={t('about.licenses.title')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="license-dialog-header">
              <div>
                <h2>{t('about.licenses.title')}</h2>
                <p>{t('about.componentsUsed', { count: openSourceComponents.length })}</p>
              </div>
              <button
                className="settings-close-btn inline"
                type="button"
                aria-label={t('about.licenses.close')}
                onClick={() => setLicenseDialogOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="license-dialog-body">
              {openSourceLoading ? (
                <div className="license-loading">
                  <LoaderCircle className="spinning" size={18} />
                  {t('about.licenses.loading')}
                </div>
              ) : (
                openSourceComponents.map((component) => (
                  <div className="license-component-row" key={`${component.name}-${component.version}`}>
                    <div className="license-component-main">
                      <strong>{component.name}</strong>
                      <span>{component.version || t('about.licenses.unknownVersion')}</span>
                    </div>
                    <span className="license-badge">{component.license}</span>
                    {(component.repositoryUrl || component.homepage) && (
                      <button
                        className="license-link"
                        type="button"
                        onClick={() => void openExternalLink(component.repositoryUrl || component.homepage)}
                      >
                        <ExternalLink size={13} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {nameDialog && (
        <NameDialog
          description={nameDialog.description}
          name={nameDialogValue}
          placeholder={nameDialog.placeholder}
          submitLabel={nameDialog.submitLabel}
          title={nameDialog.title}
          onCancel={closeNameDialog}
          onChange={setNameDialogValue}
          onSubmit={submitNameDialog}
        />
      )}

      {saveLocationDialog && (
        <SaveLocationDialog
          fileName={saveLocationDialog.fileName}
          folders={saveLocationOptions}
          saving={savingLocation}
          selectedFolderPath={saveLocationDialog.selectedFolderPath}
          onCancel={() => {
            if (!savingLocation) {
              setSaveLocationDialog(null);
            }
          }}
          onFileNameChange={(fileName) =>
            setSaveLocationDialog((current) => (current ? { ...current, fileName } : current))
          }
          onFolderSelect={(folderPath) =>
            setSaveLocationDialog((current) =>
              current ? { ...current, selectedFolderPath: folderPath } : current
            )
          }
          onSubmit={() => void submitSaveLocation()}
        />
      )}

      <div className="toast-viewport" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast ${toast.type}`} key={toast.id}>
            <div className="toast-icon">
              {toast.type === 'success' ? <CheckCircle2 size={18} /> : <Info size={18} />}
            </div>
            <div className="toast-content">
              <strong className="toast-title">{toast.title}</strong>
              <span className="toast-desc">{toast.description}</span>
            </div>
            <button className="toast-close" type="button" onClick={() => dismissToast(toast.id)}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      {contextMenu && (
        <WorkspaceContextMenu
          clipboard={fileClipboard}
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onCopy={(node) => setFileClipboard({ mode: 'copy', path: node.path, name: node.name })}
          onCopyPath={copyEntryPath}
          onCreate={createEntry}
          onCut={(node) => setFileClipboard({ mode: 'cut', path: node.path, name: node.name })}
          onDelete={deleteEntry}
          onDuplicate={duplicateEntry}
          onOpen={openEntry}
          onPaste={pasteEntry}
          onRemoveWorkspace={removeWorkspaceFolder}
          onRename={renameEntry}
          onReveal={revealEntry}
        />
      )}
    </div>
  );
}

interface FileTreeProps {
  activeFilePath: string;
  editingNode: EditingNodeState | null;
  loading: boolean;
  openFolders: Record<string, boolean>;
  tree: WorkspaceTreeNode[];
  onAddFolder: () => void;
  onCancelInlineRename: () => void;
  onCommitInlineRename: () => void;
  onCreateDatabaseWorkspace: () => void;
  onContextMenu: (event: MouseEvent, node: WorkspaceTreeNode) => void;
  onEditingNodeChange: (value: string) => void;
  onFileSelect: (filePath: string) => void;
  onFolderToggle: (folderId: string) => void;
}

function FileTree({
  activeFilePath,
  editingNode,
  loading,
  openFolders,
  tree,
  onAddFolder,
  onCancelInlineRename,
  onCommitInlineRename,
  onCreateDatabaseWorkspace,
  onContextMenu,
  onEditingNodeChange,
  onFileSelect,
  onFolderToggle
}: FileTreeProps): JSX.Element {
  return (
    <nav aria-label="Workspace files">
      <div className="directory-toolbar">
        <span>Workspace</span>
        <div className="directory-toolbar-actions">
          <button className="toolbar-icon-btn" type="button" aria-label="New database workspace" onClick={onCreateDatabaseWorkspace}>
            <Database size={16} />
          </button>
          <button className="toolbar-icon-btn" type="button" aria-label="Add folder" onClick={onAddFolder}>
            <FolderPlus size={16} />
          </button>
        </div>
      </div>

      {loading && <div className="loading-state">Loading workspace...</div>}

      {!loading && tree.length === 0 && (
        <div className="empty-sidebar-state">
          <p>Add a system folder or create a database workspace.</p>
        </div>
      )}

      {!loading &&
        tree.map((node) => (
          <TreeNode
            activeFilePath={activeFilePath}
            depth={0}
            editingNode={editingNode}
            key={node.id}
            node={node}
            openFolders={openFolders}
            onCancelInlineRename={onCancelInlineRename}
            onCommitInlineRename={onCommitInlineRename}
            onContextMenu={onContextMenu}
            onEditingNodeChange={onEditingNodeChange}
            onFileSelect={onFileSelect}
            onFolderToggle={onFolderToggle}
          />
        ))}
    </nav>
  );
}

interface GitVersionPanelProps {
  commitMessage: string;
  loading: boolean;
  status: VersionManagerStatus;
  onCommitAndPush: () => void;
  onCommitMessageChange: (value: string) => void;
  onEnsureRepository: () => void;
  onOpenAccountSettings: () => void;
  onRefresh: () => void;
}

const versionChangeLabels: Record<VersionManagedChange['kind'], string> = {
  added: 'A',
  deleted: 'D',
  modified: 'M'
};

const versionChangeStatusClasses: Record<VersionManagedChange['kind'], string> = {
  added: 'status-a',
  deleted: 'status-d',
  modified: 'status-m'
};

function splitVersionPath(relativePath: string): { directory: string; name: string } {
  const parts = relativePath.split('/').filter(Boolean);

  if (parts.length === 0) {
    return { directory: '', name: relativePath };
  }

  const name = parts[parts.length - 1] ?? relativePath;
  const directoryParts = parts.slice(0, -1);

  return {
    directory: directoryParts.length > 0 ? `${directoryParts.join('/')}/` : '',
    name
  };
}

function getVersionChangeIcon(kind: VersionManagedChange['kind']): JSX.Element {
  if (kind === 'added') {
    return <FilePlus size={14} style={{ color: 'var(--git-added)' }} />;
  }

  if (kind === 'deleted') {
    return <Trash2 size={14} style={{ color: 'var(--git-deleted)' }} />;
  }

  return <FileText size={14} />;
}

function GitVersionPanel({
  commitMessage,
  loading,
  status,
  onCommitAndPush,
  onCommitMessageChange,
  onEnsureRepository,
  onOpenAccountSettings,
  onRefresh
}: GitVersionPanelProps): JSX.Element {
  const repository = status.repository;
  const canCommit = Boolean(repository) && !loading;

  if (!status.github.connected) {
    return (
      <section className="git-panel" aria-label="Veloca version management">
        <div className="git-empty-state">
          <Github size={20} />
          <span>Bind a GitHub account before enabling Veloca version management.</span>
        </div>
        <div className="git-panel-actions">
          <button className="primary-action" type="button" onClick={onOpenAccountSettings}>
            <Github size={15} />
            Account Settings
          </button>
        </div>
      </section>
    );
  }

  if (status.github.requiresRebindForVersionManagement || !status.github.hasVersionManagementScope) {
    return (
      <section className="git-panel" aria-label="Veloca version management">
        <div className="git-empty-state">
          <Info size={20} />
          <span>GitHub is connected, but version management needs repo permission. Rebind GitHub in Account.</span>
        </div>
        <div className="git-panel-actions">
          <button className="primary-action" type="button" onClick={onOpenAccountSettings}>
            <Github size={15} />
            Rebind GitHub
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="git-panel" aria-label="Veloca version management">
      <div className="git-commit-box">
        <textarea
          className="git-textarea"
          disabled={!repository || loading}
          placeholder={repository ? 'Message (Cmd+Enter to commit)' : 'Create the private GitHub repository first'}
          value={commitMessage}
          onChange={(event) => onCommitMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canCommit) {
              event.preventDefault();
              onCommitAndPush();
            }
          }}
        />
        <button
          className="git-btn"
          type="button"
          disabled={repository ? !canCommit : loading}
          onClick={repository ? onCommitAndPush : onEnsureRepository}
        >
          {loading ? <RefreshCw className="spinning" size={16} /> : repository ? <CheckCircle2 size={16} /> : <Github size={16} />}
          {repository ? 'Commit & Push' : 'Create Repository'}
        </button>
      </div>

      <div className="git-scroll-area">
        <div className="git-group-header">
          <div className="git-group-title">
            <ChevronDown size={14} />
            Repository <span className="git-badge-count">{repository ? 1 : 0}</span>
          </div>
          <div className="git-actions">
            <button className="git-action-btn" type="button" title="Refresh" onClick={onRefresh}>
              <RefreshCw className={loading ? 'spinning' : ''} size={14} />
            </button>
          </div>
        </div>

        {repository ? (
          <div className="git-item active">
            <div className="git-item-left">
              <GitBranch size={14} />
              <span className="git-item-name">
                {repository.owner}/{repository.name}
              </span>
              <span className="git-item-dir">private</span>
            </div>
            <div className="git-item-right">
              <div className="git-actions">
                <a className="git-action-btn" href={repository.htmlUrl} rel="noreferrer" target="_blank" title="Open on GitHub">
                  <ExternalLink size={14} />
                </a>
              </div>
              <span className="git-status-badge status-a">R</span>
            </div>
          </div>
        ) : (
          <div className="git-empty-state compact">
            <GitBranch size={17} />
            <span>Create veloca-version-manager before committing Veloca markdown versions.</span>
          </div>
        )}

        <div className="git-group-header with-margin">
          <div className="git-group-title">
            <ChevronDown size={14} />
            Managed Directories <span className="git-badge-count">{status.workspaceConfigs.length}</span>
          </div>
        </div>

        {status.workspaceConfigs.length > 0 ? (
          status.workspaceConfigs.map((config) => (
            <div className="git-item" key={config.workspaceFolderId}>
              <div className="git-item-left">
                <Folder size={14} />
                <span className="git-item-name">{config.displayName}</span>
                <span className="git-item-dir">workspaces/{config.shadowPrefix}</span>
              </div>
              <div className="git-item-right">
                <span className="git-status-badge">{config.managedFileCount}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="git-empty-state compact">
            <Folder size={17} />
            <span>Save a local markdown file to create its managed directory prefix.</span>
          </div>
        )}

        <div className="git-group-header with-margin">
          <div className="git-group-title">
            <ChevronDown size={14} />
            Changes <span className="git-badge-count">{status.pendingChangeCount}</span>
          </div>
        </div>

        {status.changes.length > 0 ? (
          status.changes.map((change) => {
            const pathParts = splitVersionPath(change.relativePath);

            return (
              <div className="git-item" key={change.shadowPath}>
                <div className="git-item-left">
                  {getVersionChangeIcon(change.kind)}
                  <span className="git-item-name">{pathParts.name}</span>
                  {pathParts.directory ? <span className="git-item-dir">{pathParts.directory}</span> : null}
                </div>
                <div className="git-item-right">
                  <span className={`git-status-badge ${versionChangeStatusClasses[change.kind]}`}>
                    {versionChangeLabels[change.kind]}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="git-empty-state compact">
            <CheckCircle2 size={17} />
            <span>No Veloca-managed markdown changes yet.</span>
          </div>
        )}
      </div>
    </section>
  );
}

interface TreeNodeProps {
  activeFilePath: string;
  depth: number;
  editingNode: EditingNodeState | null;
  node: WorkspaceTreeNode;
  openFolders: Record<string, boolean>;
  onCancelInlineRename: () => void;
  onCommitInlineRename: () => void;
  onContextMenu: (event: MouseEvent, node: WorkspaceTreeNode) => void;
  onEditingNodeChange: (value: string) => void;
  onFileSelect: (filePath: string) => void;
  onFolderToggle: (folderId: string) => void;
}

function TreeNode({
  activeFilePath,
  depth,
  editingNode,
  node,
  openFolders,
  onCancelInlineRename,
  onCommitInlineRename,
  onContextMenu,
  onEditingNodeChange,
  onFileSelect,
  onFolderToggle
}: TreeNodeProps): JSX.Element {
  const isOpen = openFolders[node.id] ?? false;
  const paddingLeft = 10 + depth * 18;
  const isDatabaseRoot = node.source === 'database' && node.relativePath === '';
  const isEditing = editingNode?.path === node.path;

  if (node.type === 'file') {
    return (
      <button
        className={activeFilePath === node.path ? 'tree-item active' : 'tree-item'}
        type="button"
        style={{ paddingLeft }}
        onContextMenu={(event) => onContextMenu(event, node)}
        onClick={() => onFileSelect(node.path)}
      >
        <FileText size={14} />
        {isEditing ? (
          <InlineNameInput
            value={editingNode.value}
            onCancel={onCancelInlineRename}
            onChange={onEditingNodeChange}
            onCommit={onCommitInlineRename}
          />
        ) : (
          <span>{node.name}</span>
        )}
      </button>
    );
  }

  return (
    <div className="tree-node">
      <button
        className="tree-item"
        type="button"
        style={{ paddingLeft }}
        onContextMenu={(event) => onContextMenu(event, node)}
        onClick={() => onFolderToggle(node.id)}
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {isDatabaseRoot ? <Database size={14} /> : <Folder size={14} />}
        {isEditing ? (
          <InlineNameInput
            value={editingNode.value}
            onCancel={onCancelInlineRename}
            onChange={onEditingNodeChange}
            onCommit={onCommitInlineRename}
          />
        ) : (
          <span>{node.name}</span>
        )}
      </button>

      {isOpen && (
        <div className="tree-branch">
          {node.children?.map((child) => (
            <TreeNode
              activeFilePath={activeFilePath}
              depth={depth + 1}
              editingNode={editingNode}
              key={child.id}
              node={child}
              openFolders={openFolders}
              onCancelInlineRename={onCancelInlineRename}
              onCommitInlineRename={onCommitInlineRename}
              onContextMenu={onContextMenu}
              onEditingNodeChange={onEditingNodeChange}
              onFileSelect={onFileSelect}
              onFolderToggle={onFolderToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface InlineNameInputProps {
  value: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onCommit: () => void;
}

function InlineNameInput({
  value,
  onCancel,
  onChange,
  onCommit
}: InlineNameInputProps): JSX.Element {
  return (
    <input
      autoFocus
      className="tree-inline-input"
      value={value}
      onBlur={onCommit}
      onChange={(event) => onChange(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }

        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
      onMouseDown={(event) => event.stopPropagation()}
    />
  );
}

interface OutlinePanelProps {
  activeFile: MarkdownFileContent | null;
  activeHeadingId: string;
  sections: MarkdownSection[];
  onHeadingSelect: (headingId: string) => void;
}

function OutlinePanel({
  activeFile,
  activeHeadingId,
  sections,
  onHeadingSelect
}: OutlinePanelProps): JSX.Element {
  if (!activeFile) {
    return (
      <div className="empty-sidebar-state">
        <FileText size={18} />
        <p>Select a markdown file to view its outline.</p>
      </div>
    );
  }

  return (
    <nav className="outline-panel" aria-label="Document outline">
      <div className="outline-list">
        {sections.map((section) => (
          <button
            className={`outline-item level-${Math.min(section.level, 3)} ${
              activeHeadingId === section.id ? 'active' : ''
            }`}
            type="button"
            key={section.id}
            onClick={() => onHeadingSelect(section.id)}
          >
            <span className="outline-marker" />
            <span>{section.title}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

interface MarkdownEditorProps {
  content: string;
  filePath: string;
  onCursorRestoreComplete?: (sequence: number) => void;
  provenanceMarkdownHash?: string | null;
  provenanceSnapshotJson?: string | null;
  restoreCursorOffset?: number | null;
  restoreCursorSequence?: number | null;
  theme: ThemeMode;
  onChange: (content: string) => void;
  onToast: (message: Omit<ToastMessage, 'id'>) => void;
}

interface MarkdownEditorHandle {
  applyAiProvenanceContent: (markdown: string, ranges: AiGeneratedMarkdownRange[]) => JSONContent | null;
  getAiProvenanceRanges: (markdown?: string) => AiGeneratedMarkdownRange[];
  focusAtMarkdownOffset: (offset: number) => void;
  getCursorMarkdownOffset: () => number | null;
  getMarkdownContent: () => string;
  getMarkdownSelectionRange: () => MarkdownSelectionRange | null;
  getProvenanceSnapshot: () => JSONContent | null;
  hasRenderedEdits: () => boolean;
}

interface SourceMarkdownEditorProps {
  content: string;
  filePath: string;
  onCursorRestoreComplete?: (sequence: number) => void;
  restoreCursorOffset?: number | null;
  restoreCursorSequence?: number | null;
  onChange: (content: string) => void;
}

interface SourceMarkdownEditorHandle {
  focusAtOffset: (offset: number) => void;
  getCursorOffset: () => number | null;
  getSelectionRange: () => MarkdownSelectionRange | null;
}

type TableControlsState = {
  columnCount: number;
  columnIndex: number;
  hasAnchor: boolean;
  isHeaderRow: boolean;
  left: number;
  rowCount: number;
  rowIndex: number;
  selectionKind: 'cell' | 'table' | 'text';
  tablePos: number;
  top: number;
};

type TableGridHoverState = {
  columnCount: number;
  rowCount: number;
};

type SlashCommandItem = {
  command: string;
  description: string;
  id: 'codeBlock' | 'mermaid' | 'table';
  Icon: typeof GitBranch;
  label: string;
};

type SlashCommandMenuState = {
  items: SlashCommandItem[];
  left: number;
  query: string;
  range: {
    from: number;
    to: number;
  };
  selectedIndex: number;
  top: number;
};

const TABLE_GRID_MAX_COLUMNS = 10;
const TABLE_GRID_MAX_ROWS = 5;
const TABLE_CONTROL_LEFT_OFFSET = 36;
const TABLE_CONTROL_MIN_VIEWPORT_LEFT = 8;
const SLASH_COMMAND_MENU_WIDTH = 296;
const SLASH_COMMAND_MENU_MARGIN = 12;
const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  {
    command: '/mermaid',
    description: 'Insert a Mermaid diagram block',
    id: 'mermaid',
    Icon: GitBranch,
    label: 'Mermaid Diagram'
  },
  {
    command: '/table',
    description: 'Insert an empty 2 × 2 table',
    id: 'table',
    Icon: Table2,
    label: 'Table'
  },
  {
    command: '/code',
    description: 'Code block command is coming soon',
    id: 'codeBlock',
    Icon: Code2,
    label: 'Code Block'
  }
];

function clampSlashMenuIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(index, itemCount - 1));
}

function getSlashCommandContext(editor: TiptapEditor):
  | {
      items: SlashCommandItem[];
      query: string;
      range: {
        from: number;
        to: number;
      };
    }
  | null {
  const { empty, $from, $to } = editor.state.selection;
  const paragraphNodeType = editor.state.schema.nodes.paragraph;

  if (
    !empty ||
    !$from.sameParent($to) ||
    $from.depth !== 1 ||
    $from.parent.type !== paragraphNodeType ||
    $from.parentOffset !== $from.parent.content.size
  ) {
    return null;
  }

  const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  const match = /(^|\s)\/([a-z]*)$/i.exec(textBeforeCursor);

  if (!match) {
    return null;
  }

  const query = match[2].toLowerCase();
  const slashIndex = textBeforeCursor.length - query.length - 1;
  const items = SLASH_COMMAND_ITEMS.filter((item) => {
    const normalizedCommand = item.command.slice(1).toLowerCase();
    return normalizedCommand.startsWith(query) || item.label.toLowerCase().includes(query);
  });

  if (!items.length) {
    return null;
  }

  return {
    items,
    query,
    range: {
      from: $from.start() + slashIndex,
      to: $from.pos
    }
  };
}

function getSlashCommandMenuPosition(
  editor: TiptapEditor,
  range: SlashCommandMenuState['range'],
  shell: HTMLElement
): Pick<SlashCommandMenuState, 'left' | 'top'> {
  const commandRect = editor.view.coordsAtPos(range.from);
  const shellRect = shell.getBoundingClientRect();
  const maxLeft = Math.max(SLASH_COMMAND_MENU_MARGIN, shellRect.width - SLASH_COMMAND_MENU_WIDTH - SLASH_COMMAND_MENU_MARGIN);

  return {
    left: Math.min(Math.max(commandRect.left - shellRect.left, SLASH_COMMAND_MENU_MARGIN), maxLeft),
    top: Math.max(commandRect.bottom - shellRect.top + 8, SLASH_COMMAND_MENU_MARGIN)
  };
}

function buildEmptyTableContent(): Record<string, unknown> {
  return {
    type: 'table',
    content: Array.from({ length: 2 }, () => ({
      type: 'tableRow',
      content: Array.from({ length: 2 }, () => ({
        type: 'tableCell',
        content: [{ type: 'paragraph' }]
      }))
    }))
  };
}

function insertSlashCommandBlock(
  editor: TiptapEditor,
  menu: SlashCommandMenuState,
  blockContent: Record<string, unknown>
): boolean {
  const { empty, $from, $to } = editor.state.selection;
  const paragraphNodeType = editor.state.schema.nodes.paragraph;

  if (!empty || !$from.sameParent($to) || $from.depth !== 1 || $from.parent.type !== paragraphNodeType) {
    return false;
  }

  const paragraphStart = $from.before();
  const paragraphEnd = $from.after();
  const slashOffset = menu.range.from - $from.start();
  const prefixText = $from.parent.textBetween(0, Math.max(0, slashOffset), undefined, '\ufffc').trimEnd();
  const nextContent = prefixText
    ? [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: prefixText }]
        },
        blockContent,
        { type: 'paragraph' }
      ]
    : [blockContent, { type: 'paragraph' }];

  return editor.chain().focus().insertContentAt({ from: paragraphStart, to: paragraphEnd }, nextContent).run();
}

function createSourceCursorMarker(): string {
  return `${sourceCursorMarkerPrefix}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function findTextMarkerRange(
  doc: ProseMirrorNode,
  marker: string
): {
  from: number;
  to: number;
} | null {
  let range: { from: number; to: number } | null = null;

  doc.descendants((node, pos) => {
    if (range) {
      return false;
    }

    if (!node.isText || typeof node.text !== 'string') {
      return true;
    }

    const markerIndex = node.text.indexOf(marker);

    if (markerIndex < 0) {
      return true;
    }

    range = {
      from: pos + markerIndex,
      to: pos + markerIndex + marker.length
    };
    return false;
  });

  return range;
}

function getClosestTextSelection(editor: TiptapEditor, pos: number): Selection {
  const docSize = editor.state.doc.content.size;
  const safePos = clampNumber(pos, 0, docSize);
  const resolvedPos = editor.state.doc.resolve(safePos);

  return TextSelection.near(resolvedPos);
}

function getEditorScrollContainer(element: HTMLElement | null): HTMLElement | null {
  return element?.closest<HTMLElement>('.editor-pane-scroll, .editor-scroll-area') ?? null;
}

function scrollRectIntoEditorView(scrollContainer: HTMLElement, targetRect: Pick<DOMRect, 'top' | 'bottom'>): void {
  const containerRect = scrollContainer.getBoundingClientRect();
  const padding = Math.min(96, Math.max(32, containerRect.height * 0.18));
  const topLimit = containerRect.top + padding;
  const bottomLimit = containerRect.bottom - padding;

  if (targetRect.top < topLimit) {
    scrollContainer.scrollTop -= topLimit - targetRect.top;
    return;
  }

  if (targetRect.bottom > bottomLimit) {
    scrollContainer.scrollTop += targetRect.bottom - bottomLimit;
  }
}

function getTextareaCaretViewportRect(textarea: HTMLTextAreaElement): DOMRect | null {
  const style = window.getComputedStyle(textarea);
  const textareaRect = textarea.getBoundingClientRect();
  const mirror = document.createElement('div');
  const marker = document.createElement('span');
  const caretOffset = clampNumber(textarea.selectionStart ?? textarea.value.length, 0, textarea.value.length);
  const mirroredStyleProperties = [
    'boxSizing',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'textAlign',
    'textTransform',
    'tabSize',
    'wordBreak'
  ] as const;

  mirroredStyleProperties.forEach((property) => {
    mirror.style[property] = style[property];
  });

  mirror.style.position = 'fixed';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.top = `${textareaRect.top}px`;
  mirror.style.left = `${textareaRect.left}px`;
  mirror.style.width = `${textareaRect.width}px`;
  mirror.style.minHeight = '0';

  marker.textContent = '\u200b';
  mirror.append(document.createTextNode(textarea.value.slice(0, caretOffset)), marker);
  document.body.append(mirror);

  try {
    return marker.getBoundingClientRect();
  } finally {
    mirror.remove();
  }
}

const SourceMarkdownEditor = forwardRef<SourceMarkdownEditorHandle, SourceMarkdownEditorProps>(
  function SourceMarkdownEditor({
    content,
    filePath,
    onCursorRestoreComplete,
    restoreCursorOffset,
    restoreCursorSequence,
    onChange
  }: SourceMarkdownEditorProps, ref): JSX.Element {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const cursorFollowFrameRef = useRef(0);

    const resizeTextarea = useCallback(() => {
      const textarea = textareaRef.current;

      if (!textarea) {
        return;
      }

      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(480, textarea.scrollHeight)}px`;
    }, []);

    const queueCursorFollow = useCallback(() => {
      window.cancelAnimationFrame(cursorFollowFrameRef.current);
      cursorFollowFrameRef.current = window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;

        if (!textarea || document.activeElement !== textarea) {
          return;
        }

        resizeTextarea();
        const caretRect = getTextareaCaretViewportRect(textarea);
        const scrollContainer = getEditorScrollContainer(textarea);

        if (caretRect && scrollContainer) {
          scrollRectIntoEditorView(scrollContainer, caretRect);
        }
      });
    }, [resizeTextarea]);

    const focusAtOffset = useCallback((offset: number) => {
      const textarea = textareaRef.current;

      if (!textarea) {
        return;
      }

      const nextOffset = clampNumber(offset, 0, textarea.value.length);
      textarea.focus();
      textarea.setSelectionRange(nextOffset, nextOffset);
    }, []);

    const getCursorOffset = useCallback((): number | null => {
      return textareaRef.current?.selectionStart ?? null;
    }, []);

    const getSelectionRange = useCallback((): MarkdownSelectionRange | null => {
      const textarea = textareaRef.current;

      if (!textarea) {
        return null;
      }

      return {
        from: textarea.selectionStart,
        to: textarea.selectionEnd
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focusAtOffset,
        getCursorOffset,
        getSelectionRange
      }),
      [focusAtOffset, getCursorOffset, getSelectionRange]
    );

    useEffect(() => {
      resizeTextarea();
    }, [content, resizeTextarea]);

    useEffect(() => {
      return () => window.cancelAnimationFrame(cursorFollowFrameRef.current);
    }, []);

    useEffect(() => {
      if (typeof restoreCursorOffset !== 'number' || restoreCursorSequence === null || restoreCursorSequence === undefined) {
        return;
      }

      window.requestAnimationFrame(() => {
        focusAtOffset(restoreCursorOffset);
        onCursorRestoreComplete?.(restoreCursorSequence);
      });
    }, [focusAtOffset, onCursorRestoreComplete, restoreCursorOffset, restoreCursorSequence]);

    return (
      <div className="veloca-source-editor" data-file-path={filePath}>
        <textarea
          aria-label="Markdown source editor"
          className="veloca-source-textarea"
          ref={textareaRef}
          spellCheck={false}
          value={content}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            resizeTextarea();
            queueCursorFollow();
          }}
        />
      </div>
    );
  }
);

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({
  content,
  filePath,
  onCursorRestoreComplete,
  provenanceMarkdownHash,
  provenanceSnapshotJson,
  restoreCursorOffset,
  restoreCursorSequence,
  theme,
  onChange,
  onToast
}: MarkdownEditorProps, ref): JSX.Element {
  const contentRef = useRef(content);
  const activeFilePathRef = useRef(filePath);
  const lastEditorContentRef = useRef(content);
  const lastProvenanceSnapshotJsonRef = useRef(provenanceSnapshotJson);
  const editorInstanceRef = useRef<ReturnType<typeof useEditor> | null>(null);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const tableControlsRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  const onToastRef = useRef(onToast);
  const syncingRef = useRef(false);
  const renderedDirtyRef = useRef(false);
  const cursorFollowFrameRef = useRef(0);
  const [tableControls, setTableControls] = useState<TableControlsState | null>(null);
  const [tableGridOpen, setTableGridOpen] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [tableGridHover, setTableGridHover] = useState<TableGridHoverState | null>(null);
  const [slashCommandMenu, setSlashCommandMenu] = useState<SlashCommandMenuState | null>(null);
  const slashCommandMenuRef = useRef<SlashCommandMenuState | null>(null);
  const contentMarkdownHash = useMemo(() => hashMarkdownContent(content), [content]);
  const storedProvenanceSnapshot = useMemo(
    () => parseStoredAiProvenanceSnapshot(provenanceSnapshotJson),
    [provenanceSnapshotJson]
  );
  const provenanceSnapshot = useMemo(() => {
    if (provenanceMarkdownHash !== contentMarkdownHash || !storedProvenanceSnapshot) {
      return null;
    }

    return storedProvenanceSnapshot.version === 1
      ? storedProvenanceSnapshot.snapshot
      : storedProvenanceSnapshot.snapshot;
  }, [contentMarkdownHash, provenanceMarkdownHash, storedProvenanceSnapshot]);
  const provenanceMarkSnapshot = useMemo(() => {
    if (
      provenanceMarkdownHash !== contentMarkdownHash ||
      !storedProvenanceSnapshot ||
      storedProvenanceSnapshot.version !== 2
    ) {
      return null;
    }

    return storedProvenanceSnapshot.markSnapshot ?? storedProvenanceSnapshot.snapshot ?? null;
  }, [contentMarkdownHash, provenanceMarkdownHash, storedProvenanceSnapshot]);
  const provenanceRanges = useMemo(() => {
    if (
      provenanceMarkdownHash !== contentMarkdownHash ||
      !storedProvenanceSnapshot ||
      storedProvenanceSnapshot.version !== 2
    ) {
      return [];
    }

    return filterValidAiProvenanceRanges(content, storedProvenanceSnapshot.ranges);
  }, [content, contentMarkdownHash, provenanceMarkdownHash, storedProvenanceSnapshot]);

  const updateSlashCommandMenu = useCallback((nextMenu: SlashCommandMenuState | null) => {
    slashCommandMenuRef.current = nextMenu;
    setSlashCommandMenu(nextMenu);
  }, []);

  const runSlashCommand = useCallback(
    (item: SlashCommandItem, menu: SlashCommandMenuState | null = slashCommandMenuRef.current) => {
      const currentEditor = editorInstanceRef.current;

      if (!currentEditor || !menu) {
        return;
      }

      if (item.id === 'mermaid') {
        currentEditor
          .chain()
          .focus()
          .insertContentAt(menu.range, item.command)
          .setTextSelection(menu.range.from + item.command.length)
          .run();
        insertMermaidBlockFromCommand(currentEditor);
      }

      if (item.id === 'table') {
        insertSlashCommandBlock(currentEditor, menu, buildEmptyTableContent());
      }

      if (item.id === 'codeBlock') {
        onToastRef.current({
          type: 'info',
          title: 'Command Not Ready',
          description: 'Code block insertion will be added in a later step.'
        });
      }

      updateSlashCommandMenu(null);
    },
    [updateSlashCommandMenu]
  );

  const handleSlashCommandKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      const menu = slashCommandMenuRef.current;

      if (!menu) {
        return false;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (menu.selectedIndex + direction + menu.items.length) % menu.items.length;
        updateSlashCommandMenu({
          ...menu,
          selectedIndex: nextIndex
        });
        return true;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        runSlashCommand(menu.items[clampSlashMenuIndex(menu.selectedIndex, menu.items.length)], menu);
        return true;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        updateSlashCommandMenu(null);
        return true;
      }

      return false;
    },
    [runSlashCommand, updateSlashCommandMenu]
  );

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onToastRef.current = onToast;
  }, [onToast]);

  const extensions = useMemo(
    () =>
      createRichEditorExtensions({
        onFileDrop: async (currentEditor, files, pos) => {
          if (!window.veloca || files.length === 0) {
            return;
          }

          if (isUntitledFilePath(activeFilePathRef.current)) {
            onToastRef.current({
              type: 'info',
              title: 'Save File First',
              description: 'Choose a workspace location before attaching media.'
            });
            return;
          }

          const insertionContent: Array<Record<string, unknown>> = [];

          for (const file of files) {
            const mediaCategory = getMediaCategory(file.type, file.name);

            if (!mediaCategory) {
              onToastRef.current({
                type: 'info',
                title: 'Unsupported Media',
                description: `${file.name} is not a supported image, audio, or video file.`
              });
              continue;
            }

            const maxSize = MEDIA_LIMITS[mediaCategory];

            if (file.size > maxSize) {
              onToastRef.current({
                type: 'info',
                title: 'Media Too Large',
                description: `${file.name} exceeds the current ${mediaCategory} size limit.`
              });
              continue;
            }

            try {
              const payload: WorkspaceAssetPayload = {
                data: await file.arrayBuffer(),
                fileName: file.name,
                mimeType: file.type || guessMimeTypeFromName(file.name)
              };
              const savedAsset = await window.veloca.workspace.saveAsset(activeFilePathRef.current, payload);
              insertionContent.push(buildMediaInsertContent(savedAsset, file.name));
            } catch {
              onToastRef.current({
                type: 'info',
                title: 'Attachment Failed',
                description: `Veloca could not attach ${file.name}.`
              });
            }
          }

          if (!insertionContent.length) {
            return;
          }

          const nodes = insertionContent.flatMap((node, index) =>
            index === 0 ? [node] : [{ type: 'paragraph' }, node]
          );

          if (typeof pos === 'number') {
            currentEditor.chain().focus().insertContentAt(pos, nodes).run();
            return;
          }

          currentEditor.chain().focus().insertContent(nodes).run();
        },
        onPasteMediaUrl: async (currentEditor, url) => {
          const mediaNode = buildMediaNodeFromUrl(url);

          if (!mediaNode) {
            return false;
          }

          currentEditor.chain().focus().insertContent(mediaNode).run();
          return true;
        },
        onUpdateBlockMath: (pos, latex) => {
          editorInstanceRef.current?.commands.updateBlockMath({ latex, pos });
        },
        onUpdateInlineMath: (pos, latex) => {
          editorInstanceRef.current?.commands.updateInlineMath({ latex, pos });
        }
      }),
    []
  );

  const queueCursorFollow = useCallback((currentEditor: TiptapEditor) => {
    window.cancelAnimationFrame(cursorFollowFrameRef.current);
    cursorFollowFrameRef.current = window.requestAnimationFrame(() => {
      if (!currentEditor.isFocused || editorInstanceRef.current !== currentEditor) {
        return;
      }

      const scrollContainer = getEditorScrollContainer(editorShellRef.current);

      if (!scrollContainer) {
        return;
      }

      try {
        scrollRectIntoEditorView(scrollContainer, currentEditor.view.coordsAtPos(currentEditor.state.selection.from));
      } catch {
        // Some node selections do not expose usable caret coordinates.
      }
    });
  }, []);

  const editor = useEditor(
    {
      content: provenanceSnapshot ?? transformMarkdownForEditor(content),
      contentType: provenanceSnapshot ? 'json' : 'markdown',
      editorProps: {
        attributes: {
          class: theme === 'dark' ? 'veloca-prosemirror theme-dark' : 'veloca-prosemirror theme-light'
        },
        handleDOMEvents: {
          mousedown: (_, event) => {
            const targetNode = event.target;
            const target =
              targetNode instanceof HTMLElement
                ? targetNode
                : targetNode instanceof Node
                  ? targetNode.parentElement
                  : null;

            if (!(target instanceof HTMLElement)) {
              return false;
            }

            const wrapper = target.closest('.tableWrapper');

            if (!wrapper) {
              return false;
            }

            const isInCell = target.closest('td, th');

            if (!isInCell) {
              return true;
            }

            return false;
          },
          wheel: (_, event) => {
            const targetNode = event.target;
            const target =
              targetNode instanceof HTMLElement
                ? targetNode
                : targetNode instanceof Node
                  ? targetNode.parentElement
                  : null;

            if (!(target instanceof HTMLElement)) {
              return false;
            }

            const wrapper = target.closest('.tableWrapper');
            if (!(wrapper instanceof HTMLElement)) {
              return false;
            }

            const wheelEvent = event as WheelEvent;
            const horizontalDelta = wheelEvent.deltaX === 0 && wheelEvent.shiftKey ? wheelEvent.deltaY : wheelEvent.deltaX;

            if (horizontalDelta === 0) {
              return false;
            }

            event.preventDefault();
            wrapper.scrollLeft += horizontalDelta;
            return true;
          }
        },
        handleKeyDown: (_view, event) => handleSlashCommandKeyDown(event),
        handlePaste: (view, event) => {
          const clipboard = event.clipboardData;

          if (!clipboard) {
            return false;
          }

          const html = clipboard.getData('text/html').trim();

          if (html && /<(details|iframe|audio|video|section)\b/i.test(html)) {
            event.preventDefault();
            editorInstanceRef.current?.chain().focus().insertContent(html, { contentType: 'html' }).run();
            return true;
          }

          const pastedText = clipboard.getData('text/plain').trim();
          const mediaUrl = extractFirstMediaUrl(pastedText);

          if (!mediaUrl) {
            return false;
          }

          const mediaNode = buildMediaNodeFromUrl(mediaUrl);

          if (!mediaNode) {
            return false;
          }

          event.preventDefault();
          editorInstanceRef.current?.chain().focus().insertContent(mediaNode).run();
          return true;
        }
      },
      extensions,
      immediatelyRender: false,
      onCreate: ({ editor: currentEditor }) => {
        editorInstanceRef.current = currentEditor;
        renderedDirtyRef.current = false;
        void hydrateDocumentAssets(currentEditor, activeFilePathRef.current, resolveAssetForEditor);
      },
      onUpdate: ({ editor: currentEditor }) => {
        if (syncingRef.current) {
          return;
        }

        renderedDirtyRef.current = true;
        const nextMarkdown = transformMarkdownFromEditor(getEditorMarkdown(currentEditor));
        lastEditorContentRef.current = nextMarkdown;

        if (nextMarkdown !== contentRef.current) {
          onChangeRef.current(nextMarkdown);
        }

        queueCursorFollow(currentEditor);
        void hydrateDocumentAssets(currentEditor, activeFilePathRef.current, resolveAssetForEditor);
      }
    },
    [filePath, handleSlashCommandKeyDown, queueCursorFollow]
  );

  useEffect(() => {
    if (!editor) {
      return;
    }

    const fileChanged = activeFilePathRef.current !== filePath;
    const isExternalContentChange = content !== lastEditorContentRef.current;
    const isProvenanceChange = provenanceSnapshotJson !== lastProvenanceSnapshotJsonRef.current;
    const needsRangeSnapshot = !provenanceSnapshot && provenanceRanges.length > 0;

    activeFilePathRef.current = filePath;
    lastProvenanceSnapshotJsonRef.current = provenanceSnapshotJson;

    if (!fileChanged && !isExternalContentChange && !isProvenanceChange && !needsRangeSnapshot) {
      return;
    }

    const currentMarkdown = transformMarkdownFromEditor(getEditorMarkdown(editor));
    const currentHasAiProvenance = documentSnapshotHasAiProvenance(editor.state.doc.toJSON() as JSONContent);
    const incomingNeedsAiProvenance =
      documentSnapshotHasAiProvenance(provenanceSnapshot) ||
      documentSnapshotHasAiProvenance(provenanceMarkSnapshot) ||
      provenanceRanges.length > 0;

    if (!fileChanged && currentMarkdown === content && (!incomingNeedsAiProvenance || currentHasAiProvenance)) {
      lastEditorContentRef.current = content;
      return;
    }

    const nextProvenanceSnapshot =
      provenanceSnapshot ?? createAiProvenanceDocument(editor, content, provenanceRanges, provenanceMarkSnapshot) ?? null;

    syncingRef.current = true;
    editor.commands.setContent(nextProvenanceSnapshot ?? transformMarkdownForEditor(content), {
      contentType: nextProvenanceSnapshot ? 'json' : 'markdown',
      emitUpdate: false
    });
    syncingRef.current = false;
    lastEditorContentRef.current = content;
    renderedDirtyRef.current = false;
    void hydrateDocumentAssets(editor, filePath, resolveAssetForEditor);
  }, [content, editor, filePath, provenanceMarkSnapshot, provenanceRanges, provenanceSnapshot]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          ...(editor.options.editorProps.attributes ?? {}),
          class: theme === 'dark' ? 'veloca-prosemirror theme-dark' : 'veloca-prosemirror theme-light'
        }
      }
    });
  }, [editor, theme]);

  useEffect(() => {
    editorInstanceRef.current = editor;
  }, [editor]);

  useEffect(() => {
    return () => window.cancelAnimationFrame(cursorFollowFrameRef.current);
  }, []);

  const getCursorMarkdownOffset = useCallback((): number | null => {
    const currentEditor = editorInstanceRef.current;

    if (!currentEditor) {
      return null;
    }

    const marker = createSourceCursorMarker();
    const insertPos = currentEditor.state.selection.from;
    const originalFrom = currentEditor.state.selection.from;
    const originalTo = currentEditor.state.selection.to;

    syncingRef.current = true;

    try {
      currentEditor.view.dispatch(currentEditor.state.tr.insertText(marker, insertPos));
      const markdownWithMarker = transformMarkdownFromEditor(getEditorMarkdown(currentEditor));
      const markerOffset = markdownWithMarker.indexOf(marker);
      const deleteTo = Math.min(insertPos + marker.length, currentEditor.state.doc.content.size);
      currentEditor.view.dispatch(currentEditor.state.tr.delete(insertPos, deleteTo));

      const selectionFrom = clampNumber(originalFrom, 0, currentEditor.state.doc.content.size);
      const selectionTo = clampNumber(originalTo, selectionFrom, currentEditor.state.doc.content.size);
      currentEditor.view.dispatch(
        currentEditor.state.tr.setSelection(TextSelection.create(currentEditor.state.doc, selectionFrom, selectionTo))
      );

      return markerOffset >= 0 ? markerOffset : null;
    } catch {
      return null;
    } finally {
      syncingRef.current = false;
      lastEditorContentRef.current = contentRef.current;
    }
  }, []);

  const getMarkdownSelectionRange = useCallback((): MarkdownSelectionRange | null => {
    const currentEditor = editorInstanceRef.current;

    if (!currentEditor) {
      return null;
    }

    const { from, to } = currentEditor.state.selection;

    if (from === to) {
      const cursorOffset = getCursorMarkdownOffset();
      return typeof cursorOffset === 'number'
        ? {
            from: cursorOffset,
            to: cursorOffset
          }
        : null;
    }

    const startMarker = createSourceCursorMarker();
    const endMarker = createSourceCursorMarker();
    const originalFrom = from;
    const originalTo = to;

    syncingRef.current = true;

    try {
      let transaction = currentEditor.state.tr.insertText(endMarker, originalTo);
      transaction = transaction.insertText(startMarker, originalFrom);
      currentEditor.view.dispatch(transaction);

      const markdownWithMarkers = transformMarkdownFromEditor(getEditorMarkdown(currentEditor));
      const startOffset = markdownWithMarkers.indexOf(startMarker);
      const endOffsetWithStartMarker = markdownWithMarkers.indexOf(endMarker);
      const startRange = findTextMarkerRange(currentEditor.state.doc, startMarker);
      const endRange = findTextMarkerRange(currentEditor.state.doc, endMarker);
      let cleanupTransaction = currentEditor.state.tr;

      if (endRange) {
        cleanupTransaction = cleanupTransaction.delete(endRange.from, endRange.to);
      }

      if (startRange) {
        cleanupTransaction = cleanupTransaction.delete(startRange.from, startRange.to);
      }

      const selectionFrom = clampNumber(originalFrom, 0, cleanupTransaction.doc.content.size);
      const selectionTo = clampNumber(originalTo, selectionFrom, cleanupTransaction.doc.content.size);
      currentEditor.view.dispatch(
        cleanupTransaction.setSelection(TextSelection.create(cleanupTransaction.doc, selectionFrom, selectionTo))
      );

      if (startOffset < 0 || endOffsetWithStartMarker < 0) {
        return null;
      }

      return {
        from: startOffset,
        to: Math.max(startOffset, endOffsetWithStartMarker - startMarker.length)
      };
    } catch {
      return null;
    } finally {
      syncingRef.current = false;
      lastEditorContentRef.current = contentRef.current;
    }
  }, [getCursorMarkdownOffset]);

  const focusAtMarkdownOffset = useCallback((offset: number) => {
    const currentEditor = editorInstanceRef.current;

    if (!currentEditor) {
      return;
    }

    const currentContent = contentRef.current;
    const safeOffset = clampNumber(offset, 0, currentContent.length);
    const marker = createSourceCursorMarker();
    const markedContent = `${currentContent.slice(0, safeOffset)}${marker}${currentContent.slice(safeOffset)}`;
    const temporaryRanges = insertTemporaryTextIntoAiProvenanceRanges(provenanceRanges, safeOffset, marker);
    const temporarySnapshot =
      temporaryRanges.length > 0
        ? createAiProvenanceDocument(currentEditor, markedContent, temporaryRanges, provenanceMarkSnapshot)
        : null;
    const restoredSnapshot =
      provenanceSnapshot ??
      createAiProvenanceDocument(currentEditor, currentContent, provenanceRanges, provenanceMarkSnapshot) ??
      null;

    syncingRef.current = true;

    try {
      currentEditor.commands.setContent(temporarySnapshot ?? transformMarkdownForEditor(markedContent), {
        contentType: temporarySnapshot ? 'json' : 'markdown',
        emitUpdate: false
      });

      const markerRange = findTextMarkerRange(currentEditor.state.doc, marker);

      if (!markerRange) {
        currentEditor.commands.setContent(restoredSnapshot ?? transformMarkdownForEditor(currentContent), {
          contentType: restoredSnapshot ? 'json' : 'markdown',
          emitUpdate: false
        });
        currentEditor.commands.focus();
        currentEditor.view.dispatch(
          currentEditor.state.tr.setSelection(getClosestTextSelection(currentEditor, safeOffset))
        );
        return;
      }

      currentEditor.commands.setContent(restoredSnapshot ?? transformMarkdownForEditor(currentContent), {
        contentType: restoredSnapshot ? 'json' : 'markdown',
        emitUpdate: false
      });

      const selectionPos = clampNumber(markerRange.from, 0, currentEditor.state.doc.content.size);
      currentEditor.view.dispatch(
        currentEditor.state.tr.setSelection(getClosestTextSelection(currentEditor, selectionPos))
      );
      currentEditor.commands.focus();
    } finally {
      syncingRef.current = false;
      lastEditorContentRef.current = contentRef.current;
      void hydrateDocumentAssets(currentEditor, activeFilePathRef.current, resolveAssetForEditor);
    }
  }, [provenanceMarkSnapshot, provenanceRanges, provenanceSnapshot]);

  const applyAiProvenanceContent = useCallback((markdown: string, ranges: AiGeneratedMarkdownRange[]): JSONContent | null => {
    const currentEditor = editorInstanceRef.current;

    if (!currentEditor) {
      logAiInsertDebug('MarkdownEditor handle has no editor instance for provenance content', {
        filePath
      });
      return null;
    }

    const snapshot = createAiProvenanceDocument(currentEditor, markdown, ranges);

    if (!snapshot) {
      return null;
    }

    syncingRef.current = true;

    try {
      currentEditor.commands.setContent(snapshot, {
        contentType: 'json',
        emitUpdate: false
      });
      currentEditor.commands.focus();
      contentRef.current = markdown;
      lastEditorContentRef.current = markdown;
      renderedDirtyRef.current = false;
      void hydrateDocumentAssets(currentEditor, activeFilePathRef.current, resolveAssetForEditor);
    } finally {
      syncingRef.current = false;
    }

    logAiInsertDebug('MarkdownEditor applied AI provenance content', {
      filePath,
      rangeCount: ranges.length
    });

    return snapshot;
  }, [filePath]);

  const hasRenderedEdits = useCallback((): boolean => renderedDirtyRef.current, []);

  const getAiProvenanceRanges = useCallback((markdown?: string): AiGeneratedMarkdownRange[] => {
    const currentEditor = editorInstanceRef.current;

    return currentEditor ? getAiProvenanceRangesFromEditor(currentEditor, markdown) : [];
  }, []);

  const getMarkdownContent = useCallback((): string => {
    const currentEditor = editorInstanceRef.current;

    return currentEditor ? transformMarkdownFromEditor(getEditorMarkdown(currentEditor)) : contentRef.current;
  }, []);

  const getProvenanceSnapshot = useCallback((): JSONContent | null => {
    const currentEditor = editorInstanceRef.current;

    return currentEditor ? (currentEditor.state.doc.toJSON() as JSONContent) : null;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focusAtMarkdownOffset,
      getAiProvenanceRanges,
      getCursorMarkdownOffset,
      getMarkdownSelectionRange,
      getMarkdownContent,
      getProvenanceSnapshot,
      applyAiProvenanceContent,
      hasRenderedEdits
    }),
    [
      applyAiProvenanceContent,
      focusAtMarkdownOffset,
      getAiProvenanceRanges,
      getCursorMarkdownOffset,
      getMarkdownContent,
      getMarkdownSelectionRange,
      getProvenanceSnapshot,
      hasRenderedEdits
    ]
  );

  useEffect(() => {
    if (typeof restoreCursorOffset !== 'number' || restoreCursorSequence === null || restoreCursorSequence === undefined) {
      return;
    }

    window.requestAnimationFrame(() => {
      focusAtMarkdownOffset(restoreCursorOffset);
      onCursorRestoreComplete?.(restoreCursorSequence);
    });
  }, [focusAtMarkdownOffset, onCursorRestoreComplete, restoreCursorOffset, restoreCursorSequence]);

  useEffect(() => {
    if (!editor) {
      updateSlashCommandMenu(null);
      return;
    }

    let frameId = 0;
    const scrollContainer = editorShellRef.current?.closest('.editor-pane-scroll, .editor-scroll-area');

    const syncSlashCommandMenu = () => {
      const shell = editorShellRef.current;
      const context = getSlashCommandContext(editor);

      if (!shell || !context) {
        updateSlashCommandMenu(null);
        return;
      }

      const position = getSlashCommandMenuPosition(editor, context.range, shell);
      const previousMenu = slashCommandMenuRef.current;
      const selectedIndex =
        previousMenu?.query === context.query
          ? clampSlashMenuIndex(previousMenu.selectedIndex, context.items.length)
          : 0;

      updateSlashCommandMenu({
        ...context,
        ...position,
        selectedIndex
      });
    };

    const queueSlashCommandMenuSync = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncSlashCommandMenu);
    };
    const hideSlashCommandMenu = () => updateSlashCommandMenu(null);

    queueSlashCommandMenuSync();
    editor.on('focus', queueSlashCommandMenuSync);
    editor.on('selectionUpdate', queueSlashCommandMenuSync);
    editor.on('update', queueSlashCommandMenuSync);
    editor.on('blur', hideSlashCommandMenu);
    scrollContainer?.addEventListener('scroll', queueSlashCommandMenuSync, { passive: true });
    window.addEventListener('resize', queueSlashCommandMenuSync);

    return () => {
      window.cancelAnimationFrame(frameId);
      editor.off('focus', queueSlashCommandMenuSync);
      editor.off('selectionUpdate', queueSlashCommandMenuSync);
      editor.off('update', queueSlashCommandMenuSync);
      editor.off('blur', hideSlashCommandMenu);
      scrollContainer?.removeEventListener('scroll', queueSlashCommandMenuSync);
      window.removeEventListener('resize', queueSlashCommandMenuSync);
    };
  }, [editor, updateSlashCommandMenu]);

  const getActiveTableWrapperElement = (currentEditor: TiptapEditor) => {
    const activeTableInfo = getActiveTableInfo(currentEditor);

    if (!activeTableInfo) {
      return null;
    }

    const directDom = currentEditor.view.nodeDOM(activeTableInfo.tablePos);

    if (directDom instanceof HTMLElement) {
      if (directDom.classList.contains('tableWrapper')) {
        return {
          info: activeTableInfo,
          wrapper: directDom
        };
      }

      const directWrapper = directDom.closest('.tableWrapper');

      if (directWrapper instanceof HTMLElement) {
        return {
          info: activeTableInfo,
          wrapper: directWrapper
        };
      }
    }

    const selectionDom = currentEditor.view.domAtPos(currentEditor.state.selection.from).node;
    const selectionElement = selectionDom instanceof HTMLElement ? selectionDom : selectionDom.parentElement;
    const wrapper = selectionElement?.closest('.tableWrapper');

    if (!(wrapper instanceof HTMLElement)) {
      const tableElement = selectionElement?.closest('table');

      if (tableElement instanceof HTMLElement) {
        return {
          info: activeTableInfo,
          wrapper: tableElement
        };
      }

      return null;
    }

    return {
      info: activeTableInfo,
      wrapper
    };
  };

  useEffect(() => {
    if (!editor) {
      setTableControls(null);
      setTableGridOpen(false);
      setTableMenuOpen(false);
      setTableGridHover(null);
      return;
    }

    let frameId = 0;
    let resizeObserver: ResizeObserver | null = null;
    let observedWrapper: HTMLElement | null = null;
    const scrollContainer = editorShellRef.current?.closest('.editor-pane-scroll, .editor-scroll-area');

    const updateObservedWrapper = (wrapper: HTMLElement | null) => {
      if (observedWrapper === wrapper) {
        return;
      }

      resizeObserver?.disconnect();
      resizeObserver = null;
      observedWrapper = wrapper;

      if (wrapper && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          queueTableControlsSync();
        });
        resizeObserver.observe(wrapper);
      }
    };

    const syncTableControls = () => {
      const tableWrapperContext = getActiveTableWrapperElement(editor);

      if (!tableWrapperContext) {
        updateObservedWrapper(null);
        setTableControls(null);
        setTableGridOpen(false);
        setTableMenuOpen(false);
        setTableGridHover(null);
        return;
      }

      updateObservedWrapper(tableWrapperContext.wrapper);
      const wrapperRect = tableWrapperContext.wrapper.getBoundingClientRect();

      setTableControls({
        ...tableWrapperContext.info,
        left: Math.max(TABLE_CONTROL_MIN_VIEWPORT_LEFT, wrapperRect.left - TABLE_CONTROL_LEFT_OFFSET),
        top: wrapperRect.top + 12
      });
    };

    const queueTableControlsSync = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncTableControls);
    };

    queueTableControlsSync();
    editor.on('focus', queueTableControlsSync);
    editor.on('selectionUpdate', queueTableControlsSync);
    editor.on('update', queueTableControlsSync);
    scrollContainer?.addEventListener('scroll', queueTableControlsSync, { passive: true });
    window.addEventListener('resize', queueTableControlsSync);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      editor.off('focus', queueTableControlsSync);
      editor.off('selectionUpdate', queueTableControlsSync);
      editor.off('update', queueTableControlsSync);
      scrollContainer?.removeEventListener('scroll', queueTableControlsSync);
      window.removeEventListener('resize', queueTableControlsSync);
    };
  }, [editor]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | globalThis.MouseEvent) => {
      if (!tableControlsRef.current?.contains(event.target as Node | null)) {
        setTableGridOpen(false);
        setTableMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  const refreshTableControls = () => {
    if (!editor) {
      return;
    }

    window.requestAnimationFrame(() => {
      const tableWrapperContext = getActiveTableWrapperElement(editor);

      if (!tableWrapperContext) {
        setTableControls(null);
        return;
      }

      const wrapperRect = tableWrapperContext.wrapper.getBoundingClientRect();

      setTableControls({
        ...tableWrapperContext.info,
        left: Math.max(TABLE_CONTROL_MIN_VIEWPORT_LEFT, wrapperRect.left - TABLE_CONTROL_LEFT_OFFSET),
        top: wrapperRect.top + 12
      });
    });
  };

  const runTableMutation = (mutation: (currentEditor: TiptapEditor) => boolean) => {
    if (!editor) {
      return;
    }

    if (mutation(editor)) {
      refreshTableControls();
    }
  };

  const handleInsertTableColumn = (direction: 'left' | 'right') => {
    runTableMutation((currentEditor) => insertActiveTableColumn(currentEditor, direction));
    setTableMenuOpen(false);
  };

  const handleInsertTableRow = (direction: 'above' | 'below') => {
    runTableMutation((currentEditor) => insertActiveTableRow(currentEditor, direction));
    setTableMenuOpen(false);
  };

  const handleResizeTable = (rowCount: number, columnCount: number) => {
    runTableMutation((currentEditor) => resizeActiveTable(currentEditor, rowCount, columnCount));
    setTableGridOpen(false);
    setTableGridHover(null);
  };

  const handleDeleteTable = () => {
    runTableMutation((currentEditor) => currentEditor.chain().focus().deleteTable().run());
    setTableMenuOpen(false);
    setTableGridOpen(false);
    setTableGridHover(null);
  };

  const resolveAssetForEditor = async (
    documentPath: string,
    assetPath: string
  ): Promise<WorkspaceResolvedAsset> => {
    if (!window.veloca) {
      return {
        assetPath,
        byteSize: 0,
        exists: false,
        fileName: assetPath,
        isExternal: true,
        mimeType: guessMimeTypeFromName(assetPath),
        url: assetPath
      };
    }

    return window.veloca.workspace.resolveAsset(documentPath, assetPath);
  };

  const tableControlsPortal =
    tableControls && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="table-block-controls"
            ref={tableControlsRef}
            style={{
              left: `${tableControls.left}px`,
              top: `${tableControls.top}px`
            }}
          >
            <button
              className={`table-control-btn${tableGridOpen ? ' active' : ''}`}
              type="button"
              title="Resize Table"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setTableMenuOpen(false);
                setTableGridOpen((current) => !current);
              }}
            >
              <Grid3X3 size={16} />
            </button>
            <button
              className={`table-control-btn${tableMenuOpen ? ' active' : ''}`}
              type="button"
              title="Table Options"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setTableGridOpen(false);
                setTableMenuOpen((current) => !current);
              }}
            >
              <MoreHorizontal size={16} />
            </button>

            <div
              className={`table-popup-panel table-grid-popup${tableGridOpen ? ' show' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
            >
              <div className="table-grid-matrix">
                {Array.from({ length: TABLE_GRID_MAX_ROWS * TABLE_GRID_MAX_COLUMNS }, (_, index) => {
                  const row = Math.floor(index / TABLE_GRID_MAX_COLUMNS) + 1;
                  const column = (index % TABLE_GRID_MAX_COLUMNS) + 1;
                  const highlighted =
                    tableGridHover !== null &&
                    row <= tableGridHover.rowCount &&
                    column <= tableGridHover.columnCount;

                  return (
                    <button
                      className={`table-grid-cell${highlighted ? ' highlighted' : ''}`}
                      key={`${row}-${column}`}
                      type="button"
                      onMouseEnter={() =>
                        setTableGridHover({
                          columnCount: column,
                          rowCount: row
                        })
                      }
                      onMouseLeave={() => setTableGridHover(null)}
                      onClick={() => handleResizeTable(row, column)}
                    />
                  );
                })}
              </div>
              <div className="table-grid-status">
                {tableGridHover
                  ? `${tableGridHover.columnCount} × ${tableGridHover.rowCount}`
                  : `${tableControls.columnCount} × ${tableControls.rowCount}`}
              </div>
            </div>

            <div
              className={`table-popup-panel table-menu-popup${tableMenuOpen ? ' show' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
            >
              <button className="table-menu-item" type="button" onClick={() => handleInsertTableColumn('left')}>
                <span className="table-menu-item-left">
                  <ArrowLeftToLine size={14} />
                  <span>Insert column left</span>
                </span>
                <span className="table-menu-shortcut">⇧ + ←</span>
              </button>
              <button className="table-menu-item" type="button" onClick={() => handleInsertTableColumn('right')}>
                <span className="table-menu-item-left">
                  <ArrowRightToLine size={14} />
                  <span>Insert column right</span>
                </span>
                <span className="table-menu-shortcut">⇧ + →</span>
              </button>
              <div className="table-menu-separator" />
              <button
                className={`table-menu-item${tableControls.isHeaderRow ? ' disabled' : ''}`}
                disabled={tableControls.isHeaderRow}
                type="button"
                onClick={() => handleInsertTableRow('above')}
              >
                <span className="table-menu-item-left">
                  <ArrowUpToLine size={14} />
                  <span>Insert row above</span>
                </span>
                <span className="table-menu-shortcut">⇧ + ↑</span>
              </button>
              <button className="table-menu-item" type="button" onClick={() => handleInsertTableRow('below')}>
                <span className="table-menu-item-left">
                  <ArrowDownToLine size={14} />
                  <span>Insert row below</span>
                </span>
                <span className="table-menu-shortcut">⇧ + ↓</span>
              </button>
              <div className="table-menu-separator" />
              <button className="table-menu-item" type="button" onClick={handleDeleteTable}>
                <span className="table-menu-item-left">
                  <Trash2 size={14} />
                  <span>Delete table</span>
                </span>
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  const slashCommandMenuPanel = slashCommandMenu ? (
    <div
      className="slash-command-menu"
      role="listbox"
      style={{
        left: `${slashCommandMenu.left}px`,
        top: `${slashCommandMenu.top}px`
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {slashCommandMenu.items.map((item, index) => {
        const Icon = item.Icon;
        const isSelected = index === slashCommandMenu.selectedIndex;

        return (
          <button
            aria-selected={isSelected}
            className={`slash-command-item${isSelected ? ' selected' : ''}`}
            key={item.id}
            role="option"
            type="button"
            onClick={() => runSlashCommand(item, slashCommandMenu)}
            onMouseEnter={() =>
              updateSlashCommandMenu({
                ...slashCommandMenu,
                selectedIndex: index
              })
            }
          >
            <span className="slash-command-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span className="slash-command-copy">
              <span className="slash-command-label">{item.label}</span>
              <span className="slash-command-description">{item.description}</span>
            </span>
            <span className="slash-command-token">{item.command}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div className="veloca-editor" data-file-path={filePath} ref={editorShellRef}>
      {tableControlsPortal}
      {slashCommandMenuPanel}
      <EditorContent editor={editor} />
    </div>
  );
});

interface NameDialogProps {
  description: string;
  name: string;
  placeholder: string;
  submitLabel: string;
  title: string;
  onCancel: () => void;
  onChange: (name: string) => void;
  onSubmit: () => void;
}

interface SaveLocationDialogProps {
  fileName: string;
  folders: SaveLocationOption[];
  saving: boolean;
  selectedFolderPath: string | null;
  onCancel: () => void;
  onFileNameChange: (fileName: string) => void;
  onFolderSelect: (folderPath: string) => void;
  onSubmit: () => void;
}

function NameDialog({
  description,
  name,
  placeholder,
  submitLabel,
  title,
  onCancel,
  onChange,
  onSubmit
}: NameDialogProps): JSX.Element {
  return (
    <div className="name-dialog-overlay" onMouseDown={onCancel}>
      <form
        className="name-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="name-dialog-header">
          <FolderStarPlusIcon size={18} />
          <h2>{title}</h2>
        </div>
        <p>{description}</p>
        <input
          autoFocus
          className="name-dialog-input"
          placeholder={placeholder}
          value={name}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="name-dialog-actions">
          <button className="dialog-secondary-action" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="dialog-primary-action" type="submit" disabled={!name.trim()}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

interface WorkspaceContextMenuProps {
  clipboard: FileClipboard | null;
  menu: ContextMenuState;
  onClose: () => void;
  onCopy: (node: WorkspaceTreeNode) => void;
  onCopyPath: (node: WorkspaceTreeNode) => void;
  onCreate: (node: WorkspaceTreeNode, entryType: 'file' | 'folder') => void;
  onCut: (node: WorkspaceTreeNode) => void;
  onDelete: (node: WorkspaceTreeNode) => void;
  onDuplicate: (node: WorkspaceTreeNode) => void;
  onOpen: (node: WorkspaceTreeNode) => void;
  onPaste: (node: WorkspaceTreeNode) => void;
  onRemoveWorkspace: (node: WorkspaceTreeNode) => void;
  onRename: (node: WorkspaceTreeNode) => void;
  onReveal: (node: WorkspaceTreeNode) => void;
}

function WorkspaceContextMenu({
  clipboard,
  menu,
  onClose,
  onCopy,
  onCopyPath,
  onCreate,
  onCut,
  onDelete,
  onDuplicate,
  onOpen,
  onPaste,
  onRemoveWorkspace,
  onRename,
  onReveal
}: WorkspaceContextMenuProps): JSX.Element {
  const node = menu.node;
  const isFolder = node.type === 'folder';
  const isWorkspaceRoot = isFolder && node.relativePath === '';
  const isFilesystemNode = node.source === 'filesystem';

  const runAction = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      className="context-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {isFolder && (
        <>
          <ContextMenuItem icon={<FilePlus size={14} />} label="New File" onClick={() => runAction(() => onCreate(node, 'file'))} />
          <ContextMenuItem icon={<FolderPlus size={14} />} label="New Folder" onClick={() => runAction(() => onCreate(node, 'folder'))} />
          {clipboard && (
            <ContextMenuItem
              icon={<Clipboard size={14} />}
              label={`Paste ${clipboard.name}`}
              onClick={() => runAction(() => onPaste(node))}
            />
          )}
          <ContextMenuSeparator />
        </>
      )}

      {isFolder && isFilesystemNode && (
        <ContextMenuItem icon={<ExternalLink size={14} />} label="Open in Finder" onClick={() => runAction(() => onOpen(node))} />
      )}
      {isFilesystemNode && (
        <ContextMenuItem icon={<Folder size={14} />} label="Reveal in Finder" onClick={() => runAction(() => onReveal(node))} />
      )}
      <ContextMenuItem icon={<Copy size={14} />} label="Copy Path" onClick={() => runAction(() => onCopyPath(node))} />

      {!isWorkspaceRoot && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<Copy size={14} />} label="Copy" onClick={() => runAction(() => onCopy(node))} />
          <ContextMenuItem icon={<Scissors size={14} />} label="Cut" onClick={() => runAction(() => onCut(node))} />
          <ContextMenuItem icon={<Copy size={14} />} label="Duplicate" onClick={() => runAction(() => onDuplicate(node))} />
          <ContextMenuItem icon={<Pencil size={14} />} label="Rename" onClick={() => runAction(() => onRename(node))} />
          <ContextMenuSeparator />
          <ContextMenuItem destructive icon={<Trash2 size={14} />} label="Delete" onClick={() => runAction(() => onDelete(node))} />
        </>
      )}

      {isWorkspaceRoot && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            destructive
            icon={<X size={14} />}
            label="Remove from Workspace"
            onClick={() => runAction(() => onRemoveWorkspace(node))}
          />
        </>
      )}
    </div>
  );
}

interface ContextMenuItemProps {
  destructive?: boolean;
  icon: JSX.Element;
  label: string;
  onClick: () => void;
}

function ContextMenuItem({ destructive = false, icon, label, onClick }: ContextMenuItemProps): JSX.Element {
  return (
    <button className={destructive ? 'context-menu-item destructive' : 'context-menu-item'} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ContextMenuSeparator(): JSX.Element {
  return <div className="context-menu-separator" />;
}

interface FolderStarIconProps {
  size: number;
}

function FolderStarIcon({ size }: FolderStarIconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M3 6.75A2.75 2.75 0 0 1 5.75 4h4.1c.73 0 1.42.29 1.93.8l1.02 1.02c.3.3.7.47 1.13.47h4.32A2.75 2.75 0 0 1 21 9.04v7.21A2.75 2.75 0 0 1 18.25 19H5.75A2.75 2.75 0 0 1 3 16.25Z" />
      <path d="m16.2 10.35.48 1.02 1.1.15-.8.78.2 1.1-.98-.52-.98.52.19-1.1-.79-.78 1.1-.15Z" />
    </svg>
  );
}

function FolderStarPlusIcon({ size }: FolderStarIconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M3 6.75A2.75 2.75 0 0 1 5.75 4h4.1c.73 0 1.42.29 1.93.8l1.02 1.02c.3.3.7.47 1.13.47h2.82A2.75 2.75 0 0 1 19.5 9.04v1.2" />
      <path d="M3 9.25h16.5v7A2.75 2.75 0 0 1 16.75 19H5.75A2.75 2.75 0 0 1 3 16.25Z" />
      <path d="m14.35 10.15.42.87.95.13-.69.67.17.94-.85-.45-.84.45.16-.94-.68-.67.95-.13Z" />
      <path d="M20 14.5v5" />
      <path d="M17.5 17h5" />
    </svg>
  );
}

function SaveLocationDialog({
  fileName,
  folders,
  saving,
  selectedFolderPath,
  onCancel,
  onFileNameChange,
  onFolderSelect,
  onSubmit
}: SaveLocationDialogProps): JSX.Element {
  const selectedFolder = folders.find((folder) => folder.path === selectedFolderPath);
  const canSave = Boolean(fileName.trim() && selectedFolderPath && !saving);

  return (
    <div className="save-location-overlay" onMouseDown={onCancel}>
      <form
        className="save-location-dialog"
        aria-label="Save new markdown file"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();

          if (canSave) {
            onSubmit();
          }
        }}
      >
        <div className="save-location-header">
          <FilePlus size={17} />
          <div>
            <h2>Save New File</h2>
            <p>Choose a folder inside the current Veloca workspace.</p>
          </div>
        </div>

        <label className="save-location-label" htmlFor="save-location-file-name">
          File name
        </label>
        <input
          id="save-location-file-name"
          className="name-dialog-input"
          value={fileName}
          autoFocus
          disabled={saving}
          placeholder="Untitled.md"
          onChange={(event) => onFileNameChange(event.currentTarget.value)}
        />

        <div className="save-location-section-title">Workspace folder</div>
        <div className="save-location-list" role="listbox" aria-label="Workspace folders">
          {folders.map((folder) => {
            const selected = folder.path === selectedFolderPath;
            const Icon = folder.source === 'database' ? Database : Folder;

            return (
              <button
                aria-selected={selected}
                className={`save-location-option${selected ? ' selected' : ''}`}
                key={folder.id}
                role="option"
                style={{ paddingLeft: `${12 + folder.depth * 16}px` }}
                type="button"
                disabled={saving}
                onClick={() => onFolderSelect(folder.path)}
              >
                <Icon size={15} />
                <span className="save-location-option-copy">
                  <span className="save-location-option-name">{folder.name}</span>
                  <span className="save-location-option-path">{folder.relativePath || folder.name}</span>
                </span>
                {selected ? <CheckCircle2 size={15} /> : null}
              </button>
            );
          })}
        </div>

        <div className="save-location-summary">
          {selectedFolder ? selectedFolder.relativePath || selectedFolder.name : 'No workspace folder selected'}
        </div>

        <div className="name-dialog-actions">
          <button className="dialog-secondary-action" type="button" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <button className="dialog-primary-action" type="submit" disabled={!canSave}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Switch({ checked, onChange }: SwitchProps): JSX.Element {
  return (
    <button
      className="shadcn-switch"
      data-state={checked ? 'checked' : 'unchecked'}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="shadcn-switch-thumb" />
    </button>
  );
}

function getMediaCategory(mimeType: string, fileName: string): keyof typeof MEDIA_LIMITS | null {
  if (mimeType.startsWith('image/') || isImageUrl(fileName)) {
    return 'image';
  }

  if (mimeType.startsWith('audio/') || isAudioUrl(fileName)) {
    return 'audio';
  }

  if (mimeType.startsWith('video/') || isVideoUrl(fileName)) {
    return 'video';
  }

  return null;
}

function guessMimeTypeFromName(fileName: string): string {
  const normalizedFileName = fileName.toLowerCase();

  if (isImageUrl(normalizedFileName)) {
    if (normalizedFileName.endsWith('.png')) {
      return 'image/png';
    }

    if (normalizedFileName.endsWith('.svg')) {
      return 'image/svg+xml';
    }

    if (normalizedFileName.endsWith('.webp')) {
      return 'image/webp';
    }

    if (normalizedFileName.endsWith('.gif')) {
      return 'image/gif';
    }

    return 'image/jpeg';
  }

  if (isAudioUrl(normalizedFileName)) {
    if (normalizedFileName.endsWith('.wav')) {
      return 'audio/wav';
    }

    if (normalizedFileName.endsWith('.ogg')) {
      return 'audio/ogg';
    }

    if (normalizedFileName.endsWith('.webm')) {
      return 'audio/webm';
    }

    return 'audio/mpeg';
  }

  if (isVideoUrl(normalizedFileName)) {
    if (normalizedFileName.endsWith('.webm')) {
      return 'video/webm';
    }

    if (normalizedFileName.endsWith('.ogv') || normalizedFileName.endsWith('.ogg')) {
      return 'video/ogg';
    }

    return 'video/mp4';
  }

  return 'application/octet-stream';
}

function getSaveStatusLabel(status: SaveStatus): string {
  if (status === 'saving') {
    return 'Saving';
  }

  if (status === 'unsaved') {
    return 'Unsaved';
  }

  if (status === 'failed') {
    return 'Save Failed';
  }

  return 'Saved';
}

function getRemoteStatusLabel(status: RemoteDatabaseStatus, t: Translator): string {
  if (status === 'configured') {
    return t('settings.remote.statusConfigured');
  }

  if (status === 'creating') {
    return t('settings.remote.statusCreating');
  }

  if (status === 'waiting') {
    return t('settings.remote.statusWaiting');
  }

  if (status === 'initialized') {
    return t('settings.remote.statusInitialized');
  }

  if (status === 'failed') {
    return t('settings.remote.failed');
  }

  return t('settings.remote.notConfigured');
}

function getRemoteCredentialSummary(config: RemoteDatabaseConfigView, t: Translator): string {
  const savedCredentials = [
    config.patSaved ? 'PAT' : '',
    config.databasePasswordSaved ? 'DB Password' : '',
    config.secretKeySaved ? 'Secret Key' : '',
    config.publishableKeySaved ? 'Publishable Key' : ''
  ].filter(Boolean);

  return savedCredentials.length ? savedCredentials.join(', ') : t('settings.remote.notSaved');
}

function formatRemoteSyncTime(timestamp: number | null, t: Translator): string {
  if (!timestamp) {
    return t('settings.remote.never');
  }

  return new Date(timestamp).toLocaleString();
}

function getRemoteRegionSelectOptions(
  regions: RemoteRegionOption[],
  selectedRegionCode: string
): RemoteRegionOption[] {
  if (!selectedRegionCode || regions.some((region) => region.code === selectedRegionCode)) {
    return regions;
  }

  return [
    {
      code: selectedRegionCode,
      label: `${selectedRegionCode} (saved)`,
      name: selectedRegionCode,
      provider: '',
      recommended: false,
      status: '',
      type: 'specific'
    },
    ...regions
  ];
}

function canSubmitRemoteConfig(input: RemoteDatabaseConfigInput, config: RemoteDatabaseConfigView): boolean {
  return Boolean(
    input.organizationSlug.trim() &&
      input.region.trim() &&
      ((input.personalAccessToken ?? '').trim() || config.patSaved) &&
      ((input.databasePassword ?? '').trim() || config.databasePasswordSaved)
  );
}

function isAppInputShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], .settings-window, .name-dialog, .save-location-dialog'
    )
  );
}

function getErrorDescription(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getSaveButtonLabel(status: SaveStatus, autoSave: boolean): string {
  if (status === 'saving') {
    return 'Saving';
  }

  if (status === 'saved') {
    return autoSave ? 'Saved' : 'Save';
  }

  if (status === 'failed') {
    return 'Retry Save';
  }

  return 'Save';
}

function parseMarkdownSections(content: string, fallbackTitle: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const tokens = marked.lexer(content);

  collectHeadingTokens(tokens, sections);

  if (!sections.length) {
    return [
      {
        id: 'document',
        level: 1,
        title: fallbackTitle
      }
    ];
  }

  return sections;
}

function slugify(value: string, index: number): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug ? `${slug}-${index}` : `heading-${index}`;
}

interface MarkdownToken {
  depth?: number;
  items?: MarkdownListItemToken[];
  raw?: string;
  text?: string;
  tokens?: MarkdownToken[];
  type?: string;
}

interface MarkdownListItemToken {
  tokens?: MarkdownToken[];
}

function collectHeadingTokens(tokens: MarkdownToken[], sections: MarkdownSection[]): void {
  tokens.forEach((token) => {
    if (token.type === 'heading' && typeof token.depth === 'number') {
      const title = extractMarkdownText(token.tokens).trim() || decodeMarkdownEscapes(token.text ?? '').trim();

      sections.push({
        id: slugify(title, sections.length),
        level: token.depth,
        title
      });
    }

    if (token.type === 'html') {
      const htmlHeading = extractHtmlHeadingToken(token);

      if (htmlHeading) {
        sections.push({
          id: slugify(htmlHeading.title, sections.length),
          level: htmlHeading.level,
          title: htmlHeading.title
        });
      }
    }

    if (token.tokens?.length) {
      collectHeadingTokens(token.tokens, sections);
    }

    token.items?.forEach((item) => {
      if (item.tokens?.length) {
        collectHeadingTokens(item.tokens, sections);
      }
    });
  });
}

function extractHtmlHeadingToken(token: MarkdownToken): { level: number; title: string } | null {
  const html = (token.raw ?? token.text ?? '').trim();

  if (!html) {
    return null;
  }

  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const heading = document.body.querySelector('h1, h2, h3, h4, h5, h6');

    if (!heading) {
      return null;
    }

    heading.querySelectorAll('br').forEach((breakNode) => {
      breakNode.replaceWith(document.createTextNode(' '));
    });

    const title = heading.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const level = Number.parseInt(heading.tagName.slice(1), 10);

    if (!title || !Number.isFinite(level)) {
      return null;
    }

    return { level, title };
  }

  const matched = html.match(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i);

  if (!matched) {
    return null;
  }

  const title = matched[2]
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const level = Number.parseInt(matched[1], 10);

  return title && Number.isFinite(level) ? { level, title } : null;
}

function extractMarkdownText(tokens?: MarkdownToken[]): string {
  if (!tokens?.length) {
    return '';
  }

  return tokens
    .map((token) => {
      if (token.type === 'escape') {
        return token.text ?? '';
      }

      if (token.tokens?.length) {
        return extractMarkdownText(token.tokens);
      }

      return token.text ?? '';
    })
    .join('');
}

function decodeMarkdownEscapes(value: string): string {
  return value.replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, '$1');
}

function findFirstFile(nodes: WorkspaceTreeNode[]): WorkspaceTreeNode | null {
  for (const node of nodes) {
    if (node.type === 'file') {
      return node;
    }

    const child = findFirstFile(node.children ?? []);

    if (child) {
      return child;
    }
  }

  return null;
}

function findFileNodeByPath(nodes: WorkspaceTreeNode[], filePath: string): WorkspaceTreeNode | null {
  for (const node of nodes) {
    if (node.type === 'file' && node.path === filePath) {
      return node;
    }

    const child = findFileNodeByPath(node.children ?? [], filePath);

    if (child) {
      return child;
    }
  }

  return null;
}

function findNodeByPath(nodes: WorkspaceTreeNode[], filePath: string): WorkspaceTreeNode | null {
  for (const node of nodes) {
    if (node.path === filePath) {
      return node;
    }

    const child = findNodeByPath(node.children ?? [], filePath);

    if (child) {
      return child;
    }
  }

  return null;
}

function getSaveLocationOptions(nodes: WorkspaceTreeNode[]): SaveLocationOption[] {
  const options: SaveLocationOption[] = [];

  const visit = (items: WorkspaceTreeNode[], depth: number, parentLabel = '') => {
    for (const node of items) {
      if (node.type !== 'folder') {
        continue;
      }

      const relativePath = parentLabel ? `${parentLabel}/${node.name}` : node.name;
      options.push({
        depth,
        id: node.id,
        name: node.name,
        path: node.path,
        relativePath,
        source: node.source
      });

      if (node.children?.length) {
        visit(node.children, depth + 1, relativePath);
      }
    }
  };

  visit(nodes, 0);
  return options;
}
