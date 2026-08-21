import { describe, expect, it } from "vitest";
import { withNeverThrows } from "../withNeverThrows";
import { teamOk, teamFailed } from "../errors";
import type { TeamService } from "../teamService";

function fakeService(overrides: Partial<TeamService> = {}): TeamService {
  return {
    getMyProfile: async () => teamOk(null),
    bootstrapProfile: async () => teamOk({ id: "p1", displayName: "Alex", createdAt: "x", updatedAt: "x" }),
    hasPilotTeamCreationCapability: async () => teamOk(false),
    listMyTeams: async () => teamOk([]),
    createTeam: async () => teamFailed("forbidden", "no"),
    getTeamWorkspace: async () => teamFailed("not_found", "no"),
    renameTeam: async () => teamOk(undefined),
    archiveTeam: async () => teamOk(undefined),
    restoreTeam: async () => teamOk(undefined),
    setParticipation: async () => teamOk(undefined),
    assignDirectFunction: async () => teamOk(undefined),
    removeDirectFunction: async () => teamOk(undefined),
    removeAdminFunction: async () => teamOk(undefined),
    relinquishOwnAdmin: async () => teamOk(undefined),
    removeMember: async () => teamOk({ notificationEmailSent: false }),
    leaveTeam: async () => teamOk(undefined),
    listInvitations: async () => teamOk([]),
    createInvitation: async () => teamFailed("invalid_input", "no"),
    reviseInvitation: async () => teamFailed("invalid_input", "no"),
    resendInvitation: async () => teamFailed("invalid_input", "no"),
    revokeInvitation: async () => teamOk(undefined),
    previewInvitation: async () => teamOk({ status: "invalid_token" }),
    acceptInvitation: async () => teamFailed("not_found", "no"),
    listAdminRequestsForMe: async () => teamOk([]),
    listAdminRequestsForTeam: async () => teamOk([]),
    createAdminRequest: async () => teamFailed("forbidden", "no"),
    revokeAdminRequest: async () => teamOk(undefined),
    acceptAdminRequest: async () => teamOk(undefined),
    listNotifications: async () => teamOk([]),
    acknowledgeNotification: async () => teamOk(undefined),
    ...overrides,
  };
}

describe("withNeverThrows", () => {
  it("passes through a well-behaved implementation's results unchanged", async () => {
    const service = withNeverThrows(fakeService());
    expect(await service.getMyProfile()).toEqual({ ok: true, value: null });
    expect(await service.createTeam({ name: "x", participationAsPlayer: true, functions: [] })).toEqual({
      ok: false,
      error: { kind: "forbidden", message: "no" },
    });
  });

  it("converts a rejected promise into an honest unexpected_error result, never an unhandled rejection", async () => {
    const service = withNeverThrows(
      fakeService({
        getMyProfile: async () => {
          throw new Error("ECONNRESET: raw transport detail that must never reach the caller");
        },
      })
    );
    const result = await service.getMyProfile();
    expect(result).toEqual({
      ok: false,
      error: { kind: "unexpected_error", message: "Something went wrong. Please try again." },
    });
  });

  it("converts a synchronous throw the same way as an async rejection", async () => {
    const service = withNeverThrows(
      fakeService({
        listMyTeams: (() => {
          throw new Error("thrown synchronously, before returning a promise");
        }) as unknown as TeamService["listMyTeams"],
      })
    );
    const result = await service.listMyTeams();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unexpected_error");
  });

  it("never leaks the raw thrown error's own message", async () => {
    const service = withNeverThrows(
      fakeService({
        acceptInvitation: async () => {
          throw new Error("permission denied for table team_invitations");
        },
      })
    );
    const result = await service.acceptInvitation("token");
    expect(JSON.stringify(result)).not.toContain("permission denied");
    expect(JSON.stringify(result)).not.toContain("team_invitations");
  });
});
