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

## Tool Call UI Events

Veloca also emits a renderer-facing `tool_call` stream event from the backend tool adapters. This event is separate from the raw `otherone-agent` `tool_calls` status chunk and is meant for the Agent canvas UI.

```ts
type AgentToolCallMessage = {
  id: string;
  action: string;
  summary?: string;
  icon: string;
  status: 'running' | 'success' | 'error';
  openable: boolean;
  detail?: string;
};
```

The UI must not display raw tool names such as `read_file` as the primary text. Backend adapters map tool names to user-facing action labels:

| Tool | User-facing action | Expandable |
| --- | --- | --- |
| `get_workspace_directory_tree` | 查看工作区结构 | No |
| `glob_search` | 查找文件 | No |
| `grep_search` | 搜索内容 | No |
| `read_file` | 阅读文件 | No |
| `edit_file` | 编辑文件 | Yes |
| `write_file` | 写入文件 | Yes |
| `WebFetch` | 读取网页 | Yes |
| `WebSearch` | 搜索网页 | Yes |
| `REPL` | 运行代码 | Yes |
| `PowerShell` | 运行 PowerShell | Yes |
| `run_bash_command` | 运行命令 | Yes |

The expandable decision follows the user visibility rule: if the result is mainly private context for the model, such as reading a file or searching local text before answering, the item stays compact. If the result is otherwise invisible to the user, such as command stdout/stderr, code execution output, web results, or file-write patches, the item can expand to show a concise detail panel. Tool errors are expandable when a detail message is available, even for normally compact tools.

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

Important implementation detail: `ProcessTools` parses the tool call arguments JSON and calls the implementation as `fn(...Object.values(args))`. Veloca-owned workspace tools therefore expose a single top-level `input` object and unwrap that object inside the backend adapter. This avoids bugs where the model emits valid JSON with fields in a different order, such as `{"description":"...","command":"pwd"}`, which would otherwise be passed as positional arguments incorrectly.

Veloca currently exposes eleven backend-owned tools:

- `get_workspace_directory_tree`: read-only directory-tree inspection for the active workspace. It merges Veloca default ignore rules with the workspace `.velocaignore` file and the optional `velocaignore` tool argument, and never reads file contents.
- `glob_search`: read-only filename search for the active workspace. It supports brace expansion, honors Veloca ignore rules, scopes searches to the active workspace, deduplicates results, sorts recent files first, and returns at most 100 file paths.
- `grep_search`: read-only text-content search for the active workspace. It supports regex patterns, glob and file-type filters, content/count/file-list output modes, context lines, case-insensitive search, and pagination.
- `read_file`: read-only text-file access for the active workspace. It supports filesystem text files and database virtual files, enforces workspace boundaries, rejects binary or oversized files, and returns line-windowed content with `offset` and `limit`.
- `edit_file`: targeted text replacement for existing files in the active workspace. It supports filesystem files and database virtual files, enforces workspace boundaries, requires an exact non-empty `old_string`, and returns the original file plus a structured patch.
- `write_file`: text-file write access for the active workspace. It supports filesystem files and SQLite-backed database virtual files, enforces active workspace boundaries, creates missing parent folders, limits content to `10MB`, returns `create` or `update`, and includes the original content plus a structured full-file patch.
- `WebFetch`: read-only URL fetch for a single link. It fetches the URL, upgrades non-local `http` URLs to `https`, converts HTML into readable text, and returns a prompt-aware summary with HTTP metadata.
- `WebSearch`: read-only web search for current external information. It searches a configurable HTML endpoint, parses cited results, supports allowed/blocked domain filters, deduplicates URLs, and returns at most 8 result links.
- `REPL`: sandboxed short code execution for the active `filesystem` workspace. It supports Python, JavaScript/Node.js, and Shell snippets, detects available runtimes, blocks network access through macOS `sandbox-exec`, applies a timeout, and truncates each output stream at `16384` bytes.
- `PowerShell`: foreground PowerShell execution for the active `filesystem` workspace. It detects `pwsh` or `powershell`, accepts workspace-scoped `cwd`, blocks background execution and dangerous commands, captures stdout/stderr, applies a timeout, and truncates each output stream at `16384` bytes.
- `run_bash_command`: sandboxed foreground Bash execution for the active `filesystem` workspace. It runs through macOS `sandbox-exec`, blocks network access, limits writes to the workspace, accepts `cwd` as either workspace-relative or an absolute path inside the registered workspace, rejects dangerous/background/privileged commands, captures stdout/stderr, applies a timeout, and truncates each output stream at `16384` bytes.

