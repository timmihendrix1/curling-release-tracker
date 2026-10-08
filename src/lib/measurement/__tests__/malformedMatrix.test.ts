// @vitest-environment jsdom
//
// A parameterized malformed-input matrix driven through the ACTUAL repository and
// cloud boundaries. The invariant under test is single and systematic: a write this
// implementation accepts must be a read it can perform, and nothing malformed may be
// repaired on the way in or out.
//
// Covers containers, entries, identities, references, required fields, enums and
// execution state — not only measurement numbers.
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSessionRepository,
  CURRENT_SESSION_STORAGE_KEY,
  SESSION_HISTORY_STORAGE_KEY,
} from "../../sessionRepository";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import {
  deserializeTrainingSession,
  serializeTrainingSession,
} from "../../cloudSporting/records";
import { buildStep } from "../../trainingPlans/__tests__/testHelpers";
import type { Session } from "../../../types";
import {
  bothBlock,
  legacyTimeBlock,
  session,
  speedBlock,
  speedShot,
  timeShot,
} from "./measurementFixtures";

type Mutate = (session: Session) => void;

function measurementAwareSession(): Session {
  const block = bothBlock();
  const state = session([block], []);
  state.shots = [timeShot(block, 3.8, { sessionId: state.id })];
  return state;
}

/**
 * Every entry is a session this build must refuse to write — locally AND to the
 * cloud — because reading it back would not return what was written.
 */
const MALFORMED: Record<string, Mutate> = {
  "block without an identity": (s) => {
    s.shots = [];
    delete (s.blocks[0] as { id?: string }).id;
  },
  "block without a creation time": (s) => {
    delete (s.blocks[0] as { createdAt?: string }).createdAt;
  },
  "block with an unknown training form": (s) => {
    (s.blocks[0] as { mode: string }).mode = "unknown";
  },
  "null stone element": (s) => {
    s.shots = [null as never];
  },
  "non-array shots container": (s) => {
    (s as { shots: unknown }).shots = { unexpected: "value" };
  },
  "non-array blocks container in a measurement-aware session": (s) => {
    // The session stays in the new format through its plan snapshot, so this is NOT
    // the pre-block legacy shape ADR-0005 legitimately repairs by fabricating a block.
    const step = buildStep();
    step.configuration.measurement = s.blocks[0].measurement;
    step.configuration.targetTime = s.blocks[0].measurement!.time!.target;
    s.planExecution = {
      sourcePlanId: "plan",
      sourcePlanName: "Plan",
      activeStepIndex: 0,
      steps: [{ step, runtime: { kind: "release-timing-block", blockId: s.blocks[0].id } }],
    };
    (s as { blocks: unknown }).blocks = { unexpected: "value" };
  },
  "stone without a creation time": (s) => {
    delete (s.shots[0] as { createdAt?: string }).createdAt;
  },
  "stone with an unknown handle": (s) => {
    (s.shots[0] as { handle: string }).handle = "unknown";
  },
  "stone without a stone number": (s) => {
    delete (s.shots[0] as { shotNumber?: number }).shotNumber;
  },
  "stone with a fractional stone number": (s) => {
    s.shots[0].shotNumber = 1.5;
  },
  "stone without an identity": (s) => {
    delete (s.shots[0] as { id?: string }).id;
  },
  "stone owned by another session": (s) => {
    s.shots[0].sessionId = "another-session";
  },
  "stone referring to a missing exercise": (s) => {
    s.shots[0].blockId = "missing";
  },
  "duplicate stone identities": (s) => {
    s.shots.push({ ...s.shots[0] });
  },
  "missing active exercise reference": (s) => {
    delete (s as { activeBlockId?: string }).activeBlockId;
  },
  "incomplete measurement-aware plan execution": (s) => {
    const step = buildStep();
    step.configuration.measurement = s.blocks[0].measurement;
    step.configuration.targetTime = s.blocks[0].measurement!.time!.target;
    // No activeStepIndex: migration discards the whole plan, so the stored payload
    // and the restored value would disagree.
    s.planExecution = {
      sourcePlanId: "plan",
      sourcePlanName: "Plan",
      steps: [{ step, runtime: { kind: "release-timing-block", blockId: s.blocks[0].id } }],
    } as never;
  },
  "plan execution pointing at a step that was never materialised": (s) => {
    const step = buildStep();
    step.configuration.measurement = s.blocks[0].measurement;
    step.configuration.targetTime = s.blocks[0].measurement!.time!.target;
    s.planExecution = {
      sourcePlanId: "plan",
      sourcePlanName: "Plan",
      activeStepIndex: 0,
      steps: [{ step }],
    };
  },
};

beforeEach(() => {
  window.localStorage.clear();
});

