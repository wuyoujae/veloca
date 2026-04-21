import { useEffect, useMemo, useState, type MouseEvent } from 'react';
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

type ThemeMode = 'dark' | 'light';
type SidebarTab = 'files' | 'outline';
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
  lines: string[];
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

const emptyWorkspace: WorkspaceSnapshot = {
  folders: [],
  tree: [],
  totalMarkdownFiles: 0
};

export function App(): JSX.Element {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(emptyWorkspace);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [activeFile, setActiveFile] = useState<MarkdownFileContent | null>(null);
  const [activeHeadingId, setActiveHeadingId] = useState<string>('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileClipboard, setFileClipboard] = useState<FileClipboard | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const sections = useMemo(() => {
    return parseMarkdownSections(activeFile?.content ?? '', activeFile?.name ?? 'Untitled');
  }, [activeFile]);

  const wordCount = useMemo(() => {
    return activeFile?.content.trim().split(/\s+/).filter(Boolean).length ?? 0;
  }, [activeFile]);

  useEffect(() => {
    window.veloca?.settings.getTheme().then((storedTheme) => {
      applyTheme(storedTheme);
      setTheme(storedTheme);
    });

    if (!window.veloca) {
      const fallbackTheme = localStorage.getItem('veloca-theme') === 'light' ? 'light' : 'dark';
      applyTheme(fallbackTheme);
      setTheme(fallbackTheme);
    }
  }, []);

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

  const refreshWorkspaceAfterOperation = async (snapshot: WorkspaceSnapshot, selectedPath?: string) => {
    setWorkspace(snapshot);
    openWorkspaceRoots(snapshot.tree);

    if (selectedPath && selectedPath.endsWith('.md')) {
      await readMarkdownFile(selectedPath);
      return;
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
    }
  };

  const readMarkdownFile = async (filePath: string) => {
    if (!window.veloca) {
      return;
    }

    setLoadingFile(true);

    try {
      const file = await window.veloca.workspace.readMarkdown(filePath);
      setActiveFile(file);
      setSidebarTab('files');
    } catch {
      showToast({
        type: 'info',
        title: 'File Not Loaded',
        description: 'Only markdown files inside the current workspace can be opened.'
      });
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
    window.requestAnimationFrame(() => {
      document.getElementById(headingId)?.scrollIntoView({
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
    const label = entryType === 'file' ? 'file' : 'folder';
    const name = window.prompt(`New ${label} name`);

    if (!name || !window.veloca) {
      return;
    }

    try {
      const result = await window.veloca.workspace.createEntry(node.path, entryType, name);
      await refreshWorkspaceAfterOperation(result.snapshot, result.path);
    } catch {
      showToast({
        type: 'info',
        title: 'Create Failed',
        description: `Unable to create that ${label}.`
      });
    }
  };

  const renameEntry = async (node: WorkspaceTreeNode) => {
    const name = window.prompt('Rename', node.name);

    if (!name || !window.veloca) {
      return;
    }

    try {
      const result = await window.veloca.workspace.renameEntry(node.path, name);
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
                loading={loadingWorkspace}
                openFolders={openFolders}
                tree={workspace.tree}
                onAddFolder={addWorkspaceFolder}
                onContextMenu={openContextMenu}
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
                {sections.map((section) => (
                  <section
                    className={
                      activeHeadingId === section.id ? 'document-section active' : 'document-section'
                    }
                    id={section.id}
                    key={section.id}
                    onMouseEnter={() => setActiveHeadingId(section.id)}
                  >
                    {renderHeading(section)}
                    {renderMarkdownLines(section.lines)}
                  </section>
                ))}
                {loadingFile && <div className="loading-state">Loading file...</div>}
              </article>
            ) : (
              <div className="empty-editor-state">
                <FileText size={24} />
                <h1>No Markdown Loaded</h1>
                <p>Add a workspace folder to recursively load its markdown files.</p>
                <button className="primary-action" type="button" onClick={addWorkspaceFolder}>
                  <FolderPlus size={16} />
                  Add Folder
                </button>
              </div>
            )}
          </section>

          <footer className="statusbar">
            <span>{wordCount} Words</span>
            <span>{activeFile?.content.length ?? 0} Characters</span>
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
  loading: boolean;
  openFolders: Record<string, boolean>;
  tree: WorkspaceTreeNode[];
  onAddFolder: () => void;
  onContextMenu: (event: MouseEvent, node: WorkspaceTreeNode) => void;
  onFileSelect: (filePath: string) => void;
  onFolderToggle: (folderId: string) => void;
}

function FileTree({
  activeFilePath,
  loading,
  openFolders,
  tree,
  onAddFolder,
  onContextMenu,
  onFileSelect,
  onFolderToggle
}: FileTreeProps): JSX.Element {
  return (
    <nav aria-label="Workspace files">
      <div className="directory-toolbar">
        <span>Workspace</span>
        <button className="toolbar-icon-btn" type="button" aria-label="Add folder" onClick={onAddFolder}>
          <FolderPlus size={16} />
        </button>
      </div>

      {loading && <div className="loading-state">Loading workspace...</div>}

      {!loading && tree.length === 0 && (
        <div className="empty-sidebar-state">
          <Folder size={18} />
          <p>Add folders to load markdown files recursively.</p>
        </div>
      )}

      {!loading &&
        tree.map((node) => (
          <TreeNode
            activeFilePath={activeFilePath}
            depth={0}
            key={node.id}
            node={node}
            openFolders={openFolders}
            onContextMenu={onContextMenu}
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
  node: WorkspaceTreeNode;
  openFolders: Record<string, boolean>;
  onContextMenu: (event: MouseEvent, node: WorkspaceTreeNode) => void;
  onFileSelect: (filePath: string) => void;
  onFolderToggle: (folderId: string) => void;
}

function TreeNode({
  activeFilePath,
  depth,
  node,
  openFolders,
  onContextMenu,
  onFileSelect,
  onFolderToggle
}: TreeNodeProps): JSX.Element {
  const isOpen = openFolders[node.id] ?? false;
  const paddingLeft = 10 + depth * 18;

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
        <span>{node.name}</span>
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
        <Folder size={14} />
        <span>{node.name}</span>
      </button>

      {isOpen && (
        <div className="tree-branch">
          {node.children?.map((child) => (
            <TreeNode
              activeFilePath={activeFilePath}
              depth={depth + 1}
              key={child.id}
              node={child}
              openFolders={openFolders}
              onContextMenu={onContextMenu}
              onFileSelect={onFileSelect}
              onFolderToggle={onFolderToggle}
            />
          ))}
        </div>
      )}
    </div>
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

      {isFolder && (
        <ContextMenuItem icon={<ExternalLink size={14} />} label="Open in Finder" onClick={() => runAction(() => onOpen(node))} />
      )}
      <ContextMenuItem icon={<Folder size={14} />} label="Reveal in Finder" onClick={() => runAction(() => onReveal(node))} />
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

function parseMarkdownSections(content: string, fallbackTitle: string): MarkdownSection[] {
  const lines = content.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);

    if (match) {
      if (current) {
        sections.push(current);
      }

      current = {
        id: slugify(match[2], sections.length),
        level: match[1].length,
        title: match[2].trim(),
        lines: []
      };
      continue;
    }

    if (!current) {
      current = {
        id: 'document',
        level: 1,
        title: fallbackTitle,
        lines: []
      };
    }

    current.lines.push(line);
  }

  if (current) {
    sections.push(current);
  }

  return sections.length > 0
    ? sections
    : [
        {
          id: 'document',
          level: 1,
          title: fallbackTitle,
          lines: []
        }
      ];
}

function renderHeading(section: MarkdownSection): JSX.Element {
  if (section.level === 1) {
    return <h1>{section.title}</h1>;
  }

  if (section.level === 2) {
    return <h2>{section.title}</h2>;
  }

  return <h3>{section.title}</h3>;
}

function renderMarkdownLines(lines: string[]): JSX.Element[] {
  const elements: JSX.Element[] = [];
  let paragraph: string[] = [];
  let codeLines: string[] = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    elements.push(<p key={`p-${elements.length}`}>{paragraph.join(' ')}</p>);
    paragraph = [];
  };

  const flushCode = () => {
    elements.push(
      <pre key={`code-${elements.length}`}>
        <code>{codeLines.join('\n')}</code>
      </pre>
    );
    codeLines = [];
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        flushParagraph();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('>')) {
      flushParagraph();
      elements.push(<blockquote key={`quote-${elements.length}`}>{line.replace(/^>\s?/, '')}</blockquote>);
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();

  if (inCodeBlock) {
    flushCode();
  }

  return elements;
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
