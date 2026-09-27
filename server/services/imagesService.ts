import { v4 as uuid } from 'uuid';
import { imagesRepo } from '../repositories/imagesRepo';
import { secretsRepo } from '../repositories/secretsRepo';
import { agentsRepo } from '../repositories/agentsRepo';
import { audit } from './audit';
import { getSecretPlain } from './secretsService';
import { agentGateway } from './agentGateway';
import { resolveDesiredImageRef, splitImageRef, type TargetMode } from './imageTarget';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

export type RegistryAuthPayload = {
  username: string;
  password: string;
  serveraddress?: string;
};

export type DockerImageInput = {
  key: string;
  name: string;
  repository: string;
  targetMode?: string;
  targetTag?: string | null;
  targetRange?: string | null;
  allowPrerelease?: boolean;
  secretId?: string | null;
};

function normalizeKey(raw: string): string {
  return String(raw || '').trim().replace(/^SD_IMAGE_/i, '');
}

function assertKey(key: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
    throw new AppError(400, 'key must be alphanumeric/underscore and start with a letter', 'invalid_key');
  }
}

function assertSecret(secretId: string | null | undefined) {
  if (!secretId) return;
  const row = secretsRepo.findById(secretId);
  if (!row) throw new AppError(400, 'secret not found', 'invalid_secret');
  if (row.type !== 'registry_credentials') {
    throw new AppError(400, 'secret must be registry_credentials', 'invalid_secret');
  }
}

function toPublic(row: NonNullable<ReturnType<typeof imagesRepo.findById>>) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    repository: row.repository,
    targetMode: row.targetMode,
    targetTag: row.targetTag,
    targetRange: row.targetRange,
    allowPrerelease: Boolean(row.allowPrerelease),
    secretId: row.secretId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    placeholder: `SD_IMAGE_${row.key}`,
  };
}

export function listDockerImages() {
  return imagesRepo.list().map(toPublic);
}

export function getDockerImage(id: string) {
  const row = imagesRepo.findById(id);
  if (!row) throw new AppError(404, 'image not found', 'not_found');
  return toPublic(row);
}

export function getDockerImageByKey(key: string) {
  const row = imagesRepo.findByKey(normalizeKey(key));
  if (!row) throw new AppError(404, 'image not found', 'not_found');
  return toPublic(row);
}

export async function createDockerImage(input: DockerImageInput, actor: string) {
  const key = normalizeKey(input.key);
  assertKey(key);
  const name = String(input.name || '').trim();
  let repository = String(input.repository || '').trim();
  repository = repository.replace(/[@:].*$/, '');
  if (!name) throw new AppError(400, 'name required', 'validation');
  if (!repository) throw new AppError(400, 'repository required', 'validation');
  if (imagesRepo.findByKey(key)) throw new AppError(409, 'key already exists', 'conflict');
  const secretId = input.secretId ? String(input.secretId) : null;
  assertSecret(secretId);
  const now = new Date();
  const id = uuid();
  const mode = (input.targetMode as TargetMode) || 'follow_tag';
  let targetTag = input.targetTag != null ? String(input.targetTag).trim() || null : null;
  if ((mode === 'follow_tag' || mode === 'pin_tag') && !targetTag) {
    targetTag = mode === 'follow_tag' ? 'latest' : null;
  }
  if (mode === 'pin_tag' && !targetTag) {
    throw new AppError(400, 'targetTag required for pin_tag', 'validation');
  }
  imagesRepo.insert({
    id,
    key,
    name,
    repository,
    targetMode: mode,
    targetTag,
    targetRange: input.targetRange != null ? String(input.targetRange).trim() || null : null,
    allowPrerelease: Boolean(input.allowPrerelease),
    secretId,
    createdAt: now,
    updatedAt: now,
  });
  await audit({ actor, action: 'docker_image.created', entity: 'docker_image', entityId: id });
  return getDockerImage(id);
}

