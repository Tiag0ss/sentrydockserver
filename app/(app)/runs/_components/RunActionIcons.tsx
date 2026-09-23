'use client';

import type { CSSProperties, ReactNode } from 'react';

const iconBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};

export function IconOpen({ title }: { title: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <title>{title}</title>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function IconRerun({ title }: { title: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <title>{title}</title>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

export function ActionIconButton({
  title,
  onClick,
  disabled,
  children,
  primary,
}: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...iconBtn,
        borderColor: primary ? 'var(--accent)' : 'var(--border)',
        color: primary ? 'var(--accent)' : 'var(--text)',
        background: primary ? 'rgba(61, 214, 198, 0.1)' : 'transparent',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const color = status === 'success' ? '#3dd68c'
    : status === 'failed' || status === 'aborted' || status === 'rejected' ? 'var(--danger)'
      : status === 'waiting_approval' || status === 'awaiting_user' || status === 'interrupted' ? 'var(--warn)'
        : status === 'running' ? 'var(--accent)'
          : 'var(--muted)';
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      border: `1px solid ${color}`,
      color,
      borderRadius: 999,
      padding: '3px 9px',
      whiteSpace: 'nowrap',
    }}>
      {label || status}
    </span>
  );
}
