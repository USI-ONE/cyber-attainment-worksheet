'use client';

import { useEffect } from 'react';

/**
 * Active read-only enforcement on the client side.
 *
 * The CSS rules in globals.css set `pointer-events: none` and dim the
 * editable controls — but `pointer-events` blocks the MOUSE only. A user
 * can still Tab into a <select>, hit Space/Arrow to change the value,
 * and the React onChange fires (so the UI updates locally even though the
 * server 403s the save). The user sees "I changed the dropdown value"
 * and is confused.
 *
 * This component runs only when body[data-readonly="true"] is set and
 * installs capture-phase event listeners on document that:
 *   - call preventDefault() + stopPropagation() on mousedown / click /
 *     keydown / input / change events that target an editable control
 *   - so React's synthetic event handlers never see them
 *   - so no local state mutation happens, no "I changed the value but
 *     it didn't save" UX glitch
 *
 * It also actively sets the native `disabled` attribute on matching
 * elements after every render (via MutationObserver) for belt-and-
 * suspenders. Native `disabled` is the only foolproof way to make a
 * <select> non-interactive — once it's set, the browser refuses focus,
 * keyboard input, and click all by itself.
 *
 * Selectors must stay in sync with the read-only CSS rules in globals.css.
 * If you add a new editable surface to a component, prefer the
 * `.score-select` class so both this enforcer and the CSS pick it up
 * without further changes.
 */

const READ_ONLY_SELECTORS = [
  '.app-main .score-select',
  '.app-main .input-cell input',
  '.app-main .input-cell select',
  '.app-main .input-cell textarea',
  '.app-main .priority-select',
  '.app-main .status-select',
  '.app-main .action-btn.primary',
  '.app-main .action-btn.danger',
  '.app-main input[type="checkbox"]',
  '.app-main input[type="radio"]',
  '.app-main input[type="file"]',
];

function matchesAny(el: Element): boolean {
  for (const sel of READ_ONLY_SELECTORS) {
    if (el.matches(sel)) return true;
    if (el.closest(sel)) return true;
  }
  return false;
}

export default function ReadOnlyEnforcer() {
  useEffect(() => {
    if (document.body.getAttribute('data-readonly') !== 'true') return;

    // 1. Capture-phase event blocker. We use { capture: true } so we get
    //    the event BEFORE React's synthetic event system delegates it.
    function block(e: Event) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!matchesAny(target)) return;
      e.preventDefault();
      e.stopPropagation();
      // stopImmediatePropagation also kills sibling listeners on the same node.
      if ('stopImmediatePropagation' in e) e.stopImmediatePropagation();
    }
    const opts: AddEventListenerOptions = { capture: true };
    const events: (keyof DocumentEventMap)[] = [
      'mousedown', 'click', 'dblclick',
      'keydown', 'keypress',
      'input', 'change',
      'paste', 'cut', 'drop',
    ];
    for (const ev of events) document.addEventListener(ev, block, opts);

    // 2. Belt-and-suspenders: set the native `disabled` attribute on
    //    matching elements. Use a MutationObserver to re-apply after
    //    React renders, since React will overwrite the attribute when
    //    its diff doesn't include `disabled` in the prop set.
    function setDisabledFlag(root: ParentNode) {
      for (const sel of READ_ONLY_SELECTORS) {
        const els = root.querySelectorAll(sel);
        for (const el of els) {
          if (el instanceof HTMLInputElement ||
              el instanceof HTMLSelectElement ||
              el instanceof HTMLTextAreaElement ||
              el instanceof HTMLButtonElement) {
            if (!el.disabled) el.disabled = true;
          }
        }
      }
    }
    setDisabledFlag(document.body);

    const observer = new MutationObserver((mutations) => {
      // Throttle: just re-scan the whole body. React's diff cadence is
      // already throttled to animation frames, and the overhead of
      // querying ~10 selectors against a typical page DOM is < 1ms.
      let touched = false;
      for (const m of mutations) {
        if (m.type === 'childList' || m.type === 'attributes') {
          touched = true;
          break;
        }
      }
      if (touched) setDisabledFlag(document.body);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'class'],
    });

    return () => {
      for (const ev of events) document.removeEventListener(ev, block, opts);
      observer.disconnect();
    };
  }, []);
  return null;
}
