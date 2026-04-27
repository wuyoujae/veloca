import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { getDatabase } from '../database/connection';

export interface WorkspaceFolder {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

export interface WorkspaceTreeNode {
  id: string;
  name: string;
  type: 'folder' | 'file';
  source: 'filesystem' | 'database';
  path: string;
  relativePath: string;
  workspaceFolderId: string;
  children?: WorkspaceTreeNode[];
}

export interface WorkspaceSnapshot {
  folders: WorkspaceFolder[];
  tree: WorkspaceTreeNode[];
  totalMarkdownFiles: number;
}

export interface MarkdownFileContent {
  path: string;
  name: string;
  content: string;
  relativePath: string;
  workspaceFolderId: string;
}

export interface FileOperationResult {
  snapshot: WorkspaceSnapshot;
  path?: string;
}

export interface SaveMarkdownFileAsResult {
  file: MarkdownFileContent;
  snapshot: WorkspaceSnapshot;
}

export type DocumentProvenanceWorkspaceType = 'database' | 'filesystem';

export interface DocumentProvenanceSnapshot {
  documentKey: string;
  documentPath: string;
  markdownHash: string;
  snapshotJson: string;
  workspaceFolderId: string;
  workspaceType: DocumentProvenanceWorkspaceType;
}

interface WorkspaceFolderRow {
  id: string;
  name: string;
  folder_path: string;
  created_at: number;
}

interface VirtualWorkspaceRow {
  id: string;
  name: string;
  created_at: number;
}

interface VirtualWorkspaceEntryRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  entry_type: number;
  name: string;
  content: string;
  created_at: number;
}

interface VirtualWorkspaceAssetRow {
  id: string;
  workspace_id: string;
  document_entry_id: string;
  asset_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  binary_content: Buffer;
  created_at: number;
}

interface DocumentProvenanceSnapshotRow {
  document_key: string;
  document_path: string;
  markdown_hash: string;
  snapshot_json: string;
  workspace_folder_id: string;
  workspace_type: number;
}

export interface WorkspaceAssetPayload {
  data: ArrayBuffer | Uint8Array;
  fileName: string;
  mimeType: string;
}

export interface WorkspaceResolvedAsset {
  assetPath: string;
  byteSize: number;
  exists: boolean;
  fileName: string;
  isExternal: boolean;
  mimeType: string;
  url: string;
}

