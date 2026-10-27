// Shared actual archive/domain/catalog admission; no native storage or authority.
import { openInstallationTransferV3 } from "./installationTransferProtection";
import { evaluateInstallationTransferHistoricalV3 } from "./installationTransferHistorical";
import { decodeInstallationTransferV3 } from "./installationTransferV3";
import { encodeTransferCodeUnits } from "./installationTransferCodeUnits";
import type { PreparedSportingRow } from "./installationTransferQuarantineSql";
import { isQuarantineProtectedWire } from "./installationTransferQuarantineWork";
import { evaluateTransferSourceDenial } from "./installationTransferSourceDenial";
async function validateTransferPreparation(wire: unknown, code: unknown, current: () => boolean) {
  if (!isQuarantineProtectedWire(wire) || typeof code !== "string" || code.length !== 47 || !/^ct1-[A-Za-z0-9_-]{43}$/.test(code)) return { ok: false as const, code: "invalid_input" as const };
  const opened = await openInstallationTransferV3(wire, code);
  if (!opened.ok) return { ok: false as const, code: "archive_refused" as const };
  if (!current()) return { ok: false as const, code: "closed" as const };
  const evaluated = await evaluateInstallationTransferHistoricalV3(opened.wire);
  if (!evaluated.ok || evaluated.value.domain.domainStatus === "preserved_unusable") return { ok: false as const, code: "domain_refused" as const };
  if (evaluated.value.historicalStatus !== "catalog_candidate" || evaluated.value.packageDigest !== opened.packageDigest) return { ok: false as const, code: "history_refused" as const };
  if (!current()) return { ok: false as const, code: "closed" as const };
  const decoded = await decodeInstallationTransferV3(opened.wire);
  if (!decoded.ok || decoded.value.envelope.packageDigest !== opened.packageDigest) return { ok: false as const, code: "archive_refused" as const };
  const rows: PreparedSportingRow[] = [];
  for (const item of decoded.value.envelope.items as Record<string, unknown>[]) {
    if (item.category === "sporting" && item.presence === "present") rows.push(Object.freeze({ key: item.key as string, ascii: encodeTransferCodeUnits(item.raw), digest: item.valueDigest as string }));
  }
  return { ok: true as const, openedWire: opened.wire, wire, digest: opened.packageDigest, rows: Object.freeze(rows), recoveryRequired: evaluated.value.domain.domainStatus === "recovery_required" };
}

/** Original route retains its exact result and validation order. */
export async function admitTransferPreparation(wire: unknown, code: unknown, current: () => boolean) {
  const result = await validateTransferPreparation(wire, code, current);
  if (!result.ok) return result;
  const { openedWire: _openedWire, ...original } = result;
  void _openedWire;
  return original;
}
/** Separate dormant route; the caller cannot supply a projection or source facts. */
export async function admitSourceAwareTransferPreparation(wire: unknown, code: unknown, current: () => boolean) {
  const result = await validateTransferPreparation(wire, code, current);
  if (!result.ok) return result;
  const sourceDenial = await evaluateTransferSourceDenial(result.openedWire, result.digest, current);
  if (!current()) return { ok: false as const, code: "closed" as const };
  if (sourceDenial === null) return { ok: false as const, code: "source_denial_refused" as const };
  const { openedWire: _openedWire, ...original } = result;
  void _openedWire;
  return { ...original, sourceDenial };
}
