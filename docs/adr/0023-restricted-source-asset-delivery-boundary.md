# ADR-0023: A restricted source asset is reachable only through an opaque reference plus an explicitly authorized resolver, and fails closed

## Status

Accepted. Implemented for the Exercise Library's content boundary (Stage A). No
restricted asset exists in this repository, and no authorized resolver is
implemented — the boundary is deliberately in place *before* the first one arrives.

## Context

`docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md` sections 5.4 and 6.3 approve
showing three Swiss Curling source diagrams to one named closed-beta team, with visible
attribution, and require that a source image "must not be exposed through a public
Library or unauthenticated asset surface". The specification states that requirement;
it does not decide the mechanism.

The obvious implementations all fail it quietly:

1. **Put the image in `public/` and hide it behind a UI condition.** The asset URL stays
   publicly fetchable, and the bundle or DOM usually reveals it. A visibility condition
   is not a distribution restriction.
2. **Embed the image in the content package as a data URI.** Every client that can load
   the Library now holds the full asset, regardless of audience.
3. **Store a signed or environment-specific URL in the curated content.** Curated
   content is immutable and version-controlled; a credential-bearing URL inside it
   either leaks or expires, and it makes the content package environment-dependent.

The failure mode this ADR guards against is not exotic: a future contributor adding the
fourth curated Exercise, or "simplifying" the diagram model, could reasonably reach for
option 1 without realising that the restriction was ever load-bearing.

## Decision

1. **A restricted asset is named by an opaque `RestrictedAssetReference`, never by a
   locator.** `{ assetId: string }` where `assetId` must match lowercase kebab-case
   (`OPAQUE_ASSET_ID_PATTERN`, `src/lib/exercises/validation.ts`). That rule
   deterministically rejects every form that could address the asset — an absolute or
   relative path, an `https:`/`data:`/`blob:` URL, a file extension, a Windows path — so
   the content package alone cannot be turned into a request.

2. **Resolution is a separate, explicit capability.** One function,
   `resolveRestrictedAssetAccess(reference, distribution, resolver?)`
   (`src/lib/exercises/restrictedAssets.ts`), is the only path from a reference to a
   renderable source. The `resolver` is an injected `RestrictedAssetResolver` supplied by
   an authorized delivery context. There is no default resolver and no fallback, so the
   application's production behaviour today is "unavailable" by construction, not by
   configuration.

3. **It fails closed on every uncertain path,** with one of exactly five named
   reasons (`RestrictedAssetAccessReason`):

   | Reason | Meaning |
   |---|---|
   | `no-resolver` | No resolver was injected — this application's behaviour today |
   | `not-authorized` | A resolver ran and declined this reference |
   | `distribution-not-restricted` | The diagram's own metadata does not describe a restricted asset; re-checked here rather than trusting that catalog validation ran |
   | `invalid-resolution` | The resolver returned an unusable value |
   | `resolver-error` | The resolver **threw**, or the resolution it returned threw while being inspected |

   `resolver-error` matters because a resolver is injected, external code: it may fail
   for reasons that have nothing to do with authorization (a network error, a bad
   configuration, a bug). A thrown value escaping this boundary would replace the
   designed unavailable state with a broken Exercise page — the opposite of failing
   closed. Any thrown value at all is therefore caught and treated as a refusal, and
   the value itself is **dropped, not inspected, logged, serialized or returned**, since
   a resolver may well have put a path, a signed URL or the asset id into its message.
   Nothing is ever derived from `assetId` either.

   **Obtaining and inspecting the resolution both sit inside that boundary.** A resolver
   may return an object — or a `Proxy` — whose `src` getter throws or traps, so reading
   the value outside the `try` would still crash the render even though the call itself
   succeeded. `src` is also read exactly once, into a local: reading it twice would let
   a getter pass the validity check and then hand the renderer a different value.

4. **The renderer never writes the reference into the DOM.** In both the authorized and
   the unavailable branch, `ExerciseRestrictedSourceImage.tsx` renders no `src`, `href`
   or asset id when access was refused, so the unavailable state cannot be read out of
   the markup and reconstructed into a URL. That holds for a thrown resolver too: the
   refusal carries no diagnostic payload to render.

5. **Attribution survives independently of the image.** Attribution, source
   organisation, source version, permitted audience and provenance are required fields
   on the diagram and are rendered in *both* branches. Whether the picture can be shown
   and whether its origin is recorded are separate concerns. In
   `ExerciseRestrictedSourceImage.tsx` all five are built into one list and rendered
   from a single definition list *outside* the authorized/unavailable branch, as
   labelled `dt`/`dd` pairs — so no branch can omit one, and an incomplete renderer
   cannot drift back in unnoticed.

6. **Restricted-distribution metadata is validated as content, not assumed.** A
   source-image diagram is rejected at the catalog boundary unless it carries
   attribution, source organisation, source version, provenance, an opaque asset
   reference, a supported restricted scope, a permitted audience, and
   `publicDeliveryPermitted: false`.

7. **Stage A ships no restricted asset at all.** The Swiss Curling PDF and its diagrams
   are not copied, cropped, extracted or placed in `public/`, and no Stage A Exercise
   uses the source-image variant. `Eight Guards, Progressively Longer` uses an
   independently authored structured platform diagram
   (`src/lib/exercises/diagrams.ts`). The boundary above is therefore proven only by
   in-memory test fixtures — which is the point: the mechanism exists before the asset
   does, so nobody has to invent it under delivery pressure.

## Consequences

- Showing a real restricted diagram to the closed beta is a *new capability to build*
  (an authenticated delivery path that implements `RestrictedAssetResolver`), not a flag
  to flip or a file to drop into `public/`. That is the intended cost.
- Replacing a restricted source image with an independently authored structured diagram
  is a content change and therefore requires a **new Exercise Version**; the old version
  keeps its source-image diagram and stays independently resolvable
  (`src/lib/exercises/__tests__/versioning.test.ts`).
- The unavailable state is a real, designed UI state that athletes may actually see, not
  an error path — so it carries the written setup and instructions as the substitute,
  and says plainly that the diagram's delivery has not been authorised here. Every
  failure reason lands on that same state; the athlete is never shown which one, and a
  resolver failure is not surfaced as an application error.
- A resolver implementation is therefore free to throw rather than having to catch
  everything itself. It must still never return a source it is not authorized to return
  — this boundary makes a *failure* safe, not a mistake.
- Any future restricted asset class (a licensed video, a partner's illustration) reuses
  this boundary rather than inventing a second one. If a genuinely public asset is ever
  needed, it should not be modelled as a restricted asset with `publicDeliveryPermitted`
  flipped — that field is validated as `false` precisely so the two cannot blur.
- Section 5.4's external rights gate is unaffected by this ADR: a mechanism that can
  deliver a restricted asset safely is not permission to deliver it.
