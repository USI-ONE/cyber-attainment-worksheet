import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { computePracticeScore } from '@/lib/assessment';
import type { AssessmentAnswer, AssessmentResponse } from '@/lib/supabase/types';

/**
 * GET /api/assessment/[control_id] — fetch the saved response for one control.
 * POST /api/assessment/[control_id] — upsert an answer set; recomputes the
 *   Practice score and writes it to current_scores.pra so the radar /
 *   worksheet / executive reports update in real time.
 *
 * Allowed answers: 'no' | 'partial' | 'yes' | null.
 * If all three answers are 'yes' AND q4_improvement is non-empty,
 * the score reaches 5.0 (Optimizing).
 */
export const dynamic = 'force-dynamic';

const ANSWERS: readonly AssessmentAnswer[] = ['no', 'partial', 'yes'];

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function asAnswer(v: unknown): AssessmentAnswer | null {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  return (ANSWERS as readonly string[]).includes(v) ? (v as AssessmentAnswer) : null;
}

export async function GET(request: NextRequest, { params }: { params: { control_id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const fw = await loadActiveFramework(tenant);
  if (!fw) return bad('no active framework');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('assessment_responses')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('framework_version_id', fw.version.id)
    .eq('control_id', params.control_id)
    .maybeSingle();
  if (error) return bad(error.message, 500);
  return NextResponse.json({ response: (data ?? null) as AssessmentResponse | null });
}

export async function POST(request: NextRequest, { params }: { params: { control_id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const fw = await loadActiveFramework(tenant);
  if (!fw) return bad('no active framework');

  let body: Partial<AssessmentResponse>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const q1 = asAnswer(body.q1_documented);
  const q2 = asAnswer(body.q2_followed);
  const q3 = asAnswer(body.q3_measured);
  const q4 = body.q4_improvement?.toString() ?? null;
  const notes = body.notes?.toString() ?? null;
  const responded_by = body.responded_by?.toString() ?? null;

  const computed = computePracticeScore({
    q1, q2, q3,
    q4_improvement: q4,
  });

  const supabase = createServiceRoleClient();

  // Upsert the response row.
  const { data: row, error: upErr } = await supabase
    .from('assessment_responses')
    .upsert({
      tenant_id: tenant.id,
      framework_version_id: fw.version.id,
      control_id: params.control_id,
      q1_documented:  q1,
      q2_followed:    q2,
      q3_measured:    q3,
      q4_improvement: q4 && q4.trim() ? q4 : null,
      notes:          notes && notes.trim() ? notes : null,
      computed_score: computed,
      responded_by,
    }, { onConflict: 'tenant_id,framework_version_id,control_id' })
    .select('*')
    .single();
  if (upErr || !row) return bad(upErr?.message ?? 'upsert failed', 500);

  // Mirror the score onto current_scores.pra so the radar/worksheet/reports
  // pick it up immediately. Only writes when we actually have a number — a
  // partial-progress save (no answers yet) shouldn't blow away an existing
  // score the user manually set on /worksheet.
  if (computed != null) {
    const { error: csErr } = await supabase
      .from('current_scores')
      .upsert({
        tenant_id: tenant.id,
        framework_version_id: fw.version.id,
        control_id: params.control_id,
        pra: computed,
        updated_by: responded_by,
      }, { onConflict: 'tenant_id,framework_version_id,control_id' });
    if (csErr) {
      // Don't fail the whole request — the response row is saved; the score
      // mirror is best-effort. Surface the error so the UI can show it.
      return NextResponse.json({
        ok: true,
        response: row as AssessmentResponse,
        computed,
        warning: `assessment saved but pra mirror failed: ${csErr.message}`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    response: row as AssessmentResponse,
    computed,
  });
}
