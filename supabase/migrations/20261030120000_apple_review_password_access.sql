-- Creates the policy only. Hosted/local hook activation is a separate operation.
-- Canonical contract and operational preconditions: docs/APPLE_REVIEW_ACCESS.md.
-- No real account, credential, seed, client provider or Auth setting is changed.

create table private.apple_review_password_account (
  singleton boolean primary key default true check (singleton),
  account_id uuid not null unique references auth.users(id) on delete cascade
);
alter table private.apple_review_password_account enable row level security;
revoke all on private.apple_review_password_account from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant select on private.apple_review_password_account to supabase_auth_admin;
create policy apple_review_password_account_auth_read
  on private.apple_review_password_account for select to supabase_auth_admin using (true);

-- SECURITY INVOKER deliberately keeps the hook dependent on its narrow Auth-role
-- grants. Caller-supplied metadata/email is never an authority. Only Auth may call
-- this function; normal users cannot submit fabricated authentication evidence.
create function public.apple_review_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  method text;
  subject text;
  evidence jsonb;
  entry jsonb;
  entry_method text;
  has_current_method boolean := false;
  password_derived boolean := false;
  allowed boolean;
  denied constant jsonb := '{"error":{"http_code":403,"message":"This sign-in method is unavailable."}}'::jsonb;
begin
  if jsonb_typeof(event) is distinct from 'object'
    or jsonb_typeof(event->'user_id') is distinct from 'string'
    or jsonb_typeof(event->'authentication_method') is distinct from 'string'
    or jsonb_typeof(event->'claims') is distinct from 'object' then
    return denied;
  end if;
  subject := event->>'user_id';
  method := event->>'authentication_method';
  if subject !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(event->'claims'->'sub') is distinct from 'string'
    or event->'claims'->>'sub' is distinct from subject
    or method not in ('password', 'otp', 'oauth', 'token_refresh', 'email/signup',
      'recovery', 'invite', 'magiclink', 'email_change', 'totp', 'sso/saml') then
    return denied;
  end if;

  evidence := event->'claims'->'amr';
  if jsonb_typeof(evidence) is distinct from 'array' then return denied; end if;
  if jsonb_array_length(evidence) = 0 then return denied; end if;
  for entry in select value from jsonb_array_elements(evidence) loop
    if jsonb_typeof(entry) is distinct from 'object'
      or jsonb_typeof(entry->'method') is distinct from 'string'
      or jsonb_typeof(entry->'timestamp') is distinct from 'number' then
      return denied;
    end if;
    entry_method := entry->>'method';
    if entry_method not in ('password', 'otp', 'oauth', 'email/signup', 'recovery',
      'invite', 'magiclink', 'email_change', 'totp', 'sso/saml')
      or (entry->>'timestamp')::numeric < 0
      or (entry->>'timestamp')::numeric > 999999999999
      or trunc((entry->>'timestamp')::numeric) <> (entry->>'timestamp')::numeric then
      return denied;
    end if;
    has_current_method := has_current_method or entry_method = method;
    password_derived := password_derived or entry_method in ('password', 'email/signup');
  end loop;
  if method <> 'token_refresh' and not has_current_method then return denied; end if;

  -- Automatically confirmed signup is not mailbox proof. Confirmed OTP/recovery
  -- verification is supplied by GoTrue as its genuine proof method instead.
  -- Refresh inherits server-issued AMR, not the caller's user_metadata.
  if method in ('password', 'email/signup') or password_derived then
    select exists (
      select 1 from private.apple_review_password_account
      where singleton and account_id = subject::uuid
    ) into allowed;
    if not allowed then return denied; end if;
  end if;

  -- Do not add privileges or change identity, role, AMR, legal or Profile claims.
  return jsonb_build_object('claims', event->'claims');
end;
$$;
revoke all on function public.apple_review_access_token_hook(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apple_review_access_token_hook(jsonb) to supabase_auth_admin;
