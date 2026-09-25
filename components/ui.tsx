'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { useTheme } from '@/lib/theme/ThemeProvider';
import {
  THEME_PALETTES,
  THEME_PALETTE_META,
  type ThemeMode,
  type ThemePalette,
} from '@/lib/theme';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="sd-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="sd-actions">{actions}</div> : null}
    </header>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
};

export function Button({ variant = 'primary', className = '', ...props }: BtnProps) {
  const cls = variant === 'ghost' ? 'sd-btn-ghost' : variant === 'danger' ? 'sd-btn-danger' : 'sd-btn';
  return <button type="button" className={`${cls} ${className}`.trim()} {...props} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`sd-input ${className}`.trim()} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="sd-select" {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="sd-textarea" {...props} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="sd-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <nav className="sd-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className="sd-tab"
          aria-selected={value === item.id}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count != null ? (
            <span style={{ marginLeft: 8, opacity: 0.7 }}>{item.count}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'ok' | 'warn';
  children: ReactNode;
}) {
  return <div className={`sd-alert sd-alert-${tone}`}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="sd-empty">{children}</div>;
}

export function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'ok' | 'danger' | 'accent';
}) {
  const cls = tone ? `sd-badge sd-badge-${tone}` : 'sd-badge';
  return <span className={cls}>{children}</span>;
}

export function DataRow({
  title,
  meta,
  actions,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="sd-row">
      <div className="sd-row-main">
        <strong>{title}</strong>
        {meta ? <div className="sd-row-meta">{meta}</div> : null}
        {children}
      </div>
      {actions ? <div className="sd-row-actions">{actions}</div> : null}
    </div>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`sd-panel ${className}`.trim()}>{children}</section>;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sd-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sd-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={wide ? { maxWidth: 640 } : undefined}
      >
        <div className="sd-modal-header">
          <h2>{title}</h2>
          <button type="button" className="sd-modal-close" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="sd-modal-body">{children}</div>
        {footer ? <div className="sd-modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ThemeControls() {
  const { t } = useI18n();
  const { mode, palette, setMode, setPalette } = useTheme();
  const modes: ThemeMode[] = ['system', 'light', 'dark'];
  const modeLabel = (m: ThemeMode) =>
    m === 'system' ? t('common.themeSystem') : m === 'light' ? t('common.themeLight') : t('common.themeDark');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div className="sd-control-label">{t('common.theme')}</div>
        <div className="sd-theme-modes">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              data-active={mode === m}
              onClick={() => setMode(m)}
              aria-label={modeLabel(m)}
            >
              {modeLabel(m)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="sd-control-label">{t('common.palette')}</div>
        <div className="sd-palette-grid">
          {THEME_PALETTES.map((p: ThemePalette) => {
            const meta = THEME_PALETTE_META[p];
            return (
              <button
                key={p}
                type="button"
                className="sd-palette-btn"
                data-active={palette === p}
                onClick={() => setPalette(p)}
                aria-label={t(meta.labelKey)}
                title={t(meta.labelKey)}
              >
                <span style={{ display: 'flex', gap: 2 }} aria-hidden>
                  <span className="sd-swatch" style={{ background: meta.swatchLight }} />
                  <span className="sd-swatch" style={{ background: meta.swatchDark }} />
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(meta.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
