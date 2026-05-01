import { randomUUID } from 'node:crypto';
import { net, safeStorage } from 'electron';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { getDatabase } from '../database/connection';

export interface RemoteDatabaseConfigInput {
  databasePassword?: string;
  organizationSlug: string;
  personalAccessToken?: string;
  region: string;
}

export interface RemoteDatabaseConfigView {
  databaseHost: string;
  databasePasswordSaved: boolean;
  initializedAt: number | null;
  lastError: string;
  organizationSlug: string;
  patSaved: boolean;
  projectName: string;
  projectRef: string;
  projectUrl: string;
  publishableKeySaved: boolean;
  region: string;
  secretKeySaved: boolean;
  status: RemoteDatabaseStatus;
  statusCode: number;
  updatedAt: number | null;
}

export interface RemoteProjectProvisionResult {
  config: RemoteDatabaseConfigView;
  reusedExistingProject: boolean;
}

export interface RemoteRegionOption {
  code: string;
  label: string;
  name: string;
  provider: string;
  recommended: boolean;
  status: string;
  type: 'smartGroup' | 'specific';
}

interface RemoteDatabaseConfigRow {
  database_host: string | null;
  encrypted_db_password: string | null;
  encrypted_pat: string | null;
  encrypted_secret_key: string | null;
  initialized_at: number | null;
  last_error: string | null;
  organization_slug: string;
  project_name: string;
  project_ref: string | null;
  project_url: string | null;
  publishable_key: string | null;
  region: string;
  status: number;
  updated_at: number;
}

interface SupabaseProjectResponse {
  database?: {
    host?: string;
  };
  id?: string;
  name?: string;
  organization_slug?: string;
  ref?: string;
  region?: string;
  status?: string;
}

interface SupabaseApiKeyResponse {
  api_key?: string;
  description?: string;
  id?: string;
  name?: string;
  prefix?: string;
  type?: string;
}

interface SupabaseProjectListResponse {
  projects?: SupabaseProjectResponse[];
}

class SupabaseManagementApiError extends Error {
  method: string;
  path: string;
  status: number;

  constructor(method: string, path: string, status: number, message: string) {
    super(message);
    this.method = method;
    this.path = path;
    this.status = status;
    this.name = 'SupabaseManagementApiError';
  }
}

export type RemoteDatabaseStatus = 'notConfigured' | 'configured' | 'creating' | 'waiting' | 'initialized' | 'failed';

const supabaseManagementApiBaseUrl = 'https://api.supabase.com';
const remoteProviderSupabase = 1;
const remoteProjectName = 'veloca';
const defaultRegion = 'us-east-1';
const defaultRemoteRegionData: Array<[code: string, name: string]> = [
  ['us-east-1', 'East US (North Virginia)'],
  ['us-east-2', 'East US (Ohio)'],
  ['us-west-1', 'West US (North California)'],
  ['us-west-2', 'West US (Oregon)'],
  ['ca-central-1', 'Canada (Central)'],
  ['eu-west-1', 'West EU (Ireland)'],
  ['eu-west-2', 'West Europe (London)'],
  ['eu-west-3', 'West EU (Paris)'],
  ['eu-central-1', 'Central EU (Frankfurt)'],
  ['eu-central-2', 'Central Europe (Zurich)'],
  ['eu-north-1', 'North EU (Stockholm)'],
  ['ap-south-1', 'South Asia (Mumbai)'],
  ['ap-southeast-1', 'Southeast Asia (Singapore)'],
  ['ap-southeast-2', 'Oceania (Sydney)'],
  ['ap-northeast-1', 'Northeast Asia (Tokyo)'],
  ['ap-northeast-2', 'Northeast Asia (Seoul)'],
  ['sa-east-1', 'South America (Sao Paulo)']
];
const defaultRemoteRegionOptions: RemoteRegionOption[] = defaultRemoteRegionData.map(([code, name]) => ({
  code,
  label: `${name} - ${code}`,
  name,
  provider: 'AWS',
  recommended: code === defaultRegion,
  status: '',
  type: 'specific'
}));
const statusCodeByStatus: Record<RemoteDatabaseStatus, number> = {
  notConfigured: 0,
  configured: 1,
  creating: 2,
  waiting: 3,
  initialized: 4,
  failed: 5
};
const statusByStatusCode = new Map<number, RemoteDatabaseStatus>(
  Object.entries(statusCodeByStatus).map(([status, code]) => [code, status as RemoteDatabaseStatus])
);
const projectReadyPollAttempts = 24;
const projectReadyPollDelayMs = 5000;
const remoteSchemaSql = `
CREATE TABLE IF NOT EXISTS veloca_remote_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS veloca_remote_documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  parent_id TEXT,
  entry_type INTEGER NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS veloca_remote_assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  asset_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS veloca_remote_document_provenance (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  markdown_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_veloca_remote_documents_workspace_id
  ON veloca_remote_documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_veloca_remote_documents_parent_id
  ON veloca_remote_documents(parent_id);
CREATE INDEX IF NOT EXISTS idx_veloca_remote_assets_document_id
  ON veloca_remote_assets(document_id);
CREATE INDEX IF NOT EXISTS idx_veloca_remote_document_provenance_document_id
  ON veloca_remote_document_provenance(document_id);
`;

function assertSecureCredentialStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable. Enable the system keychain before saving Supabase credentials.');
  }
}

function encryptCredential(value: string): string {
  assertSecureCredentialStorage();
  return safeStorage.encryptString(value).toString('base64');
}

function decryptCredential(encryptedValue: string | null): string | null {
  if (!encryptedValue) {
    return null;
  }

  try {
    assertSecureCredentialStorage();
    return safeStorage.decryptString(Buffer.from(encryptedValue, 'base64'));
  } catch {
    return null;
  }
}

function getRemoteConfigRow(): RemoteDatabaseConfigRow | null {
  const row = getDatabase()
    .prepare(
      `
      SELECT
        database_host,
        encrypted_db_password,
        encrypted_pat,
        encrypted_secret_key,
        initialized_at,
        last_error,
        organization_slug,
        project_name,
        project_ref,
        project_url,
        publishable_key,
        region,
        status,
        updated_at
      FROM remote_database_configs
      WHERE provider = ?
      ORDER BY updated_at DESC
      LIMIT 1
      `
    )
    .get(remoteProviderSupabase) as RemoteDatabaseConfigRow | undefined;

  return row ?? null;
}

function toConfigView(row: RemoteDatabaseConfigRow | null): RemoteDatabaseConfigView {
  if (!row) {
    return {
      databaseHost: '',
      databasePasswordSaved: false,
      initializedAt: null,
      lastError: '',
      organizationSlug: '',
      patSaved: false,
      projectName: remoteProjectName,
      projectRef: '',
      projectUrl: '',
      publishableKeySaved: false,
      region: defaultRegion,
      secretKeySaved: false,
      status: 'notConfigured',
      statusCode: statusCodeByStatus.notConfigured,
      updatedAt: null
    };
  }

  const status = statusByStatusCode.get(row.status) ?? 'configured';

  return {
    databaseHost: row.database_host ?? '',
    databasePasswordSaved: Boolean(row.encrypted_db_password),
    initializedAt: row.initialized_at,
    lastError: row.last_error ?? '',
    organizationSlug: row.organization_slug,
    patSaved: Boolean(row.encrypted_pat),
    projectName: row.project_name,
    projectRef: row.project_ref ?? '',
    projectUrl: row.project_url ?? '',
    publishableKeySaved: Boolean(row.publishable_key),
    region: row.region,
    secretKeySaved: Boolean(row.encrypted_secret_key),
    status,
    statusCode: row.status,
    updatedAt: row.updated_at
  };
}

