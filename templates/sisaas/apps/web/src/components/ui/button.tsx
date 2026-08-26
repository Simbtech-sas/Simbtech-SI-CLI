import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  // The single accent lives here: primary actions only.
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'border border-border bg-card text-foreground hover:bg-accent',
  ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
  danger: 'text-red-600 hover:bg-accent dark:text-red-400',
};
// Touch devices get the 44px minimum; mouse users keep the tighter density.
// `pointer-coarse:` is Tailwind's `@media (pointer: coarse)`.
const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs pointer-coarse:h-11 pointer-coarse:px-4 pointer-coarse:text-sm',
  md: 'h-10 gap-2 px-4 text-sm pointer-coarse:h-11',
};

type Props = {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
} & ComponentPropsWithoutRef<'button'>;

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...props
}: Props) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center rounded-lg font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}
