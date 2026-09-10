import Link from 'next/link';
import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import {
  METRIC_DEFINITIONS,
  METRIC_ORDER,
  METRIC_CATEGORY_ORDER,
  type MetricDefinition,
} from '@/lib/metric-definitions';

/**
 * /definitions — full glossary of every metric surfaced on the scorecard
 * and its component pages. One source of truth: the same data feeds the
 * per-metric InfoIcon tooltips on the dashboard.
 *
 * Rendered as a plain static page — no auth on the read side, no tenant
 * data. Tenant resolution stays so the shared Nav chrome and theming
 * apply; if there is no tenant we still render the reference content
 * (nothing here is tenant-specific).
 */
export const dynamic = 'force-dynamic';

export default async function DefinitionsPage() {
  // Tenant resolution is best-effort — the definitions are tenant-agnostic
  // but we still want the layout chrome to know which tenant is signed in.
  const host = headers().get('host') ?? undefined;
  await resolveTenant(host);

  const byCategory: Record<string, MetricDefinition[]> = {};
  for (const id of METRIC_ORDER) {
    const def = METRIC_DEFINITIONS[id];
    if (!def) continue;
    if (!byCategory[def.category]) byCategory[def.category] = [];
    byCategory[def.category].push(def);
  }

  return (
    <main className="app-main">
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Definitions &amp; Calculations</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Every metric that appears on the scorecard, defined once — with the exact formula used to produce the number.
            </div>
          </div>
          <Link className="action-btn" href="/">← Back to dashboard</Link>
        </div>

        <div style={{
          marginTop: 8,
          padding: '10px 12px',
          background: 'var(--bg-deep)',
          border: '1px solid var(--bg-border)',
          borderRadius: 2,
          fontSize: 12,
          color: 'var(--text-mid)',
          lineHeight: 1.6,
        }}>
          These are the exact calculations the platform uses — no rounding tricks, no marketing metrics. Anywhere a number appears on the dashboard with a small &quot;i&quot; icon, hovering it will show a compact version of the same definition you see here. Auditors: the <code>source_ref</code> line under each metric points to the exact file and function that computes it.
        </div>
      </section>

      {/* Category table of contents */}
      <section className="scorecard">
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
          Jump to
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {METRIC_CATEGORY_ORDER.map((cat) => (
            <a
              key={cat}
              href={`#${slugForCategory(cat)}`}
              className="action-btn"
              style={{ fontSize: 12 }}
            >
              {cat}
              <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                ({(byCategory[cat] ?? []).length})
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* One section per category */}
      {METRIC_CATEGORY_ORDER.map((cat) => {
        const metrics = byCategory[cat] ?? [];
        if (metrics.length === 0) return null;
        return (
          <section key={cat} className="scorecard" id={slugForCategory(cat)}>
            <div className="scorecard-header">
              <div>
                <div className="scorecard-title">{cat}</div>
                <div className="scorecard-tag" style={{ marginTop: 4 }}>
                  {CATEGORY_HINT[cat]}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 14, marginTop: 4 }}>
              {metrics.map((def) => <DefinitionCard key={def.id} def={def} />)}
            </div>
          </section>
        );
      })}
    </main>
  );
}

function DefinitionCard({ def }: { def: MetricDefinition }) {
  return (
    <article
      id={`metric-${def.id}`}
      style={{
        padding: '12px 14px',
        background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)',
        borderRadius: 4,
      }}
    >
      <header style={{
        display: 'flex', alignItems: 'baseline', gap: 10,
        justifyContent: 'space-between', flexWrap: 'wrap',
        marginBottom: 6,
      }}>
        <h3 style={{
          margin: 0, fontFamily: 'Inter, sans-serif', fontSize: 15,
          fontWeight: 700, color: 'var(--text)',
        }}>
          {def.label}
        </h3>
        {def.source_ref && (
          <code style={{
            fontSize: 10, color: 'var(--text-muted)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            {def.source_ref}
          </code>
        )}
      </header>

      <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-mid)' }}>
        {def.definition}
      </div>

      {def.formula && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            fontSize: 10, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.12em',
            marginBottom: 4,
          }}>
            Formula
          </div>
          <pre style={{
            margin: 0, padding: '8px 10px',
            background: 'var(--bg-deep)',
            border: '1px solid var(--bg-border)',
            borderRadius: 2,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12, color: 'var(--text)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            overflowX: 'auto',
          }}>
            {def.formula}
          </pre>
        </div>
      )}

      {def.interpretation && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            fontSize: 10, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.12em',
            marginBottom: 4,
          }}>
            How to read it
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-mid)' }}>
            {def.interpretation}
          </div>
        </div>
      )}
    </article>
  );
}

function slugForCategory(cat: string): string {
  return cat.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const CATEGORY_HINT: Record<MetricDefinition['category'], string> = {
  'Portfolio Averages':
    'The four KPI tiles at the top of the dashboard. One number per axis of the Policy / Practice / Goal model, weighted by control.',
  'Compliance Attainment':
    'How close the organization is to the goals it set. Answers "what fraction of the program have we actually attained?" — not "what is our average maturity?"',
  'Per-Function Metrics':
    'The Executive Scorecard table and per-function progress bars. Same math as the portfolio metrics, scoped to one NIST CSF function.',
  'Per-Control Scores':
    'The three axes every control is measured on. Set on the Worksheet or, for Practice, computed from the guided Assessment.',
  'Practice Assessment':
    'How the guided Assessment questionnaire turns Yes / Partial / No answers into a numeric Practice score.',
  'Maturity Tiers':
    'The 1–5 CMM ladder used across every score in the platform. Half-steps (2.5, 3.5, ...) are allowed so a control can sit between two tiers.',
};
