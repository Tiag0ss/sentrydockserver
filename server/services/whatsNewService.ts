import fs from 'fs';
import path from 'path';
import { usersRepo } from '../repositories/usersRepo';
import logger from '../utils/logger';
import {
  type ChangelogEntry,
  type ChangelogFile,
  filterChangelogEntries,
  normalizeVersion,
} from './changelogFilter';

let cachedChangelog: ChangelogFile | null = null;
let cachedPackageVersion: string | null = null;

function resolveChangelogPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'docs/whats-new/changelog.json'),
    path.join(__dirname, '../../docs/whats-new/changelog.json'),
    path.join(__dirname, '../../../docs/whats-new/changelog.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolvePackageJsonPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'package.json'),
    path.join(__dirname, '../../package.json'),
    path.join(__dirname, '../../../package.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function loadChangelogFile(): ChangelogFile {
  if (cachedChangelog) return cachedChangelog;
  const filePath = resolveChangelogPath();
  if (!filePath) {
    logger.warn('What’s New changelog.json not found');
    cachedChangelog = { versions: [] };
    return cachedChangelog;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ChangelogFile;
    cachedChangelog = {
      versions: Array.isArray(parsed?.versions) ? parsed.versions : [],
    };
  } catch (err) {
    logger.error('Failed to parse What’s New changelog.json', {
      err: err instanceof Error ? err.message : String(err),
    });
    cachedChangelog = { versions: [] };
  }
  return cachedChangelog;
}

export function getCurrentAppVersion(): string {
  if (cachedPackageVersion) return cachedPackageVersion;
  const filePath = resolvePackageJsonPath();
  if (!filePath) {
    cachedPackageVersion = '0.0.0';
    return cachedPackageVersion;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { version?: string };
    cachedPackageVersion = normalizeVersion(pkg.version) || '0.0.0';
  } catch (err) {
    logger.error('Failed to read package.json version for What’s New', {
      err: err instanceof Error ? err.message : String(err),
    });
    cachedPackageVersion = '0.0.0';
  }
  return cachedPackageVersion;
}

/** Test helper — clear in-memory caches. */
export function resetWhatsNewCaches(): void {
  cachedChangelog = null;
  cachedPackageVersion = null;
}

export function getUserLastSeenAppVersion(userId: string): string | null {
  return normalizeVersion(usersRepo.getLastSeenAppVersion(userId));
}

export function setUserLastSeenAppVersion(userId: string, version: string): string {
  const normalized = normalizeVersion(version);
  if (!normalized) throw new Error('Invalid app version');
  usersRepo.setLastSeenAppVersion(userId, normalized);
  return normalized;
}

function buildEntries(
  full: boolean,
  lastSeenAppVersion: string | null,
  sinceQuery: string | null,
): ChangelogEntry[] {
  const currentVersion = getCurrentAppVersion();
  const changelog = loadChangelogFile();
  if (full) {
    return filterChangelogEntries(changelog.versions, currentVersion, { full: true });
  }
  const since = sinceQuery != null ? sinceQuery : lastSeenAppVersion;
  return filterChangelogEntries(changelog.versions, currentVersion, { since, full: false });
}

export function getWhatsNewForUser(
  userId: string,
  opts: { full?: boolean; since?: string | null } = {},
) {
  const full = Boolean(opts.full);
  const sinceQuery = normalizeVersion(opts.since);
  const lastSeenAppVersion = getUserLastSeenAppVersion(userId);
  const currentVersion = getCurrentAppVersion();
  const entries = buildEntries(full, lastSeenAppVersion, sinceQuery);
  return { currentVersion, lastSeenAppVersion, entries };
}

export function markWhatsNewSeen(userId: string) {
  const currentVersion = getCurrentAppVersion();
  const lastSeenAppVersion = setUserLastSeenAppVersion(userId, currentVersion);
  return { lastSeenAppVersion };
}
