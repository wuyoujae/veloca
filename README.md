# Veloca

Veloca is an early-stage desktop markdown editor inspired by Typora. The goal is to provide a focused writing experience where markdown content feels close to the final rendered document while still being practical for local desktop workflows.

The current version is a foundation build. It includes the Electron desktop shell, React renderer, Node backend entry point, SQLite-backed settings persistence, persisted workspace folders, recursive markdown loading, and the first editor interface based on the provided prototype.

## Project Overview

Veloca is positioned as a clean, desktop-first markdown editor. Its first core use case is simple: open the app, write or preview markdown, and control the editor appearance without visual clutter.

The project currently focuses on the base application architecture and visual system. Full document editing, file persistence, export, search, and synchronization are planned follow-up modules.

## Project Approach

Veloca separates desktop, backend, and renderer responsibilities:

- Electron owns the native window, lifecycle, and secure bridge between UI and backend code.
- React owns the interactive editor interface.
- Node services own persistent application behavior.
- SQLite stores local application data with a minimal schema aligned to current requirements, including app settings and workspace folder roots.

This keeps the first version small while leaving a clear path for future markdown file management, editor engine integration, and local document persistence.

## Core Features

- Electron desktop app shell with a custom title bar.
- React-based editor layout matching the prototype direction.
- Interactive sidebar with Files and Outline modes.
- Collapsible workspace file tree with real folder loading.
- VS Code-style workspace roots where multiple folders can be added.
- Database-backed workspace roots for quick projects that do not need a system folder.
- Recursive `.md` file discovery from added folders.
- Custom file tree context menu for common system-level operations.
- Typora-style markdown preview surface.
- Settings modal with polished dark/light theme switching.
- SQLite-backed app setting storage for theme persistence.
- Toast message component for user feedback.

## Tech Stack

- Frontend: React, TypeScript, Vite, Lucide React, CSS
- Desktop shell: Electron, electron-vite
- Backend: Node.js, TypeScript
- Database: SQLite through `better-sqlite3`
- Build tools: TypeScript, Vite, electron-vite
- Testing: not configured yet; this foundation milestone is verified through typecheck and production build

## Project Structure

```text
.
├── app
│   ├── backend
│   │   ├── database
│   │   ├── electron
│   │   └── services
│   ├── frontend
│   │   └── src
│   ├── selection
│   └── test
├── docs
│   └── models
├── propertypes
├── resources
├── electron.vite.config.ts
├── package.json
└── tsconfig.json
```

## Quick Start

Install dependencies:

```bash
npm install
```

Start the desktop app in development mode:

```bash
npm run dev
```

Build the project:

```bash
npm run build
```

Preview the built Electron app:

```bash
npm run preview
```

## Configuration

Copy `.env.example` if you need local configuration:

```bash
cp .env.example .env
```

Available environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `VELOCA_DB_NAME` | `veloca.sqlite` | SQLite database file name stored inside Electron's user data directory. |

Workspace folders are stored in SQLite. Markdown file content from system folders is read from disk only after selecting a file in the tree. Database-backed workspaces store their virtual folders and markdown files directly in SQLite.

## Development Guide

All application code lives under `app`.

- Put renderer code in `app/frontend`.
- Put Electron and Node backend code in `app/backend`.
- Put uncertain temporary implementation work in `app/selection`, then move it once ownership is clear.
- Put tests and test helpers in `app/test`.
- Keep feature documentation in `docs/models`, organized by business model.

Database design should stay minimal and match the backend logic being implemented. Do not add speculative tables or fields before the related business behavior exists.

## Testing Guide

The current foundation can be checked with:

```bash
npm run typecheck
npm run build
```

Manual acceptance checks:

1. Run `npm run dev`.
2. Confirm the Electron window opens with the Veloca editor layout.
3. Click the add-folder icon beside `Workspace`.
4. Select a folder that contains `.md` files.
5. Click the new-workspace icon beside `Workspace` and create a database-backed workspace.
6. Confirm the database-backed workspace uses a folder-with-star icon that differs from system folders.
7. Confirm only markdown files appear as files under system folders.
8. Use the `Files` tab to collapse and expand folders.
9. Right-click a folder and try `New File` or `New Folder`; confirm a default item appears in the tree and enters inline rename mode.
10. Right-click a file and try `Rename`, `Duplicate`, `Copy Path`, or `Reveal in Finder`.
11. Right-click a root workspace folder and confirm `Remove from Workspace` is available.
12. Select different markdown files and confirm the editor content and breadcrumb update.
13. Switch to `Outline` and select headings to confirm the active outline state changes and scroll behavior.
14. Click `Settings` in the sidebar.
15. Switch between `Dark` and `Light`.
16. Close and reopen the app, then confirm workspace folders, database-backed workspaces, and the selected theme are restored.

Automated unit and integration tests should be added when real markdown editing, file IO, and persistence workflows are implemented.

## Usage Examples

At this stage, Veloca starts with an empty workspace until folders are added or database-backed workspaces are created. Use the folder button in the `Workspace` toolbar to add one or more system folders, or use the new-workspace button to create a workspace stored entirely in SQLite. Veloca recursively scans system roots and shows only `.md` files as files. Selecting a markdown file updates the preview, breadcrumb, status bar, and outline. Right-click file tree items to create, rename, duplicate, copy, cut, paste, reveal, delete, or remove workspace roots.

## Roadmap

- Completed: project scaffold, Electron shell, React UI, SQLite settings storage, theme switching, persisted workspace folders, database-backed workspaces, recursive markdown discovery, file tree interactions, custom file context menu, and outline interactions.
- Next: markdown editor engine integration.
- Next: local file save workflows.
- Next: workspace folder indexing and real file tree.
- Next: markdown export and search.
- Later: plugin or extension system if product requirements justify it.

## FAQ

### Is Veloca production-ready?

No. This is the initial foundation build. It is suitable for continuing development, not for end-user release.

### Why is SQLite already included?

Theme settings need durable local persistence. The schema is intentionally small and can evolve only when new backend behavior requires it.

### Why do no files appear after launch?

Veloca now loads real markdown files from added workspace folders. Click the add-folder icon beside `Directory` and choose a folder that contains `.md` files.

## Contribution Guide

Use small, focused commits. Keep changes aligned with the requested feature and update the relevant documentation when behavior or architecture changes.

Recommended commit style:

```text
feat: add markdown editor foundation
fix: persist editor theme setting
docs: document markdown editor model
```

## License

MIT
