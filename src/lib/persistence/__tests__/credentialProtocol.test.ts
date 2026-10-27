import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { correlatePair, parseF, parseI, parseM, parseQ, projectCredentialIssue, serializeF, serializeI, serializeM, serializeQ, transitionQ, validateFrozenCopy } from "../credentialProtocol";
import { fixedCredentialSlots, parseBoundedJson, unwrap } from "../../supabase/providerCredentialContract";
import { reduceCredentialFault } from "../../identity/credentialFaultPolicy";
const root = "sb-fixture-auth-token";
const id = "00000001-1111-4111-8111-111111111111", foreign = "00000002-1111-4111-8111-111111111111";
const header = { schemaVersion: 1, protocolId: id, credentialEpochId: id, manifestId: id, providerConfigIdentity: "pc1:fixture", sdkContractVersion: "auth-js/2.112.3:credential-v1", sessionStorageKey: root };
const q = { ...header, initialEntryKeys: [] as string[], phase: "credentials_verified", verifiedItemIds: [] as string[], expectedStoreIdentity: id };
const fixedSlots = fixedCredentialSlots(root).map(slot => ({ ...slot, presence: "absent" }));
const m = { ...header, expectedStoreIdentity: id, initialEntryKeys: [] as string[], fixedSlots, items: [] as { itemId: string; key: string; fingerprint: string }[] };
const format = (candidate: string) => /^test-only-fingerprint-[0-9]+$/.test(candidate);
const sessionRaw = '{"access_token":"SYNTHETIC_ACCESS","refresh_token":"SYNTHETIC_REFRESH","expires_at":100,"expires_in":0.125,"token_type":"bearer"}';
const userRaw = '{"user":{"id":"opaque-provider","aud":"authenticated","created_at":"synthetic","app_metadata":{},"user_metadata":{}}}';
const rawB = sessionRaw.replace("SYNTHETIC_REFRESH", "SYNTHETIC_OTHER_REFRESH");
function envelope(key = root, value = sessionRaw) { return { schemaVersion: 1, protocolId: id, credentialEpochId: id, originManifestId: id, providerConfigIdentity: "pc1:fixture", sdkContractVersion: header.sdkContractVersion, key, value }; }
function fixture(empty = false) {
  const raws = empty ? [] : [{ key: root, raw: sessionRaw }, { key: root + "-user", raw: userRaw }];
  const keys = raws.map(item => item.key);
  const slots = fixedCredentialSlots(root).map(slot => ({ ...slot, presence: keys.includes(slot.key) ? "present" : "absent" }));
  return {
    q: { ...q, initialEntryKeys: keys, verifiedItemIds: keys.map((_, i) => "c000" + i) },
    m: { ...m, initialEntryKeys: [...keys], fixedSlots: slots, items: raws.map((item, i) => ({ itemId: "c000" + i, key: item.key, fingerprint: "test-only-fingerprint-" + (i * 2) })) },
    sourceSnapshot: { listedKeys: [...keys], reads: fixedCredentialSlots(root).map(slot => ({ key: slot.key, result: keys.includes(slot.key) ? { status: "value", value: raws.find(item => item.key === slot.key)!.raw } : { status: "absent" } })), enumerationComplete: true },
    protectedSnapshot: { items: raws.map((item, i) => ({ itemId: "c000" + i, key: item.key, result: { status: "value", raw: JSON.stringify(envelope(item.key, item.raw)) } })), fixedItemAbsences: slots.filter(slot => slot.presence === "absent").map(({ kind, key }) => ({ kind, key, result: { status: "absent" } })) },
  };
}
// Explicit NON-CRYPTOGRAPHIC tuple-specific provider; no implementation default.
const fingerprint = (purpose: string, key: string, raw: string) => purpose !== "credential-value/v1" ? "test-only-fingerprint-99" : key === root && raw === sessionRaw ? "test-only-fingerprint-0" : key === root && raw === rawB ? "test-only-fingerprint-1" : key === root + "-user" && raw === userRaw ? "test-only-fingerprint-2" : "test-only-fingerprint-99";
const run = (f = fixture(), compute: unknown = fingerprint, predicate: unknown = format) => validateFrozenCopy(f.q, f.m, f.sourceSnapshot, f.protectedSnapshot, compute, predicate);

