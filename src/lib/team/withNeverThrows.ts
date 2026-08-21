// Centralizes the "TeamService never rejects/throws for an ordinary provider or
// transport failure" contract (requirement 23; docs/adr/0022 §TeamService Never-Throws
// Contract) in ONE place, rather than requiring every one of TeamService's ~20 methods
// to individually wrap its own body in try/catch. Every interface method already
// resolves a `TeamResult<T>` on its own success/expected-failure paths — this wrapper
// exists only to catch the *unexpected* case: a Supabase query-builder/RPC promise that
// rejects instead of resolving `{ data, error }`, a `fetch` rejection, a session-lookup
// throw, or a mapping function throwing on an unexpectedly-shaped row — converting any
// of those into an honest `unexpected_error` result instead of an unhandled rejection
// reaching UI code (which must never have to guard every call site with its own
// try/catch to stay safe).
import { teamFailed, type TeamResult } from "./errors";
import type { TeamService } from "./teamService";

function isPromiseReturning(value: unknown): value is (...args: unknown[]) => Promise<unknown> {
  return typeof value === "function";
}

/**
 * Wraps every method of a `TeamService` implementation so a thrown error or a
 * rejected promise resolves to `{ ok: false, error: { kind: "unexpected_error", ... } }`
 * instead of propagating as an unhandled rejection. Safe to apply to any conforming
 * implementation (production or fake) — a well-behaved implementation that never
 * actually throws is unaffected; this only changes behavior for the case that would
 * otherwise violate the "never throws" contract.
 */
export function withNeverThrows(service: TeamService): TeamService {
  return new Proxy(service, {
    get(target, propertyKey, receiver) {
      const value = Reflect.get(target, propertyKey, receiver);
      if (!isPromiseReturning(value)) return value;
      return async (...args: unknown[]): Promise<TeamResult<unknown>> => {
        try {
          return (await value.apply(target, args)) as TeamResult<unknown>;
        } catch {
          // Never the raw error's own message — it could be a provider/transport
          // detail (docs/adr/0022 §Error Boundary Sanitization applies here too).
          return teamFailed("unexpected_error", "Something went wrong. Please try again.");
        }
      };
    },
  }) as TeamService;
}