export interface WorkspaceAssetBinary {
  byteSize: number;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const ignoredDirectoryNames = new Set([
  '.git',
  '.next',
  '.turbo',
  'dist',
  'node_modules',
  'out',
  'release'
]);

export function addWorkspaceFolders(folderPaths: string[]): WorkspaceSnapshot {
  const insert = getDatabase().prepare(`
    INSERT INTO workspace_folders (id, folder_path, name, status, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(folder_path) DO UPDATE SET
      name = excluded.name,
      status = 0,
      updated_at = excluded.updated_at
  `);

  const now = Date.now();

  for (const folderPath of folderPaths) {
    const resolvedPath = realpathSync(folderPath);
    const stats = statSync(resolvedPath);

    if (!stats.isDirectory()) {
      continue;
    }

    insert.run(randomUUID(), resolvedPath, basename(resolvedPath), now, now);
  }

  return getWorkspaceSnapshot();
}

export function createDatabaseWorkspace(name: string): FileOperationResult {
  const now = Date.now();
  const workspaceName = normalizeEntryName(name, 'folder');
  const workspaceId = randomUUID();

  getDatabase()
    .prepare(
      `
      INSERT INTO virtual_workspaces (id, name, status, created_at, updated_at)
      VALUES (?, ?, 0, ?, ?)
      `
    )
    .run(workspaceId, workspaceName, now, now);

  return {
    snapshot: getWorkspaceSnapshot(),
    path: getDatabaseRootPath(workspaceId)
  };
}

export function removeWorkspaceFolder(workspaceFolderId: string): WorkspaceSnapshot {
  deactivateWorkspaceFolderProvenance(workspaceFolderId);

  getDatabase()
    .prepare(
      `
      UPDATE workspace_folders
      SET status = 1, updated_at = ?
      WHERE id = ?
      `
    )
    .run(Date.now(), workspaceFolderId);

  getDatabase()
    .prepare(
      `
      UPDATE virtual_workspaces
      SET status = 1, updated_at = ?
      WHERE id = ?
      `
    )
    .run(Date.now(), workspaceFolderId);

  getDatabase()
    .prepare(
      `
      UPDATE virtual_workspace_assets
      SET status = 1, updated_at = ?
      WHERE workspace_id = ?
      `
    )
    .run(Date.now(), workspaceFolderId);

  return getWorkspaceSnapshot();
}

export function getWorkspaceSnapshot(): WorkspaceSnapshot {
  const folders = getWorkspaceFolders();
  const tree: WorkspaceTreeNode[] = [];
  let totalMarkdownFiles = 0;

  for (const folder of folders) {
    const node = scanWorkspaceFolder(folder);

    if (node) {
      tree.push(node);
      totalMarkdownFiles += countMarkdownFiles(node);
    }
  }

  for (const node of getDatabaseWorkspaceNodes()) {
    tree.push(node);
    totalMarkdownFiles += countMarkdownFiles(node);
  }

  return {
    folders,
    tree,
    totalMarkdownFiles
  };
}

export function readMarkdownFile(filePath: string): MarkdownFileContent {
  if (isDatabasePath(filePath)) {
    return readDatabaseMarkdownFile(filePath);
  }

  const resolvedPath = realpathSync(filePath);

  if (!isMarkdownFile(resolvedPath) || !isInsideWorkspace(resolvedPath)) {
    throw new Error('The selected file is not an allowed markdown file.');
  }

  const folder = findWorkspaceFolderForPath(resolvedPath);

  if (!folder) {
    throw new Error('The selected file is outside the current workspace.');
  }

  return {
    path: resolvedPath,
    name: basename(resolvedPath),
    content: readFileSync(resolvedPath, 'utf8'),
    relativePath: relative(folder.path, resolvedPath).split(sep).join('/'),
    workspaceFolderId: folder.id
  };
}

export function saveMarkdownFile(filePath: string, content: string): MarkdownFileContent {
  if (isDatabasePath(filePath)) {
    return saveDatabaseMarkdownFile(filePath, content);
  }

  const resolvedPath = resolveExistingWorkspacePath(filePath);

  if (!isMarkdownFile(resolvedPath)) {
    throw new Error('Only markdown files can be saved.');
  }

  const folder = findWorkspaceFolderForPath(resolvedPath);

  if (!folder) {
    throw new Error('The selected file is outside the current workspace.');
  }

  writeFileSync(resolvedPath, content, 'utf8');

  return {
    path: resolvedPath,
    name: basename(resolvedPath),
    content,
    relativePath: relative(folder.path, resolvedPath).split(sep).join('/'),
    workspaceFolderId: folder.id
  };
}

export function saveMarkdownFileAs(parentPath: string, name: string, content: string): SaveMarkdownFileAsResult {
  if (isDatabasePath(parentPath)) {
    return saveDatabaseMarkdownFileAs(parentPath, name, content);
  }

  const parentDirectory = resolveExistingWorkspaceDirectory(parentPath);
  const safeName = normalizeEntryName(name, 'file');

  if (!isMarkdownFile(safeName)) {
    throw new Error('Only markdown files can be saved.');
  }

  const targetPath = getAvailablePath(join(parentDirectory, safeName));
  const folder = findWorkspaceFolderForPath(parentDirectory);

  if (!folder) {
    throw new Error('The selected folder is outside the current workspace.');
  }

  writeFileSync(targetPath, content, { encoding: 'utf8', flag: 'wx' });

  return {
    file: {
      path: targetPath,
      name: basename(targetPath),
      content,
      relativePath: relative(folder.path, targetPath).split(sep).join('/'),
      workspaceFolderId: folder.id
    },
    snapshot: getWorkspaceSnapshot()
  };
}

export function readDocumentProvenanceSnapshot(documentKey: string): DocumentProvenanceSnapshot | null {
  const key = normalizeDocumentProvenanceKey(documentKey);
  const row = getDatabase()
    .prepare(
      `
      SELECT document_key, workspace_type, document_path, workspace_folder_id, markdown_hash, snapshot_json
      FROM document_provenance_snapshots
      WHERE document_key = ? AND status = 0
      `
    )
    .get(key) as DocumentProvenanceSnapshotRow | undefined;

  return row ? mapDocumentProvenanceRow(row) : null;
}

export function saveDocumentProvenanceSnapshot(
  snapshot: DocumentProvenanceSnapshot
): DocumentProvenanceSnapshot {
  const normalized = normalizeDocumentProvenanceSnapshot(snapshot);
  const now = Date.now();

  getDatabase()
    .prepare(
      `
      INSERT INTO document_provenance_snapshots
        (id, document_key, workspace_type, document_path, workspace_folder_id, markdown_hash, snapshot_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(document_key) DO UPDATE SET
        workspace_type = excluded.workspace_type,
        document_path = excluded.document_path,
        workspace_folder_id = excluded.workspace_folder_id,
        markdown_hash = excluded.markdown_hash,
        snapshot_json = excluded.snapshot_json,
        status = 0,
        updated_at = excluded.updated_at
      `
    )
    .run(
      randomUUID(),
      normalized.documentKey,
      getDocumentProvenanceWorkspaceTypeValue(normalized.workspaceType),
      normalized.documentPath,
      normalized.workspaceFolderId,
      normalized.markdownHash,
      normalized.snapshotJson,
      now,
      now
    );

  return normalized;
}

export function deleteDocumentProvenanceSnapshot(documentKey: string): void {
  getDatabase()
    .prepare('UPDATE document_provenance_snapshots SET status = 1, updated_at = ? WHERE document_key = ? AND status = 0')
    .run(Date.now(), normalizeDocumentProvenanceKey(documentKey));
}

export function saveWorkspaceAsset(
  documentPath: string,
  payload: WorkspaceAssetPayload
): WorkspaceResolvedAsset {
  const fileName = createStoredAssetFileName(payload.fileName, payload.mimeType);
  const buffer = toBuffer(payload.data);

  if (isDatabasePath(documentPath)) {
    return saveDatabaseAsset(documentPath, payload.mimeType, fileName, buffer);
  }

  return saveFilesystemAsset(documentPath, payload.mimeType, fileName, buffer);
}

export function resolveWorkspaceAsset(documentPath: string, assetPath: string): WorkspaceResolvedAsset {
  if (isExternalAssetSource(assetPath)) {
    return {
      assetPath,
      byteSize: 0,
      exists: true,
      fileName: basename(assetPath),
      isExternal: true,
      mimeType: getMimeTypeFromAssetPath(assetPath),
      url: assetPath
    };
  }

  if (isDatabasePath(documentPath)) {
    const asset = getDatabaseAsset(documentPath, assetPath);

    return {
      assetPath: asset.asset_path,
      byteSize: asset.byte_size,
      exists: true,
      fileName: asset.file_name,
      isExternal: false,
      mimeType: asset.mime_type,
      url: createAssetProtocolUrl(documentPath, asset.asset_path)
    };
  }

  const resolvedDocumentPath = resolveExistingWorkspacePath(documentPath);
  const absoluteAssetPath = resolve(dirname(resolvedDocumentPath), assetPath);

  if (!isInsideWorkspace(absoluteAssetPath)) {
    throw new Error('Asset path is outside the current workspace.');
  }

  if (!existsSync(absoluteAssetPath)) {
    throw new Error('Asset not found.');
  }

  const stats = statSync(absoluteAssetPath);

  return {
    assetPath,
    byteSize: stats.size,
    exists: true,
    fileName: basename(absoluteAssetPath),
    isExternal: false,
    mimeType: getMimeTypeFromAssetPath(absoluteAssetPath),
    url: createAssetProtocolUrl(resolvedDocumentPath, assetPath)
  };
}

export function readWorkspaceAssetMeta(documentPath: string, assetPath: string): WorkspaceResolvedAsset {
  return resolveWorkspaceAsset(documentPath, assetPath);
}

export function readWorkspaceAssetBinary(
  documentPath: string,
  assetPath: string
): WorkspaceAssetBinary {
  if (isDatabasePath(documentPath)) {
    const asset = getDatabaseAsset(documentPath, assetPath);

    return {
      buffer: asset.binary_content,
      byteSize: asset.byte_size,
      fileName: asset.file_name,
      mimeType: asset.mime_type
    };
  }

  const resolvedDocumentPath = resolveExistingWorkspacePath(documentPath);
  const absoluteAssetPath = resolve(dirname(resolvedDocumentPath), assetPath);

  if (!isInsideWorkspace(absoluteAssetPath) || !existsSync(absoluteAssetPath)) {
    throw new Error('Asset not found.');
  }

  return {
    buffer: readFileSync(absoluteAssetPath),
    byteSize: statSync(absoluteAssetPath).size,
    fileName: basename(absoluteAssetPath),
    mimeType: getMimeTypeFromAssetPath(absoluteAssetPath)
  };
}

export function createWorkspaceEntry(
  parentPath: string,
  entryType: 'file' | 'folder',
  name: string
): FileOperationResult {
  if (isDatabasePath(parentPath)) {
    return createDatabaseEntry(parentPath, entryType, name);
  }

  const parentDirectory = resolveExistingWorkspaceDirectory(parentPath);
  const safeName = normalizeEntryName(name, entryType);
  const targetPath = getAvailablePath(join(parentDirectory, safeName));

  if (entryType === 'folder') {
    mkdirSync(targetPath, { recursive: false });
  } else {
    writeFileSync(targetPath, '', { flag: 'wx' });
  }

  return {
    snapshot: getWorkspaceSnapshot(),
    path: targetPath
  };
}

export function renameWorkspaceEntry(filePath: string, name: string): FileOperationResult {
  if (isDatabasePath(filePath)) {
    return renameDatabaseEntry(filePath, name);
  }

  const sourcePath = resolveExistingWorkspacePath(filePath);
  const stats = statSync(sourcePath);
  const safeName = normalizeEntryName(name, stats.isDirectory() ? 'folder' : 'file');
  const targetPath = join(dirname(sourcePath), safeName);

  if (sourcePath === targetPath) {
    return {
      snapshot: getWorkspaceSnapshot(),
      path: sourcePath
    };
  }

  if (existsSync(targetPath)) {
    throw new Error('A file or folder with that name already exists.');
  }

  renameSync(sourcePath, targetPath);
  moveFilesystemDocumentProvenance(sourcePath, targetPath);

  return {
    snapshot: getWorkspaceSnapshot(),
    path: targetPath
  };
}

export function duplicateWorkspaceEntry(filePath: string): FileOperationResult {
  if (isDatabasePath(filePath)) {
    return duplicateDatabaseEntry(filePath);
  }

  const sourcePath = resolveExistingWorkspacePath(filePath);
  const targetPath = getCopyPath(sourcePath, dirname(sourcePath));

  cpSync(sourcePath, targetPath, {
    recursive: true,
    errorOnExist: true
  });
  copyFilesystemDocumentProvenance(sourcePath, targetPath);

  return {
    snapshot: getWorkspaceSnapshot(),
    path: targetPath
  };
}

export function pasteWorkspaceEntry(
  sourcePath: string,
  targetFolderPath: string,
  mode: 'copy' | 'cut'
): FileOperationResult {
  if (isDatabasePath(sourcePath) || isDatabasePath(targetFolderPath)) {
    return pasteDatabaseEntry(sourcePath, targetFolderPath, mode);
  }

  const resolvedSourcePath = resolveExistingWorkspacePath(sourcePath);
  const targetDirectory = resolveExistingWorkspaceDirectory(targetFolderPath);
  const stats = statSync(resolvedSourcePath);
  const targetPath = getAvailablePath(join(targetDirectory, basename(resolvedSourcePath)));

  if (stats.isDirectory() && isSameOrChildPath(resolvedSourcePath, targetDirectory)) {
    throw new Error('A folder cannot be pasted into itself.');
  }

  if (mode === 'cut') {
    renameSync(resolvedSourcePath, targetPath);
    moveFilesystemDocumentProvenance(resolvedSourcePath, targetPath);
  } else {
    cpSync(resolvedSourcePath, targetPath, {
      recursive: true,
      errorOnExist: true
    });
    copyFilesystemDocumentProvenance(resolvedSourcePath, targetPath);
  }

  return {
    snapshot: getWorkspaceSnapshot(),
    path: targetPath
  };
}

export function validateWorkspacePath(filePath: string): string {
  if (isDatabasePath(filePath)) {
    assertDatabasePath(filePath);
    return filePath;
  }

  return resolveExistingWorkspacePath(filePath);
}

export function deleteWorkspaceEntry(filePath: string): WorkspaceSnapshot {
  if (!isDatabasePath(filePath)) {
    throw new Error('Only database entries can be deleted through this function.');
  }

  const entry = getDatabaseEntryByPath(filePath);
  deactivateDatabaseProvenance(entry.id);
  deactivateDatabaseEntry(entry.id);
  return getWorkspaceSnapshot();
}

function getWorkspaceFolders(): WorkspaceFolder[] {
  const rows = getDatabase()
    .prepare(
      `
      SELECT id, name, folder_path, created_at
      FROM workspace_folders
      WHERE status = 0
      ORDER BY created_at ASC
      `
    )
    .all() as WorkspaceFolderRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    path: row.folder_path,
    createdAt: row.created_at
  }));
}

