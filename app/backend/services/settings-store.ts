import { randomUUID } from 'node:crypto';
import { getDatabase } from '../database/connection';

export type ThemeMode = 'dark' | 'light';

const autoSaveKey = 'autoSave';
const themeKey = 'theme';

export function getSetting(key: string): string | null {
  const row = getDatabase()
    .prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?')
    .get(key) as { setting_value: string } | undefined;

  return row?.setting_value ?? null;
}

export function getTheme(): ThemeMode {
  return getSetting(themeKey) === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: ThemeMode): ThemeMode {
  setSetting(themeKey, theme);
  return theme;
}

export function getAutoSave(): boolean {
  return getSetting(autoSaveKey) === 'false' ? false : true;
}

export function setAutoSave(enabled: boolean): boolean {
  setSetting(autoSaveKey, enabled ? 'true' : 'false');
  return enabled;
}

export function setSetting(key: string, value: string): void {
  const now = Date.now();

  getDatabase()
    .prepare(
      `
      INSERT INTO app_settings (id, setting_key, setting_value, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = excluded.updated_at
      `
    )
    .run(randomUUID(), key, value, now, now);
}

export function deleteSetting(key: string): void {
  getDatabase().prepare('DELETE FROM app_settings WHERE setting_key = ?').run(key);
}
