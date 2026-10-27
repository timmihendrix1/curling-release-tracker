// Private historical compatibility only; no storage, delivery or publication grant.
import { decodeInstallationTransferV3 } from "./installationTransferV3";
import { evaluateInstallationTransferDomainsV3 } from "./installationTransferSemantics";
import { PROFILE_SCOPED_SPORTING_STORAGE_KEYS, profileScopedSportingStorageKey } from "./profileScopedSportingPersistence";
import { parseBoundedJson } from "../supabase/providerCredentialContract";
import { EXERCISE_CATALOG } from "../exercises/catalog";
import { RELEASE_TIME_VERSION_ID } from "../exercises/content";
import { findExerciseVersion, findMeasurementProtocol } from "../exercises/lookup";
import { validateExerciseCatalogPackage } from "../exercises/validation";
import { PUBLIC_EXERCISE_ASSET_DEFINITIONS, PUBLIC_EXERCISE_ASSET_IDS, PUBLIC_EXERCISE_DIAGRAM_PATHS } from "../exercises/restrictedAssetCatalog";
import { deserializeTrainingSession, deserializeAssessmentRun } from "../cloudSporting/records";
import type { CloudSportingRecord } from "../cloudSporting/types";

type Obj = Record<string, unknown>;
type Status = "catalog_candidate" | "preserved_unusable" | "not_evaluated";
type Finding = Readonly<{ profileIndex: number; historicalStatus: Status; exerciseSnapshots: number; protocolSnapshots: number; registeredAssets: number }>;
const budget = Symbol(), maximumNodes = 262_144;
function bad(): never { throw null; }
function obj(v: unknown): Obj { return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Obj : bad(); }
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : bad(); }
function str(v: unknown): string { return typeof v === "string" ? v : bad(); }
function exact(v: unknown, names: readonly string[], optional: readonly string[] = []): Obj {
  const o = obj(v), keys = Object.keys(o);
  if (names.some(k => !Object.hasOwn(o, k)) || keys.some(k => !names.includes(k) && !optional.includes(k))) bad();
  return o;
}
function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") return typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Object.is(a, b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return Object.is(a, b);
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  const x = obj(a), y = obj(b), ak = Object.keys(x).filter(k => x[k] !== undefined).sort(), bk = Object.keys(y).filter(k => y[k] !== undefined).sort();
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && same(x[k], y[k]));
}
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}
/** Closed data capture of actual module metadata. Never execute accessors/toJSON. */
function catalogCapture() {
  const sourceCatalog = EXERCISE_CATALOG, sourceDefinitions = PUBLIC_EXERCISE_ASSET_DEFINITIONS;
  const sourceIds = PUBLIC_EXERCISE_ASSET_IDS, sourcePaths = PUBLIC_EXERCISE_DIAGRAM_PATHS;
  let nodes = 0;
  const active = new Set<object>(), lengths = new WeakMap<object, number>();
  function data(value: unknown, name: string): unknown {
    const field = Object.getOwnPropertyDescriptor(obj(value), name);
    return field && Object.hasOwn(field, "value") ? field.value : bad();
  }
  function length(value: unknown, maximum: number): number {
    if (!Array.isArray(value)) bad();
    const prior = lengths.get(value);
    if (prior !== undefined) return prior <= maximum ? prior : bad();
    const field = Object.getOwnPropertyDescriptor(value, "length"), size = field?.value;
    if (!field || !Object.hasOwn(field, "value") || typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 || size > maximum) bad();
    lengths.set(value, size); return size;
  }
  function copy(value: unknown, depth = 0): unknown {
    if (++nodes > maximumNodes || depth > 32) bad();
    if (value === null || typeof value === "boolean" || value === undefined) return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : bad();
    if (typeof value === "string") return value.length <= 1_048_576 ? value : bad();
    if (typeof value !== "object" || active.has(value)) bad();
    active.add(value);
    const arrayLength = Array.isArray(value) ? length(value, 8192) : null;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).length > 8194 || Object.getOwnPropertySymbols(fields).length) bad();
    for (const field of Object.values(fields)) if (!Object.hasOwn(field, "value")) bad();
    let result: unknown;
    if (arrayLength !== null) {
      if (fields.length?.value !== arrayLength || Object.keys(fields).some(k => k !== "length" && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= arrayLength))) bad();
      result = Array.from({ length: arrayLength }, (_, i) => fields[String(i)] ? copy(fields[String(i)].value, depth + 1) : bad());
    } else {
      const out: Obj = Object.create(null);
      for (const [k, field] of Object.entries(fields)) {
        if (!field.enumerable || k.length > 128) bad();
        out[k] = copy(field.value, depth + 1);
      }
      result = out;
    }
    active.delete(value); return frozen(result);
  }
  // Bound actual registry arrays before capture or the domain validator traverses them.
  for (const name of ["exercises", "versions", "measurementProtocols"]) length(data(sourceCatalog, name), 8192);
  length(sourceDefinitions, 4096); length(sourceIds, 4096);
  const catalog = copy(sourceCatalog) as typeof EXERCISE_CATALOG;
  const definitions = arr(copy(sourceDefinitions)), ids = arr(copy(sourceIds)), paths = obj(copy(sourcePaths));
  if (!validateExerciseCatalogPackage(catalog).valid || definitions.length !== ids.length || definitions.length !== Object.keys(paths).length) bad();
  const assets = new Set<string>();
  for (const item of definitions) {
    const definition = exact(item, ["assetId", "path"]), id = str(definition.assetId);
    if (!/^swiss-curling-(guard|draw|softshot)-exercise-[1-9][0-9]*-v[1-9][0-9]*$/.test(id) || assets.has(id) || ids.filter(v => v === id).length !== 1 || definition.path !== `/exercise-diagrams/${id}.png` || !Object.hasOwn(paths, id) || paths[id] !== definition.path) bad();
    assets.add(id);
  }
  function asset(version: unknown): string | null {
    const diagram = obj(version).diagram;
    if (diagram === undefined || obj(diagram).kind !== "attributed-source-image") return null;
    const id = str(obj(obj(diagram).assetReference).assetId);
    if (!assets.has(id)) bad(); return id;
  }
  for (const version of catalog.versions) {
    asset(version);
    for (const ref of version.compatibleMeasurementProtocols) if (!findMeasurementProtocol(catalog, ref.protocolId, ref.protocolVersion)) bad();
  }
  return { catalog, asset };
}

