'use client';

import { useState } from 'react';
import { FlowWorkspace } from './_components/FlowWorkspace';
import { FlowsList, type FlowSummary } from './_components/FlowsList';

type View =
  | { mode: 'list' }
  | { mode: 'create' }
  | { mode: 'edit'; flow: FlowSummary };

export default function FlowsPage() {
  const [view, setView] = useState<View>({ mode: 'list' });
  const [listKey, setListKey] = useState(0);

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