function normalizeRemoteConfigInput(input: RemoteDatabaseConfigInput): Required<RemoteDatabaseConfigInput> {
  const personalAccessToken = input.personalAccessToken?.trim() ?? '';
  const organizationSlug = input.organizationSlug.trim();
  const region = input.region.trim() || defaultRegion;
  const databasePassword = input.databasePassword ?? '';

  if (!organizationSlug || !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(organizationSlug)) {
    throw new Error('Supabase organization slug is required.');
  }

  if (!/^[a-z0-9-]+$/.test(region)) {
    throw new Error('Supabase region must be a valid region code.');
  }

  return {
    databasePassword,
    organizationSlug,
    personalAccessToken,
    region
  };
}

function upsertRemoteConfig(
  input: Required<RemoteDatabaseConfigInput>,
  status: RemoteDatabaseStatus,
  existingRow?: RemoteDatabaseConfigRow | null
): void {
  const now = Date.now();
  const encryptedPat = input.personalAccessToken ? encryptCredential(input.personalAccessToken) : existingRow?.encrypted_pat ?? null;
  const encryptedDbPassword = input.databasePassword
    ? encryptCredential(input.databasePassword)
    : existingRow?.encrypted_db_password ?? null;

  getDatabase()
    .prepare(
      `
      INSERT INTO remote_database_configs (
        id,
        provider,
        project_name,
        organization_slug,
        region,
        encrypted_pat,
        encrypted_db_password,
        status,
        last_error,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(provider, organization_slug, project_name) DO UPDATE SET
        region = excluded.region,
        encrypted_pat = COALESCE(excluded.encrypted_pat, remote_database_configs.encrypted_pat),
        encrypted_db_password = COALESCE(excluded.encrypted_db_password, remote_database_configs.encrypted_db_password),
        status = excluded.status,
        last_error = NULL,
        updated_at = excluded.updated_at
      `
    )
    .run(
      randomUUID(),
      remoteProviderSupabase,
      remoteProjectName,
      input.organizationSlug,
      input.region,
      encryptedPat,
      encryptedDbPassword,
      statusCodeByStatus[status],
      now,
      now
    );
}

function updateRemoteConfigStatus(status: RemoteDatabaseStatus, error?: string): void {
  getDatabase()
    .prepare(
      `
      UPDATE remote_database_configs
      SET status = ?, last_error = ?, updated_at = ?
      WHERE provider = ? AND project_name = ?
      `
    )
    .run(statusCodeByStatus[status], error ?? null, Date.now(), remoteProviderSupabase, remoteProjectName);
}

function updateRemoteProjectDetails(
  project: SupabaseProjectResponse,
  organizationSlug: string,
  region: string,
  publishableKey: string,
  secretKey: string | null
): void {
  if (!project.ref) {
    throw new Error('Supabase did not return a project ref.');
  }

  const now = Date.now();
  const databaseHost = project.database?.host || `db.${project.ref}.supabase.co`;
  const projectUrl = `https://${project.ref}.supabase.co`;
  const encryptedSecretKey = secretKey ? encryptCredential(secretKey) : null;

  getDatabase()
    .prepare(
      `
      UPDATE remote_database_configs
      SET
        project_ref = ?,
        project_url = ?,
        database_host = ?,
        publishable_key = ?,
        encrypted_secret_key = COALESCE(?, encrypted_secret_key),
        status = ?,
        last_error = NULL,
        initialized_at = ?,
        updated_at = ?
      WHERE provider = ? AND organization_slug = ? AND project_name = ? AND region = ?
      `
    )
    .run(
      project.ref,
      projectUrl,
      databaseHost,
      publishableKey,
      encryptedSecretKey,
      statusCodeByStatus.initialized,
      now,
      now,
      remoteProviderSupabase,
      organizationSlug,
      remoteProjectName,
      region
    );
}

async function fetchSupabaseManagement<T>(
  personalAccessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', `Bearer ${personalAccessToken}`);
  headers.set('User-Agent', 'Veloca');

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await net.fetch(`${supabaseManagementApiBaseUrl}${path}`, {
    ...init,
    headers
  });
  const responseText = await response.text();
  let payload = {} as T;

  if (responseText) {
    try {
      payload = JSON.parse(responseText) as T;
    } catch {
      payload = { message: responseText } as T;
    }
  }

  if (!response.ok) {
    const errorPayload = payload as { error?: unknown; message?: unknown };
    const errorMessage =
      typeof errorPayload.message === 'string'
        ? errorPayload.message
        : typeof errorPayload.error === 'string'
          ? errorPayload.error
          : `Supabase Management API request failed with ${response.status}.`;
    throw new SupabaseManagementApiError(
      method,
      path,
      response.status,
      `Supabase Management API ${method} ${path} failed (${response.status}): ${errorMessage}`
    );
  }

  return payload;
}

