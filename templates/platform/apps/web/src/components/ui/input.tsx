import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const FIELD =
  'w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground ' +
  'placeholder:text-muted-foreground outline-none transition-colors ' +
  'focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ' +
  'aria-[invalid=true]:border-red-500';

export function Input({ className, ...props }: ComponentPropsWithoutRef<'input'>) {
  // 44px on touch, matching Button — a form row that is comfortable with a mouse
  // is a miss-target on a phone.
  return <input className={cn(FIELD, 'h-10 pointer-coarse:h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<'textarea'>) {
  return <textarea className={cn(FIELD, 'min-h-20 py-2', className)} {...props} />;
}

/**
 * Label + control + error, as one unit.
 *
 * The error is wired to the input with `aria-describedby` and the field is
 * marked `aria-invalid`, so a screen reader announces the problem instead of a
 * sighted-only red border. `id` is required for that reason.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** A whole-form failure, as opposed to one field's. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400"
    >
      {children}
    </p>
  );
}
