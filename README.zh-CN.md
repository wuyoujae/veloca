<p align="center">
  <a href="https://github.com/wuyoujae/veloca">
    <img src="resources/logo.svg" alt="Veloca" width="128" />
  </a>
</p>

<h1 align="center">Veloca</h1>

<p align="center">
  一个桌面优先的 Markdown 编辑器，灵感来自 Typora，面向专注写作、本地工作区和更丰富的 Markdown 文档体验。
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="https://nodejs.org/"><img alt="Node.js >= 18" src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" /></a>
  <a href="https://www.electronjs.org/"><img alt="Electron 33" src="https://img.shields.io/badge/electron-33.x-9feaf9.svg" /></a>
  <img alt="Status: early development" src="https://img.shields.io/badge/status-early%20development-orange.svg" />
</p>

<p align="center">
  <a href="README.md">English</a>
  ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

---

## 项目概览

Veloca 是一个早期阶段的桌面 Markdown 编辑器。它的核心目标是提供类似 Typora 的写作界面，让 Markdown 内容尽量接近最终渲染效果，同时保留桌面应用需要的实际工作流：本地文件夹、数据库工作区、富媒体内容、源码编辑和私有版本管理。

当前项目是一个用于继续产品开发的基础版本。它已经包含 Electron 桌面外壳、React 渲染层、Node 后端服务、SQLite 持久化、工作区管理、基于 TipTap 的富文本 Markdown 编辑、本地资源处理、早期 Agent 对话框、GitHub 版本管理能力，以及 Remote Supabase 配置路径。

Veloca 目前还不是生产可用版本。它适合本地开发、产品迭代和技术验证。

## 项目方案

Veloca 采用清晰的职责拆分：

| 区域 | 职责 |
| --- | --- |
| Electron 外壳 | 原生窗口生命周期、单实例启动、安全 preload 桥接、本地协议处理和跨平台桌面打包。 |
| React 渲染层 | 编辑器 UI、工作区导航、设置面板、富 Markdown 交互和用户反馈。 |
| Node 后端服务 | 文件系统访问、SQLite 持久化、敏感凭据加密、GitHub 集成、远程同步编排和 Agent 运行时集成。 |
| SQLite | 本地设置、工作区根目录、数据库工作区、文档元数据、同步状态和 Veloca 自有版本管理映射。 |
| 影子 Git 仓库 | 为 Veloca 保存过的本地 Markdown 文件提供私有版本历史，不修改用户自己的 Git 仓库。 |

编辑器使用 TipTap，是因为它采用 MIT 许可证、扩展能力强，并且能让 Veloca 控制最终写作体验。数据库 schema 保持最小化，只围绕已经实现的后端行为设计，不提前设计尚未进入当前业务范围的未来模块。

## 核心功能

### 已实现

- Electron 桌面应用，包含平台适配的标题栏行为和单实例启动。
- React Markdown 编辑器界面，包含文件侧边栏、大纲侧边栏、Git 侧边栏、状态栏和设置弹窗。
- 支持多个本地文件系统工作区根目录。
- 支持存储在 SQLite 中的虚拟工作区，适合不想创建系统文件夹的场景。
- 对已添加的本地工作区递归发现 `.md` 文件。
- 文件树支持创建、重命名、复制副本、复制、剪切、粘贴、删除、定位和移除工作区根目录。
- 支持未命名 Markdown 标签页，只有在用户选择工作区内保存位置后才落盘。
- 基于 TipTap 的富 Markdown 编辑体验，并使用 Veloca 自有样式。
- 每个文件独立支持渲染视图和源码视图切换。
- 支持多标签编辑和左右双栏分屏编辑。
- 富 Markdown 支持表格、任务列表、Mermaid 图表、代码高亮、数学公式、emoji、链接、图片、音频、视频、YouTube 嵌入和 iframe 嵌入。
- 本地文件系统文档通过相邻 `.assets` 文件夹保存资源。
- 数据库工作区资源通过 SQLite 保存，并由本地 Electron protocol 提供访问。
- 默认开启 Auto Save，同时支持 `Cmd/Ctrl+S` 手动保存。
- 主题设置、Auto Save 偏好、工作区根目录和远程同步状态都持久化到 SQLite。
- Agent 对话框原型，支持选中文本上下文、后端流式回复、会话处理、AI 内容插入和生成内容 provenance 元数据。
- GitHub OAuth device flow 基础设施。
- 通过名为 `veloca-version-manager` 的私有 GitHub 仓库管理 Veloca 自有 Markdown 版本。
- Remote Supabase 配置，包含本地加密凭据保存、云端表初始化和同步偏好。
- About 面板展示应用版本、更新检查、GitHub 链接和开源许可证说明。

