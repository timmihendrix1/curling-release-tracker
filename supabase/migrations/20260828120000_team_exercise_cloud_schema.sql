-- Exercise Stage C2a — Team recording consent and immutable completed-Session cloud records.
--
-- The recorder device uploads one exact shared coordination envelope and one exact,
-- athlete-owned bundle per training athlete. Human-authored payloads remain TEXT for
-- the same lossless reason as Stage B0.4 sporting_records; UUID-only manifests are
-- relational so authority and idempotency never depend on parsing an opaque payload.

create table public.team_exercise_recording_permissions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  athlete_profile_id uuid not null references public.athletes(profile_id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint team_exercise_recording_permission_chronology
    check (revoked_at is null or revoked_at >= granted_at)
);

create unique index team_exercise_recording_permissions_one_active
  on public.team_exercise_recording_permissions(team_id, athlete_profile_id)
  where revoked_at is null;

create index team_exercise_recording_permissions_athlete
  on public.team_exercise_recording_permissions(athlete_profile_id, team_id);

create table public.team_exercise_sessions (
  id uuid primary key,
  team_id uuid not null references public.teams(id) on delete restrict,
  recorded_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  schema_version integer not null check (schema_version > 0),
  coordination_payload text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint team_exercise_session_chronology check (completed_at >= started_at),
  constraint team_exercise_session_payload_not_empty check (octet_length(coordination_payload) > 0),
  constraint team_exercise_session_payload_bounded check (octet_length(coordination_payload) <= 8388608)
);

create index team_exercise_sessions_team_completed
  on public.team_exercise_sessions(team_id, completed_at desc, id);

create table public.team_exercise_session_participants (
  session_id uuid not null references public.team_exercise_sessions(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  participation text not null check (participation in ('training-athlete', 'supporting')),
  primary key (session_id, profile_id)
);

create index team_exercise_session_participants_profile
  on public.team_exercise_session_participants(profile_id, session_id);

create table public.team_exercise_execution_refs (
  session_id uuid not null references public.team_exercise_sessions(id) on delete cascade,
  execution_id uuid not null unique,
  primary key (session_id, execution_id)
);

create table public.team_exercise_result_bundles (
  id uuid primary key,
  session_id uuid not null references public.team_exercise_sessions(id) on delete restrict,
  athlete_profile_id uuid not null references public.athletes(profile_id) on delete restrict,
  recorded_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  schema_version integer not null check (schema_version > 0),
  result_payload text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint team_exercise_result_bundle_payload_not_empty check (octet_length(result_payload) > 0),
  constraint team_exercise_result_bundle_payload_bounded check (octet_length(result_payload) <= 8388608),
  constraint team_exercise_result_bundle_one_athlete_per_session unique (session_id, athlete_profile_id),
  constraint team_exercise_result_bundle_identity_owner unique (id, athlete_profile_id),
  constraint team_exercise_result_bundle_participant_fk
    foreign key (session_id, athlete_profile_id)
    references public.team_exercise_session_participants(session_id, profile_id)
    on delete restrict
);

create index team_exercise_result_bundles_athlete
  on public.team_exercise_result_bundles(athlete_profile_id, recorded_at desc, id);

create table public.team_exercise_result_refs (
  bundle_id uuid not null,
  result_id uuid not null unique,
  athlete_profile_id uuid not null references public.athletes(profile_id) on delete restrict,
  execution_id uuid not null references public.team_exercise_execution_refs(execution_id) on delete restrict,
  primary key (bundle_id, result_id),
  constraint team_exercise_result_ref_identity_owner unique (result_id, athlete_profile_id),
  constraint team_exercise_result_ref_bundle_owner_fk
    foreign key (bundle_id, athlete_profile_id)
    references public.team_exercise_result_bundles(id, athlete_profile_id)
    on delete cascade
);

create table public.team_exercise_session_approvals (
  session_id uuid not null references public.team_exercise_sessions(id) on delete cascade,
  athlete_profile_id uuid not null references public.athletes(profile_id) on delete restrict,
  approved_at timestamptz not null default now(),
  primary key (session_id, athlete_profile_id),
  constraint team_exercise_session_approval_participant_fk
    foreign key (session_id, athlete_profile_id)
    references public.team_exercise_session_participants(session_id, profile_id)
    on delete restrict
);

create table public.team_exercise_private_notes (
  result_id uuid primary key,
  athlete_profile_id uuid not null references public.athletes(profile_id) on delete restrict,
  note text not null,
  updated_at timestamptz not null default now(),
  constraint team_exercise_private_note_not_blank check (length(btrim(note)) > 0),
  constraint team_exercise_private_note_bounded check (octet_length(note) <= 65536),
  constraint team_exercise_private_note_result_owner_fk
    foreign key (result_id, athlete_profile_id)
    references public.team_exercise_result_refs(result_id, athlete_profile_id)
    on delete cascade
);

comment on table public.team_exercise_recording_permissions is
  'Prospective athlete-to-Team permission to record that athlete in shared Sessions. Separate from membership, sharing and entitlement.';

comment on table public.team_exercise_sessions is
  'Immutable shared coordination envelope. It contains no athlete-private note; recorder identity is server-derived.';

comment on table public.team_exercise_result_bundles is
  'Immutable athlete-owned Team Session result bundle. The recorder may insert through the authority-checked RPC but never becomes its owner.';

comment on table public.team_exercise_private_notes is
  'Athlete-only note storage, deliberately outside recorder-authored shared envelopes and result bundles.';
