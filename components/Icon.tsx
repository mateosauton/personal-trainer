import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Calendar from 'lucide-react-native/icons/calendar';
import Check from 'lucide-react-native/icons/check';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import House from 'lucide-react-native/icons/house';
import X from 'lucide-react-native/icons/x';

import { colors } from '@/lib/theme';

/**
 * Every icon in the app comes through here. Two reasons: the deep imports keep
 * lucide's 1,500-icon barrel out of the bundle, which the static web build
 * cares about, and a swap of icon set later touches one file rather than nine.
 */
export const icons = {
  home: House,
  plan: Calendar,
  close: X,
  back: ArrowLeft,
  check: Check,
  prev: ChevronLeft,
  next: ChevronRight,
} as const;

export type IconName = keyof typeof icons;

/**
 * Stroke 2 at 24px is lucide's own grid; the smaller sizes below thicken it a
 * touch so the line does not disappear against the near-black ground.
 */
export function Icon({
  name,
  size = 24,
  color = colors.text,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const Glyph = icons[name];
  return <Glyph size={size} color={color} strokeWidth={size < 20 ? 2.4 : 2} />;
}
