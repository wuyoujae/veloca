import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { veloca } from 'otherone-agent';
import { getDatabase } from '../database/connection';
import { getWorkspaceSnapshot, readMarkdownFile, type WorkspaceSnapshot, type WorkspaceTreeNode } from './workspace-service';
import { getAiBaseUrl, getAiApiKey, getAiModel, getAiContextWindow } from './settings-store';
import { attachStoredReasoningToMessages, getStoredReasoningContent } from './agent-reasoning';

export type AgentUiModel = 'lite' | 'pro' | 'ultra';

export interface AgentAttachmentSummary {
  mimeType: string;
  name: string;
  status: string;
}

export type AgentWorkspaceType = 'database' | 'filesystem' | 'none';

export interface AgentRuntimeContext {
  brainstormSessionKey?: string;
  currentFilePath?: string;
  selectedText?: string;
  workspaceRootPath?: string;
  workspaceType?: AgentWorkspaceType;
}

export interface AgentInheritSessionsResult {
  movedSessions: number;
}

export interface AgentSendMessageRequest {
  attachments?: AgentAttachmentSummary[];
  context?: AgentRuntimeContext;
  message: string;
  model: AgentUiModel;
  sessionId: string;
  webSearch?: boolean;
}

export interface AgentSendMessageResponse {
  answer: string;
  model: string;
  sessionId: string;
}

export interface AgentRuntimeHooks {
  onToolCallItem?: (toolCall: AgentToolCallMessage) => void;
  onWorkspaceChanged?: (snapshot: WorkspaceSnapshot) => void;
}

export interface AgentStoredConversation {
  answer: string;
  attachments: AgentAttachmentSummary[];
  id: string;
  model: AgentUiModel;
  prompt: string;
  status: 'complete';
  webSearch: boolean;
}

export interface AgentStoredSession {
  id: string;
  messages: AgentStoredConversation[];
  name: string;
}

export type AgentToolCallStatus = 'running' | 'success' | 'error';

export interface AgentToolCallMessage {
  action: string;
  detail?: string;
  icon: string;
  id: string;
  openable: boolean;
  status: AgentToolCallStatus;
  summary?: string;
}

export type AgentStreamEvent =
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

const defaultAgentBaseUrl = 'https://openrouter.ai/api/v1';
const defaultAgentModel = 'google/gemini-3.1-flash-lite-preview';
const defaultContextWindow = 128000;
const bashDefaultTimeoutMs = 10000;
const bashMaxCommandLength = 2000;
const bashMaxOutputBytes = 16384;
const bashMaxTimeoutMs = 120000;
const bashSandboxExecPath = '/usr/bin/sandbox-exec';
const powerShellDefaultTimeoutMs = 10000;
const powerShellMaxCommandLength = 2000;
const powerShellMaxTimeoutMs = 120000;
const replDefaultTimeoutMs = 10000;
const replMaxCodeLength = 20000;
const replMaxTimeoutMs = 120000;
const webFetchMaxPromptLength = 4000;
const webFetchTimeoutMs = 20000;
const webSearchDefaultBaseUrl = 'https://html.duckduckgo.com/html/';
const webSearchMaxDomainFilters = 20;
const webSearchMaxQueryLength = 500;
const webSearchMaxResults = 8;
const webSearchTimeoutMs = 20000;
const maxGlobPatternExpansions = 64;
const maxGlobPatternLength = 1000;
const maxGlobSearchResults = 100;
const defaultGrepSearchLimit = 250;
const maxGrepPatternLength = 1000;
const maxDirectoryTreeCharacters = 30000;
const maxDirectoryTreeDepth = 8;
const maxDirectoryTreeNodes = 1200;
const maxPromptLength = 20000;
const maxReadFileBytes = 10 * 1024 * 1024;
const maxWriteFileBytes = 10 * 1024 * 1024;
const readFileBinarySampleBytes = 8192;
const agentStorageDirectory = join(process.cwd(), '.veloca', 'storage');
const agentStorageFilePath = join(agentStorageDirectory, 'veloca-storage.json');
const agentSessionWorkspaceIndexPath = join(agentStorageDirectory, 'veloca-session-workspaces.json');
const agentBrainstormWorkspaceKey = 'brainstorm';
const maxBrainstormSessionKeyLength = 512;
let envLoaded = false;
let agentToolCallSequence = 0;

const defaultVelocaIgnorePatterns = [
  '.DS_Store',
  '.cache/',
  '.env',
  '.env.*',
  '.git/',
  '.next/',
  '.turbo/',
  '.veloca/',
  '*.log',
  '*.sqlite',
  '*.sqlite-*',
  '*.tmp',
  'build/',
  'coverage/',
  'dist/',
  'node_modules/',
  'out/',
  'package-lock.json',
  'pnpm-lock.yaml',
  'release/',
  'yarn.lock'
];

interface StoredAgentSessionSummary {
  create_at?: unknown;
  session_id?: unknown;
  status?: unknown;
}

interface StoredAgentEntry {
  content?: unknown;
  create_at?: unknown;
  entry_id?: unknown;
  reasoning_content?: unknown;
  role?: unknown;
  token_consumption?: unknown;
  tools?: unknown;
}

interface StoredAgentSessionData {
  entries?: StoredAgentEntry[];
}

interface StoredAgentStorageSession {
  compacted_entries?: unknown[];
  create_at?: unknown;
  entries?: StoredAgentEntry[];
  session_id?: unknown;
  status?: unknown;
}

interface StoredAgentStorageData {
  sessions?: StoredAgentStorageSession[];
}

interface AgentSessionWorkspaceScope {
  workspaceKey: string;
  workspaceRootPath?: string;
  workspaceType: AgentWorkspaceType;
}

interface AgentSessionWorkspaceRecord {
  created_at?: unknown;
  session_id?: unknown;
  updated_at?: unknown;
  workspace_key?: unknown;
  workspace_root_path?: unknown;
  workspace_type?: unknown;
}

interface DirectoryTreeStats {
  directories: number;
  files: number;
  ignored: number;
  maxDepth: number;
  maxNodes: number;
  truncated: boolean;
  unreadable: number;
}

interface DirectoryTreeWalkState extends DirectoryTreeStats {
  nodes: number;
}

interface BashCommandInput {
  command: string;
  cwd?: string;
  description?: string;
  timeout?: number;
}

interface PowerShellCommandInput {
  command: string;
  cwd?: string;
  description?: string;
  runInBackground: boolean;
  timeout?: number;
}

interface ReplInput {
  code: string;
  language: string;
  timeoutMs?: number;
}

interface WebSearchInput {
  allowedDomains?: string[];
  blockedDomains?: string[];
  query: string;
}

interface WebFetchInput {
  prompt: string;
  url: string;
}

interface AgentToolEnvelopeInput {
  input?: unknown;
}

interface BashCommandOutput {
  blocked: boolean;
  cwd: string;
  durationMs: number;
  error?: string;
  exitCode: number | null;
  interrupted: boolean;
  noOutputExpected: boolean;
  ok: boolean;
  outputTruncated: boolean;
  sandboxStatus: {
    enabled: boolean;
    filesystem: 'workspace-write';
    network: 'blocked';
  };
  stderr: string;
  stdout: string;
  timedOut: boolean;
  workspaceRootPath?: string;
}

interface CapturedOutput {
  stderr: string;
  stdout: string;
  truncated: boolean;
}

interface PowerShellCommandOutput {
  backgroundTaskId: null;
  backgroundedByUser: false;
  blocked: boolean;
  cwd: string;
  durationMs: number;
  error?: string;
  exitCode: number | null;
  interrupted: boolean;
  noOutputExpected: boolean;
  ok: boolean;
  outputTruncated: boolean;
  powershellPath?: string;
  runInBackground: boolean;
  sandboxStatus: {
    enabled: false;
    filesystem: 'workspace-write';
    network: 'not-enforced';
  };
  stderr: string;
  stdout: string;
  timedOut: boolean;
  workspaceRootPath?: string;
}

interface ReplOutput {
  blocked: boolean;
  cwd: string;
  durationMs: number;
  error?: string;
  exitCode: number | null;
  interrupted: boolean;
  language: string;
  ok: boolean;
  outputTruncated: boolean;
  runtimePath?: string;
  sandboxStatus: {
    enabled: boolean;
    filesystem: 'workspace-write';
    network: 'blocked';
  };
  stderr: string;
  stdout: string;
  timedOut: boolean;
  workspaceRootPath?: string;
}

interface ReplRuntime {
  args: string[];
  language: string;
  program: string;
}

interface SearchHit {
  title: string;
  url: string;
}

type WebSearchResultItem =
  | string
  | {
      content: SearchHit[];
      tool_use_id: string;
    };

interface WebSearchOutput {
  durationSeconds: number;
  query: string;
  results: WebSearchResultItem[];
}

interface WebFetchOutput {
  bytes: number;
  code: number;
  codeText: string;
  durationMs: number;
  result: string;
  url: string;
}

interface OutputBuffer {
  bytes: number;
  chunks: Buffer[];
  truncated: boolean;
}

interface GlobSearchInput {
  path?: string;
  pattern: string;
}

interface GlobSearchMatch {
  filename: string;
  sortTime: number;
}

interface GlobSearchOutput {
  durationMs: number;
  filenames: string[];
  numFiles: number;
  truncated: boolean;
}

type GrepSearchOutputMode = 'content' | 'count' | 'files_with_matches';

interface GrepSearchInput {
  after?: number;
  before?: number;
  caseInsensitive: boolean;
  context?: number;
  contextShort?: number;
  fileType?: string;
  glob?: string;
  headLimit?: number;
  lineNumbers: boolean;
  multiline: boolean;
  offset?: number;
  outputMode: GrepSearchOutputMode;
  path?: string;
  pattern: string;
}

interface GrepSearchFile {
  baseRelativePath: string;
  content?: string;
  filePath: string;
  name: string;
  relativePath: string;
  sortTime: number;
}

interface GrepSearchOutput {
  appliedLimit: number | null;
  appliedOffset: number | null;
  content: string | null;
  filenames: string[];
  mode: GrepSearchOutputMode;
  numFiles: number;
  numLines: number | null;
  numMatches: number | null;
}

interface ReadFileInput {
  limit?: number;
  offset?: number;
  path: string;
}

interface ReadFileOutput {
  file: {
    content: string;
    filePath: string;
    numLines: number;
    startLine: number;
    totalLines: number;
  };
  type: 'text';
}

interface EditFileInput {
  newString: string;
  oldString: string;
  path: string;
  replaceAll: boolean;
}

interface EditFileOutput {
  filePath: string;
  gitDiff: null;
  newString: string;
  oldString: string;
  originalFile: string;
  replaceAll: boolean;
  structuredPatch: StructuredPatchHunk[];
  userModified: false;
  workspaceType: 'database' | 'filesystem';
}

interface StructuredPatchHunk {
  lines: string[];
  newLines: number;
  newStart: number;
  oldLines: number;
  oldStart: number;
}

interface WriteFileInput {
  content: string;
  path: string;
}

interface WriteFileOutput {
  content: string;
  filePath: string;
  gitDiff: null;
  originalFile: string | null;
  structuredPatch: StructuredPatchHunk[];
  type: 'create' | 'update';
  workspaceType: 'database' | 'filesystem';
}

type AgentToolName =
  | 'PowerShell'
  | 'REPL'
  | 'WebFetch'
  | 'WebSearch'
  | 'edit_file'
  | 'get_workspace_directory_tree'
  | 'glob_search'
  | 'grep_search'
  | 'read_file'
  | 'run_bash_command'
  | 'write_file';

interface AgentToolDisplayConfig {
  action: string;
  icon: string;
  openable: boolean;
}

interface AgentToolRunState {
  detail?: string;
  id: string;
  input?: unknown;
  status: AgentToolCallStatus;
  summary?: string;
  toolName: AgentToolName;
}

const agentToolDisplayConfig: Record<AgentToolName, AgentToolDisplayConfig> = {
  get_workspace_directory_tree: {
    action: '查看工作区结构',
    icon: 'folder-tree',
    openable: false
  },
  glob_search: {
    action: '查找文件',
    icon: 'search',
    openable: false
  },
  grep_search: {
    action: '搜索内容',
    icon: 'search-code',
    openable: false
  },
  read_file: {
    action: '阅读文件',
    icon: 'file-text',
    openable: false
  },
  edit_file: {
    action: '编辑文件',
    icon: 'file-pen-line',
    openable: true
  },
  write_file: {
    action: '写入文件',
    icon: 'save',
    openable: true
  },
  WebFetch: {
    action: '读取网页',
    icon: 'link',
    openable: true
  },
  WebSearch: {
    action: '搜索网页',
    icon: 'globe',
    openable: true
  },
  REPL: {
    action: '运行代码',
    icon: 'play',
    openable: true
  },
  PowerShell: {
    action: '运行 PowerShell',
    icon: 'terminal',
    openable: true
  },
  run_bash_command: {
    action: '运行命令',
    icon: 'terminal',
    openable: true
  }
};

interface AgentDatabaseEntryRow {
  content: string;
  created_at: number;
  entry_type: number;
  id: string;
  name: string;
  parent_id: string | null;
  workspace_id: string;
}

