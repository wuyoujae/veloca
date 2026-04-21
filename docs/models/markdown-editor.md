# Markdown Editor Model

## Scope

The current Veloca milestone provides a Typora-like markdown editor with rich Markdown rendering. It now includes the Electron desktop shell, React renderer, Node backend surface, SQLite-backed settings persistence, workspace folder persistence, recursive markdown file loading, a TipTap-powered rich editor, and a dual-workspace asset pipeline for images, audio, video, formulas, tables, and safe HTML embeds.

## Implemented Architecture

- `app/frontend`: React renderer built with Vite. It owns the visible editor surface, sidebar, status bar, settings panel, and theme interactions.
- `app/backend/electron`: Electron main and preload scripts. The main process creates the desktop window and exposes safe IPC handlers. The preload script exposes a minimal `window.veloca` API to the renderer.
- `app/backend/database`: SQLite connection setup using `better-sqlite3`. Foreign key enforcement is explicitly disabled to match the project database rule.
- `app/backend/services`: Backend service layer for app settings and workspace scanning.
- `tiptap`: MIT-licensed rich-text editor engine used as the writing surface, with `@tiptap/markdown` as the primary Markdown bridge.
- `veloca-asset://`: A custom read-only Electron protocol that serves local media from either filesystem workspaces or SQLite-backed workspaces.

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

### `virtual_workspace_assets`

Stores database-backed binary assets that belong to markdown documents in virtual workspaces.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT` | UUID generated immediately before insert. |
| `workspace_id` | `TEXT` | Logical root workspace ID. No foreign key constraint is used. |
| `document_entry_id` | `TEXT` | Logical markdown document entry ID. |
| `asset_path` | `TEXT` | Relative path stored in markdown such as `./note.assets/uuid-image.png`. |
| `file_name` | `TEXT` | Stored asset file name. |
| `mime_type` | `TEXT` | Media MIME type. |
| `byte_size` | `INTEGER` | Asset byte size. |
| `binary_content` | `BLOB` | Binary asset payload. |
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
2. The active markdown source is loaded into TipTap using `contentType: 'markdown'`.
3. TipTap rich nodes are serialized back into Markdown through `editor.getMarkdown()`.
4. Renderer state updates outline data, word count, character count, and save status.
5. When Auto Save is enabled, input is saved after an 800 ms debounce through `window.veloca.workspace.saveMarkdown(path, content)`.
6. When Auto Save is disabled, `Cmd/Ctrl+S` saves the active file manually.
7. Filesystem markdown is written back to disk only after workspace path and `.md` validation.
8. Database-backed markdown updates `virtual_workspace_entries.content` and `updated_at`.
9. Media files dropped or pasted into the editor are persisted through `workspace:save-asset` and inserted back into the document as Markdown or safe HTML-backed rich nodes.
10. Relative media paths are resolved into renderable URLs through `workspace:resolve-asset`, then served through `veloca-asset://`.
11. The editor header exposes a manual save button, and Auto Save reuses that same button for animated `Saving` and `Saved` feedback instead of showing a separate label.

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
- The editor surface uses TipTap with `@tiptap/markdown`, rich Markdown extensions, and no visible third-party toolbar.
- The editor visuals are fully styled through Veloca's existing theme tokens and layout rules instead of a third-party skin.
- List items and blockquotes use tighter paragraph spacing so Typora-style writing does not open oversized gaps after line breaks.
- Typora-style table authoring is supported: typing a single header row such as `| Head 1 | Head 2 |` in a normal paragraph and pressing `Enter` immediately converts it into a rendered table, auto-inserting the standard Markdown separator row and an empty body row.
- The editor supports richer Markdown blocks including tables, task lists, code highlighting, inline and block LaTeX formulas, emoji input, images, audio, video, iframe embeds, and safe HTML `details` blocks.
- Filesystem workspaces save pasted or dropped media beside the current markdown file in a `<document>.assets` directory and keep relative markdown paths.
- Database-backed workspaces store pasted or dropped media inside SQLite and resolve them through the same asset protocol used by renderer media nodes.
- The editor saves markdown changes automatically by default and supports manual `Cmd/Ctrl+S` saves.
- The editor header shows both the current file path and a single save button that reflects auto-save activity through its own animated state changes.
- The status bar shows save state, word count, character count, and encoding.
- The outline panel reflects the active editor content using a Typora-style indented list without connector lines, and heading labels are derived from parsed Markdown tokens so escaped punctuation renders correctly.
- The Settings entry is placed at the bottom of the sidebar.
- The Settings panel opens as a modal with a blurred overlay.
- The Theme segmented control switches between dark and light modes.
- The Auto Save switch persists the user's preferred save behavior.
- The editor page follows the prototype structure: title bar, file sidebar, editor header, markdown typography, and bottom status bar.

## Next Development Notes

The next practical feature after this milestone should be richer import/export and search. Image and attachment handling is now implemented, so the next design work should focus on format interoperability, document discovery, and longer-document authoring ergonomics.
