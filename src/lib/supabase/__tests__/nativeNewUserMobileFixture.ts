import { expect, vi } from "vitest";
import { fixture } from "./nativeTrackerFixture";
export async function mobileFixture() {
  const h = await fixture();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", h.options.config.status === "configured" ? h.options.config.url : "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_SYNTHETIC_HOST_ONLY");
  vi.stubGlobal("fetch", h.fetch);
  vi.spyOn(await import("../../platform/runtimePlatform"), "detectRuntimePlatform").mockReturnValue("ios");
  const engine = vi.spyOn(await import("../../persistence/capacitorSqliteEngine"), "createCapacitorSqliteEngine").mockReturnValue(h.options.migration.sqlite.engine!);
  const protectedFactory = vi.spyOn(await import("../../persistence/capacitorSecureStorageBinding"), "createCapacitorSecureStorageBinding").mockReturnValue(h.binding as unknown as ReturnType<(typeof import("../../persistence/capacitorSecureStorageBinding"))["createCapacitorSecureStorageBinding"]>);
  const { createNewUserMobileApplication } = await import("../newUserMobileApplication");
  const app = createNewUserMobileApplication();
  return { h, app, engine, protectedFactory };
}

// Presentation exposes factual terminal state, never an outward disposal flight.
export async function finishApplication(app: ReturnType<(typeof import("../newUserMobileApplication"))["createNewUserMobileApplication"]>) {
  app.close();
  await vi.waitFor(() => {
    const snapshot = app.getSnapshot();
    expect(snapshot.phase === "closed" || snapshot.phase === "blocked" && snapshot.cleanup !== null).toBe(true);
  });
  return app.getSnapshot().cleanup;
}
