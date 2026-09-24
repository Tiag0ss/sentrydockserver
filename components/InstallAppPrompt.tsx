'use client';

import { useEffect, useState } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useI18n } from '@/lib/i18n/I18nProvider';
import {
  clearDeferredInstallPrompt,
  dismissInstallPrompt,
  getDeferredInstallPrompt,
  isIosSafari,
  isStandaloneDisplay,
  subscribePwaInstall,
  wasInstallDismissed,
} from '@/lib/pwaInstall';
import { Button } from '@/components/ui';

export function InstallAppPrompt() {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => setMounted(true), []);
  useEffect(() => subscribePwaInstall(() => setTick((n) => n + 1)), []);

  if (!mounted || !isMobile) return null;
  if (isStandaloneDisplay()) return null;
  if (wasInstallDismissed()) return null;

  void tick;
  const deferred = getDeferredInstallPrompt();
  const ios = isIosSafari();

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* ignore */
    } finally {
      clearDeferredInstallPrompt();
      setTick((n) => n + 1);
    }
  };

  const dismiss = () => {
    dismissInstallPrompt();
    setTick((n) => n + 1);
  };

  const body = ios
    ? t('pwa.installIos')
    : deferred
      ? t('pwa.installBody')
      : t('pwa.installFallback');

  return (
    <div className="sd-pwa-banner" role="region" aria-label={t('pwa.installTitle')}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 650, fontSize: 14 }}>{t('pwa.installTitle')}</p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--sd-muted)', lineHeight: 1.45 }}>{body}</p>
        </div>
        <button
          type="button"
          className="sd-btn-ghost"
          style={{ padding: '4px 8px', minHeight: 32 }}
          onClick={dismiss}
          aria-label={t('pwa.dismiss')}
        >
          ✕
        </button>
      </div>
      <div className="sd-actions" style={{ marginTop: 12 }}>
        {deferred ? (
          <Button onClick={() => { void install(); }}>{t('pwa.install')}</Button>
        ) : null}
        <Button variant="ghost" onClick={dismiss}>{t('pwa.notNow')}</Button>
      </div>
    </div>
  );
}
