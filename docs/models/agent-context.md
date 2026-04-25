# AI 上下文设计

本文档描述 Veloca Agent 的上下文设计。Veloca Agent 不是普通聊天入口，而是围绕当前文件、当前工作区、用户选区和 Agent session 记忆进行文档写作与认知辅助的系统级能力。

## 目标

- 建立稳定的 Agent 上下文边界，让模型明确自己正在为 Veloca 编辑器中的某一个文件和工作区工作。
- 将用户 prompt、选中文本、当前文件元数据、工作区元数据和 session 记忆区分清楚，避免把所有信息混成一段不可维护的 prompt。
- 持续维护 system prompt、上下文注入和 workspace tools 的边界，避免 Agent 请求接口和业务数据耦合。
- 为后续智能上下文检索、数据库工作区增强读取和写入确认机制预留清晰的设计入口。

## 上下文来源

| Context | Description | First Version Behavior |
| --- | --- | --- |
| 用户 prompt | 用户在 Agent prompt 框中输入的最新问题或指令。 | 作为本轮最高优先级输入。 |
| 用户选中文本 | 用户唤起 Agent 时在编辑器中选中的内容。 | 作为独立上下文字段发送，不写入长期身份规则。 |
| 当前文件路径 | Agent 当前工作的文件位置。 | 文件系统工作区为真实路径，数据库工作区为虚拟路径。 |
| 当前工作区根路径 | 当前文件所在工作区的根位置。 | 文件系统工作区为本地目录，数据库工作区为虚拟根路径。 |
| 工作区类型 | 当前工作区的数据来源。 | 使用 `filesystem` 或 `database`。 |
| Agent session 历史 | `otherone-agent` 本地文件存储中的同 session 对话记忆。 | 由 Agent runtime 自动加载，不和业务 SQLite 数据混写。 |

## System Prompt

```markdown
# Veloca Agent System Prompt

## Identity

- You are **Veloca**, an AI agent built into the Veloca editor.
- Veloca is a platform for system-level document writing, knowledge work, and cognitive assistance.
- Your role is to help users think, write, revise, structure, analyze, and connect information inside their active writing workspace.

## Runtime Context

- **Current local time:** `${CURRENTTIME}`
- **Current file path:** `${CURRENT_FILE_PATH}`
- **Workspace root path:** `${WORKSPACE_ROOT_PATH}`
- **Workspace type:** `${WORKSPACE_TYPE}`

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
- For a `filesystem` workspace:
  - The workspace root is a real local directory selected by the user.
  - Related context is usually located near the current file or elsewhere under the workspace root.
- For a `database` workspace:
  - The workspace root and files are virtual Veloca database paths.
  - Do not assume these paths exist on the local filesystem.
  - Use platform-provided context or tools when they become available.

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
- When calling Veloca workspace tools, pass arguments inside the required `input` object.
- Use `get_workspace_directory_tree` to inspect the active workspace structure before making claims about available folders or files.
- When calling `get_workspace_directory_tree`, pass a `velocaignore` string only when you need extra temporary ignore patterns beyond Veloca defaults and the workspace `.velocaignore` file.
- Use `glob_search` to find files by name or extension before reading them. It supports patterns like `**/*.md` and `**/*.{ts,tsx}`, honors Veloca ignore rules, and returns at most 100 file paths.
- Use `read_file` to read a known text file from the active workspace. Use `offset` and `limit` when reading large files or when you only need a specific section.
- Do not claim that you read an entire file when you only read a line window.
- Use `edit_file` for precise replacements in existing text files. Provide an exact `old_string`, use `replace_all` only when every occurrence should change, and read the file first when you are unsure of the current content.
- Use `write_file` only when the user clearly asks you to create, replace, or save a workspace file. It replaces the full file content, supports filesystem and database workspaces, and is limited to the active workspace.
- Prefer `edit_file` over `write_file` for targeted changes. Before using `write_file`, read the relevant existing file first when updating a file and explain the intended write in your response. Do not use it for speculative drafts when a normal answer would be enough.
- Use `run_bash_command` only when a shell command is necessary to inspect, verify, build, or make a workspace-local change.
- When the user explicitly asks you to run a safe shell command, call `run_bash_command` instead of saying you cannot execute commands.
- For `run_bash_command`, prefer the `cwd` argument over putting `cd ...` in the command. `cwd` may be workspace-relative or an absolute path inside the active workspace.
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
- If the user asks for a rewrite, provide the rewritten result first, then brief notes only when helpful.
```

