import { randomUUID } from 'node:crypto';
import { getDatabase } from '../database/connection';

export type ThemeMode = 'dark' | 'light';
export type AppLanguage = 'system' | 'en' | 'zh-CN';
export type InterfaceDensity = 'comfortable' | 'compact' | 'spacious';
export type MotionPreference = 'system' | 'full' | 'reduced';

export interface AiModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow: number;
}

export interface ShortcutSettings {
  focusVeloca: string;
  newBlankFile: string;
  openAiPanel: string;
  redo: string;
  toggleSourceMode: string;
  undo: string;
}

export interface TypographySettings {
  editorFontSize: number;
}

export interface AppearanceSettings {
  language: AppLanguage;
  density: InterfaceDensity;
  motion: MotionPreference;
}

const autoSaveKey = 'autoSave';
const themeKey = 'theme';
const appLanguageKey = 'appLanguage';
const interfaceDensityKey = 'interfaceDensity';
const motionPreferenceKey = 'motionPreference';
const aiBaseUrlKey = 'aiBaseUrl';
const aiApiKeyKey = 'aiApiKey';
const aiModelKey = 'aiModel';
const aiContextWindowKey = 'aiContextWindow';
const focusVelocaShortcutKey = 'shortcutFocusVeloca';
const newBlankFileShortcutKey = 'shortcutNewBlankFile';
const openAiPanelShortcutKey = 'shortcutOpenAiPanel';
const redoShortcutKey = 'shortcutRedo';
const toggleSourceModeShortcutKey = 'shortcutToggleSourceMode';
const undoShortcutKey = 'shortcutUndo';
const editorFontSizeKey = 'editorFontSize';
const defaultEditorFontSize = 16;
const minimumEditorFontSize = 13;
const maximumEditorFontSize = 48;
const defaultAppearanceSettings: AppearanceSettings = {
  density: 'comfortable',
  language: 'system',
  motion: 'system'
};

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

function normalizeAppLanguage(language: string | null): AppLanguage {
  return language === 'en' || language === 'zh-CN' ? language : 'system';
}

function normalizeInterfaceDensity(density: string | null): InterfaceDensity {
  return density === 'compact' || density === 'spacious' ? density : 'comfortable';
}

function normalizeMotionPreference(motion: string | null): MotionPreference {
  return motion === 'full' || motion === 'reduced' ? motion : 'system';
}

export function getAppearanceSettings(): AppearanceSettings {
  return {
    density: normalizeInterfaceDensity(getSetting(interfaceDensityKey) ?? defaultAppearanceSettings.density),
    language: normalizeAppLanguage(getSetting(appLanguageKey) ?? defaultAppearanceSettings.language),
    motion: normalizeMotionPreference(getSetting(motionPreferenceKey) ?? defaultAppearanceSettings.motion)
  };
}

export function setAppearanceSettings(settings: AppearanceSettings): AppearanceSettings {
  const normalizedSettings = {
    density: normalizeInterfaceDensity(settings.density),
    language: normalizeAppLanguage(settings.language),
    motion: normalizeMotionPreference(settings.motion)
  };

  setSetting(appLanguageKey, normalizedSettings.language);
  setSetting(interfaceDensityKey, normalizedSettings.density);
  setSetting(motionPreferenceKey, normalizedSettings.motion);
  return normalizedSettings;
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

function getPlatformCommandShortcut(platform: NodeJS.Platform, key: string): string {
  return `${platform === 'darwin' ? 'Command' : 'Ctrl'}+${key}`;
}

export function getDefaultOpenAiPanelShortcut(platform: NodeJS.Platform): string {
  return getPlatformCommandShortcut(platform, 'J');
}

function getStoredShortcut(settingKey: string, fallback: string, legacyFallback?: string): string {
  const storedShortcut = getSetting(settingKey);

  if (!storedShortcut || storedShortcut === legacyFallback) {
    return fallback;
  }

  return storedShortcut;
}

export function getShortcutSettings(platform: NodeJS.Platform): ShortcutSettings {
  const openAiPanelFallback = getDefaultOpenAiPanelShortcut(platform);
  const incorrectOpenAiPanelFallback = getPlatformCommandShortcut(platform, 'Q');

  return {
    focusVeloca: getStoredShortcut(focusVelocaShortcutKey, getPlatformCommandShortcut(platform, 'Q')),
    newBlankFile: getStoredShortcut(newBlankFileShortcutKey, getPlatformCommandShortcut(platform, 'N')),
    openAiPanel: getStoredShortcut(openAiPanelShortcutKey, openAiPanelFallback, incorrectOpenAiPanelFallback),
    redo: getStoredShortcut(redoShortcutKey, getPlatformCommandShortcut(platform, 'Shift+Z')),
    toggleSourceMode: getStoredShortcut(toggleSourceModeShortcutKey, getPlatformCommandShortcut(platform, '/')),
    undo: getStoredShortcut(undoShortcutKey, getPlatformCommandShortcut(platform, 'Z'))
  };
}

export function setShortcutSettings(settings: ShortcutSettings): ShortcutSettings {
  setSetting(focusVelocaShortcutKey, settings.focusVeloca);
  setSetting(newBlankFileShortcutKey, settings.newBlankFile);
  setSetting(openAiPanelShortcutKey, settings.openAiPanel);
  setSetting(redoShortcutKey, settings.redo);
  setSetting(toggleSourceModeShortcutKey, settings.toggleSourceMode);
  setSetting(undoShortcutKey, settings.undo);
  return settings;
}

export function normalizeEditorFontSize(fontSize: number): number {
  if (!Number.isFinite(fontSize)) {
    return defaultEditorFontSize;
  }

  return Math.min(Math.max(Math.round(fontSize), minimumEditorFontSize), maximumEditorFontSize);
}

export function getTypographySettings(): TypographySettings {
  const storedFontSize = Number(getSetting(editorFontSizeKey));

  return {
    editorFontSize: normalizeEditorFontSize(storedFontSize || defaultEditorFontSize)
  };
}

export function setTypographySettings(settings: TypographySettings): TypographySettings {
  const normalizedSettings = {
    editorFontSize: normalizeEditorFontSize(settings.editorFontSize)
  };

  setSetting(editorFontSizeKey, String(normalizedSettings.editorFontSize));
  return normalizedSettings;
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
