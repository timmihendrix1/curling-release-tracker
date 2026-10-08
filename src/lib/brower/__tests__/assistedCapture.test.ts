import { describe, expect, it } from "vitest";
import {
  BROWER_MAX_OFFERED_CANDIDATES,
  armBrowerAssistedCapture,
  browerIntervalFitsShotRange,
  browerCaptureContextsMatch,
  createBrowerAssistedCaptureState,
  describeBrowerBaseline,
  discardAllBrowerCandidates,
  isBrowerRecordExhausted,
  observeBrowerChronRecord,
  retireBrowerCandidate,
  suspendBrowerAssistedCapture,
  verifyBrowerCaptureOwnership,
  type BrowerAssistedCaptureState,
  type BrowerCaptureContext,
  type BrowerCaptureOwnershipSnapshot,
} from "../assistedCapture";
import { BROWER_CHRON_MAX_SPLITS, type BrowerChronRecord } from "../chronDecoder";

const CONTEXT: BrowerCaptureContext = {
  profileId: "profile-1",
  sessionId: "session-1",
  blockId: "block-1",
  sequenceId: "sequence-1",
  measurementMode: "back-hog",
};

function record(cumulativeMs: number[], key = "001-000-0016CDE"): BrowerChronRecord {
  const [memoryLocationDigits, athleteNumberDigits, startTimeDigits] = key.split("-");
  return {
    key,
    memoryLocationDigits,
    athleteNumberDigits,
    unattributedDigits: "FF0000",
    startTimeDigits,
    cumulativeMs,
    appendixCount: 0,
  };
}

function observe(
  state: BrowerAssistedCaptureState,
  cumulativeMs: number[],
  key?: string,
  receivedAt = "2026-09-30T10:00:00.000Z"
): BrowerAssistedCaptureState {
  return observeBrowerChronRecord(state, {
    record: record(cumulativeMs, key),
    receivedAt,
    // Assembled within the current arming window unless a test says otherwise.
    assemblyStartedAtArmingEpoch: state.armingEpoch,
  });
}

/**
 * An armed state with one complete record already observed — arming now requires a real
 * baseline, so "armed with nothing seen" is no longer a reachable state.
 */
function armed(baselineSplits: number[] = [], key?: string): BrowerAssistedCaptureState {
  // A zero-split record is a complete observation: it establishes which record the
  // timer is on without claiming any measurement. That is what lets a test arm with an
  // empty baseline for the record it then exercises.
  const observing = observeBrowerChronRecord(createBrowerAssistedCaptureState(), {
    record: record(baselineSplits, key),
    receivedAt: "2026-09-30T09:00:00.000Z",
    assemblyStartedAtArmingEpoch: 0,
  });
  return armBrowerAssistedCapture(observing, CONTEXT);
}

describe("arming and the setup baseline", () => {
  it("offers nothing before the operator confirms setup", () => {
    const state = observe(createBrowerAssistedCaptureState(), [3798, 37216, 41012]);
    expect(state.phase).toBe("observing");
    expect(state.candidates).toEqual([]);
  });

  it("never offers a split that was already observed when arming happened", () => {
    // Setup triggers: three splits exist before the operator confirms.
    const observing = observe(createBrowerAssistedCaptureState(), [3798, 37216, 41012]);
    const state = armBrowerAssistedCapture(observing, CONTEXT);

    expect(describeBrowerBaseline(state)).toEqual({ recordCount: 1, splitCount: 3 });

    // The same record is resent unchanged.
    const afterRepeat = observe(state, [3798, 37216, 41012]);
    expect(afterRepeat.candidates).toEqual([]);

    // A real throw adds split 4; only that one is offered.
    const afterThrow = observe(afterRepeat, [3798, 37216, 41012, 76756]);
    expect(afterThrow.candidates).toHaveLength(1);
    expect(afterThrow.candidates[0]).toMatchObject({ splitIndex: 4, intervalMs: 35744 });
  });

  it("keeps observing while suspended so a re-arm cannot re-offer what arrived meanwhile", () => {
    const state = observe(armed(), [3798, 37216]);
    expect(state.candidates).toHaveLength(2);

    const suspended = suspendBrowerAssistedCapture(state, "App moved to the background.");
    expect(suspended.candidates).toEqual([]);

    // A split arrives while suspended. It is recorded, but nothing is offered.
    const duringPause = observe(suspended, [3798, 37216, 41012]);
    expect(duringPause.candidates).toEqual([]);

    // Re-arming baselines everything known, including the split seen while paused.
    const rearmed = armBrowerAssistedCapture(duringPause, CONTEXT);
    expect(observe(rearmed, [3798, 37216, 41012]).candidates).toEqual([]);
    expect(observe(rearmed, [3798, 37216, 41012, 76756]).candidates).toHaveLength(1);
  });

  it("starts a clean offered list on every arming", () => {
    const state = observe(armed(), [3798, 37216]);
    expect(armBrowerAssistedCapture(state, CONTEXT).candidates).toEqual([]);
  });

  it("increments the arming epoch so two windows are distinguishable", () => {
    const first = armed();
    expect(first.armingEpoch).toBe(1);
    expect(armBrowerAssistedCapture(first, CONTEXT).armingEpoch).toBe(2);
  });
});

