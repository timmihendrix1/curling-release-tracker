// Private interpretation only. Immutable archive bytes never become live storage.
import { decodeInstallationTransferV3 } from "./installationTransferV3";
import { createProfileScopedSportingRepositories, createProfileScopedSportingStorageAdapter, PROFILE_SCOPED_SPORTING_STORAGE_KEYS, profileScopedSportingStorageKey } from "./profileScopedSportingPersistence";
import { createSportingSyncStateRepository } from "../cloudSporting/syncStateRepository";
import { parseBoundedJson } from "../supabase/providerCredentialContract";
import { EXERCISE_CATALOG } from "../exercises/catalog";
import { RELEASE_TIME_VERSION_ID } from "../exercises/content";
import { findExerciseVersion } from "../exercises/lookup";
import { isPlanExecutable } from "../trainingPlans/validation";
import type { DomainLoadResult, RemovableStorageAdapter } from "./types";

type Status = "absent" | "preserved_candidate" | "recovery_required" | "preserved_unusable";
type Interpretation = "none" | "capture_paused" | "assessment_recovery" | "schema_interpretation";
type Domain = "current_session" | "session_history" | "history_filters" | "assessment" | "training_plans" | "tolerance_profiles" | "random_profiles" | "show_introduction" | "threshold_preset" | "custom_threshold" | "cloud_sync";
type Finding = Readonly<{ domain: Domain; status: Status; interpretation: Interpretation; plansExecutable: boolean | null }>;
type ProfileFinding = Readonly<{ profileIndex: number; domainStatus: Status; domains: readonly Finding[] }>;
type Report = Readonly<{ schemaVersion: 1; packageDigest: string; domainStatus: Status; historicalStatus: "not_evaluated"; profiles: readonly ProfileFinding[]; mayIssue: false; mayPublish: false; mayMount: false }>;
type Tree = null | boolean | number | string | Tree[] | { [key: string]: Tree | undefined };
type Obj = { [key: string]: Tree | undefined };
type Audit = Readonly<{ method: "get" | "set" | "remove"; key: unknown; value: unknown; before: string | null; after: string | null }>;
const keys = PROFILE_SCOPED_SPORTING_STORAGE_KEYS;
const primitiveJsonStringify = JSON.stringify;
function bad(): never { throw null; }
const rec = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : bad();
const list = (value: unknown): Tree[] => Array.isArray(value) ? value as Tree[] : bad();
function exact(value: unknown, names: readonly string[], optional: readonly string[] = []): Obj {
  const o = rec(value), present = Object.keys(o);
  if (names.some(name => !Object.hasOwn(o, name)) || present.some(name => !names.includes(name) && !optional.includes(name))) bad();
  return o;
}
function same(left: unknown, right: unknown): boolean {
  if (typeof left === "number" || typeof right === "number") return typeof left === "number" && typeof right === "number" && Number.isFinite(left) && Number.isFinite(right) && Object.is(left, right);
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return Object.is(left, right);
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((v, i) => same(v, right[i]));
  const a = left as Obj, b = right as Obj, ak = Object.keys(a).filter(k => a[k] !== undefined).sort(), bk = Object.keys(b).filter(k => b[k] !== undefined).sort();
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && same(a[k], b[k]));
}
function requireSame(left: unknown, right: unknown): void { if (!same(left, right)) bad(); }
/** Independent normal JSON bytes for already-owned state. Container hooks never run. */
function ownedJson(value: unknown): string {
  const maximum = 1_048_576, chunks: string[] = [], active = new Set<object>();
  let size = 0, nodes = 0;
  function append(part: string) { if (part.length > maximum - size) bad(); size += part.length; chunks.push(part); }
  function string(value: string) {
    let length = 2;
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c === 34 || c === 92 || c === 8 || c === 9 || c === 10 || c === 12 || c === 13) length += 2;
      else if (c < 32) length += 6;
      else if (c >= 0xd800 && c <= 0xdbff) {
        const next = value.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { length += 2; i++; } else length += 6;
      } else length += c >= 0xdc00 && c <= 0xdfff ? 6 : 1;
      if (length > maximum - size) bad();
    }
    if (length > maximum - size) bad();
    const encoded = primitiveJsonStringify(value);
    if (typeof encoded !== "string" || encoded.length !== length) bad();
    append(encoded);
  }
  function data(object: object, name: string): unknown {
    const field = Object.getOwnPropertyDescriptor(object, name);
    if (!field) return undefined;
    if (!Object.hasOwn(field, "value")) bad();
    return field.value;
  }
  function write(value: unknown, depth: number): void {
    if (nodes >= 262_144) bad(); nodes++;
    if (typeof value === "string") { string(value); return; }
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      if (typeof value === "number" && !Number.isFinite(value)) bad();
      const encoded = Object.is(value, -0) ? "-0" : primitiveJsonStringify(value);
      if (typeof encoded !== "string") bad(); append(encoded); return;
    }
    if (typeof value !== "object" || depth >= 32 || active.has(value)) bad();
    active.add(value);
    if (Array.isArray(value)) {
      append("[");
      for (let i = 0; i < value.length; i++) { if (i) append(","); const child = data(value, String(i)); write(child === undefined ? null : child, depth + 1); }
      append("]");
    } else {
      append("{"); let first = true;
      for (const name of Object.keys(value)) {
        const child = data(value, name); if (child === undefined) continue;
        if (!first) append(","); first = false; string(name); append(":"); write(child, depth + 1);
      }
      append("}");
    }
    active.delete(value);
  }
  write(value, 0); return chunks.join("");
}
function aggregate(values: readonly { status: Status }[]): Status {
  return values.some(v => v.status === "preserved_unusable") ? "preserved_unusable" : values.some(v => v.status === "recovery_required") ? "recovery_required" : "preserved_candidate";
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function overlay(seed: ReadonlyMap<string, string | null>) {
  const working = new Map(seed), audit: Audit[] = [];
  let poisoned = false;
  const error = () => ({ kind: "storage_unavailable" as const });
  const adapter: RemovableStorageAdapter = Object.freeze({
    async get(key: string) {
      const allowed = typeof key === "string" && seed.has(key), before = allowed ? working.get(key)! : null;
      audit.push(Object.freeze({ method: "get", key, value: undefined, before, after: before }));
      if (!allowed || poisoned) { poisoned = true; return { status: "read_failed" as const, fallback: null, error: error() }; }
      return { status: "value" as const, value: before };
    },
    async set(key: string, value: string) {
      const allowed = typeof key === "string" && seed.has(key) && typeof value === "string", before = typeof key === "string" && seed.has(key) ? working.get(key)! : null;
      if (allowed && !poisoned) working.set(key, value); else poisoned = true;
      audit.push(Object.freeze({ method: "set", key, value, before, after: allowed ? working.get(key)! : null }));
      return poisoned ? { ok: false as const, error: error() } : { ok: true as const };
    },
    async remove(key: string) {
      const allowed = typeof key === "string" && seed.has(key), before = allowed ? working.get(key)! : null;
      if (allowed && !poisoned) working.set(key, null); else poisoned = true;
      audit.push(Object.freeze({ method: "remove", key, value: undefined, before, after: allowed ? working.get(key)! : null }));
      return poisoned ? { ok: false as const, error: error() } : { ok: true as const };
    },
  });
  return { adapter, audit, poisoned: () => poisoned };
}
function verifyTrace(seed: ReadonlyMap<string, string | null>, audit: readonly Audit[]) {
  const replay = new Map(seed);
  for (const event of audit) {
    if (typeof event.key !== "string" || !replay.has(event.key) || event.before !== replay.get(event.key)) bad();
    if (event.method === "get") { if (event.after !== event.before) bad(); }
    else {
      if (event.method === "set" ? typeof event.value !== "string" || event.after !== event.value : event.after !== null) bad();
      replay.set(event.key, event.after);
    }
  }
}
function verifyAudit(seed: ReadonlyMap<string, string | null>, audit: readonly Audit[], expected: readonly { key: string; value: string }[]) {
  const writes = audit.filter(event => event.method !== "get");
  if (writes.length !== expected.length || writes.some((event, i) => event.method !== "set" || event.key !== expected[i].key || event.value !== expected[i].value || event.after !== expected[i].value)) bad();
  verifyTrace(seed, audit);
}
function ids(values: Tree[]): void {
  const seen = new Set<string>();
  for (const value of values) { const id = rec(value).id; if (typeof id !== "string" || !id.length || seen.has(id)) bad(); seen.add(id); }
}
function assessmentState(value: unknown): Obj {
  const o = exact(value, ["schemaVersion", "history"], ["currentRun"]);
  if (o.schemaVersion !== 1) bad();
  const history = list(o.history); ids(history);
  if (history.some(run => !["completed", "incomplete"].includes(rec(run).status as string))) bad();
  if (o.currentRun !== undefined) { const run = rec(o.currentRun); if (typeof run.id !== "string" || !run.id.length) bad(); }
  return o;
}
function filtersShape(value: unknown): Obj {
  const o = exact(value, ["trainingCategory", "measuredQuantity", "measurementMode", "dateRange", "handles", "shotTypes", "sessionIds", "blockIds", "thresholdComparisonMode"], ["targetRange"]);
  if (![null, "fixed", "variable", "blind"].includes(o.trainingCategory as null | string) || ![null, "time", "speed"].includes(o.measuredQuantity as null | string) || ![null, "back-hog", "hog-hog"].includes(o.measurementMode as null | string)) bad();
  for (const name of ["handles", "shotTypes", "sessionIds", "blockIds"]) {
    const values = list(o[name]);
    if (values.some(v => typeof v !== "string")) bad();
    if (name === "handles" && values.some(v => v !== "in" && v !== "out") || name === "shotTypes" && values.some(v => v !== "draw" && v !== "takeout")) bad();
  }
  const date = rec(o.dateRange);
  if (date.preset === "custom") { exact(date, ["preset", "from", "to"]); if (typeof date.from !== "string" || typeof date.to !== "string") bad(); }
  else { exact(date, ["preset"]); if (!["all", "30d", "90d", "6m"].includes(date.preset as string)) bad(); }
  if (o.targetRange !== undefined) { const range = exact(o.targetRange, [], ["min", "max"]); for (const number of Object.values(range)) if (typeof number !== "number" || !Number.isFinite(number)) bad(); }
  const mode = rec(o.thresholdComparisonMode);
  if (mode.type === "original") exact(mode, ["type"]);
  else { exact(mode, ["type", "thresholds"]); if (mode.type !== "comparison") bad(); exact(mode.thresholds, ["onTarget", "acceptable"]); }
  return o;
}
function plansExpected(value: unknown): Obj {
  const root = exact(value, ["schemaVersion", "plans"]);
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2) bad();
  const plans = list(root.plans); ids(plans);
  if (root.schemaVersion === 2) return root;
  const release = findExerciseVersion(EXERCISE_CATALOG, RELEASE_TIME_VERSION_ID);
  if (!release) bad();
  return { ...root, schemaVersion: 2, plans: plans.map(value => {
    const plan = rec(value), steps = list(plan.steps); ids(steps);
    if (plan.schemaVersion !== 1) bad();
    return { ...plan, schemaVersion: 2, steps: steps.map(value => {
      const step = rec(value);
      if (step.type === "curated-exercise") return step;
      if (step.type !== undefined && step.type !== "release-timing") bad();
      if (step.exerciseVersionSnapshot !== undefined) requireSame(step.exerciseVersionSnapshot, release);
      return { ...step, type: "release-timing", exerciseVersionSnapshot: release as unknown as Tree };
    }) };
  }) };
}
function toleranceExpected(value: unknown): Obj {
  const root = exact(value, ["schemaVersion", "profiles", "defaultProfileId"]);
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2) bad();
  const profiles = list(root.profiles); ids(profiles);
  if (root.schemaVersion === 2) return root;
  return { ...root, schemaVersion: 2, profiles: profiles.map(value => {
    const p = exact(value, ["id", "name", "createdAt", "updatedAt", "onTarget", "acceptable"]);
    if (typeof p.onTarget !== "number" || typeof p.acceptable !== "number") bad();
    return { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, quantity: "time", tolerance: { onTarget: { lower: p.onTarget, upper: p.onTarget }, acceptable: { lower: p.acceptable, upper: p.acceptable } } };
  }) };
}
function syncExpected(value: unknown): Obj {
  const root = rec(value), version = root.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 6) bad();
  const names = ["schemaVersion", "entries", ...(version >= 2 ? ["teamEntries"] : []), ...(version >= 3 ? ["teamEligibilitySnapshots"] : []), ...(version >= 4 ? ["activeTeamExerciseDraft"] : []), ...(version >= 5 ? ["teamExerciseResults"] : [])];
  exact(root, names);
  for (const entry of [...list(root.entries), ...(version >= 2 ? list(root.teamEntries) : [])]) {
    const digest = rec(entry).contentSha256;
    if (typeof digest !== "string" || digest.length !== 64 || !/^[0-9a-f]{64}$/.test(digest)) bad();
  }
  const expected: Obj = { ...root, schemaVersion: 6, ...(version < 2 ? { teamEntries: [] } : {}), ...(version < 3 ? { teamEligibilitySnapshots: [] } : {}), ...(version < 4 ? { activeTeamExerciseDraft: null } : {}), ...(version < 5 ? { teamExerciseResults: [] } : {}) };
  if (version === 5) expected.teamExerciseResults = list(root.teamExerciseResults).map(value => {
    const record = rec(value);
    if (["originalResult", "postCompletionRevisions", "isVoided"].some(k => Object.hasOwn(record, k))) bad();
    return { ...record, originalResult: record.result, postCompletionRevisions: [], isVoided: false };
  });
  return expected;
}

