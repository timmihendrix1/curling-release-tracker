// Eligibility for the M3b4a decision layer (docs/MOBILE_APP_MIGRATION.md Stage M3b0
// §1). The mirrored literals in `nativeMigrationEligibility.ts` are pinned here
// against the REAL exported constants and predicates, so a renamed or added key
// fails this test instead of silently changing what migration would import.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY } from "../../accuracyToleranceProfiles/persistence";
import {
  ASSESSMENT_DRAFT_STORAGE_KEY,
  ASSESSMENT_HISTORY_STORAGE_KEY,
} from "../../assessment/persistence";
import { CLOUD_SPORTING_SYNC_STORAGE_KEY } from "../../cloudSporting/syncStateRepository";
import { isResolutionStorageKey, resolutionStorageKeyFor } from "../../identity/identityBarrierResolution";
import { INTENT_CLEANUP_STORAGE_KEY, PENDING_INTENT_STORAGE_KEY } from "../../identity/pendingIntentRepository";
import { providerSessionStorageKey } from "../../supabase/providerCredentialStorage";
import {
  classifyMigrationSourceKey,
  isEligibleMigrationKey,
  NATIVE_MIGRATION_DIAGRAM_CACHE_PREFIX,
  NATIVE_MIGRATION_IDENTITY_FIXED_KEYS,
  NATIVE_MIGRATION_LEGACY_RETIREMENT_MARKER_KEY,
  NATIVE_MIGRATION_PROFILE_SPORTING_KEYS,
  NATIVE_MIGRATION_RETIRED_UNSCOPED_SPORTING_KEYS,
  NATIVE_MIGRATION_SOURCE_MARKER_KEY,
  NATIVE_MIGRATION_ACTIVATION_RECORD_KEY,
  NATIVE_MIGRATION_FAULT_LATCH_KEY,
} from "../nativeMigrationEligibility";
import {
  LEGACY_SPORTING_RETIREMENT_MARKER_KEY,
  profileScopedSportingStorageKey,
  SPORTING_STORAGE_KEYS,
} from "../profileScopedSportingPersistence";
import { BARRIER, PROFILE_A, PROFILE_B } from "./nativeMigrationTestKit";

describe("mirrored literals are pinned to the real declarations", () => {
  it("the Profile-scoped allow-list equals the real closed allow-list, in order", () => {
    expect(NATIVE_MIGRATION_PROFILE_SPORTING_KEYS).toEqual([
      ...SPORTING_STORAGE_KEYS,
      ASSESSMENT_DRAFT_STORAGE_KEY,
      ASSESSMENT_HISTORY_STORAGE_KEY,
      CLOUD_SPORTING_SYNC_STORAGE_KEY,
    ]);
    expect(NATIVE_MIGRATION_PROFILE_SPORTING_KEYS).toContain(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY);
    expect(NATIVE_MIGRATION_RETIRED_UNSCOPED_SPORTING_KEYS).toEqual([...SPORTING_STORAGE_KEYS]);
  });

  it("every allow-listed key builds the same physical key as the real Profile-scoped adapter", () => {
    for (const key of NATIVE_MIGRATION_PROFILE_SPORTING_KEYS) {
      const physical = profileScopedSportingStorageKey(PROFILE_A, key as (typeof SPORTING_STORAGE_KEYS)[number]);
      expect(classifyMigrationSourceKey(physical)).toEqual({ eligible: true, family: "profile_sporting", profileId: PROFILE_A });
    }
  });

  it("identity keys, the legacy marker and the dynamic family match their declarations", () => {
    expect(NATIVE_MIGRATION_IDENTITY_FIXED_KEYS).toContain(PENDING_INTENT_STORAGE_KEY);
    expect(NATIVE_MIGRATION_IDENTITY_FIXED_KEYS).toContain(INTENT_CLEANUP_STORAGE_KEY);
    expect(NATIVE_MIGRATION_IDENTITY_FIXED_KEYS).toHaveLength(5);
    expect(NATIVE_MIGRATION_LEGACY_RETIREMENT_MARKER_KEY).toBe(LEGACY_SPORTING_RETIREMENT_MARKER_KEY);
    const resolution = resolutionStorageKeyFor(BARRIER) as string;
    expect(isResolutionStorageKey(resolution)).toBe(true);
    expect(classifyMigrationSourceKey(resolution)).toEqual({ eligible: true, family: "identity_barrier_resolution" });
  });

  it("the diagram-cache prefix matches the resolver's literal", () => {
    const source = readFileSync(join(process.cwd(), "src", "lib", "exercises", "exerciseAssets.ts"), "utf8");
    expect(source).toContain(`const CACHE_KEY_PREFIX = "${NATIVE_MIGRATION_DIAGRAM_CACHE_PREFIX.slice(0, -1)}";`);
  });
});

