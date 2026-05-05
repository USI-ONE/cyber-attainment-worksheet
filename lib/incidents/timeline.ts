/**
 * Timeline parsing helpers shared between the IncidentEditor textarea and the
 * IncidentReport PDF renderer. Goal: be lenient about how a user types a
 * timeline entry (we used to require a pipe separator, which nobody read), so
 * "5/4/2026, 5:12 PM (MT) — Spoofed email…" is recognized as
 * { at: "5/4/2026, 5:12 PM (MT)", event: "Spoofed email…" }
 * even when stored without an explicit separator.
 */
import type { IncidentTimelineEntry } from '@/lib/supabase/types';

// Date-or-time-prefix regex used when there is no explicit separator. Matches:
//   - "5/4/2026", "05/04/2026", "5-4-2026", "2026-05-04"
//   - optional ", " then a time like "5:12 PM" or "5 PM" or "5:12 PM (MT)"
//   - optional second "—HH:MM"
// Conservative on what counts as a prefix to avoid eating the start of a
// genuine narrative sentence.
const DATETIME_PREFIX_RE =
  /^(\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}(?:,?\s+(?:about\s+)?\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)(?:\s*\([^)]+\))?)?(?:\s*[–—-]\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?(?:\s*[A-Z]{2,4})?)?)\s+/;

// Explicit separators (with surrounding whitespace) we recognize between a
// date prefix and the event body.
const SEPARATORS: RegExp[] = [
  /\s+—\s+/,    // em-dash
  /\s+–\s+/,    // en-dash
  /\s+--\s+/,   // double hyphen
  /\s+\|\s+/,   // pipe (the canonical write-back format)
];

export function splitTimelineEntry(entry: IncidentTimelineEntry): IncidentTimelineEntry {
  if (entry.at && entry.at.trim()) return entry;
  if (!entry.event) return entry;

  // 1. Try explicit separator: "<digit-prefix><sep><body>".
  for (const sep of SEPARATORS) {
    const m = entry.event.match(sep);
    if (m && m.index != null && m.index > 0) {
      const prefix = entry.event.slice(0, m.index);
      // Require the prefix to contain at least one digit and stay short — a
      // long prefix is more likely to be the start of a narrative than a
      // timestamp.
      if (/\d/.test(prefix) && prefix.length <= 80) {
        return {
          at: prefix.trim(),
          event: entry.event.slice(m.index + m[0].length).trim(),
        };
      }
    }
  }

  // 2. No separator — try to recognize a date/time at the start of the line.
  const dt = entry.event.match(DATETIME_PREFIX_RE);
  if (dt) {
    const rest = entry.event.slice(dt[0].length).trim();
    if (rest) return { at: dt[1].trim(), event: rest };
  }

  return entry;
}

/** Apply splitTimelineEntry to every entry in a timeline array. */
export function normalizeTimeline(entries: IncidentTimelineEntry[]): IncidentTimelineEntry[] {
  return entries.map(splitTimelineEntry);
}

/** Render a timeline as canonical "<at> | <event>" textarea text. Entries
 *  with no explicit at are passed through with the event-only form so the
 *  textarea round-trips edits without injecting fake timestamps. */
export function timelineToText(timeline: IncidentTimelineEntry[]): string {
  return timeline.map((e) => (e.at ? `${e.at} | ${e.event}` : e.event)).join('\n');
}

/** Parse "<at> | <event>" textarea text. Falls back to splitTimelineEntry's
 *  smart heuristics when no pipe is present, so users can also type
 *  "5/4/2026, 5:12 PM — Spoofed email…" and get the right split on save. */
export function textToTimeline(s: string): IncidentTimelineEntry[] {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => splitTimelineEntry({ at: '', event: line }));
}
