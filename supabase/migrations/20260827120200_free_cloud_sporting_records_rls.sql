-- Stage B0.4 — own-Profile reads, RPC-only writes.

alter table public.sporting_records enable row level security;
alter table public.sporting_record_tombstones enable row level security;

revoke all on table public.sporting_records, public.sporting_record_tombstones
from public, anon, authenticated;

grant select on table public.sporting_records, public.sporting_record_tombstones
to authenticated;

create policy sporting_records_select_own on public.sporting_records
  for select to authenticated
  using (profile_id = private.current_profile_id());

create policy sporting_record_tombstones_select_own on public.sporting_record_tombstones
  for select to authenticated
  using (profile_id = private.current_profile_id());

