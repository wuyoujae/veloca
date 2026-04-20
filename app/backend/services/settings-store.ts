import { randomUUID } from 'node:crypto';
import { getDatabase } from '../database/connection';

export type ThemeMode = 'dark' | 'light';

const themeKey = 'theme';

export function getTheme(): ThemeMode {
  const row = getDatabase()
    .prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?')
    .get(themeKey) as { setting_value: string } | undefined;

  return row?.setting_value === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: ThemeMode): ThemeMode {
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
    .run(randomUUID(), themeKey, theme, now, now);

  return theme;
}
