import { describe, expect, it } from 'vitest';
import {
  getNodeOutputs,
  getSplitBranches,
  normalizeHandle,
  branchesFromTargets,
} from './flowConstants';

describe('normalizeHandle', () => {
  it('maps action nodes to out', () => {
    expect(normalizeHandle('webhook', 'error')).toBe('out');
    expect(normalizeHandle('pull_image', 'ok')).toBe('out');
  });

  it('keeps branching handles for check / if / run_flow', () => {
    expect(normalizeHandle('check_image_update', 'update')).toBe('update');
    expect(normalizeHandle('if', 'false')).toBe('false');
    expect(normalizeHandle('run_flow', 'failed')).toBe('failed');
  });
});

describe('getNodeOutputs', () => {
  it('returns static ports for check_image_update', () => {
    const ports = getNodeOutputs('check_image_update');
    expect(ports.map((p) => p.id)).toEqual(['update', 'no_update', 'error']);
  });

  it('builds split ports from branches', () => {
    const ports = getNodeOutputs('split', {
      branches: [
        { id: 'a:web-1', label: 'web-1', agentId: 'a', containerName: 'web-1' },
        { id: 'a:web-2', label: 'web-2', agentId: 'a', containerName: 'web-2' },
      ],
    });
    expect(ports.map((p) => p.id)).toEqual(['a:web-1', 'a:web-2']);
  });

  it('includes run_flow success/failed/error when wait is true', () => {
    expect(getNodeOutputs('run_flow', { wait: true }).map((p) => p.id))
      .toEqual(['success', 'failed', 'error']);
  });
});

describe('getSplitBranches / branchesFromTargets', () => {
  it('parses targets into branch handles', () => {
    const branches = branchesFromTargets([
      { agentId: 'agent-1', containerName: 'web-1' },
    ]);
    expect(branches).toEqual([{
      id: 'agent-1:web-1',
      label: 'web-1',
      agentId: 'agent-1',
      containerName: 'web-1',
    }]);
  });

  it('prefers explicit data.branches', () => {
    expect(getSplitBranches({
      branches: [{ id: 'x:y', containerName: 'y', agentId: 'x' }],
      targets: [{ agentId: 'other', containerName: 'z' }],
    })).toHaveLength(1);
  });
});
