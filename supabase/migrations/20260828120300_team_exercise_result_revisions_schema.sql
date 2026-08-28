-- Exercise Stage C4a — append-only post-completion result revisions and ordinary voiding.

create table public.team_exercise_result_revisions (
  id uuid primary key,
  result_id uuid not null,
  athlete_profile_id uuid not null references public.athletes(profile_id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  kind text not null check (kind in ('corrected', 'voided')),
  schema_version integer not null check (schema_version > 0),
  result_payload text,
  content_sha256 text,
  changed_fields text[] not null,
  reason text not null,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint team_exercise_result_revision_owner_fk
    foreign key (result_id, athlete_profile_id)
    references public.team_exercise_result_refs(result_id, athlete_profile_id)
    on delete restrict,
  constraint team_exercise_result_revision_sequence unique (result_id, revision_number),
  constraint team_exercise_result_revision_reason
    check (char_length(btrim(reason)) between 10 and 500 and octet_length(reason) <= 2000),
  constraint team_exercise_result_revision_changed_fields
    check (
      cardinality(changed_fields) > 0
      and array_position(changed_fields, null) is null
      and changed_fields <@ array[
        'actualHandle', 'evaluation', 'measurements', 'teamRoleContextOverride', 'result'
      ]::text[]
    ),
  constraint team_exercise_result_revision_shape check (
    (kind = 'corrected'
      and result_payload is not null
      and octet_length(result_payload) between 1 and 8388608
      and content_sha256 ~ '^[0-9a-f]{64}$'
      and not ('result' = any(changed_fields)))
    or
    (kind = 'voided'
      and result_payload is null
      and content_sha256 is null
      and changed_fields = array['result']::text[])
  )
);

create index team_exercise_result_revisions_owner
  on public.team_exercise_result_revisions(athlete_profile_id, result_id, revision_number desc);

-- Existing notification rows keep NULL here. A result-change event can create at most
-- one actionable notification for a recipient, even after a lost RPC acknowledgement.
alter table public.account_notifications
  add column source_event_id uuid;

alter table public.account_notifications
  add constraint account_notifications_profile_source_event_unique
  unique (profile_id, source_event_id);

alter table public.account_notifications
  drop constraint account_notifications_kind_check;

alter table public.account_notifications
  add constraint account_notifications_kind_check
  check (kind in ('admin_request', 'member_removed', 'team_exercise_result_changed'));

comment on table public.team_exercise_result_revisions is
  'Athlete-authored append-only corrections or whole-result voids after Team Session completion. Original bundles remain immutable.';

comment on column public.account_notifications.source_event_id is
  'Stable idempotency source for event-backed notifications. NULL for legacy notification kinds.';

