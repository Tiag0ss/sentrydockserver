'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getNodeOutputs } from './flowConstants';
import { composeNodeMisconfigured, composeNodeMissingPath } from '@/lib/composePath';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';

const portLabel: React.CSSProperties = {
  fontSize: 10,
  lineHeight: 1.2,
  color: 'var(--muted)',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
};

type RunColors = { border: string; background: string; handle: string };

export function FlowCard({ data, selected }: NodeProps) {
  const { t } = useI18n();
  const nodeType = String(data.nodeType || '');
  const outputs = getNodeOutputs(nodeType, data as Record<string, unknown>);
  const multi = outputs.length > 1;
  const outPad = multi ? 120 : 52;
  const minH = Math.max(56, outputs.length * 22 + 28);
  const typeTitle = t(`nodes.${nodeType}`) !== `nodes.${nodeType}`
    ? t(`nodes.${nodeType}`)
    : nodeType;
  const customLabel = String(data.label || '').trim();
  const title = customLabel || typeTitle;

  const runColors = data.runColors as RunColors | undefined;
  const runStatus = data.runStatus ? String(data.runStatus) : null;
  const runError = data.runError ? String(data.runError) : null;
  const isCurrent = Boolean(data.isCurrent);

  const isCompose = nodeType === 'compose_up' || nodeType === 'compose_down';
  const composeBad = isCompose && composeNodeMisconfigured(data as Record<string, unknown>);
  const composeNoPath = isCompose && !composeBad && composeNodeMissingPath(data as Record<string, unknown>);
  const configError = composeBad
    ? t('inspector.composeMissingConfig')
    : composeNoPath
      ? t('inspector.composeMissingPath')
      : null;

  const border = configError && !runColors
    ? 'var(--danger)'
    : (runColors?.border || (selected ? 'var(--accent)' : 'var(--border)'));
  const background = runColors?.background
    || (selected ? '#1e2a44' : 'var(--panel)');
  const handleColor = runColors?.handle || 'var(--accent)';

  return (
    <div style={{
      background,
      border: `2px solid ${border}`,
      borderRadius: 10,
      padding: `10px ${outPad}px 10px 56px`,
      minWidth: multi ? 260 : 180,
      minHeight: minH,
      fontSize: 12,
      position: 'relative',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      boxShadow: isCurrent ? `0 0 0 2px ${border}55` : undefined,
    }}>
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        style={{
          width: 10,
          height: 10,
          border: '2px solid var(--bg)',
          background: '#7aa2f7',
          top: '50%',
        }}
        title={t('flows.input')}
      />
      <span style={{
        ...portLabel,
        position: 'absolute',
        left: 14,
        top: '50%',
        transform: 'translateY(-50%)',
        color: '#7aa2f7',
        fontWeight: 600,
      }}>
        {t('flows.input')}
      </span>

      <div style={{ fontWeight: 600 }}>{title}</div>
      {configError && !runStatus && (
        <div style={{
          marginTop: 4,
          fontSize: 10,
          color: 'var(--danger)',
          maxWidth: 160,
          lineHeight: 1.3,
        }} title={configError}>
          {configError}
        </div>
      )}
      {runStatus && runStatus !== 'pending' && (
        <div style={{
          marginTop: 4,
          fontSize: 11,
          fontWeight: 600,
          color: border,
          textTransform: 'uppercase',
          letterSpacing: 0.3,
        }}>
          {tt(t, 'status', runStatus)}
          {Number(data.runAttempts) > 1 ? ` · ×${String(data.runAttempts)}` : ''}
        </div>
      )}
      {runError && (
        <div style={{
          marginTop: 4,
          fontSize: 10,
          color: 'var(--danger)',
          maxWidth: 160,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }} title={runError}>
          {runError}
        </div>
      )}
      {data.retries != null && Number(data.retries) > 0 && !runStatus && (
        <div style={{ marginTop: 4, color: 'var(--warn)', fontSize: 11 }}>
          {t('flows.retries')}: {String(data.retries)}
        </div>
      )}

      {outputs.map((port, i) => {
        const top = multi
          ? `${((i + 1) / (outputs.length + 1)) * 100}%`
          : '50%';
        const translated = t(`ports.${port.id}`);
        const label = multi
          ? (port.label
            || (translated !== `ports.${port.id}` ? translated : port.id))
          : t('flows.output');
        return (
          <div key={port.id}>
            <span style={{
              ...portLabel,
              position: 'absolute',
              right: 14,
              top,
              transform: 'translateY(-50%)',
              color: handleColor,
              fontWeight: 600,
              maxWidth: multi ? 110 : 44,
              textAlign: 'right',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
            }}>
              {label}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              style={{
                width: 10,
                height: 10,
                border: '2px solid var(--bg)',
                background: handleColor,
                top,
              }}
              title={`${t('flows.output')}: ${label}`}
            />
          </div>
        );
      })}
    </div>
  );
}