For direct user requests such as "运行 pwd" or "run pwd", Veloca adds a per-message `<tool-routing-hint>` that tells the model to call `run_bash_command` with arguments inside `input` for safe commands. For direct PowerShell requests that mention `PowerShell` or `pwsh`, Veloca adds a similar hint for the `PowerShell` tool. For direct short-code execution requests that mention `REPL` or ask to run Python/Node/Shell snippets, Veloca adds a hint for the `REPL` tool. When the UI Web Search toggle is enabled, or when the prompt explicitly asks for online/web search, Veloca adds a hint for `WebSearch`. When the user prompt contains a URL, Veloca adds a hint for `WebFetch` so the model reads the linked content before making claims about it. Runtime `toolChoice` remains `"auto"` intentionally: `otherone-agent` reuses the same `toolChoice` across tool-loop iterations, so forcing a single function can make the model repeat the same tool call after the first tool result instead of producing the final answer.

### `glob_search` Tool

`glob_search` finds files by glob pattern in the current active workspace. It is read-only and returns paths only; file contents still require `read_file`.

| Field | Description |
| --- | --- |
| Tool name | `glob_search` |
| Parameters | `input: { pattern: string, path?: string }` |
| Return value | `durationMs`, `numFiles`, `filenames`, `truncated` |
| Result limit | 100 file paths |

The tool supports shell-style brace expansion before matching, so patterns like `**/*.{ts,tsx,md}` work as expected. It deduplicates matched paths and sorts filesystem results by modified time descending. Database workspaces use the virtual entry timestamp available from SQLite.

For filesystem workspaces, `pattern` may be workspace-relative or absolute under the active workspace root. `path` is an optional search base directory and may also be workspace-relative or absolute under the same root. Real path checks reject workspace escapes and symlink traversal.

For database workspaces, `pattern` must be workspace-relative. `path` may be a workspace-relative virtual folder or a `veloca-db://entry/...` folder. The tool searches virtual files only and does not read binary assets.

Search traversal honors Veloca default ignore rules and the workspace `.velocaignore` file, so dependency folders, build output, caches, logs, SQLite files, and local environment files do not enter Agent search results.

### `grep_search` Tool

`grep_search` searches text file contents by regular expression inside the current active workspace. It is read-only and is intended for finding definitions, repeated terms, headings, configuration keys, or project-specific decisions before reading full files.

| Field | Description |
| --- | --- |
| Tool name | `grep_search` |
| Parameters | `input: { pattern: string, path?: string, glob?: string, output_mode?: "files_with_matches" | "content" | "count", "-B"?: number, "-A"?: number, "-C"?: number, context?: number, "-n"?: boolean, "-i"?: boolean, type?: string, head_limit?: number, offset?: number, multiline?: boolean }` |
| Return value | `mode`, `numFiles`, `filenames`, `content`, `numLines`, `numMatches`, `appliedLimit`, `appliedOffset` |
| Default output mode | `files_with_matches` |
| Default result limit | 250 files or content lines |

The `content` mode returns matching lines and optional context. `-B` controls lines before a match, `-A` controls lines after a match, and `-C` or `context` applies both directions. Line numbers are included by default and can be disabled with `"-n": false`.

The `count` mode counts regex matches across readable text files and returns `numMatches`. The `files_with_matches` mode returns only filenames. Both filesystem and database workspaces support the same output envelope.

For filesystem workspaces, `path` may be a file or directory under the active workspace root. Traversal honors Veloca ignore rules, rejects workspace escapes, skips binary files, and skips files over `10MB`.

For database workspaces, `path` may be a virtual file or folder. The tool searches SQLite-backed virtual document content and does not inspect binary assets.

