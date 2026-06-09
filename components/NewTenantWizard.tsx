'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /admin/tenants/new wizard. Single-page form (no multi-step) that
 * captures every onboarding-time field the API accepts and surfaces a
 * "next steps" panel on successful create — because the database side
 * of onboarding is the most common ask, the Vercel-project-creation
 * piece is still manual and intentionally surfaced as a script command
 * the admin can copy/paste rather than embedding a Vercel API token in
 * the platform.
 *
 * Auto-defaults are tuned for the common case: NIST CSF 2.0 active,
 * baseline POL=3 / GOL=3, no brand config, no admin-tenant flag.
 * Slug + display name are the only required fields; everything else
 * the admin can edit later from /admin/tenants.
 */

export interface AvailableFramework {
  id: string;
  slug: string;
  version: string;
  display_name: string;
}

export default function NewTenantWizard({ frameworks }: { frameworks: AvailableFramework[] }) {
  const router = useRouter();

  // Slug derived from display name as the user types — kebab-cased
  // approximation, the admin can override before submit.
  const [displayName, setDisplayName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugAuto, setSlugAuto] = useState(true);
  function onDisplayNameChange(v: string) {
    setDisplayName(v);
    if (slugAuto) {
      const next = v
        .toLowerCase()
        .replace(/[^a-z0-9\s-]+/g, '')
        .trim()
        .replace(/\s+/g, '-');
      setSlug(next);
    }
  }
  function onSlugChange(v: string) {
    setSlug(v);
    setSlugAuto(false);  // user-edited; stop auto-generating
  }

  const [hostname, setHostname] = useState('');
  const defaultHostname = slug ? `caw-${slug}.vercel.app` : '';

  // Framework + seeding. Default to the first framework that looks like
  // "NIST CSF" — that's the canonical scoring framework on the platform.
  const defaultFw = frameworks.find((f) => f.slug === 'nist-csf-2.0')?.id ?? frameworks[0]?.id ?? '';
  const [frameworkId, setFrameworkId] = useState(defaultFw);
  const [seedScores, setSeedScores] = useState<'none' | 'baseline'>('baseline');
  const [baselinePol, setBaselinePol] = useState('3.0');
  const [baselineGol, setBaselineGol] = useState('3.0');

  // Brand config
  const [primaryColor, setPrimaryColor] = useState('');
  const [logoUrl, setLogoUrl] = useState('');

  // Admin-tenant flag
  const [isAdminTenant, setIsAdminTenant] = useState(false);

  // Submit state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    tenant: { id: string; slug: string; display_name: string; hostname: string | null };
    framework_assigned: { framework_version_id: string; control_count: number } | null;
    baseline_seeded: { count: number; pol: number; gol: number } | null;
    warning?: string;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      setError('Slug must be kebab-case (a–z, 0–9, hyphens, no leading hyphen).');
      return;
    }
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    if (isAdminTenant && !confirm(
      `Mark "${displayName}" as an ADMIN TENANT? Anyone added to this tenant with role=admin will get platform-wide admin access. Only flip this on if you mean it.`,
    )) {
      return;
    }

    const brand_config: Record<string, unknown> = {};
    if (primaryColor.trim() || logoUrl.trim()) {
      const theme: Record<string, string> = {};
      if (primaryColor.trim()) theme.primary = primaryColor.trim();
      if (Object.keys(theme).length > 0) brand_config.theme = theme;
      if (logoUrl.trim()) brand_config.logo_url = logoUrl.trim();
    }

    setBusy(true);
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          display_name: displayName.trim(),
          hostname: hostname.trim() || undefined,
          brand_config,
          is_admin_tenant: isAdminTenant,
          framework_version_id: frameworkId || undefined,
          seed_scores: frameworkId ? seedScores : 'none',
          baseline_pol: parseFloat(baselinePol),
          baseline_gol: parseFloat(baselineGol),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setCreated(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }

  // ---- success view --------------------------------------------------
  if (created) {
    return <SuccessPanel created={created} onAnother={() => router.refresh()} />;
  }

  // ---- form view -----------------------------------------------------
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            New tenant
          </h1>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-mid)' }}>
            Creates the tenant row, assigns an active framework, and seeds baseline scores so the dashboard renders immediately.
          </div>
        </div>
        <Link href="/admin/tenants" className="action-btn">← Back to all tenants</Link>
      </div>

      <form onSubmit={submit} style={{
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <Section title="Identity" hint="Slug is immutable. Display name is what users see.">
          <Field label="Display name" required>
            <input className="score-select"
              value={displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              placeholder="Acme Corporation" required autoFocus />
          </Field>
          <Field label="Slug" hint="kebab-case, lowercase, no spaces. Auto-derived from display name; click to edit.">
            <input className="score-select"
              value={slug}
              pattern="[a-z0-9][a-z0-9-]*"
              onChange={(e) => onSlugChange(e.target.value)}
              placeholder="acme-corp" required />
          </Field>
        </Section>

        <Section title="Hostname" hint="Production URL the tenant deploy resolves on. Default mirrors the Vercel naming convention; override if you've set up a custom domain.">
          <Field label="Hostname (optional)">
            <input className="score-select"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder={defaultHostname || 'caw-<slug>.vercel.app'} />
          </Field>
        </Section>

        <Section title="Framework + baseline" hint="The framework decides which control set the tenant scores against. Baseline seeding pre-populates POL + GOL so dashboards aren't empty on day one.">
          <Field label="Active framework">
            <select className="score-select" value={frameworkId}
              onChange={(e) => setFrameworkId(e.target.value)}>
              <option value="">— skip (data-only tenant) —</option>
              {frameworks.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.display_name} {f.version}
                </option>
              ))}
            </select>
          </Field>
          {frameworkId && (
            <Field label="Seed baseline scores"
              hint="Bulk-create current_scores rows for every control in the framework. The tenant can refine these later via the worksheet.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="radio" name="seed" checked={seedScores === 'baseline'}
                    onChange={() => setSeedScores('baseline')} />
                  Seed POL + GOL across every control (recommended)
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="radio" name="seed" checked={seedScores === 'none'}
                    onChange={() => setSeedScores('none')} />
                  Leave scores empty — admin will populate later
                </label>
                {seedScores === 'baseline' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
                    <Field label="POL baseline" hint="0.5..5.0 in 0.5 steps">
                      <input className="score-select" type="number" min="0.5" max="5" step="0.5"
                        value={baselinePol} onChange={(e) => setBaselinePol(e.target.value)} />
                    </Field>
                    <Field label="GOL baseline" hint="0.5..5.0 in 0.5 steps">
                      <input className="score-select" type="number" min="0.5" max="5" step="0.5"
                        value={baselineGol} onChange={(e) => setBaselineGol(e.target.value)} />
                    </Field>
                  </div>
                )}
              </div>
            </Field>
          )}
        </Section>

        <Section title="Branding (optional)" hint="Tints the tenant deploy's chrome and replaces the placeholder logo block. Both can be edited later from /admin/tenants.">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
            <Field label="Primary color (hex)">
              <input className="score-select" type="text"
                pattern="^#?[0-9a-fA-F]{3,8}$"
                value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#2563EB" />
            </Field>
            <Field label="Logo URL">
              <input className="score-select" type="url"
                value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://acme.example.com/logo.svg" />
            </Field>
          </div>
        </Section>

        <Section title="Advanced">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={isAdminTenant} onChange={(e) => setIsAdminTenant(e.target.checked)} />
            <strong>Admin tenant</strong> — anyone added to this tenant with <code>role=admin</code> gets platform-wide admin access. Only set this for an operator-staff tenant.
          </label>
        </Section>

        {error && (
          <div className="banner error" style={{ padding: '10px 14px' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Link href="/admin/tenants" className="action-btn">Cancel</Link>
          <button type="submit" className="action-btn primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create tenant'}
          </button>
        </div>
      </form>
    </>
  );
}

function SuccessPanel({ created, onAnother }: {
  created: NonNullable<Parameters<typeof NewTenantWizard>[0]['frameworks']> extends unknown ? {
    tenant: { id: string; slug: string; display_name: string; hostname: string | null };
    framework_assigned: { framework_version_id: string; control_count: number } | null;
    baseline_seeded: { count: number; pol: number; gol: number } | null;
    warning?: string;
  } : never;
  onAnother: () => void;
}) {
  const t = created.tenant;
  // Manual Vercel-project bootstrap script. Surfaced as a copy-paste
  // command because we don't want to keep a Vercel PAT in env vars on
  // the hub — it would let any code running on the hub mint deploys on
  // the team. The admin runs this locally where they're already
  // authenticated against Vercel.
  const vercelBootstrap = `# Run locally (any machine with vercel CLI auth):
vercel link --yes --project caw-${t.slug} --scope usi-ones-projects 2>/dev/null || true
vercel env add NEXT_PUBLIC_SUPABASE_URL production <<< 'https://pfhlhwawiyzwwhwbcmsz.supabase.co'
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY production
vercel env add SUPABASE_SECRET_KEY production
vercel env add RESEND_API_KEY production
vercel env add EMAIL_FROM production <<< 'SecureOS <no-reply@usisecureos.tech>'
vercel env add AUTH_REQUIRED production <<< 'true'
vercel --prod`;

  return (
    <>
      <div className="banner success" style={{ padding: '16px 18px', marginBottom: 18 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          Tenant <strong>{t.display_name}</strong> created
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 4 }}>
          slug: <code>{t.slug}</code>{t.hostname && <> · hostname: <code>{t.hostname}</code></>}
        </div>
        {created.framework_assigned && (
          <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 4 }}>
            Framework assigned · {created.framework_assigned.control_count} controls
          </div>
        )}
        {created.baseline_seeded && (
          <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 4 }}>
            Baseline scores seeded · {created.baseline_seeded.count} rows
            (POL={created.baseline_seeded.pol}, GOL={created.baseline_seeded.gol})
          </div>
        )}
        {created.warning && (
          <div style={{ fontSize: 12, color: 'var(--red-text)', marginTop: 6 }}>
            ⚠ {created.warning}
          </div>
        )}
      </div>

      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Next: spin up the Vercel project</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              The DB side is done. To make {t.display_name} reachable at a tenant URL, run the script below locally where your Vercel CLI is authenticated. Storing a long-lived Vercel API token in env vars on the hub would give every deploy permission to mint new projects — intentionally not doing that.
            </div>
          </div>
        </div>

        <pre style={{
          background: 'var(--bg-deep)', border: '1px solid var(--bg-border)',
          borderRadius: 'var(--r-md)', padding: '12px 14px',
          fontSize: 11.5, fontFamily: 'Inter, sans-serif', overflowX: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: 'var(--text)',
        }}>{vercelBootstrap}</pre>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            className="action-btn primary"
            onClick={() => {
              navigator.clipboard.writeText(vercelBootstrap)
                .catch(() => alert('Clipboard write failed; copy manually.'));
            }}
          >Copy script</button>
          <Link href="/admin/tenants" className="action-btn">Back to tenants list</Link>
          <Link href="/admin/tenants/new" className="action-btn" onClick={(e) => {
            // Soft-reset: re-render the wizard with an empty form.
            e.preventDefault();
            onAnother();
          }}>Add another tenant</Link>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Form layout helpers
// ---------------------------------------------------------------------------

function Section({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <section className="scorecard">
      <div className="scorecard-header" style={{ marginBottom: 12 }}>
        <div>
          <div className="scorecard-title">{title}</div>
          {hint && <div className="scorecard-tag" style={{ marginTop: 4 }}>{hint}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </div>
    </section>
  );
}

function Field({ label, hint, required, children }: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{
        fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 11,
        letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-mid)',
      }}>
        {label}{required && <span style={{ color: 'var(--red-text)', marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}
