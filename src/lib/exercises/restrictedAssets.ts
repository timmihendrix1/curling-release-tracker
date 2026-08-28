// The access boundary for a restricted, attributed source-image Diagram
// (spec 5.4 / 6.3).
//
// Stage A introduced this boundary before an asset existed. Stage E connects it
// to one authenticated, private closed-beta delivery path; without that explicit
// resolver capability the same boundary still resolves to unavailable.
//
// Two rules this module enforces structurally rather than by convention:
//
// 1. A `RestrictedAssetReference` is opaque (see `validation.ts`'s
//    `OPAQUE_ASSET_ID_PATTERN`). Nothing in the content package can be turned
//    into a URL or a public path, so a UI visibility condition is never the
//    only thing standing between a restricted asset and the open web.
// 2. Without an authorized resolver, resolution returns a definite
//    "unavailable" result. Callers must render an unavailable state and must
//    never emit or infer an asset URL — including from the asset id itself.
import type { RestrictedAssetReference, RestrictedDistribution } from "./types";

export type RestrictedAssetResolution = {
  /**
   * A renderable source produced by an authorized delivery context. Never
   * derived from the asset id by this module or by any renderer.
   */
  src: string;
};

export type RestrictedAssetResolver = {
  /**
   * Returns a resolution only when the caller is genuinely authorized for this
   * reference under this distribution scope, and `null` otherwise. An
   * implementation must not treat "I have an id" as authorization.
   *
   * A resolver is an injected external dependency, so it may also throw —
   * `resolveRestrictedAssetAccess` treats that as a refusal rather than letting
   * it escape (see `"resolver-error"` below).
   */
  resolveRestrictedAsset(
    reference: RestrictedAssetReference,
    distribution: RestrictedDistribution
  ):
    | RestrictedAssetResolution
    | null
    | Promise<RestrictedAssetResolution | null>;
};

export type RestrictedAssetAccessReason =
  /** No resolver was supplied — the required default for an unconfigured composition. */
  | "no-resolver"
  /** A resolver exists but declined this reference. */
  | "not-authorized"
  /** The distribution metadata does not describe a restricted asset; fail closed. */
  | "distribution-not-restricted"
  /** The resolver returned an unusable value; fail closed rather than guess. */
  | "invalid-resolution"
  /**
   * The resolver threw. Any thrown value at all — an `Error`, a string, or
   * something with no `message` — is a refusal, never a crash and never a
   * reason to guess a source. The thrown value itself is deliberately dropped
   * rather than returned, so nothing a resolver put in an exception message
   * (a path, a signed URL, an asset id) can reach the DOM.
   */
  | "resolver-error";

export type RestrictedAssetAccess =
  | { authorized: true; src: string }
  | { authorized: false; reason: RestrictedAssetAccessReason };

/**
 * The one place a restricted asset may become renderable. Fails closed on
 * every uncertain path — no resolver, a declining resolver, a throwing
 * resolver, non-restricted distribution metadata, or an unusable resolution —
 * and never returns anything derived from `reference.assetId` or from a thrown
 * value.
 */
export async function resolveRestrictedAssetAccess(
  reference: RestrictedAssetReference,
  distribution: RestrictedDistribution,
  resolver?: RestrictedAssetResolver
): Promise<RestrictedAssetAccess> {
  // Defence in depth: catalog validation already rejects a restricted diagram
  // that permits public delivery, but this boundary re-checks rather than
  // trusting that it ran.
  if (distribution?.publicDeliveryPermitted !== false) {
    return { authorized: false, reason: "distribution-not-restricted" };
  }
  if (!resolver) {
    return { authorized: false, reason: "no-resolver" };
  }

  // A resolver is injected, external code. It failing is an ordinary outcome of
  // this boundary, not an exceptional one: the promise ADR-0023 makes is that
  // an unauthorized asset renders an unavailable state, and a thrown value must
  // not turn that into a broken Exercise page. The caught value is intentionally
  // not inspected, logged, serialized or forwarded.
  //
  // Obtaining *and* inspecting the resolution both sit inside this boundary on
  // purpose. A resolver may return an object — or a Proxy — whose `src` getter
  // throws or traps, so reading it outside the `try` would still crash the
  // render even though the call itself succeeded.
  try {
    const resolution: RestrictedAssetResolution | null =
      await resolver.resolveRestrictedAsset(reference, distribution);

    if (resolution === null || resolution === undefined) {
      return { authorized: false, reason: "not-authorized" };
    }

    // Read once, into a local. Reading `resolution.src` twice would let a
    // getter or Proxy pass the validity check and then hand a different value
    // to the renderer.
    const src: unknown = resolution.src;
    if (typeof src !== "string" || src.trim().length === 0) {
      return { authorized: false, reason: "invalid-resolution" };
    }

    return { authorized: true, src };
  } catch {
    return { authorized: false, reason: "resolver-error" };
  }
}
