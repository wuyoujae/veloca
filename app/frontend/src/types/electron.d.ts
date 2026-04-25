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

type AgentUiModel = 'lite' | 'pro' | 'ultra';
type AgentWorkspaceType = 'database' | 'filesystem' | 'none';

interface AgentAttachmentSummary {
  mimeType: string;
  name: string;
  status: string;
}

interface AgentRuntimeContext {
  currentFilePath?: string;
  selectedText?: string;
  workspaceRootPath?: string;
  workspaceType?: AgentWorkspaceType;
}

interface AgentSendMessageRequest {
  attachments?: AgentAttachmentSummary[];
  context?: AgentRuntimeContext;
  message: string;
  model: AgentUiModel;
  sessionId: string;
  webSearch?: boolean;
}

interface AgentSendMessageResponse {
  answer: string;
  model: string;
  sessionId: string;
}

interface AgentStoredConversation {
  answer: string;
  attachments: AgentAttachmentSummary[];
  id: string;
  model: AgentUiModel;
  prompt: string;
  status: 'complete';
  webSearch: boolean;
}

interface AgentStoredSession {
  id: string;
  messages: AgentStoredConversation[];
  name: string;
}

type AgentStreamEvent =
  | {
      content: string;
      model: string;
      sessionId: string;
      type: 'delta' | 'tool_calls';
    }
  | {
      answer: string;
      model: string;
      sessionId: string;
      type: 'complete';
    }
  | {
      error: string;
      model: string;
      sessionId: string;
      type: 'error';
    };

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
        onChanged: (callback: (snapshot: WorkspaceSnapshot) => void) => () => void;
      };
      app: {
        platform: NodeJS.Platform;
      };
      agent: {
        listSessions: (context?: AgentRuntimeContext) => Promise<AgentStoredSession[]>;
        createSession: (context?: AgentRuntimeContext) => Promise<AgentStoredSession>;
        sendMessage: (payload: AgentSendMessageRequest) => Promise<AgentSendMessageResponse>;
        streamMessage: (payload: AgentSendMessageRequest, callback: (event: AgentStreamEvent) => void) => () => void;
        onOpenPalette: (callback: () => void) => () => void;
      };
    };
  }
}
