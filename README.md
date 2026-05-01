<p align="center">
  <a href="https://github.com/wuyoujae/veloca">
    <img src="resources/logo.svg" alt="Veloca" width="128" />
  </a>
</p>

<h1 align="center">Veloca</h1>

<p align="center">
  A desktop-first Markdown editor inspired by Typora, built for focused writing, local workspaces, and richer Markdown documents.
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

## Project Overview

Veloca is an early-stage desktop Markdown editor. Its core goal is to provide a Typora-like writing surface where Markdown stays close to the final rendered document while still giving users practical desktop workflows: local folders, database-backed workspaces, rich media, source editing, and private version management.

The project is currently a foundation build for continued product development. It already includes the Electron desktop shell, React renderer, Node backend services, SQLite persistence, workspace management, TipTap-based rich editing, local asset handling, an early Agent palette, GitHub-backed Veloca version management, and Remote Supabase configuration.

Veloca is not production-ready yet. It is suitable for local development, product iteration, and technical validation.

## Project Approach

Veloca is designed around a clear separation of responsibility:

| Area | Responsibility |
| --- | --- |
| Electron shell | Native window lifecycle, single-instance behavior, secure preload bridge, local protocol handling, and platform-specific desktop packaging. |
| React renderer | Editor UI, workspace navigation, settings panels, rich Markdown interactions, and user feedback. |
| Node backend services | Filesystem access, SQLite persistence, encrypted credential handling, GitHub integration, remote sync orchestration, and Agent runtime integration. |
| SQLite | Local settings, workspace roots, database-backed workspaces, document metadata, sync state, and Veloca-owned version-management mappings. |
| Shadow Git repository | Private version history for Veloca-saved local Markdown files without touching the user's own Git repositories. |

The editor uses TipTap because it is MIT licensed, extensible, and gives Veloca control over the final writing experience. The database schema is intentionally minimal and follows implemented backend behavior instead of speculative future modules.

## Core Features

### Implemented

- Electron desktop application with platform-aware title bar behavior and single-instance startup.
- React-based Markdown editor interface with a file sidebar, outline sidebar, Git sidebar, status bar, and settings modal.
- Multi-root workspace support for local filesystem folders.
- SQLite-backed virtual workspaces for users who do not want to create a system folder.
- Recursive `.md` discovery in added local workspace folders.
- File tree interactions for creating, renaming, duplicating, copying, cutting, pasting, deleting, revealing, and removing workspace roots.
- Untitled Markdown tabs that are saved only after the user chooses a workspace-scoped destination.
- TipTap-powered rich Markdown editing with Veloca-native styling.
- Per-file rendered/source view switching.
- Multi-tab editing and two-pane split editing.
- Rich Markdown support for tables, task lists, Mermaid diagrams, syntax-highlighted code blocks, math, emoji, links, images, audio, video, YouTube embeds, and iframe embeds.
- Local asset persistence for filesystem documents through sibling `.assets` folders.
- SQLite asset persistence for database-backed workspaces through a local Electron protocol.
- Auto Save enabled by default, plus manual save with `Cmd/Ctrl+S`.
- Theme settings, Auto Save preference, workspace roots, and remote sync state persisted in SQLite.
- Agent palette prototype with selected-text context, streaming backend integration, session handling, AI insertion, and provenance metadata for generated content.
- GitHub OAuth device-flow infrastructure.
- Veloca-owned Markdown version management through a private GitHub repository named `veloca-version-manager`.
- Remote Supabase configuration with encrypted local credential storage, cloud table initialization, and sync preferences.
- About panel with app version details, update checks, GitHub link, and open-source license disclosure.

### Planned

- Markdown export workflows.
- Search and navigation improvements.
- A plugin or extension system only if later product requirements justify it.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Desktop | Electron 33, electron-vite, electron-builder |
| Frontend | React 18, TypeScript, Vite, Lucide React, TipTap, Mermaid, KaTeX, Shiki, DOMPurify, Marked, CSS |
| Backend | Node.js, TypeScript, Electron main process services, isomorphic-git, `pg`, `@supabase/supabase-js`, `otherone-agent` |
| Database | SQLite through `better-sqlite3` |
| Testing | Node.js test runner (`node --test`) |
| Build and release | TypeScript, Vite, electron-vite, electron-builder, GitHub Actions |
| Internationalization | Not configured yet |
| License | MIT |

> The project instructions mention Next.js as a target stack, but the current repository implementation is Electron + Vite + React. This README documents the code that currently exists.

## Project Structure

