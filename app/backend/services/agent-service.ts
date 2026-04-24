import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { veloca } from 'otherone-agent';

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
const maxPromptLength = 20000;
let envLoaded = false;

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

  if (!metadata.length) {
    return prompt;
  }

  return `${metadata.join('\n\n')}\n\n用户问题：\n${prompt}`;
}

function getAgentRuntimeOptions(request: AgentSendMessageRequest, stream: boolean) {
  const prompt = validateRequest(request);
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

export function createAgentSession(): AgentStoredSession {
  const sessionId = veloca.CreateNewSession();
  const sessions = readStoredSessionSummaries();
  const sessionIndex = Math.max(
    0,
    sessions.findIndex((session) => getStoredSessionId(session) === sessionId)
  );

  return readStoredSession(sessionId, sessionIndex);
}

export function listAgentSessions(): AgentStoredSession[] {
  const sessions = readStoredSessionSummaries();

  if (sessions.length === 0) {
    return [createAgentSession()];
  }

  return sessions.map((session, index) => readStoredSession(getStoredSessionId(session), index));
}

export async function sendAgentMessage(request: AgentSendMessageRequest): Promise<AgentSendMessageResponse> {
  const { ai, input, model } = getAgentRuntimeOptions(request, false);

  const response = await veloca.InvokeAgent(input, ai);

  return {
    answer: String(response?.content ?? ''),
    model,
    sessionId: request.sessionId
  };
}

export async function streamAgentMessage(
  request: AgentSendMessageRequest,
  emit: (event: AgentStreamEvent) => void
): Promise<void> {
  let model = defaultAgentModel;

  try {
    const options = getAgentRuntimeOptions(request, true);
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