describe("candidate identity", () => {
  it("regenerates an identical id for a byte-for-byte repeat", () => {
    const first = observe(armed(), [3798]);
    const repeated = observe(first, [3798]);
    expect(repeated.candidates).toHaveLength(1);
    expect(repeated.candidates[0].id).toBe(first.candidates[0].id);
  });

  it("keeps two equal times at different split positions distinct", () => {
    // Splits 2 and 4 both describe a 3798 ms interval.
    const state = observe(armed(), [10000, 13798, 20000, 23798]);
    const equalValued = state.candidates.filter((candidate) => candidate.intervalMs === 3798);
    expect(equalValued).toHaveLength(2);
    expect(equalValued[0].id).not.toBe(equalValued[1].id);
    expect(equalValued.map((candidate) => candidate.splitIndex)).toEqual([2, 4]);
  });

  it("gives records at different memory locations different candidate ids", () => {
    const first = observe(armed(), [3798], "001-000-0016CDE");
    // A second record cannot be offered in the same arming window (see the
    // record-change rule), so the ids are compared across two windows.
    const second = observe(
      armBrowerAssistedCapture(first, CONTEXT),
      [3798, 7594],
      "002-000-0016CDE"
    );
    expect(first.candidates[0].id).not.toBe(second.candidates[0]?.id);
    expect(first.candidates[0].recordKey).toBe("001-000-0016CDE");
  });

  it("binds every candidate to the full capture context", () => {
    const state = observe(armed(), [3798]);
    expect(state.candidates[0].context).toEqual(CONTEXT);
    expect(browerCaptureContextsMatch(state.candidates[0].context, CONTEXT)).toBe(true);
    expect(
      browerCaptureContextsMatch(state.candidates[0].context, { ...CONTEXT, blockId: "block-2" })
    ).toBe(false);
    expect(
      browerCaptureContextsMatch(state.candidates[0].context, {
        ...CONTEXT,
        measurementMode: "hog-hog",
      })
    ).toBe(false);
  });

  it("records arrival time without claiming it is a measurement time", () => {
    const state = observe(armed(), [3798], undefined, "2026-09-30T12:34:56.789Z");
    expect(state.candidates[0].observedAt).toBe("2026-09-30T12:34:56.789Z");
  });
});

describe("retiring candidates", () => {
  it("never re-offers an accepted candidate, even after a resend", () => {
    const state = observe(armed(), [3798, 37216]);
    const accepted = retireBrowerCandidate(state, state.candidates[0].id, "accepted");
    expect(accepted.candidates).toHaveLength(1);

    const resent = observe(accepted, [3798, 37216]);
    expect(resent.candidates.map((candidate) => candidate.splitIndex)).toEqual([2]);
  });

  it("discards a candidate without offering it again and without creating anything", () => {
    const state = observe(armed(), [3798, 37216]);
    const discarded = retireBrowerCandidate(state, state.candidates[1].id, "discarded");
    expect(discarded.candidates.map((candidate) => candidate.splitIndex)).toEqual([1]);
    expect(observe(discarded, [3798, 37216]).candidates.map((c) => c.splitIndex)).toEqual([1]);
    expect(discarded.retired).toContainEqual({
      id: state.candidates[1].id,
      outcome: "discarded",
    });
  });

  it("discards every offered candidate at once", () => {
    const state = discardAllBrowerCandidates(observe(armed(), [3798, 37216, 41012]));
    expect(state.candidates).toEqual([]);
    expect(observe(state, [3798, 37216, 41012]).candidates).toEqual([]);
  });

  it("is idempotent for a candidate retired twice", () => {
    const state = observe(armed(), [3798]);
    const once = retireBrowerCandidate(state, state.candidates[0].id, "accepted");
    const twice = retireBrowerCandidate(once, state.candidates[0].id, "accepted");
    expect(twice.retired).toHaveLength(1);
    expect(twice.candidates).toEqual([]);
  });
});