function scanWorkspaceFolder(folder: WorkspaceFolder): WorkspaceTreeNode | null {
  try {
    const children = scanDirectory(folder.path, folder.path, folder.id);

    return {
      id: `folder:${folder.path}`,
      name: folder.name,
      type: 'folder',
      source: 'filesystem',
      path: folder.path,
      relativePath: '',
      workspaceFolderId: folder.id,
      children
    };
  } catch {
    return null;
  }
}

function scanDirectory(
  directoryPath: string,
  rootPath: string,
  workspaceFolderId: string
): WorkspaceTreeNode[] {
  let entries = readdirSync(directoryPath, { withFileTypes: true });

  entries = entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

  const nodes: WorkspaceTreeNode[] = [];

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name)) {
        continue;
      }

      const children = safeScanDirectory(entryPath, rootPath, workspaceFolderId);

      nodes.push({
        id: `folder:${entryPath}`,
        name: entry.name,
        type: 'folder',
        source: 'filesystem',
        path: entryPath,
        relativePath: relative(rootPath, entryPath),
        workspaceFolderId,
        children
      });

      continue;
    }

    if (entry.isFile() && isMarkdownFile(entry.name)) {
      nodes.push({
        id: `file:${entryPath}`,
        name: entry.name,
        type: 'file',
        source: 'filesystem',
        path: entryPath,
        relativePath: relative(rootPath, entryPath).split(sep).join('/'),
        workspaceFolderId
      });
    }
  }

  return nodes;
}

function safeScanDirectory(
  directoryPath: string,
  rootPath: string,
  workspaceFolderId: string
): WorkspaceTreeNode[] {
  try {
    return scanDirectory(directoryPath, rootPath, workspaceFolderId);
  } catch {
    return [];
  }
}

function countMarkdownFiles(node: WorkspaceTreeNode): number {
  if (node.type === 'file') {
    return 1;
  }

  return node.children?.reduce((count, child) => count + countMarkdownFiles(child), 0) ?? 0;
}

function isMarkdownFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() === '.md';
}

function isInsideWorkspace(filePath: string): boolean {
  return getWorkspaceFolders().some((folder) => {
    const relativePath = relative(folder.path, filePath);
    return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith(sep));
  });
}

