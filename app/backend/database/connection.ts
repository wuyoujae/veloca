import { app } from 'electron';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

let database: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (database) {
    return database;
  }

  const dbName = process.env.VELOCA_DB_NAME ?? 'veloca.sqlite';
  const dbPath = join(app.getPath('userData'), dbName);
  mkdirSync(dirname(dbPath), { recursive: true });

  database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = OFF');
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_folders (
      id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS virtual_workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS virtual_workspace_entries (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      parent_id TEXT,
      entry_type INTEGER NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS virtual_workspace_assets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      document_entry_id TEXT NOT NULL,
      asset_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      binary_content BLOB NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS version_repositories (
      id TEXT PRIMARY KEY,
      provider INTEGER NOT NULL,
      owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      remote_url TEXT NOT NULL,
      html_url TEXT,
      local_path TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(provider, owner, repo_name)
    );

    CREATE TABLE IF NOT EXISTS version_workspace_configs (
      id TEXT PRIMARY KEY,
      workspace_folder_id TEXT NOT NULL UNIQUE,
      source_root_path TEXT NOT NULL,
      display_name TEXT NOT NULL,
      shadow_prefix TEXT NOT NULL UNIQUE,
      status INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS version_managed_files (
      id TEXT PRIMARY KEY,
      workspace_folder_id TEXT NOT NULL,
      source_root_path TEXT NOT NULL,
      source_path TEXT NOT NULL UNIQUE,
      relative_path TEXT NOT NULL,
      shadow_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_provenance_snapshots (
      id TEXT PRIMARY KEY,
      document_key TEXT NOT NULL UNIQUE,
      workspace_type INTEGER NOT NULL,
      document_path TEXT NOT NULL,
      workspace_folder_id TEXT NOT NULL,
      markdown_hash TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  return database;
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}
