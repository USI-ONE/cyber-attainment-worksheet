'use client';

import { useState } from 'react';
import PolicyDocumentsTab from '@/components/PolicyDocumentsTab';
import type { PolicyDocument } from '@/lib/supabase/types';

interface Section {
  id: string;
  title: string;
  body_md: string;
  display_order: number;
  version: number;
  control_refs: string[] | null;
}

type Tab = 'sections' | 'documents';

const DEFAULT_SECTIONS = [
  { title: 'Purpose & Scope', body_md: '## Purpose\n\nDescribe why this policy exists and what it covers.\n\n## Scope\n\nList who and what is covered by this policy.' },
  { title: 'Roles & Responsibilities', body_md: '- **Executive sponsor:** \n- **Policy owner:** \n- **All employees:** ' },
  { title: 'Acceptable Use', body_md: 'Acceptable use of organizational systems and data.' },
  { title: 'Access Control', body_md: 'Authentication, authorization, and provisioning rules.' },
  { title: 'Data Protection', body_md: 'Data classification, encryption, retention.' },
  { title: 'Incident Response', body_md: 'How incidents are reported, triaged, and resolved.' },
  { title: 'Third-Party Risk', body_md: 'Vendor onboarding, assessment, and monitoring.' },
  { title: 'Policy Review & Exceptions', body_md: 'Review cadence, approval authority, and exception process.' },
];

export default function PolicyClient({
  initialSections,
  initialDocuments = [],
}: {
  initialSections: Section[];
  initialDocuments?: PolicyDocument[];
}) {
  const [sections, setSections] = useState<Section[]>(initialSections);
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { title: string; body_md: string }>>({});
  const [tab, setTab] = useState<Tab>(initialDocuments.length > 0 ? 'documents' : 'sections');

  const tabBar = (
    <div className="scorecard" style={{ padding: '6px 8px', display: 'flex', gap: 4 }}>
      <TabButton active={tab === 'documents'} onClick={() => setTab('documents')}>
        Documents <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{initialDocuments.length}</span>
      </TabButton>
      <TabButton active={tab === 'sections'} onClick={() => setTab('sections')}>
        Sections <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{sections.length}</span>
      </TabButton>
    </div>
  );

  if (tab === 'documents') {
    return (
      <>
        {tabBar}
        <PolicyDocumentsTab initialDocuments={initialDocuments} />
      </>
    );
  }

  async function add(title: string, body_md = '') {
    const res = await fetch('/api/policy-sections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body_md, display_order: sections.length }),
    });
    const j = await res.json();
    if (res.ok) setSections((xs) => [...xs, j.section]);
  }

  async function seedDefaults() {
    for (let i = 0; i < DEFAULT_SECTIONS.length; i++) {
      const s = DEFAULT_SECTIONS[i];
      await fetch('/api/policy-sections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: s.title, body_md: s.body_md, display_order: i }),
      });
    }
    location.reload();
  }

  async function save(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setSections((xs) => xs.map((s) => s.id === id ? { ...s, title: draft.title, body_md: draft.body_md, version: s.version + 1 } : s));
    setEditing(null);
    setDrafts((d) => { const c = { ...d }; delete c[id]; return c; });
    await fetch('/api/policy-sections', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title: draft.title, body_md: draft.body_md }),
    });
  }

  async function remove(id: string) {
    if (!confirm('Delete this section?')) return;
    setSections((xs) => xs.filter((x) => x.id !== id));
    await fetch(`/api/policy-sections?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async function move(id: string, dir: -1 | 1) {
    const idx = sections.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const ni = idx + dir;
    if (ni < 0 || ni >= sections.length) return;
    const newOrder = [...sections];
    [newOrder[idx], newOrder[ni]] = [newOrder[ni], newOrder[idx]];
    setSections(newOrder.map((s, i) => ({ ...s, display_order: i })));
    // Persist new orders
    await Promise.all(
      newOrder.map((s, i) =>
        fetch('/api/policy-sections', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: s.id, display_order: i }),
        })
      )
    );
  }

  if (sections.length === 0) {
    return (
      <>
        {tabBar}
        <section className="scorecard">
          <div className="scorecard-header">
            <div>
              <div className="scorecard-title">Security Policy</div>
              <div className="scorecard-tag" style={{ marginTop: 4 }}>Editor-of-record for the tenant&apos;s written policy</div>
            </div>
          </div>
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-mid)', marginBottom: 16 }}>
              No sections yet. Seed the standard 8-section template (Purpose, Roles, Acceptable Use, Access Control, Data Protection, Incident Response, Third-Party Risk, Review) or add sections one at a time.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="action-btn primary" onClick={seedDefaults}>Seed standard sections</button>
              <button className="action-btn" onClick={() => add('New Section')}>+ Empty section</button>
            </div>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {tabBar}
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Security Policy</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>{sections.length} sections</div>
          </div>
          <button className="action-btn primary" onClick={() => add('New Section')}>+ Add section</button>
        </div>
      </section>

      {sections.map((s, i) => {
        const draft = drafts[s.id];
        const isEditing = editing === s.id;
        return (
          <section className="scorecard" key={s.id}>
            <div className="scorecard-header">
              <div style={{ flex: 1 }}>
                {isEditing ? (
                  <input className="score-select" value={draft?.title ?? s.title}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: { title: e.target.value, body_md: draft?.body_md ?? s.body_md } }))}
                    style={{ fontFamily: 'Oswald, sans-serif', fontSize: 16, fontWeight: 600 }} />
                ) : (
                  <>
                    <div className="scorecard-title">{i + 1}. {s.title}</div>
                    <div className="scorecard-tag" style={{ marginTop: 4 }}>v{s.version}</div>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="action-btn" onClick={() => move(s.id, -1)} disabled={i === 0}>↑</button>
                <button className="action-btn" onClick={() => move(s.id, 1)} disabled={i === sections.length - 1}>↓</button>
                {isEditing ? (
                  <>
                    <button className="action-btn primary" onClick={() => save(s.id)}>Save</button>
                    <button className="action-btn" onClick={() => { setEditing(null); setDrafts((d) => { const c = { ...d }; delete c[s.id]; return c; }); }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="action-btn" onClick={() => { setEditing(s.id); setDrafts((d) => ({ ...d, [s.id]: { title: s.title, body_md: s.body_md } })); }}>Edit</button>
                    <button className="action-btn danger" onClick={() => remove(s.id)}>Delete</button>
                  </>
                )}
              </div>
            </div>

            {isEditing ? (
              <textarea
                value={draft?.body_md ?? s.body_md}
                onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: { title: draft?.title ?? s.title, body_md: e.target.value } }))}
                rows={12}
                style={{
                  width: '100%', padding: '12px 14px',
                  background: 'var(--bg-deep)', border: '1px solid var(--bg-border)',
                  color: 'var(--text)', fontSize: 12, lineHeight: 1.5,
                  fontFamily: '"JetBrains Mono", monospace', borderRadius: 2, resize: 'vertical',
                }}
                placeholder="Markdown content…"
              />
            ) : (
              <pre style={{
                whiteSpace: 'pre-wrap', wordWrap: 'break-word',
                color: 'var(--text)', fontSize: 12, lineHeight: 1.6,
                fontFamily: 'Inter, sans-serif', margin: 0, padding: '4px 0',
              }}>
                {s.body_md || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>(empty)</span>}
              </pre>
            )}
          </section>
        );
      })}
    </>
  );
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`nav-tab ${active ? 'active' : ''}`}
      style={{ fontSize: 12, padding: '8px 14px' }}
    >
      {children}
    </button>
  );
}
