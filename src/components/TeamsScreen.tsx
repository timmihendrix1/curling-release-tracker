"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveCloudConfig, type CloudConfig, type ConfiguredCloudConfig } from "../lib/supabase/config";
import { createSupabaseTeamService } from "../lib/supabase/teamServiceFactory";
import type {
  AccountNotification,
  DirectlyAssignableFunction,
  TeamAdminRequest,
  TeamFunction,
  TeamInvitation,
} from "../lib/team/types";
import type { InvitationProposal, TeamService, TeamSummary, TeamWorkspace } from "../lib/team/teamService";
import { isCanonicalUuid } from "../lib/uuid";
import ConfirmModal from "./ConfirmModal";
import { useOptionalIdentity, type GateSession } from "./identity/IdentityProvider";
import {
  useSportingCloudSync,
  type SportingCloudSyncContextValue,
} from "./ProfileScopedSportingPersistence";

type TeamsScreenProps = {
  onClose: () => void;
  /** Test-only injection points — production usage passes none of these. */
  config?: CloudConfig;
  createTeamService?: (config: ConfiguredCloudConfig) => TeamService;
  identitySession?: GateSession;
  exerciseSync?: SportingCloudSyncContextValue | null;
};

type StatusMessage = { kind: "error" | "success"; text: string };

const ASSIGNABLE_FUNCTIONS: DirectlyAssignableFunction[] = ["coach", "training_lead"];
// The Identity boundary accepts at most 80 display-name characters. Keep the inbox
// parser fail-closed without importing through that deliberately isolated module.
const MAX_NOTIFICATION_ACTOR_DISPLAY_NAME_LENGTH = 80;

function functionLabel(fn: TeamFunction): string {
  if (fn === "team_admin") return "Team Admin";
  if (fn === "coach") return "Coach";
  return "Training Lead";
}

type TeamExerciseResultChangeNotification = {
  sessionId: string;
  actorDisplayName: string;
  changeKind: "corrected" | "voided";
  changedFieldCount: number;
  reason: string;
};

function teamExerciseResultChangeNotification(
  notification: AccountNotification
): TeamExerciseResultChangeNotification | null {
  if (notification.kind !== "team_exercise_result_changed") return null;
  const payload = notification.payload;
  const actorDisplayName = payload.actorDisplayName;
  const reason = payload.reason;
  if (!isCanonicalUuid(payload.sessionId) || !isCanonicalUuid(payload.actorProfileId) ||
      typeof actorDisplayName !== "string" || actorDisplayName.trim().length === 0 ||
      actorDisplayName.length > MAX_NOTIFICATION_ACTOR_DISPLAY_NAME_LENGTH ||
      (payload.changeKind !== "corrected" && payload.changeKind !== "voided") ||
      !Number.isInteger(payload.changedFieldCount) || (payload.changedFieldCount as number) < 1 ||
      (payload.changedFieldCount as number) > 4 || typeof reason !== "string" ||
      reason !== reason.trim() || reason.length < 10 || reason.length > 500 ||
      new TextEncoder().encode(reason).byteLength > 2_000 ||
      !Number.isFinite(Date.parse(notification.createdAt))) return null;
  return {
    sessionId: payload.sessionId,
    actorDisplayName: actorDisplayName.trim(),
    changeKind: payload.changeKind,
    changedFieldCount: payload.changedFieldCount as number,
    reason,
  };
}

function notificationTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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
  exerciseRecordingPermission: boolean | null;
  onSetExerciseRecordingPermission: (granted: boolean) => void;
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
  exerciseRecordingPermission,
  onSetExerciseRecordingPermission,
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

      {workspace.team.status === "active" && (
        <section className="rounded-xl border border-slate-200 p-4">
          <h4 className="text-sm font-semibold text-slate-800">
            Exercise recording permission
          </h4>
          <p className="mt-1 text-sm text-slate-600">
            Allow this Team to record your individual Exercise results when you take part
            in a shared Training Session. This does not share your existing history or analytics.
          </p>
          {exerciseRecordingPermission === null ? (
            <p className="mt-3 text-sm text-slate-500">
              The current permission could not be confirmed. Connect and reopen this Team to try again.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-700">
                {exerciseRecordingPermission ? "Permission granted" : "Permission not granted"}
              </p>
              <button
                type="button"
                onClick={() => onSetExerciseRecordingPermission(!exerciseRecordingPermission)}
                disabled={busy}
                className={exerciseRecordingPermission ? dangerButtonClassName : secondaryButtonClassName}
              >
                {exerciseRecordingPermission ? "Revoke Permission" : "Grant Permission"}
              </button>
            </div>
          )}
        </section>
      )}

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
 * presentational "complete athlete sign-in" message only for isolated component
 * rendering; production composition reaches it exclusively behind the global gate.
 * No TeamService method is called without a gate-approved session.
 */
