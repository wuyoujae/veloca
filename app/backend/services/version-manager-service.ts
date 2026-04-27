import { randomUUID, createHash } from 'node:crypto';
import fs, {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { app, net } from 'electron';
import * as git from 'isomorphic-git';
import type { GitHttpRequest, GitHttpResponse, HttpClient, StatusRow } from 'isomorphic-git';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { getDatabase } from '../database/connection';
import {
  getGitHubAccessToken,
  getGitHubAuthStatus,
  githubVersionManagementScope,
  type GitHubAuthStatus
} from './github-auth-service';

export interface VersionRepositoryStatus {
  htmlUrl: string;
  localPath: string;
  name: string;
  owner: string;
  private: boolean;
  remoteUrl: string;
}

export interface VersionManagedChange {
  filePath: string;
  kind: 'added' | 'deleted' | 'modified';
  relativePath: string;
  shadowPath: string;
  workspaceFolderId: string;
}

export interface VersionWorkspaceConfig {
  displayName: string;
  managedFileCount: number;
  shadowPrefix: string;
  sourceRootPath: string;
  status: number;
  workspaceFolderId: string;
}

export interface VersionManagerStatus {
  changes: VersionManagedChange[];
  github: GitHubAuthStatus;
  managedFileCount: number;
  pendingChangeCount: number;
  repository: VersionRepositoryStatus | null;
  shadowRepositoryReady: boolean;
  workspaceConfigs: VersionWorkspaceConfig[];
}

export interface VersionSyncResult {
  reason?: string;
  shadowPath?: string;
  synced: boolean;
}

export interface VersionCommitResult {
  commitOid?: string;
  pushed: boolean;
  status: VersionManagerStatus;
}

interface WorkspaceFolderRow {
  id: string;
  name: string;
  folder_path: string;
}

interface VersionRepositoryRow {
  html_url: string | null;
  local_path: string;
  owner: string;
  remote_url: string;
  repo_name: string;
}

interface VersionManagedFileRow {
  content_hash: string;
  relative_path: string;
  shadow_path: string;
  source_path: string;
  source_root_path: string;
  workspace_folder_id: string;
}

interface VersionWorkspaceConfigRow {
  display_name: string;
  managed_file_count?: number;
  shadow_prefix: string;
  source_root_path: string;
  status: number;
  workspace_folder_id: string;
}

interface GitHubRepositoryResponse {
  clone_url?: string;
  html_url?: string;
  name?: string;
  owner?: {
    login?: string;
  };
  private?: boolean;
  pushed_at?: string | null;
  size?: number;
}

const versionRepositoryName = 'veloca-version-manager';
const versionProviderGitHub = 1;
const defaultBranch = 'main';
const defaultBranchRef = `refs/heads/${defaultBranch}`;

function getVersionRootPath(): string {
  return join(app.getPath('userData'), 'version-manager');
}

function getShadowRepositoryPath(): string {
  return join(getVersionRootPath(), 'repo');
}

function getShadowGitDirectoryPath(): string {
  return join(getShadowRepositoryPath(), '.git');
}

function normalizeTreePath(value: string): string {
  return value.split(sep).join('/').replace(/^\/+/, '');
}

function normalizeWorkspaceSlug(value: string): string {
  const slug = value
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return slug || 'workspace';
}

function getWorkspaceIdSegment(workspaceFolderId: string, length?: number): string {
  const normalizedId = workspaceFolderId.replace(/-/g, '');
  return length ? normalizedId.slice(0, length) : normalizedId;
}

function getContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function isGitOid(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value.trim());
}

function isMarkdownPath(filePath: string): boolean {
  return extname(filePath).toLowerCase() === '.md';
}

