# Markdown Editor Model

## Scope

The current Veloca milestone provides the foundation for a Typora-like markdown editor. It includes the Electron desktop shell, React renderer, Node backend surface, SQLite-backed settings persistence, workspace folder persistence, and recursive markdown file loading.

## Implemented Architecture

- `app/frontend`: React renderer built with Vite. It owns the visible editor surface, sidebar, status bar, settings panel, and theme interactions.
- `app/backend/electron`: Electron main and preload scripts. The main process creates the desktop window and exposes safe IPC handlers. The preload script exposes a minimal `window.veloca` API to the renderer.
- `app/backend/database`: SQLite connection setup using `better-sqlite3`. Foreign key enforcement is explicitly disabled to match the project database rule.
- `app/backend/services`: Backend service layer for app settings and workspace scanning.

## Data Model

### `app_settings`

Stores application-level settings that must persist across sessions.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `TEXT` | UUID generated immediately before insert. |
| `setting_key` | `TEXT` | Unique logical key, such as `theme`. |
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

## Theme Flow

1. Renderer asks `window.veloca.settings.getTheme()` for the stored theme.
2. Electron main process reads the `theme` record from SQLite.
3. Renderer applies `document.documentElement.dataset.theme`.
4. Setting changes are written back through `settings:set-theme`.

When the app is opened in a normal browser during frontend-only development, the renderer falls back to `localStorage`.

## Current UI Behavior

- Dark mode is the default.
- The custom title bar no longer renders the prototype logo text or fake status dots, allowing native Electron window controls to stay unobstructed.
- The sidebar switches between `Files` and `Outline`.
- The file tree supports folder expand/collapse and real markdown file switching.
- The `Workspace` toolbar exposes an add-folder action.
- Added folders are persisted in SQLite and reloaded on next launch.
- Workspace scanning recursively loads `.md` files only. Common generated folders such as `node_modules`, `.git`, `dist`, `out`, and `release` are skipped.
- The file tree supports a custom context menu for creating files/folders, opening in Finder, copying paths, deleting, renaming, duplicating, copying, cutting, and pasting.
- Root workspace folders can be removed from the workspace through the context menu.
- Delete operations move files or folders to the system Trash instead of permanently deleting them.
- The outline panel reflects the active document headings using a Typora-style indented list without connector lines.
- The Settings entry is placed at the bottom of the sidebar.
- The Settings panel opens as a modal with a blurred overlay.
- The Theme segmented control switches between dark and light modes.
- The editor page follows the prototype structure: title bar, file sidebar, editor header, markdown typography, and bottom status bar.

## Next Development Notes

The next practical feature should be markdown editing and save behavior. Before adding it, define whether edits are written directly to disk, staged in memory, or saved through a recovery buffer for crash safety.
