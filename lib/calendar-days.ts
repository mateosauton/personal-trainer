/** A home timezone makes travel independent of the current device timezone. */
export function validTimeZone(value: string | null | undefined): string {
  if (value) {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return value; } catch {}
  }
  return 'UTC';
}

export function deviceTimeZone(): string {
  return validTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export function calendarDayKey(date: Date | string, timeZone: string): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: validTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Calendar arithmetic uses UTC noon, never the current device's DST rules. */
export function shiftDayKey(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function calendarDayDifference(later: string, earlier: string): number {
  return Math.round((Date.parse(`${later}T12:00:00Z`) - Date.parse(`${earlier}T12:00:00Z`)) / 86_400_000);
}
