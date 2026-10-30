#!/usr/bin/env python3
"""Owned, isolated complete E2E runner. Never resets an existing Supabase stack."""
import base64
import hashlib
import hmac
import importlib.util
import json
import os
import re
from pathlib import Path
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
RESULT = Path('/tmp/curling-isolated-e2e-result.json')
STAGE1 = 'supabase/migrations/20261030120000_apple_review_password_access.sql'
NODE = shutil.which('node')
BRAVE = Path('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')

def safe_source(name):
    path = Path(name)
    denied = {'.git', '.next', '.auth', '.supabase', '.temp', '.vercel', 'node_modules',
              'test-results', 'playwright-report', 'coverage', '__pycache__', '.agents', '.codex',
              '.aws', 'dist', 'build', '.turbo', '.cache', 'Pods', 'DerivedData'}
    if not name or any(p in denied for p in path.parts) or path.is_absolute() or '..' in path.parts:
        return False
    if path.suffix in {'.log', '.tsbuildinfo', '.har', '.trace', '.pem', '.key', '.p12', '.mobileprovision'}:
        return False
    return all(not p.startswith('.env') or p == '.env.example' for p in path.parts)

# New untracked files are copied only from this reviewed implementation manifest.
# Tracked files are enumerated by Git, but their CURRENT bytes are copied.
APPROVED_UNTRACKED = {
    'docs/APPLE_REVIEW_ACCESS.md', 'scripts/test_apple_review_access.py',
    'scripts/run_isolated_e2e.py', 'scripts/test_isolated_e2e_infrastructure.py',
    'supabase/migrations/20261030120000_apple_review_password_access.sql',
    'src/lib/identity/__tests__/reviewPasswordTransition.test.ts',
    'src/lib/supabase/__tests__/webReviewPasswordIsolation.test.ts',
    'src/components/identity/__tests__/IdentityGateScreen.reviewAccess.test.tsx',
    'tests/e2e/isolated-environment.ts',
    'tests/e2e/review-access-web.spec.ts',
    'scripts/__tests__/isolatedEnvironment.test.ts',
    'src/lib/supabase/__tests__/nativeReviewAccessUi.test.tsx',
}

def read_source(repo, name):
    # Walk with directory descriptors and O_NOFOLLOW: a concurrently replaced
    # source symlink must never turn a manifest copy into a private-file read.
    directory = os.open(repo, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parts = Path(name).parts
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory); directory = child
        descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        with os.fdopen(descriptor, 'rb') as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode): raise RuntimeError('Non-regular source refused')
            return source.read()
    finally: os.close(directory)

def source_manifest(repo):
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=repo).split(b'\0')
    names = {n.decode() for n in tracked if n and safe_source(n.decode())}
    untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=repo).split(b'\0')
    for raw in untracked:
        if not raw: continue
        name = raw.decode()
        if safe_source(name) and name not in APPROVED_UNTRACKED:
            raise RuntimeError('Unreviewed untracked source prevents snapshot')
        if safe_source(name): names.add(name)
    manifest = {}
    for name in sorted(names):
        source = repo / name
        # Never resolve or copy symlinked files or directory ancestors.
        if any(parent.is_symlink() for parent in [source, *source.parents] if parent != repo.parent):
            raise RuntimeError('Symlinked source prevents snapshot')
        if not source.exists(): continue  # approved working-tree deletion
        if not source.is_file(): raise RuntimeError('Non-file source prevents snapshot')
        manifest[name] = hashlib.sha256(read_source(repo, name)).hexdigest()
    return manifest

def snapshot(app, repo=None):
    repo = repo or REPO
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    manifest = source_manifest(repo)
    for name, digest in manifest.items():
        data = read_source(repo, name)
        if hashlib.sha256(data).hexdigest() != digest:
            raise RuntimeError('Source changed while copying')
        dest = app / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    if source_manifest(repo) != manifest:
        raise RuntimeError('Source changed during snapshot')
    # Only installed dependencies, never application/private source or state.
    (app / 'node_modules').symlink_to(repo / 'node_modules', target_is_directory=True)
    return head, manifest

