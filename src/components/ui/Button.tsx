import type { ButtonHTMLAttributes, ReactNode } from 'react';

const base =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const variants = {
  primary: 'bg-accent-ink text-on-accent hover:brightness-110',
  quiet: 'border border-line bg-paper-raised text-ink hover:border-line-strong',
  ghost: 'text-ink-muted hover:bg-paper-sunken hover:text-ink',
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
};

export function Button({
  variant = 'quiet',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return <button type={type} className={`${base} ${variants[variant]} ${className}`} {...props} />;
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
      className={`grid size-8 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-paper-sunken hover:text-ink disabled:opacity-50 ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
}