describe("classification by shape only", () => {
  it("admits every family, from every Profile — not just a mounted one", () => {
    expect(isEligibleMigrationKey(`curling.sporting.profile.v1.${PROFILE_B}.curling-release-tracker-cloud-sporting-sync`)).toBe(true);
    for (const key of NATIVE_MIGRATION_IDENTITY_FIXED_KEYS) {
      expect(classifyMigrationSourceKey(key)).toEqual({ eligible: true, family: "identity_fixed" });
    }
    expect(classifyMigrationSourceKey(LEGACY_SPORTING_RETIREMENT_MARKER_KEY)).toEqual({ eligible: true, family: "legacy_retirement_marker" });
  });

  it("rejects malformed Profile UUIDs and unknown suffixes as an unrecognised Profile-namespace key", () => {
    for (const key of [
      `curling.sporting.profile.v1.${PROFILE_A.toUpperCase().replace(/5/g, "A")}.curling-release-tracker-current-session`,
      `curling.sporting.profile.v1.not-a-uuid.curling-release-tracker-current-session`,
      `curling.sporting.profile.v1.${PROFILE_A}.curling-release-tracker-unknown`,
      `curling.sporting.profile.v1.${PROFILE_A}curling-release-tracker-current-session`,
      `curling.sporting.profile.v1.${PROFILE_A}.`,
    ]) {
      expect(classifyMigrationSourceKey(key), key).toEqual({ eligible: false, reason: "profile_namespace_unrecognised" });
    }
  });

  it("never adopts retired unscoped keys, the diagram cache, credentials, its own markers or unknown keys", () => {
    for (const key of SPORTING_STORAGE_KEYS) {
      expect(classifyMigrationSourceKey(key)).toEqual({ eligible: false, reason: "retired_legacy_unscoped" });
    }
    expect(classifyMigrationSourceKey(`${NATIVE_MIGRATION_DIAGRAM_CACHE_PREFIX}asset`)).toEqual({ eligible: false, reason: "diagram_cache" });
    const sessionKey = providerSessionStorageKey("https://synthetic.example.test") as string;
    for (const key of [sessionKey, `${sessionKey}-code-verifier`, `${sessionKey}-flow-abc-code-verifier`, `${sessionKey}-user`]) {
      expect(classifyMigrationSourceKey(key), key).toEqual({ eligible: false, reason: "provider_credential" });
    }
    expect(classifyMigrationSourceKey(NATIVE_MIGRATION_SOURCE_MARKER_KEY)).toEqual({ eligible: false, reason: "migration_source_marker" });
    expect(classifyMigrationSourceKey(NATIVE_MIGRATION_ACTIVATION_RECORD_KEY)).toEqual({ eligible: false, reason: "migration_reserved_target_key" });
    expect(classifyMigrationSourceKey(NATIVE_MIGRATION_FAULT_LATCH_KEY)).toEqual({ eligible: false, reason: "migration_reserved_target_key" });
    for (const key of ["", "random", "curling.identity.accessBarrierResolution.not-a-uuid.v1", 42, null, undefined]) {
      expect(classifyMigrationSourceKey(key).eligible, String(key)).toBe(false);
    }
  });
});
