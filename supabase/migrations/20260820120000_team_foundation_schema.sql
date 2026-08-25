-- Team Foundation — schema (requirements 1-46, 99-138 of the approved Team Foundation
-- specification; see docs/adr/0022-team-foundation-domain-and-persistence.md).
--
-- STATUS: executed. This migration has been applied by `supabase db reset --local`
-- against a real local Supabase Postgres and exercised end to end by the pgTAP suite
-- under supabase/tests/ (see that directory's README.md for the recorded result).
--
-- These are new, cloud-born, cloud-authoritative Team Foundation records. They do
-- not adopt, upload, or otherwise take authority over local Training or Assessment
-- data (docs/adr/0019/0020 remain Proposed and untouched by this migration).

-- pgcrypto lives in the `extensions` schema on Supabase (local and hosted alike),
-- not in `public`. Every SECURITY DEFINER function in this feature pins
-- `search_path = public, pg_temp` (requirement 133), which deliberately does NOT
-- include `extensions` — so pgcrypto is always called SCHEMA-QUALIFIED
-- (`extensions.digest`, `extensions.gen_random_bytes`) in the functions migration
-- rather than by widening a security-sensitive search path. Creating it here with an
-- explicit schema keeps that qualification correct on a database that does not
-- already have the extension.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- A schema for RLS-helper functions that must not be reachable through PostgREST —
-- only the `public` schema (and explicitly configured extras) are exposed by
-- Supabase's API layer, so anything here is callable only from SQL running inside
-- this database (RLS policies, other SECURITY DEFINER functions).
create schema if not exists private;

-- ---------------------------------------------------------------------------------
-- Profiles and identity (requirements 1-13)
-- ---------------------------------------------------------------------------------

-- Profile has its OWN stable identity — never auth.users.id. This is the accepted
-- Team Foundation decision that supersedes the earlier (never-implemented)
-- `profiles.id = auth.users.id` sketch in docs/adr/0020 §"Profiles and account
-- links" — see that ADR's supersession note and docs/adr/0022 Decision 1.
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint display_name_not_blank check (display_name is null or length(btrim(display_name)) > 0),
  constraint display_name_length check (display_name is null or length(display_name) <= 80)
);

comment on table public.profiles is
  'A person represented on the platform. Never keyed by auth.users.id — see account_profile_links.';

-- Explicit one-to-one account/Profile link boundary (requirement 4). account_id is
-- the primary key (at most one profile per account); profile_id is separately unique
-- (at most one account per profile) — both directions enforced, while the table
-- itself is designed so an "unclaimed" profile (a row in `profiles` with no matching
-- row here) remains possible for a future feature without changing Profile identity.
-- Unclaimed profiles are not created by anything in this migration or this beta.
create table public.account_profile_links (
  account_id uuid primary key references auth.users (id) on delete restrict,
  profile_id uuid not null unique references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Athlete is a capability attached to a Profile (requirement 6-8), never a global
-- account type and never created automatically for every account.
create table public.athletes (
  profile_id uuid primary key references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

-- Manually granted closed-beta team-creation capability (requirement 15). Presence
-- of a row is the grant; there is no self-service path to insert one (no RLS INSERT
-- policy is created for `authenticated` — see the RLS migration).
create table public.pilot_team_creation_grants (
  profile_id uuid primary key references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default now(),
  note text
);

-- ---------------------------------------------------------------------------------
-- Teams (requirements 15-25, 99-138)
-- ---------------------------------------------------------------------------------

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 'recovery': the restricted state for the loss of the final Team Admin
  -- (requirements 93-98). Nothing in this beta's RPCs ever transitions a team INTO
  -- this state — see the functions migration's header comment on why entry is
  -- Prepared, not Implemented, in this beta (it depends on an account-deletion flow
  -- this beta does not build). Exit (accepting the normal Admin Request) IS
  -- implemented and tested.
  status text not null default 'active' check (status in ('active', 'archived', 'recovery')),
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  restored_at timestamptz,
  constraint team_name_not_blank check (length(btrim(name)) > 0)
);

comment on table public.teams is
  'A Team Foundation team. Team UUID is authoritative identity — names need not be unique (requirement 18).';

-- ---------------------------------------------------------------------------------
-- Memberships and contextual functions (requirements 26-46)
-- ---------------------------------------------------------------------------------

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'ended')),
  participation_as_player boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('left', 'removed')),
  constraint end_state_consistency check (
    (status = 'active' and ended_at is null and end_reason is null) or
    (status = 'ended' and ended_at is not null and end_reason is not null)
  )
);

