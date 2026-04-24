export {};

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

interface WorkspaceAssetPayload {
  data: ArrayBuffer | Uint8Array;
  fileName: string;
  mimeType: string;
}

interface WorkspaceResolvedAsset {
  assetPath: string;
  byteSize: number;
  exists: boolean;
  fileName: string;
  isExternal: boolean;
  mimeType: string;
  url: string;
}

interface FileOperationResult {
  snapshot: WorkspaceSnapshot;
  path?: string;
}

declare global {
  interface Window {
    veloca?: {
      settings: {
        getTheme: () => Promise<'dark' | 'light'>;
        setTheme: (theme: 'dark' | 'light') => Promise<'dark' | 'light'>;
        getAutoSave: () => Promise<boolean>;
        setAutoSave: (enabled: boolean) => Promise<boolean>;
      };
      workspace: {
        get: () => Promise<WorkspaceSnapshot>;
        addFolder: () => Promise<WorkspaceSnapshot>;
        createDatabaseWorkspace: (name: string) => Promise<FileOperationResult>;
        readMarkdown: (filePath: string) => Promise<MarkdownFileContent>;
        saveMarkdown: (filePath: string, content: string) => Promise<MarkdownFileContent>;
        saveAsset: (documentPath: string, payload: WorkspaceAssetPayload) => Promise<WorkspaceResolvedAsset>;
        resolveAsset: (documentPath: string, assetPath: string) => Promise<WorkspaceResolvedAsset>;
        readAssetMeta: (documentPath: string, assetPath: string) => Promise<WorkspaceResolvedAsset>;
        createEntry: (
          parentPath: string,
          entryType: 'file' | 'folder',
          name: string
        ) => Promise<FileOperationResult>;
        renameEntry: (filePath: string, name: string) => Promise<FileOperationResult>;
        duplicateEntry: (filePath: string) => Promise<FileOperationResult>;
        pasteEntry: (
          sourcePath: string,
          targetFolderPath: string,
          mode: 'copy' | 'cut'
        ) => Promise<FileOperationResult>;
        deleteEntry: (filePath: string) => Promise<WorkspaceSnapshot>;
        removeFolder: (workspaceFolderId: string) => Promise<WorkspaceSnapshot>;
        reveal: (filePath: string) => Promise<void>;
        openPath: (filePath: string) => Promise<string>;
        copyPath: (filePath: string) => Promise<void>;
      };
      app: {
        platform: NodeJS.Platform;
      };
      agent: {
        onOpenPalette: (callback: () => void) => () => void;
      };
    };
  }
}
