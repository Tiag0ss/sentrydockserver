'use client';

import { useEffect } from 'react';
import { NODE_TYPES_LIST } from './flowConstants';
import { useI18n } from '@/lib/i18n/I18nProvider';

export type ContextTarget =
  | { kind: 'pane'; flowX: number; flowY: number }
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string };

export type ContextMenuState = {
  x: number;
  y: number;
  target: ContextTarget;
} | null;

type Action = { id: string; label: string; danger?: boolean };

type Props = {
  menu: ContextMenuState;
  onClose: () => void;
  onAction: (actionId: string, target: ContextTarget) => void;
};

export function FlowContextMenu({ menu, onClose, onAction }: Props) {
  const { t } = useI18n();

  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  function actionsFor(target: ContextTarget): Action[] {
    if (target.kind === 'node') {
      return [
        { id: 'duplicate', label: t('flowMenu.duplicate') },
        { id: 'inspect', label: t('flowMenu.inspect') },
        { id: 'delete-node', label: t('flowMenu.deleteNode'), danger: true },
      ];
    }
    if (target.kind === 'edge') {
      return [{ id: 'delete-edge', label: t('flowMenu.deleteEdge'), danger: true }];
    }
    return [
      { id: 'fit-view', label: t('flowMenu.fitView') },
      ...NODE_TYPES_LIST.map((n) => ({
        id: `add:${n.type}`,
        label: `${t('flowMenu.add')}: ${t(`nodes.${n.type}`)}`,
      })),
    ];
  }

  const items = actionsFor(menu.target);

  return (
    <div
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: Math.min(menu.x, window.innerWidth - 240),
        top: Math.min(menu.y, window.innerHeight - 320),
        zIndex: 1000,
        minWidth: 210,
        maxHeight: '70vh',
        overflowY: 'auto',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
        padding: 6,
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => {
            onAction(item.id, menu.target);
            onClose();
          }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            color: item.danger ? 'var(--danger)' : 'var(--text)',
            padding: '8px 10px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