/** Correlated findings only; no adapter, loaded content or usable-workspace grant. */
export async function evaluateInstallationTransferDomainsV3(wire: unknown) {
  const decoded = await decodeInstallationTransferV3(wire);
  if (!decoded.ok) return decoded;
  try {
    const envelope = decoded.value.envelope;
    const items = envelope.items as Obj[], profiles = envelope.profiles as string[];
    let parsedNodes = 0;
    function parse(raw: string): Tree {
      const value = parseBoundedJson(raw, 1_048_576, 1_048_576);
      function charge(tree: unknown): void {
        if (parsedNodes >= 262_144) bad(); parsedNodes++;
        if (tree !== null && typeof tree === "object") for (const child of Object.values(tree)) charge(child);
      }
      charge(value);
      return value;
    }
    const findings: ProfileFinding[] = [];
    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
      const profileId = profiles[profileIndex], seed = new Map<string, string | null>();
      const physical = (key: typeof keys[number]) => profileScopedSportingStorageKey(profileId, key);
      for (const key of keys) {
        const name = physical(key), item = items.find(item => item.key === name);
        if (!item) bad();
        seed.set(name, item.presence === "present" ? item.raw as string : null);
      }
      const copy = overlay(seed), { adapter, audit } = copy, parsed = new Map<string, Tree>();
      const repositories = createProfileScopedSportingRepositories(profileId, adapter);
      const sync = createSportingSyncStateRepository(createProfileScopedSportingStorageAdapter(profileId, adapter));
      const raw = (index: number) => seed.get(physical(keys[index]))!;
      const tree = (index: number): Tree => {
        const key = physical(keys[index]), source = raw(index);
        if (source === null) bad();
        if (!parsed.has(key)) parsed.set(key, parse(source));
        return parsed.get(key)!;
      };
      const domains: Finding[] = [];
      type Detail = { interpretation?: Interpretation; plansExecutable?: boolean; writes?: readonly { index: number; value: string }[] } | void;
      async function run<T>(domain: Domain, indices: readonly number[], load: () => Promise<DomainLoadResult<T>>, check: (value: T) => Detail | Promise<Detail>, json = true) {
        const start = audit.length;
        try {
          if (copy.poisoned()) bad();
          if (json) for (const index of indices) if (raw(index) !== null) tree(index);
          const result = await load();
          if (copy.poisoned() || result.status === "read_failed") bad();
          const absent = indices.every(index => raw(index) === null);
          if (result.status === "absent") {
            if (!absent || audit.slice(start).some(event => event.method !== "get")) bad();
            domains.push({ domain, status: "absent", interpretation: "none", plansExecutable: null }); return;
          }
          if (absent) bad();
          const detail = await check(result.value) ?? {};
          const writes = audit.slice(start).filter(event => event.method !== "get"), expected = detail.writes ?? [];
          if (writes.length !== expected.length || writes.some((event, i) => event.method !== "set" || event.key !== physical(keys[expected[i].index]) || event.value !== expected[i].value || event.after !== expected[i].value)) bad();
          // Every read, including a loader's read-after-write, must report the exact
          // current copy-local value. No source/staging ACK is manufactured.
          verifyTrace(seed, audit);
          const interpretation = detail.interpretation ?? "none";
          domains.push({ domain, status: expected.length || interpretation === "capture_paused" ? "recovery_required" : "preserved_candidate", interpretation, plansExecutable: detail.plansExecutable ?? null });
        } catch { domains.push({ domain, status: "preserved_unusable", interpretation: "none", plansExecutable: null }); }
      }
      await run("current_session", [0], () => repositories.session.loadCurrent(), value => {
        const before = rec(tree(0));
        if (typeof before.id !== "string" || !before.id.length) bad();
        const sequence = before.captureSequence;
        if (sequence !== null && typeof sequence === "object" && !Array.isArray(sequence) && sequence.status === "running") {
          const after = rec(value.captureSequence), pausedAt = after.pausedAt;
          if (after.status !== "paused" || typeof pausedAt !== "string" || !Number.isFinite(Date.parse(pausedAt))) bad();
          requireSame({ ...before, captureSequence: { ...sequence, status: "paused", pausedAt } }, value);
          return { interpretation: "capture_paused" };
        }
        requireSame(before, value);
      });
      await run("session_history", [1], () => repositories.session.loadHistory(), value => { const before = list(tree(1)); ids(before); requireSame(before, value); });
      await run("history_filters", [2], () => repositories.historyFilters.load(), value => requireSame(filtersShape(tree(2)), value));
      await run("assessment", [3, 10, 11], () => repositories.assessment.loadState(), async value => {
        const combined = raw(3) === null ? null : assessmentState(tree(3));
        const draft = raw(10) === null ? null : exact(tree(10), ["schemaVersion"], ["currentRun"]);
        const history = raw(11) === null ? null : exact(tree(11), ["schemaVersion", "history"]);
        if (draft && draft.schemaVersion !== 1 || history && history.schemaVersion !== 1 || value.currentRunQuarantined) bad();
        const shadowWrites: { index: number; value: string }[] = [];
        const fullSplit = draft !== null && history !== null;
        // Even an inert older shadow must be lossless under the ACTUAL loader.
        if (combined && fullSplit) {
          const shadowSeed = new Map(seed); shadowSeed.set(physical(keys[10]), null); shadowSeed.set(physical(keys[11]), null);
          const shadow = overlay(shadowSeed);
          const loaded = await createProfileScopedSportingRepositories(profileId, shadow.adapter).assessment.loadState();
          if (shadow.poisoned() || loaded.status !== "value" || loaded.value.currentRunQuarantined) bad();
          requireSame(combined, loaded.value.state);
          verifyAudit(shadowSeed, shadow.audit, [
            { key: physical(keys[11]), value: ownedJson({ schemaVersion: 1, history: loaded.value.state.history }) },
            { key: physical(keys[10]), value: ownedJson({ schemaVersion: 1, ...(loaded.value.state.currentRun ? { currentRun: loaded.value.state.currentRun } : {}) }) },
          ]);
        }
        const before = assessmentState(fullSplit ? { schemaVersion: 1, ...(Object.hasOwn(draft!, "currentRun") ? { currentRun: draft!.currentRun } : {}), history: history!.history } : combined);
        let expected = before;
        const duplicate = before.currentRun === undefined ? undefined : list(before.history).find(run => rec(run).id === rec(before.currentRun).id);
        if (duplicate) {
          if (!fullSplit || !["completed", "incomplete"].includes(rec(before.currentRun).status as string) || ownedJson(before.currentRun) !== ownedJson(duplicate)) bad();
          expected = { ...before }; delete expected.currentRun;
          shadowWrites.push({ index: 10, value: ownedJson({ schemaVersion: 1 }) });
        }
        requireSame(expected, value.state);
        if (!fullSplit) {
          const draftValue = ownedJson({ schemaVersion: 1, ...(value.state.currentRun ? { currentRun: value.state.currentRun } : {}) });
          const historyValue = ownedJson({ schemaVersion: 1, history: value.state.history });
          if (raw(10) !== null && raw(10) !== draftValue || raw(11) !== null && raw(11) !== historyValue) bad();
          if (raw(11) === null) shadowWrites.push({ index: 11, value: historyValue });
          if (raw(10) === null) shadowWrites.push({ index: 10, value: draftValue });
        }
        return { writes: shadowWrites, interpretation: shadowWrites.length ? "assessment_recovery" : "none" };
      });
      await run("training_plans", [4], () => repositories.trainingPlans.loadPlans(), value => {
        const expected = plansExpected(tree(4)); requireSame(expected, { schemaVersion: 2, plans: value });
        for (const plan of list(expected.plans)) ids(list(rec(plan).steps));
        return { interpretation: rec(tree(4)).schemaVersion === 1 ? "schema_interpretation" : "none", plansExecutable: value.every(isPlanExecutable) };
      });
      await run("tolerance_profiles", [5], () => repositories.accuracyToleranceProfiles.loadState(), value => { requireSame(toleranceExpected(tree(5)), value); return { interpretation: rec(tree(5)).schemaVersion === 1 ? "schema_interpretation" : "none" }; });
      await run("random_profiles", [6], () => repositories.smartRandomProfiles.loadState(), value => { const before = rec(tree(6)); if (before.schemaVersion !== 1) bad(); ids(list(before.profiles)); requireSame(before, value); });
      await run("show_introduction", [7], () => repositories.assessmentPreferences.getShowIntroduction(), value => { if (raw(7) !== "true" && raw(7) !== "false") bad(); requireSame(raw(7) === "true", value); }, false);
      await run("threshold_preset", [8], () => repositories.assessmentPreferences.getLastThresholdPreset(), value => { if (!["standard", "tight", "custom"].includes(raw(8)!)) bad(); requireSame(raw(8), value); }, false);
      await run("custom_threshold", [9], () => repositories.assessmentPreferences.getLastCustomThreshold(), value => { const before = exact(tree(9), ["onTarget", "acceptable"]); if (typeof before.onTarget !== "number" || typeof before.acceptable !== "number") bad(); requireSame(before, value); });
      await run("cloud_sync", [12], () => sync.load(), value => {
        requireSame(syncExpected(tree(12)), value);
        if (value.activeTeamExerciseDraft && value.activeTeamExerciseDraft.teamContext?.recorderProfileId !== profileId || value.teamExerciseResults.some(result => result.athleteProfileId !== profileId)) bad();
        return { interpretation: rec(tree(12)).schemaVersion === 6 ? "none" : "schema_interpretation" };
      });
      if (copy.poisoned()) for (let i = 0; i < domains.length; i++) domains[i] = { ...domains[i], status: "preserved_unusable", interpretation: "none", plansExecutable: null };
      findings.push({ profileIndex, domainStatus: aggregate(domains), domains });
    }
    const report: Report = { schemaVersion: 1, packageDigest: envelope.packageDigest as string, domainStatus: aggregate(findings.map(v => ({ status: v.domainStatus }))), historicalStatus: "not_evaluated", profiles: findings, mayIssue: false, mayPublish: false, mayMount: false };
    return { ok: true as const, value: freeze(report) };
  } catch { return { ok: false as const, code: "domain_evaluation_unavailable" as const }; }
}
