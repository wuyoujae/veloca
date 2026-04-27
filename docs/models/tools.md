根据代码库中的 `mvp_tool_specs()` 函数，系统总共定义了 **40 个工具**，分为以下几个主要类别 [1](#3-0) 。

---

## 📁 文件操作工具 (6个)
- **`read_file`** - 读取工作区中的文本文件，支持分页 [2](#3-1) 
- **`write_file`** - 在工作区中写入文本文件 [3](#3-2) 
- **`edit_file`** - 替换工作区文件中的文本 [4](#3-3) 
- **`glob_search`** - 通过 glob 模式查找文件 [5](#3-4) 
- **`grep_search`** - 使用正则表达式搜索文件内容 [6](#3-5) 

## 🌐 网络工具 (2个)
- **`WebFetch`** - 获取 URL 内容并转换为可读文本 [7](#3-6) 
- **`WebSearch`** - 搜索网络信息并返回引用结果 [8](#3-7) 

## 🛠️ 系统执行工具 (3个)
- **`bash`** - 在当前工作区执行 shell 命令 [9](#3-8) 
- **`PowerShell`** - 执行 PowerShell 命令 [10](#3-9) 
- **`REPL`** - 在 REPL 子进程中执行代码 [11](#3-10) 

## 📋 任务管理工具 (6个)
- **`TaskCreate`** - 创建后台任务 [12](#3-11) 
- **`TaskGet`** - 获取任务状态和详情 [13](#3-12) 
- **`TaskList`** - 列出所有后台任务 [14](#3-13) 
- **`TaskStop`** - 停止运行中的任务 [15](#3-14) 
- **`TaskUpdate`** - 向运行中的任务发送消息或更新 [16](#3-15) 
- **`TaskOutput`** - 检索后台任务的输出 [17](#3-16) 

## 👥 工作进程工具 (7个)
- **`WorkerCreate`** - 创建编码工作进程 [18](#3-17) 
- **`WorkerGet`** - 获取工作进程状态 [19](#3-18) 
- **`WorkerAwaitReady`** - 等待工作进程就绪 [20](#3-19) 
- **`WorkerSendPrompt`** - 向工作进程发送任务提示 [21](#3-20) 
- **`WorkerRestart`** - 重启工作进程 [22](#3-21) 
- **`WorkerTerminate`** - 终止工作进程 [23](#3-22) 
- **`WorkerObserveCompletion`** - 报告会话完成状态 [24](#3-23) 

## 🏗️ 团队协作工具 (2个)
- **`TeamCreate`** - 创建子代理团队 [25](#3-24) 
- **`TeamDelete`** - 删除团队并停止所有任务 [26](#3-25) 

## ⏰ 定时任务工具 (3个)
- **`CronCreate`** - 创建定时任务 [27](#3-26) 
- **`CronDelete`** - 删除定时任务 [28](#3-27) 
- **`CronList`** - 列出所有定时任务 [28](#3-27) 

## 🔍 开发工具 (1个)
- **`LSP`** - 查询语言服务器协议获取代码智能 [29](#3-28) 

## 🔌 MCP 工具 (4个)
- **`ListMcpResources`** - 列出 MCP 服务器资源 [30](#3-29) 
- **`ReadMcpResource`** - 读取 MCP 服务器资源 [31](#3-30) 
- **`McpAuth`** - MCP 服务器身份验证 [32](#3-31) 
- **`MCP`** - 执行 MCP 服务器工具 [33](#3-32) 

## 🎯 生产力工具 (10个)
- **`TodoWrite`** - 更新结构化任务列表 [34](#3-33) 
- **`Skill`** - 加载本地技能定义 [35](#3-34) 
- **`Agent`** - 启动专业代理任务 [36](#3-35) 
- **`ToolSearch`** - 搜索延迟或专业工具 [37](#3-36) 
- **`NotebookEdit`** - 编辑 Jupyter 笔记本 [38](#3-37) 
- **`Sleep`** - 等待指定时间 [39](#3-38) 
- **`SendUserMessage`** - 向用户发送消息 [40](#3-39) 
- **`Config`** - 获取或设置 Claude Code 配置 [41](#3-40) 
- **`EnterPlanMode`** - 启用规划模式 [42](#3-41) 
- **`ExitPlanMode`** - 退出规划模式 [43](#3-42) 

## 🔧 系统工具 (6个)
- **`StructuredOutput`** - 返回结构化输出 [44](#3-43) 
- **`AskUserQuestion`** - 向用户提问并等待响应 [45](#3-44) 
- **`RemoteTrigger`** - 触发远程操作或 webhook [46](#3-45) 
- **`TestingPermission`** - 测试权限强制执行行为 [47](#3-46) 

## 权限分类
所有工具都按权限模式分类：
- **`ReadOnly`** - 只读权限（如 read_file、WebSearch）
- **`WorkspaceWrite`** - 工作区写权限（如 write_file、TodoWrite）
- **`DangerFullAccess`** - 完全访问权限（如 bash、Agent、WorkerCreate） [48](#3-47) 

## Notes
- 部分工具（如 `AskUserQuestion`、`RemoteTrigger`）仍为有限实现或存根响应 [49](#3-48) 
- `Brief` 是执行别名而非独立工具规范 [50](#3-49) 
- 所有工具都通过 `execute_tool_with_enforcer()` 统一执行，包含权限检查 [51](#3-50) 

Wiki pages you might want to explore:
- [Repository Structure (ultraworkers/claw-code)](/wiki/ultraworkers/claw-code#1.2)

### Citations

**File:** rust/crates/tools/src/lib.rs (L385-1172)
```rust
pub fn mvp_tool_specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: "bash",
            description: "Execute a shell command in the current workspace.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "timeout": { "type": "integer", "minimum": 1 },
                    "description": { "type": "string" },
                    "run_in_background": { "type": "boolean" },
                    "dangerouslyDisableSandbox": { "type": "boolean" },
                    "namespaceRestrictions": { "type": "boolean" },
                    "isolateNetwork": { "type": "boolean" },
                    "filesystemMode": { "type": "string", "enum": ["off", "workspace-only", "allow-list"] },
                    "allowedMounts": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "read_file",
            description: "Read a text file from the workspace.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "offset": { "type": "integer", "minimum": 0 },
                    "limit": { "type": "integer", "minimum": 1 }
                },
                "required": ["path"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "write_file",
            description: "Write a text file in the workspace.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["path", "content"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "edit_file",
            description: "Replace text in a workspace file.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "old_string": { "type": "string" },
                    "new_string": { "type": "string" },
                    "replace_all": { "type": "boolean" }
                },
                "required": ["path", "old_string", "new_string"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "glob_search",
            description: "Find files by glob pattern.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string" }
                },
                "required": ["pattern"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "grep_search",
            description: "Search file contents with a regex pattern.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string" },
                    "path": { "type": "string" },
                    "glob": { "type": "string" },
                    "output_mode": { "type": "string" },
                    "-B": { "type": "integer", "minimum": 0 },
                    "-A": { "type": "integer", "minimum": 0 },
                    "-C": { "type": "integer", "minimum": 0 },
                    "context": { "type": "integer", "minimum": 0 },
                    "-n": { "type": "boolean" },
                    "-i": { "type": "boolean" },
                    "type": { "type": "string" },
                    "head_limit": { "type": "integer", "minimum": 1 },
                    "offset": { "type": "integer", "minimum": 0 },
                    "multiline": { "type": "boolean" }
                },
                "required": ["pattern"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "WebFetch",
            description:
                "Fetch a URL, convert it into readable text, and answer a prompt about it.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "format": "uri" },
                    "prompt": { "type": "string" }
                },
                "required": ["url", "prompt"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "WebSearch",
            description: "Search the web for current information and return cited results.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "minLength": 2 },
                    "allowed_domains": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "blocked_domains": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "TodoWrite",
            description: "Update the structured task list for the current session.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "content": { "type": "string" },
                                "activeForm": { "type": "string" },
                                "status": {
                                    "type": "string",
                                    "enum": ["pending", "in_progress", "completed"]
                                }
                            },
                            "required": ["content", "activeForm", "status"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["todos"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "Skill",
            description: "Load a local skill definition and its instructions.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "skill": { "type": "string" },
                    "args": { "type": "string" }
                },
                "required": ["skill"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "Agent",
            description: "Launch a specialized agent task and persist its handoff metadata.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "description": { "type": "string" },
                    "prompt": { "type": "string" },
                    "subagent_type": { "type": "string" },
                    "name": { "type": "string" },
                    "model": { "type": "string" }
                },
                "required": ["description", "prompt"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "ToolSearch",
            description: "Search for deferred or specialized tools by exact name or keywords.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "max_results": { "type": "integer", "minimum": 1 }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "NotebookEdit",
            description: "Replace, insert, or delete a cell in a Jupyter notebook.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "notebook_path": { "type": "string" },
                    "cell_id": { "type": "string" },
                    "new_source": { "type": "string" },
                    "cell_type": { "type": "string", "enum": ["code", "markdown"] },
                    "edit_mode": { "type": "string", "enum": ["replace", "insert", "delete"] }
                },
                "required": ["notebook_path"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "Sleep",
            description: "Wait for a specified duration without holding a shell process.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "duration_ms": { "type": "integer", "minimum": 0 }
                },
                "required": ["duration_ms"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "SendUserMessage",
            description: "Send a message to the user.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "message": { "type": "string" },
                    "attachments": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "status": {
                        "type": "string",
                        "enum": ["normal", "proactive"]
                    }
                },
                "required": ["message", "status"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "Config",
            description: "Get or set Claude Code settings.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "setting": { "type": "string" },
                    "value": {
                        "type": ["string", "boolean", "number"]
                    }
                },
                "required": ["setting"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "EnterPlanMode",
            description: "Enable a worktree-local planning mode override and remember the previous local setting for ExitPlanMode.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "ExitPlanMode",
            description: "Restore or clear the worktree-local planning mode override created by EnterPlanMode.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            required_permission: PermissionMode::WorkspaceWrite,
        },
        ToolSpec {
            name: "StructuredOutput",
            description: "Return structured output in the requested format.",
            input_schema: json!({
                "type": "object",
                "additionalProperties": true
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "REPL",
            description: "Execute code in a REPL-like subprocess.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "code": { "type": "string" },
                    "language": { "type": "string" },
                    "timeout_ms": { "type": "integer", "minimum": 1 }
                },
                "required": ["code", "language"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "PowerShell",
            description: "Execute a PowerShell command with optional timeout.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "timeout": { "type": "integer", "minimum": 1 },
                    "description": { "type": "string" },
                    "run_in_background": { "type": "boolean" }
                },
                "required": ["command"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "AskUserQuestion",
            description: "Ask the user a question and wait for their response.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "question": { "type": "string" },
                    "options": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
                },
                "required": ["question"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "TaskCreate",
            description: "Create a background task that runs in a separate subprocess.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "description": { "type": "string" }
                },
                "required": ["prompt"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "RunTaskPacket",
            description: "Create a background task from a structured task packet.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "objective": { "type": "string" },
                    "scope": { "type": "string" },
                    "repo": { "type": "string" },
                    "branch_policy": { "type": "string" },
                    "acceptance_tests": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "commit_policy": { "type": "string" },
                    "reporting_contract": { "type": "string" },
                    "escalation_policy": { "type": "string" }
                },
                "required": [
                    "objective",
                    "scope",
                    "repo",
                    "branch_policy",
                    "acceptance_tests",
                    "commit_policy",
                    "reporting_contract",
                    "escalation_policy"
                ],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "TaskGet",
            description: "Get the status and details of a background task by ID.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" }
                },
                "required": ["task_id"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "TaskList",
            description: "List all background tasks and their current status.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "TaskStop",
            description: "Stop a running background task by ID.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" }
                },
                "required": ["task_id"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "TaskUpdate",
            description: "Send a message or update to a running background task.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" },
                    "message": { "type": "string" }
                },
                "required": ["task_id", "message"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "TaskOutput",
            description: "Retrieve the output produced by a background task.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": { "type": "string" }
                },
                "required": ["task_id"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "WorkerCreate",
            description: "Create a coding worker boot session with trust-gate and prompt-delivery guards.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "cwd": { "type": "string" },
                    "trusted_roots": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "auto_recover_prompt_misdelivery": { "type": "boolean" }
                },
                "required": ["cwd"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "WorkerGet",
            description: "Fetch the current worker boot state, last error, and event history.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "worker_id": { "type": "string" }
                },
                "required": ["worker_id"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "WorkerObserve",
            description: "Feed a terminal snapshot into worker boot detection to resolve trust gates, ready handshakes, and prompt misdelivery.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "worker_id": { "type": "string" },
                    "screen_text": { "type": "string" }
                },
                "required": ["worker_id", "screen_text"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "WorkerResolveTrust",
            description: "Resolve a detected trust prompt so worker boot can continue.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "worker_id": { "type": "string" }
                },
                "required": ["worker_id"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "WorkerAwaitReady",
            description: "Return the current ready-handshake verdict for a coding worker.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "worker_id": { "type": "string" }
                },
                "required": ["worker_id"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "WorkerSendPrompt",
            description: "Send a task prompt only after the worker reaches ready_for_prompt; can replay a recovered prompt.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "worker_id": { "type": "string" },
                    "prompt": { "type": "string" },
                    "task_receipt": {
                        "type": "object",
                        "properties": {
                            "repo": { "type": "string" },
                            "task_kind": { "type": "string" },
                            "source_surface": { "type": "string" },
                            "expected_artifacts": {
                                "type": "array",
                                "items": { "type": "string" }
                            },
                            "objective_preview": { "type": "string" }
                        },
                        "required": ["repo", "task_kind", "source_surface", "objective_preview"],
                        "additionalProperties": false
                    }
                },
                "required": ["worker_id"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "WorkerRestart",
            description: "Restart worker boot state after a failed or stale startup.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "worker_id": { "type": "string" }
                },
                "required": ["worker_id"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "WorkerTerminate",
            description: "Terminate a worker and mark the lane finished from the control plane.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "worker_id": { "type": "string" }
                },
                "required": ["worker_id"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "WorkerObserveCompletion",
            description: "Report session completion to the worker, classifying finish_reason into Finished or Failed (provider-degraded). Use after the opencode session completes to advance the worker to its terminal state.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "worker_id": { "type": "string" },
                    "finish_reason": { "type": "string" },
                    "tokens_output": { "type": "integer", "minimum": 0 }
                },
                "required": ["worker_id", "finish_reason", "tokens_output"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "TeamCreate",
            description: "Create a team of sub-agents for parallel task execution.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "tasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "prompt": { "type": "string" },
                                "description": { "type": "string" }
                            },
                            "required": ["prompt"]
                        }
                    }
                },
                "required": ["name", "tasks"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "TeamDelete",
            description: "Delete a team and stop all its running tasks.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "team_id": { "type": "string" }
                },
                "required": ["team_id"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "CronCreate",
            description: "Create a scheduled recurring task.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "schedule": { "type": "string" },
                    "prompt": { "type": "string" },
                    "description": { "type": "string" }
                },
                "required": ["schedule", "prompt"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "CronDelete",
            description: "Delete a scheduled recurring task by ID.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "cron_id": { "type": "string" }
                },
                "required": ["cron_id"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "CronList",
            description: "List all scheduled recurring tasks.",
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "LSP",
            description: "Query Language Server Protocol for code intelligence (symbols, references, diagnostics).",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["symbols", "references", "diagnostics", "definition", "hover"] },
                    "path": { "type": "string" },
                    "line": { "type": "integer", "minimum": 0 },
                    "character": { "type": "integer", "minimum": 0 },
                    "query": { "type": "string" }
                },
                "required": ["action"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "ListMcpResources",
            description: "List available resources from connected MCP servers.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "server": { "type": "string" }
                },
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "ReadMcpResource",
            description: "Read a specific resource from an MCP server by URI.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "server": { "type": "string" },
                    "uri": { "type": "string" }
                },
                "required": ["uri"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::ReadOnly,
        },
        ToolSpec {
            name: "McpAuth",
            description: "Authenticate with an MCP server that requires OAuth or credentials.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "server": { "type": "string" }
                },
                "required": ["server"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "RemoteTrigger",
            description: "Trigger a remote action or webhook endpoint.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string" },
                    "method": { "type": "string", "enum": ["GET", "POST", "PUT", "DELETE"] },
                    "headers": { "type": "object" },
                    "body": { "type": "string" }
                },
                "required": ["url"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "MCP",
            description: "Execute a tool provided by a connected MCP server.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "server": { "type": "string" },
                    "tool": { "type": "string" },
                    "arguments": { "type": "object" }
                },
                "required": ["server", "tool"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
        ToolSpec {
            name: "TestingPermission",
            description: "Test-only tool for verifying permission enforcement behavior.",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string" }
                },
                "required": ["action"],
                "additionalProperties": false
            }),
            required_permission: PermissionMode::DangerFullAccess,
        },
    ]
}
```

**File:** rust/crates/tools/src/lib.rs (L1193-1217)
```rust
fn execute_tool_with_enforcer(
    enforcer: Option<&PermissionEnforcer>,
    name: &str,
    input: &Value,
) -> Result<String, String> {
    match name {
        "bash" => {
            // Parse input to get the command for permission classification
            let bash_input: BashCommandInput = from_value(input)?;
            let classified_mode = classify_bash_permission(&bash_input.command);
            maybe_enforce_permission_check_with_mode(enforcer, name, input, classified_mode)?;
            run_bash(bash_input)
        }
        "read_file" => {
            maybe_enforce_permission_check(enforcer, name, input)?;
            from_value::<ReadFileInput>(input).and_then(run_read_file)
        }
        "write_file" => {
            maybe_enforce_permission_check(enforcer, name, input)?;
            from_value::<WriteFileInput>(input).and_then(run_write_file)
        }
        "edit_file" => {
            maybe_enforce_permission_check(enforcer, name, input)?;
            from_value::<EditFileInput>(input).and_then(run_edit_file)
        }
```

**File:** PARITY.md (L145-152)
```markdown
## Tool Surface: 40 exposed tool specs on `main`

- `mvp_tool_specs()` in `rust/crates/tools/src/lib.rs` exposes **40** tool specs.
- Core execution is present for `bash`, `read_file`, `write_file`, `edit_file`, `glob_search`, and `grep_search`.
- Existing product tools in `mvp_tool_specs()` include `WebFetch`, `WebSearch`, `TodoWrite`, `Skill`, `Agent`, `ToolSearch`, `NotebookEdit`, `Sleep`, `SendUserMessage`, `Config`, `EnterPlanMode`, `ExitPlanMode`, `StructuredOutput`, `REPL`, and `PowerShell`.
- The 9-lane push replaced pure fixed-payload stubs for `Task*`, `Team*`, `Cron*`, `LSP`, and MCP tools with registry-backed handlers on `main`.
- `Brief` is handled as an execution alias in `execute_tool()`, but it is not a separately exposed tool spec in `mvp_tool_specs()`.

```

**File:** PARITY.md (L153-159)
```markdown
### Still limited or intentionally shallow

- `AskUserQuestion` still returns a pending response payload rather than real interactive UI wiring.
- `RemoteTrigger` remains a stub response.
- `TestingPermission` remains test-only.
- Task, team, cron, MCP, and LSP are no longer just fixed-payload stubs in `execute_tool()`, but several remain registry-backed approximations rather than full external-runtime integrations.
- Bash deep validation remains branch-only until `36dac6c` is merged.
```
