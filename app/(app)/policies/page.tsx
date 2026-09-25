'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Policies fundiram-se no agendamento dos flows. */
export default function PoliciesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/flows');
  }, [router]);
  return <p>…</p>;
}
