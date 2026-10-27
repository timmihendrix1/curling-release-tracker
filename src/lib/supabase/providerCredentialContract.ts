// Inactive credential-v1 contract (MOBILE_APP_MIGRATION.md, S1 §§2–4).
// This module has no SDK, storage, transport, clock or digest dependency.
export type IssueCode = "invalid_input" | "hostile_input" | "limit_exceeded" | "invalid_json" | "duplicate_member" | "unsupported_version" | "unknown_field" | "invalid_shape" | "invalid_identifier" | "invalid_key" | "order_or_duplicate" | "phase_violation" | "membership_mismatch" | "identity_mismatch" | "fingerprint_invalid" | "evidence_unavailable";
export type IssueField = "input" | "header" | "phase" | "inventory" | "cursor" | "binding" | "session" | "user" | "verifier" | "index" | "fault" | "evidence";
export type CredentialIssue = Readonly<{ code: IssueCode; field: IssueField }>;
export type Result<T> = { ok: true; value: T } | { ok: false; issue: CredentialIssue };
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type DataRecord = { [key: string]: Json };
export const SDK_RAW_LIMIT = 1_048_576;
export const ROOT_PATTERN = /^sb-[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?-auth-token$/;
export const FLOW_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
export const FIXED_KINDS = ["session", "user", "legacy_verifier", "flow_index"] as const;
export type FixedKind = typeof FIXED_KINDS[number];
export type CredentialKind = FixedKind | "flow_verifier";
export type Classification = { kind: CredentialKind; flowId?: string } | { kind: "foreign" | "unsupported_own" };

// Only this private exception crosses internal validation frames; dependency
// exceptions are caught at the call site, never inspected or projected.
const ISSUE_CODES: readonly string[] = ["invalid_input", "hostile_input", "limit_exceeded", "invalid_json", "duplicate_member", "unsupported_version", "unknown_field", "invalid_shape", "invalid_identifier", "invalid_key", "order_or_duplicate", "phase_violation", "membership_mismatch", "identity_mismatch", "fingerprint_invalid", "evidence_unavailable"];
const ISSUE_FIELDS: readonly string[] = ["input", "header", "phase", "inventory", "cursor", "binding", "session", "user", "verifier", "index", "fault", "evidence"];
const internalRefusals = new WeakMap<object, CredentialIssue>();
export function refuse(code: IssueCode, field: IssueField = "input"): never {
  const valid = typeof code === "string" && ISSUE_CODES.includes(code) && typeof field === "string" && ISSUE_FIELDS.includes(field);
  const signal: object = Object.freeze(Object.create(null));
  internalRefusals.set(signal, Object.freeze(valid ? { code, field } : { code: "invalid_input", field: "input" }));
  throw signal;
}
// An external operation may replay even a genuine internal signal. Reclassify
// at the boundary, before the internal control-flow catch; never read its value.
function reflection<T>(run: () => T): T {
  try { return run(); } catch { refuse("hostile_input"); }
}
export function contractResult<T>(run: () => T): Result<T> {
  try { return { ok: true, value: run() }; }
  catch (error) {
    const metadata = typeof error === "object" && error !== null ? internalRefusals.get(error) : undefined;
    return { ok: false, issue: Object.freeze(metadata ? { code: metadata.code, field: metadata.field } : { code: "hostile_input", field: "input" }) };
  }
}
export function unwrap<T>(result: Result<T>): T { if (!result.ok) refuse(result.issue.code, result.issue.field); return result.value; }
export function record(value: Json, field: IssueField = "input"): DataRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) refuse("invalid_shape", field);
  return value;
}
export function exactFields(value: DataRecord, names: readonly string[], field: IssueField = "input"): void {
  if (Object.keys(value).some(key => !names.includes(key))) refuse("unknown_field", field);
  if (names.some(key => !Object.hasOwn(value, key))) refuse("invalid_shape", field);
}
export function text(value: Json | undefined, max: number, field: IssueField, nonempty = false): string {
  if (typeof value !== "string") refuse("invalid_shape", field);
  if (value.length > max) refuse("limit_exceeded", field);
  if (nonempty && value.length === 0) refuse("invalid_shape", field);
  return value;
}
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    // Only owned JSON trees enter here; no reflection on caller objects.
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Descriptor-only copy, with no input getter/iterator/toJSON invocation.
 * Reflection traps can execute; throwing traps are contained by contractResult.
 * Ancestor tracking rejects cycles without rejecting harmless shared data.
 */
