import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Info,
  Moon,
  Settings,
  Sun,
  X
} from 'lucide-react';

type ThemeMode = 'dark' | 'light';
type SidebarTab = 'files' | 'outline';
type FolderId = 'project' | 'docs' | 'components';
type ToastType = 'success' | 'info';

interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  description: string;
}

interface Section {
  id: string;
  level: 1 | 2 | 3;
  title: string;
  body: string;
  quote?: string;
  code?: string;
}

interface DocumentFile {
  id: string;
  name: string;
  folder: FolderId;
  path: string[];
  sections: Section[];
}

const documents: DocumentFile[] = [
  {
    id: 'manifesto',
    name: 'manifesto.md',
    folder: 'docs',
    path: ['docs', 'manifesto.md'],
    sections: [
      {
        id: 'veloca-manifesto',
        level: 1,
        title: 'Veloca Manifesto',
        body: 'Writing should be completely frictionless. Veloca is built on a simple philosophy: the interface should dissolve, leaving only you and your typography.',
        quote:
          'Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.'
      },
      {
        id: 'design-language',
        level: 2,
        title: 'Design Language',
        body: 'Veloca follows a focused monochrome interface with measured spacing, clear hierarchy, and a calm writing surface.',
        code: `const editor = {
  mode: 'live-preview',
  theme: 'system-ready',
  storage: 'sqlite'
};`
      },
      {
        id: 'foundation',
        level: 2,
        title: 'Foundation',
        body: 'The first milestone is a stable Electron shell, a React renderer, a Node backend surface, and persistent application settings.'
      }
    ]
  },
  {
    id: 'design-system',
    name: 'design-system.md',
    folder: 'docs',
    path: ['docs', 'design-system.md'],
    sections: [
      {
        id: 'design-system',
        level: 1,
        title: 'Design System',
        body: 'Veloca keeps the editor surface quiet and gives hierarchy to navigation, document structure, and focused writing states.'
      },
      {
        id: 'color',
        level: 2,
        title: 'Color',
        body: 'The palette is intentionally restrained. Dark and light modes use the same layout rhythm, with contrast tuned for long writing sessions.'
      },
      {
        id: 'motion',
        level: 2,
        title: 'Motion',
        body: 'Transitions should feel responsive without drawing attention away from the page. Panels fade and slide softly, while active states move quickly.'
      }
    ]
  },
  {
    id: 'component-notes',
    name: 'component-notes.md',
    folder: 'components',
    path: ['components', 'component-notes.md'],
    sections: [
      {
        id: 'components',
        level: 1,
        title: 'Component Notes',
        body: 'The first shared components are small interface primitives used by the shell: tabs, tree rows, switches, segmented controls, and toasts.'
      },
      {
        id: 'sidebar',
        level: 2,
        title: 'Sidebar',
        body: 'The sidebar switches between file navigation and document outline while preserving the current document selection.'
      },
      {
        id: 'settings',
        level: 2,
        title: 'Settings',
        body: 'The settings panel should remain modal, focused, and easy to close with either the close button, Escape, or the blurred backdrop.'
      }
    ]
  },
  {
    id: 'readme',
    name: 'readme.md',
    folder: 'project',
    path: ['readme.md'],
    sections: [
      {
        id: 'readme',
        level: 1,
        title: 'Readme',
        body: 'Veloca is currently in its foundation stage. The interface is interactive, while real file IO and markdown editing will be layered in next.'
      },
      {
        id: 'quick-start',
        level: 2,
        title: 'Quick Start',
        body: 'Install dependencies, start the Electron development server, then use the sidebar and settings panel to inspect the current shell behavior.'
      }
    ]
  }
];

const initialFolders: Record<FolderId, boolean> = {
  project: true,
  docs: true,
  components: false
};

