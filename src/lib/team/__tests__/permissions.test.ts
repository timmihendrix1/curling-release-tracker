import { describe, expect, it } from "vitest";
import {
  canPerformTeamAction,
  listAdminOnlyActions,
  listMemberActions,
  type TeamActorContext,
} from "../permissions";
import type { TeamMembership } from "../types";

function membership(overrides: Partial<TeamMembership> = {}): TeamMembership {
  return {
    id: "m1",
    teamId: "t1",
    profileId: "p1",
    status: "active",
    participationAsPlayer: true,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    endReason: null,
    ...overrides,
  };
}

function context(overrides: Partial<TeamActorContext> = {}): TeamActorContext {
  return {
    membership: membership(),
    functions: [],
    teamStatus: "active",
    ...overrides,
  };
}

describe("canPerformTeamAction — the permission matrix (requirement 21/37-46)", () => {
  it("a non-member can perform no action at all", () => {
    const ctx = context({ membership: null, functions: [] });
    for (const action of [...listMemberActions(), ...listAdminOnlyActions(), "relinquish_own_admin" as const]) {
      expect(canPerformTeamAction(action, ctx)).toBe(false);
    }
  });

  it("a former (ended) member can perform no action — no current team access (requirement 80)", () => {
    const ctx = context({ membership: membership({ status: "ended", endReason: "left" }), functions: [] });
    for (const action of [...listMemberActions(), ...listAdminOnlyActions(), "relinquish_own_admin" as const]) {
      expect(canPerformTeamAction(action, ctx)).toBe(false);
    }
  });

  it("player only: can view and leave, nothing administrative", () => {
    const ctx = context({ functions: [] });
    expect(canPerformTeamAction("view_team", ctx)).toBe(true);
    expect(canPerformTeamAction("view_roster", ctx)).toBe(true);
    expect(canPerformTeamAction("leave_team", ctx)).toBe(true);
    for (const action of listAdminOnlyActions()) {
      expect(canPerformTeamAction(action, ctx)).toBe(false);
    }
    expect(canPerformTeamAction("relinquish_own_admin", ctx)).toBe(false);
  });

  it("playing Team Admin: every admin-only action plus member actions and relinquish", () => {
    const ctx = context({ functions: ["team_admin"] });
    for (const action of [...listMemberActions(), ...listAdminOnlyActions()]) {
      expect(canPerformTeamAction(action, ctx)).toBe(true);
    }
    expect(canPerformTeamAction("relinquish_own_admin", ctx)).toBe(true);
  });

  it("non-playing Team Admin: same permissions as playing admin — participation is independent", () => {
    const ctx = context({
      membership: membership({ participationAsPlayer: false }),
      functions: ["team_admin"],
    });
    for (const action of listAdminOnlyActions()) {
      expect(canPerformTeamAction(action, ctx)).toBe(true);
    }
  });

  it("playing Coach (no admin): member actions only, no admin-only action", () => {
    const ctx = context({ functions: ["coach"] });
    expect(canPerformTeamAction("view_team", ctx)).toBe(true);
    expect(canPerformTeamAction("leave_team", ctx)).toBe(true);
    for (const action of listAdminOnlyActions()) {
      expect(canPerformTeamAction(action, ctx)).toBe(false);
    }
  });

  it("non-playing Coach: same as playing coach — participation never grants or removes function permissions", () => {
    const ctx = context({ membership: membership({ participationAsPlayer: false }), functions: ["coach"] });
    for (const action of listAdminOnlyActions()) {
      expect(canPerformTeamAction(action, ctx)).toBe(false);
    }
  });

  it("Team Admin + Coach: admin permissions apply regardless of the extra Coach function", () => {
    const ctx = context({ functions: ["team_admin", "coach"] });
    for (const action of listAdminOnlyActions()) {
      expect(canPerformTeamAction(action, ctx)).toBe(true);
    }
  });

  it("Team Admin + Coach + Training Lead + player: full admin permissions, composable functions", () => {
    const ctx = context({ functions: ["team_admin", "coach", "training_lead"] });
    for (const action of listAdminOnlyActions()) {
      expect(canPerformTeamAction(action, ctx)).toBe(true);
    }
    expect(canPerformTeamAction("leave_team", ctx)).toBe(true);
  });

  it("Training Lead alone gets base member visibility only, never Admin permissions (requirement 45/132)", () => {
    const ctx = context({ functions: ["training_lead"] });
    expect(canPerformTeamAction("view_team", ctx)).toBe(true);
    expect(canPerformTeamAction("view_roster", ctx)).toBe(true);
    for (const action of listAdminOnlyActions()) {
      expect(canPerformTeamAction(action, ctx)).toBe(false);
    }
  });

  it("frontend-visible action lists are non-empty and disjoint from each other (sanity: the matrix is real, not vacuous)", () => {
    const memberActions = new Set(listMemberActions());
    const adminActions = new Set(listAdminOnlyActions());
    expect(memberActions.size).toBeGreaterThan(0);
    expect(adminActions.size).toBeGreaterThan(0);
    for (const action of memberActions) {
      expect(adminActions.has(action)).toBe(false);
    }
  });
});