export async function updateDockerImage(id: string, input: Partial<DockerImageInput>, actor: string) {
  const existing = imagesRepo.findById(id);
  if (!existing) throw new AppError(404, 'image not found', 'not_found');
  const key = input.key != null ? normalizeKey(input.key) : existing.key;
  assertKey(key);
  const other = imagesRepo.findByKey(key);
  if (other && other.id !== id) throw new AppError(409, 'key already exists', 'conflict');
  const name = input.name != null ? String(input.name).trim() : existing.name;
  let repository = input.repository != null ? String(input.repository).trim() : existing.repository;
  repository = repository.replace(/[@:].*$/, '');
  if (!name) throw new AppError(400, 'name required', 'validation');
  if (!repository) throw new AppError(400, 'repository required', 'validation');
  const secretId = input.secretId !== undefined
    ? (input.secretId ? String(input.secretId) : null)
    : existing.secretId;
  assertSecret(secretId);
  const targetMode = input.targetMode != null ? String(input.targetMode) : existing.targetMode;
  let targetTag = input.targetTag !== undefined
    ? (input.targetTag != null ? String(input.targetTag).trim() || null : null)
    : existing.targetTag;
  if (targetMode === 'follow_tag' && !targetTag) targetTag = 'latest';
  if (targetMode === 'pin_tag' && !targetTag) {
    throw new AppError(400, 'targetTag required for pin_tag', 'validation');
  }
  imagesRepo.update(id, {
    key,
    name,
    repository,
    targetMode,
    targetTag,
    targetRange: input.targetRange !== undefined
      ? (input.targetRange != null ? String(input.targetRange).trim() || null : null)
      : existing.targetRange,
    allowPrerelease: input.allowPrerelease !== undefined
      ? Boolean(input.allowPrerelease)
      : existing.allowPrerelease,
    secretId,
    updatedAt: new Date(),
  });
  await audit({ actor, action: 'docker_image.updated', entity: 'docker_image', entityId: id });
  return getDockerImage(id);
}

export async function deleteDockerImage(id: string, actor: string) {
  const existing = imagesRepo.findById(id);
  if (!existing) throw new AppError(404, 'image not found', 'not_found');
  imagesRepo.delete(id);
  await audit({ actor, action: 'docker_image.deleted', entity: 'docker_image', entityId: id });
  return { ok: true };
}

export function getRegistryAuth(secretId?: string | null): RegistryAuthPayload | undefined {
  if (!secretId) return undefined;
  const plainStr = getSecretPlain(secretId);
  if (!plainStr) return undefined;
  try {
    const raw = JSON.parse(plainStr) as Record<string, unknown>;
    const username = String(raw.username ?? raw.user ?? '').replace(/\r/g, '').trim();
    let password = String(raw.password ?? raw.token ?? raw.pass ?? '').replace(/\r/g, '').trim();
    if (/^(bearer|basic)\s+/i.test(password)) {
      password = password.replace(/^(bearer|basic)\s+/i, '').trim();
    }
    if (!username || !password) {
      logger.warn('registry secret missing username/password', { secretId });
      return undefined;
    }
    let serveraddress = String(raw.serveraddress ?? raw.server ?? '').replace(/\r/g, '').trim();
    if (!serveraddress
      || /^(docker\.io|index\.docker\.io|registry-1\.docker\.io|hub\.docker\.com)(:|\/|$)/i.test(serveraddress)
      || /^https?:\/\/(docker\.io|index\.docker\.io|registry-1\.docker\.io|hub\.docker\.com)\b/i.test(serveraddress)
    ) {
      serveraddress = 'https://index.docker.io/v1/';
    } else if (!/^https?:\/\//i.test(serveraddress)) {
      serveraddress = `https://${serveraddress}`;
    }
    return { username, password, serveraddress };
  } catch {
    logger.warn('invalid registry secret JSON', { secretId });
    return undefined;
  }
}

/** Find `${SD_IMAGE_key}` / `$SD_IMAGE_key` placeholders in compose YAML. */
export function scanSdImageKeys(yamlText: string): string[] {
  const keys = new Set<string>();
  const re = /\$\{SD_IMAGE_([A-Za-z0-9_]+)\}|\$SD_IMAGE_([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(yamlText))) {
    keys.add(m[1] || m[2]!);
  }
  return [...keys];
}

