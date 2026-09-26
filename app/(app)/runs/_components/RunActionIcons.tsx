'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import {
  IconButton,
  IconOpen as SharedIconOpen,
  IconRefresh,
} from '@/components/IconActions';

/** @deprecated Prefer IconOpen from @/components/IconActions */
export function IconOpen({ title: _title }: { title: string }) {
  return <SharedIconOpen />;
}

/** @deprecated Prefer IconRefresh from @/components/IconActions */
export function IconRerun({ title: _title }: { title: string }) {
  return <IconRefresh />;
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
    <IconButton
      label={title}
      tone={primary ? 'primary' : 'default'}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </IconButton>
  );
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const { t } = useI18n();
  const color = status === 'success' ? '#3dd68c'
    : status === 'failed' || status === 'aborted' || status === 'rejected' ? 'var(--danger)'
      : status === 'waiting_approval' || status === 'awaiting_user' || status === 'interrupted' ? 'var(--warn)'
        : status === 'running' ? 'var(--accent)'
          : 'var(--muted)';
  const text = label || tt(t, 'status', status);
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
      {text}
    </span>
  );
}