export function snapshotJson(input: unknown, stringLimit = 6_300_000): Json {
  let nodes = 0;
  const ancestors = new Set<object>();
  function visit(value: unknown, depth: number): Json {
    if (nodes >= 65_536) refuse("limit_exceeded");
    nodes++;
    if (typeof value === "string") { if (value.length > stringLimit) refuse("limit_exceeded"); return value; }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") { if (!Number.isFinite(value)) refuse("invalid_input"); return value; }
    if (typeof value !== "object") refuse("hostile_input");
    if (depth > 32) refuse("limit_exceeded");
    if (ancestors.has(value)) refuse("hostile_input");
    const array = reflection(() => Array.isArray(value));
    const proto = reflection(() => Object.getPrototypeOf(value));
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) refuse("hostile_input");
    const keys = reflection(() => Reflect.ownKeys(value));
    if (keys.length > (array ? 65_537 : 4_096)) refuse("limit_exceeded");
    if (keys.some(key => typeof key !== "string")) refuse("hostile_input");
    const descriptors: Record<string, PropertyDescriptor> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = reflection(() => Object.getOwnPropertyDescriptor(value, key));
      if (!descriptor || !Object.hasOwn(descriptor, "value") || (!descriptor.enumerable && !(array && key === "length"))) refuse("hostile_input");
      if (!array && key.length > 128) refuse("limit_exceeded");
      descriptors[key] = descriptor;
    }
    ancestors.add(value);
    let copy: Json;
    if (array) {
      const length: unknown = descriptors.length?.value;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) refuse("hostile_input");
      if (length > 65_536 - nodes) refuse("limit_exceeded");
      if (keys.length !== length + 1) refuse("hostile_input");
      const out: Json[] = [];
      for (let i = 0; i < length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor) refuse("hostile_input");
        out.push(visit(descriptor.value, depth + 1));
      }
      copy = out;
    } else {
      const out: DataRecord = {};
      for (const key of keys as string[]) Object.defineProperty(out, key, { value: visit(descriptors[key].value, depth + 1), enumerable: true, writable: true, configurable: true });
      copy = out;
    }
    ancestors.delete(value);
    Object.freeze(copy);
    return copy;
  }
  return visit(input, 1);
}

/** Iterative JSON grammar admission BEFORE the one JSON.parse.
 * Decoded member names are compared, including escapes and __proto__.
 * String chunks are bounded before accumulation; lone UTF-16 surrogates survive.
 */