function loadLocalEnv(): void {
  if (envLoaded) {
    return;
  }

  envLoaded = true;
  const envPath = join(process.cwd(), '.env');

  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, 'utf-8').split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getRequiredEnv(name: string): string {
  loadLocalEnv();

  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for Veloca Agent.`);
  }

  return value;
}

function getOptionalEnv(name: string, fallback: string): string {
  loadLocalEnv();

  return process.env[name]?.trim() || fallback;
}

function getNumberEnv(name: string, fallback: number): number {
  const value = getOptionalEnv(name, String(fallback));
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function validateRequest(request: AgentSendMessageRequest): string {
  const prompt = request.message.trim();

  if (!request.sessionId || !/^[a-zA-Z0-9_-]{1,96}$/.test(request.sessionId)) {
    throw new Error('Invalid Agent session id.');
  }

  if (!prompt) {
    throw new Error('Agent message cannot be empty.');
  }

  if (prompt.length > maxPromptLength) {
    throw new Error(`Agent message cannot exceed ${maxPromptLength} characters.`);
  }

  if (!['lite', 'pro', 'ultra'].includes(request.model)) {
    throw new Error('Invalid Agent model selection.');
  }

  return prompt;
}

function getCurrentLocalTime(): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'long'
  }).format(new Date());
}

function getContextValue(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function getWorkspaceType(context?: AgentRuntimeContext): AgentWorkspaceType {
  if (context?.workspaceType === 'database' || context?.workspaceType === 'filesystem') {
    return context.workspaceType;
  }

  return 'none';
}

function getBrainstormWorkspaceKey(context?: AgentRuntimeContext): string {
  const sessionKey = context?.brainstormSessionKey?.trim();

  if (!sessionKey || sessionKey.includes('\0') || sessionKey.length > maxBrainstormSessionKeyLength) {
    return agentBrainstormWorkspaceKey;
  }

  return `${agentBrainstormWorkspaceKey}:${sessionKey}`;
}

function getAgentSessionWorkspaceScope(context?: AgentRuntimeContext): AgentSessionWorkspaceScope {
  const workspaceType = getWorkspaceType(context);
  const requestedRootPath = context?.workspaceRootPath?.trim();

  if (workspaceType === 'none') {
    return {
      workspaceKey: getBrainstormWorkspaceKey(context),
      workspaceType
    };
  }

  if (!requestedRootPath) {
    throw new Error('An active workspace root is required for Agent sessions.');
  }

  const workspaceRoot = resolveWorkspaceRoot(requestedRootPath, workspaceType);

  if (!workspaceRoot) {
    throw new Error('The active workspace root is not registered in Veloca.');
  }

  return {
    workspaceKey: workspaceType + ':' + workspaceRoot.rootPath,
    workspaceRootPath: workspaceRoot.rootPath,
    workspaceType
  };
}

function getStoredWorkspaceRecordSessionId(record: AgentSessionWorkspaceRecord): string {
  return typeof record.session_id === 'string' ? record.session_id : '';
}

function getStoredWorkspaceRecordKey(record: AgentSessionWorkspaceRecord): string {
  return typeof record.workspace_key === 'string' ? record.workspace_key : '';
}

function readAgentSessionWorkspaceRecords(): AgentSessionWorkspaceRecord[] {
  if (!existsSync(agentSessionWorkspaceIndexPath)) {
    return [];
  }

  try {
    const data = JSON.parse(readFileSync(agentSessionWorkspaceIndexPath, 'utf-8')) as {
      sessions?: unknown;
    };

    return Array.isArray(data.sessions) ? (data.sessions as AgentSessionWorkspaceRecord[]) : [];
  } catch {
    return [];
  }
}

function writeAgentSessionWorkspaceRecords(records: AgentSessionWorkspaceRecord[]): void {
  if (!existsSync(agentStorageDirectory)) {
    mkdirSync(agentStorageDirectory, { recursive: true });
  }

  writeFileSync(
    agentSessionWorkspaceIndexPath,
    JSON.stringify(
      {
        sessions: records
      },
      null,
      2
    ),
    'utf-8'
  );
}

function upsertAgentSessionWorkspaceRecord(sessionId: string, scope: AgentSessionWorkspaceScope): void {
  const records = readAgentSessionWorkspaceRecords();
  const recordIndex = records.findIndex((record) => getStoredWorkspaceRecordSessionId(record) === sessionId);
  const now = new Date().toISOString();
  const nextRecord: AgentSessionWorkspaceRecord = {
    created_at:
      recordIndex >= 0 && typeof records[recordIndex].created_at === 'string'
        ? records[recordIndex].created_at
        : now,
    session_id: sessionId,
    updated_at: now,
    workspace_key: scope.workspaceKey,
    workspace_root_path: scope.workspaceRootPath,
    workspace_type: scope.workspaceType
  };

  if (recordIndex >= 0) {
    records[recordIndex] = nextRecord;
  } else {
    records.push(nextRecord);
  }

  writeAgentSessionWorkspaceRecords(records);
}

function assertAgentSessionBelongsToWorkspace(sessionId: string, scope: AgentSessionWorkspaceScope): void {
  const storedSessions = readStoredSessionSummaries();

  if (!storedSessions.some((session) => getStoredSessionId(session) === sessionId)) {
    throw new Error('Agent session does not exist.');
  }

  const record = readAgentSessionWorkspaceRecords().find(
    (candidate) => getStoredWorkspaceRecordSessionId(candidate) === sessionId
  );

  if (!record || getStoredWorkspaceRecordKey(record) !== scope.workspaceKey) {
    throw new Error('Agent session does not belong to the active workspace.');
  }
}

function createBashOutput(
  values: Partial<BashCommandOutput> & Pick<BashCommandOutput, 'cwd' | 'ok'>
): BashCommandOutput {
  const stdout = values.stdout ?? '';
  const stderr = values.stderr ?? '';

  return {
    blocked: values.blocked ?? false,
    cwd: values.cwd,
    durationMs: values.durationMs ?? 0,
    error: values.error,
    exitCode: values.exitCode ?? null,
    interrupted: values.interrupted ?? false,
    noOutputExpected: values.noOutputExpected ?? (stdout.trim().length === 0 && stderr.trim().length === 0),
    ok: values.ok,
    outputTruncated: values.outputTruncated ?? false,
    sandboxStatus: values.sandboxStatus ?? {
      enabled: false,
      filesystem: 'workspace-write',
      network: 'blocked'
    },
    stderr,
    stdout,
    timedOut: values.timedOut ?? false,
    workspaceRootPath: values.workspaceRootPath
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeOptionalTimeout(value: unknown): number | undefined {
  const timeout = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  if (!Number.isFinite(timeout) || timeout <= 0) {
    return undefined;
  }

  return Math.min(Math.floor(timeout), bashMaxTimeoutMs);
}

function normalizeBashInput(command: unknown, cwd: unknown, timeout: unknown, description: unknown): BashCommandInput {
  const normalizedCommand = typeof command === 'string' ? command : '';
  let normalizedCwd = normalizeOptionalString(cwd);
  let normalizedTimeout = normalizeOptionalTimeout(timeout);
  let normalizedDescription = normalizeOptionalString(description);

  if (typeof cwd === 'number' && normalizedTimeout === undefined) {
    normalizedTimeout = normalizeOptionalTimeout(cwd);
    normalizedCwd = undefined;
  }

  if (typeof timeout === 'string' && normalizedTimeout === undefined && normalizedDescription === undefined) {
    normalizedDescription = timeout.trim() || undefined;
  }

  return {
    command: normalizedCommand,
    cwd: normalizedCwd,
    description: normalizedDescription,
    timeout: normalizedTimeout
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapToolInput(value: unknown): unknown {
  return isRecord(value) && 'input' in value ? (value as AgentToolEnvelopeInput).input : value;
}

function truncateToolDisplayText(value: string, maxCharacters = 8000): string {
  if (value.length <= maxCharacters) {
    return value;
  }

  return `${value.slice(0, maxCharacters).trimEnd()}\n...truncated for display`;
}

function compactToolSummary(value: string | undefined, fallback = ''): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? fallback;

  if (!normalized) {
    return undefined;
  }

  return normalized.length > 90 ? `${normalized.slice(0, 87).trimEnd()}...` : normalized;
}

function stringifyToolDetail(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getToolInputSummary(toolName: AgentToolName, input: unknown): string | undefined {
  if (toolName === 'get_workspace_directory_tree') {
    return compactToolSummary(undefined, '当前工作区');
  }

  if (!isRecord(input)) {
    return undefined;
  }

  switch (toolName) {
    case 'glob_search':
      return compactToolSummary(typeof input.pattern === 'string' ? input.pattern : undefined);
    case 'grep_search':
      return compactToolSummary(typeof input.pattern === 'string' ? input.pattern : undefined);
    case 'read_file':
    case 'edit_file':
    case 'write_file':
      return compactToolSummary(typeof input.path === 'string' ? input.path : undefined);
    case 'WebFetch':
      return compactToolSummary(typeof input.url === 'string' ? input.url : undefined);
    case 'WebSearch':
      return compactToolSummary(typeof input.query === 'string' ? input.query : undefined);
    case 'REPL': {
      const language = typeof input.language === 'string' ? input.language : 'code';
      return compactToolSummary(language);
    }
    case 'PowerShell':
    case 'run_bash_command':
      return compactToolSummary(typeof input.command === 'string' ? input.command : undefined);
  }
}

function formatCommandToolDetail(result: unknown): string {
  if (!isRecord(result)) {
    return stringifyToolDetail(result);
  }

  const lines: string[] = [];

  if (typeof result.cwd === 'string') {
    lines.push(`CWD: ${result.cwd}`);
  }

  if ('exitCode' in result) {
    lines.push(`Exit code: ${result.exitCode === null ? 'null' : String(result.exitCode)}`);
  }

  if (typeof result.durationMs === 'number') {
    lines.push(`Duration: ${result.durationMs} ms`);
  }

  if (result.blocked === true) {
    lines.push('Status: blocked');
  } else if (result.timedOut === true) {
    lines.push('Status: timed out');
  } else if (result.ok === false) {
    lines.push('Status: failed');
  }

  if (typeof result.error === 'string' && result.error) {
    lines.push(`Error: ${result.error}`);
  }

  if (typeof result.stdout === 'string' && result.stdout) {
    lines.push(`\nstdout\n${result.stdout}`);
  }

  if (typeof result.stderr === 'string' && result.stderr) {
    lines.push(`\nstderr\n${result.stderr}`);
  }

  return lines.length ? lines.join('\n') : stringifyToolDetail(result);
}

function formatPatchLines(patch: unknown): string {
  if (!Array.isArray(patch)) {
    return stringifyToolDetail(patch);
  }

  const lines = patch.flatMap((hunk) => (isRecord(hunk) && Array.isArray(hunk.lines) ? hunk.lines : []));

  return lines.map(String).join('\n');
}

function formatToolResultDetail(toolName: AgentToolName, result: unknown): string | undefined {
  if (!result) {
    return undefined;
  }

  if (toolName === 'run_bash_command' || toolName === 'PowerShell' || toolName === 'REPL') {
    return truncateToolDisplayText(formatCommandToolDetail(result));
  }

  if (toolName === 'WebFetch' && isRecord(result)) {
    return truncateToolDisplayText(
      [
        typeof result.url === 'string' ? `URL: ${result.url}` : '',
        typeof result.code === 'number' ? `HTTP: ${result.code} ${typeof result.codeText === 'string' ? result.codeText : ''}` : '',
        typeof result.result === 'string' ? `\n${result.result}` : stringifyToolDetail(result)
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  if (toolName === 'WebSearch' && isRecord(result)) {
    const results = Array.isArray(result.results) ? result.results : [];
    const structured = results.find((item) => isRecord(item) && Array.isArray(item.content));
    const hits = isRecord(structured) && Array.isArray(structured.content) ? structured.content : [];
    const renderedHits = hits
      .filter(isRecord)
      .map((hit) => {
        const title = typeof hit.title === 'string' ? hit.title : 'Untitled result';
        const url = typeof hit.url === 'string' ? hit.url : '';

        return url ? `- ${title}\n  ${url}` : `- ${title}`;
      })
      .join('\n');

    return truncateToolDisplayText(
      [`Query: ${typeof result.query === 'string' ? result.query : ''}`, renderedHits || stringifyToolDetail(result)]
        .filter(Boolean)
        .join('\n\n')
    );
  }

  if ((toolName === 'edit_file' || toolName === 'write_file') && isRecord(result)) {
    return truncateToolDisplayText(
      [
        typeof result.filePath === 'string' ? `File: ${result.filePath}` : '',
        toolName === 'write_file' && typeof result.type === 'string' ? `Mode: ${result.type}` : '',
        'Patch:',
        formatPatchLines(result.structuredPatch)
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  return truncateToolDisplayText(stringifyToolDetail(result));
}

function getToolResultStatus(result: unknown): AgentToolCallStatus {
  if (!isRecord(result)) {
    return 'success';
  }

  if (result.ok === false || result.blocked === true || (typeof result.error === 'string' && result.error.trim())) {
    return 'error';
  }

  return 'success';
}

function createAgentToolCallId(toolName: AgentToolName): string {
  agentToolCallSequence += 1;

  return `tool-${toolName}-${Date.now().toString(36)}-${agentToolCallSequence.toString(36)}`;
}

function toAgentToolCallMessage(state: AgentToolRunState): AgentToolCallMessage {
  const config = agentToolDisplayConfig[state.toolName];

  return {
    action: config.action,
    detail: state.detail,
    icon: config.icon,
    id: state.id,
    openable: Boolean(state.detail?.trim()) && (config.openable || state.status === 'error'),
    status: state.status,
    summary: state.summary ?? getToolInputSummary(state.toolName, state.input)
  };
}

async function runVisibleAgentTool<Input, Output>(
  hooks: AgentRuntimeHooks | undefined,
  toolName: AgentToolName,
  readInput: () => Input,
  execute: (input: Input) => Output | Promise<Output>
): Promise<Output> {
  const id = createAgentToolCallId(toolName);
  let input: Input;

  try {
    input = readInput();
  } catch (error) {
    hooks?.onToolCallItem?.(
      toAgentToolCallMessage({
        detail: getErrorMessage(error),
        id,
        status: 'error',
        toolName
      })
    );
    throw error;
  }

  hooks?.onToolCallItem?.(
    toAgentToolCallMessage({
      id,
      input,
      status: 'running',
      toolName
    })
  );

  try {
    const result = await Promise.resolve(execute(input));
    const status = getToolResultStatus(result);
    const shouldExposeDetail = agentToolDisplayConfig[toolName].openable || status === 'error';

    hooks?.onToolCallItem?.(
      toAgentToolCallMessage({
        detail: shouldExposeDetail ? formatToolResultDetail(toolName, result) : undefined,
        id,
        input,
        status,
        toolName
      })
    );

    return result;
  } catch (error) {
    hooks?.onToolCallItem?.(
      toAgentToolCallMessage({
        detail: getErrorMessage(error),
        id,
        input,
        status: 'error',
        toolName
      })
    );
    throw error;
  }
}

function isLikelyShellCommand(value: string): boolean {
  const commandName = value.trim().split(/\s+/)[0] ?? '';

  if (!commandName) {
    return false;
  }

  return (
    commandName.includes('/') ||
    [
      'cat',
      'echo',
      'find',
      'git',
      'grep',
      'head',
      'ls',
      'node',
      'npm',
      'npx',
      'pnpm',
      'pwd',
      'python',
      'python3',
      'rg',
      'sed',
      'sh',
      'tail',
      'test',
      'tsc',
      'yarn'
    ].includes(commandName)
  );
}

function isLikelyBashCwd(value: string): boolean {
  const trimmedValue = value.trim();

  return (
    trimmedValue === '' ||
    trimmedValue === '.' ||
    trimmedValue.startsWith('./') ||
    trimmedValue.startsWith('/') ||
    trimmedValue.includes('/') ||
    /^[A-Za-z0-9._-]+$/.test(trimmedValue)
  );
}

function normalizeBashToolInput(first: unknown, second: unknown, third: unknown, fourth: unknown): BashCommandInput {
  const input = unwrapToolInput(first);

  if (isRecord(input)) {
    return normalizeBashInput(input.command, input.cwd, input.timeout, input.description);
  }

  if (typeof first === 'number') {
    return normalizeBashInput(second, undefined, first, third);
  }

  if (typeof first === 'string' && typeof second === 'string') {
    const commandFirst = normalizeBashInput(first, second, third, fourth);
    const commandSecond = normalizeBashInput(second, undefined, third, first);

    if ((!commandFirst.command && commandSecond.command) || (!isLikelyShellCommand(first) && isLikelyShellCommand(second))) {
      return commandSecond;
    }

    if (isLikelyShellCommand(first) && !isLikelyBashCwd(second)) {
      return normalizeBashInput(first, undefined, third, second);
    }
  }

  return normalizeBashInput(first, second, third, fourth);
}

function normalizePowerShellInput(
  command: unknown,
  cwd: unknown,
  timeout: unknown,
  description: unknown,
  runInBackground: unknown
): PowerShellCommandInput {
  const normalizedCommand = typeof command === 'string' ? command : '';
  const normalizedCwd = normalizeOptionalString(cwd);
  const parsedTimeout = normalizeOptionalTimeout(timeout);
  const normalizedTimeout = parsedTimeout === undefined ? undefined : Math.min(parsedTimeout, powerShellMaxTimeoutMs);
  const normalizedDescription = normalizeOptionalString(description);

  if (runInBackground !== undefined && runInBackground !== null && typeof runInBackground !== 'boolean') {
    throw new Error('PowerShell run_in_background must be a boolean.');
  }

  return {
    command: normalizedCommand,
    cwd: normalizedCwd,
    description: normalizedDescription,
    runInBackground: runInBackground === true,
    timeout: normalizedTimeout
  };
}

function normalizePowerShellToolInput(first: unknown, second: unknown, third: unknown, fourth: unknown): PowerShellCommandInput {
  const input = unwrapToolInput(first);

  if (isRecord(input)) {
    return normalizePowerShellInput(
      input.command,
      input.cwd,
      input.timeout,
      input.description,
      input.run_in_background ?? input.runInBackground
    );
  }

  return normalizePowerShellInput(first, undefined, second, third, fourth);
}

function normalizeReplInput(code: unknown, language: unknown, timeoutMs: unknown): ReplInput {
  if (typeof code !== 'string') {
    throw new Error('REPL code is required.');
  }

  if (typeof language !== 'string' || !language.trim()) {
    throw new Error('REPL language is required.');
  }

  const parsedTimeout = normalizeOptionalTimeout(timeoutMs);
  const normalizedTimeout = parsedTimeout === undefined ? undefined : Math.min(parsedTimeout, replMaxTimeoutMs);

  return {
    code,
    language: language.trim(),
    timeoutMs: normalizedTimeout
  };
}

function normalizeReplToolInput(first: unknown, second: unknown, third: unknown): ReplInput {
  const input = unwrapToolInput(first);

  if (isRecord(input)) {
    return normalizeReplInput(input.code, input.language, input.timeout_ms ?? input.timeoutMs);
  }

  return normalizeReplInput(first, second, third);
}

function normalizeOptionalStringList(value: unknown, name: string): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array of strings.`);
  }

  if (value.length > webSearchMaxDomainFilters) {
    throw new Error(`${name} cannot contain more than ${webSearchMaxDomainFilters} domains.`);
  }

  return value
    .map((item) => {
      if (typeof item !== 'string') {
        throw new Error(`${name} must contain only strings.`);
      }

      return item.trim();
    })
    .filter(Boolean);
}

function normalizeWebSearchInput(query: unknown, allowedDomains: unknown, blockedDomains: unknown): WebSearchInput {
  if (typeof query !== 'string' || query.trim().length < 2) {
    throw new Error('WebSearch query must be at least 2 characters.');
  }

  const normalizedQuery = query.trim();

  if (normalizedQuery.length > webSearchMaxQueryLength) {
    throw new Error(`WebSearch query cannot exceed ${webSearchMaxQueryLength} characters.`);
  }

  return {
    allowedDomains: normalizeOptionalStringList(allowedDomains, 'WebSearch allowed_domains'),
    blockedDomains: normalizeOptionalStringList(blockedDomains, 'WebSearch blocked_domains'),
    query: normalizedQuery
  };
}

function normalizeWebSearchToolInput(first: unknown, second: unknown, third: unknown): WebSearchInput {
  const input = unwrapToolInput(first);

  if (isRecord(input)) {
    return normalizeWebSearchInput(
      input.query,
      input.allowed_domains ?? input.allowedDomains,
      input.blocked_domains ?? input.blockedDomains
    );
  }

  return normalizeWebSearchInput(first, second, third);
}

function normalizeWebFetchInput(url: unknown, prompt: unknown): WebFetchInput {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('WebFetch url is required.');
  }

  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('WebFetch prompt is required.');
  }

  const normalizedPrompt = prompt.trim();

  if (normalizedPrompt.length > webFetchMaxPromptLength) {
    throw new Error(`WebFetch prompt cannot exceed ${webFetchMaxPromptLength} characters.`);
  }

  return {
    prompt: normalizedPrompt,
    url: url.trim()
  };
}

function normalizeWebFetchToolInput(first: unknown, second: unknown): WebFetchInput {
  const input = unwrapToolInput(first);

  if (isRecord(input)) {
    return normalizeWebFetchInput(input.url, input.prompt);
  }

  return normalizeWebFetchInput(first, second);
}

function normalizeDirectoryTreeToolInput(first: unknown): string | undefined {
  const input = unwrapToolInput(first);
  const velocaignore = isRecord(input) ? input.velocaignore : input;

  return typeof velocaignore === 'string' ? velocaignore : undefined;
}

function normalizeGlobSearchInput(pattern: unknown, path: unknown): GlobSearchInput {
  if (typeof pattern !== 'string' || !pattern.trim()) {
    throw new Error('glob_search pattern is required.');
  }

  const normalizedPattern = pattern.trim();

  if (normalizedPattern.length > maxGlobPatternLength) {
    throw new Error(`glob_search pattern cannot exceed ${maxGlobPatternLength} characters.`);
  }

  if (normalizedPattern.includes('\0')) {
    throw new Error('glob_search pattern cannot contain NUL bytes.');
  }

  if (typeof path !== 'string' || !path.trim()) {
    return {
      pattern: normalizedPattern
    };
  }

  const normalizedPath = path.trim();

  if (normalizedPath.includes('\0')) {
    throw new Error('glob_search path cannot contain NUL bytes.');
  }

  return {
    path: normalizedPath,
    pattern: normalizedPattern
  };
}

function normalizeGlobSearchToolInput(first: unknown, second: unknown): GlobSearchInput {
  const input = unwrapToolInput(first);

  if (isRecord(input)) {
    return normalizeGlobSearchInput(input.pattern, input.path);
  }

  return normalizeGlobSearchInput(first, second);
}

function normalizeGrepOutputMode(value: unknown): GrepSearchOutputMode {
  if (value === undefined || value === null || value === '') {
    return 'files_with_matches';
  }

  if (value === 'files_with_matches' || value === 'content' || value === 'count') {
    return value;
  }

  throw new Error('grep_search output_mode must be files_with_matches, content, or count.');
}

function normalizeOptionalLineNumber(value: unknown, minimum: number, name: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  if (!Number.isInteger(numberValue) || numberValue < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }

  return numberValue;
}