async function validateSupabaseOrganization(personalAccessToken: string, organizationSlug: string): Promise<void> {
  try {
    await fetchSupabaseManagement(personalAccessToken, `/v1/organizations/${encodeURIComponent(organizationSlug)}`);
  } catch (error) {
    if (error instanceof SupabaseManagementApiError && error.status === 404) {
      throw new Error(
        `Supabase organization slug "${organizationSlug}" was not found. Use the organization slug from the Supabase dashboard URL, not the display name.`
      );
    }

    throw error;
  }
}

async function getExistingVelocaProject(
  personalAccessToken: string,
  organizationSlug: string
): Promise<SupabaseProjectResponse | null> {
  let payload: SupabaseProjectResponse[] | SupabaseProjectListResponse;

  try {
    payload = await fetchSupabaseManagement<SupabaseProjectResponse[] | SupabaseProjectListResponse>(
      personalAccessToken,
      `/v1/organizations/${encodeURIComponent(organizationSlug)}/projects`
    );
  } catch (error) {
    if (!(error instanceof SupabaseManagementApiError && error.status === 404)) {
      throw error;
    }

    payload = await fetchSupabaseManagement<SupabaseProjectResponse[] | SupabaseProjectListResponse>(
      personalAccessToken,
      '/v1/projects'
    );
  }

  const projects = Array.isArray(payload) ? payload : payload.projects ?? [];

  return projects.find((project) =>
    project.name === remoteProjectName &&
    (!project.organization_slug || project.organization_slug === organizationSlug)
  ) ?? null;
}

function getRegionSelection(regionCode: string): Pick<RemoteRegionOption, 'code' | 'type'> {
  const staticRegion = defaultRemoteRegionOptions.find((region) => region.code === regionCode);

  return {
    code: regionCode,
    type: staticRegion?.type ?? 'specific'
  };
}

async function createVelocaProject(
  personalAccessToken: string,
  organizationSlug: string,
  regionSelection: Pick<RemoteRegionOption, 'code' | 'type'>,
  databasePassword: string
): Promise<SupabaseProjectResponse> {
  const basePayload = {
    db_pass: databasePassword,
    name: remoteProjectName,
    organization_slug: organizationSlug
  };

  try {
    return await fetchSupabaseManagement<SupabaseProjectResponse>(personalAccessToken, '/v1/projects', {
      body: JSON.stringify({
        ...basePayload,
        region_selection: {
          code: regionSelection.code,
          type: regionSelection.type
        }
      }),
      method: 'POST'
    });
  } catch (error) {
    if (!(error instanceof SupabaseManagementApiError && [400, 404, 422].includes(error.status))) {
      throw error;
    }

    return fetchSupabaseManagement<SupabaseProjectResponse>(personalAccessToken, '/v1/projects', {
      body: JSON.stringify({
        ...basePayload,
        region: regionSelection.code
      }),
      method: 'POST'
    });
  }
}

async function getSupabaseProject(
  personalAccessToken: string,
  projectRef: string
): Promise<SupabaseProjectResponse> {
  return fetchSupabaseManagement<SupabaseProjectResponse>(
    personalAccessToken,
    `/v1/projects/${encodeURIComponent(projectRef)}`
  );
}

