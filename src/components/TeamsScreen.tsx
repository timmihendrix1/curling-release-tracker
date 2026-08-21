"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useSupabaseAuthController,
} from "../lib/supabase/useSupabaseAuthController";
import type { AuthService } from "../lib/supabase/authService";
import { resolveCloudConfig, type CloudConfig, type ConfiguredCloudConfig } from "../lib/supabase/config";
import { createSupabaseTeamService } from "../lib/supabase/teamServiceFactory";
import type {
  AccountNotification,
  DirectlyAssignableFunction,
  Profile,
  TeamAdminRequest,
  TeamFunction,
  TeamInvitation,
} from "../lib/team/types";
import type { InvitationProposal, TeamService, TeamSummary, TeamWorkspace } from "../lib/team/teamService";
import ConfirmModal from "./ConfirmModal";

type TeamsScreenProps = {
  onClose: () => void;
  /** Test-only injection points — production usage passes none of these. */
  config?: CloudConfig;
  createAuthService?: (config: ConfiguredCloudConfig) => AuthService;
  createTeamService?: (config: ConfiguredCloudConfig) => TeamService;
};

type StatusMessage = { kind: "error" | "success"; text: string };

const ASSIGNABLE_FUNCTIONS: DirectlyAssignableFunction[] = ["coach", "training_lead"];

function functionLabel(fn: TeamFunction): string {
  if (fn === "team_admin") return "Team Admin";
  if (fn === "coach") return "Coach";
  return "Training Lead";
}

const primaryButtonClassName =
  "min-h-11 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400";
const secondaryButtonClassName =
  "min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60";
const dangerButtonClassName =
  "min-h-11 rounded-lg bg-red-100 px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60";
const fieldClassName =
  "min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500";

type ReviseFormState = { email: string; participationAsPlayer: boolean; proposedFunctions: TeamFunction[] };

type TeamWorkspaceDetailProps = {
  workspace: TeamWorkspace;
  busy: boolean;
  invitations: TeamInvitation[];
  teamAdminRequests: TeamAdminRequest[];
  inviteEmail: string;
  setInviteEmail: (value: string) => void;
  invitePlayer: boolean;
  setInvitePlayer: (value: boolean) => void;
  inviteFunctions: TeamFunction[];
  setInviteFunctions: (updater: (current: TeamFunction[]) => TeamFunction[]) => void;
  renameInput: string;
  setRenameInput: (value: string) => void;
  isRenaming: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  revisingInvitationId: string | null;
  reviseForm: ReviseFormState;
  setReviseForm: (updater: (current: ReviseFormState) => ReviseFormState) => void;
  onBack: () => void;
  onRenameTeam: () => void;
  onSetParticipation: (membershipId: string, participationAsPlayer: boolean) => void;
  onToggleFunction: (membershipId: string, fn: DirectlyAssignableFunction, currentlyHeld: boolean) => void;
  onRequestAdminPromotion: (membershipId: string) => void;
  onRemoveAdminFunction: (membershipId: string) => void;
  onRemoveMember: (membershipId: string) => void;
  onCreateInvitation: () => void;
  onStartRevise: (invitation: TeamInvitation) => void;
  onCancelRevise: () => void;
  onSaveRevise: () => void;
  onResendInvitation: (invitationId: string) => void;
  onRevokeInvitation: (invitationId: string) => void;
  onRevokeTeamAdminRequest: (requestId: string) => void;
  onRelinquishOwnAdmin: () => void;
  onArchiveTeam: () => void;
  onRestoreTeam: () => void;
  onLeaveTeam: () => void;
};

function displayNameForMembership(workspace: TeamWorkspace, membershipId: string): string {
  return workspace.roster.find((entry) => entry.membershipId === membershipId)?.displayName ?? "(former member)";
}

/** One team's full roster/invitation/administration detail — a separate component
 * (rather than an inline conditional block) so every event handler here is an
 * ordinary render-time closure over plain props, never a ref read reachable from a
 * function *defined* inside the parent's own render body (react-hooks/refs). */
