'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { applyTheme, currentTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * Switches between the two themes.
 *
 * Starts as `null` rather than guessing: the server cannot know which theme the
 * browser resolved, and rendering a moon that flips to a sun on hydration is
 * the flash this whole arrangement exists to avoid. One frame with no icon is
 * cheaper than one frame with the wrong one.
 */
export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => setTheme(currentTheme()), []);

  const next: Theme = theme === 'light' ? 'dark' : 'light';

  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      className="flex h-[34px] items-center gap-3 rounded-[10px] px-2.5 text-[13px] text-dim transition-colors hover:bg-rise hover:text-ink"
    >
      <span className="grid size-4 shrink-0 place-items-center">
        {theme === null ? null : theme === 'light' ? (
          <Moon size={16} strokeWidth={1.7} />
        ) : (
          <Sun size={16} strokeWidth={1.7} />
        )}
      </span>
      <span className={cn('whitespace-nowrap transition-opacity', collapsed && 'opacity-0')}>
        {theme === null ? 'Theme' : theme === 'light' ? 'Dark' : 'Light'}
      </span>
    </button>
  );
}