Use `glob`, `path`, or `type` to narrow searches before reading content. `glob` supports brace expansion, and `type` accepts extension-style filters such as `md`, `json`, `typescript`, and `markdown`.

### `edit_file` Tool

`edit_file` replaces exact text in an existing text file in the current active workspace. It is the preferred write tool for localized changes because it avoids overwriting unrelated file content.

| Field | Description |
| --- | --- |
| Tool name | `edit_file` |
| Parameters | `input: { path: string, old_string: string, new_string: string, replace_all?: boolean }` |
| Return value | `filePath`, `oldString`, `newString`, `originalFile`, `structuredPatch`, `userModified`, `replaceAll`, `gitDiff`, `workspaceType` |
| Size limit | `10MB` for the original file and updated UTF-8 content |

For filesystem workspaces, `path` may be workspace-relative or an absolute path under the registered active workspace root. The target must already exist, must be a regular text file, and real path checks reject workspace escapes and symlink escapes.

For database workspaces, `path` may be an existing `veloca-db://entry/...` file path or a workspace-relative virtual file path. The tool only edits existing virtual files; it does not create entries or edit folders.

`old_string` must be non-empty, must differ from `new_string`, and must exist in the current file content. By default, only the first occurrence is replaced. Set `replace_all: true` only when every occurrence should change. The returned `structuredPatch` is a compact full-file patch envelope for UI or audit display; `gitDiff` is reserved and currently `null`.

After a successful `edit_file`, the backend emits the same `workspace:changed` IPC event used by `write_file`, allowing the renderer to refresh file-tree and editor metadata from the latest workspace snapshot.

### `write_file` Tool

`write_file` writes complete text content to a single file in the current active workspace. It is intentionally scoped to the workspace passed through the Agent runtime context and does not accept an arbitrary root path.

| Field | Description |
| --- | --- |
| Tool name | `write_file` |
| Parameters | `input: { path: string, content: string }` |
| Return value | `type`, `filePath`, `content`, `structuredPatch`, `originalFile`, `gitDiff`, `workspaceType` |
| Size limit | `10MB` by UTF-8 byte length |

For filesystem workspaces, `path` may be workspace-relative or an absolute path under the registered active workspace root. Missing parent directories are created automatically. Existing targets must be regular files, and real path checks reject workspace escapes and symlink escapes.

For database workspaces, `path` may be an existing `veloca-db://entry/...` file path or a workspace-relative virtual path. Relative paths create missing virtual folders and then create or update the final file entry. Database path segments reject empty values, `.`, `..`, backslashes, NUL bytes, and root escapes.

Use `edit_file` instead of `write_file` for targeted replacements in existing files. The tool returns `type: "create"` when no previous file existed and `type: "update"` when existing content was replaced. `originalFile` is `null` for creates and the prior file content for updates. `structuredPatch` is a compact full-file patch envelope for UI or audit display; `gitDiff` is reserved and currently `null`.

After a successful `write_file`, the backend emits a `workspace:changed` IPC event with a fresh workspace snapshot. The renderer subscribes through `window.veloca.workspace.onChanged(...)` and refreshes the file tree from that snapshot, so Agent-created filesystem files and database virtual files appear without requiring a manual reload.

### `WebFetch` Tool

`WebFetch` fetches one URL, converts the response into readable text, and returns a prompt-aware result. It is intended for links provided by the user or URLs discovered through `WebSearch` that need deeper inspection.

| Field | Description |
| --- | --- |
| Tool name | `WebFetch` |
| Parameters | `input: { url: string, prompt: string }` |
| Return value | `bytes`, `code`, `codeText`, `result`, `durationMs`, `url` |
| Timeout | `20000` ms |

The backend accepts `http` and `https` URLs. Non-local `http` URLs are upgraded to `https`; local development URLs on `localhost`, `127.0.0.1`, and `::1` keep `http` so local preview servers remain usable.

HTML responses are converted to readable text with scripts, styles, and tags removed. Other content types are treated as text. If the prompt asks for a title, the tool extracts the `<title>` element when available. If the prompt asks for a summary, it returns a compact content preview. Otherwise, it returns the prompt plus a content preview.

