export type ChangelogEntry = {
  version: string;
  date?: string | null;
  title?: string;
  items: string[];
};

export type ChangelogFile = {
  versions: ChangelogEntry[];
};

/** Parse a semver-ish string into [major, minor, patch]. Strips leading V/v and pre-release. */
export function parseSemverParts(version: string): [number, number, number] {
  const cleaned = String(version || '')
    .replace(/^v/i, '')
    .split('-')[0]
    .trim();
  const parts = cleaned.split('.').map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function normalizeVersion(version: string | null | undefined): string | null {
  if (version == null) return null;
  const trimmed = String(version).replace(/^v/i, '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Filter changelog entries for the What’s New UI.
 * - full=true: all entries with version <= currentVersion
 * - otherwise: since < version <= currentVersion
 *   (null/empty since → all entries <= current, for first-time users)
 */
export function filterChangelogEntries(
  versions: ChangelogEntry[],
  currentVersion: string,
  options: { since?: string | null; full?: boolean } = {},
): ChangelogEntry[] {
  const current = normalizeVersion(currentVersion);
  if (!current) return [];

  const since = options.full ? null : normalizeVersion(options.since ?? null);
  const sorted = [...versions].sort((a, b) => compareSemver(a.version, b.version));

  return sorted.filter((entry) => {
    const v = normalizeVersion(entry.version);
    if (!v) return false;
    if (compareSemver(v, current) > 0) return false;
    if (since != null && compareSemver(v, since) <= 0) return false;
    return true;
  });
}
