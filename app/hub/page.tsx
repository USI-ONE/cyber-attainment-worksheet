import { createServiceRoleClient } from '@/lib/supabase/server';
import { computeAttention, summarize, type AttentionItem, type AttentionSummary } from '@/lib/attention';

/**
 * Portfolio Hub — operator-only landing page that lists every tenant portal
 * with at-a-glance signals (open incidents, last scoring update, last
 * snapshot, active policy docs, attention summary).
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
  attention: AttentionSummary;
  top_attention: AttentionItem[];      // up to 3 highest-severity items
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

  // Per-tenant signals in parallel: small queries × N tenants. Attention feed
  // is computed in lib/attention; we keep the top 3 highest-severity items
  // so the operator can scan the watchlist without clicking through.
  const cards: TenantCard[] = await Promise.all(
    ((tenants ?? []) as TenantRow[]).map(async (t) => {
      const [incRes, scoreRes, snapRes, policyRes, attention] = await Promise.all([
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
        computeAttention(t.id, supabase),
      ]);
      const brand = t.brand_config ?? {};
      return {
        id: t.id,
        slug: t.slug,
        display_name: t.display_name,
        url: 'https://' + (t.hostname ?? `caw-${t.slug}.vercel.app`),
        logo_url: brand.logo_url ?? null,
        accent: brand.theme?.primary ?? '#475569',
        open_incidents: incRes.count ?? 0,
        last_scored: scoreRes.data?.[0]?.updated_at ?? null,
        last_snapshot: snapRes.data?.[0]?.taken_at ?? null,
        policy_doc_count: policyRes.count ?? 0,
        attention: summarize(attention),
        top_attention: attention.slice(0, 3),
      };
    }),
  );

  cards.sort((a, b) => a.display_name.localeCompare(b.display_name));

  // Portfolio-level rollup across every tenant.
  const portfolio: AttentionSummary = {
    total: 0, critical: 0, high: 0, medium: 0, low: 0, by_kind: {},
  };
  for (const c of cards) {
    portfolio.total    += c.attention.total;
    portfolio.critical += c.attention.critical;
    portfolio.high     += c.attention.high;
    portfolio.medium   += c.attention.medium;
    portfolio.low      += c.attention.low;
  }

  // Watchlist = critical-and-high items only, grouped by tenant.
  const watchlist: { tenant: TenantCard; item: AttentionItem }[] = [];
  for (const c of cards) {
    for (const it of c.top_attention) {
      if (it.severity === 'critical' || it.severity === 'high') watchlist.push({ tenant: c, item: it });
    }
  }

  return (
    <main className="app-main">
      {/* Portfolio rollup */}
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <KpiTile label="Tenants" value={cards.length.toString()} sub="active portals" accent="#2563EB" />
        <KpiTile label="Critical" value={portfolio.critical.toString()} sub="items across portfolio" accent="#991B1B" />
        <KpiTile label="High"     value={portfolio.high.toString()}     sub="items across portfolio" accent="#DC2626" />
        <KpiTile label="Medium"   value={portfolio.medium.toString()}   sub="items across portfolio" accent="#F59E0B" />
        <KpiTile label="Low"      value={portfolio.low.toString()}      sub="items across portfolio" accent="#64748B" />
      </div>

      {/* Watchlist */}
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Portfolio Watchlist</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              {watchlist.length === 0
                ? 'No critical or high items across the portfolio right now — clean board.'
                : `${watchlist.length} critical / high item${watchlist.length === 1 ? '' : 's'} across ${
                    new Set(watchlist.map((w) => w.tenant.id)).size
                  } tenant${new Set(watchlist.map((w) => w.tenant.id)).size === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>

        {watchlist.length === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-mid)', fontSize: 13 }}>
            <span style={{ fontSize: 22, marginRight: 8, color: '#10B981' }}>✓</span>
            Nothing critical or high across all tenants.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {watchlist.map((w, idx) => {
              const sevColor = w.item.severity === 'critical' ? '#991B1B' : '#DC2626';
              const sevBg    = w.item.severity === 'critical' ? 'rgba(153,27,27,0.08)' : 'rgba(220,38,38,0.08)';
              return (
                <a
                  key={idx}
                  href={w.tenant.url + w.item.href}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'grid', gridTemplateColumns: '4px 1fr auto auto', gap: 12, alignItems: 'center',
                    padding: '10px 12px', background: sevBg,
                    borderRadius: 'var(--r-md)', textDecoration: 'none', color: 'var(--text)',
                  }}
                >
                  <span style={{ width: 4, height: 28, background: sevColor, borderRadius: 999 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: sevColor,
                      textTransform: 'uppercase', letterSpacing: '.04em',
                    }}>
                      {w.tenant.display_name}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginTop: 1,
                                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {w.item.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-mid)', marginTop: 2 }}>
                      {w.item.detail}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: sevColor,
                    textTransform: 'uppercase', letterSpacing: '.04em',
                  }}>
                    {w.item.severity}
                  </span>
                  <span style={{ color: sevColor, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Open →
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </section>

      {/* Tenant cards header */}
      <section className="scorecard" style={{ marginBottom: 0, paddingBottom: 12 }}>
        <div className="scorecard-header" style={{ marginBottom: 0 }}>
          <div>
            <div className="scorecard-title">Tenant Portals</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              {cards.length} {cards.length === 1 ? 'portal' : 'portals'} · click a card to open in a new tab
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
                  color: c.accent, fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 11,
                }}>{c.slug.slice(0, 2).toUpperCase()}</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dash-card-name" style={{ fontSize: 14, fontWeight: 600 }}>
                  {c.display_name}
                </div>
                <div style={{
                  fontSize: 10, color: 'var(--text-muted)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  fontFamily: 'Inter, sans-serif',
                }}>
                  {c.url.replace(/^https?:\/\//, '')}
                </div>
              </div>
              {c.attention.total > 0 && (
                <AttentionBadge summary={c.attention} />
              )}
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

function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="kpi-tile" style={{ ['--accent' as never]: accent }}>
      <div className="kpi-tile-label">{label}</div>
      <div className="kpi-tile-value">{value}</div>
      <div className="kpi-tile-sub">{sub}</div>
    </div>
  );
}

function AttentionBadge({ summary }: { summary: AttentionSummary }) {
  // Pick the worst-severity color present so the chip carries the urgency.
  const color =
    summary.critical > 0 ? '#991B1B'
    : summary.high > 0   ? '#DC2626'
    : summary.medium > 0 ? '#F59E0B'
    : '#64748B';
  return (
    <span
      title={`Critical: ${summary.critical} · High: ${summary.high} · Medium: ${summary.medium} · Low: ${summary.low}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 8px',
        background: `${color}1a`, color, border: `1px solid ${color}55`,
        borderRadius: 999, fontSize: 11, fontWeight: 700, lineHeight: 1,
        fontFamily: 'Inter, sans-serif',
        flexShrink: 0,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {summary.total}
    </span>
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