function findWorkspaceFolderForPath(filePath: string): WorkspaceFolder | undefined {
  return getWorkspaceFolders().find((folder) => {
    const relativePath = relative(folder.path, filePath);
    return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith(sep));
  });
}

function getDatabaseWorkspaceNodes(): WorkspaceTreeNode[] {
  const roots = getDatabase()
    .prepare(
      `
      SELECT id, name, created_at
      FROM virtual_workspaces
      WHERE status = 0
      ORDER BY created_at ASC
      `
    )
    .all() as VirtualWorkspaceRow[];

  return roots.map((root) => ({
    id: `database-root:${root.id}`,
    name: root.name,
    type: 'folder',
    source: 'database',
    path: getDatabaseRootPath(root.id),
    relativePath: '',
    workspaceFolderId: root.id,
    children: getDatabaseChildNodes(root.id, null)
  }));
}

function getDatabaseChildNodes(workspaceId: string, parentId: string | null): WorkspaceTreeNode[] {
  const rows = getDatabase()
    .prepare(
      `
      SELECT id, workspace_id, parent_id, entry_type, name, content, created_at
      FROM virtual_workspace_entries
      WHERE workspace_id = ? AND parent_id IS ? AND status = 0
      ORDER BY entry_type ASC, name ASC
      `
    )
    .all(workspaceId, parentId) as VirtualWorkspaceEntryRow[];

  return rows.map((row) => ({
    id: `database-entry:${row.id}`,
    name: row.name,
    type: row.entry_type === 0 ? 'folder' : 'file',
    source: 'database',
    path: getDatabaseEntryPath(row.id),
    relativePath: getDatabaseRelativePath(row),
    workspaceFolderId: row.workspace_id,
    children: row.entry_type === 0 ? getDatabaseChildNodes(row.workspace_id, row.id) : undefined
  }));
}

function readDatabaseMarkdownFile(filePath: string): MarkdownFileContent {
  const entry = getDatabaseEntryByPath(filePath);

  if (entry.entry_type !== 1) {
    throw new Error('The selected database entry is not a markdown file.');
  }

  return {
    path: getDatabaseEntryPath(entry.id),
    name: entry.name,
    content: entry.content,
    relativePath: getDatabaseRelativePath(entry),
    workspaceFolderId: entry.workspace_id
  };
}

function saveDatabaseMarkdownFile(filePath: string, content: string): MarkdownFileContent {
  const entry = getDatabaseEntryByPath(filePath);

  if (entry.entry_type !== 1) {
    throw new Error('The selected database entry is not a markdown file.');
  }

  getDatabase()
    .prepare('UPDATE virtual_workspace_entries SET content = ?, updated_at = ? WHERE id = ? AND status = 0')
    .run(content, Date.now(), entry.id);

  return {
    path: getDatabaseEntryPath(entry.id),
    name: entry.name,
    content,
    relativePath: getDatabaseRelativePath(entry),
    workspaceFolderId: entry.workspace_id
  };
}

function saveFilesystemAsset(
  documentPath: string,
  mimeType: string,
  fileName: string,
  buffer: Buffer
): WorkspaceResolvedAsset {
  const resolvedDocumentPath = resolveExistingWorkspacePath(documentPath);

  if (!isMarkdownFile(resolvedDocumentPath)) {
    throw new Error('Assets can only be attached to markdown files.');
  }

  const assetDirectoryPath = join(
    dirname(resolvedDocumentPath),
    `${basename(resolvedDocumentPath, extname(resolvedDocumentPath))}.assets`
  );
  mkdirSync(assetDirectoryPath, { recursive: true });

  const absoluteAssetPath = getAvailablePath(join(assetDirectoryPath, fileName));
  writeFileSync(absoluteAssetPath, buffer);

  const relativeAssetPath = `./${relative(dirname(resolvedDocumentPath), absoluteAssetPath)
    .split(sep)
    .join('/')}`;

  return {
    assetPath: relativeAssetPath,
    byteSize: buffer.byteLength,
    exists: true,
    fileName: basename(absoluteAssetPath),
    isExternal: false,
    mimeType,
    url: createAssetProtocolUrl(resolvedDocumentPath, relativeAssetPath)
  };
}

function saveDatabaseAsset(
  documentPath: string,
  mimeType: string,
  fileName: string,
  buffer: Buffer
): WorkspaceResolvedAsset {
  const entry = getDatabaseEntryByPath(documentPath);

  if (entry.entry_type !== 1) {
    throw new Error('Assets can only be attached to markdown documents.');
  }

  const assetPath = `./${basename(entry.name, extname(entry.name))}.assets/${fileName}`;
  const now = Date.now();

  getDatabase()
    .prepare(
      `
      INSERT INTO virtual_workspace_assets
        (id, workspace_id, document_entry_id, asset_path, file_name, mime_type, byte_size, binary_content, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `
    )
    .run(
      randomUUID(),
      entry.workspace_id,
      entry.id,
      assetPath,
      fileName,
      mimeType,
      buffer.byteLength,
      buffer,
      now,
      now
    );

  return {
    assetPath,
    byteSize: buffer.byteLength,
    exists: true,
    fileName,
    isExternal: false,
    mimeType,
    url: createAssetProtocolUrl(getDatabaseEntryPath(entry.id), assetPath)
  };
}

function createDatabaseEntry(
  parentPath: string,
  entryType: 'file' | 'folder',
  name: string
): FileOperationResult {
  const parent = getDatabaseFolderTarget(parentPath);
  const safeName = normalizeEntryName(name, entryType);
  const now = Date.now();
  const id = randomUUID();

  getDatabase()
    .prepare(
      `
      INSERT INTO virtual_workspace_entries
        (id, workspace_id, parent_id, entry_type, name, content, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', 0, ?, ?)
      `
    )
    .run(id, parent.workspaceId, parent.parentId, entryType === 'folder' ? 0 : 1, safeName, now, now);

  return {
    snapshot: getWorkspaceSnapshot(),
    path: getDatabaseEntryPath(id)
  };
}