export function parseBoundedJson(input: unknown, maxLength = SDK_RAW_LIMIT, stringLimit = SDK_RAW_LIMIT): Json {
  if (typeof input !== "string") refuse("invalid_input");
  if (input.length > maxLength) refuse("limit_exceeded");
  const raw = input;
  let pos = 0, nodes = 0;
  type Frame = { kind: "object" | "array"; state: "key" | "colon" | "value" | "comma" | "end"; names: Set<string>; members: number };
  const stack: Frame[] = [];
  const whitespace = () => { while (pos < raw.length && (raw[pos] === " " || raw[pos] === "\n" || raw[pos] === "\r" || raw[pos] === "\t")) pos++; };
  function stringToken(member: boolean): string {
    if (raw[pos++] !== '"') refuse("invalid_json");
    const chunks: string[] = [];
    let start = pos, length = 0;
    const add = (chunk: string) => {
      const limit = member ? 128 : stringLimit;
      if (length > limit - chunk.length) refuse("limit_exceeded");
      length += chunk.length;
      if (member) chunks.push(chunk);
    };
    while (pos < raw.length) {
      const code = raw.charCodeAt(pos);
      if (code === 34) { add(raw.slice(start, pos)); pos++; return member ? chunks.join("") : ""; }
      if (code < 32) refuse("invalid_json");
      if (code === 92) {
        add(raw.slice(start, pos)); pos++;
        const escape = raw[pos++];
        if (escape === "u") {
          const hex = raw.slice(pos, pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) refuse("invalid_json");
          add(String.fromCharCode(Number.parseInt(hex, 16))); pos += 4;
        } else {
          const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (!Object.hasOwn(escapes, escape)) refuse("invalid_json");
          add(escapes[escape]);
        }
        start = pos;
      } else {
        pos++;
        // Check before constructing a potentially huge slice.
        if (length > (member ? 128 : stringLimit) - (pos - start)) refuse("limit_exceeded");
      }
    }
    refuse("invalid_json");
  }
  const numberToken = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  function valueToken(): void {
    if (nodes >= 65_536) refuse("limit_exceeded"); nodes++;
    const char = raw[pos];
    if (char === "{" || char === "[") {
      if (stack.length >= 32) refuse("limit_exceeded");
      stack.push({ kind: char === "{" ? "object" : "array", state: char === "{" ? "key" : "value", names: new Set(), members: 0 }); pos++; return;
    }
    if (char === '"') { stringToken(false); return; }
    for (const literal of ["true", "false", "null"]) if (raw.startsWith(literal, pos)) { pos += literal.length; return; }
    numberToken.lastIndex = pos;
    const match = numberToken.exec(raw);
    if (!match || !Number.isFinite(Number(match[0]))) refuse("invalid_json");
    pos = numberToken.lastIndex;
  }
  whitespace(); valueToken();
  while (stack.length) {
    whitespace();
    const frame = stack[stack.length - 1];
    const close = frame.kind === "object" ? "}" : "]";
    if ((frame.kind === "object" ? frame.state === "key" : frame.state === "value") && frame.members === 0 && raw[pos] === close) { pos++; stack.pop(); continue; }
    if (frame.state === "end") refuse("invalid_json");
    if (frame.state === "key") {
      const name = stringToken(true);
      if (frame.names.has(name)) refuse("duplicate_member");
      if (frame.members >= 4_096) refuse("limit_exceeded");
      frame.names.add(name); frame.state = "colon";
    } else if (frame.state === "colon") {
      if (raw[pos++] !== ":") refuse("invalid_json"); frame.state = "value";
    } else if (frame.state === "value") {
      frame.members++; frame.state = "comma"; valueToken();
    } else if (raw[pos] === close) { pos++; stack.pop(); }
    else {
      if (raw[pos++] !== ",") refuse("invalid_json");
      frame.state = frame.kind === "object" ? "key" : "value";
    }
  }
  whitespace(); if (pos !== raw.length) refuse("invalid_json");
  return deepFreeze(JSON.parse(raw) as Json);
}

