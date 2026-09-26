'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { inputStyle } from './flowConstants';
import { useI18n } from '@/lib/i18n/I18nProvider';

export type SearchOption = {
  value: string;
  label: string;
  hint?: string;
};

type Props = {
  label: string;
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  allowCustom?: boolean;
};

export function SearchSelect({
  label,
  value,
  options,
  onChange,
  placeholder,
  emptyLabel,
  disabled,
  loading,
  allowCustom,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const resolvedEmpty = emptyLabel ?? t('common.none');
  const resolvedPlaceholder = placeholder ?? t('common.search');
  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label || (value ? value : resolvedEmpty);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.label} ${o.hint || ''} ${o.value}`.toLowerCase().includes(q),
    );
  }, [options, query]);

  const customCandidate = allowCustom && query.trim() && !options.some((o) => o.value === query.trim())
    ? query.trim()
    : null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      {label ? <div style={{ fontSize: 13, marginBottom: 0 }}>{label}</div> : null}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...inputStyle,
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loading ? t('common.loading') : displayLabel}
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 10 }}>▾</span>
      </button>

      {open && !disabled && (
        <div
          id={listId}
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 40,
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            maxHeight: 240,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={resolvedPlaceholder}
            style={{
              ...inputStyle,
              margin: 8,
              width: 'auto',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter' && customCandidate) {
                onChange(customCandidate);
                setOpen(false);
              }
            }}
          />
          <div style={{ overflow: 'auto', padding: '0 0 8px' }}>
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => { onChange(''); setOpen(false); }}
              style={optionStyle(!value)}
            >
              {resolvedEmpty}
            </button>
            {customCandidate && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => { onChange(customCandidate); setOpen(false); }}
                style={optionStyle(false)}
              >
                {t('searchSelect.useCustom', { value: customCandidate })}
              </button>
            )}
            {filtered.length === 0 && !customCandidate && (
              <div style={{ padding: '8px 12px', color: 'var(--muted)', fontSize: 12 }}>
                {t('searchSelect.noResults')}
              </div>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={optionStyle(o.value === value)}
              >
                <div>{o.label}</div>
                {o.hint && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{o.hint}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function optionStyle(active: boolean): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: active ? 'rgba(61, 214, 198, 0.15)' : 'transparent',
    border: 'none',
    color: 'var(--text)',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 13,
  };
}
