export interface AgentReasoningEntry {
  content?: unknown;
  reasoning_content?: unknown;
  role?: unknown;
  tools?: unknown;
}

type OpenAiMessage = Record<string, unknown>;

export function getStoredReasoningContent(entry: AgentReasoningEntry): string | undefined {
  return typeof entry.reasoning_content === 'string' && entry.reasoning_content ? entry.reasoning_content : undefined;
}

export function attachStoredReasoningToMessages(
  messages: OpenAiMessage[],
  entries: AgentReasoningEntry[]
): OpenAiMessage[] {
  const assistantEntries = entries.filter((entry) => entry.role === 'assistant' && getStoredReasoningContent(entry));
  const usedEntryIndexes = new Set<number>();

  return messages.map((message) => {
    if (message.role !== 'assistant') {
      return message;
    }

    const entryIndex = assistantEntries.findIndex(
      (entry, index) => !usedEntryIndexes.has(index) && assistantEntryMatchesMessage(entry, message)
    );

    if (entryIndex < 0) {
      return message;
    }

    usedEntryIndexes.add(entryIndex);
    return {
      ...message,
      reasoning_content: getStoredReasoningContent(assistantEntries[entryIndex])
    };
  });
}

function assistantEntryMatchesMessage(entry: AgentReasoningEntry, message: OpenAiMessage): boolean {
  if (normalizeMessageContent(entry.content) !== normalizeMessageContent(message.content)) {
    return false;
  }

  const entryToolCalls = getToolCallsFromValue(entry.tools);
  const messageToolCalls = getToolCallsFromValue(message);

  if (entryToolCalls.length || messageToolCalls.length) {
    return JSON.stringify(entryToolCalls) === JSON.stringify(messageToolCalls);
  }

  return true;
}

function normalizeMessageContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function getToolCallsFromValue(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.tool_calls)) {
    return [];
  }

  return value.tool_calls;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
