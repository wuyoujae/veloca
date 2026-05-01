import { app, net } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const githubOwner = 'wuyoujae';
const githubRepo = 'veloca';
const githubRepositoryUrl = `https://github.com/${githubOwner}/${githubRepo}`;

export interface AppInfo {
  githubUrl: string;
  license: string;
  logoDataUrl: string;
  name: string;
  version: string;
}

export interface OpenSourceComponent {
  homepage: string;
  license: string;
  name: string;
  repositoryUrl: string;
  version: string;
}

export interface UpdateCheckResult {
  checkedAt: number;
  currentVersion: string;
  errorMessage?: string;
  hasUpdate: boolean;
  latestVersion: string | null;
  publishedAt: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  status: 'available' | 'current' | 'unavailable';
}

interface PackageJson {
  dependencies?: Record<string, string>;
  homepage?: string;
  license?: unknown;
  licenses?: unknown;
  name?: string;
  productName?: string;
  repository?: string | { type?: string; url?: string };
  version?: string;
}

interface GitHubReleaseResponse {
  html_url?: string;
  name?: string | null;
  published_at?: string | null;
  tag_name?: string;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function getRootPackageJson(): PackageJson {
  return readJsonFile<PackageJson>(join(app.getAppPath(), 'package.json')) ?? {};
}

function getLogoDataUrl(): string {
  const logoPaths = [
    join(app.getAppPath(), 'resources', 'logo.svg'),
    join(process.cwd(), 'resources', 'logo.svg')
  ];
  const logoPath = logoPaths.find((candidate) => existsSync(candidate));

  if (!logoPath) {
    return '';
  }

  try {
    const logo = readFileSync(logoPath);
    return `data:image/svg+xml;base64,${logo.toString('base64')}`;
  } catch {
    return '';
  }
}

export function getAppInfo(): AppInfo {
  const packageJson = getRootPackageJson();

  return {
    githubUrl: githubRepositoryUrl,
    license: typeof packageJson.license === 'string' ? packageJson.license : 'MIT',
    logoDataUrl: getLogoDataUrl(),
    name: packageJson.productName ?? 'Veloca',
    version: app.getVersion() || packageJson.version || '0.0.0'
  };
}

function normalizeVersion(version: string | null | undefined): number[] {
  if (!version) {
    return [0];
  }

  return version
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part.replace(/\D/g, ''), 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left);
  const rightParts = normalizeVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart > rightPart) {
      return 1;
    }

    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = getAppInfo().version;
  const checkedAt = Date.now();

  try {
    const response = await net.fetch(`https://api.github.com/repos/${githubOwner}/${githubRepo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Veloca'
      }
    });

    if (!response.ok) {
      return {
        checkedAt,
        currentVersion,
        errorMessage: response.status === 404 ? 'No published release is available yet.' : 'Unable to inspect releases.',
        hasUpdate: false,
        latestVersion: null,
        publishedAt: null,
        releaseName: null,
        releaseUrl: null,
        status: 'unavailable'
      };
    }

    const release = (await response.json()) as GitHubReleaseResponse;
    const latestVersion = release.tag_name?.replace(/^v/i, '') || null;
    const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

    return {
      checkedAt,
      currentVersion,
      hasUpdate,
      latestVersion,
      publishedAt: release.published_at ?? null,
      releaseName: release.name ?? release.tag_name ?? null,
      releaseUrl: release.html_url ?? githubRepositoryUrl,
      status: hasUpdate ? 'available' : 'current'
    };
  } catch (error) {
    return {
      checkedAt,
      currentVersion,
      errorMessage: error instanceof Error ? error.message : 'Unable to check for updates.',
      hasUpdate: false,
      latestVersion: null,
      publishedAt: null,
      releaseName: null,
      releaseUrl: null,
      status: 'unavailable'
    };
  }
}

function stringifyLicense(packageJson: PackageJson): string {
  if (typeof packageJson.license === 'string') {
    return packageJson.license;
  }

  if (Array.isArray(packageJson.licenses)) {
    return packageJson.licenses
      .map((license) => {
        if (typeof license === 'string') {
          return license;
        }

        if (license && typeof license === 'object' && 'type' in license) {
          return String((license as { type?: unknown }).type ?? '');
        }

        return '';
      })
      .filter(Boolean)
      .join(', ');
  }

  return 'Unknown';
}

function normalizeRepositoryUrl(repository: PackageJson['repository']): string {
  const rawUrl = typeof repository === 'string' ? repository : repository?.url ?? '';

  return rawUrl
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@github.com\//, 'https://github.com/')
    .replace(/^git@github.com:/, 'https://github.com/')
    .replace(/\.git$/, '');
}

function getPackageJsonPath(packageName: string): string | null {
  const packagePathParts = packageName.split('/');
  const packageJsonPaths = [
    join(app.getAppPath(), 'node_modules', ...packagePathParts, 'package.json'),
    join(process.cwd(), 'node_modules', ...packagePathParts, 'package.json')
  ];
  const existingPath = packageJsonPaths.find((candidate) => existsSync(candidate));

  if (existingPath) {
    return existingPath;
  }

  try {
    return require.resolve(`${packageName}/package.json`, {
      paths: [app.getAppPath(), process.cwd()]
    });
  } catch {
    return null;
  }
}

export function listOpenSourceComponents(): OpenSourceComponent[] {
  const rootPackageJson = getRootPackageJson();
  const queue = Object.keys(rootPackageJson.dependencies ?? {});
  const visited = new Set<string>();
  const components: OpenSourceComponent[] = [];

  while (queue.length > 0) {
    const packageName = queue.shift();

    if (!packageName || visited.has(packageName)) {
      continue;
    }

    visited.add(packageName);

    const packageJsonPath = getPackageJsonPath(packageName);
    const packageJson = packageJsonPath ? readJsonFile<PackageJson>(packageJsonPath) : null;

    if (!packageJson) {
      continue;
    }

    components.push({
      homepage: packageJson.homepage ?? '',
      license: stringifyLicense(packageJson),
      name: packageJson.name ?? packageName,
      repositoryUrl: normalizeRepositoryUrl(packageJson.repository),
      version: packageJson.version ?? ''
    });

    for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
      if (!visited.has(dependencyName)) {
        queue.push(dependencyName);
      }
    }
  }

  return components.sort((left, right) => left.name.localeCompare(right.name));
}
