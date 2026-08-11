'use client';

import {
  cloneElement,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';

interface TooltipProps {
  label: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

const VIEWPORT_MARGIN = 8;

/** Wraps a single focusable child; shows the label on hover *and* keyboard focus.
 *
 * Centered under the trigger by default, then shifted just enough to stay within
 * the viewport when that would otherwise overflow it — computed from the
 * anchor's position and the tooltip's own (transform-independent) width, not
 * from the tooltip's current on-screen rect, so repeated hovers can't compound
 * a stale offset. A fixed left/right-anchor instead of this measurement would
 * only fix overflow for triggers on one edge and reintroduce it, mirrored, for
 * triggers on the other — this component has consumers on both edges of a row. */
export function Tooltip({ label, children }: TooltipProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [offset, setOffset] = useState(0);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    // Runs on mount too, not just when `visible` flips true: the tooltip span is
    // always in the DOM (opacity-0 when hidden, never display:none — see the
    // class name below), so its *resting* position already contributes to page
    // layout/scrollWidth even before anyone hovers it.
    if (!anchorRef.current || !tooltipRef.current) return;
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const tooltipWidth = tooltipRef.current.getBoundingClientRect().width;
    const anchorCenter = anchorRect.left + anchorRect.width / 2;
    const naturalLeft = anchorCenter - tooltipWidth / 2;
    const naturalRight = anchorCenter + tooltipWidth / 2;

    if (naturalRight > window.innerWidth - VIEWPORT_MARGIN) {
      setOffset(window.innerWidth - VIEWPORT_MARGIN - naturalRight);
    } else if (naturalLeft < VIEWPORT_MARGIN) {
      setOffset(VIEWPORT_MARGIN - naturalLeft);
    } else {
      setOffset(0);
    }
  }, [visible, label]);

  if (!isValidElement(children)) {
    return children;
  }

  const trigger = cloneElement(children, { 'aria-describedby': id });

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
      onPointerEnter={() => setVisible(true)}
      onPointerLeave={() => setVisible(false)}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={() => setVisible(false)}
    >
      {trigger}
      <span
        ref={tooltipRef}
        role="tooltip"
        id={id}
        style={{ transform: `translateX(calc(-50% + ${offset}px))` }}
        className={`pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-max max-w-56 text-center rounded-md bg-ink px-2 py-1 text-xs font-medium text-surface shadow-raised transition-opacity duration-150 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {label}
      </span>
    </span>
  );
}
