'use client';

import { useEffect } from 'react';
import { initPwaInstallCapture, registerSdServiceWorker } from '@/lib/pwaInstall';

export function PwaRegister() {
  useEffect(() => {
    initPwaInstallCapture();
    void registerSdServiceWorker();
  }, []);
  return null;
}