export function App(): JSX.Element {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [openFolders, setOpenFolders] = useState<Record<FolderId, boolean>>(initialFolders);
  const [activeFileId, setActiveFileId] = useState(documents[0].id);
  const [activeHeadingId, setActiveHeadingId] = useState(documents[0].sections[0].id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const activeFile = documents.find((document) => document.id === activeFileId) ?? documents[0];
  const activeFileText = useMemo(() => {
    return activeFile.sections
      .map((section) => `${'#'.repeat(section.level)} ${section.title}\n${section.body}`)
      .join('\n');
  }, [activeFile]);

  const wordCount = useMemo(() => {
    return activeFileText.trim().split(/\s+/).filter(Boolean).length;
  }, [activeFileText]);

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

  const toggleFolder = (folderId: FolderId) => {
    setOpenFolders((current) => ({
      ...current,
      [folderId]: !current[folderId]
    }));
  };

  const openFile = (fileId: string) => {
    const nextFile = documents.find((document) => document.id === fileId);

    if (!nextFile) {
      return;
    }

    setActiveFileId(fileId);
    setActiveHeadingId(nextFile.sections[0].id);
    setOpenFolders((current) => ({
      ...current,
      project: true,
      [nextFile.folder]: true
    }));
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
                activeFileId={activeFileId}
                openFolders={openFolders}
                onFileSelect={openFile}
                onFolderToggle={toggleFolder}
              />
            ) : (
              <OutlinePanel
                activeFile={activeFile}
                activeHeadingId={activeHeadingId}
                onHeadingSelect={setActiveHeadingId}
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
              {activeFile.path.map((segment, index) => (
                <span className="breadcrumb-segment" key={segment}>
                  {index > 0 && <ChevronRight size={12} />}
                  {segment}
                </span>
              ))}
            </div>
          </header>

          <section className="editor-scroll-area" aria-label="Markdown editor preview">
            <article className={focusMode ? 'markdown-body focus-mode' : 'markdown-body'}>
              {activeFile.sections.map((section, index) => (
                <section
                  className={activeHeadingId === section.id ? 'document-section active' : 'document-section'}
                  key={section.id}
                  onMouseEnter={() => setActiveHeadingId(section.id)}
                >
                  {section.level === 1 ? <h1>{section.title}</h1> : <h2>{section.title}</h2>}
                  <p>
                    {section.body}
                    {index === activeFile.sections.length - 1 && <span className="cursor" />}
                  </p>
                  {section.quote && <blockquote>{section.quote}</blockquote>}
                  {section.code && (
                    <pre>
                      <code>
                        {section.code.replace('system-ready', theme)}
                      </code>
                    </pre>
                  )}
                </section>
              ))}
            </article>
          </section>

          <footer className="statusbar">
            <span>{wordCount} Words</span>
            <span>{activeFileText.length} Characters</span>
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
    </div>
  );
}

interface FileTreeProps {
  activeFileId: string;
  openFolders: Record<FolderId, boolean>;
  onFileSelect: (fileId: string) => void;
  onFolderToggle: (folderId: FolderId) => void;
}

function FileTree({
  activeFileId,
  openFolders,
  onFileSelect,
  onFolderToggle
}: FileTreeProps): JSX.Element {
  const docsFiles = documents.filter((document) => document.folder === 'docs');
  const componentFiles = documents.filter((document) => document.folder === 'components');
  const rootFiles = documents.filter((document) => document.folder === 'project');

  return (
    <nav aria-label="Workspace files">
      <FolderRow
        depth="root"
        label="Project Veloca"
        open={openFolders.project}
        onClick={() => onFolderToggle('project')}
      />
      {openFolders.project && (
        <div className="tree-branch">
          <FolderRow
            depth="child"
            label="docs"
            open={openFolders.docs}
            onClick={() => onFolderToggle('docs')}
          />
          {openFolders.docs &&
            docsFiles.map((document) => (
              <FileRow
                active={activeFileId === document.id}
                depth="deep"
                document={document}
                key={document.id}
                onClick={() => onFileSelect(document.id)}
              />
            ))}

          <FolderRow
            depth="child"
            label="components"
            open={openFolders.components}
            onClick={() => onFolderToggle('components')}
          />
          {openFolders.components &&
            componentFiles.map((document) => (
              <FileRow
                active={activeFileId === document.id}
                depth="deep"
                document={document}
                key={document.id}
                onClick={() => onFileSelect(document.id)}
              />
            ))}

          {rootFiles.map((document) => (
            <FileRow
              active={activeFileId === document.id}
              depth="child"
              document={document}
              key={document.id}
              onClick={() => onFileSelect(document.id)}
            />
          ))}
        </div>
      )}
    </nav>
  );
}

interface FolderRowProps {
  depth: 'root' | 'child';
  label: string;
  open: boolean;
  onClick: () => void;
}

function FolderRow({ depth, label, open, onClick }: FolderRowProps): JSX.Element {
  return (
    <button className={`tree-item ${depth === 'child' ? 'tree-indent' : ''}`} type="button" onClick={onClick}>
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      <Folder size={14} />
      <span>{label}</span>
    </button>
  );
}

interface FileRowProps {
  active: boolean;
  depth: 'child' | 'deep';
  document: DocumentFile;
  onClick: () => void;
}

function FileRow({ active, depth, document, onClick }: FileRowProps): JSX.Element {
  return (
    <button
      className={`tree-item tree-indent ${depth === 'deep' ? 'deep' : ''} ${active ? 'active' : ''}`}
      type="button"
      onClick={onClick}
    >
      <FileText size={14} />
      <span>{document.name}</span>
    </button>
  );
}

interface OutlinePanelProps {
  activeFile: DocumentFile;
  activeHeadingId: string;
  onHeadingSelect: (headingId: string) => void;
}

function OutlinePanel({
  activeFile,
  activeHeadingId,
  onHeadingSelect
}: OutlinePanelProps): JSX.Element {
  return (
    <nav className="outline-panel" aria-label="Document outline">
      <div className="outline-heading">
        <FileText size={14} />
        <span>{activeFile.name}</span>
      </div>
      <div className="outline-list">
        {activeFile.sections.map((section) => (
          <button
            className={`outline-item level-${section.level} ${
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
