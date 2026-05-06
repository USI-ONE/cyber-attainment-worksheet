'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AssessmentAnswer, AssessmentResponse, PolicyDocument } from '@/lib/supabase/types';
import { GROUP_COLORS } from '@/lib/scoring';
import { computePracticeScore, isComplete, tierForScore } from '@/lib/assessment';

type LinkedPolicy = Pick<PolicyDocument, 'id' | 'title' | 'version' | 'owner' | 'filename' | 'linked_control_ids' | 'status'>;

/**
 * Single-control wizard for the guided Practice assessment. Auto-saves
 * on every answer change. Save & Next walks the user through the
 * remaining controls in the same NIST CSF function before crossing into
 * the next function.
 */
export default function AssessmentWizard({
  controlId,
  controlOutcome,
  functionId,
  functionName,
  categoryName,
  positionInFunction,
  totalInFunction,
  prevControlId,
  nextControlId,
  initialResponse,
  priorPracticeScore,
  linkedPolicies,
}: {
  controlId: string;
  controlOutcome: string;
  functionId: string;
  functionName: string;
  categoryName: string;
  positionInFunction: number;
  totalInFunction: number;
  prevControlId: string | null;
  nextControlId: string | null;
  initialResponse: AssessmentResponse | null;
  priorPracticeScore: number | null;
  linkedPolicies: LinkedPolicy[];
}) {
  const router = useRouter();
  const accent = GROUP_COLORS[functionId]?.accent ?? '#C9A961';

  const [q1, setQ1] = useState<AssessmentAnswer | null>(initialResponse?.q1_documented ?? null);
  const [q2, setQ2] = useState<AssessmentAnswer | null>(initialResponse?.q2_followed ?? null);
  const [q3, setQ3] = useState<AssessmentAnswer | null>(initialResponse?.q3_measured ?? null);
  const [q4, setQ4] = useState(initialResponse?.q4_improvement ?? '');
  const [notes, setNotes] = useState(initialResponse?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const computedScore = computePracticeScore({ q1, q2, q3, q4_improvement: q4 });
  const complete = isComplete({ q1_documented: q1, q2_followed: q2, q3_measured: q3 });

  // Auto-save with a 300 ms debounce — user changes a radio button, the
  // request fires once they pause. Avoids the API getting hammered for every
  // keystroke in the textarea fields.
  useEffect(() => {
    // Skip the very first render so we don't immediately re-save what we
    // just loaded from the server.
    if (
      q1 === (initialResponse?.q1_documented ?? null) &&
      q2 === (initialResponse?.q2_followed ?? null) &&
      q3 === (initialResponse?.q3_measured ?? null) &&
      q4 === (initialResponse?.q4_improvement ?? '') &&
      notes === (initialResponse?.notes ?? '')
    ) return;

    const t = setTimeout(() => { void save(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q1, q2, q3, q4, notes]);

  async function save() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/assessment/${encodeURIComponent(controlId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q1_documented: q1,
          q2_followed:   q2,
          q3_measured:   q3,
          q4_improvement: q4 || null,
          notes: notes || null,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
      } else {
        setSavedAt(new Date());
        if (j.warning) setError(j.warning);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  function goToNext() {
    if (nextControlId) router.push(`/assessment/${nextControlId}` as never);
    else router.push('/assessment' as never);
  }

  return (
    <>
      {/* Control header */}
      <section className="scorecard">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <code style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 16,
            fontWeight: 700, color: accent,
          }}>{controlId}</code>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {functionId} {functionName} · {categoryName}
          </span>
        </div>
        <div style={{
          fontSize: 14, color: 'var(--text)', lineHeight: 1.5,
          marginTop: 8, marginBottom: 4,
        }}>
          <strong>Outcome:</strong> {controlOutcome}
        </div>
      </section>

      {/* Linked policies (evidence) */}
      {linkedPolicies.length > 0 && (
        <section className="scorecard" style={{ borderLeft: `3px solid ${accent}` }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
            📄 Backed by policy {linkedPolicies.length === 1 ? 'document' : 'documents'}
          </div>
          {linkedPolicies.map((p) => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '4px 0',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.title}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {p.version ? `v${p.version} · ` : ''}{p.owner ?? '—'} · {p.status}
                </div>
              </div>
              <button className="action-btn"
                onClick={async () => {
                  const r = await fetch(`/api/policy-documents/${p.id}`);
                  const j = await r.json();
                  if (j.download_url) window.open(j.download_url, '_blank');
                }}>
                Open
              </button>
            </div>
          ))}
        </section>
      )}

      {/* Questions */}
      <section className="scorecard">
        <Question
          number={1}
          question="Is there a documented process or standard for this control?"
          help="Look for: written policy, runbook, SOP, or other artifact that clearly defines what we do."
          value={q1}
          onChange={setQ1}
        />
        <Question
          number={2}
          question="Is the process consistently followed across all relevant teams or systems?"
          help="Look for: real-world adoption — not just on paper. Are exceptions rare and tracked?"
          value={q2}
          onChange={setQ2}
        />
        <Question
          number={3}
          question="Is the process measured, audited, and continuously improved?"
          help="Look for: metrics, periodic review, evidence of changes over time."
          value={q3}
          onChange={setQ3}
        />

        <div style={{ marginTop: 12 }}>
          <label style={{
            fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 11,
            letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-mid)',
          }}>
            Q4 (optional) — Improvement in the last 12 months
          </label>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
            If filled in <em>and</em> Q1-3 are all Yes, score reaches 5 (Optimizing).
          </div>
          <textarea
            value={q4}
            onChange={(e) => setQ4(e.target.value)}
            placeholder="Example: rolled out Conditional Access baseline in Q1; reduced exception count from 14 to 2."
            rows={3}
            style={{
              width: '100%', padding: '8px 10px',
              background: 'var(--bg-deep)', border: '1px solid var(--bg-border)',
              color: 'var(--text)', fontFamily: 'Inter, sans-serif', fontSize: 13,
              borderRadius: 2, resize: 'vertical', minHeight: 60,
            }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={{
            fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 11,
            letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-mid)',
          }}>
            Assessor notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal context, evidence pointers, exceptions to follow up on…"
            rows={2}
            style={{
              width: '100%', padding: '8px 10px',
              background: 'var(--bg-deep)', border: '1px solid var(--bg-border)',
              color: 'var(--text)', fontFamily: 'Inter, sans-serif', fontSize: 13,
              borderRadius: 2, resize: 'vertical', minHeight: 40,
            }}
          />
        </div>
      </section>

      {/* Score preview + navigation */}
      <section className="scorecard">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Computed Practice score
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 4 }}>
              <span style={{
                fontSize: 28, fontWeight: 700, color: accent,
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {computedScore != null ? computedScore.toFixed(1) : '—'}
              </span>
              <span style={{ fontSize: 14, color: 'var(--text-mid)' }}>
                {tierForScore(computedScore)}
              </span>
              {priorPracticeScore != null && computedScore != null && Math.abs(priorPracticeScore - computedScore) > 0.05 && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  (was {priorPracticeScore.toFixed(1)})
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              {saving ? 'Saving…'
                : savedAt ? `✓ Saved ${savedAt.toLocaleTimeString()}`
                : initialResponse ? '✓ Saved'
                : 'Not saved yet'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {prevControlId ? (
              <Link className="action-btn" href={`/assessment/${prevControlId}` as never}>← Previous</Link>
            ) : (
              <span className="action-btn" style={{ opacity: 0.4, pointerEvents: 'none' }}>← Previous</span>
            )}
            <button className="action-btn" onClick={() => goToNext()}>Skip</button>
            <button
              className="action-btn primary"
              onClick={async () => { await save(); goToNext(); }}
              disabled={!complete && !initialResponse}
              title={!complete ? 'Answer Q1-Q3 to save a score' : undefined}
            >
              {nextControlId ? 'Save & Next →' : 'Save & Done'}
            </button>
          </div>
        </div>
        {error && <div className="banner error" style={{ marginTop: 8 }}>{error}</div>}
      </section>
    </>
  );
}

function Question({
  number, question, help, value, onChange,
}: {
  number: number;
  question: string;
  help: string;
  value: AssessmentAnswer | null;
  onChange: (v: AssessmentAnswer) => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>
        Q{number}. {question}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, marginBottom: 8 }}>
        {help}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['no', 'partial', 'yes'] as AssessmentAnswer[]).map((opt) => {
          const sel = value === opt;
          const color = opt === 'yes' ? '#15803D' : opt === 'partial' ? '#A16207' : '#B91C1C';
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              type="button"
              style={{
                flex: 1, padding: '10px 12px',
                background: sel ? `${color}22` : 'var(--bg-deep)',
                border: sel ? `1px solid ${color}` : '1px solid var(--bg-border)',
                color: sel ? color : 'var(--text-mid)',
                fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 12,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                cursor: 'pointer', borderRadius: 2,
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
