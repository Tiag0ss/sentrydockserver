import { and, eq, gte, lte, lt, desc, asc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { db } from '../database/db';
import { containerMetricSamples } from '../database/schema';
import { agentsRepo } from '../repositories/agentsRepo';
import logger from '../utils/logger';

export const DEFAULT_METRICS_INTERVAL_SEC = 30;
export const DEFAULT_METRICS_RETENTION_HOURS = 24;
export const MIN_METRICS_INTERVAL_SEC = 10;
export const MAX_METRICS_INTERVAL_SEC = 300;
export const MIN_METRICS_RETENTION_HOURS = 1;
export const MAX_METRICS_RETENTION_HOURS = 168;

export type MetricsConfig = {
  metricsIntervalSec: number;
  metricsRetentionHours: number;
};

export type MetricsContainerSample = {
  id: string;
  name: string;
  image?: string;
  state?: string;
  status?: string;
  cpuPercent?: number | null;
  memoryUsageBytes?: number | null;
  memoryLimitBytes?: number | null;
  sizeRwBytes?: number | null;
  sizeRootFsBytes?: number | null;
};

export type MetricsBatch = {
  ts?: number;
  containers: MetricsContainerSample[];
};

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function parseMetricsConfig(meta: Record<string, unknown> | null | undefined): MetricsConfig {
  const interval = clamp(
    Number(meta?.metricsIntervalSec),
    MIN_METRICS_INTERVAL_SEC,
    MAX_METRICS_INTERVAL_SEC,
    DEFAULT_METRICS_INTERVAL_SEC,
  );
  const retention = clamp(
    Number(meta?.metricsRetentionHours),
    MIN_METRICS_RETENTION_HOURS,
    MAX_METRICS_RETENTION_HOURS,
    DEFAULT_METRICS_RETENTION_HOURS,
  );
  return { metricsIntervalSec: interval, metricsRetentionHours: retention };
}

export function getAgentMetricsConfig(agentId: string): MetricsConfig {
  const row = agentsRepo.findById(agentId);
  if (!row?.metaJson) return parseMetricsConfig(null);
  try {
    return parseMetricsConfig(JSON.parse(row.metaJson) as Record<string, unknown>);
  } catch {
    return parseMetricsConfig(null);
  }
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function ingestBatch(agentId: string, batch: MetricsBatch): number {
  const ts = Number(batch.ts) || Date.now();
  const containers = Array.isArray(batch.containers) ? batch.containers : [];
  if (!containers.length) return 0;

  const rows = containers
    .filter((c) => c && (c.id || c.name))
    .map((c) => ({
      id: uuid(),
      agentId,
      containerId: String(c.id || c.name),
      containerName: String(c.name || c.id || ''),
      image: c.image != null ? String(c.image) : null,
      state: c.state != null ? String(c.state) : null,
      status: c.status != null ? String(c.status) : null,
      ts,
      cpuPercent: numOrNull(c.cpuPercent),
      memoryUsageBytes: numOrNull(c.memoryUsageBytes) != null
        ? Math.round(numOrNull(c.memoryUsageBytes)!)
        : null,
      memoryLimitBytes: numOrNull(c.memoryLimitBytes) != null
        ? Math.round(numOrNull(c.memoryLimitBytes)!)
        : null,
      sizeRwBytes: numOrNull(c.sizeRwBytes) != null
        ? Math.round(numOrNull(c.sizeRwBytes)!)
        : null,
      sizeRootFsBytes: numOrNull(c.sizeRootFsBytes) != null
        ? Math.round(numOrNull(c.sizeRootFsBytes)!)
        : null,
    }));

  if (!rows.length) return 0;

  const inserted = db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(containerMetricSamples).values(row).run();
    }
    return rows.length;
  });

  try {
    pruneAgent(agentId);
  } catch (err) {
    logger.warn('metrics prune failed', { agentId, err: err instanceof Error ? err.message : String(err) });
  }
  return inserted;
}

export function pruneAgent(agentId: string): number {
  const cfg = getAgentMetricsConfig(agentId);
  const cutoff = Date.now() - cfg.metricsRetentionHours * 3600_000;
  const result = db
    .delete(containerMetricSamples)
    .where(and(eq(containerMetricSamples.agentId, agentId), lt(containerMetricSamples.ts, cutoff)))
    .run();
  return result.changes ?? 0;
}

