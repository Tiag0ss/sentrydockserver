import { CronExpressionParser } from 'cron-parser';

export function nextCronDate(cron: string, timezone: string, from = new Date()): Date {
  const expr = CronExpressionParser.parse(cron, { currentDate: from, tz: timezone });
  return expr.next().toDate();
}

/** Blackout window HH:mm-HH:mm in given timezone (simple local wall-clock check). */
export function inBlackout(timezone: string, start?: string | null, end?: string | null, now = new Date()): boolean {
  if (!start || !end) return false;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hh = parts.find((p) => p.type === 'hour')?.value || '00';
  const mm = parts.find((p) => p.type === 'minute')?.value || '00';
  const cur = `${hh}:${mm}`;
  if (start <= end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}
