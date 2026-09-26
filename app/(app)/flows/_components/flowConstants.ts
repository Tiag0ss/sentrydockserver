export const NODE_TYPES_LIST = [
  { type: 'check_image_update' },
  { type: 'pull_image' },
  { type: 'recreate_container' },
  { type: 'compose_up' },
  { type: 'compose_down' },
  { type: 'notify' },
  { type: 'webhook' },
  { type: 'wait_approval' },
  { type: 'if' },
  { type: 'case' },
  { type: 'split' },
  { type: 'join' },
  { type: 'wait_healthy' },
  { type: 'rollback' },
  { type: 'run_flow' },
] as const;

export type NodePort = { id: string; label?: string };

const OUT: NodePort[] = [{ id: 'out' }];

/** Tipos de acção: uma saída; o resultado vai para o contexto. */
export const ACTION_NODE_TYPES = new Set([
  'pull_image',
  'recreate_container',
  'compose_up',
  'compose_down',
  'notify',
  'webhook',
  'wait_approval',
  // split tem saídas dinâmicas por contentor — não forçar `out`
  'join',
  'wait_healthy',
  'rollback',
]);

/** Saídas estáticas (CASE é dinâmico via data.cases; split via branches/targets; run_flow depende de wait). */
export const NODE_OUTPUTS: Record<string, NodePort[]> = {
  check_image_update: [{ id: 'update' }, { id: 'no_update' }, { id: 'error' }],
  pull_image: OUT,
  recreate_container: OUT,
  compose_up: OUT,
  compose_down: OUT,
  notify: OUT,
  webhook: OUT,
  wait_approval: OUT,
  if: [{ id: 'true' }, { id: 'false' }],
  condition: [{ id: 'true' }, { id: 'false' }], // legado → if
  case: [{ id: 'else' }], // fallback; usar getNodeOutputs(type, data)
  split: OUT, // fallback; usar getNodeOutputs(type, data)
  join: OUT,
  wait_healthy: OUT,
  rollback: OUT,
  run_flow: [{ id: 'success' }, { id: 'failed' }, { id: 'error' }],
};

export type CaseWhen = { id: string; match: string };

export type SplitBranch = {
  id: string;
  label: string;
  agentId?: string;
  containerName?: string;
};

function parseTargetLike(row: Record<string, unknown>): SplitBranch | null {
  const agentId = String(row.agentId || '').trim();
  const containerName = String(row.containerName || row.label || '').trim();
  const id = String(row.id || (agentId && containerName ? `${agentId}:${containerName}` : '')).trim();
  if (!id && !containerName) return null;
  const handleId = id || containerName;
  return {
    id: handleId,
    label: containerName || handleId,
    agentId: agentId || undefined,
    containerName: containerName || undefined,
  };
}

/** Ramos do Split: data.branches ou targets manuais. */
export function getSplitBranches(data?: Record<string, unknown> | null): SplitBranch[] {
  if (!data) return [];
  const rawBranches = data.branches;
  if (Array.isArray(rawBranches) && rawBranches.length) {
    return rawBranches
      .map((b) => {
        if (!b || typeof b !== 'object') return null;
        return parseTargetLike(b as Record<string, unknown>);
      })
      .filter(Boolean) as SplitBranch[];
  }
  if (String(data.targetsSource || '') === 'manual' && Array.isArray(data.targets)) {
    return (data.targets as unknown[])
      .map((t) => {
        if (!t || typeof t !== 'object') return null;
        return parseTargetLike(t as Record<string, unknown>);
      })
      .filter(Boolean) as SplitBranch[];
  }
  return [];
}

/** Constrói branches a partir de targets do check (para sync no editor). */
export function branchesFromTargets(targets: unknown): SplitBranch[] {
  if (!Array.isArray(targets)) return [];
  return targets
    .map((t) => {
      if (!t || typeof t !== 'object') return null;
      return parseTargetLike(t as Record<string, unknown>);
    })
    .filter(Boolean) as SplitBranch[];
}

