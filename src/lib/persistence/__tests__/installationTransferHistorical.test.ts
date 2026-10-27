import { afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { evaluateInstallationTransferHistoricalV3 } from "../installationTransferHistorical";
import * as archive from "../installationTransferV3";
import { encodeInstallationTransferV3 } from "../installationTransferV3";
import { TRANSFER_SPORTING_SUFFIXES, TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY } from "../installationTransferInventory";
import * as scoped from "../profileScopedSportingPersistence";
import * as catalogModule from "../../exercises/catalog";
import * as lookup from "../../exercises/lookup";
import * as records from "../../cloudSporting/records";
import * as assets from "../../exercises/restrictedAssetCatalog";
import { EXERCISE_CATALOG } from "../../exercises/catalog";
import { EIGHT_GUARDS_VERSION_ID, EIGHT_GUARDS_SOURCE_DIAGRAM_V3_VERSION_ID, ROTATION_COUNT_VERSION_ID } from "../../exercises/content";
import { findExerciseVersion } from "../../exercises/lookup";
import { createTeamExerciseExecution, addTeamShotmakingAttempt, addTeamMeasurementAttempt, completeTeamExerciseExecution } from "../../exercises/teamExecution";
import { serializeCompletedTeamExercise, deserializeOwnedTeamExerciseResult } from "../../cloudSporting/teamExerciseRecords";
import { sha256Hex } from "../../cloudSporting/records";
import { buildPlan, buildSession, buildExerciseStep, buildStep } from "../../trainingPlans/__tests__/testHelpers";
import { startPlanExecution } from "../../trainingPlans/execution";
import { timeBlock } from "../../measurement/__tests__/measurementFixtures";
import { createTestRun, abandonTestRun } from "../../assessment/__tests__/testHelpers";
import { transitionAssessmentRun } from "../../assessment/run";

const a = "10000000-0000-4000-8000-000000000001", b = "20000000-0000-4000-8000-000000000002";
const c = "30000000-0000-4000-8000-000000000003";
const key = (index: number, profile = a) => `curling.sporting.profile.v1.${profile}.${TRANSFER_SPORTING_SUFFIXES[index]}`;
const json = (value: unknown) => JSON.stringify(value);
const clone = <T>(value: T): T => JSON.parse(json(value));
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
  const result = await evaluateInstallationTransferHistoricalV3(await wire(raws));
  expect(result.ok).toBe(true); if (!result.ok) throw Error("Synthetic evaluation refused"); return result.value;
}
async function teamFixture(recorder = c, measured = false) {
  let next = 10;
  const clock = { id: () => `70000000-0000-4000-8000-${String(next++).padStart(12, "0")}`, now: () => "2026-10-01T10:00:00.000Z" };
  const created = createTeamExerciseExecution(findExerciseVersion(EXERCISE_CATALOG, measured ? ROTATION_COUNT_VERSION_ID : EIGHT_GUARDS_VERSION_ID)!, {
    trainingSessionId: "80000000-0000-4000-8000-000000000008", teamId: "90000000-0000-4000-8000-000000000009", recorderProfileId: recorder,
    participantRoster: [{ profileId: a, participation: "training-athlete" }, { profileId: b, participation: "training-athlete" }, { profileId: c, participation: "supporting" }],
    enabledMeasurementProtocols: measured ? lookup.resolveMeasurementProtocols(EXERCISE_CATALOG, findExerciseVersion(EXERCISE_CATALOG, ROTATION_COUNT_VERSION_ID)!.compatibleMeasurementProtocols).map(v => v.protocol) : [],
    initialRoleAssignment: { deliveringAthleteProfileId: a, sweeperProfileIds: [], observerProfileId: c, sweepingUsed: false }, rotation: { kind: "after-every-stone", athleteOrder: [a, b] }, clock,
  });
  if (!created.ok) throw Error("Synthetic Team fixture refused");
  const attempted = measured ? addTeamMeasurementAttempt(created.value, { recorderProfileId: recorder, athleteProfileId: a, actualHandle: "out", measurements: [{ id: "a0000000-0000-4000-8000-000000000010", protocolId: created.value.configuration.enabledMeasurementProtocols[0].id, protocolVersion: created.value.configuration.enabledMeasurementProtocols[0].version, value: 2.5, source: "manual", recordedAt: "2026-10-01T10:10:00.000Z" }], clock }) : addTeamShotmakingAttempt(created.value, { recorderProfileId: recorder, athleteProfileId: a, actualHandle: "in", evaluation: { status: "scored", score: 3 }, clock });
  if (!attempted.ok) throw Error("Synthetic attempt refused");
  const completed = completeTeamExerciseExecution(attempted.value, recorder, "2026-10-01T11:00:00.000Z"); if (!completed.ok) throw null;
  const upload = serializeCompletedTeamExercise(completed.value)!;
  const bundle = upload.bundles.find(v => v.athleteProfileId === a)!;
  const record = await deserializeOwnedTeamExerciseResult({ session: { ...upload.session, recordedByProfileId: recorder, contentSha256: (await sha256Hex(upload.session.coordinationPayload))!, createdAt: "2026-10-01T12:00:00.000Z" }, bundle: { ...bundle, recordedByProfileId: recorder, contentSha256: (await sha256Hex(bundle.resultPayload))!, createdAt: "2026-10-01T12:00:00.000Z" }, privateNote: { resultId: bundle.resultIds[0], note: "synthetic private 🥌", updatedAt: "2026-10-01T12:00:00.000Z" }, revisions: [] }, a);
  expect(record).not.toBeNull(); if (!record) throw null;
  return { draft: attempted.value, record, upload };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("checks the actual full registry without Profiles and grants nothing", async () => {
  engine(); const result = await evaluate({});
  expect(result).toMatchObject({ historicalStatus: "catalog_candidate", profiles: [], mayIssue: false, mayPublish: false, mayMount: false });
});
function outbox(upload: NonNullable<ReturnType<typeof serializeCompletedTeamExercise>>) {
  return [{ ...upload.session, entryKind: "team_exercise_session", contentSha256: "a".repeat(64), status: "pending" }, ...upload.bundles.map(bundle => ({ ...bundle, entryKind: "team_exercise_bundle", contentSha256: "b".repeat(64), status: "pending" }))] as Record<string, unknown>[];
}
function changePayload(entry: Record<string, unknown>, field: "coordinationPayload" | "resultPayload", change: (payload: Record<string, unknown>) => void) {
  const payload = JSON.parse(entry[field] as string); change(payload); entry[field] = json(payload);
}
it("preserves original source bytes, uses actual lookups and exposes only frozen value-free findings", async () => {
  engine(); const look = vi.spyOn(lookup, "findExerciseVersion"), protocol = vi.spyOn(lookup, "findMeasurementProtocol");
  const raws = { [key(4)]: json({ schemaVersion: 2, plans: [buildPlan({ steps: [buildExerciseStep({ exerciseVersionSnapshot: findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_SOURCE_DIAGRAM_V3_VERSION_ID)! })] })] }) }, before = json(raws);
  const result = await evaluate(raws); expect(result.historicalStatus).toBe("catalog_candidate");
  expect(result.profiles[0]).toMatchObject({ exerciseSnapshots: 1, protocolSnapshots: 0, registeredAssets: 1 });
  expect(look).toHaveBeenCalled(); expect(protocol).toHaveBeenCalled(); expect(json(raws)).toBe(before);
  expect(Object.isFrozen(result.profiles[0])).toBe(true); expect(Object.isFrozen(result.domain.profiles[0].domains)).toBe(true);
  expect(json(result)).not.toContain(a); expect(json(result)).not.toContain("swiss-curling");
});
it.each(["current", "history", "plan", "future_step"])("examines full immutable snapshots at %s", async surface => {
  engine(); const old = clone(EXERCISE_CATALOG.versions.find(v => v.id === EIGHT_GUARDS_SOURCE_DIAGRAM_V3_VERSION_ID)!); expect(old).toBeDefined();
  const plan = buildPlan({ steps: [buildStep(), buildExerciseStep({ exerciseVersionSnapshot: old })] });
  const block = timeBlock();
  const session = buildSession({ blocks: [block], activeBlockId: block.id, planExecution: startPlanExecution(plan, { kind: "release-timing-block", blockId: block.id }) });
  const raws = surface === "plan" ? { [key(4)]: json({ schemaVersion: 2, plans: [plan] }) } : surface === "history" ? { [key(1)]: json([session]) } : { [key(0)]: json(session) };
  expect((await evaluate(raws)).historicalStatus).toBe("catalog_candidate");
  const changed = clone(old); changed.title = "Altered immutable copy";
  plan.steps[1].exerciseVersionSnapshot = changed; session.planExecution!.steps[1].step.exerciseVersionSnapshot = changed;
  const bad = surface === "plan" ? { [key(4)]: json({ schemaVersion: 2, plans: [plan] }) } : surface === "history" ? { [key(1)]: json([session]) } : { [key(0)]: json(session) };
  expect((await evaluate(bad)).historicalStatus).not.toBe("catalog_candidate");
});
it.each([1, 2])("uses adopted plan schema%d interpretation without changing library/execution status", async schemaVersion => {
  engine(); const plan = clone(buildPlan()); plan.schemaVersion = schemaVersion;
  if (schemaVersion === 1) { const step = plan.steps[0] as unknown as Record<string, unknown>; delete step.type; delete step.exerciseVersionSnapshot; }
  const result = await evaluate({ [key(4)]: json({ schemaVersion, plans: [plan] }) });
  expect(result.historicalStatus).toBe("catalog_candidate"); expect(result.domain.historicalStatus).toBe("not_evaluated");
});
it("accepts authoritative self-contained historical Assessment snapshots, including a stale shadow", async () => {
  engine(); const run = createTestRun(); run.templateId = "historical-custom-template"; run.templateVersion = 42; run.templateSnapshot.id = run.templateId; run.templateSnapshot.version = 42;
  const result = await evaluate({ [key(3)]: json({ schemaVersion: 1, currentRun: run, history: [] }), [key(10)]: '{"schemaVersion":1}', [key(11)]: '{"schemaVersion":1,"history":[]}' });
  expect(result.historicalStatus).toBe("catalog_candidate"); expect(result.profiles[0].exerciseSnapshots).toBe(0);
  run.templateVersion = 43; expect((await evaluate({ [key(10)]: json({ schemaVersion: 1, currentRun: run }) })).historicalStatus).not.toBe("catalog_candidate");
});
it("does not fabricate success for a domain-unusable Profile or hide it beside a valid Profile", async () => {
  engine(); const result = await evaluate({ [key(7)]: "true", [key(7, b)]: "TRUE" });
  expect(result.historicalStatus).toBe("not_evaluated"); expect(result.profiles.map(v => v.historicalStatus)).toEqual(["catalog_candidate", "not_evaluated"]);
  expect(result.domain.domainStatus).toBe("preserved_unusable");
});
it.each([1, 2, 3, 4, 5, 6])("evaluates complete supported sync schema%d empty roots", async schemaVersion => {
  engine(); const state: Record<string, unknown> = { schemaVersion, entries: [] };
  if (schemaVersion >= 2) state.teamEntries = []; if (schemaVersion >= 3) state.teamEligibilitySnapshots = []; if (schemaVersion >= 4) state.activeTeamExerciseDraft = null; if (schemaVersion >= 5) state.teamExerciseResults = [];
  expect((await evaluate({ [key(12)]: json(state) })).historicalStatus).toBe("catalog_candidate");
});
it("uses actual synchronous personal readers after bounded admission without internal payload-hash claims", async () => {
  engine(); const personal = buildSession({ id: b }), serialized = records.serializeTrainingSession(personal)!; expect(serialized).not.toBeNull();
  const started = transitionAssessmentRun(createTestRun(), "warmup"); if (!started.ok) throw null;
  const assessment = records.serializeAssessmentRun(abandonTestRun(started.value))!;
  const entry = (r: typeof serialized) => ({ ...r, contentSha256: "a".repeat(64), desired: "present", status: "pending" });
  const one = vi.spyOn(records, "deserializeTrainingSession"), two = vi.spyOn(records, "deserializeAssessmentRun");
  expect((await evaluate({ [key(12)]: json({ ...emptySync(), entries: [entry(serialized), entry(assessment)] }) })).historicalStatus).toBe("catalog_candidate");
  expect(one).toHaveBeenCalledTimes(1); expect(two).toHaveBeenCalledTimes(1);
});
it.each(["{bad", '{"id":1,"id":1}', '{"x":1e999}', '{"x":'+"[".repeat(33)+"0"+"]".repeat(33)+"}", "[]"])("refuses opaque personal payload: %s", async payload => {
  engine(); const reader = vi.spyOn(records, "deserializeTrainingSession");
  const result = await evaluate({ [key(12)]: json({ ...emptySync(), entries: [{ recordKind: "training_session", recordId: b, schemaVersion: 1, payload, contentSha256: "a".repeat(64), recordedAt: "2026-10-01T12:00:00Z", desired: "present", status: "pending" }] }) });
  expect(result.historicalStatus).toBe("preserved_unusable");
  if (payload !== "[]") expect(reader).not.toHaveBeenCalled();
});
it("aggregates a historically unusable Profile above an independent valid one", async () => {
  engine(); const state = { ...emptySync(), entries: [{ recordKind: "training_session", recordId: b, schemaVersion: 1, payload: "opaque", contentSha256: "a".repeat(64), recordedAt: "2026-10-01T12:00:00Z", desired: "present", status: "synced" }] };
  const result = await evaluate({ [key(7)]: "true", [key(12, b)]: json(state) });
  expect(result.historicalStatus).toBe("preserved_unusable"); expect(result.domain.domainStatus).toBe("preserved_candidate");
  expect(result.profiles.map(v => v.historicalStatus)).toEqual(["catalog_candidate", "preserved_unusable"]);
});
it("retains deleted personal tombstones without inventing their missing history", async () => {
  engine(); const reader = vi.spyOn(records, "deserializeTrainingSession");
  const result = await evaluate({ [key(12)]: json({ ...emptySync(), entries: [{ recordKind: "training_session", recordId: b, schemaVersion: 1, payload: "", contentSha256: "a".repeat(64), recordedAt: "2026-10-01T12:00:00Z", desired: "deleted", status: "synced" }] }) });
  expect(result.historicalStatus).toBe("catalog_candidate"); expect(reader).not.toHaveBeenCalled();
});
it.each([false, true])("covers actual full Team state and upload references (measured=%s)", async measured => {
  engine(); const { draft, record, upload } = await teamFixture(a, measured);
  const result = await evaluate({ [key(12)]: json({ ...emptySync(), activeTeamExerciseDraft: draft, teamExerciseResults: [record], teamEntries: outbox(upload) }) });
  expect(result.historicalStatus).toBe("catalog_candidate"); expect(result.profiles[0].exerciseSnapshots).toBe(3);
  expect(result.profiles[0].protocolSnapshots).toBe(measured ? 3 : 0);
});
it.each(["session", "team", "execution", "unknown_schema", "snapshot", "protocol", "unknown_carrier"])("refuses nonmatching Team coordination/bundle %s", async mode => {
  engine(); const { upload } = await teamFixture(a, true), entries = outbox(upload);
  if (["session", "team", "execution", "unknown_schema", "snapshot", "protocol"].includes(mode)) changePayload(entries[0], "coordinationPayload", payload => {
    const e = payload.execution as Record<string, unknown>;
    if (mode === "session") e.trainingSessionId = c;
    if (mode === "team") (e.teamContext as Record<string, unknown>).teamId = c;
    if (mode === "execution") e.id = c;
    if (mode === "unknown_schema") payload.schemaVersion = 99;
    if (mode === "snapshot") (e.exerciseVersionSnapshot as Record<string, unknown>).title = "Changed";
    if (mode === "protocol") ((e.configuration as Record<string, unknown>).enabledMeasurementProtocols as Record<string, unknown>[])[0].label = "Changed";
  });
  else changePayload(entries[1], "resultPayload", p => { (((p.result as Record<string, unknown>).attempts as Record<string, unknown>[])[0]).kind = "future"; });
  expect((await evaluate({ [key(12)]: json({ ...emptySync(), teamEntries: entries }) })).historicalStatus).toBe("preserved_unusable");
});
it.each(["missing", "cached", "current", "history", "draft", "other_session", "other_team", "other_profile"])("resolves pending measured bundle with empty synced coordination: %s", async mode => {
  engine(); const { draft, record, upload } = await teamFixture(a, true), entries = outbox(upload); entries[0].status = "synced"; entries[0].coordinationPayload = "";
  const state = { ...emptySync(), teamEntries: entries }, raws: Record<string, string> = {};
  const local = clone(draft);
  if (mode === "other_session") { local.trainingSessionId = c; state.activeTeamExerciseDraft = local as never; }
  if (mode === "other_team") { local.teamContext!.teamId = c; state.activeTeamExerciseDraft = local as never; }
  if (mode === "draft") state.activeTeamExerciseDraft = draft as never;
  if (mode === "cached") state.teamExerciseResults = [record] as never;
  if (mode === "current" || mode === "history") {
    const s = buildSession({ id: local.trainingSessionId, exerciseExecutions: [local], activeExerciseExecutionId: local.id });
    raws[key(mode === "current" ? 0 : 1)] = json(mode === "current" ? s : [s]);
  }
  if (mode === "other_profile") raws[key(12, b)] = json({ ...emptySync(), teamExerciseResults: [{ ...record, athleteProfileId: b }] });
  raws[key(12)] = json(state);
  const result = await evaluate(raws);
  expect(result.profiles[0].historicalStatus).toBe(["cached", "draft"].includes(mode) ? "catalog_candidate" : ["current", "history"].includes(mode) ? "not_evaluated" : "preserved_unusable");
  // Actual Session validation still rejects Team execution aggregates in Solo
  // Session storage. S6b refusal is authoritative; never bypass it for fallback.
  if (["current", "history"].includes(mode)) expect(result.domain.profiles[0].domainStatus).toBe("preserved_unusable");
});
it("permits no-reference bundles with empty synced coordination and invents no remote snapshot", async () => {
  engine(); const { upload } = await teamFixture(), entries = outbox(upload); entries[0].status = "synced"; entries[0].coordinationPayload = "";
  const result = await evaluate({ [key(12)]: json({ ...emptySync(), teamEntries: entries }) });
  expect(result.historicalStatus).toBe("catalog_candidate"); expect(result.profiles[0].exerciseSnapshots).toBe(0);
});
it("accepts identical fallback copies and refuses conflicting enabled context without choosing a winner", async () => {
  engine(); const { draft, record, upload } = await teamFixture(a, true), entries = outbox(upload); entries[0].status = "synced"; entries[0].coordinationPayload = "";
  const state = { ...emptySync(), activeTeamExerciseDraft: draft, teamExerciseResults: [record], teamEntries: entries };
  expect((await evaluate({ [key(12)]: json(state) })).historicalStatus).toBe("catalog_candidate");
  // A separate matching, well-formed cached context with a different immutable
  // Exercise Version is not an authority to override the active execution.
  const other = await teamFixture(a, false); other.record.sharedExecution.id = draft.id;
  state.teamExerciseResults = [other.record];
  expect((await evaluate({ [key(12)]: json(state) })).historicalStatus).toBe("preserved_unusable");
});
it.each(["ids_missing", "definition_duplicate", "path_changed", "map_extra", "catalog_changed"])("refuses incomplete actual compiled registry: %s", async mode => {
  engine();
  if (mode === "ids_missing") vi.spyOn(assets, "PUBLIC_EXERCISE_ASSET_IDS", "get").mockReturnValue(assets.PUBLIC_EXERCISE_ASSET_IDS.slice(1));
  if (mode === "definition_duplicate") vi.spyOn(assets, "PUBLIC_EXERCISE_ASSET_DEFINITIONS", "get").mockReturnValue([...assets.PUBLIC_EXERCISE_ASSET_DEFINITIONS, assets.PUBLIC_EXERCISE_ASSET_DEFINITIONS[0]]);
  if (mode === "path_changed" || mode === "map_extra") vi.spyOn(assets, "PUBLIC_EXERCISE_DIAGRAM_PATHS", "get").mockReturnValue({ ...assets.PUBLIC_EXERCISE_DIAGRAM_PATHS, [mode === "path_changed" ? assets.PUBLIC_EXERCISE_ASSET_IDS[0] : "unknown"]: "/wrong" });
  if (mode === "catalog_changed") vi.spyOn(catalogModule, "EXERCISE_CATALOG", "get").mockReturnValue({ ...EXERCISE_CATALOG, versions: [] });
  expect(await evaluateInstallationTransferHistoricalV3(await wire())).toEqual({ ok: false, code: "historical_evaluation_unavailable" });
});
it("does not run any actual domain factory for invalid input and exposes no override", async () => {
  engine(); const factory = vi.spyOn(scoped, "createProfileScopedSportingRepositories"), override = vi.fn(); let effects = 0;
  const foreign = new Proxy({}, { get() { effects++; throw null; } });
  expect((await Reflect.apply(evaluateInstallationTransferHistoricalV3, undefined, [foreign, override])).ok).toBe(false);
  expect(effects).toBe(0); expect(factory).not.toHaveBeenCalled(); expect(override).not.toHaveBeenCalled();
});
it("bounds repeated payload parsing across Profiles even when the sync loader treats payloads as opaque", async () => {
  engine(); const raws: Record<string, string> = {};
  for (let i = 1; i <= 5; i++) raws[key(12, `60000000-0000-4000-8000-${String(i).padStart(12, "0")}`)] = json({ ...emptySync(), entries: [{ recordKind: "training_session", recordId: b, schemaVersion: 1, payload: json({ unknown: Array(60_000).fill(0) }), contentSha256: "a".repeat(64), recordedAt: "2026-10-01T12:00:00Z", desired: "present", status: "pending" }] });
  expect(await evaluateInstallationTransferHistoricalV3(await wire(raws))).toEqual({ ok: false, code: "historical_evaluation_unavailable" });
});
it("captures malformed actual module metadata without invoking data accessors", async () => {
  engine(); let touches = 0;
  const definition = { ...assets.PUBLIC_EXERCISE_ASSET_DEFINITIONS[0] };
  Object.defineProperty(definition, "path", { enumerable: true, get() { touches++; throw null; } });
  vi.spyOn(assets, "PUBLIC_EXERCISE_ASSET_DEFINITIONS", "get").mockReturnValue([definition, ...assets.PUBLIC_EXERCISE_ASSET_DEFINITIONS.slice(1)]);
  expect(await evaluateInstallationTransferHistoricalV3(await wire())).toEqual({ ok: false, code: "historical_evaluation_unavailable" }); expect(touches).toBe(0);
});
it("refuses oversized actual registry before capture", async () => {
  engine(); const registry = Array(4097).fill(assets.PUBLIC_EXERCISE_ASSET_DEFINITIONS[0]);
  vi.spyOn(assets, "PUBLIC_EXERCISE_ASSET_DEFINITIONS", "get").mockReturnValue(registry);
  expect(await evaluateInstallationTransferHistoricalV3(await wire())).toEqual({ ok: false, code: "historical_evaluation_unavailable" });
});
it("keeps Assessment recovery required while separately reporting catalog compatibility", async () => {
  engine(); const result = await evaluate({ [key(3)]: '{"schemaVersion":1,"history":[]}' });
  expect(result.historicalStatus).toBe("catalog_candidate"); expect(result.domain.domainStatus).toBe("recovery_required");
  expect(result.domain.profiles[0].domains.find(v => v.domain === "assessment")?.interpretation).toBe("assessment_recovery");
});
it.each(["unknown_schema", "execution", "protocol", "correction_before", "correction_after"])("refuses unsupported bundle reference %s", async mode => {
  engine(); const { upload } = await teamFixture(a, true), entries = outbox(upload);
  changePayload(entries[1], "resultPayload", p => {
    const result = p.result as Record<string, unknown>, attempt = (result.attempts as Record<string, unknown>[])[0];
    if (mode === "unknown_schema") p.schemaVersion = 99;
    if (mode === "execution") p.exerciseExecutionId = c;
    if (mode === "protocol") (attempt.measurements as Record<string, unknown>[])[0].protocolVersion = 999;
    if (mode.startsWith("correction")) {
      const before = clone(attempt), after = clone(attempt);
      (mode === "correction_before" ? before : after).kind = "future";
      p.activeAttemptCorrections = [{ id: c, kind: "updated", attemptId: attempt.id, correctedAt: "2026-10-01T10:20:00.000Z", before, after }];
    }
  });
  expect((await evaluate({ [key(12)]: json({ ...emptySync(), teamEntries: entries }) })).historicalStatus).toBe("preserved_unusable");
});

