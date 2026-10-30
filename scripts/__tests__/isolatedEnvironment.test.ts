import { afterEach, beforeEach, expect, it, vi } from "vitest";
const edge = vi.hoisted(() => ({ exec: vi.fn(), realpath: vi.fn((value: string) => value) }));
vi.mock("node:child_process", () => ({ execFileSync: edge.exec }));
vi.mock("node:fs", () => ({ realpathSync: edge.realpath }));
import { isolatedEnvironment, ownedDatabaseSql } from "../../tests/e2e/isolated-environment";
const owner = "curling-review-test-123456789abc", id = "a".repeat(64), root = "/private/tmp/curling-e2e-infra-synthetic/app";
beforeEach(() => {
  vi.resetAllMocks(); edge.realpath.mockReturnValue(root);
  for (const [key, value] of Object.entries({ CURLING_E2E_ISOLATED: "1", CURLING_E2E_OWNER: owner, CURLING_E2E_DB_CONTAINER: `${owner}-db`, CURLING_E2E_DB_ID: id, CURLING_E2E_TEMP_ROOT: root, CURLING_E2E_APP_ORIGIN: "http://127.0.0.1:43111", CURLING_E2E_MAIL_ORIGIN: "http://127.0.0.1:43112", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:43113", APP_ORIGIN: "http://127.0.0.1:43111" })) vi.stubEnv(key, value);
  edge.exec.mockReturnValue(`${id}|${owner}`);
});
afterEach(() => vi.unstubAllEnvs());
it("requires explicit selectors and consistent loopback endpoints", () => { expect(isolatedEnvironment().databaseId).toBe(id); });
it.each(["CURLING_E2E_OWNER", "CURLING_E2E_DB_CONTAINER", "CURLING_E2E_DB_ID", "CURLING_E2E_TEMP_ROOT", "CURLING_E2E_APP_ORIGIN", "CURLING_E2E_MAIL_ORIGIN", "NEXT_PUBLIC_SUPABASE_URL"])("missing %s causes zero mutations", name => { vi.stubEnv(name, ""); expect(() => ownedDatabaseSql("synthetic SQL")).toThrow(); expect(edge.exec).not.toHaveBeenCalled(); });
it.each(["https://example.invalid", "http://localhost:43111", "http://127.0.0.1:43111/", "http://127.0.0.1:65536"])("refuses foreign or inconsistent endpoint %s", value => { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", value); expect(() => ownedDatabaseSql("synthetic SQL")).toThrow(); expect(edge.exec).not.toHaveBeenCalled(); });
it.each([`${id}|wrong-owner`, `${"b".repeat(64)}|${owner}`, `malformed|${owner}`])("wrong label/id refuses exec", value => { edge.exec.mockReturnValue(value); expect(() => ownedDatabaseSql("synthetic SQL")).toThrow(); expect(edge.exec).toHaveBeenCalledTimes(1); expect(edge.exec.mock.calls[0][1][0]).toBe("inspect"); });
it("executes only positively verified original container ID", () => { ownedDatabaseSql("synthetic SQL"); expect(edge.exec).toHaveBeenCalledTimes(2); expect(edge.exec.mock.calls[1][1].slice(0,3)).toEqual(["exec", "-i", id]); });