function saveDatabaseMarkdownFileAs(parentPath: string, name: string, content: string): SaveMarkdownFileAsResult {
  const parent = getDatabaseFolderTarget(parentPath);
  const normalizedName = normalizeEntryName(name, 'file');

  if (!isMarkdownFile(normalizedName)) {
    throw new Error('Only markdown files can be saved.');
  }

  const safeName = getAvailableDatabaseEntryName(parent.workspaceId, parent.parentId, normalizedName);
  const now = Date.now();
  const id = randomUUID();

  getDatabase()
    .prepare(
      `
      INSERT INTO virtual_workspace_entries
        (id, workspace_id, parent_id, entry_type, name, content, status, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, 0, ?, ?)
      `
    )
    .run(id, parent.workspaceId, parent.parentId, safeName, content, now, now);

  const entry = getDatabaseEntryByPath(getDatabaseEntryPath(id));

  return {
    file: {
      path: getDatabaseEntryPath(id),
      name: entry.name,
      content,
      relativePath: getDatabaseRelativePath(entry),
      workspaceFolderId: entry.workspace_id
    },
    snapshot: getWorkspaceSnapshot()
  };
}

function getAvailableDatabaseEntryName(workspaceId: string, parentId: string | null, name: string): string {
  if (!databaseEntryNameExists(workspaceId, parentId, name)) {
    return name;
  }

  const extension = extname(name);
  const nameWithoutExtension = extension ? basename(name, extension) : name;

  for (let index = 1; index < 1000; index += 1) {
    const candidateName = `${nameWithoutExtension} ${index}${extension}`;

    if (!databaseEntryNameExists(workspaceId, parentId, candidateName)) {
      return candidateName;
    }
  }

  throw new Error('Unable to create a unique database file name.');
}

function databaseEntryNameExists(workspaceId: string, parentId: string | null, name: string): boolean {
  const row = getDatabase()
    .prepare(
      `
      SELECT id
      FROM virtual_workspace_entries
      WHERE workspace_id = ? AND parent_id IS ? AND name = ? AND status = 0
      LIMIT 1
      `
    )
    .get(workspaceId, parentId, name) as { id: string } | undefined;

  return Boolean(row);
}

function renameDatabaseEntry(filePath: string, name: string): FileOperationResult {
  if (isDatabaseRootPath(filePath)) {
    const workspaceId = getDatabaseRootId(filePath);
    const safeName = normalizeEntryName(name, 'folder');

    getDatabase()
      .prepare('UPDATE virtual_workspaces SET name = ?, updated_at = ? WHERE id = ? AND status = 0')
      .run(safeName, Date.now(), workspaceId);

    return {
      snapshot: getWorkspaceSnapshot(),
      path: filePath
    };
  }

  const entry = getDatabaseEntryByPath(filePath);
  const safeName = normalizeEntryName(name, entry.entry_type === 0 ? 'folder' : 'file');

  getDatabase()
    .prepare('UPDATE virtual_workspace_entries SET name = ?, updated_at = ? WHERE id = ? AND status = 0')
    .run(safeName, Date.now(), entry.id);

  return {
    snapshot: getWorkspaceSnapshot(),
    path: getDatabaseEntryPath(entry.id)
  };
}

function duplicateDatabaseEntry(filePath: string): FileOperationResult {
  const entry = getDatabaseEntryByPath(filePath);
  const copyId = cloneDatabaseEntry(entry, entry.parent_id, `${entry.name} copy`);

  return {
    snapshot: getWorkspaceSnapshot(),
    path: getDatabaseEntryPath(copyId)
  };
}

function pasteDatabaseEntry(
  sourcePath: string,
  targetFolderPath: string,
  mode: 'copy' | 'cut'
): FileOperationResult {
  if (!isDatabasePath(sourcePath) || !isDatabasePath(targetFolderPath)) {
    throw new Error('Database entries can only be pasted inside database workspaces.');
  }

  const source = getDatabaseEntryByPath(sourcePath);
  const target = getDatabaseFolderTarget(targetFolderPath);

  if (
    source.entry_type === 0 &&
    target.parentId &&
    (source.id === target.parentId || isDatabaseDescendant(source.id, target.parentId))
  ) {
    throw new Error('A database folder cannot be pasted into itself.');
  }

  if (mode === 'cut') {
    getDatabase()
      .prepare(
        `
        UPDATE virtual_workspace_entries
        SET workspace_id = ?, parent_id = ?, updated_at = ?
        WHERE id = ? AND status = 0
        `
      )
      .run(target.workspaceId, target.parentId, Date.now(), source.id);

    updateDatabaseAssetWorkspace(source.id, target.workspaceId);
    updateDatabaseProvenanceWorkspace(source.id, target.workspaceId);

    return {
      snapshot: getWorkspaceSnapshot(),
      path: getDatabaseEntryPath(source.id)
    };
  }

  const copyId = cloneDatabaseEntry(source, target.parentId, source.name, target.workspaceId);

  return {
    snapshot: getWorkspaceSnapshot(),
    path: getDatabaseEntryPath(copyId)
  };
}

function cloneDatabaseEntry(
  entry: VirtualWorkspaceEntryRow,
  parentId: string | null,
  name: string,
  workspaceId = entry.workspace_id
): string {
  const now = Date.now();
  const id = randomUUID();

  getDatabase()
    .prepare(
      `
      INSERT INTO virtual_workspace_entries
        (id, workspace_id, parent_id, entry_type, name, content, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      `
    )
    .run(id, workspaceId, parentId, entry.entry_type, name, entry.content, now, now);

  if (entry.entry_type === 1) {
    cloneDatabaseAssets(entry.id, id, workspaceId);
    copyDatabaseDocumentProvenance(entry.id, id, workspaceId);
  }

  if (entry.entry_type === 0) {
    const children = getDatabase()
      .prepare(
        `
        SELECT id, workspace_id, parent_id, entry_type, name, content, created_at
        FROM virtual_workspace_entries
        WHERE parent_id = ? AND status = 0
        ORDER BY entry_type ASC, name ASC
        `
      )
      .all(entry.id) as VirtualWorkspaceEntryRow[];

    for (const child of children) {
      cloneDatabaseEntry(child, id, child.name, workspaceId);
    }
  }

  return id;
}

function deactivateDatabaseEntry(entryId: string): void {
  getDatabase()
    .prepare('UPDATE virtual_workspace_entries SET status = 1, updated_at = ? WHERE id = ?')
    .run(Date.now(), entryId);

  deactivateDatabaseAssets(entryId);

  const children = getDatabase()
    .prepare('SELECT id FROM virtual_workspace_entries WHERE parent_id = ? AND status = 0')
    .all(entryId) as Array<{ id: string }>;

  for (const child of children) {
    deactivateDatabaseEntry(child.id);
  }
}

