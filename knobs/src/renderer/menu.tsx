import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './ui';

export interface MenuItem {
  label: string;
  value: string;
  hint?: string;
  active?: boolean;
  checked?: boolean;
  disabled?: boolean;
}

/** Small dropdown: button + popover list. Closes on outside click or Escape. */
export function Menu(props: { icon?: string; label?: ComponentChildren; title: string; items: MenuItem[]; onSelect: (v: string) => void; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Layout effect: listeners must exist as soon as the popover is on screen, or an Escape
  // pressed in the first frame is lost (plain effects run a frame later).
  useLayoutEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('blur', close);
    };
  }, [open]);
  return (
    <div class="menu" ref={ref}>
      <button class={`ibtn ${open ? 'active' : ''}`} title={props.title} aria-label={props.title} aria-expanded={open} onClick={() => setOpen(!open)}>
        {props.icon && <Icon name={props.icon} />}
        {props.label}
      </button>
      {open && (
        <div class={`menu-pop ${props.align === 'left' ? 'left' : ''}`} role="menu">
          {props.items.map((it) => (
            <button
              key={it.value}
              role="menuitem"
              class={`menu-item ${it.active ? 'active' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                props.onSelect(it.value);
              }}
            >
              {it.checked !== undefined && <span class={`check ${it.checked ? 'on' : ''}`}>{it.checked && <Icon name="check" size={12} />}</span>}
              <span class="menu-label">{it.label}</span>
              {it.hint && <span class="menu-hint">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
