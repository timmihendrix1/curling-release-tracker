// @vitest-environment jsdom
//
// Local persistence evidence: reload, archive, write-failure and retry behaviour for
// measurement-aware sessions, plus proof that malformed new-format data is protected
// rather than repaired away.
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSessionRepository,
  CURRENT_SESSION_STORAGE_KEY,
  SESSION_HISTORY_STORAGE_KEY,
} from "../../sessionRepository";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import type { PersistenceWriteResult, StorageAdapter } from "../../persistence/types";
import type { Session } from "../../../types";
import { BOTH_CONFIGURATION, SPEED_CONFIGURATION } from "./measurementFixtures";

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
        measurement: BOTH_CONFIGURATION,
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
        speed: 2.43,
        targetSpeed: 2.4,
        speedSource: "manual",
        handle: "in",
        createdAt: "2026-10-06T10:01:00.000Z",
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        sessionId: SESSION_ID,
        blockId: BLOCK_ID,
        shotNumber: 2,
        releaseTime: 3.7,
        targetTime: 3.75,
        handle: "out",
        createdAt: "2026-10-06T10:02:00.000Z",
      },
    ],
  };
}

function speedOnlySession(): Session {
  return {
    ...bothSession(),
    blocks: [
      {
        id: BLOCK_ID,
        name: "Speed",
        mode: "fixed",
        createdAt: "2026-10-06T10:00:00.000Z",
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        measurement: SPEED_CONFIGURATION,
      },
    ],
    shots: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        sessionId: SESSION_ID,
        blockId: BLOCK_ID,
        shotNumber: 1,
        speed: 2.41,
        targetSpeed: 2.4,
        speedSource: "manual",
        handle: "in",
        createdAt: "2026-10-06T10:01:00.000Z",
      },
    ],
  };
}

function failingAdapter(): StorageAdapter {
  return {
    async get(key) {
      return { status: "value", value: window.localStorage.getItem(key) };
    },
    async set() {
      return { ok: false, error: { kind: "storage_unavailable" } };
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("local reload", () => {
  it.each([
    ["Both", bothSession],
    ["Speed only", speedOnlySession],
  ])("%s survives a save and reload with every field intact", async (_label, build) => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    const original = build();

    expect(await repository.saveCurrent(original)).toEqual({ ok: true });

    const reloaded = await repository.loadCurrent();
    expect(reloaded.status).toBe("value");
    if (reloaded.status !== "value") return;
    expect(reloaded.value).toEqual(original);
  });

  it("keeps a missing measurement missing across reload, never zero", async () => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    await repository.saveCurrent(bothSession());

    const reloaded = await repository.loadCurrent();
    if (reloaded.status !== "value") throw new Error("expected a value");
    const partial = reloaded.value.shots[1];
    expect(partial.speed).toBeUndefined();
    expect(partial.targetSpeed).toBeUndefined();
    expect(partial.releaseTime).toBe(3.7);
  });

  it("protects malformed new-format data instead of emptying or repairing it", async () => {
    const corrupted = bothSession();
    // A stone claiming a speed without the target it was judged against.
    delete (corrupted.shots[0] as Record<string, unknown>).targetSpeed;
    const stored = JSON.stringify(corrupted);
    window.localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, stored);

    const repository = createSessionRepository(createLocalStorageAdapter());
    const loaded = await repository.loadCurrent();

    expect(loaded.status).toBe("read_failed");
    // The stored bytes are still there, untouched, for recovery.
    expect(window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)).toBe(stored);
  });

  it("refuses to write a session whose measurement state is malformed", async () => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    const corrupted = bothSession();
    delete (corrupted.shots[0] as Record<string, unknown>).targetSpeed;

    const result: PersistenceWriteResult = await repository.saveCurrent(corrupted);
    expect(result.ok).toBe(false);
    expect(window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe("archive", () => {
  it("archives a measurement-aware session into history with everything intact", async () => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    const completed = bothSession();
    const next: Session = {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Training Session",
      date: "2026-10-06T12:00:00.000Z",
      notes: "",
      blocks: [],
      activeBlockId: "",
      shots: [],
    };

    expect(await repository.archiveAndReplace([completed], next)).toEqual({ ok: true });

    const history = await repository.loadHistory();
    expect(history.status).toBe("value");
    if (history.status !== "value") return;
    expect(history.value).toEqual([completed]);

    const current = await repository.loadCurrent();
    if (current.status !== "value") throw new Error("expected a value");
    expect(current.value.id).toBe(next.id);
  });

  it("keeps the existing failure semantics: a failed history write persists nothing", async () => {
    const repository = createSessionRepository(failingAdapter());
    const outcome = await repository.archiveAndReplace([bothSession()], bothSession());
    expect(outcome).toMatchObject({ ok: false, step: "history" });
    expect(window.localStorage.getItem(SESSION_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("a save failure leaves the prior stored value intact and a retry then succeeds", async () => {
    let failNext = true;
    const adapter: StorageAdapter = {
      async get(key) {
        return { status: "value", value: window.localStorage.getItem(key) };
      },
      async set(key, value) {
        if (failNext) {
          failNext = false;
          return { ok: false, error: { kind: "storage_unavailable" } };
        }
        window.localStorage.setItem(key, value);
        return { ok: true };
      },
    };

    const repository = createSessionRepository(adapter);
    const session = bothSession();

    expect((await repository.saveCurrent(session)).ok).toBe(false);
    expect(window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)).toBeNull();

    // Retrying the SAME session succeeds and does not duplicate any stone.
    expect(await repository.saveCurrent(session)).toEqual({ ok: true });
    const reloaded = await repository.loadCurrent();
    if (reloaded.status !== "value") throw new Error("expected a value");
    expect(reloaded.value.shots).toHaveLength(2);
    expect(reloaded.value).toEqual(session);
  });
});