export function fixedCredentialSlots(root: string): { kind: FixedKind; key: string }[] {
  return [{ kind: "session", key: root }, { kind: "user", key: root + "-user" }, { kind: "legacy_verifier", key: root + "-code-verifier" }, { kind: "flow_index", key: root + "-flows-code-verifier" }];
}
export function classifyCredentialKey(root: unknown, key: unknown): Classification {
  if (typeof root !== "string" || typeof key !== "string" || !ROOT_PATTERN.test(root)) return { kind: "unsupported_own" };
  for (const slot of fixedCredentialSlots(root)) if (slot.key === key) return { kind: slot.kind };
  if (!key.startsWith(root + "-")) return { kind: "foreign" };
  const prefix = root + "-flow-", suffix = "-code-verifier";
  if (key.startsWith(prefix) && key.endsWith(suffix)) {
    const flowId = key.slice(prefix.length, -suffix.length);
    if (FLOW_PATTERN.test(flowId)) return { kind: "flow_verifier", flowId };
  }
  return { kind: "unsupported_own" };
}
const noControls = /^[^\u0000-\u0020\u007f-\u009f]+$/;
function token(value: Json | undefined, max: number, field: IssueField): void { if (!noControls.test(text(value, max, field, true))) refuse("invalid_shape", field); }
function optionalStrings(obj: DataRecord, names: readonly string[], max: number, field: IssueField): void {
  for (const name of names) if (Object.hasOwn(obj, name)) text(obj[name], max, field);
}
function validateUser(input: Json): DataRecord {
  const user = record(input, "user");
  if (Object.hasOwn(user, "__isUserNotAvailableProxy")) refuse("invalid_shape", "user");
  token(user.id, 512, "user"); text(user.aud, 512, "user", true); text(user.created_at, 128, "user", true);
  const app = record(user.app_metadata, "user"); record(user.user_metadata, "user");
  optionalStrings(user, ["confirmation_sent_at", "recovery_sent_at", "email_change_sent_at", "new_email", "new_phone", "invited_at", "action_link", "email", "phone", "confirmed_at", "email_confirmed_at", "phone_confirmed_at", "last_sign_in_at", "role", "updated_at", "deleted_at", "banned_until"], 4_096, "user");
  for (const name of ["is_anonymous", "is_sso_user"]) if (Object.hasOwn(user, name) && typeof user[name] !== "boolean") refuse("invalid_shape", "user");
  if (Object.hasOwn(app, "provider")) text(app.provider, SDK_RAW_LIMIT, "user");
  if (Object.hasOwn(app, "providers")) {
    if (!Array.isArray(app.providers)) refuse("invalid_shape", "user");
    for (const provider of app.providers) text(provider, 512, "user");
  }
  for (const name of ["identities", "factors"]) if (Object.hasOwn(user, name)) {
    const list = user[name];
    if (!Array.isArray(list)) refuse("invalid_shape", "user");
    if (list.length > 1_024) refuse("limit_exceeded", "user");
    for (const entry of list) {
      const item = record(entry, "user");
      if (name === "identities") {
        for (const required of ["id", "user_id", "identity_id", "provider"]) text(item[required], 512, "user", true);
        if (Object.hasOwn(item, "identity_data")) record(item.identity_data, "user");
        optionalStrings(item, ["created_at", "last_sign_in_at", "updated_at"], 128, "user");
      } else {
        text(item.id, 512, "user", true);
        if (typeof item.factor_type !== "string" || !["totp", "phone", "webauthn"].includes(item.factor_type) || typeof item.status !== "string" || !["verified", "unverified"].includes(item.status)) refuse("invalid_shape", "user");
        text(item.created_at, 128, "user", true); text(item.updated_at, 128, "user", true);
        optionalStrings(item, ["friendly_name"], 4_096, "user"); optionalStrings(item, ["last_challenged_at"], 128, "user");
      }
    }
  }
  return user;
}
function validateSdkData(kind: CredentialKind, data: Json): void {
  if (kind === "session") {
    const obj = record(data, "session");
    if (Object.hasOwn(obj, "__isUserNotAvailableProxy")) refuse("invalid_shape", "session");
    token(obj.access_token, 65_536, "session"); token(obj.refresh_token, 65_536, "session");
    const expiry = obj.expires_at, duration = obj.expires_in;
    if (typeof expiry !== "number" || !Number.isSafeInteger(expiry) || expiry < 0 || !Number.isSafeInteger(expiry * 1_000)) refuse("invalid_shape", "session");
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 || duration > 9_007_199_254_740) refuse("invalid_shape", "session");
    if (obj.token_type !== "bearer") refuse("invalid_shape", "session");
    for (const key of ["provider_token", "provider_refresh_token"]) if (Object.hasOwn(obj, key) && obj[key] !== null) token(obj[key], 65_536, "session");
    if (Object.hasOwn(obj, "user")) validateUser(obj.user);
  } else if (kind === "user") {
    const obj = record(data, "user"); exactFields(obj, ["user"], "user"); validateUser(obj.user);
  } else if (kind === "flow_index") {
    if (!Array.isArray(data)) refuse("invalid_shape", "index");
    if (data.length > 1_020) refuse("limit_exceeded", "index");
    const seen = new Set<string>();
    for (const entry of data) {
      if (typeof entry !== "string" || !FLOW_PATTERN.test(entry)) refuse("invalid_identifier", "index");
      if (seen.has(entry)) refuse("order_or_duplicate", "index"); seen.add(entry);
    }
  } else if (typeof data !== "string" || !/^[A-Za-z0-9._~-]{43,128}(?:\/recovery)?$/.test(data)) refuse("invalid_shape", "verifier");
}
function runtimeValue(root: unknown, key: unknown, raw: unknown): { kind: CredentialKind; raw: string } {
  if (typeof root !== "string" || typeof key !== "string" || typeof raw !== "string") refuse("invalid_input");
  if (key.length > 192 || raw.length > SDK_RAW_LIMIT) refuse("limit_exceeded");
  const data = parseBoundedJson(raw);
  if (!ROOT_PATTERN.test(root)) refuse("invalid_key", "header");
  const classification = classifyCredentialKey(root, key);
  if (classification.kind === "foreign" || classification.kind === "unsupported_own") refuse("invalid_key", "inventory");
  validateSdkData(classification.kind, data);
  return Object.freeze({ kind: classification.kind, raw });
}
export function validateRuntimeCredentialValue(root: unknown, key: unknown, raw: unknown): Result<{ kind: CredentialKind; raw: string }> {
  return contractResult(() => runtimeValue(root, key, raw));
}
export function chargeCredentialUnits(total: number, addition: number): number {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(addition) || addition < 0) refuse("invalid_input", "inventory");
  if (total > 8_388_608 - addition) refuse("limit_exceeded", "inventory");
  return total + addition;
}
export type CredentialInventory = Readonly<{ initialEntryKeys: string[]; fixedSlots: { kind: FixedKind; key: string; presence: "present" | "absent" }[]; items: { key: string; raw: string }[] }>;
export function validateQuiescentCredentialSnapshot(root: unknown, snapshot: unknown): Result<CredentialInventory> {
  return contractResult(() => {
    if (typeof root !== "string") refuse("invalid_input");
    if (!ROOT_PATTERN.test(root)) refuse("invalid_key", "header");
    const obj = record(snapshotJson(snapshot)); exactFields(obj, ["listedKeys", "reads", "enumerationComplete"], "inventory");
    if (obj.enumerationComplete !== true) refuse("evidence_unavailable", "evidence");
    if (!Array.isArray(obj.listedKeys) || !Array.isArray(obj.reads)) refuse("invalid_shape", "inventory");
    const listed = new Set<string>(), own: string[] = [];
    let flows = 0;
    for (const entry of obj.listedKeys) {
      const key = text(entry, 192, "inventory");
      if (listed.has(key)) refuse("order_or_duplicate", "inventory"); listed.add(key);
      const classification = classifyCredentialKey(root, key);
      if (classification.kind === "unsupported_own") refuse("invalid_key", "inventory");
      if (classification.kind !== "foreign") {
        if (own.length >= 1_024 || (classification.kind === "flow_verifier" && flows >= 1_020)) refuse("limit_exceeded", "inventory");
        own.push(key); if (classification.kind === "flow_verifier") flows++;
      }
    }
    own.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const required = new Set([...own, ...fixedCredentialSlots(root).map(slot => slot.key)]);
    const reads = new Map<string, DataRecord>();
    for (const entry of obj.reads) {
      const read = record(entry, "evidence"); exactFields(read, ["key", "result"], "evidence");
      const key = text(read.key, 192, "evidence");
      if (!required.has(key) || reads.has(key)) refuse("membership_mismatch", "evidence");
      const result = record(read.result, "evidence");
      if (result.status === "value") { exactFields(result, ["status", "value"], "evidence"); text(result.value, SDK_RAW_LIMIT, "evidence"); }
      else if (result.status === "absent" || result.status === "read_failed") exactFields(result, ["status"], "evidence");
      else refuse("invalid_shape", "evidence");
      reads.set(key, result);
    }
    if (reads.size !== required.size || [...reads.values()].some(result => result.status === "read_failed")) refuse("evidence_unavailable", "evidence");
    let total = 0;
    const items: { key: string; raw: string }[] = [];
    for (const key of required) {
      const result = reads.get(key)!;
      if ((result.status === "value") !== listed.has(key)) refuse("membership_mismatch", "inventory");
      if (result.status === "value") {
        const value = runtimeValue(root, key, result.value);
        total = chargeCredentialUnits(total, value.raw.length);
        items.push({ key, raw: value.raw });
      }
    }
    items.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const index = items.find(item => item.key === root + "-flows-code-verifier");
    if (index) for (const flow of parseBoundedJson(index.raw) as string[]) if (!listed.has(root + "-flow-" + flow + "-code-verifier")) refuse("membership_mismatch", "index");
    const session = items.find(item => item.key === root), detached = items.find(item => item.key === root + "-user");
    if (session && detached) {
      const inline = record(parseBoundedJson(session.raw)).user;
      if (inline && record(inline).id !== record(record(parseBoundedJson(detached.raw)).user).id) refuse("identity_mismatch", "user");
    }
    return deepFreeze({ initialEntryKeys: own, fixedSlots: fixedCredentialSlots(root).map(slot => ({ ...slot, presence: listed.has(slot.key) ? "present" as const : "absent" as const })), items });
  });
}
