# Remote Database Model - Supabase

本文档记录 Veloca Remote v1 的 Supabase 云端数据库配置方案。

## Product Scope

Remote v1 的目标是让用户在 Settings > Remote 中填写自己的 Supabase 信息，然后由 Veloca 自动创建或连接一个名为 `veloca` 的 Supabase 项目，并初始化 Veloca 云端所需的基础表结构。

当前版本只负责远程项目配置与基础 schema 初始化，不执行本地 SQLite 数据同步，也不迁移已有本地工作区或文档内容。

## API Strategy

Supabase 的 JavaScript client `@supabase/supabase-js` 用于连接已有项目的数据 API，不负责创建 Supabase 项目。Veloca 创建项目时使用 Supabase Management API：

- `GET /v1/organizations/{slug}` 校验组织 slug。
- `GET /v1/organizations/{slug}/projects` 查找同组织下是否已有名为 `veloca` 的项目。
- `POST /v1/projects` 创建项目，传入 `name`、`organization_slug`、`db_pass` 和 `region_selection: { type, code }`。
- `GET /v1/projects/{ref}` 轮询项目状态，直到项目为 `ACTIVE` 且 database host 可用。
- `GET /v1/projects/{ref}/api-keys?reveal=true` 获取后续数据访问需要的 publishable / secret key。

Supabase Management API 的 database migration endpoint 目前标注为仅 selected partner OAuth apps 可用，因此 Veloca 不依赖该 endpoint。基础表初始化通过 `pg` 直连 Supabase Postgres 执行 DDL。

Remote v1 不依赖 `available-regions` endpoint。Settings 面板内置 Supabase 常用 AWS region 列表，并提供手动 region code 输入兜底，避免账号、接口版本或平台权限差异导致地区加载失败。

## Local Persistence And Security

本地 SQLite 表 `remote_database_configs` 保存单个 Supabase remote 配置：

- `provider` 使用数字枚举，Supabase 为 `1`。
- `project_name` 固定为 `veloca`。
- `status` 使用数字枚举：`0` not configured、`1` configured、`2` creating、`3` waiting、`4` initialized、`5` failed。
- `project_ref`、`project_url`、`database_host`、`publishable_key` 可明文保存。
- Supabase PAT、database password、secret key 必须通过 Electron `safeStorage` 加密后保存。

如果当前系统无法提供 secure credential storage，Veloca 会拒绝保存敏感凭据，并提示用户启用系统钥匙串或凭据服务。Renderer 只接收脱敏状态，例如 `patSaved`、`databasePasswordSaved`、`secretKeySaved`，不会接收明文密钥。Remote 面板会用掩码显示已保存的 PAT 和 database password；提交保存或创建项目时，掩码值不会覆盖本地加密凭据。

## Remote Schema

Remote v1 初始化以下最小表结构：

- `veloca_remote_workspaces`
- `veloca_remote_documents`
- `veloca_remote_assets`
- `veloca_remote_document_provenance`

所有 ID 字段使用 UUID 文本值，由应用写入前生成。状态字段使用数字枚举。表之间只保存逻辑关系字段，例如 `workspace_id`、`document_id`、`parent_id`，不创建数据库外键约束。

当前 schema 只覆盖远程存储的基础能力。完整同步、冲突处理、用户身份、权限模型、存储桶上传策略和增量合并策略应在后续 Remote Sync 模型中单独设计。

## User Flow

1. 用户打开 Settings > Remote。
2. 用户输入 Supabase PAT、organization slug 和 database password。
3. 用户从内置地区下拉框选择常用 Supabase region，或手动输入 region code。
4. 用户点击 `Create / Connect Veloca Project`。
5. Veloca 主进程加密保存敏感信息。
6. Veloca 校验组织并查找同名项目；存在则复用，不存在则使用该 region code 创建。
7. Veloca 等待项目 ready，直连 Postgres 初始化基础表。
8. Veloca 保存项目 ref、URL、host 和 API key 状态。

## Validation

开发验收至少覆盖：

- Settings 侧边栏只展示 `Editor`、`AI Model`、`Remote`、`Account` 和 `About Veloca`。
- Remote 面板不会回填 PAT、database password 或 secret key 明文。
- 无效 PAT 或组织 slug 会失败，并在面板显示错误状态。
- 有效配置会创建或复用 `veloca` Supabase 项目。
- Supabase SQL editor 能看到 Veloca remote 基础表。
- 重启应用后 Remote 面板只显示脱敏状态和项目连接信息。