### 计划中

- Markdown 导出工作流。
- 搜索和导航能力增强。
- 只有在后续产品需求明确时才考虑插件或扩展系统。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面端 | Electron 33, electron-vite, electron-builder |
| 前端 | React 18, TypeScript, Vite, Lucide React, TipTap, Mermaid, KaTeX, Shiki, DOMPurify, Marked, CSS |
| 后端 | Node.js, TypeScript, Electron main process services, isomorphic-git, `pg`, `@supabase/supabase-js`, `otherone-agent` |
| 数据库 | SQLite，通过 `better-sqlite3` 使用 |
| 测试 | Node.js test runner (`node --test`) |
| 构建与发布 | TypeScript, Vite, electron-vite, electron-builder, GitHub Actions |
| 国际化 | 暂未配置 |
| 许可证 | MIT |

> 项目说明中提到 Next.js 作为目标技术栈，但当前仓库实际实现是 Electron + Vite + React。本 README 以当前真实代码为准。

## 项目结构

```text
.
├── app
│   ├── backend
│   │   ├── database          # SQLite 连接和持久化辅助逻辑
│   │   ├── electron          # Electron main/preload 入口
│   │   └── services          # 工作区、同步、版本管理、设置、Agent 和应用信息服务
│   ├── frontend
│   │   └── src               # React 渲染层、编辑器 UI、富 Markdown、Agent 对话框和样式
│   ├── selection             # 归属尚未确定时的临时实现区域
│   └── test                  # Node 测试文件
├── docs
│   └── models                # 按业务模型组织的功能文档
├── propertypes               # 前端开发参考的原型设计
├── resources                 # 图标、Logo 和应用资源
├── .github
│   └── workflows             # GitHub Actions 发布工作流
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

## 快速开始

### 环境要求

- Node.js 18 或更高版本。
- npm。
- Electron 支持的桌面操作系统。

### 安装依赖

```bash
npm install
```

### 配置环境变量

```bash
cp .env.example .env
```

如果只是进行基础的本地编辑器开发，默认配置已经足够。AI、GitHub 和 Remote 功能需要额外凭据。

### 开发模式运行

```bash
npm run dev
```

### 构建项目

```bash
npm run build
```

### 预览构建产物

```bash
npm run preview
```

### 生成桌面安装包

根据目标平台运行对应命令：

```bash
npm run package:mac
npm run package:win
npm run package:linux
```

生成的桌面产物会写入 `release/`，该目录已被 Git 忽略。

## 配置说明

运行时配置从 `.env.example` 开始：

| 变量 | 示例默认值 | 说明 |
| --- | --- | --- |
| `VELOCA_DB_NAME` | `veloca.sqlite` | SQLite 数据库文件名，存储在 Electron user data 目录内。 |
| `VELOCA_AGENT_BASE_URL` | `https://openrouter.ai/api/v1` | Agent 模型服务的 base URL。 |
| `VELOCA_AGENT_MODEL` | `google/gemini-3.1-flash-lite-preview` | 默认 Agent 模型。应用内 Settings 可以覆盖该值。 |
| `VELOCA_AGENT_API_KEY` | `your-openrouter-api-key` | 后端 Agent 服务使用的 API Key。 |
| `VELOCA_AGENT_CONTEXT_WINDOW` | `128000` | Agent 运行时使用的上下文窗口大小。 |
| `VELOCA_WEB_SEARCH_BASE_URL` | `https://html.duckduckgo.com/html/` | Agent Web Search 工具路径使用的搜索端点。 |
| `VELOCA_GITHUB_CLIENT_ID` | `your-github-oauth-app-client-id` | GitHub OAuth App client ID，用于 device-flow 账号绑定和 Veloca 版本管理。 |

