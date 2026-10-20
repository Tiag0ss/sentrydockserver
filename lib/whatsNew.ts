import { api } from '@/lib/api';

export type WhatsNewEntry = {
  version: string;
  date?: string | null;
  title?: string;
  items: string[];
};

export type WhatsNewPayload = {
  currentVersion: string;
  lastSeenAppVersion: string | null;
  entries: WhatsNewEntry[];
};

export async function fetchWhatsNew(options: { full?: boolean; since?: string } = {}): Promise<WhatsNewPayload> {
  const params = new URLSearchParams();
  if (options.full) params.set('full', '1');
  if (options.since) params.set('since', options.since);
  const qs = params.toString();
  return api<WhatsNewPayload>(`/whats-new${qs ? `?${qs}` : ''}`);
}

export async function markWhatsNewSeen(): Promise<string> {
  const data = await api<{ lastSeenAppVersion: string }>('/whats-new/seen', {
    method: 'PATCH',
    body: '{}',
  });
  return data.lastSeenAppVersion;
}
