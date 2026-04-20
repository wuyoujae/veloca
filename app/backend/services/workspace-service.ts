import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
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

      if (children.length > 0) {
        nodes.push({
          id: `folder:${entryPath}`,
          name: entry.name,
          type: 'folder',
          path: entryPath,
          relativePath: relative(rootPath, entryPath),
          workspaceFolderId,
          children
        });
      }

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