本地用户偏好、工作区根目录、数据库工作区文档、版本管理映射和同步队列会保存在 Electron user data 目录下的 SQLite 数据库中。

Remote Supabase 的敏感值在 `Settings > Remote` 中配置。Supabase personal access token、database password 和 secret key 会先通过 Electron secure storage 加密，再保存到本地。渲染层只接收脱敏后的状态值。

## 开发指南

请保持仓库边界清晰：

- 渲染层代码放在 `app/frontend`。
- Electron 和 Node 后端代码放在 `app/backend`。
- 归属暂不确定的临时实现放在 `app/selection`，确认后再移动到正确目录。
- 测试与测试辅助代码放在 `app/test`。
- 功能文档放在 `docs/models`，按业务模型组织。
- 应用资源放在 `resources`。

开发原则：

- 改动要小，并且直接对应当前产品行为。
- 不添加 speculative 的数据库字段、表、服务或抽象。
- 不创建数据库外键约束，只使用逻辑关系字段。
- ID 字段使用 UUID，状态和枚举字段优先使用数字值。
- 运行时可配置项放入 `.env`，并同步维护 `.env.example`。
- `.gitignore` 要覆盖生成产物、凭据和本地专用文件。
- 新增前端界面前，先参考现有原型和 UI 习惯。

当前功能模型文档包括：

- `docs/models/markdown-editor.md`
- `docs/models/agent-runtime.md`
- `docs/models/remote-database.md`
- `docs/models/version-management.md`
- `docs/models/release-pipeline.md`
- `docs/models/app-about-updates.md`
- `docs/models/tools.md`
- `docs/models/agent-context.md`

## 测试指南

运行自动化检查：

```bash
npm run typecheck
npm run test
npm run build
```

运行发布前检查：

```bash
npm run release:check
```

编辑器手动验收建议：

1. 运行 `npm run dev`。
2. 确认 Electron 窗口打开后显示 Veloca 编辑器布局。
3. 添加一个包含 `.md` 文件的本地工作区文件夹。
4. 创建一个数据库工作区。
5. 打开、编辑、保存、关闭并重新打开 Markdown 文件。
6. 在同一文件中切换渲染视图和源码视图。
7. 插入标题、列表、表格、任务列表、Mermaid 图表、代码块、数学公式、图片和媒体嵌入。
8. 测试 Auto Save 和 `Cmd/Ctrl+S` 手动保存。
9. 使用文件树右键菜单测试创建、重命名、复制副本、复制路径、定位、删除和移除工作区。
10. 使用分屏模式打开两个文件，确认每个面板保留自己的视图状态。
11. 切换亮色和暗色主题，确认富 Markdown 内容仍然可读。
12. 重启应用，确认工作区根目录、数据库工作区、偏好设置和保存内容都能恢复。

Remote 和 GitHub 功能需要有效外部凭据。请只使用专门用于开发测试的账号和项目进行验证。

## 使用示例

### 打开本地 Markdown 工作区

1. 运行 `npm run dev` 启动 Veloca。
2. 点击 `Workspace` 旁边的添加文件夹按钮。
3. 选择一个包含 Markdown 文件的文件夹。
4. 从侧边栏选择一个 `.md` 文件。
5. 在渲染视图中编辑，或从编辑器顶部切换到源码视图。

### 创建数据库工作区

1. 点击 `Workspace` 旁边的新建工作区操作。
2. 创建一个 Veloca 数据库工作区。
3. 在该工作区中添加 Markdown 文件。
4. 保存并重启应用，确认该工作区能从 SQLite 恢复。

### 插入富 Markdown 内容

- 在编辑器中输入 `/` 打开命令菜单。
- 使用 `/m` 插入 Mermaid 图表。
- 使用 `/t` 插入表格。
- 粘贴或拖拽本地媒体到文档中以保存资源。

### 使用 Veloca 版本管理

