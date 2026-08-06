'use client';

import Link from 'next/link';

import type { NavItem } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * One row of navigation, in both sidebars.
 *
 * A screen that does not exist renders as a `<span>`, not a dimmed link: a
 * disabled anchor is still focusable and still followable by keyboard, which
 * makes "disabled" a lie told only to the mouse.
 */
export function NavRow({
  item,
  current,
  collapsed = false,
}: {
  item: NavItem;
  current: boolean;
  collapsed?: boolean;
}) {
  const shared = 'relative flex h-[34px] items-center gap-3 rounded-[10px] px-2.5 text-[13px]';

  if (item.comingSoon) {
    return (
      <span
        aria-disabled="true"
        title={`${item.label} is not built yet`}
        className={cn(shared, 'cursor-not-allowed text-faint/60')}
      >
        <item.icon size={16} strokeWidth={1.7} className="shrink-0" />
        <span className={cn('whitespace-nowrap transition-opacity', collapsed && 'opacity-0')}>
          {item.label}
        </span>
        {!collapsed ? (
          <span className="ml-auto rounded-full bg-white/5 px-1.5 text-[9.5px] text-faint/70">
            soon
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      className={cn(
        shared,
        'transition-colors',
        current ? 'bg-rise text-ink' : 'text-dim hover:bg-rise hover:text-ink',
      )}
    >
      {current ? <span className="absolute -left-2 top-2 bottom-2 w-[2.5px] rounded-r bg-accent" /> : null}
      <item.icon size={16} strokeWidth={1.7} className="shrink-0" />
      <span className={cn('whitespace-nowrap transition-opacity', collapsed && 'opacity-0')}>
        {item.label}
      </span>
    </Link>
  );
}
