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

export type AgentStoredResponsePart =
  | {
      content: string;
      id: string;
      type: 'text';
    }
  | {
      id: string;
      item: AgentToolCallMessage;
      type: 'thinking' | 'tool';
    };

export interface AgentStoredConversation {
  answer: string;
  attachments: Array<{
    mimeType: string;
    name: string;
    status: string;
  }>;
  id: string;
  model: 'lite' | 'pro' | 'ultra';
  prompt: string;
  responseParts?: AgentStoredResponsePart[];
  status: 'complete';
  toolCalls?: AgentToolCallMessage[];
  webSearch: boolean;
}

export interface StoredAgentEntry {
  content?: unknown;
  entry_id?: unknown;
  reasoning_content?: unknown;
  role?: unknown;
  tools?: unknown;
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
    action: 'Inspect workspace tree',
    icon: 'folder-tree',
    openable: false
  },
  glob_search: {
    action: 'Find files',
    icon: 'search',
    openable: false
  },
  grep_search: {
    action: 'Search content',
    icon: 'search-code',
    openable: false
  },
  read_file: {
    action: 'Read file',
    icon: 'file-text',
    openable: false
  },
  edit_file: {
    action: 'Edit file',
    icon: 'file-pen-line',
    openable: true
  },
  write_file: {
    action: 'Write file',
    icon: 'save',
    openable: true
  },
  WebFetch: {
    action: 'Fetch web page',
    icon: 'link',
    openable: true
  },
  WebSearch: {
    action: 'Search web',
    icon: 'globe',
    openable: true
  },
  REPL: {
    action: 'Run code',
    icon: 'play',
    openable: true
  },
  PowerShell: {
    action: 'Run PowerShell',
    icon: 'terminal',
    openable: true
  },
  run_bash_command: {
    action: 'Run command',
    icon: 'terminal',
    openable: true
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAgentToolName(value: unknown): value is AgentToolName {
  return typeof value === 'string' && value in agentToolDisplayConfig;
}

function unwrapToolInput(value: unknown): unknown {
  return isRecord(value) && 'input' in value ? value.input : value;
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
    return compactToolSummary(undefined, 'Current workspace');
  }

  if (!isRecord(input)) {
    return undefined;
  }

  switch (toolName) {
    case 'glob_search':
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
    case 'REPL':
      return compactToolSummary(typeof input.language === 'string' ? input.language : 'code');
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

function createAgentThinkingMessage(id: string, detail: string, status: AgentToolCallStatus): AgentToolCallMessage {
  return {
    action: 'Thinking',
    detail: truncateToolDisplayText(detail),
    icon: 'brain',
    id,
    openable: Boolean(detail.trim()),
    status,
    summary: status === 'running' ? 'Reasoning in progress' : 'Reasoning complete'
  };
}

function createStoredTimelineId(prefix: string, ...values: unknown[]): string {
  const suffix = values
    .map((value) => String(value ?? ''))
    .join('-')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);

  return suffix ? `${prefix}-${suffix}` : prefix;
}

function parseStoredToolInput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return unwrapToolInput(value);
  }

  try {
    return unwrapToolInput(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function createStoredToolCallMessage(options: {
  error?: unknown;
  id: string;
  input?: unknown;
  result?: unknown;
  status?: AgentToolCallStatus;
  toolName: AgentToolName;
}): AgentToolCallMessage {
  const status = options.status ?? (options.error ? 'error' : getToolResultStatus(options.result));
  const detailTarget = options.error ? options.error : options.result;
  const shouldExposeDetail = agentToolDisplayConfig[options.toolName].openable || status === 'error';

  return toAgentToolCallMessage({
    detail: shouldExposeDetail ? formatToolResultDetail(options.toolName, detailTarget) : undefined,
    id: options.id,
    input: options.input,
    status,
    toolName: options.toolName
  });
}

function addStoredResponsePart(conversation: AgentStoredConversation, part: AgentStoredResponsePart): void {
  conversation.responseParts = [...(conversation.responseParts ?? []), part];
}

function upsertStoredToolMessage(
  toolCalls: AgentToolCallMessage[] | undefined,
  nextToolCall: AgentToolCallMessage
): AgentToolCallMessage[] {
  const currentToolCalls = toolCalls ?? [];
  const index = currentToolCalls.findIndex((toolCall) => toolCall.id === nextToolCall.id);

  if (index < 0) {
    return [...currentToolCalls, nextToolCall];
  }

  return currentToolCalls.map((toolCall, currentIndex) => (currentIndex === index ? nextToolCall : toolCall));
}

function upsertStoredToolPart(conversation: AgentStoredConversation, toolCall: AgentToolCallMessage): void {
  const currentParts = conversation.responseParts ?? [];
  const index = currentParts.findIndex((part) => part.type === 'tool' && part.item.id === toolCall.id);

  conversation.toolCalls = upsertStoredToolMessage(conversation.toolCalls, toolCall);

  if (index < 0) {
    conversation.responseParts = [
      ...currentParts,
      {
        id: toolCall.id,
        item: toolCall,
        type: 'tool'
      }
    ];
    return;
  }

  conversation.responseParts = currentParts.map((part, currentIndex) =>
    currentIndex === index && part.type === 'tool'
      ? {
          ...part,
          item: toolCall
        }
      : part
  );
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

function getStoredAssistantToolCalls(entry: StoredAgentEntry): unknown[] {
  const tools = entry.tools;

  if (!isRecord(tools) || !Array.isArray(tools.tool_calls)) {
    return [];
  }

  return tools.tool_calls;
}

function getStoredToolCallId(toolCall: unknown, fallback: string): string {
  return isRecord(toolCall) && typeof toolCall.id === 'string' && toolCall.id.trim() ? toolCall.id : fallback;
}

function getStoredToolCallName(toolCall: unknown): AgentToolName | undefined {
  if (!isRecord(toolCall) || !isRecord(toolCall.function)) {
    return undefined;
  }

  return isAgentToolName(toolCall.function.name) ? toolCall.function.name : undefined;
}

function getStoredToolCallInput(toolCall: unknown): unknown {
  if (!isRecord(toolCall) || !isRecord(toolCall.function)) {
    return undefined;
  }

  return parseStoredToolInput(toolCall.function.arguments);
}

function getStoredToolResultPayload(entry: StoredAgentEntry): {
  error?: unknown;
  result?: unknown;
  toolCallId?: string;
  toolName?: AgentToolName;
} | null {
  if (!isRecord(entry.tools)) {
    return null;
  }

  return {
    error: entry.tools.error,
    result: entry.tools.result,
    toolCallId: typeof entry.tools.tool_call_id === 'string' ? entry.tools.tool_call_id : undefined,
    toolName: isAgentToolName(entry.tools.function_name) ? entry.tools.function_name : undefined
  };
}

export function mapStoredEntriesToConversations(sessionId: string, entries: StoredAgentEntry[]): AgentStoredConversation[] {
  const conversations: AgentStoredConversation[] = [];
  const pendingToolCalls = new Map<
    string,
    {
      conversation: AgentStoredConversation;
      input?: unknown;
      toolName: AgentToolName;
      uiId: string;
    }
  >();

  for (const [index, entry] of entries.entries()) {
    const role = typeof entry.role === 'string' ? entry.role : '';
    const content = getStoredEntryContent(entry);
    const entryId = getStoredEntryId(entry, `${sessionId}-message-${index}`);

    if (role === 'user') {
      conversations.push({
        answer: '',
        attachments: [],
        id: entryId,
        model: 'lite',
        prompt: getDisplayPrompt(content),
        status: 'complete',
        webSearch: false
      });
      continue;
    }

    if (role === 'assistant' && conversations.length > 0) {
      const latestConversation = conversations[conversations.length - 1];

      if (typeof entry.reasoning_content === 'string' && entry.reasoning_content.trim()) {
        const thinkingId = createStoredTimelineId('thinking', entryId);

        addStoredResponsePart(latestConversation, {
          id: thinkingId,
          item: createAgentThinkingMessage(thinkingId, entry.reasoning_content, 'success'),
          type: 'thinking'
        });
      }

      if (content) {
        latestConversation.answer = latestConversation.answer ? `${latestConversation.answer}\n\n${content}` : content;
        addStoredResponsePart(latestConversation, {
          content,
          id: createStoredTimelineId('answer-part', entryId),
          type: 'text'
        });
      }

      for (const [toolIndex, toolCall] of getStoredAssistantToolCalls(entry).entries()) {
        const toolName = getStoredToolCallName(toolCall);

        if (!toolName) {
          continue;
        }

        const rawToolCallId = getStoredToolCallId(toolCall, `${entryId}-${toolIndex}`);
        const uiId = createStoredTimelineId('tool', rawToolCallId);
        const input = getStoredToolCallInput(toolCall);
        const toolMessage = createStoredToolCallMessage({
          id: uiId,
          input,
          status: 'success',
          toolName
        });

        pendingToolCalls.set(rawToolCallId, {
          conversation: latestConversation,
          input,
          toolName,
          uiId
        });
        upsertStoredToolPart(latestConversation, toolMessage);
      }
      continue;
    }

    if (role === 'tool' && conversations.length > 0) {
      const payload = getStoredToolResultPayload(entry);

      if (!payload?.toolName) {
        continue;
      }

      const rawToolCallId = payload.toolCallId ?? entryId;
      const pending = pendingToolCalls.get(rawToolCallId);
      const latestConversation = pending?.conversation ?? conversations[conversations.length - 1];
      const toolMessage = createStoredToolCallMessage({
        error: payload.error,
        id: pending?.uiId ?? createStoredTimelineId('tool', rawToolCallId),
        input: pending?.input,
        result: payload.result,
        toolName: pending?.toolName ?? payload.toolName
      });

      upsertStoredToolPart(latestConversation, toolMessage);
      pendingToolCalls.delete(rawToolCallId);
    }
  }

  return conversations.filter(
    (conversation) => conversation.prompt.trim() || conversation.answer.trim() || Boolean(conversation.responseParts?.length)
  );
}
