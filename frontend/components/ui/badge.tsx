import { cn } from '@/lib/utils';
import type { StepStatus } from '@/lib/types';

const TONE: Record<string, string> = {
  idle: 'text-faint bg-white/5',
  running: 'text-accent-hi bg-accent/15',
  ok: 'text-ok bg-ok/12',
  warn: 'text-warn bg-warn/12',
  error: 'text-err bg-err/12',
};

export const STATUS_TONE: Record<StepStatus, keyof typeof TONE> = {
  PENDING: 'idle',
  RUNNING: 'running',
  SUCCEEDED: 'ok',
  FAILED: 'error',
  SKIPPED: 'idle',
};

export const STATUS_LABEL: Record<StepStatus, string> = {
  PENDING: 'Idle',
  RUNNING: 'Running',
  SUCCEEDED: 'Success',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};

export function Badge({
  tone = 'idle',
  pulse = false,
  children,
  className,
}: {
  tone?: keyof typeof TONE;
  pulse?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[10.5px] font-medium',
        TONE[tone],
        className,
      )}
    >
      <span className={cn('size-[5px] rounded-full bg-current', pulse && 'animate-status')} />
      {children}
    </span>
  );
}