describe("review regressions: shared containment and staged protocol admission", () => {
  it("contains captured refusal mutation/getter/replay in serializer, reducer and async copy", async () => {
    for (const mode of ["mutate", "getter", "proxy"]) {
      let captured: unknown; try { parseBoundedJson("{"); } catch (error) { captured = error; }
      try {
        if (mode === "mutate") Object.assign(captured as object, { code: "PRIVATE", field: "PRIVATE" });
        if (mode === "getter") Object.defineProperty(captured, "code", { get() { throw "PRIVATE"; } });
      } catch { /* refusing mutation of immutable signal is permitted */ }
      if (mode === "proxy") captured = new Proxy({}, { get() { throw "PRIVATE"; }, getPrototypeOf() { throw "PRIVATE"; } });
      const hostile = new Proxy({}, { ownKeys() { throw captured; } });
      expect(serializeQ(hostile)).toEqual({ ok: false, issue: { code: "hostile_input", field: "input" } });
      expect(reduceCredentialFault(hostile, { kind: "startup_check" })).toEqual({ ok: false, issue: { code: "invalid_input", field: "input" } });
      const f = fixture();
      await expect(validateFrozenCopy(hostile, f.m, f.sourceSnapshot, f.protectedSnapshot, fingerprint, format)).resolves.toEqual({ ok: false, issue: { code: "hostile_input", field: "input" } });
    }
  });
  it("selects declaration-order field types and inventory budgets before identifiers", () => {
    expect(parseQ(JSON.stringify({ ...q, initialEntryKeys: [17], expectedStoreIdentity: 17 }))).toEqual({ ok: false, issue: { code: "invalid_shape", field: "inventory" } });
    const f = fixture(); Object.assign(f.m, { protocolId: "invalid" }); Object.assign(f.m.fixedSlots[0], { presence: 17 });
    expect(parseM(JSON.stringify(f.m), format)).toEqual({ ok: false, issue: { code: "invalid_shape", field: "inventory" } });
    expect(parseQ(JSON.stringify({ ...q, protocolId: "invalid", initialEntryKeys: ["k".repeat(193)] }))).toEqual({ ok: false, issue: { code: "limit_exceeded", field: "inventory" } });
    expect(serializeQ({ ...q, protocolId: "invalid", initialEntryKeys: ["k".repeat(193)] })).toEqual({ ok: false, issue: { code: "limit_exceeded", field: "inventory" } });
    expect(correlatePair(f.q, f.m, { kind: "preactive", expected: id })).toEqual({ ok: false, issue: { code: "invalid_shape", field: "inventory" } });
  });
  it("stages all nested exact fields before types, and Q inventory grammar before binding grammar", () => {
    const input = { ...q, phase: "copying", initialEntryKeys: [root + "-unsupported"], verifiedItemIds: [], expectedStoreIdentity: "invalid" };
    expect(parseQ(JSON.stringify(input))).toEqual({ ok: false, issue: { code: "invalid_key", field: "inventory" } });
    const f = fixture();
    const manifest = { ...f.m, protocolId: 17, items: f.m.items.map((item, i) => i ? item : { ...item, extra: true }) };
    expect(parseM(JSON.stringify(manifest), format)).toEqual({ ok: false, issue: { code: "unknown_field", field: "inventory" } });
    expect(serializeM(manifest, format)).toEqual({ ok: false, issue: { code: "unknown_field", field: "inventory" } });
  });
  it.each(["true", "false", "throw"])("rejects canonical over-budget M before any format call (%s)", mode => {
    const largeRoot = "sb-" + "a".repeat(63) + "-auth-token";
    const keys = [...fixedCredentialSlots(largeRoot).map(s => s.key), ...Array.from({ length: 1020 }, (_, i) => largeRoot + "-flow-" + "f" + i.toString(16).padStart(63, "0") + "-code-verifier")].sort();
    const input = { ...m, sessionStorageKey: largeRoot, initialEntryKeys: keys, fixedSlots: fixedCredentialSlots(largeRoot).map(s => ({ ...s, presence: "present" })), items: keys.map((key, i) => ({ itemId: "c" + i.toString(16).padStart(4, "0"), key, fingerprint: "\u0000".repeat(128) })) };
    expect(JSON.stringify(input).length).toBe(1165752);
    const predicate = vi.fn(() => { if (mode === "throw") throw "PRIVATE"; return mode === "true"; });
    expect(serializeM(input, predicate)).toEqual({ ok: false, issue: { code: "limit_exceeded", field: "input" } });
    expect(predicate).not.toHaveBeenCalled();
  });
  it.each(["parse", "serialize", "frozen-initial", "frozen-computed"].flatMap(mode => ["ordinary", "noncallable", "getter"].map(returnedThen => ({ mode, returnedThen }))))("owns invalid async format results in isolated strict Node ($mode/$returnedThen)", ({ mode, returnedThen }) => {
    const f = fixture();
    const script = `
      const fs=require('node:fs'), assert=require('node:assert/strict'), ts=require('typescript');
      require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,p);
      const originalPromise=Promise, originalThen=Promise.prototype.then, originalResolve=Promise.resolve, originalReject=Promise.reject;
      const eventNames=['unhandledRejection','rejectionHandled','uncaughtException'];
      const originalListeners=eventNames.map(name=>process.listeners(name));
      assert(originalListeners.every(list=>list.length===0));
      const P=require(process.cwd()+'/src/lib/persistence/credentialProtocol.ts');
      const f=${JSON.stringify(f)}, mode=${JSON.stringify(mode)}, returnedThen=${JSON.stringify(returnedThen)};
      (async()=>{
        const hostile=new Proxy({}, {get(){throw 'PRIVATE_REASON';}});
        let ownThenReads=0, returnedPromise, originalOwnThen;
        const maskedPromise=()=>{
          returnedPromise=Promise.reject('SYNTHETIC_RETURNED_PROMISE_REASON');
          Object.defineProperty(returnedPromise,'then',returnedThen==='getter'?{get(){ownThenReads++;throw 'SYNTHETIC_THEN_GETTER';}}:{value:undefined});
          originalOwnThen=Object.getOwnPropertyDescriptor(returnedPromise,'then');
          return returnedPromise;
        };
        const returns=returnedThen==='ordinary'?[()=>Promise.reject('PRIVATE_REASON'),async()=>{throw 'PRIVATE_REASON';},()=>Promise.reject(hostile),()=>({then(_ok,fail){fail(hostile);}}),()=>({get then(){throw hostile;}}),()=>Promise.resolve(true),()=>new Promise(()=>{}),()=>false,()=>{throw hostile;},()=>true]:[maskedPromise];
        for(let n=0;n<returns.length;n++){
          let calls=0;
          const pred=()=>mode==='frozen-computed' && ++calls<=f.m.items.length ? true : returns[n]();
          const compute=(_purpose,key)=>key===f.m.items[0].key?f.m.items[0].fingerprint:f.m.items[1].fingerprint;
          const result=mode==='parse'?P.parseM(JSON.stringify(f.m),pred):mode==='serialize'?P.serializeM(f.m,pred):await P.validateFrozenCopy(f.q,f.m,f.sourceSnapshot,f.protectedSnapshot,compute,pred);
          assert.equal(result.ok,returnedThen==='ordinary' && n===returns.length-1);
          if(!result.ok)assert.deepEqual(result.issue,{code:'fingerprint_invalid',field:'evidence'});
          if(returnedThen!=='ordinary')console.log('immediate-fixed-refusal');
          await new Promise(resolve=>setImmediate(resolve));
          assert.equal(Promise,originalPromise);assert.equal(Promise.prototype.then,originalThen);
          assert.equal(Promise.resolve,originalResolve);assert.equal(Promise.reject,originalReject);
          assert.deepEqual(eventNames.map(name=>process.listeners(name)),originalListeners);
          if(returnedThen!=='ordinary'){
            assert.equal(ownThenReads,0);
            assert.deepEqual(Object.getOwnPropertyDescriptor(returnedPromise,'then'),originalOwnThen);
          }
        }
        console.log('strict-format-cases='+returns.length);
      })().catch(()=>{process.exitCode=2;});
    `;
    const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "-e", script], { encoding: "utf8", timeout: 40_000 });
    expect(child.error).toBeUndefined(); expect(child.status, JSON.stringify({ stdout: child.stdout, stderr: child.stderr })).toBe(0); expect(child.stderr).toBe("");
    expect(child.stdout).toBe(returnedThen === "ordinary" ? "strict-format-cases=10\n" : "immediate-fixed-refusal\nstrict-format-cases=1\n");
  }, 60_000);
});

