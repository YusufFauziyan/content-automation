'use client';

import { AlertCircle, Check, Info, X } from 'lucide-react';

import { useRun } from '@/lib/store';
import { cn } from '@/lib/utils';

const ICON = { ok: Check, error: AlertCircle, info: Info };
const TONE = {
  ok: 'border-ok/30 text-ok',
  error: 'border-err/30 text-err',
  info: 'border-accent/30 text-accent-hi',
};

export function Toasts() {
  const { toasts, dismiss } = useRun();

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-[12px] border bg-base/95 px-3.5 py-3 shadow-[0_10px_40px_-12px_var(--shadow-modal)] backdrop-blur-xl',
              TONE[t.tone],
            )}
          >
            <Icon size={15} className="mt-px shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-ink">{t.message}</p>
              {t.hint ? <p className="mt-0.5 text-[11px] text-faint">{t.hint}</p> : null}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-faint hover:text-ink"
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
