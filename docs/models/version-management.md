# Version Management Model

This document describes Veloca's current version management model. The feature is intentionally narrow: it manages only local filesystem markdown files that Veloca has saved, and it keeps all Git operations isolated from user project folders.

## Current Scope

- Veloca manages only `.md` files from filesystem workspaces.
- Database workspace files under `veloca-db://` are skipped.
- A file enters version management only after Veloca successfully saves it.
- User workspace folders are never initialized as Git repositories by Veloca.
- Existing user `.git` folders are not read, modified, committed, or pushed by Veloca.
- The remote repository name is fixed to `veloca-version-manager`.

## Architecture

Veloca uses a global shadow repository inside Electron's user data directory:

```text
version-manager/
  repo/
    .git/
    workspaces/
      <workspaceSlug>-<shortWorkspaceId>/
        manifest.json
        files/
          <relativePath>.md
```

The shadow repository is the only directory where Git is initialized. Local workspace files are copied into `workspaces/<workspaceSlug>-<shortWorkspaceId>/files/` so multiple workspaces can contain the same relative file names without colliding while still being readable in GitHub.

The workspace prefix is generated once and then kept stable:

- `displayName` uses the local workspace folder name.
- The slug keeps Unicode letters and numbers, including Chinese names, and converts whitespace or path-unsafe characters to `-`.
- The suffix starts with the first 8 normalized characters of `workspaceFolderId`.
- If a prefix conflicts, Veloca expands the suffix to 12 characters, then to the full normalized workspace ID.
- v1 shows this prefix as read-only and does not allow users to edit it.

`manifest.json` records the source mapping for each managed workspace:

- `workspaceFolderId`
- `sourceRootPath`
- `displayName`
- `shadowPrefix`
- `managedFiles[]`
- `sourcePath`
- `relativePath`
- `shadowPath`
- `lastContentHash`

## GitHub Authorization

Veloca uses GitHub's OAuth device authorization flow because it fits an Electron desktop app without requiring a local callback server.

1. The backend requests a device code from GitHub using `VELOCA_GITHUB_CLIENT_ID`.
2. The app opens `https://github.com/login/device` and shows the returned `user_code`.
3. The backend polls GitHub at the required interval until authorization succeeds, expires, or is denied.
4. After authorization succeeds, Veloca validates the token by requesting the authenticated GitHub user profile.
5. The token is encrypted with Electron `safeStorage` before it is persisted in the `app_settings` table.

Version management requires the GitHub `repo` scope. Older tokens that only have `read:user` are still recognized as connected accounts, but the Account panel and Git tab ask the user to rebind GitHub before repository creation or push operations.

## Repository Lifecycle

When the user enables version management from the Git tab:

1. Veloca checks the authenticated GitHub account.
2. Veloca requests or reuses a private repository named `veloca-version-manager`.
3. If the repository exists and is private under the current account, Veloca reuses it.
4. If the same repository name exists but is not private, Veloca stops and asks the user to resolve it.
5. Veloca initializes the local shadow repository at `userData/version-manager/repo`.
6. Veloca configures the shadow repository remote as GitHub `origin`.

Veloca uses `isomorphic-git` and Electron `net.fetch`; it does not depend on the user's system Git binary.

## Save Sync Flow

After `saveMarkdownFile` or `saveMarkdownFileAs` succeeds for a filesystem `.md` file:

1. The backend validates that the saved path belongs to an active filesystem workspace.
2. Veloca creates or reuses the workspace version config and stable `shadowPrefix`.
3. The saved markdown content is copied into the shadow repository.
4. `version_managed_files` is inserted or updated with the source path, relative path, shadow path, workspace ID, and content hash.
5. The workspace `manifest.json` is regenerated.
6. The Git tab can list the resulting shadow repository changes.

