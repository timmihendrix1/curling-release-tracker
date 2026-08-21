// A stable, provably-safe label for a caught error, for server-side operational
// logging only (never returned to a caller). Every place in this codebase that logs
// a caught provider/transport error at a security-sensitive boundary (Route Handler
// best-effort helpers, the SMTP send path) must go through this — never
// `error.message`, `error.name`, `error.code`, `error.status`, `String(error)`, or
// any other value read directly off the caught object, since ALL of those are
// runtime-controlled and can legitimately be set to anything by whatever threw —
// including, deliberately or not, a request body fragment, a recipient email
// address, a raw invitation/OTP token, an authorization header, SMTP credentials, or
// a provider connection string (docs/adr/0022 §Sanitized Operational Logging).
//
// Fourth correction pass: an earlier revision of this module returned `err.name` for
// an `Error` and a pattern-matched `code`/`status` field for a plain object. Both are
// runtime-controlled strings — nothing stops code (this app's own, a dependency's, or
// a malicious/compromised one) from doing `error.name = rawInvitationToken` or
// throwing `{ code: rawInvitationToken }`, and an alphanumeric-looking secret would
// satisfy the old character/length pattern check trivially. This module now returns
// ONLY hard-coded string literals authored right here — never any substring, field
// value, or transformation of anything read off the caught object. Which literal is
// chosen may depend on the RUNTIME TYPE of the caught value (via `instanceof`/`typeof`
// checks), never on its CONTENTS.
//
// Fifth correction pass: classification itself was not yet total. `instanceof`
// against a Proxy invokes that Proxy's own `getPrototypeOf` trap (to walk the
// prototype chain), and the `in` operator against a Proxy invokes its `has` trap —
// both are ordinary JavaScript reflection operations, and both are user-definable
// code that can throw. A hostile or merely buggy thrown Proxy could therefore make
// classification itself throw, escaping every `catch`/`bestEffort` boundary this
// module exists to protect, AFTER the durable Team mutation those boundaries guard
// had already succeeded. Fixed by wrapping the entire classification in one
// `try`/`catch`: any exception raised while merely INSPECTING the caught value's
// type (never its field values, which are never read regardless) now falls back to
// the same hard-coded `"unknown_error"` literal every other unrecognized shape
// already produces. This preserves the same fixed set of hard-coded categories for
// every ordinary input; it changes behavior only for a hostile/adversarial thrown
// value that could not have been classified safely before either.

/**
 * Returns a safe, hard-coded category for a caught error — never a value read from
 * the error itself, and never a value that requires trusting the error's own
 * reflection behavior (a hostile Proxy's `getPrototypeOf`/`has` traps included).
 * Total and non-throwing for every possible `unknown` input. Classification is by
 * runtime type only:
 * - one of a fixed set of built-in `Error` subclasses, via `instanceof` (their
 *   constructor identity, never `.name`, which is a mutable, runtime-controlled
 *   string property even on a genuine built-in instance);
 * - the literal `"Error"` for any other `Error` instance (a custom subclass, or a
 *   built-in one not specifically enumerated);
 * - the literal `"provider_error"` for a plain object that merely LOOKS like a
 *   provider/transport error (has a `message`, `code`, or `status` property) but
 *   isn't an `Error` instance — its field values are never read or returned;
 * - the literal `"unknown_error"` for anything else (a primitive throw, `null`,
 *   `undefined`, an object with none of the above shape, OR a value whose own
 *   reflection traps threw while this function was merely trying to inspect its
 *   type — classification failing closed, exactly like an unrecognized shape).
 */
export function safeErrorCategory(err: unknown): string {
  try {
    return classifyByRuntimeType(err);
  } catch {
    // Classifying the value's own TYPE threw (e.g. a Proxy's `getPrototypeOf` or
    // `has` trap) — fail closed to the same generic literal an unrecognized shape
    // already produces. Never inspects, logs, or rethrows whatever was caught here.
    return "unknown_error";
  }
}

function classifyByRuntimeType(err: unknown): string {
  if (err instanceof TypeError) return "TypeError";
  if (err instanceof RangeError) return "RangeError";
  if (err instanceof SyntaxError) return "SyntaxError";
  if (err instanceof ReferenceError) return "ReferenceError";
  if (err instanceof URIError) return "URIError";
  if (err instanceof EvalError) return "EvalError";
  if (typeof AggregateError !== "undefined" && err instanceof AggregateError) return "AggregateError";
  if (err instanceof Error) return "Error";
  if (isProviderErrorShape(err)) return "provider_error";
  return "unknown_error";
}

/** True for a plain object that has the SHAPE of a provider/transport error (a
 * `message`, `code`, or `status` property) without being an `Error` instance —
 * e.g. a Postgrest `{ message, code, details, hint }` result or an SMTP client's
 * plain error object. Only checks for the PRESENCE of these keys — their values are
 * never read. May itself throw (a hostile Proxy's `has` trap) — the caller
 * (`safeErrorCategory`) is responsible for catching that, not this helper. */
function isProviderErrorShape(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return "message" in err || "code" in err || "status" in err;
}