describe("canPerformTeamAction — teamStatus materially participates (spec §11)", () => {
  const ARCHIVED_BLOCKED_FOR_ADMIN = [
    "rename_team",
    "manage_invitations",
    "change_participation",
    "assign_direct_function",
    "remove_direct_function",
    "request_admin_promotion",
    "remove_admin_function",
    "remove_member",
    "archive_team",
  ] as const;

  const ARCHIVED_STILL_ALLOWED_FOR_ADMIN = ["view_member_emails", "view_admin_requests", "revoke_admin_request"] as const;

  it("an active Team Admin cannot restore_team (nothing to restore) but can archive_team", () => {
    const ctx = context({ functions: ["team_admin"], teamStatus: "active" });
    expect(canPerformTeamAction("restore_team", ctx)).toBe(false);
    expect(canPerformTeamAction("archive_team", ctx)).toBe(true);
  });

  it("an archived Team blocks every collaborative-write admin action for a Team Admin", () => {
    const ctx = context({ functions: ["team_admin"], teamStatus: "archived" });
    for (const action of ARCHIVED_BLOCKED_FOR_ADMIN) {
      expect(canPerformTeamAction(action, ctx)).toBe(false);
    }
  });

  it("an archived Team still allows admin reads, revoking a pending Admin Request, and restoring", () => {
    const ctx = context({ functions: ["team_admin"], teamStatus: "archived" });
    for (const action of ARCHIVED_STILL_ALLOWED_FOR_ADMIN) {
      expect(canPerformTeamAction(action, ctx)).toBe(true);
    }
    expect(canPerformTeamAction("restore_team", ctx)).toBe(true);
  });

  it("an archived Team still allows an ordinary member to view and leave, and an admin to relinquish their own admin", () => {
    const memberCtx = context({ functions: [], teamStatus: "archived" });
    expect(canPerformTeamAction("view_team", memberCtx)).toBe(true);
    expect(canPerformTeamAction("view_roster", memberCtx)).toBe(true);
    expect(canPerformTeamAction("leave_team", memberCtx)).toBe(true);

    const adminCtx = context({ functions: ["team_admin"], teamStatus: "archived" });
    expect(canPerformTeamAction("relinquish_own_admin", adminCtx)).toBe(true);
  });

  it("a non-admin member of an archived team has no admin-only actions at all", () => {
    const ctx = context({ functions: [], teamStatus: "archived" });
    for (const action of listAdminOnlyActions()) {
      expect(canPerformTeamAction(action, ctx)).toBe(false);
    }
  });

  it("a recovery-status Team suspends every administrative and collaborative action, even for a Team Admin", () => {
    const ctx = context({ functions: ["team_admin"], teamStatus: "recovery" });
    for (const action of [...listAdminOnlyActions(), "restore_team" as const, "relinquish_own_admin" as const]) {
      expect(canPerformTeamAction(action, ctx)).toBe(false);
    }
  });

  it("a recovery-status Team still allows an existing active member to view and leave", () => {
    const ctx = context({ functions: [], teamStatus: "recovery" });
    expect(canPerformTeamAction("view_team", ctx)).toBe(true);
    expect(canPerformTeamAction("view_roster", ctx)).toBe(true);
    expect(canPerformTeamAction("leave_team", ctx)).toBe(true);
  });

  it("a non-member has no actions regardless of teamStatus", () => {
    for (const teamStatus of ["active", "archived", "recovery"] as const) {
      const ctx = context({ membership: null, functions: [], teamStatus });
      for (const action of [...listMemberActions(), ...listAdminOnlyActions(), "restore_team" as const, "relinquish_own_admin" as const]) {
        expect(canPerformTeamAction(action, ctx)).toBe(false);
      }
    }
  });
});
