'use client';

import { useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/I18nProvider';

type CollapsibleFilterPanelProps = {
  title?: string;
  /** Number of active filters — shown as a badge when > 0 */
  activeCount?: number;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  headerMiddle?: ReactNode;
  headerExtra?: ReactNode;
  onClear?: () => void;
  clearLabel?: string;
};

/**
 * Compact collapsible filter chrome for list pages.
 * Filters are collapsed by default to free vertical space.
 */
export function CollapsibleFilterPanel({
  title,
  activeCount = 0,
  defaultOpen = false,
  children,
  className = '',
  bodyClassName = 'sd-collapsible-filter-body',
  headerMiddle,
  headerExtra,
  onClear,
  clearLabel,
}: CollapsibleFilterPanelProps) {
  const { t } = useI18n();
  const titleResolved = title ?? t('common.filters');
  const clearLabelResolved = clearLabel ?? t('common.clear');
  const [open, setOpen] = useState(defaultOpen);
  const hasActive = activeCount > 0;

  return (
    <div className={`sd-collapsible-filter ${className}`.trim()}>
      <div className="sd-collapsible-filter-head">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="sd-collapsible-filter-toggle"
        >
          <svg
            className={`sd-collapsible-filter-chevron${open ? ' is-open' : ''}`}
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <span className="sd-collapsible-filter-title">{titleResolved}</span>
          {hasActive ? (
            <span className="sd-collapsible-filter-badge">{activeCount}</span>
          ) : null}
          <span className="sd-collapsible-filter-hint">
            {open ? t('common.showLess') : t('common.showMore')}
          </span>
        </button>

        <div className="sd-collapsible-filter-middle">
          {headerMiddle}
        </div>

        {hasActive && onClear ? (
          <button type="button" onClick={onClear} className="sd-collapsible-filter-clear">
            {clearLabelResolved}
          </button>
        ) : null}

        {headerExtra ? <div className="sd-collapsible-filter-extra">{headerExtra}</div> : null}
      </div>

      {open ? <div className={bodyClassName}>{children}</div> : null}
    </div>
  );
}
