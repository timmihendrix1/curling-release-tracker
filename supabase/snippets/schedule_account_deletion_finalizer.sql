-- OWNER-OPERATED RELEASE STEP after the complete deletion feature has passed
-- review and is deployed. Never run this against an unreviewed live migration.
-- Executes hourly after the 30-day boundary; no user credential or API key is
-- embedded. Existing conflicting jobs cause a refusal rather than replacement.
begin;
create extension if not exists pg_cron;
do $$
declare v_job record;
begin
  select * into v_job from cron.job where jobname = 'curling-account-deletion-finalizer';
  if found then
    if v_job.schedule <> '17 * * * *'
      or v_job.command <> 'select public.finalize_due_account_deletions(20)'
      or not v_job.active or v_job.username <> current_user then
      raise exception 'Unexpected account-deletion job; inspect before changing it.';
    end if;
    return;
  end if;
  perform cron.schedule('curling-account-deletion-finalizer', '17 * * * *',
    'select public.finalize_due_account_deletions(20)');
end;
$$;
commit;
