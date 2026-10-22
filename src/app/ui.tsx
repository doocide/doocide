import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';

/** Source code. Releases are published to doocide/doocide.github.io, served at https://doocide.github.io */
export const REPO_URL = 'https://github.com/doocide/doocide';

const PATHS: Record<string, string> = {
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  up: 'M18 15l-6-6-6 6',
  down: 'M6 9l6 6 6-6',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  link: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  people: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M16 5a3 3 0 010 6M21 20a6 6 0 00-4-5.6',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  contrast: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 3v18M12 7h4M12 11h5M12 15h4',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18',
  file: 'M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8zM14 3v5h5',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  template: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  check: 'M5 12l5 5L20 7',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  note: 'M5 4h14v12l-4 4H5zM15 20v-4h4',
  trophy: 'M8 4h8v5a4 4 0 01-8 0zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 21h8M10 17h4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  folder: 'M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z',
  refresh: 'M20 12a8 8 0 11-2.3-5.7M20 4v5h-5',
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog wide' : 'dialog'}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-inner">
        <header className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </dialog>
  );
}

export function Stars({ value, onChange, readOnly, label }: { value: number; onChange: (v: number) => void; readOnly?: boolean; label: string }) {
  return (
    <div className="stars" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t(`weight.${n}`)}
          title={t(`weight.${n}`)}
          className={n <= value ? 'star on' : 'star'}
          disabled={readOnly}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  readOnly,
}: {
  value: T | undefined;
  options: { value: T; label: string; title?: string; tone?: 'good' | 'bad' }[];
  onChange: (v: T) => void;
  label: string;
  readOnly?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title ?? o.label}
          className={[value === o.value ? 'on' : '', o.tone ?? ''].join(' ')}
          disabled={readOnly}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: string;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

export function Menu({ label, items, icon = 'more' }: { label: string; items: MenuItem[]; icon?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className="icon-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={icon} />
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items
            .filter((i) => !i.hidden)
            .map((item) => (
              <button
                key={item.label}
                role="menuitem"
                className={item.danger ? 'danger' : ''}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon && <Icon name={item.icon} size={18} />}
                {item.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}

type Ask = (request: ConfirmRequest) => Promise<boolean>;
const ConfirmContext = createContext<Ask>(async () => false);

/**
 * In-app confirmation. The browser's built-in confirm box can be silently suppressed: Chrome was
 * seen returning "cancel" in 1 ms without showing anything (Safari showed it), so Doocide never
 * uses it.
 */
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmHost({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);
  const ask: Ask = useCallback((request) => new Promise<boolean>((resolve) => setPending({ ...request, resolve })), []);
  const answer = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <Dialog title={pending.title} onClose={() => answer(false)}>
          <p>{pending.message}</p>
          <div className="actions">
            <button className="button" onClick={() => answer(false)}>
              {t('common.cancel')}
            </button>
            <button className={pending.danger ? 'button danger-solid' : 'button primary'} autoFocus onClick={() => answer(true)}>
              {pending.confirmLabel}
            </button>
          </div>
        </Dialog>
      )}
    </ConfirmContext.Provider>
  );
}

type Toast = (message: string) => void;
const ToastContext = createContext<Toast>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show: Toast = (m) => {
    setMessage(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3200);
  };
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast" role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function Logo() {
  return (
    <span className="logo" aria-label="Doocide">
      {/* Three sliders settle into a check; the winner is a green confirm button. */}
      <svg width="36" height="36" viewBox="0 0 120 120" aria-hidden="true">
        <path className="logo-track" d="M30 16v88M60 16v88M90 16v88" strokeWidth="6" strokeLinecap="round" />
        <path className="logo-line" d="M30 64L60 88L90 34" fill="none" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <circle className="logo-knob" cx="30" cy="64" r="10" strokeWidth="5" />
        <circle className="logo-knob" cx="60" cy="88" r="10" strokeWidth="5" />
        <circle className="logo-badge" cx="90" cy="34" r="15" />
        <path d="M83 34l5 5l9-10" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="logo-word">doocide</span>
    </span>
  );
}
