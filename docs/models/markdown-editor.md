# Markdown 编辑器模型 - 多标签文件打开与切换

本文档描述编辑器中“顶部标签栏 + 多文件编辑”交互的行为。

## 打开文件与标签

- 文件树点击某个 Markdown 文件时，采用“打开/聚焦”策略：
  - 如果该文件已在 `openTabs` 中，直接激活该标签并恢复该标签的 `draftContent`；
  - 否则读取文件后新增标签，并设为激活标签。
- 由 `openTabs: OpenEditorTab[]` 与 `activeTabPath: string | null` 统一管理当前打开集合和当前激活文件。
- `activeFile` 不再作为独立状态维护，始终由 `activeTabPath` 在 `openTabs` 中派生。

## 草稿与切换

- 切换标签时不弹出“放弃修改”确认框，当前标签草稿会被保留在内存中。
- 每个标签保存三类状态：
  - `draftContent`：编辑缓冲内容；
  - `savedContent`：上次成功保存的内容；
  - `status`：`saving` / `saved` / `unsaved` / `failed`。
- `updateDocumentContent` 每次编辑时同时更新 `documentContent` 与对应标签的 `draftContent`。

## 关闭标签

- 每个标签右侧带关闭按钮（`X`）。
- 关闭未保存标签时弹出确认对话框：
  - `status === 'unsaved'` 提示并要求确认后可关闭；
  - 其他状态直接关闭。
- 关闭激活标签后自动激活相邻标签（优先同位，找不到则回退到前一项）；若已无剩余标签则清空编辑器。
- 关闭后清理状态：`activeTabPath`、`documentContent`、`saveStatus` 与标签集合保持一致。

## 保存

- 保存逻辑始终作用于当前激活标签：
  - 手动保存按钮、快捷键保存、自动保存都只保存激活标签；
  - 保存成功后更新该标签的 `savedContent` 与 `draftContent` 状态同步；
  - 自动保存状态监听与 `activeTabPath` 绑定。

## 工作区刷新同步

- `workspace.refresh` 后会对 `openTabs` 做收敛：
  - 在新快照中不存在的路径会移除；
- 若文件重命名，使用旧路径与新路径进行映射后更新该标签元信息。
- 若当前激活标签仍存在则保留激活，不存在则回退到最近可用标签；若无可用标签则清空编辑区。
