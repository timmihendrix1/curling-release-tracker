#!/usr/bin/env python3
"""Real isolated GoTrue/Postgres tests of the Apple review access migration.

Uses ONLY already-cached Docker images, its own random network/containers and
loopback ephemeral ports. Never reads .env files or touches the CLI's existing
Supabase project. Temporary credentials and mail are neither printed nor reported.
No dependency installation, production calls, hosted activation or Google fake.
Run: python3 scripts/test_apple_review_access.py [--result /tmp/result.json]
"""

import argparse
import base64
import json
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


REPO = Path(__file__).resolve().parents[1]
MIGRATION = REPO / "supabase/migrations/20261030120000_apple_review_password_access.sql"
POSTGRES = "public.ecr.aws/supabase/postgres:17.6.1.155"
AUTH = "public.ecr.aws/supabase/gotrue:v2.195.0"
MAIL = "public.ecr.aws/supabase/mailpit:v1.30.2"


class NoLocalRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        # Even a local upstream must not forward a bearer/body to another origin.
        return None


def open_local_http(request, *, origins, timeout=15):
    """Explicit per-call transport: no ambient proxies and no redirect following.

    Only the exact generated loopback origins are accepted. No global urllib
    opener is replaced; other callers/tests retain their own transport policy.
    """
    url = request.full_url if isinstance(request, urllib.request.Request) else request
    parsed = urllib.parse.urlsplit(url)
    try:
        port = parsed.port
    except ValueError:
        raise RuntimeError("Invalid disposable HTTP endpoint") from None
    origin = "http://127.0.0.1:" + str(port)
    if (parsed.scheme != "http" or not port or parsed.netloc != "127.0.0.1:" + str(port)
            or parsed.fragment or origin not in origins):
        raise RuntimeError("Unowned disposable HTTP endpoint refused")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoLocalRedirects())
    return opener.open(request, timeout=timeout)