## 变量替换规则

| Variable | Meaning | Replacement Rule |
| --- | --- | --- |
| `${CURRENTTIME}` | 用户本机当前时间。 | 后端提交 system prompt 前替换为本地时间字符串。 |
| `${CURRENT_FILE_PATH}` | Agent 当前工作的文件位置。 | 从当前 active file metadata 获取。 |
| `${WORKSPACE_ROOT_PATH}` | 当前文件所在工作区根位置。 | 从当前 workspace metadata 获取。 |
| `${WORKSPACE_TYPE}` | 当前工作区类型。 | 使用 `filesystem`、`database` 或无可用工作区时的 `none`。 |
| `${SELECTED_TEXT}` | 用户唤起 Agent 时选中的文本。 | 作为独立上下文字段注入到本轮请求，不放入长期 system prompt。 |

文件系统工作区和数据库工作区的路径语义不同，替换时必须保留这种差异：

- `filesystem` 工作区：
  - `${CURRENT_FILE_PATH}` 是真实本地文件路径。
  - `${WORKSPACE_ROOT_PATH}` 是用户选择的本地工作区目录。
- `database` 工作区：
  - `${CURRENT_FILE_PATH}` 是 `veloca-db://entry/...` 形式的虚拟文件路径。
  - `${WORKSPACE_ROOT_PATH}` 是 `veloca-db://root/...` 形式的虚拟工作区根路径。
  - Agent 不应把这些虚拟路径当成本地文件系统路径处理。

## 第一版注入策略

- 不自动注入完整当前文件全文，避免不必要的 token 消耗和隐私风险。
- 用户选中文本以独立上下文字段发送，并在 system prompt 中说明选区的重要性和边界。
- 当前文件路径、工作区根路径和工作区类型只作为元数据发送。
- Agent session 历史继续由 `otherone-agent` localfile 存储和加载，不写入 Veloca 业务 SQLite 数据。
- 当用户的问题明显依赖工作区内容时，Agent 应优先基于可用上下文或后续 tools 查找相关信息；如果找不到必要信息，再向用户提出聚焦问题。

## 当前接入状态

- 前端在用户唤起 Agent 时快照当前 active file、工作区根路径、工作区类型和选中文本，并随每次 Agent 请求发送给后端。
- 后端在调用 `otherone-agent` 前生成完整 system prompt，并将 `${CURRENTTIME}`、`${CURRENT_FILE_PATH}`、`${WORKSPACE_ROOT_PATH}` 和 `${WORKSPACE_TYPE}` 替换为真实请求值。
- `${SELECTED_TEXT}` 不写入 system prompt，而是以 `<selected-text>` 独立块注入到本轮 user prompt 中。
- 如果没有活动文件或工作区，后端会使用 `No active file`、`No active workspace` 和 `none`，避免 prompt 中残留未替换变量。
- 后端已经暴露只读 tool `get_workspace_directory_tree`，用于获取当前活动工作区目录树。
- 后端已经暴露只读 tool `glob_search`，用于在当前活动工作区内按 glob pattern 查找文件。
- 后端已经暴露只读 tool `read_file`，用于读取当前活动工作区内的文本文件。
- 后端已经暴露写入 tool `edit_file`，用于在当前活动工作区内精确替换已有文本文件内容。
- 后端已经暴露写入 tool `write_file`，用于在当前活动工作区内创建或完整覆盖文本文件。
- 后端已经暴露受沙箱限制的 tool `run_bash_command`，用于在当前文件系统工作区内运行前台 Bash 命令。

## Workspace Directory Tree Tool

`get_workspace_directory_tree` 是第一批 Agent workspace tool。它只读取当前请求上下文中的活动工作区，不接受任意路径参数。

| Field | Description |
| --- | --- |
| Tool name | `get_workspace_directory_tree` |
| 参数 | `input: { velocaignore?: string }` |
| 返回内容 | 当前工作区根路径、当前文件路径、工作区类型、压缩后的目录树、忽略规则和截断统计。 |
| 安全边界 | 只读；只允许读取当前 active workspace root；不会读取文件内容。 |

`velocaignore` 使用 `.gitignore` 风格的基础语义，用于过滤不应进入目录树上下文的目录或文件。最终忽略规则由三部分合并：

- Veloca 内置默认规则。
- 工作区根目录下的 `.velocaignore` 文件。
- tool 调用时传入的 `velocaignore` 参数。

