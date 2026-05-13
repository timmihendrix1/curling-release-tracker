import type { Session, Shot } from "../types";

function convertShotsToCsvRows(
  session: Session,
  shots: Shot[]
): string[] {
  return shots.map((shot) => {
    return [
      session.title,
      new Date(session.date).toLocaleDateString(),
      shot.shotNumber,
      shot.releaseTime,
      shot.handle,
      shot.shotType,
      shot.createdAt,
    ].join(",");
  });
}

export function exportSessionToCsv(session: Session) {
  const header = [
    "session_title",
    "session_date",
    "shot_number",
    "release_time",
    "handle",
    "shot_type",
    "created_at",
  ].join(",");

  const rows = convertShotsToCsvRows(session, session.shots);

  downloadCsv(
    [header, ...rows].join("\n"),
    `${session.title.replace(/\s+/g, "_")}.csv`
  );
}

export function exportHistoryToCsv(sessions: Session[]) {
  const header = [
    "session_title",
    "session_date",
    "shot_number",
    "release_time",
    "handle",
    "shot_type",
    "created_at",
  ].join(",");

  const rows = sessions.flatMap((session) =>
    convertShotsToCsvRows(session, session.shots)
  );

  downloadCsv(
    [header, ...rows].join("\n"),
    "curling_session_history.csv"
  );
}

function downloadCsv(content: string, fileName: string) {
  const blob = new Blob([content], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.setAttribute("download", fileName);

  document.body.appendChild(link);

  link.click();

  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}