class LocalPolicyTest:
    def __init__(self):
        self.tag = "curling-review-test-" + uuid.uuid4().hex[:12]
        self.containers = []
        self.network_created = False
        self.results = []
        self.temp = tempfile.TemporaryDirectory(prefix="curling-review-test-")
        self.root = Path(self.temp.name)
        self.password = secrets.token_urlsafe(32)
        self.auth = None

    def docker(self, *args, data=None, require=True):
        p = subprocess.run(["docker", *args], input=data, text=True, capture_output=True)
        if require and p.returncode:
            # Docker stderr may contain environment values or SQL. Never report it.
            raise RuntimeError("Local Docker operation failed: " + args[0])
        return p

    def run(self, suffix, image, *, env=None, ports=(), args=(), entrypoint=None, mounts=()):
        name = self.tag + "-" + suffix
        command = ["run", "--pull=never", "-d", "--name", name,
                   "--label", "curling.review-test=" + self.tag, "--network", self.tag]
        if env:
            path = self.root / (suffix + ".env")
            path.write_text("\n".join(k + "=" + v for k, v in env.items()))
            path.chmod(0o600)
            command += ["--env-file", str(path)]
        for port in ports:
            command += ["-p", "127.0.0.1::" + str(port)]
        for source, target in mounts:
            command += ["-v", str(source) + ":" + target + ":ro"]
        if entrypoint:
            command += ["--entrypoint", entrypoint]
        # Only this unpredictable, owned name is ever eligible for cleanup.
        self.containers.append(name)
        self.docker(*command, image, *args)
        return name

    def port(self, name, port):
        value = self.docker("port", name, str(port)).stdout.strip()
        if not re.fullmatch(r"127\.0\.0\.1:\d+", value):
            raise RuntimeError("Expected a loopback-only disposable port")
        return value.rsplit(":", 1)[1]

    def sql_process(self, query):
        return self.docker("exec", "-i", self.db, "psql", "-U", "supabase_admin",
                           "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1",
                           "-v", "VERBOSITY=verbose", data=query, require=False)

    def sql(self, query):
        p = self.sql_process(query)
        if p.returncode:
            raise RuntimeError("Isolated database query failed")
        return p.stdout.strip()

    def rejected_sql(self, label, query, state):
        p = self.sql_process(query)
        self.check(label, p.returncode != 0 and bool(re.search(r"ERROR:\s+" + state + r":", p.stderr)))

    def api(self, path, data=None, token=None, method=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(self.base + path, headers=headers, method=method,
                                         data=json.dumps(data).encode() if data is not None else None)
        try:
            with self.open_local(request, timeout=15) as response:
                return response.status, json.loads(response.read() or "{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or "{}")

    def open_local(self, request, timeout=15):
        return open_local_http(request, origins=(getattr(self, "base", None),
                                                getattr(self, "mail_base", None)), timeout=timeout)

    def check(self, label, ok):
        self.results.append({"test": label, "pass": bool(ok)})
        print(("PASS: " if ok else "FAIL: ") + label, flush=True)
        if not ok:
            raise RuntimeError("Check failed: " + label)

    def wait_auth(self):
        for _ in range(60):
            try:
                if self.api("/health")[0] == 200:
                    return
            except (OSError, ValueError):
                pass
            time.sleep(0.25)
        raise RuntimeError("Isolated Auth service did not become healthy")

    def start_auth(self, suffix, *, hook=True, autoconfirm=False):
        if self.auth:
            self.docker("rm", "-fv", self.auth)
        env = dict(self.auth_env)
        env["GOTRUE_MAILER_AUTOCONFIRM"] = str(autoconfirm).lower()
        env["GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED"] = str(hook).lower()
        self.auth = self.run("auth-" + suffix, AUTH, env=env, ports=(9999,))
        self.base = "http://127.0.0.1:" + self.port(self.auth, 9999)
        self.wait_auth()

    def setup(self):
        self.docker("network", "create", self.tag)
        self.network_created = True
        self.db = self.run("db", POSTGRES, env={"POSTGRES_PASSWORD": self.password},
                           args=("postgres", "-c", "log_min_messages=panic", "-c", "listen_addresses=*"))
        for _ in range(180):
            p = self.sql_process("select 1;")
            if p.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("Isolated database did not become ready")
        self.sql("alter role supabase_auth_admin password '" + self.password + "';")
        self.mail = self.run("mail", MAIL, ports=(8025,))
        self.mail_base = "http://127.0.0.1:" + self.port(self.mail, 8025)
        # Serve an actual six-digit OTP template INSIDE the disposable network.
        template = self.root / "templates"
        template.mkdir()
        (template / "code.html").write_text("<p>Local disposable verification code: <b>{{ .Token }}</b></p>")
        handler = template / "serve.sh"
        handler.write_text("#!/bin/sh\nwhile IFS= read -r line; do [ \"$line\" = \"$(printf '\\r')\" ] && break; done\nprintf 'HTTP/1.1 200 OK\\r\\nConnection: close\\r\\nContent-Type: text/html\\r\\n\\r\\n'\ncat /tmp/template-code.html\n")
        handler.chmod(0o755)
        server = self.run("templates", MAIL, entrypoint="/bin/busybox",
                          args=("nc", "-lk", "-p", "8080", "-e", "/tmp/template-response.sh"))
        # `docker cp` works with remote/Colima daemons too; host /tmp bind mounts
        # can silently point at the VM's different /tmp directory.
        self.docker("cp", str(template / "code.html"), server + ":/tmp/template-code.html")
        self.docker("cp", str(handler), server + ":/tmp/template-response.sh")
        url = "http://" + server + ":8080/code.html"
        template_read = self.docker("exec", self.mail, "/bin/busybox", "wget", "-qO-", url, require=False)
        self.check("Disposable email template server returns the actual code template",
                   template_read.returncode == 0 and "{{ .Token }}" in template_read.stdout)
        self.auth_env = {
            "GOTRUE_API_HOST": "0.0.0.0", "GOTRUE_API_PORT": "9999",
            "API_EXTERNAL_URL": "http://localhost:9999", "GOTRUE_SITE_URL": "http://localhost:3000",
            "GOTRUE_DB_DRIVER": "postgres",
            "DATABASE_URL": "postgres://supabase_auth_admin:" + self.password + "@" + self.db + ":5432/postgres?sslmode=disable",
            "GOTRUE_JWT_SECRET": secrets.token_urlsafe(48), "GOTRUE_JWT_EXP": "3600",
            "GOTRUE_JWT_AUD": "authenticated", "GOTRUE_JWT_DEFAULT_GROUP_NAME": "authenticated",
            "GOTRUE_EXTERNAL_EMAIL_ENABLED": "true", "GOTRUE_MAILER_OTP_LENGTH": "6",
            "GOTRUE_SMTP_HOST": self.mail, "GOTRUE_SMTP_PORT": "1025",
            "GOTRUE_SMTP_ADMIN_EMAIL": "test@example.invalid", "GOTRUE_SMTP_SENDER_NAME": "Local test",
            "GOTRUE_SMTP_MAX_FREQUENCY": "0s", "GOTRUE_RATE_LIMIT_EMAIL_SENT": "1000",
            "GOTRUE_MAILER_TEMPLATES_MAGIC_LINK": url, "GOTRUE_MAILER_TEMPLATES_CONFIRMATION": url,
            "GOTRUE_MAILER_TEMPLATES_RECOVERY": url, "GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE": url,
            "GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI": "pg-functions://postgres/public/apple_review_access_token_hook",
        }
        self.start_auth("bootstrap", hook=False)
        migrations = sorted((REPO / "supabase/migrations").glob("*.sql"))
        for migration in migrations:
            self.sql(migration.read_text())
        self.check("Entire actual product migration chain applies after real Auth schema", MIGRATION in migrations)
        self.start_auth("confirmed")

    def message_ids(self, email):
        with self.open_local(self.mail_base + "/api/v1/messages", timeout=10) as response:
            messages = json.load(response).get("messages", [])
        return [m["ID"] for m in messages if any(x["Address"] == email for x in m["To"])]

    def request_and_verify(self, email, *, path="/otp", verify_type="email", label=None, data=None):
        before = set(self.message_ids(email))
        status, initial = self.api(path, data if data is not None else {"email": email, "create_user": True})
        self.check((label or email.split("@")[0]) + " verification mail request accepted", status == 200)
        self.check((label or email.split("@")[0]) + " mail request supplies no access or refresh token",
                   "access_token" not in initial and "refresh_token" not in initial)
        for _ in range(60):
            fresh = [mid for mid in self.message_ids(email) if mid not in before]
            if fresh:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("Fresh disposable verification mail not delivered")
        with self.open_local(self.mail_base + "/api/v1/message/" + fresh[0], timeout=10) as response:
            message = json.load(response)
        codes = re.findall(r"\b\d{6}\b", message.get("Text", "") + " " + message.get("HTML", ""))
        if not codes:
            lengths = [len(n) for n in re.findall(r"\b\d+\b", message.get("Text", ""))]
            marker = "Local disposable verification code" in (message.get("Text", "") + message.get("HTML", ""))
            raise RuntimeError("Six-digit code missing; template marker=" + str(marker) + "; digit lengths=" + str(lengths))
        status, result = self.api("/verify", {"email": email, "token": codes[0], "type": verify_type})
        self.check((label or email.split("@")[0]) + " genuine six-digit verification returns session",
                   status == 200 and self.session(result))
        return result

    @staticmethod
    def session(result):
        return isinstance(result.get("access_token"), str) and isinstance(result.get("refresh_token"), str)

    @staticmethod
    def claims(session):
        part = session["access_token"].split(".")[1]
        return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))

    def password_login(self, email, password):
        return self.api("/token?grant_type=password", {"email": email, "password": password})

    def refresh(self, session):
        return self.api("/token?grant_type=refresh_token", {"refresh_token": session["refresh_token"]})

    def counts(self, account):
        return self.sql("select (select count(*) from auth.sessions where user_id='" + account +
                        "'), (select count(*) from auth.refresh_tokens where user_id='" + account + "');")

    def denied_login(self, label, email, password, account):
        before = self.counts(account)
        status, result = self.password_login(email, password)
        self.check(label, status == 403 and not self.session(result) and "access_token" not in result
                   and "refresh_token" not in result)
        self.check(label + ": no new session or refresh-token rows", self.counts(account) == before)

    def hook(self, event):
        serialized = json.dumps(event).replace("'", "''")
        result = self.sql("set role supabase_auth_admin; select public.apple_review_access_token_hook('" +
                          serialized + "'::jsonb);")
        return json.loads(result.splitlines()[-1])

    def event(self, account, method="token_refresh", amr=None):
        return {"user_id": account, "authentication_method": method,
                "claims": {"sub": account, "role": "authenticated", "amr": amr if amr is not None else
                           [{"method": "otp", "timestamp": int(time.time())}]}}

    def run_checks(self):
        review = self.request_and_verify("review@example.invalid", label="Review first OTP")
        other = self.request_and_verify("ordinary@example.invalid", label="Ordinary first OTP")
        rid, oid = review["user"]["id"], other["user"]["id"]
        self.rid, self.oid = rid, oid
        passwd = secrets.token_urlsafe(24)
        self.check("Allowlist initially empty", self.sql("select count(*) from private.apple_review_password_account;") == "0")
        self.sql("insert into private.apple_review_password_account(account_id) values ('" + rid + "');")
        self.rejected_sql("Second review account rejected by singleton primary key",
                          "insert into private.apple_review_password_account(account_id) values ('" + oid + "');", "23505")
        self.rejected_sql("False singleton cannot bypass cardinality", "insert into private.apple_review_password_account values (false,'" + oid + "');", "23514")
        self.rejected_sql("Null singleton cannot bypass cardinality", "insert into private.apple_review_password_account values (null,'" + oid + "');", "23502")
        self.rejected_sql("Missing Auth UUID rejected by foreign key", "update private.apple_review_password_account set account_id='" + str(uuid.uuid4()) + "';", "23503")
        self.rejected_sql("Null Auth UUID rejected", "update private.apple_review_password_account set account_id=null;", "23502")
        for role in ["anon", "authenticated", "service_role"]:
            self.rejected_sql(role + " cannot read allowlist", "set role " + role + "; select * from private.apple_review_password_account;", "42501")
            self.rejected_sql(role + " cannot write allowlist", "set role " + role + "; delete from private.apple_review_password_account;", "42501")
            self.rejected_sql(role + " cannot invoke hook directly", "set role " + role + "; select public.apple_review_access_token_hook('{}');", "42501")
        self.rejected_sql("Auth role cannot change allowlist", "set role supabase_auth_admin; delete from private.apple_review_password_account;", "42501")
        self.check("Auth SELECT works under real RLS", self.sql("set role supabase_auth_admin; select count(*) from private.apple_review_password_account;").splitlines()[-1] == "1")
        for label, session in [("Review", review), ("Ordinary", other)]:
            status, _ = self.api("/user", {"password": passwd}, session["access_token"], "PUT")
            self.check(label + " authenticated password storage remains allowed", status == 200)
        status, pw_session = self.password_login("review@example.invalid", passwd)
        self.check("Review UUID password sign-in allowed", status == 200 and self.session(pw_session))
        self.check("Review password session retains ordinary authenticated role",
                   self.claims(pw_session).get("role") == "authenticated" and
                   self.claims(pw_session).get("sub") == rid)
        status, pw_session = self.refresh(pw_session)
        self.check("Review password session refresh allowed", status == 200 and self.session(pw_session))
        self.denied_login("Ordinary direct password grant denied after password update", "ordinary@example.invalid", passwd, oid)
        status, other = self.refresh(other)
        self.check("Denied password login does not revoke separate ordinary OTP session", status == 200 and self.session(other))
        before = self.counts(rid)
        status, response = self.password_login("review@example.invalid", secrets.token_urlsafe(24))
        self.check("Incorrect review password denied without new session rows", status == 400 and not self.session(response) and self.counts(rid) == before)
        status, _ = self.api("/user", {"data": {"apple_review": True, "account_id": rid,
                                               "email": "review@example.invalid"}}, other["access_token"], "PUT")
        self.check("Ordinary user can store metadata without acquiring review authority", status == 200)
        self.denied_login("Forged review metadata does not authorize password sign-in", "ordinary@example.invalid", passwd, oid)
        self.sql("delete from private.apple_review_password_account;")
        self.denied_login("Empty allowlist closes review password login", "review@example.invalid", passwd, rid)
        status, result = self.refresh(pw_session)
        self.check("Allowlist revocation closes existing review password refresh", status == 403 and not self.session(result))
        status, other = self.refresh(other)
        self.check("Empty allowlist preserves ordinary OTP refresh", status == 200 and self.session(other))
        self.request_and_verify("empty-list@example.invalid", label="New OTP with empty allowlist")
        self.sql("insert into private.apple_review_password_account(account_id) values ('" + rid + "');")
        recovered = self.request_and_verify("ordinary@example.invalid", path="/recover", verify_type="recovery", label="Ordinary recovery email proof")
        new_passwd = secrets.token_urlsafe(24)
        status, _ = self.api("/user", {"password": new_passwd}, recovered["access_token"], "PUT")
        self.check("Recovery-proved password storage remains allowed", status == 200)
        self.denied_login("Recovered ordinary password cannot sign in", "ordinary@example.invalid", new_passwd, oid)
        status, recovered = self.refresh(recovered)
        self.check("Recovery email-proof session can refresh", status == 200 and self.session(recovered))
        signed_up = self.request_and_verify("signup@example.invalid", path="/signup", verify_type="signup",
                                           data={"email": "signup@example.invalid", "password": passwd}, label="Password signup with required email proof")
        sid = signed_up["user"]["id"]
        self.denied_login("Confirmed signup still cannot password-sign-in", "signup@example.invalid", passwd, sid)
        status, signed_up = self.refresh(signed_up)
        self.check("Signup email-proof session refresh preserved", status == 200 and self.session(signed_up))
        self.check_event_validation(rid, oid)
        self.check_faults(rid, passwd)
        self.check_email_authority(rid, oid, passwd, new_passwd)
        self.check_autoconfirm(passwd)
        self.check("Migration does not activate or modify ordinary local Auth configuration",
                   "[auth.hook.custom_access_token]" not in (REPO / "supabase/config.toml").read_text())
        self.results.append({"test": "Real external Google OAuth round trip", "pass": None,
                             "reason": "No real provider credentials; SQL branch evidence is not external OAuth evidence."})
        print("NOT EXECUTED: Real external Google OAuth round trip", flush=True)

    def check_event_validation(self, rid, oid):
        valid = self.event(oid)
        self.check("Hook returns original claims without privilege additions", self.hook(valid) == {"claims": valid["claims"]})
        for method in ["otp", "oauth", "recovery", "invite", "magiclink", "email_change", "totp", "sso/saml"]:
            event = self.event(oid, method, [{"method": method, "timestamp": int(time.time())}])
            self.check("SQL trusted event shape preserved for " + method + " (not provider E2E)", self.hook(event) == {"claims": event["claims"]})
        malformed = [None, [], {}, {**valid, "user_id": None}, {**valid, "user_id": "bad"},
                     {**valid, "authentication_method": None}, {**valid, "authentication_method": "new_future_method"},
                     {**valid, "claims": None}, {**valid, "claims": []},
                     {**valid, "claims": {**valid["claims"], "sub": rid}}]
        for amr in [None, "password", {}, [], [None], [{}], [{"method": "password"}],
                    [{"method": "otp", "timestamp": "123"}], [{"method": "otp", "timestamp": None}],
                    [{"method": "otp", "timestamp": -1}], [{"method": "otp", "timestamp": 1.5}],
                    [{"method": "otp", "timestamp": 1000000000000}],
                    [{"method": "unknown", "timestamp": 123}],
                    [{"method": "otp", "timestamp": 123}, {"method": "unknown", "timestamp": 123}]]:
            malformed.append({**valid, "claims": {**valid["claims"], "amr": amr}})
        missing_amr = self.event(oid)
        del missing_amr["claims"]["amr"]
        malformed.append(missing_amr)
        malformed.append(self.event(rid, "password", [{"method": "otp", "timestamp": 123}]))
        for number, event in enumerate(malformed, 1):
            self.check("Malformed or unknown trusted event denied " + str(number), "error" in self.hook(event))
        for method in ["password", "email/signup"]:
            event = self.event(oid, "token_refresh", [{"method": method, "timestamp": 123}])
            self.check("Refresh cannot launder " + method + " AMR", "error" in self.hook(event))
        mixed = self.event(oid, "otp", [{"method": "otp", "timestamp": 123}, {"method": "password", "timestamp": 120}])
        self.check("Mixed AMR containing password remains restricted", "error" in self.hook(mixed))

    def check_faults(self, rid, passwd):
        self.sql("revoke select on private.apple_review_password_account from supabase_auth_admin;")
        before = self.counts(rid)
        status, result = self.password_login("review@example.invalid", passwd)
        self.check("Missing allowlist SELECT grant prevents password token issuance", status >= 400 and not self.session(result))
        self.check("Missing allowlist SELECT grant creates no session or refresh rows", self.counts(rid) == before)
        self.request_and_verify("no-grant@example.invalid", label="OTP despite unavailable password-policy SELECT")
        self.sql("grant select on private.apple_review_password_account to supabase_auth_admin;")
        self.sql("drop policy apple_review_password_account_auth_read on private.apple_review_password_account;")
        self.denied_login("Missing RLS read policy fails closed", "review@example.invalid", passwd, rid)
        self.sql("create policy apple_review_password_account_auth_read on private.apple_review_password_account for select to supabase_auth_admin using (true);")
        self.sql("alter table private.apple_review_password_account rename to unavailable_review_password_account;")
        before = self.counts(rid)
        status, result = self.password_login("review@example.invalid", passwd)
        self.check("Unavailable allowlist table prevents password tokens", status >= 400 and not self.session(result))
        self.check("Unavailable allowlist creates no session or refresh rows", self.counts(rid) == before)
        self.request_and_verify("no-table@example.invalid", label="OTP despite unavailable password-policy table")
        self.sql("alter table private.unavailable_review_password_account rename to apple_review_password_account;")
        self.sql("revoke execute on function public.apple_review_access_token_hook(jsonb) from supabase_auth_admin;")
        before = self.counts(rid)
        status, result = self.password_login("review@example.invalid", passwd)
        self.check("Missing hook permission prevents token issuance", status >= 400 and not self.session(result))
        self.check("Missing hook permission creates no session or refresh rows", self.counts(rid) == before)
        self.sql("grant execute on function public.apple_review_access_token_hook(jsonb) to supabase_auth_admin;")
        # Test a genuine runtime hook fault, then restore the EXACT migration body.
        self.sql("create or replace function public.apple_review_access_token_hook(event jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$ begin raise exception 'synthetic local fault'; end $$;")
        before = self.counts(rid)
        status, result = self.password_login("review@example.invalid", passwd)
        self.check("Hook runtime exception prevents password token issuance", status >= 400 and not self.session(result))
        self.check("Hook runtime exception creates no password session or refresh rows", self.counts(rid) == before)
        before = set(self.message_ids("fault@example.invalid"))
        status, _ = self.api("/otp", {"email": "fault@example.invalid", "create_user": True})
        self.check("OTP mail request itself does not bypass a faulty token hook", status == 200)
        for _ in range(60):
            fresh = [m for m in self.message_ids("fault@example.invalid") if m not in before]
            if fresh:
                break
            time.sleep(0.1)
        with self.open_local(self.mail_base + "/api/v1/message/" + fresh[0]) as response:
            message = json.load(response)
        code = re.search(r"\b\d{6}\b", message.get("Text", "") + " " + message.get("HTML", "")).group()
        status, result = self.api("/verify", {"email": "fault@example.invalid", "token": code, "type": "email"})
        self.check("Hook runtime exception also prevents OTP token issuance", status >= 400 and not self.session(result))
        self.sql("drop function public.apple_review_access_token_hook(jsonb);")
        migration = MIGRATION.read_text()
        self.sql(migration[migration.index("create function public.apple_review_access_token_hook"):])
        self.request_and_verify("restored@example.invalid", label="OTP after exact product hook restoration")

    def check_email_authority(self, rid, oid, review_password, ordinary_password):
        # Real email-change flow: new inbox proof, not editing auth.users directly.
        review_session = self.request_and_verify("review@example.invalid", label="Review OTP before email change")
        new_email = "renamed-review@example.invalid"
        mail_before = {email: set(self.message_ids(email)) for email in [new_email, "review@example.invalid"]}
        status, _ = self.api("/user", {"email": new_email}, review_session["access_token"], "PUT")
        self.check("Review email change starts normally", status == 200)
        # GoTrue's secure email-change default requires proof from BOTH inboxes.
        # Do not weaken provider settings just to make the test easier.
        for email in [new_email, "review@example.invalid"]:
            for _ in range(60):
                fresh = [m for m in self.message_ids(email) if m not in mail_before[email]]
                if fresh:
                    break
                time.sleep(0.1)
            with self.open_local(self.mail_base + "/api/v1/message/" + fresh[0]) as response:
                message = json.load(response)
            code = re.search(r"\b\d{6}\b", message.get("Text", "") + " " + message.get("HTML", "")).group()
            status, changed = self.api("/verify", {"email": email, "token": code, "type": "email_change"})
            self.check("Review email change six-digit inbox proof accepted " + ("new" if email == new_email else "old"), status == 200)
        self.check("Review email change proof preserves same Auth UUID", changed.get("user", {}).get("id") == rid)
        status, result = self.password_login(new_email, review_password)
        self.check("Allowlisted UUID remains authorized after email change", status == 200 and self.session(result))
        # Reuse former review EMAIL for another UUID: it must not inherit authority.
        former = self.request_and_verify("review@example.invalid", label="Former review email creates distinct ordinary account")
        self.check("Former review email has a different UUID", former["user"]["id"] != rid)
        status, _ = self.api("/user", {"password": review_password}, former["access_token"], "PUT")
        self.check("Former review email password storage is permitted", status == 200)
        self.denied_login("Former review email does not inherit password authority", "review@example.invalid", review_password, former["user"]["id"])
        # Administrative replacement is explicit, atomic, and never based on email.
        self.sql("begin; update private.apple_review_password_account set account_id='" + oid + "'; commit;")
        self.denied_login("Replaced review UUID cannot password-login", new_email, review_password, rid)
        status, replacement = self.password_login("ordinary@example.invalid", ordinary_password)
        self.check("Replacement UUID now alone obtains password session", status == 200 and self.session(replacement))
        self.sql("delete from auth.users where id='" + oid + "';")
        self.check("Deleting designated Auth account cascades allowlist row", self.sql("select count(*) from private.apple_review_password_account;") == "0")
        status, result = self.refresh(replacement)
        self.check("Deleted review account cannot refresh", status >= 400 and not self.session(result))

    def check_autoconfirm(self, passwd):
        self.start_auth("autoconfirm", autoconfirm=True)
        counts = "select (select count(*) from auth.sessions), (select count(*) from auth.refresh_tokens);"
        before = self.sql(counts)
        status, result = self.api("/signup", {"email": "autoconfirm-signup@example.invalid", "password": passwd})
        self.check("Auto-confirmed password signup cannot issue session", status == 403 and not self.session(result))
        self.check("Denied auto-confirm signup leaves no session or refresh rows", self.sql(counts) == before)
        status, result = self.api("/otp", {"email": "autoconfirm-otp@example.invalid", "create_user": True})
        self.check("Auto-confirm new OTP conflict is detected (rollout forbidden with this config)", status == 403 and not self.session(result))
        self.start_auth("confirmed-again")
        self.request_and_verify("final-new@example.invalid", label="Confirmation-required new OTP after config restoration")

    def cleanup(self):
        for name in reversed(self.containers):
            label = self.docker("inspect", "--format", '{{index .Config.Labels "curling.review-test"}}', name, require=False)
            if label.returncode == 0 and label.stdout.strip() == self.tag:
                self.docker("rm", "-fv", name, require=False)
        if self.network_created:
            self.docker("network", "rm", self.tag, require=False)
        self.temp.cleanup()
        remaining = self.docker("ps", "-aq", "--filter", "label=curling.review-test=" + self.tag, require=False)
        network = self.docker("network", "inspect", self.tag, require=False)
        return remaining.returncode == 0 and not remaining.stdout.strip() and network.returncode != 0 and not self.root.exists()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--result", type=Path, default=Path("/tmp/curling-review-access-result.json"))
    args = parser.parse_args()
    test = LocalPolicyTest()
    failed = False
    try:
        test.setup()
        test.run_checks()
    except Exception as error:
        # Only our closed messages are safe. HTTP/Docker/JSON exceptions can embed secrets.
        message = str(error) if type(error) is RuntimeError else "Isolated infrastructure or response failure"
        test.results.append({"test": "Run completed", "pass": False, "reason": message})
        print("STOPPED: " + message, flush=True)
        failed = True
    finally:
        cleaned = test.cleanup()
        test.results.append({"test": "Only owned disposable containers/network and temporary secrets cleaned up", "pass": cleaned})
        failed = failed or not cleaned
        result = {"scope": "Actual full migration chain; isolated GoTrue 2.195.0/Postgres17/Mailpit; no hosted mutation",
                  "checks": test.results, "cleanup_verified": cleaned}
        args.result.write_text(json.dumps(result, indent=2) + "\n")
    passed = sum(item["pass"] is True for item in test.results)
    print("Result: " + str(passed) + " passed; " + str(sum(item["pass"] is False for item in test.results)) + " failed; " +
          str(sum(item["pass"] is None for item in test.results)) + " unexecuted", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