function cloneDatabaseAssets(sourceDocumentEntryId: string, targetDocumentEntryId: string, workspaceId: string): void {
  const assets = getDatabase()
    .prepare(
      `
      SELECT id, workspace_id, document_entry_id, asset_path, file_name, mime_type, byte_size, binary_content, created_at
      FROM virtual_workspace_assets
      WHERE document_entry_id = ? AND status = 0
      ORDER BY created_at ASC
      `
    )
    .all(sourceDocumentEntryId) as VirtualWorkspaceAssetRow[];

  const now = Date.now();
  const insert = getDatabase().prepare(
    `
    INSERT INTO virtual_workspace_assets
      (id, workspace_id, document_entry_id, asset_path, file_name, mime_type, byte_size, binary_content, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `
  );

  assets.forEach((asset) => {
    insert.run(
      randomUUID(),
      workspaceId,
      targetDocumentEntryId,
      asset.asset_path,
      asset.file_name,
      asset.mime_type,
      asset.byte_size,
      asset.binary_content,
      now,
      now
    );
  });
}

function deactivateDatabaseAssets(documentEntryId: string): void {
  getDatabase()
    .prepare('UPDATE virtual_workspace_assets SET status = 1, updated_at = ? WHERE document_entry_id = ? AND status = 0')
    .run(Date.now(), documentEntryId);
}

function updateDatabaseAssetWorkspace(entryId: string, workspaceId: string): void {
  const entry = getDatabase()
    .prepare(
      `
      SELECT id, workspace_id, parent_id, entry_type, name, content, created_at
      FROM virtual_workspace_entries
      WHERE id = ? AND status = 0
      `
    )
    .get(entryId) as VirtualWorkspaceEntryRow | undefined;

  if (!entry) {
    return;
  }

  if (entry.entry_type === 1) {
    getDatabase()
      .prepare(
        `
        UPDATE virtual_workspace_assets
        SET workspace_id = ?, updated_at = ?
        WHERE document_entry_id = ? AND status = 0
        `
      )
      .run(workspaceId, Date.now(), entryId);
  }

  if (entry.entry_type === 0) {
    const children = getDatabase()
      .prepare(
        `
        SELECT id, workspace_id, parent_id, entry_type, name, content, created_at
        FROM virtual_workspace_entries
        WHERE parent_id = ? AND status = 0
        `
      )
      .all(entryId) as VirtualWorkspaceEntryRow[];

    children.forEach((child) => updateDatabaseAssetWorkspace(child.id, workspaceId));
  }
}

function isDatabaseDescendant(parentId: string, childId: string): boolean {
  let currentId: string | null = childId;

  while (currentId) {
    if (currentId === parentId) {
      return true;
    }

    const row = getDatabase()
      .prepare('SELECT parent_id FROM virtual_workspace_entries WHERE id = ? AND status = 0')
      .get(currentId) as { parent_id: string | null } | undefined;

    currentId = row?.parent_id ?? null;
  }

  return false;
}

function getDatabaseFolderTarget(filePath: string): { workspaceId: string; parentId: string | null } {
  if (isDatabaseRootPath(filePath)) {
    return {
      workspaceId: getDatabaseRootId(filePath),
      parentId: null
    };
  }

  const entry = getDatabaseEntryByPath(filePath);

  if (entry.entry_type !== 0) {
    throw new Error('Target database entry is not a folder.');
  }

  return {
    workspaceId: entry.workspace_id,
    parentId: entry.id
  };
}

function getDatabaseEntryByPath(filePath: string): VirtualWorkspaceEntryRow {
  const entryId = getDatabaseEntryId(filePath);
  const row = getDatabase()
    .prepare(
      `
      SELECT id, workspace_id, parent_id, entry_type, name, content, created_at
      FROM virtual_workspace_entries
      WHERE id = ? AND status = 0
      `
    )
    .get(entryId) as VirtualWorkspaceEntryRow | undefined;

  if (!row) {
    throw new Error('Database entry not found.');
  }

  return row;
}

function getDatabaseAsset(documentPath: string, assetPath: string): VirtualWorkspaceAssetRow {
  const entry = getDatabaseEntryByPath(documentPath);
  const normalizedAssetPath = normalizeAssetPath(assetPath);
  const asset = getDatabase()
    .prepare(
      `
      SELECT id, workspace_id, document_entry_id, asset_path, file_name, mime_type, byte_size, binary_content, created_at
      FROM virtual_workspace_assets
      WHERE document_entry_id = ? AND asset_path = ? AND status = 0
      `
    )
    .get(entry.id, normalizedAssetPath) as VirtualWorkspaceAssetRow | undefined;

  if (!asset) {
    throw new Error('Database asset not found.');
  }

  return asset;
}

function getDatabaseRelativePath(entry: VirtualWorkspaceEntryRow): string {
  const names = [entry.name];
  let parentId = entry.parent_id;

  while (parentId) {
    const parent = getDatabase()
      .prepare(
        `
        SELECT id, workspace_id, parent_id, entry_type, name, content, created_at
        FROM virtual_workspace_entries
        WHERE id = ? AND status = 0
        `
      )
      .get(parentId) as VirtualWorkspaceEntryRow | undefined;

    if (!parent) {
      break;
    }

    names.unshift(parent.name);
    parentId = parent.parent_id;
  }

  return names.join('/');
}

function assertDatabasePath(filePath: string): void {
  if (isDatabaseRootPath(filePath)) {
    const workspaceId = getDatabaseRootId(filePath);
    const root = getDatabase()
      .prepare('SELECT id FROM virtual_workspaces WHERE id = ? AND status = 0')
      .get(workspaceId);

    if (!root) {
      throw new Error('Database workspace not found.');
    }

    return;
  }

  getDatabaseEntryByPath(filePath);
}

function getDatabaseRootPath(workspaceId: string): string {
  return `veloca-db://root/${workspaceId}`;
}

function getDatabaseEntryPath(entryId: string): string {
  return `veloca-db://entry/${entryId}`;
}

function isDatabasePath(filePath: string): boolean {
  return filePath.startsWith('veloca-db://');
}

function isDatabaseRootPath(filePath: string): boolean {
  return filePath.startsWith('veloca-db://root/');
}

function getDatabaseRootId(filePath: string): string {
  return filePath.replace('veloca-db://root/', '');
}

function getDatabaseEntryId(filePath: string): string {
  if (!filePath.startsWith('veloca-db://entry/')) {
    throw new Error('Invalid database entry path.');
  }

  return filePath.replace('veloca-db://entry/', '');
}

function createStoredAssetFileName(fileName: string, mimeType: string): string {
  const originalExtension = extname(fileName);
  const safeBaseName = basename(fileName, originalExtension)
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const fallbackExtension = getExtensionFromMimeType(mimeType);
  const extension = (originalExtension || fallbackExtension || '').toLowerCase();
  const baseName = safeBaseName || 'asset';

  return `${randomUUID()}-${baseName}${extension}`;
}

