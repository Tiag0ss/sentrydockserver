import { createHash } from 'node:crypto';

export type TargetMode = 'follow_tag' | 'pin_tag' | 'semver_range';

export type ImageTargetInput = {
  image: string;
  targetMode?: string | null;
  targetTag?: string | null;
  targetRange?: string | null;
  allowPrerelease?: boolean | null;
};

export type ResolvedImageTarget = {
  mode: TargetMode;
  imageRef: string;
  repo: string;
  selectedTag: string | null;
  targetTag: string | null;
  targetRange: string | null;
};

/** Split `registry/repo:tag` or `repo@sha256:…` into parts. */
export function splitImageRef(image: string): {
  repo: string;
  tag: string | null;
  digest: string | null;
} {
  const raw = String(image || '').trim();
  if (!raw) return { repo: '', tag: null, digest: null };

  const at = raw.lastIndexOf('@');
  if (at > 0) {
    return {
      repo: raw.slice(0, at),
      tag: null,
      digest: raw.slice(at + 1),
    };
  }

  // Tag is after the last ':' that is not part of a host:port (host:port/repo:tag)
  const lastColon = raw.lastIndexOf(':');
  const lastSlash = raw.lastIndexOf('/');
  if (lastColon > lastSlash && lastColon > 0) {
    return {
      repo: raw.slice(0, lastColon),
      tag: raw.slice(lastColon + 1) || null,
      digest: null,
    };
  }
  return { repo: raw, tag: null, digest: null };
}

function normalizeMode(raw: string | null | undefined): TargetMode {
  if (raw === 'pin_tag' || raw === 'semver_range') return raw;
  return 'follow_tag';
}

type SemVer = { major: number; minor: number; patch: number; prerelease: string; raw: string };

function parseSemVer(tag: string): SemVer | null {
  const cleaned = String(tag || '').trim().replace(/^v/i, '');
  const m = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] || '',
    raw: tag,
  };
}

function cmpSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function satisfiesRange(v: SemVer, range: string): boolean {
  const r = String(range || '').trim();
  if (!r) return false;

  const caret = r.match(/^\^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (caret) {
    const base = {
      major: Number(caret[1]),
      minor: Number(caret[2] || 0),
      patch: Number(caret[3] || 0),
      prerelease: '',
      raw: '',
    };
    if (cmpSemVer(v, base) < 0) return false;
    if (base.major === 0) {
      return v.major === 0 && v.minor === base.minor;
    }
    return v.major === base.major;
  }

  const tilde = r.match(/^~(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (tilde) {
    const base = {
      major: Number(tilde[1]),
      minor: Number(tilde[2] || 0),
      patch: Number(tilde[3] || 0),
      prerelease: '',
      raw: '',
    };
    if (cmpSemVer(v, base) < 0) return false;
    return v.major === base.major && v.minor === base.minor;
  }

  // Simple comparators: ">=1.2.0 <2.0.0" or ">=1.2.0"
  const parts = r.split(/\s+/).filter(Boolean);
  if (parts.length && parts.every((p) => /^[<>]=?\d/.test(p) || /^\d+\.\d+/.test(p))) {
    for (const p of parts) {
      const m = p.match(/^(>=|<=|>|<)?(\d+\.\d+\.\d+)/);
      if (!m) return false;
      const op = m[1] || '>=';
      const bound = parseSemVer(m[2]);
      if (!bound) return false;
      const c = cmpSemVer(v, bound);
      if (op === '>=' && c < 0) return false;
      if (op === '>' && c <= 0) return false;
      if (op === '<=' && c > 0) return false;
      if (op === '<' && c >= 0) return false;
    }
    return true;
  }

  // Exact / prefix like "1.2"
  const exact = parseSemVer(r.includes('.') && r.split('.').length === 2 ? `${r}.0` : r);
  if (exact && /^\d+\.\d+$/.test(r)) {
    return v.major === exact.major && v.minor === exact.minor;
  }
  const full = parseSemVer(r);
  if (full) return cmpSemVer(v, full) === 0;
  return false;
}

/** Pick highest semver tag matching range. */
export function pickSemverTag(
  tags: string[],
  range: string,
  allowPrerelease = false,
): string | null {
  const matched = tags
    .map((t) => parseSemVer(t))
    .filter((v): v is SemVer => Boolean(v))
    .filter((v) => (allowPrerelease ? true : !v.prerelease))
    .filter((v) => satisfiesRange(v, range))
    .sort(cmpSemVer);
  return matched.length ? matched[matched.length - 1]!.raw : null;
}

export function buildImageRef(repo: string, tagOrDigest: string): string {
  const t = String(tagOrDigest || '').trim();
  if (!repo) return t;
  if (/^sha256:[a-f0-9]{64}$/i.test(t)) return `${repo}@${t}`;
  if (t.startsWith('sha256:')) return `${repo}@${t}`;
  return `${repo}:${t}`;
}

/**
 * Resolve the image ref to pull/compare from node + runtime context.
 * For semver_range, `listTags` must be provided.
 */
export async function resolveDesiredImageRef(
  input: ImageTargetInput,
  listTags?: () => Promise<string[]>,
): Promise<ResolvedImageTarget> {
  const mode = normalizeMode(input.targetMode);
  const image = String(input.image || '').trim();
  const { repo, tag, digest } = splitImageRef(image);
  const targetTag = input.targetTag != null ? String(input.targetTag).trim() : '';
  const targetRange = input.targetRange != null ? String(input.targetRange).trim() : '';

  if (mode === 'follow_tag') {
    const follow = targetTag || tag || digest || 'latest';
    if (!repo) throw new Error('follow_tag requires image repo');
    const imageRef = buildImageRef(repo, follow);
    return {
      mode,
      imageRef,
      repo,
      selectedTag: follow,
      targetTag: follow,
      targetRange: null,
    };
  }

  if (mode === 'pin_tag') {
    const pin = targetTag || tag || digest || '';
    if (!pin) throw new Error('pin_tag requires targetTag');
    if (!repo && !pin.includes(':') && !pin.includes('@')) {
      throw new Error('pin_tag requires image repo');
    }
    const imageRef = pin.includes('/') || pin.includes(':') || pin.includes('@')
      ? (/^sha256:/i.test(pin) ? buildImageRef(repo, pin) : pin)
      : buildImageRef(repo, pin);
    return {
      mode,
      imageRef,
      repo: splitImageRef(imageRef).repo || repo,
      selectedTag: pin,
      targetTag: pin,
      targetRange: null,
    };
  }

  // semver_range
  if (!targetRange) throw new Error('semver_range requires targetRange');
  if (!repo) throw new Error('semver_range requires image repo');
  if (!listTags) throw new Error('semver_range requires listTags');
  const tags = await listTags();
  const picked = pickSemverTag(tags, targetRange, Boolean(input.allowPrerelease));
  if (!picked) {
    throw new Error(`No tag matches semver range ${targetRange}`);
  }
  return {
    mode,
    imageRef: buildImageRef(repo, picked),
    repo,
    selectedTag: picked,
    targetTag: null,
    targetRange,
  };
}

/** Merge node data with runtime ctx overrides (ctx wins). */
export function targetInputFromNodeAndCtx(
  nodeData: Record<string, unknown>,
  ctx: Record<string, unknown>,
): ImageTargetInput {
  return {
    image: String(nodeData.image || ctx.image || ''),
    targetMode: String(ctx.targetMode || nodeData.targetMode || 'follow_tag'),
    targetTag: (ctx.targetTag ?? nodeData.targetTag) != null
      ? String(ctx.targetTag ?? nodeData.targetTag)
      : null,
    targetRange: (ctx.targetRange ?? nodeData.targetRange) != null
      ? String(ctx.targetRange ?? nodeData.targetRange)
      : null,
    allowPrerelease: Boolean(ctx.allowPrerelease ?? nodeData.allowPrerelease),
  };
}

export function hashComposeDesired(yamlText: string, env: Record<string, string>): string {
  const envKeys = Object.keys(env).sort();
  const normalized = JSON.stringify({
    yaml: yamlText.replace(/\r\n/g, '\n'),
    env: Object.fromEntries(envKeys.map((k) => [k, env[k]])),
  });
  return createHash('sha256').update(normalized).digest('hex');
}

export function hashYamlOnly(yamlText: string): string {
  return createHash('sha256').update(String(yamlText || '').replace(/\r\n/g, '\n')).digest('hex');
}
