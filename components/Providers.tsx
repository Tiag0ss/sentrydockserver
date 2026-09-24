'use client';

import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { PwaRegister } from '@/components/PwaRegister';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <PwaRegister />
        {children}
      </I18nProvider>
    </ThemeProvider>
  );
}
