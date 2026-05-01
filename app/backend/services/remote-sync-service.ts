import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { safeStorage } from 'electron';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { getDatabase } from '../database/connection';

export interface RemoteSyncConfig {
  autoSyncEnabled: boolean;
  conflictPolicy: 1;
  pullOnStartup: boolean;
  pushOnSave: boolean;
  syncAssets: boolean;
  syncDatabaseWorkspaces: boolean;
  syncDeletes: boolean;
  syncLocalOpenedMarkdown: boolean;
  syncProvenance: boolean;
}

export interface RemoteSyncStatus {
  conflictCount: number;
  failedCount: number;
  lastError: string;
  lastRunAt: number | null;
  pendingPullCount: number;
  pendingPushCount: number;
  running: boolean;
  syncedCount: number;
}

interface RemoteDatabaseConfigRow {
  database_host: string | null;
  encrypted_db_password: string | null;
  encrypted_secret_key: string | null;
  project_url: string | null;
  project_ref: string | null;
  region: string;
  status: number;
}

interface RemoteSyncConfigRow {
  auto_sync_enabled: number;
  conflict_policy: number;
  pull_on_startup: number;
  push_on_save: number;
  sync_assets: number;
  sync_database_workspaces: number;
  sync_deletes: number;
  sync_local_opened_markdown: number;
  sync_provenance: number;
}

interface RemoteSyncItemRow {
  content_hash: string | null;
  id: string;
  item_type: number;
  local_path: string | null;
  relative_path: string | null;
  remote_id: string | null;
  source_key: string;
  source_type: number;
  workspace_id: string | null;
}

interface PostgresConnectionTarget {
  host: string;
  label: string;
  port: number;
  user: string;
}

interface PostgresConnectionFailure {
  error: string;
  target: PostgresConnectionTarget;
}

interface WorkspaceFolderRow {
  folder_path: string;
  id: string;
  name: string;
}

interface VirtualWorkspaceRow {
  created_at: number;
  id: string;
  name: string;
  updated_at: number;
}

interface VirtualWorkspaceEntryRow {
  content: string;
  created_at: number;
  entry_type: number;
  id: string;
  name: string;
  parent_id: string | null;
  updated_at: number;
  workspace_id: string;
}

interface VirtualWorkspaceAssetRow {
  asset_path: string;
  binary_content: Buffer;
  byte_size: number;
  created_at: number;
  document_entry_id: string;
  file_name: string;
  id: string;
  mime_type: string;
  updated_at: number;
  workspace_id: string;
}

interface DocumentProvenanceRow {
  document_key: string;
  document_path: string;
  id?: string;
  markdown_hash: string;
  snapshot_json: string;
  updated_at: number;
  workspace_folder_id: string;
  workspace_type: number;
}

interface RemoteDocumentRow {
  content: string | null;
  content_hash: string | null;
  id: string;
  name: string;
}

const remoteProviderSupabase = 1;
const remoteStatusInitialized = 4;
const remoteAssetBucketName = 'veloca-assets';
const syncStateSynced = 0;
const syncStatePendingPush = 1;
const syncStatePendingPull = 2;
const syncStateConflict = 3;
const syncStateFailed = 4;
const sourceTypeFilesystem = 1;
const sourceTypeDatabase = 2;
const itemTypeWorkspace = 1;
const itemTypeDocument = 2;
const itemTypeAsset = 3;
const itemTypeProvenance = 4;
const remoteSyncSchemaSql = `
ALTER TABLE veloca_remote_workspaces
  ADD COLUMN IF NOT EXISTS source_type INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS source_key TEXT,
  ADD COLUMN IF NOT EXISTS relative_path TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at BIGINT,
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE veloca_remote_documents
  ADD COLUMN IF NOT EXISTS source_type INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS source_key TEXT,
  ADD COLUMN IF NOT EXISTS relative_path TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at BIGINT,
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE veloca_remote_assets
  ADD COLUMN IF NOT EXISTS source_type INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS source_key TEXT,
  ADD COLUMN IF NOT EXISTS relative_path TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at BIGINT,
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE veloca_remote_document_provenance
  ADD COLUMN IF NOT EXISTS source_type INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS source_key TEXT,
  ADD COLUMN IF NOT EXISTS relative_path TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at BIGINT,
  ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 0;
`;
const defaultRemoteSyncConfig: RemoteSyncConfig = {
  autoSyncEnabled: true,
  conflictPolicy: 1,
  pullOnStartup: true,
  pushOnSave: true,
  syncAssets: true,
  syncDatabaseWorkspaces: true,
  syncDeletes: true,
  syncLocalOpenedMarkdown: true,
  syncProvenance: true
};

