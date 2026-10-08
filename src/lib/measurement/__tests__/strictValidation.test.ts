// @vitest-environment jsdom
//
// Strictness at the persistence boundaries: malformed or unsupported measurement data
// must produce a protected failure with the stored bytes untouched — never a silent
// downgrade into something that looks like valid legacy training.
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSessionRepository,
  CURRENT_SESSION_STORAGE_KEY,
} from "../../sessionRepository";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import { serializeTrainingSession } from "../../cloudSporting/records";
import { migrateSession } from "../../sessionMigration";
import { validateSessionMeasurementState } from "../validation";
import { BOTH_CONFIGURATION, SPEED_CONFIGURATION } from "./measurementFixtures";
import type { Session } from "../../../types";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "33333333-3333-4333-8333-333333333333";

function bothSession(): Session {
  return {
    id: SESSION_ID,
    title: "Both",
    date: "2026-10-06T10:00:00.000Z",
    notes: "",
    blocks: [
      {
        id: BLOCK_ID,
        name: "Both",
        mode: "fixed",
        measurementMode: "back-hog",
        targetTime: 3.75,
        createdAt: "2026-10-06T10:00:00.000Z",
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        measurement: structuredClone(BOTH_CONFIGURATION),
      },
    ],
    activeBlockId: BLOCK_ID,
    shots: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        sessionId: SESSION_ID,
        blockId: BLOCK_ID,
        shotNumber: 1,
        releaseTime: 3.81,
        targetTime: 3.75,
        handle: "in",
        createdAt: "2026-10-06T10:01:00.000Z",
      },
    ],
  };
}

async function expectRejectedWrite(mutate: (session: Session) => void): Promise<void> {
  const session = bothSession();
  mutate(session);
  const repository = createSessionRepository(createLocalStorageAdapter());
  expect((await repository.saveCurrent(session)).ok).toBe(false);
  expect(window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)).toBeNull();
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("unsupported and malformed shapes are rejected, never filtered down", () => {
  it("rejects an unknown measured quantity rather than silently dropping it", async () => {
    await expectRejectedWrite((session) => {
      (session.blocks[0].measurement!.quantities as string[]).push("future-spin");
    });
  });

  it("rejects a duplicated quantity", async () => {
    await expectRejectedWrite((session) => {
      (session.blocks[0].measurement!.quantities as string[]).push("speed");
    });
  });

  it("returns a protected failure for a null metric configuration instead of throwing", async () => {
    const session = bothSession();
    session.blocks[0].measurement = {
      quantities: ["speed"],
      speed: null as never,
    };
    delete session.blocks[0].targetTime;
    delete session.blocks[0].measurementMode;
    session.shots = [];

    const repository = createSessionRepository(createLocalStorageAdapter());
    await expect(repository.saveCurrent(session)).resolves.toMatchObject({ ok: false });
  });

  it("rejects a configuration entry for a quantity the block does not declare", async () => {
    await expectRejectedWrite((session) => {
      session.blocks[0].measurement = {
        quantities: ["time"],
        time: structuredClone(BOTH_CONFIGURATION.time!),
        speed: structuredClone(BOTH_CONFIGURATION.speed!),
      };
    });
  });

  it("rejects two stored time targets that disagree", async () => {
    await expectRejectedWrite((session) => {
      session.blocks[0].measurement!.time!.target = 4;
    });
  });

  it("rejects a stone referring to an exercise that is not part of the training", async () => {
    await expectRejectedWrite((session) => {
      session.shots.push({
        id: "orphan",
        sessionId: SESSION_ID,
        blockId: "missing-block",
        shotNumber: 2,
        handle: "in",
        createdAt: "2026-10-06T10:02:00.000Z",
      });
    });
  });

  it("rejects two stones sharing one identity", async () => {
    await expectRejectedWrite((session) => {
      session.shots.push({ ...session.shots[0] });
    });
  });

  it("rejects two blocks sharing one identity", async () => {
    await expectRejectedWrite((session) => {
      session.blocks.push({ ...session.blocks[0] });
    });
  });

  it("rejects a stone carrying no real measurement at all", async () => {
    await expectRejectedWrite((session) => {
      delete session.shots[0].releaseTime;
      delete session.shots[0].targetTime;
    });
  });

  it("rejects a time source recorded without a time", async () => {
    await expectRejectedWrite((session) => {
      session.shots[0] = {
        ...session.shots[0],
        releaseTime: undefined,
        targetTime: undefined,
        speed: 2.4,
        targetSpeed: 2.4,
        measurementSource: "external",
      };
    });
  });
});

