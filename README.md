# Veloca

Veloca is an early-stage desktop markdown editor inspired by Typora. The goal is to provide a focused writing experience where markdown content feels close to the final rendered document while still being practical for local desktop workflows.

The current version is a foundation build. It includes the Electron desktop shell, React renderer, Node backend entry point, SQLite-backed settings persistence, and the first editor interface based on the provided prototype.

## Project Overview

Veloca is positioned as a clean, desktop-first markdown editor. Its first core use case is simple: open the app, write or preview markdown, and control the editor appearance without visual clutter.

The project currently focuses on the base application architecture and visual system. Full document editing, file persistence, export, search, and synchronization are planned follow-up modules.

## Project Approach

Veloca separates desktop, backend, and renderer responsibilities:

- Electron owns the native window, lifecycle, and secure bridge between UI and backend code.
- React owns the interactive editor interface.
- Node services own persistent application behavior.
- SQLite stores local application data with a minimal schema aligned to current requirements.

This keeps the first version small while leaving a clear path for future markdown file management, editor engine integration, and local document persistence.

## Core Features

- Electron desktop app shell with a custom title bar.
- React-based editor layout matching the prototype direction.
- Interactive sidebar with Files and Outline modes.
- Collapsible file tree with local document switching.
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
3. Use the `Files` tab to collapse and expand folders.
4. Select different markdown files and confirm the editor content and breadcrumb update.
5. Switch to `Outline` and select headings to confirm the active outline state changes.
6. Click `Settings` in the sidebar.
7. Switch between `Dark` and `Light`.
8. Close and reopen the app, then confirm the selected theme is restored.

Automated unit and integration tests should be added when real markdown editing, file IO, and persistence workflows are implemented.

## Usage Examples

At this stage, Veloca opens to a sample markdown manifesto page. The left sidebar can switch between a collapsible file tree and a document outline. Selecting files updates the preview and breadcrumb, while the settings panel can be opened from the bottom-left sidebar button to change appearance.

## Roadmap

- Completed: project scaffold, Electron shell, React UI, SQLite settings storage, theme switching, file tree interactions, and outline interactions.
- Next: real markdown editor engine integration.
- Next: local file open/save workflows.
- Next: workspace folder indexing and real file tree.
- Next: markdown export and search.
- Later: plugin or extension system if product requirements justify it.

## FAQ

### Is Veloca production-ready?

No. This is the initial foundation build. It is suitable for continuing development, not for end-user release.

### Why is SQLite already included?

Theme settings need durable local persistence. The schema is intentionally small and can evolve only when new backend behavior requires it.

### Why does the editor show sample content?

The current task is the application framework and frontend design. Real markdown editing and file IO are planned as the next feature layer.

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