export function getCaseWhens(data?: Record<string, unknown> | null): CaseWhen[] {
  const raw = data?.cases;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      if (!c || typeof c !== 'object') return null;
      const row = c as Record<string, unknown>;
      const id = String(row.id || row.match || '').trim();
      const match = String(row.match ?? row.id ?? '').trim();
      if (!id) return null;
      return { id, match: match || id };
    })
    .filter(Boolean) as CaseWhen[];
}

export function getNodeOutputs(
  type: string,
  data?: Record<string, unknown> | null,
): NodePort[] {
  const normalized = type === 'condition' ? 'if' : type;
  if (normalized === 'case') {
    const whens = getCaseWhens(data);
    return [...whens.map((w) => ({ id: w.id })), { id: 'else' }];
  }
  if (normalized === 'run_flow') {
    const wait = data?.wait !== false && data?.wait !== 'false';
    return wait
      ? [{ id: 'success' }, { id: 'failed' }, { id: 'error' }]
      : OUT;
  }
  if (normalized === 'split') {
    const branches = getSplitBranches(data);
    if (branches.length) {
      return branches.map((b) => ({ id: b.id, label: b.label }));
    }
    return OUT;
  }
  return NODE_OUTPUTS[normalized] || OUT;
}

/** Normaliza handles antigos para o modelo out / IF / CASE / check / run_flow / split. */
export function normalizeHandle(
  type: string,
  handle: string | null | undefined,
  data?: Record<string, unknown> | null,
): string {
  const normalized = type === 'condition' ? 'if' : type;
  const outputs = getNodeOutputs(normalized, data);
  const ids = new Set(outputs.map((o) => o.id));
  if (handle && ids.has(handle)) return handle;
  if (normalized === 'check_image_update') {
    if (!handle || handle === 'out' || handle === 'success' || handle === 'ok') return 'update';
  }
  if (normalized === 'run_flow') {
    const wait = data?.wait !== false && data?.wait !== 'false';
    if (!wait) return 'out';
    if (!handle || handle === 'out' || handle === 'ok') return 'success';
  }
  if (normalized === 'split') {
    // Preservar handle por contentor; só aliases genéricos → out
    if (!handle || handle === 'ok' || handle === 'success') return 'out';
    if (handle === 'out') return 'out';
    return handle;
  }
  if (ACTION_NODE_TYPES.has(normalized)) return 'out';
  if (!handle || handle === 'out' || handle === 'success' || handle === 'ok') {
    return outputs[0]?.id || 'out';
  }
  return handle;
}

export const CONTEXT_FIELD_VALUES = [
  'lastResult',
  'lastOutcome',
  'updateAvailable',
  'image',
  'agentId',
  'containerName',
  'newDigest',
  'oldDigest',
  'error',
  'approvalDecision',
  'targetTag',
  'currentTag',
  'targetMode',
  'targetRange',
] as const;

/** @deprecated Prefer CONTEXT_FIELD_VALUES + t('contextFields.*') */
export const CONTEXT_FIELDS = CONTEXT_FIELD_VALUES.map((value) => ({
  value,
  label: value,
}));

/** Campos do contexto que o node anterior expõe para IF (bool) / CASE (enum). */
export type NodeBranchField = {
  field: string;
  kind: 'bool' | 'enum';
  values?: string[];
};

const OK_ERROR: NodeBranchField[] = [
  { field: 'lastResult', kind: 'bool' },
  { field: 'lastOutcome', kind: 'enum', values: ['ok', 'error'] },
];