function getActiveWorkspaceFolders(): WorkspaceFolderRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT id, name, folder_path
      FROM workspace_folders
      WHERE status = 0
      `
    )
    .all() as WorkspaceFolderRow[];
}

function findWorkspaceFolderForPath(filePath: string): WorkspaceFolderRow | null {
  const resolvedPath = resolve(filePath);

  return (
    getActiveWorkspaceFolders().find((folder) => {
      const relativePath = relative(folder.folder_path, resolvedPath);
      return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith(sep));
    }) ?? null
  );
}

function mapWorkspaceConfigRow(row: VersionWorkspaceConfigRow): VersionWorkspaceConfig {
  return {
    displayName: row.display_name,
    managedFileCount: row.managed_file_count ?? 0,
    shadowPrefix: row.shadow_prefix,
    sourceRootPath: row.source_root_path,
    status: row.status,
    workspaceFolderId: row.workspace_folder_id
  };
}

function getWorkspaceConfigByWorkspaceId(workspaceFolderId: string): VersionWorkspaceConfig | null {
  const row = getDatabase()
    .prepare(
      `
      SELECT workspace_folder_id, source_root_path, display_name, shadow_prefix, status
      FROM version_workspace_configs
      WHERE workspace_folder_id = ?
      LIMIT 1
      `
    )
    .get(workspaceFolderId) as VersionWorkspaceConfigRow | undefined;

  return row ? mapWorkspaceConfigRow(row) : null;
}

function getWorkspaceConfigByPrefix(shadowPrefix: string): VersionWorkspaceConfig | null {
  const row = getDatabase()
    .prepare(
      `
      SELECT workspace_folder_id, source_root_path, display_name, shadow_prefix, status
      FROM version_workspace_configs
      WHERE shadow_prefix = ?
      LIMIT 1
      `
    )
    .get(shadowPrefix) as VersionWorkspaceConfigRow | undefined;

  return row ? mapWorkspaceConfigRow(row) : null;
}

function generateWorkspaceShadowPrefix(workspaceFolder: WorkspaceFolderRow): string {
  const slug = normalizeWorkspaceSlug(workspaceFolder.name || basename(workspaceFolder.folder_path));
  const segmentLengths = [8, 12, undefined];

  for (const segmentLength of segmentLengths) {
    const candidate = `${slug}-${getWorkspaceIdSegment(workspaceFolder.id, segmentLength)}`;
    const existingConfig = getWorkspaceConfigByPrefix(candidate);

    if (!existingConfig || existingConfig.workspaceFolderId === workspaceFolder.id) {
      return candidate;
    }
  }

  throw new Error('Unable to generate a unique Veloca version directory prefix.');
}

function ensureWorkspaceVersionConfig(workspaceFolder: WorkspaceFolderRow): VersionWorkspaceConfig {
  const existingConfig = getWorkspaceConfigByWorkspaceId(workspaceFolder.id);
  const now = Date.now();

  if (existingConfig) {
    getDatabase()
      .prepare(
        `
        UPDATE version_workspace_configs
        SET source_root_path = ?, display_name = ?, status = 0, updated_at = ?
        WHERE workspace_folder_id = ?
        `
      )
      .run(workspaceFolder.folder_path, workspaceFolder.name, now, workspaceFolder.id);

    return {
      ...existingConfig,
      displayName: workspaceFolder.name,
      sourceRootPath: workspaceFolder.folder_path,
      status: 0
    };
  }

  const shadowPrefix = generateWorkspaceShadowPrefix(workspaceFolder);

  getDatabase()
    .prepare(
      `
      INSERT INTO version_workspace_configs (
        id, workspace_folder_id, source_root_path, display_name, shadow_prefix, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `
    )
    .run(randomUUID(), workspaceFolder.id, workspaceFolder.folder_path, workspaceFolder.name, shadowPrefix, now, now);

  return {
    displayName: workspaceFolder.name,
    managedFileCount: 0,
    shadowPrefix,
    sourceRootPath: workspaceFolder.folder_path,
    status: 0,
    workspaceFolderId: workspaceFolder.id
  };
}

function getManagedMarkdownTarget(filePath: string): {
  content: string;
  contentHash: string;
  relativePath: string;
  resolvedPath: string;
  shadowPrefix: string;
  shadowPath: string;
  sourceRootPath: string;
  workspaceFolderId: string;
} | null {
  if (filePath.startsWith('veloca-db://')) {
    return null;
  }

  if (!existsSync(filePath)) {
    return null;
  }

  const resolvedPath = realpathSync(filePath);

  if (!isMarkdownPath(resolvedPath) || !statSync(resolvedPath).isFile()) {
    return null;
  }

  const folder = findWorkspaceFolderForPath(resolvedPath);

  if (!folder) {
    return null;
  }

  const relativePath = normalizeTreePath(relative(folder.folder_path, resolvedPath));
  const content = readFileSync(resolvedPath, 'utf8');
  const config = ensureWorkspaceVersionConfig(folder);
  migrateWorkspaceShadowPrefixIfNeeded(folder.id);
  const shadowPath = getWorkspaceFileShadowPath(config.shadowPrefix, relativePath);

  return {
    content,
    contentHash: getContentHash(content),
    relativePath,
    resolvedPath,
    shadowPrefix: config.shadowPrefix,
    shadowPath,
    sourceRootPath: folder.folder_path,
    workspaceFolderId: folder.id
  };
}

function getRepositoryRow(): VersionRepositoryRow | null {
  const row = getDatabase()
    .prepare(
      `
      SELECT owner, repo_name, remote_url, local_path, html_url
      FROM version_repositories
      WHERE provider = ? AND repo_name = ? AND status = 0
      ORDER BY updated_at DESC
      LIMIT 1
      `
    )
    .get(versionProviderGitHub, versionRepositoryName) as VersionRepositoryRow | undefined;

  return row ?? null;
}

function mapRepositoryRow(row: VersionRepositoryRow | null): VersionRepositoryStatus | null {
  if (!row) {
    return null;
  }

  return {
    htmlUrl: row.html_url ?? `https://github.com/${row.owner}/${row.repo_name}`,
    localPath: row.local_path,
    name: row.repo_name,
    owner: row.owner,
    private: true,
    remoteUrl: row.remote_url
  };
}