When a user prompt contains a URL, Veloca adds a per-message `<tool-routing-hint>` that tells the model to use `WebFetch` before making claims about the linked page. The model must not say it opened, read, or verified a URL unless `WebFetch` returned a result.

### `WebSearch` Tool

`WebSearch` searches the web for current external information and returns cited result links. It is not scoped to the active workspace and does not read or write local files.

| Field | Description |
| --- | --- |
| Tool name | `WebSearch` |
| Parameters | `input: { query: string, allowed_domains?: string[], blocked_domains?: string[] }` |
| Return value | `query`, `durationSeconds`, `results` |
| Default endpoint | `https://html.duckduckgo.com/html/` |
| Config | `VELOCA_WEB_SEARCH_BASE_URL`; `CLAWD_WEB_SEARCH_BASE_URL` is accepted for compatibility. |
| Result limit | 8 deduplicated URLs |

The backend builds the search URL by appending `q=<query>` to the configured endpoint. It fetches HTML with a `20000` ms timeout, parses DuckDuckGo `result__a` links first, then falls back to generic anchor extraction when needed.

`allowed_domains` keeps only matching domains, and `blocked_domains` removes matching domains. Domain filters normalize scheme, casing, leading dots, and trailing slashes. Subdomains match their parent domain, so `docs.example.com` matches `example.com`.

The result shape mirrors the reference implementation: `results` includes a commentary string and a structured block with `tool_use_id: "web_search_1"` plus `content: [{ title, url }]`. The system prompt instructs the Agent to include a Sources section when web results inform the answer and to avoid claiming web search occurred without a tool result.

### `REPL` Tool

`REPL` executes short code snippets inside the current active filesystem workspace. It is intended for bounded verification, calculation, quick parsing, or small transformations, not for long-running services or broad project modification.

| Field | Description |
| --- | --- |
| Tool name | `REPL` |
| Parameters | `input: { code: string, language: string, timeout_ms?: number }` |
| Supported languages | `python` / `py`, `javascript` / `js` / `node`, `shell` / `sh` / `bash` |
| Return value | `ok`, `stdout`, `stderr`, `exitCode`, `language`, `runtimePath`, `interrupted`, `timedOut`, `blocked`, `cwd`, `durationMs`, `outputTruncated`, `sandboxStatus` |
| Default timeout | `10000` ms |
| Maximum timeout | `120000` ms |

The backend detects Python with `python3` then `python`, JavaScript with `node`, and Shell with `bash` then `sh`. If the requested runtime is missing or the language is unsupported, the tool returns a structured blocked result instead of throwing an unhandled runtime error.

Execution runs at the registered active workspace root. The code length is capped at `20000` characters. stdout/stderr are captured and truncated per stream at `16384` bytes.

The first implementation requires macOS `sandbox-exec`. Network access is blocked, and writes are limited to the active workspace plus `.veloca/repl-sandbox/`. Shell snippets additionally reuse the Bash command safety checks for background, privileged, parent-directory, absolute-path, and destructive command patterns. Python and JavaScript are still execution tools, so the system prompt instructs the Agent not to use `REPL` for destructive work, dependency installation, or tasks better handled by workspace file tools.

### `PowerShell` Tool

`PowerShell` executes foreground PowerShell commands inside the current active filesystem workspace. It is intended for PowerShell-specific workflows and should not replace `run_bash_command` for normal shell inspection on macOS/Linux.

| Field | Description |
| --- | --- |
| Tool name | `PowerShell` |
| Parameters | `input: { command: string, cwd?: string, timeout?: number, description?: string, run_in_background?: boolean }` |
| Return value | `ok`, `stdout`, `stderr`, `exitCode`, `interrupted`, `timedOut`, `blocked`, `cwd`, `durationMs`, `outputTruncated`, `powershellPath`, `sandboxStatus`, `noOutputExpected` |
| Default timeout | `10000` ms |
| Maximum timeout | `120000` ms |

The backend detects `pwsh` first and falls back to `powershell` when available in `PATH`. If neither executable exists, the tool returns a structured blocked result instead of throwing an unhandled runtime error.