function TeamWorkspaceDetail({
  workspace,
  busy,
  invitations,
  teamAdminRequests,
  inviteEmail,
  setInviteEmail,
  invitePlayer,
  setInvitePlayer,
  inviteFunctions,
  setInviteFunctions,
  renameInput,
  setRenameInput,
  isRenaming,
  onStartRename,
  onCancelRename,
  revisingInvitationId,
  reviseForm,
  setReviseForm,
  onBack,
  onRenameTeam,
  onSetParticipation,
  onToggleFunction,
  onRequestAdminPromotion,
  onRemoveAdminFunction,
  onRemoveMember,
  onCreateInvitation,
  onStartRevise,
  onCancelRevise,
  onSaveRevise,
  onResendInvitation,
  onRevokeInvitation,
  onRevokeTeamAdminRequest,
  onRelinquishOwnAdmin,
  onArchiveTeam,
  onRestoreTeam,
  onLeaveTeam,
}: TeamWorkspaceDetailProps) {
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className={secondaryButtonClassName}>
        ← Back to My Teams
      </button>

      {!isRenaming && (
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-slate-900">
            {workspace.team.name}
            {workspace.team.status === "archived" && (
              <span className="ml-2 text-xs font-normal text-slate-500">(archived)</span>
            )}
          </h3>
          {workspace.isAdmin && workspace.team.status === "active" && (
            <button type="button" onClick={onStartRename} disabled={busy} className={secondaryButtonClassName}>
              Rename
            </button>
          )}
        </div>
      )}

      {isRenaming && (
        <div className="rounded-xl bg-slate-100 p-3">
          <input
            type="text"
            value={renameInput}
            onChange={(event) => setRenameInput(event.target.value)}
            className={fieldClassName}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onRenameTeam}
              disabled={busy || !renameInput.trim()}
              className={secondaryButtonClassName}
            >
              Save
            </button>
            <button type="button" onClick={onCancelRename} disabled={busy} className={secondaryButtonClassName}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-slate-700">Roster</h4>
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
          {workspace.roster.map((entry) => (
            <li key={entry.membershipId} className="p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{entry.displayName ?? "(no name)"}</span>
                <span className="text-xs text-slate-500">
                  {[entry.participationAsPlayer ? "Player" : null, ...entry.functions.map(functionLabel)]
                    .filter(Boolean)
                    .join(", ") || "Member"}
                </span>
              </div>
              {entry.email && <p className="mt-0.5 text-xs text-slate-500">{entry.email}</p>}

              {workspace.isAdmin && workspace.team.status === "active" && entry.membershipId !== workspace.myMembershipId && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSetParticipation(entry.membershipId, !entry.participationAsPlayer)}
                    disabled={busy}
                    className={secondaryButtonClassName}
                  >
                    {entry.participationAsPlayer ? "Set Non-Player" : "Set Player"}
                  </button>
                  {ASSIGNABLE_FUNCTIONS.map((fn) => (
                    <button
                      key={fn}
                      type="button"
                      onClick={() => onToggleFunction(entry.membershipId, fn, entry.functions.includes(fn))}
                      disabled={busy}
                      className={secondaryButtonClassName}
                    >
                      {entry.functions.includes(fn) ? `Remove ${functionLabel(fn)}` : `Assign ${functionLabel(fn)}`}
                    </button>
                  ))}
                  {!entry.functions.includes("team_admin") && (
                    <button
                      type="button"
                      onClick={() => onRequestAdminPromotion(entry.membershipId)}
                      disabled={busy}
                      className={secondaryButtonClassName}
                    >
                      Request Team Admin
                    </button>
                  )}
                  {entry.functions.includes("team_admin") && (
                    <button
                      type="button"
                      onClick={() => onRemoveAdminFunction(entry.membershipId)}
                      disabled={busy}
                      className={dangerButtonClassName}
                    >
                      Remove Team Admin
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveMember(entry.membershipId)}
                    disabled={busy}
                    className={dangerButtonClassName}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {workspace.isAdmin && workspace.team.status === "active" && (
        <div className="rounded-xl bg-slate-100 p-4">
          <h4 className="text-sm font-semibold text-slate-700">Invite a Member</h4>
          <input
            type="email"
            placeholder="Email address"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            className={`${fieldClassName} mt-2`}
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={invitePlayer} onChange={(event) => setInvitePlayer(event.target.checked)} />
            Player
          </label>
          <div className="mt-2 flex gap-3">
            {(["team_admin", "coach", "training_lead"] as TeamFunction[]).map((fn) => (
              <label key={fn} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={inviteFunctions.includes(fn)}
                  onChange={(event) =>
                    setInviteFunctions((current) => (event.target.checked ? [...current, fn] : current.filter((f) => f !== fn)))
                  }
                />
                {functionLabel(fn)}
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={onCreateInvitation}
            disabled={busy || !inviteEmail.trim()}
            className={`${primaryButtonClassName} mt-3 w-full`}
          >
            Send Invitation
          </button>

          {invitations.length > 0 && (
            <ul className="mt-4 space-y-2">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="rounded-lg bg-white p-3 text-sm">
                  {revisingInvitationId === invitation.id ? (
                    <div className="space-y-2">
                      <input
                        type="email"
                        value={reviseForm.email}
                        onChange={(event) => setReviseForm((current) => ({ ...current, email: event.target.value }))}
                        className={fieldClassName}
                      />
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={reviseForm.participationAsPlayer}
                          onChange={(event) =>
                            setReviseForm((current) => ({ ...current, participationAsPlayer: event.target.checked }))
                          }
                        />
                        Player
                      </label>
                      <div className="flex gap-3">
                        {(["team_admin", "coach", "training_lead"] as TeamFunction[]).map((fn) => (
                          <label key={fn} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={reviseForm.proposedFunctions.includes(fn)}
                              onChange={(event) =>
                                setReviseForm((current) => ({
                                  ...current,
                                  proposedFunctions: event.target.checked
                                    ? [...current.proposedFunctions, fn]
                                    : current.proposedFunctions.filter((f) => f !== fn),
                                }))
                              }
                            />
                            {functionLabel(fn)}
                          </label>
                        ))}
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={onSaveRevise}
                          disabled={busy || !reviseForm.email.trim()}
                          className={secondaryButtonClassName}
                        >
                          Save Changes
                        </button>
                        <button type="button" onClick={onCancelRevise} disabled={busy} className={secondaryButtonClassName}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span>{invitation.email}</span>
                        <span className="text-xs text-slate-500">{invitation.status}</span>
                      </div>
                      {invitation.status === "pending" && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => onStartRevise(invitation)}
                            disabled={busy}
                            className={secondaryButtonClassName}
                          >
                            Revise
                          </button>
                          <button
                            type="button"
                            onClick={() => onResendInvitation(invitation.id)}
                            disabled={busy}
                            className={secondaryButtonClassName}
                          >
                            Resend
                          </button>
                          <button
                            type="button"
                            onClick={() => onRevokeInvitation(invitation.id)}
                            disabled={busy}
                            className={dangerButtonClassName}
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {workspace.isAdmin && teamAdminRequests.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-700">Outstanding Admin Requests</h4>
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
            {teamAdminRequests.map((request) => (
              <li key={request.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                <span>{displayNameForMembership(workspace, request.membershipId)}</span>
                <button
                  type="button"
                  onClick={() => onRevokeTeamAdminRequest(request.id)}
                  disabled={busy}
                  className={dangerButtonClassName}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        {workspace.myFunctions.includes("team_admin") && (
          <button type="button" onClick={onRelinquishOwnAdmin} disabled={busy} className={secondaryButtonClassName}>
            Relinquish My Team Admin
          </button>
        )}
        {workspace.isAdmin && workspace.team.status === "active" && (
          <button type="button" onClick={onArchiveTeam} disabled={busy} className={secondaryButtonClassName}>
            Archive Team
          </button>
        )}
        {workspace.isAdmin && workspace.team.status === "archived" && (
          <button type="button" onClick={onRestoreTeam} disabled={busy} className={secondaryButtonClassName}>
            Restore Team
          </button>
        )}
        <button type="button" onClick={onLeaveTeam} disabled={busy} className={dangerButtonClassName}>
          Leave Team
        </button>
      </div>
    </div>
  );
}

/**
 * Settings > Teams — the Team Foundation beta management screen (docs/adr/0022).
 * Entirely cloud-backed (no local persistence of its own): every render reflects a
 * fresh or just-mutated read through the injected `TeamService`. Renders a
 * presentational "sign in first" message when the caller isn't authenticated, never
 * calling any TeamService method itself (requirement 164) — mirrors AccountControl's
 * own cloud-disabled/invalid-configuration/sign-in-first branches.
 */
export default function TeamsScreen({ onClose, config, createAuthService, createTeamService }: TeamsScreenProps) {
  const controller = useSupabaseAuthController({ config, createAuthService });
  const resolvedConfig = useMemo<CloudConfig>(() => config ?? resolveCloudConfig(), [config]);
  const teamService = useMemo<TeamService | null>(() => {
    if (resolvedConfig.status !== "configured") return null;
    return (createTeamService ?? createSupabaseTeamService)(resolvedConfig);
  }, [resolvedConfig, createTeamService]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [profile, setProfile] = useState<Profile | null | "loading">("loading");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [canCreateTeam, setCanCreateTeam] = useState(false);
  const [notifications, setNotifications] = useState<AccountNotification[]>([]);
  const [myAdminRequests, setMyAdminRequests] = useState<Array<TeamAdminRequest & { teamName: string }>>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<TeamWorkspace | null>(null);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [busy, setBusy] = useState(false);

  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamPlayer, setNewTeamPlayer] = useState(true);
  const [newTeamFunctions, setNewTeamFunctions] = useState<DirectlyAssignableFunction[]>([]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePlayer, setInvitePlayer] = useState(true);
  const [inviteFunctions, setInviteFunctions] = useState<TeamFunction[]>([]);

  const [teamAdminRequests, setTeamAdminRequests] = useState<TeamAdminRequest[]>([]);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [revisingInvitationId, setRevisingInvitationId] = useState<string | null>(null);
  const [reviseForm, setReviseForm] = useState<ReviseFormState>({
    email: "",
    participationAsPlayer: true,
    proposedFunctions: [],
  });
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(
    null
  );

  function requestConfirm(title: string, message: string, onConfirm: () => void) {
    setConfirmAction({ title, message, onConfirm });
  }

  function report<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }, onOk: (value: T) => void) {
    if (!mountedRef.current) return;
    if (result.ok) {
      onOk(result.value);
    } else {
      setStatus({ kind: "error", text: result.error.message });
    }
  }

  async function refreshTeamsAndInbox() {
    if (!teamService) return;
    const [teamsResult, canCreateResult, notificationsResult, adminRequestsResult] = await Promise.all([
      teamService.listMyTeams(),
      teamService.hasPilotTeamCreationCapability(),
      teamService.listNotifications(),
      teamService.listAdminRequestsForMe(),
    ]);
    if (!mountedRef.current) return;
    if (teamsResult.ok) setTeams(teamsResult.value);
    if (canCreateResult.ok) setCanCreateTeam(canCreateResult.value);
    if (notificationsResult.ok) setNotifications(notificationsResult.value);
    if (adminRequestsResult.ok) setMyAdminRequests(adminRequestsResult.value);
  }

  async function refreshWorkspace(teamId: string) {
    if (!teamService) return;
    const workspaceResult = await teamService.getTeamWorkspace(teamId);
    if (!mountedRef.current) return;
    report(workspaceResult, (value) => {
      setWorkspace(value);
      if (value.isAdmin) {
        teamService.listInvitations(teamId).then((invitationsResult) => {
          if (mountedRef.current && invitationsResult.ok) setInvitations(invitationsResult.value);
        });
        teamService.listAdminRequestsForTeam(teamId).then((requestsResult) => {
          if (mountedRef.current && requestsResult.ok) setTeamAdminRequests(requestsResult.value);
        });
      } else {
        setInvitations([]);
        setTeamAdminRequests([]);
      }
    });
  }

  useEffect(() => {
    if (controller.state.status !== "signed_in" || !teamService) return;
    let cancelled = false;
    (async () => {
      const profileResult = await teamService.getMyProfile();
      if (cancelled || !mountedRef.current) return;
      if (profileResult.ok) {
        setProfile(profileResult.value);
        if (profileResult.value) await refreshTeamsAndInbox();
      } else {
        setStatus({ kind: "error", text: profileResult.error.message });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- teamService/refreshTeamsAndInbox are stable for the life of one signed-in session
  }, [controller.state.status, teamService]);

  useEffect(() => {
    if (selectedTeamId) refreshWorkspace(selectedTeamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeamId]);

  // `workspace` is only ever trusted for rendering when it matches the currently
  // selected team — this avoids needing a synchronous setState(null) inside the
  // effect above (react-hooks/set-state-in-effect) purely to clear stale data when
  // navigating back to the team list or between teams.
  const activeWorkspace = workspace && workspace.team.id === selectedTeamId ? workspace : null;

  async function withBusy(action: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function handleBootstrapProfile() {
    if (!teamService || !displayNameInput.trim()) return;
    withBusy(async () => {
      const result = await teamService.bootstrapProfile(displayNameInput.trim());
      report(result, async (value) => {
        setProfile(value);
        await refreshTeamsAndInbox();
      });
    });
  }

  function handleCreateTeam() {
    if (!teamService || !newTeamName.trim()) return;
    withBusy(async () => {
      const result = await teamService.createTeam({
        name: newTeamName.trim(),
        participationAsPlayer: newTeamPlayer,
        functions: newTeamFunctions,
      });
      report(result, async (value) => {
        setNewTeamName("");
        setNewTeamFunctions([]);
        setWorkspace(value);
        setSelectedTeamId(value.team.id);
        await refreshTeamsAndInbox();
      });
    });
  }

  function handleCreateInvitation() {
    if (!teamService || !selectedTeamId || !inviteEmail.trim()) return;
    withBusy(async () => {
      const result = await teamService.createInvitation(selectedTeamId, {
        email: inviteEmail.trim(),
        participationAsPlayer: invitePlayer,
        proposedFunctions: inviteFunctions,
      });
      report(result, (value) => {
        setInvitations((current) => [value.invitation, ...current]);
        setInviteEmail("");
        setInviteFunctions([]);
        setStatus(
          value.emailSent
            ? { kind: "success", text: "Invitation sent." }
            : { kind: "error", text: "Invitation created, but the email could not be delivered." }
        );
      });
    });
  }

  function handleResendInvitation(invitationId: string) {
    if (!teamService) return;
    withBusy(async () => {
      const result = await teamService.resendInvitation(invitationId);
      report(result, (value) => {
        setInvitations((current) => [value.invitation, ...current.filter((i) => i.id !== invitationId)]);
      });
    });
  }

  function handleStartRevise(invitation: TeamInvitation) {
    setRevisingInvitationId(invitation.id);
    setReviseForm({
      email: invitation.email,
      participationAsPlayer: invitation.participationAsPlayer,
      proposedFunctions: invitation.proposedFunctions,
    });
  }

  function handleCancelRevise() {
    setRevisingInvitationId(null);
  }

  function handleSaveRevise() {
    if (!teamService || !revisingInvitationId || !reviseForm.email.trim()) return;
    const invitationId = revisingInvitationId;
    const proposal: InvitationProposal = {
      email: reviseForm.email.trim(),
      participationAsPlayer: reviseForm.participationAsPlayer,
      proposedFunctions: reviseForm.proposedFunctions,
    };
    withBusy(async () => {
      const result = await teamService.reviseInvitation(invitationId, proposal);
      report(result, (value) => {
        setInvitations((current) => [value.invitation, ...current.filter((i) => i.id !== invitationId)]);
        setRevisingInvitationId(null);
        setStatus(
          value.emailSent
            ? { kind: "success", text: "Invitation revised and resent." }
            : { kind: "error", text: "Invitation revised, but the email could not be delivered." }
        );
      });
    });
  }

  function handleRevokeInvitation(invitationId: string) {
    if (!teamService) return;
    requestConfirm("Revoke Invitation?", "The existing link will stop working immediately.", () => {
      withBusy(async () => {
        const result = await teamService.revokeInvitation(invitationId);
        report(result, () => {
          setInvitations((current) =>
            current.map((invitation) => (invitation.id === invitationId ? { ...invitation, status: "revoked" } : invitation))
          );
        });
      });
    });
  }

  function handleRevokeTeamAdminRequest(requestId: string) {
    if (!teamService) return;
    requestConfirm("Revoke Admin Request?", "The nominee will no longer be able to accept this request.", () => {
      withBusy(async () => {
        const result = await teamService.revokeAdminRequest(requestId);
        report(result, () => {
          setTeamAdminRequests((current) => current.filter((request) => request.id !== requestId));
        });
      });
    });
  }

  function handleStartRename() {
    if (!workspace) return;
    setRenameInput(workspace.team.name);
    setIsRenaming(true);
  }

  function handleCancelRename() {
    setIsRenaming(false);
  }

  function handleRenameTeam() {
    if (!teamService || !selectedTeamId || !renameInput.trim()) return;
    withBusy(async () => {
      const result = await teamService.renameTeam(selectedTeamId, renameInput.trim());
      report(result, async () => {
        setIsRenaming(false);
        await refreshWorkspace(selectedTeamId);
      });
    });
  }

  function handleSetParticipation(membershipId: string, participationAsPlayer: boolean) {
    if (!teamService || !selectedTeamId) return;
    withBusy(async () => {
      const result = await teamService.setParticipation(selectedTeamId, membershipId, participationAsPlayer);
      report(result, () => refreshWorkspace(selectedTeamId));
    });
  }

  function handleToggleFunction(membershipId: string, fn: DirectlyAssignableFunction, currentlyHeld: boolean) {
    if (!teamService || !selectedTeamId) return;
    withBusy(async () => {
      const result = currentlyHeld
        ? await teamService.removeDirectFunction(selectedTeamId, membershipId, fn)
        : await teamService.assignDirectFunction(selectedTeamId, membershipId, fn);
      report(result, () => refreshWorkspace(selectedTeamId));
    });
  }

  function handleRequestAdminPromotion(membershipId: string) {
    if (!teamService || !selectedTeamId) return;
    withBusy(async () => {
      const result = await teamService.createAdminRequest(selectedTeamId, membershipId);
      report(result, (value) => {
        setStatus(
          value.emailSent
            ? { kind: "success", text: "Admin Request sent." }
            : { kind: "error", text: "Admin Request created, but the email could not be delivered." }
        );
      });
    });
  }

  function handleRemoveAdminFunction(membershipId: string) {
    if (!teamService || !selectedTeamId) return;
    const memberName = workspace ? displayNameForMembership(workspace, membershipId) : "this member";
    requestConfirm(
      "Remove Team Admin?",
      `${memberName} will keep their membership but lose administrative access.`,
      () => {
        withBusy(async () => {
          const result = await teamService.removeAdminFunction(selectedTeamId, membershipId);
          report(result, () => refreshWorkspace(selectedTeamId));
        });
      }
    );
  }

  function handleRemoveMember(membershipId: string) {
    if (!teamService || !selectedTeamId) return;
    const memberName = workspace ? displayNameForMembership(workspace, membershipId) : "this member";
    requestConfirm("Remove Member?", `${memberName} will immediately lose all access to this team.`, () => {
      withBusy(async () => {
        const result = await teamService.removeMember(selectedTeamId, membershipId);
        report(result, (value) => {
          if (!value.notificationEmailSent) {
            setStatus({ kind: "error", text: "Member removed, but the notification email could not be delivered." });
          }
          refreshWorkspace(selectedTeamId);
        });
      });
    });
  }

  function handleLeaveTeam() {
    if (!teamService || !selectedTeamId) return;
    requestConfirm("Leave Team?", "You will lose all access to this team.", () => {
      withBusy(async () => {
        const result = await teamService.leaveTeam(selectedTeamId);
        report(result, async () => {
          setSelectedTeamId(null);
          await refreshTeamsAndInbox();
        });
      });
    });
  }

  function handleRelinquishOwnAdmin() {
    if (!teamService || !selectedTeamId) return;
    requestConfirm("Relinquish Team Admin?", "You will keep your membership, but lose administrative access.", () => {
      withBusy(async () => {
        const result = await teamService.relinquishOwnAdmin(selectedTeamId);
        report(result, () => refreshWorkspace(selectedTeamId));
      });
    });
  }

  function handleArchiveTeam() {
    if (!teamService || !selectedTeamId) return;
    requestConfirm(
      "Archive Team?",
      "Ordinary collaborative writes (roster changes, new invitations) will be suspended until restored.",
      () => {
        withBusy(async () => {
          const result = await teamService.archiveTeam(selectedTeamId);
          report(result, () => refreshWorkspace(selectedTeamId));
        });
      }
    );
  }

  function handleRestoreTeam() {
    if (!teamService || !selectedTeamId) return;
    withBusy(async () => {
      const result = await teamService.restoreTeam(selectedTeamId);
      report(result, () => refreshWorkspace(selectedTeamId));
    });
  }

  function handleAcknowledgeNotification(notificationId: string) {
    if (!teamService) return;
    withBusy(async () => {
      const result = await teamService.acknowledgeNotification(notificationId);
      report(result, () => {
        setNotifications((current) => current.filter((notification) => notification.id !== notificationId));
      });
    });
  }

  function handleAcceptAdminRequest(requestId: string) {
    if (!teamService) return;
    withBusy(async () => {
      const result = await teamService.acceptAdminRequest(requestId);
      report(result, async () => {
        setMyAdminRequests((current) => current.filter((request) => request.id !== requestId));
        await refreshTeamsAndInbox();
        if (selectedTeamId) await refreshWorkspace(selectedTeamId);
      });
    });
  }

  const isSignedIn = controller.state.status === "signed_in";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Teams</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Teams"
            className="rounded-lg px-2 py-1 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            Close
          </button>
        </div>

        <p className="mt-2 text-sm text-slate-600">
          Optional beta collaboration layer — named teams, invitations, and shared
          administration. Never shares your training data; only identity, team
          functions, and (for admins) member email are visible to teammates.
        </p>

        {resolvedConfig.status !== "configured" && (
          <p className="mt-4 rounded-xl bg-slate-100 p-4 text-sm text-slate-600">
            Teams requires cloud sign-in, which isn&apos;t available in this build.
          </p>
        )}

        {resolvedConfig.status === "configured" && !isSignedIn && (
          <p className="mt-4 rounded-xl bg-slate-100 p-4 text-sm text-slate-600">
            Sign in above to use Teams.
          </p>
        )}

        {resolvedConfig.status === "configured" && isSignedIn && (
          <div className="mt-4 space-y-4">
            {status && (
              <p
                role={status.kind === "error" ? "alert" : "status"}
                className={`text-sm ${status.kind === "error" ? "text-red-600" : "text-emerald-700"}`}
              >
                {status.text}
              </p>
            )}

            {profile === "loading" && <p className="text-sm text-slate-500">Loading…</p>}

            {profile === null && (
              <div className="rounded-xl bg-slate-100 p-4">
                <label className="text-sm font-medium text-slate-700" htmlFor="team-display-name">
                  Choose a display name
                </label>
                <p className="mt-1 text-xs text-slate-500">Shown to your teammates — never your email address.</p>
                <input
                  id="team-display-name"
                  type="text"
                  value={displayNameInput}
                  onChange={(event) => setDisplayNameInput(event.target.value)}
                  className={`${fieldClassName} mt-2`}
                />
                <button
                  type="button"
                  onClick={handleBootstrapProfile}
                  disabled={busy || !displayNameInput.trim()}
                  className={`${primaryButtonClassName} mt-3 w-full`}
                >
                  Continue
                </button>
              </div>
            )}

            {profile && profile !== "loading" && (
              <>
                {/* Only "member_removed" notifications render here — an "admin_request"
                    notification is never a second actionable surface alongside "Pending
                    Admin Requests" below (docs/adr/0022 §Notification Convergence: one
                    actionable UI representation, not duplicated). Accepting/revoking a
                    request already resolves its notification server-side, so this list
                    never needs to special-case that kind at all. */}
                {notifications.filter((n) => n.kind === "member_removed").length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-700">Notifications</h3>
                    {notifications
                      .filter((n) => n.kind === "member_removed")
                      .map((notification) => (
                        <div key={notification.id} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                          <p>You were removed from &quot;{String(notification.payload.teamName ?? "a team")}&quot;.</p>
                          <button
                            type="button"
                            onClick={() => handleAcknowledgeNotification(notification.id)}
                            disabled={busy}
                            className={`${secondaryButtonClassName} mt-2`}
                          >
                            Dismiss
                          </button>
                        </div>
                      ))}
                  </div>
                )}

                {myAdminRequests.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-700">Pending Admin Requests</h3>
                    {myAdminRequests.map((request) => (
                      <div key={request.id} className="flex items-center justify-between rounded-lg bg-slate-100 p-3 text-sm">
                        <span>{request.teamName}</span>
                        <button
                          type="button"
                          onClick={() => handleAcceptAdminRequest(request.id)}
                          disabled={busy}
                          className={secondaryButtonClassName}
                        >
                          Accept
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {!selectedTeamId && (
                  <>
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-slate-700">My Teams</h3>
                      {teams === null ? (
                        <p className="text-sm text-slate-500">Loading…</p>
                      ) : teams.length === 0 ? (
                        <p className="text-sm text-slate-500">Not on a team yet.</p>
                      ) : (
                        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
                          {teams.map((summary) => (
                            <li key={summary.team.id}>
                              <button
                                type="button"
                                onClick={() => setSelectedTeamId(summary.team.id)}
                                className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm hover:bg-slate-50"
                              >
                                <span className="font-medium text-slate-900">
                                  {summary.team.name}
                                  {summary.team.status === "archived" && (
                                    <span className="ml-2 text-xs font-normal text-slate-500">(archived)</span>
                                  )}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {[
                                    summary.myParticipationAsPlayer ? "Player" : null,
                                    ...summary.myFunctions.map(functionLabel),
                                  ]
                                    .filter(Boolean)
                                    .join(", ") || "Member"}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {canCreateTeam && (
                      <div className="rounded-xl bg-slate-100 p-4">
                        <h3 className="text-sm font-semibold text-slate-700">Create a Team</h3>
                        <input
                          type="text"
                          placeholder="Team name"
                          value={newTeamName}
                          onChange={(event) => setNewTeamName(event.target.value)}
                          className={`${fieldClassName} mt-2`}
                        />
                        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={newTeamPlayer}
                            onChange={(event) => setNewTeamPlayer(event.target.checked)}
                          />
                          I play on this team
                        </label>
                        <div className="mt-2 flex gap-3">
                          {ASSIGNABLE_FUNCTIONS.map((fn) => (
                            <label key={fn} className="flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={newTeamFunctions.includes(fn)}
                                onChange={(event) =>
                                  setNewTeamFunctions((current) =>
                                    event.target.checked ? [...current, fn] : current.filter((f) => f !== fn)
                                  )
                                }
                              />
                              {functionLabel(fn)}
                            </label>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={handleCreateTeam}
                          disabled={busy || !newTeamName.trim()}
                          className={`${primaryButtonClassName} mt-3 w-full`}
                        >
                          Create Team
                        </button>
                      </div>
                    )}
                  </>
                )}

                {activeWorkspace && (
                  <TeamWorkspaceDetail
                    workspace={activeWorkspace}
                    busy={busy}
                    invitations={invitations}
                    teamAdminRequests={teamAdminRequests}
                    inviteEmail={inviteEmail}
                    setInviteEmail={setInviteEmail}
                    invitePlayer={invitePlayer}
                    setInvitePlayer={setInvitePlayer}
                    inviteFunctions={inviteFunctions}
                    setInviteFunctions={setInviteFunctions}
                    renameInput={renameInput}
                    setRenameInput={setRenameInput}
                    isRenaming={isRenaming}
                    onStartRename={handleStartRename}
                    onCancelRename={handleCancelRename}
                    revisingInvitationId={revisingInvitationId}
                    reviseForm={reviseForm}
                    setReviseForm={setReviseForm}
                    onBack={() => setSelectedTeamId(null)}
                    onRenameTeam={handleRenameTeam}
                    onSetParticipation={handleSetParticipation}
                    onToggleFunction={handleToggleFunction}
                    onRequestAdminPromotion={handleRequestAdminPromotion}
                    onRemoveAdminFunction={handleRemoveAdminFunction}
                    onRemoveMember={handleRemoveMember}
                    onCreateInvitation={handleCreateInvitation}
                    onStartRevise={handleStartRevise}
                    onCancelRevise={handleCancelRevise}
                    onSaveRevise={handleSaveRevise}
                    onResendInvitation={handleResendInvitation}
                    onRevokeInvitation={handleRevokeInvitation}
                    onRevokeTeamAdminRequest={handleRevokeTeamAdminRequest}
                    onRelinquishOwnAdmin={handleRelinquishOwnAdmin}
                    onArchiveTeam={handleArchiveTeam}
                    onRestoreTeam={handleRestoreTeam}
                    onLeaveTeam={handleLeaveTeam}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          isDanger
          onConfirm={() => {
            const action = confirmAction.onConfirm;
            setConfirmAction(null);
            action();
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
