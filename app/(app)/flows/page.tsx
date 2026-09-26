'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { FlowWorkspace } from './_components/FlowWorkspace';
import { FlowsList, type FlowSummary } from './_components/FlowsList';

type View =
  | { mode: 'list' }
  | { mode: 'create' }
  | { mode: 'edit'; flow: FlowSummary };

function FlowsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [view, setView] = useState<View>({ mode: 'list' });
  const [listKey, setListKey] = useState(0);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) {
      setBootstrapping(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const flow = await api<FlowSummary>(`/flows/${editId}`);
        if (!cancelled) {
          setView({ mode: 'edit', flow });
          router.replace('/flows', { scroll: false });
        }
      } catch {
        if (!cancelled) setView({ mode: 'list' });
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams, router]);

  if (bootstrapping) {
    return null;
  }

  if (view.mode === 'list') {
    return (
      <FlowsList
        key={listKey}
        onCreate={() => setView({ mode: 'create' })}
        onEdit={(flow) => setView({ mode: 'edit', flow })}
      />
    );
  }

  return (
    <FlowWorkspace
      initial={view.mode === 'edit' ? view.flow : null}
      onBack={() => {
        setListKey((k) => k + 1);
        setView({ mode: 'list' });
      }}
      onSaved={(flow) => setView({ mode: 'edit', flow })}
    />
  );
}

export default function FlowsPage() {
  return (
    <Suspense fallback={null}>
      <FlowsPageInner />
    </Suspense>
  );
}