async function waitForProjectReady(
  personalAccessToken: string,
  project: SupabaseProjectResponse
): Promise<SupabaseProjectResponse> {
  if (!project.ref) {
    throw new Error('Supabase did not return a project ref.');
  }

  let latestProject = project;

  for (let attempt = 0; attempt < projectReadyPollAttempts; attempt += 1) {
    try {
      latestProject = await getSupabaseProject(personalAccessToken, project.ref);
    } catch (error) {
      if (!(error instanceof SupabaseManagementApiError && error.status === 404)) {
        throw error;
      }

      await wait(projectReadyPollDelayMs);
      continue;
    }

    if (latestProject.status?.toUpperCase().startsWith('ACTIVE') && latestProject.database?.host) {
      return latestProject;
    }

    await wait(projectReadyPollDelayMs);
  }

  throw new Error('Supabase project was created but did not become ready in time.');
}

async function getProjectApiKeys(
  personalAccessToken: string,
  projectRef: string
): Promise<{ publishableKey: string; secretKey: string | null }> {
  let keys: SupabaseApiKeyResponse[] | null = null;

  for (let attempt = 0; attempt < projectReadyPollAttempts; attempt += 1) {
    try {
      keys = await fetchSupabaseManagement<SupabaseApiKeyResponse[]>(
        personalAccessToken,
        `/v1/projects/${encodeURIComponent(projectRef)}/api-keys?reveal=true`
      );
      break;
    } catch (error) {
      if (!(error instanceof SupabaseManagementApiError && error.status === 404)) {
        throw error;
      }

      await wait(projectReadyPollDelayMs);
    }
  }

  if (!keys) {
    throw new Error('Supabase API keys were not available in time.');
  }

  const publishableKey =
    keys.find((key) => key.api_key?.startsWith('sb_publishable_'))?.api_key ??
    keys.find((key) => /publishable|anon/i.test(`${key.name ?? ''} ${key.description ?? ''}`))?.api_key ??
    '';
  const secretKey =
    keys.find((key) => key.api_key?.startsWith('sb_secret_'))?.api_key ??
    keys.find((key) => /secret|service_role/i.test(`${key.name ?? ''} ${key.description ?? ''}`))?.api_key ??
    null;

  if (!publishableKey) {
    throw new Error('Supabase did not return a publishable or anon API key.');
  }

  return {
    publishableKey,
    secretKey
  };
}

async function initializeRemoteSchema(project: SupabaseProjectResponse, databasePassword: string): Promise<void> {
  if (!project.ref) {
    throw new Error('Supabase did not return a project ref.');
  }

  const client = new Client({
    database: 'postgres',
    host: project.database?.host || `db.${project.ref}.supabase.co`,
    password: databasePassword,
    port: 5432,
    ssl: {
      rejectUnauthorized: false
    },
    user: 'postgres'
  });

  await client.connect();

  try {
    await client.query(remoteSchemaSql);
  } finally {
    await client.end();
  }
}