async function listTagsForRepo(repository: string, secretId: string | null, preferAgentId?: string) {
  const auth = getRegistryAuth(secretId);
  const candidates = preferAgentId
    ? [preferAgentId, ...agentsRepo.list().map((a) => a.id).filter((id) => id !== preferAgentId)]
    : agentsRepo.list().map((a) => a.id);
  for (const agentId of candidates) {
    if (!agentGateway.isOnline(agentId)) continue;
    try {
      const res = await agentGateway.sendCommand(
        agentId,
        'image.listTags',
        { imageRepo: repository, ...(auth ? { auth } : {}) },
        60_000,
      ) as { tags?: string[] };
      return Array.isArray(res.tags) ? res.tags : [];
    } catch (err) {
      logger.warn('listTags via agent failed', {
        agentId,
        repository,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  throw new AppError(503, 'no online agent to list tags', 'no_agent');
}

export async function resolveCatalogImageRef(
  imageIdOrKey: string,
  opts?: { preferAgentId?: string },
): Promise<{
  id: string;
  key: string;
  imageRef: string;
  secretId: string | null;
  mode: string;
}> {
  const byId = imagesRepo.findById(imageIdOrKey);
  const row = byId || imagesRepo.findByKey(normalizeKey(imageIdOrKey));
  if (!row) throw new AppError(404, 'image not found', 'not_found');

  const resolved = await resolveDesiredImageRef(
    {
      image: row.repository,
      targetMode: row.targetMode,
      targetTag: row.targetTag,
      targetRange: row.targetRange,
      allowPrerelease: row.allowPrerelease,
    },
    row.targetMode === 'semver_range'
      ? () => listTagsForRepo(row.repository, row.secretId, opts?.preferAgentId)
      : undefined,
  );

  return {
    id: row.id,
    key: row.key,
    imageRef: resolved.imageRef,
    secretId: row.secretId,
    mode: resolved.mode,
  };
}

/**
 * Verify the catalog image is reachable on the registry (via an online agent).
 * Uses the image's secret when set — same auth path as check/pull.
 */
export async function probeDockerImage(imageId: string): Promise<{
  ok: boolean;
  imageRef: string;
  digest?: string;
  source?: string;
  agentId?: string;
  agentName?: string;
  usedSecret: boolean;
  error?: string;
}> {
  const row = imagesRepo.findById(imageId) || imagesRepo.findByKey(normalizeKey(imageId));
  if (!row) throw new AppError(404, 'image not found', 'not_found');

  let imageRef: string;
  try {
    const resolved = await resolveCatalogImageRef(row.id);
    imageRef = resolved.imageRef;
  } catch (err) {
    return {
      ok: false,
      imageRef: row.repository,
      usedSecret: Boolean(row.secretId),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const auth = getRegistryAuth(row.secretId);
  const agents = agentsRepo.list();
  const online = agents.filter((a) => agentGateway.isOnline(a.id));
  if (!online.length) {
    return {
      ok: false,
      imageRef,
      usedSecret: Boolean(auth),
      error: 'no online agent',
    };
  }

  const errors: string[] = [];
  for (const agent of online) {
    try {
      const res = await agentGateway.sendCommand(
        agent.id,
        'image.digest',
        { image: imageRef, ...(auth ? { auth } : {}) },
        120_000,
      ) as { digest?: string; digests?: string[]; source?: string };
      const digest = String(res.digest || res.digests?.[0] || '').trim();
      if (!digest) {
        errors.push(`${agent.name || agent.id}: empty digest`);
        continue;
      }
      return {
        ok: true,
        imageRef,
        digest,
        source: res.source ? String(res.source) : undefined,
        agentId: agent.id,
        agentName: agent.name,
        usedSecret: Boolean(auth),
      };
    } catch (err) {
      errors.push(`${agent.name || agent.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    ok: false,
    imageRef,
    usedSecret: Boolean(auth),
    error: errors.join(' · ') || 'registry probe failed',
  };
}

/**
 * Resolve SD_IMAGE_* env map + registry auths for a compose YAML on a given agent.
 */
export async function resolveSdImageEnvForYaml(
  yamlText: string,
  preferAgentId?: string,
): Promise<{
  env: Record<string, string>;
  registryAuths: RegistryAuthPayload[];
  missingKeys: string[];
}> {
  const keys = scanSdImageKeys(yamlText);
  const env: Record<string, string> = {};
  const authByServer = new Map<string, RegistryAuthPayload>();
  const missingKeys: string[] = [];

  for (const key of keys) {
    const row = imagesRepo.findByKey(key);
    if (!row) {
      missingKeys.push(key);
      continue;
    }
    const resolved = await resolveCatalogImageRef(row.id, { preferAgentId });
    env[`SD_IMAGE_${key}`] = resolved.imageRef;
    const auth = getRegistryAuth(resolved.secretId);
    if (auth?.username) {
      const server = auth.serveraddress || 'https://index.docker.io/v1/';
      authByServer.set(server, auth);
    }
  }

  return {
    env,
    registryAuths: [...authByServer.values()],
    missingKeys,
  };
}

function repoMatches(a: string, b: string): boolean {
  const ra = splitImageRef(a).repo.toLowerCase();
  const rb = splitImageRef(b).repo.toLowerCase();
  if (!ra || !rb) return false;
  if (ra === rb) return true;
  // docker hub library/foo vs foo
  if (!ra.includes('/') && rb === `library/${ra}`) return true;
  if (!rb.includes('/') && ra === `library/${rb}`) return true;
  return false;
}

/** Running containers across online agents that use this catalog image's repository. */
export async function listRunningContainersForImage(imageId: string) {
  const row = imagesRepo.findById(imageId) || imagesRepo.findByKey(normalizeKey(imageId));
  if (!row) throw new AppError(404, 'image not found', 'not_found');
  const catalogRepo = row.repository;

  type Cont = {
    name: string;
    image: string;
    composeProject?: string | null;
    composeService?: string | null;
  };
  const agentsOut: Array<{
    agentId: string;
    agentName: string;
    online: boolean;
    containers: Cont[];
  }> = [];

  for (const agent of agentsRepo.list()) {
    const online = agentGateway.isOnline(agent.id);
    if (!online) {
      agentsOut.push({
        agentId: agent.id,
        agentName: agent.name,
        online: false,
        containers: [],
      });
      continue;
    }
    try {
      const list = await agentGateway.sendCommand(agent.id, 'docker.list', { all: true }, 60_000) as Array<{
        name?: string;
        names?: string[];
        image?: string;
        configImage?: string;
        composeProject?: string | null;
        composeService?: string | null;
      }>;
      const containers: Cont[] = [];
      for (const c of Array.isArray(list) ? list : []) {
        const name = String(c.name || (c.names?.[0] || '').replace(/^\//, '') || '').trim();
        const image = String(c.configImage || c.image || '').trim();
        if (!name || !image) continue;
        if (!repoMatches(image, catalogRepo)) continue;
        containers.push({
          name,
          image,
          composeProject: c.composeProject || null,
          composeService: c.composeService || null,
        });
      }
      containers.sort((a, b) => a.name.localeCompare(b.name));
      agentsOut.push({
        agentId: agent.id,
        agentName: agent.name,
        online: true,
        containers,
      });
    } catch (err) {
      logger.warn('listRunningContainersForImage agent failed', {
        agentId: agent.id,
        err: err instanceof Error ? err.message : String(err),
      });
      agentsOut.push({
        agentId: agent.id,
        agentName: agent.name,
        online: true,
        containers: [],
      });
    }
  }

  agentsOut.sort((a, b) => a.agentName.localeCompare(b.agentName));
  return {
    imageId: row.id,
    key: row.key,
    repository: row.repository,
    agents: agentsOut,
  };
}

function slugFromRepository(repository: string): string {
  const last = repository.split('/').pop() || repository;
  let key = last.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!key) key = 'image';
  if (!/^[A-Za-z]/.test(key)) key = `img_${key}`;
  return key.slice(0, 64);
}

function uniqueKey(base: string): string {
  if (!imagesRepo.findByKey(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}_${i}`.slice(0, 64);
    if (!imagesRepo.findByKey(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`.slice(0, 64);
}

/**
 * Pull named images from online agents into the catalog.
 * Existing repositories are skipped; new ones use pin_tag (or follow_tag for latest).
 */
export async function syncDockerImagesFromAgents(actor: string, agentIds?: string[]) {
  const targets = (agentIds?.length
    ? agentIds
    : agentsRepo.list().map((a) => a.id)
  ).filter((id) => agentGateway.isOnline(id));

  if (!targets.length) {
    throw new AppError(503, 'no online agents', 'no_agent');
  }

  type LocalImg = { repository: string; tag: string; repoTag: string };
  const byRepo = new Map<string, LocalImg>();
  const agentsQueried: string[] = [];
  const agentErrors: Array<{ agentId: string; error: string }> = [];

  for (const agentId of targets) {
    try {
      const res = await agentGateway.sendCommand(
        agentId,
        'image.listLocal',
        {},
        120_000,
      ) as { images?: LocalImg[] };
      agentsQueried.push(agentId);
      for (const img of res.images || []) {
        const repository = String(img.repository || '').trim();
        const tag = String(img.tag || 'latest').trim() || 'latest';
        if (!repository) continue;
        const prev = byRepo.get(repository);
        // Prefer a non-latest tag when aggregating across agents
        if (!prev || (prev.tag === 'latest' && tag !== 'latest')) {
          byRepo.set(repository, { repository, tag, repoTag: img.repoTag || `${repository}:${tag}` });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('image sync agent failed', { agentId, err: msg });
      agentErrors.push({ agentId, error: msg });
    }
  }

  const existingRepos = new Set(
    imagesRepo.list().map((r) => r.repository.trim().toLowerCase()),
  );

  const created: Array<ReturnType<typeof toPublic>> = [];
  const skipped: string[] = [];

  for (const img of [...byRepo.values()].sort((a, b) => a.repository.localeCompare(b.repository))) {
    if (existingRepos.has(img.repository.toLowerCase())) {
      skipped.push(img.repository);
      continue;
    }
    const key = uniqueKey(slugFromRepository(img.repository));
    const row = await createDockerImage({
      key,
      name: key,
      repository: img.repository,
      targetMode: 'pin_tag',
      targetTag: img.tag || 'latest',
      targetRange: null,
      allowPrerelease: false,
      secretId: null,
    }, actor);
    created.push(row);
    existingRepos.add(img.repository.toLowerCase());
  }

  await audit({
    actor,
    action: 'docker_image.synced',
    entity: 'docker_image',
    payload: {
      agentsQueried,
      created: created.length,
      skipped: skipped.length,
      agentErrors,
    },
  });

  return {
    agentsQueried,
    agentErrors,
    created,
    skipped,
    discovered: byRepo.size,
  };
}