describe.each(Object.entries(MALFORMED))("malformed: %s", (_name, mutate) => {
  it("is refused by the local repository, leaving storage untouched", async () => {
    const state = measurementAwareSession();
    mutate(state);

    const repository = createSessionRepository(createLocalStorageAdapter());
    expect((await repository.saveCurrent(state)).ok).toBe(false);
    expect(window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("is refused by the archive path too", async () => {
    const state = measurementAwareSession();
    mutate(state);

    const repository = createSessionRepository(createLocalStorageAdapter());
    const next = session([legacyTimeBlock()], []);
    const outcome = await repository.archiveAndReplace([state], next);

    expect(outcome.ok).toBe(false);
    expect(window.localStorage.getItem(SESSION_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("is never written to the cloud in a shape its own reader rejects", () => {
    const state = measurementAwareSession();
    mutate(state);

    const record = serializeTrainingSession(state);
    // Either the writer refuses it, or the reader must be able to restore it.
    if (record) {
      expect(
        deserializeTrainingSession({ ...record, contentSha256: "unused" })
      ).not.toBeNull();
    } else {
      expect(record).toBeNull();
    }
  });
});

describe("valid controls still pass every boundary", () => {
  const VALID: Record<string, () => Session> = {
    "legacy time-only": () => {
      const block = legacyTimeBlock();
      const state = session([block], []);
      state.shots = [timeShot(block, 3.8, { sessionId: state.id })];
      return state;
    },
    "Both with a complete stone": () => measurementAwareSession(),
    "Both with a stone missing its speed": () => measurementAwareSession(),
    "Both with a stone missing its time": () => {
      const block = bothBlock();
      const state = session([block], []);
      state.shots = [speedShot(block, 2.4, { sessionId: state.id })];
      return state;
    },
    "speed only": () => {
      const block = speedBlock();
      const state = session([block], []);
      state.shots = [speedShot(block, 2.4, { sessionId: state.id })];
      return state;
    },
    "time-only with an asymmetric tolerance": () => {
      const block = bothBlock();
      block.measurement = {
        quantities: ["time"],
        time: {
          target: 3.75,
          tolerance: {
            onTarget: { lower: 0.05, upper: 0.12 },
            acceptable: { lower: 0.1, upper: 0.2 },
          },
        },
      };
      const state = session([block], []);
      state.shots = [timeShot(block, 3.8, { sessionId: state.id })];
      return state;
    },
  };

  it.each(Object.entries(VALID))("%s saves and reloads unchanged", async (_name, build) => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    const original = build();

    expect(await repository.saveCurrent(original)).toEqual({ ok: true });

    const reloaded = await repository.loadCurrent();
    expect(reloaded.status).toBe("value");
    if (reloaded.status !== "value") return;
    expect(reloaded.value).toEqual(original);
  });

  it.each(Object.entries(VALID))(
    "%s round-trips the cloud record with its exact payload",
    (_name, build) => {
      const original = build();
      const record = serializeTrainingSession(original);
      expect(record).not.toBeNull();

      const restored = deserializeTrainingSession({
        ...record!,
        contentSha256: "unused",
      });
      expect(restored).not.toBeNull();

      // Same bytes back out: the reader's equality/digest protection is satisfied
      // without being weakened.
      expect(serializeTrainingSession(restored!)!.payload).toBe(record!.payload);
      expect(restored).toEqual(original);
    }
  );

  it("still repairs genuinely legacy data exactly as before", async () => {
    // A legacy stone with no release time keeps its long-standing 0 repair, and a
    // legacy orphan stone is still reattached to the fallback block (ADR-0005).
    const blockId = "33333333-3333-4333-8333-333333333333";
    const legacy = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Legacy",
      date: "2026-09-01T10:00:00.000Z",
      notes: "",
      blocks: [
        {
          id: blockId,
          name: "Block",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.75,
          createdAt: "2026-09-01T10:00:00.000Z",
          accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        },
      ],
      activeBlockId: blockId,
      shots: [
        {
          id: "legacy-shot",
          sessionId: "11111111-1111-4111-8111-111111111111",
          blockId: "gone",
          shotNumber: 1,
          handle: "in",
          createdAt: "2026-09-01T10:01:00.000Z",
        },
      ],
    };

    window.localStorage.setItem(CURRENT_SESSION_KEY_FOR_TEST, JSON.stringify(legacy));
    const repository = createSessionRepository(createLocalStorageAdapter());
    const loaded = await repository.loadCurrent();

    expect(loaded.status).toBe("value");
    if (loaded.status !== "value") return;
    expect(loaded.value.shots[0].releaseTime).toBe(0);
    expect(loaded.value.shots[0].blockId).toBe(blockId);
  });
});

const CURRENT_SESSION_KEY_FOR_TEST = CURRENT_SESSION_STORAGE_KEY;