/** All declared Profiles must be examined before any global catalog candidate. */
export async function evaluateInstallationTransferHistoricalV3(wire: unknown) {
  const domain = await evaluateInstallationTransferDomainsV3(wire);
  if (!domain.ok) return domain;
  try {
    const decoded = await decodeInstallationTransferV3(wire);
    if (!decoded.ok) bad();
    const envelope = decoded.value.envelope, profiles = envelope.profiles as string[];
    if (domain.value.packageDigest !== envelope.packageDigest || domain.value.profiles.length !== profiles.length || domain.value.profiles.some((v, i) => v.profileIndex !== i)) bad();
    const { catalog, asset } = catalogCapture(), findings: Finding[] = [];
    let parsedNodes = 0;
    function parse(raw: unknown): unknown {
      const tree = parseBoundedJson(str(raw), 1_048_576, 1_048_576);
      function charge(v: unknown) { if (++parsedNodes > maximumNodes) throw budget; if (v !== null && typeof v === "object") for (const child of Object.values(v)) charge(child); }
      charge(tree); return tree;
    }
    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
      let exerciseSnapshots = 0, protocolSnapshots = 0;
      const assets = new Set<string>();
      let historicalStatus: Status = "not_evaluated";
      if (domain.value.profiles[profileIndex].domainStatus !== "preserved_unusable") try {
        const items = envelope.items as Obj[], keys = PROFILE_SCOPED_SPORTING_STORAGE_KEYS;
        const tree = (index: number): unknown => {
          const item = items.find(v => v.key === profileScopedSportingStorageKey(profiles[profileIndex], keys[index]));
          if (!item) bad(); return item.presence === "present" ? parse(item.raw) : undefined;
        };
        const current = tree(0), history = tree(1), plans = tree(4), sync = tree(12), contexts: Obj[] = [];
        function exercise(snapshot: unknown) {
          const s = obj(snapshot), actual = findExerciseVersion(catalog, str(s.id));
          if (!actual || !same(s, actual)) bad();
          const id = asset(actual); if (id) assets.add(id); exerciseSnapshots++;
        }
        function protocol(snapshot: unknown) {
          const s = obj(snapshot);
          if (typeof s.version !== "number" || !same(s, findMeasurementProtocol(catalog, str(s.id), s.version))) bad();
          protocolSnapshots++;
        }
        function attempt(value: unknown, enabled: unknown[] | null, upload = false) {
          const a = obj(value);
          const base = ["id", "athleteProfileId", "roleAssignmentSegmentId", "sequenceNumber", "createdAt", "kind", "actualHandle", "measurements", "recordedByProfileId"];
          if (a.kind === "shotmaking") exact(a, ["kind", "measurements", "evaluation"], [...base, "intendedHandle", "teamRoleContextOverride"]);
          else if (a.kind === "measurement") exact(a, ["kind", "measurements"], base);
          else bad();
          if (upload && Object.hasOwn(a, "recordedByProfileId")) bad();
          for (const value of arr(a.measurements)) {
            const m = exact(value, ["id", "protocolId", "protocolVersion", "value", "source", "recordedAt"], ["observerProfileId", "timingResultId", "deviceId", "laneId"]);
            if (typeof m.protocolId !== "string" || typeof m.protocolVersion !== "number" || !enabled?.some(p => obj(p).id === m.protocolId && obj(p).version === m.protocolVersion)) bad();
          }
        }
        function result(value: unknown, enabled: unknown[] | null, upload = false) { for (const a of arr(obj(value).attempts)) attempt(a, enabled, upload); }
        function corrections(values: unknown, enabled: unknown[] | null, upload = false) {
          for (const value of arr(values)) {
            const c = exact(value, ["id", "kind", "attemptId", "correctedAt", "before"], ["after", "correctedByProfileId"]);
            if (upload && Object.hasOwn(c, "correctedByProfileId")) bad();
            attempt(c.before, enabled, upload);
            if (c.kind === "updated") attempt(c.after, enabled, upload);
            else if (c.kind !== "annulled" || c.after !== undefined) bad();
          }
        }
        function execution(value: unknown, retainContext = false): Obj {
          const e = obj(value); exercise(e.exerciseVersionSnapshot);
          const enabled = arr(obj(e.configuration).enabledMeasurementProtocols);
          for (const p of enabled) protocol(p);
          if (e.athleteResults !== undefined) for (const r of arr(e.athleteResults)) result(r, enabled);
          if (e.activeAttemptCorrections !== undefined) corrections(e.activeAttemptCorrections, enabled);
          if (retainContext) contexts.push(e); return e;
        }
        function step(value: unknown, legacy = false) {
          const s = obj(value);
          if (s.exerciseVersionSnapshot !== undefined) exercise(s.exerciseVersionSnapshot);
          else if (legacy && (s.type === undefined || s.type === "release-timing")) {
            const release = findExerciseVersion(catalog, RELEASE_TIME_VERSION_ID); if (!release) bad(); exercise(release);
          } else bad();
        }
        function session(value: unknown, retainContext = false) {
          const s = obj(value);
          if (s.releaseTimingExerciseVersionSnapshot !== undefined) exercise(s.releaseTimingExerciseVersionSnapshot);
          if (s.planExecution !== undefined) for (const entry of arr(obj(s.planExecution).steps)) step(obj(entry).step);
          if (s.exerciseExecutions !== undefined) for (const e of arr(s.exerciseExecutions)) execution(e, retainContext);
        }
        function assessment(value: unknown) {
          const r = obj(value), template = obj(r.templateSnapshot);
          if (r.templateId !== template.id || r.templateVersion !== template.version) bad();
        }
        if (current !== undefined) session(current, true);
        if (history !== undefined) for (const s of arr(history)) session(s, true);
        if (plans !== undefined) for (const p of arr(obj(plans).plans)) for (const s of arr(obj(p).steps)) step(s, obj(plans).schemaVersion === 1);
        for (const index of [3, 10, 11]) {
          const state = tree(index); if (state === undefined) continue;
          const root = obj(state);
          if (root.currentRun !== undefined) assessment(root.currentRun);
          if (root.history !== undefined) for (const run of arr(root.history)) assessment(run);
        }
        if (sync !== undefined) {
          const state = obj(sync);
          if (state.activeTeamExerciseDraft !== undefined && state.activeTeamExerciseDraft !== null) execution(state.activeTeamExerciseDraft, true);
          for (const value of state.teamExerciseResults === undefined ? [] : arr(state.teamExerciseResults)) {
            const owned = obj(value), shared = execution(owned.sharedExecution, true), enabled = arr(obj(shared.configuration).enabledMeasurementProtocols);
            result(owned.result, enabled);
            if (owned.originalResult !== undefined) result(owned.originalResult, enabled);
            if (owned.activeAttemptCorrections !== undefined) corrections(owned.activeAttemptCorrections, enabled);
            if (owned.postCompletionRevisions !== undefined) for (const revision of arr(owned.postCompletionRevisions)) if (obj(revision).resultingResult !== null) result(obj(revision).resultingResult, enabled);
          }
          for (const value of arr(state.entries)) {
            const entry = obj(value); if (entry.desired === "deleted") continue;
            const payload = parse(entry.payload), record = { recordKind: entry.recordKind, recordId: entry.recordId, schemaVersion: entry.schemaVersion, payload: entry.payload, contentSha256: entry.contentSha256, recordedAt: entry.recordedAt } as CloudSportingRecord;
            if (entry.recordKind === "training_session") { if (!deserializeTrainingSession(record)) bad(); session(payload); }
            else if (entry.recordKind === "assessment_run") { if (!deserializeAssessmentRun(record)) bad(); assessment(payload); }
            else bad();
          }
          const teamEntries = state.teamEntries === undefined ? [] : arr(state.teamEntries).map(obj), coordinations = new Map<Obj, Obj>();
          for (const entry of teamEntries.filter(v => v.entryKind === "team_exercise_session")) {
            if (entry.coordinationPayload === "") continue;
            const payload = exact(parse(entry.coordinationPayload), ["schemaVersion", "execution"]);
            if (![1, 2].includes(payload.schemaVersion as number) || payload.schemaVersion !== entry.schemaVersion) bad();
            const shared = exact(payload.execution, ["id", "trainingSessionId", "exerciseVersionSnapshot", "evaluationBasis", "configuration", "status", "startedAt", "roleAssignmentSegments", "teamContext", "schemaVersion"], ["completedAt", "abandonedAt"]);
            if (![1, 2].includes(shared.schemaVersion as number)) bad();
            exact(shared.configuration, ["sweeperCount", "sweepingUsed", "enabledMeasurementProtocols", "deviations"], ["selectedVariationId", "plannedVolume"]);
            exact(shared.teamContext, ["kind", "teamId", "participantRoster", "rotation"]);
            const e = execution(payload.execution);
            if (e.trainingSessionId !== entry.sessionId || obj(e.teamContext).teamId !== entry.teamId || !arr(entry.executionIds).includes(e.id)) bad();
            coordinations.set(entry, e);
          }
          for (const entry of teamEntries.filter(v => v.entryKind === "team_exercise_bundle")) {
            if (entry.resultPayload === "") continue;
            const payload = obj(parse(entry.resultPayload));
            if (![1, 2].includes(payload.schemaVersion as number) || payload.schemaVersion !== entry.schemaVersion) bad();
            exact(payload, ["schemaVersion", "exerciseExecutionId", "result", ...(payload.schemaVersion === 2 ? ["activeAttemptCorrections"] : [])]);
            const parent = teamEntries.find(v => v.entryKind === "team_exercise_session" && v.sessionId === entry.sessionId);
            if (!parent || !arr(parent.executionIds).includes(payload.exerciseExecutionId) || !arr(entry.executionIds).includes(payload.exerciseExecutionId)) bad();
            const coordination = coordinations.get(parent);
            let enabled: unknown[] | null = null;
            if (coordination) {
              if (coordination.id !== payload.exerciseExecutionId) bad();
              enabled = arr(obj(coordination.configuration).enabledMeasurementProtocols);
            } else {
              const matching = contexts.filter(e => e.id === payload.exerciseExecutionId && e.trainingSessionId === parent.sessionId && e.teamContext !== undefined && obj(e.teamContext).teamId === parent.teamId);
              if (matching.length) {
                const first = matching[0]; enabled = arr(obj(first.configuration).enabledMeasurementProtocols);
                if (matching.some(e => !same(e.exerciseVersionSnapshot, first.exerciseVersionSnapshot) || !same(obj(e.configuration).enabledMeasurementProtocols, enabled))) bad();
              }
            }
            exact(payload.result, ["id", "athleteProfileId", "attempts", "createdAt", "updatedAt"]);
            result(payload.result, enabled, true);
            if (payload.schemaVersion === 2) corrections(payload.activeAttemptCorrections, enabled, true);
          }
        }
        historicalStatus = "catalog_candidate";
      } catch (error) { if (error === budget) throw error; historicalStatus = "preserved_unusable"; }
      findings.push({ profileIndex, historicalStatus, exerciseSnapshots, protocolSnapshots, registeredAssets: assets.size });
    }
    const historicalStatus: Status = findings.some(v => v.historicalStatus === "preserved_unusable") ? "preserved_unusable" : findings.some(v => v.historicalStatus === "not_evaluated") ? "not_evaluated" : "catalog_candidate";
    return { ok: true as const, value: frozen({ schemaVersion: 1 as const, packageDigest: domain.value.packageDigest, domain: domain.value, historicalStatus, profiles: findings, mayIssue: false as const, mayPublish: false as const, mayMount: false as const }) };
  } catch { return { ok: false as const, code: "historical_evaluation_unavailable" as const }; }
}
