import { afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { evaluateInstallationTransferDomainsV3 } from "../installationTransferSemantics";
import { encodeInstallationTransferV3, decodeInstallationTransferV3 } from "../installationTransferV3";
import { TRANSFER_SPORTING_SUFFIXES, TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY } from "../installationTransferInventory";
import * as scoped from "../profileScopedSportingPersistence";
import * as syncModule from "../../cloudSporting/syncStateRepository";
import { localStorageAdapter } from "../localStorageAdapter";
import { createDefaultHistoryFilters } from "../../historyAnalysis";
import { buildPlan, buildSession } from "../../trainingPlans/__tests__/testHelpers";
import { createTestRun, abandonTestRun } from "../../assessment/__tests__/testHelpers";
import { transitionAssessmentRun } from "../../assessment/run";
import { session, timeBlock } from "../../measurement/__tests__/measurementFixtures";
import { createCaptureSequence, startCaptureSequence } from "../../captureSequence";
import type { RemovableStorageAdapter } from "../types";
import { EXERCISE_CATALOG } from "../../exercises/catalog";
import { EIGHT_GUARDS_VERSION_ID } from "../../exercises/content";
import { findExerciseVersion } from "../../exercises/lookup";
import { createTeamExerciseExecution, addTeamShotmakingAttempt, completeTeamExerciseExecution } from "../../exercises/teamExecution";
import { serializeCompletedTeamExercise, deserializeOwnedTeamExerciseResult } from "../../cloudSporting/teamExerciseRecords";
import { sha256Hex } from "../../cloudSporting/records";

const a = "10000000-0000-4000-8000-000000000001", b = "20000000-0000-4000-8000-000000000002";
const c = "30000000-0000-4000-8000-000000000003";
const key = (index: number, profile = a) => `curling.sporting.profile.v1.${profile}.${TRANSFER_SPORTING_SUFFIXES[index]}`;
const json = (value: unknown) => JSON.stringify(value);
const clone = <T>(value: T): T => JSON.parse(json(value));
const originalFactory = scoped.createProfileScopedSportingRepositories;
const emptySync = () => ({ schemaVersion: 6, entries: [], teamEntries: [], teamEligibilitySnapshots: [], activeTeamExerciseDraft: null, teamExerciseResults: [] });
function engine() { vi.stubGlobal("crypto", webcrypto); }
function snapshot(raws: Record<string, string>) {
  const profiles = [...new Set(Object.keys(raws).filter(k => k.startsWith("curling.sporting.profile.v1.")).map(k => k.slice("curling.sporting.profile.v1.".length, "curling.sporting.profile.v1.".length + 36)))].sort();
  const fixed = [...TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY];
  const dynamic = Object.keys(raws).filter(k => k.startsWith("curling.identity.") && !fixed.includes(k));
  const slots = [...fixed, ...dynamic, ...profiles.flatMap(profile => TRANSFER_SPORTING_SUFFIXES.map((_, i) => key(i, profile)))].sort();
  return { schemaVersion: 3, transferId: "40000000-0000-4000-8000-000000000004", snapshotId: "50000000-0000-4000-8000-000000000005", sourceBuild: { version: "synthetic", build: "test" }, catalogContractId: "synthetic", listing: { schemaVersion: 1, keys: Object.keys(raws).sort() }, observations: slots.map(k => Object.hasOwn(raws, k) ? { key: k, state: "present", raw: raws[k] } : { key: k, state: "absent" }), sourceControl: { domain: "absent", credential: "excluded" }, snapshotState: "synthetic_frozen" };
}
async function wire(raws: Record<string, string> = {}) {
  const result = await encodeInstallationTransferV3(json(snapshot(raws)));
  expect(result.ok).toBe(true); if (!result.ok) throw Error("Synthetic archive refused"); return result.value.wire;
}
async function evaluate(raws: Record<string, string>) {
  const result = await evaluateInstallationTransferDomainsV3(await wire(raws));
  expect(result.ok).toBe(true); if (!result.ok) throw Error("Synthetic evaluation refused"); return result.value;
}
async function domain(index: number, raw: string, name: string) {
  return (await evaluate({ [key(index)]: raw })).profiles[0].domains.find(v => v.domain === name)!;
}
function allRaws(profile = a): Record<string, string> {
  return {
    [key(0, profile)]: json(buildSession({ notes: "synthetic 🥌\ud800" })), [key(1, profile)]: "[]", [key(2, profile)]: json(createDefaultHistoryFilters()),
    [key(3, profile)]: json({ schemaVersion: 1, history: [] }), [key(4, profile)]: json({ schemaVersion: 2, plans: [buildPlan()] }),
    [key(5, profile)]: json({ schemaVersion: 2, profiles: [], defaultProfileId: null }), [key(6, profile)]: json({ schemaVersion: 1, profiles: [], defaultProfileId: null }),
    [key(7, profile)]: "false", [key(8, profile)]: "custom", [key(9, profile)]: '{"onTarget":0.1,"acceptable":0.2}',
    [key(10, profile)]: '{"schemaVersion":1}', [key(11, profile)]: '{"schemaVersion":1,"history":[]}', [key(12, profile)]: json(emptySync()),
  };
}
async function teamFixture(recorder = c) {
  let next = 10;
  const clock = { id: () => `70000000-0000-4000-8000-${String(next++).padStart(12, "0")}`, now: () => "2026-10-01T10:00:00.000Z" };
  const created = createTeamExerciseExecution(findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID)!, {
    trainingSessionId: "80000000-0000-4000-8000-000000000008", teamId: "90000000-0000-4000-8000-000000000009", recorderProfileId: recorder,
    participantRoster: [{ profileId: a, participation: "training-athlete" }, { profileId: b, participation: "training-athlete" }, { profileId: c, participation: "supporting" }],
    initialRoleAssignment: { deliveringAthleteProfileId: a, sweeperProfileIds: [], observerProfileId: c, sweepingUsed: false }, rotation: { kind: "after-every-stone", athleteOrder: [a, b] }, clock,
  });
  if (!created.ok) throw Error("Synthetic Team fixture refused");
  const attempted = addTeamShotmakingAttempt(created.value, { recorderProfileId: recorder, athleteProfileId: a, actualHandle: "in", evaluation: { status: "scored", score: 3 }, clock });
  if (!attempted.ok) throw Error("Synthetic attempt refused");
  const completed = completeTeamExerciseExecution(attempted.value, recorder, "2026-10-01T11:00:00.000Z"); if (!completed.ok) throw null;
  const upload = serializeCompletedTeamExercise(completed.value)!;
  const bundle = upload.bundles.find(v => v.athleteProfileId === a)!;
  const record = await deserializeOwnedTeamExerciseResult({ session: { ...upload.session, recordedByProfileId: recorder, contentSha256: (await sha256Hex(upload.session.coordinationPayload))!, createdAt: "2026-10-01T12:00:00.000Z" }, bundle: { ...bundle, recordedByProfileId: recorder, contentSha256: (await sha256Hex(bundle.resultPayload))!, createdAt: "2026-10-01T12:00:00.000Z" }, privateNote: { resultId: bundle.resultIds[0], note: "synthetic private 🥌", updatedAt: "2026-10-01T12:00:00.000Z" }, revisions: [] }, a);
  expect(record).not.toBeNull(); if (!record) throw null;
  return { draft: attempted.value, record, upload };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("evaluates the real complete 13-key inventory through all actual repository loads without external I/O", async () => {
  engine(); const calls: string[] = [], reads: string[] = [];
  const get = vi.spyOn(localStorageAdapter, "get"), set = vi.spyOn(localStorageAdapter, "set");
  vi.spyOn(scoped, "createProfileScopedSportingRepositories").mockImplementation((profile, adapter) => {
    const actualGet = adapter!.get;
    const actual = originalFactory(profile, { ...adapter!, get: async name => { reads.push(name); return actualGet(name); } });
    const output = { ...actual };
    for (const name of Object.keys(actual) as (keyof typeof actual)[]) {
      const repository = actual[name]; const wrapped = { ...repository } as Record<string, unknown>;
      for (const [method, value] of Object.entries(repository)) if (/^(load|get)/.test(method)) wrapped[method] = async () => { calls.push(`${name}.${method}`); return Reflect.apply(value, repository, []); };
      Object.assign(output, { [name]: wrapped });
    }
    return output;
  });
  const syncFactory = vi.spyOn(syncModule, "createSportingSyncStateRepository");
  const raws = allRaws(), before = json(raws), encoded = await wire(raws), result = await evaluateInstallationTransferDomainsV3(encoded);
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.value.domainStatus).toBe("preserved_candidate"); expect(result.value.profiles[0].domains).toHaveLength(11);
  expect(calls.filter(k => k !== "assessment.loadState")).toHaveLength(9); expect(calls.filter(k => k === "assessment.loadState")).toHaveLength(2); expect(syncFactory).toHaveBeenCalledTimes(1);
  expect([...new Set(reads)].sort()).toEqual(TRANSFER_SPORTING_SUFFIXES.slice(0, 12).map((_, i) => key(i)).sort());
  expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(json(raws)).toBe(before);
  expect(result.value).toMatchObject({ historicalStatus: "not_evaluated", mayIssue: false, mayPublish: false, mayMount: false });
  expect(Object.isFrozen(result.value)).toBe(true); expect(Object.isFrozen(result.value.profiles[0].domains[0])).toBe(true);
  expect(json(result.value)).not.toContain("synthetic 🥌"); expect(json(result.value)).not.toContain(a);
  const decoded = await decodeInstallationTransferV3(encoded); expect(decoded.ok).toBe(true); if (decoded.ok) for (const item of decoded.value.envelope.items as { key: string; raw?: string }[]) if (item.raw !== undefined) expect(item.raw).toBe(raws[item.key]);
});
it("handles no sporting namespace and true absent slots separately from stored empty domains", async () => {
  engine(); expect((await evaluate({})).profiles).toEqual([]);
  const result = await evaluate({ [key(1)]: "[]" }); expect(result.profiles[0].domains.find(v => v.domain === "session_history")?.status).toBe("preserved_candidate");
  expect(result.profiles[0].domains.filter(v => v.status === "absent")).toHaveLength(10);
});
it("never constructs domain repositories for invalid/cross-version/digest-failed input", async () => {
  engine(); const factory = vi.spyOn(scoped, "createProfileScopedSportingRepositories"), good = await wire();
  let touches = 0; const proxy = new Proxy({}, { get() { touches++; throw null; } });
  for (const value of [undefined, null, proxy, new String(good), "{bad", good + " "]) expect((await evaluateInstallationTransferDomainsV3(value)).ok).toBe(false);
  expect(factory).not.toHaveBeenCalled(); expect(touches).toBe(0);
});
it("isolates simultaneous evaluations and two declared Profile namespaces", async () => {
  engine(); const [first, second] = await Promise.all([evaluate({ ...allRaws(), ...allRaws(b), [key(7, b)]: "true" }), evaluate({ [key(7)]: "false" })]);
  expect(first.profiles.map(v => v.profileIndex)).toEqual([0, 1]); expect(first.domainStatus).toBe("preserved_candidate"); expect(second.domainStatus).toBe("preserved_candidate");
});
it("recognises only the actual running-to-paused capture transition", async () => {
  engine(); const block = timeBlock(), value = session([block], []); value.captureSequence = startCaptureSequence(createCaptureSequence({ session: value, block, expectedShotCount: 8, providerType: "simulator", handleMode: "manual" }));
  expect(await domain(0, json(value), "current_session")).toMatchObject({ status: "recovery_required", interpretation: "capture_paused" });
  value.captureSequence.expectedShotCount = 0;
  expect(await domain(0, json(value), "current_session")).toMatchObject({ status: "preserved_unusable" });
});
it.each(["{bad", "null", "{}", '{"id":"s"}', '{"blocks":[],"shots":[]}', json({ ...buildSession(), unknown: true })])("rejects present Session fallback/repair: %s", async raw => { engine(); expect((await domain(0, raw, "current_session")).status).toBe("preserved_unusable"); });
it.each(["null", "{}", "[{}]", json([buildSession(), buildSession({ id: "duplicate" }), buildSession({ id: "duplicate" })])])("rejects malformed or duplicate history: %s", async raw => { engine(); expect((await domain(1, raw, "session_history")).status).toBe("preserved_unusable"); });
it.each(["{bad", "{}", "null", json({ ...createDefaultHistoryFilters(), unknown: true })])("detects actual filter sanitisation: %s", async raw => { engine(); expect((await domain(2, raw, "history_filters")).status).toBe("preserved_unusable"); });
it.each([{ handles: ["future"] }, { shotTypes: ["future"] }, { measurementMode: "future" }, { dateRange: { preset: "future" } }, { dateRange: { preset: "90d", extra: true } }, { targetRange: { min: "1" } }, { sessionIds: [null] }])("refuses unsupported filter fields even when the sanitizer preserves them: %j", async change => {
  engine(); expect((await domain(2, json({ ...createDefaultHistoryFilters(), ...change }), "history_filters")).status).toBe("preserved_unusable");
});
it("does not treat harmless duplicate filter selections as lost record identities", async () => { engine(); expect((await domain(2, json({ ...createDefaultHistoryFilters(), handles: ["in", "in"] }), "history_filters")).status).toBe("preserved_candidate"); });
it.each(["", "TRUE", " false", "0", "null"])('keeps unsupported intro "%s" unusable', async raw => { engine(); expect((await domain(7, raw, "show_introduction")).status).toBe("preserved_unusable"); });
it.each(["true", "false"])('accepts exact intro "%s"', async raw => { engine(); expect((await domain(7, raw, "show_introduction")).status).toBe("preserved_candidate"); });
it.each(["standard", "tight", "custom"])('accepts exact preset "%s"', async raw => { engine(); expect((await domain(8, raw, "threshold_preset")).status).toBe("preserved_candidate"); });
it.each(["", "future", " standard", '"tight"'])('rejects preset defaulting "%s"', async raw => { engine(); expect((await domain(8, raw, "threshold_preset")).status).toBe("preserved_unusable"); });
it.each(["", "null", "{}", '{"onTarget":1,"acceptable":2,"extra":0}', '{"onTarget":1,"onTarget":1,"acceptable":2}', '{"onTarget":1,"on\\u0054arget":1,"acceptable":2}', '{"onTarget":1e999,"acceptable":2}', '{"onTarget":"1","acceptable":2}', "[1,2]"])('refuses threshold fallback or unsupported JSON: %s', async raw => { engine(); expect((await domain(9, raw, "custom_threshold")).status).toBe("preserved_unusable"); });
it("keeps finite exact numeric preferences without inventing a new sporting range rule", async () => { engine(); expect((await domain(9, '{"acceptable":-2,"onTarget":0}', "custom_threshold")).status).toBe("preserved_candidate"); });
it("uses the actual Assessment split with no source changes, including partial exact-half recovery", async () => {
  engine(); const run = createTestRun(), combined = { schemaVersion: 1, currentRun: run, history: [] }, draft = json({ schemaVersion: 1, currentRun: run }), history = '{"schemaVersion":1,"history":[]}';
  for (const halves of [{}, { [key(10)]: draft }, { [key(11)]: history }]) {
    const result = await evaluate({ [key(3)]: json(combined), ...halves }); expect(result.profiles[0].domains.find(v => v.domain === "assessment")).toMatchObject({ status: "recovery_required", interpretation: "assessment_recovery" });
  }
});
it("accepts exact terminal duplicate clearing only with full split history already present", async () => {
  engine(); const started = transitionAssessmentRun(createTestRun(), "warmup"); if (!started.ok) throw null;
  const run = abandonTestRun(started.value), combined = json({ schemaVersion: 1, currentRun: run, history: [run] }), draft = json({ schemaVersion: 1, currentRun: run }), history = json({ schemaVersion: 1, history: [run] });
  const result = await evaluate({ [key(10)]: draft, [key(11)]: history }); expect(result.profiles[0].domains.find(v => v.domain === "assessment")?.status).toBe("recovery_required");
  for (const halves of [{}, { [key(10)]: draft }, { [key(11)]: history }]) expect((await evaluate({ [key(3)]: combined, ...halves })).profiles[0].domains.find(v => v.domain === "assessment")?.status).toBe("preserved_unusable");
});
it("independently rejects a lossy shadow behind a valid full split", async () => {
  engine(); for (const legacy of [{ schemaVersion: 99, history: [] }, { schemaVersion: 1, history: [{}] }, { schemaVersion: 1, history: [], extra: true }]) {
    const result = await evaluate({ [key(3)]: json(legacy), [key(10)]: '{"schemaVersion":1}', [key(11)]: '{"schemaVersion":1,"history":[]}' }); expect(result.profiles[0].domains.find(v => v.domain === "assessment")?.status).toBe("preserved_unusable");
  }
});
it("allows a different valid older shadow without treating it as split authority", async () => {
  engine(); const result = await evaluate({ [key(3)]: json({ schemaVersion: 1, history: [] }), [key(10)]: json({ schemaVersion: 1, currentRun: createTestRun() }), [key(11)]: '{"schemaVersion":1,"history":[]}' }); expect(result.profiles[0].domains.find(v => v.domain === "assessment")?.status).toBe("preserved_candidate");
});
it.each(["{bad", "null", '{"schemaVersion":99,"history":[]}', '{"schemaVersion":1,"history":[{}]}', '{"schemaVersion":1,"history":[],"currentRun":{}}'])("rejects Assessment quarantine/default: %s", async raw => { engine(); expect((await domain(3, raw, "assessment")).status).toBe("preserved_unusable"); });
it("rejects partial split conflicts and non-byte-identical existing halves", async () => {
  engine(); const combined = '{"schemaVersion":1,"history":[]}';
  for (const half of [{ [key(10)]: '{ "schemaVersion":1 }' }, { [key(11)]: '{"schemaVersion":1,"history":[{}]}' }, { [key(10)]: "{bad" }]) expect((await evaluate({ [key(3)]: combined, ...half })).profiles[0].domains.find(v => v.domain === "assessment")?.status).toBe("preserved_unusable");
});
it.each([1, 2])("compares full Training Plan content for supported schema%d", async version => {
  engine(); const plan = clone(buildPlan()); plan.schemaVersion = version;
  if (version === 1) { const step = plan.steps[0] as unknown as Record<string, unknown>; delete step.exerciseVersionSnapshot; delete step.type; }
  expect(await domain(4, json({ schemaVersion: version, plans: [plan] }), "training_plans")).toMatchObject({ status: "preserved_candidate", plansExecutable: true, interpretation: version === 1 ? "schema_interpretation" : "none" });
  const bad = clone(plan); bad.name = "Changed"; (bad.steps[0] as unknown as Record<string, unknown>).unexpected = true;
  expect((await domain(4, json({ schemaVersion: version, plans: [bad] }), "training_plans")).status).toBe("preserved_unusable");
});
it("keeps readable-only plans distinct from executable plans", async () => {
  engine(); const plan = buildPlan(); const step = plan.steps[0]; if (step.type !== "release-timing") throw null;
  step.configuration.measurementMode = "hog-hog"; step.configuration.mode = "variable"; step.configuration.variableTargetMode = "smart-random";
  expect(await domain(4, json({ schemaVersion: 2, plans: [plan] }), "training_plans")).toMatchObject({ status: "preserved_candidate", plansExecutable: false });
});
it.each(["missing_id", "default_completion", "default_target", "unknown_snapshot", "duplicate_step"])('refuses plan repair "%s"', async kind => {
  engine(); const plan = clone(buildPlan()), step = plan.steps[0] as unknown as Record<string, unknown>;
  if (kind === "missing_id") delete step.id;
  if (kind === "default_completion") delete step.completion;
  if (kind === "default_target") delete (step.configuration as Record<string, unknown>).targetTime;
  if (kind === "unknown_snapshot") (step.exerciseVersionSnapshot as Record<string, unknown>).id = "unknown";
  if (kind === "duplicate_step") plan.steps.push(clone(plan.steps[0]));
  expect((await domain(4, json({ schemaVersion: 2, plans: [plan] }), "training_plans")).status).toBe("preserved_unusable");
});
it.each([1, 2])("uses actual tolerance schema%d interpretation without renaming/default loss", async schemaVersion => {
  engine(); const p = { id: "p", name: "Time", createdAt: "synthetic", updatedAt: "synthetic", ...(schemaVersion === 1 ? { onTarget: 0.1, acceptable: 0.2 } : { quantity: "speed", tolerance: { onTarget: { lower: 0.1, upper: 0.15 }, acceptable: { lower: 0.2, upper: 0.3 } } }) };
  const state = { schemaVersion, profiles: [p], defaultProfileId: "p" };
  expect((await domain(5, json(state), "tolerance_profiles")).status).toBe("preserved_candidate");
  for (const bad of [{ ...state, profiles: [{ ...p, name: " Time " }] }, { ...state, defaultProfileId: "missing" }, { ...state, profiles: [p, p] }]) expect((await domain(5, json(bad), "tolerance_profiles")).status).toBe("preserved_unusable");
});
it("does not accept actual Smart Random trimming, range repair, dropped members or default replacement", async () => {
  engine(); const p = { id: "r", name: "Range", measurementMode: "back-hog", min: 2.5, max: 4.5, createdAt: "synthetic", updatedAt: "synthetic" }, state = { schemaVersion: 1, profiles: [p], defaultProfileId: "r" };
  expect((await domain(6, json(state), "random_profiles")).status).toBe("preserved_candidate");
  for (const bad of [{ ...state, schemaVersion: 99 }, { ...state, profiles: [{ ...p, name: " Range " }] }, { ...state, profiles: [{ ...p, min: -1 }] }, { ...state, defaultProfileId: "missing" }, { ...state, profiles: [p, {}] }]) expect((await domain(6, json(bad), "random_profiles")).status).toBe("preserved_unusable");
});
it.each([1, 2, 3, 4, 5, 6])("loads whole sync schema%d with only its named empty-root evolution", async version => {
  engine(); const value: Record<string, unknown> = { schemaVersion: version, entries: [{ recordKind: "training_session", recordId: b, schemaVersion: 1, payload: "opaque synthetic payload \ud800", contentSha256: "a".repeat(64), recordedAt: "2026-10-01T12:00:00Z", desired: "present", status: "synced" }] };
  if (version >= 2) value.teamEntries = []; if (version >= 3) value.teamEligibilitySnapshots = []; if (version >= 4) value.activeTeamExerciseDraft = null; if (version >= 5) value.teamExerciseResults = [];
  expect((await domain(12, json(value), "cloud_sync")).status).toBe("preserved_candidate");
  expect((await domain(12, json({ ...value, futureField: true }), "cloud_sync")).status).toBe("preserved_unusable");
  const entry = (value.entries as Record<string, unknown>[])[0]; entry.desired = "deleted"; entry.payload = "";
  expect((await domain(12, json(value), "cloud_sync")).status).toBe("preserved_candidate");
  entry.unknown = true; expect((await domain(12, json(value), "cloud_sync")).status).toBe("preserved_unusable");
});
it.each(["{bad", "null", '{"schemaVersion":999,"entries":[]}', json({ ...emptySync(), entries: [{}] })])("preserves but refuses unsupported sync: %s", async raw => { engine(); expect((await domain(12, raw, "cloud_sync")).status).toBe("preserved_unusable"); });
it.each(["unknown_get", "foreign_set", "known_set", "known_remove", "throw", "reject", "absent", "read_failed"])('contains actual-loader negative boundary "%s"', async mode => {
  engine(); let effect = 0;
  vi.spyOn(scoped, "createProfileScopedSportingRepositories").mockImplementation((profile, adapter) => {
    const actual = originalFactory(profile, adapter);
    return { ...actual, historyFilters: { ...actual.historyFilters, async load() {
      effect++;
      if (mode === "throw") throw new Proxy({}, { get() { throw null; } });
      if (mode === "reject") return Promise.reject(new Proxy({}, { get() { throw null; } }));
      if (mode === "absent") return { status: "absent" as const };
      if (mode === "read_failed") return { status: "read_failed" as const, fallback: createDefaultHistoryFilters(), error: { kind: "storage_unavailable" as const } };
      const port = adapter as RemovableStorageAdapter;
      if (mode === "unknown_get") await port.get("foreign");
      if (mode === "foreign_set") await port.set(key(2, b), "synthetic");
      if (mode === "known_set") expect((await port.set(key(2, profile), json(createDefaultHistoryFilters()))).ok).toBe(true);
      if (mode === "known_remove") expect((await port.remove(key(2, profile))).ok).toBe(true);
      return actual.historyFilters.load();
    } } };
  });
  const result = await evaluate({ [key(2)]: json(createDefaultHistoryFilters()) }); expect(effect).toBe(1); expect(result.domainStatus).toBe("preserved_unusable"); expect(result.profiles[0].domains.find(v => v.domain === "history_filters")?.status).toBe("preserved_unusable");
});
it("audits real overlay acknowledgements and subsequent reads after Assessment recovery", async () => {
  engine(); let observed = 0;
  vi.spyOn(scoped, "createProfileScopedSportingRepositories").mockImplementation((profile, adapter) => {
    const actual = originalFactory(profile, adapter);
    return { ...actual, assessment: { ...actual.assessment, async loadState() {
      const result = await actual.assessment.loadState(); const found = await adapter!.get(key(11, profile));
      expect(found).toEqual({ status: "value", value: '{"schemaVersion":1,"history":[]}' }); observed++; return result;
    } } };
  });
  expect((await domain(3, '{"schemaVersion":1,"history":[]}', "assessment")).status).toBe("recovery_required"); expect(observed).toBe(1);
});
it("refuses deep/nonfinite/duplicate raw without handing it to an unbounded domain loader", async () => {
  engine(); const raws = ['{"x":' + "[".repeat(33) + "0" + "]".repeat(33) + "}", '{"schemaVersion":1,"schemaVersion":1,"profiles":[],"defaultProfileId":null}', '{"schemaVersion":1,"profiles":[],"defaultProfileId":null,"x":1e999}'];
  for (const raw of raws) expect((await domain(6, raw, "random_profiles")).status).toBe("preserved_unusable");
});
it.each([5, 6])("preserves full owned Team results and private notes in sync%d with foreign recorder/roster", async schemaVersion => {
  engine(); const { record } = await teamFixture(), owned = clone(record) as unknown as Record<string, unknown>;
  if (schemaVersion === 5) { delete owned.originalResult; delete owned.postCompletionRevisions; delete owned.isVoided; }
  const state = { ...emptySync(), schemaVersion, teamExerciseResults: [owned] };
  expect((await domain(12, json(state), "cloud_sync")).status).toBe("preserved_candidate");
  const foreign = await evaluate({ [key(12, b)]: json(state) }); expect(foreign.profiles[0].domains.find(v => v.domain === "cloud_sync")?.status).toBe("preserved_unusable");
  (owned.privateNote as Record<string, unknown>).extra = true;
  expect((await domain(12, json(state), "cloud_sync")).status).toBe("preserved_unusable");
});
it("does not overwrite supplied future schema5 owned-result fields", async () => {
  engine(); const { record } = await teamFixture();
  expect((await domain(12, json({ ...emptySync(), schemaVersion: 5, teamExerciseResults: [record] }), "cloud_sync")).status).toBe("preserved_unusable");
});
it("correlates active Team recorder namespace while retaining other athletes", async () => {
  engine(); const { draft } = await teamFixture(a);
  expect((await domain(12, json({ ...emptySync(), activeTeamExerciseDraft: draft }), "cloud_sync")).status).toBe("preserved_candidate");
  const result = await evaluate({ [key(12, b)]: json({ ...emptySync(), activeTeamExerciseDraft: draft }) });
  expect(result.profiles[0].domains.find(v => v.domain === "cloud_sync")?.status).toBe("preserved_unusable");
});
it("preserves parent/child Team outbox relations and accepts emptied payloads only when synced", async () => {
  engine(); const { upload } = await teamFixture();
  const parent = { ...upload.session, entryKind: "team_exercise_session", contentSha256: "a".repeat(64), status: "pending" };
  const children = upload.bundles.map(bundle => ({ ...bundle, entryKind: "team_exercise_bundle", contentSha256: "b".repeat(64), status: "pending" }));
  const state = { ...emptySync(), teamEntries: [parent, ...children] };
  expect((await domain(12, json(state), "cloud_sync")).status).toBe("preserved_candidate");
  const first = children[0] as unknown as Record<string, unknown>;
  first.status = "blocked"; first.blockReason = "athlete_ineligible";
  expect((await domain(12, json(state), "cloud_sync")).status).toBe("preserved_candidate");
  first.blockReason = "future"; expect((await domain(12, json(state), "cloud_sync")).status).toBe("preserved_unusable");
  first.status = "pending"; delete first.blockReason;
  parent.coordinationPayload = ""; expect((await domain(12, json(state), "cloud_sync")).status).toBe("preserved_unusable");
  parent.status = "synced"; for (const child of children) { child.status = "synced"; child.resultPayload = ""; }
  expect((await domain(12, json(state), "cloud_sync")).status).toBe("preserved_candidate");
  state.teamEntries.pop(); expect((await domain(12, json(state), "cloud_sync")).status).toBe("preserved_unusable");
});
it("preserves original/current/voided results, corrections and permission cache together", async () => {
  engine(); const { record } = await teamFixture(), changed = clone(record.result);
  const attempt = changed.attempts[0]; if (attempt.kind !== "shotmaking") throw null;
  attempt.actualHandle = "out"; changed.updatedAt = "2026-10-01T13:00:00.000Z";
  record.result = changed; record.isVoided = true;
  record.postCompletionRevisions = [
    { revisionId: "a0000000-0000-4000-8000-000000000001", revisionNumber: 1, kind: "corrected", changedFields: ["actualHandle"], reason: "Synthetic handle correction", actorProfileId: a, createdAt: changed.updatedAt, resultingResult: changed },
    { revisionId: "a0000000-0000-4000-8000-000000000002", revisionNumber: 2, kind: "voided", changedFields: ["result"], reason: "Synthetic result exclusion", actorProfileId: a, createdAt: "2026-10-01T14:00:00.000Z", resultingResult: null },
  ];
  const state = { ...emptySync(), teamExerciseResults: [record], teamEligibilitySnapshots: [{ teamId: record.teamId, teamName: "Synthetic Team", cachedAt: "2026-10-01T15:00:00.000Z", participants: [a, b, c].map(profileId => ({ profileId, displayName: null, participationAsPlayer: true, functions: [], recordingPermissionGranted: false })) }] };
  expect((await domain(12, json(state), "cloud_sync")).status).toBe("preserved_candidate");
  record.result = clone(record.originalResult); expect((await domain(12, json(state), "cloud_sync")).status).toBe("preserved_unusable");
});
it("enforces the aggregate parsed-node budget before issuing the next actual load", async () => {
  engine(); let loads = 0;
  vi.spyOn(scoped, "createProfileScopedSportingRepositories").mockImplementation((profile, adapter) => { const actual = originalFactory(profile, adapter); return { ...actual, smartRandomProfiles: { ...actual.smartRandomProfiles, async loadState() { loads++; return actual.smartRandomProfiles.loadState(); } } }; });
  const raw = json({ schemaVersion: 1, profiles: [], defaultProfileId: null, unknown: Array(60_000).fill(0) });
  const raws: Record<string, string> = {}; for (let i = 1; i <= 5; i++) raws[key(6, `60000000-0000-4000-8000-${String(i).padStart(12, "0")}`)] = raw;
  const result = await evaluate(raws); expect(loads).toBe(4); expect(result.domainStatus).toBe("preserved_unusable");
});
it("holds actual pending archive hashing before any domain factory and offers no override", async () => {
  engine(); const encoded = await wire({ [key(7)]: "true" }), factory = vi.spyOn(scoped, "createProfileScopedSportingRepositories");
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal("crypto", { subtle: { digest: async (_algorithm: string, bytes: Uint8Array<ArrayBuffer>) => { await gate; return webcrypto.subtle.digest("SHA-256", bytes); } } });
  let done = false; const work = evaluateInstallationTransferDomainsV3(encoded).then(result => { done = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 10)); expect(done).toBe(false); expect(factory).not.toHaveBeenCalled(); release(); expect((await work).ok).toBe(true);
  factory.mockClear(); vi.stubGlobal("crypto", undefined); const override = vi.fn();
  expect(await Reflect.apply(evaluateInstallationTransferDomainsV3, undefined, [encoded, override])).toEqual({ ok: false, code: "fingerprint_failed" }); expect(factory).not.toHaveBeenCalled(); expect(override).not.toHaveBeenCalled();
});