function upsertRepository(repository: VersionRepositoryStatus): void {
  const now = Date.now();

  getDatabase()
    .prepare(
      `
      INSERT INTO version_repositories (
        id, provider, owner, repo_name, remote_url, local_path, status, created_at, updated_at, html_url
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(provider, owner, repo_name) DO UPDATE SET
        remote_url = excluded.remote_url,
        local_path = excluded.local_path,
        html_url = excluded.html_url,
        status = 0,
        updated_at = excluded.updated_at
      `
    )
    .run(
      randomUUID(),
      versionProviderGitHub,
      repository.owner,
      repository.name,
      repository.remoteUrl,
      repository.localPath,
      now,
      now,
      repository.htmlUrl
    );
}

async function collectRequestBody(body?: AsyncIterableIterator<Uint8Array>): Promise<Uint8Array | undefined> {
  if (!body) {
    return undefined;
  }

  const chunks: Uint8Array[] = [];

  for await (const chunk of body) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function* readResponseBody(stream: ReadableStream<Uint8Array> | null): AsyncIterableIterator<Uint8Array> {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        return;
      }

      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

const electronGitHttpClient: HttpClient = {
  request: async (request: GitHttpRequest): Promise<GitHttpResponse> => {
    const body = await collectRequestBody(request.body);
    const requestBody = body ? new Blob([copyToArrayBuffer(body)]) : undefined;
    const response = await net.fetch(request.url, {
      body: requestBody,
      headers: request.headers,
      method: request.method
    });
    const headers: Record<string, string> = {};

    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      body: readResponseBody(response.body),
      headers,
      method: request.method,
      statusCode: response.status,
      statusMessage: response.statusText,
      url: response.url
    };
  }
};

