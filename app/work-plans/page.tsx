import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import WorkPlansClient from '@/components/WorkPlansClient';

export const dynamic = 'force-dynamic';

export default async function WorkPlansPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  const fw = await loadActiveFramework(tenant);
  if (!fw) return <main className="app-main"><div className="banner error">No framework.</div></main>;

  const supabase = createServiceRoleClient();
  const [{ data: tasks }, { data: notes }] = await Promise.all([
    supabase.from('work_plan_tasks').select('*').eq('tenant_id', tenant.id)
      .order('control_id').order('display_order').order('created_at'),
    supabase.from('work_plan_notes').select('control_id, notes')
      .eq('tenant_id', tenant.id).eq('framework_version_id', fw.version.id),
  ]);

  const notesMap: Record<string, string> = {};
  for (const r of notes ?? []) notesMap[(r as { control_id: string }).control_id] = (r as { notes: string }).notes ?? '';

  return (
    <main className="app-main">
      <WorkPlansClient
        definition={fw.definition}
        initialTasks={tasks ?? []}
        initialNotes={notesMap}
      />
    </main>
  );
}
