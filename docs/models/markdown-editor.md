# Markdown Editor Model

## Scope

The current Veloca milestone provides the foundation for a Typora-like markdown editor. It includes the Electron desktop shell, React renderer, Node backend surface, SQLite-backed settings persistence, and the first editor-facing interface based on the provided prototype files.

## Implemented Architecture

- `app/frontend`: React renderer built with Vite. It owns the visible editor surface, sidebar, status bar, settings panel, and theme interactions.
- `app/backend/electron`: Electron main and preload scripts. The main process creates the desktop window and exposes safe IPC handlers. The preload script exposes a minimal `window.veloca` API to the renderer.
- `app/backend/database`: SQLite connection setup using `better-sqlite3`. Foreign key enforcement is explicitly disabled to match the project database rule.
- `app/backend/services`: Backend service layer for app settings.

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
- The file tree supports folder expand/collapse and local document switching.
- The outline panel reflects the active document headings and marks the selected heading.
- The Settings entry is placed at the bottom of the sidebar.
- The Settings panel opens as a modal with a blurred overlay.
- The Theme segmented control switches between dark and light modes.
- The editor page follows the prototype structure: title bar, file sidebar, editor header, markdown typography, and bottom status bar.

## Next Development Notes

The next practical feature should be real markdown editing and file IO. Before adding it, define the minimum file model and decide whether the first iteration edits a single local file, a workspace folder, or a database-backed document.
