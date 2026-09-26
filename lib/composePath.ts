/** Mirrors agent `sanitizeProjectName` / deploy layout under compose root. */
export function sanitizeComposeProjectName(name: string): string {
  return String(name || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'project';
}

/**
 * Canonical path where the agent writes catalog Compose projects
 * (`SENTRYDOCK_COMPOSE_DIR` or `~/.sentrydock/compose/<name>/docker-compose.yml`).
 * `~` is expanded by the agent at runtime.
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
