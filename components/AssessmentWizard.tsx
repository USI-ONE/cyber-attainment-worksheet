'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AssessmentAnswer, AssessmentResponse, ItemAnswer, PolicyDocument } from '@/lib/supabase/types';
import { GROUP_COLORS } from '@/lib/scoring';
import { computePracticeScore, isComplete, tierForScore, itemsFromResponse } from '@/lib/assessment';
import { CONTROL_QUESTIONS, type ControlQuestionnaire } from '@/lib/assessment-questions';

// Generic CMM-ladder fallback used when a control is missing from the
// hand-authored CONTROL_QUESTIONS map. Identical to the original v1 wording
// so existing reviewers see the same generic fallback for any uncovered
// control rather than nothing.
const GENERIC_QUESTIONS: ControlQuestionnaire = {
  items: [
    { id: 'q1', prompt: 'Is there a documented process or standard for this control?', hint: 'Look for: written policy, runbook, SOP, or other artifact that clearly defines what we do.' },
    { id: 'q2', prompt: 'Is the process consistently followed across all relevant teams or systems?', hint: 'Look for: real-world adoption — not just on paper. Are exceptions rare and tracked?' },
    { id: 'q3', prompt: 'Is the process measured, audited, and continuously improved?', hint: 'Look for: metrics, periodic review, evidence of changes over time.' },
  ],
  evidence_narrative_prompt: 'Describe one specific improvement made in the last 12 months for this control.',
};

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
  const accent = GROUP_COLORS[functionId]?.accent ?? '#475569';

  // Pull the hand-authored questionnaire for this specific control. Falls
  // back to the generic CMM-ladder questions if the control is missing.
  const questions = CONTROL_QUESTIONS[controlId] ?? GENERIC_QUESTIONS;

  // Hydrate per-item answers from whatever shape the server returned.
  // itemsFromResponse prefers items_answered (new) and falls back to the
  // legacy q1/q2/q3 columns. We then re-key by the questionnaire's item
  // ids so an item that doesn't yet have a saved answer is null rather
  // than undefined.
  const initialItemAnswers = initialResponse ? itemsFromResponse(initialResponse) : [];
  const initialAnswersById: Record<string, AssessmentAnswer | null> =
    Object.fromEntries(questions.items.map((it) => {
      const saved = initialItemAnswers.find((a) => a.id === it.id);
      return [it.id, saved?.answer ?? null];
    }));

  const [answers, setAnswers] = useState<Record<string, AssessmentAnswer | null>>(initialAnswersById);
  const [q4, setQ4] = useState(initialResponse?.q4_improvement ?? '');
  const [notes, setNotes] = useState(initialResponse?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Materialize the answers map into an ordered ItemAnswer[] matching the
  // questionnaire's item order. This is the canonical shape for both the
  // score calculator and the save payload.
  const itemsAnswered: ItemAnswer[] = questions.items.map((it) => ({
    id: it.id,
    answer: answers[it.id] ?? null,
  }));

  const computedScore = computePracticeScore({ items: itemsAnswered, evidence_narrative: q4 });
  const complete = isComplete(itemsAnswered, questions.items.length);

  // Auto-save with a 300 ms debounce. Compare against the hydrated initial
  // map so the user's first render doesn't immediately fire a redundant save.
  useEffect(() => {
    const unchanged =
      questions.items.every((it) => (answers[it.id] ?? null) === (initialAnswersById[it.id] ?? null)) &&
      q4 === (initialResponse?.q4_improvement ?? '') &&
      notes === (initialResponse?.notes ?? '');
    if (unchanged) return;

    const t = setTimeout(() => { void save(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, q4, notes]);

  async function save() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/assessment/${encodeURIComponent(controlId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items_answered: itemsAnswered,
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

  // Lazy setter used by the dynamic Question rendering.
  function setAnswer(id: string, v: AssessmentAnswer) {
    setAnswers((cur) => ({ ...cur, [id]: v }));
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
            fontFamily: 'Inter, sans-serif', fontSize: 16,
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

      {/* Questions — pulled per-control from lib/assessment-questions.ts so
          each NIST CSF 2.0 sub-control gets specific, evidence-grounded
          wording rather than generic CMM-ladder text. Number of items
          varies per control; this maps over the dynamic list. */}
      <section className="scorecard">
        {questions.items.map((item, idx) => (
          <Question
            key={item.id}
            number={idx + 1}
            question={item.prompt}
            help={item.hint}
            value={answers[item.id] ?? null}
            onChange={(v) => setAnswer(item.id, v)}
          />
        ))}

        <div style={{ marginTop: 12 }}>
          <label style={{
            fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 11,
            letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-mid)',
          }}>
            Evidence narrative (optional) — Improvement in the last 12 months
          </label>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
            If filled in <em>and</em> every question is Yes, score reaches 5 (Optimizing).
          </div>
          <textarea
            value={q4}
            onChange={(e) => setQ4(e.target.value)}
            placeholder={questions.evidence_narrative_prompt}
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
            fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 11,
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
                fontFamily: 'Inter, sans-serif',
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
              title={!complete ? `Answer all ${questions.items.length} questions to save a score` : undefined}
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
          const color = opt === 'yes' ? '#10B981' : opt === 'partial' ? '#F59E0B' : '#DC2626';
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              type="button"
              // .answer-btn picks up the read-only enforcer + CSS in
              // globals.css so a viewer's buttons are dimmed AND inert,
              // not just visually styled-as-inert. .answer-selected on
              // the currently-chosen option keeps it un-dimmed in
              // read-only mode so the recorded answer stays obvious.
              className={`answer-btn ${sel ? 'answer-selected' : ''}`}
              style={{
                flex: 1, padding: '10px 12px',
                background: sel ? `${color}22` : 'var(--bg-deep)',
                border: sel ? `1px solid ${color}` : '1px solid var(--bg-border)',
                color: sel ? color : 'var(--text-mid)',
                fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 12,
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
