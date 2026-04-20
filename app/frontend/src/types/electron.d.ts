export {};

interface WorkspaceTreeNode {
  id: string;
  name: string;
  type: 'folder' | 'file';
  path: string;
  relativePath: string;
  workspaceFolderId: string;
  children?: WorkspaceTreeNode[];
}

interface WorkspaceFolder {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

interface WorkspaceSnapshot {
  folders: WorkspaceFolder[];
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

declare global {
  interface Window {
    veloca?: {
      settings: {
        getTheme: () => Promise<'dark' | 'light'>;
        setTheme: (theme: 'dark' | 'light') => Promise<'dark' | 'light'>;
      };
      workspace: {
        get: () => Promise<WorkspaceSnapshot>;
        addFolder: () => Promise<WorkspaceSnapshot>;
        readMarkdown: (filePath: string) => Promise<MarkdownFileContent>;
      };
      app: {
        platform: NodeJS.Platform;
      };
    };
  }
}
