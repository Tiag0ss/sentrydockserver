export const NODE_TYPES_LIST = [
  { type: 'check_image_update' },
  { type: 'pull_image' },
  { type: 'recreate_container' },
  { type: 'compose_up' },
  { type: 'compose_down' },
  { type: 'notify' },
  { type: 'webhook' },
  { type: 'wait_approval' },
  { type: 'condition' },
  { type: 'split' },
  { type: 'join' },
  { type: 'wait_healthy' },
  { type: 'rollback' },
] as const;

export type NodePort = { id: string };

const OK_ERROR: NodePort[] = [{ id: 'ok' }, { id: 'error' }];

/** Saídas à direita — o motor segue o `id` do handle. */
export const NODE_OUTPUTS: Record<string, NodePort[]> = {
  check_image_update: [{ id: 'update' }, { id: 'no_update' }, { id: 'error' }],
  pull_image: OK_ERROR,
  recreate_container: OK_ERROR,
  compose_up: OK_ERROR,
  compose_down: OK_ERROR,
  notify: [{ id: 'ok' }],
  webhook: OK_ERROR,
  wait_approval: [{ id: 'approved' }, { id: 'rejected' }],
  condition: [{ id: 'true' }, { id: 'false' }],
  split: [{ id: 'ok' }],
  join: OK_ERROR,
  wait_healthy: [{ id: 'healthy' }, { id: 'timeout' }, { id: 'error' }],
  rollback: OK_ERROR,
};

export function getNodeOutputs(type: string): NodePort[] {
  return NODE_OUTPUTS[type] || OK_ERROR;
}

/** Normaliza handles antigos (`out`) para o id actual. */
export function normalizeHandle(type: string, handle: string | null | undefined): string {
  const outputs = getNodeOutputs(type);
  const ids = new Set(outputs.map((o) => o.id));
  if (handle && ids.has(handle)) return handle;
  if (!handle || handle === 'out' || handle === 'success') {
    if (ids.has('ok')) return 'ok';
    return outputs[0]?.id || 'ok';
  }
  return handle;
}

export const CONTEXT_FIELD_VALUES = [
  'updateAvailable',
  'image',
  'agentId',
  'containerName',
  'newDigest',
  'oldDigest',
  'error',
  'approvalDecision',
] as const;

/** @deprecated Prefer CONTEXT_FIELD_VALUES + t('contextFields.*') */
export const CONTEXT_FIELDS = CONTEXT_FIELD_VALUES.map((value) => ({
  value,
  label: value,
}));

/** Tags disponíveis em Notify / Webhook (`{{tag}}`). */
export const TEMPLATE_TAGS = [
  'error',
  'lastError',
  'failedNodeId',
  'failedNodeType',
  'agentId',
  'containerName',
  'image',
  'updateAvailable',
  'newDigest',
  'oldDigest',
  'previousDigest',
  'approvalDecision',
  'runId',
  'flowId',
] as const;

export const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 8px',
  color: 'var(--text)',
  marginTop: 4,
  boxSizing: 'border-box',
};

export const btnStyle: React.CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--bg)',
  border: 'none',
  borderRadius: 8,
  padding: '8px 12px',
  fontWeight: 600,
  cursor: 'pointer',
};

export const btnSecondaryStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
};
