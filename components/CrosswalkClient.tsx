'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CrosswalkFramework, CrosswalkRelationship } from '@/lib/crosswalk';

/**
 * Compliance Crosswalk UI.
 *
 * Top of page: framework pickers (source ↔ target) + KPI tiles for
 * coverage (mapped controls, average inherited Practice score, gaps).
 *
 * Below: a list of every target control grouped by parent group, with
 * the inherited score and contributing source controls inline. Gaps
 * (target controls with no mapped source) get a "Coverage gap" pill so
 * the user immediately sees what the source framework doesn't cover.
 */

export interface CrosswalkControl {
  control_id: string;
  outcome: string;
  group_id: string;
  group_name: string;
  category_id: string;
  category_name: string;
}

export interface CrosswalkMapping {
  target_control_id: string;
  inherited_pra: number | null;
  inherited_pol: number | null;
  source_count: number;
  contributors: {
    source_control_id: string;
    relationship: CrosswalkRelationship;
    pra: number | null;
    pol: number | null;
  }[];
}

const RELATIONSHIP_META: Record<CrosswalkRelationship, { color: string; label: string }> = {
  equivalent: { color: '#10B981', label: 'Equivalent' },
  related:    { color: '#F59E0B', label: 'Related'    },
  partial:    { color: '#64748B', label: 'Partial'    },
};

function tierColor(score: number | null): string {
  if (score == null) return '#94A3B8';
  if (score >= 4.5) return '#10B981';
  if (score >= 3.5) return '#0EA5E9';
  if (score >= 2.5) return '#F59E0B';
  if (score >= 1.5) return '#DC2626';
  return '#991B1B';
}

function fmtScore(n: number | null): string {
  if (n == null) return '—';
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}

