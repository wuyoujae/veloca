# App About and Updates Model

This document describes Veloca's About panel, update checking, and open-source component disclosure.

## Scope

- Settings contains an `About Veloca` panel.
- The About panel shows Veloca's logo, version, GitHub repository URL, and license.
- Veloca checks GitHub Releases for updates on startup.
- Users can also manually check for updates from the About panel.
- The open-source license dialog lists runtime npm components used by Veloca.

## Update Checking

Veloca checks the public GitHub Releases endpoint:

```text
https://api.github.com/repos/wuyoujae/veloca/releases/latest
```

The check compares the latest public release tag, such as `v0.3.2`, with the current app version from Electron. Draft releases are not visible to end users through this public endpoint, so they do not trigger update prompts.

The first implementation intentionally does not auto-download or auto-install updates. It only surfaces availability and links the user to the GitHub Release page. This keeps the desktop release path simple while Veloca does not yet have code signing, installer channels, or platform-specific updater metadata.

## UI Behavior

If an update is available:

- A `New` badge appears beside `About Veloca` in the Settings sidebar.
- The About panel shows a banner with the latest version and an `Open Release` action.
- A toast is shown after the automatic check completes.

Manual checks use the same backend path and show a toast for available, current, or unavailable states.

## Open Source Licenses

Veloca lists runtime npm components by starting from `package.json` production dependencies and walking each package's dependency metadata. The dialog shows component name, version, license, and an external link when a homepage or repository URL is available.

The list is generated at runtime from the installed package metadata so it reflects the packaged dependency graph rather than a manually maintained static list.

## Validation Checklist

- Open Settings and confirm `About Veloca` is selectable.
- Confirm the About panel shows the Veloca logo, app version, GitHub URL, and MIT license.
- Click `Check for Updates` and confirm a toast appears.
- Publish a newer GitHub Release and confirm the Settings sidebar shows the `New` badge after automatic or manual checking.
- Click `Open Source Licenses` and confirm the dialog lists runtime npm components with versions and licenses.