async function githubApiRequest<T>(
  token: string,
  path: string,
  options: { body?: unknown; method?: string } = {}
): Promise<{ data: T | null; response: Response }> {
  const response = await net.fetch(`https://api.github.com${path}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Veloca',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    method: options.method ?? 'GET'
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : null;

  return { data, response };
}

function getRequiredGitHubToken(): string {
  const token = getGitHubAccessToken();

  if (!token) {
    throw new Error('Bind a GitHub account before enabling version management.');
  }

  return token;
}

async function getOrCreateGitHubRepository(token: string, owner: string): Promise<VersionRepositoryStatus> {
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(versionRepositoryName)}`;
  const existing = await githubApiRequest<GitHubRepositoryResponse>(token, repoPath);
  let repository = existing.data;

  if (existing.response.status === 404) {
    const created = await githubApiRequest<GitHubRepositoryResponse>(token, '/user/repos', {
      body: {
        auto_init: false,
        name: versionRepositoryName,
        private: true
      },
      method: 'POST'
    });

    if (!created.response.ok || !created.data) {
      throw new Error('Unable to create the GitHub private repository for Veloca version management.');
    }

    repository = created.data;
  } else if (!existing.response.ok || !repository) {
    throw new Error('Unable to inspect the GitHub version management repository.');
  }

  if (!repository.private) {
    throw new Error(`GitHub repository ${versionRepositoryName} already exists but is not private.`);
  }

  const repositoryOwner = repository.owner?.login;

  if (!repositoryOwner) {
    throw new Error('GitHub did not return a repository owner.');
  }

  return {
    htmlUrl: repository.html_url ?? `https://github.com/${repositoryOwner}/${versionRepositoryName}`,
    localPath: getShadowRepositoryPath(),
    name: repository.name ?? versionRepositoryName,
    owner: repositoryOwner,
    private: true,
    remoteUrl: repository.clone_url ?? `https://github.com/${repositoryOwner}/${versionRepositoryName}.git`
  };
}

function getGitAuthor(github: GitHubAuthStatus): { email: string; name: string } {
  const account = github.account;

  if (!account) {
    return {
      email: 'version-manager@veloca.local',
      name: 'Veloca Version Manager'
    };
  }

  return {
    email: `${account.id}+${account.login}@users.noreply.github.com`,
    name: account.name ?? account.login
  };
}

function isLocalGitRepositoryReady(): boolean {
  return existsSync(getShadowGitDirectoryPath());
}

function hasLocalDefaultBranchRef(): boolean {
  return existsSync(join(getShadowGitDirectoryPath(), ...defaultBranchRef.split('/')));
}

function repairDefaultBranchRef(): void {
  if (!isLocalGitRepositoryReady()) {
    return;
  }

  const gitdir = getShadowGitDirectoryPath();
  const legacyShortRefPath = join(gitdir, defaultBranch);
  const fullRefPath = join(gitdir, ...defaultBranchRef.split('/'));

  if (existsSync(legacyShortRefPath)) {
    const legacyRefValue = readFileSync(legacyShortRefPath, 'utf8').trim();

    if (isGitOid(legacyRefValue)) {
      mkdirSync(dirname(fullRefPath), { recursive: true });
      writeFileSync(fullRefPath, `${legacyRefValue}\n`, 'utf8');
      rmSync(legacyShortRefPath, { force: true, recursive: true });
    }
  }

  writeFileSync(join(gitdir, 'HEAD'), `ref: ${defaultBranchRef}\n`, 'utf8');
}

async function ensureLocalRepository(repository?: VersionRepositoryStatus): Promise<void> {
  const dir = getShadowRepositoryPath();

  mkdirSync(dir, { recursive: true });

  if (!isLocalGitRepositoryReady()) {
    await git.init({ defaultBranch, dir, fs });
  }

  repairDefaultBranchRef();

  if (repository) {
    await git.addRemote({
      dir,
      force: true,
      fs,
      remote: 'origin',
      url: repository.remoteUrl
    });
    await git.setConfig({ dir, fs, path: 'user.name', value: 'Veloca Version Manager' });
    await git.setConfig({ dir, fs, path: 'user.email', value: 'version-manager@veloca.local' });
    await git.setConfig({ dir, fs, path: `branch.${defaultBranch}.remote`, value: 'origin' });
    await git.setConfig({ dir, fs, path: `branch.${defaultBranch}.merge`, value: defaultBranchRef });
  }
}

async function pushDefaultBranch(token: string): Promise<void> {
  await git.push({
    dir: getShadowRepositoryPath(),
    fs,
    http: electronGitHttpClient,
    onAuth: () => ({ username: token }),
    onPrePush: ({ localRef, remoteRef }) => {
      if (localRef.ref !== defaultBranchRef || remoteRef.ref !== defaultBranchRef) {
        throw new Error(`Veloca refused to push invalid Git refs: ${localRef.ref} -> ${remoteRef.ref}`);
      }

      return true;
    },
    ref: defaultBranchRef,
    remote: 'origin',
    remoteRef: defaultBranchRef
  });
}

function getManagedFileRows(): VersionManagedFileRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT workspace_folder_id, source_root_path, source_path, relative_path, shadow_path, content_hash
      FROM version_managed_files
      WHERE status = 0
      ORDER BY workspace_folder_id ASC, relative_path ASC
      `
    )
    .all() as VersionManagedFileRow[];
}

function getManagedFileRowsByWorkspaceId(workspaceFolderId: string): VersionManagedFileRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT workspace_folder_id, source_root_path, source_path, relative_path, shadow_path, content_hash
      FROM version_managed_files
      WHERE status = 0 AND workspace_folder_id = ?
      ORDER BY relative_path ASC
      `
    )
    .all(workspaceFolderId) as VersionManagedFileRow[];
}

