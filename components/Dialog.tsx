"use client";
// The one dialog frame of the Rome app UI guide (the DEX's Dialog.tsx): a serif title on the left, a square close button with an icon top right,
// Escape and a click on the dimmed ground close it, Tab stays inside, focus goes in and comes back, and the page behind does not scroll.
// Every dialog of the app (the action window, liquidation, E-mode, the wallet chooser) is this component and only fills the body.
// `dismissOnGround={false}` is for a review/confirm window that ends in a signature: a stray click on the ground never throws away what was typed.
// `dismissible={false}` is for a window that is moving money: Escape does nothing either. The close button always works.
// It renders into document.body: a blurred header or card (backdrop-filter) would otherwise become the containing block of its fixed layer.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "@/components/icons";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, onClose, testid, closeTestid, children, dismissible = true, dismissOnGround = true, icon, width }: {
  title: string; onClose: () => void; testid: string; closeTestid?: string; children: ReactNode; dismissible?: boolean; dismissOnGround?: boolean;
  /** A small mark before the title (an asset, a lane). */ icon?: ReactNode; /** Maximum width in px (the frame is 420 by default). */ width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Read while rendering: a field inside the window may focus itself in its own effect, which runs before this one, and then it is not the control to return to.
  const [before] = useState<HTMLElement | null>(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  const onCloseRef = useRef(onClose);
  const dismissRef = useRef(dismissible);
  onCloseRef.current = onClose;
  dismissRef.current = dismissible;

  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus]");
    if (first || !panel.current?.contains(document.activeElement)) (first ?? panel.current)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (dismissRef.current) { e.stopPropagation(); onCloseRef.current(); } return; }
      if (e.key !== "Tab" || !panel.current) return;
      // Tab stays inside the window: from the last control it goes to the first, from the first (or the window itself) with Shift to the last.
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
      if (!items.length) { e.preventDefault(); panel.current.focus(); return; }
      const head = items[0], last = items[items.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === head || at === panel.current || !panel.current.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !panel.current.contains(at))) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [before]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="confirm-modal-overlay" onMouseDown={(e) => { if (dismissible && dismissOnGround && e.target === e.currentTarget) { e.preventDefault(); onClose(); } }}>
      <div ref={panel} tabIndex={-1} className="confirm-modal dlg" data-testid={testid} role="dialog" aria-modal="true" aria-labelledby={titleId} style={width ? { maxWidth: width } : undefined}>
        <div className="dlg-head">
          <div className="dlg-title">{icon ? <span className="dlg-icon" aria-hidden="true">{icon}</span> : null}<h3 id={titleId}>{title}</h3></div>
          <button type="button" className="dlg-close" data-testid={closeTestid ?? `${testid}-close`} aria-label="Close" onClick={onClose}><IconClose size={16} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
