-- Temp-password invite flow.
--
-- The original invite flow issued a single-use magic-link token; the
-- invitee clicked the link and set their own password on /auth/accept-invite.
-- That works, but operators wanted a simpler "give them a one-time password
-- and force the change on first login" path so they can read the credentials
-- aloud or paste them into a chat without the invitee chasing a link.
--
-- This migration adds a single boolean flag. When true, every part of the
-- app forces the user through /auth/change-password before any other UI is
-- usable. The flag is set by the admin/users + settings/users POST handlers
-- when they create the user with a generated temp password, and cleared by
-- the password-change handler once the user picks a real password.

alter table public.profiles
  add column if not exists password_must_change boolean not null default false;

comment on column public.profiles.password_must_change is
  'When true, the user is forced through /auth/change-password before any other UI is usable. Set when an admin issues a temp-password invite; cleared by the user changing their password.';
