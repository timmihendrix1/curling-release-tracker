"""Harmless unit/counter tests: no Docker, browser, existing database or Git mutation."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch
import sys
import io
import os
import signal
import time
import urllib.request
import urllib.response
import urllib.error
from email.message import Message
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('infra', Path(__file__).with_name('run_isolated_e2e.py'))
infra = importlib.util.module_from_spec(spec)
spec.loader.exec_module(infra)

class ManifestTests(unittest.TestCase):
    def test_private_paths_rejected_without_reading(self):
        for name in ['.env.local', 'a/.env.production', '.git/config', '.auth/session.json', '.supabase/state', '.temp/a', '.vercel/project.json', '.next/a', 'test-results/x', '../a', '/a', 'mobile/dist/x', 'x.har', '.aws/x']:
            with self.subTest(name=name): self.assertFalse(infra.safe_source(name))
    def test_public_example_and_source_allowed(self):
        self.assertTrue(infra.safe_source('.env.example'))
        self.assertTrue(infra.safe_source('src/app/page.tsx'))
    def manifest(self, root, tracked, untracked=b''):
        with patch.object(infra.subprocess, 'check_output', side_effect=[tracked, untracked]):
            return infra.source_manifest(root)
    def test_current_tracked_bytes_and_approved_untracked_copied(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); (root/'a.ts').write_text('current unstaged bytes')
            (root/'docs').mkdir(); (root/'docs/APPLE_REVIEW_ACCESS.md').write_text('approved new file')
            result = self.manifest(root, b'a.ts\0.env.local\0', b'docs/APPLE_REVIEW_ACCESS.md\0')
            self.assertEqual(set(result), {'a.ts', 'docs/APPLE_REVIEW_ACCESS.md'})
            self.assertEqual(result['a.ts'], infra.hashlib.sha256(b'current unstaged bytes').hexdigest())
    def test_unknown_untracked_source_refuses_snapshot(self):
        with self.assertRaisesRegex(RuntimeError, 'Unreviewed'):
            self.manifest(Path('/private/tmp'), b'', b'unknown.ts\0')
    def test_symlink_source_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); (root/'target').write_text('synthetic'); (root/'a.ts').symlink_to(root/'target')
            with self.assertRaisesRegex(RuntimeError, 'Symlinked'): self.manifest(root, b'a.ts\0')
    def test_source_change_after_copy_refuses_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve(); app=root/'app'; app.mkdir(); (root/'a.ts').write_text('one')
            digest=infra.hashlib.sha256(b'one').hexdigest()
            with patch.object(infra.subprocess, 'check_output', return_value=b'head\n'), patch.object(infra, 'source_manifest', side_effect=[{'a.ts':digest},{}]):
                with self.assertRaisesRegex(RuntimeError, 'changed'): infra.snapshot(app,root)

class CompletionTests(unittest.TestCase):
    def test_cleanup_or_preservation_failure_cannot_succeed(self):
        good={'ok':True, 'existing_cli_stack_unchanged':True, 'owned_stack_cleanup_verified':True, 'temporary_app_and_private_logs_removed':True, 'owned_process_group_cleanup_verified':True}
        self.assertTrue(infra.complete_success(good))
        for key in good:
            self.assertFalse(infra.complete_success({**good,key:False}))
    def test_argument_overrides_forbidden(self):
        for flag in ['--trace=on','--workers=4','--config=private.ts','--output=/somewhere','../foreign.spec.ts']:
            with self.assertRaises(RuntimeError): infra.test_arguments([flag])
    def test_only_filters_and_owned_modes_accepted(self):
        self.assertEqual(infra.test_arguments(['--ch-beta']), ['ch-beta-product-analytics.spec.ts'])
        self.assertEqual(infra.test_arguments(['review-access-web.spec.ts','--grep','Web']), ['review-access-web.spec.ts','--grep','Web'])

class FakeBase:
    def __init__(self):
        self.tag='curling-review-test-123456789abc'; self.calls=[]
        self.inspect_id='a'*64; self.inspect_label=self.tag
    def docker(self,*args,**kwargs):
        self.calls.append((args,kwargs))
        if args[0]=='inspect': return subprocess.CompletedProcess(args,0,self.inspect_id+'|'+self.inspect_label+'\n','')
        return subprocess.CompletedProcess(args,0,'','')

class OwnershipTests(unittest.TestCase):
    def setUp(self):
        self.stack=infra.stack_type(types.SimpleNamespace(LocalPolicyTest=FakeBase, open_local_http=lambda *a, **k: None))()
        self.stack.db=self.stack.tag+'-db'; self.stack.ids[self.stack.db]='a'*64
    def mutations(self): return [c for c in self.stack.calls if c[0][0] in {'exec','rm','cp'}]
    def test_wrong_label_causes_zero_sql_writes(self):
        self.stack.inspect_label='other'
        self.assertNotEqual(self.stack.sql_process('delete from fixture').returncode,0); self.assertEqual(self.mutations(),[])
    def test_wrong_id_causes_zero_sql_writes(self):
        self.stack.inspect_id='b'*64
        self.assertNotEqual(self.stack.sql_process('delete from fixture').returncode,0); self.assertEqual(self.mutations(),[])
    def test_sql_uses_registered_id_after_positive_inspect(self):
        self.stack.sql_process('select 1')
        self.assertEqual(self.mutations()[0][0][:3],('exec','-i','a'*64))
    def test_removal_uses_registered_id(self):
        self.stack.docker('rm','-fv',self.stack.db)
        self.assertEqual(self.mutations()[0][0],('rm','-fv','a'*64))
    def test_wrong_label_blocks_parent_auth_removal(self):
        self.stack.inspect_label='other'
        with self.assertRaisesRegex(RuntimeError,'ownership'): self.stack.docker('rm','-fv',self.stack.db)
        self.assertEqual(self.mutations(),[])
    def test_unregistered_exec_target_refused(self):
        with self.assertRaisesRegex(RuntimeError,'Unregistered'): self.stack.docker('exec','existing-developer-db','anything')
        self.assertEqual(self.mutations(),[])
    def test_template_cp_uses_registered_id(self):
        self.stack.docker('cp','synthetic-file',self.stack.db+':/tmp/fixture')
        self.assertEqual(self.mutations()[0][0],('cp','synthetic-file','a'*64+':/tmp/fixture'))

# Actual transport, intercepted below HTTP/HTTPS handlers: no network is opened.
helper_spec = importlib.util.spec_from_file_location('policy_helper', Path(__file__).with_name('test_apple_review_access.py'))
policy = importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(policy)

class LocalHTTPTests(unittest.TestCase):
    def run_intercepted(self, callback, redirect=None):
        seen = []
        class HTTP(urllib.request.HTTPHandler):
            def http_open(self, request):
                seen.append((request.host, request.has_proxy(), request.get_header('Authorization'), request.data))
                headers=Message()
                if redirect: headers['Location']=redirect
                result=urllib.response.addinfourl(io.BytesIO(b'{}'),headers,request.full_url,302 if redirect else 200)
                result.msg='Found' if redirect else 'OK'
                return result
        class HTTPS(urllib.request.HTTPSHandler):
            def https_open(self, request):
                seen.append(('EXTERNAL_ATTEMPT',False,None,None))
                raise RuntimeError('External routing attempted')
        actual_build = urllib.request.build_opener
        def build(*handlers): return actual_build(*handlers, HTTP(), HTTPS())
        with patch.dict(os.environ, {'HTTP_PROXY':'http://synthetic-proxy.invalid:3128', 'ALL_PROXY':'http://synthetic-proxy.invalid:3128', 'NO_PROXY':''}), patch.object(urllib.request,'proxy_bypass',return_value=False), patch.object(urllib.request,'build_opener',side_effect=build), patch.object(urllib.request,'urlopen',side_effect=AssertionError('Global opener forbidden')):
            callback()
        return seen
    def test_auth_password_and_bearer_ignore_ambient_proxy(self):
        instance=object.__new__(policy.LocalPolicyTest); instance.base='http://127.0.0.1:43111'
        seen=self.run_intercepted(lambda: instance.api('/token?grant_type=password',{'password':'SYNTHETIC_TEST_ONLY'},'SYNTHETIC_TOKEN'))
        self.assertEqual(len(seen),1); self.assertEqual(seen[0][:2],('127.0.0.1:43111',False))
        self.assertEqual(seen[0][2],'Bearer SYNTHETIC_TOKEN'); self.assertIn(b'SYNTHETIC_TEST_ONLY',seen[0][3])
    def test_mail_and_readiness_paths_use_proxy_free_transport(self):
        instance=object.__new__(policy.LocalPolicyTest); instance.base='http://127.0.0.1:43111'; instance.mail_base='http://127.0.0.1:43112'
        def calls():
            instance.message_ids('synthetic@example.invalid')
            with policy.open_local_http('http://127.0.0.1:43113/',origins=('http://127.0.0.1:43113',)): pass
        seen=self.run_intercepted(calls)
        self.assertEqual([value[:2] for value in seen],[('127.0.0.1:43112',False),('127.0.0.1:43113',False)])
    def test_redirect_cannot_forward_bearer_or_body(self):
        for target in ['https://synthetic-external.invalid/receive','http://synthetic-external.invalid/receive','http://127.0.0.1:43112/receive']:
            request=urllib.request.Request('http://127.0.0.1:43111/verify',headers={'Authorization':'Bearer SYNTHETIC_TOKEN'},data=b'SYNTHETIC_BODY')
            def call():
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    policy.open_local_http(request,origins=('http://127.0.0.1:43111',))
                self.assertEqual(caught.exception.code,302)
            seen=self.run_intercepted(call,target)
            self.assertEqual(len(seen),1); self.assertNotEqual(seen[0][0],'EXTERNAL_ATTEMPT')
    def test_direct_foreign_or_wrong_port_target_refused_before_transport(self):
        for target in ['https://external.invalid/a','http://127.0.0.1:43112/a','http://user@127.0.0.1:43111/a','http://localhost:43111/a','http://127.0.0.1:43111/a#secret']:
            with patch.object(urllib.request,'build_opener') as opened:
                with self.assertRaises(RuntimeError): policy.open_local_http(target,origins=('http://127.0.0.1:43111',))
                opened.assert_not_called()

class ProcessCleanupTests(unittest.TestCase):
    def test_parent_exit_does_not_skip_kill_of_term_resistant_owned_child(self):
        with tempfile.TemporaryDirectory(prefix='curling-own-process-test-',dir='/private/tmp') as tmp:
            ready=Path(tmp)/'child-ready'
            child="import os,signal,sys,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); open(sys.argv[1],'w').write(str(os.getpid())); time.sleep(30)"
            parent="import subprocess,sys; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]])"
            process=subprocess.Popen([sys.executable,'-c',parent,child,str(ready)],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                deadline=time.monotonic()+5
                while not ready.exists() and time.monotonic()<deadline: time.sleep(.01)
                self.assertTrue(ready.exists()); process.wait(timeout=5)
                with patch.object(infra.os,'killpg',wraps=os.killpg) as signals:
                    self.assertTrue(infra.stop_owned_process_group(process,.1,3))
                    self.assertTrue(any(args[0][1]==signal.SIGKILL for args in signals.call_args_list))
                self.assertFalse(infra.process_group_exists(process.pid))
            finally:
                try: os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError: pass
                process.wait(timeout=5)
    def test_fault_finally_still_cleans_own_live_group(self):
        process=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            try: raise RuntimeError('Synthetic run fault')
            except RuntimeError: pass
            finally: self.assertTrue(infra.stop_owned_process_group(process,.1,3))
        finally:
            try: os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            process.wait(timeout=5)
    def test_surviving_group_is_failure_even_after_parent_wait(self):
        process=types.SimpleNamespace(pid=999999999,poll=lambda:0)
        with patch.object(infra,'process_group_exists',return_value=True), patch.object(infra.os,'killpg') as signals:
            self.assertFalse(infra.stop_owned_process_group(process,0,0))
            self.assertEqual(signals.call_args_list,[unittest.mock.call(process.pid,signal.SIGTERM),unittest.mock.call(process.pid,signal.SIGKILL)])
    def test_never_targets_callers_own_group(self):
        process=types.SimpleNamespace(pid=os.getpgrp())
        with patch.object(infra.os,'killpg') as signals:
            self.assertFalse(infra.stop_owned_process_group(process,0,0)); signals.assert_not_called()

if __name__=='__main__': unittest.main()
