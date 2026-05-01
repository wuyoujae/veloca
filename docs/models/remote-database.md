# Remote Database Model - Supabase

本文档记录 Veloca Remote v1 的 Supabase 云端数据库配置方案。

## Product Scope

Remote v1 的目标是让用户在 Settings > Remote 中填写自己的 Supabase 信息，然后由 Veloca 自动创建或连接一个名为 `veloca` 的 Supabase 项目，并初始化 Veloca 云端所需的基础表结构。

当前版本负责远程项目配置、基础 schema 初始化，以及 Remote Sync v1 的配置和后台同步队列。Remote Sync v1 只同步 Veloca 打开或编辑过的本地 Markdown 文件；Veloca 数据库工作区会全量镜像目录、文件、资源和 provenance 数据。

## API Strategy

Supabase 的 JavaScript client `@supabase/supabase-js` 用于连接已有项目的数据 API，不负责创建 Supabase 项目。Veloca 创建项目时使用 Supabase Management API：

- `GET /v1/organizations/{slug}` 校验组织 slug。
- `GET /v1/organizations/{slug}/projects` 查找同组织下是否已有名为 `veloca` 的项目。
- `POST /v1/projects` 创建项目，传入 `name`、`organization_slug`、`db_pass` 和 `region_selection: { type, code }`。
- `GET /v1/projects/{ref}` 轮询项目状态，直到项目为 `ACTIVE` 且 database host 可用。
- `GET /v1/projects/{ref}/api-keys?reveal=true` 获取后续数据访问需要的 publishable / secret key。

Supabase Management API 的 database migration endpoint 目前标注为仅 selected partner OAuth apps 可用，因此 Veloca 不依赖该 endpoint。基础表初始化通过 `pg` 连接 Supabase Postgres 执行 DDL；优先尝试 direct database host，如果本地网络无法稳定连接 direct host，则自动回退到 Supabase pooler host。Pooler fallback 会尝试 `aws-0` 和 `aws-1` 两种 Supabase pooler 前缀，并在 pooler tenant 尚未同步完成时继续重试。

Remote v1 不依赖 `available-regions` endpoint。Settings 面板内置 Supabase 常用 AWS region 列表，并提供手动 region code 输入兜底，避免账号、接口版本或平台权限差异导致地区加载失败。

Remote Sync v1 使用 Supabase JavaScript client 访问数据表和 Storage。资源文件写入私有 bucket `veloca-assets`，文件 metadata 记录在 `veloca_remote_assets` 表中。

## Local Persistence And Security

本地 SQLite 表 `remote_database_configs` 保存单个 Supabase remote 配置：

- `provider` 使用数字枚举，Supabase 为 `1`。
- `project_name` 固定为 `veloca`。
- `status` 使用数字枚举：`0` not configured、`1` configured、`2` creating、`3` waiting、`4` initialized、`5` failed。
- `project_ref`、`project_url`、`database_host`、`publishable_key` 可明文保存。
- Supabase PAT、database password、secret key 必须通过 Electron `safeStorage` 加密后保存。

如果当前系统无法提供 secure credential storage，Veloca 会拒绝保存敏感凭据，并提示用户启用系统钥匙串或凭据服务。Renderer 只接收脱敏状态，例如 `patSaved`、`databasePasswordSaved`、`secretKeySaved`，不会接收明文密钥。Remote 面板会用掩码显示已保存的 PAT 和 database password；提交保存或创建项目时，掩码值不会覆盖本地加密凭据。

Remote Sync 使用两个本地表：

- `remote_sync_configs` 保存同步偏好，布尔值使用 `0/1`，冲突策略固定为数字枚举 `1` keep both。
- `remote_sync_items` 跟踪本地文件系统和数据库工作区同步项，`sync_state` 使用数字枚举：`0` synced、`1` pending push、`2` pending pull、`3` conflict、`4` failed。

## Remote Schema

Remote v1 初始化以下最小表结构：

- `veloca_remote_workspaces`
- `veloca_remote_documents`
- `veloca_remote_assets`
- `veloca_remote_document_provenance`

所有 ID 字段使用 UUID 文本值，由应用写入前生成。状态字段使用数字枚举。表之间只保存逻辑关系字段，例如 `workspace_id`、`document_id`、`parent_id`，不创建数据库外键约束。

Remote Sync v1 会为云端表补充同步元数据字段：`source_type`、`source_key`、`relative_path`、`content_hash`、`deleted_at`、`sync_version`。删除通过 `status=1` 和 `deleted_at` 软删除表示，不物理删除云端数据。

当前 schema 不实现用户身份、权限模型或实时协作。完整多用户权限和 Supabase Realtime 应在后续 Remote Sync 模型中单独设计。

## Remote Sync Settings

Remote 面板的 Sync 区域包含以下配置：

- `Auto Sync` 默认开启，控制自动拉取和推送。
- `Pull on Startup` 默认开启，应用启动或 Remote 初始化后拉取云端变更。
- `Push on Save` 默认开启，保存文档后推送变更。
- `Sync Local Opened/Edited Markdown` 默认开启，只跟踪 Veloca 打开或编辑过的本地 Markdown。
- `Sync Veloca Database Workspaces` 默认开启且不可关闭，数据库工作区全量镜像到云端。
- `Sync Assets` 默认开启，同步数据库资产和已跟踪本地 Markdown 引用的资源文件。
- `Sync Provenance Metadata` 默认开启，同步 provenance snapshots。
- `Sync Deletes` 默认开启，删除同步为软删除。
- `Conflict Policy` v1 固定为 `Keep Both`。本地文件冲突时在原目录创建 `*.remote-conflict-YYYYMMDD-HHmmss.md`。
- `Manual Sync Now` 和 `Retry Failed Items` 可手动触发同步或重试失败队列。

## User Flow

1. 用户打开 Settings > Remote。
2. 用户输入 Supabase PAT、organization slug 和 database password。
3. 用户从内置地区下拉框选择常用 Supabase region，或手动输入 region code。
4. 用户点击 `Create / Connect Veloca Project`。
5. Veloca 主进程加密保存敏感信息。
6. Veloca 校验组织并查找同名项目；存在则复用，不存在则使用该 region code 创建。
7. Veloca 等待项目 ready，直连 Postgres 初始化基础表。
8. Veloca 保存项目 ref、URL、host 和 API key 状态。
9. 如果 Remote Sync 开启，Veloca 启动后台同步队列；启动时拉取，保存后推送。

## Validation

开发验收至少覆盖：

- Settings 侧边栏只展示 `Editor`、`AI Model`、`Remote`、`Account` 和 `About Veloca`。
- Remote 面板不会回填 PAT、database password 或 secret key 明文。
- 无效 PAT 或组织 slug 会失败，并在面板显示错误状态。
- 有效配置会创建或复用 `veloca` Supabase 项目。
- Supabase SQL editor 能看到 Veloca remote 基础表。
- 重启应用后 Remote 面板只显示脱敏状态和项目连接信息。
- Remote Sync 配置保存后能恢复默认开启状态。
- 打开或保存本地 Markdown 后会进入同步队列。
- 数据库工作区变更会触发全量镜像推送。
- 同步失败不阻塞编辑，Remote 面板显示失败数量并允许 retry。
