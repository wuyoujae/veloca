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

Renderer components call a Veloca-owned IPC/API wrapper. That wrapper validates input, chooses the model configuration, calls `otherone-agent`, and streams normalized events back to the Agent UI.

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

Veloca currently exposes four backend-owned workspace tools:

- `get_workspace_directory_tree`: read-only directory-tree inspection for the active workspace. It merges Veloca default ignore rules with the workspace `.velocaignore` file and the optional `velocaignore` tool argument, and never reads file contents.
- `read_file`: read-only text-file access for the active workspace. It supports filesystem text files and database virtual files, enforces workspace boundaries, rejects binary or oversized files, and returns line-windowed content with `offset` and `limit`.
- `write_file`: text-file write access for the active workspace. It supports filesystem files and SQLite-backed database virtual files, enforces active workspace boundaries, creates missing parent folders, limits content to `10MB`, returns `create` or `update`, and includes the original content plus a structured full-file patch.
- `run_bash_command`: sandboxed foreground Bash execution for the active `filesystem` workspace. It runs through macOS `sandbox-exec`, blocks network access, limits writes to the workspace, accepts `cwd` as either workspace-relative or an absolute path inside the registered workspace, rejects dangerous/background/privileged commands, captures stdout/stderr, applies a timeout, and truncates each output stream at `16384` bytes.

For direct user requests such as "运行 pwd" or "run pwd", Veloca adds a per-message `<tool-routing-hint>` that tells the model to call `run_bash_command` for safe commands. Runtime `toolChoice` remains `"auto"` intentionally: `otherone-agent` reuses the same `toolChoice` across tool-loop iterations, so forcing a single function can make the model repeat the same bash tool call after the first tool result instead of producing the final answer.

### `write_file` Tool

`write_file` writes complete text content to a single file in the current active workspace. It is intentionally scoped to the workspace passed through the Agent runtime context and does not accept an arbitrary root path.

| Field | Description |
| --- | --- |
| Tool name | `write_file` |
| Parameters | `path: string`, `content: string` |
| Return value | `type`, `filePath`, `content`, `structuredPatch`, `originalFile`, `gitDiff`, `workspaceType` |
| Size limit | `10MB` by UTF-8 byte length |

For filesystem workspaces, `path` may be workspace-relative or an absolute path under the registered active workspace root. Missing parent directories are created automatically. Existing targets must be regular files, and real path checks reject workspace escapes and symlink escapes.

For database workspaces, `path` may be an existing `veloca-db://entry/...` file path or a workspace-relative virtual path. Relative paths create missing virtual folders and then create or update the final file entry. Database path segments reject empty values, `.`, `..`, backslashes, NUL bytes, and root escapes.

The tool returns `type: "create"` when no previous file existed and `type: "update"` when existing content was replaced. `originalFile` is `null` for creates and the prior file content for updates. `structuredPatch` is a compact full-file patch envelope for UI or audit display; `gitDiff` is reserved and currently `null`.

## Persistence

In local-file mode, `otherone-agent` writes to:

```text
.veloca/storage/veloca-storage.json
```

The file is relative to `process.cwd()`. It contains sessions, entries, tool results, token consumption, and compacted summaries. This runtime directory is ignored by Git via `.gitignore`.

Veloca keeps this Agent memory separate from product business data. Workspace data, settings, virtual documents, and assets continue to live in the app SQLite database under Electron's user data directory. Agent conversation memory currently stays in the `otherone-agent` local-file store only, because Veloca does not have an account system yet. When account support is added, this boundary should stay intact and the Agent memory layer can migrate independently.

The package's built-in database helpers target PostgreSQL tables:

- `veloca_session`
- `veloca_entries`
- `veloca_compacted_entries`

Those tables intentionally do not match the current Veloca SQLite stack.

## Session Management

Veloca now exposes a small backend-owned session API over IPC:

- `agent:list-sessions`: reads `otherone-agent` local-file sessions, creates one default session if the store is empty, and maps stored entries back into the Agent canvas shape.
- `agent:create-session`: calls `veloca.CreateNewSession()` and returns the newly created local-file session.
- `agent:send-message-stream`: sends the active session id into `veloca.InvokeAgent()`, so follow-up turns reuse the same context memory.

The renderer no longer treats Agent sessions as throwaway UI-only state. On mount, the Agent palette calls `window.veloca.agent.listSessions()`, restores historical sessions, and selects the newest session by default. The session switcher uses the same `otherone-agent` session ids that are passed back to the runtime, which means switching to an older session and sending a new message continues that session's saved context.

`otherone-agent` does not currently store Veloca UI metadata such as the selected Lite / Pro / Ultra badge, upload attachment UI state, or Web Search toggle separately. Persisted history therefore restores the durable user/assistant text from local memory and treats attachment chips as per-turn runtime context until a dedicated metadata layer is added.

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

The Agent system prompt is defined by the AI context design in `docs/models/agent-context.md`. At request time, Veloca replaces runtime variables with the current local time, active file path, workspace root path, and workspace type. The selected editor text is injected as a per-turn `<selected-text>` block in the user prompt rather than as a long-lived system rule.

## Integration Direction For Veloca

The current implementation uses a backend Agent service boundary:

1. Keep the current Agent UI as the renderer surface.
2. Use `agent:send-message-stream` for streaming Agent responses. The legacy `agent:send-message` invoke path remains available for non-streaming calls.
3. Resolve model selection to backend config.
4. Call `veloca.InvokeAgent` from the main process with `stream: true`.
5. Normalize raw chunks into UI events: `delta`, `tool_calls`, `complete`, and `error`.
6. Use `otherone-agent` local-file session ids directly as Veloca Agent session ids.

The preload layer creates a request id per send operation, listens for `agent:message-event`, filters events by request id, and returns an unsubscribe function to the renderer. The Agent palette appends each `delta` to the active AI message so the canvas updates while the model is still generating.

This keeps the UI responsive while preserving security and leaves room to replace the package local-file storage with SQLite later. Real tool execution is the next likely extension point.
