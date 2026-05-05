import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import { baseStyles, paletteFor, fmtDate, registerFonts } from './styles';
import { GROUP_COLORS } from '@/lib/scoring';
import type { Tenant } from '@/lib/supabase/types';

/**
 * Executive Work Plan & 30-Day Priorities Briefing — what we said we'd
 * do, what we're doing, what's done. Two sections:
 *   1. Active 30-Day Priorities (priorities table, status != Complete)
 *   2. Work Plan tasks grouped by NIST CSF function
 * Each row shows owner, due date, status, and priority level so the
 * board can read a Monday-morning operating picture.
 */

registerFonts();

export interface PriorityRow {
  id: string;
  control_id: string | null;
  title: string;
  detail: string | null;
  owner: string | null;
  status: string;
  priority_level: number | null;
  due_date: string | null;
}

export interface WorkPlanTaskRow {
  id: string;
  control_id: string;
  title: string;
  detail: string | null;
  status: string;
  owner: string | null;
  due_date: string | null;
  completed_at: string | null;
}

const PRIORITY_LABEL = ['', 'Low', 'Medium', 'High', 'Critical'];

export function WorkPlanReport({
  tenant,
  priorities,
  tasks,
  asOf,
}: {
  tenant: Tenant;
  priorities: PriorityRow[];
  tasks: WorkPlanTaskRow[];
  asOf: Date;
}) {
  const palette = paletteFor(tenant);

  // Active priorities first; everything else hidden — this is an executive
  // briefing, not a full audit log.
  const activePriorities = priorities
    .filter((p) => p.status !== 'Complete')
    .sort((a, b) => {
      // Critical → High → Medium → Low → unranked, then earliest due first.
      const lvl = (b.priority_level ?? 0) - (a.priority_level ?? 0);
      if (lvl !== 0) return lvl;
      const ad = a.due_date ?? '9999-12-31';
      const bd = b.due_date ?? '9999-12-31';
      return ad.localeCompare(bd);
    });
  const completedCount = priorities.filter((p) => p.status === 'Complete').length;

  // Group work plan tasks by NIST CSF function (first two chars of control_id).
  const tasksByFunction = new Map<string, WorkPlanTaskRow[]>();
  for (const t of tasks) {
    const fn = t.control_id.split('.')[0];
    const arr = tasksByFunction.get(fn) ?? [];
    arr.push(t);
    tasksByFunction.set(fn, arr);
  }
  const functionOrder = ['GV', 'ID', 'PR', 'DE', 'RS', 'RC'];
  const orderedFunctions = functionOrder.filter((fn) => tasksByFunction.has(fn))
    .concat(Array.from(tasksByFunction.keys()).filter((fn) => !functionOrder.includes(fn)));

  const openTaskCount = tasks.filter((t) => t.status !== 'Complete').length;
  const completedTaskCount = tasks.filter((t) => t.status === 'Complete').length;
  const totalTasks = tasks.length;

  const statusColor = (s: string): string => {
    if (s === 'Complete') return palette.status.closed;
    if (s === 'In Progress') return palette.status.contained;
    if (s === 'Blocked') return palette.severity.high;
    return palette.muted;
  };

  return (
    <Document
      title={`${tenant.display_name} — Work Plan & Priorities`}
      author={tenant.display_name}
      subject="Executive Work Plan Briefing"
      creator="Cyber Attainment Worksheet"
    >
      <Page size="LETTER" style={baseStyles.page}>
        <View style={baseStyles.pageHeader} fixed>
          <Text style={baseStyles.pageHeaderTenant}>{tenant.display_name}</Text>
          <Text style={baseStyles.pageHeaderType}>Confidential · Work Plan &amp; Priorities</Text>
        </View>
        <View style={baseStyles.pageFooter} fixed>
          <Text>As of {fmtDate(asOf.toISOString())}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        {/* Cover */}
        <View style={[baseStyles.cover, { borderBottomColor: palette.primary }]}>
          <Text style={[baseStyles.coverEyebrow, { color: palette.primary }]}>
            Work Plan &amp; 30-Day Priorities
          </Text>
          <Text style={baseStyles.coverTitle}>What We Said We&apos;d Do · What We&apos;re Doing</Text>
          <Text style={[baseStyles.coverSub, { marginTop: 6 }]}>
            Prepared for: Chief Executive Officer · Chief Financial Officer · Board Members
          </Text>

          <View style={[baseStyles.metaGrid, { marginTop: 18 }]}>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Active Priorities</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {activePriorities.length}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                {completedCount} completed previously
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Open Tasks</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {openTaskCount}
              </Text>
              <Text style={{ fontSize: 9, color: palette.muted }}>
                {completedTaskCount} of {totalTasks} complete
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Critical-Level</Text>
              <Text style={[baseStyles.metaVal, {
                fontSize: 18, fontWeight: 700,
                color: activePriorities.filter((p) => (p.priority_level ?? 0) >= 4).length > 0
                  ? palette.severity.critical : palette.status.closed,
              }]}>
                {activePriorities.filter((p) => (p.priority_level ?? 0) >= 4).length}
              </Text>
            </View>
            <View style={baseStyles.metaItem}>
              <Text style={baseStyles.metaLabel}>Functions With Active Work</Text>
              <Text style={[baseStyles.metaVal, { fontSize: 18, fontWeight: 700, color: palette.primary }]}>
                {orderedFunctions.length}
              </Text>
            </View>
          </View>
        </View>

        {/* 30-Day Priorities */}
        <Text style={baseStyles.sectionH}>1. Active 30-Day Priorities</Text>
        {activePriorities.length === 0 ? (
          <Text style={[baseStyles.para, { color: palette.muted }]}>
            No active priorities on the board. {completedCount > 0 && `${completedCount} previously completed.`}
          </Text>
        ) : (
          <View style={baseStyles.table}>
            <View style={[baseStyles.tr, { borderBottomWidth: 1, borderBottomColor: palette.ink }]}>
              <Text style={[baseStyles.th, { width: '34%' }]}>Title</Text>
              <Text style={[baseStyles.th, { width: '14%' }]}>Control</Text>
              <Text style={[baseStyles.th, { width: '18%' }]}>Owner</Text>
              <Text style={[baseStyles.th, { width: '12%' }]}>Priority</Text>
              <Text style={[baseStyles.th, { width: '12%' }]}>Status</Text>
              <Text style={[baseStyles.th, { width: '10%', textAlign: 'right' }]}>Due</Text>
            </View>
            {activePriorities.map((p) => {
              const lvl = p.priority_level ?? 0;
              const lvlColor = lvl === 4 ? palette.severity.critical
                : lvl === 3 ? palette.severity.high
                : lvl === 2 ? palette.severity.medium : palette.severity.low;
              return (
                <View key={p.id} style={baseStyles.tr} wrap={false}>
                  <View style={{ width: '34%' }}>
                    <Text style={[baseStyles.td, { fontWeight: 700 }]}>{p.title}</Text>
                    {p.detail && (
                      <Text style={{ fontSize: 8, color: palette.muted, marginTop: 2 }}>
                        {p.detail.length > 140 ? p.detail.slice(0, 140) + '…' : p.detail}
                      </Text>
                    )}
                  </View>
                  <Text style={[baseStyles.tdMono, { width: '14%' }]}>{p.control_id ?? '—'}</Text>
                  <Text style={[baseStyles.td, { width: '18%' }]}>{p.owner ?? '—'}</Text>
                  <Text style={[baseStyles.td, { width: '12%', color: lvlColor, fontWeight: 700 }]}>
                    {lvl > 0 ? PRIORITY_LABEL[lvl] : '—'}
                  </Text>
                  <Text style={[baseStyles.td, { width: '12%', color: statusColor(p.status), fontWeight: 600 }]}>
                    {p.status}
                  </Text>
                  <Text style={[baseStyles.tdMono, { width: '10%', textAlign: 'right' }]}>
                    {p.due_date ?? '—'}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Work plan tasks per function */}
        <Text style={baseStyles.sectionH}>2. Work Plan Tasks by Function</Text>
        {orderedFunctions.length === 0 ? (
          <Text style={[baseStyles.para, { color: palette.muted }]}>No work plan tasks logged.</Text>
        ) : (
          orderedFunctions.map((fn) => {
            const c = GROUP_COLORS[fn] ?? { accent: palette.primary };
            const fnTasks = (tasksByFunction.get(fn) ?? []).slice().sort((a, b) =>
              a.control_id.localeCompare(b.control_id) || a.title.localeCompare(b.title),
            );
            const open = fnTasks.filter((t) => t.status !== 'Complete').length;
            const done = fnTasks.filter((t) => t.status === 'Complete').length;
            return (
              <View key={fn} wrap={false} style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                  <View style={{
                    width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent, marginRight: 8,
                  }} />
                  <Text style={{
                    fontFamily: 'Helvetica-Bold', fontSize: 11, fontWeight: 700,
                    color: c.accent, letterSpacing: 1, textTransform: 'uppercase',
                  }}>{fn}</Text>
                  <Text style={{ fontSize: 9, color: palette.muted, marginLeft: 8 }}>
                    {open} open · {done} complete
                  </Text>
                </View>
                <View style={baseStyles.table}>
                  <View style={[baseStyles.tr, { borderBottomWidth: 0.5, borderBottomColor: palette.rule }]}>
                    <Text style={[baseStyles.th, { width: '14%' }]}>Control</Text>
                    <Text style={[baseStyles.th, { width: '46%' }]}>Task</Text>
                    <Text style={[baseStyles.th, { width: '18%' }]}>Owner</Text>
                    <Text style={[baseStyles.th, { width: '12%' }]}>Status</Text>
                    <Text style={[baseStyles.th, { width: '10%', textAlign: 'right' }]}>Due</Text>
                  </View>
                  {fnTasks.map((t) => (
                    <View key={t.id} style={baseStyles.tr} wrap={false}>
                      <Text style={[baseStyles.tdMono, { width: '14%' }]}>{t.control_id}</Text>
                      <View style={{ width: '46%' }}>
                        <Text style={baseStyles.td}>{t.title}</Text>
                        {t.detail && (
                          <Text style={{ fontSize: 8, color: palette.muted, marginTop: 2 }}>
                            {t.detail.length > 120 ? t.detail.slice(0, 120) + '…' : t.detail}
                          </Text>
                        )}
                      </View>
                      <Text style={[baseStyles.td, { width: '18%' }]}>{t.owner ?? '—'}</Text>
                      <Text style={[baseStyles.td, { width: '12%', color: statusColor(t.status), fontWeight: 600 }]}>
                        {t.status}
                      </Text>
                      <Text style={[baseStyles.tdMono, { width: '10%', textAlign: 'right' }]}>
                        {t.due_date ?? '—'}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })
        )}
      </Page>
    </Document>
  );
}
