import { randomUUID, createHash } from 'node:crypto';
import fs, {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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

export interface VersionManagerStatus {
  changes: VersionManagedChange[];
  github: GitHubAuthStatus;
  managedFileCount: number;
  pendingChangeCount: number;
  repository: VersionRepositoryStatus | null;
  shadowRepositoryReady: boolean;
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

function getVersionRootPath(): string {
  return join(app.getPath('userData'), 'version-manager');
}

function getShadowRepositoryPath(): string {
  return join(getVersionRootPath(), 'repo');
}

function normalizeTreePath(value: string): string {
  return value.split(sep).join('/').replace(/^\/+/, '');
}

function getContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
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

function getManagedMarkdownTarget(filePath: string): {
  content: string;
  contentHash: string;
  relativePath: string;
  resolvedPath: string;
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
  const shadowPath = `workspaces/${folder.id}/files/${relativePath}`;

  return {
    content,
    contentHash: getContentHash(content),
    relativePath,
    resolvedPath,
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
  return existsSync(join(getShadowRepositoryPath(), '.git'));
}

async function ensureLocalRepository(repository?: VersionRepositoryStatus): Promise<void> {
  const dir = getShadowRepositoryPath();

  mkdirSync(dir, { recursive: true });

  if (!isLocalGitRepositoryReady()) {
    await git.init({ defaultBranch, dir, fs });
  }

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
  }
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

function getManagedFileCount(): number {
  const row = getDatabase()
    .prepare('SELECT COUNT(*) AS count FROM version_managed_files WHERE status = 0')
    .get() as { count: number };

  return row.count;
}

function getWorkspaceManifestPath(workspaceFolderId: string): string {
  return `workspaces/${workspaceFolderId}/manifest.json`;
}

function writeWorkspaceManifest(workspaceFolderId: string): void {
  const rows = getManagedFileRows().filter((row) => row.workspace_folder_id === workspaceFolderId);

  if (!rows.length) {
    return;
  }

  const sourceRootPath = rows[0].source_root_path;
  const manifest = {
    displayName: basename(sourceRootPath),
    managedFiles: rows.map((row) => ({
      lastContentHash: row.content_hash,
      relativePath: row.relative_path,
      shadowPath: row.shadow_path,
      sourcePath: row.source_path
    })),
    sourceRootPath,
    updatedAt: Date.now(),
    workspaceFolderId
  };
  const manifestPath = join(getShadowRepositoryPath(), ...getWorkspaceManifestPath(workspaceFolderId).split('/'));

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

function mapStatusRow(row: StatusRow, managedFiles: VersionManagedFileRow[]): VersionManagedChange {
  const [shadowPath] = row;
  const managedFile = managedFiles.find((file) => file.shadow_path === shadowPath);
  const workspaceMatch = /^workspaces\/([^/]+)\//.exec(shadowPath);
  const workspaceFolderId = managedFile?.workspace_folder_id ?? workspaceMatch?.[1] ?? '';

  return {
    filePath: managedFile?.source_path ?? '',
    kind: getStatusKind(row),
    relativePath: managedFile?.relative_path ?? 'manifest.json',
    shadowPath,
    workspaceFolderId
  };
}

export async function listManagedChanges(): Promise<VersionManagedChange[]> {
  if (!isLocalGitRepositoryReady()) {
    return [];
  }

  const managedFiles = getManagedFileRows();
  const filepaths = Array.from(
    new Set([
      ...managedFiles.map((file) => file.shadow_path),
      ...managedFiles.map((file) => getWorkspaceManifestPath(file.workspace_folder_id))
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
    .map((row) => mapStatusRow(row, managedFiles));
}

export async function getVersionManagerStatus(): Promise<VersionManagerStatus> {
  const github = await getGitHubAuthStatus();
  const repository = mapRepositoryRow(getRepositoryRow());
  const changes = await listManagedChanges();

  return {
    changes,
    github,
    managedFileCount: getManagedFileCount(),
    pendingChangeCount: changes.length,
    repository,
    shadowRepositoryReady: isLocalGitRepositoryReady()
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

  if (!changes.length) {
    return {
      pushed: false,
      status
    };
  }

  const token = getRequiredGitHubToken();
  const author = getGitAuthor(status.github);
  const commitMessage = message.trim() || 'Update Veloca markdown versions';

  for (const change of changes) {
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
    ref: defaultBranch
  });

  await git.push({
    dir: getShadowRepositoryPath(),
    fs,
    http: electronGitHttpClient,
    onAuth: () => ({ username: token }),
    ref: defaultBranch,
    remote: 'origin'
  });

  return {
    commitOid,
    pushed: true,
    status: await getVersionManagerStatus()
  };
}