1. 在 `.env` 中配置 `VELOCA_GITHUB_CLIENT_ID`。
2. 当账号 UI 启用时，通过 device authorization flow 绑定 GitHub 账号。
3. 在 Git 侧边栏中创建私有仓库 `veloca-version-manager`。
4. 通过 Veloca 保存本地文件系统中的 Markdown 文件。
5. 从影子仓库提交并推送 Veloca 管理的 Markdown 副本。

Veloca 不会在用户工作区内创建、读取或修改 `.git` 目录。

## 发布流程

发布前先运行：

```bash
npm run release:check
```

创建版本提交和标签：

```bash
npm run release:patch
# 或
npm run release:minor
# 或
npm run release:major
```

推送当前分支和标签：

```bash
npm run release:push
```

推送 `v*` 标签会触发 `.github/workflows/build.yml`。工作流会构建 Linux x64、Windows x64、macOS arm64 和 macOS x64 产物，然后创建带自动生成 release notes 的 GitHub Draft Release。

## 路线图

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 桌面外壳和编辑器基础 | 已完成 | Electron 外壳、React 渲染层、SQLite 持久化、工作区根目录和富 Markdown 编辑已就位。 |
| 工作区和文件操作 | 已完成 | 本地文件夹、数据库工作区、文件树操作、未命名文件和保存流程已实现。 |
| 富 Markdown 编辑 | 已完成 | TipTap 渲染、源码模式、Mermaid、表格、媒体、数学公式、代码和分屏编辑已实现。 |
| 版本管理 | 进行中 | 影子仓库和 GitHub 私有仓库流程已存在，账号 UI 正在重新打磨。 |
| Remote Sync | 进行中 | Supabase 配置和同步偏好已存在，更完整的冲突处理和协作行为后续继续演进。 |
| 导出和搜索 | 计划中 | Markdown 导出和搜索是下一批产品模块。 |
| 插件系统 | 后续评估 | 只有在产品需求明确时才添加。 |

## FAQ

<details>
<summary><strong>Veloca 现在可以用于生产吗？</strong></summary>

不可以。Veloca 仍处于早期开发阶段，适合本地开发和功能验证，还不适合面向终端用户大规模发布。
</details>

<details>
<summary><strong>为什么 Veloca 使用 SQLite？</strong></summary>

SQLite 可以为 Veloca 提供稳定的本地状态存储，用于设置、工作区、数据库文档、同步元数据和版本管理映射，同时不要求用户额外运行数据库服务。
</details>

<details>
<summary><strong>Veloca 会修改我自己的 Git 仓库吗？</strong></summary>

不会。Veloca 版本管理使用 Electron user data 目录内的独立影子仓库，并且可以把副本推送到名为 `veloca-version-manager` 的私有 GitHub 仓库。它不会在用户工作区内创建或修改 `.git` 文件夹。
</details>

<details>
<summary><strong>为什么启动后没有文件？</strong></summary>

Veloca 默认不会自动打开任何工作区。你需要添加一个包含 `.md` 文件的文件夹，或者从 Workspace 工具栏创建数据库工作区。
</details>

<details>
<summary><strong>为什么开发模式窗口可能需要等一会儿才出现？</strong></summary>

`npm run dev` 会同时启动 Vite 渲染层和 Electron 外壳。Veloca 会在渲染层准备好后再显示原生窗口，避免先展示未渲染的空白窗口。
</details>

<details>
<summary><strong>功能文档应该放在哪里？</strong></summary>

功能文档应该放在 `docs/models`，并按业务模型拆分。当行为、架构或开发方式变化时，需要同步更新相关文档。
</details>

## 贡献指南

Veloca 目前仍是早期项目。贡献应保持小范围、聚焦，并且对应明确的产品或工程目标。

推荐流程：

1. 阅读 `docs/models` 中相关的功能文档。
2. 保持代码改动只围绕当前需求。
3. 行为变化时添加或更新测试。
4. 实现细节、配置或用户流程变化时更新文档。
5. 提交 PR 前运行 `npm run typecheck`、`npm run test` 和 `npm run build`。

推荐提交格式：

```text
feat: add markdown editor foundation
feat: integrate tiptap markdown editing
fix: persist editor theme setting
docs: document markdown editor model
```

## 许可证

Veloca 使用 [MIT License](LICENSE) 开源。
