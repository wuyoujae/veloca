import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection, TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import { createPortal } from 'react-dom';
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  Copy,
  Database,
  ExternalLink,
  FileMinus2,
  FilePlus2,
  FileText,
  FilePlus,
  Folder,
  FolderPlus,
  GitCompare,
  GitBranch,
  Github,
  Grid3X3,
  Info,
  ListTree,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  MoreVertical,
  Settings,
  Scissors,
  Sun,
  Table2,
  Trash2,
  Undo2,
  Unlink,
  X
} from 'lucide-react';
import { marked } from 'marked';
import 'katex/dist/katex.min.css';
import {
  MEDIA_LIMITS,
  buildMediaInsertContent,
  buildMediaNodeFromUrl,
  createRichEditorExtensions,
  extractFirstMediaUrl,
  getActiveTableInfo,
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
  AgentPalette,
  type AgentPaletteAnchor,
  type AgentRuntimeContext,
  type AgentWorkspaceType
} from './agent-palette';

type ThemeMode = 'dark' | 'light';
type SidebarTab = 'files' | 'outline' | 'git';
type SettingsPanel = 'editor' | 'account';
type SaveStatus = 'failed' | 'saved' | 'saving' | 'unsaved';
type SaveActionState = 'idle' | 'saving' | 'success';
type DocumentViewMode = 'rendered' | 'source';
type ToastType = 'success' | 'info';

interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  description: string;
}

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
  savedContent: string;
  status: SaveStatus;
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
}

