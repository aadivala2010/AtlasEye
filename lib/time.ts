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

/**
 * The GIBS date to ask for today's clouds: yesterday, UTC — the most recent *complete* global
 * composite, and what NASA Worldview itself opens on. GIBS's `default` means "latest date that
 * exists", which is the day currently being flown: a polar orbiter has only swathed part of the
 * globe so far, the rest of that day's tiles come back empty, and the boundary lands as a hard
 * seam down the middle of the planet.
 */
export const cloudsDate = (now = Date.now()) => {
  // Just after UTC midnight the previous day's own last (westernmost) swaths can still be in NRT
  // processing, which would put the same seam a day back; hold on the day before until they land.
  const back = new Date(now).getUTCHours() < 4 ? 48 : 24;
  return new Date(now - back * 3600_000).toISOString().slice(0, 10);
};