/** Outputs de branching por tipo de node (o que escreve em lastResult / lastOutcome). */
export const NODE_BRANCH_FIELDS: Record<string, NodeBranchField[]> = {
  check_image_update: [
    { field: 'lastResult', kind: 'bool' },
    { field: 'updateAvailable', kind: 'bool' },
    { field: 'lastOutcome', kind: 'enum', values: ['update', 'no_update', 'error'] },
  ],
  wait_approval: [
    { field: 'lastResult', kind: 'bool' },
    { field: 'lastOutcome', kind: 'enum', values: ['approved', 'rejected'] },
  ],
  wait_healthy: [
    { field: 'lastResult', kind: 'bool' },
    { field: 'lastOutcome', kind: 'enum', values: ['healthy', 'timeout', 'error'] },
  ],
  join: [
    { field: 'lastResult', kind: 'bool' },
    { field: 'lastOutcome', kind: 'enum', values: ['ok', 'failed'] },
  ],
  pull_image: OK_ERROR,
  recreate_container: OK_ERROR,
  compose_up: OK_ERROR,
  compose_down: OK_ERROR,
  rollback: OK_ERROR,
  webhook: OK_ERROR,
  split: OK_ERROR,
  run_flow: [
    { field: 'lastResult', kind: 'bool' },
    { field: 'lastOutcome', kind: 'enum', values: ['ok', 'failed', 'error'] },
  ],
  notify: [{ field: 'lastResult', kind: 'bool' }],
  if: [
    { field: 'lastResult', kind: 'bool' },
    { field: 'lastOutcome', kind: 'enum', values: ['true', 'false'] },
  ],
  condition: [
    { field: 'lastResult', kind: 'bool' },
    { field: 'lastOutcome', kind: 'enum', values: ['true', 'false'] },
  ],
  case: [], // CASE não escreve outcomes próprios para o seguinte
};

/** Campos do node anterior; sem predecessor / tipo desconhecido → vazio (sem fallback genérico). */
export function getBranchFieldsForNodeType(type: string | null | undefined): NodeBranchField[] {
  if (!type || type === 'flowCard') return [];
  const normalized = type === 'condition' ? 'if' : type;
  return NODE_BRANCH_FIELDS[normalized] ?? [];
}

/** Campos booleanos do node anterior (IF). */
export function getIfFieldsForPrev(prevType: string | null | undefined): string[] {
  return getBranchFieldsForNodeType(prevType)
    .filter((f) => f.kind === 'bool')
    .map((f) => f.field);
}

/** Campos enum do node anterior (CASE) — tipicamente só lastOutcome. */
export function getCaseFieldsForPrev(prevType: string | null | undefined): NodeBranchField[] {
  return getBranchFieldsForNodeType(prevType).filter((f) => f.kind === 'enum');
}

/** Valores de retorno do node anterior para um campo CASE. */
export function getCaseMatchValues(
  prevType: string | null | undefined,
  field: string,
): string[] {
  const hit = getCaseFieldsForPrev(prevType).find((f) => f.field === field);
  return hit?.values?.length ? [...hit.values] : [];
}

/** Tags disponíveis em Notify / Webhook / Wait approval (`{{tag}}`). */
export const TEMPLATE_TAGS = [
  'agentName',
  'agentId',
  'containerName',
  'image',
  'updateAvailable',
  'lastResult',
  'lastOutcome',
  'newDigest',
  'oldDigest',
  'previousDigest',
  'error',
  'lastError',
  'failedNodeId',
  'failedNodeType',
  'approvalDecision',
  'targetTag',
  'currentTag',
  'targetMode',
  'targetRange',
  'targetsList',
  'targetsCount',
  'skippedTargetsList',
  'skippedTargetsCount',
  'runId',
  'flowId',
  'flowName',
  'nodeName',
  'childRunId',
] as const;

export const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  background: 'var(--sd-panel)',
  border: '1px solid var(--sd-border)',
  borderRadius: 6,
  padding: '6px 8px',
  color: 'var(--sd-text)',
  marginTop: 4,
  boxSizing: 'border-box',
};

export const btnStyle: React.CSSProperties = {
  background: 'var(--sd-accent)',
  color: 'var(--sd-accent-fg)',
  border: 'none',
  borderRadius: 8,
  padding: '8px 12px',
  fontWeight: 600,
  cursor: 'pointer',
};

export const btnSecondaryStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'transparent',
  color: 'var(--sd-text)',
  border: '1px solid var(--sd-border)',
};
