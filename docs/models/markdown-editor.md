# Markdown Editor Model

## Scope

The current Veloca milestone provides the foundation for a Typora-like markdown editor. It includes the Electron desktop shell, React renderer, Node backend surface, SQLite-backed settings persistence, workspace folder persistence, recursive markdown file loading, and a Vditor-powered instant-rendering markdown editor.

## Implemented Architecture

- `app/frontend`: React renderer built with Vite. It owns the visible editor surface, sidebar, status bar, settings panel, and theme interactions.
- `app/backend/electron`: Electron main and preload scripts. The main process creates the desktop window and exposes safe IPC handlers. The preload script exposes a minimal `window.veloca` API to the renderer.
- `app/backend/database`: SQLite connection setup using `better-sqlite3`. Foreign key enforcement is explicitly disabled to match the project database rule.
- `app/backend/services`: Backend service layer for app settings and workspace scanning.
- `vditor`: MIT-licensed markdown editor engine used in `ir` instant-rendering mode to provide the Typora-like writing surface.

## Data Model

### `app_settings`

Stores application-level settings that must persist across sessions.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT` | UUID generated immediately before insert. |
| `setting_key` | `TEXT` | Unique logical key, such as `theme` or `autoSave`. |
| `setting_value` | `TEXT` | Stored value. |
| `created_at` | `INTEGER` | Unix timestamp in milliseconds. |
| `updated_at` | `INTEGER` | Unix timestamp in milliseconds. |

### `workspace_folders`

Stores folders added to the current local workspace. A workspace can contain multiple root folders, similar to the VS Code workspace concept.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT` | UUID generated immediately before insert. |
| `folder_path` | `TEXT` | Unique absolute folder path. |
| `name` | `TEXT` | Display name derived from the folder basename. |
| `status` | `INTEGER` | `0` means active. |
| `created_at` | `INTEGER` | Unix timestamp in milliseconds. |
| `updated_at` | `INTEGER` | Unix timestamp in milliseconds. |

### `virtual_workspaces`

Stores database-backed workspace roots. These roots appear in the same tree as system folders but do not point to a real directory.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT` | UUID generated immediately before insert. |
| `name` | `TEXT` | Display name shown in the workspace tree. |
| `status` | `INTEGER` | `0` means active. |
| `created_at` | `INTEGER` | Unix timestamp in milliseconds. |
| `updated_at` | `INTEGER` | Unix timestamp in milliseconds. |

### `virtual_workspace_entries`

Stores database-backed folders and markdown files inside a virtual workspace root.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT` | UUID generated immediately before insert. |
| `workspace_id` | `TEXT` | Logical root workspace ID. No foreign key constraint is used. |
| `parent_id` | `TEXT` | Logical parent folder ID, or `NULL` for root-level entries. |
| `entry_type` | `INTEGER` | `0` is folder, `1` is markdown file. |
| `name` | `TEXT` | Entry display name. |
| `content` | `TEXT` | Markdown content for database files. Empty for folders. |
| `status` | `INTEGER` | `0` means active. |
| `created_at` | `INTEGER` | Unix timestamp in milliseconds. |
| `updated_at` | `INTEGER` | Unix timestamp in milliseconds. |

## Theme Flow

1. Renderer asks `window.veloca.settings.getTheme()` for the stored theme.
2. Electron main process reads the `theme` record from SQLite.
3. Renderer applies `document.documentElement.dataset.theme`.
4. Setting changes are written back through `settings:set-theme`.

When the app is opened in a normal browser during frontend-only development, the renderer falls back to `localStorage`.

## Editing and Save Flow

1. Renderer opens a markdown file through `window.veloca.workspace.readMarkdown(path)`.
2. The active markdown source is passed into Vditor in `ir` mode with the Vditor cache disabled.
3. Editor input updates renderer state, outline data, word count, character count, and save status.
4. When Auto Save is enabled, input is saved after an 800 ms debounce through `window.veloca.workspace.saveMarkdown(path, content)`.
5. When Auto Save is disabled, `Cmd/Ctrl+S` saves the active file manually.
6. Filesystem markdown is written back to disk only after workspace path and `.md` validation.
7. Database-backed markdown updates `virtual_workspace_entries.content` and `updated_at`.

## Current UI Behavior

- Dark mode is the default.
- The custom title bar no longer renders the prototype logo text or fake status dots, allowing native Electron window controls to stay unobstructed.
- The sidebar switches between `Files` and `Outline`.
- The file tree supports folder expand/collapse and real markdown file switching.
- The `Workspace` toolbar exposes an add-folder action.
- Added folders are persisted in SQLite and reloaded on next launch.
- Database-backed workspace roots can be created directly from the toolbar without selecting a system folder.
- Database-backed roots use a custom folder-with-star icon to keep the same hierarchy as system folders while still being visually distinct.
- Database-backed files and folders are stored in SQLite and participate in the same tree interactions as system files.
- Workspace scanning recursively loads `.md` files only. Common generated folders such as `node_modules`, `.git`, `dist`, `out`, and `release` are skipped.
- The file tree supports a custom context menu for creating files/folders, opening in Finder, copying paths, deleting, renaming, duplicating, copying, cutting, and pasting.
- New files and folders are created with default names directly inside the tree, then immediately enter inline rename mode, matching Typora-style creation behavior.
- Root workspace folders can be removed from the workspace through the context menu.
- Delete operations move files or folders to the system Trash instead of permanently deleting them.
- The editor surface uses Vditor instant-rendering mode for Typora-like single-pane markdown writing.
- The editor saves markdown changes automatically by default and supports manual `Cmd/Ctrl+S` saves.
- The status bar shows save state, word count, character count, and encoding.
- The outline panel reflects the active editor content using a Typora-style indented list without connector lines.
- The Settings entry is placed at the bottom of the sidebar.
- The Settings panel opens as a modal with a blurred overlay.
- The Theme segmented control switches between dark and light modes.
- The Auto Save switch persists the user's preferred save behavior.
- The editor page follows the prototype structure: title bar, file sidebar, editor header, markdown typography, and bottom status bar.

## Next Development Notes

The next practical feature should be image and attachment handling. Before adding it, define local asset storage, image compression rules, and how markdown links should be generated for filesystem and database-backed workspaces.
