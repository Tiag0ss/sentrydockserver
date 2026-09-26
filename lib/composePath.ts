/** Mirrors agent `sanitizeProjectName` / deploy layout under compose root. */
export function sanitizeComposeProjectName(name: string): string {
  return String(name || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'project';
}

/**
 * Canonical path hint where the agent writes catalog Compose projects.
 * Prefer the absolute path from `docker.compose.status` when an agent is selected.
 * Default host layout: `~/.sentrydock/compose/<name>/docker-compose.yml`.
 * In the bundled agent container: `/var/lib/sentrydock/compose` (named volume via `SENTRYDOCK_COMPOSE_DIR`).
 */
export function expectedComposeDeployPath(projectName: string): string {
  const n = sanitizeComposeProjectName(projectName);
  return `~/.sentrydock/compose/${n}/docker-compose.yml`;
}

export function composeNodeMissingPath(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return true;
  const projectPath = String(data.projectPath || '').trim();
  return !projectPath;
}

export function composeNodeMisconfigured(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return true;
  const composeProjectId = String(data.composeProjectId || '').trim();
  const projectPath = String(data.projectPath || '').trim();
  return !composeProjectId && !projectPath;
}
