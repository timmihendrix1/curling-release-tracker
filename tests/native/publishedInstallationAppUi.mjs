// Real existing App tree, genuine published runtime, synthetic closed browser edges.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
export function setupPublishedUiEnvironment(load) {
  const { JSDOM } = load('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.example.invalid/', pretendToBeVisual: true });
  const win = dom.window, cache = new Map(), accesses = [], forbidden = [], cacheStats = { fetches: 0, writes: 0, hits: 0, domBlobs: 0 };
  let sdkImport = false, sdkImported = false, sdkProbes = 0;
  const check = key => { if (typeof key !== 'string' || !key.startsWith('curling-performance-public-exercise-diagram-v1.')) { forbidden.push(String(key) + '\n' + new Error('Synthetic storage origin').stack); throw Error('Forbidden synthetic browser storage'); } accesses.push(key); };
  const storageMethods = {
    getItem(key) { check(key); if (cache.has(key)) cacheStats.hits++; return cache.get(key) ?? null; }, setItem(key, value) { if (sdkImport && sdkProbes === 0 && typeof key === 'string' && key === value && /^lswt-0\.\d+0\.\d+$/.test(key)) { sdkProbes++; throw Error('Synthetic browser capability unavailable'); } check(key); cacheStats.writes++; cache.set(key, String(value)); }, removeItem(key) { check(key); cache.delete(key); },
    key() { forbidden.push('enumeration'); throw Error('Forbidden storage enumeration'); }, clear() { forbidden.push('clear'); throw Error('Forbidden storage clear'); },
    get length() { forbidden.push('length'); throw Error('Forbidden storage enumeration'); },
  };
  const storage = new Proxy(storageMethods, {
    get(target, key) { if (['getItem', 'setItem', 'removeItem', 'key', 'clear', 'length'].includes(key)) return Reflect.get(target, key); forbidden.push('property-read'); throw Error('Forbidden storage property'); },
    ownKeys() { forbidden.push('enumeration'); throw Error('Forbidden storage enumeration'); },
    set() { forbidden.push('property-write'); throw Error('Forbidden storage property'); },
    deleteProperty() { forbidden.push('property-delete'); throw Error('Forbidden storage property'); },
    defineProperty() { forbidden.push('property-define'); throw Error('Forbidden storage property'); },
  });
  for (const target of [globalThis, win]) Object.defineProperty(target, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(win.navigator, 'onLine', { configurable: true, value: false });
  for (const [key, value] of Object.entries({ window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, File: win.File, Blob: win.Blob, FileReader: win.FileReader, MutationObserver: win.MutationObserver, getComputedStyle: win.getComputedStyle.bind(win), requestAnimationFrame: win.requestAnimationFrame.bind(win), cancelAnimationFrame: win.cancelAnimationFrame.bind(win) })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  Object.defineProperty(win, 'crypto', { configurable: true, value: globalThis.crypto });
  win.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, width: 640, height: 320, top: 0, right: 640, bottom: 320, left: 0, toJSON() { return {}; } }; };
  class ResizeObserver { constructor(callback) { this.callback = callback; } observe(target) { this.callback([{ target, contentRect: target.getBoundingClientRect() }]); } disconnect() {} unobserve() {} }
  globalThis.ResizeObserver = ResizeObserver; win.ResizeObserver = ResizeObserver;
  // Recharts emits this exact initial unmeasured-layout warning before its real
  // measurement effect. JSDOM has synthetic geometry; this is not visual QA.
  const initialChartWarning = 'The width(-1) and height(-1) of chart should be greater than 0,\n       please check the style of container, or the props width(100%) and height(100%),\n       or add a minWidth(0) or minHeight(undefined) or use aspect(undefined) to control the\n       height and width.';
  const reportWarning = console.warn; let initialChartWarnings = 0;
  console.warn = (...args) => { if (args.length === 1 && args[0] === initialChartWarning) { initialChartWarnings++; return; } Reflect.apply(reportWarning, console, args); };

  const unexpectedNative = [];
  const webkit = { messageHandlers: { bridge: { postMessage() { unexpectedNative.push('unexpected-plugin'); throw Error('Unexpected synthetic native plugin'); } } } };
  globalThis.webkit = webkit; win.webkit = webkit;
  const lifecycleListeners = new Map(); let nextListener = 0;
  const native = {
    PluginHeaders: [{ name: 'App', methods: [{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }] }],
    nativeCallback(plugin, method, options, callback) { if (plugin === 'App' && method === 'addListener' && options?.eventName === 'appStateChange' && typeof callback === 'function') { const id = String(++nextListener); lifecycleListeners.set(id, callback); return id; } unexpectedNative.push('unexpected-callback'); throw Error('Unexpected synthetic native callback'); },
    nativePromise(plugin, method, options) { if (plugin === 'App' && method === 'removeListener' && options?.eventName === 'appStateChange' && lifecycleListeners.delete(options.callbackId)) return Promise.resolve(); unexpectedNative.push('unexpected-promise'); return Promise.reject(Error('Unexpected synthetic native method')); },
  };
  globalThis.Capacitor = native; win.Capacitor = native;

  const unexpectedNetwork = [];
  const fetch = async input => {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url === 'string' && /^\/exercise-diagrams\/[A-Za-z0-9_.-]+\.png$/.test(url)) {
      const bytes = fs.readFileSync(path.join(process.cwd(), 'public', url));
      cacheStats.fetches++;
      const response = new Response(bytes, { headers: { 'content-type': 'image/png' } });
      // Match the actual browser Blob/FileReader realm at this synthetic fetch
      // edge; SDK JSON transport keeps its actual Node Response separately.
      response.blob = async () => { cacheStats.domBlobs++; return new win.Blob([bytes], { type: 'image/png' }); };
      return response;
    }
    unexpectedNetwork.push('unexpected-target'); throw Error('Unexpected synthetic UI network target');
  };
  globalThis.fetch = fetch; win.fetch = fetch;
  Module._extensions['.tsx'] = Module._extensions['.ts'];
  return { dom, accesses, forbidden, unexpectedNetwork,
    async verifyPublicCache() {
      assert.equal(cache.size, 0);
      const assets = load(path.join(process.cwd(), 'src/lib/exercises/exerciseAssets.ts'));
      const catalog = load(path.join(process.cwd(), 'src/lib/exercises/restrictedAssetCatalog.ts'));
      const assetId = catalog.CURRENT_PUBLIC_EXERCISE_ASSET_IDS[0], key = 'curling-performance-public-exercise-diagram-v1.' + assetId;
      assert.equal(storage.getItem(key), null);
      const reference = { assetId }, distribution = { scope: 'public', permittedAudience: 'All application users.', publicDeliveryPermitted: true };
      const cold = await assets.createPublicExerciseAssetResolver().resolveExerciseAsset(reference, distribution);
      assert.ok(cold?.src.startsWith('data:image/png;base64,')); assert.equal(storage.getItem(key), cold.src);
      assert.equal(cacheStats.fetches, 1); assert.equal(cacheStats.writes, 1); assert.equal(cacheStats.domBlobs, 1);
      const hits = cacheStats.hits;
      const warm = await assets.createPublicExerciseAssetResolver().resolveExerciseAsset(reference, distribution);
      assert.deepEqual(warm, cold); assert.equal(cacheStats.fetches, 1); assert.equal(cacheStats.writes, 1); assert.equal(cacheStats.hits, hits + 1);
      return { miss: true, write: true, hit: true, warmFetches: 0, domBlob: true };
    }, get initialChartWarnings() { return initialChartWarnings; }, checkUnmounted() { assert.equal(lifecycleListeners.size, 0); }, importSdk() { assert.equal(sdkImported, false); sdkImport = true; try { return load('@supabase/supabase-js'); } finally { sdkImport = false; sdkImported = true; } }, check() { assert.deepEqual(forbidden, []); assert.deepEqual(unexpectedNetwork, []); assert.deepEqual(unexpectedNative, []); assert.equal(win.localStorage, globalThis.localStorage); assert.equal(sdkProbes, 1); }, close() { console.warn = reportWarning; dom.window.close(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; } };
}
export async function runPublishedAppUi({ load, runtime, host, data, profile, requests, environment, failCredential, failDomain, hydration }) {
  const React = load('react'), ui = load('@testing-library/react');
  const { act, fireEvent, render, screen, waitFor, cleanup } = ui;
  const { DormantNativeTrackerComposition } = load(path.join(process.cwd(), 'src/components/persistence/DormantNativeTrackerComposition.tsx'));
  const tree = React.createElement(DormantNativeTrackerComposition, { runtime });
  const progress = []; let phase = 'mount'; const unobserve = runtime.subscribeToProgress(value => { progress.push(value); });
  const rendered = render(data.uiStrict ? React.createElement(React.StrictMode, null, tree) : tree);
  const click = async (role, name) => { await act(async () => { fireEvent.click(screen.getAllByRole(role, { name })[0]); }); };
  const scope = () => { const actual = runtime.createLocalSportingScope(profile); assert.ok(actual); return actual; };
  const current = async () => { const result = await scope().repositories.session.loadCurrent(); assert.equal(result.status, 'value'); return result.value; };
  try {
    if (data.uiCloseDuringHydration) {
      await hydration.entered; const before = hydration.closes(); let done = false, receipt;
      await act(async () => {
        const closing = host.dispose(); void closing.then(() => { done = true; });
        await new Promise(resolve => setImmediate(resolve)); assert.equal(done, false); assert.equal(hydration.closes(), before);
        rendered.unmount(); hydration.release(); receipt = await closing;
      });
      assert.deepEqual(receipt, { ok: false, reason: 'evidence_held' }); assert.equal(screen.queryByTestId('house-home'), null); environment.check();
      return { heldHydrationClosed: true, forbiddenBrowserAccesses: environment.forbidden.length };
    }
    if (data.uiFreshOtp || data.uiPendingFlow || data.uiGuardFlow) {
      await screen.findByLabelText('Email address'); assert.equal(screen.queryByTestId('house-home'), null); assert.equal(screen.queryByRole('button', { name: 'Continue with Google' }), null);
      await act(async () => { fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'synthetic@example.invalid' } }); });
      phase = 'first-request'; await click('button', 'Send sign-in code'); await screen.findByLabelText('6-digit code');
      await act(async () => { fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } }); });
      await click('button', 'Verify code');
      if (data.uiGuardFlow) {
        await screen.findByRole('button', { name: 'Try again' });
        if (!data.uiGuardLowControl) await waitFor(() => assert.ok(requests.includes('abort_my_uncommitted_account_deletion')));
        assert.equal(screen.queryByTestId('house-home'), null); assert.equal(runtime.createLocalSportingScope(profile), null);
        // Await a genuine current Account-service completion as the recovery
        // prerequisite; request observation alone is not completed guard I/O.
        if (data.uiGuardLowControl) assert.deepEqual(await runtime.accountDeletion.getState(), { ok: false, error: 'unavailable' });
        else await waitFor(async () => { const recoveredControl = await runtime.accountDeletion.getState(); assert.equal(recoveredControl.ok, true); assert.equal(recoveredControl.value, null); }, { timeout: 10000 });
        assert.equal(runtime.createLocalSportingScope(profile), null);
        await click('button', 'Try again');
        if (data.uiGuardLowControl) {
          await screen.findByRole('button', { name: 'Try again' });
          assert.equal(screen.queryByTestId('house-home'), null); assert.equal(runtime.createLocalSportingScope(profile), null);
          assert.equal(requests.filter(name => name === 'verify').length, 1); assert.equal(requests.includes('abort_my_uncommitted_account_deletion'), false);
          await act(async () => { rendered.unmount(); }); environment.check();
          return { unresolvedGuardRefused: true, guardRetryRefused: true, forbiddenBrowserAccesses: environment.forbidden.length };
        }
        await screen.findByTestId('house-home', {}, { timeout: 10000 });
        await screen.findByText('Other Profile private training'); assert.ok(runtime.createLocalSportingScope(profile));
        assert.equal(requests.filter(name => name === 'verify').length, 1);
        await act(async () => { rendered.unmount(); }); environment.check();
        return { guardedRetryRecovered: true, verifyCount: 1, forbiddenBrowserAccesses: environment.forbidden.length };
      }
      if (data.uiPendingFlow) {
        await screen.findByRole('heading', { name: 'Account deletion requested' }); assert.equal(screen.queryByTestId('house-home'), null);
        await click('button', 'Keep my account');
      }
    }
    await screen.findByTestId('house-home', {}, { timeout: 10000 });
    environment.check();
    if (data.uiDomainFault) {
      const old = scope(), before = await old.repositories.session.loadCurrent(); assert.equal(before.status, 'value');
      failDomain(); assert.equal((await old.repositories.session.loadCurrent()).status, 'read_failed');
      await waitFor(() => assert.equal(runtime.createLocalSportingScope(profile), null));
      await screen.findByRole('heading', { name: 'Training changes are paused' });
      assert.equal((await old.repositories.session.saveCurrent(before.value)).ok, false);
      await act(async () => { rendered.unmount(); }); environment.check();
      return { domainRefused: true, forbiddenBrowserAccesses: environment.forbidden.length };
    }
    await screen.findByText('Imported published history');
    for (const tab of ['Train', 'Analyze', 'Settings', 'Home']) await click('button', tab);
    assert.equal(screen.queryByText('Other Profile private training'), null);
    if (data.uiExpectedHistoryShot) {
      const history = await scope().repositories.session.loadHistory(); assert.equal(history.status, 'value');
      assert.ok(history.value.some(session => session.shots.some(shot => shot.releaseTime === data.uiExpectedHistoryShot)));
    }
    if (data.uiReadOnly) {
      const history = await scope().repositories.session.loadHistory(); assert.equal(history.status, 'value');
      assert.equal(history.value.filter(item => item.id === data.uiExpectedSavedId).length, 1);
      assert.equal(history.value.find(item => item.id === data.uiExpectedSavedId).shots.at(-1).releaseTime, 3.83);
      assert.equal(history.value.some(item => item.title === 'Other Profile private training'), false);
      assert.equal((await current()).id, data.uiExpectedNextCurrentId);
      await act(async () => { rendered.unmount(); });
      return { sessionId: data.uiExpectedSavedId, forbiddenBrowserAccesses: environment.forbidden.length };
    }
    if (data.uiResumeImported) {
      await screen.findByText('Imported current timing'); await click('button', 'Resume training');
    } else {
    await click('button', 'Start Training'); await screen.findByRole('heading', { level: 2, name: 'Exercises' });
    await click('tab', 'Training Plans'); await screen.findByText('Imported published plan');
    assert.equal(screen.queryByText('Other Profile private plan'), null);
    await click('tab', 'Exercises');
    await click('button', /^Technique/); await click('button', 'View Details: Release Time'); await click('button', 'Continue to Timing Setup');
    await screen.findByText('Ready to train.'); await click('button', 'Start Training'); await screen.findByText('Current exercise');
    }
    await screen.findByText('Current exercise');
    await waitFor(async () => assert.equal((await current()).blocks.length, 1));
    const sessionId = (await current()).id; if (data.uiExpectedCurrentId) assert.equal(sessionId, data.uiExpectedCurrentId);
    const initialShots = (await current()).shots.length;
    await act(async () => { fireEvent.change(screen.getByPlaceholderText('3.75 or 375'), { target: { value: '3.83' } }); });
    await click('button', 'Save Shot'); await waitFor(async () => assert.equal((await current()).shots.length, initialShots + 1));
    assert.equal((await current()).shots.at(-1).releaseTime, 3.83);
    if (data.uiCredentialFault) {
      await act(async () => { failCredential(); await runtime.coordinator.revalidateGateFacts(); });
      await screen.findByRole('heading', { name: 'Sign-in storage is unavailable' });
      assert.equal(host.health().runtime.credential, 'failed');
      await click('button', 'New Training Block'); await screen.findByRole('button', { name: 'Start Block' }); await click('button', 'Start Block');
      await screen.findByText('Current exercise');
      await act(async () => { fireEvent.change(screen.getByPlaceholderText('3.75 or 375'), { target: { value: '3.84' } }); });
      await click('button', 'Save Shot');
      // Existing scope is retired on Q1; inspect continuation via actual tracked
      // UI results and terminal durable history after its final acknowledgement.
      assert.equal(runtime.createLocalSportingScope(profile), null);
    }
    await click('button', 'Complete Session'); await screen.findByRole('heading', { name: 'Complete Session' }); await click('button', 'Complete');
    if (data.uiCredentialFault) await screen.findByRole('heading', { name: 'Training saved on this device' });
    else { await screen.findByText('Training saved.'); await click('button', 'Home'); await screen.findByTestId('house-home'); const history = await scope().repositories.session.loadHistory(); assert.equal(history.status, 'value'); assert.equal(history.value.filter(item => item.id === sessionId).length, 1); assert.equal(history.value.find(item => item.id === sessionId).shots.at(-1).releaseTime, 3.83); }
    environment.check();
    assert.ok(environment.accesses.length > 0);
    const result = { sessionId, nextCurrentId: data.uiCredentialFault ? sessionId : (await current()).id, initialChartWarnings: environment.initialChartWarnings, publicCacheAccesses: environment.accesses.length, forbiddenBrowserAccesses: environment.forbidden.length };
    await act(async () => { rendered.unmount(); });
    return result;
  } catch (error) { error.message = '[UI '+phase+';calls='+requests.join(',')+';progress='+progress.join(',')+'] '+error.message; throw error; } finally { unobserve(); await act(async () => { cleanup(); }); environment.check(); }
}