describe("continuity", () => {
  it("suspends when a split position reports a different value than before", () => {
    const state = observe(armed(), [3798, 37216]);
    const changed = observe(state, [3798, 37999]);
    expect(changed.phase).toBe("suspended");
    expect(changed.candidates).toEqual([]);
    expect(changed.suspendedReason).toMatch(/split 2 changed from 37216 ms to 37999 ms/);
  });

  it("suspends when a record loses splits", () => {
    const state = observe(armed(), [3798, 37216, 41012]);
    const shrunk = observe(state, [3798, 37216]);
    expect(shrunk.phase).toBe("suspended");
    expect(shrunk.suspendedReason).toMatch(/2 splits after previously reporting 3/);
  });

  it("keeps the superseded record's new state so a re-arm baselines it", () => {
    const state = observe(armed(), [3798, 37216]);
    const changed = observe(state, [3798, 37999]);
    expect(changed.observed["001-000-0016CDE"]).toEqual([3798, 37999]);
    expect(observe(armBrowerAssistedCapture(changed, CONTEXT), [3798, 37999]).candidates).toEqual([]);
  });

  it("does not suspend for an ordinary growing record", () => {
    const state = observe(observe(armed(), [3798]), [3798, 37216]);
    expect(state.phase).toBe("armed");
    expect(state.candidates).toHaveLength(2);
  });
});

describe("record exhaustion", () => {
  it("marks a record exhausted at the documented twenty-split limit", () => {
    const twenty = Array.from({ length: 20 }, (_value, index) => (index + 1) * 1000);
    const state = observe(armed(), twenty);
    expect(isBrowerRecordExhausted(state, "001-000-0016CDE")).toBe(true);
  });

  it("does not mark a shorter record exhausted", () => {
    const nineteen = Array.from({ length: 19 }, (_value, index) => (index + 1) * 1000);
    expect(isBrowerRecordExhausted(observe(armed(), nineteen), "001-000-0016CDE")).toBe(false);
  });

  it("stops offering when the timer moves to a new record, until the operator re-arms", () => {
    const twenty = Array.from({ length: 20 }, (_value, index) => (index + 1) * 1000);
    const exhausted = observe(armed(), twenty);
    expect(isBrowerRecordExhausted(exhausted, "001-000-0016CDE")).toBe(true);
    expect(exhausted.candidates).toHaveLength(20);

    // Pressing New starts record 002. Capture does not silently continue into it, and
    // pending candidates are invalidated when the operator changes the record.
    const newRecord = observe(exhausted, [4200], "002-000-0016CDE");
    expect(newRecord.phase).toBe("suspended");
    expect(newRecord.suspendedReason).toMatch(/started a new record/);
    expect(newRecord.candidates).toHaveLength(0);
    expect(newRecord.candidates.every((c) => c.recordKey === "001-000-0016CDE")).toBe(true);

    // After re-arming, the new record's own later splits are offered.
    const rearmed = armBrowerAssistedCapture(newRecord, CONTEXT);
    const next = observe(rearmed, [4200, 8000], "002-000-0016CDE");
    expect(next.candidates).toHaveLength(1);
    expect(next.candidates[0]).toMatchObject({ recordKey: "002-000-0016CDE", splitIndex: 2 });
  });
});

describe("the bounded offered list", () => {
  it("never truncates a coherent full record, so its final measurement survives", () => {
    // The bound must exceed what one record can hold, or a full 20-split record would
    // silently lose its last measurement to the display limit.
    expect(BROWER_MAX_OFFERED_CANDIDATES).toBeGreaterThanOrEqual(BROWER_CHRON_MAX_SPLITS);

    const twenty = Array.from({ length: 20 }, (_value, index) => (index + 1) * 1000);
    const state = observe(armed(), twenty);
    expect(state.candidates).toHaveLength(20);
    expect(state.droppedCandidateCount).toBe(0);
    expect(state.candidates.at(-1)).toMatchObject({ splitIndex: 20 });
  });
});

describe("assembly rejections", () => {
  it("offers nothing for a record that never reaches the state machine", () => {
    // An invalid or incomplete assembly is rejected before this module sees it, so it
    // adds no candidate and no split — only the zero-split baseline observation exists.
    const state = armed();
    expect(state.candidates).toEqual([]);
    expect(state.observed).toEqual({ "001-000-0016CDE": [] });
  });
});

