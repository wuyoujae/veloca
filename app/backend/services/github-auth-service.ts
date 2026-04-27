import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { net, safeStorage } from 'electron';
import { deleteSetting, getSetting, setSetting } from './settings-store';

export interface GitHubAccountProfile {
  avatarUrl: string;
  connectedAt: number;
  id: number;
  login: string;
  name: string | null;
  profileUrl: string;
}

export interface GitHubAuthStatus {
  account: GitHubAccountProfile | null;
  connected: boolean;
  configured: boolean;
  hasVersionManagementScope: boolean;
  requiresRebindForVersionManagement: boolean;
  scopes: string[];
}

export interface GitHubDeviceBinding {
  expiresAt: number;
  interval: number;
  scope: string;
  sessionId: string;
  userCode: string;
  verificationUri: string;
}

interface PendingGitHubBinding {
  clientId: string;
  deviceCode: string;
  expiresAt: number;
  interval: number;
  scope: string;
}

interface GitHubDeviceCodeResponse {
  device_code?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  interval?: number;
  user_code?: string;
  verification_uri?: string;
}

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  interval?: number;
  scope?: string;
  token_type?: string;
}

interface GitHubUserResponse {
  avatar_url?: string;
  html_url?: string;
  id?: number;
  login?: string;
  name?: string | null;
}

const githubClientIdEnv = 'VELOCA_GITHUB_CLIENT_ID';
const githubAccountKey = 'github.account';
const githubTokenKey = 'github.token';
export const githubVersionManagementScope = 'repo';
const githubScope = githubVersionManagementScope;
const githubDeviceGrantType = 'urn:ietf:params:oauth:grant-type:device_code';
const pendingBindings = new Map<string, PendingGitHubBinding>();
const githubNetworkRetryAttempts = 3;
const githubNetworkRetryDelayMs = 900;

let envLoaded = false;

function loadLocalEnv(): void {
  if (envLoaded) {
    return;
  }

  envLoaded = true;
  const envPath = join(process.cwd(), '.env');

  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, 'utf-8').split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getGitHubClientId(): string | null {
  loadLocalEnv();
  return process.env[githubClientIdEnv]?.trim() || null;
}

function getRequiredGitHubClientId(): string {
  const clientId = getGitHubClientId();

  if (!clientId) {
    throw new Error(`${githubClientIdEnv} is required before binding a GitHub account.`);
  }

  return clientId;
}

function getStoredGitHubAccount(): GitHubAccountProfile | null {
  const storedAccount = getSetting(githubAccountKey);

  if (!storedAccount) {
    return null;
  }

  try {
    const account = JSON.parse(storedAccount) as Partial<GitHubAccountProfile>;

    if (
      typeof account.id !== 'number' ||
      typeof account.login !== 'string' ||
      typeof account.avatarUrl !== 'string' ||
      typeof account.profileUrl !== 'string' ||
      typeof account.connectedAt !== 'number'
    ) {
      return null;
    }

    return {
      avatarUrl: account.avatarUrl,
      connectedAt: account.connectedAt,
      id: account.id,
      login: account.login,
      name: typeof account.name === 'string' ? account.name : null,
      profileUrl: account.profileUrl
    };
  } catch {
    return null;
  }
}

function assertSecureCredentialStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable on this device.');
  }
}

function storeGitHubToken(token: string): void {
  assertSecureCredentialStorage();
  setSetting(githubTokenKey, safeStorage.encryptString(token).toString('base64'));
}

export function getGitHubAccessToken(): string | null {
  const encryptedToken = getSetting(githubTokenKey);

  if (!encryptedToken) {
    return null;
  }

  try {
    assertSecureCredentialStorage();
    return safeStorage.decryptString(Buffer.from(encryptedToken, 'base64'));
  } catch {
    return null;
  }
}

function storeGitHubAccount(account: GitHubAccountProfile): void {
  setSetting(githubAccountKey, JSON.stringify(account));
}

function buildFormBody(values: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    body.set(key, value);
  }

  return body;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientGitHubNetworkError(error: unknown): boolean {
  const message = getErrorMessage(error);

  return /net::ERR_|ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ERR_INTERNET_DISCONNECTED|fetch failed|network/i.test(
    message
  );
}

async function retryGitHubNetworkRequest<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= githubNetworkRetryAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isTransientGitHubNetworkError(error) || attempt === githubNetworkRetryAttempts) {
        throw error;
      }

      await wait(githubNetworkRetryDelayMs * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('GitHub network request failed.');
}

async function postGitHubForm<T>(url: string, values: Record<string, string>): Promise<T> {
  return retryGitHubNetworkRequest(async () => {
    const response = await net.fetch(url, {
      body: buildFormBody(values),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Veloca'
      },
      method: 'POST'
    });

    const payload = (await response.json()) as T & { error?: string; error_description?: string };

    if (!response.ok) {
      throw new Error(payload.error_description || payload.error || `GitHub request failed with ${response.status}.`);
    }

    return payload;
  });
}

