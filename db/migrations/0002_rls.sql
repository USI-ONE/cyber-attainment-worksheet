-- 0002_rls.sql
-- Row Level Security policies. Run after 0001_init.sql.

-- =============================================================
-- Helper functions (security definer; safe because they only check membership)
-- =============================================================

create or replace function user_can_see_tenant(t uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and tenant_id = t
  );
$$;

create or replace function user_has_tenant_role(t uuid, r membership_role)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and tenant_id = t and role = r
  );
$$;

-- =============================================================
-- profiles: self read/write
-- =============================================================

alter table profiles enable row level security;

create policy profiles_self_read  on profiles for select using (id = auth.uid());
create policy profiles_self_write on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- =============================================================
-- tenants: members can read their own tenants
-- =============================================================

alter table tenants enable row level security;

create policy tenants_member_read on tenants for select using (user_can_see_tenant(id));

-- =============================================================
-- memberships: a user can see their own memberships
-- =============================================================

alter table memberships enable row level security;

create policy memberships_self_read on memberships for select using (user_id = auth.uid());

-- =============================================================
-- frameworks / framework_versions: world-readable to authenticated users
-- tenant_frameworks: members of the tenant
-- =============================================================

alter table frameworks         enable row level security;
alter table framework_versions enable row level security;
alter table tenant_frameworks  enable row level security;

create policy frameworks_auth_read         on frameworks         for select using (auth.role() = 'authenticated');
create policy framework_versions_auth_read on framework_versions for select using (auth.role() = 'authenticated');
create policy tenant_frameworks_member_read on tenant_frameworks for select using (user_can_see_tenant(tenant_id));

-- =============================================================
-- current_scores: read by membership, write by editor
-- =============================================================

alter table current_scores enable row level security;

create policy current_scores_member_read on current_scores for select
  using (user_can_see_tenant(tenant_id));

create policy current_scores_editor_write on current_scores for all
  using      (user_has_tenant_role(tenant_id, 'editor'))
  with check (user_has_tenant_role(tenant_id, 'editor'));

-- =============================================================
-- snapshots: read by membership OR active share to your tenant; write by editor
-- =============================================================

alter table snapshots enable row level security;

create policy snapshots_member_or_share_read on snapshots for select
  using (
    user_can_see_tenant(tenant_id)
    or exists (
      select 1
      from snapshot_shares ss
      join memberships m on m.tenant_id = ss.recipient_tenant_id
      where ss.snapshot_id = snapshots.id
        and m.user_id = auth.uid()
        and ss.revoked_at is null
        and (ss.expires_at is null or ss.expires_at > now())
    )
  );

create policy snapshots_editor_write on snapshots for all
  using      (user_has_tenant_role(tenant_id, 'editor'))
  with check (user_has_tenant_role(tenant_id, 'editor'));

-- =============================================================
-- snapshot_scores: read iff parent snapshot is readable
-- =============================================================

alter table snapshot_scores enable row level security;

create policy snapshot_scores_inherit_read on snapshot_scores for select
  using (
    exists (
      select 1 from snapshots s
      where s.id = snapshot_scores.snapshot_id
        and (
          user_can_see_tenant(s.tenant_id)
          or exists (
            select 1
            from snapshot_shares sh
            join memberships m on m.tenant_id = sh.recipient_tenant_id
            where sh.snapshot_id = s.id
              and m.user_id = auth.uid()
              and sh.revoked_at is null
              and (sh.expires_at is null or sh.expires_at > now())
          )
        )
    )
  );

-- =============================================================
-- snapshot_shares: only owners (members of source tenant) can read; only editors of source can write
-- (Public-token reads happen via service-role edge function, not via RLS.)
-- =============================================================

alter table snapshot_shares enable row level security;

create policy snapshot_shares_owner_read on snapshot_shares for select
  using (
    exists (
      select 1 from snapshots s
      where s.id = snapshot_shares.snapshot_id
        and user_can_see_tenant(s.tenant_id)
    )
  );

create policy snapshot_shares_editor_write on snapshot_shares for all
  using (
    exists (
      select 1 from snapshots s
      where s.id = snapshot_shares.snapshot_id
        and user_has_tenant_role(s.tenant_id, 'editor')
    )
  );

-- =============================================================
-- audit_log: editors of the tenant only
-- =============================================================

alter table audit_log enable row level security;

create policy audit_log_editor_read on audit_log for select
  using (user_has_tenant_role(tenant_id, 'editor'));

-- =============================================================
-- domain_whitelist: not user-readable. Service role bypasses RLS.
-- =============================================================

alter table domain_whitelist enable row level security;
-- No policies = no access for anon/authenticated keys. By design.
