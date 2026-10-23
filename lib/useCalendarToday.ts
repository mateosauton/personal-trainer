import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { calendarDayKey, validTimeZone } from './calendar-days';

/** Wake exactly at the next home-calendar boundary, including short/long DST days. */
export function useCalendarToday(homeTimezone: string | undefined): string {
  const zone = validTimeZone(homeTimezone);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timeout);
      const now = new Date();
      setClock(now);
      const today = calendarDayKey(now, zone);
      let low = now.getTime();
      let high = low + 27 * 60 * 60 * 1000;
      while (high - low > 1000) {
        const middle = Math.floor((low + high) / 2);
        if (calendarDayKey(new Date(middle), zone) === today) low = middle;
        else high = middle;
      }
      timeout = setTimeout(schedule, high - now.getTime() + 10);
    };
    schedule();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') schedule();
    });
    return () => { clearTimeout(timeout); subscription.remove(); };
  }, [zone]);
  return calendarDayKey(clock, zone);
}