-- Exactly one active membership per (team, profile); multiple historical periods are
-- allowed (requirement 26/125). This partial unique index IS the transactional
-- enforcement — a concurrent second "accept"/"create" that would violate it fails
-- with a unique_violation, which every relevant RPC below catches and reports as a
-- normalized `already_exists` outcome rather than a raw database error.
create unique index team_memberships_one_active_per_profile
  on public.team_memberships (team_id, profile_id)
  where status = 'active';

create index team_memberships_team_id_idx on public.team_memberships (team_id);
create index team_memberships_profile_id_idx on public.team_memberships (profile_id);

comment on table public.team_memberships is
  'The base relationship (requirement 26). One uniform Team Seat per active row — see '
  'docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md revision note, 2026-08-20.';

create table public.team_membership_functions (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.team_memberships (id) on delete restrict,
  function text not null check (function in ('team_admin', 'coach', 'training_lead')),
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint end_state_consistency check (
    (status = 'active' and ended_at is null) or (status = 'ended' and ended_at is not null)
  )
);

create unique index team_membership_functions_one_active_per_function
  on public.team_membership_functions (membership_id, function)
  where status = 'active';

create index team_membership_functions_membership_id_idx on public.team_membership_functions (membership_id);

comment on table public.team_membership_functions is
  'Composable, time-bounded, audited contextual functions (requirement 36) — Team Admin, Coach, Training Lead only. No Captain function exists here (docs/adr/0022 Decision 2).';

-- ---------------------------------------------------------------------------------
-- Invitations (requirements 47-66)
-- ---------------------------------------------------------------------------------

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  email text not null,
  participation_as_player boolean not null default false,
  proposed_functions text[] not null default '{}',
  -- The durably STORED status. Expiry may be derived (requirement 59) — every reader
  -- (RPCs and RLS policies alike) must treat a 'pending' row past expires_at as
  -- effectively expired; see the functions migration's `private.invitation_is_pending`
  -- helper, which every mutating RPC uses instead of comparing status='pending' directly.
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked', 'replaced')),
  -- Only a cryptographic hash is stored (requirement 63) — the raw token is returned
  -- exactly once, from create_invitation/revise_invitation/resend_invitation, to the
  -- caller (the Next.js Route Handler, never the browser directly for the value that
  -- goes into the email), and never persisted anywhere.
  token_hash text not null unique,
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_membership_id uuid references public.team_memberships (id),
  revoked_at timestamptz,
  replaced_by_invitation_id uuid references public.team_invitations (id),
  email_delivery_status text not null default 'pending' check (email_delivery_status in ('pending', 'sent', 'failed')),
  constraint email_looks_like_email check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint proposed_functions_valid check (
    proposed_functions <@ array['team_admin', 'coach', 'training_lead']::text[]
  )
);

create index team_invitations_team_id_idx on public.team_invitations (team_id);

comment on table public.team_invitations is
  'Requirements 47-66. token_hash is a SHA-256 (or stronger) hash — the raw token exists only transiently in RPC return values, never at rest.';

-- ---------------------------------------------------------------------------------
-- Team Admin responsibility requests (requirements 67-75)
-- ---------------------------------------------------------------------------------

create table public.team_admin_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  membership_id uuid not null references public.team_memberships (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'replaced', 'expired')),
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  replaced_by_request_id uuid references public.team_admin_requests (id)
);

create index team_admin_requests_team_id_idx on public.team_admin_requests (team_id);
create index team_admin_requests_membership_id_idx on public.team_admin_requests (membership_id);

-- ---------------------------------------------------------------------------------
-- Notifications and audit (requirements 82, 136-138, 169)
-- ---------------------------------------------------------------------------------

create table public.account_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  kind text not null check (kind in ('admin_request', 'member_removed')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index account_notifications_profile_id_idx on public.account_notifications (profile_id);

comment on table public.account_notifications is
  'A member_removed payload must never contain performance data (requirement 82) — enforced by the emitting RPC, not by a database constraint.';

create table public.team_audit_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams (id) on delete restrict,
  actor_profile_id uuid references public.profiles (id) on delete restrict,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index team_audit_events_team_id_idx on public.team_audit_events (team_id);

comment on table public.team_audit_events is
  'Server-authored only (requirement 137) — no INSERT policy is ever granted to authenticated/anon; only SECURITY DEFINER functions, running as table owner, write here.';
