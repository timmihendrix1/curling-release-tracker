#!/usr/bin/env python3
"""Real concurrent Postgres connections; disposable LOCAL database only.

Run after `supabase db reset --local --no-seed` and the transactional pgTAP
suites. Refuses an occupied auth database. Leaves synthetic fixtures behind;
reset the local database afterwards. No provider credentials are required.
"""
import subprocess
import time

PSQL = ["docker", "exec", "-i", "supabase_db_curling-release-mvp", "psql",
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]
ACCOUNT = "00000000-0000-4000-8000-000000000391"


def sql(query, check=True):
    result = subprocess.run(PSQL, input=query, text=True, capture_output=True, timeout=15)
    if check and result.returncode:
        raise AssertionError(result.stderr)
    return result


def auth():
    return f"""select set_config('request.jwt.claims', jsonb_build_object(
      'sub','{ACCOUNT}','role','authenticated','amr',jsonb_build_array(
      jsonb_build_object('method','otp','timestamp',floor(extract(epoch from now())))))::text,true);
      set local role authenticated;"""


def hold(query):
    process = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True)
    process.stdin.write("begin; " + query + " select 'held';\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if line.strip() == "held":
            return process
        if not line:
            raise AssertionError(process.stderr.read())


def release(process):
    process.stdin.write("commit;\n")
    process.stdin.close()
    assert process.wait(timeout=10) == 0, process.stderr.read()


def racing(name, query):
    process = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"set application_name = '{name}'; " + query)
    process.stdin.close()
    return process


def prove_wait(name):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        waiting = sql(f"select count(*) from pg_stat_activity where application_name='{name}' "
                      "and wait_event_type='Lock' and wait_event='advisory';").stdout.strip()
        if waiting == "1":
            return
        time.sleep(0.05)
    raise AssertionError(f"No actual advisory-lock wait observed for {name}")


def finish(process, expected_error=None):
    assert process.wait(timeout=10) == (3 if expected_error else 0), process.stderr.read()
    output = process.stdout.read()
    if expected_error:
        assert expected_error in process.stderr.read()
    return output.strip().splitlines()[-1] if output.strip() else ""


assert sql("select count(*) from auth.users;").stdout.strip() == "0", "Reset the disposable local database first"
sql(f"""insert into auth.users(id,email) values('{ACCOUNT}','concurrency@example.invalid');
insert into public.legal_documents(kind,version_label,document_url,effective_at) values
('terms_of_service','concurrency-terms','https://example.invalid/terms',now()),
('privacy_notice','concurrency-privacy','https://example.invalid/privacy',now());
begin; {auth()}
select public.ensure_my_profile();
select public.complete_personal_onboarding('Synthetic concurrency athlete',
(select id from public.get_current_legal_documents() where kind='terms_of_service'),
(select id from public.get_current_legal_documents() where kind='privacy_notice'));
commit;""")
PROFILE = sql(f"select profile_id from public.account_profile_links where account_id='{ACCOUNT}';").stdout.strip()
request = f"select request_id from public.request_my_account_deletion('{PROFILE}', 0);"
upload = "select (public.put_my_sporting_record('training_session',gen_random_uuid(),1,'{}',now())).outcome;"

# A request must wait until the already-authorized upload commits.
holder = hold(auth() + upload)
worker = racing("deletion-race-request", "begin; " + auth() + request + "commit;")
prove_wait("deletion-race-request")
release(holder)
finish(worker)
assert sql(f"select count(*) from public.sporting_records where profile_id='{PROFILE}';").stdout.strip() == "1"
print("PASS: request waits for an in-flight authorized upload")

# Cancellation also uses the exclusive fence. A subsequent request holds it
# while an upload queues, then that upload must read the committed denial.
holder = hold(auth() + "select public.cancel_my_account_deletion((select request_id from public.get_my_account_deletion_state()));")
worker = racing("deletion-late-request-after-cancel", "begin; " + auth() + request + "commit;")
prove_wait("deletion-late-request-after-cancel")
release(holder)
finish(worker, "conflict:")
print("PASS: a delayed request cannot recreate deletion after concurrent cancellation")

request = f"select request_id from public.request_my_account_deletion('{PROFILE}', 1);"
holder = hold(auth() + f"select public.abort_my_uncommitted_account_deletion('{PROFILE}', 1);")
worker = racing("deletion-late-request-after-abort", "begin; " + auth() + request + "commit;")
prove_wait("deletion-late-request-after-abort")
release(holder)
finish(worker, "conflict:")
print("PASS: conditional recovery fences a concurrent late request before offline access can return")
request = f"select request_id from public.request_my_account_deletion('{PROFILE}', 2);"
holder = hold(auth() + request)
worker = racing("deletion-race-upload", "begin; " + auth() + upload + "commit;")
prove_wait("deletion-race-upload")
release(holder)
finish(worker, "forbidden:")
assert sql(f"select count(*) from public.sporting_records where profile_id='{PROFILE}';").stdout.strip() == "1"
print("PASS: queued upload rechecks pending deletion after the fence")

# A cancellation can begin before the cutoff but reach the mutation only after
# waiting. Transaction-start `now()` must not extend the recovery period.
sql("update public.account_deletion_requests d set requested_at=v.deadline-interval '30 days', "
    "finalize_after=v.deadline from (select clock_timestamp()+interval '2 seconds' deadline) v "
    "where d.cancelled_at is null;")
request_id = sql("select id from public.account_deletion_requests where cancelled_at is null;").stdout.strip()
holder = hold("select pg_advisory_xact_lock_shared(hashtext('account-deletion-lifecycle'));")
worker = racing("deletion-race-cutoff", "begin; " + auth()
                + f"select public.cancel_my_account_deletion('{request_id}'); commit;")
prove_wait("deletion-race-cutoff")
while sql("select bool_and(clock_timestamp() >= finalize_after) from public.account_deletion_requests where cancelled_at is null;").stdout.strip() != "t":
    time.sleep(0.05)
release(holder)
finish(worker, "recovery_period_ended:")
print("PASS: waiting does not extend the recovery cutoff")

# A committed due purge wins over both a concurrent cancellation and another
# finalizer. Neither may revive identity or recreate deleted raw records.
sql("update public.account_deletion_requests set requested_at=now()-interval '31 days', "
    "finalize_after=now()-interval '1 day' where cancelled_at is null;")
request_id = sql("select id from public.account_deletion_requests where cancelled_at is null;").stdout.strip()
holder = hold("select public.finalize_due_account_deletions();")
cancel = racing("deletion-race-cancel", "begin; " + auth()
                + f"select public.cancel_my_account_deletion('{request_id}'); commit;")
other = racing("deletion-race-finalizer", "select public.finalize_due_account_deletions();")
prove_wait("deletion-race-cancel")
prove_wait("deletion-race-finalizer")
release(holder)
finish(cancel, "forbidden:")
assert finish(other) == "0"
assert sql(f"select count(*) from auth.users where id='{ACCOUNT}';").stdout.strip() == "0"
assert sql(f"select count(*) from public.sporting_records where profile_id='{PROFILE}';").stdout.strip() == "0"
print("PASS: concurrent cancellation and duplicate worker cannot undo a completed purge")
