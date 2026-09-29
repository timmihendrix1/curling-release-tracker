// The injected export boundary.
//
// Exporting is the step that decides whether an observation session produced evidence
// or produced nothing, so its outcomes are modelled precisely:
//
//   - `shared`   — the share sheet completed. The operator chose a destination.
//   - `cancelled`— the operator dismissed the share sheet. NOT a saved file, and the
//                  probe must not mark the log as exported on this outcome.
//   - `failed`   — writing or sharing errored.
//
// Collapsing `cancelled` into `shared` would let the probe tell an operator their
// evidence is safe when it is not, and then let them clear the log. Collapsing it into
// `failed` would be merely wrong rather than dangerous, but it is still a different
// fact and is kept separate.

export type ProbeExportOutcome =
  | { kind: "shared"; fileName: string }
  | { kind: "cancelled"; fileName: string }
  | { kind: "failed"; reason: string };

export interface ProbeExportTarget {
  /**
   * Writes `content` somewhere the operator can keep it and offers it for sharing.
   * Implementations must not upload anything anywhere by themselves.
   */
  exportJson(fileName: string, content: string): Promise<ProbeExportOutcome>;
}