```text
.
├── app
│   ├── backend
│   │   ├── database          # SQLite connection and persistence helpers
│   │   ├── electron          # Electron main/preload entry points
│   │   └── services          # Backend services for workspace, sync, versioning, settings, Agent, and app info
│   ├── frontend
│   │   └── src               # React renderer, editor UI, rich Markdown, Agent palette, and styles
│   ├── selection             # Temporary implementation area when ownership is not settled
│   └── test                  # Node test files
├── docs
│   └── models                # Feature-model documentation
├── propertypes               # Prototype designs used as frontend references
├── resources                 # Icons, logo, and application assets
├── .github
│   └── workflows             # GitHub Actions release workflow
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Quick Start

### Requirements

- Node.js 18 or newer.
- npm.
- A desktop operating system supported by Electron.

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
```

For basic local editor development, the defaults are enough. AI, GitHub, and Remote features require additional credentials.

### Run in Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Preview the Built App

```bash
npm run preview
```

### Create Desktop Packages

Run the package command that matches the target platform:

```bash
npm run package:mac
npm run package:win
npm run package:linux
```

Generated desktop artifacts are written to `release/`, which is ignored by Git.

## Configuration

Runtime configuration starts from `.env.example`:

| Variable | Default example | Description |
| --- | --- | --- |
| `VELOCA_DB_NAME` | `veloca.sqlite` | SQLite database file name stored inside Electron's user data directory. |
| `VELOCA_AGENT_BASE_URL` | `https://openrouter.ai/api/v1` | Base URL for the Agent model provider. |
| `VELOCA_AGENT_MODEL` | `google/gemini-3.1-flash-lite-preview` | Default Agent model. Settings inside the app can override this value. |
| `VELOCA_AGENT_API_KEY` | `your-openrouter-api-key` | API key used by the backend Agent service. |
| `VELOCA_AGENT_CONTEXT_WINDOW` | `128000` | Context window used by the Agent runtime. |
| `VELOCA_WEB_SEARCH_BASE_URL` | `https://html.duckduckgo.com/html/` | Search endpoint used by the Agent web-search tool path. |
| `VELOCA_GITHUB_CLIENT_ID` | `your-github-oauth-app-client-id` | GitHub OAuth App client ID for device-flow account binding and Veloca version management. |

Local user preferences, workspace roots, database-backed documents, version-management mappings, and sync queues are stored in SQLite under Electron's user data directory.

Sensitive Remote Supabase values are configured inside `Settings > Remote`. Supabase personal access tokens, database passwords, and secret keys are encrypted with Electron secure storage before being saved locally. The renderer receives only desensitized status values.

## Development Guide

Use the repository boundaries consistently:

- Put renderer code in `app/frontend`.
- Put Electron and Node backend code in `app/backend`.
- Put temporary uncertain implementation work in `app/selection`, then move it once ownership is clear.
- Put tests and test helpers in `app/test`.
- Keep feature documentation in `docs/models`, organized by business model.
- Keep app assets in `resources`.

Development principles:

- Keep changes small and tied to current product behavior.
- Do not add speculative database fields, tables, services, or abstractions.
- Do not create database foreign key constraints; use logical relationship fields instead.
- Use UUIDs for ID fields and numeric values for status or enum fields.
- Store configurable runtime values in `.env` and keep `.env.example` updated.
- Keep `.gitignore` aligned with generated output, credentials, and local-only files.
- Reference existing prototype and UI patterns before adding frontend surfaces.

Feature model documents currently include:

- `docs/models/markdown-editor.md`
- `docs/models/agent-runtime.md`
- `docs/models/remote-database.md`
- `docs/models/version-management.md`
- `docs/models/release-pipeline.md`
- `docs/models/app-about-updates.md`
- `docs/models/tools.md`
- `docs/models/agent-context.md`

## Testing Guide

Run the automated checks:

```bash
npm run typecheck
npm run test
npm run build
```

Run the release-readiness check:

```bash
npm run release:check
```

Manual acceptance checks for the editor:

1. Run `npm run dev`.
2. Confirm the Electron window opens to the Veloca editor layout.
3. Add a local workspace folder containing `.md` files.
4. Create a database-backed workspace.
5. Open, edit, save, close, and reopen Markdown files.
6. Switch the same file between rendered mode and source mode.
7. Insert headings, lists, tables, task lists, Mermaid diagrams, code blocks, math, images, and media embeds.
8. Test Auto Save and manual save with `Cmd/Ctrl+S`.
9. Use the file tree context menu for create, rename, duplicate, copy path, reveal, delete, and remove workspace flows.
10. Open two files in split editor mode and confirm each pane keeps its own view state.
11. Toggle light and dark theme and confirm rich Markdown content remains readable.
12. Restart the app and confirm workspace roots, database workspaces, preferences, and saved content are restored.