let remoteSyncRunning = false;
let lastRunAt: number | null = null;
let lastRunError = '';

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function intToBool(value: number): boolean {
  return value === 1;
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getUserFacingSyncError(error: unknown): string {
  const message = getErrorMessage(error);

  if (
    /fetch failed|net::ERR_|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|connection terminated/i.test(
      message
    )
  ) {
    return 'Remote sync could not reach Supabase. Veloca will keep working locally; please check the network and retry sync later.';
  }

  return message;
}

function isPostgresAuthenticationError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes('password authentication failed') ||
    message.includes('invalid_password') ||
    message.includes('28p01')
  );
}

function formatPostgresTarget(target: PostgresConnectionTarget): string {
  return `${target.label} ${target.host}:${target.port} as ${target.user}`;
}

function decryptCredential(encryptedValue: string | null): string | null {
  if (!encryptedValue) {
    return null;
  }

  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }

    return safeStorage.decryptString(Buffer.from(encryptedValue, 'base64'));
  } catch {
    return null;
  }
}

function mapRemoteSyncConfig(row: RemoteSyncConfigRow | undefined): RemoteSyncConfig {
  if (!row) {
    return defaultRemoteSyncConfig;
  }

  return {
    autoSyncEnabled: intToBool(row.auto_sync_enabled),
    conflictPolicy: 1,
    pullOnStartup: intToBool(row.pull_on_startup),
    pushOnSave: intToBool(row.push_on_save),
    syncAssets: intToBool(row.sync_assets),
    syncDatabaseWorkspaces: true,
    syncDeletes: intToBool(row.sync_deletes),
    syncLocalOpenedMarkdown: intToBool(row.sync_local_opened_markdown),
    syncProvenance: intToBool(row.sync_provenance)
  };
}

function getRemoteConfigRow(): RemoteDatabaseConfigRow | null {
  const row = getDatabase()
    .prepare(
      `
      SELECT database_host, encrypted_db_password, encrypted_secret_key, project_ref, project_url, region, status
      FROM remote_database_configs
      WHERE provider = ?
      ORDER BY updated_at DESC
      LIMIT 1
      `
    )
    .get(remoteProviderSupabase) as RemoteDatabaseConfigRow | undefined;

  return row ?? null;
}

