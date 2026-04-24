# Agent Runtime

## Current Dependency

Veloca now includes `otherone-agent@^0.2.0`, a Node.js and TypeScript Agent runtime library. The package is installed from npm and exposes a CommonJS entry at `dist/index.js` with TypeScript declarations at `dist/index.d.ts`.

`otherone-agent@0.2.0` publishes CommonJS output and calls `require('uuid')` internally. `uuid@13` is ESM-only and crashes under Electron's embedded Node 20 CommonJS loader with `ERR_REQUIRE_ESM`, so Veloca pins the package's transitive `uuid` dependency to `11.1.0` through npm `overrides`. Keep this override until `otherone-agent` publishes an ESM-safe build or removes the CommonJS `require('uuid')` path.

The public import is:

```ts
import { veloca } from 'otherone-agent';
```

The package exports a single `veloca` object plus named methods. The most important methods for Veloca are:

- `CreateNewSession()`: creates a local-file session and returns a UUID session id.
- `InvokeAgent(input, ai)`: runs the full Agent loop, including context loading, model call, tool processing, and persistence.
- `ReadSessionData(sessionId)`: reads one local-file session with entries and compacted entries.
- `GetAllSessions()`: lists local-file sessions.
- `WriteEntry(options)`: manually persists one message entry.
- `EstimateTokens(options)`, `CheckThreshold(options)`, `CompactMessages(options)`: lower-level context management helpers.

The package also exposes PostgreSQL helpers, but Veloca currently uses SQLite. Do not use the package database storage path unless the product explicitly adds PostgreSQL support.

## Runtime Placement

`otherone-agent` must run in the Electron backend/main side, not directly in the renderer.

Reasons:

- It needs API keys for model providers.
- The local-file storage mode writes to disk through Node `fs`.
- Tool implementations may access local workspace or editor state and should be mediated through controlled IPC.

Renderer components should call a Veloca-owned IPC/API wrapper. That wrapper should validate input, choose the model configuration, call `otherone-agent`, and stream normalized events back to the Agent UI.

## Basic Local-File Session Flow

```ts
import { veloca } from 'otherone-agent';

const sessionId = veloca.CreateNewSession();

const response = await veloca.InvokeAgent(
  {
    sessionId,
    contextLoadType: 'localfile',
    storageType: 'localfile',
    contextWindow: 128000,
    thresholdPercentage: 0.8,
    maxIterations: 8
  },
  {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    systemPrompt: 'You are Veloca, an editor-native writing and coding agent.',
    userPrompt: 'Rewrite the selected paragraph.',
    stream: false
  }
);

console.log(response.content);
```

For a follow-up turn, reuse the same `sessionId`. The library loads previous entries automatically through `CombineContext`.

## Streaming Flow

When `ai.stream` is `true`, `InvokeAgent` resolves to an async generator:

```ts
const stream = await veloca.InvokeAgent(
  {
    sessionId,
    contextLoadType: 'localfile',
    storageType: 'localfile',
    contextWindow: 128000,
    maxIterations: 8
  },
  {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    userPrompt: 'Summarize this section.',
    stream: true
  }
);

for await (const chunk of stream) {
  const text = chunk.choices?.[0]?.delta?.content;

  if (text) {
    // Forward text to the renderer as an incremental assistant delta.
  }

  if (chunk.type === 'tool_calls') {
    // Forward tool status to the Agent canvas.
  }

  if (chunk.type === 'error') {
    // Convert to Veloca's error message UI.
  }
}
```

The stream yields raw OpenAI chunks while accumulating the final assistant content for storage. It may also yield internal status chunks with `type` values such as `tool_calls`, `thinking`, `complete`, or `error`.

## Tool Calling

Tools are passed in OpenAI-compatible function-tool format. Implementations are passed through `tools_realize`.

```ts
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_selected_text',
      description: 'Read the current selected text from the editor context.',
      parameters: {
        type: 'object',
        properties: {
          selectionId: { type: 'string' }
        },
        required: ['selectionId']
      }
    }
  }
];

const tools_realize = {
  get_selected_text: async (selectionId: string) => {
    return readSelectionSnapshot(selectionId);
  }
};

await veloca.InvokeAgent(input, {
  provider: 'openai',
  apiKey,
  baseUrl,
  model,
  userPrompt,
  tools,
  tools_realize,
  toolChoice: 'auto',
  parallelToolCalls: false,
  stream: true
});
```

Important implementation detail: `ProcessTools` parses the tool call arguments JSON and calls the implementation as `fn(...Object.values(args))`. For Veloca-owned tools, define argument schemas with stable property order, or wrap the library behind an adapter that converts arguments into a named object before calling product code.

## Persistence

In local-file mode, `otherone-agent` writes to:

```text
.veloca/storage/veloca-storage.json
```

The file is relative to `process.cwd()`. It contains sessions, entries, tool results, token consumption, and compacted summaries. This runtime directory is ignored by Git via `.gitignore`.

Before production integration, Veloca should decide whether Agent history should stay in this local JSON file, be copied into the existing SQLite backend, or be wrapped with a custom persistence layer. The package's built-in database helpers target PostgreSQL tables:

- `veloca_session`
- `veloca_entries`
- `veloca_compacted_entries`

Those tables intentionally do not match the current Veloca SQLite stack.

## Configuration Notes

The package requires provider credentials at call time:

- `provider`: currently only OpenAI is implemented end to end.
- `apiKey`: must come from backend-owned configuration or environment variables.
- `baseUrl`: OpenAI-compatible API endpoint.
- `model`: model id selected by Veloca's Lite / Pro / Ultra UI.
- `contextWindow`: total context budget used for threshold checks.
- `thresholdPercentage`: optional compression trigger ratio, default behavior is handled by the library.
- `contextLength`: maps to OpenAI `max_tokens` in this package.
- `other.client`: extra OpenAI client options.
- `other.chat`: extra OpenAI chat completion options.

Do not expose API keys to renderer state, localStorage, or frontend logs.

Veloca currently reads Agent configuration from backend environment variables. Local development can use `.env`, which is intentionally ignored by Git:

```env
VELOCA_AGENT_BASE_URL=https://openrouter.ai/api/v1
VELOCA_AGENT_MODEL=google/gemini-3.1-flash-lite-preview
VELOCA_AGENT_API_KEY=your-openrouter-api-key
VELOCA_AGENT_CONTEXT_WINDOW=128000
```

The first integrated backend path uses OpenRouter through the package's OpenAI-compatible provider. The renderer calls `window.veloca.agent.sendMessage(...)`; the Electron main process validates the request and calls `veloca.InvokeAgent` with a simple Veloca editor system prompt. Lite / Pro / Ultra are currently UI selections only and all resolve to `VELOCA_AGENT_MODEL` until separate model routing is added.

## Integration Direction For Veloca

The current implementation starts with a backend Agent service boundary:

1. Keep the current Agent UI as the renderer surface.
2. Add an Electron IPC channel such as `agent:send-message`.
3. Resolve model selection to backend config.
4. Call `veloca.InvokeAgent` from the main process.
5. Normalize the response into UI events: user message stored, assistant response, completion, and error.
6. Persist the mapping between Veloca UI sessions and `otherone-agent` session ids.

This keeps the UI responsive while preserving security and leaves room to replace the package local-file storage with SQLite later. Streaming deltas and real tool execution are the next likely extension points.
