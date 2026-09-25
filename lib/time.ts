const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock time in a zone: { time: "03:47:12", offset: "GMT+9" }. */
export function zonedClock(date: Date, timeZone: string): { time: string; offset: string } {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  const offset = get('timeZoneName').replace('GMT', 'UTC');
  return { time: `${get('hour')}:${get('minute')}:${get('second')}`, offset: offset === 'UTC' ? 'UTC±0' : offset };
}

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const utcClock = (date: Date) => date.toISOString().slice(11, 19);