`cwd` is resolved inside the registered active workspace root. The command itself is executed through `-NoProfile -NonInteractive -Command`. Output is captured from stdout/stderr and truncated per stream at `16384` bytes.

Veloca intentionally does not support `run_in_background` for this first version. If the model or user requests background execution, the tool returns `blocked: true` and does not spawn a process.

Unlike `run_bash_command`, the first PowerShell implementation does not provide an OS-level network sandbox. The output includes `sandboxStatus.enabled: false` and `network: "not-enforced"`. To reduce risk, the backend blocks obvious background, privileged, destructive, network, service-management, disk-management, home-directory, parent-directory, and external absolute-path command patterns before execution.

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

- `agent:list-sessions`: receives the current Agent runtime context, scopes the request to the active workspace root, reads only sessions assigned to that workspace, creates one default session for that workspace if none exist, and maps stored entries back into the Agent canvas shape.
- `agent:create-session`: receives the current Agent runtime context, calls `veloca.CreateNewSession()`, records the new session's workspace ownership in `.veloca/storage/veloca-session-workspaces.json`, and returns the newly created local-file session.
- `agent:send-message-stream`: validates that the active session id belongs to the current workspace root before sending it into `veloca.InvokeAgent()`, so follow-up turns reuse the same context memory without allowing another workspace to open that session.

The renderer no longer treats Agent sessions as throwaway UI-only state. On mount and whenever the active workspace root changes, the Agent palette calls `window.veloca.agent.listSessions(context)`, restores historical sessions for that workspace, and selects the newest session by default. The session switcher uses the same `otherone-agent` session ids that are passed back to the runtime, which means switching to an older session and sending a new message continues that session's saved context inside the same workspace.

Session content still stays in the third-party local-file store, but Veloca owns the workspace boundary through a small sidecar index:

```text
.veloca/storage/veloca-session-workspaces.json
```

The sidecar maps `session_id` to a normalized workspace key. Filesystem workspaces use the registered real path; database workspaces use the registered `veloca-db://root/{workspaceId}` root. When the Agent palette is opened from an untitled file or any state without a valid workspace root, Veloca sends an empty workspace context and stores the conversation under the standalone `brainstorm` scope. Brainstorm sessions are intentionally separate from every real workspace and do not expose workspace tools or directory context. Sessions without a matching sidecar record are not listed for any workspace and cannot be sent through the Veloca IPC API.

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
VELOCA_WEB_SEARCH_BASE_URL=https://html.duckduckgo.com/html/
```

The first integrated backend path uses OpenRouter through the package's OpenAI-compatible provider. The renderer calls `window.veloca.agent.sendMessage(...)`; the Electron main process validates the request and calls `veloca.InvokeAgent` with a simple Veloca editor system prompt. Lite / Pro / Ultra are currently UI selections only and all resolve to `VELOCA_AGENT_MODEL` until separate model routing is added.

The Agent system prompt is defined by the AI context design in `docs/models/agent-context.md`. At request time, Veloca replaces runtime variables with the current local time, active file path, workspace root path, and workspace type. The selected editor text is injected as a per-turn `<selected-text>` block in the user prompt rather than as a long-lived system rule.

## Integration Direction For Veloca

The current implementation uses a backend Agent service boundary:

1. Keep the current Agent UI as the renderer surface.
2. Use `agent:send-message-stream` for streaming Agent responses. The legacy `agent:send-message` invoke path remains available for non-streaming calls.
3. Resolve model selection to backend config.
4. Call `veloca.InvokeAgent` from the main process with `stream: true`.
5. Normalize raw chunks into UI events: `delta`, `tool_calls`, structured `tool_call`, `complete`, and `error`.
6. Use `otherone-agent` local-file session ids directly as Veloca Agent session ids.

The preload layer creates a request id per send operation, listens for `agent:message-event`, filters events by request id, and returns an unsubscribe function to the renderer. The Agent palette appends each `delta` to the active AI message so the canvas updates while the model is still generating.

This keeps the UI responsive while preserving security and leaves room to replace the package local-file storage with SQLite later. Real tool execution is the next likely extension point.
