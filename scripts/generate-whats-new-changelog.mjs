#!/usr/bin/env node
/**
 * Merge package.json version bumps into docs/whats-new/changelog.json
 * without overwriting the hand-authored 0.1.0 block.
 *
 * Git root is this package (SentryDockServer). Source of truth is package.json
 * version bumps in git — not invented feature lists.
 *
 * Usage: node scripts/generate-whats-new-changelog.mjs [--keep-curated]
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CHANGELOG_PATH = path.join(ROOT, 'docs/whats-new/changelog.json');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const BASELINE = '0.1.0';
const PACKAGE_GIT_PATH = 'package.json';
const MAX_SUBJECTS = 100;
const KEEP_CURATED = process.argv.includes('--keep-curated');

function findGitRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    try {
      return execSync('git rev-parse --show-toplevel', {
        cwd: path.join(ROOT, '..'),
        encoding: 'utf8',
      }).trim();
    } catch {
      return ROOT;
    }
  }
}

const GIT_ROOT = findGitRoot();

function run(cmd) {
  try {
    return execSync(cmd, { cwd: GIT_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function parseSemverParts(version) {
  const cleaned = String(version || '').replace(/^v/i, '').split('-')[0];
  const parts = cleaned.split('.').map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareSemver(a, b) {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function normalizeVersion(raw) {
  return String(raw || '').replace(/^v/i, '').trim();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function loadChangelog() {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    return { versions: [] };
  }
  return JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
}

function packageJsonGitPath() {
  const fromServer = run(`git ls-files -- ${PACKAGE_GIT_PATH}`);
  if (fromServer) return PACKAGE_GIT_PATH;
  const local = run('git ls-files -- package.json');
  if (local.split('\n').includes('package.json')) return 'package.json';
  return PACKAGE_GIT_PATH;
}

function packageJsonVersionTimeline() {
  const tracked = packageJsonGitPath();
  const log = run(`git log --reverse --format=%H%x09%ci%x09%s -- ${tracked}`);
  if (!log) return [];

  const rows = [];
  for (const line of log.split('\n')) {
    const [hash, date, ...subjectParts] = line.split('\t');
    const subject = subjectParts.join('\t');
    if (!hash) continue;

    let version = null;
    try {
      const pkg = JSON.parse(run(`git show ${hash}:${tracked}`));
      version = normalizeVersion(pkg.version);
    } catch {
      continue;
    }
    if (!version) continue;

    rows.push({
      version,
      date: String(date || '').slice(0, 10),
      hash,
      subject,
    });
  }
  return rows;
}

function collectVersionIntroductions() {
  const timeline = packageJsonVersionTimeline();
  const introductions = [];
  let previous = null;

  for (const row of timeline) {
    if (previous === row.version) continue;
    introductions.push(row);
    previous = row.version;
  }

  const byVersion = new Map();
  for (const intro of introductions) {
    if (!byVersion.has(intro.version)) {
      byVersion.set(intro.version, intro);
    }
  }

  return [...byVersion.values()].sort((a, b) => compareSemver(a.version, b.version));
}

function ensureWorkingTreeVersion(intros, currentVersion) {
  if (!currentVersion) return intros;
  if (intros.some((b) => b.version === currentVersion)) return intros;

  return [
    ...intros,
    {
      version: currentVersion,
      date: todayIsoDate(),
      hash: null,
      subject: `Working tree package.json ${currentVersion}`,
      workingTree: true,
    },
  ].sort((a, b) => compareSemver(a.version, b.version));
}

function subjectsBetween(olderHash, newerRef) {
  if (!newerRef) return [];
  const range = olderHash ? `${olderHash}..${newerRef}` : newerRef;
  const out = run(`git log --format=%s ${range}`);
  if (!out) return [];
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^Update version to /i.test(s))
    .filter((s) => !/^Bump version to /i.test(s))
    .slice(0, MAX_SUBJECTS);
}

function summarizeItems(subjects) {
  if (subjects.length === 0) {
    return ['Maintenance and stability updates'];
  }
  return subjects.map((s) => s.replace(/\.$/, ''));
}

function defaultTitle(version, existingTitle, subjects) {
  if (
    existingTitle
    && existingTitle.trim()
    && !/^Version\s+/i.test(existingTitle)
  ) {
    return existingTitle;
  }
  const first = (subjects && subjects[0]) || '';
  if (first.length > 0 && first.length <= 72) return first;
  if (first.length > 72) return `${first.slice(0, 69)}…`;
  return `Release ${version}`;
}

function main() {
  const existing = loadChangelog();
  const byVersion = new Map(
    (existing.versions || []).map((entry) => [normalizeVersion(entry.version), entry]),
  );

  const baseline = byVersion.get(BASELINE);
  if (!baseline) {
    console.error(`Missing hand-authored ${BASELINE} entry in changelog.json — aborting.`);
    process.exit(1);
  }

  const currentVersion = normalizeVersion(
    JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8')).version,
  );

  let intros = collectVersionIntroductions();
  intros = ensureWorkingTreeVersion(intros, currentVersion);

  const head = run('git rev-parse HEAD') || null;
  let rebuilt = 0;
  let kept = 0;

  for (let i = 0; i < intros.length; i += 1) {
    const intro = intros[i];
    if (compareSemver(intro.version, BASELINE) <= 0) continue;
    if (compareSemver(intro.version, currentVersion) > 0) continue;

    const existingEntry = byVersion.get(intro.version);
    const isCurrent = intro.version === currentVersion;
    if (
      KEEP_CURATED
      && !isCurrent
      && existingEntry
      && Array.isArray(existingEntry.items)
      && existingEntry.items.length > 0
    ) {
      if (!existingEntry.date && intro.date) existingEntry.date = intro.date;
      kept += 1;
      continue;
    }

    const older = intros[i - 1];
    const newerRef = isCurrent ? head || intro.hash : intro.hash;
    const subjects = subjectsBetween(older?.hash || null, newerRef);
    byVersion.set(intro.version, {
      version: intro.version,
      date: intro.date || existingEntry?.date || todayIsoDate(),
      title: defaultTitle(intro.version, existingEntry?.title, subjects),
      items: summarizeItems(subjects),
    });
    rebuilt += 1;
  }

  for (const key of [...byVersion.keys()]) {
    if (key === BASELINE) continue;
    if (compareSemver(key, BASELINE) < 0 || compareSemver(key, currentVersion) > 0) {
      byVersion.delete(key);
    }
  }

  const versions = [...byVersion.values()]
    .filter((entry) => compareSemver(entry.version, BASELINE) >= 0)
    .filter((entry) => compareSemver(entry.version, currentVersion) <= 0)
    .sort((a, b) => compareSemver(a.version, b.version));
  const idx = versions.findIndex((v) => v.version === BASELINE);
  if (idx >= 0) versions[idx] = baseline;

  const payload = { versions };
  fs.mkdirSync(path.dirname(CHANGELOG_PATH), { recursive: true });
  fs.writeFileSync(CHANGELOG_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const current = versions.find((v) => v.version === currentVersion);
  console.log(
    `Wrote ${CHANGELOG_PATH} (${versions.length} versions, package.json=${currentVersion})`,
  );
  console.log(
    KEEP_CURATED
      ? `Rebuilt ${rebuilt} version(s), kept curated ${kept}`
      : `Rebuilt ${rebuilt} version(s) from git (${BASELINE} preserved)`,
  );
  if (current) {
    console.log(`Current ${currentVersion}: ${current.items.length} item(s)`);
  }
}

main();
