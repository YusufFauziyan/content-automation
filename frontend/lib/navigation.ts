import {
  CalendarClock,
  History,
  Send,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  ScrollText,
  Settings,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /**
   * Screens that do not exist yet.
   *
   * Shown, because hiding them would leave no sign the product intends to have
   * them — but not clickable, because a link that lands on an apology is worse
   * than one that plainly says "not yet".
   */
  readonly comingSoon?: boolean;
}

/**
 * The one navigation list.
 *
 * Declared here rather than in each sidebar so the editor and the rest of the
 * app cannot disagree about what exists — they did, and the editor's copy
 * pointed every entry at `#`.
 */
export const MAIN_NAV: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/workflows', label: 'Workflows', icon: Workflow },
  { href: '/uploads', label: 'Uploads', icon: Send },
  { href: '/logs', label: 'Logs', icon: ScrollText },
  { href: '/executions', label: 'Executions', icon: History, comingSoon: true },
  { href: '/schedules', label: 'Schedules', icon: CalendarClock },
  { href: '/credentials', label: 'Credentials', icon: KeyRound },
];

export const FOOTER_NAV: readonly NavItem[] = [
  { href: '/settings', label: 'Settings', icon: Settings, comingSoon: true },
  { href: '/help', label: 'Help', icon: LifeBuoy, comingSoon: true },
];

/** True when `pathname` is the item's page or a page beneath it. */
export const isCurrent = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);
