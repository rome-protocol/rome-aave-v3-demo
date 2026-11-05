"use client";
// The tooltip of the Rome app UI guide (section 1; the DEX's Tooltip.tsx): shows on hover and keyboard focus, read by screen readers through
// aria-describedby. A long caveat goes here instead of a line of its own. `cue` marks a figure that carries a note with a faint dotted underline.
import { cloneElement, isValidElement, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

export function Tip({ text, children, align = "center", block = false, focusable = false, cue = false, place = "above" }: {
  text?: string | null; children: ReactNode; align?: "center" | "start" | "end"; block?: boolean; focusable?: boolean; cue?: boolean;
  /** Where the bubble opens. "below" is for a trigger at the top of the screen (the header); "above" flips to below by itself when there is no room. */
  place?: "above" | "below";
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const bubble = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  const [flip, setFlip] = useState(false);
  // Keep the bubble on screen whatever the position of its trigger: measure on open and nudge it into the viewport (16 px gutter).
  useLayoutEffect(() => {
    if (!open) { setShift(0); setFlip(false); return; }
    const el = bubble.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (place === "above" && !flip && r.top < 8) { setFlip(true); return; }
      const vw = document.documentElement.clientWidth;
      const base = { left: r.left - shift, right: r.right - shift };
      let next = 0;
      if (base.right > vw - 16) next = vw - 16 - base.right;
      if (base.left + next < 16) next = 16 - base.left;
      if (Math.abs(next - shift) > 0.5) setShift(next);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, shift, text, place, flip]);
  if (!text) return <span className={`tip${block ? " tip-block" : ""}`}>{children}</span>;
  const inner = !focusable && isValidElement(children) && typeof children.type === "string" ? (children as ReactElement<Record<string, unknown>>) : null;
  const describedBy = open ? id : undefined;
  return (
    <span className={`tip${block ? " tip-block" : ""}${cue ? " tip-cue" : ""}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
      aria-describedby={inner ? undefined : describedBy} tabIndex={focusable ? 0 : undefined}>
      {inner ? cloneElement(inner, { "aria-describedby": describedBy ?? inner.props["aria-describedby"] }) : children}
      {open && <span id={id} ref={bubble} role="tooltip" className={`tip-bubble tip-${align}${place === "below" || flip ? " tip-below" : ""}`} data-testid="tooltip" style={shift ? { translate: `${shift}px 0` } : undefined}>{text}</span>}
    </span>
  );
}

/** A small "?" that carries a tooltip, for a caveat that belongs to a whole row or sentence, not one figure. */
export function Hint({ text, align = "start" }: { text: string; align?: "center" | "start" | "end" }) {
  return (
    <Tip text={text} align={align} focusable>
      <span className="hint" aria-label="More info" role="img">?</span>
    </Tip>
  );
}
