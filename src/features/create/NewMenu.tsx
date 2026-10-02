import {
  FileText,
  Folder,
  FolderKanban,
  Gavel,
  Lightbulb,
  ListTodo,
  Plus,
  Table2,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CREATE_KINDS, CREATE_LABEL, useCreate, type CreateKind } from './create-context';

const ICON: Record<CreateKind, LucideIcon> = {
  task: ListTodo,
  project: FolderKanban,
  page: FileText,
  folder: Folder,
  database: Table2,
  hackathon: Trophy,
  idea: Lightbulb,
  decision: Gavel,
};

/**
 * The one global way to make something (v2.1): a labelled New button in the
 * rail (and the phone bar) that opens a short menu. Arrow keys move, Enter
 * chooses, Escape closes and returns focus to the button.
 */
export function NewMenu() {
  const { openCreate } = useCreate();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = (at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        title="New: task, project, page, folder…"
        className={`flex h-9 items-center gap-1 rounded-md bg-primary px-2.5 text-[13px] font-medium text-on-primary transition-colors hover:bg-primary/85 md:h-11 md:w-10 md:flex-col md:justify-center md:gap-0.5 md:px-0 md:text-[10px]`}
      >
        <Plus aria-hidden className="size-4" strokeWidth={2.25} />
        <span className="max-[359px]:sr-only">New</span>
      </button>
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label="New"
        hidden={!open}
        onKeyDown={onKey}
        className="lt-pop absolute top-full left-0 z-40 mt-2 w-56 rounded-lg bg-raised p-1.5 shadow-[var(--lt-shadow)] md:top-0 md:left-full md:mt-0 md:ml-3"
      >
        {CREATE_KINDS.map((kind) => {
          const Icon = ICON[kind];
          return (
            <button
              key={kind}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                openCreate(kind);
              }}
              className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg focus:bg-hover focus:text-fg"
            >
              <Icon aria-hidden className="size-4" strokeWidth={1.75} />
              {CREATE_LABEL[kind]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
