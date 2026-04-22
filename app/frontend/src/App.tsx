import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  ExternalLink,
  FileText,
  FilePlus,
  Folder,
  FolderPlus,
  Grid3X3,
  Info,
  LoaderCircle,
  MoreHorizontal,
  Moon,
  Pencil,
  Save,
  Settings,
  Scissors,
  Sun,
  Trash2,
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
  isAudioUrl,
  isImageUrl,
  isVideoUrl,
  resizeActiveTable,
  transformMarkdownForEditor,
  transformMarkdownFromEditor,
  type WorkspaceAssetPayload,
  type WorkspaceResolvedAsset
} from './rich-markdown';

type ThemeMode = 'dark' | 'light';
type SidebarTab = 'files' | 'outline';
type SaveStatus = 'failed' | 'saved' | 'saving' | 'unsaved';
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

const emptyWorkspace: WorkspaceSnapshot = {
  folders: [],
  tree: [],
  totalMarkdownFiles: 0
};

marked.setOptions({
  async: false,
  breaks: false,
  gfm: true
});

export function App(): JSX.Element {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(emptyWorkspace);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [activeFile, setActiveFile] = useState<MarkdownFileContent | null>(null);
  const [documentContent, setDocumentContent] = useState('');
  const [activeHeadingId, setActiveHeadingId] = useState<string>('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [nameDialogValue, setNameDialogValue] = useState('');
  const [editingNode, setEditingNode] = useState<EditingNodeState | null>(null);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileClipboard, setFileClipboard] = useState<FileClipboard | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const activeFileRef = useRef<MarkdownFileContent | null>(null);
  const autoSaveRef = useRef(autoSave);
  const documentContentRef = useRef(documentContent);
  const outlineFilePathRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sections = useMemo(() => {
    return parseMarkdownSections(documentContent, activeFile?.name ?? 'Untitled');
  }, [activeFile?.name, documentContent]);

  const wordCount = useMemo(() => {
    return documentContent.trim().split(/\s+/).filter(Boolean).length;
  }, [documentContent]);

  useEffect(() => {
    window.veloca?.settings.getTheme().then((storedTheme) => {
      applyTheme(storedTheme);
      setTheme(storedTheme);
    });
    window.veloca?.settings.getAutoSave().then(setAutoSave);

    if (!window.veloca) {
      const fallbackTheme = localStorage.getItem('veloca-theme') === 'light' ? 'light' : 'dark';
      const fallbackAutoSave = localStorage.getItem('veloca-auto-save') !== 'false';
      applyTheme(fallbackTheme);
      setTheme(fallbackTheme);
      setAutoSave(fallbackAutoSave);
    }
  }, []);

  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  useEffect(() => {
    autoSaveRef.current = autoSave;
  }, [autoSave]);

  useEffect(() => {
    documentContentRef.current = documentContent;
  }, [documentContent]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null);
    window.addEventListener('click', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);

    return () => {
      window.removeEventListener('click', closeContextMenu);
      window.removeEventListener('resize', closeContextMenu);
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

  const clearSaveTimer = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  };

  const saveCurrentDocument = async () => {
    const file = activeFileRef.current;
    const content = documentContentRef.current;

    if (!file || !window.veloca) {
      setSaveStatus('saved');
      return true;
    }

    clearSaveTimer();
    setSaveStatus('saving');

    try {
      const savedFile = await window.veloca.workspace.saveMarkdown(file.path, content);

      if (activeFileRef.current?.path === savedFile.path) {
        setActiveFile(savedFile);
        setSaveStatus(documentContentRef.current === content ? 'saved' : 'unsaved');
      }

      return true;
    } catch {
      setSaveStatus('failed');
      showToast({
        type: 'info',
        title: 'Save Failed',
        description: 'Veloca could not save the current markdown file.'
      });
      return false;
    }
  };

  const canLeaveActiveFile = async (targetPath?: string) => {
    const currentFile = activeFileRef.current;
    const hasUnsavedChanges = Boolean(currentFile && documentContentRef.current !== currentFile.content);

    if (!currentFile || currentFile.path === targetPath || !hasUnsavedChanges) {
      return true;
    }

    if (!autoSaveRef.current) {
      const shouldDiscard = window.confirm('Discard unsaved changes before switching files?');

      if (shouldDiscard) {
        clearSaveTimer();
      }

      return shouldDiscard;
    }

    return saveCurrentDocument();
  };

  const updateDocumentContent = (content: string) => {
    setDocumentContent(content);

    const savedContent = activeFileRef.current?.content ?? '';
    setSaveStatus(content === savedContent ? 'saved' : 'unsaved');
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

      const nextFile = activeFile
        ? findFileNodeByPath(snapshot.tree, activeFile.path) ?? findFirstFile(snapshot.tree)
        : findFirstFile(snapshot.tree);

      if (nextFile) {
        await readMarkdownFile(nextFile.path);
      } else {
        setActiveFile(null);
        setDocumentContent('');
        setSaveStatus('saved');
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
      setWorkspace(snapshot);
      openWorkspaceRoots(snapshot.tree);

      const nextFile = findFirstFile(snapshot.tree);

      if (nextFile) {
        await readMarkdownFile(nextFile.path);
      }

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

  const refreshWorkspaceAfterOperation = async (snapshot: WorkspaceSnapshot, selectedPath?: string) => {
    setWorkspace(snapshot);
    openWorkspaceRoots(snapshot.tree);

    if (selectedPath) {
      const selectedNode = findNodeByPath(snapshot.tree, selectedPath);

      if (selectedNode?.type === 'file') {
        await readMarkdownFile(selectedNode.path);
        return;
      }
    }

    if (activeFile && findFileNodeByPath(snapshot.tree, activeFile.path)) {
      await readMarkdownFile(activeFile.path);
      return;
    }

    const nextFile = findFirstFile(snapshot.tree);

    if (nextFile) {
      await readMarkdownFile(nextFile.path);
    } else {
      setActiveFile(null);
      setDocumentContent('');
      setSaveStatus('saved');
    }
  };

  const setFolderOpen = (folderId: string) => {
    setOpenFolders((current) => ({
      ...current,
      [folderId]: true
    }));
  };

  const readMarkdownFile = async (filePath: string) => {
    if (!window.veloca) {
      return false;
    }

    if (activeFileRef.current?.path === filePath) {
      setSidebarTab('files');
      return true;
    }

    const canLeave = await canLeaveActiveFile(filePath);

    if (!canLeave) {
      return false;
    }

    setLoadingFile(true);

    try {
      const file = await window.veloca.workspace.readMarkdown(filePath);
      setActiveFile(file);
      setDocumentContent(file.content);
      setSaveStatus('saved');
      setSidebarTab('files');
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
      const editorHeadings = document.querySelectorAll<HTMLElement>(
        '.veloca-editor .ProseMirror h1, .veloca-editor .ProseMirror h2, .veloca-editor .ProseMirror h3, .veloca-editor .ProseMirror h4, .veloca-editor .ProseMirror h5, .veloca-editor .ProseMirror h6'
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
      await refreshWorkspaceAfterOperation(result.snapshot, result.path);
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
    if (!autoSave || saveStatus !== 'unsaved' || !activeFile) {
      return undefined;
    }

    clearSaveTimer();
    saveTimerRef.current = setTimeout(() => {
      void saveCurrentDocument();
    }, 800);

    return clearSaveTimer;
  }, [activeFile, autoSave, documentContent, saveStatus]);

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

  return (
    <div className="app-shell">
      <header className="titlebar" aria-label="Window title bar" />

      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="tabs-list">
              <button
                className={sidebarTab === 'files' ? 'tab-trigger active' : 'tab-trigger'}
                type="button"
                onClick={() => setSidebarTab('files')}
              >
                Files
              </button>
              <button
                className={sidebarTab === 'outline' ? 'tab-trigger active' : 'tab-trigger'}
                type="button"
                onClick={() => setSidebarTab('outline')}
              >
                Outline
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
            ) : (
              <OutlinePanel
                activeFile={activeFile}
                activeHeadingId={activeHeadingId}
                sections={sections}
                onHeadingSelect={selectHeading}
              />
            )}
          </div>

          <div className="sidebar-footer">
            <button className="nav-btn" type="button" onClick={() => setSettingsOpen(true)}>
              <Settings size={16} />
              <span>Settings</span>
            </button>
          </div>
        </aside>

        <main className="editor-container">
          <header className="editor-header">
            <div className="breadcrumb">
              {activeFile ? (
                activeFile.relativePath.split('/').map((segment, index) => (
                  <span className="breadcrumb-segment" key={`${segment}-${index}`}>
                    {index > 0 && <ChevronRight size={12} />}
                    {segment}
                  </span>
                ))
              ) : (
                <span>No markdown file selected</span>
              )}
            </div>

            <div className="editor-actions">
              <button
                className={`save-button ${saveStatus}`}
                type="button"
                onClick={() => void saveCurrentDocument()}
                disabled={!activeFile || saveStatus === 'saving'}
              >
                {saveStatus === 'saving' ? (
                  <LoaderCircle className="save-button-icon spinning" size={14} />
                ) : (
                  <Save className="save-button-icon" size={14} />
                )}
                <span>{getSaveButtonLabel(saveStatus, autoSave)}</span>
              </button>
            </div>
          </header>

          <section className="editor-scroll-area" aria-label="Markdown editor preview">
            {activeFile ? (
              <article className={focusMode ? 'markdown-body focus-mode' : 'markdown-body'}>
                <MarkdownEditor
                  content={documentContent}
                  filePath={activeFile.path}
                  theme={theme}
                  onChange={updateDocumentContent}
                  onToast={showToast}
                />
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
              <button className="settings-nav-item active" type="button">
                Editor
              </button>
              <button className="settings-nav-item" type="button">
                Appearance
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
  theme: ThemeMode;
  onChange: (content: string) => void;
  onToast: (message: Omit<ToastMessage, 'id'>) => void;
}

type TableControlsState = {
  columnCount: number;
  columnIndex: number;
  isHeaderRow: boolean;
  left: number;
  rowCount: number;
  rowIndex: number;
  tablePos: number;
  top: number;
};

type TableGridHoverState = {
  columnCount: number;
  rowCount: number;
};

const TABLE_GRID_MAX_COLUMNS = 10;
const TABLE_GRID_MAX_ROWS = 5;

function MarkdownEditor({
  content,
  filePath,
  theme,
  onChange,
  onToast
}: MarkdownEditorProps): JSX.Element {
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
    [filePath]
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
        attributes: {
          class: theme === 'dark' ? 'veloca-prosemirror theme-dark' : 'veloca-prosemirror theme-light'
        }
      }
    });
  }, [editor, theme]);

  useEffect(() => {
    editorInstanceRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      setTableControls(null);
      setTableGridOpen(false);
      setTableMenuOpen(false);
      setTableGridHover(null);
      return;
    }

    const syncTableControls = () => {
      if (!editorShellRef.current) {
        return;
      }

      const activeTableInfo = getActiveTableInfo(editor);

      if (!activeTableInfo) {
        setTableControls(null);
        setTableGridOpen(false);
        setTableMenuOpen(false);
        setTableGridHover(null);
        return;
      }

      const wrapperDom = editor.view.nodeDOM(activeTableInfo.tablePos);

      if (!(wrapperDom instanceof HTMLElement) || !wrapperDom.classList.contains('tableWrapper')) {
        setTableControls(null);
        return;
      }

      const shellRect = editorShellRef.current.getBoundingClientRect();
      const wrapperRect = wrapperDom.getBoundingClientRect();

      setTableControls({
        ...activeTableInfo,
        left: wrapperRect.left - shellRect.left - 44,
        top: wrapperRect.top - shellRect.top + 12
      });
    };

    const rafSync = () => {
      window.requestAnimationFrame(syncTableControls);
    };

    rafSync();
    editor.on('focus', rafSync);
    editor.on('selectionUpdate', rafSync);
    editor.on('update', rafSync);
    window.addEventListener('resize', rafSync);

    return () => {
      editor.off('focus', rafSync);
      editor.off('selectionUpdate', rafSync);
      editor.off('update', rafSync);
      window.removeEventListener('resize', rafSync);
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
      if (!editorShellRef.current) {
        return;
      }

      const activeTableInfo = getActiveTableInfo(editor);

      if (!activeTableInfo) {
        setTableControls(null);
        return;
      }

      const wrapperDom = editor.view.nodeDOM(activeTableInfo.tablePos);

      if (!(wrapperDom instanceof HTMLElement) || !wrapperDom.classList.contains('tableWrapper')) {
        setTableControls(null);
        return;
      }

      const shellRect = editorShellRef.current.getBoundingClientRect();
      const wrapperRect = wrapperDom.getBoundingClientRect();

      setTableControls({
        ...activeTableInfo,
        left: wrapperRect.left - shellRect.left - 44,
        top: wrapperRect.top - shellRect.top + 12
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

  return (
    <div className="veloca-editor" ref={editorShellRef}>
      {tableControls ? (
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
          </div>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}

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
      onContextMenu={(event) => event.preventDefault()}
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
