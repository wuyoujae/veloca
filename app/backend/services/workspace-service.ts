import { randomUUID } from 'node:crypto';
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
import { basename, dirname, extname, join, relative, sep } from 'node:path';
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

interface WorkspaceFolderRow {
  id: string;
  name: string;
  folder_path: string;
  created_at: number;
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

export function removeWorkspaceFolder(workspaceFolderId: string): WorkspaceSnapshot {
  getDatabase()
    .prepare(
      `
      UPDATE workspace_folders
      SET status = 1, updated_at = ?
      WHERE id = ?
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

  return {
    folders,
    tree,
    totalMarkdownFiles
  };
}

export function readMarkdownFile(filePath: string): MarkdownFileContent {
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
    relativePath: relative(folder.path, resolvedPath),
    workspaceFolderId: folder.id
  };
}

export function createWorkspaceEntry(
  parentPath: string,
  entryType: 'file' | 'folder',
  name: string
): FileOperationResult {
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

  return {
    snapshot: getWorkspaceSnapshot(),
    path: targetPath
  };
}

export function duplicateWorkspaceEntry(filePath: string): FileOperationResult {
  const sourcePath = resolveExistingWorkspacePath(filePath);
  const targetPath = getCopyPath(sourcePath, dirname(sourcePath));

  cpSync(sourcePath, targetPath, {
    recursive: true,
    errorOnExist: true
  });

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
  const resolvedSourcePath = resolveExistingWorkspacePath(sourcePath);
  const targetDirectory = resolveExistingWorkspaceDirectory(targetFolderPath);
  const stats = statSync(resolvedSourcePath);
  const targetPath = getAvailablePath(join(targetDirectory, basename(resolvedSourcePath)));

  if (stats.isDirectory() && isSameOrChildPath(resolvedSourcePath, targetDirectory)) {
    throw new Error('A folder cannot be pasted into itself.');
  }

  if (mode === 'cut') {
    renameSync(resolvedSourcePath, targetPath);
  } else {
    cpSync(resolvedSourcePath, targetPath, {
      recursive: true,
      errorOnExist: true
    });
  }

  return {
    snapshot: getWorkspaceSnapshot(),
    path: targetPath
  };
}

export function validateWorkspacePath(filePath: string): string {
  return resolveExistingWorkspacePath(filePath);
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

function getCopyPath(sourcePath: string, targetDirectory: string): string {
  const extension = extname(sourcePath);
  const nameWithoutExtension = extension ? basename(sourcePath, extension) : basename(sourcePath);

  return getAvailablePath(join(targetDirectory, `${nameWithoutExtension} copy${extension}`));
}

function isSameOrChildPath(parentPath: string, childPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith(sep));
}