function parseGitHubScopes(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function fetchGitHubUser(accessToken: string): Promise<{ account: GitHubAccountProfile; scopes: string[] }> {
  return retryGitHubNetworkRequest(async () => {
    const response = await net.fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'Veloca',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    const user = (await response.json()) as GitHubUserResponse;

    if (!response.ok || typeof user.id !== 'number' || typeof user.login !== 'string') {
      throw new Error('Unable to validate the authorized GitHub account.');
    }

    return {
      account: {
        avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : '',
        connectedAt: Date.now(),
        id: user.id,
        login: user.login,
        name: typeof user.name === 'string' ? user.name : null,
        profileUrl: typeof user.html_url === 'string' ? user.html_url : `https://github.com/${user.login}`
      },
      scopes: parseGitHubScopes(response.headers.get('x-oauth-scopes'))
    };
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function getGitHubAuthStatus(): Promise<GitHubAuthStatus> {
  const account = getStoredGitHubAccount();
  const accessToken = getGitHubAccessToken();
  let scopes: string[] = [];

  if (accessToken) {
    try {
      const validated = await fetchGitHubUser(accessToken);
      scopes = validated.scopes;
    } catch {
      scopes = [];
    }
  }

  const hasVersionManagementScope = scopes.includes(githubVersionManagementScope);

  return {
    account,
    connected: Boolean(account),
    configured: Boolean(getGitHubClientId()),
    hasVersionManagementScope,
    requiresRebindForVersionManagement: Boolean(account) && !hasVersionManagementScope,
    scopes
  };
}

export async function startGitHubBinding(): Promise<GitHubDeviceBinding> {
  const clientId = getRequiredGitHubClientId();
  assertSecureCredentialStorage();

  const payload = await postGitHubForm<GitHubDeviceCodeResponse>('https://github.com/login/device/code', {
    client_id: clientId,
    scope: githubScope
  });

  if (
    !payload.device_code ||
    !payload.user_code ||
    !payload.verification_uri ||
    typeof payload.expires_in !== 'number'
  ) {
    throw new Error(payload.error_description || payload.error || 'GitHub did not return a valid device code.');
  }

  const sessionId = randomUUID();
  const interval = typeof payload.interval === 'number' && payload.interval > 0 ? payload.interval : 5;
  const expiresAt = Date.now() + payload.expires_in * 1000;

  pendingBindings.set(sessionId, {
    clientId,
    deviceCode: payload.device_code,
    expiresAt,
    interval,
    scope: githubScope
  });

  return {
    expiresAt,
    interval,
    scope: githubScope,
    sessionId,
    userCode: payload.user_code,
    verificationUri: payload.verification_uri
  };
}

export async function completeGitHubBinding(sessionId: string): Promise<GitHubAuthStatus> {
  const pendingBinding = pendingBindings.get(sessionId);

  if (!pendingBinding) {
    throw new Error('GitHub binding session is no longer available.');
  }

  let interval = pendingBinding.interval;
  let authorizedAccessToken: string | null = null;
  let lastTransientErrorMessage = '';

  try {
    while (Date.now() < pendingBinding.expiresAt) {
      await wait(interval * 1000);

      if (authorizedAccessToken) {
        try {
          const { account } = await fetchGitHubUser(authorizedAccessToken);

          storeGitHubToken(authorizedAccessToken);
          storeGitHubAccount(account);
          pendingBindings.delete(sessionId);

          return getGitHubAuthStatus();
        } catch (error) {
          if (isTransientGitHubNetworkError(error)) {
            lastTransientErrorMessage = getErrorMessage(error);
            continue;
          }

          throw error;
        }
      }

      let tokenResponse: GitHubTokenResponse;

      try {
        tokenResponse = await postGitHubForm<GitHubTokenResponse>('https://github.com/login/oauth/access_token', {
          client_id: pendingBinding.clientId,
          device_code: pendingBinding.deviceCode,
          grant_type: githubDeviceGrantType
        });
      } catch (error) {
        if (isTransientGitHubNetworkError(error)) {
          lastTransientErrorMessage = getErrorMessage(error);
          continue;
        }

        throw error;
      }

      if (tokenResponse.access_token) {
        authorizedAccessToken = tokenResponse.access_token;
        continue;
      }

      if (tokenResponse.error === 'authorization_pending') {
        continue;
      }

      if (tokenResponse.error === 'slow_down') {
        interval = typeof tokenResponse.interval === 'number' ? tokenResponse.interval : interval + 5;
        continue;
      }

      throw new Error(tokenResponse.error_description || tokenResponse.error || 'GitHub authorization failed.');
    }

    if (lastTransientErrorMessage) {
      throw new Error(`GitHub authorization expired before Veloca could confirm it. Last network error: ${lastTransientErrorMessage}`);
    }

    throw new Error('GitHub authorization expired. Please start binding again.');
  } finally {
    pendingBindings.delete(sessionId);
  }
}

export function unbindGitHubAccount(): GitHubAuthStatus {
  deleteSetting(githubTokenKey);
  deleteSetting(githubAccountKey);

  return {
    account: null,
    connected: false,
    configured: Boolean(getGitHubClientId()),
    hasVersionManagementScope: false,
    requiresRebindForVersionManagement: false,
    scopes: []
  };
}
