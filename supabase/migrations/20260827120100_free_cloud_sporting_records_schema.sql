-- Stage B0.4 — lossless Profile-owned terminal sporting records.
--
-- The authoritative payload is exact serialized JSON stored as TEXT, not JSONB.
-- PostgreSQL JSONB cannot represent every string the existing TypeScript domains can
-- serialize (notably U+0000 and unpaired surrogates). TEXT preserves the exact wire
-- value; the server-owned SHA-256 makes equality and idempotency explicit.

create table public.sporting_records (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  record_kind text not null check (record_kind in ('training_session', 'assessment_run')),
  record_id uuid not null,
  schema_version integer not null check (schema_version > 0),
  payload text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, record_kind, record_id),
  constraint sporting_records_payload_not_empty check (octet_length(payload) > 0),
  constraint sporting_records_payload_bounded check (octet_length(payload) <= 8388608)
);

create table public.sporting_record_tombstones (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  record_kind text not null check (record_kind in ('training_session', 'assessment_run')),
  record_id uuid not null,
  deleted_content_sha256 text not null
    check (deleted_content_sha256 ~ '^[0-9a-f]{64}$'),
  deleted_at timestamptz not null default now(),
  primary key (profile_id, record_kind, record_id)
);

create index sporting_records_restore_order
  on public.sporting_records (profile_id, recorded_at desc, record_id);

comment on table public.sporting_records is
  'B0.4 exact terminal sporting records. Payload TEXT is the lossless raw authority; '
  'browser writes are RPC-only and scoped to private.current_profile_id().';

comment on table public.sporting_record_tombstones is
  'Permanent per-Profile record deletion facts. A tombstoned stable identity cannot be reinserted.';

