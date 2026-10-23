import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { resolveAvatar } from './avatar';

/** Cache only the object reference; refresh short-lived access while displayed. */
export function useAvatar(value: string | null, owner: string | null): string | null {
  const [resolved, setResolved] = useState<{ value: string; owner: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!value || !owner) return;
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      const url = await resolveAvatar(value, owner);
      if (active && revision === current) setResolved({ value, owner, url });
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 240_000);
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { active = false; clearInterval(timer); foreground.remove(); };
  }, [value, owner]);
  return resolved?.value === value && resolved.owner === owner ? resolved.url : null;
}
