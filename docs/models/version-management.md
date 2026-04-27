# Version Management Model

This document describes Veloca's current version management foundation.

## Current Scope

- Version management is currently limited to GitHub account authorization.
- The sidebar `Git` tab is still a front-end prototype and does not yet read repository state or perform Git actions.
- The Settings window includes an `Account` section where users can bind or locally unbind a GitHub account.

## GitHub Authorization

Veloca uses GitHub's OAuth device authorization flow because it fits an Electron desktop app without requiring a local callback server.

1. The backend requests a device code from GitHub using `VELOCA_GITHUB_CLIENT_ID`.
2. The app opens `https://github.com/login/device` and shows the returned `user_code`.
3. The backend polls GitHub at the required interval until authorization succeeds, expires, or is denied.
4. After authorization succeeds, Veloca validates the token by requesting the authenticated GitHub user profile.
5. The token is encrypted with Electron `safeStorage` before it is persisted in the `app_settings` table.

## Configuration

`VELOCA_GITHUB_CLIENT_ID` must be configured in `.env` before binding can start. The GitHub OAuth App must also have Device Flow enabled in GitHub's application settings.

No client secret is used or stored in the desktop app.

## Stored Data

- `github.account`: JSON profile summary used by the Settings UI.
- `github.token`: encrypted OAuth access token.

Unbinding removes both local settings. It does not revoke the OAuth grant from GitHub because token revocation for an OAuth App requires app credentials that should not be embedded in the desktop client.

## Next Steps

- Use the stored GitHub authorization to query repository metadata.
- Replace the static Git sidebar prototype with real repository status.
- Add explicit GitHub revocation guidance or a server-side revocation path if Veloca later introduces a secure backend.
