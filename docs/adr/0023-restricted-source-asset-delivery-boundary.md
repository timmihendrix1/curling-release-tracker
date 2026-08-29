# ADR-0023: A restricted source asset is reachable only through an opaque reference plus an explicitly authorized resolver, and fails closed

## Status

Accepted for genuinely restricted content. Stage A implemented the boundary and Stage E
used it for the initial one-Team delivery. **ADR-0044 supersedes that delivery decision
for the three Swiss Curling diagrams only:** their permission scope is now public and
their current Exercise Versions use a separate cache-first public resolver. This ADR
remains the required boundary for any future asset whose audience is actually restricted.

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
   an authorized delivery context. There is no implicit resolver and no fallback: an
   unconfigured application or a caller that cannot pass the explicit delivery boundary
   still receives "unavailable" by construction.

3. **It fails closed on every uncertain path,** with one of exactly five named
   reasons (`RestrictedAssetAccessReason`):

   | Reason | Meaning |
   |---|---|
   | `no-resolver` | No resolver was injected — the required fail-closed behaviour in an unconfigured or non-cloud composition |
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

8. **Stage E supplies a fixed private asset catalogue, not a public directory.** Exactly
   three opaque ids are declared in `restrictedAssetCatalog.ts` and mapped server-side to
   three PNGs under `restricted-assets/exercises/`. No file is placed under `public/`,
   and `next.config.ts` includes only those private PNGs in the server output trace. The
   Route Handler rejects an unknown id before authentication and never joins a request
   value into a filesystem path.

9. **Delivery requires both authentication and active membership in one configured
   Team.** `CLOSED_BETA_EXERCISE_ASSET_TEAM_ID` must be a canonical UUID. The browser
   forwards its ordinary Supabase bearer token only to the exact same-origin,
   prefix-confined route. A shared server auth seam creates a fresh user-scoped Supabase
   client from that token — never a service-role client — and the route reads the PNG only
   after an active `team_memberships` row for the configured Team is visible through that
   caller's RLS scope. Unknown config, missing authentication, absent membership, provider
   failure and file failure all return generic private/no-store responses without paths,
   ids or provider detail.

10. **Browser resolution is asynchronous and validates the response before rendering.**
    `createAuthorizedRestrictedAssetResolver` accepts only the shared allowlisted id,
    validates the exact same-origin path before reading the access token, requests with
    `no-store`, accepts only a non-empty `image/png` body below the fixed size limit and
    converts it to an in-memory data URL. A thrown synchronous value, rejected Promise,
    hostile getter/Proxy or invalid response is still one of Decision 3's ordinary
    fail-closed outcomes. The renderer also refuses to display a prior diagram's resolved
    bytes while a new asynchronous check is pending.

11. **Source-language labels are localized as content, not by Exercise-specific UI.**
    The original private source PNGs are retained. Optional normalized overlay metadata
    on the attributed-image Diagram covers an embedded label with English text, validated
    for bounds, colors, positive size and unique identity. The generic renderer maps that
    metadata without inspecting an Exercise id, Version id, title or asset id. The English
    accessible summary remains the image's alternative text.

## Consequences

- Showing a real restricted diagram to the closed beta now requires the configured Team
  UUID, a signed-in active member and the Stage-E server route/resolver composition. It is
  still not a flag that can expose a file from `public/`.
- Replacing a restricted source image with an independently authored structured diagram
  is a content change and therefore requires a **new Exercise Version**; the old version
  keeps its source-image diagram and stays independently resolvable
  (`src/lib/exercises/__tests__/versioning.test.ts`).
- The unavailable state is a real, designed UI state that athletes may actually see, not
  an error path — so it carries the written setup and instructions as the substitute,
  and says plainly that the diagram's delivery has not been authorised here. Every
  failure reason lands on that same state; the athlete is never shown which one, and a
  resolver failure is not surfaced as an application error.
- A resolver implementation is therefore free to reject/throw rather than having to catch
  everything itself. It must still never return a source it is not authorized to return
  — this boundary makes a *failure* safe, not a mistake.
- Any future restricted asset class (a licensed video, a partner's illustration) reuses
  this boundary rather than inventing a second one. If a genuinely public asset is ever
  needed, it should not be modelled as a restricted asset with `publicDeliveryPermitted`
  flipped — that field is validated as `false` precisely so the two cannot blur.
- Section 5.4's external rights gate is unaffected by this ADR: a mechanism that can
  deliver a restricted asset safely is not permission to deliver it.