当前基础 `.velocaignore` 重点过滤 `node_modules/`、`.git/`、`.veloca/`、构建产物、缓存、日志、环境变量文件和 SQLite 文件，避免目录树撑爆上下文或暴露不必要的本地配置。

## Glob Search Tool

`glob_search` 用于在当前 active workspace 内按 glob pattern 查找文件。它是只读 tool，不读取文件内容，也不修改工作区。

| Field | Description |
| --- | --- |
| Tool name | `glob_search` |
| 参数 | `input: { pattern: string, path?: string }` |
| 返回内容 | `durationMs`、`numFiles`、`filenames`、`truncated`。 |
| filesystem 路径 | `pattern` 支持工作区相对 glob，也支持 active workspace 内的绝对 glob；`path` 是可选搜索基准目录，必须在 active workspace root 内。 |
| database 路径 | `pattern` 必须是工作区相对 glob；`path` 可为数据库工作区内的相对 folder 或 `veloca-db://entry/...` folder。 |
| 安全边界 | 只搜索当前 active workspace；拒绝 `..` 逃逸、NUL byte、超长 pattern、workspace 外路径和非 folder 搜索基准。 |

`glob_search` 支持 shell 风格 brace expansion，例如 `**/*.{ts,tsx,md}` 会展开为多个 glob pattern。结果会去重，按 filesystem 修改时间倒序返回；database workspace 使用虚拟 entry 的可用时间戳排序。最多返回 100 个文件路径，超出时 `truncated: true`。

它会复用 Veloca 默认忽略规则和工作区 `.velocaignore`，避免把 `node_modules/`、构建产物、缓存、日志和本地配置文件带入 Agent 上下文。

## Read File Tool

`read_file` 用于读取当前 active workspace 内的文本文件。它是只读 tool，不会修改工作区内容。

| Field | Description |
| --- | --- |
| Tool name | `read_file` |
| 参数 | `input: { path: string, offset?: number, limit?: number }` |
| 返回内容 | `type: "text"`、`file.filePath`、`file.content`、`file.numLines`、`file.startLine`、`file.totalLines`。 |
| filesystem 路径 | 支持工作区相对路径或当前工作区内的绝对路径；真实路径解析后必须仍在 active workspace root 内。 |
| database 路径 | 支持 `veloca-db://entry/...` 或数据库工作区内的相对路径；只读取虚拟文件，不读取 folder 或二进制资产。 |
| 安全边界 | 最大 `10MB`；filesystem 读取前检查前 `8192` bytes 是否包含 NUL byte；拒绝二进制文件和 workspace 逃逸路径。 |

`offset` 是 0-based 行偏移，`limit` 是最多读取的行数。读取超出文件尾部时返回空内容，并将 `startLine` 设置为 `totalLines + 1`。

## Edit File Tool

`edit_file` 用于在当前 active workspace 内对已有文本文件执行精确字符串替换。它适合局部修改，不负责创建文件，也不适合整文件覆盖。

| Field | Description |
| --- | --- |
| Tool name | `edit_file` |
| 参数 | `input: { path: string, old_string: string, new_string: string, replace_all?: boolean }` |
| 返回内容 | `filePath`、`oldString`、`newString`、`originalFile`、`structuredPatch`、`userModified: false`、`replaceAll`、`gitDiff: null`、`workspaceType`。 |
| filesystem 路径 | 支持工作区相对路径或当前工作区内的绝对路径；真实路径解析后必须仍在 active workspace root 内，目标必须是已有文件。 |
| database 路径 | 支持 `veloca-db://entry/...` 或数据库工作区内的相对路径；只编辑已有虚拟文件，不编辑 folder，也不创建新 entry。 |
| 安全边界 | 最大 `10MB`；filesystem 读取前检查前 `8192` bytes 是否包含 NUL byte；拒绝二进制文件、workspace 逃逸路径、空 `old_string` 和无意义的相同替换。 |

默认只替换第一个匹配到的 `old_string`。只有当用户明确希望所有匹配项都修改时，才应设置 `replace_all: true`。如果不确定文件当前内容，应先调用 `read_file` 获取足够上下文，再调用 `edit_file`。

## Write File Tool

`write_file` 用于在当前 active workspace 内写入完整文本文件。它是写入类 tool，只有当用户明确要求创建、覆盖或保存文件时才应调用；普通草稿、改写建议或解释类输出应直接回复用户，不应写入磁盘或数据库。

