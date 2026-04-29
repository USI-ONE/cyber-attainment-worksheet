'use client';

import { useMemo, useState } from 'react';
import type { FrameworkDefinition } from '@/lib/supabase/types';
import { GROUP_COLORS } from '@/lib/scoring';

interface Task {
  id: string;
  control_id: string;
  title: string;
  detail: string | null;
  status: string;
  owner: string | null;
  due_date: string | null;
  display_order: number;
  completed_at: string | null;
}

const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Complete'];

export default function WorkPlansClient({
  definition,
  initialTasks,
  initialNotes,
}: {
  definition: FrameworkDefinition;
  initialTasks: Task[];
  initialNotes: Record<string, string>;
}) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [notes, setNotes] = useState<Record<string, string>>(initialNotes);
  const [filter, setFilter] = useState<'ALL' | string>('ALL');

  const allControls = useMemo(() => {
    const out: { id: string; outcome: string; group: string; group_name: string }[] = [];
    for (const g of definition.groups)
      for (const cat of g.categories)
        for (const c of cat.controls) out.push({ id: c.id, outcome: c.outcome, group: g.id, group_name: g.name });
    return out;
  }, [definition]);

  const tasksByControl = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of tasks) (m[t.control_id] ??= []).push(t);
    return m;
  }, [tasks]);

  const visible = filter === 'ALL' ? allControls : allControls.filter((c) => c.group === filter);
  const visibleWithTasksFirst = [...visible].sort((a, b) => {
    const aHas = (tasksByControl[a.id] ?? []).length > 0 ? 0 : 1;
    const bHas = (tasksByControl[b.id] ?? []).length > 0 ? 0 : 1;
    return aHas - bHas;
  });

  async function addTask(control_id: string, title: string) {
    const res = await fetch('/api/work-plan-tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ control_id, title }),
    });
    const j = await res.json();
    if (res.ok) setTasks((xs) => [...xs, j.task]);
  }

  async function patchTask(id: string, fields: Partial<Task>) {
    setTasks((xs) => xs.map((x) => (x.id === id ? { ...x, ...fields } : x)));
    await fetch('/api/work-plan-tasks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
  }

  async function removeTask(id: string) {
    setTasks((xs) => xs.filter((x) => x.id !== id));
    await fetch(`/api/work-plan-tasks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async function saveNotes(control_id: string, value: string) {
    setNotes((m) => ({ ...m, [control_id]: value }));
    await fetch('/api/work-plan-notes', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ control_id, notes: value }),
    });
  }

  const totalTasks = tasks.length;
  const openTasks = tasks.filter((t) => t.status !== 'Complete').length;

  return (
    <>
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Work Plans</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Tactical tasks per control · {openTasks} open · {totalTasks} total
            </div>
          </div>
          <div className="fn-filters">
            <button className={`fn-btn ${filter === 'ALL' ? 'active' : ''}`} onClick={() => setFilter('ALL')}>All</button>
            {definition.groups.map((g) => (
              <button key={g.id} className={`fn-btn ${filter === g.id ? 'active' : ''}`} onClick={() => setFilter(g.id)}>{g.id}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visibleWithTasksFirst.map((c) => {
            const ctrlTasks = tasksByControl[c.id] ?? [];
            return (
              <ControlCard
                key={c.id}
                control={c}
                tasks={ctrlTasks}
                notes={notes[c.id] ?? ''}
                onAdd={(title) => addTask(c.id, title)}
                onPatch={patchTask}
                onRemove={removeTask}
                onSaveNotes={(v) => saveNotes(c.id, v)}
              />
            );
          })}
        </div>
      </section>
    </>
  );
}

function ControlCard({
  control, tasks, notes, onAdd, onPatch, onRemove, onSaveNotes,
}: {
  control: { id: string; outcome: string; group: string; group_name: string };
  tasks: Task[];
  notes: string;
  onAdd: (title: string) => void | Promise<void>;
  onPatch: (id: string, fields: Partial<Task>) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  onSaveNotes: (notes: string) => void | Promise<void>;
}) {
  const [newTitle, setNewTitle] = useState('');
  const [draftNotes, setDraftNotes] = useState(notes);
  const c = GROUP_COLORS[control.group] ?? { accent: '#C9A961', text: '#E8D29B', bg: '' };
  const open = tasks.filter((t) => t.status !== 'Complete').length;

  return (
    <details
      open={tasks.length > 0}
      style={{
        background: 'var(--bg-mid)', border: '1px solid var(--bg-border)',
        borderLeft: `3px solid ${c.accent}`, borderRadius: 3, padding: '12px 16px',
      }}
    >
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
        <code style={{ fontFamily: 'JetBrains Mono', fontWeight: 600, color: c.accent, fontSize: 12 }}>{control.id}</code>
        <span style={{ color: 'var(--text)', fontSize: 12, flex: 1 }}>{control.outcome}</span>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: 'var(--text-mid)' }}>
          {open}/{tasks.length} open
        </span>
      </summary>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tasks.length > 0 && (
          <table className="score-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Due</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    <input className="score-select" defaultValue={t.title}
                      onBlur={(e) => onPatch(t.id, { title: e.target.value })} />
                  </td>
                  <td>
                    <select className="score-select" value={t.status}
                      onChange={(e) => onPatch(t.id, { status: e.target.value })}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="score-select" defaultValue={t.owner ?? ''}
                      onBlur={(e) => onPatch(t.id, { owner: e.target.value || null })} />
                  </td>
                  <td>
                    <input type="date" className="score-select" defaultValue={t.due_date ?? ''}
                      onChange={(e) => onPatch(t.id, { due_date: e.target.value || null })} />
                  </td>
                  <td>
                    <button className="action-btn danger" onClick={() => onRemove(t.id)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="score-select"
            placeholder="Add a task — e.g. 'Document MFA enforcement policy'"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newTitle.trim()) {
                onAdd(newTitle.trim());
                setNewTitle('');
              }
            }}
            style={{ flex: 1 }}
          />
          <button className="action-btn" onClick={() => { if (newTitle.trim()) { onAdd(newTitle.trim()); setNewTitle(''); } }}>+ Add</button>
        </div>

        <div>
          <label style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-mid)' }}>
            Control notes
          </label>
          <textarea
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            onBlur={() => { if (draftNotes !== notes) onSaveNotes(draftNotes); }}
            placeholder="Status, blockers, evidence links, audit context…"
            rows={2}
            style={{
              width: '100%', padding: '6px 8px', marginTop: 4,
              background: 'var(--bg-deep)', border: '1px solid var(--bg-border)',
              color: 'var(--text)', fontSize: 11, fontFamily: 'Inter, sans-serif',
              borderRadius: 2, resize: 'vertical',
            }}
          />
        </div>
      </div>
    </details>
  );
}
