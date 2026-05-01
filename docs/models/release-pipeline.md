# Release Pipeline Model

This document describes Veloca's GitHub release pipeline. The scope is intentionally narrow: npm scripts prepare a local version commit and Git tag, while GitHub Actions builds distributable desktop packages and creates a draft GitHub Release.

## Goals

- Keep release preparation explicit and repeatable from the local machine.
- Build platform-specific Electron artifacts on the matching GitHub-hosted runner.
- Publish artifacts only from GitHub Actions after a version tag is pushed.
- Keep generated build output out of Git history.

## Local Release Flow

Veloca uses npm scripts for release preparation:

```bash
npm run release:check
npm run release:patch
npm run release:minor
npm run release:major
npm run release:push
```

`release:check` runs type checking, the current test script, and a production build. The version scripts run the same checks first, then call `npm version` to update `package.json`, update `package-lock.json`, create a version commit, and create a Git tag such as `v0.1.1`.

`release:push` pushes the current branch and all reachable tags to `origin`. Pushing a `v*` tag starts the GitHub Actions release workflow.

## GitHub Actions Release Flow

`.github/workflows/build.yml` runs when a `v*` tag is pushed or when the workflow is manually dispatched.

The build matrix is:

| Target | Runner | Architecture | Output |
| --- | --- | --- | --- |
| Linux | `ubuntu-latest` | x64 | AppImage |
| Windows | `windows-latest` | x64 | zip |
| macOS | `macos-15` | arm64 | dmg and zip |
| macOS | `macos-15-intel` | x64 | dmg and zip |

Each matrix job installs dependencies with `npm ci`, runs the production build, then calls `electron-builder` with `--publish never`. Publishing is centralized in the release job so artifacts are uploaded once through GitHub CLI.

The release job runs only for `v*` tag refs. It downloads all matrix artifacts, creates a draft GitHub Release, uploads the generated files, and asks GitHub to generate release notes.

## Generated Artifacts

Build output is written to the local `release/` directory by electron-builder. This directory is ignored by Git through `.gitignore` and should not be committed.

## Runtime Dependency Packaging

Veloca's packaged main process loads `isomorphic-git`, which loads `sha.js` and related hashing dependencies at runtime. The `call-bind-apply-helpers` package must be present at the root `node_modules` level inside `app.asar` because dependencies such as `dunder-proto` resolve it from their own root-level package paths.

`package.json` declares `call-bind-apply-helpers` as a production dependency and includes it with an explicit electron-builder FileSet. Do not remove this packaging rule unless the dependency tree is changed and the generated `app.asar` is verified to still contain a root-level `/node_modules/call-bind-apply-helpers` directory.

## Required Repository Settings

The workflow uses the default `GITHUB_TOKEN`. Repository Actions settings must allow workflows to read repository contents and write releases. No custom secret is required for the current unsigned builds.

macOS artifacts are currently unsigned. Windows artifacts are packaged as zip files, not NSIS installers. Linux artifacts are packaged as AppImage files.

## Verification Checklist

- Run `npm run release:check` locally before creating a release version.
- Run `npm run release:patch`, `npm run release:minor`, or `npm run release:major`.
- Confirm `git status --short` is clean after `npm version`, then confirm the new tag points at `HEAD`.
- Run `npm run release:push`.
- Open the repository's Actions tab and confirm the `Build & Release` workflow runs for the pushed tag.
- Confirm the draft GitHub Release contains Linux AppImage, Windows zip, and macOS dmg/zip artifacts.
- Confirm `app.asar` contains `/node_modules/call-bind-apply-helpers` at the root `node_modules` level.
- Download at least one artifact from the draft release and smoke-test app startup before publishing the release.