async function testRemoteSupabaseClient(projectUrl: string, secretKey: string | null): Promise<void> {
  if (!secretKey) {
    return;
  }

  const supabase = createClient(projectUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
  const { error } = await supabase.from('veloca_remote_workspaces').select('id').limit(1);

  if (error) {
    throw new Error(error.message);
  }
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function getRemoteSetupErrorMessage(error: unknown): string {
  if (!(error instanceof SupabaseManagementApiError)) {
    return error instanceof Error ? error.message : 'Supabase remote setup failed.';
  }

  if (error.method === 'POST' && error.path === '/v1/projects' && error.status === 404) {
    return 'Supabase could not create the Veloca project. Check that the organization slug is correct and that the selected region is available for new projects.';
  }

  if (error.path.includes('/api-keys') && error.status === 404) {
    return 'Supabase created the project, but the API keys endpoint was not available yet. Wait a minute and retry Create / Connect.';
  }

  return error.message;
}

function logRemoteSetupStep(step: string, details: Record<string, string | boolean | null> = {}): void {
  console.info('[remote-supabase]', step, details);
}

export function getRemoteDatabaseConfig(): RemoteDatabaseConfigView {
  return toConfigView(getRemoteConfigRow());
}

export function saveRemoteDatabaseConfig(input: RemoteDatabaseConfigInput): RemoteDatabaseConfigView {
  const normalizedInput = normalizeRemoteConfigInput(input);
  const existingRow = getRemoteConfigRow();

  if (!normalizedInput.personalAccessToken && !existingRow?.encrypted_pat) {
    throw new Error('Supabase personal access token is required.');
  }

  upsertRemoteConfig(normalizedInput, 'configured', existingRow);
  return getRemoteDatabaseConfig();
}

export async function listAvailableRemoteRegions(): Promise<RemoteRegionOption[]> {
  return defaultRemoteRegionOptions;
}

export async function provisionRemoteVelocaProject(
  input: RemoteDatabaseConfigInput
): Promise<RemoteProjectProvisionResult> {
  const normalizedInput = normalizeRemoteConfigInput(input);
  const existingRow = getRemoteConfigRow();
  const personalAccessToken = normalizedInput.personalAccessToken || decryptCredential(existingRow?.encrypted_pat ?? null);
  const databasePassword = normalizedInput.databasePassword || decryptCredential(existingRow?.encrypted_db_password ?? null);

  if (!personalAccessToken) {
    throw new Error('Supabase personal access token is required.');
  }

  if (!databasePassword) {
    throw new Error('Supabase database password is required.');
  }

  upsertRemoteConfig(
    {
      ...normalizedInput,
      databasePassword,
      personalAccessToken
    },
    'creating',
    existingRow
  );

  try {
    logRemoteSetupStep('validate organization', {
      organizationSlug: normalizedInput.organizationSlug,
      region: normalizedInput.region
    });
    await validateSupabaseOrganization(personalAccessToken, normalizedInput.organizationSlug);

    logRemoteSetupStep('lookup existing project', {
      organizationSlug: normalizedInput.organizationSlug
    });
    const existingProject = await getExistingVelocaProject(personalAccessToken, normalizedInput.organizationSlug);
    let project = existingProject;

    if (!project) {
      const regionSelection = getRegionSelection(normalizedInput.region);
      logRemoteSetupStep('create project', {
        organizationSlug: normalizedInput.organizationSlug,
        region: regionSelection.code,
        regionSelectionType: regionSelection.type
      });
      project = await createVelocaProject(
        personalAccessToken,
        normalizedInput.organizationSlug,
        regionSelection,
        databasePassword
      );
    } else {
      logRemoteSetupStep('reuse existing project', {
        projectRef: project.ref ?? null
      });
    }

    updateRemoteConfigStatus('waiting');

    logRemoteSetupStep('wait for project ready', {
      projectRef: project.ref ?? null
    });
    const readyProject = await waitForProjectReady(personalAccessToken, project);

    logRemoteSetupStep('initialize remote schema', {
      projectRef: readyProject.ref ?? null
    });
    await initializeRemoteSchema(readyProject, databasePassword);

    logRemoteSetupStep('load api keys', {
      projectRef: readyProject.ref ?? null
    });
    const apiKeys = await getProjectApiKeys(personalAccessToken, readyProject.ref ?? '');
    const projectUrl = `https://${readyProject.ref}.supabase.co`;
    await testRemoteSupabaseClient(projectUrl, apiKeys.secretKey);
    updateRemoteProjectDetails(
      readyProject,
      normalizedInput.organizationSlug,
      normalizedInput.region,
      apiKeys.publishableKey,
      apiKeys.secretKey
    );

    return {
      config: getRemoteDatabaseConfig(),
      reusedExistingProject: Boolean(existingProject)
    };
  } catch (error) {
    const message = getRemoteSetupErrorMessage(error);
    logRemoteSetupStep('setup failed', {
      error: message
    });
    updateRemoteConfigStatus('failed', message);
    throw new Error(message);
  }
}

export async function testRemoteDatabaseConnection(): Promise<RemoteDatabaseConfigView> {
  const row = getRemoteConfigRow();

  if (!row?.project_url) {
    throw new Error('Remote Supabase project is not configured.');
  }

  const secretKey = decryptCredential(row.encrypted_secret_key);

  if (!secretKey) {
    throw new Error('Supabase secret key is not available for connection testing.');
  }

  await testRemoteSupabaseClient(row.project_url, secretKey);
  updateRemoteConfigStatus('initialized');

  return getRemoteDatabaseConfig();
}