describe("an orphan stone is never restored as a fabricated zero", () => {
  it("would have acquired releaseTime=0 through migration, and is refused instead", () => {
    const session = bothSession();
    session.shots = [
      {
        id: "orphan",
        sessionId: SESSION_ID,
        blockId: "missing-block",
        shotNumber: 1,
        handle: "in",
        createdAt: "2026-10-06T10:02:00.000Z",
      },
    ];

    // Validation refuses it...
    expect(validateSessionMeasurementState(session).valid).toBe(false);
    // ...and the cloud writer refuses it too, so it can never reach a reader.
    expect(serializeTrainingSession(session)).toBeNull();
  });
});

describe("legitimate legacy behaviour is untouched", () => {
  it("still repairs a legacy stone with a missing release time to 0", () => {
    const legacy = {
      id: SESSION_ID,
      title: "Legacy",
      date: "2026-09-01T10:00:00.000Z",
      notes: "",
      blocks: [
        {
          id: BLOCK_ID,
          name: "Fixed Weight Block",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.75,
          createdAt: "2026-09-01T10:00:00.000Z",
          accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        },
      ],
      activeBlockId: BLOCK_ID,
      shots: [
        {
          id: "legacy-shot",
          sessionId: SESSION_ID,
          blockId: BLOCK_ID,
          shotNumber: 1,
          handle: "in",
          createdAt: "2026-09-01T10:01:00.000Z",
        },
      ],
    };

    expect(validateSessionMeasurementState(legacy).valid).toBe(true);
    expect(migrateSession(legacy).shots[0].releaseTime).toBe(0);
  });

  it("still reassigns a legacy orphan stone to the fallback block", () => {
    const legacy = {
      id: SESSION_ID,
      title: "Legacy",
      date: "2026-09-01T10:00:00.000Z",
      blocks: [
        {
          id: BLOCK_ID,
          name: "Block",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.75,
          createdAt: "2026-09-01T10:00:00.000Z",
          accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        },
      ],
      activeBlockId: BLOCK_ID,
      shots: [
        {
          id: "legacy-orphan",
          sessionId: SESSION_ID,
          blockId: "gone",
          shotNumber: 1,
          releaseTime: 3.8,
          targetTime: 3.75,
          handle: "in",
          createdAt: "2026-09-01T10:01:00.000Z",
        },
      ],
    };

    expect(validateSessionMeasurementState(legacy).valid).toBe(true);
    expect(migrateSession(legacy).shots[0].blockId).toBe(BLOCK_ID);
  });

  it("accepts a well-formed speed-only session", async () => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    const session = bothSession();
    session.blocks[0].measurement = structuredClone(SPEED_CONFIGURATION);
    delete session.blocks[0].targetTime;
    delete session.blocks[0].measurementMode;
    session.shots = [
      {
        id: "s1",
        sessionId: SESSION_ID,
        blockId: BLOCK_ID,
        shotNumber: 1,
        speed: 2.4,
        targetSpeed: 2.4,
        speedSource: "manual",
        handle: "in",
        createdAt: "2026-10-06T10:01:00.000Z",
      },
    ];

    expect(await repository.saveCurrent(session)).toEqual({ ok: true });
  });
});
