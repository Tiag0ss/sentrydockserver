'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import {
  PageHeader, Panel, EmptyState, Alert, Input, Select, Field, Button,
} from '@/components/ui';
import { CollapsibleFilterPanel } from '@/components/CollapsibleFilterPanel';
import { IconButton, IconRefresh, IconOpen } from '@/components/IconActions';

type LogItem = {
  id: string;
  ts: string | Date;
  actor: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  flowRunId: string | null;
  flowId: string | null;
  flowName: string | null;
  payload: unknown;
  summary: string | null;
  level: 'ok' | 'warn' | 'danger' | 'info';
};

type LogsResponse = {
  items: LogItem[];
  facets: { actions: string[]; actors: string[]; entities: string[] };
};

function levelColor(level: LogItem['level']): string {
  if (level === 'danger') return 'var(--sd-danger)';
  if (level === 'warn') return 'var(--sd-warn)';
  if (level === 'ok') return 'var(--sd-ok)';
  return 'var(--sd-accent)';
}

function actionLabel(t: (k: string) => string, action: string): string {
  const key = `logActions.${action.replace(/\./g, '_')}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return action.replace(/[._]/g, ' ');
}

function shortId(id: string | null | undefined): string {
  if (!id) return '';
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function payloadPreview(payload: unknown): string {
  if (payload == null) return '';
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export default function LogsPage() {
  const { t, formatDate } = useI18n();
  const [items, setItems] = useState<LogItem[]>([]);
  const [facets, setFacets] = useState<LogsResponse['facets']>({ actions: [], actors: [], entities: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [q, setQ] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [entity, setEntity] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '300');
      if (q.trim()) params.set('q', q.trim());
      if (action) params.set('action', action);
      if (actor) params.set('actor', actor);
      if (entity) params.set('entity', entity);
      const data = await api<LogsResponse>(`/logs?${params.toString()}`);
      setItems(data.items || []);
      setFacets(data.facets || { actions: [], actors: [], entities: [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [q, action, actor, entity, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => setQ(qDraft), 280);
    return () => clearTimeout(timer);
  }, [qDraft]);

  const hasFilters = Boolean(q || action || actor || entity);
  const activeFilterCount = [q, action, actor, entity].filter(Boolean).length;

  const counts = useMemo(() => ({
    total: items.length,
    danger: items.filter((i) => i.level === 'danger').length,
    warn: items.filter((i) => i.level === 'warn').length,
  }), [items]);

  function clearFilters() {
    setQDraft('');
    setQ('');
    setAction('');
    setActor('');
    setEntity('');
  }

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('logs.title')}
        subtitle={t('logs.subtitle')}
        actions={(
          <IconButton label={t('logs.refresh')} onClick={() => { void load(); }}>
            <IconRefresh />
          </IconButton>
        )}
      />

      <CollapsibleFilterPanel
        className="sd-logs-filters"
        activeCount={activeFilterCount}
        onClear={clearFilters}
        clearLabel={t('logs.clearFilters')}
        headerExtra={(
          <span className="sd-entity-muted" style={{ fontSize: 12 }}>
            {loading ? t('common.loading') : t('logs.resultCount', { count: String(counts.total) })}
            {!loading && counts.danger > 0 ? ` · ${t('logs.dangerCount', { count: String(counts.danger) })}` : ''}
          </span>
        )}
      >
        <div className="sd-form-row">
          <Field label={t('logs.search')}>
            <Input
              value={qDraft}
              placeholder={t('logs.searchPlaceholder')}
              onChange={(e) => setQDraft(e.target.value)}
            />
          </Field>
          <Field label={t('logs.action')}>
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">{t('logs.allActions')}</option>
              {facets.actions.map((a) => (
                <option key={a} value={a}>{actionLabel(t, a)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('logs.actor')}>
            <Select value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">{t('logs.allActors')}</option>
              {facets.actors.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('logs.entity')}>
            <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">{t('logs.allEntities')}</option>
              {facets.entities.map((e) => (
                <option key={e} value={e}>{tt(t, 'logEntities', e) || e}</option>
              ))}
            </Select>
          </Field>
        </div>
      </CollapsibleFilterPanel>

      {error ? <Alert>{error}</Alert> : null}

      {!loading && items.length === 0 ? (
        <EmptyState>{hasFilters ? t('logs.emptyFiltered') : t('logs.empty')}</EmptyState>
      ) : (
        <div className="sd-entity-list">
          {items.map((l) => {
            const open = Boolean(expanded[l.id]);
            const label = actionLabel(t, l.action);
            return (
              <Panel key={l.id} className={`sd-entity-card sd-log-card sd-log-${l.level}`}>
                <div className="sd-entity-item">
                  <span
                    className="sd-entity-dot"
                    style={{ background: levelColor(l.level) }}
                    aria-hidden
                  />
                  <div className="sd-entity-main">
                    <div className="sd-entity-top">
                      <strong className="sd-entity-name">{label}</strong>
                      <span className="sd-entity-badge" style={{ color: levelColor(l.level) }}>
                        {l.actor}
                      </span>
                    </div>
                    {l.summary ? (
                      <div className="sd-log-summary">{l.summary}</div>
                    ) : null}
                    <div className="sd-entity-meta sd-entity-meta-wrap">
                      {formatDate(l.ts)}
                      {l.entity ? (
                        <>
                          {' · '}
                          <span>{tt(t, 'logEntities', l.entity) || l.entity}</span>
                          {l.entityId ? <code className="sd-log-id"> {shortId(l.entityId)}</code> : null}
                        </>
                      ) : null}
                      {l.flowName ? <> · {l.flowName}</> : null}
                      {l.flowRunId ? (
                        <>
                          {' · '}
                          <Link href={`/runs/${l.flowRunId}`} className="sd-entity-link">
                            {t('logs.openRun')} {shortId(l.flowRunId)}
                          </Link>
                        </>
                      ) : null}
                    </div>
                    {open && l.payload != null ? (
                      <pre className="sd-log-payload">{payloadPreview(l.payload)}</pre>
                    ) : null}
                  </div>
                  <div className="sd-entity-actions">
                    {l.payload != null ? (
                      <Button
                        variant="ghost"
                        className="sd-btn-sm"
                        onClick={() => setExpanded((s) => ({ ...s, [l.id]: !open }))}
                      >
                        {open ? t('logs.hidePayload') : t('logs.showPayload')}
                      </Button>
                    ) : null}
                    {l.flowRunId ? (
                      <Link href={`/runs/${l.flowRunId}`} className="sd-icon-btn" title={t('logs.openRun')} aria-label={t('logs.openRun')}>
                        <IconOpen />
                      </Link>
                    ) : null}
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
