import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent, useEditor } from '@tiptap/react';
import {
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
  Info,
  Moon,
  Pencil,
  Settings,
  Scissors,
  Sun,
  Trash2,
  X
} from 'lucide-react';
import { marked } from 'marked';
import TurndownService from 'turndown';

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

const turndownService = new TurndownService({
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
  headingStyle: 'atx',
  hr: '---',
  strongDelimiter: '**'
});

turndownService.addRule('strikethrough', {
  filter(node) {
    return ['del', 's', 'strike'].includes(node.nodeName.toLowerCase());
  },
  replacement(content: string) {
    return `~~${content}~~`;
  }
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
    setActiveHeadingId(sections[0]?.id ?? '');
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
          </header>

          <section className="editor-scroll-area" aria-label="Markdown editor preview">
            {activeFile ? (
              <article className={focusMode ? 'markdown-body focus-mode' : 'markdown-body'}>
                <MarkdownEditor
                  content={documentContent}
                  filePath={activeFile.path}
                  theme={theme}
                  onChange={updateDocumentContent}
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
            <FilePlus size={16} />
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
}

function MarkdownEditor({ content, filePath, theme, onChange }: MarkdownEditorProps): JSX.Element {
  const contentRef = useRef(content);
  const onChangeRef = useRef(onChange);
  const syncingRef = useRef(false);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor(
    {
      content: markdownToEditorHtml(content),
      editorProps: {
        attributes: {
          class: theme === 'dark' ? 'veloca-prosemirror theme-dark' : 'veloca-prosemirror theme-light'
        }
      },
      extensions: [
        StarterKit.configure({
          codeBlock: {
            HTMLAttributes: {
              class: 'veloca-code-block'
            }
          },
          heading: {
            levels: [1, 2, 3, 4, 5, 6]
          }
        }),
        Placeholder.configure({
          placeholder: 'Start writing in Markdown...'
        })
      ],
      immediatelyRender: false,
      onUpdate: ({ editor: currentEditor }) => {
        if (syncingRef.current) {
          return;
        }

        const nextMarkdown = editorHtmlToMarkdown(currentEditor.getHTML());

        if (nextMarkdown !== contentRef.current) {
          onChangeRef.current(nextMarkdown);
        }
      }
    },
    [filePath]
  );

  useEffect(() => {
    if (!editor) {
      return;
    }

    const nextHtml = markdownToEditorHtml(content);

    if (editor.getHTML() === nextHtml) {
      return;
    }

    syncingRef.current = true;
    editor.commands.setContent(nextHtml, {
      emitUpdate: false
    });
    syncingRef.current = false;
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

  return (
    <div className="veloca-editor">
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
          <FilePlus size={18} />
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

function markdownToEditorHtml(markdown: string): string {
  if (!markdown.trim()) {
    return '<p></p>';
  }

  const rendered = marked.parse(markdown);
  return typeof rendered === 'string' ? rendered : '<p></p>';
}

function editorHtmlToMarkdown(html: string): string {
  if (!html.trim()) {
    return '';
  }

  return turndownService
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
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

function parseMarkdownSections(content: string, fallbackTitle: string): MarkdownSection[] {
  const lines = content.split(/\r?\n/);
  const sections: MarkdownSection[] = [];

  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);

    if (match) {
      sections.push({
        id: slugify(match[2], sections.length),
        level: match[1].length,
        title: match[2].trim()
      });
    }

    if (index === lines.length - 1 && sections.length === 0) {
      sections.push({
        id: 'document',
        level: 1,
        title: fallbackTitle
      });
    }
  });

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
