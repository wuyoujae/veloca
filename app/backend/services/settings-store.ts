import { randomUUID } from 'node:crypto';
import { getDatabase } from '../database/connection';

export type ThemeMode = 'dark' | 'light';

export interface AiModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow: number;
}

const autoSaveKey = 'autoSave';
const themeKey = 'theme';
const aiBaseUrlKey = 'aiBaseUrl';
const aiApiKeyKey = 'aiApiKey';
const aiModelKey = 'aiModel';
const aiContextWindowKey = 'aiContextWindow';

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

export function getAiBaseUrl(): string | null {
  return getSetting(aiBaseUrlKey);
}

export function getAiApiKey(): string | null {
  return getSetting(aiApiKeyKey);
}

export function getAiModel(): string | null {
  return getSetting(aiModelKey);
}

export function getAiContextWindow(): number | null {
  const value = getSetting(aiContextWindowKey);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function setAiConfig(config: AiModelConfig): AiModelConfig {
  setSetting(aiBaseUrlKey, config.baseUrl);
  setSetting(aiApiKeyKey, config.apiKey);
  setSetting(aiModelKey, config.model);
  setSetting(aiContextWindowKey, String(config.contextWindow));
  return config;
}

export function deleteAiConfig(): void {
  deleteSetting(aiBaseUrlKey);
  deleteSetting(aiApiKeyKey);
  deleteSetting(aiModelKey);
  deleteSetting(aiContextWindowKey);
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
