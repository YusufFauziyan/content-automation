'use client';

import { Clapperboard, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { RecentRuns } from '@/components/sidebar-runs';
import { ThemeToggle } from '@/components/theme-toggle';
import { NavRow } from '@/components/ui/nav-item';
import { FOOTER_NAV, isCurrent, MAIN_NAV } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const [rail, setRail] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col overflow-hidden border-r border-white/6 bg-base',
        'transition-[width] duration-250 ease-[var(--ease-house)]',
        rail ? 'w-[60px]' : 'w-[228px]',
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-3.5">
        <Link
          href="/workflows"
          title="Back to the workflow list"
          className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-gradient-to-br from-node-ai to-accent shadow-[0_4px_14px_-4px_rgba(124,92,255,.6)]"
        >
          <Clapperboard size={14} className="text-on-accent" strokeWidth={2.2} />
        </Link>
        <button
          onClick={() => setRail((v) => !v)}
          aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'min-w-0 text-left transition-opacity',
            rail && 'pointer-events-none opacity-0',
          )}
        >
          <span className="block whitespace-nowrap text-[13.5px] font-semibold tracking-[-0.015em]">
            Yu-tomation
          </span>
          <span className="block whitespace-nowrap text-[10px] text-faint">Studio workspace</span>
        </button>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto px-2 pb-2">
        <nav className="flex flex-col gap-px">
          {MAIN_NAV.map((item) => (
            <NavRow
              key={item.href}
              item={item}
              current={isCurrent(pathname, item.href)}
              collapsed={rail}
            />
          ))}
        </nav>

        <RecentRuns collapsed={rail} />
      </div>

      <div className="flex flex-col gap-px border-t border-white/6 p-2">
        {FOOTER_NAV.map((item) => (
          <NavRow
            key={item.href}
            item={item}
            current={isCurrent(pathname, item.href)}
            collapsed={rail}
          />
        ))}
        <ThemeToggle collapsed={rail} />
        <button
          onClick={() => void signOut()}
          className="flex h-[34px] items-center gap-3 rounded-[10px] px-2.5 text-[13px] text-dim transition-colors hover:bg-rise hover:text-ink"
        >
          <LogOut size={16} strokeWidth={1.7} className="shrink-0" />
          <span className={cn('whitespace-nowrap transition-opacity', rail && 'opacity-0')}>
            Sign out
          </span>
        </button>
      </div>
    </aside>
  );
}
