[![Veloca](resources/logo.svg)](https://github.com/wuyoujae/veloca)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/wuyoujae/veloca/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/electron-33.x-9feaf9.svg)](https://www.electronjs.org/)

Veloca is an early-stage desktop markdown editor inspired by Typora. The goal is to provide a focused writing experience where markdown content feels close to the final rendered document while still being practical for local desktop workflows.

The current version is an early rich-editor build. It includes the Electron desktop shell, React renderer, Node backend entry point, SQLite-backed settings persistence, persisted workspace folders, recursive markdown loading, a TipTap-powered editor styled through Veloca's own UI system, local asset handling for richer Markdown documents, GitHub account binding, and Veloca-owned markdown version management through an isolated shadow repository.
It also includes an early Remote settings path for creating and initializing a user-owned Supabase project named `veloca`.

## Table of Contents

- [Project Overview](#project-overview)
- [Project Approach](#project-approach)
- [Core Features](#core-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Release Workflow](#release-workflow)
- [Development Guide](#development-guide)
- [Testing Guide](#testing-guide)
- [Usage Examples](#usage-examples)
- [Roadmap](#roadmap)
- [FAQ](#faq)
- [Contribution Guide](#contribution-guide)
- [License](#license)

## Project Overview

Veloca is positioned as a clean, desktop-first markdown editor. Its first core use case is simple: open the app, write markdown in a Typora-like single-pane editor, and control the editor appearance without visual clutter.

The project currently focuses on desktop-first workspace management, rich markdown editing, media attachment handling, save behavior, and a simple version-management path for local filesystem markdown files. Export and search are planned follow-up modules.

## Project Approach

Veloca separates desktop, backend, and renderer responsibilities:

- **Electron** owns the native window, lifecycle, and secure bridge between UI and backend code.
- **React** owns the interactive editor interface.
- **Node services** own persistent application behavior.
- **SQLite** stores local application data with a minimal schema aligned to current requirements, including app settings and workspace folder roots.
- **Version management** uses a Veloca-owned Git repository in Electron's user data directory. User project folders are never turned into Git repositories by Veloca, and existing user `.git` folders are not read or modified.

TipTap is used as the editor engine because it is MIT licensed, gives Veloca more control over the final writing experience, and allows the editing surface to fully inherit the application's own layout, typography, and theme tokens.

## Core Features

- Electron desktop app shell with a custom title bar.
- React-based editor layout matching the prototype direction.
- Interactive sidebar with Files and Outline modes.
- Collapsible workspace file tree with real folder loading.
- VS Code-style workspace roots where multiple folders can be added.
- Database-backed workspace roots for quick projects that do not need a system folder.
- Recursive `.md` file discovery from added folders.
- Header-level untitled file creation with an in-app save-location picker limited to current workspace folders.
- Custom file tree context menu for common system-level operations.
- TipTap-powered rich markdown editor with Veloca-native styling.
- Per-file source/rendered view switching for editable raw Markdown and Typora-like rich preview.
- Rich Markdown rendering for tables, task lists, Mermaid diagrams, code highlighting, inline and block math, and emoji input.
- Local image, audio, video, and iframe embed support.
- Dual-workspace attachment persistence for both filesystem and SQLite-backed workspaces.
- Auto Save enabled by default, with `Cmd/Ctrl+S` manual save support.
- Save status in the editor status bar.
- GitHub account binding through the OAuth device authorization flow.
- Veloca version management for saved local filesystem `.md` files through a private GitHub repository named `veloca-version-manager`.
- Sidebar Git tab showing only Veloca-managed markdown changes from the isolated shadow repository.
- Remote Supabase configuration through Settings, including encrypted local credential storage, cloud table initialization, and Remote Sync preferences.
- Settings modal with polished dark/light theme switching.
- SQLite-backed app setting storage for theme and Auto Save persistence.
- Toast message component for user feedback.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React, TypeScript, Vite, Lucide React, TipTap, `@tiptap/markdown`, Mermaid, KaTeX, Shiki, DOMPurify, Marked, CSS |
| Desktop shell | Electron, electron-vite |
| Backend | Node.js, TypeScript, isomorphic-git, `pg`, `@supabase/supabase-js` |
| Database | SQLite through `better-sqlite3` |
| Build tools | TypeScript, Vite, electron-vite |
| Testing | not configured yet; this foundation milestone is verified through typecheck and production build |

## Project Structure

```
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

Build local desktop packages on the matching operating system:

```bash
npm run package:mac
npm run package:win
npm run package:linux
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
| `VELOCA_GITHUB_CLIENT_ID` | None | GitHub OAuth App client ID used by the Account settings panel to bind a GitHub account through the device authorization flow. Device Flow must be enabled in the OAuth App settings. Veloca requests the `repo` scope so it can create and push to the private `veloca-version-manager` repository. |

Workspace folders are stored in SQLite. Markdown file content from system folders is read from disk only after selecting a file in the tree, then written back to the same validated `.md` path when saved. Header-level new files start as untitled in-memory tabs and are written only after the user chooses a destination through Veloca's workspace-scoped save dialog. Database-backed workspaces store their virtual folders and markdown files directly in SQLite. Rich media inserted into filesystem documents is saved to a sibling `<document>.assets` directory; rich media inserted into database-backed documents is stored in SQLite and served through a local Electron protocol.

Version management data is stored under Electron's user data directory at `version-manager/repo`. This shadow repository contains copies of Veloca-saved local filesystem markdown files under `workspaces/<workspaceSlug>-<shortWorkspaceId>/files/` plus a workspace `manifest.json`. The directory prefix is generated once per filesystem workspace, stored locally, and shown read-only in the Git tab. Database-backed workspace files are intentionally skipped. Veloca records repository metadata in `version_repositories`, workspace directory prefixes in `version_workspace_configs`, and managed markdown mappings in `version_managed_files`; these tables use UUID IDs and numeric status values.

Auto Save is a user preference stored in the `app_settings` table and defaults to enabled. It is not an environment variable because it changes per user inside the app.

Remote Supabase configuration is also a user preference configured inside Settings rather than through required environment variables. The Remote panel asks for a Supabase personal access token, organization slug, database password, and region. Veloca provides a built-in dropdown of common Supabase regions plus a manual region code input for fallback. Sensitive values are stored with Electron secure storage before writing encrypted values into SQLite. Veloca then uses Supabase Management API to create or reuse a project named `veloca`, initializes the minimum cloud database tables, and keeps only desensitized status visible in the renderer.

Remote Sync is configured in the same panel. Auto Sync, Pull on Startup, Push on Save, local opened/edited Markdown sync, asset sync, provenance sync, and soft-delete sync default to enabled. Veloca always mirrors SQLite-backed database workspaces to the remote project, while filesystem workspaces only sync Markdown files opened or edited inside Veloca. Sync runs in the background and records pending, failed, and conflict counts locally.

## Release Workflow

Veloca uses npm scripts plus GitHub Actions for desktop releases. Local scripts prepare the version commit and Git tag; GitHub Actions builds platform artifacts and creates a draft GitHub Release.

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

Pushing a tag that matches `v*` triggers `.github/workflows/build.yml`. The workflow builds Linux x64, Windows x64, macOS arm64, and macOS x64 artifacts, then creates a draft GitHub Release with generated release notes. Review and smoke-test the uploaded artifacts before publishing the draft release.

Release output is generated in `release/`, which is intentionally ignored by Git.

## Development Guide

All application code lives under `app`.

- Put **renderer code** in `app/frontend`.
- Put **Electron and Node backend code** in `app/backend`.
- Put **uncertain temporary implementation work** in `app/selection`, then move it once ownership is clear.
- Put **tests and test helpers** in `app/test`.
- Keep **feature documentation** in `docs/models`, organized by business model.

Database design should stay minimal and match the backend logic being implemented. Do not add speculative tables or fields before the related business behavior exists.

Remote Supabase development is documented in `docs/models/remote-database.md`. The current remote module initializes cloud tables, stores sync preferences, queues opened/edited local Markdown files, mirrors database workspaces, uploads assets to a private Supabase Storage bucket, and preserves conflict copies instead of overwriting user content.

## Testing Guide

The current foundation can be checked with:

```bash
npm run typecheck
npm run test
npm run build
```

Release readiness can be checked with:

```bash
npm run release:check
```

<details>
<summary><b>Manual acceptance checks</b> (click to expand)</summary>

<br>

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
12. Click the editor header `New File` button and confirm an untitled tab opens without immediately appearing in the file tree.
13. Type content in the untitled tab, click `Save`, choose a workspace folder from the in-app save dialog, and confirm the file appears under that workspace folder.
14. Repeat the untitled save flow with a database-backed workspace folder and confirm the file is stored in the database workspace.
15. Select a markdown file and edit headings, paragraphs, lists, blockquotes, tables, task lists, Mermaid diagrams, formulas, and code blocks in the TipTap editor.
16. Click the code icon to switch the active file into Source Mode, confirm the raw Markdown is editable, make a small change, and confirm the status bar shows `Unsaved`.
17. Click the document icon to return to rendered mode and confirm the same content is shown in the rich editor.
18. Open a second markdown file and confirm it still starts in rendered mode even if the first file is in Source Mode.
19. Open Settings and confirm the sidebar contains `Remote`, while the old placeholder entries `Appearance`, `File & Sync`, and `Shortcuts` are no longer present.
20. In Settings > Remote, enter an invalid Supabase PAT and confirm setup fails without creating a project.
21. Enter a valid Supabase PAT, organization slug, database password, and region; choose a common region from the dropdown or type a custom region code, then confirm Veloca creates or connects a Supabase project named `veloca`.
22. Confirm the Supabase SQL editor shows the `veloca_remote_*` tables after initialization.
23. Restart Veloca and confirm Settings > Remote shows project status without revealing the PAT, database password, or secret key.
24. In Settings > Remote > Sync, confirm Auto Sync, Pull on Startup, Push on Save, local Markdown sync, asset sync, provenance sync, and soft-delete sync are enabled by default.
25. Save a local Markdown file that was opened in Veloca, then confirm Remote Sync shows pending or synced queue status.
26. Create or edit a database workspace file, run Manual Sync Now, and confirm the remote tables contain database workspace rows.
27. Use `More Actions` → `Split Editor Right`, switch only one pane into Source Mode, and confirm the other pane keeps its own view mode.
28. Wait for Auto Save and confirm the status bar returns to `Saved`.
29. Select a different file, then return to the edited file and confirm the saved content is still present.
30. Paste or drag an image into a filesystem markdown document and confirm a sibling `.assets` folder is created and the image renders inside the document.
28. Paste or drag an image into a database-backed markdown document and confirm it still renders after switching files.
29. Paste a YouTube URL or raw iframe snippet and confirm it renders as an embedded media block.
30. Type `/` and confirm the command menu shows Mermaid, Table, and Code Block. Type `/m` to filter Mermaid, press `Enter`, and confirm it creates a Mermaid diagram card. Type `/t` to filter Table and confirm it creates an empty 2 × 2 table. Then try `Text before command /mermaid` and confirm the text remains while a Mermaid card is inserted below.
31. Enter `$E=mc^2$` and `$$\int_0^1 x^2 dx$$` and confirm both formulas render.
32. Switch to `Outline` and select headings to confirm the active outline state changes and scroll behavior.
33. Add `VELOCA_GITHUB_CLIENT_ID` to `.env`, open `Settings` → `Account`, click `Bind GitHub`, enter the displayed code on GitHub, and confirm the connected GitHub account appears in Veloca.
34. Switch to the sidebar `Git` tab and confirm it prompts for repository setup after GitHub is bound with the required `repo` permission.
35. Click `Create Repository` and confirm GitHub has a private repository named `veloca-version-manager`.
36. Edit and save a local filesystem `.md` file, then confirm the `Git` tab lists a Veloca markdown change.
37. Confirm the original workspace folder does not gain a new `.git` folder and an existing user `.git` status is not changed by Veloca.
38. Enter a version message, click `Commit & Push`, and confirm the private GitHub repository receives the corresponding file under `workspaces/<workspaceSlug>-<shortWorkspaceId>/files/`.
39. Click `Settings` in the sidebar.
40. Toggle `Auto Save` off, edit a document, confirm the status bar shows `Unsaved`, then press `Cmd/Ctrl+S` and confirm it returns to `Saved`.
41. Switch between `Dark` and `Light` and confirm Mermaid diagrams adapt to the selected theme.
42. Close and reopen the app, then confirm workspace folders, database-backed workspaces, Auto Save preference, saved markdown content, and the selected theme are restored.

</details>

Automated unit and integration tests should be added around file IO, save failure handling, and editor state transitions as the product surface grows.

## Usage Examples

At this stage, Veloca starts with an empty workspace until folders are added or database-backed workspaces are created. Use the folder button in the `Workspace` toolbar to add one or more system folders, or use the new-workspace button to create a workspace stored entirely in SQLite. Veloca recursively scans system roots and shows only `.md` files as files. Selecting a markdown file opens it in the TipTap editor and updates the breadcrumb, status bar, and outline. Use the editor header's `New File` button to create an untitled in-memory tab, then save it into a local or database workspace folder through Veloca's save-location dialog. Use the editor header's code/document toggle to switch the active file between rendered mode and editable raw Markdown source mode; this view preference is tracked independently for each open file. Right-click file tree items to create, rename, duplicate, copy, cut, paste, reveal, delete, or remove workspace roots. Paste or drag supported media directly into the editor to insert it into the current document. Mermaid diagrams and empty 2 × 2 tables can be inserted from the editor slash command menu by typing `/`, `/m`, or `/t`; saved Mermaid diagrams still use the standard Markdown `mermaid` fenced code block format. After GitHub is bound, the `Git` tab can create the private `veloca-version-manager` repository and commit only Veloca-saved filesystem markdown copies from the shadow repository.

## Roadmap

- **Completed:** project scaffold, Electron shell, React UI, SQLite settings storage, theme switching, persisted workspace folders, database-backed workspaces, recursive markdown discovery, file tree interactions, custom file context menu, untitled file creation with workspace-scoped save dialog, TipTap editor integration, rich Markdown rendering, editable source mode switching, Mermaid diagram rendering, local media handling, Auto Save, manual save, outline interactions, GitHub account binding, and isolated Veloca markdown version management.
- **Next:** markdown export and search.
- **Later:** plugin or extension system if product requirements justify it.

## FAQ

<details>
<summary><b>Is Veloca production-ready?</b></summary>

No. This is the initial foundation build. It is suitable for continuing development, not for end-user release.
</details>

<details>
<summary><b>How do I publish a GitHub Release?</b></summary>

Run `npm run release:patch`, `npm run release:minor`, or `npm run release:major`, then run `npm run release:push`. The pushed `v*` tag starts the GitHub Actions workflow and creates a draft release for review.
</details>

<details>
<summary><b>Why is SQLite already included?</b></summary>

Theme settings need durable local persistence. The schema is intentionally small and can evolve only when new backend behavior requires it.
</details>

<details>
<summary><b>Why do no files appear after launch?</b></summary>

Veloca now loads real markdown files from added workspace folders. Click the add-folder icon beside `Workspace` and choose a folder that contains `.md` files.
</details>

<details>
<summary><b>How are edits saved?</b></summary>

Auto Save is enabled by default and writes changes after a short pause. You can turn it off in `Settings`; when it is off, use `Cmd/Ctrl+S` to save the active markdown file.
</details>

<details>
<summary><b>Does Veloca modify my project's Git repository?</b></summary>

No. Veloca version management uses a separate shadow repository in Electron's user data directory. It copies only Veloca-saved local `.md` files into that repository and does not create, read, or modify `.git` inside user workspace folders.
</details>

## Contribution Guide

Use small, focused commits. Keep changes aligned with the requested feature and update the relevant documentation when behavior or architecture changes.

Recommended commit style:

```
feat: add markdown editor foundation
feat: integrate tiptap markdown editing
fix: persist editor theme setting
docs: document markdown editor model
```

## License

[MIT](LICENSE)