If an older local shadow path used `workspaces/<workspaceFolderId>/...`, the next status or sync pass lazily moves it to `workspaces/<workspaceSlug>-<shortWorkspaceId>/...` and updates the local mapping. This creates a Git rename in the shadow repository without touching the user's project directory.

Database workspace saves return early and do not write into the shadow repository.

## Directory Prefix Configuration

`version_workspace_configs` stores the generated directory prefix for each filesystem workspace:

- `id`: UUID primary key.
- `workspace_folder_id`: filesystem workspace ID.
- `source_root_path`: workspace root path.
- `display_name`: workspace display name when the config is refreshed.
- `shadow_prefix`: stable directory prefix, such as `日常-a1b2c3d4`.
- `status`: `0 = active`, `1 = removed`.
- `created_at`, `updated_at`: millisecond timestamps.

Removing a workspace marks its config and managed-file mappings as removed locally. Veloca does not delete existing GitHub history or proactively remove already pushed files.

## Database Tables

`version_repositories` stores the current GitHub repository binding:

- `id`: UUID primary key.
- `provider`: numeric provider ID. GitHub is `1`.
- `owner`: GitHub owner login.
- `repo_name`: currently `veloca-version-manager`.
- `remote_url`: Git remote URL.
- `html_url`: GitHub web URL.
- `local_path`: shadow repository path.
- `status`: `0 = active`, `1 = removed`.
- `created_at`, `updated_at`: millisecond timestamps.

`version_workspace_configs` stores stable workspace directory prefixes:

- `id`: UUID primary key.
- `workspace_folder_id`: filesystem workspace ID.
- `source_root_path`: workspace root path.
- `display_name`: workspace display name.
- `shadow_prefix`: path segment used under `workspaces/`.
- `status`: `0 = active`, `1 = removed`.
- `created_at`, `updated_at`: millisecond timestamps.

`version_managed_files` stores the markdown source mapping:

- `id`: UUID primary key.
- `workspace_folder_id`: filesystem workspace ID.
- `source_root_path`: workspace root path.
- `source_path`: original local markdown path.
- `relative_path`: path relative to the workspace root.
- `shadow_path`: path inside the shadow repository.
- `content_hash`: SHA-256 hash of the last synced content.
- `status`: `0 = active`, `1 = removed`.
- `created_at`, `updated_at`: millisecond timestamps.

No foreign key constraints are used.

## UI Behavior

The Account settings panel shows the GitHub binding state. If the token lacks `repo`, it prompts the user to rebind.

The sidebar Git tab shows only Veloca version-management state:

- GitHub binding and permission readiness.
- Whether the private repository has been created or reused.
- Shadow repository local path.
- Managed directory prefixes for filesystem workspaces.
- Managed file count.
- Pending Veloca markdown changes.
- Commit message input and `Commit & Push` action.

The Git tab does not display or inspect the user's original project Git repository.

## Security Notes

- OAuth tokens are stored through Electron `safeStorage`.
- No GitHub client secret is embedded in the desktop app.
- The shadow repository contains full copies of managed markdown files. This is an accepted v1 assumption and must remain clear in user-facing documentation.
- Token revocation is not performed locally because OAuth App revocation requires credentials that should not be distributed with the desktop client.

## Validation Checklist

- Bind a GitHub account with `repo` scope.
- Rebind when using an older token without version-management permission.
- Create or reuse the private `veloca-version-manager` repository.
- Save a local filesystem `.md` file and confirm it appears under `workspaces/<workspaceSlug>-<shortWorkspaceId>/files/`.
- Confirm a Chinese workspace name produces a readable prefix such as `日常-a1b2c3d4`.
- Save files from two same-name workspaces and confirm their prefixes do not collide.
- Save a database workspace markdown file and confirm it is skipped.
- Confirm user workspace `.git` state is unchanged.
- Confirm an old `workspaces/<workspaceFolderId>/...` shadow path migrates to the generated prefix on status or sync.
- Commit and push from the Git tab, then confirm the private GitHub repository receives the shadow file path.
