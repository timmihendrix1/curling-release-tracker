import { describe, expect, it } from "vitest";
import { canRelinquishOrRemoveLastAdmin, wouldViolateLastAdminInvariant } from "../lastAdminInvariant";

describe("last-active-Team-Admin invariant (requirements 44, 93-98)", () => {
  it("blocks removing/demoting/leaving the sole active admin of an active team", () => {
    expect(wouldViolateLastAdminInvariant({ otherActiveAdminCount: 0, teamStatus: "active" })).toBe(true);
  });

  it("allows the action when at least one other active admin remains", () => {
    expect(wouldViolateLastAdminInvariant({ otherActiveAdminCount: 1, teamStatus: "active" })).toBe(false);
    expect(wouldViolateLastAdminInvariant({ otherActiveAdminCount: 3, teamStatus: "active" })).toBe(false);
  });

  it("exempts an archived team even with zero other active admins (requirement 44's explicit exception)", () => {
    expect(wouldViolateLastAdminInvariant({ otherActiveAdminCount: 0, teamStatus: "archived" })).toBe(false);
  });

  it("canRelinquishOrRemoveLastAdmin is the exact negation", () => {
    expect(canRelinquishOrRemoveLastAdmin({ otherActiveAdminCount: 0, teamStatus: "active" })).toBe(false);
    expect(canRelinquishOrRemoveLastAdmin({ otherActiveAdminCount: 0, teamStatus: "archived" })).toBe(true);
    expect(canRelinquishOrRemoveLastAdmin({ otherActiveAdminCount: 1, teamStatus: "active" })).toBe(true);
  });

  it("a merely pending successor request never counts — callers must pass only ACTIVE admin counts (requirement 73/74)", () => {
    // This function takes no "pending requests" parameter at all — it cannot be
    // fooled into treating a pending request as a successor. A caller that (bug)
    // counted a pending request as if it were an active admin would incorrectly pass
    // 1 here; the correct call site passes 0.
    expect(wouldViolateLastAdminInvariant({ otherActiveAdminCount: 0, teamStatus: "active" })).toBe(true);
  });
});