describe("logical Q/M/I/F protocol", () => {
  it.each(["intent", "manifest_confirmed", "copying", "credentials_verified", "bound"])("enforces %s matrix with empty and nonempty C", phase => {
    for (const keys of [[], [root]]) {
      const complete = phase === "bound" || phase === "credentials_verified";
      const input: Record<string, unknown> = { ...q, phase, initialEntryKeys: keys, verifiedItemIds: complete ? keys.map(() => "c0000") : [] };
      if (phase === "bound") { delete input.expectedStoreIdentity; input.storeIdentity = id; }
      const parsed = unwrap(parseQ(JSON.stringify(input)));
      expect(parsed).toEqual(input); expect(Object.isFrozen(parsed.initialEntryKeys)).toBe(true); expect("ready" in parsed).toBe(false);
    }
  });
  it.each([
    { phase: "credentials_verified", initialEntryKeys: [root], verifiedItemIds: [] },
    { initialEntryKeys: [root], phase: "copying", verifiedItemIds: ["c0001"] },
    { initialEntryKeys: [root], phase: "copying", verifiedItemIds: ["c0000", "c0000"] },
    { initialEntryKeys: [root], phase: "intent", verifiedItemIds: ["c0000"] },
    { storeIdentity: id }, { expectedStoreIdentity: null }, { phase: "bound" }, { inventedGrant: true },
    { schemaVersion: 2 }, { schemaVersion: "1" }, { credentialEpochId: "NOT_UUID" },
    { protocolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase() }, { providerConfigIdentity: "pc1:UPPER" }, { sdkContractVersion: "auth-js/other" },
    { sessionStorageKey: root + ".extra" }, { initialEntryKeys: [root + "-user", root] }, { initialEntryKeys: [root, root] }, { initialEntryKeys: [root + "-unknown"] },
  ])("refuses closed matrix violation %j", patch => { expect(parseQ(JSON.stringify({ ...q, ...patch })).ok).toBe(false); });
  it("refuses missing binding, lexical duplicates, unsafe input types, and prioritizes version", () => {
    const input: Record<string, unknown> = { ...q }; delete input.expectedStoreIdentity;
    expect(parseQ(JSON.stringify(input)).ok).toBe(false);
    expect(parseQ('{"schemaVersion":1,"schema\\u0056ersion":1}')).toMatchObject({ ok: false, issue: { code: "duplicate_member" } });
    for (const raw of [q, null, [], new String("{}")]) expect(parseQ(raw)).toEqual({ ok: false, issue: { code: "invalid_input", field: "input" } });
    expect(parseQ('{"schemaVersion":2,"extra":true}')).toMatchObject({ ok: false, issue: { code: "unsupported_version" } });
  });
  it("prioritizes field types before identifiers and rejects structural fingerprint errors uniformly", () => {
    expect(parseQ(JSON.stringify({ ...q, protocolId: "invalid", verifiedItemIds: [17] }))).toMatchObject({ ok: false, issue: { code: "invalid_shape", field: "cursor" } });
    for (const fingerprint of [null, true, 17, "", "x".repeat(129)]) {
      const f = fixture(); Object.assign(f.m.items[0], { fingerprint });
      expect(parseM(JSON.stringify(f.m), format)).toMatchObject({ ok: false, issue: { code: "fingerprint_invalid", field: "evidence" } });
    }
  });
  it("requires every sequential transition, including empty C, no implicit retry", () => {
    for (const keys of [[], [root, root + "-user"]]) {
      let current = unwrap(parseQ(JSON.stringify({ ...q, phase: "intent", initialEntryKeys: keys, verifiedItemIds: [] })));
      expect(transitionQ(current, { kind: "verify_all" }).ok).toBe(false);
      current = unwrap(transitionQ(current, { kind: "confirm_manifest" }));
      expect(transitionQ(current, { kind: "confirm_manifest" }).ok).toBe(false);
      current = unwrap(transitionQ(current, { kind: "begin_copying" }));
      if (keys.length) expect(transitionQ(current, { kind: "verify_all" }).ok).toBe(false);
      for (let i = 0; i < keys.length; i++) {
        expect(transitionQ(current, { kind: "confirm_next_item", itemId: "c03ff" }).ok).toBe(false);
        current = unwrap(transitionQ(current, { kind: "confirm_next_item", itemId: "c000" + i }));
        expect(transitionQ(current, { kind: "confirm_next_item", itemId: "c000" + i }).ok).toBe(false);
      }
      current = unwrap(transitionQ(current, { kind: "verify_all" }));
      expect(transitionQ(current, { kind: "bind", storeIdentity: foreign }).ok).toBe(false);
      const bound = unwrap(transitionQ(current, { kind: "bind", storeIdentity: id }));
      expect(bound.storeIdentity).toBe(id); expect(Object.hasOwn(bound, "expectedStoreIdentity")).toBe(false);
      expect(bound.initialEntryKeys).toEqual(keys); expect(transitionQ(bound, { kind: "bind", storeIdentity: id }).ok).toBe(false);
      expect(transitionQ(bound, { kind: "verify_all", extra: true }).ok).toBe(false);
    }
  });
  it("requires exact M fixed absence and ordered full membership, not just counts", () => {
    const f = fixture(); expect(parseM(JSON.stringify(f.m), format).ok).toBe(true);
    const mutations: ((input: ReturnType<typeof fixture>["m"]) => void)[] = [x => { x.fixedSlots.pop(); }, x => { x.fixedSlots[0].presence = "absent"; }, x => { x.items.pop(); }, x => { x.items[0].key = root + "-unknown"; }, x => { x.items[1].itemId = "c0000"; }, x => { x.initialEntryKeys.reverse(); }, x => { x.items[0].fingerprint = "not-test-format"; }];
    for (const mutate of mutations) { const input = fixture().m; mutate(input); expect(parseM(JSON.stringify(input), format).ok).toBe(false); }
    expect(unwrap(parseM(JSON.stringify(m), format)).fixedSlots).toHaveLength(4);
    for (const predicate of [undefined, null, true]) expect(parseM(JSON.stringify(m), predicate)).toMatchObject({ ok: false, issue: { code: "evidence_unavailable" } });
    for (const predicate of [() => false, () => "true", () => Promise.resolve(true), () => { throw "PRIVATE"; }]) expect(parseM(JSON.stringify(f.m), predicate)).toMatchObject({ ok: false, issue: { code: "fingerprint_invalid" } });
  });
  it("correlates exact ordered Q/M/D roles, never an active Boolean", () => {
    const f = fixture(); expect(correlatePair(f.q, f.m, { kind: "preactive", expected: id }).ok).toBe(true);
    const bound = { ...f.q, phase: "bound", expectedStoreIdentity: undefined, storeIdentity: id }; delete bound.expectedStoreIdentity;
    expect(correlatePair(bound, f.m, { kind: "active", storeIdentity: id }).ok).toBe(true);
    for (const d of [true, { kind: "preactive", expected: foreign }, { kind: "active", storeIdentity: id }, { kind: "preactive", expected: id, extra: true }]) expect(correlatePair(f.q, f.m, d).ok).toBe(false);
    for (const field of ["protocolId", "credentialEpochId", "manifestId", "expectedStoreIdentity"]) expect(correlatePair(f.q, { ...f.m, [field]: foreign }, { kind: "preactive", expected: id }).ok).toBe(false);
  });
  it("serializes fresh canonical declaration order, keeps exact I raw, no historical runtime membership", () => {
    const raw = '  "' + "a".repeat(56) + '"  ';
    const item = envelope(root + "-flow-NewFlow01-code-verifier", raw);
    const wire = unwrap(serializeI(item, root)); expect(unwrap(parseI(wire, root, m)).value).toBe(raw);
    for (const field of ["protocolId", "credentialEpochId", "originManifestId"]) expect(parseI(JSON.stringify({ ...item, [field]: foreign }), root, m).ok).toBe(false);
    expect(parseI(JSON.stringify({ ...item, providerConfigIdentity: "pc1:foreign" }), root, m).ok).toBe(false);
    expect(parseI(raw, root).ok).toBe(false); expect(parseI(JSON.stringify({ ...item, value: "" }), root).ok).toBe(false);
    expect(parseI(JSON.stringify({ ...item, itemId: "c0000" }), root).ok).toBe(false);
    const shuffled = Object.fromEntries(Object.entries(q).reverse());
    expect(unwrap(serializeQ(shuffled))).toBe(JSON.stringify(q));
    expect(Object.keys(JSON.parse(unwrap(serializeM(m, format))))).toEqual([...Object.keys(header), "expectedStoreIdentity", "initialEntryKeys", "fixedSlots", "items"]);
  });
  it.each(["pairing_mismatch", "namespace_unproven", "source_changed", "protected_evidence_lost", "sql_evidence_mismatch", "invalid_metadata", "boundary_failure"])("accepts F code %s without diagnostics", code => {
    for (const phase of ["preflight", "intent", "manifest_confirmed", "copying", "credentials_verified", "bound", "finalizing", "handoff"]) for (const operation of ["read", "enumerate", "write_manifest", "write_item", "write_q", "finalize", "reopen", "release"]) {
      const fault = { schemaVersion: 1, code, phase, operation };
      expect(unwrap(serializeF(fault))).toBe(JSON.stringify(fault)); expect(parseF(JSON.stringify(fault)).ok).toBe(true);
    }
  });
  it("projects only fixed issues and bounds Q/M/I/F before parsing", () => {
    const fault = { schemaVersion: 1, code: "boundary_failure", phase: "preflight", operation: "read" };
    expect(parseF(JSON.stringify({ ...fault, detail: "PRIVATE" }))).toEqual({ ok: false, issue: { code: "unknown_field", field: "fault" } });
    expect(projectCredentialIssue({ code: "identity_mismatch", field: "binding" })).toEqual({ code: "identity_mismatch", field: "binding" });
    expect(projectCredentialIssue({ code: "PRIVATE", field: "PRIVATE", extra: "PRIVATE" })).toEqual({ code: "invalid_input", field: "input" });
    for (const [parser, raw, max] of [[parseQ, JSON.stringify(q), 1_048_576], [(raw: unknown) => parseM(raw, format), JSON.stringify(m), 1_048_576], [parseI, JSON.stringify(envelope()), 6_300_000], [parseF, JSON.stringify(fault), 512]] as const) {
      expect(parser(raw + " ".repeat(max - raw.length)).ok).toBe(true);
      expect(parser(raw + " ".repeat(max - raw.length + 1))).toMatchObject({ ok: false, issue: { code: "limit_exceeded" } });
    }
  });
});

