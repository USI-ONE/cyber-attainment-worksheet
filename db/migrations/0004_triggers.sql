-- 0004_triggers.sql
-- Audit trigger on current_scores; auth signup hook for profile + domain whitelist.

-- =============================================================
-- Audit trigger: emit one row per changed field on insert/update/delete
-- =============================================================

create or replace function fn_audit_current_scores()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fields text[] := array['pol','pra','gol','prio','owner','status','notes'];
  f text;
  old_v text;
  new_v text;
begin
  if (tg_op = 'DELETE') then
    foreach f in array fields loop
      execute format('select ($1).%I::text', f) into old_v using OLD;
      if old_v is not null then
        insert into audit_log (tenant_id, framework_version_id, control_id, field, old_value, new_value, changed_by)
        values (OLD.tenant_id, OLD.framework_version_id, OLD.control_id, f, old_v, null, OLD.updated_by);
      end if;
    end loop;
    return OLD;
  end if;

  if (tg_op = 'INSERT') then
    foreach f in array fields loop
      execute format('select ($1).%I::text', f) into new_v using NEW;
      if new_v is not null then
        insert into audit_log (tenant_id, framework_version_id, control_id, field, old_value, new_value, changed_by)
        values (NEW.tenant_id, NEW.framework_version_id, NEW.control_id, f, null, new_v, NEW.updated_by);
      end if;
    end loop;
    return NEW;
  end if;

  -- UPDATE
  foreach f in array fields loop
    execute format('select ($1).%I::text', f) into old_v using OLD;
    execute format('select ($1).%I::text', f) into new_v using NEW;
    if (old_v is distinct from new_v) then
      insert into audit_log (tenant_id, framework_version_id, control_id, field, old_value, new_value, changed_by)
      values (NEW.tenant_id, NEW.framework_version_id, NEW.control_id, f, old_v, new_v, NEW.updated_by);
    end if;
  end loop;
  return NEW;
end;
$$;

create trigger trg_audit_current_scores
after insert or update or delete on current_scores
for each row execute function fn_audit_current_scores();

-- =============================================================
-- Auth signup hook: create profile + auto-grant domain-whitelisted memberships
-- =============================================================

create or replace function fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_email    text := lower(new.email);
  email_domain text := split_part(new_email, '@', 2);
  wl record;
begin
  insert into profiles (id, email, display_name)
  values (
    new.id,
    new_email,
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', new_email)
  )
  on conflict (id) do nothing;

  for wl in
    select tenant_id, default_role
    from domain_whitelist
    where domain = email_domain
  loop
    insert into memberships (user_id, tenant_id, role)
    values (new.id, wl.tenant_id, wl.default_role)
    on conflict (user_id, tenant_id) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
after insert on auth.users
for each row execute function fn_handle_new_user();