function getManagedFileCount(): number {
  const row = getDatabase()
    .prepare('SELECT COUNT(*) AS count FROM version_managed_files WHERE status = 0')
    .get() as { count: number };

  return row.count;
}

function getWorkspaceFileShadowPath(shadowPrefix: string, relativePath: string): string {
  return `workspaces/${shadowPrefix}/files/${relativePath}`;
}

function getWorkspaceManifestPath(shadowPrefix: string): string {
  return `workspaces/${shadowPrefix}/manifest.json`;
}

function getLegacyWorkspaceFileShadowPath(workspaceFolderId: string, relativePath: string): string {
  return `workspaces/${workspaceFolderId}/files/${relativePath}`;
}

function getLegacyWorkspaceManifestPath(workspaceFolderId: string): string {
  return `workspaces/${workspaceFolderId}/manifest.json`;
}

function getShadowRepositoryAbsolutePath(shadowPath: string): string {
  return join(getShadowRepositoryPath(), ...shadowPath.split('/'));
}

function moveShadowPathIfPresent(sourceShadowPath: string, targetShadowPath: string): void {
  if (sourceShadowPath === targetShadowPath) {
    return;
  }

  const sourcePath = getShadowRepositoryAbsolutePath(sourceShadowPath);

  if (!existsSync(sourcePath)) {
    return;
  }

  const targetPath = getShadowRepositoryAbsolutePath(targetShadowPath);
  mkdirSync(dirname(targetPath), { recursive: true });

  if (existsSync(targetPath)) {
    rmSync(sourcePath, { force: true });
    return;
  }

  renameSync(sourcePath, targetPath);
}

function ensureWorkspaceConfigsForManagedRows(): void {
  const foldersById = new Map(getActiveWorkspaceFolders().map((folder) => [folder.id, folder]));
  const workspaceIds = Array.from(new Set(getManagedFileRows().map((row) => row.workspace_folder_id)));

  for (const workspaceFolderId of workspaceIds) {
    const folder = foldersById.get(workspaceFolderId);

    if (!folder) {
      continue;
    }

    ensureWorkspaceVersionConfig(folder);
    migrateWorkspaceShadowPrefixIfNeeded(workspaceFolderId);
  }
}

export function markWorkspaceVersionConfigRemoved(workspaceFolderId: string): void {
  const now = Date.now();

  getDatabase()
    .prepare(
      `
      UPDATE version_workspace_configs
      SET status = 1, updated_at = ?
      WHERE workspace_folder_id = ?
      `
    )
    .run(now, workspaceFolderId);

  getDatabase()
    .prepare(
      `
      UPDATE version_managed_files
      SET status = 1, updated_at = ?
      WHERE workspace_folder_id = ?
      `
    )
    .run(now, workspaceFolderId);
}

export function listWorkspaceVersionConfigs(): VersionWorkspaceConfig[] {
  ensureWorkspaceConfigsForManagedRows();

  const rows = getDatabase()
    .prepare(
      `
      SELECT
        config.workspace_folder_id,
        config.source_root_path,
        config.display_name,
        config.shadow_prefix,
        config.status,
        COUNT(file.id) AS managed_file_count
      FROM version_workspace_configs config
      INNER JOIN workspace_folders folder
        ON folder.id = config.workspace_folder_id
       AND folder.status = 0
      LEFT JOIN version_managed_files file
        ON file.workspace_folder_id = config.workspace_folder_id
       AND file.status = 0
      WHERE config.status = 0
      GROUP BY
        config.workspace_folder_id,
        config.source_root_path,
        config.display_name,
        config.shadow_prefix,
        config.status
      ORDER BY config.display_name ASC, config.created_at ASC
      `
    )
    .all() as VersionWorkspaceConfigRow[];

  return rows.map(mapWorkspaceConfigRow);
}

