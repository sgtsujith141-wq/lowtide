import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';

/*
 * Buttons (v2 PHASE 011). One height per size, one radius. `primary` is the
 * single filled action on a screen (off-white on graphite, ink on paper in
 * the light theme); everything else is quiet. Disabled buttons stay legible:
 * their text uses the subtle colour instead of fading the whole control.
 */
const base =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-[background-color,border-color,color] duration-150 select-none disabled:cursor-not-allowed';

const sizes = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-8 px-3 text-[13px]',
} as const;

const variants = {
  primary:
    'bg-primary text-on-primary hover:bg-primary/85 disabled:bg-hover disabled:text-fg-subtle',
  quiet:
    'border border-line-strong bg-raised text-fg hover:border-fg-subtle/60 hover:bg-hover disabled:border-line disabled:bg-surface disabled:text-fg-subtle',
  ghost: 'text-fg-muted hover:bg-hover hover:text-fg disabled:text-fg-subtle',
  danger:
    'border border-danger/40 text-danger hover:border-danger/70 hover:bg-danger/10 disabled:border-line disabled:text-fg-subtle',
} as const;

type ButtonProps = ComponentProps<'button'> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function Button({
  variant = 'quiet',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Accessible name; also shown as a tooltip. */
  label: string;
  icon: ReactNode;
};

/** Square icon-only button. Always has an accessible name. */
export function IconButton({
  label,
  icon,
  className = '',
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`grid size-8 shrink-0 place-items-center rounded-md text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:text-fg-subtle disabled:hover:bg-transparent ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
}
