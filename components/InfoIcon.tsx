'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { METRIC_DEFINITIONS } from '@/lib/metric-definitions';

/**
 * Small "i" badge that reveals a metric's definition + calculation on
 * hover (mouse) or focus (keyboard). Also toggles on click so touch
 * devices work without a native hover.
 *
 * Content lives in lib/metric-definitions.ts keyed by metricId; the
 * icon is a no-op when the id is unknown so unlinked callers do not
 * crash a render.
 *
 * The tooltip positions itself above the icon by default. On the last
 * KPI tile the tooltip would clip the right edge of the viewport — we
 * flip its anchor to the right in that case (aria-controlled via the
 * `align` prop).
 */
export default function InfoIcon({
  metricId,
  align = 'left',
  size = 14,
}: {
  metricId: string;
  /** Anchor the tooltip to the icon's left or right edge. */
  align?: 'left' | 'right';
  /** Icon diameter in pixels. Font auto-scales. */
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const def = METRIC_DEFINITIONS[metricId];

  // Close on Escape when the icon has focus, and on any outside click
  // (clicks on the icon itself are handled by the button's onClick).
  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onEsc);
    document.addEventListener('mousedown', onDocClick);
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [open]);

  if (!def) return null;

  return (
    <span
      ref={wrapRef}
      className="info-icon-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={{ display: 'inline-flex', position: 'relative', marginLeft: 4, verticalAlign: 'middle' }}
    >
      <button
        type="button"
        className="info-icon"
        aria-label={`Definition of ${def.label}`}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        style={{
          width: size, height: size,
          fontSize: Math.max(9, Math.round(size * 0.72)),
          fontFamily: 'Inter, sans-serif', fontWeight: 700, fontStyle: 'italic',
          background: 'var(--bg-deep, #f8fafc)',
          color: 'var(--text-muted, #64748b)',
          border: '1px solid var(--bg-border, #cbd5e1)',
          borderRadius: '50%',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'help', padding: 0, lineHeight: 1,
        }}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="info-tooltip"
          style={{
            position: 'absolute',
            bottom: `calc(100% + 8px)`,
            [align === 'right' ? 'right' : 'left']: 0,
            zIndex: 30,
            width: 320,
            padding: '10px 12px 12px',
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--bg-border, #cbd5e1)',
            borderRadius: 4,
            boxShadow: '0 6px 16px rgba(15,23,42,0.15)',
            fontSize: 12, lineHeight: 1.5,
            color: 'var(--text, #1e293b)',
            textAlign: 'left', textTransform: 'none', letterSpacing: 0,
            fontWeight: 400, whiteSpace: 'normal',
            cursor: 'default',
          }}
        >
          <div style={{
            fontWeight: 700, fontSize: 12, color: 'var(--text, #1e293b)',
            marginBottom: 4,
          }}>
            {def.label}
          </div>
          <div style={{ color: 'var(--text-mid, #475569)' }}>
            {def.definition}
          </div>
          {def.formula && (
            <div style={{
              marginTop: 8, padding: '6px 8px',
              background: 'var(--bg-deep, #f8fafc)',
              border: '1px solid var(--bg-border, #e2e8f0)',
              borderRadius: 2,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 11, color: 'var(--text, #0f172a)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {def.formula}
            </div>
          )}
          {def.interpretation && (
            <div style={{
              marginTop: 8,
              fontSize: 11, color: 'var(--text-muted, #64748b)',
              fontStyle: 'italic',
            }}>
              {def.interpretation}
            </div>
          )}
          <div style={{
            marginTop: 10, paddingTop: 8,
            borderTop: '1px solid var(--bg-border, #e2e8f0)',
            fontSize: 11,
          }}>
            <Link
              href={'/definitions' as never}
              style={{ color: 'var(--gold, #b45309)', fontWeight: 600, textDecoration: 'none' }}
            >
              View all definitions →
            </Link>
          </div>
        </span>
      )}
    </span>
  );
}