function normalizeAssetPath(assetPath: string): string {
  const normalized = assetPath.trim().replace(/\\/g, '/');

  if (!normalized.startsWith('./') && !normalized.startsWith('../')) {
    return normalized.startsWith('/') ? `.${normalized}` : `./${normalized}`;
  }

  return normalized;
}

function createAssetProtocolUrl(documentPath: string, assetPath: string): string {
  const params = new URLSearchParams({
    assetPath: normalizeAssetPath(assetPath),
    documentPath
  });

  return `veloca-asset://asset?${params.toString()}`;
}

function isExternalAssetSource(assetPath: string): boolean {
  return /^(https?:\/\/|data:|blob:|veloca-asset:\/\/)/i.test(assetPath);
}

function toBuffer(data: ArrayBuffer | Uint8Array): Buffer {
  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }

  return Buffer.from(new Uint8Array(data));
}

function getExtensionFromMimeType(mimeType: string): string {
  const normalizedMimeType = mimeType.toLowerCase();
  const extensionMap: Record<string, string> = {
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/webm': '.webm',
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/svg+xml': '.svg',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/ogg': '.ogv',
    'video/webm': '.webm'
  };

  return extensionMap[normalizedMimeType] ?? '';
}

function getMimeTypeFromAssetPath(assetPath: string): string {
  const extension = extname(assetPath).toLowerCase();
  const mimeTypeMap: Record<string, string> = {
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.ogg': 'audio/ogg',
    '.ogv': 'video/ogg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.webm': 'video/webm',
    '.webp': 'image/webp'
  };

  return mimeTypeMap[extension] ?? 'application/octet-stream';
}

function resolveExistingWorkspacePath(filePath: string): string {
  const resolvedPath = realpathSync(filePath);

  if (!isInsideWorkspace(resolvedPath)) {
    throw new Error('Path is outside the current workspace.');
  }

  return resolvedPath;
}

function resolveExistingWorkspaceDirectory(filePath: string): string {
  const resolvedPath = resolveExistingWorkspacePath(filePath);
  const stats = statSync(resolvedPath);

  if (!stats.isDirectory()) {
    throw new Error('Target path is not a directory.');
  }

  return resolvedPath;
}

function normalizeEntryName(name: string, entryType: 'file' | 'folder'): string {
  const trimmedName = name.trim();

  if (!trimmedName || trimmedName.includes('/') || trimmedName.includes('\\')) {
    throw new Error('Invalid file or folder name.');
  }

  if (entryType === 'file' && extname(trimmedName) === '') {
    return `${trimmedName}.md`;
  }

  return trimmedName;
}

