/** Catalog registry providers for Docker/OCI image credentials. */

export const REGISTRY_PROVIDER_IDS = [
  'docker_hub',
  'ghcr',
  'gitea',
  'gitlab',
  'bitbucket',
  'harbor',
  'custom',
] as const;

export type RegistryProviderId = (typeof REGISTRY_PROVIDER_IDS)[number];

export type RegistryProviderDef = {
  id: RegistryProviderId;
  /** Canonical docker login server; null = leave empty / Hub default on agent */
  defaultServer: string | null;
  /** Host must be typed by the user (self-hosted / custom). */
  serverEditable: boolean;
  /** Example repository path (no tag). */
  repositoryPlaceholder: string;
  /** i18n key under imageProviderHints.<id> */
  hintKey: string;
};

export const REGISTRY_PROVIDERS: Record<RegistryProviderId, RegistryProviderDef> = {
  docker_hub: {
    id: 'docker_hub',
    defaultServer: 'https://index.docker.io/v1/',
    serverEditable: false,
    repositoryPlaceholder: 'library/nginx or user/app',
    hintKey: 'docker_hub',
  },
  ghcr: {
    id: 'ghcr',
    defaultServer: 'ghcr.io',
    serverEditable: false,
    repositoryPlaceholder: 'ghcr.io/org/app',
    hintKey: 'ghcr',
  },
  gitea: {
    id: 'gitea',
    defaultServer: null,
    serverEditable: true,
    repositoryPlaceholder: 'gitea.example.com/owner/app',
    hintKey: 'gitea',
  },
  gitlab: {
    id: 'gitlab',
    defaultServer: 'registry.gitlab.com',
    serverEditable: true,
    repositoryPlaceholder: 'registry.gitlab.com/group/project',
    hintKey: 'gitlab',
  },
  bitbucket: {
    id: 'bitbucket',
    defaultServer: 'crg.apkg.io',
    serverEditable: false,
    repositoryPlaceholder: 'crg.apkg.io/workspace/app',
    hintKey: 'bitbucket',
  },
  harbor: {
    id: 'harbor',
    defaultServer: null,
    serverEditable: true,
    repositoryPlaceholder: 'harbor.example.com/project/app',
    hintKey: 'harbor',
  },
  custom: {
    id: 'custom',
    defaultServer: null,
    serverEditable: true,
    repositoryPlaceholder: 'registry.example.com/app',
    hintKey: 'custom',
  },
};

export function isRegistryProviderId(v: string | null | undefined): v is RegistryProviderId {
  return Boolean(v && (REGISTRY_PROVIDER_IDS as readonly string[]).includes(v));
}

export function getRegistryProvider(id: string | null | undefined): RegistryProviderDef {
  if (isRegistryProviderId(id)) return REGISTRY_PROVIDERS[id];
  return REGISTRY_PROVIDERS.docker_hub;
}

/** Infer provider from a repository path host when provider was never set. */
export function inferProviderFromRepository(repository: string): RegistryProviderId {
  const raw = String(repository || '').trim().toLowerCase();
  const host = raw.split('/')[0] || '';
  if (!host || !host.includes('.') && !host.includes(':')) return 'docker_hub';
  if (host === 'docker.io' || host === 'index.docker.io' || host === 'registry-1.docker.io') {
    return 'docker_hub';
  }
  if (host === 'ghcr.io') return 'ghcr';
  if (host === 'crg.apkg.io') return 'bitbucket';
  if (host === 'registry.gitlab.com' || host.endsWith('.gitlab.com')) return 'gitlab';
  if (host.includes('gitea')) return 'gitea';
  if (host.includes('harbor')) return 'harbor';
  return 'custom';
}

export function defaultServerForProvider(providerId: string | null | undefined): string | undefined {
  const p = getRegistryProvider(providerId);
  return p.defaultServer || undefined;
}
