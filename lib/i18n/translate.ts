/** Translate `prefix.value` with fallback to a humanized raw value. */
export function tt(
  t: (key: string, vars?: Record<string, string | number>) => string,
  prefix: string,
  value: string | null | undefined,
): string {
  if (!value) return '';
  const key = `${prefix}.${value}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return value.replace(/_/g, ' ');
}
