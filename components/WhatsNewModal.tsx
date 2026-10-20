'use client';

import { useI18n } from '@/lib/i18n/I18nProvider';
import { Modal, Button } from '@/components/ui';
import type { WhatsNewEntry } from '@/lib/whatsNew';

export function WhatsNewModal({
  open,
  mode,
  currentVersion,
  entries,
  onClose,
  acknowledgeOnClose = false,
  acknowledging = false,
}: {
  open: boolean;
  mode: 'delta' | 'full';
  currentVersion: string;
  entries: WhatsNewEntry[];
  onClose: () => void;
  acknowledgeOnClose?: boolean;
  acknowledging?: boolean;
}) {
  const { t } = useI18n();

  const title = mode === 'full'
    ? t('whatsNew.title')
    : t('whatsNew.sinceLastVisit');

  const primaryLabel = acknowledgeOnClose
    ? t('whatsNew.gotIt')
    : t('common.close');

  const sorted = [...entries].sort((a, b) => {
    const pa = a.version.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.version.split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i += 1) {
      const d = (pb[i] || 0) - (pa[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  });

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      wide
      footer={(
        <Button disabled={acknowledging} onClick={onClose}>
          {acknowledging ? t('whatsNew.saving') : primaryLabel}
        </Button>
      )}
    >
      <p className="sd-entity-muted" style={{ marginTop: 0, marginBottom: 16, fontSize: 13 }}>
        {t('whatsNew.currentVersion', { version: currentVersion })}
      </p>

      {sorted.length === 0 ? (
        <p className="sd-entity-muted">{t('whatsNew.empty')}</p>
      ) : (
        <div className="sd-whats-new-list">
          {sorted.map((entry) => (
            <section key={entry.version} className="sd-whats-new-entry">
              <div className="sd-whats-new-entry-head">
                <strong>
                  {entry.version}
                  {entry.title ? ` — ${entry.title}` : ''}
                </strong>
                {entry.date ? (
                  <span className="sd-entity-muted" style={{ fontSize: 12 }}>{entry.date}</span>
                ) : null}
              </div>
              <ul className="sd-whats-new-items">
                {(entry.items || []).map((item, index) => (
                  <li key={`${entry.version}-${index}`}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
