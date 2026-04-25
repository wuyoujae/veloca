import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { veloca } from 'otherone-agent';
import { getDatabase } from '../database/connection';
import { getWorkspaceSnapshot, readMarkdownFile, type WorkspaceSnapshot, type WorkspaceTreeNode } from './workspace-service';

export type AgentUiModel = 'lite' | 'pro' | 'ultra';

export interface AgentAttachmentSummary {
  mimeType: string;
  name: string;
  status: string;
}

export type AgentWorkspaceType = 'database' | 'filesystem' | 'none';

export interface AgentRuntimeContext {
  currentFilePath?: string;
  selectedText?: string;
  workspaceRootPath?: string;
  workspaceType?: AgentWorkspaceType;
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

export type AgentStreamEvent =
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

const defaultAgentBaseUrl = 'https://openrouter.ai/api/v1';
const defaultAgentModel = 'google/gemini-3.1-flash-lite-preview';
const defaultContextWindow = 128000;
const bashDefaultTimeoutMs = 10000;
const bashMaxCommandLength = 2000;
const bashMaxOutputBytes = 16384;
const bashMaxTimeoutMs = 120000;
const bashSandboxExecPath = '/usr/bin/sandbox-exec';
const maxDirectoryTreeCharacters = 30000;
const maxDirectoryTreeDepth = 8;
const maxDirectoryTreeNodes = 1200;
const maxPromptLength = 20000;
const maxReadFileBytes = 10 * 1024 * 1024;
const maxWriteFileBytes = 10 * 1024 * 1024;
const readFileBinarySampleBytes = 8192;
const agentStorageDirectory = join(process.cwd(), '.veloca', 'storage');
const agentSessionWorkspaceIndexPath = join(agentStorageDirectory, 'veloca-session-workspaces.json');
let envLoaded = false;

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
  role?: unknown;
}

interface StoredAgentSessionData {
  entries?: StoredAgentEntry[];
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

interface OutputBuffer {
  bytes: number;
  chunks: Buffer[];
  truncated: boolean;
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

function getAgentSessionWorkspaceScope(context?: AgentRuntimeContext): AgentSessionWorkspaceScope {
  const workspaceType = getWorkspaceType(context);
  const requestedRootPath = context?.workspaceRootPath?.trim();

  if (workspaceType === 'none') {
    return {
      workspaceKey: 'none',
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

function normalizeDirectoryTreeToolInput(first: unknown): string | undefined {
  const input = unwrapToolInput(first);
  const velocaignore = isRecord(input) ? input.velocaignore : input;

  return typeof velocaignore === 'string' ? velocaignore : undefined;
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

function resolveFilesystemReadPath(workspaceRootPath: string, path: string): string {
  const canonicalRoot = realpathSync(workspaceRootPath);
  const candidatePath = isAbsolute(path) ? path : resolve(canonicalRoot, path);
  const resolvedPath = realpathSync(candidatePath);
  const stats = statSync(resolvedPath);

  if (!isSameOrChildPath(canonicalRoot, resolvedPath)) {
    throw new Error(`path ${resolvedPath} escapes workspace boundary ${canonicalRoot}`);
  }

  if (!stats.isFile()) {
    throw new Error('read_file path must point to a file.');
  }

  ensureReadableTextContentSize(resolvedPath, stats.size);

  return resolvedPath;
}

function readFilesystemTextFile(workspaceRootPath: string, input: ReadFileInput): ReadFileOutput {
  const resolvedPath = resolveFilesystemReadPath(workspaceRootPath, input.path);
  const buffer = readFileSync(resolvedPath);
  const sample = buffer.subarray(0, readFileBinarySampleBytes);

  if (sample.includes(0)) {
    throw new Error('file appears to be binary');
  }

  return createReadFileOutput(resolvedPath, buffer.toString('utf8'), input.offset, input.limit);
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

function resolveDatabaseReadNode(rootNode: WorkspaceTreeNode, path: string): WorkspaceTreeNode {
  const node = path.startsWith('veloca-db://entry/')
    ? findWorkspaceTreeNodeByPath(rootNode, path)
    : findWorkspaceTreeNodeByRelativePath(rootNode, path);

  if (!node) {
    throw new Error('Database file is not inside the active workspace.');
  }

  if (node.type !== 'file') {
    throw new Error('read_file path must point to a database file.');
  }

  return node;
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
      getWorkspaceDirectoryTree(context, normalizeDirectoryTreeToolInput(input)),
    read_file: (inputOrPath?: unknown, offset?: unknown, limit?: unknown) =>
      readWorkspaceTextFile(context, normalizeReadFileToolInput(inputOrPath, offset, limit)),
    write_file: (inputOrPath?: unknown, content?: unknown) =>
      writeWorkspaceTextFile(context, normalizeWriteFileToolInput(inputOrPath, content), hooks),
    run_bash_command: (inputOrCommand?: unknown, cwd?: unknown, timeout?: unknown, description?: unknown) =>
      runBashCommand(context, normalizeBashToolInput(inputOrCommand, cwd, timeout, description))
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
- Use \`get_workspace_directory_tree\` to inspect the active workspace structure before making claims about available folders or files.
- When calling \`get_workspace_directory_tree\`, pass a \`velocaignore\` string only when you need extra temporary ignore patterns beyond Veloca defaults and the workspace \`.velocaignore\` file.
- Use \`read_file\` to read a known text file from the active workspace. Use \`offset\` and \`limit\` when reading large files or when you only need a specific section.
- Do not claim that you read an entire file when you only read a line window.
- Use \`write_file\` only when the user clearly asks you to create, replace, or save a workspace file. It replaces the full file content, supports filesystem and database workspaces, and is limited to the active workspace.
- Before using \`write_file\`, read the relevant existing file first when updating a file and explain the intended write in your response. Do not use it for speculative drafts when a normal answer would be enough.
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

  if (request.webSearch) {
    metadata.push('用户开启了 Web Search 开关，但当前 Veloca 版本尚未接入实时网页搜索工具；不要声称已经联网搜索。');
  }

  if (isDirectBashCommandRequest(prompt)) {
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

function getAgentRuntimeOptions(request: AgentSendMessageRequest, stream: boolean, hooks?: AgentRuntimeHooks) {
  const prompt = validateRequest(request);
  const workspaceScope = getAgentSessionWorkspaceScope(request.context);
  assertAgentSessionBelongsToWorkspace(request.sessionId, workspaceScope);
  const apiKey = getRequiredEnv('VELOCA_AGENT_API_KEY');
  const baseUrl = getOptionalEnv('VELOCA_AGENT_BASE_URL', defaultAgentBaseUrl);
  const model = getOptionalEnv('VELOCA_AGENT_MODEL', defaultAgentModel);
  const contextWindow = getNumberEnv('VELOCA_AGENT_CONTEXT_WINDOW', defaultContextWindow);

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

  const response = await veloca.InvokeAgent(input, ai);

  return {
    answer: String(response?.content ?? ''),
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
    const options = getAgentRuntimeOptions(request, true, hooks);
    model = options.model;

    const stream = await veloca.InvokeAgent(options.input, options.ai);

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
