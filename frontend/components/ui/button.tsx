'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type Variant = 'default' | 'primary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  default: 'bg-rise border-white/10 text-dim hover:bg-lift hover:text-ink',
  primary:
    'bg-accent border-transparent text-on-accent hover:bg-accent-hi shadow-[0_6px_20px_-8px_rgba(124,92,255,.6)]',
  ghost: 'bg-transparent border-transparent text-dim hover:bg-rise hover:text-ink',
  danger: 'bg-err/12 border-err/25 text-err hover:bg-err/20',
  outline: 'bg-transparent border-white/12 text-dim hover:bg-rise hover:text-ink',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[11.5px] gap-1.5 rounded-[8px]',
  md: 'h-8 px-3 text-[12.5px] gap-2 rounded-[10px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'default', size = 'md', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center border font-medium whitespace-nowrap',
        'transition-[background-color,color,border-color,transform] duration-150',
        'active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
});
