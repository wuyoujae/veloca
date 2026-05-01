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

interface WatchedMarkdownFileChange {
  file?: MarkdownFileContent;
  path: string;
  status: 'changed' | 'unavailable';
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

interface SaveMarkdownFileAsResult {
  file: MarkdownFileContent;
  snapshot: WorkspaceSnapshot;
}

interface DocumentProvenanceSnapshot {
  documentKey: string;
  documentPath: string;
  markdownHash: string;
  snapshotJson: string;
  workspaceFolderId: string;
  workspaceType: 'database' | 'filesystem';
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

interface VersionSyncResult {
  reason?: string;
  shadowPath?: string;
  synced: boolean;
}

interface VersionCommitResult {
  commitOid?: string;
  pushed: boolean;
  status: VersionManagerStatus;
}

type AgentUiModel = 'lite' | 'pro' | 'ultra';
type AgentWorkspaceType = 'database' | 'filesystem' | 'none';

interface AiModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow: number;
}

type RemoteDatabaseStatus = 'notConfigured' | 'configured' | 'creating' | 'waiting' | 'initialized' | 'failed';

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

interface AppInfo {
  githubUrl: string;
  license: string;
  logoDataUrl: string;
  name: string;
  version: string;
}

interface UpdateCheckResult {
  checkedAt: number;
  currentVersion: string;
  errorMessage?: string;
  hasUpdate: boolean;
  latestVersion: string | null;
  publishedAt: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  status: 'available' | 'current' | 'unavailable';
}

interface OpenSourceComponent {
  homepage: string;
  license: string;
  name: string;
  repositoryUrl: string;
  version: string;
}

interface AgentAttachmentSummary {
  mimeType: string;
  name: string;
  status: string;
}

interface AgentRuntimeContext {
  brainstormSessionKey?: string;
  currentFilePath?: string;
  selectedText?: string;
  workspaceRootPath?: string;
  workspaceType?: AgentWorkspaceType;
}

interface AgentInheritSessionsResult {
  movedSessions: number;
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

type AgentToolCallStatus = 'running' | 'success' | 'error';

interface AgentToolCallMessage {
  action: string;
  detail?: string;
  icon: string;
  id: string;
  openable: boolean;
  status: AgentToolCallStatus;
  summary?: string;
}

type AgentStreamEvent =
  | {
      content: string;
      model: string;
      sessionId: string;
      type: 'delta' | 'tool_calls';
    }
  | {
      model: string;
      sessionId: string;
      toolCall: AgentToolCallMessage;
      type: 'tool_call';
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
        getAiConfig: () => Promise<AiModelConfig>;
        setAiConfig: (config: AiModelConfig) => Promise<AiModelConfig>;
        getRemoteConfig: () => Promise<RemoteDatabaseConfigView>;
        getRemoteSyncConfig: () => Promise<RemoteSyncConfig>;
        saveRemoteConfig: (config: RemoteDatabaseConfigInput) => Promise<RemoteDatabaseConfigView>;
        saveRemoteSyncConfig: (config: RemoteSyncConfig) => Promise<RemoteSyncConfig>;
      };
      remote: {
        createVelocaProject: (config: RemoteDatabaseConfigInput) => Promise<RemoteProjectProvisionResult>;
        getSyncStatus: () => Promise<RemoteSyncStatus>;
        listAvailableRegions: (config: RemoteDatabaseConfigInput) => Promise<RemoteRegionOption[]>;
        retryFailedSync: () => Promise<RemoteSyncStatus>;
        syncNow: () => Promise<RemoteSyncStatus>;
        testConnection: () => Promise<RemoteDatabaseConfigView>;
      };
      workspace: {
        get: () => Promise<WorkspaceSnapshot>;
        addFolder: () => Promise<WorkspaceSnapshot>;
        createDatabaseWorkspace: (name: string) => Promise<FileOperationResult>;
        readMarkdown: (filePath: string) => Promise<MarkdownFileContent>;
        watchMarkdownFiles: (filePaths: string[]) => Promise<void>;
        saveMarkdown: (filePath: string, content: string) => Promise<MarkdownFileContent>;
        saveMarkdownAs: (
          parentPath: string,
          name: string,
          content: string
        ) => Promise<SaveMarkdownFileAsResult>;
        readProvenance: (documentKey: string) => Promise<DocumentProvenanceSnapshot | null>;
        saveProvenance: (snapshot: DocumentProvenanceSnapshot) => Promise<DocumentProvenanceSnapshot>;
        deleteProvenance: (documentKey: string) => Promise<void>;
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
        onMarkdownFileChanged: (callback: (change: WatchedMarkdownFileChange) => void) => () => void;
      };
      app: {
        checkForUpdates: () => Promise<UpdateCheckResult>;
        getInfo: () => Promise<AppInfo>;
        listOpenSourceComponents: () => Promise<OpenSourceComponent[]>;
        openExternal: (url: string) => Promise<void>;
        platform: NodeJS.Platform;
      };
      windowControls: {
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
        minimize: () => Promise<void>;
        toggleMaximize: () => Promise<boolean>;
        onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
      };
      github: {
        getStatus: () => Promise<GitHubAuthStatus>;
        startBinding: () => Promise<GitHubDeviceBinding>;
        completeBinding: (sessionId: string) => Promise<GitHubAuthStatus>;
        unbind: () => Promise<GitHubAuthStatus>;
        openVerificationUrl: (url: string) => Promise<void>;
      };
      versionManager: {
        getStatus: () => Promise<VersionManagerStatus>;
        ensureRepository: () => Promise<VersionManagerStatus>;
        syncMarkdownFile: (filePath: string) => Promise<VersionSyncResult>;
        listManagedChanges: () => Promise<VersionManagedChange[]>;
        commitAndPush: (message: string) => Promise<VersionCommitResult>;
      };
      agent: {
        listSessions: (context?: AgentRuntimeContext) => Promise<AgentStoredSession[]>;
        createSession: (context?: AgentRuntimeContext) => Promise<AgentStoredSession>;
        inheritSessions: (
          sourceContext?: AgentRuntimeContext,
          targetContext?: AgentRuntimeContext
        ) => Promise<AgentInheritSessionsResult>;
        sendMessage: (payload: AgentSendMessageRequest) => Promise<AgentSendMessageResponse>;
        streamMessage: (payload: AgentSendMessageRequest, callback: (event: AgentStreamEvent) => void) => () => void;
        onOpenPalette: (callback: () => void) => () => void;
      };
    };
  }
}
