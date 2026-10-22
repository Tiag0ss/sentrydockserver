'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

type MenuBox = { top: number; left: number; width: number; maxHeight: number };

/** Above modals (.sd-modal-overlay is z-index 1000). */
const DROPDOWN_Z = 1100;

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
  const [box, setBox] = useState<MenuBox | null>(null);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const gap = 4;
      const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
      const spaceAbove = rect.top - gap - 8;
      const preferBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;
      const maxHeight = Math.max(120, Math.min(280, preferBelow ? spaceBelow : spaceAbove));
      setBox({
        top: preferBelow ? rect.bottom + gap : Math.max(8, rect.top - gap - maxHeight),
        left: rect.left,
        width: rect.width,
        maxHeight,
      });
    }
    place();
    window.addEventListener('resize', place);
    // Capture scroll on any ancestor (modal body, inspector, …)
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const menu = open && !disabled && mounted && box
    ? createPortal(
      <div
        ref={menuRef}
        id={listId}
        role="listbox"
        style={{
          position: 'fixed',
          zIndex: DROPDOWN_Z,
          top: box.top,
          left: box.left,
          width: box.width,
          maxHeight: box.maxHeight,
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
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
        <div style={{ overflow: 'auto', padding: '0 0 8px', minHeight: 0 }}>
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
      </div>,
      document.body,
    )
    : null;

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      {label ? <div style={{ fontSize: 13, marginBottom: 0 }}>{label}</div> : null}
      <button
        ref={triggerRef}
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
      {menu}
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