function migrateWorkspaceShadowPrefixIfNeeded(workspaceFolderId: string): void {
  const config = getWorkspaceConfigByWorkspaceId(workspaceFolderId);

  if (!config || config.status !== 0) {
    return;
  }

  const rows = getManagedFileRowsByWorkspaceId(workspaceFolderId);
  let changed = false;

  for (const row of rows) {
    const nextShadowPath = getWorkspaceFileShadowPath(config.shadowPrefix, row.relative_path);

    if (row.shadow_path === nextShadowPath) {
      continue;
    }

    moveShadowPathIfPresent(row.shadow_path, nextShadowPath);
    moveShadowPathIfPresent(getLegacyWorkspaceFileShadowPath(workspaceFolderId, row.relative_path), nextShadowPath);

    getDatabase()
      .prepare(
        `
        UPDATE version_managed_files
        SET shadow_path = ?, updated_at = ?
        WHERE source_path = ?
        `
      )
      .run(nextShadowPath, Date.now(), row.source_path);

    changed = true;
  }

  const nextManifestPath = getWorkspaceManifestPath(config.shadowPrefix);

  moveShadowPathIfPresent(getLegacyWorkspaceManifestPath(workspaceFolderId), nextManifestPath);

  if (changed || rows.length) {
    writeWorkspaceManifest(workspaceFolderId);
  }
}

