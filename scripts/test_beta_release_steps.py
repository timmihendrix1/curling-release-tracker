#!/usr/bin/env python3
"""Execute the ACTUAL guarded release snippets on a disposable local database.

Each case rolls back, including pg_cron job creation. Requires a fresh --no-seed
reset. Does not deploy pages, activate a hosted worker or contact a hosted DB.
"""
from pathlib import Path
import subprocess

PSQL = ["docker", "exec", "-i", "supabase_db_curling-release-mvp", "psql",
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]


def execute(query, expected_error=None):
    result = subprocess.run(PSQL, input=query, text=True, capture_output=True, timeout=15)
    if expected_error:
        assert result.returncode != 0 and expected_error in result.stderr, result.stderr
    else:
        assert result.returncode == 0, result.stderr
    return result.stdout.strip()


assert execute("select count(*) from auth.users;") == "0", "Reset the disposable local database first"
assert execute("select count(*) from public.legal_documents;") == "0", "Reset without seed first"
root = Path(__file__).resolve().parents[1]


def body(name):
    source = (root / "supabase" / "snippets" / name).read_text()
    # Preserve the exact executable guarded transaction, replacing only its
    # outer commit with rollback-controlled test composition.
    return source.split("begin;", 1)[1].rsplit("commit;", 1)[0]


legal = body("publish_beta_legal_documents_2026_10_24.sql")
pair_check = """do $$ begin
if (select count(*) from public.legal_documents where retired_at is null
and version_label in ('privacy-2026-10-24','terms-2026-10-24')) <> 2 then
raise exception 'Incomplete published pair'; end if; end $$;"""
execute("begin; " + legal + legal + pair_check + "rollback;")
print("PASS: first legal publication and exact retry")
old = """insert into public.legal_documents(kind,version_label,document_url,effective_at) values
('privacy_notice','privacy-2026-08-28','https://curling.evolane.me/legal/privacy/2026-08-28','2026-08-28 00:00:00+02'),
('terms_of_service','terms-2026-08-29','https://curling.evolane.me/legal/terms/2026-08-29','2026-08-29 00:00:00+02');"""
execute("begin; " + old + legal + pair_check + "rollback;")
print("PASS: exact known predecessor pair rotates atomically")
for fixture in [old.replace("terms-2026-08-29", "unknown-terms"),
                old + "update public.legal_documents set retired_at=now() where kind='terms_of_service';"]:
    execute("begin; " + fixture + legal + "rollback;", "Unexpected current Legal pair")
print("PASS: unknown or partial predecessor refuses without publication")
execute("begin; " + legal + "update public.legal_documents set retired_at=now();"
        + legal + "rollback;", "replacement labels already exist")
print("PASS: retired replacement cannot be silently reactivated")

schedule = body("schedule_account_deletion_finalizer.sql")
execute("begin; " + schedule + schedule + """do $$ begin
if (select count(*) from cron.job where jobname='curling-account-deletion-finalizer') <> 1
then raise exception 'Duplicate deletion worker'; end if; end $$; rollback;""")
print("PASS: hourly worker installation and exact retry are idempotent")
execute("begin; " + schedule + "select cron.schedule('curling-account-deletion-finalizer','18 * * * *','select public.finalize_due_account_deletions(20)');"
        + schedule + "rollback;", "Unexpected account-deletion job")
print("PASS: conflicting worker refuses instead of replacing an owner's job")
assert execute("select count(*) from public.legal_documents;") == "0"
print("PASS: all release-step fixtures rolled back; no publication or worker activated")
