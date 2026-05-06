import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * Portfolio Hub — operator-only landing page that lists every tenant portal
 * with at-a-glance signals (open incidents, last scoring update, last
 * snapshot, active policy docs).
 *
 * The hub lives on its own Vercel deployment with the env var
 * `OPERATOR_MODE=true` set. That deploy has no `TENANT_SLUG`, so it is not a
 * tenant itself — every customer (including USI, the MSP) shows up here as
 * one of the cards. Tenant deploys leave this route as an empty placeholder
 * so the URL never leaks portfolio data even if guessed.
 *
 * When real auth lands, the gate becomes "logged-in MSP user" — the URL
 * stays the same, so any bookmark survives.
 */
export const dynamic = 'force-dynamic';

type TenantRow = {
  id: string;
  slug: string;
  hostname: string | null;
  display_name: string;
  brand_config: { logo_url?: string; tagline?: string; theme?: { primary?: string } } | null;
};

interface TenantCard {
  id: string;
  slug: string;
  display_name: string;
  url: string;
  logo_url: string | null;
  accent: string;
  open_incidents: number;
  last_scored: string | null;
  last_snapshot: string | null;
  policy_doc_count: number;
}

export default async function HubPage() {
  // Gate: hub only renders on the operator deploy. Customer-tenant deploys
  // get a minimal placeholder so the URL never reveals portfolio data.
  if (process.env.OPERATOR_MODE !== 'true') {
    return (
      <main className="app-main">
        <section className="scorecard">
          <div className="scorecard-title">Portfolio Hub</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            The portfolio hub is hosted on the operator deployment, not on this tenant portal.
          </div>
        </section>
      </main>
    );
  }

  const supabase = createServiceRoleClient();

  // Pull every tenant. Order USI first (the operator), then alphabetical for the rest.
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, slug, hostname, display_name, brand_config')
    .order('display_name');

  // Per-tenant signals in parallel: 4 small queries × N tenants.
  const cards: TenantCard[] = await Promise.all(
    ((tenants ?? []) as TenantRow[]).map(async (t) => {
      const [incRes, scoreRes, snapRes, policyRes] = await Promise.all([
        supabase
          .from('incidents')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', t.id)
          .neq('status', 'closed'),
        supabase
          .from('current_scores')
          .select('updated_at')
          .eq('tenant_id', t.id)
          .order('updated_at', { ascending: false })
          .limit(1),
        supabase
          .from('snapshots')
          .select('taken_at')
          .eq('tenant_id', t.id)
          .order('taken_at', { ascending: false })
          .limit(1),
        supabase
          .from('policy_documents')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', t.id)
          .neq('status', 'archived'),
      ]);
      const brand = t.brand_config ?? {};
      return {
        id: t.id,
        slug: t.slug,
        display_name: t.display_name,
        url: 'https://' + (t.hostname ?? `caw-${t.slug}.vercel.app`),
        logo_url: brand.logo_url ?? null,
        accent: brand.theme?.primary ?? '#C9A961',
        open_incidents: incRes.count ?? 0,
        last_scored: scoreRes.data?.[0]?.updated_at ?? null,
        last_snapshot: snapRes.data?.[0]?.taken_at ?? null,
        policy_doc_count: policyRes.count ?? 0,
      };
    }),
  );

  // Alphabetical by display_name. USI shows up as a peer of every other
  // portfolio company — the hub itself is operator-level, separate from
  // any tenant identity.
  cards.sort((a, b) => a.display_name.localeCompare(b.display_name));

  return (
    <main className="app-main">
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Portfolio Hub</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              {cards.length} tenant {cards.length === 1 ? 'portal' : 'portals'} · click a card to open in a new tab
            </div>
          </div>
        </div>
      </section>

      <section className="dash">
        {cards.map((c) => (
          <a
            key={c.id}
            href={c.url}
            className="dash-card"
            style={{
              ['--fn-color' as never]: c.accent,
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              {c.logo_url ? (
                <img src={c.logo_url} alt="" width={28} height={28}
                  style={{ borderRadius: 4, background: 'var(--bg-deep)' }} />
              ) : (
                <div style={{
                  width: 28, height: 28, borderRadius: 4,
                  background: c.accent + '33', border: '1px solid ' + c.accent + '55',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: c.accent, fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 11,
                }}>{c.slug.slice(0, 2).toUpperCase()}</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dash-card-name" style={{ fontSize: 14, fontWeight: 600 }}>
                  {c.display_name}
                </div>
                <div style={{
                  fontSize: 10, color: 'var(--text-muted)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  fontFamily: 'JetBrains Mono, monospace',
                }}>
                  {c.url.replace(/^https?:\/\//, '')}
                </div>
              </div>
            </div>

            <div className="dash-card-stats">
              <div className="dash-stat">
                <span className="dash-stat-val" style={{
                  fontSize: 18,
                  color: c.open_incidents > 0 ? '#FCA5A5' : 'var(--text-mid)',
                }}>{c.open_incidents}</span>
                <span className="dash-stat-lbl">Open incidents</span>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-val" style={{ fontSize: 13 }}>
                  {fmtRel(c.last_scored)}
                </span>
                <span className="dash-stat-lbl">Last scored</span>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-val" style={{ fontSize: 13 }}>
                  {fmtRel(c.last_snapshot)}
                </span>
                <span className="dash-stat-lbl">Last snapshot</span>
              </div>
            </div>

            <div style={{
              marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--bg-border)',
              fontSize: 10, color: 'var(--text-muted)',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>{c.policy_doc_count} policy doc{c.policy_doc_count === 1 ? '' : 's'}</span>
              <span style={{ color: c.accent }}>Open portal →</span>
            </div>
          </a>
        ))}
      </section>
    </main>
  );
}

/** "today" / "yesterday" / "Nd ago" / "Nw ago" / "Nmo ago" / "—". */
function fmtRel(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 0) return 'just now';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