function getAvailablePath(targetPath: string): string {
  if (!existsSync(targetPath)) {
    return targetPath;
  }

  const extension = extname(targetPath);
  const nameWithoutExtension = extension ? basename(targetPath, extension) : basename(targetPath);
  const parentPath = dirname(targetPath);

  for (let index = 1; index < 1000; index += 1) {
    const candidatePath = join(parentPath, `${nameWithoutExtension} ${index}${extension}`);

    if (!existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error('Unable to create a unique file path.');
}

function normalizeDocumentProvenanceKey(documentKey: string): string {
  const key = documentKey.trim();

  if (!key || key.length > 1024) {
    throw new Error('Invalid provenance document key.');
  }

  return key;
}

function normalizeDocumentProvenanceSnapshot(snapshot: DocumentProvenanceSnapshot): DocumentProvenanceSnapshot {
  const documentKey = normalizeDocumentProvenanceKey(snapshot.documentKey);
  const documentPath = snapshot.documentPath.trim();
  const workspaceFolderId = snapshot.workspaceFolderId.trim();
  const markdownHash = snapshot.markdownHash.trim();
  const snapshotJson = snapshot.snapshotJson.trim();

  if (!documentPath || !workspaceFolderId || !markdownHash || !snapshotJson) {
    throw new Error('Incomplete provenance snapshot.');
  }

  if (snapshot.workspaceType !== 'database' && snapshot.workspaceType !== 'filesystem') {
    throw new Error('Invalid provenance workspace type.');
  }

  JSON.parse(snapshotJson);

  return {
    documentKey,
    documentPath,
    markdownHash,
    snapshotJson,
    workspaceFolderId,
    workspaceType: snapshot.workspaceType
  };
}

function getDocumentProvenanceWorkspaceTypeValue(workspaceType: DocumentProvenanceWorkspaceType): number {
  return workspaceType === 'database' ? 2 : 1;
}

function getDocumentProvenanceWorkspaceTypeLabel(value: number): DocumentProvenanceWorkspaceType {
  return value === 2 ? 'database' : 'filesystem';
}

function mapDocumentProvenanceRow(row: DocumentProvenanceSnapshotRow): DocumentProvenanceSnapshot {
  return {
    documentKey: row.document_key,
    documentPath: row.document_path,
    markdownHash: row.markdown_hash,
    snapshotJson: row.snapshot_json,
    workspaceFolderId: row.workspace_folder_id,
    workspaceType: getDocumentProvenanceWorkspaceTypeLabel(row.workspace_type)
  };
}

function getFilesystemDocumentKey(filePath: string): string | null {
  const folder = findWorkspaceFolderForPath(filePath);

  if (!folder) {
    return null;
  }

  return `filesystem:${folder.id}:${relative(folder.path, filePath).split(sep).join('/')}`;
}

function getFilesystemProvenanceRows(filePath: string, includeChildren: boolean): DocumentProvenanceSnapshotRow[] {
  if (!includeChildren) {
    const row = getDatabase()
      .prepare(
        `
        SELECT document_key, workspace_type, document_path, workspace_folder_id, markdown_hash, snapshot_json
        FROM document_provenance_snapshots
        WHERE workspace_type = 1 AND document_path = ? AND status = 0
        `
      )
      .get(filePath) as DocumentProvenanceSnapshotRow | undefined;

    return row ? [row] : [];
  }

  return getDatabase()
    .prepare(
      `
      SELECT document_key, workspace_type, document_path, workspace_folder_id, markdown_hash, snapshot_json
      FROM document_provenance_snapshots
      WHERE workspace_type = 1
        AND status = 0
        AND (document_path = ? OR document_path LIKE ?)
      `
    )
    .all(filePath, `${filePath}${sep}%`) as DocumentProvenanceSnapshotRow[];
}

function moveFilesystemDocumentProvenance(sourcePath: string, targetPath: string): void {
  const targetStats = statSync(targetPath);
  const rows = getFilesystemProvenanceRows(sourcePath, targetStats.isDirectory());

  if (!rows.length) {
    return;
  }

  const update = getDatabase().prepare(
    `
    UPDATE document_provenance_snapshots
    SET document_key = ?, document_path = ?, workspace_folder_id = ?, updated_at = ?
    WHERE document_key = ? AND status = 0
    `
  );
  const deleteTarget = getDatabase().prepare(
    'UPDATE document_provenance_snapshots SET status = 1, updated_at = ? WHERE document_key = ? AND status = 0'
  );
  const now = Date.now();

  getDatabase().transaction(() => {
    for (const row of rows) {
      const nextPath =
        row.document_path === sourcePath
          ? targetPath
          : join(targetPath, relative(sourcePath, row.document_path));
      const nextKey = getFilesystemDocumentKey(nextPath);
      const folder = findWorkspaceFolderForPath(nextPath);

      if (!nextKey || !folder) {
        continue;
      }

      deleteTarget.run(now, nextKey);
      update.run(nextKey, nextPath, folder.id, now, row.document_key);
    }
  })();
}

function copyFilesystemDocumentProvenance(sourcePath: string, targetPath: string): void {
  const targetStats = statSync(targetPath);
  const rows = getFilesystemProvenanceRows(sourcePath, targetStats.isDirectory());

  if (!rows.length) {
    return;
  }

  const upsert = getDatabase().prepare(
    `
    INSERT INTO document_provenance_snapshots
      (id, document_key, workspace_type, document_path, workspace_folder_id, markdown_hash, snapshot_json, status, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(document_key) DO UPDATE SET
      workspace_type = excluded.workspace_type,
      document_path = excluded.document_path,
      workspace_folder_id = excluded.workspace_folder_id,
      markdown_hash = excluded.markdown_hash,
      snapshot_json = excluded.snapshot_json,
      status = 0,
      updated_at = excluded.updated_at
    `
  );
  const now = Date.now();

  getDatabase().transaction(() => {
    for (const row of rows) {
      const nextPath =
        row.document_path === sourcePath
          ? targetPath
          : join(targetPath, relative(sourcePath, row.document_path));
      const nextKey = getFilesystemDocumentKey(nextPath);
      const folder = findWorkspaceFolderForPath(nextPath);

      if (!nextKey || !folder) {
        continue;
      }

      upsert.run(randomUUID(), nextKey, nextPath, folder.id, row.markdown_hash, row.snapshot_json, now, now);
    }
  })();
}

export function deactivateFilesystemDocumentProvenance(filePath: string): void {
  const rows = getFilesystemProvenanceRows(filePath, statSync(filePath).isDirectory());

  if (!rows.length) {
    return;
  }

  const update = getDatabase().prepare(
    'UPDATE document_provenance_snapshots SET status = 1, updated_at = ? WHERE document_key = ? AND status = 0'
  );
  const now = Date.now();

  getDatabase().transaction(() => {
    rows.forEach((row) => update.run(now, row.document_key));
  })();
}

function deactivateWorkspaceFolderProvenance(workspaceFolderId: string): void {
  getDatabase()
    .prepare(
      `
      UPDATE document_provenance_snapshots
      SET status = 1, updated_at = ?
      WHERE workspace_folder_id = ? AND status = 0
      `
    )
    .run(Date.now(), workspaceFolderId);
}

function getDatabaseDocumentKey(entryId: string): string {
  return `database:${entryId}`;
}

function copyDatabaseDocumentProvenance(sourceEntryId: string, targetEntryId: string, workspaceId: string): void {
  const row = getDatabase()
    .prepare(
      `
      SELECT document_key, workspace_type, document_path, workspace_folder_id, markdown_hash, snapshot_json
      FROM document_provenance_snapshots
      WHERE document_key = ? AND status = 0
      `
    )
    .get(getDatabaseDocumentKey(sourceEntryId)) as DocumentProvenanceSnapshotRow | undefined;

  if (!row) {
    return;
  }

  saveDocumentProvenanceSnapshot({
    documentKey: getDatabaseDocumentKey(targetEntryId),
    documentPath: getDatabaseEntryPath(targetEntryId),
    markdownHash: row.markdown_hash,
    snapshotJson: row.snapshot_json,
    workspaceFolderId: workspaceId,
    workspaceType: 'database'
  });
}

function updateDatabaseProvenanceWorkspace(entryId: string, workspaceId: string): void {
  const entry = getDatabase()
    .prepare(
      `
      SELECT id, workspace_id, parent_id, entry_type, name, content, created_at
      FROM virtual_workspace_entries
      WHERE id = ? AND status = 0
      `
    )
    .get(entryId) as VirtualWorkspaceEntryRow | undefined;

  if (!entry) {
    return;
  }

  if (entry.entry_type === 1) {
    getDatabase()
      .prepare(
        `
        UPDATE document_provenance_snapshots
        SET workspace_folder_id = ?, updated_at = ?
        WHERE document_key = ? AND status = 0
        `
      )
      .run(workspaceId, Date.now(), getDatabaseDocumentKey(entry.id));
    return;
  }

  const children = getDatabase()
    .prepare(
      `
      SELECT id, workspace_id, parent_id, entry_type, name, content, created_at
      FROM virtual_workspace_entries
      WHERE parent_id = ? AND status = 0
      `
    )
    .all(entryId) as VirtualWorkspaceEntryRow[];

  children.forEach((child) => updateDatabaseProvenanceWorkspace(child.id, workspaceId));
}

function deactivateDatabaseProvenance(entryId: string): void {
  const entry = getDatabase()
    .prepare(
      `
      SELECT id, workspace_id, parent_id, entry_type, name, content, created_at
      FROM virtual_workspace_entries
      WHERE id = ? AND status = 0
      `
    )
    .get(entryId) as VirtualWorkspaceEntryRow | undefined;

  if (!entry) {
    return;
  }

  if (entry.entry_type === 1) {
    deleteDocumentProvenanceSnapshot(getDatabaseDocumentKey(entry.id));
    return;
  }

  const children = getDatabase()
    .prepare(
      `
      SELECT id, workspace_id, parent_id, entry_type, name, content, created_at
      FROM virtual_workspace_entries
      WHERE parent_id = ? AND status = 0
      `
    )
    .all(entryId) as VirtualWorkspaceEntryRow[];

  children.forEach((child) => deactivateDatabaseProvenance(child.id));
}

function getCopyPath(sourcePath: string, targetDirectory: string): string {
  const extension = extname(sourcePath);
  const nameWithoutExtension = extension ? basename(sourcePath, extension) : basename(sourcePath);

  return getAvailablePath(join(targetDirectory, `${nameWithoutExtension} copy${extension}`));
}

function isSameOrChildPath(parentPath: string, childPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith(sep));
}
