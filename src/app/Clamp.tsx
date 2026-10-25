// Long descriptions, cut to two lines with "…" (`.clamp` in the stylesheet); short ones show as they
// are. In the grid, pointing at cut text shows all of it at once, and the details dialog (the "…"
// button) always has it in full, on touch screens too. The decision's own description gets
// "Show more" / "Show less", or a dialog when it's very long, so the grid keeps its room.

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { t } from '../i18n';
import { useHoverTip } from './controls';
import { Dialog } from './ui';

/** Past this many lines, the decision's description opens in a dialog instead of growing in place. */
const IN_PLACE_LINES = 8;

/**
 * How text cut to its line limit fits: whether some of it is hidden, and how many lines it takes in
 * full. Measured after layout, and again whenever the element is resized.
 */
export function useCut(ref: RefObject<HTMLElement | null>, text: string): { cut: boolean; lines: number } {
  const [fit, setFit] = useState({ cut: false, lines: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.45;
      const cut = el.scrollHeight > el.clientHeight + 1;
      const lines = Math.round(el.scrollHeight / lineHeight);
      setFit((f) => (f.cut === cut && f.lines === lines ? f : { cut, lines }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, text]);
  return fit;
}

/** Someone's text cut to two lines; pointing at it shows all of it at once when some is hidden. */
export function ClampedText({ text, lang, className }: { text: string; lang: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { cut } = useCut(ref, text);
  const hover = useHoverTip(cut ? text : undefined, lang);
  return (
    <div ref={ref} className={className ? `clamp ${className}` : 'clamp'} dir="auto" lang={lang} {...hover.props}>
      {text}
      {hover.tip}
    </div>
  );
}

/** The decision's description: two lines, then "Show more" for the rest, in place or, when it's very long, in a dialog. */
export function DescriptionText({ text, lang }: { text: string; lang: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const { cut, lines } = useCut(ref, text);
  const toggle = () => {
    if (open) setOpen(false);
    else if (lines > IN_PLACE_LINES) setDialog(true);
    else setOpen(true);
  };
  return (
    <div className="description">
      <p ref={ref} className={open ? 'description-text' : 'description-text clamp'} dir="auto" lang={lang}>
        {text}
      </p>
      {(cut || open) && (
        <button className="link-button small" aria-expanded={open} onClick={toggle}>
          {open ? t('common.showLess') : t('common.showMore')}
        </button>
      )}
      {dialog && (
        <Dialog title={t('detail.description')} onClose={() => setDialog(false)}>
          <p className="description-full" dir="auto" lang={lang}>
            {text}
          </p>
        </Dialog>
      )}
    </div>
  );
}