describe("actual frozen-copy correlation and owned asynchronous evidence", () => {
  it("verifies every fixed absence even for empty C without computing digests", async () => {
    const compute = vi.fn(fingerprint); const result = await run(fixture(true), compute);
    expect(result).toMatchObject({ ok: true }); expect(compute).not.toHaveBeenCalled();
    const incomplete = fixture(true); incomplete.protectedSnapshot.fixedItemAbsences.pop(); expect(await run(incomplete)).toMatchObject({ ok: false, issue: { code: "evidence_unavailable", field: "evidence" } });
  });
  it("computes exact source tuples once in manifest order, returns detached frozen data", async () => {
    const f = fixture(), compute = vi.fn(fingerprint); const copy = unwrap(await run(f, compute));
    expect(compute.mock.calls).toEqual([["credential-value/v1", root, sessionRaw], ["credential-value/v1", root + "-user", userRaw]]);
    expect(copy.q === f.q).toBe(false); expect(copy.sourceSnapshot === f.sourceSnapshot).toBe(false);
    expect(Object.isFrozen(copy.m.items[0])).toBe(true); expect("ready" in copy).toBe(false);
  });
  it("rejects Source=I=B under M-hash(A), format-valid wrong and swapped digests", async () => {
    const f = fixture(); f.sourceSnapshot.reads[0].result.value = rawB; f.protectedSnapshot.items[0].result.raw = JSON.stringify(envelope(root, rawB));
    expect(await run(f)).toEqual({ ok: false, issue: { code: "fingerprint_invalid", field: "evidence" } });
    const wrong = fixture(); wrong.m.items[0].fingerprint = "test-only-fingerprint-99"; expect(await run(wrong)).toMatchObject({ ok: false, issue: { code: "fingerprint_invalid" } });
    const swapped = fixture(); [swapped.m.items[0].fingerprint, swapped.m.items[1].fingerprint] = [swapped.m.items[1].fingerprint, swapped.m.items[0].fingerprint]; expect(await run(swapped)).toMatchObject({ ok: false, issue: { code: "fingerprint_invalid" } });
  });
  it("checks headers and exact source/I equality BEFORE any callback", async () => {
    for (const mutate of [(f: ReturnType<typeof fixture>) => { f.protectedSnapshot.items[0].result.raw = JSON.stringify(envelope(root, rawB)); }, (f: ReturnType<typeof fixture>) => { f.protectedSnapshot.items[0].result.raw = JSON.stringify({ ...envelope(), credentialEpochId: foreign }); }, (f: ReturnType<typeof fixture>) => { f.m.protocolId = foreign; }, (f: ReturnType<typeof fixture>) => { f.sourceSnapshot.reads.pop(); }]) {
      const f = fixture(); mutate(f); const compute = vi.fn(fingerprint), predicate = vi.fn(format);
      expect((await run(f, compute, predicate)).ok).toBe(false); expect(compute).not.toHaveBeenCalled(); expect(predicate).not.toHaveBeenCalled();
    }
  });
  it("refuses omissions, extras, duplicates, wrong order, absent/uncertain protected observations", async () => {
    const missing = fixture(); missing.protectedSnapshot.items.shift(); expect(await run(missing)).toMatchObject({ ok: false, issue: { code: "evidence_unavailable" } });
    const duplicate = fixture(); duplicate.protectedSnapshot.items.push(duplicate.protectedSnapshot.items[0]); expect(await run(duplicate)).toMatchObject({ ok: false, issue: { code: "membership_mismatch" } });
    const order = fixture(); order.protectedSnapshot.items.reverse(); expect(await run(order)).toMatchObject({ ok: false, issue: { code: "membership_mismatch" } });
    for (const reason of ["unavailable", "inaccessible", "unreadable", "absence_not_established", "invalid_response"]) {
      const f = fixture(); Object.assign(f.protectedSnapshot.items[0], { result: { status: "read_failed", reason } }); expect(await run(f)).toMatchObject({ ok: false, issue: { code: "evidence_unavailable" } });
    }
    const uncertain = fixture(true); Object.assign(uncertain.protectedSnapshot.fixedItemAbsences[0], { result: { status: "read_failed", reason: "absence_not_established" } }); expect((await run(uncertain)).ok).toBe(false);
  });
  it.each([undefined, null, true])("requires callable dependencies %j, even empty", async dependency => {
    const f = fixture(true);
    expect(await validateFrozenCopy(f.q, f.m, f.sourceSnapshot, f.protectedSnapshot, dependency, format)).toMatchObject({ ok: false, issue: { code: "evidence_unavailable" } });
    expect(await validateFrozenCopy(f.q, f.m, f.sourceSnapshot, f.protectedSnapshot, fingerprint, dependency)).toMatchObject({ ok: false, issue: { code: "evidence_unavailable" } });
  });
  it("contains sync throw, rejection, hostile then getter and revoked callable without inspecting failures", async () => {
    const thrown = new Proxy({}, { get() { throw "MUST_NOT_INSPECT"; }, getPrototypeOf() { throw "MUST_NOT_INSPECT"; } });
    const revoked = Proxy.revocable(() => "test-only-fingerprint-0", {}); revoked.revoke();
    for (const compute of [() => { throw thrown; }, () => Promise.reject(thrown), () => Object.defineProperty({}, "then", { get() { throw thrown; } }), revoked.proxy]) expect(await run(fixture(), compute)).toEqual({ ok: false, issue: { code: "evidence_unavailable", field: "evidence" } });
    expect(await run(fixture(), fingerprint, () => { throw thrown; })).toMatchObject({ ok: false, issue: { code: "fingerprint_invalid" } });
  });
  it.each([null, true, 17, {}, "", "x".repeat(129)])("rejects malformed resolved digest %j", async candidate => { expect(await run(fixture(), () => candidate)).toEqual({ ok: false, issue: { code: "fingerprint_invalid", field: "evidence" } }); });
  it("snapshots all caller data before format callbacks and first await, pending stays pending", async () => {
    const f = fixture(); let settle!: (value: string) => void;
    const deferred = new Promise<string>(resolve => { settle = resolve; });
    let calls = 0, settled = false;
    const pending = run(f, (purpose: string, key: string, raw: string) => ++calls === 1 ? deferred : fingerprint(purpose, key, raw)).then(result => { settled = true; return result; });
    await Promise.resolve(); expect(calls).toBe(1); expect(settled).toBe(false);
    f.q.protocolId = foreign; f.m.items[0].fingerprint = "test-only-fingerprint-99"; f.sourceSnapshot.reads.length = 0; f.protectedSnapshot.items.length = 0;
    await Promise.resolve(); expect(settled).toBe(false);
    settle("test-only-fingerprint-0");
    const copy = unwrap(await pending); expect(copy.q.protocolId).toBe(id); expect(copy.m.items).toHaveLength(2);
    const other = fixture(); const predicate = (candidate: string) => { other.sourceSnapshot.reads.length = 0; other.q.protocolId = foreign; return format(candidate); };
    expect((await run(other, fingerprint, predicate)).ok).toBe(true);
  });
  it("guards ALL object seams with no getter calls and asynchronous refusals", async () => {
    const f = fixture(); let getterCalls = 0;
    Object.defineProperty(f.protectedSnapshot, "items", { get() { getterCalls++; throw "PRIVATE"; } });
    const compute = vi.fn(fingerprint), predicate = vi.fn(format); const promise = run(f, compute, predicate);
    expect(promise).toBeInstanceOf(Promise); expect(await promise).toMatchObject({ ok: false, issue: { code: "hostile_input" } });
    expect(getterCalls).toBe(0); expect(compute).not.toHaveBeenCalled(); expect(predicate).not.toHaveBeenCalled();
    const action = Object.defineProperty({}, "kind", { get() { getterCalls++; return "bind"; }, enumerable: true });
    expect(transitionQ(q, action).ok).toBe(false); expect(getterCalls).toBe(0);
  });
});
