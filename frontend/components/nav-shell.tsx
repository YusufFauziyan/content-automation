'use client';

import {
  CalendarClock,
  Clapperboard,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  ScrollText,
  Settings,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { RecentRuns } from '@/components/sidebar-runs';
import { ThemeToggle } from '@/components/theme-toggle';
import { NavRow } from '@/components/ui/nav-item';
import { FOOTER_NAV, isCurrent, MAIN_NAV } from '@/lib/navigation';


/**
 * Chrome for the pages that are read rather than operated.
 *
 * The editor deliberately does not use this: it owns the whole viewport and has
 * its own top bar, because a canvas competing with page chrome for space serves
 * neither.
 */
export function NavShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-void text-ink">
      <aside className="flex w-[228px] shrink-0 flex-col border-r border-white/6 bg-base">
        <Link href="/dashboard" className="flex h-14 shrink-0 items-center gap-2.5 px-3.5">
          <span className="grid size-7 place-items-center rounded-[9px] bg-gradient-to-br from-node-ai to-accent">
            <Clapperboard size={14} className="text-on-accent" strokeWidth={2.2} />
          </span>
          <span>
            <span className="block text-[13.5px] font-semibold tracking-[-0.015em]">Yu-tomation</span>
            <span className="block text-[10px] text-faint">Studio workspace</span>
          </span>
        </Link>

        <div className="flex flex-1 flex-col overflow-y-auto px-2 pb-2">
          <nav className="flex flex-col gap-px">
            {MAIN_NAV.map((item) => (
              <NavRow key={item.href} item={item} current={isCurrent(pathname, item.href)} />
            ))}
          </nav>

          <RecentRuns />
        </div>

        <div className="flex flex-col gap-px border-t border-white/6 p-2">
          {FOOTER_NAV.map((item) => (
            <NavRow key={item.href} item={item} current={isCurrent(pathname, item.href)} />
          ))}
          <ThemeToggle />
          <button
            onClick={() => void signOut()}
            className="flex h-[34px] items-center gap-3 rounded-[10px] px-2.5 text-[13px] text-dim transition-colors hover:bg-rise hover:text-ink"
          >
            <LogOut size={16} strokeWidth={1.7} className="shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/** Page heading used by every screen inside the shell. */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-white/6 px-8 py-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-[-0.022em]">{title}</h1>
        {subtitle ? <p className="mt-1 text-[12.5px] text-dim">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}