interface GitHubDeviceBinding {
  expiresAt: number;
  interval: number;
  scope: string;
  sessionId: string;
  userCode: string;
  verificationUri: string;
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

const emptyWorkspace: WorkspaceSnapshot = {
  folders: [],
  tree: [],
  totalMarkdownFiles: 0
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
  const [focusMode, setFocusMode] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [githubStatus, setGithubStatus] = useState<GitHubAuthStatus>({
    account: null,
    connected: false,
    configured: false
  });
  const [githubBinding, setGithubBinding] = useState<GitHubDeviceBinding | null>(null);
  const [githubAuthLoading, setGithubAuthLoading] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileClipboard, setFileClipboard] = useState<FileClipboard | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const activeTabRef = useRef<OpenEditorTab | null>(null);
  const documentContentRef = useRef(documentContent);
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
  const headerMenuButtonRef = useRef<HTMLButtonElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);

  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.file.path === activeTabPath) ?? null,
    [activeTabPath, openTabs]
  );
  const activeFile = activeTab?.file ?? null;
  const activeSaveActionState = activeTabPath ? saveActionStatesByPath[activeTabPath] ?? 'idle' : 'idle';
  const activeDocumentViewMode = activeTabPath
    ? documentViewModesByPath[activeTabPath] ?? defaultDocumentViewMode
    : defaultDocumentViewMode;
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

  useEffect(() => {
    window.veloca?.settings.getTheme().then((storedTheme) => {
      applyTheme(storedTheme);
      setTheme(storedTheme);
    });
    window.veloca?.settings.getAutoSave().then(setAutoSave);
    window.veloca?.github.getStatus().then(setGithubStatus);

    if (!window.veloca) {
      const fallbackTheme = localStorage.getItem('veloca-theme') === 'light' ? 'light' : 'dark';
      const fallbackAutoSave = localStorage.getItem('veloca-auto-save') !== 'false';
      applyTheme(fallbackTheme);
      setTheme(fallbackTheme);
      setAutoSave(fallbackAutoSave);
    }
  }, []);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
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
      const key = event.key.toLowerCase();
      const isFnKey = event.key === 'Fn' || event.code === 'Fn';
      const isFallbackShortcut = (event.metaKey || event.ctrlKey) && key === 'j';

      if (!isFnKey && !isFallbackShortcut) {
        return;
      }

      event.preventDefault();
      openAgentPalette();
    };

    window.addEventListener('keydown', openOnAgentShortcut);
    return () => window.removeEventListener('keydown', openOnAgentShortcut);
  }, [openAgentPalette]);

  useEffect(() => {
    return window.veloca?.agent.onOpenPalette(openAgentPalette);
  }, [openAgentPalette]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    window.veloca?.github.getStatus().then(setGithubStatus);
  }, [settingsOpen]);

  useEffect(() => {
    if (!agentPaletteOpen) {
      return;
    }

    const repositionAgentPalette = () => positionAgentPalette();

    window.addEventListener('resize', repositionAgentPalette);
    return () => window.removeEventListener('resize', repositionAgentPalette);
  }, [agentPaletteOpen, positionAgentPalette]);

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
      title: 'Appearance Updated',
      description: `${nextTheme === 'dark' ? 'Dark' : 'Light'} mode is now active.`
    });
  };

  const updateAutoSave = async (enabled: boolean) => {
    setAutoSave(enabled);
    localStorage.setItem('veloca-auto-save', enabled ? 'true' : 'false');
    await window.veloca?.settings.setAutoSave(enabled);
    showToast({
      type: 'success',
      title: 'Editor Updated',
      description: `Auto Save is now ${enabled ? 'enabled' : 'disabled'}.`
    });
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
      setGithubStatus(status);
      setGithubBinding(null);
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
      setGithubStatus(status);
      setGithubBinding(null);
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

    const currentMode = getDocumentViewMode(activeTabPath);
    const nextMode: DocumentViewMode = currentMode === 'rendered' ? 'source' : 'rendered';
    const cursorOffset = getCursorOffsetForViewMode(activeTabPath, currentMode);
    const scrollTop = getEditorScrollPosition(activeTabPath);

    if (typeof cursorOffset === 'number') {
      cursorRestoreSequenceRef.current += 1;
      setCursorRestoreRequest({
        filePath: activeTabPath,
        mode: nextMode,
        offset: cursorOffset,
        sequence: cursorRestoreSequenceRef.current
      });
    }

    setDocumentViewModesByPath((current) => ({
      ...current,
      [activeTabPath]: nextMode
    }));
    restoreEditorScrollPosition(activeTabPath, scrollTop);
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

      setOpenTabs((current) =>
        current.map((currentTab) =>
          currentTab.file.path === filePath
            ? {
                ...currentTab,
                file: { ...currentTab.file, ...savedFile },
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

  const updateTabDocumentContent = (filePath: string, content: string) => {
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

  const updateDocumentContent = (content: string) => {
    if (!activeTabPath) {
      return;
    }

    updateTabDocumentContent(activeTabPath, content);
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

  workspaceChangedHandlerRef.current = (snapshot) => {
    void refreshWorkspaceAfterOperation(snapshot);
  };

  useEffect(() => {
    const unsubscribe = window.veloca?.workspace.onChanged((snapshot) => {
      workspaceChangedHandlerRef.current(snapshot);
    });

    return () => unsubscribe?.();
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
      const nextTab: OpenEditorTab = {
        file,
        draftContent: file.content,
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
        const targetIndex = nextTabs.findIndex((item) => item.file.path === tab.file.path);

        if (targetIndex >= 0) {
          nextTabs[targetIndex] = {
            ...nextTabs[targetIndex],
            file: { ...nextTabs[targetIndex].file, ...savedFile },
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
                onChange={(content) => updateTabDocumentContent(tab.file.path, content)}
                {...restoreProps}
              />
            ) : (
              <MarkdownEditor
                content={paneContent}
                filePath={tab.file.path}
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
      <header className="titlebar" aria-label="Window title bar" />

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
                  className={sidebarTab === 'files' ? 'tab-trigger active' : 'tab-trigger'}
                  type="button"
                  title="Files"
                  onClick={() => setSidebarTab('files')}
                >
                  <FileText size={14} />
                  <span className="tab-trigger-label">Files</span>
                </button>
                <button
                  className={sidebarTab === 'outline' ? 'tab-trigger active' : 'tab-trigger'}
                  type="button"
                  title="Outline"
                  onClick={() => setSidebarTab('outline')}
                >
                  <ListTree size={14} />
                  <span className="tab-trigger-label">Outline</span>
                </button>
                <button
                  className={sidebarTab === 'git' ? 'tab-trigger active' : 'tab-trigger'}
                  type="button"
                  title="Git version management"
                  onClick={() => setSidebarTab('git')}
                >
                  <GitBranch size={14} />
                  <span className="tab-trigger-label">Git</span>
                  <span className="tab-status-dot" aria-hidden="true" />
                </button>
              </div>
              <button
                className="sidebar-toggle-btn"
                type="button"
                aria-label="Collapse sidebar"
                onClick={() => setIsSidebarCollapsed(true)}
              >
                <PanelLeftClose size={15} />
              </button>
            </div>
          </div>

          <div className="sidebar-content">
            {sidebarTab === 'files' ? (
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
            ) : sidebarTab === 'outline' ? (
              <OutlinePanel
                activeFile={activeFile}
                activeHeadingId={activeHeadingId}
                sections={sections}
                onHeadingSelect={selectHeading}
              />
            ) : (
              <GitVersionPanel />
            )}
          </div>

          <div className="sidebar-footer">
            <button className="nav-btn" type="button" onClick={() => setSettingsOpen(true)}>
              <Settings size={16} />
              <span>Settings</span>
            </button>
          </div>
          <div
            className="sidebar-resize-handle"
            role="separator"
            tabIndex={0}
            aria-label="Resize sidebar"
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
          <div className="sidebar-restore-rail" aria-label="Collapsed sidebar">
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
              {visibleTabGroups.length === 0 ? (
                <span className="editor-tab-empty">No markdown file opened</span>
              ) : (
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
                })
              )}

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
                    onChange={updateDocumentContent}
                    {...getCursorRestoreProps(activeFile.path, 'source')}
                  />
                ) : (
                  <MarkdownEditor
                    content={documentContent}
                    filePath={activeFile.path}
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
            aria-label="Settings"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <aside className="settings-sidebar">
              <h2 className="settings-title">Settings</h2>
              <button
                className={settingsPanel === 'editor' ? 'settings-nav-item active' : 'settings-nav-item'}
                type="button"
                onClick={() => setSettingsPanel('editor')}
              >
                Editor
              </button>
              <button className="settings-nav-item" type="button">
                Appearance
              </button>
              <button
                className={settingsPanel === 'account' ? 'settings-nav-item active' : 'settings-nav-item'}
                type="button"
                onClick={() => setSettingsPanel('account')}
              >
                Account
              </button>
              <button className="settings-nav-item" type="button">
                File & Sync
              </button>
              <button className="settings-nav-item" type="button">
                Shortcuts
              </button>
              <span className="settings-spacer" />
              <button className="settings-nav-item muted" type="button">
                About Veloca
              </button>
            </aside>

            <div className="settings-content-wrapper">
              <button
                className="settings-close-btn"
                type="button"
                aria-label="Close settings"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={20} />
              </button>

              <div className="settings-scroll-area">
                {settingsPanel === 'editor' ? (
                  <>
                    <h3 className="settings-section-title">Editor Settings</h3>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">Theme</span>
                        <span className="setting-desc">Switch the entire editor between dark and light mode.</span>
                      </div>
                      <div className="theme-toggle" role="group" aria-label="Theme">
                        <button
                          className={theme === 'dark' ? 'theme-option active' : 'theme-option'}
                          type="button"
                          onClick={() => updateTheme('dark')}
                        >
                          <Moon size={15} />
                          Dark
                        </button>
                        <button
                          className={theme === 'light' ? 'theme-option active' : 'theme-option'}
                          type="button"
                          onClick={() => updateTheme('light')}
                        >
                          <Sun size={15} />
                          Light
                        </button>
                      </div>
                    </div>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">Font Family</span>
                        <span className="setting-desc">Controls the font family of the Markdown editor.</span>
                      </div>
                      <select className="shadcn-select" defaultValue="inter">
                        <option value="inter">Inter</option>
                        <option value="system">System</option>
                        <option value="mono">JetBrains Mono</option>
                      </select>
                    </div>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">Auto Save</span>
                        <span className="setting-desc">Save markdown changes after a short pause while writing.</span>
                      </div>
                      <Switch checked={autoSave} onChange={updateAutoSave} />
                    </div>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">Line Numbers</span>
                        <span className="setting-desc">Render line numbers alongside the markdown source code.</span>
                      </div>
                      <Switch checked={lineNumbers} onChange={setLineNumbers} />
                    </div>

                    <div className="setting-row">
                      <div className="setting-info">
                        <span className="setting-label">Focus Mode</span>
                        <span className="setting-desc">Dim surrounding text while writing in the active paragraph.</span>
                      </div>
                      <Switch checked={focusMode} onChange={setFocusMode} />
                    </div>
                  </>
                ) : (
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

                      <div className="account-actions">
                        {githubStatus.connected ? (
                          <button
                            className="secondary-action danger"
                            type="button"
                            disabled={githubAuthLoading}
                            onClick={unbindGitHubAccount}
                          >
                            <Unlink size={15} />
                            Unbind GitHub
                          </button>
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
              </div>
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
            <FolderStarPlusIcon size={16} />
          </button>
          <button className="toolbar-icon-btn" type="button" aria-label="Add folder" onClick={onAddFolder}>
            <FolderPlus size={16} />
          </button>
        </div>
      </div>

      {loading && <div className="loading-state">Loading workspace...</div>}

      {!loading && tree.length === 0 && (
        <div className="empty-sidebar-state">
          <Folder size={18} />
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

function GitVersionPanel(): JSX.Element {
  return (
    <section className="git-panel" aria-label="Git version management">
      <div className="git-commit-box">
        <textarea className="git-textarea" placeholder="Message (Cmd+Enter to commit)" />
        <button className="git-commit-btn" type="button">
          <Check size={15} />
          <span>Commit</span>
        </button>
      </div>

      <div className="git-scroll-area">
        <div className="git-group-header">
          <span className="git-group-title">
            <ChevronDown size={14} />
            Staged Changes
            <span className="git-badge-count">1</span>
          </span>
        </div>

        <div className="git-item">
          <span className="git-item-left">
            <FileText size={14} />
            <span className="git-item-name">architecture.md</span>
            <span className="git-item-dir">docs/</span>
          </span>
          <span className="git-item-right">
            <span className="git-actions">
              <button className="git-action-btn" type="button" title="Unstage Changes">
                <Minus size={14} />
              </button>
            </span>
            <span className="git-status-badge status-m">M</span>
          </span>
        </div>

        <div className="git-group-header with-actions">
          <span className="git-group-title">
            <ChevronDown size={14} />
            Changes
            <span className="git-badge-count">3</span>
          </span>
          <span className="git-actions">
            <button className="git-action-btn" type="button" title="Discard All Changes">
              <Undo2 size={14} />
            </button>
            <button className="git-action-btn" type="button" title="Stage All Changes">
              <Plus size={14} />
            </button>
          </span>
        </div>

        <div className="git-item active">
          <span className="git-item-left">
            <GitCompare size={14} />
            <span className="git-item-name">manifesto.md</span>
            <span className="git-item-dir">docs/</span>
          </span>
          <span className="git-item-right">
            <span className="git-actions">
              <button className="git-action-btn" type="button" title="Discard Changes">
                <Undo2 size={14} />
              </button>
              <button className="git-action-btn" type="button" title="Stage Changes">
                <Plus size={14} />
              </button>
            </span>
            <span className="git-status-badge status-m">M</span>
          </span>
        </div>

        <div className="git-item">
          <span className="git-item-left">
            <FilePlus2 className="git-added-icon" size={14} />
            <span className="git-item-name">new_feature.md</span>
          </span>
          <span className="git-item-right">
            <span className="git-actions">
              <button className="git-action-btn" type="button" title="Stage Changes">
                <Plus size={14} />
              </button>
            </span>
            <span className="git-status-badge status-u">U</span>
          </span>
        </div>

        <div className="git-item">
          <span className="git-item-left">
            <FileMinus2 className="git-deleted-icon" size={14} />
            <span className="git-item-name">old_config.json</span>
          </span>
          <span className="git-item-right">
            <span className="git-actions">
              <button className="git-action-btn" type="button" title="Restore">
                <Undo2 size={14} />
              </button>
              <button className="git-action-btn" type="button" title="Stage Changes">
                <Plus size={14} />
              </button>
            </span>
            <span className="git-status-badge status-d">D</span>
          </span>
        </div>
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
        {isDatabaseRoot ? <FolderStarIcon size={14} /> : <Folder size={14} />}
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
  restoreCursorOffset?: number | null;
  restoreCursorSequence?: number | null;
  theme: ThemeMode;
  onChange: (content: string) => void;
  onToast: (message: Omit<ToastMessage, 'id'>) => void;
}

interface MarkdownEditorHandle {
  focusAtMarkdownOffset: (offset: number) => void;
  getCursorMarkdownOffset: () => number | null;
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

    const resizeTextarea = useCallback(() => {
      const textarea = textareaRef.current;

      if (!textarea) {
        return;
      }

      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(480, textarea.scrollHeight)}px`;
    }, []);

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

    useImperativeHandle(
      ref,
      () => ({
        focusAtOffset,
        getCursorOffset
      }),
      [focusAtOffset, getCursorOffset]
    );

    useEffect(() => {
      resizeTextarea();
    }, [content, resizeTextarea]);

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
          onChange={(event) => onChange(event.currentTarget.value)}
          onInput={resizeTextarea}
        />
      </div>
    );
  }
);

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({
  content,
  filePath,
  onCursorRestoreComplete,
  restoreCursorOffset,
  restoreCursorSequence,
  theme,
  onChange,
  onToast
}: MarkdownEditorProps, ref): JSX.Element {
  const contentRef = useRef(content);
  const activeFilePathRef = useRef(filePath);
  const lastEditorContentRef = useRef(content);
  const editorInstanceRef = useRef<ReturnType<typeof useEditor> | null>(null);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const tableControlsRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  const onToastRef = useRef(onToast);
  const syncingRef = useRef(false);
  const [tableControls, setTableControls] = useState<TableControlsState | null>(null);
  const [tableGridOpen, setTableGridOpen] = useState(false);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [tableGridHover, setTableGridHover] = useState<TableGridHoverState | null>(null);
  const [slashCommandMenu, setSlashCommandMenu] = useState<SlashCommandMenuState | null>(null);
  const slashCommandMenuRef = useRef<SlashCommandMenuState | null>(null);

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

  const editor = useEditor(
    {
      content: transformMarkdownForEditor(content),
      contentType: 'markdown',
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
        void hydrateDocumentAssets(currentEditor, activeFilePathRef.current, resolveAssetForEditor);
      },
      onUpdate: ({ editor: currentEditor }) => {
        if (syncingRef.current) {
          return;
        }

        const nextMarkdown = transformMarkdownFromEditor(currentEditor.getMarkdown());
        lastEditorContentRef.current = nextMarkdown;

        if (nextMarkdown !== contentRef.current) {
          onChangeRef.current(nextMarkdown);
        }

        void hydrateDocumentAssets(currentEditor, activeFilePathRef.current, resolveAssetForEditor);
      }
    },
    [filePath, handleSlashCommandKeyDown]
  );

  useEffect(() => {
    if (!editor) {
      return;
    }

    const fileChanged = activeFilePathRef.current !== filePath;
    const isExternalContentChange = content !== lastEditorContentRef.current;

    activeFilePathRef.current = filePath;

    if (!fileChanged && !isExternalContentChange) {
      return;
    }

    if (!fileChanged && transformMarkdownFromEditor(editor.getMarkdown()) === content) {
      lastEditorContentRef.current = content;
      return;
    }

    syncingRef.current = true;
    editor.commands.setContent(transformMarkdownForEditor(content), {
      contentType: 'markdown',
      emitUpdate: false
    });
    syncingRef.current = false;
    lastEditorContentRef.current = content;
    void hydrateDocumentAssets(editor, filePath, resolveAssetForEditor);
  }, [content, editor, filePath]);

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
      const markdownWithMarker = transformMarkdownFromEditor(currentEditor.getMarkdown());
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

  const focusAtMarkdownOffset = useCallback((offset: number) => {
    const currentEditor = editorInstanceRef.current;

    if (!currentEditor) {
      return;
    }

    const currentContent = contentRef.current;
    const safeOffset = clampNumber(offset, 0, currentContent.length);
    const marker = createSourceCursorMarker();
    const markedContent = `${currentContent.slice(0, safeOffset)}${marker}${currentContent.slice(safeOffset)}`;

    syncingRef.current = true;

    try {
      currentEditor.commands.setContent(transformMarkdownForEditor(markedContent), {
        contentType: 'markdown',
        emitUpdate: false
      });

      const markerRange = findTextMarkerRange(currentEditor.state.doc, marker);

      if (!markerRange) {
        currentEditor.commands.setContent(transformMarkdownForEditor(currentContent), {
          contentType: 'markdown',
          emitUpdate: false
        });
        currentEditor.commands.focus();
        currentEditor.view.dispatch(
          currentEditor.state.tr.setSelection(getClosestTextSelection(currentEditor, safeOffset))
        );
        return;
      }

      const transaction = currentEditor.state.tr.delete(markerRange.from, markerRange.to);
      const nextSelection = TextSelection.near(transaction.doc.resolve(markerRange.from));
      currentEditor.view.dispatch(transaction.setSelection(nextSelection));
      currentEditor.commands.focus();
    } finally {
      syncingRef.current = false;
      lastEditorContentRef.current = contentRef.current;
      void hydrateDocumentAssets(currentEditor, activeFilePathRef.current, resolveAssetForEditor);
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focusAtMarkdownOffset,
      getCursorMarkdownOffset
    }),
    [focusAtMarkdownOffset, getCursorMarkdownOffset]
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
