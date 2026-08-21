import { describe, expect, it } from "vitest";
import { parsePostgresErrorMessage } from "../postgresErrorMapping";

describe("parsePostgresErrorMessage (requirement 23: never leak a raw provider error)", () => {
  it("parses a well-formed '<kind>: <message>' RPC error", () => {
    expect(parsePostgresErrorMessage("forbidden: You do not have permission to do this.")).toEqual({
      kind: "forbidden",
      message: "You do not have permission to do this.",
    });
  });

  it("parses every kind this project's RPCs actually raise", () => {
    for (const kind of [
      "invalid_input",
      "forbidden",
      "not_found",
      "already_exists",
      "conflict",
      "expired",
      "revoked",
      "replaced",
      "already_accepted",
      "wrong_email",
      "wrong_nominee",
      "last_admin_invariant",
      "archived_team",
    ]) {
      expect(parsePostgresErrorMessage(`${kind}: detail`).kind).toBe(kind);
    }
  });

  it("falls back to unexpected_error for an unrecognized prefix, never surfacing the raw text", () => {
    const result = parsePostgresErrorMessage("permission denied for table team_memberships");
    expect(result).toEqual({ kind: "unexpected_error", message: "Something went wrong. Please try again." });
  });

  it("falls back to unexpected_error for a genuine Postgres constraint-violation message", () => {
    const result = parsePostgresErrorMessage(
      'duplicate key value violates unique constraint "team_memberships_one_active_per_profile"'
    );
    expect(result.kind).toBe("unexpected_error");
    expect(result.message).not.toContain("constraint");
  });

  it("falls back to unexpected_error for null/empty input", () => {
    expect(parsePostgresErrorMessage(null).kind).toBe("unexpected_error");
    expect(parsePostgresErrorMessage("").kind).toBe("unexpected_error");
  });

  it("a colon with no recognizable prefix (e.g. a URL in an unrelated error) is not misparsed as a kind", () => {
    const result = parsePostgresErrorMessage("https://example.com: connection refused");
    expect(result.kind).toBe("unexpected_error");
  });
});