describe("acceptance ownership", () => {
  const MATCHING: BrowerCaptureOwnershipSnapshot = {
    sessionReady: true,
    assessmentCaptureActive: false,
    profileId: "profile-1",
    sessionId: "session-1",
    activeBlockId: "block-1",
    activeBlockMeasurementMode: "back-hog",
    captureSequenceId: "sequence-1",
  };

  it("permits acceptance when every bound part still matches", () => {
    expect(verifyBrowerCaptureOwnership(CONTEXT, MATCHING)).toBeNull();
  });

  it.each([
    [
      "the Session domain is not writable",
      { sessionReady: false },
      /not ready to be written/,
    ],
    [
      "an assessment run owns the stream",
      { assessmentCaptureActive: true },
      /assessment run is using the timer/,
    ],
    ["the profile changed", { profileId: "profile-2" }, /signed-in profile changed/],
    ["there is no profile", { profileId: null }, /signed-in profile changed/],
    ["the session changed", { sessionId: "session-2" }, /training session changed/],
    ["there is no session", { sessionId: null }, /training session changed/],
    [
      "the capture sequence changed",
      { captureSequenceId: "sequence-2" },
      /no longer running/,
    ],
    [
      "there is no capture sequence",
      { captureSequenceId: null },
      /no longer running/,
    ],
    ["the active block changed", { activeBlockId: "block-2" }, /training block changed/],
    ["there is no active block", { activeBlockId: null }, /training block changed/],
    [
      "the measurement mode changed",
      { activeBlockMeasurementMode: "hog-hog" as const },
      /now measures hog-hog, not back-hog/,
    ],
  ])("refuses acceptance when %s", (_label, override, expected) => {
    const refusal = verifyBrowerCaptureOwnership(CONTEXT, { ...MATCHING, ...override });
    expect(refusal).not.toBeNull();
    expect(refusal).toMatch(expected);
    // Every refusal says plainly that nothing was recorded.
    expect(refusal).toMatch(/^This time was not recorded/);
  });

  it("checks readiness and assessment ownership before anything else", () => {
    // A completely mismatched context still reports the blocking condition, not a
    // misleading "the block changed".
    expect(
      verifyBrowerCaptureOwnership(CONTEXT, {
        ...MATCHING,
        sessionReady: false,
        profileId: "other",
        sessionId: "other",
      })
    ).toMatch(/not ready to be written/);
  });
});


describe("approved shot-type range filter", () => {
  it.each([
    ["draw", 2999, false], ["draw", 3000, true], ["draw", 5000, true], ["draw", 5001, false],
    ["takeout", 1999, false], ["takeout", 2000, true], ["takeout", 4000, true], ["takeout", 4001, false],
  ] as const)("%s at %i ms: selectable=%s", (shotType, intervalMs, expected) => {
    expect(browerIntervalFitsShotRange(intervalMs, { ...CONTEXT, shotType })).toBe(expected);
  });

  it("does not invent a range for Hog–Hog or unclassified capture", () => {
    expect(browerIntervalFitsShotRange(16020, { ...CONTEXT, measurementMode: "hog-hog", shotType: "draw" })).toBe(true);
    expect(browerIntervalFitsShotRange(16020, CONTEXT)).toBe(true);
  });

  it("keeps the return split for the next SEG subtraction and does not recount repeats", () => {
    let state = armBrowerAssistedCapture(armed(), { ...CONTEXT, shotType: "draw" });
    state = observe(state, [3770, 19790, 23430]);
    expect(state.candidates.map(({ intervalMs, splitIndex }) => [intervalMs, splitIndex])).toEqual([[3770, 1], [3640, 3]]);
    expect(state.filteredCandidateCount).toBe(1);
    expect(state.observed["001-000-0016CDE"]).toEqual([3770, 19790, 23430]);
    state = observe(state, [3770, 19790, 23430]);
    expect(state.filteredCandidateCount).toBe(1);
    expect(state.candidates).toHaveLength(2);
    state = armBrowerAssistedCapture(state, { ...CONTEXT, shotType: "takeout" });
    expect(state.filteredCandidateCount).toBe(0);
    expect(state.candidates).toEqual([]);
    expect(observe(state, [3770, 19790, 23430]).candidates).toEqual([]);
  });

  it("makes Shot Type part of arming and queued acceptance ownership", () => {
    const expected = { ...CONTEXT, shotType: "draw" as const };
    expect(browerCaptureContextsMatch(expected, { ...CONTEXT, shotType: "takeout" })).toBe(false);
    expect(verifyBrowerCaptureOwnership(expected, {
      sessionReady: true, assessmentCaptureActive: false, profileId: CONTEXT.profileId,
      sessionId: CONTEXT.sessionId, activeBlockId: CONTEXT.blockId,
      activeBlockMeasurementMode: CONTEXT.measurementMode, captureSequenceId: CONTEXT.sequenceId,
      captureShotType: "takeout",
    })).toMatch(/shot type changed/);
  });
});