export default function CrosswalkClient({
  frameworks, source, target, targetControls, mappings, sourceControlLookup,
}: {
  frameworks: CrosswalkFramework[];
  source: CrosswalkFramework;
  target: CrosswalkFramework;
  targetControls: CrosswalkControl[];
  mappings: CrosswalkMapping[];
  sourceControlLookup: Record<string, string>;
}) {
  const router = useRouter();
  const [groupFilter, setGroupFilter] = useState<'ALL' | string>('ALL');
  const [showGapsOnly, setShowGapsOnly] = useState(false);
  const [search, setSearch] = useState('');

  function setPair(nextSourceId: string, nextTargetId: string) {
    const params = new URLSearchParams();
    params.set('source', nextSourceId);
    params.set('target', nextTargetId);
    // Next's typed-routes generator can't infer the shape of a
    // template-literal URL carrying query params, so cast to `never`.
    // The string itself is well-formed.
    router.push(`/crosswalk?${params.toString()}` as never);
  }

  // KPI roll-ups
  const mappingByTarget = useMemo(() => {
    const m = new Map<string, CrosswalkMapping>();
    for (const x of mappings) m.set(x.target_control_id, x);
    return m;
  }, [mappings]);

  const stats = useMemo(() => {
    const total = targetControls.length;
    const mapped = mappings.filter((m) => m.source_count > 0).length;
    const gaps = total - mapped;
    const praValues = mappings.map((m) => m.inherited_pra).filter((v): v is number => v != null);
    const avgPra = praValues.length ? praValues.reduce((s, v) => s + v, 0) / praValues.length : null;
    return { total, mapped, gaps, avgPra };
  }, [targetControls, mappings]);

  const groups = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const c of targetControls) {
      if (!seen.has(c.group_id)) {
        seen.add(c.group_id);
        out.push({ id: c.group_id, name: c.group_name });
      }
    }
    return out;
  }, [targetControls]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return targetControls.filter((c) => {
      if (groupFilter !== 'ALL' && c.group_id !== groupFilter) return false;
      if (showGapsOnly && (mappingByTarget.get(c.control_id)?.source_count ?? 0) > 0) return false;
      if (term) {
        const hay = `${c.control_id} ${c.outcome} ${c.group_name}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [targetControls, groupFilter, showGapsOnly, search, mappingByTarget]);

  // Group filtered controls by parent for rendering.
  const byGroup = useMemo(() => {
    const m: Record<string, CrosswalkControl[]> = {};
    for (const c of filtered) (m[c.group_id] ??= []).push(c);
    return m;
  }, [filtered]);

  return (
    <>
      {/* Framework pickers + KPI strip */}
      <section className="scorecard">
        <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="scorecard-title">Compliance Crosswalk</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Inherit coverage on one framework from scores on another. Equivalent / related /
              partial relationship weighting; gaps surface inline.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Plain .action-btn (not .primary) so viewers can generate
                the PDF too — it's a read operation. Honors the current
                source/target picks via query params on the API. */}
            <a
              className="action-btn"
              href={`/api/report/crosswalk?source=${encodeURIComponent(source.framework_version_id)}&target=${encodeURIComponent(target.framework_version_id)}`}
              download
              title={`Generate a PDF showing ${target.display_name} coverage inherited from ${source.display_name} scores.`}
            >
              Generate Crosswalk PDF
            </a>
            <span style={{ fontSize: 11, color: 'var(--text-mid)', marginLeft: 8 }}>Source:</span>
            <select
              className="score-select"
              value={source.framework_version_id}
              onChange={(e) => setPair(e.target.value, target.framework_version_id)}
              style={{ minWidth: 240 }}
            >
              {frameworks.map((f) => (
                <option key={f.framework_version_id} value={f.framework_version_id}>
                  {f.display_name} (v{f.version})
                </option>
              ))}
            </select>
            <span style={{ fontSize: 14, color: 'var(--text-mid)' }}>→</span>
            <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>Target:</span>
            <select
              className="score-select"
              value={target.framework_version_id}
              onChange={(e) => setPair(source.framework_version_id, e.target.value)}
              style={{ minWidth: 240 }}
            >
              {frameworks.map((f) => (
                <option key={f.framework_version_id} value={f.framework_version_id}>
                  {f.display_name} (v{f.version})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 6, marginBottom: 0 }}>
          <KpiTile label="Target Controls" value={stats.total.toString()} sub={`in ${target.display_name}`} accent="#2563EB" />
          <KpiTile
            label="Mapped"
            value={`${stats.mapped} / ${stats.total}`}
            sub={`from ${source.display_name}`}
            accent={stats.mapped >= stats.total / 2 ? '#10B981' : '#F59E0B'}
          />
          <KpiTile
            label="Coverage Gaps"
            value={stats.gaps.toString()}
            sub={stats.gaps > 0 ? 'no mapped source control' : 'fully mapped'}
            accent={stats.gaps > 0 ? '#DC2626' : '#10B981'}
          />
          <KpiTile
            label="Avg Inherited Practice"
            value={fmtScore(stats.avgPra)}
            sub="weighted across mapped controls"
            accent={tierColor(stats.avgPra)}
          />
        </div>
      </section>

      {/* Filter row */}
      <section className="scorecard">
        <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="scorecard-title">{target.display_name} — Coverage Detail</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              {filtered.length} of {stats.total} target controls shown · weighted: equivalent ×1.0, related ×0.7, partial ×0.4
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="score-select"
              placeholder="Search ID, outcome, group…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 240 }}
            />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-mid)' }}>
              <input type="checkbox" checked={showGapsOnly} onChange={(e) => setShowGapsOnly(e.target.checked)} />
              Gaps only
            </label>
          </div>
        </div>

        <div className="fn-filters" style={{ marginTop: 8 }}>
          <button className={`fn-btn ${groupFilter === 'ALL' ? 'active' : ''}`} onClick={() => setGroupFilter('ALL')}>
            All
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              className={`fn-btn ${groupFilter === g.id ? 'active' : ''}`}
              onClick={() => setGroupFilter(g.id)}
            >
              {g.id} {g.name}
            </button>
          ))}
        </div>

        {Object.keys(byGroup).length === 0 ? (
          <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--text-mid)' }}>
            No controls match the current filter.
          </div>
        ) : (
          Object.entries(byGroup).map(([gid, ctrls]) => (
            <GroupSection
              key={gid}
              groupId={gid}
              groupName={ctrls[0].group_name}
              controls={ctrls}
              mappingByTarget={mappingByTarget}
              sourceControlLookup={sourceControlLookup}
            />
          ))
        )}
      </section>
    </>
  );
}

function GroupSection({
  groupId, groupName, controls, mappingByTarget, sourceControlLookup,
}: {
  groupId: string;
  groupName: string;
  controls: CrosswalkControl[];
  mappingByTarget: Map<string, CrosswalkMapping>;
  sourceControlLookup: Record<string, string>;
}) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8,
        paddingBottom: 6, borderBottom: '1px solid var(--bg-border)',
      }}>
        <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: '0.04em' }}>
          {groupId}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-mid)' }}>{groupName}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {controls.length} control{controls.length === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {controls.map((c) => (
          <ControlRow
            key={c.control_id}
            control={c}
            mapping={mappingByTarget.get(c.control_id)}
            sourceControlLookup={sourceControlLookup}
          />
        ))}
      </div>
    </div>
  );
}

function ControlRow({
  control, mapping, sourceControlLookup,
}: {
  control: CrosswalkControl;
  mapping: CrosswalkMapping | undefined;
  sourceControlLookup: Record<string, string>;
}) {
  const sourceCount = mapping?.source_count ?? 0;
  const inheritedPra = mapping?.inherited_pra ?? null;
  const isGap = sourceCount === 0;

  return (
    <div style={{
      border: '1px solid var(--bg-border)', borderRadius: 'var(--r-md)',
      padding: '10px 12px', background: isGap ? 'rgba(220,38,38,0.04)' : 'var(--bg-mid)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <code style={{
          fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 12,
          color: 'var(--text)', minWidth: 64,
        }}>{control.control_id}</code>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>{control.outcome}</span>

        {isGap ? (
          <span style={{
            fontSize: 10, fontWeight: 700,
            padding: '2px 8px', borderRadius: 999,
            background: 'rgba(220,38,38,0.10)',
            color: '#DC2626', border: '1px solid rgba(220,38,38,0.40)',
            textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
            Coverage gap
          </span>
        ) : (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Inherited Pra</span>
            <span style={{
              fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 14,
              color: tierColor(inheritedPra),
              padding: '2px 8px', borderRadius: 6,
              background: `${tierColor(inheritedPra)}1a`,
              border: `1px solid ${tierColor(inheritedPra)}55`,
            }}>
              {fmtScore(inheritedPra)}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              from {sourceCount} source
            </span>
          </span>
        )}
      </div>

      {sourceCount > 0 && mapping && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--bg-border)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {mapping.contributors.map((c, i) => {
              const meta = RELATIONSHIP_META[c.relationship];
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11.5 }}>
                  <code style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, color: 'var(--text-mid)', minWidth: 56 }}>
                    {c.source_control_id}
                  </code>
                  <span style={{ flex: 1, color: 'var(--text-mid)' }}>
                    {sourceControlLookup[c.source_control_id] ?? '—'}
                  </span>
                  <span style={{
                    fontSize: 9.5, fontWeight: 700,
                    padding: '1px 6px', borderRadius: 999,
                    background: `${meta.color}1a`, color: meta.color,
                    border: `1px solid ${meta.color}55`,
                    textTransform: 'uppercase', letterSpacing: '.04em',
                  }}>
                    {meta.label}
                  </span>
                  <span style={{
                    fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 11,
                    color: tierColor(c.pra), minWidth: 28, textAlign: 'right',
                  }}>
                    {fmtScore(c.pra)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="kpi-tile" style={{ ['--accent' as never]: accent }}>
      <div className="kpi-tile-label">{label}</div>
      <div className="kpi-tile-value">{value}</div>
      <div className="kpi-tile-sub">{sub}</div>
    </div>
  );
}