it.each(["digest", "profiles", "decode_failed"])("refuses a second-decode correlation failure: %s", async mode => {
  engine(); const encoded = await wire({ [key(7)]: "true" }), actual = archive.decodeInstallationTransferV3;
  let calls = 0;
  vi.spyOn(archive, "decodeInstallationTransferV3").mockImplementation(async raw => {
    const result = await actual(raw); calls++; if (calls !== 2 || !result.ok) return result;
    if (mode === "decode_failed") return { ok: false as const, code: "fingerprint_failed" as const };
    return { ok: true as const, value: { ...result.value, envelope: { ...result.value.envelope, ...(mode === "digest" ? { packageDigest: "f".repeat(64) } : { profiles: [] }) } } };
  });
  expect(await evaluateInstallationTransferHistoricalV3(encoded)).toEqual({ ok: false, code: "historical_evaluation_unavailable" }); expect(calls).toBe(2);
});

// Independent CODE review witnesses, adopted without changing their assertions.
it.each(["exercises","versions","measurementProtocols"])("never reads a malformed catalog %s accessor",async name=>{
 engine();let touches=0;const malformed={...EXERCISE_CATALOG};Object.defineProperty(malformed,name,{enumerable:true,get(){touches++;throw Error("private marker");}});
 vi.spyOn(catalogModule,"EXERCISE_CATALOG","get").mockReturnValue(malformed);
 expect(await evaluateInstallationTransferHistoricalV3(await wire())).toEqual({ok:false,code:"historical_evaluation_unavailable"});expect(touches).toBe(0);
});
it("preserves actual same-Profile cached-only protocol fallback and blocks future protocol snapshot",async()=>{
 engine();const {record,upload}=await teamFixture(a,true),entries=outbox(upload);entries[0].status="synced";entries[0].coordinationPayload="";
 const s={...emptySync(),teamExerciseResults:[record],teamEntries:entries};expect((await evaluate({[key(12)]:json(s)})).historicalStatus).toBe("catalog_candidate");
 (record.sharedExecution.configuration.enabledMeasurementProtocols[0] as unknown as Record<string,unknown>).label="foreign";
 expect((await evaluate({[key(12)]:json(s)})).historicalStatus).not.toBe("catalog_candidate");
});
it("checks bundle before and after protocol references independently",async()=>{
 engine();const {upload}=await teamFixture(a,true),entries=outbox(upload);changePayload(entries[1],"resultPayload",p=>{const attempt=clone(((p.result as Record<string, unknown>).attempts as Record<string, unknown>[])[0]);const after=clone(attempt);(after.measurements as Record<string, unknown>[])[0].protocolVersion=987;p.activeAttemptCorrections=[{id:c,kind:"updated",attemptId:attempt.id,correctedAt:"2026-10-01T10:20:00.000Z",before:attempt,after}];});
 expect((await evaluate({[key(12)]:json({...emptySync(),teamEntries:entries})})).historicalStatus).toBe("preserved_unusable");
});
it("does not infer bare protocols from compatible lists when no execution context exists",async()=>{
 engine();const {upload}=await teamFixture(a,true),entries=outbox(upload);entries[0].status="synced";entries[0].coordinationPayload="";
 expect((await evaluate({[key(12)]:json({...emptySync(),teamEntries:entries})})).historicalStatus).toBe("preserved_unusable");
});
it("keeps unknown carrier fields closed without demanding unrelated Team value semantics",async()=>{
 engine();const {upload}=await teamFixture(a,true),entries=outbox(upload);changePayload(entries[1],"resultPayload",p=>{((p.result as Record<string, unknown>).attempts as Record<string, unknown>[])[0].futureCarrier={protocolId:"unknown",protocolVersion:99};});
 expect((await evaluate({[key(12)]:json({...emptySync(),teamEntries:entries})})).historicalStatus).toBe("preserved_unusable");
});
it("does not treat known but mismatched execution version as future top-level payload routing",async()=>{
 engine();const {upload}=await teamFixture(a,true),entries=outbox(upload);changePayload(entries[0],"coordinationPayload",p=>{(p.execution as Record<string, unknown>).schemaVersion=1;});
 const r=await evaluate({[key(12)]:json({...emptySync(),teamEntries:entries})});expect(r.historicalStatus).toBe("catalog_candidate");
});
it.each(["exercises","versions","measurementProtocols"])("does not access Proxy length through ordinary Get for catalog %s",async name=>{
 engine();let touches=0;const source=EXERCISE_CATALOG[name as "exercises" | "versions" | "measurementProtocols"];const replacement=new Proxy(source,{get(target,key,receiver){if(key==="length")touches++;return Reflect.get(target,key,receiver);}});
 vi.spyOn(catalogModule,"EXERCISE_CATALOG","get").mockReturnValue({...EXERCISE_CATALOG,[name]:replacement});
 expect(await evaluateInstallationTransferHistoricalV3(await wire())).toMatchObject({ok:true,value:{historicalStatus:"catalog_candidate"}});expect(touches).toBe(0);
});
it("rejects an invalid first catalog array without consulting a later data accessor",async()=>{
 engine();let touches=0;const actualVersions=EXERCISE_CATALOG.versions;const replacement={...EXERCISE_CATALOG,exercises:null};Object.defineProperty(replacement,"versions",{enumerable:true,get(){touches++;return actualVersions;}});
 vi.spyOn(catalogModule,"EXERCISE_CATALOG","get").mockReturnValue(replacement as unknown as typeof EXERCISE_CATALOG);
 expect(await evaluateInstallationTransferHistoricalV3(await wire())).toEqual({ok:false,code:"historical_evaluation_unavailable"});expect(touches).toBe(0);
});
it("keeps metadata accessors in asset definitions inert while refusing",async()=>{
 engine();let touches=0;const definition={...assets.PUBLIC_EXERCISE_ASSET_DEFINITIONS[0]};Object.defineProperty(definition,"path",{enumerable:true,get(){touches++;return "/foreign";}});
 vi.spyOn(assets,"PUBLIC_EXERCISE_ASSET_DEFINITIONS","get").mockReturnValue([definition,...assets.PUBLIC_EXERCISE_ASSET_DEFINITIONS.slice(1)]);
 expect(await evaluateInstallationTransferHistoricalV3(await wire())).toEqual({ok:false,code:"historical_evaluation_unavailable"});expect(touches).toBe(0);
});

