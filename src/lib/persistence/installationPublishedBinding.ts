// Private published-artifact provenance. Never current identity or mount authority.
import type { PublicationAnchor } from "./installationTransferPublicationProtocol";
import type { SourceDenialFacts } from "./installationTransferSourceDenial";
type Binding = Readonly<{ context: object; raw: string; anchorDigest: string; anchor: PublicationAnchor; source: SourceDenialFacts; schema: number; current(): boolean }>;
const bindings = new WeakMap<object, Binding>();
/** Sole actual producer: the closed published SQL context after genuine store reads. */
export function recordPublishedInstallationBinding(facts: Binding): object | null {
  try {
    if (facts.current() !== true) return null;
    const handle = Object.freeze(Object.create(null)) as object;
    bindings.set(handle, Object.freeze({ ...facts })); return handle;
  } catch { return null; }
}
/** Identity-only lookup; copied, wrapped or proxied objects gain no provenance. */
export function readPublishedInstallationBinding(value: unknown): Binding | null {
  const facts = value !== null && (typeof value === "object" || typeof value === "function") ? bindings.get(value) : null;
  try { return facts?.current() === true ? facts : null; } catch { return null; }
}
