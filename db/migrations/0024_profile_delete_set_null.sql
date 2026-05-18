-- 0024_profile_delete_set_null.sql
--
-- Make hard-delete of a profiles row possible without losing history.
--
-- Five FKs referencing public.profiles(id) were created without an
-- ON DELETE clause, so the default NO ACTION (RESTRICT) blocks any
-- attempt to delete a profile. We want to allow operators to
-- permanently remove a disabled user without nuking the per-control
-- audit log, score history, snapshots, or KPI observations the user
-- ever touched. Switch each constraint to ON DELETE SET NULL — the
-- historical rows stay, the "who did this" pointer becomes null, and
-- (where applicable) email/display_name captured in audit detail json
-- still attributes the action to the long-gone user.
--
-- All five columns are already nullable, so SET NULL won't violate any
-- check.

-- Helper macro pattern: drop the old constraint, re-add with SET NULL.
-- Each block is independent so a single failure doesn't leave the
-- schema half-migrated.

alter table public.audit_log
  drop constraint if exists audit_log_changed_by_fkey,
  add  constraint audit_log_changed_by_fkey
    foreign key (changed_by) references public.profiles(id) on delete set null;

alter table public.current_scores
  drop constraint if exists current_scores_updated_by_fkey,
  add  constraint current_scores_updated_by_fkey
    foreign key (updated_by) references public.profiles(id) on delete set null;

alter table public.kpi_observations
  drop constraint if exists kpi_observations_recorded_by_fkey,
  add  constraint kpi_observations_recorded_by_fkey
    foreign key (recorded_by) references public.profiles(id) on delete set null;

alter table public.snapshots
  drop constraint if exists snapshots_taken_by_fkey,
  add  constraint snapshots_taken_by_fkey
    foreign key (taken_by) references public.profiles(id) on delete set null;

alter table public.snapshot_shares
  drop constraint if exists snapshot_shares_created_by_fkey,
  add  constraint snapshot_shares_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;
