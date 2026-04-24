import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { veloca } from 'otherone-agent';

export type AgentUiModel = 'lite' | 'pro' | 'ultra';

export interface AgentAttachmentSummary {
  mimeType: string;
  name: string;
  status: string;
}

export interface AgentSendMessageRequest {
  attachments?: AgentAttachmentSummary[];
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

function buildSystemPrompt(): string {
  return [
    '你是 Veloca 编辑器内置的 Agent。',
    '你擅长 Markdown 写作、内容润色、代码解释、结构整理和编辑器内协作。',
    '请优先使用用户使用的语言回答；如果用户使用中文，就用简洁自然的中文回答。',
    '回答要直接、可执行、不过度展开；涉及代码或 Markdown 时保持格式清晰。',
    '如果上下文不足，请说明需要什么信息，不要编造。'
  ].join('\n');
}

function buildUserPrompt(prompt: string, request: AgentSendMessageRequest): string {
  const metadata: string[] = [];

  if (request.attachments?.length) {
    const attachmentList = request.attachments
      .map((attachment) => `- ${attachment.name} (${attachment.mimeType || 'unknown'}, ${attachment.status})`)
      .join('\n');

    metadata.push(`用户在本轮对话中带了这些附件占位信息：\n${attachmentList}`);
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
      systemPrompt: buildSystemPrompt(),
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
