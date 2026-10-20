import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  filterChangelogEntries,
  normalizeVersion,
  parseSemverParts,
  type ChangelogEntry,
} from './changelogFilter';

const SAMPLE: ChangelogEntry[] = [
  { version: '0.2.0', title: 'Baseline', items: ['a'] },
  { version: '0.2.1', title: 'Patch', items: ['b'] },
  { version: '0.2.2', title: 'Current', items: ['c'] },
  { version: '0.3.0', title: 'Future', items: ['d'] },
];

describe('changelogFilter', () => {
  it('parses and strips V prefix', () => {
    expect(parseSemverParts('V0.2.2')).toEqual([0, 2, 2]);
    expect(parseSemverParts('0.2.0-beta')).toEqual([0, 2, 0]);
  });

  it('compares semver', () => {
    expect(compareSemver('0.2.0', '0.2.1')).toBeLessThan(0);
    expect(compareSemver('0.2.2', '0.2.1')).toBeGreaterThan(0);
  });

  it('normalizes versions', () => {
    expect(normalizeVersion('V0.2.2')).toBe('0.2.2');
    expect(normalizeVersion('')).toBeNull();
  });

  it('filters full history up to current', () => {
    const entries = filterChangelogEntries(SAMPLE, '0.2.2', { full: true });
    expect(entries.map((e) => e.version)).toEqual(['0.2.0', '0.2.1', '0.2.2']);
  });

  it('filters delta since last seen', () => {
    const entries = filterChangelogEntries(SAMPLE, '0.2.2', { since: '0.2.0' });
    expect(entries.map((e) => e.version)).toEqual(['0.2.1', '0.2.2']);
  });

  it('returns empty when already on current', () => {
    expect(filterChangelogEntries(SAMPLE, '0.2.2', { since: '0.2.2' })).toEqual([]);
  });
});
