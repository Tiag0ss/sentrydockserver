'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/I18nProvider';

/** Policies fundiram-se no agendamento dos flows. */
export default function PoliciesRedirectPage() {
  const router = useRouter();
  const { t } = useI18n();
  useEffect(() => {
    router.replace('/flows');
  }, [router]);
  return <p>{t('common.loading')}</p>;
}