it.each(["PUBLIC_EXERCISE_ASSET_DEFINITIONS", "PUBLIC_EXERCISE_ASSET_IDS"] as const)("never uses original array length Get for actual asset registry %s", async name => {
  engine(); let touches = 0; const actual = assets[name];
  const replacement = new Proxy(actual, { get(target, key, receiver) { if (key === "length") touches++; return Reflect.get(target, key, receiver); } });
  if (name === "PUBLIC_EXERCISE_ASSET_IDS") vi.spyOn(assets, name, "get").mockReturnValue(replacement as typeof assets.PUBLIC_EXERCISE_ASSET_IDS);
  else vi.spyOn(assets, name, "get").mockReturnValue(replacement as typeof assets.PUBLIC_EXERCISE_ASSET_DEFINITIONS);
  expect((await evaluate({})).historicalStatus).toBe("catalog_candidate"); expect(touches).toBe(0);
});
it("refuses an oversized catalog array from its descriptor before traversing entries", async () => {
  engine(); let touches = 0; const replacement = new Proxy(Array(8193), { get() { touches++; throw null; } });
  vi.spyOn(catalogModule, "EXERCISE_CATALOG", "get").mockReturnValue({ ...EXERCISE_CATALOG, exercises: replacement });
  expect(await evaluateInstallationTransferHistoricalV3(await wire())).toEqual({ ok: false, code: "historical_evaluation_unavailable" }); expect(touches).toBe(0);
});