export default function TeamsScreen({
  onClose,
  config,
  createTeamService,
  identitySession,
  exerciseSync,
}: TeamsScreenProps) {
  const identity = useOptionalIdentity();
  const contextSportingSync = useSportingCloudSync();
  const sportingSync = exerciseSync === undefined ? contextSportingSync : exerciseSync;
  const session = identitySession ?? identity?.session ?? null;
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
    if (adminRequestsResult.ok) {
      setMyAdminRequests(adminRequestsResult.value);
      // A successful inbox read completes an Admin Request deep-link replay,
      // whether the linked request is still actionable or has already reached a
      // terminal state. On read failure the durable intent remains for retry.
      if (identity?.pendingIntent?.kind === "admin_request") {
        await identity.discardPendingIntent();
      }
    }
  }

  async function refreshWorkspace(teamId: string) {
    if (!teamService) return;
    const workspaceResult = await teamService.getTeamWorkspace(teamId);
    if (!mountedRef.current) return;
    report(workspaceResult, (value) => {
      setWorkspace(value);
      void sportingSync?.refreshTeamExerciseEligibility(value);
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
    if (session === null || !teamService) return;
    let cancelled = false;
    (async () => {
      await refreshTeamsAndInbox();
      if (cancelled || !mountedRef.current) return;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- teamService/refreshTeamsAndInbox are stable for the life of one signed-in session
  }, [session, teamService]);

  useEffect(() => {
    if (selectedTeamId) refreshWorkspace(selectedTeamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeamId]);

  // `workspace` is only ever trusted for rendering when it matches the currently
  // selected team — this avoids needing a synchronous setState(null) inside the
  // effect above (react-hooks/set-state-in-effect) purely to clear stale data when
  // navigating back to the team list or between teams.
  const activeWorkspace = workspace && workspace.team.id === selectedTeamId ? workspace : null;
  const activeExerciseEligibility = activeWorkspace
    ? sportingSync?.teamEligibilitySnapshots.find(
        (snapshot) => snapshot.teamId === activeWorkspace.team.id
      ) ?? null
    : null;
  const myExerciseRecordingPermission = session && activeExerciseEligibility
    ? activeExerciseEligibility.participants.find(
        (participant) => participant.profileId === session.profileId
      )?.recordingPermissionGranted ?? null
    : null;

  async function withBusy(action: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function handleSetExerciseRecordingPermission(granted: boolean) {
    if (!sportingSync || !activeWorkspace) return;
    withBusy(async () => {
      const outcome = await sportingSync.setMyTeamExerciseRecordingPermission(
        activeWorkspace.team.id,
        granted
      );
      if (!mountedRef.current) return;
      setStatus(outcome === "updated"
        ? {
            kind: "success",
            text: granted
              ? "Exercise recording permission granted."
              : "Exercise recording permission revoked.",
          }
        : outcome === "updated_cache_issue"
          ? {
              kind: "error",
              text: "Permission was updated in the cloud, but the offline Team cache could not be saved. Reopen this Team while connected before starting offline training.",
            }
          : {
            kind: "error",
            text: "Exercise recording permission could not be updated. Check the connection and try again.",
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

  const visibleNotifications = notifications.filter((notification) =>
    notification.kind === "member_removed" ||
      teamExerciseResultChangeNotification(notification) !== null
  );

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
          Beta collaboration layer — named teams, invitations, and shared
          administration. It does not share your training data; only identity, team
          functions, and (for admins) member email are visible to teammates.
        </p>

        {resolvedConfig.status !== "configured" && (
          <p className="mt-4 rounded-xl bg-slate-100 p-4 text-sm text-slate-600">
            Teams requires cloud sign-in, which isn&apos;t available in this build.
          </p>
        )}

        {resolvedConfig.status === "configured" && session === null && (
          <p className="mt-4 rounded-xl bg-slate-100 p-4 text-sm text-slate-600">
            Complete athlete sign-in to use Teams.
          </p>
        )}

        {resolvedConfig.status === "configured" && session !== null && (
          <div className="mt-4 space-y-4">
            {status && (
              <p
                role={status.kind === "error" ? "alert" : "status"}
                className={`text-sm ${status.kind === "error" ? "text-red-600" : "text-emerald-700"}`}
              >
                {status.text}
              </p>
            )}

            <>
                {/* Member-removal and metadata-only Team Exercise result-change
                    notifications render here. An "admin_request"
                    notification is never a second actionable surface alongside "Pending
                    Admin Requests" below (docs/adr/0022 §Notification Convergence: one
                    actionable UI representation, not duplicated). Accepting/revoking a
                    request already resolves its notification server-side, so this list
                    never needs to special-case that kind at all. */}
                {visibleNotifications.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-700">Notifications</h3>
                    {visibleNotifications.map((notification) => {
                      const exerciseChange = teamExerciseResultChangeNotification(notification);
                      return (
                        <div key={notification.id} className={`rounded-lg p-3 text-sm ${exerciseChange?.changeKind === "voided" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-900"}`}>
                          {notification.kind === "member_removed" ? (
                            <p>You were removed from &quot;{String(notification.payload.teamName ?? "a team")}&quot;.</p>
                          ) : exerciseChange ? (
                            <>
                              <p className="font-medium">{exerciseChange.actorDisplayName} {exerciseChange.changeKind === "voided" ? "voided" : "corrected"} their result from a shared Team Exercise session.</p>
                              <p className="mt-1 text-xs">{notificationTime(notification.createdAt)} · Session {exerciseChange.sessionId.slice(0, 8)} · {exerciseChange.changedFieldCount} changed {exerciseChange.changedFieldCount === 1 ? "field" : "fields"}</p>
                              <p className="mt-2"><span className="font-medium">Reason:</span> {exerciseChange.reason}</p>
                            </>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleAcknowledgeNotification(notification.id)}
                            disabled={busy}
                            className={`${secondaryButtonClassName} mt-2`}
                          >
                            Dismiss
                          </button>
                        </div>
                      );
                    })}
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
                    exerciseRecordingPermission={myExerciseRecordingPermission}
                    onSetExerciseRecordingPermission={handleSetExerciseRecordingPermission}
                  />
                )}
              </>
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