function normalizeOptionalBoolean(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean.`);
  }

  return value;
}

function normalizeGrepSearchInput(input: Record<string, unknown>): GrepSearchInput {
  const pattern = input.pattern;

  if (typeof pattern !== 'string' || !pattern.trim()) {
    throw new Error('grep_search pattern is required.');
  }

  const normalizedPattern = pattern.trim();

  if (normalizedPattern.length > maxGrepPatternLength) {
    throw new Error(`grep_search pattern cannot exceed ${maxGrepPatternLength} characters.`);
  }

  if (normalizedPattern.includes('\0')) {
    throw new Error('grep_search pattern cannot contain NUL bytes.');
  }

  const normalizedPath = typeof input.path === 'string' && input.path.trim() ? input.path.trim() : undefined;
  const normalizedGlob = typeof input.glob === 'string' && input.glob.trim() ? input.glob.trim() : undefined;
  const fileType = input.type ?? input.file_type ?? input.fileType;

  if (normalizedPath?.includes('\0')) {
    throw new Error('grep_search path cannot contain NUL bytes.');
  }

  if (normalizedGlob?.includes('\0')) {
    throw new Error('grep_search glob cannot contain NUL bytes.');
  }

  return {
    after: normalizeOptionalLineNumber(input['-A'] ?? input.after, 0, 'grep_search -A'),
    before: normalizeOptionalLineNumber(input['-B'] ?? input.before, 0, 'grep_search -B'),
    caseInsensitive: normalizeOptionalBoolean(input['-i'] ?? input.case_insensitive ?? input.caseInsensitive, false, 'grep_search -i'),
    context: normalizeOptionalLineNumber(input.context, 0, 'grep_search context'),
    contextShort: normalizeOptionalLineNumber(input['-C'] ?? input.context_short ?? input.contextShort, 0, 'grep_search -C'),
    fileType: typeof fileType === 'string' && fileType.trim() ? fileType.trim() : undefined,
    glob: normalizedGlob,
    headLimit: normalizeOptionalLineNumber(input.head_limit ?? input.headLimit, 1, 'grep_search head_limit'),
    lineNumbers: normalizeOptionalBoolean(input['-n'] ?? input.line_numbers ?? input.lineNumbers, true, 'grep_search -n'),
    multiline: normalizeOptionalBoolean(input.multiline, false, 'grep_search multiline'),
    offset: normalizeOptionalLineNumber(input.offset, 0, 'grep_search offset'),
    outputMode: normalizeGrepOutputMode(input.output_mode ?? input.outputMode),
    path: normalizedPath,
    pattern: normalizedPattern
  };
}

function normalizeGrepSearchToolInput(first: unknown): GrepSearchInput {
  const input = unwrapToolInput(first);

  if (!isRecord(input)) {
    throw new Error('grep_search input object is required.');
  }

  return normalizeGrepSearchInput(input);
}

function normalizeReadFileInput(path: unknown, offset: unknown, limit: unknown): ReadFileInput {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('read_file path is required.');
  }

  return {
    limit: normalizeOptionalLineNumber(limit, 1, 'read_file limit'),
    offset: normalizeOptionalLineNumber(offset, 0, 'read_file offset'),
    path: path.trim()
  };
}

function normalizeReadFileToolInput(first: unknown, second: unknown, third: unknown): ReadFileInput {
  const input = unwrapToolInput(first);

  if (isRecord(input)) {
    return normalizeReadFileInput(input.path, input.offset, input.limit);
  }

  return normalizeReadFileInput(first, second, third);
}

function normalizeWriteFileInput(path: unknown, content: unknown): WriteFileInput {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('write_file path is required.');
  }

  if (typeof content !== 'string') {
    throw new Error('write_file content is required.');
  }

  const normalizedPath = path.trim();

  if (normalizedPath.includes('\0')) {
    throw new Error('write_file path cannot contain NUL bytes.');
  }

  return {
    content,
    path: normalizedPath
  };
}

function normalizeWriteFileToolInput(first: unknown, second: unknown): WriteFileInput {
  const input = unwrapToolInput(first);

  if (isRecord(input)) {
    return normalizeWriteFileInput(input.path, input.content);
  }

  return normalizeWriteFileInput(first, second);
}

function normalizeEditFileInput(path: unknown, oldString: unknown, newString: unknown, replaceAll: unknown): EditFileInput {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('edit_file path is required.');
  }

  if (typeof oldString !== 'string') {
    throw new Error('edit_file old_string is required.');
  }

  if (typeof newString !== 'string') {
    throw new Error('edit_file new_string is required.');
  }

  const normalizedPath = path.trim();

  if (normalizedPath.includes('\0')) {
    throw new Error('edit_file path cannot contain NUL bytes.');
  }

  if (oldString.length === 0) {
    throw new Error('edit_file old_string cannot be empty.');
  }

  if (oldString === newString) {
    throw new Error('old_string and new_string must differ');
  }

  if (replaceAll !== undefined && replaceAll !== null && typeof replaceAll !== 'boolean') {
    throw new Error('edit_file replace_all must be a boolean.');
  }

  return {
    newString,
    oldString,
    path: normalizedPath,
    replaceAll: replaceAll === true
  };
}

function normalizeEditFileToolInput(
  first: unknown,
  second: unknown,
  third: unknown,
  fourth: unknown
): EditFileInput {
  const input = unwrapToolInput(first);

  if (isRecord(input)) {
    return normalizeEditFileInput(
      input.path,
      input.old_string ?? input.oldString,
      input.new_string ?? input.newString,
      input.replace_all ?? input.replaceAll
    );
  }

  return normalizeEditFileInput(first, second, third, fourth);
}

function ensureWritableTextContentSize(content: string): void {
  const byteLength = Buffer.byteLength(content, 'utf8');

  if (byteLength > maxWriteFileBytes) {
    throw new Error(`content is too large (${byteLength} bytes, max ${maxWriteFileBytes} bytes)`);
  }
}

function isSameOrChildPath(parentPath: string, childPath: string): boolean {
  const relativePath = relative(parentPath, childPath);

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function createStructuredPatch(original: string, updated: string): StructuredPatchHunk[] {
  if (original === updated) {
    return [];
  }

  const originalLines = splitTextLines(original);
  const updatedLines = splitTextLines(updated);

  return [
    {
      lines: [
        ...originalLines.map((line) => `-${line}`),
        ...updatedLines.map((line) => `+${line}`)
      ],
      newLines: updatedLines.length,
      newStart: 1,
      oldLines: originalLines.length,
      oldStart: 1
    }
  ];
}

function resolveBashCwd(workspaceRootPath: string, cwd: string | undefined): string {
  const rootPath = realpathSync(workspaceRootPath);
  const candidatePath = cwd ? (isAbsolute(cwd) ? cwd : resolve(rootPath, cwd)) : rootPath;

  if (!existsSync(candidatePath)) {
    throw new Error('Bash cwd does not exist inside the active workspace.');
  }

  const resolvedCwd = realpathSync(candidatePath);
  const stats = statSync(resolvedCwd);

  if (!stats.isDirectory()) {
    throw new Error('Bash cwd must be a directory.');
  }

  if (!isSameOrChildPath(rootPath, resolvedCwd)) {
    throw new Error('Bash cwd is outside the active workspace root.');
  }

  return resolvedCwd;
}

function getCommandForBashSafetyCheck(command: string, workspaceRootPath: string): string {
  const workspacePathPattern = new RegExp(`${escapeRegex(workspaceRootPath)}(?=$|[\\s"';&|)]|/)`, 'g');

  return command.replace(workspacePathPattern, '.');
}

function getBlockedBashReason(command: string, workspaceRootPath: string): string | null {
  const checkedCommand = getCommandForBashSafetyCheck(command, workspaceRootPath);
  const checks: Array<[RegExp, string]> = [
    [/(^|[;&|]\s*)sudo(\s|$)/, 'sudo is not allowed in Veloca Agent bash commands.'],
    [/(^|[;&|]\s*)su(\s|$)/, 'Switching users is not allowed in Veloca Agent bash commands.'],
    [/\bgit\s+reset\s+--hard\b/, 'git reset --hard is blocked.'],
    [/\bgit\s+clean\b/, 'git clean is blocked.'],
    [/(^|[;&|]\s*)diskutil(\s|$)/, 'diskutil is blocked.'],
    [/(^|[;&|]\s*)mkfs(\s|$)/, 'mkfs is blocked.'],
    [/(^|[;&|]\s*)shutdown(\s|$)/, 'shutdown is blocked.'],
    [/(^|[;&|]\s*)reboot(\s|$)/, 'reboot is blocked.'],
    [/(^|[;&|]\s*)launchctl(\s|$)/, 'launchctl is blocked.'],
    [/(^|[;&|]\s*)osascript(\s|$)/, 'osascript is blocked.'],
    [/(^|[;&|]\s*)nohup(\s|$)/, 'Background commands are not supported.'],
    [/(^|[;&|]\s*)disown(\s|$)/, 'Background commands are not supported.'],
    [/\bdd\b[^;&|]*\bof=/, 'dd writes with of= are blocked.'],
    [/(^|[\s"'=])~(?=\/|\s|$)/, 'Home-directory paths are blocked; use workspace-relative paths.'],
    [/(^|[\s"'=])\.\.(?=\/|\s|$)/, 'Parent-directory traversal is blocked; use workspace-relative paths.'],
    [
      /(^|[\s"'=])\/(?!dev\/null(?=\s|$)|bin\/|usr\/bin\/|usr\/local\/bin\/|opt\/homebrew\/bin\/)/,
      'Absolute local paths outside the workspace command model are blocked; use cwd and relative paths.'
    ],
    [/\brm\b(?=[^;&|]*\s-[^\s;&|]*r)(?=[^;&|]*\s-[^\s;&|]*f)/, 'rm -rf style commands are blocked.']
  ];

  for (const [pattern, reason] of checks) {
    if (pattern.test(checkedCommand)) {
      return reason;
    }
  }

  const withoutFdRedirects = checkedCommand.replace(/[<>]&\d/g, '');

  if (/(^|[^&])&(\s|$)/.test(withoutFdRedirects)) {
    return 'Background commands are not supported.';
  }

  return null;
}

function quoteSandboxPath(pathValue: string): string {
  return JSON.stringify(pathValue);
}

function buildBashSandboxProfile(workspaceRootPath: string, sandboxRootPath: string): string {
  return `(version 1)
(deny default)
(allow process*)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow mach-lookup)
(allow file-read-metadata)
(allow file-read*)
(allow file-write*
  (subpath ${quoteSandboxPath(workspaceRootPath)})
  (subpath ${quoteSandboxPath(sandboxRootPath)})
)
(deny network*)`;
}

function createOutputBuffer(): OutputBuffer {
  return {
    bytes: 0,
    chunks: [],
    truncated: false
  };
}

function appendOutput(buffer: OutputBuffer, chunk: Buffer): void {
  const remainingBytes = bashMaxOutputBytes - buffer.bytes;

  if (remainingBytes <= 0) {
    buffer.truncated = true;
    return;
  }

  if (chunk.byteLength > remainingBytes) {
    buffer.chunks.push(chunk.subarray(0, remainingBytes));
    buffer.bytes += remainingBytes;
    buffer.truncated = true;
    return;
  }

  buffer.chunks.push(chunk);
  buffer.bytes += chunk.byteLength;
}

function readOutputBuffer(buffer: OutputBuffer): string {
  const output = Buffer.concat(buffer.chunks).toString('utf8');

  if (!buffer.truncated) {
    return output;
  }

  return `${output}\n\n[output truncated - exceeded ${bashMaxOutputBytes} bytes]`;
}

function executeSandboxedBash(command: string, cwd: string, workspaceRootPath: string, timeoutMs: number): Promise<CapturedOutput & {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}> {
  const sandboxRootPath = join(workspaceRootPath, '.veloca', 'bash-sandbox');
  const sandboxHomePath = join(sandboxRootPath, 'home');
  const sandboxTmpPath = join(sandboxRootPath, 'tmp');
  const sandboxProfile = buildBashSandboxProfile(workspaceRootPath, sandboxRootPath);
  const stdoutBuffer = createOutputBuffer();
  const stderrBuffer = createOutputBuffer();

  mkdirSync(sandboxHomePath, { recursive: true });
  mkdirSync(sandboxTmpPath, { recursive: true });

  return new Promise((resolveCommand, rejectCommand) => {
    const started = spawn(bashSandboxExecPath, ['-p', sandboxProfile, '/bin/sh', '-lc', command], {
      cwd,
      detached: true,
      env: {
        ...process.env,
        HOME: sandboxHomePath,
        TMPDIR: sandboxTmpPath
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;

      if (started.pid) {
        try {
          process.kill(-started.pid, 'SIGTERM');
        } catch {
          started.kill('SIGTERM');
        }

        killTimer = setTimeout(() => {
          if (!started.killed && started.pid) {
            try {
              process.kill(-started.pid, 'SIGKILL');
            } catch {
              started.kill('SIGKILL');
            }
          }
        }, 1000);
      }
    }, timeoutMs);

    started.stdout?.on('data', (chunk: Buffer) => appendOutput(stdoutBuffer, chunk));
    started.stderr?.on('data', (chunk: Buffer) => appendOutput(stderrBuffer, chunk));
    started.on('error', (error) => {
      clearTimeout(timeoutTimer);

      if (killTimer) {
        clearTimeout(killTimer);
      }

      rejectCommand(error);
    });
    started.on('close', (exitCode, signal) => {
      clearTimeout(timeoutTimer);

      if (killTimer) {
        clearTimeout(killTimer);
      }

      resolveCommand({
        exitCode,
        signal,
        stderr: readOutputBuffer(stderrBuffer),
        stdout: readOutputBuffer(stdoutBuffer),
        timedOut,
        truncated: stdoutBuffer.truncated || stderrBuffer.truncated
      });
    });
  });
}

function createPowerShellOutput(
  values: Partial<PowerShellCommandOutput> & Pick<PowerShellCommandOutput, 'cwd' | 'ok'>
): PowerShellCommandOutput {
  const stdout = values.stdout ?? '';
  const stderr = values.stderr ?? '';

  return {
    backgroundTaskId: null,
    backgroundedByUser: false,
    blocked: values.blocked ?? false,
    cwd: values.cwd,
    durationMs: values.durationMs ?? 0,
    error: values.error,
    exitCode: values.exitCode ?? null,
    interrupted: values.interrupted ?? false,
    noOutputExpected: values.noOutputExpected ?? (stdout.trim().length === 0 && stderr.trim().length === 0),
    ok: values.ok,
    outputTruncated: values.outputTruncated ?? false,
    powershellPath: values.powershellPath,
    runInBackground: values.runInBackground ?? false,
    sandboxStatus: {
      enabled: false,
      filesystem: 'workspace-write',
      network: 'not-enforced'
    },
    stderr,
    stdout,
    timedOut: values.timedOut ?? false,
    workspaceRootPath: values.workspaceRootPath
  };
}

function findExecutableOnPath(command: string): string | null {
  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];

  for (const pathEntry of pathEntries) {
    for (const extension of extensions) {
      const candidateName =
        extension && command.toLowerCase().endsWith(extension.toLowerCase()) ? command : `${command}${extension}`;
      const candidatePath = join(pathEntry, candidateName);

      if (!existsSync(candidatePath)) {
        continue;
      }

      try {
        const stats = statSync(candidatePath);

        if (stats.isFile()) {
          return candidatePath;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

function detectPowerShellShell(): string | null {
  return findExecutableOnPath('pwsh') ?? findExecutableOnPath('powershell');
}

function resolvePowerShellCwd(workspaceRootPath: string, cwd: string | undefined): string {
  const rootPath = realpathSync(workspaceRootPath);
  const candidatePath = cwd ? (isAbsolute(cwd) ? cwd : resolve(rootPath, cwd)) : rootPath;

  if (!existsSync(candidatePath)) {
    throw new Error('PowerShell cwd does not exist inside the active workspace.');
  }

  const resolvedCwd = realpathSync(candidatePath);
  const stats = statSync(resolvedCwd);

  if (!stats.isDirectory()) {
    throw new Error('PowerShell cwd must be a directory.');
  }

  if (!isSameOrChildPath(rootPath, resolvedCwd)) {
    throw new Error('PowerShell cwd is outside the active workspace root.');
  }

  return resolvedCwd;
}

function getCommandForPowerShellSafetyCheck(command: string, workspaceRootPath: string): string {
  const workspacePathPattern = new RegExp(`${escapeRegex(workspaceRootPath)}(?=$|[\\s"';&|)]|[\\\\/])`, 'g');

  return command.replace(workspacePathPattern, '.');
}

function getBlockedPowerShellReason(command: string, workspaceRootPath: string): string | null {
  const checkedCommand = getCommandForPowerShellSafetyCheck(command, workspaceRootPath);
  const checks: Array<[RegExp, string]> = [
    [/(^|[;|\n]\s*)Start-Job(\s|$)/i, 'PowerShell background jobs are not supported.'],
    [/(^|[;|\n]\s*)Start-ThreadJob(\s|$)/i, 'PowerShell background jobs are not supported.'],
    [/(^|[\s"'=])-AsJob(\s|$)/i, 'PowerShell background jobs are not supported.'],
    [/(^|[;|\n]\s*)Start-Process\b/i, 'Start-Process is blocked for Agent PowerShell commands.'],
    [/\b-Verb\s+RunAs\b/i, 'Elevated PowerShell execution is blocked.'],
    [/(^|[;|\n]\s*)Set-ExecutionPolicy\b/i, 'Set-ExecutionPolicy is blocked.'],
    [/(^|[;|\n]\s*)Remove-Item\b/i, 'Remove-Item is blocked.'],
    [/(^|[;|\n]\s*)(rm|del|erase|rmdir|rd)\b/i, 'Destructive PowerShell aliases are blocked.'],
    [/(^|[;|\n]\s*)Clear-Content\b/i, 'Clear-Content is blocked.'],
    [/(^|[;|\n]\s*)Format-Volume\b/i, 'Format-Volume is blocked.'],
    [/(^|[;|\n]\s*)Clear-Disk\b/i, 'Clear-Disk is blocked.'],
    [/(^|[;|\n]\s*)Remove-Partition\b/i, 'Remove-Partition is blocked.'],
    [/(^|[;|\n]\s*)diskpart(\.exe)?\b/i, 'diskpart is blocked.'],
    [/(^|[;|\n]\s*)Stop-Computer\b/i, 'Stop-Computer is blocked.'],
    [/(^|[;|\n]\s*)Restart-Computer\b/i, 'Restart-Computer is blocked.'],
    [/(^|[;|\n]\s*)shutdown(\.exe)?\b/i, 'shutdown is blocked.'],
    [/(^|[;|\n]\s*)New-Service\b/i, 'Service creation is blocked.'],
    [/(^|[;|\n]\s*)sc(\.exe)?\s+/i, 'Service control commands are blocked.'],
    [/(^|[;|\n]\s*)net\s+user\b/i, 'User-management commands are blocked.'],
    [/(^|[;|\n]\s*)Invoke-WebRequest\b/i, 'Network PowerShell commands are blocked.'],
    [/(^|[;|\n]\s*)Invoke-RestMethod\b/i, 'Network PowerShell commands are blocked.'],
    [/(^|[;|\n]\s*)Start-BitsTransfer\b/i, 'Network transfer commands are blocked.'],
    [/(^|[;|\n]\s*)(iwr|irm|curl|wget)\b/i, 'Network PowerShell aliases are blocked.'],
    [/(^|[\s"'=])~(?=[\\/]|[\s"'`]|$)/, 'Home-directory paths are blocked; use workspace-relative paths.'],
    [/(^|[\s"'=])\.\.(?=[\\/]|[\s"'`]|$)/, 'Parent-directory traversal is blocked; use workspace-relative paths.'],
    [/(^|[\s"'=])([A-Za-z]:\\|\\\\)/, 'Absolute Windows paths are blocked; use cwd and workspace-relative paths.'],
    [
      /(^|[\s"'=])\/(?!dev\/null(?=\s|$)|bin\/|usr\/bin\/|usr\/local\/bin\/|opt\/homebrew\/bin\/)/,
      'Absolute local paths outside the workspace command model are blocked; use cwd and relative paths.'
    ]
  ];

  for (const [pattern, reason] of checks) {
    if (pattern.test(checkedCommand)) {
      return reason;
    }
  }

  return null;
}

function executePowerShell(command: string, cwd: string, powerShellPath: string, timeoutMs: number): Promise<CapturedOutput & {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}> {
  const stdoutBuffer = createOutputBuffer();
  const stderrBuffer = createOutputBuffer();

  return new Promise((resolveCommand, rejectCommand) => {
    const started = spawn(powerShellPath, ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;

      if (started.pid) {
        try {
          if (process.platform !== 'win32') {
            process.kill(-started.pid, 'SIGTERM');
          } else {
            started.kill('SIGTERM');
          }
        } catch {
          started.kill('SIGTERM');
        }

        killTimer = setTimeout(() => {
          if (!started.killed && started.pid) {
            try {
              if (process.platform !== 'win32') {
                process.kill(-started.pid, 'SIGKILL');
              } else {
                started.kill('SIGKILL');
              }
            } catch {
              started.kill('SIGKILL');
            }
          }
        }, 1000);
      }
    }, timeoutMs);

    started.stdout?.on('data', (chunk: Buffer) => appendOutput(stdoutBuffer, chunk));
    started.stderr?.on('data', (chunk: Buffer) => appendOutput(stderrBuffer, chunk));
    started.on('error', (error) => {
      clearTimeout(timeoutTimer);

      if (killTimer) {
        clearTimeout(killTimer);
      }

      rejectCommand(error);
    });
    started.on('close', (exitCode, signal) => {
      clearTimeout(timeoutTimer);

      if (killTimer) {
        clearTimeout(killTimer);
      }

      resolveCommand({
        exitCode,
        signal,
        stderr: readOutputBuffer(stderrBuffer),
        stdout: readOutputBuffer(stdoutBuffer),
        timedOut,
        truncated: stdoutBuffer.truncated || stderrBuffer.truncated
      });
    });
  });
}

function createReplOutput(values: Partial<ReplOutput> & Pick<ReplOutput, 'cwd' | 'language' | 'ok'>): ReplOutput {
  return {
    blocked: values.blocked ?? false,
    cwd: values.cwd,
    durationMs: values.durationMs ?? 0,
    error: values.error,
    exitCode: values.exitCode ?? null,
    interrupted: values.interrupted ?? false,
    language: values.language,
    ok: values.ok,
    outputTruncated: values.outputTruncated ?? false,
    runtimePath: values.runtimePath,
    sandboxStatus: values.sandboxStatus ?? {
      enabled: false,
      filesystem: 'workspace-write',
      network: 'blocked'
    },
    stderr: values.stderr ?? '',
    stdout: values.stdout ?? '',
    timedOut: values.timedOut ?? false,
    workspaceRootPath: values.workspaceRootPath
  };
}

function detectFirstReplRuntime(commands: string[]): string | null {
  for (const command of commands) {
    const executablePath = findExecutableOnPath(command);

    if (executablePath) {
      return executablePath;
    }
  }

  return null;
}

function resolveReplRuntime(language: string): ReplRuntime {
  const normalizedLanguage = language.trim().toLowerCase();

  if (normalizedLanguage === 'python' || normalizedLanguage === 'py') {
    const program = detectFirstReplRuntime(['python3', 'python']);

    if (!program) {
      throw new Error('python runtime not found');
    }

    return {
      args: ['-c'],
      language: 'python',
      program
    };
  }

  if (normalizedLanguage === 'javascript' || normalizedLanguage === 'js' || normalizedLanguage === 'node') {
    const program = detectFirstReplRuntime(['node']);

    if (!program) {
      throw new Error('node runtime not found');
    }

    return {
      args: ['-e'],
      language: 'javascript',
      program
    };
  }

  if (normalizedLanguage === 'sh' || normalizedLanguage === 'shell' || normalizedLanguage === 'bash') {
    const program = detectFirstReplRuntime(['bash', 'sh']);

    if (!program) {
      throw new Error('shell runtime not found');
    }

    return {
      args: ['-lc'],
      language: 'shell',
      program
    };
  }

  throw new Error(`unsupported REPL language: ${normalizedLanguage || language}`);
}

function executeSandboxedRepl(
  input: ReplInput,
  runtime: ReplRuntime,
  cwd: string,
  workspaceRootPath: string,
  timeoutMs: number
): Promise<CapturedOutput & {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}> {
  const sandboxRootPath = join(workspaceRootPath, '.veloca', 'repl-sandbox');
  const sandboxHomePath = join(sandboxRootPath, 'home');
  const sandboxTmpPath = join(sandboxRootPath, 'tmp');
  const sandboxProfile = buildBashSandboxProfile(workspaceRootPath, sandboxRootPath);
  const stdoutBuffer = createOutputBuffer();
  const stderrBuffer = createOutputBuffer();

  mkdirSync(sandboxHomePath, { recursive: true });
  mkdirSync(sandboxTmpPath, { recursive: true });

  return new Promise((resolveCommand, rejectCommand) => {
    const started = spawn(bashSandboxExecPath, ['-p', sandboxProfile, runtime.program, ...runtime.args, input.code], {
      cwd,
      detached: true,
      env: {
        ...process.env,
        HOME: sandboxHomePath,
        TMPDIR: sandboxTmpPath
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;

      if (started.pid) {
        try {
          process.kill(-started.pid, 'SIGTERM');
        } catch {
          started.kill('SIGTERM');
        }

        killTimer = setTimeout(() => {
          if (!started.killed && started.pid) {
            try {
              process.kill(-started.pid, 'SIGKILL');
            } catch {
              started.kill('SIGKILL');
            }
          }
        }, 1000);
      }
    }, timeoutMs);

    started.stdout?.on('data', (chunk: Buffer) => appendOutput(stdoutBuffer, chunk));
    started.stderr?.on('data', (chunk: Buffer) => appendOutput(stderrBuffer, chunk));
    started.on('error', (error) => {
      clearTimeout(timeoutTimer);

      if (killTimer) {
        clearTimeout(killTimer);
      }

      rejectCommand(error);
    });
    started.on('close', (exitCode, signal) => {
      clearTimeout(timeoutTimer);

      if (killTimer) {
        clearTimeout(killTimer);
      }

      resolveCommand({
        exitCode,
        signal,
        stderr: readOutputBuffer(stderrBuffer),
        stdout: readOutputBuffer(stdoutBuffer),
        timedOut,
        truncated: stdoutBuffer.truncated || stderrBuffer.truncated
      });
    });
  });
}

function getWebSearchBaseUrl(): string {
  loadLocalEnv();

  return (
    process.env.VELOCA_WEB_SEARCH_BASE_URL?.trim() ||
    process.env.CLAWD_WEB_SEARCH_BASE_URL?.trim() ||
    webSearchDefaultBaseUrl
  );
}

function buildWebSearchUrl(query: string): URL {
  const url = new URL(getWebSearchBaseUrl());
  url.searchParams.append('q', query);

  return url;
}

async function fetchWebSearchHtml(url: URL): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), webSearchTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Veloca-Agent-WebSearch/0.1'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`WebSearch request failed with HTTP ${response.status}.`);
    }

    return await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`WebSearch request exceeded timeout of ${webSearchTimeoutMs} ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function collapseWhitespace(input: string): string {
  return input.split(/\s+/).filter(Boolean).join(' ');
}

function decodeNumericHtmlEntity(value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix);

  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return '';
  }

  return String.fromCodePoint(codePoint);
}

function decodeHtmlEntities(input: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };

  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => decodeNumericHtmlEntity(value, 16))
    .replace(/&#(\d+);/g, (_, value: string) => decodeNumericHtmlEntity(value, 10))
    .replace(/&([a-z]+);/gi, (entity, name: string) => namedEntities[name.toLowerCase()] ?? entity);
}

function htmlToText(html: string): string {
  return collapseWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function extractQuotedValue(input: string): { rest: string; value: string } | null {
  const quote = input[0];

  if (quote !== '"' && quote !== "'") {
    return null;
  }

  const end = input.indexOf(quote, 1);

  if (end < 0) {
    return null;
  }

  return {
    rest: input.slice(end + 1),
    value: input.slice(1, end)
  };
}

function htmlEntityDecodeUrl(url: string): string {
  return decodeHtmlEntities(url);
}

function decodeDuckDuckGoRedirect(url: string): string | null {
  const decodedUrl = htmlEntityDecodeUrl(url);
  const joined = decodedUrl.startsWith('//')
    ? `https:${decodedUrl}`
    : decodedUrl.startsWith('/')
      ? `https://duckduckgo.com${decodedUrl}`
      : decodedUrl;

  if (!joined.startsWith('http://') && !joined.startsWith('https://')) {
    return null;
  }

  try {
    const parsed = new URL(joined);

    if ((parsed.pathname === '/l/' || parsed.pathname === '/l') && parsed.searchParams.has('uddg')) {
      return htmlEntityDecodeUrl(parsed.searchParams.get('uddg') ?? joined);
    }

    return joined;
  } catch {
    return null;
  }
}

function extractSearchHits(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  let remaining = html;

  while (true) {
    const anchorStart = remaining.indexOf('result__a');

    if (anchorStart < 0) {
      break;
    }

    const afterClass = remaining.slice(anchorStart);
    const hrefIndex = afterClass.indexOf('href=');

    if (hrefIndex < 0) {
      remaining = afterClass.slice(1);
      continue;
    }

    const quotedUrl = extractQuotedValue(afterClass.slice(hrefIndex + 5));

    if (!quotedUrl) {
      remaining = afterClass.slice(1);
      continue;
    }

    const closeTagIndex = quotedUrl.rest.indexOf('>');

    if (closeTagIndex < 0) {
      remaining = afterClass.slice(1);
      continue;
    }

    const afterTag = quotedUrl.rest.slice(closeTagIndex + 1);
    const endAnchorIndex = afterTag.indexOf('</a>');

    if (endAnchorIndex < 0) {
      remaining = afterTag.slice(1);
      continue;
    }

    const title = htmlToText(afterTag.slice(0, endAnchorIndex)).trim();
    const decodedUrl = decodeDuckDuckGoRedirect(quotedUrl.value);

    if (title && decodedUrl) {
      hits.push({
        title,
        url: decodedUrl
      });
    }

    remaining = afterTag.slice(endAnchorIndex + 4);
  }

  return hits;
}

function extractSearchHitsFromGenericLinks(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  let remaining = html;

  while (true) {
    const anchorStart = remaining.indexOf('<a');

    if (anchorStart < 0) {
      break;
    }

    const afterAnchor = remaining.slice(anchorStart);
    const hrefIndex = afterAnchor.indexOf('href=');

    if (hrefIndex < 0) {
      remaining = afterAnchor.slice(2);
      continue;
    }

    const quotedUrl = extractQuotedValue(afterAnchor.slice(hrefIndex + 5));

    if (!quotedUrl) {
      remaining = afterAnchor.slice(2);
      continue;
    }

    const closeTagIndex = quotedUrl.rest.indexOf('>');

    if (closeTagIndex < 0) {
      remaining = afterAnchor.slice(2);
      continue;
    }

    const afterTag = quotedUrl.rest.slice(closeTagIndex + 1);
    const endAnchorIndex = afterTag.indexOf('</a>');

    if (endAnchorIndex < 0) {
      remaining = afterAnchor.slice(2);
      continue;
    }

    const title = htmlToText(afterTag.slice(0, endAnchorIndex)).trim();
    const decodedUrl = decodeDuckDuckGoRedirect(quotedUrl.value);

    if (title && decodedUrl?.match(/^https?:\/\//i)) {
      hits.push({
        title,
        url: decodedUrl
      });
    }

    remaining = afterTag.slice(endAnchorIndex + 4);
  }

  return hits;
}

function normalizeDomainFilter(domain: string): string {
  const trimmed = domain.trim();
  let host = trimmed;

  try {
    host = new URL(trimmed).hostname;
  } catch {
    try {
      host = new URL(`https://${trimmed}`).hostname;
    } catch {
      host = trimmed.split('/')[0] ?? trimmed;
    }
  }

  return host.trim().replace(/^\.+|\.+$/g, '').toLowerCase();
}

function hostMatchesList(url: string, domains: string[]): boolean {
  let host: string;

  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  return domains.some((domain) => {
    const normalized = normalizeDomainFilter(domain);

    return Boolean(normalized) && (host === normalized || host.endsWith(`.${normalized}`));
  });
}

function dedupeSearchHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();

  return hits.filter((hit) => {
    if (seen.has(hit.url)) {
      return false;
    }

    seen.add(hit.url);
    return true;
  });
}

async function runWebSearch(input: WebSearchInput): Promise<WebSearchOutput> {
  const startedAt = Date.now();
  const searchUrl = buildWebSearchUrl(input.query);
  const html = await fetchWebSearchHtml(searchUrl);
  let hits = extractSearchHits(html);

  if (hits.length === 0) {
    hits = extractSearchHitsFromGenericLinks(html);
  }

  if (input.allowedDomains?.length) {
    hits = hits.filter((hit) => hostMatchesList(hit.url, input.allowedDomains ?? []));
  }

  if (input.blockedDomains?.length) {
    hits = hits.filter((hit) => !hostMatchesList(hit.url, input.blockedDomains ?? []));
  }

  hits = dedupeSearchHits(hits).slice(0, webSearchMaxResults);

  const summary =
    hits.length === 0
      ? `No web search results matched the query "${input.query}".`
      : [
          `Search results for "${input.query}". Include a Sources section in the final answer.`,
          ...hits.map((hit) => `- [${hit.title}](${hit.url})`)
        ].join('\n');

  return {
    durationSeconds: (Date.now() - startedAt) / 1000,
    query: input.query,
    results: [
      summary,
      {
        content: hits,
        tool_use_id: 'web_search_1'
      }
    ]
  };
}

function normalizeFetchUrl(rawUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('WebFetch url must use http or https.');
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';

  if (parsed.protocol === 'http:' && !isLocalhost) {
    parsed.protocol = 'https:';
  }

  return parsed.toString();
}

async function fetchUrlText(url: string): Promise<{
  body: string;
  code: number;
  codeText: string;
  contentType: string;
  finalUrl: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), webFetchTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'User-Agent': 'Veloca-Agent-WebFetch/0.1'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    const body = await response.text();

    return {
      body,
      code: response.status,
      codeText: response.statusText || 'Unknown',
      contentType: response.headers.get('content-type') ?? '',
      finalUrl: response.url || url
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`WebFetch request exceeded timeout of ${webFetchTimeoutMs} ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeFetchedContent(body: string, contentType: string): string {
  if (contentType.toLowerCase().includes('html')) {
    return htmlToText(body);
  }

  return body.trim();
}

function previewText(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }

  return `${input.slice(0, maxChars).trimEnd()}...`;
}

function extractTitle(content: string, rawBody: string, contentType: string): string | null {
  if (contentType.toLowerCase().includes('html')) {
    const match = rawBody.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

    if (match?.[1]) {
      const title = htmlToText(match[1]).trim();

      if (title) {
        return title;
      }
    }
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (trimmedLine) {
      return trimmedLine;
    }
  }

  return null;
}

function summarizeWebFetch(
  url: string,
  prompt: string,
  content: string,
  rawBody: string,
  contentType: string
): string {
  const lowerPrompt = prompt.toLowerCase();
  const compact = collapseWhitespace(content);
  let detail: string;

  if (lowerPrompt.includes('title') || prompt.includes('标题')) {
    const title = extractTitle(content, rawBody, contentType);
    detail = title ? `Title: ${title}` : previewText(compact, 600);
  } else if (
    lowerPrompt.includes('summary') ||
    lowerPrompt.includes('summarize') ||
    prompt.includes('总结') ||
    prompt.includes('摘要')
  ) {
    detail = previewText(compact, 900);
  } else {
    detail = `Prompt: ${prompt}\nContent preview:\n${previewText(compact, 900)}`;
  }

  return `Fetched ${url}\n${detail}`;
}

async function runWebFetch(input: WebFetchInput): Promise<WebFetchOutput> {
  const startedAt = Date.now();
  const requestUrl = normalizeFetchUrl(input.url);
  const response = await fetchUrlText(requestUrl);
  const normalized = normalizeFetchedContent(response.body, response.contentType);

  return {
    bytes: Buffer.byteLength(response.body, 'utf8'),
    code: response.code,
    codeText: response.codeText,
    durationMs: Date.now() - startedAt,
    result: summarizeWebFetch(response.finalUrl, input.prompt, normalized, response.body, response.contentType),
    url: response.finalUrl
  };
}

function splitTextLines(content: string): string[] {
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (!normalizedContent) {
    return [];
  }

  const lines = normalizedContent.split('\n');

  if (normalizedContent.endsWith('\n')) {
    lines.pop();
  }

  return lines;
}

function createReadFileOutput(filePath: string, content: string, offset: number | undefined, limit: number | undefined): ReadFileOutput {
  const lines = splitTextLines(content);
  const startIndex = Math.min(offset ?? 0, lines.length);
  const endIndex = limit === undefined ? lines.length : Math.min(startIndex + limit, lines.length);

  return {
    file: {
      content: lines.slice(startIndex, endIndex).join('\n'),
      filePath,
      numLines: endIndex - startIndex,
      startLine: startIndex + 1,
      totalLines: lines.length
    },
    type: 'text'
  };
}

function ensureReadableTextContentSize(filePath: string, byteLength: number): void {
  if (byteLength > maxReadFileBytes) {
    throw new Error(`file is too large (${byteLength} bytes, max ${maxReadFileBytes} bytes)`);
  }

  if (byteLength < 0) {
    throw new Error(`Unable to read file size for ${filePath}.`);
  }
}

function resolveFilesystemExistingFilePath(workspaceRootPath: string, path: string, toolName: string): string {
  const canonicalRoot = realpathSync(workspaceRootPath);
  const candidatePath = isAbsolute(path) ? path : resolve(canonicalRoot, path);
  const resolvedPath = realpathSync(candidatePath);
  const stats = statSync(resolvedPath);

  if (!isSameOrChildPath(canonicalRoot, resolvedPath)) {
    throw new Error(`path ${resolvedPath} escapes workspace boundary ${canonicalRoot}`);
  }

  if (!stats.isFile()) {
    throw new Error(`${toolName} path must point to a file.`);
  }

  ensureReadableTextContentSize(resolvedPath, stats.size);

  return resolvedPath;
}

function resolveFilesystemReadPath(workspaceRootPath: string, path: string): string {
  return resolveFilesystemExistingFilePath(workspaceRootPath, path, 'read_file');
}

function resolveFilesystemEditPath(workspaceRootPath: string, path: string): string {
  return resolveFilesystemExistingFilePath(workspaceRootPath, path, 'edit_file');
}

function readResolvedFilesystemTextContent(filePath: string): string {
  const buffer = readFileSync(filePath);
  const sample = buffer.subarray(0, readFileBinarySampleBytes);

  if (sample.includes(0)) {
    throw new Error('file appears to be binary');
  }

  return buffer.toString('utf8');
}

function readFilesystemTextFile(workspaceRootPath: string, input: ReadFileInput): ReadFileOutput {
  const resolvedPath = resolveFilesystemReadPath(workspaceRootPath, input.path);

  return createReadFileOutput(resolvedPath, readResolvedFilesystemTextContent(resolvedPath), input.offset, input.limit);
}

function findWorkspaceTreeNodeByPath(node: WorkspaceTreeNode, path: string): WorkspaceTreeNode | null {
  if (node.path === path) {
    return node;
  }

  for (const child of node.children ?? []) {
    const found = findWorkspaceTreeNodeByPath(child, path);

    if (found) {
      return found;
    }
  }

  return null;
}

function findWorkspaceTreeNodeByRelativePath(node: WorkspaceTreeNode, path: string): WorkspaceTreeNode | null {
  const normalizedPath = normalizeTreePath(path.replace(/^\.\//, ''));

  if (!normalizedPath) {
    return node;
  }

  for (const child of node.children ?? []) {
    if (normalizeTreePath(child.relativePath) === normalizedPath) {
      return child;
    }

    const found = findWorkspaceTreeNodeByRelativePath(child, normalizedPath);

    if (found) {
      return found;
    }
  }

  return null;
}

function resolveDatabaseExistingFileNode(rootNode: WorkspaceTreeNode, path: string, toolName: string): WorkspaceTreeNode {
  const node = path.startsWith('veloca-db://entry/')
    ? findWorkspaceTreeNodeByPath(rootNode, path)
    : findWorkspaceTreeNodeByRelativePath(rootNode, path);

  if (!node) {
    throw new Error('Database file is not inside the active workspace.');
  }

  if (node.type !== 'file') {
    throw new Error(`${toolName} path must point to a database file.`);
  }

  return node;
}

function resolveDatabaseReadNode(rootNode: WorkspaceTreeNode, path: string): WorkspaceTreeNode {
  return resolveDatabaseExistingFileNode(rootNode, path, 'read_file');
}

function resolveDatabaseEditNode(rootNode: WorkspaceTreeNode, path: string): WorkspaceTreeNode {
  return resolveDatabaseExistingFileNode(rootNode, path, 'edit_file');
}

function readDatabaseTextFile(rootNode: WorkspaceTreeNode, input: ReadFileInput): ReadFileOutput {
  const node = resolveDatabaseReadNode(rootNode, input.path);
  const file = readMarkdownFile(node.path);
  const byteLength = Buffer.byteLength(file.content, 'utf8');

  ensureReadableTextContentSize(file.path, byteLength);

  if (file.content.includes('\0')) {
    throw new Error('file appears to be binary');
  }

  return createReadFileOutput(file.path, file.content, input.offset, input.limit);
}

function readWorkspaceTextFile(context: AgentRuntimeContext | undefined, input: ReadFileInput): ReadFileOutput {
  const workspaceType = getWorkspaceType(context);
  const workspaceRootPath = context?.workspaceRootPath?.trim();
  const workspaceRoot = resolveWorkspaceRoot(workspaceRootPath, workspaceType);

  if (!workspaceRootPath || !workspaceRoot) {
    throw new Error('No active workspace root is available for file reading.');
  }

  if (workspaceType === 'filesystem') {
    return readFilesystemTextFile(workspaceRoot.rootPath, input);
  }

  if (workspaceType === 'database') {
    return readDatabaseTextFile(workspaceRoot.node, input);
  }

  throw new Error('read_file requires an active workspace.');
}

function findExistingAncestor(path: string, stopPath: string): string {
  let currentPath = path;

  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath);

    if (parentPath === currentPath || !isSameOrChildPath(stopPath, parentPath)) {
      throw new Error('write_file parent path is outside the active workspace root.');
    }

    currentPath = parentPath;
  }

  return currentPath;
}

function resolveFilesystemWritePath(workspaceRootPath: string, path: string): string {
  const canonicalRoot = realpathSync(workspaceRootPath);
  const candidatePath = isAbsolute(path) ? resolve(path) : resolve(canonicalRoot, path);

  if (!isSameOrChildPath(canonicalRoot, candidatePath)) {
    throw new Error(`path ${candidatePath} escapes workspace boundary ${canonicalRoot}`);
  }

  if (existsSync(candidatePath)) {
    const resolvedPath = realpathSync(candidatePath);
    const stats = statSync(resolvedPath);

    if (!isSameOrChildPath(canonicalRoot, resolvedPath)) {
      throw new Error(`path ${resolvedPath} escapes workspace boundary ${canonicalRoot}`);
    }

    if (!stats.isFile()) {
      throw new Error('write_file path must point to a file.');
    }

    return resolvedPath;
  }

  const parentPath = dirname(candidatePath);
  const ancestorPath = findExistingAncestor(parentPath, canonicalRoot);
  const resolvedAncestorPath = realpathSync(ancestorPath);
  const ancestorStats = statSync(resolvedAncestorPath);

  if (!isSameOrChildPath(canonicalRoot, resolvedAncestorPath)) {
    throw new Error(`path ${resolvedAncestorPath} escapes workspace boundary ${canonicalRoot}`);
  }

  if (!ancestorStats.isDirectory()) {
    throw new Error('write_file parent path must be a directory.');
  }

  mkdirSync(parentPath, { recursive: true });

  const resolvedParentPath = realpathSync(parentPath);

  if (!isSameOrChildPath(canonicalRoot, resolvedParentPath)) {
    throw new Error(`path ${resolvedParentPath} escapes workspace boundary ${canonicalRoot}`);
  }

  return candidatePath;
}

function createWriteFileOutput(
  filePath: string,
  content: string,
  originalFile: string | null,
  workspaceType: 'database' | 'filesystem'
): WriteFileOutput {
  return {
    content,
    filePath,
    gitDiff: null,
    originalFile,
    structuredPatch: createStructuredPatch(originalFile ?? '', content),
    type: originalFile === null ? 'create' : 'update',
    workspaceType
  };
}

function writeFilesystemTextFile(workspaceRootPath: string, input: WriteFileInput): WriteFileOutput {
  const filePath = resolveFilesystemWritePath(workspaceRootPath, input.path);
  const originalFile = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;

  writeFileSync(filePath, input.content, 'utf8');

  return createWriteFileOutput(filePath, input.content, originalFile, 'filesystem');
}

function getDatabaseEntryPath(entryId: string): string {
  return `veloca-db://entry/${entryId}`;
}

function getDatabaseEntryId(filePath: string): string {
  if (!filePath.startsWith('veloca-db://entry/')) {
    throw new Error('Invalid database entry path.');
  }

  const entryId = filePath.replace('veloca-db://entry/', '').trim();

  if (!entryId) {
    throw new Error('Invalid database entry path.');
  }

  return entryId;
}

function getAgentDatabaseEntry(entryId: string): AgentDatabaseEntryRow {
  const row = getDatabase()
    .prepare(
      `
      SELECT id, workspace_id, parent_id, entry_type, name, content, created_at
      FROM virtual_workspace_entries
      WHERE id = ? AND status = 0
      `
    )
    .get(entryId) as AgentDatabaseEntryRow | undefined;

  if (!row) {
    throw new Error('Database entry not found.');
  }

  return row;
}

function findAgentDatabaseEntry(
  workspaceId: string,
  parentId: string | null,
  name: string
): AgentDatabaseEntryRow | undefined {
  return getDatabase()
    .prepare(
      `
      SELECT id, workspace_id, parent_id, entry_type, name, content, created_at
      FROM virtual_workspace_entries
      WHERE workspace_id = ? AND parent_id IS ? AND name = ? AND status = 0
      ORDER BY created_at ASC
      LIMIT 1
      `
    )
    .get(workspaceId, parentId, name) as AgentDatabaseEntryRow | undefined;
}

function validateDatabaseWriteSegments(path: string): string[] {
  if (path.startsWith('veloca-db://')) {
    throw new Error('write_file database paths must use veloca-db://entry/... or a workspace-relative path.');
  }

  if (path.startsWith('/')) {
    throw new Error('write_file database relative paths cannot start with /.');
  }

  const segments = path.split('/');

  if (segments.length === 0) {
    throw new Error('write_file database path is required.');
  }

  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0')) {
      throw new Error('write_file database path contains an invalid segment.');
    }
  }

  return segments;
}

function createAgentDatabaseEntry(
  workspaceId: string,
  parentId: string | null,
  name: string,
  entryType: 0 | 1,
  content: string
): AgentDatabaseEntryRow {
  const now = Date.now();
  const id = randomUUID();

  getDatabase()
    .prepare(
      `
      INSERT INTO virtual_workspace_entries
        (id, workspace_id, parent_id, entry_type, name, content, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      `
    )
    .run(id, workspaceId, parentId, entryType, name, content, now, now);

  return {
    content,
    created_at: now,
    entry_type: entryType,
    id,
    name,
    parent_id: parentId,
    workspace_id: workspaceId
  };
}

function updateAgentDatabaseFile(entryId: string, content: string): void {
  getDatabase()
    .prepare('UPDATE virtual_workspace_entries SET content = ?, updated_at = ? WHERE id = ? AND status = 0')
    .run(content, Date.now(), entryId);
}

function writeDatabaseEntryFile(rootNode: WorkspaceTreeNode, path: string, content: string): WriteFileOutput {
  const entry = getAgentDatabaseEntry(getDatabaseEntryId(path));

  if (entry.workspace_id !== rootNode.workspaceFolderId) {
    throw new Error('Database file is not inside the active workspace.');
  }

  if (entry.entry_type !== 1) {
    throw new Error('write_file path must point to a database file.');
  }

  const originalFile = entry.content;
  updateAgentDatabaseFile(entry.id, content);

  return createWriteFileOutput(getDatabaseEntryPath(entry.id), content, originalFile, 'database');
}

function writeDatabaseRelativeFile(rootNode: WorkspaceTreeNode, path: string, content: string): WriteFileOutput {
  const workspaceId = rootNode.workspaceFolderId;
  const segments = validateDatabaseWriteSegments(path);
  const fileName = segments[segments.length - 1];
  let parentId: string | null = null;

  for (const folderName of segments.slice(0, -1)) {
    const existingFolder = findAgentDatabaseEntry(workspaceId, parentId, folderName);

    if (existingFolder && existingFolder.entry_type !== 0) {
      throw new Error('write_file database path crosses an existing file.');
    }

    const folder: AgentDatabaseEntryRow =
      existingFolder ?? createAgentDatabaseEntry(workspaceId, parentId, folderName, 0, '');
    parentId = folder.id;
  }

  const existingFile = findAgentDatabaseEntry(workspaceId, parentId, fileName);

  if (existingFile && existingFile.entry_type !== 1) {
    throw new Error('write_file path must point to a database file.');
  }

  if (existingFile) {
    updateAgentDatabaseFile(existingFile.id, content);

    return createWriteFileOutput(getDatabaseEntryPath(existingFile.id), content, existingFile.content, 'database');
  }

  const createdFile = createAgentDatabaseEntry(workspaceId, parentId, fileName, 1, content);

  return createWriteFileOutput(getDatabaseEntryPath(createdFile.id), content, null, 'database');
}

function writeDatabaseTextFile(rootNode: WorkspaceTreeNode, input: WriteFileInput): WriteFileOutput {
  if (input.path.startsWith('veloca-db://entry/')) {
    return writeDatabaseEntryFile(rootNode, input.path, input.content);
  }

  return writeDatabaseRelativeFile(rootNode, input.path, input.content);
}

function createEditFileOutput(
  filePath: string,
  oldString: string,
  newString: string,
  originalFile: string,
  updatedFile: string,
  replaceAll: boolean,
  workspaceType: 'database' | 'filesystem'
): EditFileOutput {
  return {
    filePath,
    gitDiff: null,
    newString,
    oldString,
    originalFile,
    replaceAll,
    structuredPatch: createStructuredPatch(originalFile, updatedFile),
    userModified: false,
    workspaceType
  };
}

function editTextContent(
  filePath: string,
  originalFile: string,
  input: EditFileInput,
  workspaceType: 'database' | 'filesystem'
): { output: EditFileOutput; updatedFile: string } {
  if (!originalFile.includes(input.oldString)) {
    throw new Error('old_string not found in file');
  }

  const updatedFile = input.replaceAll
    ? originalFile.split(input.oldString).join(input.newString)
    : originalFile.replace(input.oldString, input.newString);

  ensureWritableTextContentSize(updatedFile);

  return {
    output: createEditFileOutput(
      filePath,
      input.oldString,
      input.newString,
      originalFile,
      updatedFile,
      input.replaceAll,
      workspaceType
    ),
    updatedFile
  };
}

function editFilesystemTextFile(workspaceRootPath: string, input: EditFileInput): EditFileOutput {
  const filePath = resolveFilesystemEditPath(workspaceRootPath, input.path);
  const originalFile = readResolvedFilesystemTextContent(filePath);
  const { output, updatedFile } = editTextContent(filePath, originalFile, input, 'filesystem');

  writeFileSync(filePath, updatedFile, 'utf8');

  return output;
}

function editDatabaseTextFile(rootNode: WorkspaceTreeNode, input: EditFileInput): EditFileOutput {
  const node = resolveDatabaseEditNode(rootNode, input.path);
  const entry = getAgentDatabaseEntry(getDatabaseEntryId(node.path));

  if (entry.workspace_id !== rootNode.workspaceFolderId) {
    throw new Error('Database file is not inside the active workspace.');
  }

  if (entry.entry_type !== 1) {
    throw new Error('edit_file path must point to a database file.');
  }

  const originalFile = entry.content;
  const byteLength = Buffer.byteLength(originalFile, 'utf8');

  ensureReadableTextContentSize(node.path, byteLength);

  if (originalFile.includes('\0')) {
    throw new Error('file appears to be binary');
  }

  const { output, updatedFile } = editTextContent(getDatabaseEntryPath(entry.id), originalFile, input, 'database');
  updateAgentDatabaseFile(entry.id, updatedFile);

  return output;
}

function editWorkspaceTextFile(
  context: AgentRuntimeContext | undefined,
  input: EditFileInput,
  hooks?: AgentRuntimeHooks
): EditFileOutput {
  const workspaceType = getWorkspaceType(context);
  const workspaceRootPath = context?.workspaceRootPath?.trim();
  const workspaceRoot = resolveWorkspaceRoot(workspaceRootPath, workspaceType);
  let output: EditFileOutput;

  if (!workspaceRootPath || !workspaceRoot) {
    throw new Error('No active workspace root is available for file editing.');
  }

  if (workspaceType === 'filesystem') {
    output = editFilesystemTextFile(workspaceRoot.rootPath, input);
  } else if (workspaceType === 'database') {
    output = editDatabaseTextFile(workspaceRoot.node, input);
  } else {
    throw new Error('edit_file requires an active workspace.');
  }

  hooks?.onWorkspaceChanged?.(getWorkspaceSnapshot());

  return output;
}

function writeWorkspaceTextFile(
  context: AgentRuntimeContext | undefined,
  input: WriteFileInput,
  hooks?: AgentRuntimeHooks
): WriteFileOutput {
  const workspaceType = getWorkspaceType(context);
  const workspaceRootPath = context?.workspaceRootPath?.trim();
  const workspaceRoot = resolveWorkspaceRoot(workspaceRootPath, workspaceType);
  let output: WriteFileOutput;

  ensureWritableTextContentSize(input.content);

  if (!workspaceRootPath || !workspaceRoot) {
    throw new Error('No active workspace root is available for file writing.');
  }

  if (workspaceType === 'filesystem') {
    output = writeFilesystemTextFile(workspaceRoot.rootPath, input);
  } else if (workspaceType === 'database') {
    output = writeDatabaseTextFile(workspaceRoot.node, input);
  } else {
    throw new Error('write_file requires an active workspace.');
  }

  hooks?.onWorkspaceChanged?.(getWorkspaceSnapshot());

  return output;
}

async function runRepl(context: AgentRuntimeContext | undefined, input: ReplInput): Promise<ReplOutput> {
  const startedAt = Date.now();
  const workspaceType = getWorkspaceType(context);
  const workspaceRootPath = context?.workspaceRootPath?.trim();
  const language = input.language.trim();

  if (workspaceType !== 'filesystem') {
    return createReplOutput({
      blocked: true,
      cwd: 'No filesystem workspace',
      error: 'REPL execution is only available in filesystem workspaces.',
      language,
      ok: false,
      workspaceRootPath
    });
  }

  if (!workspaceRootPath) {
    return createReplOutput({
      blocked: true,
      cwd: 'No active workspace',
      error: 'No active workspace root is available for REPL execution.',
      language,
      ok: false
    });
  }

  const workspaceRoot = resolveWorkspaceRoot(workspaceRootPath, workspaceType);

  if (!workspaceRoot) {
    return createReplOutput({
      blocked: true,
      cwd: workspaceRootPath,
      error: 'The active workspace root is not registered in Veloca.',
      language,
      ok: false,
      workspaceRootPath
    });
  }

  const registeredWorkspaceRootPath = workspaceRoot.rootPath;

  if (!input.code.trim()) {
    return createReplOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: 'REPL code must not be empty.',
      language,
      ok: false,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  if (input.code.length > replMaxCodeLength) {
    return createReplOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: `REPL code cannot exceed ${replMaxCodeLength} characters.`,
      language,
      ok: false,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  if (!existsSync(bashSandboxExecPath)) {
    return createReplOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: 'REPL sandbox is unavailable on this machine.',
      language,
      ok: false,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  let runtime: ReplRuntime;

  try {
    runtime = resolveReplRuntime(language);
  } catch (error) {
    return createReplOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: getErrorMessage(error),
      language,
      ok: false,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  if (runtime.language === 'shell') {
    const blockedReason = getBlockedBashReason(input.code, registeredWorkspaceRootPath);

    if (blockedReason) {
      return createReplOutput({
        blocked: true,
        cwd: registeredWorkspaceRootPath,
        error: blockedReason,
        language: runtime.language,
        ok: false,
        runtimePath: runtime.program,
        workspaceRootPath: registeredWorkspaceRootPath
      });
    }
  }

  const cwd = realpathSync(registeredWorkspaceRootPath);
  const timeoutMs = input.timeoutMs ?? replDefaultTimeoutMs;

  try {
    const result = await executeSandboxedRepl(input, runtime, cwd, registeredWorkspaceRootPath, timeoutMs);
    const stderr = result.timedOut
      ? `${result.stderr}${result.stderr ? '\n' : ''}REPL execution exceeded timeout of ${timeoutMs} ms`
      : result.stderr;

    return createReplOutput({
      cwd,
      durationMs: Date.now() - startedAt,
      exitCode: result.exitCode,
      interrupted: result.timedOut || result.signal !== null,
      language: runtime.language,
      ok: result.exitCode === 0 && !result.timedOut,
      outputTruncated: result.truncated,
      runtimePath: runtime.program,
      sandboxStatus: {
        enabled: true,
        filesystem: 'workspace-write',
        network: 'blocked'
      },
      stderr,
      stdout: result.stdout,
      timedOut: result.timedOut,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  } catch (error) {
    return createReplOutput({
      cwd,
      durationMs: Date.now() - startedAt,
      error: getErrorMessage(error),
      language: runtime.language,
      ok: false,
      runtimePath: runtime.program,
      stderr: getErrorMessage(error),
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }
}

async function runPowerShellCommand(
  context: AgentRuntimeContext | undefined,
  input: PowerShellCommandInput
): Promise<PowerShellCommandOutput> {
  const startedAt = Date.now();
  const workspaceType = getWorkspaceType(context);
  const workspaceRootPath = context?.workspaceRootPath?.trim();
  const command = input.command.trim();

  if (workspaceType !== 'filesystem') {
    return createPowerShellOutput({
      blocked: true,
      cwd: 'No filesystem workspace',
      error: 'PowerShell commands are only available in filesystem workspaces.',
      ok: false,
      runInBackground: input.runInBackground,
      workspaceRootPath
    });
  }

  if (!workspaceRootPath) {
    return createPowerShellOutput({
      blocked: true,
      cwd: 'No active workspace',
      error: 'No active workspace root is available for PowerShell execution.',
      ok: false,
      runInBackground: input.runInBackground
    });
  }

  const workspaceRoot = resolveWorkspaceRoot(workspaceRootPath, workspaceType);

  if (!workspaceRoot) {
    return createPowerShellOutput({
      blocked: true,
      cwd: workspaceRootPath,
      error: 'The active workspace root is not registered in Veloca.',
      ok: false,
      runInBackground: input.runInBackground,
      workspaceRootPath
    });
  }

  const registeredWorkspaceRootPath = workspaceRoot.rootPath;

  if (input.runInBackground) {
    return createPowerShellOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: 'PowerShell background execution is not supported in Veloca Agent.',
      ok: false,
      runInBackground: true,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  if (!command) {
    return createPowerShellOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: 'PowerShell command cannot be empty.',
      ok: false,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  if (command.length > powerShellMaxCommandLength) {
    return createPowerShellOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: `PowerShell command cannot exceed ${powerShellMaxCommandLength} characters.`,
      ok: false,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  const blockedReason = getBlockedPowerShellReason(command, registeredWorkspaceRootPath);

  if (blockedReason) {
    return createPowerShellOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: blockedReason,
      ok: false,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  const powerShellPath = detectPowerShellShell();

  if (!powerShellPath) {
    return createPowerShellOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: 'PowerShell executable not found (expected `pwsh` or `powershell` in PATH).',
      ok: false,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  let cwd: string;

  try {
    cwd = resolvePowerShellCwd(registeredWorkspaceRootPath, input.cwd);
  } catch (error) {
    return createPowerShellOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: getErrorMessage(error),
      ok: false,
      powershellPath: powerShellPath,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  const timeoutMs = input.timeout ?? powerShellDefaultTimeoutMs;

  try {
    const result = await executePowerShell(command, cwd, powerShellPath, timeoutMs);
    const stderr = result.timedOut
      ? `${result.stderr}${result.stderr ? '\n' : ''}Command exceeded timeout of ${timeoutMs} ms`
      : result.stderr;

    return createPowerShellOutput({
      cwd,
      durationMs: Date.now() - startedAt,
      exitCode: result.exitCode,
      interrupted: result.timedOut || result.signal !== null,
      ok: result.exitCode === 0 && !result.timedOut,
      outputTruncated: result.truncated,
      powershellPath: powerShellPath,
      stderr,
      stdout: result.stdout,
      timedOut: result.timedOut,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  } catch (error) {
    return createPowerShellOutput({
      cwd,
      durationMs: Date.now() - startedAt,
      error: getErrorMessage(error),
      ok: false,
      powershellPath: powerShellPath,
      stderr: getErrorMessage(error),
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }
}

async function runBashCommand(context: AgentRuntimeContext | undefined, input: BashCommandInput): Promise<BashCommandOutput> {
  const startedAt = Date.now();
  const workspaceType = getWorkspaceType(context);
  const workspaceRootPath = context?.workspaceRootPath?.trim();
  const command = input.command.trim();
  const sandboxStatus = {
    enabled: true,
    filesystem: 'workspace-write' as const,
    network: 'blocked' as const
  };

  if (workspaceType !== 'filesystem') {
    return createBashOutput({
      blocked: true,
      cwd: 'No filesystem workspace',
      error: 'Bash commands are only available in filesystem workspaces.',
      ok: false,
      workspaceRootPath
    });
  }

  if (!workspaceRootPath) {
    return createBashOutput({
      blocked: true,
      cwd: 'No active workspace',
      error: 'No active workspace root is available for bash execution.',
      ok: false
    });
  }

  const workspaceRoot = resolveWorkspaceRoot(workspaceRootPath, workspaceType);

  if (!workspaceRoot) {
    return createBashOutput({
      blocked: true,
      cwd: workspaceRootPath,
      error: 'The active workspace root is not registered in Veloca.',
      ok: false,
      workspaceRootPath
    });
  }

  const registeredWorkspaceRootPath = workspaceRoot.rootPath;

  if (!existsSync(bashSandboxExecPath) || process.platform !== 'darwin') {
    return createBashOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: 'Bash sandbox is unavailable on this platform, so the command was not executed.',
      ok: false,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  if (!command) {
    return createBashOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: 'Bash command cannot be empty.',
      ok: false,
      sandboxStatus,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  if (command.length > bashMaxCommandLength) {
    return createBashOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: `Bash command cannot exceed ${bashMaxCommandLength} characters.`,
      ok: false,
      sandboxStatus,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  const blockedReason = getBlockedBashReason(command, registeredWorkspaceRootPath);

  if (blockedReason) {
    return createBashOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: blockedReason,
      ok: false,
      sandboxStatus,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  let cwd: string;

  try {
    cwd = resolveBashCwd(registeredWorkspaceRootPath, input.cwd);
  } catch (error) {
    return createBashOutput({
      blocked: true,
      cwd: registeredWorkspaceRootPath,
      error: getErrorMessage(error),
      ok: false,
      sandboxStatus,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }

  const timeoutMs = input.timeout ?? bashDefaultTimeoutMs;

  try {
    const result = await executeSandboxedBash(command, cwd, registeredWorkspaceRootPath, timeoutMs);
    const stderr = result.timedOut
      ? `${result.stderr}${result.stderr ? '\n' : ''}Command exceeded timeout of ${timeoutMs} ms`
      : result.stderr;

    return createBashOutput({
      cwd,
      durationMs: Date.now() - startedAt,
      exitCode: result.exitCode,
      interrupted: result.timedOut || result.signal !== null,
      ok: result.exitCode === 0 && !result.timedOut,
      outputTruncated: result.truncated,
      sandboxStatus,
      stderr,
      stdout: result.stdout,
      timedOut: result.timedOut,
      workspaceRootPath: registeredWorkspaceRootPath
    });
  } catch (error) {
    return createBashOutput({
      cwd,
      durationMs: Date.now() - startedAt,
      error: getErrorMessage(error),
      ok: false,
      sandboxStatus,
      stderr: getErrorMessage(error),
      workspaceRootPath: registeredWorkspaceRootPath
    });
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseVelocaIgnore(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'));
}

function readWorkspaceVelocaIgnore(rootPath: string, workspaceType: AgentWorkspaceType): string[] {
  if (workspaceType !== 'filesystem') {
    return [];
  }

  const ignorePath = join(rootPath, '.velocaignore');

  if (!existsSync(ignorePath)) {
    return [];
  }

  try {
    return parseVelocaIgnore(readFileSync(ignorePath, 'utf-8'));
  } catch {
    return [];
  }
}

function normalizeTreePath(value: string): string {
  return value.split(sep).join('/').replace(/^\/+/, '');
}

function getPathSegments(relativePath: string): string[] {
  return normalizeTreePath(relativePath).split('/').filter(Boolean);
}

function matchWildcard(pattern: string, value: string): boolean {
  const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`);

  return regex.test(value);
}

function matchesVelocaIgnorePattern(pattern: string, relativePath: string, name: string, isDirectory: boolean): boolean {
  const directoryOnly = pattern.endsWith('/');
  const rawPattern = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
  const normalizedPath = normalizeTreePath(relativePath);
  const normalizedPattern = normalizeTreePath(rawPattern);

  if (!normalizedPattern || (directoryOnly && !isDirectory)) {
    return false;
  }

  if (normalizedPattern.includes('/')) {
    return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
  }

  if (normalizedPattern.includes('*')) {
    return matchWildcard(normalizedPattern, name);
  }

  return getPathSegments(normalizedPath).includes(normalizedPattern);
}

function shouldIgnoreTreeEntry(patterns: string[], relativePath: string, name: string, isDirectory: boolean): boolean {
  return patterns.some((pattern) => matchesVelocaIgnorePattern(pattern, relativePath, name, isDirectory));
}

function createDirectoryTreeState(): DirectoryTreeWalkState {
  return {
    directories: 0,
    files: 0,
    ignored: 0,
    maxDepth: maxDirectoryTreeDepth,
    maxNodes: maxDirectoryTreeNodes,
    nodes: 0,
    truncated: false,
    unreadable: 0
  };
}

function pushDirectoryTreeLine(lines: string[], depth: number, name: string, isDirectory: boolean): void {
  lines.push(`${'  '.repeat(depth)}- ${name}${isDirectory ? '/' : ''}`);
}

function limitDirectoryTreeText(lines: string[], state: DirectoryTreeWalkState): string {
  const text = lines.join('\n');

  if (text.length <= maxDirectoryTreeCharacters) {
    return text;
  }

  state.truncated = true;
  return `${text.slice(0, maxDirectoryTreeCharacters)}\n... truncated because the directory tree exceeded ${maxDirectoryTreeCharacters} characters.`;
}

function getDirectoryTreePatterns(rootPath: string, workspaceType: AgentWorkspaceType, velocaignore: string | undefined): string[] {
  return Array.from(
    new Set([
      ...defaultVelocaIgnorePatterns,
      ...readWorkspaceVelocaIgnore(rootPath, workspaceType),
      ...parseVelocaIgnore(velocaignore)
    ])
  );
}

function hasParentPathSegment(path: string): boolean {
  return normalizeTreePath(path).split('/').includes('..');
}

function expandGlobBraces(pattern: string): string[] {
  const openIndex = pattern.indexOf('{');

  if (openIndex < 0) {
    return [pattern];
  }

  const closeIndex = pattern.indexOf('}', openIndex + 1);

  if (closeIndex < 0) {
    return [pattern];
  }

  const prefix = pattern.slice(0, openIndex);
  const suffix = pattern.slice(closeIndex + 1);
  const alternatives = pattern.slice(openIndex + 1, closeIndex).split(',');
  const expanded = alternatives.flatMap((alternative) => expandGlobBraces(`${prefix}${alternative}${suffix}`));

  if (expanded.length > maxGlobPatternExpansions) {
    throw new Error(`glob_search brace expansion cannot exceed ${maxGlobPatternExpansions} patterns.`);
  }

  return expanded;
}

function splitGlobPath(value: string): string[] {
  return normalizeTreePath(value.replace(/^\.\//, '')).split('/').filter(Boolean);
}

function globSegmentToRegex(segment: string): RegExp {
  let regex = '^';

  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];

    if (character === '*') {
      regex += '[^/]*';
      continue;
    }

    if (character === '?') {
      regex += '[^/]';
      continue;
    }

    if (character === '[') {
      const closeIndex = segment.indexOf(']', index + 1);

      if (closeIndex > index + 1) {
        regex += segment.slice(index, closeIndex + 1);
        index = closeIndex;
        continue;
      }
    }

    regex += escapeRegex(character);
  }

  regex += '$';

  return new RegExp(regex);
}

function globSegmentsMatch(patternSegments: string[], pathSegments: string[]): boolean {
  if (patternSegments.length === 0) {
    return pathSegments.length === 0;
  }

  const [currentPattern, ...remainingPatterns] = patternSegments;

  if (currentPattern === '**') {
    if (globSegmentsMatch(remainingPatterns, pathSegments)) {
      return true;
    }

    return pathSegments.length > 0 && globSegmentsMatch(patternSegments, pathSegments.slice(1));
  }

  return (
    pathSegments.length > 0 &&
    globSegmentToRegex(currentPattern).test(pathSegments[0]) &&
    globSegmentsMatch(remainingPatterns, pathSegments.slice(1))
  );
}

function matchesAnyGlobPattern(patterns: string[][], relativePath: string): boolean {
  const pathSegments = splitGlobPath(relativePath);

  return patterns.some((patternSegments) => globSegmentsMatch(patternSegments, pathSegments));
}

function createGlobSearchOutput(startedAt: number, matches: GlobSearchMatch[], truncated: boolean): GlobSearchOutput {
  const sortedMatches = matches.sort((left, right) => right.sortTime - left.sortTime || left.filename.localeCompare(right.filename));
  const filenames = sortedMatches.slice(0, maxGlobSearchResults).map((match) => match.filename);

  return {
    durationMs: Date.now() - startedAt,
    filenames,
    numFiles: filenames.length,
    truncated: truncated || sortedMatches.length > maxGlobSearchResults
  };
}

function resolveFilesystemGlobBasePath(workspaceRootPath: string, path: string | undefined): string {
  const canonicalRoot = realpathSync(workspaceRootPath);

  if (!path) {
    return canonicalRoot;
  }

  if (hasParentPathSegment(path)) {
    throw new Error('glob_search path cannot contain parent-directory traversal.');
  }

  const candidatePath = isAbsolute(path) ? path : resolve(canonicalRoot, path);

  if (!existsSync(candidatePath)) {
    throw new Error('glob_search path does not exist inside the active workspace.');
  }

  const resolvedPath = realpathSync(candidatePath);
  const stats = statSync(resolvedPath);

  if (!isSameOrChildPath(canonicalRoot, resolvedPath)) {
    throw new Error(`path ${resolvedPath} escapes workspace boundary ${canonicalRoot}`);
  }

  if (!stats.isDirectory()) {
    throw new Error('glob_search path must point to a directory.');
  }

  return resolvedPath;
}

function getFilesystemGlobPatternSegments(
  workspaceRootPath: string,
  basePath: string,
  pattern: string
): { patternSegments: string[][]; searchRootPath: string } {
  const canonicalRoot = realpathSync(workspaceRootPath);

  if (isAbsolute(pattern)) {
    const absolutePattern = resolve(pattern);

    if (!isSameOrChildPath(canonicalRoot, absolutePattern)) {
      throw new Error('glob_search absolute pattern must stay inside the active workspace root.');
    }

    return {
      patternSegments: expandGlobBraces(normalizeTreePath(relative(canonicalRoot, absolutePattern))).map(splitGlobPath),
      searchRootPath: canonicalRoot
    };
  }

  if (hasParentPathSegment(pattern)) {
    throw new Error('glob_search pattern cannot contain parent-directory traversal.');
  }

  return {
    patternSegments: expandGlobBraces(pattern).map(splitGlobPath),
    searchRootPath: basePath
  };
}

function walkFilesystemGlobSearch(
  directoryPath: string,
  rootPath: string,
  searchRootPath: string,
  ignorePatterns: string[],
  globPatterns: string[][],
  seen: Set<string>,
  matches: GlobSearchMatch[]
): void {
  let entries;

  try {
    entries = readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isFile()) {
      continue;
    }

    const entryPath = join(directoryPath, entry.name);
    const relativeToRoot = normalizeTreePath(relative(rootPath, entryPath));
    const isDirectory = entry.isDirectory();

    if (entry.isSymbolicLink() || shouldIgnoreTreeEntry(ignorePatterns, relativeToRoot, entry.name, isDirectory)) {
      continue;
    }

    if (isDirectory) {
      walkFilesystemGlobSearch(entryPath, rootPath, searchRootPath, ignorePatterns, globPatterns, seen, matches);
      continue;
    }

    const relativeToSearchRoot = normalizeTreePath(relative(searchRootPath, entryPath));

    if (!matchesAnyGlobPattern(globPatterns, relativeToSearchRoot) || seen.has(entryPath)) {
      continue;
    }

    let sortTime = 0;

    try {
      sortTime = statSync(entryPath).mtimeMs;
    } catch {
      sortTime = 0;
    }

    seen.add(entryPath);
    matches.push({
      filename: entryPath,
      sortTime
    });
  }
}

function globSearchFilesystem(workspaceRootPath: string, input: GlobSearchInput): GlobSearchOutput {
  const startedAt = Date.now();
  const searchRootPath = resolveFilesystemGlobBasePath(workspaceRootPath, input.path);
  const { patternSegments, searchRootPath: resolvedSearchRootPath } = getFilesystemGlobPatternSegments(
    workspaceRootPath,
    searchRootPath,
    input.pattern
  );
  const ignorePatterns = getDirectoryTreePatterns(workspaceRootPath, 'filesystem', undefined);
  const matches: GlobSearchMatch[] = [];

  walkFilesystemGlobSearch(
    resolvedSearchRootPath,
    realpathSync(workspaceRootPath),
    resolvedSearchRootPath,
    ignorePatterns,
    patternSegments,
    new Set(),
    matches
  );

  return createGlobSearchOutput(startedAt, matches, false);
}

function resolveDatabaseGlobBaseNode(rootNode: WorkspaceTreeNode, path: string | undefined): WorkspaceTreeNode {
  if (!path) {
    return rootNode;
  }

  if (hasParentPathSegment(path)) {
    throw new Error('glob_search path cannot contain parent-directory traversal.');
  }

  const node = path.startsWith('veloca-db://entry/')
    ? findWorkspaceTreeNodeByPath(rootNode, path)
    : findWorkspaceTreeNodeByRelativePath(rootNode, path);

  if (!node) {
    throw new Error('Database glob_search path is not inside the active workspace.');
  }

  if (node.type !== 'folder') {
    throw new Error('glob_search path must point to a database folder.');
  }

  return node;
}

function getDatabaseNodeRelativeToBase(baseNode: WorkspaceTreeNode, node: WorkspaceTreeNode): string {
  const basePath = normalizeTreePath(baseNode.relativePath);
  const nodePath = normalizeTreePath(node.relativePath);

  if (!basePath) {
    return nodePath;
  }

  return nodePath === basePath ? '' : nodePath.replace(`${basePath}/`, '');
}

function getDatabaseEntrySortTime(filePath: string): number {
  try {
    return getAgentDatabaseEntry(getDatabaseEntryId(filePath)).created_at;
  } catch {
    return 0;
  }
}

function walkDatabaseGlobSearch(
  node: WorkspaceTreeNode,
  baseNode: WorkspaceTreeNode,
  ignorePatterns: string[],
  globPatterns: string[][],
  seen: Set<string>,
  matches: GlobSearchMatch[]
): void {
  for (const child of node.children ?? []) {
    if (shouldIgnoreTreeEntry(ignorePatterns, child.relativePath, child.name, child.type === 'folder')) {
      continue;
    }

    if (child.type === 'folder') {
      walkDatabaseGlobSearch(child, baseNode, ignorePatterns, globPatterns, seen, matches);
      continue;
    }

    const relativeToBase = getDatabaseNodeRelativeToBase(baseNode, child);

    if (!matchesAnyGlobPattern(globPatterns, relativeToBase) || seen.has(child.path)) {
      continue;
    }

    seen.add(child.path);
    matches.push({
      filename: child.path,
      sortTime: getDatabaseEntrySortTime(child.path)
    });
  }
}

function globSearchDatabase(rootNode: WorkspaceTreeNode, input: GlobSearchInput): GlobSearchOutput {
  if (isAbsolute(input.pattern) || input.pattern.startsWith('veloca-db://')) {
    throw new Error('glob_search database patterns must be workspace-relative glob patterns.');
  }

  if (hasParentPathSegment(input.pattern)) {
    throw new Error('glob_search pattern cannot contain parent-directory traversal.');
  }

  const startedAt = Date.now();
  const baseNode = resolveDatabaseGlobBaseNode(rootNode, input.path);
  const ignorePatterns = getDirectoryTreePatterns(rootNode.path, 'database', undefined);
  const patternSegments = expandGlobBraces(input.pattern).map(splitGlobPath);
  const matches: GlobSearchMatch[] = [];

  walkDatabaseGlobSearch(baseNode, baseNode, ignorePatterns, patternSegments, new Set(), matches);

  return createGlobSearchOutput(startedAt, matches, false);
}

function globSearchWorkspace(context: AgentRuntimeContext | undefined, input: GlobSearchInput): GlobSearchOutput {
  const workspaceType = getWorkspaceType(context);
  const workspaceRootPath = context?.workspaceRootPath?.trim();
  const workspaceRoot = resolveWorkspaceRoot(workspaceRootPath, workspaceType);

  if (!workspaceRootPath || !workspaceRoot) {
    throw new Error('No active workspace root is available for glob search.');
  }

  if (workspaceType === 'filesystem') {
    return globSearchFilesystem(workspaceRoot.rootPath, input);
  }

  if (workspaceType === 'database') {
    return globSearchDatabase(workspaceRoot.node, input);
  }

  throw new Error('glob_search requires an active workspace.');
}

function getFileExtension(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf('.');

  return extensionIndex >= 0 ? fileName.slice(extensionIndex + 1).toLowerCase() : '';
}

function getGrepFileTypeExtensions(fileType: string | undefined): Set<string> | null {
  if (!fileType) {
    return null;
  }

  const normalizedType = fileType.trim().toLowerCase().replace(/^\./, '');
  const mappedTypes: Record<string, string[]> = {
    javascript: ['cjs', 'js', 'jsx', 'mjs'],
    markdown: ['md', 'markdown', 'mdx'],
    typescript: ['ts', 'tsx']
  };

  return new Set(mappedTypes[normalizedType] ?? [normalizedType]);
}

function compileGrepRegex(input: GrepSearchInput, global: boolean): RegExp {
  try {
    return new RegExp(input.pattern, `${input.caseInsensitive ? 'i' : ''}${input.multiline ? 's' : ''}${global ? 'g' : ''}`);
  } catch (error) {
    throw new Error(`Invalid grep_search regex pattern: ${getErrorMessage(error)}`);
  }
}

function countRegexMatches(regex: RegExp, content: string): number {
  let count = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    count += 1;

    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
  }

  return count;
}

function applyGrepLimit<T>(
  items: T[],
  headLimit: number | undefined,
  offset: number | undefined
): { appliedLimit: number | null; appliedOffset: number | null; items: T[] } {
  const offsetValue = offset ?? 0;
  const explicitLimit = headLimit ?? defaultGrepSearchLimit;
  const offsetItems = items.slice(offsetValue);
  const truncated = offsetItems.length > explicitLimit;

  return {
    appliedLimit: truncated ? explicitLimit : null,
    appliedOffset: offsetValue > 0 ? offsetValue : null,
    items: offsetItems.slice(0, explicitLimit)
  };
}

function compileGrepGlobFilters(
  glob: string | undefined,
  workspaceRootPath: string,
  workspaceType: AgentWorkspaceType
): Array<{ basenameOnly: boolean; segments: string[] }> | null {
  if (!glob) {
    return null;
  }

  if (hasParentPathSegment(glob)) {
    throw new Error('grep_search glob cannot contain parent-directory traversal.');
  }

  let normalizedGlob = glob;

  if (isAbsolute(glob)) {
    if (workspaceType !== 'filesystem') {
      throw new Error('grep_search database glob must be workspace-relative.');
    }

    const canonicalRoot = realpathSync(workspaceRootPath);
    const absoluteGlob = resolve(glob);

    if (!isSameOrChildPath(canonicalRoot, absoluteGlob)) {
      throw new Error('grep_search absolute glob must stay inside the active workspace root.');
    }

    normalizedGlob = normalizeTreePath(relative(canonicalRoot, absoluteGlob));
  }

  return expandGlobBraces(normalizedGlob).map((expandedPattern) => ({
    basenameOnly: !normalizeTreePath(expandedPattern).includes('/'),
    segments: splitGlobPath(expandedPattern)
  }));
}

function matchesGrepGlobFilter(
  filters: Array<{ basenameOnly: boolean; segments: string[] }> | null,
  file: GrepSearchFile
): boolean {
  if (!filters) {
    return true;
  }

  return filters.some((filter) => {
    if (filter.basenameOnly && globSegmentToRegex(filter.segments[0] ?? '').test(file.name)) {
      return true;
    }

    return (
      globSegmentsMatch(filter.segments, splitGlobPath(file.baseRelativePath)) ||
      globSegmentsMatch(filter.segments, splitGlobPath(file.relativePath))
    );
  });
}

function shouldSearchGrepFile(
  file: GrepSearchFile,
  filters: Array<{ basenameOnly: boolean; segments: string[] }> | null,
  fileTypeExtensions: Set<string> | null
): boolean {
  if (fileTypeExtensions && !fileTypeExtensions.has(getFileExtension(file.name))) {
    return false;
  }

  return matchesGrepGlobFilter(filters, file);
}

function createFilesystemGrepFile(filePath: string, rootPath: string, basePath: string): GrepSearchFile {
  const stats = statSync(filePath);
  const baseRelativePath = normalizeTreePath(relative(basePath, filePath)) || basename(filePath);

  return {
    baseRelativePath,
    filePath,
    name: basename(filePath),
    relativePath: normalizeTreePath(relative(rootPath, filePath)),
    sortTime: stats.mtimeMs
  };
}

function resolveFilesystemGrepTarget(
  workspaceRootPath: string,
  path: string | undefined
): { basePath: string; isFile: boolean; targetPath: string } {
  const canonicalRoot = realpathSync(workspaceRootPath);

  if (!path) {
    return {
      basePath: canonicalRoot,
      isFile: false,
      targetPath: canonicalRoot
    };
  }

  if (hasParentPathSegment(path)) {
    throw new Error('grep_search path cannot contain parent-directory traversal.');
  }

  const candidatePath = isAbsolute(path) ? path : resolve(canonicalRoot, path);

  if (!existsSync(candidatePath)) {
    throw new Error('grep_search path does not exist inside the active workspace.');
  }

  const resolvedPath = realpathSync(candidatePath);
  const stats = statSync(resolvedPath);

  if (!isSameOrChildPath(canonicalRoot, resolvedPath)) {
    throw new Error(`path ${resolvedPath} escapes workspace boundary ${canonicalRoot}`);
  }

  if (!stats.isDirectory() && !stats.isFile()) {
    throw new Error('grep_search path must point to a file or directory.');
  }

  return {
    basePath: stats.isFile() ? dirname(resolvedPath) : resolvedPath,
    isFile: stats.isFile(),
    targetPath: resolvedPath
  };
}

function collectFilesystemGrepFiles(
  directoryPath: string,
  rootPath: string,
  basePath: string,
  ignorePatterns: string[],
  files: GrepSearchFile[]
): void {
  let entries;

  try {
    entries = readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  entries = entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isFile()) {
      continue;
    }

    const entryPath = join(directoryPath, entry.name);
    const relativeToRoot = normalizeTreePath(relative(rootPath, entryPath));
    const isDirectory = entry.isDirectory();

    if (entry.isSymbolicLink() || shouldIgnoreTreeEntry(ignorePatterns, relativeToRoot, entry.name, isDirectory)) {
      continue;
    }

    if (isDirectory) {
      collectFilesystemGrepFiles(entryPath, rootPath, basePath, ignorePatterns, files);
    } else {
      files.push(createFilesystemGrepFile(entryPath, rootPath, basePath));
    }
  }
}

function readFilesystemGrepContent(filePath: string): string | null {
  try {
    const stats = statSync(filePath);

    ensureReadableTextContentSize(filePath, stats.size);

    return readResolvedFilesystemTextContent(filePath);
  } catch {
    return null;
  }
}

function collectDatabaseGrepFiles(
  node: WorkspaceTreeNode,
  baseNode: WorkspaceTreeNode,
  ignorePatterns: string[],
  files: GrepSearchFile[]
): void {
  for (const child of node.children ?? []) {
    if (shouldIgnoreTreeEntry(ignorePatterns, child.relativePath, child.name, child.type === 'folder')) {
      continue;
    }

    if (child.type === 'folder') {
      collectDatabaseGrepFiles(child, baseNode, ignorePatterns, files);
      continue;
    }

    let entry: AgentDatabaseEntryRow;

    try {
      entry = getAgentDatabaseEntry(getDatabaseEntryId(child.path));
    } catch {
      continue;
    }

    const baseRelativePath = getDatabaseNodeRelativeToBase(baseNode, child) || child.name;

    files.push({
      baseRelativePath,
      content: entry.content,
      filePath: child.path,
      name: child.name,
      relativePath: normalizeTreePath(child.relativePath),
      sortTime: entry.created_at
    });
  }
}

function resolveDatabaseGrepNode(rootNode: WorkspaceTreeNode, path: string | undefined): WorkspaceTreeNode {
  if (!path) {
    return rootNode;
  }

  if (hasParentPathSegment(path)) {
    throw new Error('grep_search path cannot contain parent-directory traversal.');
  }

  const node = path.startsWith('veloca-db://entry/')
    ? findWorkspaceTreeNodeByPath(rootNode, path)
    : findWorkspaceTreeNodeByRelativePath(rootNode, path);

  if (!node) {
    throw new Error('Database grep_search path is not inside the active workspace.');
  }

  return node;
}

function readDatabaseGrepContent(file: GrepSearchFile): string | null {
  const content = file.content ?? '';
  const byteLength = Buffer.byteLength(content, 'utf8');

  try {
    ensureReadableTextContentSize(file.filePath, byteLength);
  } catch {
    return null;
  }

  if (content.includes('\0')) {
    return null;
  }

  return content;
}

function runGrepSearch(files: GrepSearchFile[], input: GrepSearchInput): GrepSearchOutput {
  const regex = compileGrepRegex(input, false);
  const countRegex = input.outputMode === 'count' ? compileGrepRegex(input, true) : null;
  const filenames: string[] = [];
  const contentLines: string[] = [];
  let totalMatches = 0;
  const contextLineCount = input.context ?? input.contextShort ?? 0;
  const before = input.before ?? contextLineCount;
  const after = input.after ?? contextLineCount;

  for (const file of files) {
    const fileContents = file.content === undefined ? readFilesystemGrepContent(file.filePath) : readDatabaseGrepContent(file);

    if (fileContents === null) {
      continue;
    }

    if (input.outputMode === 'count' && countRegex) {
      countRegex.lastIndex = 0;
      const count = countRegexMatches(countRegex, fileContents);

      if (count > 0) {
        filenames.push(file.filePath);
        totalMatches += count;
      }

      continue;
    }

    const lines = splitTextLines(fileContents);
    const matchedLines: number[] = [];

    for (const [index, line] of lines.entries()) {
      if (regex.test(line)) {
        totalMatches += 1;
        matchedLines.push(index);
      }
    }

    if (matchedLines.length === 0) {
      continue;
    }

    filenames.push(file.filePath);

    if (input.outputMode === 'content') {
      for (const index of matchedLines) {
        const start = Math.max(index - before, 0);
        const end = Math.min(index + after + 1, lines.length);

        for (let current = start; current < end; current += 1) {
          const prefix = input.lineNumbers ? `${file.filePath}:${current + 1}:` : `${file.filePath}:`;
          contentLines.push(`${prefix}${lines[current]}`);
        }
      }
    }
  }

  const limitedFilenames = applyGrepLimit(filenames, input.headLimit, input.offset);

  if (input.outputMode === 'content') {
    const limitedContent = applyGrepLimit(contentLines, input.headLimit, input.offset);

    return {
      appliedLimit: limitedContent.appliedLimit,
      appliedOffset: limitedContent.appliedOffset,
      content: limitedContent.items.join('\n'),
      filenames: limitedFilenames.items,
      mode: input.outputMode,
      numFiles: limitedFilenames.items.length,
      numLines: limitedContent.items.length,
      numMatches: null
    };
  }

  return {
    appliedLimit: limitedFilenames.appliedLimit,
    appliedOffset: limitedFilenames.appliedOffset,
    content: null,
    filenames: limitedFilenames.items,
    mode: input.outputMode,
    numFiles: limitedFilenames.items.length,
    numLines: null,
    numMatches: input.outputMode === 'count' ? totalMatches : null
  };
}

function grepSearchFilesystem(workspaceRootPath: string, input: GrepSearchInput): GrepSearchOutput {
  const target = resolveFilesystemGrepTarget(workspaceRootPath, input.path);
  const rootPath = realpathSync(workspaceRootPath);
  const ignorePatterns = getDirectoryTreePatterns(rootPath, 'filesystem', undefined);
  const filters = compileGrepGlobFilters(input.glob, rootPath, 'filesystem');
  const fileTypeExtensions = getGrepFileTypeExtensions(input.fileType);
  const files: GrepSearchFile[] = [];

  if (target.isFile) {
    const file = createFilesystemGrepFile(target.targetPath, rootPath, target.basePath);

    if (!shouldIgnoreTreeEntry(ignorePatterns, file.relativePath, file.name, false)) {
      files.push(file);
    }
  } else {
    collectFilesystemGrepFiles(target.targetPath, rootPath, target.basePath, ignorePatterns, files);
  }

  return runGrepSearch(
    files.filter((file) => shouldSearchGrepFile(file, filters, fileTypeExtensions)),
    input
  );
}

function grepSearchDatabase(rootNode: WorkspaceTreeNode, input: GrepSearchInput): GrepSearchOutput {
  const baseNode = resolveDatabaseGrepNode(rootNode, input.path);
  const ignorePatterns = getDirectoryTreePatterns(rootNode.path, 'database', undefined);
  const filters = compileGrepGlobFilters(input.glob, rootNode.path, 'database');
  const fileTypeExtensions = getGrepFileTypeExtensions(input.fileType);
  const files: GrepSearchFile[] = [];

  if (baseNode.type === 'file') {
    let entry: AgentDatabaseEntryRow;

    try {
      entry = getAgentDatabaseEntry(getDatabaseEntryId(baseNode.path));
    } catch {
      entry = {
        content: '',
        created_at: 0,
        entry_type: 1,
        id: '',
        name: baseNode.name,
        parent_id: null,
        workspace_id: baseNode.workspaceFolderId
      };
    }

    files.push({
      baseRelativePath: baseNode.name,
      content: entry.content,
      filePath: baseNode.path,
      name: baseNode.name,
      relativePath: normalizeTreePath(baseNode.relativePath),
      sortTime: entry.created_at
    });
  } else {
    collectDatabaseGrepFiles(baseNode, baseNode, ignorePatterns, files);
  }

  return runGrepSearch(
    files.filter((file) => shouldSearchGrepFile(file, filters, fileTypeExtensions)),
    input
  );
}

function grepSearchWorkspace(context: AgentRuntimeContext | undefined, input: GrepSearchInput): GrepSearchOutput {
  const workspaceType = getWorkspaceType(context);
  const workspaceRootPath = context?.workspaceRootPath?.trim();
  const workspaceRoot = resolveWorkspaceRoot(workspaceRootPath, workspaceType);

  if (!workspaceRootPath || !workspaceRoot) {
    throw new Error('No active workspace root is available for grep search.');
  }

  if (workspaceType === 'filesystem') {
    return grepSearchFilesystem(workspaceRoot.rootPath, input);
  }

  if (workspaceType === 'database') {
    return grepSearchDatabase(workspaceRoot.node, input);
  }

  throw new Error('grep_search requires an active workspace.');
}

function resolveWorkspaceRoot(
  rootPath: string | undefined,
  workspaceType: AgentWorkspaceType
): { node: WorkspaceTreeNode; rootPath: string } | null {
  if (!rootPath || workspaceType === 'none') {
    return null;
  }

  const nodes = getWorkspaceSnapshot().tree.filter(
    (node) => node.type === 'folder' && node.source === workspaceType
  );

  if (workspaceType !== 'filesystem') {
    const node = nodes.find((candidate) => candidate.path === rootPath);
    return node ? { node, rootPath } : null;
  }

  let requestedRootPath: string;

  try {
    requestedRootPath = realpathSync(rootPath);
  } catch {
    return null;
  }

  for (const node of nodes) {
    try {
      const registeredRootPath = realpathSync(node.path);

      if (registeredRootPath === requestedRootPath) {
        return { node, rootPath: registeredRootPath };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function walkFilesystemDirectory(
  directoryPath: string,
  rootPath: string,
  patterns: string[],
  lines: string[],
  state: DirectoryTreeWalkState,
  depth: number
): void {
  if (state.truncated || depth > maxDirectoryTreeDepth) {
    state.truncated = state.truncated || depth > maxDirectoryTreeDepth;
    return;
  }

  let entries;

  try {
    entries = readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    state.unreadable += 1;
    return;
  }

  entries = entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

  for (const entry of entries) {
    if (state.nodes >= maxDirectoryTreeNodes) {
      state.truncated = true;
      return;
    }

    if (!entry.isDirectory() && !entry.isFile()) {
      state.ignored += 1;
      continue;
    }

    const isDirectory = entry.isDirectory();
    const entryPath = join(directoryPath, entry.name);
    const relativePath = normalizeTreePath(relative(rootPath, entryPath));

    if (entry.isSymbolicLink() || shouldIgnoreTreeEntry(patterns, relativePath, entry.name, isDirectory)) {
      state.ignored += 1;
      continue;
    }

    state.nodes += 1;
    pushDirectoryTreeLine(lines, depth, entry.name, isDirectory);

    if (isDirectory) {
      state.directories += 1;
      walkFilesystemDirectory(entryPath, rootPath, patterns, lines, state, depth + 1);
    } else if (entry.isFile()) {
      state.files += 1;
    }
  }
}

function walkWorkspaceTreeNode(
  node: WorkspaceTreeNode,
  patterns: string[],
  lines: string[],
  state: DirectoryTreeWalkState,
  depth: number
): void {
  if (state.truncated || depth > maxDirectoryTreeDepth) {
    state.truncated = state.truncated || depth > maxDirectoryTreeDepth;
    return;
  }

  for (const child of node.children ?? []) {
    if (state.nodes >= maxDirectoryTreeNodes) {
      state.truncated = true;
      return;
    }

    if (shouldIgnoreTreeEntry(patterns, child.relativePath, child.name, child.type === 'folder')) {
      state.ignored += 1;
      continue;
    }

    state.nodes += 1;
    pushDirectoryTreeLine(lines, depth, child.name, child.type === 'folder');

    if (child.type === 'folder') {
      state.directories += 1;
      walkWorkspaceTreeNode(child, patterns, lines, state, depth + 1);
    } else {
      state.files += 1;
    }
  }
}

function getWorkspaceDirectoryTree(context: AgentRuntimeContext | undefined, velocaignore: string | undefined) {
  const workspaceType = getWorkspaceType(context);
  const workspaceRootPath = context?.workspaceRootPath?.trim();
  const workspaceRoot = resolveWorkspaceRoot(workspaceRootPath, workspaceType);

  if (!workspaceRootPath || !workspaceRoot) {
    return {
      error: 'No active workspace root is available for directory tree inspection.',
      ok: false,
      workspaceType
    };
  }

  const registeredWorkspaceRootPath = workspaceRoot.rootPath;
  const rootNode = workspaceRoot.node;
  const patterns = getDirectoryTreePatterns(registeredWorkspaceRootPath, workspaceType, velocaignore);
  const state = createDirectoryTreeState();
  const rootName = rootNode.name || basename(registeredWorkspaceRootPath) || registeredWorkspaceRootPath;
  const lines = [`${rootName}/`];

  if (workspaceType === 'filesystem') {
    walkFilesystemDirectory(registeredWorkspaceRootPath, registeredWorkspaceRootPath, patterns, lines, state, 1);
  } else {
    walkWorkspaceTreeNode(rootNode, patterns, lines, state, 1);
  }

  const tree = limitDirectoryTreeText(lines, state);
  const stats: DirectoryTreeStats = {
    directories: state.directories,
    files: state.files,
    ignored: state.ignored,
    maxDepth: state.maxDepth,
    maxNodes: state.maxNodes,
    truncated: state.truncated,
    unreadable: state.unreadable
  };

  return {
    currentFilePath: getContextValue(context?.currentFilePath, 'No active file'),
    ignoredPatterns: patterns,
    ok: true,
    stats,
    tree,
    workspaceRootPath: registeredWorkspaceRootPath,
    workspaceType
  };
}

function buildAgentTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'get_workspace_directory_tree',
        description:
          'Return a compact directory tree for the active Veloca workspace. Use this when the user asks about the workspace structure or when you need to discover nearby context before answering.',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: 'Tool input object. Always pass arguments inside this object.',
              properties: {
                velocaignore: {
                  type: 'string',
                  description:
                    'Optional .velocaignore-style ignore patterns separated by newlines or commas. These patterns are merged with Veloca defaults and the workspace .velocaignore file.'
                }
              },
              required: [],
              additionalProperties: false
            }
          },
          required: ['input'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'glob_search',
        description:
          'Find files in the active Veloca workspace by glob pattern. Supports brace expansion such as **/*.{ts,tsx,md}. Returns at most the 100 most recently modified matching files.',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: 'Tool input object. Always pass arguments inside this object.',
              properties: {
                pattern: {
                  type: 'string',
                  description:
                    'Glob pattern to match files. Use workspace-relative patterns such as **/*.md or **/*.{ts,tsx}. Filesystem workspaces also allow absolute patterns inside the active workspace.'
                },
                path: {
                  type: 'string',
                  description:
                    'Optional search base folder. May be workspace-relative or absolute inside a filesystem workspace, and workspace-relative or veloca-db://entry/... for a database folder.'
                }
              },
              required: ['pattern'],
              additionalProperties: false
            }
          },
          required: ['input'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'grep_search',
        description:
          'Search text file contents in the active Veloca workspace with a regular expression. Supports filename glob filters, content output, count output, context lines, pagination, and case-insensitive search.',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: 'Tool input object. Always pass arguments inside this object.',
              properties: {
                pattern: {
                  type: 'string',
                  description: 'Regular expression pattern to search for.'
                },
                path: {
                  type: 'string',
                  description:
                    'Optional file or directory to search. Must be inside the active workspace. Database paths may be workspace-relative or veloca-db://entry/....'
                },
                glob: {
                  type: 'string',
                  description:
                    'Optional filename glob filter such as **/*.md or **/*.{ts,tsx}. It filters files before reading content.'
                },
                output_mode: {
                  type: 'string',
                  enum: ['files_with_matches', 'content', 'count'],
                  description:
                    'Optional output mode. Defaults to files_with_matches. Use content for matching lines, count for total regex matches.'
                },
                '-B': {
                  type: 'number',
                  minimum: 0,
                  description: 'Optional number of lines to include before each matching line in content mode.'
                },
                '-A': {
                  type: 'number',
                  minimum: 0,
                  description: 'Optional number of lines to include after each matching line in content mode.'
                },
                '-C': {
                  type: 'number',
                  minimum: 0,
                  description: 'Optional number of context lines before and after each match.'
                },
                context: {
                  type: 'number',
                  minimum: 0,
                  description: 'Optional context lines before and after each match.'
                },
                '-n': {
                  type: 'boolean',
                  description: 'Optional. Defaults to true. Include line numbers in content mode.'
                },
                '-i': {
                  type: 'boolean',
                  description: 'Optional. Defaults to false. Search case-insensitively.'
                },
                type: {
                  type: 'string',
                  description: 'Optional file extension filter such as md, ts, json, or markdown.'
                },
                head_limit: {
                  type: 'number',
                  minimum: 1,
                  description: 'Optional maximum number of returned files or content lines.'
                },
                offset: {
                  type: 'number',
                  minimum: 0,
                  description: 'Optional number of returned files or content lines to skip.'
                },
                multiline: {
                  type: 'boolean',
                  description: 'Optional. Defaults to false. Allows dot in the regex to match newlines for count mode.'
                }
              },
              required: ['pattern'],
              additionalProperties: false
            }
          },
          required: ['input'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description:
          'Read a text file from the active Veloca workspace. Supports filesystem text files and database workspace virtual files.',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: 'Tool input object. Always pass arguments inside this object.',
              properties: {
                path: {
                  type: 'string',
                  description:
                    'File path to read. Filesystem paths may be workspace-relative or absolute within the active workspace. Database paths may be veloca-db://entry/... or workspace-relative.'
                },
                offset: {
                  type: 'number',
                  minimum: 0,
                  description: 'Optional zero-based line offset.'
                },
                limit: {
                  type: 'number',
                  minimum: 1,
                  description: 'Optional maximum number of lines to read.'
                }
              },
              required: ['path'],
              additionalProperties: false
            }
          },
          required: ['input'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description:
          'Replace exact text in an existing text file inside the active Veloca workspace. Supports filesystem files and database workspace virtual files. Use for targeted edits after reading enough context.',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: 'Tool input object. Always pass arguments inside this object.',
              properties: {
                path: {
                  type: 'string',
                  description:
                    'Existing file path to edit. Filesystem paths may be workspace-relative or absolute within the active workspace. Database paths may be veloca-db://entry/... or workspace-relative.'
                },
                old_string: {
                  type: 'string',
                  description:
                    'Exact text to replace. It must appear in the current file content and cannot be empty.'
                },
                new_string: {
                  type: 'string',
                  description: 'Replacement text.'
                },
                replace_all: {
                  type: 'boolean',
                  description:
                    'Optional. Defaults to false. When true, every occurrence of old_string is replaced.'
                }
              },
              required: ['path', 'old_string', 'new_string'],
              additionalProperties: false
            }
          },
          required: ['input'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description:
          'Write a text file in the active Veloca workspace. Supports filesystem files and database workspace virtual files. Use only when the user clearly wants to create or replace a file.',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: 'Tool input object. Always pass arguments inside this object.',
              properties: {
                path: {
                  type: 'string',
                  description:
                    'File path to write. Filesystem paths may be workspace-relative or absolute within the active workspace. Database paths may be veloca-db://entry/... for existing files or workspace-relative for create/update.'
                },
                content: {
                  type: 'string',
                  description: 'Complete text content to write to the file. The full file will be replaced.'
                }
              },
              required: ['path', 'content'],
              additionalProperties: false
            }
          },
          required: ['input'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'WebFetch',
        description:
          'Fetch a URL, convert it into readable text, and answer a prompt about it. Use when the user provides a link that needs to be opened or inspected.',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: 'Tool input object. Always pass arguments inside this object.',
              properties: {
                url: {
                  type: 'string',
                  format: 'uri',
                  description: 'The URL to fetch. Non-local http URLs are upgraded to https before fetching.'
                },
                prompt: {
                  type: 'string',
                  description:
                    'Question or instruction about the fetched content, such as summarize this page or what is the title.'
                }
              },
              required: ['url', 'prompt'],
              additionalProperties: false
            }
          },
          required: ['input'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'WebSearch',
        description:
          'Search the web for current information and return cited results. Use when the user enables Web Search or asks for current external information.',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: 'Tool input object. Always pass arguments inside this object.',
              properties: {
                query: {
                  type: 'string',
                  minLength: 2,
                  description: 'The web search query.'
                },
                allowed_domains: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  description:
                    'Optional domain allowlist, such as ["openai.com", "docs.rs"]. Results outside these domains are removed.'
                },
                blocked_domains: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  description:
                    'Optional domain blocklist, such as ["example.com"]. Matching results are removed.'
                }
              },
              required: ['query'],
              additionalProperties: false
            }
          },
          required: ['input'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'REPL',
        description:
          'Execute a short Python, JavaScript/Node.js, or shell code snippet in a sandboxed subprocess inside the active filesystem workspace.',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: 'Tool input object. Always pass arguments inside this object.',
              properties: {
                code: {
                  type: 'string',
                  description: 'Code to execute. Keep it short and use it for verification, calculation, or small transformations.'
                },
                language: {
                  type: 'string',
                  enum: ['python', 'py', 'javascript', 'js', 'node', 'shell', 'sh', 'bash'],
                  description: 'Runtime language. Supported values: python/py, javascript/js/node, shell/sh/bash.'
                },
                timeout_ms: {
                  type: 'number',
                  minimum: 1,
                  description:
                    'Optional timeout in milliseconds. Defaults to 10000 and cannot exceed 120000.'
                }
              },
              required: ['code', 'language'],
              additionalProperties: false
            }
          },
          required: ['input'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'PowerShell',
        description:
          'Execute a foreground PowerShell command inside the active filesystem workspace. Veloca detects pwsh or powershell from PATH, blocks dangerous commands, and does not support background execution.',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: 'Tool input object. Always pass arguments inside this object.',
              properties: {
                command: {
                  type: 'string',
                  description: 'The PowerShell command to run. Keep it short and explain the purpose before using it.'
                },
                cwd: {
                  type: 'string',
                  description:
                    'Optional working directory. May be relative to the active workspace root or an absolute path inside the active workspace.'
                },
                timeout: {
                  type: 'number',
                  minimum: 1,
                  description:
                    'Optional timeout in milliseconds. Defaults to 10000 and cannot exceed 120000.'
                },
                description: {
                  type: 'string',
                  description: 'Optional short description of why this command is needed.'
                },
                run_in_background: {
                  type: 'boolean',
                  description:
                    'Optional. Background execution is accepted for compatibility but blocked by Veloca Agent.'
                }
              },
              required: ['command'],
              additionalProperties: false
            }
          },
          required: ['input'],
          additionalProperties: false
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_bash_command',
        description:
          'Run a foreground bash command inside the active filesystem workspace. The command is sandboxed, network access is blocked, and writes are limited to the workspace.',
        parameters: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: 'Tool input object. Always pass arguments inside this object.',
              properties: {
                command: {
                  type: 'string',
                  description: 'The bash command to run. Keep it short and explain the purpose before using it.'
                },
                cwd: {
                  type: 'string',
                  description:
                    'Optional working directory. May be relative to the active workspace root or an absolute path inside the active workspace. Use an empty string to run at the workspace root.'
                },
                timeout: {
                  type: 'number',
                  description:
                    'Optional timeout in milliseconds. Defaults to 10000 and cannot exceed 120000.'
                },
                description: {
                  type: 'string',
                  description: 'Optional short description of why this command is needed.'
                }
              },
              required: ['command'],
              additionalProperties: false
            }
          },
          required: ['input'],
          additionalProperties: false
        }
      }
    }
  ];
}

function buildAgentToolRealizers(context?: AgentRuntimeContext, hooks?: AgentRuntimeHooks) {
  return {
    get_workspace_directory_tree: (input?: unknown) =>
      runVisibleAgentTool(
        hooks,
        'get_workspace_directory_tree',
        () => normalizeDirectoryTreeToolInput(input),
        (toolInput) => getWorkspaceDirectoryTree(context, toolInput)
      ),
    glob_search: (inputOrPattern?: unknown, path?: unknown) =>
      runVisibleAgentTool(
        hooks,
        'glob_search',
        () => normalizeGlobSearchToolInput(inputOrPattern, path),
        (toolInput) => globSearchWorkspace(context, toolInput)
      ),
    grep_search: (input?: unknown) =>
      runVisibleAgentTool(
        hooks,
        'grep_search',
        () => normalizeGrepSearchToolInput(input),
        (toolInput) => grepSearchWorkspace(context, toolInput)
      ),
    read_file: (inputOrPath?: unknown, offset?: unknown, limit?: unknown) =>
      runVisibleAgentTool(
        hooks,
        'read_file',
        () => normalizeReadFileToolInput(inputOrPath, offset, limit),
        (toolInput) => readWorkspaceTextFile(context, toolInput)
      ),
    edit_file: (inputOrPath?: unknown, oldString?: unknown, newString?: unknown, replaceAll?: unknown) =>
      runVisibleAgentTool(
        hooks,
        'edit_file',
        () => normalizeEditFileToolInput(inputOrPath, oldString, newString, replaceAll),
        (toolInput) => editWorkspaceTextFile(context, toolInput, hooks)
      ),
    write_file: (inputOrPath?: unknown, content?: unknown) =>
      runVisibleAgentTool(
        hooks,
        'write_file',
        () => normalizeWriteFileToolInput(inputOrPath, content),
        (toolInput) => writeWorkspaceTextFile(context, toolInput, hooks)
      ),
    WebFetch: (inputOrUrl?: unknown, prompt?: unknown) =>
      runVisibleAgentTool(
        hooks,
        'WebFetch',
        () => normalizeWebFetchToolInput(inputOrUrl, prompt),
        (toolInput) => runWebFetch(toolInput)
      ),
    WebSearch: (inputOrQuery?: unknown, allowedDomains?: unknown, blockedDomains?: unknown) =>
      runVisibleAgentTool(
        hooks,
        'WebSearch',
        () => normalizeWebSearchToolInput(inputOrQuery, allowedDomains, blockedDomains),
        (toolInput) => runWebSearch(toolInput)
      ),
    REPL: (inputOrCode?: unknown, language?: unknown, timeoutMs?: unknown) =>
      runVisibleAgentTool(
        hooks,
        'REPL',
        () => normalizeReplToolInput(inputOrCode, language, timeoutMs),
        (toolInput) => runRepl(context, toolInput)
      ),
    PowerShell: (inputOrCommand?: unknown, timeout?: unknown, description?: unknown, runInBackground?: unknown) =>
      runVisibleAgentTool(
        hooks,
        'PowerShell',
        () => normalizePowerShellToolInput(inputOrCommand, timeout, description, runInBackground),
        (toolInput) => runPowerShellCommand(context, toolInput)
      ),
    run_bash_command: (inputOrCommand?: unknown, cwd?: unknown, timeout?: unknown, description?: unknown) =>
      runVisibleAgentTool(
        hooks,
        'run_bash_command',
        () => normalizeBashToolInput(inputOrCommand, cwd, timeout, description),
        (toolInput) => runBashCommand(context, toolInput)
      )
  };
}

function buildSystemPrompt(context?: AgentRuntimeContext): string {
  const replacements = {
    CURRENTTIME: getCurrentLocalTime(),
    CURRENT_FILE_PATH: getContextValue(context?.currentFilePath, 'No active file'),
    WORKSPACE_ROOT_PATH: getContextValue(context?.workspaceRootPath, 'No active workspace'),
    WORKSPACE_TYPE: getWorkspaceType(context)
  };

  return `# Veloca Agent System Prompt

## Identity

- You are **Veloca**, an AI agent built into the Veloca editor.
- Veloca is a platform for system-level document writing, knowledge work, and cognitive assistance.
- Your role is to help users think, write, revise, structure, analyze, and connect information inside their active writing workspace.

## Runtime Context

- **Current local time:** ${replacements.CURRENTTIME}
- **Current file path:** ${replacements.CURRENT_FILE_PATH}
- **Workspace root path:** ${replacements.WORKSPACE_ROOT_PATH}
- **Workspace type:** ${replacements.WORKSPACE_TYPE}

## Language Policy

- Reply in the language used by the user unless the user explicitly requests another language.
- If the user mixes languages, follow the language that best matches the user's direct instruction.
- Keep wording professional, clear, and easy to understand.

## Context Priority

Use information in this priority order:

1. The user's latest prompt.
2. The selected text provided by Veloca, when available.
3. Context you can retrieve from the current file and workspace.
4. Conversation history from the current Agent session.
5. Your general knowledge, only when workspace context is not required or cannot be found.

## Workspace Awareness

- You are working inside one active file and one active workspace.
- For a \`filesystem\` workspace:
  - The workspace root is a real local directory selected by the user.
  - Related context is usually located near the current file or elsewhere under the workspace root.
- For a \`database\` workspace:
  - The workspace root and files are virtual Veloca database paths.
  - Do not assume these paths exist on the local filesystem.
  - Use platform-provided context or tools when they become available.
- If the workspace type is \`none\`, no active workspace metadata is available for this request.

## Selected Text

- Veloca may provide text selected by the user when the Agent is invoked.
- Treat selected text as highly relevant context for the user's question.
- The selected text may be a paragraph, code block, heading section, partial sentence, table content, or mixed Markdown.
- Do not assume selected text is the whole document.

## Context-Seeking Behavior

- Base your answer on the user's prompt and available workspace context.
- When the user asks about content that likely depends on files in the workspace, look for relevant context before answering.
- Prefer context from the active file and nearby workspace files over broad assumptions.
- If necessary context cannot be found, ask the user a focused follow-up question instead of inventing details.

<tools-use-demo>

- If tools are available, use them to inspect the current file, nearby files, or workspace search results when the user request depends on local context.
- When calling Veloca workspace tools, pass arguments inside the required \`input\` object.
- When describing tool activity to the user, use natural action wording such as "I read the file" or "I ran the command" instead of raw tool names.
- Use \`get_workspace_directory_tree\` to inspect the active workspace structure before making claims about available folders or files.
- When calling \`get_workspace_directory_tree\`, pass a \`velocaignore\` string only when you need extra temporary ignore patterns beyond Veloca defaults and the workspace \`.velocaignore\` file.
- Use \`glob_search\` to find files by name or extension before reading them. It supports patterns like \`**/*.md\` and \`**/*.{ts,tsx}\`, honors Veloca ignore rules, and returns at most 100 file paths.
- Use \`grep_search\` to search text contents across workspace files. Use \`glob\`, \`path\`, or \`type\` to narrow the search before reading content, and use \`output_mode: "content"\` when matching lines are needed.
- Use \`read_file\` to read a known text file from the active workspace. Use \`offset\` and \`limit\` when reading large files or when you only need a specific section.
- Do not claim that you read an entire file when you only read a line window.
- Use \`edit_file\` for precise replacements in existing text files. Provide an exact \`old_string\`, use \`replace_all\` only when every occurrence should change, and read the file first when you are unsure of the current content.
- Use \`write_file\` only when the user clearly asks you to create, replace, or save a workspace file. It replaces the full file content, supports filesystem and database workspaces, and is limited to the active workspace.
- Prefer \`edit_file\` over \`write_file\` for targeted changes. Before using \`write_file\`, read the relevant existing file first when updating a file and explain the intended write in your response. Do not use it for speculative drafts when a normal answer would be enough.
- Use \`WebFetch\` when the user provides a URL that needs to be opened, inspected, summarized, or used as evidence. It fetches one URL, converts HTML to readable text, and answers a prompt about that page.
- If a URL appears in the user request and the answer depends on its content, call \`WebFetch\` before making claims about the linked page. Do not claim that you opened, read, or verified a URL unless \`WebFetch\` returned a tool result.
- Use \`WebSearch\` when the user enables Web Search or asks for current external information that is likely outside the workspace. Use \`allowed_domains\` or \`blocked_domains\` when the user asks to include or avoid specific sources.
- Treat \`WebSearch\` results as source candidates, not as guaranteed truth. Cite the returned URLs in a Sources section when web results inform the answer.
- Do not claim that you searched the web unless \`WebSearch\` returned a tool result for this request.
- Use \`REPL\` for short, bounded Python, JavaScript/Node.js, or shell snippets when execution is useful for verification, calculation, or small transformations. It is filesystem-workspace-only, sandboxed, and network access is blocked.
- Do not use \`REPL\` for long-running services, dependency installation, broad file edits, destructive operations, or tasks that should be handled by \`read_file\`, \`edit_file\`, \`write_file\`, or \`run_bash_command\`.
- Do not claim that REPL code succeeded unless the tool result reports success. If the requested runtime is unavailable or unsupported, report that clearly.
- Use \`PowerShell\` only when the user explicitly asks for PowerShell or when PowerShell-specific behavior is necessary. It is foreground-only, filesystem-workspace-only, and background execution is blocked.
- For \`PowerShell\`, prefer the \`cwd\` argument over changing directories inside the command. Do not use dangerous, destructive, privileged, background, or network-dependent PowerShell commands.
- Do not claim that a PowerShell command succeeded unless the tool result reports success. If \`pwsh\` or \`powershell\` is unavailable, report that clearly.
- Use \`run_bash_command\` only when a shell command is necessary to inspect, verify, build, or make a workspace-local change.
- When the user explicitly asks you to run a safe shell command, call \`run_bash_command\` instead of saying you cannot execute commands.
- For \`run_bash_command\`, prefer the \`cwd\` argument over putting \`cd ...\` in the command. \`cwd\` may be workspace-relative or an absolute path inside the active workspace.
- Before running a bash command, briefly state why the command is needed. Prefer read-only inspection commands before write commands.
- Do not run dangerous, destructive, privileged, background, or network-dependent commands. Network access is blocked in the bash sandbox.
- Do not claim that a bash command succeeded unless the tool result reports success.
- Use tools before making claims about project-specific structure, terminology, requirements, or prior decisions.
- Do not claim that you searched, opened, read, or verified files unless the provided context or tools actually support that claim.

</tools-use-demo>

## Answer Style

- Be concise, direct, and useful.
- Preserve Markdown structure when editing or generating document content.
- When giving revisions, prefer ready-to-use text over abstract advice.
- When explaining, separate conclusions from assumptions.
- If the user asks for a rewrite, provide the rewritten result first, then brief notes only when helpful.`;
}

function isDirectBashCommandRequest(prompt: string): boolean {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, ' ');

  if (!normalizedPrompt) {
    return false;
  }

  return (
    /(?:^|[\s,，。；;：:]|请|请你|帮我|帮忙|麻烦你?)(?:运行|执行|跑一下|跑下)\s*(?:一下|下)?\s*(?:命令)?\s*[:：`"']?\s*[\w./~-]+/i.test(normalizedPrompt) ||
    /(?:^|[\s,，。；;：:])(?:run|execute)\s+(?:the\s+)?(?:command\s+)?[`"']?[\w./~-]+/i.test(normalizedPrompt)
  );
}

function isDirectPowerShellCommandRequest(prompt: string): boolean {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, ' ');

  if (!normalizedPrompt) {
    return false;
  }

  return /\b(powershell|pwsh)\b/i.test(normalizedPrompt);
}

function hasUrlInPrompt(prompt: string): boolean {
  return /https?:\/\/[^\s<>"')\]]+/i.test(prompt);
}

function isDirectWebSearchRequest(prompt: string): boolean {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, ' ');

  if (!normalizedPrompt) {
    return false;
  }

  return (
    /\b(web search|search the web|search online|look up online)\b/i.test(normalizedPrompt) ||
    /(?:联网|网络|网页|网上|互联网).{0,16}(?:搜索|查询|查找|查一下|检索)/.test(normalizedPrompt) ||
    /(?:搜索|查询|查一下|检索).{0,16}(?:联网|网络|网页|网上|互联网)/.test(normalizedPrompt)
  );
}

function isDirectReplExecutionRequest(prompt: string): boolean {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, ' ');

  if (!normalizedPrompt) {
    return false;
  }

  return (
    /\bREPL\b/i.test(normalizedPrompt) ||
    /(?:运行|执行|跑一下|跑下|run|execute).{0,40}\b(python|py|javascript|js|node)\b/i.test(normalizedPrompt) ||
    /\b(python|py|javascript|js|node)\b.{0,40}(?:运行|执行|跑一下|跑下|run|execute)/i.test(normalizedPrompt)
  );
}

function buildUserPrompt(prompt: string, request: AgentSendMessageRequest): string {
  const metadata: string[] = [];
  const context = request.context;
  const selectedText = context?.selectedText?.trim();

  metadata.push(
    [
      '<veloca-runtime-context>',
      `- Current file path: ${getContextValue(context?.currentFilePath, 'No active file')}`,
      `- Workspace root path: ${getContextValue(context?.workspaceRootPath, 'No active workspace')}`,
      `- Workspace type: ${getWorkspaceType(context)}`,
      '</veloca-runtime-context>'
    ].join('\n')
  );

  if (selectedText) {
    metadata.push(['<selected-text>', selectedText, '</selected-text>'].join('\n'));
  }

  if (request.attachments?.length) {
    const attachmentList = request.attachments
      .map((attachment) => `- ${attachment.name} (${attachment.mimeType || 'unknown'}, ${attachment.status})`)
      .join('\n');

    metadata.push(`<attachments>\n${attachmentList}\n</attachments>`);
  }

  if (request.webSearch || isDirectWebSearchRequest(prompt)) {
    metadata.push(
      [
        '<tool-routing-hint>',
        '- The user enabled Web Search or explicitly asked for web search.',
        '- If current external information is useful, call `WebSearch` with arguments inside the required `input` object.',
        '- Do not say that web search is unavailable before trying the tool.',
        '- If web results inform the final answer, include a Sources section with returned URLs.',
        '- If the tool is unavailable, blocked, or returns no useful results, report that clearly.',
        '</tool-routing-hint>'
      ].join('\n')
    );
  }

  if (hasUrlInPrompt(prompt)) {
    metadata.push(
      [
        '<tool-routing-hint>',
        '- The user message contains at least one URL.',
        '- If answering requires the linked content, call `WebFetch` with arguments inside the required `input` object before making claims about the page.',
        '- Use the user request as the `prompt` for `WebFetch`, or ask a concise question about the page when the user intent is unclear.',
        '- If WebFetch fails, report the tool result clearly instead of inventing page content.',
        '</tool-routing-hint>'
      ].join('\n')
    );
  }

  if (isDirectPowerShellCommandRequest(prompt)) {
    metadata.push(
      [
        '<tool-routing-hint>',
        '- The user is explicitly asking for PowerShell.',
        '- If the command is safe and the active workspace is a filesystem workspace, call `PowerShell` with arguments inside the required `input` object.',
        '- Do not say that you cannot execute PowerShell before trying the tool for a safe command.',
        '- If the tool is unavailable, blocked, or returns an error, report that tool result clearly.',
        '</tool-routing-hint>'
      ].join('\n')
    );
  } else if (isDirectReplExecutionRequest(prompt)) {
    metadata.push(
      [
        '<tool-routing-hint>',
        '- The user is explicitly asking to execute a short code snippet.',
        '- If the code is safe and the active workspace is a filesystem workspace, call `REPL` with arguments inside the required `input` object.',
        '- Do not say that you cannot execute code before trying the tool for a safe, bounded snippet.',
        '- If the tool is unavailable, blocked, or returns an error, report that tool result clearly.',
        '</tool-routing-hint>'
      ].join('\n')
    );
  } else if (isDirectBashCommandRequest(prompt)) {
    metadata.push(
      [
        '<tool-routing-hint>',
        '- The user is explicitly asking you to run a shell command.',
        '- If the command is safe and the active workspace is a filesystem workspace, call `run_bash_command` with arguments inside the required `input` object.',
        '- Do not say that you cannot execute commands before trying the tool for a safe command.',
        '- If the tool is unavailable, blocked, or returns an error, report that tool result clearly.',
        '</tool-routing-hint>'
      ].join('\n')
    );
  }

  if (!metadata.length) {
    return prompt;
  }

  return `${metadata.join('\n\n')}\n\n用户问题：\n${prompt}`;
}

function readAgentStorageData(): StoredAgentStorageData {
  if (!existsSync(agentStorageFilePath)) {
    return { sessions: [] };
  }

  try {
    const data = JSON.parse(readFileSync(agentStorageFilePath, 'utf-8')) as StoredAgentStorageData;

    return {
      sessions: Array.isArray(data.sessions) ? data.sessions : []
    };
  } catch {
    return { sessions: [] };
  }
}

function writeAgentStorageData(data: StoredAgentStorageData): void {
  if (!existsSync(agentStorageDirectory)) {
    mkdirSync(agentStorageDirectory, { recursive: true });
  }

  writeFileSync(agentStorageFilePath, JSON.stringify(data, null, 2), 'utf-8');
}

function writeAgentEntry(options: {
  content: string;
  reasoningContent?: string;
  role: string;
  sessionId: string;
  tokenConsumption?: number;
  tools?: unknown;
}): void {
  const storageData = readAgentStorageData();
  const sessions = storageData.sessions ?? [];
  let session = sessions.find((candidate) => candidate.session_id === options.sessionId);
  const now = new Date().toISOString();

  if (!session) {
    session = {
      compacted_entries: [],
      create_at: now,
      entries: [],
      session_id: options.sessionId,
      status: 0
    };
    sessions.push(session);
  }

  const entry: StoredAgentEntry = {
    content: options.content,
    create_at: now,
    entry_id: randomUUID(),
    role: options.role
  };

  if (options.tools !== undefined && options.tools !== null) {
    entry.tools = options.tools;
  }

  if (options.tokenConsumption !== undefined) {
    entry.token_consumption = options.tokenConsumption;
  }

  if (options.reasoningContent) {
    entry.reasoning_content = options.reasoningContent;
  }

  session.entries = Array.isArray(session.entries) ? session.entries : [];
  session.entries.push(entry);
  storageData.sessions = sessions;
  writeAgentStorageData(storageData);
}

function getStoredSessionEntries(sessionId: string): StoredAgentEntry[] {
  const storageData = readAgentStorageData();
  const session = storageData.sessions?.find((candidate) => candidate.session_id === sessionId && candidate.status !== 1);

  return Array.isArray(session?.entries) ? session.entries : [];
}

function getReasoningAwareMessages(messages: unknown, sessionId: string): unknown {
  if (!Array.isArray(messages)) {
    return messages;
  }

  return attachStoredReasoningToMessages(messages, getStoredSessionEntries(sessionId));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOpenAiAgentResponse(response: unknown): {
  content: string;
  reasoningContent?: string;
  role: string;
  tokenConsumption: number;
  tools: { tool_calls: unknown[] } | null;
} {
  if (!isRecord(response) || !Array.isArray(response.choices) || !response.choices[0]) {
    throw new Error('Invalid OpenAI response format: missing choices');
  }

  const choice = response.choices[0];
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : {};
  const usage = isRecord(response.usage) ? response.usage : {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  return {
    content: typeof message.content === 'string' ? message.content : '',
    reasoningContent: typeof message.reasoning_content === 'string' ? message.reasoning_content : undefined,
    role: typeof message.role === 'string' ? message.role : 'assistant',
    tokenConsumption: typeof usage.total_tokens === 'number' ? usage.total_tokens : 0,
    tools: toolCalls.length > 0 ? { tool_calls: toolCalls } : null
  };
}

function getStreamReasoningDelta(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') {
    return '';
  }

  const choices = (chunk as { choices?: Array<{ delta?: { reasoning_content?: unknown } }> }).choices;
  const reasoningContent = choices?.[0]?.delta?.reasoning_content;

  return typeof reasoningContent === 'string' ? reasoningContent : '';
}

function getStreamRoleDelta(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') {
    return '';
  }

  const choices = (chunk as { choices?: Array<{ delta?: { role?: unknown } }> }).choices;
  const role = choices?.[0]?.delta?.role;

  return typeof role === 'string' ? role : '';
}

function getStreamToolCallsDelta(chunk: unknown): Array<{
  function?: {
    arguments?: unknown;
    name?: unknown;
  };
  id?: unknown;
  index?: unknown;
  type?: unknown;
}> {
  if (!chunk || typeof chunk !== 'object') {
    return [];
  }

  const choices = (chunk as { choices?: Array<{ delta?: { tool_calls?: unknown } }> }).choices;
  const toolCalls = choices?.[0]?.delta?.tool_calls;

  return Array.isArray(toolCalls) ? toolCalls : [];
}

function getChunkTokenConsumption(chunk: unknown): number {
  if (!isRecord(chunk) || !isRecord(chunk.usage)) {
    return 0;
  }

  return typeof chunk.usage.total_tokens === 'number' ? chunk.usage.total_tokens : 0;
}

function accumulateStreamToolCalls(
  toolCalls: Array<{
    function: {
      arguments: string;
      name: string;
    };
    id: string;
    type: string;
  }>,
  deltaToolCalls: ReturnType<typeof getStreamToolCallsDelta>
): void {
  for (const toolCall of deltaToolCalls) {
    const index = typeof toolCall.index === 'number' ? toolCall.index : toolCalls.length;

    if (!toolCalls[index]) {
      toolCalls[index] = {
        function: {
          arguments: '',
          name: ''
        },
        id: '',
        type: 'function'
      };
    }

    if (typeof toolCall.id === 'string') {
      toolCalls[index].id = toolCall.id;
    }

    if (typeof toolCall.type === 'string') {
      toolCalls[index].type = toolCall.type;
    }

    if (typeof toolCall.function?.name === 'string') {
      toolCalls[index].function.name += toolCall.function.name;
    }

    if (typeof toolCall.function?.arguments === 'string') {
      toolCalls[index].function.arguments += toolCall.function.arguments;
    }
  }
}

async function writeToolResults(
  sessionId: string,
  toolCalls: unknown[],
  toolsRealize: Record<string, unknown> | undefined
): Promise<void> {
  const realizedTools = (toolsRealize || {}) as Parameters<typeof veloca.ProcessTools>[1];
  const toolResults = await veloca.ProcessTools(toolCalls, realizedTools);

  for (const toolResult of toolResults) {
    const resultContent = JSON.stringify(toolResult.result ?? toolResult.error);
    writeAgentEntry({
      content: resultContent,
      role: 'tool',
      sessionId,
      tools: {
        error: toolResult.error,
        function_name: toolResult.function_name,
        result: toolResult.result,
        tool_call_id: toolResult.tool_call_id
      }
    });
  }
}

function getAgentRuntimeOptions(request: AgentSendMessageRequest, stream: boolean, hooks?: AgentRuntimeHooks) {
  const prompt = validateRequest(request);
  const workspaceScope = getAgentSessionWorkspaceScope(request.context);
  assertAgentSessionBelongsToWorkspace(request.sessionId, workspaceScope);
  // Priority: UI settings > .env vars > hardcoded defaults
  const uiApiKey = getAiApiKey();
  const uiBaseUrl = getAiBaseUrl();
  const uiModel = getAiModel();
  const uiContextWindow = getAiContextWindow();

  loadLocalEnv();

  const apiKey = uiApiKey
    || process.env.VELOCA_AGENT_API_KEY?.trim()
    || (() => { throw new Error('VELOCA_AGENT_API_KEY is required. Configure it in Settings > AI Model or the .env file.'); })();

  const baseUrl = uiBaseUrl
    || process.env.VELOCA_AGENT_BASE_URL?.trim()
    || defaultAgentBaseUrl;

  const model = uiModel
    || process.env.VELOCA_AGENT_MODEL?.trim()
    || defaultAgentModel;

  const contextWindow = (uiContextWindow != null && uiContextWindow > 0)
    ? uiContextWindow
    : getNumberEnv('VELOCA_AGENT_CONTEXT_WINDOW', defaultContextWindow);

  return {
    ai: {
      apiKey,
      baseUrl,
      model,
      provider: 'openai' as const,
      stream,
      systemPrompt: buildSystemPrompt(request.context),
      temperature: 0.4,
      toolChoice: 'auto' as const,
      tools: buildAgentTools(),
      tools_realize: buildAgentToolRealizers(request.context, hooks),
      parallelToolCalls: false,
      userPrompt: buildUserPrompt(prompt, request)
    },
    input: {
      contextLoadType: 'localfile' as const,
      contextWindow,
      maxIterations: 8,
      sessionId: request.sessionId,
      storageType: 'localfile' as const,
      thresholdPercentage: 0.8
    },
    model
  };
}

function getStreamDelta(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') {
    return '';
  }

  const choices = (chunk as { choices?: Array<{ delta?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.delta?.content;

  return typeof content === 'string' ? content : '';
}

function getChunkTextContent(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') {
    return '';
  }

  const content = (chunk as { content?: unknown }).content;

  return typeof content === 'string' ? content : '';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Agent request failed.';
}

function getStoredSessionId(session: StoredAgentSessionSummary): string {
  return typeof session.session_id === 'string' ? session.session_id : '';
}

function getStoredTimestamp(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : new Date(0).toISOString();
}

function getStoredEntryContent(entry: StoredAgentEntry): string {
  return typeof entry.content === 'string' ? entry.content : '';
}

function getStoredEntryId(entry: StoredAgentEntry, fallback: string): string {
  return typeof entry.entry_id === 'string' && entry.entry_id.trim() ? entry.entry_id : fallback;
}

function getDisplayPrompt(content: string): string {
  const metadataSeparator = '\n\n用户问题：\n';
  const separatorIndex = content.lastIndexOf(metadataSeparator);

  if (separatorIndex < 0) {
    return content;
  }

  return content.slice(separatorIndex + metadataSeparator.length).trim();
}

function sortStoredSessions(sessions: StoredAgentSessionSummary[]): StoredAgentSessionSummary[] {
  return [...sessions]
    .filter((session) => getStoredSessionId(session) && Number(session.status ?? 0) !== 1)
    .sort((left, right) => getStoredTimestamp(left.create_at).localeCompare(getStoredTimestamp(right.create_at)));
}

function mapStoredEntriesToConversations(sessionId: string, entries: StoredAgentEntry[]): AgentStoredConversation[] {
  const conversations: AgentStoredConversation[] = [];

  for (const [index, entry] of entries.entries()) {
    const role = typeof entry.role === 'string' ? entry.role : '';
    const content = getStoredEntryContent(entry);

    if (role === 'user') {
      conversations.push({
        answer: '',
        attachments: [],
        id: getStoredEntryId(entry, `${sessionId}-message-${index}`),
        model: 'lite',
        prompt: getDisplayPrompt(content),
        status: 'complete',
        webSearch: false
      });
      continue;
    }

    if (role === 'assistant' && conversations.length > 0) {
      const latestConversation = conversations[conversations.length - 1];
      latestConversation.answer = latestConversation.answer ? `${latestConversation.answer}\n\n${content}` : content;
    }
  }

  return conversations.filter((conversation) => conversation.prompt.trim() || conversation.answer.trim());
}

function readStoredSession(sessionId: string, displayIndex: number): AgentStoredSession {
  const sessionData = veloca.ReadSessionData(sessionId) as StoredAgentSessionData;
  const messages = mapStoredEntriesToConversations(sessionId, sessionData.entries ?? []);

  return {
    id: sessionId,
    messages,
    name: `Session ${displayIndex + 1}`
  };
}

function readStoredSessionSummaries(): StoredAgentSessionSummary[] {
  const sessions = veloca.GetAllSessions() as StoredAgentSessionSummary[];

  return sortStoredSessions(Array.isArray(sessions) ? sessions : []);
}

function getSessionsForWorkspace(scope: AgentSessionWorkspaceScope): StoredAgentSessionSummary[] {
  const workspaceSessionIds = new Set(
    readAgentSessionWorkspaceRecords()
      .filter((record) => getStoredWorkspaceRecordKey(record) === scope.workspaceKey)
      .map((record) => getStoredWorkspaceRecordSessionId(record))
      .filter(Boolean)
  );

  return readStoredSessionSummaries().filter((session) => workspaceSessionIds.has(getStoredSessionId(session)));
}

async function prepareAgentMessages(
  input: ReturnType<typeof getAgentRuntimeOptions>['input'],
  ai: ReturnType<typeof getAgentRuntimeOptions>['ai']
): Promise<void> {
  veloca.CombineTools(ai);
  const messages = await veloca.CombineContext({
    ai,
    contextWindow: input.contextWindow,
    loadType: input.contextLoadType,
    provider: ai.provider,
    sessionId: input.sessionId,
    systemPrompt: ai.systemPrompt,
    thresholdPercentage: input.thresholdPercentage,
    tools: ai.tools
  });

  (ai as { messages?: unknown }).messages = getReasoningAwareMessages(messages, input.sessionId);
}

async function invokeReasoningAwareAgent(
  input: ReturnType<typeof getAgentRuntimeOptions>['input'],
  ai: ReturnType<typeof getAgentRuntimeOptions>['ai']
): Promise<{
  content: string;
  reasoningContent?: string;
  role: string;
  tokenConsumption: number;
  tools: { tool_calls: unknown[] } | null;
}> {
  if (ai.userPrompt) {
    writeAgentEntry({
      content: ai.userPrompt,
      role: 'user',
      sessionId: input.sessionId
    });
  }

  const maxIterations = input.maxIterations || 999999;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    await prepareAgentMessages(input, ai);
    const response = await veloca.InvokeModel(ai);
    const parsedResponse = parseOpenAiAgentResponse(response);

    writeAgentEntry({
      content: parsedResponse.content,
      reasoningContent: parsedResponse.reasoningContent,
      role: parsedResponse.role,
      sessionId: input.sessionId,
      tokenConsumption: parsedResponse.tokenConsumption,
      tools: parsedResponse.tools
    });

    if (parsedResponse.tools?.tool_calls.length) {
      await writeToolResults(input.sessionId, parsedResponse.tools.tool_calls, ai.tools_realize);
      await sleep(1500);
      continue;
    }

    return parsedResponse;
  }

  throw new Error(`Agent循环次数超过限制(${maxIterations}次)，可能陷入无限循环`);
}

async function* streamReasoningAwareAgent(
  input: ReturnType<typeof getAgentRuntimeOptions>['input'],
  ai: ReturnType<typeof getAgentRuntimeOptions>['ai']
): AsyncGenerator<unknown, void, unknown> {
  if (ai.userPrompt) {
    writeAgentEntry({
      content: ai.userPrompt,
      role: 'user',
      sessionId: input.sessionId
    });
  }

  const maxIterations = input.maxIterations || 999999;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    try {
      await prepareAgentMessages(input, ai);
      const response = await veloca.InvokeModel(ai);

      if (!response || typeof response[Symbol.asyncIterator] !== 'function') {
        const parsedResponse = parseOpenAiAgentResponse(response);
        writeAgentEntry({
          content: parsedResponse.content,
          reasoningContent: parsedResponse.reasoningContent,
          role: parsedResponse.role,
          sessionId: input.sessionId,
          tokenConsumption: parsedResponse.tokenConsumption,
          tools: parsedResponse.tools
        });
        yield {
          ...parsedResponse,
          type: 'complete',
          content: parsedResponse.content
        };
        return;
      }

      let fullContent = '';
      let reasoningContent = '';
      let role = 'assistant';
      let tokenConsumption = 0;
      const toolCalls: Array<{
        function: {
          arguments: string;
          name: string;
        };
        id: string;
        type: string;
      }> = [];

      for await (const chunk of response) {
        yield chunk;

        const roleDelta = getStreamRoleDelta(chunk);
        const contentDelta = getStreamDelta(chunk);
        const reasoningDelta = getStreamReasoningDelta(chunk);
        const chunkTokens = getChunkTokenConsumption(chunk);

        if (roleDelta) {
          role = roleDelta;
        }

        if (contentDelta) {
          fullContent += contentDelta;
        }

        if (reasoningDelta) {
          reasoningContent += reasoningDelta;
        }

        if (chunkTokens > 0) {
          tokenConsumption = chunkTokens;
        }

        accumulateStreamToolCalls(toolCalls, getStreamToolCallsDelta(chunk));
      }

      const tools = toolCalls.length > 0 ? { tool_calls: toolCalls } : null;
      writeAgentEntry({
        content: fullContent,
        reasoningContent,
        role,
        sessionId: input.sessionId,
        tokenConsumption,
        tools
      });

      if (tools?.tool_calls.length) {
        const toolCallsInfo = tools.tool_calls
          .map((toolCall) => `${toolCall.function.name}(${toolCall.function.arguments})`)
          .join(', ');

        yield {
          content: `[tool_calls:${toolCallsInfo}]`,
          type: 'tool_calls'
        };

        await writeToolResults(input.sessionId, tools.tool_calls, ai.tools_realize);
        await sleep(1500);
        continue;
      }

      return;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      yield {
        content: `[error:${errorMessage}]`,
        error: errorMessage,
        type: 'error'
      };
      throw error;
    }
  }

  const errorMessage = `Agent循环次数超过限制(${maxIterations}次)，可能陷入无限循环`;
  yield {
    content: `[error:${errorMessage}]`,
    error: errorMessage,
    type: 'error'
  };
  throw new Error(errorMessage);
}

export function inheritAgentSessions(
  sourceContext: AgentRuntimeContext | undefined,
  targetContext: AgentRuntimeContext | undefined
): AgentInheritSessionsResult {
  const sourceScope = getAgentSessionWorkspaceScope(sourceContext);
  const targetScope = getAgentSessionWorkspaceScope(targetContext);

  if (sourceScope.workspaceType !== 'none') {
    throw new Error('Only standalone brainstorm Agent sessions can be inherited.');
  }

  if (targetScope.workspaceType === 'none') {
    throw new Error('A saved workspace root is required to inherit Agent sessions.');
  }

  const records = readAgentSessionWorkspaceRecords();
  let movedSessions = 0;
  const now = new Date().toISOString();
  const nextRecords = records.map((record) => {
    if (getStoredWorkspaceRecordKey(record) !== sourceScope.workspaceKey) {
      return record;
    }

    movedSessions += 1;

    return {
      ...record,
      updated_at: now,
      workspace_key: targetScope.workspaceKey,
      workspace_root_path: targetScope.workspaceRootPath,
      workspace_type: targetScope.workspaceType
    };
  });

  if (movedSessions > 0) {
    writeAgentSessionWorkspaceRecords(nextRecords);
  }

  return { movedSessions };
}

export function createAgentSession(context?: AgentRuntimeContext): AgentStoredSession {
  const scope = getAgentSessionWorkspaceScope(context);
  const sessionId = veloca.CreateNewSession();
  upsertAgentSessionWorkspaceRecord(sessionId, scope);

  const sessions = getSessionsForWorkspace(scope);
  const sessionIndex = Math.max(
    0,
    sessions.findIndex((session) => getStoredSessionId(session) === sessionId)
  );

  return readStoredSession(sessionId, sessionIndex);
}

export function listAgentSessions(context?: AgentRuntimeContext): AgentStoredSession[] {
  const scope = getAgentSessionWorkspaceScope(context);
  const sessions = getSessionsForWorkspace(scope);

  if (sessions.length === 0) {
    return [createAgentSession(context)];
  }

  return sessions.map((session, index) => readStoredSession(getStoredSessionId(session), index));
}

export async function sendAgentMessage(
  request: AgentSendMessageRequest,
  hooks?: AgentRuntimeHooks
): Promise<AgentSendMessageResponse> {
  const { ai, input, model } = getAgentRuntimeOptions(request, false, hooks);

  const response = await invokeReasoningAwareAgent(input, ai);

  return {
    answer: response.content,
    model,
    sessionId: request.sessionId
  };
}

export async function streamAgentMessage(
  request: AgentSendMessageRequest,
  emit: (event: AgentStreamEvent) => void,
  hooks?: AgentRuntimeHooks
): Promise<void> {
  let model = defaultAgentModel;

  try {
    const streamHooks: AgentRuntimeHooks = {
      ...hooks,
      onToolCallItem: (toolCall) => {
        hooks?.onToolCallItem?.(toolCall);
        emit({
          model,
          sessionId: request.sessionId,
          toolCall,
          type: 'tool_call'
        });
      }
    };
    const options = getAgentRuntimeOptions(request, true, streamHooks);
    model = options.model;

    const stream = streamReasoningAwareAgent(options.input, options.ai);

    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
      throw new Error('Veloca Agent did not return a stream.');
    }

    let answer = '';

    for await (const chunk of stream) {
      const chunkType = chunk && typeof chunk === 'object' ? (chunk as { type?: unknown }).type : null;

      if (chunkType === 'error') {
        const message = getChunkTextContent(chunk) || getErrorMessage((chunk as { error?: unknown }).error);
        throw new Error(message);
      }

      if (chunkType === 'tool_calls') {
        emit({
          content: getChunkTextContent(chunk),
          model,
          sessionId: request.sessionId,
          type: 'tool_calls'
        });
        continue;
      }

      const delta = getStreamDelta(chunk) || (chunkType === 'complete' ? getChunkTextContent(chunk) : '');

      if (!delta) {
        continue;
      }

      answer += delta;
      emit({
        content: delta,
        model,
        sessionId: request.sessionId,
        type: 'delta'
      });
    }

    emit({
      answer,
      model,
      sessionId: request.sessionId,
      type: 'complete'
    });
  } catch (error) {
    emit({
      error: getErrorMessage(error),
      model,
      sessionId: request.sessionId,
      type: 'error'
    });
  }
}