| Field | Description |
| --- | --- |
| Tool name | `write_file` |
| 参数 | `input: { path: string, content: string }` |
| 返回内容 | `type: "create" | "update"`、`filePath`、`content`、`structuredPatch`、`originalFile`、`gitDiff: null`、`workspaceType`。 |
| filesystem 路径 | 支持工作区相对路径或当前工作区内的绝对路径；缺失父目录会自动创建；真实路径解析后必须仍在 active workspace root 内。 |
| database 路径 | 支持已有 `veloca-db://entry/...` 文件路径或数据库工作区内的相对路径；相对路径会创建缺失虚拟 folder，并创建或更新最终文件 entry。 |
| 安全边界 | 最大 `10MB`；拒绝 workspace 逃逸路径、filesystem symlink 逃逸、目录目标、无效数据库路径段和非 active workspace 条目。 |

`write_file` 会完整替换目标文件内容，不是局部 patch 工具。更新已有文件前应优先使用 `read_file` 读取相关内容，避免覆盖用户未纳入上下文的编辑。返回的 `structuredPatch` 是用于审计或 UI 展示的全文件 patch envelope；当前不生成真实 `gitDiff`。

写入成功后，后端会通过 `workspace:changed` IPC 事件广播最新 workspace snapshot。前端通过 `window.veloca.workspace.onChanged(...)` 订阅该事件并刷新文件树，因此 Agent 新建 filesystem 文件或 database 虚拟文件后，左侧 Workspace 会自动更新。

## Bash Command Tool

`run_bash_command` 用于让 Agent 在当前 `filesystem` 工作区内执行必要的前台命令。第一版不支持数据库工作区、不支持后台任务，也不会在缺少 macOS `sandbox-exec` 时降级为不安全执行。

| Field | Description |
| --- | --- |
| Tool name | `run_bash_command` |
| 参数 | `input: { command: string, cwd?: string, timeout?: number, description?: string }` |
| 默认行为 | `cwd` 可为相对当前工作区根目录的路径，也可为当前工作区内的绝对路径；`timeout` 默认 `10000` ms，最大 `120000` ms。 |
| 返回内容 | `ok`、`stdout`、`stderr`、`exitCode`、`interrupted`、`timedOut`、`blocked`、`cwd`、`durationMs`、`outputTruncated`、`sandboxStatus`、`noOutputExpected`。 |
| 安全边界 | macOS sandbox；默认禁网；写入限制在当前工作区；输出按 stdout/stderr 各 `16384` bytes 截断。 |

第一版会直接拦截明显危险或不适合 Agent 自动执行的命令，例如 `sudo`、`su`、`rm -rf`、`git reset --hard`、`git clean`、`diskutil`、`mkfs`、`dd ... of=`、`shutdown`、`reboot`、`launchctl`、`osascript`、`nohup`、`disown` 和后台化命令。被拦截命令会返回 `blocked: true`，不会执行。

当用户明确要求运行安全命令时，后端会在本轮 user prompt 中追加 `<tool-routing-hint>`，提醒模型优先调用 `run_bash_command`，避免模型按通用安全话术回答“无法直接执行命令”。当前仍保持 `toolChoice: "auto"`，因为 `otherone-agent` 会在工具循环中复用同一个 `toolChoice`；如果强制指定 `run_bash_command`，工具执行后续轮次也会被继续强制调用，存在重复执行风险。

`otherone-agent` 当前会通过 `fn(...Object.values(args))` 调用 tool 实现，直接暴露多个顶层参数会受到模型输出 JSON 字段顺序影响。Veloca workspace tools 因此统一使用单个 `input` 对象作为顶层参数，并在后端保留旧顶层参数格式的兼容解析。

## 后续扩展

- 继续设计 workspace tools，例如读取当前文件、读取邻近文件、搜索工作区内容。
- 为数据库工作区提供独立读取工具，避免将 `veloca-db://...` 虚拟路径误用为本地路径。
- 根据任务类型智能注入当前文件全文、当前标题段落、文档大纲或附近上下文。
- 为写入类工具设计权限边界和用户确认机制，避免 Agent 在未确认时直接修改用户文档。
- 为 Bash tool 设计显式网络授权、长任务管理和用户确认流。
- 为附件解析、Web Search 和外部资料检索建立独立上下文层，避免和核心工作区上下文混淆。
