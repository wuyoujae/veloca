import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Feather,
  FileText,
  Folder,
  Info,
  Moon,
  Search,
  Settings,
  Share,
  Sun,
  X
} from 'lucide-react';

type ThemeMode = 'dark' | 'light';
type ToastType = 'success' | 'info';

interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  description: string;
}

const sampleMarkdown = `# Veloca Manifesto

Writing should be completely frictionless. Veloca is built on a simple philosophy: the interface should dissolve, leaving only you and your typography.

> Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.

## Design Language

Veloca follows a focused monochrome interface with measured spacing, clear hierarchy, and a calm writing surface.

\`\`\`ts
const editor = {
  mode: 'live-preview',
  theme: 'system-ready',
  storage: 'sqlite'
};
\`\`\`
`;

export function App(): JSX.Element {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const wordCount = useMemo(() => {
    return sampleMarkdown.trim().split(/\s+/).filter(Boolean).length;
  }, []);

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
      <header className="titlebar">
        <div className="titlebar-left">
          <Feather size={14} />
          <span>Veloca</span>
        </div>
        <div className="window-controls" aria-hidden="true">
          <span className="control-dot" />
          <span className="control-dot" />
          <span className="control-dot" />
        </div>
      </header>

      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="tabs-list">
              <button className="tab-trigger active" type="button">
                Files
              </button>
              <button className="tab-trigger" type="button">
                Outline
              </button>
            </div>
          </div>

          <nav className="sidebar-content" aria-label="Workspace files">
            <button className="tree-item" type="button">
              <ChevronDown size={14} />
              <Folder size={14} />
              <span>Project Veloca</span>
            </button>
            <button className="tree-item tree-indent" type="button">
              <ChevronDown size={14} />
              <Folder size={14} />
              <span>docs</span>
            </button>
            <button className="tree-item tree-indent deep active" type="button">
              <FileText size={14} />
              <span>manifesto.md</span>
            </button>
            <button className="tree-item tree-indent deep" type="button">
              <FileText size={14} />
              <span>design-system.md</span>
            </button>
            <button className="tree-item tree-indent" type="button">
              <ChevronRight size={14} />
              <Folder size={14} />
              <span>components</span>
            </button>
            <button className="tree-item tree-indent" type="button">
              <FileText size={14} />
              <span>readme.md</span>
            </button>
          </nav>

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
              docs <ChevronRight size={12} /> manifesto.md
            </div>
            <div className="editor-actions">
              <button className="icon-btn" type="button" aria-label="Search">
                <Search size={16} />
              </button>
              <button className="icon-btn" type="button" aria-label="Reading mode">
                <BookOpen size={16} />
              </button>
              <button className="icon-btn" type="button" aria-label="Export or share">
                <Share size={16} />
              </button>
            </div>
          </header>

          <section className="editor-scroll-area" aria-label="Markdown editor preview">
            <article className="markdown-body">
              <h1>Veloca Manifesto</h1>
              <p>
                Writing should be completely frictionless. Veloca is built on a simple philosophy:
                the interface should dissolve, leaving only you and your typography.
              </p>
              <blockquote>
                Perfection is achieved, not when there is nothing more to add, but when there is
                nothing left to take away.
              </blockquote>
              <h2>Design Language</h2>
              <p>
                Veloca follows a focused monochrome interface with measured spacing, clear hierarchy,
                and a calm writing surface.
              </p>
              <pre>
                <code>{`const editor = {
  mode: 'live-preview',
  theme: '${theme}',
  storage: 'sqlite'
};`}</code>
              </pre>
              <h2>Foundation</h2>
              <p>
                The first milestone is a stable Electron shell, a React renderer, a Node backend
                surface, and persistent application settings.
                <span className="cursor" />
              </p>
            </article>
          </section>

          <footer className="statusbar">
            <span>{wordCount} Words</span>
            <span>{sampleMarkdown.length} Characters</span>
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
