// Internal data-only capture for genuine native owners and explicit config input.
// It performs no I/O, grants no admission and exports no application runner.
export type NativeSportingInput = "record" | "array" | "boolean" | "preset" | "string" | "nullable_string";
type CaptureOwner = Readonly<{ current(): boolean; retire(): void; retain(value: unknown): void; isOwnDisposal(value: unknown): boolean }>;
const apply = Reflect.apply, hasOwn = Object.prototype.hasOwnProperty, then = Promise.prototype.then;
const prototypeOf = Object.getPrototypeOf, descriptorOf = Object.getOwnPropertyDescriptor, ownKeys = Reflect.ownKeys;
const define = Object.defineProperty, objectPrototype = Object.prototype, arrayPrototype = Array.prototype;

export function captureNativeSportingArguments(args: readonly unknown[], kinds: readonly NativeSportingInput[], owner: CaptureOwner): unknown[] {
  const { current, retire, retain, isOwnDisposal } = owner;
  const ancestors = new Set<object>();
  function reject(...values: unknown[]): never {
    retire(); // before assimilation or its reentrancy
    for (const value of values) retain(value);
    throw null;
  }
  function check(value?: unknown) { if (!current()) reject(value); }
  function reflect<T>(value: unknown, operation: () => T): T {
    check(value);
    try { return operation(); } catch { return reject(value); }
  }
  function copy(value: unknown): unknown {
    check(value);
    if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value !== "object" || isOwnDisposal(value)) reject(value);
    if (ancestors.has(value)) reject(value);
    const array = reflect(value, () => Array.isArray(value)); check(value);
    const prototype = reflect(value, () => prototypeOf(value));
    if (!current() || (array ? prototype !== arrayPrototype : prototype !== objectPrototype && prototype !== null)) reject(prototype, value);
    for (const key of ["constructor", "then"]) {
      check(value); const present = reflect(value, () => apply(hasOwn, value, [key]));
      if (!current() || present !== false) reject(value);
    }
    // Brand-check plain-prototype native promises independently of the shape.
    // An intrinsic throw alone never supplies supported-root eligibility.
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    let nativePromise = false;
    try { apply(then, value, [finish, finish]); nativePromise = true; }
    catch { /* supported data root; poisoned provider work remains subject to C4 */ }
    if (nativePromise) { retire(); retain(pending); retain(value); throw null; }
    check(value);
    const keys = reflect(value, () => ownKeys(value)); check(value);
    if (keys.some(key => typeof key !== "string")) reject(value);
    const out: object = array ? [] : Object.create(prototype);
    ancestors.add(value);
    try {
      for (const key of keys) {
        check(value); const descriptor = reflect(value, () => descriptorOf(value, key));
        const data = descriptor !== undefined && apply(hasOwn, descriptor, ["value"]) === true;
        if (!current()) reject(data ? descriptor!.value : undefined, value);
        if (!data) reject(value);
        const child = copy(descriptor!.value); check(child);
        // Define data properties; __proto__ must never invoke a setter. Array
        // holes remain holes and own extra data keeps its ordinary JSON meaning.
        define(out, key, { value: child, enumerable: descriptor!.enumerable, writable: true, configurable: !(array && key === "length") });
        check(child);
      }
    } finally { ancestors.delete(value); }
    return out;
  }
  const copied: unknown[] = [];
  for (let index = 0; index < kinds.length; index++) {
    check(); const value = args[index], kind = kinds[index];
    if (kind === "string" ? typeof value !== "string" : kind === "nullable_string" ? value !== null && typeof value !== "string" :
        kind === "boolean" ? typeof value !== "boolean" : kind === "preset" ? value !== "standard" && value !== "tight" && value !== "custom" :
        kind === "array" ? !Array.isArray(value) : !value || typeof value !== "object" || Array.isArray(value)) reject(value);
    copied.push(copy(value));
  }
  return copied;
}
