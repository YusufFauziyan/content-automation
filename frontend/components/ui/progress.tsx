import { cn } from '@/lib/utils';

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1 overflow-hidden rounded-full bg-white/8', className)}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300 ease-[var(--ease-house)]"
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}