function getRemoteSupabaseClient(): SupabaseClient | null {
  const row = getRemoteConfigRow();
  const secretKey = decryptCredential(row?.encrypted_secret_key ?? null);

  if (!row?.project_url || row.status !== remoteStatusInitialized || !secretKey) {
    return null;
  }

  return createClient(row.project_url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}

function getRemoteSyncSchemaConnectionTargets(row: RemoteDatabaseConfigRow): PostgresConnectionTarget[] {
  const targets: PostgresConnectionTarget[] = [];
  const projectRef = row.project_ref ?? '';
  const directHost = `db.${projectRef}.supabase.co`;
  const poolerHosts = [
    `aws-0-${row.region}.pooler.supabase.com`,
    `aws-1-${row.region}.pooler.supabase.com`
  ];
  const addTarget = (target: PostgresConnectionTarget) => {
    const key = `${target.host}:${target.port}:${target.user}`;

    if (!targets.some((existingTarget) => `${existingTarget.host}:${existingTarget.port}:${existingTarget.user}` === key)) {
      targets.push(target);
    }
  };

  if (row.database_host) {
    if (row.database_host.includes('pooler.supabase.com')) {
      addTarget({
        host: row.database_host,
        label: 'stored-pooler-session',
        port: 5432,
        user: `postgres.${projectRef}`
      });
      addTarget({
        host: row.database_host,
        label: 'stored-pooler-transaction',
        port: 6543,
        user: `postgres.${projectRef}`
      });
    } else {
      addTarget({
        host: row.database_host,
        label: 'stored-direct',
        port: 5432,
        user: 'postgres'
      });
    }
  }

  addTarget({
    host: directHost,
    label: 'direct',
    port: 5432,
    user: 'postgres'
  });

  for (const host of poolerHosts) {
    addTarget({
      host,
      label: 'session-pooler',
      port: 5432,
      user: `postgres.${projectRef}`
    });
  }

  for (const host of poolerHosts) {
    addTarget({
      host,
      label: 'transaction-pooler',
      port: 6543,
      user: `postgres.${projectRef}`
    });
  }

  return targets;
}

function upsertRemoteSyncItem(input: {
  contentHash?: string;
  itemType: number;
  localPath?: string;
  relativePath?: string;
  remoteId?: string;
  sourceKey: string;
  sourceType: number;
  state: number;
  workspaceId?: string;
}): void {
  const now = Date.now();

  getDatabase()
    .prepare(
      `
      INSERT INTO remote_sync_items
        (id, source_type, item_type, source_key, workspace_id, local_path, relative_path, remote_id, content_hash, sync_state, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        source_type = excluded.source_type,
        item_type = excluded.item_type,
        workspace_id = COALESCE(excluded.workspace_id, remote_sync_items.workspace_id),
        local_path = COALESCE(excluded.local_path, remote_sync_items.local_path),
        relative_path = COALESCE(excluded.relative_path, remote_sync_items.relative_path),
        remote_id = COALESCE(excluded.remote_id, remote_sync_items.remote_id),
        content_hash = COALESCE(excluded.content_hash, remote_sync_items.content_hash),
        sync_state = excluded.sync_state,
        last_error = NULL,
        updated_at = excluded.updated_at
      `
    )
    .run(
      randomUUID(),
      input.sourceType,
      input.itemType,
      input.sourceKey,
      input.workspaceId ?? null,
      input.localPath ?? null,
      input.relativePath ?? null,
      input.remoteId ?? null,
      input.contentHash ?? null,
      input.state,
      now,
      now
    );
}

function markSyncItemResult(sourceKey: string, state: number, contentHash?: string, error?: string): void {
  getDatabase()
    .prepare(
      `
      UPDATE remote_sync_items
      SET sync_state = ?, content_hash = COALESCE(?, content_hash), last_error = ?, last_synced_at = ?, updated_at = ?
      WHERE source_key = ?
      `
    )
    .run(state, contentHash ?? null, error ?? null, state === syncStateSynced ? Date.now() : null, Date.now(), sourceKey);
}

function updateRemoteSyncItemRemoteId(sourceKey: string, remoteId: string): void {
  getDatabase()
    .prepare('UPDATE remote_sync_items SET remote_id = ?, updated_at = ? WHERE source_key = ?')
    .run(remoteId, Date.now(), sourceKey);
}

function getFilesystemWorkspaceInfo(filePath: string): { relativePath: string; workspaceId: string } | null {
  const rows = getDatabase()
    .prepare('SELECT id, folder_path, name FROM workspace_folders WHERE status = 0')
    .all() as WorkspaceFolderRow[];
  const normalizedPath = resolve(filePath);
  const folder = rows
    .map((row) => ({ row, root: resolve(row.folder_path) }))
    .filter(({ root }) => normalizedPath === root || normalizedPath.startsWith(`${root}${sep}`))
    .sort((left, right) => right.root.length - left.root.length)[0];

  if (!folder) {
    return null;
  }

  return {
    relativePath: relative(folder.root, normalizedPath).split(sep).join('/'),
    workspaceId: folder.row.id
  };
}

function isMarkdownPath(filePath: string): boolean {
  return extname(filePath).toLowerCase() === '.md';
}

function getConflictPath(filePath: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const extension = extname(filePath);
  const baseName = basename(filePath, extension);

  return join(dirname(filePath), `${baseName}.remote-conflict-${stamp}${extension || '.md'}`);
}

function extractLocalAssetPaths(documentPath: string, markdown: string): string[] {
  const matches = [...markdown.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)];
  const paths = new Set<string>();

  for (const match of matches) {
    const rawPath = match[1]?.trim();

    if (!rawPath || /^(https?:|data:|veloca-asset:|#)/i.test(rawPath)) {
      continue;
    }

    const cleanPath = rawPath.split(/[?#]/)[0];
    const absolutePath = resolve(dirname(documentPath), cleanPath);

    if (existsSync(absolutePath)) {
      paths.add(absolutePath);
    }
  }

  return [...paths];
}

async function ensureRemoteAssetBucket(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.storage.createBucket(remoteAssetBucketName, {
    public: false
  });

  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error(error.message);
  }
}

async function ensureRemoteSyncSchema(): Promise<void> {
  const row = getRemoteConfigRow();
  const databasePassword = decryptCredential(row?.encrypted_db_password ?? null);

  if (!row?.project_ref || !databasePassword) {
    return;
  }

  const targets = getRemoteSyncSchemaConnectionTargets(row);
  let lastError: unknown = null;
  const authenticationFailures: PostgresConnectionFailure[] = [];

  for (const target of targets) {
    const client = new Client({
      connectionTimeoutMillis: 10000,
      database: 'postgres',
      host: target.host,
      password: databasePassword,
      port: target.port,
      query_timeout: 30000,
      ssl: {
        rejectUnauthorized: false
      },
      user: target.user
    });

    try {
      await client.connect();
      await client.query(remoteSyncSchemaSql);
      return;
    } catch (error) {
      lastError = error;
      if (isPostgresAuthenticationError(error)) {
        authenticationFailures.push({
          error: getErrorMessage(error),
          target
        });
        console.warn('[remote-sync] database authentication failed; trying next connection target', {
          connectionTarget: target.label,
          error: getErrorMessage(error),
          host: target.host,
          user: target.user
        });
        continue;
      }
    } finally {
      await client.end().catch(() => {});
    }
  }

  if (authenticationFailures.length === targets.length) {
    const targetsText = authenticationFailures.map((failure) => formatPostgresTarget(failure.target)).join('; ');
    throw new Error(`Supabase remote sync schema migration failed: database password authentication failed for tried connection targets (${targetsText}).`);
  }

  throw new Error(`Supabase remote sync schema migration failed: ${getErrorMessage(lastError)}`);
}

async function upsertRows(supabase: SupabaseClient, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) {
    return;
  }

  const { error } = await supabase.from(table).upsert(rows);

  if (error) {
    throw new Error(error.message);
  }
}

async function uploadAsset(
  supabase: SupabaseClient,
  storagePath: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const { error } = await supabase.storage.from(remoteAssetBucketName).upload(storagePath, body, {
    contentType,
    upsert: true
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function pushFilesystemDocument(supabase: SupabaseClient, item: RemoteSyncItemRow, config: RemoteSyncConfig): Promise<void> {
  if (!item.local_path || !item.workspace_id) {
    return;
  }

  if (!existsSync(item.local_path)) {
    if (config.syncDeletes) {
      await upsertRows(supabase, 'veloca_remote_documents', [
        {
          deleted_at: Date.now(),
          id: item.remote_id ?? item.id,
          source_key: item.source_key,
          source_type: sourceTypeFilesystem,
          status: 1,
          updated_at: Date.now()
        }
      ]);
    }

    markSyncItemResult(item.source_key, syncStateSynced, item.content_hash ?? undefined);
    return;
  }

  const content = readFileSync(item.local_path, 'utf8');
  const contentHash = sha256(content);
  const remoteId = item.remote_id ?? item.id;
  updateRemoteSyncItemRemoteId(item.source_key, remoteId);

  await upsertRows(supabase, 'veloca_remote_documents', [
    {
      content,
      content_hash: contentHash,
      created_at: Date.now(),
      deleted_at: null,
      entry_type: 1,
      id: remoteId,
      name: basename(item.local_path),
      parent_id: null,
      relative_path: item.relative_path,
      source_key: item.source_key,
      source_type: sourceTypeFilesystem,
      status: 0,
      sync_version: Date.now(),
      updated_at: Date.now(),
      workspace_id: item.workspace_id
    }
  ]);

  if (config.syncAssets) {
    for (const assetPath of extractLocalAssetPaths(item.local_path, content)) {
      const assetContent = readFileSync(assetPath);
      const storagePath = `filesystem/${item.workspace_id}/${sha256(assetPath)}-${basename(assetPath)}`;

      await uploadAsset(supabase, storagePath, assetContent, 'application/octet-stream');
      await upsertRows(supabase, 'veloca_remote_assets', [
        {
          asset_path: assetPath,
          byte_size: assetContent.byteLength,
          content_hash: sha256(assetContent),
          created_at: Date.now(),
          deleted_at: null,
          document_id: remoteId,
          file_name: basename(assetPath),
          id: sha256(`${item.source_key}:${assetPath}`),
          mime_type: 'application/octet-stream',
          relative_path: relative(dirname(item.local_path), assetPath).split(sep).join('/'),
          source_key: `filesystem-asset:${assetPath}`,
          source_type: sourceTypeFilesystem,
          status: 0,
          storage_path: storagePath,
          sync_version: Date.now(),
          updated_at: Date.now(),
          workspace_id: item.workspace_id
        }
      ]);
    }
  }

  markSyncItemResult(item.source_key, syncStateSynced, contentHash);
}

async function pullFilesystemDocument(supabase: SupabaseClient, item: RemoteSyncItemRow): Promise<void> {
  if (!item.local_path || !item.remote_id || !existsSync(item.local_path)) {
    return;
  }

  const { data, error } = await supabase
    .from('veloca_remote_documents')
    .select('id,name,content,content_hash')
    .eq('id', item.remote_id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const remoteDocument = data as RemoteDocumentRow | null;

  if (!remoteDocument?.content || !remoteDocument.content_hash || remoteDocument.content_hash === item.content_hash) {
    return;
  }

  const localContent = readFileSync(item.local_path, 'utf8');
  const localHash = sha256(localContent);

  if (localHash !== item.content_hash) {
    writeFileSync(getConflictPath(item.local_path), remoteDocument.content, 'utf8');
    markSyncItemResult(item.source_key, syncStateConflict, item.content_hash ?? undefined, 'Remote conflict copy created.');
    return;
  }

  writeFileSync(item.local_path, remoteDocument.content, 'utf8');
  markSyncItemResult(item.source_key, syncStateSynced, remoteDocument.content_hash);
}

async function pushDatabaseWorkspaces(supabase: SupabaseClient, config: RemoteSyncConfig): Promise<void> {
  if (!config.syncDatabaseWorkspaces) {
    return;
  }

  const workspaces = getDatabase()
    .prepare('SELECT id, name, created_at, updated_at FROM virtual_workspaces WHERE status = 0')
    .all() as VirtualWorkspaceRow[];
  const entries = getDatabase()
    .prepare('SELECT id, workspace_id, parent_id, entry_type, name, content, created_at, updated_at FROM virtual_workspace_entries WHERE status = 0')
    .all() as VirtualWorkspaceEntryRow[];

  await upsertRows(
    supabase,
    'veloca_remote_workspaces',
    workspaces.map((workspace) => ({
      content_hash: sha256(`${workspace.id}:${workspace.name}:${workspace.updated_at}`),
      created_at: workspace.created_at,
      deleted_at: null,
      id: workspace.id,
      name: workspace.name,
      relative_path: '',
      source_key: `database-workspace:${workspace.id}`,
      source_type: sourceTypeDatabase,
      status: 0,
      sync_version: workspace.updated_at,
      updated_at: workspace.updated_at
    }))
  );

  await upsertRows(
    supabase,
    'veloca_remote_documents',
    entries.map((entry) => ({
      content: entry.content,
      content_hash: sha256(entry.content),
      created_at: entry.created_at,
      deleted_at: null,
      entry_type: entry.entry_type,
      id: entry.id,
      name: entry.name,
      parent_id: entry.parent_id,
      relative_path: entry.id,
      source_key: `database-entry:${entry.id}`,
      source_type: sourceTypeDatabase,
      status: 0,
      sync_version: entry.updated_at,
      updated_at: entry.updated_at,
      workspace_id: entry.workspace_id
    }))
  );

  if (config.syncAssets) {
    const assets = getDatabase()
      .prepare(
        'SELECT id, workspace_id, document_entry_id, asset_path, file_name, mime_type, byte_size, binary_content, created_at, updated_at FROM virtual_workspace_assets WHERE status = 0'
      )
      .all() as VirtualWorkspaceAssetRow[];

    for (const asset of assets) {
      const storagePath = `database/${asset.workspace_id}/${asset.id}/${asset.file_name}`;
      await uploadAsset(supabase, storagePath, asset.binary_content, asset.mime_type);
      await upsertRows(supabase, 'veloca_remote_assets', [
        {
          asset_path: asset.asset_path,
          byte_size: asset.byte_size,
          content_hash: sha256(asset.binary_content),
          created_at: asset.created_at,
          deleted_at: null,
          document_id: asset.document_entry_id,
          file_name: asset.file_name,
          id: asset.id,
          mime_type: asset.mime_type,
          relative_path: asset.asset_path,
          source_key: `database-asset:${asset.id}`,
          source_type: sourceTypeDatabase,
          status: 0,
          storage_path: storagePath,
          sync_version: asset.updated_at,
          updated_at: asset.updated_at,
          workspace_id: asset.workspace_id
        }
      ]);
    }
  }

  if (config.syncProvenance) {
    const provenanceRows = getDatabase()
      .prepare(
        'SELECT document_key, workspace_type, document_path, workspace_folder_id, markdown_hash, snapshot_json, updated_at FROM document_provenance_snapshots WHERE status = 0'
      )
      .all() as DocumentProvenanceRow[];

    await upsertRows(
      supabase,
      'veloca_remote_document_provenance',
      provenanceRows.map((row) => ({
        content_hash: row.markdown_hash,
        created_at: row.updated_at,
        deleted_at: null,
        document_id: row.document_key,
        id: sha256(row.document_key),
        markdown_hash: row.markdown_hash,
        relative_path: row.document_path,
        snapshot_json: row.snapshot_json,
        source_key: `provenance:${row.document_key}`,
        source_type: row.workspace_type,
        status: 0,
        sync_version: row.updated_at,
        updated_at: row.updated_at
      }))
    );
  }
}

export function getRemoteSyncConfig(): RemoteSyncConfig {
  const row = getDatabase()
    .prepare(
      `
      SELECT auto_sync_enabled, pull_on_startup, push_on_save, sync_local_opened_markdown,
        sync_database_workspaces, sync_assets, sync_provenance, sync_deletes, conflict_policy
      FROM remote_sync_configs
      WHERE provider = ?
      `
    )
    .get(remoteProviderSupabase) as RemoteSyncConfigRow | undefined;

  return mapRemoteSyncConfig(row);
}

export function saveRemoteSyncConfig(input: RemoteSyncConfig): RemoteSyncConfig {
  const now = Date.now();

  getDatabase()
    .prepare(
      `
      INSERT INTO remote_sync_configs
        (id, provider, auto_sync_enabled, pull_on_startup, push_on_save, sync_local_opened_markdown,
          sync_database_workspaces, sync_assets, sync_provenance, sync_deletes, conflict_policy, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        auto_sync_enabled = excluded.auto_sync_enabled,
        pull_on_startup = excluded.pull_on_startup,
        push_on_save = excluded.push_on_save,
        sync_local_opened_markdown = excluded.sync_local_opened_markdown,
        sync_database_workspaces = 1,
        sync_assets = excluded.sync_assets,
        sync_provenance = excluded.sync_provenance,
        sync_deletes = excluded.sync_deletes,
        conflict_policy = 1,
        updated_at = excluded.updated_at
      `
    )
    .run(
      randomUUID(),
      remoteProviderSupabase,
      boolToInt(input.autoSyncEnabled),
      boolToInt(input.pullOnStartup),
      boolToInt(input.pushOnSave),
      boolToInt(input.syncLocalOpenedMarkdown),
      boolToInt(input.syncAssets),
      boolToInt(input.syncProvenance),
      boolToInt(input.syncDeletes),
      now,
      now
    );

  return getRemoteSyncConfig();
}

export function getRemoteSyncStatus(): RemoteSyncStatus {
  const counts = getDatabase()
    .prepare('SELECT sync_state, COUNT(*) AS count FROM remote_sync_items GROUP BY sync_state')
    .all() as Array<{ count: number; sync_state: number }>;
  const getCount = (state: number) => counts.find((row) => row.sync_state === state)?.count ?? 0;

  return {
    conflictCount: getCount(syncStateConflict),
    failedCount: getCount(syncStateFailed),
    lastError: lastRunError,
    lastRunAt,
    pendingPullCount: getCount(syncStatePendingPull),
    pendingPushCount: getCount(syncStatePendingPush),
    running: remoteSyncRunning,
    syncedCount: getCount(syncStateSynced)
  };
}

export function markRemoteMarkdownOpened(file: { path: string; relativePath: string; workspaceFolderId: string }): void {
  const config = getRemoteSyncConfig();

  if (!config.syncLocalOpenedMarkdown || !isMarkdownPath(file.path)) {
    return;
  }

  upsertRemoteSyncItem({
    itemType: itemTypeDocument,
    localPath: file.path,
    relativePath: file.relativePath,
    sourceKey: `filesystem:${file.path}`,
    sourceType: sourceTypeFilesystem,
    state: syncStatePendingPush,
    workspaceId: file.workspaceFolderId
  });
}

export function markRemoteMarkdownSaved(file: { content: string; path: string; relativePath: string; workspaceFolderId: string }): void {
  const config = getRemoteSyncConfig();

  if (!config.syncLocalOpenedMarkdown || !isMarkdownPath(file.path)) {
    return;
  }

  upsertRemoteSyncItem({
    itemType: itemTypeDocument,
    localPath: file.path,
    relativePath: file.relativePath,
    sourceKey: `filesystem:${file.path}`,
    sourceType: sourceTypeFilesystem,
    state: syncStatePendingPush,
    workspaceId: file.workspaceFolderId
  });
}

export function markRemoteDatabaseWorkspaceDirty(workspaceId?: string): void {
  const config = getRemoteSyncConfig();

  if (!config.syncDatabaseWorkspaces) {
    return;
  }

  upsertRemoteSyncItem({
    itemType: itemTypeWorkspace,
    sourceKey: `database-workspace:${workspaceId ?? 'all'}`,
    sourceType: sourceTypeDatabase,
    state: syncStatePendingPush,
    workspaceId
  });
}

export function markRemotePathDeleted(filePath: string): void {
  const info = getFilesystemWorkspaceInfo(filePath);

  if (!info || !isMarkdownPath(filePath)) {
    return;
  }

  upsertRemoteSyncItem({
    itemType: itemTypeDocument,
    localPath: filePath,
    relativePath: info.relativePath,
    sourceKey: `filesystem:${filePath}`,
    sourceType: sourceTypeFilesystem,
    state: syncStatePendingPush,
    workspaceId: info.workspaceId
  });
}

export async function runRemoteSync(reason: 'manual' | 'retry' | 'startup' | 'save'): Promise<RemoteSyncStatus> {
  if (remoteSyncRunning) {
    return getRemoteSyncStatus();
  }

  const config = getRemoteSyncConfig();
  const supabase = getRemoteSupabaseClient();

  if (!supabase) {
    return getRemoteSyncStatus();
  }

  remoteSyncRunning = true;
  lastRunError = '';

  try {
    await ensureRemoteSyncSchema();
    await ensureRemoteAssetBucket(supabase);

    if (config.syncDatabaseWorkspaces) {
      await pushDatabaseWorkspaces(supabase, config);
    }

    const items = getDatabase()
      .prepare(
        `
        SELECT id, source_type, item_type, source_key, workspace_id, local_path, relative_path, remote_id, content_hash
        FROM remote_sync_items
        WHERE sync_state IN (?, ?, ?)
        ORDER BY updated_at ASC
        `
      )
      .all(syncStatePendingPush, syncStatePendingPull, syncStateFailed) as RemoteSyncItemRow[];

    for (const item of items) {
      try {
        if (item.source_type === sourceTypeFilesystem && item.item_type === itemTypeDocument) {
          await pullFilesystemDocument(supabase, item);
          await pushFilesystemDocument(supabase, item, config);
        }
      } catch (error) {
        console.warn('[remote-sync] item sync failed', {
          error: getErrorMessage(error),
          reason,
          sourceKey: item.source_key
        });
        markSyncItemResult(item.source_key, syncStateFailed, item.content_hash ?? undefined, getUserFacingSyncError(error));
      }
    }

    lastRunAt = Date.now();
    return getRemoteSyncStatus();
  } catch (error) {
    console.warn('[remote-sync] sync failed', {
      error: getErrorMessage(error),
      reason
    });
    lastRunError = getUserFacingSyncError(error);
    return getRemoteSyncStatus();
  } finally {
    remoteSyncRunning = false;
  }
}

export function runRemoteSyncInBackground(reason: 'startup' | 'save'): void {
  const config = getRemoteSyncConfig();

  if (!config.autoSyncEnabled) {
    return;
  }

  if (reason === 'startup' && !config.pullOnStartup) {
    return;
  }

  if (reason === 'save' && !config.pushOnSave) {
    return;
  }

  void runRemoteSync(reason).catch((error) => {
    console.warn('[remote-sync] background sync failed', {
      error: getErrorMessage(error),
      reason
    });
    lastRunError = getUserFacingSyncError(error);
  });
}
