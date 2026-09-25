import { agentsRepo } from '../repositories/agentsRepo';

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SHA_DIGEST_RE = /sha256:([a-f0-9]{20,})/gi;
const RAW_DIGEST_RE = /\b([a-f0-9]{64})\b/gi;

export function agentNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of agentsRepo.list()) map.set(a.id, a.name);
  return map;
}

export function resolveAgentName(
  agentId: string | null | undefined,
  names?: Map<string, string>,
): string | null {
  if (!agentId) return null;
  const map = names || agentNameMap();
  return map.get(agentId) || null;
}

/** Texto para humanos: UUIDs de agentes → nome; digests longos → forma curta. */
export function humanizeDisplayText(
  message: string | null | undefined,
  names?: Map<string, string>,
): string {
  if (!message) return '';
  const map = names || agentNameMap();
  let out = message.replace(UUID_RE, (id) => {
    const name = map.get(id);
    return name || `${id.slice(0, 8)}…`;
  });
  out = out.replace(SHA_DIGEST_RE, (_, hex: string) => `sha256:${hex.slice(0, 12)}…`);
  out = out.replace(RAW_DIGEST_RE, (hex) => `${hex.slice(0, 12)}…`);
  return out;
}

/** Omitir digests crus na meta da UI (não são legíveis). */
export function displayImageLabel(image: string | null | undefined): string | null {
  if (!image) return null;
  const v = String(image).trim();
  if (!v) return null;
  if (/^sha256:[a-f0-9]+$/i.test(v) || /^[a-f0-9]{64}$/i.test(v)) return null;
  return v;
}

export function shortDigest(value: string | null | undefined): string {
  if (!value) return '';
  const v = String(value).trim();
  const m = v.match(/^sha256:([a-f0-9]+)$/i);
  if (m) return `sha256:${m[1].slice(0, 12)}…`;
  if (/^[a-f0-9]{40,}$/i.test(v)) return `${v.slice(0, 12)}…`;
  return v;
}