function writeWorkspaceManifest(workspaceFolderId: string): void {
  const config = getWorkspaceConfigByWorkspaceId(workspaceFolderId);
  const rows = getManagedFileRows().filter((row) => row.workspace_folder_id === workspaceFolderId);

  if (!config || !rows.length) {
    return;
  }

  const manifest = {
    displayName: config.displayName,
    managedFiles: rows.map((row) => ({
      lastContentHash: row.content_hash,
      relativePath: row.relative_path,
      shadowPath: row.shadow_path,
      sourcePath: row.source_path
    })),
    shadowPrefix: config.shadowPrefix,
    sourceRootPath: config.sourceRootPath,
    updatedAt: Date.now(),
    workspaceFolderId
  };
  const manifestPath = getShadowRepositoryAbsolutePath(getWorkspaceManifestPath(config.shadowPrefix));

  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function upsertManagedFile(target: NonNullable<ReturnType<typeof getManagedMarkdownTarget>>): void {
  const now = Date.now();

  getDatabase()
    .prepare(
      `
      INSERT INTO version_managed_files (
        id, workspace_folder_id, source_root_path, source_path, relative_path, shadow_path, content_hash, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(source_path) DO UPDATE SET
        workspace_folder_id = excluded.workspace_folder_id,
        source_root_path = excluded.source_root_path,
        relative_path = excluded.relative_path,
        shadow_path = excluded.shadow_path,
        content_hash = excluded.content_hash,
        status = 0,
        updated_at = excluded.updated_at
      `
    )
    .run(
      randomUUID(),
      target.workspaceFolderId,
      target.sourceRootPath,
      target.resolvedPath,
      target.relativePath,
      target.shadowPath,
      target.contentHash,
      now,
      now
    );
}

function writeShadowFile(target: NonNullable<ReturnType<typeof getManagedMarkdownTarget>>): void {
  const shadowFilePath = join(getShadowRepositoryPath(), ...target.shadowPath.split('/'));

  mkdirSync(dirname(shadowFilePath), { recursive: true });
  writeFileSync(shadowFilePath, target.content, 'utf8');
}

function getStatusKind(row: StatusRow): VersionManagedChange['kind'] {
  const [, head, workdir] = row;

  if (head === 0 && workdir > 0) {
    return 'added';
  }

  if (head > 0 && workdir === 0) {
    return 'deleted';
  }

  return 'modified';
}

function mapStatusRow(
  row: StatusRow,
  managedFiles: VersionManagedFileRow[],
  workspaceConfigs: VersionWorkspaceConfig[]
): VersionManagedChange {
  const [shadowPath] = row;
  const managedFile = managedFiles.find(
    (file) =>
      file.shadow_path === shadowPath ||
      getLegacyWorkspaceFileShadowPath(file.workspace_folder_id, file.relative_path) === shadowPath
  );
  const config = workspaceConfigs.find(
    (item) =>
      getWorkspaceManifestPath(item.shadowPrefix) === shadowPath ||
      getLegacyWorkspaceManifestPath(item.workspaceFolderId) === shadowPath
  );
  const workspaceMatch = /^workspaces\/([^/]+)\/files\/(.+)$/.exec(shadowPath);
  const workspaceFolderId = managedFile?.workspace_folder_id ?? config?.workspaceFolderId ?? '';

  return {
    filePath: managedFile?.source_path ?? '',
    kind: getStatusKind(row),
    relativePath: managedFile?.relative_path ?? (workspaceMatch ? workspaceMatch[2] : 'manifest.json'),
    shadowPath,
    workspaceFolderId
  };
}

export async function listManagedChanges(): Promise<VersionManagedChange[]> {
  ensureWorkspaceConfigsForManagedRows();
  repairDefaultBranchRef();

  if (!isLocalGitRepositoryReady()) {
    return [];
  }

  const managedFiles = getManagedFileRows();
  const workspaceConfigs = listWorkspaceVersionConfigs();
  const filepaths = Array.from(
    new Set([
      ...managedFiles.map((file) => file.shadow_path),
      ...managedFiles.map((file) => getLegacyWorkspaceFileShadowPath(file.workspace_folder_id, file.relative_path)),
      ...workspaceConfigs.map((config) => getWorkspaceManifestPath(config.shadowPrefix)),
      ...workspaceConfigs.map((config) => getLegacyWorkspaceManifestPath(config.workspaceFolderId))
    ])
  );

  if (!filepaths.length) {
    return [];
  }

  const matrix = await git.statusMatrix({
    dir: getShadowRepositoryPath(),
    filepaths,
    fs
  });

  return matrix
    .filter((row) => row[1] !== row[2] || row[2] !== row[3])
    .map((row) => mapStatusRow(row, managedFiles, workspaceConfigs));
}

export async function getVersionManagerStatus(): Promise<VersionManagerStatus> {
  ensureWorkspaceConfigsForManagedRows();

  const github = await getGitHubAuthStatus();
  const repository = mapRepositoryRow(getRepositoryRow());
  const changes = await listManagedChanges();
  const workspaceConfigs = listWorkspaceVersionConfigs();

  return {
    changes,
    github,
    managedFileCount: getManagedFileCount(),
    pendingChangeCount: changes.length,
    repository,
    shadowRepositoryReady: isLocalGitRepositoryReady(),
    workspaceConfigs
  };
}

export async function ensureVersionRepository(): Promise<VersionManagerStatus> {
  const github = await getGitHubAuthStatus();

  if (!github.account) {
    throw new Error('Bind a GitHub account before enabling version management.');
  }

  if (!github.hasVersionManagementScope) {
    throw new Error(`Rebind GitHub with the ${githubVersionManagementScope} scope before enabling version management.`);
  }

  const token = getRequiredGitHubToken();
  const repository = await getOrCreateGitHubRepository(token, github.account.login);

  await ensureLocalRepository(repository);
  upsertRepository(repository);

  return getVersionManagerStatus();
}

export async function syncMarkdownFile(filePath: string): Promise<VersionSyncResult> {
  const target = getManagedMarkdownTarget(filePath);

  if (!target) {
    return {
      reason: 'Only local filesystem markdown files are managed.',
      synced: false
    };
  }

  await ensureLocalRepository(mapRepositoryRow(getRepositoryRow()) ?? undefined);
  writeShadowFile(target);
  upsertManagedFile(target);
  writeWorkspaceManifest(target.workspaceFolderId);

  return {
    shadowPath: target.shadowPath,
    synced: true
  };
}

export async function commitAndPushVersionChanges(message: string): Promise<VersionCommitResult> {
  const status = await ensureVersionRepository();
  const changes = status.changes;
  const token = getRequiredGitHubToken();

  if (!changes.length) {
    if (!hasLocalDefaultBranchRef()) {
      return {
        pushed: false,
        status
      };
    }

    await pushDefaultBranch(token);

    return {
      pushed: true,
      status: await getVersionManagerStatus()
    };
  }

  const author = getGitAuthor(status.github);
  const commitMessage = message.trim() || 'Update Veloca markdown versions';

  for (const change of changes) {
    if (change.kind === 'deleted') {
      await git.remove({
        dir: getShadowRepositoryPath(),
        filepath: change.shadowPath,
        fs
      });
      continue;
    }

    await git.add({
      dir: getShadowRepositoryPath(),
      filepath: change.shadowPath,
      fs
    });
  }

  const commitOid = await git.commit({
    author,
    committer: author,
    dir: getShadowRepositoryPath(),
    fs,
    message: commitMessage,
    ref: defaultBranchRef
  });

  await pushDefaultBranch(token);

  return {
    commitOid,
    pushed: true,
    status: await getVersionManagerStatus()
  };
}