export function pruneAllAgents(): number {
  let total = 0;
  for (const a of agentsRepo.list()) {
    total += pruneAgent(a.id);
  }
  return total;
}

export function deleteAgentMetrics(agentId: string): number {
  const result = db
    .delete(containerMetricSamples)
    .where(eq(containerMetricSamples.agentId, agentId))
    .run();
  return result.changes ?? 0;
}

export type MetricPoint = {
  ts: number;
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  sizeRwBytes: number | null;
  sizeRootFsBytes: number | null;
};

export type ContainerMetricsView = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  stats: {
    cpuPercent: number | null;
    memoryUsageBytes: number | null;
    memoryLimitBytes: number | null;
    sizeRwBytes: number | null;
    sizeRootFsBytes: number | null;
  };
  series: MetricPoint[];
};

export function getAgentMetrics(
  agentId: string,
  opts?: { from?: number; to?: number; maxPointsPerContainer?: number },
): {
  config: MetricsConfig;
  containers: ContainerMetricsView[];
  from: number;
  to: number;
} {
  const cfg = getAgentMetricsConfig(agentId);
  const to = opts?.to && Number.isFinite(opts.to) ? opts.to : Date.now();
  const retentionMs = cfg.metricsRetentionHours * 3600_000;
  const from = opts?.from && Number.isFinite(opts.from)
    ? opts.from
    : to - Math.min(retentionMs, 6 * 3600_000);
  const maxPoints = opts?.maxPointsPerContainer ?? 180;

  const rows = db
    .select()
    .from(containerMetricSamples)
    .where(and(
      eq(containerMetricSamples.agentId, agentId),
      gte(containerMetricSamples.ts, from),
      lte(containerMetricSamples.ts, to),
    ))
    .orderBy(asc(containerMetricSamples.ts))
    .all();

  const byContainer = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byContainer.get(r.containerId) || [];
    list.push(r);
    byContainer.set(r.containerId, list);
  }

  // Also pick up latest-known containers that may have fallen outside the window
  // by merging with the absolute latest sample per container_id.
  const latestRows = db
    .select()
    .from(containerMetricSamples)
    .where(eq(containerMetricSamples.agentId, agentId))
    .orderBy(desc(containerMetricSamples.ts))
    .all();

  const seenLatest = new Set<string>();
  for (const r of latestRows) {
    if (seenLatest.has(r.containerId)) continue;
    seenLatest.add(r.containerId);
    if (!byContainer.has(r.containerId)) {
      byContainer.set(r.containerId, [r]);
    }
  }

  const containers: ContainerMetricsView[] = [];
  for (const [cid, list] of byContainer) {
    const decimated = decimate(list, maxPoints);
    const last = list[list.length - 1];
    containers.push({
      id: cid,
      name: last.containerName || cid,
      image: last.image || '',
      state: last.state || '',
      status: last.status || '',
      stats: {
        cpuPercent: last.cpuPercent ?? null,
        memoryUsageBytes: last.memoryUsageBytes ?? null,
        memoryLimitBytes: last.memoryLimitBytes ?? null,
        sizeRwBytes: last.sizeRwBytes ?? null,
        sizeRootFsBytes: last.sizeRootFsBytes ?? null,
      },
      series: decimated.map((p) => ({
        ts: p.ts,
        cpuPercent: p.cpuPercent ?? null,
        memoryUsageBytes: p.memoryUsageBytes ?? null,
        memoryLimitBytes: p.memoryLimitBytes ?? null,
        sizeRwBytes: p.sizeRwBytes ?? null,
        sizeRootFsBytes: p.sizeRootFsBytes ?? null,
      })),
    });
  }

  containers.sort((a, b) => a.name.localeCompare(b.name));

  return { config: cfg, containers, from, to };
}

function decimate<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) {
    out.push(arr[Math.round(i * step)]);
  }
  return out;
}

/** Start periodic prune (hourly). */
export function startMetricsPruneLoop() {
  setInterval(() => {
    try {
      const n = pruneAllAgents();
      if (n > 0) logger.info('pruned metric samples', { deleted: n });
    } catch (err) {
      logger.warn('metrics prune loop failed', { err: err instanceof Error ? err.message : String(err) });
    }
  }, 3600_000);
}