def stack_type(stage1):
    class Stack(stage1.LocalPolicyTest):
        def __init__(self):
            super().__init__()
            self.owned_sql_checks = 0
            self.sql_owner_override = None
            self.ids = {}
            self.network_id = None
            self.open_http = stage1.open_local_http
        def owned_id(self, name, expected=None):
            if name not in self.ids: raise RuntimeError('Unregistered container refused')
            result = super().docker('inspect', '--format', '{{.Id}}|{{index .Config.Labels "curling.review-test"}}', name, require=False)
            parts = result.stdout.strip().split('|')
            if result.returncode or len(parts) != 2 or parts != [self.ids[name], expected or self.tag]:
                raise RuntimeError('Container ownership refused')
            return parts[0]
        def docker(self, *args, data=None, require=True):
            if args[:2] == ('network', 'create'):
                result = super().docker('network', 'create', '--label', 'curling.review-test=' + self.tag, *args[2:], data=data, require=require)
                if result.returncode == 0: self.network_id = result.stdout.strip()
                return result
            if args and args[0] == 'run':
                name = args[args.index('--name') + 1]
                result = super().docker(*args, data=data, require=require)
                if result.returncode == 0:
                    identity = result.stdout.strip()
                    if not re.fullmatch('[a-f0-9]{64}', identity): raise RuntimeError('New container ID unavailable')
                    self.ids[name] = identity
                return result
            if args and args[0] == 'rm':
                if len(args) != 3: raise RuntimeError('Unexpected removal refused')
                args = ('rm', args[1], self.owned_id(args[2]))
            elif args and args[0] == 'exec':
                index = 2 if args[1] == '-i' else 1
                args = (*args[:index], self.owned_id(args[index]), *args[index+1:])
            elif args and args[0] == 'cp':
                name, sep, target = args[-1].partition(':')
                if not sep: raise RuntimeError('Unexpected copy refused')
                args = (*args[:-1], self.owned_id(name) + ':' + target)
            return super().docker(*args, data=data, require=require)
        def cleanup(self):
            clean = True
            for name in reversed(self.containers):
                present = super().docker('inspect', name, require=False)
                if present.returncode: continue
                try:
                    identity = self.owned_id(name)
                    removed = super().docker('rm', '-fv', identity, require=False)
                    clean = clean and removed.returncode == 0
                except RuntimeError: clean = False
            if self.network_created:
                result = super().docker('network', 'inspect', '--format', '{{.Id}}|{{index .Labels "curling.review-test"}}', self.tag, require=False)
                if result.returncode == 0 and result.stdout.strip() == self.network_id + '|' + self.tag:
                    clean = super().docker('network', 'rm', self.network_id, require=False).returncode == 0 and clean
                else: clean = False
            self.temp.cleanup()
            remaining = super().docker('ps', '-aq', '--filter', 'label=curling.review-test=' + self.tag, require=False)
            network = super().docker('network', 'inspect', self.tag, require=False)
            return clean and remaining.returncode == 0 and not remaining.stdout.strip() and network.returncode != 0 and not self.root.exists()
        def sql_process(self, query):
            try:
                identity = self.owned_id(self.db, self.sql_owner_override)
            except RuntimeError:
                return subprocess.CompletedProcess([], 1, '', 'SQL ownership refused')
            self.owned_sql_checks += 1
            return super().docker('exec', '-i', identity, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', data=query, require=False)
        def sql(self, query):
            if query.lower().startswith('alter role supabase_auth_admin password'):
                # Supabase's image can accept SELECT 1 before all init roles exist.
                for _ in range(100):
                    ready = self.sql_process("select count(*)=5 from pg_roles where rolname in ('supabase_auth_admin','authenticator','anon','authenticated','service_role');")
                    if ready.returncode == 0 and ready.stdout.strip() == 't':
                        break
                    time.sleep(0.1)
                else:
                    raise RuntimeError('Disposable database roles did not finish initializing')
            result = self.sql_process(query)
            if result.returncode:
                found = re.search(r'ERROR:\s+([A-Z0-9]{5}):', result.stderr)
                family = query.lstrip().split()[0].upper()
                raise RuntimeError('Isolated SQL ' + family + ' failed with ' + (found.group(1) if found else 'unclassified local error'))
            return result.stdout.strip()
        def start_auth(self, suffix, **kwargs):
            self.auth_env['GOTRUE_MAILER_SUBJECTS_CONFIRMATION'] = 'Your local test sign-in code'
            self.auth_env['GOTRUE_MAILER_SUBJECTS_MAGIC_LINK'] = 'Your local test sign-in code'
            return super().start_auth(suffix, **kwargs)
        def run(self, suffix, image, **kwargs):
            if suffix == 'mail':
                kwargs['ports'] = (8025, 1025)
            name = super().run(suffix, image, **kwargs)
            result = super().docker('inspect', '--format', '{{.Id}}|{{index .Config.Labels "curling.review-test"}}', name)
            parts = result.stdout.strip().split('|')
            if len(parts) != 2 or parts != [self.ids.get(name), self.tag]:
                raise RuntimeError('New container ownership unavailable')
            self.ids[name] = parts[0]
            return name
    return Stack

def compact_token(secret):
    def part(data):
        return base64.urlsafe_b64encode(json.dumps(data, separators=(',', ':')).encode()).rstrip(b'=')
    unsigned = part({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + part({'role': 'anon', 'aud': 'authenticated', 'iat': int(time.time()), 'exp': int(time.time()) + 3600})
    return (unsigned + b'.' + base64.urlsafe_b64encode(hmac.new(secret.encode(), unsigned, hashlib.sha256).digest()).rstrip(b'=')).decode()

def existing_stack(stack):
    lines = stack.docker('ps', '-a', '--format', '{{.ID}}|{{.State}}|{{.Names}}').stdout.splitlines()
    return sorted(line for line in lines if line.rsplit('|', 1)[-1].startswith('supabase_'))

class Gateway(ThreadingHTTPServer):
    daemon_threads = True

def gateway(stack, app_origin, public_key):
    anonymous = compact_token(stack.auth_env['GOTRUE_JWT_SECRET'])
    counters = {'anonymous_jwt_mapped': 0, 'user_bearer_preserved': 0, 'rest_requests': 0}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_OPTIONS(self):
            if self.headers.get('Origin') != app_origin:
                self.send_error(403)
                return
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', app_origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'apikey, authorization, content-type, x-client-info, x-supabase-api-version, accept-profile, content-profile, prefer')
            self.end_headers()
        def forward(self):
            origin = self.headers.get('Origin')
            if origin is not None and origin != app_origin:
                self.send_error(403)
                return
            if self.headers.get('apikey') != public_key:
                self.send_error(403)
                return
            if self.path.startswith('/auth/v1/'):
                target = stack.base + self.path[len('/auth/v1'):]
            elif self.path.startswith('/rest/v1/'):
                target = stack.rest + self.path[len('/rest/v1'):]
                counters['rest_requests'] += 1
            else:
                self.send_error(404)
                return
            headers = {k: v for k, v in self.headers.items() if k.lower() not in {'host', 'connection', 'content-length', 'accept-encoding', 'origin', 'apikey'}}
            if headers.get('Authorization', headers.get('authorization')) == 'Bearer ' + public_key:
                headers.pop('authorization', None)
                headers['Authorization'] = 'Bearer ' + anonymous
                counters['anonymous_jwt_mapped'] += 1
            elif self.headers.get('Authorization', '').startswith('Bearer '):
                counters['user_bearer_preserved'] += 1
            length = int(self.headers.get('Content-Length', '0'))
            if length > 1024 * 1024:
                self.send_error(413)
                return
            body = self.rfile.read(length) if length else None
            request = urllib.request.Request(target, headers=headers, data=body, method=self.command)
            try:
                response = stack.open_http(request, origins=(stack.base, stack.rest), timeout=20)
            except urllib.error.HTTPError as error:
                response = error
            except Exception:
                self.send_error(502)
                return
            with response:
                payload = response.read()
                self.send_response(response.status)
                for key, value in response.headers.items():
                    if key.lower() not in {'content-length', 'connection', 'transfer-encoding', 'access-control-allow-origin', 'content-encoding'}:
                        self.send_header(key, value)
                self.send_header('Access-Control-Allow-Origin', app_origin)
                self.send_header('Access-Control-Expose-Headers', 'content-range, x-supabase-api-version')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = forward
    server = Gateway(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, counters

def test_arguments(arguments):
    selected = []
    pending_grep = False
    for value in arguments:
        if pending_grep:
            selected.append(value); pending_grep = False
        elif value == '--ch-beta': continue
        elif value in {'--grep', '--grep-invert'}:
            selected.append(value); pending_grep = True
        elif re.fullmatch(r'[a-z0-9][a-z0-9-]*\.spec\.ts', value): selected.append(value)
        else: raise RuntimeError('Unsupported E2E argument; isolation overrides are forbidden')
    if pending_grep: raise RuntimeError('Missing E2E filter value')
    if '--ch-beta' in arguments: selected = ['ch-beta-product-analytics.spec.ts', *selected]
    return selected

def process_group_exists(group):
    try: os.killpg(group, 0); return True
    except ProcessLookupError: return False
    except PermissionError: return True  # cannot prove cleanup


def stop_owned_process_group(process, grace_seconds=2, kill_seconds=3):
    """Only for the exact Popen created below with start_new_session=True.

    Parent settlement is not group settlement: a child may ignore TERM after
    its parent has exited. Verify the whole original group after TERM and KILL.
    """
    group = process.pid
    if group <= 1 or group == os.getpgrp(): return False
    try:
        if process.poll() is None and os.getpgid(group) != group: return False
        if process_group_exists(group): os.killpg(group, signal.SIGTERM)
        deadline = time.monotonic() + grace_seconds
        while process_group_exists(group) and time.monotonic() < deadline:
            process.poll()  # reap the direct child, independent of grandchildren
            time.sleep(0.025)
        if process_group_exists(group): os.killpg(group, signal.SIGKILL)
        deadline = time.monotonic() + kill_seconds
        while process_group_exists(group) and time.monotonic() < deadline:
            process.poll()
            time.sleep(0.025)
        process.poll()
        return not process_group_exists(group)
    except ProcessLookupError:
        process.poll()
        return not process_group_exists(group)
    except (OSError, subprocess.SubprocessError): return False


def complete_success(report):
    return (report.get('ok') is True and report.get('owned_process_group_cleanup_verified') is True
            and report.get('existing_cli_stack_unchanged') is True
            and report.get('owned_stack_cleanup_verified') is True
            and report.get('temporary_app_and_private_logs_removed') is True)

def main():
    report = {'purpose': 'Complete isolated Web E2E, native device acceptance excluded', 'checks': []}
    temporary = tempfile.TemporaryDirectory(prefix='curling-e2e-infra-', dir='/private/tmp')
    app = Path(temporary.name) / 'app'
    app.mkdir()
    stack = None
    process = None
    server = None
    before = None
    step = 'safe_current_snapshot'
    def interrupted(*_): raise RuntimeError('Isolated run interrupted; owned cleanup required')
    previous_signals = {sig: signal.signal(sig, interrupted) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        arguments = test_arguments(sys.argv[1:])
        if not NODE or not BRAVE.is_file(): raise RuntimeError('Existing Node/Brave runtime unavailable; no installation attempted')
        head, manifest = snapshot(app)
        report['source'] = {'head': head, 'selection': 'current tracked plus explicitly approved untracked source', 'selected_files': len(manifest), 'manifest': manifest}
        spec = importlib.util.spec_from_file_location('frozen_stage1', app / 'scripts/test_apple_review_access.py')
        stage1 = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(stage1)
        stage1.REPO = app
        stage1.MIGRATION = app / STAGE1
        stack = stack_type(stage1)()
        before = existing_stack(stack)
        step = 'real_isolated_auth_stack'
        stack.setup()
        checks_before = stack.owned_sql_checks
        stack.sql_owner_override = 'intentionally-wrong-test-owner'
        refused = stack.sql_process('select 1;')
        stack.sql_owner_override = None
        report['checks'].append({'name': 'wrong owner tag prevents SQL exec before any database call', 'pass': refused.returncode != 0 and stack.owned_sql_checks == checks_before})
        stack.sql((app / 'supabase/seed.sql').read_text())
        # REST uses genuine JWT verification and normal Postgres role switching.
        stack.sql("alter role authenticator password '" + stack.password + "';")
        rest_container = stack.run('rest', 'public.ecr.aws/supabase/postgrest:v16.1', env={
            'PGRST_DB_URI': 'postgres://authenticator:' + stack.password + '@' + stack.db + ':5432/postgres',
            'PGRST_DB_SCHEMAS': 'public', 'PGRST_DB_ANON_ROLE': 'anon',
            'PGRST_JWT_SECRET': stack.auth_env['GOTRUE_JWT_SECRET'], 'PGRST_JWT_AUD': 'authenticated',
            'PGRST_SERVER_HOST': '0.0.0.0', 'PGRST_SERVER_PORT': '3000'}, ports=(3000,))
        stack.rest = 'http://127.0.0.1:' + stack.port(rest_container, 3000)
        for _ in range(120):
            try:
                with stack.open_http(stack.rest, origins=(stack.rest,), timeout=1) as ready:
                    if ready.status == 200: break
            except Exception: pass
            time.sleep(0.25)
        else: raise RuntimeError('Isolated REST did not become ready')
        with socket.socket() as reserved:
            reserved.bind(('127.0.0.1', 0))
            app_port = reserved.getsockname()[1]
        app_origin = 'http://127.0.0.1:' + str(app_port)
        public_key = 'sb_publishable_' + secrets.token_urlsafe(32)
        server, counters = gateway(stack, app_origin, public_key)
        api_origin = 'http://127.0.0.1:' + str(server.server_address[1])
        env = {k: os.environ[k] for k in ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM'] if k in os.environ}
        env.update({'NEXT_PUBLIC_SUPABASE_URL': api_origin, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': public_key,
                    'NEXT_PUBLIC_POSTHOG_ENABLED': '1', 'NEXT_PUBLIC_POSTHOG_TOKEN': 'phc_syntheticE2EOnly0001', 'NEXT_PUBLIC_POSTHOG_HOST': 'https://eu.i.posthog.com', 'NEXT_PUBLIC_POSTHOG_CH_BETA': '1' if '--ch-beta' in sys.argv else '0', 'APP_ORIGIN': app_origin,
                    'SMTP_HOST': '127.0.0.1', 'SMTP_PORT': stack.port(stack.mail, 1025), 'SMTP_SECURE': 'false',
                    'SMTP_USER': '', 'SMTP_PASS': '', 'SMTP_FROM_ADDRESS': 'test@example.invalid',
                    'NEXT_TELEMETRY_DISABLED': '1'})
        env.update({'CURLING_E2E_ISOLATED': '1', 'CURLING_E2E_OWNER': stack.tag,
                    'CURLING_E2E_DB_CONTAINER': stack.db, 'CURLING_E2E_DB_ID': stack.ids[stack.db], 'CURLING_E2E_APP_ORIGIN': app_origin,
                    'CURLING_E2E_MAIL_ORIGIN': stack.mail_base, 'CURLING_E2E_BROWSER': str(BRAVE),
                    'CURLING_E2E_TEMP_ROOT': str(app)})
        step = 'isolated_serial_playwright'
        private_log = Path(temporary.name) / 'playwright-private.log'
        with private_log.open('w') as output:
            private_log.chmod(0o600)
            process = subprocess.Popen([NODE, str(app / 'tests/e2e/run-local.mjs'), *arguments],
                                       cwd=app, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        status = process.wait()
        # Report only framework aggregate counts. Raw runner errors may contain
        # browser session/DOM/request data; private artifacts are deleted below.
        log_text = private_log.read_text()
        counts = {}
        for kind in ['passed', 'failed', 'skipped', 'did not run']:
            matches = re.findall(r'(\d+) ' + kind + r'\b', log_text)
            counts[kind] = int(matches[-1]) if matches else 0
        report['playwright'] = {'exit_code': status, 'counts': counts,
                                'ch_beta': '--ch-beta' in sys.argv, 'workers': 1}
        report['gateway'] = counters
        report['owned_sql_prechecks'] = stack.owned_sql_checks
        report['checks'].append({'name': 'Playwright completed successfully', 'pass': status == 0})
        report['ok'] = all(c['pass'] for c in report['checks'])
    except Exception as error:
        report['ok'] = False
        report['failed_step'] = step
        report['reason'] = 'Isolated run failed; raw runtime detail withheld'
        if isinstance(error, KeyboardInterrupt): report['interrupted'] = True
    finally:
        for sig in previous_signals: signal.signal(sig, signal.SIG_IGN)
        report['owned_process_group_cleanup_verified'] = stop_owned_process_group(process) if process is not None else True
        if server:
            server.shutdown()
            server.server_close()
        try:
            after = existing_stack(stack) if before is not None else None
            report['existing_cli_stack_unchanged'] = before == after if before is not None else None
        except Exception: report['existing_cli_stack_unchanged'] = False
        try: report['owned_stack_cleanup_verified'] = stack.cleanup() if stack is not None else True
        except Exception: report['owned_stack_cleanup_verified'] = False
        try: temporary.cleanup()
        except Exception: pass
        report['temporary_app_and_private_logs_removed'] = not Path(temporary.name).exists()
        report['ok'] = complete_success(report)
        RESULT.write_text(json.dumps(report, indent=2) + '\n')
        public_report = {**report, 'source': {k: v for k, v in report.get('source', {}).items() if k != 'manifest'}}
        print(json.dumps(public_report, indent=2))
        for sig, handler in previous_signals.items(): signal.signal(sig, handler)
    return 0 if report.get('ok') else 1

if __name__ == '__main__':
    raise SystemExit(main())
