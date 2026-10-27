// Actual explicit destination File/Provider/Tracker tree in a genuinely fresh PID.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
export async function runInstallationTransferUi({ load, configured, hostOptions, data, profile, requests, environment }) {
  const React = load('react'), ui = load('@testing-library/react');
  const { act, fireEvent, render, screen, waitFor, cleanup } = ui;
  const { createInstallationTransferApplication } = load(path.join(process.cwd(), 'src/lib/supabase/installationTransferApplication.ts'));
  const { InstallationTransferFlow } = load(path.join(process.cwd(), 'src/components/persistence/InstallationTransferFlow.tsx'));
  const owner = createInstallationTransferApplication(configured, hostOptions);
  const tree = React.createElement(InstallationTransferFlow, { owner });
  const rendered = render(data.uiStrict ? React.createElement(React.StrictMode, null, tree) : tree);
  if (data.captureUi) {
    const styles = fs.readdirSync(path.join(process.cwd(), 'mobile/dist/assets')).filter(name => name.endsWith('.css')).map(name => fs.readFileSync(path.join(process.cwd(), 'mobile/dist/assets', name), 'utf8')).join('\n');
    fs.writeFileSync('/tmp/curling-s6n2-initial-flow.html', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>' + styles + '</style></head><body><main class="house-shell min-h-screen px-4 py-4 sm:px-6 sm:py-8"><div class="mx-auto w-full max-w-md sm:max-w-xl">' + document.body.innerHTML + '</div></main></body></html>');
  }
  const click = async (name) => { await act(async () => { fireEvent.click(screen.getAllByRole('button', { name })[0]); }); };
  const change = async (label, value) => { await act(async () => { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }); };
  const signIn = async () => {
    await screen.findByLabelText('Email address'); await change('Email address', 'synthetic@example.invalid'); await click('Send sign-in code');
    await screen.findByLabelText('6-digit code'); await change('6-digit code', '123456'); await click('Verify code');
  };
  let step = 'selection';
  try {
    if (data.importUi) {
      const file = new window.File([data.protectedWire], 'synthetic-transfer.txt');
      await act(async () => { fireEvent.change(screen.getByLabelText('Transfer file'), { target: { files: [file] } }); });
      await change('Recovery code', data.recoveryCode); await click('Check transfer file');
      assert.equal(screen.queryByRole('button', { name: 'Import training data' }), null); assert.equal(screen.queryByTestId('house-home'), null);
      step = 'first-signin'; await signIn();
      if (data.importOnboarding) {
        await screen.findByLabelText('Display Name'); await change('Display Name', 'Synthetic Athlete');
        await act(async () => { for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box); });
        await click('Create athlete profile');
      }
      if (data.importGuard || data.importPending || data.importLowControl) {
        step = 'recovery'; await screen.findByRole('button', { name: 'Try again' });
        assert.equal(screen.queryByRole('button', { name: 'Import training data' }), null);
        await act(async () => { fireEvent.click(screen.getByText('Account recovery')); });
        await click('Check account status');
        if (data.importLowControl) {
          await waitFor(() => assert.equal(owner.getSnapshot().accountStatus, 'unavailable'));
          assert.equal(screen.queryByRole('button', { name: 'Import training data' }), null);
          assert.equal(requests.includes('abort_my_uncommitted_account_deletion'), false);
          assert.equal(owner.getSnapshot().dataStored, false);
          let receipt; await act(async () => { rendered.unmount(); receipt = await owner.close(); }); environment.check();
          return { deniedImport: true, verifyCount: requests.filter(name => name === 'verify').length, cleanup: receipt, forbiddenBrowserAccesses: environment.forbidden.length };
        }
        if (data.importPending) {
          await screen.findByRole('button', { name: 'Cancel account deletion' }); await click('Cancel account deletion');
          await waitFor(() => assert.equal(owner.getSnapshot().accountStatus, 'cancelled'));
        } else await waitFor(() => assert.equal(owner.getSnapshot().accountStatus, 'clear'));
        assert.equal(requests.filter(name => name === 'verify').length, 1);
        await click('Sign out and sign in again'); step = 'second-signin'; await signIn();
      }
      step = 'publication'; await screen.findByRole('button', { name: 'Import training data' });
      assert.equal(screen.queryByTestId('house-home'), null); await click('Import training data');
      await screen.findByRole('heading', { name: 'Your import is saved' }, { timeout: 10000 });
      assert.equal(owner.getSnapshot().phase, 'restart'); assert.equal(owner.getSnapshot().dataStored, true);
      assert.equal(owner.getSnapshot().publication.code, 'publication_confirmed'); assert.equal(owner.getSnapshot().publication.observedLayout, 'desired11');
      assert.equal(screen.queryByTestId('house-home'), null);
      const verifyCount = requests.filter(name => name === 'verify').length;
      assert.equal(verifyCount, data.importGuard || data.importPending ? 2 : 1);
      let receipt; await act(async () => { rendered.unmount(); receipt = await owner.close(); }); assert.deepEqual(receipt, { ok: true });
      return { imported: true, verifyCount, onboarding: data.importOnboarding === true, cleanup: receipt, forbiddenBrowserAccesses: environment.forbidden.length };
    }
    step = 'cold-open'; await click('Open imported training');
    await screen.findByTestId('house-home', {}, { timeout: 10000 }); await screen.findByText('Imported published history');
    assert.equal(screen.queryByText('Other Profile private training'), null);
    const runtime = owner.getSnapshot().runtime;
    const scope = () => { const value = runtime.createLocalSportingScope(profile); assert.ok(value); return value; };
    const history = async () => { const value = await scope().repositories.session.loadHistory(); assert.equal(value.status, 'value'); return value.value; };
    const current = async () => { const value = await scope().repositories.session.loadCurrent(); assert.equal(value.status, 'value'); return value.value; };
    assert.equal((await history()).some(item => item.shots.some(shot => shot.releaseTime === 3.71)), true);
    if (data.openUiReadOnly) {
      const saved = (await history()).find(item => item.id === data.expectedImportedUiSessionId); assert.ok(saved); assert.equal(saved.shots.at(-1).releaseTime, 3.83);
      assert.equal((await history()).filter(item => item.id === saved.id).length, 1);
      await act(async () => { rendered.unmount(); }); assert.deepEqual(await owner.close(), { ok: true });
      return { coldRead: true, sessionId: saved.id, forbiddenBrowserAccesses: environment.forbidden.length };
    }
    await click('Start Training'); await screen.findByRole('heading', { level: 2, name: 'Exercises' });
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Training Plans' })); }); await screen.findByText('Imported published plan');
    assert.equal(screen.queryByText('Other Profile private plan'), null);
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Exercises' })); });
    await click(/^Technique/); await click('View Details: Release Time'); await click('Continue to Timing Setup');
    await screen.findByText('Ready to train.'); await click('Start Training'); await screen.findByText('Current exercise');
    await waitFor(async () => assert.equal((await current()).blocks.length, 1)); const id = (await current()).id;
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('3.75 or 375'), { target: { value: '3.83' } }); });
    await click('Save Shot'); await waitFor(async () => assert.equal((await current()).shots.length, 1));
    await click('Complete Session'); await screen.findByRole('heading', { name: 'Complete Session' }); await click('Complete');
    await screen.findByText('Training saved.'); assert.equal((await history()).find(item => item.id === id).shots.at(-1).releaseTime, 3.83);
    await act(async () => { rendered.unmount(); }); assert.deepEqual(await owner.close(), { ok: true });
    return { coldOpen: true, sessionId: id, forbiddenBrowserAccesses: environment.forbidden.length };
  } catch (error) {
    error.message = '[IMPORT UI ' + step + ';phase=' + owner.getSnapshot().phase + ';calls=' + requests.join(',') + '] ' + error.message; throw error;
  } finally { await act(async () => { cleanup(); await owner.close(); }); environment.check(); }
}