Remote and GitHub features require valid external credentials. Test those flows only with accounts and projects intended for development.

## Usage Examples

### Open a Local Markdown Workspace

1. Start Veloca with `npm run dev`.
2. Click the add-folder button next to `Workspace`.
3. Select a folder that contains Markdown files.
4. Choose a `.md` file from the sidebar.
5. Edit in rendered mode or switch to source mode from the editor header.

### Create a Database-Backed Workspace

1. Click the new-workspace action beside `Workspace`.
2. Create a Veloca database workspace.
3. Add Markdown files inside that workspace.
4. Save and reopen the app to confirm the workspace is restored from SQLite.

### Insert Rich Markdown

- Type `/` in the editor to open the command menu.
- Use `/m` for Mermaid diagrams.
- Use `/t` for a table.
- Paste or drag local media into the document to persist assets.

### Use Veloca Version Management

1. Configure `VELOCA_GITHUB_CLIENT_ID` in `.env`.
2. Bind a GitHub account through the device authorization flow when the account UI is enabled.
3. Create the private `veloca-version-manager` repository from the Git sidebar.
4. Save local filesystem Markdown files through Veloca.
5. Commit and push Veloca-managed Markdown copies from the shadow repository.

Veloca does not create, read, or modify `.git` directories inside user workspace folders.

## Release Workflow

Before releasing, run:

```bash
npm run release:check
```

Create a version commit and tag:

```bash
npm run release:patch
# or
npm run release:minor
# or
npm run release:major
```

Push the current branch and tags:

```bash
npm run release:push
```

Pushing a `v*` tag triggers `.github/workflows/build.yml`. The workflow builds Linux x64, Windows x64, macOS arm64, and macOS x64 artifacts, then creates a draft GitHub Release with generated release notes.

## Roadmap

| Stage | Status | Notes |
| --- | --- | --- |
| Desktop shell and editor foundation | Complete | Electron shell, React renderer, SQLite persistence, workspace roots, and rich Markdown editing are in place. |
| Workspace and file operations | Complete | Local folders, database workspaces, file tree actions, untitled files, and save flows are implemented. |
| Rich Markdown editing | Complete | TipTap rendering, source mode, Mermaid, tables, media, math, code, and split editing are implemented. |
| Version management | In progress | Shadow repository and GitHub private-repository flow exist; account UI is being refined. |
| Remote Sync | In progress | Supabase setup and sync preferences exist; broader conflict and collaboration behavior will evolve later. |
| Export and search | Planned | Markdown export and search are the next product modules. |
| Plugin system | Later | Only if product requirements make it necessary. |

## FAQ

<details>
<summary><strong>Is Veloca production-ready?</strong></summary>

No. Veloca is still in early development. It is ready for local development and feature validation, not broad end-user distribution.
</details>

<details>
<summary><strong>Why does Veloca use SQLite?</strong></summary>

SQLite gives Veloca durable local state for settings, workspaces, database-backed documents, sync metadata, and version-management mappings without requiring users to run a separate database.
</details>

<details>
<summary><strong>Does Veloca modify my own Git repository?</strong></summary>

No. Veloca version management uses a separate shadow repository inside Electron's user data directory and can push copies to a private GitHub repository named `veloca-version-manager`. It does not create or modify `.git` folders inside user workspaces.
</details>

<details>
<summary><strong>Why do no files appear after launch?</strong></summary>

Veloca starts without a workspace. Add a folder that contains `.md` files, or create a database-backed workspace from the Workspace toolbar.
</details>

<details>
<summary><strong>Why might the development window take a moment to appear?</strong></summary>

`npm run dev` starts the Vite renderer and Electron shell together. Veloca keeps the native window hidden until the renderer is ready, which avoids showing an unrendered blank window.
</details>

<details>
<summary><strong>Where should feature documentation go?</strong></summary>

Feature documentation belongs in `docs/models`, split by business model. Update the relevant document whenever behavior, architecture, or development guidance changes.
</details>

## Contribution Guide

Veloca is currently an early-stage project. Contributions should be small, focused, and tied to an explicit product or engineering goal.

Recommended workflow:

1. Read the relevant document in `docs/models`.
2. Keep code changes scoped to the requested feature.
3. Add or update tests when behavior changes.
4. Update documentation when implementation details, configuration, or user-facing flows change.
5. Run `npm run typecheck`, `npm run test`, and `npm run build` before opening a pull request.

Recommended commit style:

```text
feat: add markdown editor foundation
feat: integrate tiptap markdown editing
fix: persist editor theme setting
docs: document markdown editor model
```

## License

Veloca is licensed under the [MIT License](LICENSE).
