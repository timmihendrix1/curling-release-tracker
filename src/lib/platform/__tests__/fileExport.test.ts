// @vitest-environment jsdom
//
// The file-delivery boundary (Stage M3a).
//
// The properties that matter are honesty properties: a person must never be
// told their data is safe when it is not, and an export must never be able to
// write outside the directory this application owns.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPORT_ROOT_DIRECTORY,
  buildExportPaths,
  exportFile,
  isConfirmedShareCancellation,
  ANDROID_RECIPIENT_RETENTION_MS,
  protectedExportDirectoriesForTests,
  resetFileExportStateForTests,
  sanitizeDisplayFileName,
  type FileExportRequest,
  type NativeExportBridge,
} from "../fileExport";

const CSV_MIME = "text/csv;charset=utf-8;";
/** Fixed clock: directory names now carry their creation time so the sweep can
 * reason about age (Stage M3a correction). */
const NOW = 1_700_000_000_000;
const at = (id: string, createdAt: number = NOW) =>
  `${EXPORT_ROOT_DIRECTORY}/${createdAt}-${id}`;
const fixedClock = { now: () => NOW };

const JSON_MIME = "application/json;charset=utf-8;";

function request(overrides: Partial<FileExportRequest> = {}): FileExportRequest {
  return {
    displayFileName: "Session.csv",
    content: "a,b\n1,2\n",
    mimeType: CSV_MIME,
    ...overrides,
  };
}

type BridgeState = {
  bridge: NativeExportBridge;
  written: Map<string, string>;
  directories: Set<string>;
  removed: string[];
  shared: Array<{ title?: string; files: string[] }>;
  mkdir: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  share: ReturnType<typeof vi.fn>;
  rmdir: ReturnType<typeof vi.fn>;
};

function makeBridge(
  options: {
    writeRejects?: unknown;
    shareRejects?: unknown;
    shareResult?: { activityType?: string };
    canShare?: boolean;
    canShareRejects?: boolean;
    existingDirectories?: readonly string[];
  } = {}
): BridgeState {
  const written = new Map<string, string>();
  const directories = new Set<string>(options.existingDirectories ?? []);
  const removed: string[] = [];
  const shared: Array<{ title?: string; files: string[] }> = [];

  const mkdir = vi.fn(async (path: string) => {
    directories.add(path);
  });
  const writeFile = vi.fn(async (path: string, data: string) => {
    if (options.writeRejects !== undefined) throw options.writeRejects;
    written.set(path, data);
    return { uri: `file:///app/cache/${path}` };
  });
  const rmdir = vi.fn(async (path: string) => {
    removed.push(path);
    directories.delete(path);
    for (const key of [...written.keys()]) {
      if (key.startsWith(`${path}/`)) written.delete(key);
    }
  });
  const share = vi.fn(async (opts: { title?: string; files: string[] }) => {
    if (options.shareRejects !== undefined) throw options.shareRejects;
    shared.push(opts);
    return options.shareResult ?? { activityType: "com.apple.UIKit.activity.CopyToPasteboard" };
  });

  const bridge: NativeExportBridge = {
    mkdir,
    writeFile,
    rmdir,
    async readdir(path) {
      return [...directories]
        .filter((entry) => entry.startsWith(`${path}/`))
        .map((entry) => entry.slice(path.length + 1));
    },
    async canShare() {
      if (options.canShareRejects) throw new Error("bridge exploded");
      return options.canShare ?? true;
    },
    share,
  };

  return { bridge, written, directories, removed, shared, mkdir, writeFile, share, rmdir };
}

beforeEach(() => {
  resetFileExportStateForTests();
});

afterEach(() => {
  resetFileExportStateForTests();
  vi.restoreAllMocks();
});

describe("Web delivery", () => {
  it("keeps the anchor download, with the caller's filename and content", async () => {
    const clicks: Array<{ download: string | null; href: string }> = [];
    const createdUrls: Blob[] = [];
    const revoked: string[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (blob: Blob) => {
        createdUrls.push(blob);
        return "blob:fake-url";
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push({ download: this.getAttribute("download"), href: this.href });
      });

    const outcome = await exportFile(
      request({ displayFileName: "curling_session_history.csv" }),
      { platform: "web" }
    );

    // The Web platform reports no completion signal, so nothing stronger than
    // "unconfirmed" may be claimed.
    expect(outcome).toEqual({ kind: "unconfirmed" });
    expect(clicks).toEqual([{ download: "curling_session_history.csv", href: "blob:fake-url" }]);
    expect(await createdUrls[0].text()).toBe("a,b\n1,2\n");
    // Released reliably, so a document cannot accumulate blobs.
    expect(revoked).toEqual(["blob:fake-url"]);
    clickSpy.mockRestore();
  });

  it("releases the object URL even when the click throws", async () => {
    const revoked: string[] = [];
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:fake-url",
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("click blocked");
    });

    const outcome = await exportFile(request(), { platform: "web" });

    expect(outcome).toEqual({ kind: "write_failed" });
    expect(revoked).toEqual(["blob:fake-url"]);
  });

  it("never touches the native bridge", async () => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const state = makeBridge();

    await exportFile(request(), {
      platform: "web",
      loadNativeBridge: async () => state.bridge,
    });

    expect(state.share).not.toHaveBeenCalled();
    expect(state.writeFile).not.toHaveBeenCalled();
  });
});

describe("native delivery", () => {
  it.each(["ios", "android"] as const)("writes UTF-8 and shares the file on %s", async (platform) => {
    const state = makeBridge();

    const outcome = await exportFile(
      request({ content: "naïve,Übung,日本語,🥌\n", shareTitle: "Training export" }),
      { platform, loadNativeBridge: async () => state.bridge, newExportId: () => "abc123", ...fixedClock }
    );

    expect(outcome).toEqual({
      kind: "shared",
      activityType: "com.apple.UIKit.activity.CopyToPasteboard",
    });
    const path = `${at("abc123")}/Session.csv`;
    expect(state.writeFile).toHaveBeenCalledWith(path, "naïve,Übung,日本語,🥌\n");
    // `files` is the file-sharing form; `url` would offer the path as text.
    expect(state.shared).toEqual([
      { title: "Training export", files: [`file:///app/cache/${path}`] },
    ]);
  });

  it("uses the .json extension and content for a JSON export", async () => {
    const state = makeBridge();

    await exportFile(
      request({ displayFileName: "team-result.json", content: '{"a":1}', mimeType: JSON_MIME }),
      { platform: "ios", loadNativeBridge: async () => state.bridge, newExportId: () => "id1", ...fixedClock }
    );

    // Asserted on the write call, not on surviving state: a completed export
    // correctly deletes its own file once sharing has settled.
    expect(state.writeFile).toHaveBeenCalledWith(
      `${at("id1")}/team-result.json`,
      '{"a":1}'
    );
  });

  it("reports a completed share without claiming the recipient saved anything", async () => {
    // An empty activityType is an ordinary documented outcome, NOT a cancellation.
    const state = makeBridge({ shareResult: { activityType: "" } });

    const outcome = await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      ...fixedClock,
    });

    expect(outcome).toEqual({ kind: "shared", activityType: null });
  });

  it("performs zero share calls when the file cannot be written", async () => {
    const state = makeBridge({ writeRejects: new Error("disk full") });

    const outcome = await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      ...fixedClock,
    });

    expect(outcome).toEqual({ kind: "write_failed" });
    expect(state.share).not.toHaveBeenCalled();
  });

  it("reports a confirmed cancellation only on the plugin's own signal", async () => {
    const state = makeBridge({ shareRejects: new Error("Share canceled") });

    const outcome = await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      ...fixedClock,
    });

    expect(outcome).toEqual({ kind: "cancelled" });
  });

  it.each([
    ["an unrelated failure", new Error("Error sharing item")],
    ["a message merely containing cancel", new Error("upload cancelled by server policy")],
    ["a concurrent-share rejection", new Error("Can't share while sharing is in progress")],
    ["a non-Error value", "boom"],
    ["null", null],
  ])("treats %s as a share failure, never as cancellation", async (_label, thrown) => {
    const state = makeBridge({ shareRejects: thrown });

    const outcome = await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      ...fixedClock,
    });

    expect(outcome).toEqual({ kind: "share_failed" });
  });

  it("allows a retry after a failure", async () => {
    const failing = makeBridge({ shareRejects: new Error("Error sharing item") });
    expect(
      await exportFile(request(), { platform: "ios", loadNativeBridge: async () => failing.bridge })
    ).toEqual({ kind: "share_failed" });

    const succeeding = makeBridge();
    expect(
      await exportFile(request(), {
        platform: "ios",
        loadNativeBridge: async () => succeeding.bridge,
        ...fixedClock,
      })
    ).toMatchObject({ kind: "shared" });
  });

  it("reports sharing unavailable rather than pretending", async () => {
    const unavailable = makeBridge({ canShare: false });
    expect(
      await exportFile(request(), {
        platform: "ios",
        loadNativeBridge: async () => unavailable.bridge,
        ...fixedClock,
      })
    ).toEqual({ kind: "share_unavailable" });
    expect(unavailable.writeFile).not.toHaveBeenCalled();

    const throwing = makeBridge({ canShareRejects: true });
    expect(
      await exportFile(request(), {
        platform: "ios",
        loadNativeBridge: async () => throwing.bridge,
        ...fixedClock,
      })
    ).toEqual({ kind: "share_unavailable" });
  });

  it("reports missing plugins instead of silently falling back to the browser", async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const outcome = await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => null,
    });

    expect(outcome).toEqual({ kind: "share_unavailable" });
    // A native build must never silently produce a WebView download, which
    // yields no keepable file at all.
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("refuses an unsupported native platform", async () => {
    const state = makeBridge();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const outcome = await exportFile(request(), {
      platform: "unsupported_native",
      loadNativeBridge: async () => state.bridge,
    });

    expect(outcome).toEqual({ kind: "unsupported_platform" });
    expect(state.share).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });
});

describe("safe internal paths", () => {
  it.each([
    ["traversal", "../../../etc/passwd.csv", "passwd.csv"],
    ["backslash traversal", "..\\..\\windows\\system.csv", "system.csv"],
    // base ".." strips to nothing, so the default name is used.
    ["a bare traversal token", "...csv", "export.csv"],
    ["reserved characters", 'a:b*c?d"e<f>g|h.csv', "a-b-c-d-e-f-g-h.csv"],
    ["a leading dot", ".hidden.csv", "hidden.csv"],
    ["an empty name", "", "export.csv"],
    ["only separators", "///", "export.csv"],
    // A disallowed extension is REPLACED, never appended: "notes.exe.csv"
    // would keep a misleading executable-looking name in the file browser.
    ["an unexpected extension", "notes.exe", "notes.csv"],
    ["no extension", "My Session", "My Session.csv"],
  ])("neutralizes %s", (_label, input, expected) => {
    expect(sanitizeDisplayFileName(input, CSV_MIME)).toBe(expected);
  });

  it("keeps an ordinary readable name intact", () => {
    expect(sanitizeDisplayFileName("Draw practice 2026-09-29.csv", CSV_MIME)).toBe(
      "Draw practice 2026-09-29.csv"
    );
  });

  it("bounds the length", () => {
    const name = sanitizeDisplayFileName(`${"x".repeat(500)}.csv`, CSV_MIME);
    expect(name.length).toBeLessThanOrEqual(85);
    expect(name.endsWith(".csv")).toBe(true);
  });

  it("confines every path to the export root and one generated directory", () => {
    const paths = buildExportPaths("../escape", "../../evil.csv", CSV_MIME);
    expect(paths.directory.startsWith(`${EXPORT_ROOT_DIRECTORY}/`)).toBe(true);
    expect(paths.file.startsWith(`${EXPORT_ROOT_DIRECTORY}/`)).toBe(true);
    expect(paths.file).not.toContain("..");
    expect(paths.file.split("/")).toHaveLength(3);
  });

  it("writes a hostile title only inside the generated directory", async () => {
    const state = makeBridge();

    await exportFile(request({ displayFileName: "../../../etc/passwd.csv" }), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "safe1",
      ...fixedClock,
    });

    expect([...state.writeFile.mock.calls[0]][0]).toBe(
      `${at("safe1")}/passwd.csv`
    );
  });
});

describe("concurrency and cleanup", () => {
  it("refuses a second share sheet while one is open", async () => {
    let releaseShare: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseShare = resolve;
    });
    const state = makeBridge();
    state.share.mockImplementation(async () => {
      await gate;
      return { activityType: "x" };
    });

    const first = exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "first",
      ...fixedClock,
    });
    // Let the first reach `share()`.
    await vi.waitFor(() => expect(state.share).toHaveBeenCalledTimes(1));

    const second = await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "second",
      ...fixedClock,
    });

    expect(second).toEqual({ kind: "busy" });
    // The rapid second tap wrote nothing and opened no second sheet.
    expect(state.share).toHaveBeenCalledTimes(1);
    expect(state.written.has(`${EXPORT_ROOT_DIRECTORY}/second/Session.csv`)).toBe(false);

    releaseShare();
    await first;
  });

  it("deletes its own file only AFTER sharing settles", async () => {
    const state = makeBridge();
    const orderOfEvents: string[] = [];
    state.share.mockImplementation(async () => {
      // The receiving app reads the file from this URL while the sheet is open.
      orderOfEvents.push(
        state.written.has(`${at("keep")}/Session.csv`)
          ? "file-present-during-share"
          : "file-missing-during-share"
      );
      return { activityType: "x" };
    });
    state.rmdir.mockImplementation(async (path: string) => {
      orderOfEvents.push(`rmdir:${path}`);
      state.directories.delete(path);
    });

    await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "keep",
      ...fixedClock,
    });

    expect(orderOfEvents[0]).toBe("file-present-during-share");
    expect(orderOfEvents).toContain(`rmdir:${at("keep")}`);
  });

  it("cleans up after a cancellation and a failure too", async () => {
    for (const thrown of [new Error("Share canceled"), new Error("Error sharing item")]) {
      const state = makeBridge({ shareRejects: thrown });
      await exportFile(request(), {
        platform: "ios",
        loadNativeBridge: async () => state.bridge,
        newExportId: () => "tidy",
        ...fixedClock,
      });
      expect(state.removed).toContain(at("tidy"));
    }
  });

  it("admits only one native attempt, even while preparation is still pending", async () => {
    // The original defect: `shareInProgress` was CHECKED before the first await
    // and SET after `writeFile` resolved, so two callers both passed the check
    // and two share sheets opened.
    const state = makeBridge();
    let releaseCanShare: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseCanShare = resolve;
    });
    let canShareCalls = 0;
    const bridge: NativeExportBridge = {
      ...state.bridge,
      async canShare() {
        canShareCalls += 1;
        await gate;
        return true;
      },
    };

    const first = exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => bridge,
      newExportId: () => "first",
      ...fixedClock,
    });
    const second = exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => bridge,
      newExportId: () => "second",
      ...fixedClock,
    });

    releaseCanShare();
    const [a, b] = await Promise.all([first, second]);

    expect(state.share).toHaveBeenCalledTimes(1);
    expect([a.kind, b.kind].filter((kind) => kind === "busy")).toHaveLength(1);
    // The refused attempt never even reached the availability probe.
    expect(canShareCalls).toBe(1);
  });

  it("protects a directory from the moment it is created, not after the write resolves", async () => {
    // The original defect: a directory was registered in-flight only AFTER
    // `writeFile` resolved, so another attempt's sweep could delete a file
    // that was still being written.
    const state = makeBridge();
    let protectedDuringWrite: readonly string[] = [];
    let protectedDuringMkdir: readonly string[] = [];
    state.mkdir.mockImplementation(async () => {
      protectedDuringMkdir = protectedExportDirectoriesForTests();
    });
    state.writeFile.mockImplementation(async (path: string) => {
      // While this write is still pending, the directory must ALREADY be
      // protected — that is the window the original defect left open.
      protectedDuringWrite = protectedExportDirectoriesForTests();
      return { uri: `file:///app/cache/${path}` };
    });

    await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "guarded",
      ...fixedClock,
    });

    expect(protectedDuringMkdir).toContain(at("guarded"));
    expect(protectedDuringWrite).toContain(at("guarded"));
    // And released once the attempt is over, so it does not leak.
    expect(protectedExportDirectoriesForTests()).toEqual([]);
  });

  it("never sweeps a directory younger than the recipient retention window", async () => {
    // A just-created sibling belongs to something; age is what distinguishes an
    // abandoned directory from a live or recently shared one.
    const young = `${EXPORT_ROOT_DIRECTORY}/${NOW - 1000}-young`;
    const ancient = `${EXPORT_ROOT_DIRECTORY}/${NOW - ANDROID_RECIPIENT_RETENTION_MS - 1000}-ancient`;
    const state = makeBridge({ existingDirectories: [young, ancient] });

    await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "current",
      ...fixedClock,
    });

    expect(state.removed).toContain(ancient);
    expect(state.removed).not.toContain(young);
  });

  it("never sweeps a directory whose name carries no age", async () => {
    // An unparseable name has no known age. Deleting it would be a guess.
    const unknown = `${EXPORT_ROOT_DIRECTORY}/legacy-no-stamp`;
    const state = makeBridge({ existingDirectories: [unknown] });

    await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "current",
      ...fixedClock,
    });

    expect(state.removed).not.toContain(unknown);
  });

  it("keeps the file readable after an Android share, so a recipient can still open it", async () => {
    // Android's `activityResult` reports that the CHOOSER returned, not that
    // the recipient finished reading the FileProvider URI it was handed. A
    // mail client that queues a draft reads it after our activity resumes.
    const state = makeBridge();
    let sharedUri = "";
    state.share.mockImplementation(async (options: { files: string[] }) => {
      sharedUri = options.files[0];
      return { activityType: "recipient.package" };
    });

    const outcome = await exportFile(request(), {
      platform: "android",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "droid",
      ...fixedClock,
    });

    expect(outcome).toMatchObject({ kind: "shared" });
    // The recipient opens it AFTER the promise resolved.
    expect(state.written.has(sharedUri.replace("file:///app/cache/", ""))).toBe(true);
    expect(state.removed).not.toContain(at("droid"));
  });

  it("still deletes immediately on iOS, where the activity is finished with the file", async () => {
    // `UIActivityViewController`'s completion handler fires only once the
    // chosen activity has finished with the items, so retaining would leave
    // cache files for no one.
    const state = makeBridge();

    await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "apple",
      ...fixedClock,
    });

    expect(state.removed).toContain(at("apple"));
  });

  it("deletes an Android export only once it is older than the retention window", async () => {
    const retained = `${EXPORT_ROOT_DIRECTORY}/${NOW - ANDROID_RECIPIENT_RETENTION_MS - 1}-old-droid`;
    const state = makeBridge({ existingDirectories: [retained] });

    await exportFile(request(), {
      platform: "android",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "new-droid",
      ...fixedClock,
    });

    expect(state.removed).toContain(retained);
    // The just-shared one is retained for its own recipient.
    expect(state.removed).not.toContain(at("new-droid"));
  });

  it("a later Android export does not delete a recently retained sibling", async () => {
    // "A subsequent export must respect retained files too."
    const recent = `${EXPORT_ROOT_DIRECTORY}/${NOW - 60_000}-recent-droid`;
    const state = makeBridge({ existingDirectories: [recent] });

    await exportFile(request(), {
      platform: "android",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "later",
      ...fixedClock,
    });

    expect(state.removed).not.toContain(recent);
  });

  it("abandons a retired attempt before sharing and discards its file", async () => {
    const state = makeBridge();

    const outcome = await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "retired",
      isRetired: () => true,
      ...fixedClock,
    });

    expect(outcome).toEqual({ kind: "retired" });
    expect(state.share).not.toHaveBeenCalled();
  });

  it("revalidates ownership immediately before the irreversible share", async () => {
    // Retirement that lands DURING the write must still stop the share: this
    // is the last checkpoint before the operating system is involved.
    const state = makeBridge();
    let retired = false;
    state.writeFile.mockImplementation(async (path: string) => {
      retired = true; // the owner goes away while the write is in flight
      return { uri: `file:///app/cache/${path}` };
    });

    const outcome = await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "late-retire",
      isRetired: () => retired,
      ...fixedClock,
    });

    expect(outcome).toEqual({ kind: "retired" });
    expect(state.share).not.toHaveBeenCalled();
    // Its unshared file was not left behind.
    expect(state.removed).toContain(at("late-retire"));
  });

  it("releases its claim on every terminal path, so a retry can follow", async () => {
    const terminal: Array<[string, Parameters<typeof makeBridge>[0]]> = [
      ["write failure", { writeRejects: new Error("disk full") }],
      ["sharing unavailable", { canShare: false }],
      ["cancellation", { shareRejects: new Error("Share canceled") }],
      ["share failure", { shareRejects: new Error("Error sharing item") }],
    ];
    for (const [label, options] of terminal) {
      const failing = makeBridge(options);
      await exportFile(request(), {
        platform: "ios",
        loadNativeBridge: async () => failing.bridge,
        newExportId: () => "t",
        ...fixedClock,
      });
      // A following attempt must be admitted, not refused as `busy`.
      const next = makeBridge();
      const outcome = await exportFile(request(), {
        platform: "ios",
        loadNativeBridge: async () => next.bridge,
        newExportId: () => "after",
        ...fixedClock,
      });
      expect(outcome.kind, label).toBe("shared");
    }
  });

  it("releases its claim when the bridge loader itself rejects", async () => {
    const rejected = await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => {
        throw new Error("loader unavailable");
      },
      ...fixedClock,
    });
    expect(rejected).toEqual({ kind: "share_unavailable" });

    const state = makeBridge();
    const outcome = await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "after-loader-failure",
      ...fixedClock,
    });
    expect(outcome).toMatchObject({ kind: "shared" });
  });

  it("never rejects, whatever the injected dependencies do", async () => {
    for (const dependencies of [
      { loadNativeBridge: async () => { throw new Error("boom"); } },
      { newExportId: () => { throw new Error("id exploded"); } },
      { now: () => { throw new Error("clock exploded"); } },
    ]) {
      await expect(
        exportFile(request(), {
          platform: "ios",
          loadNativeBridge: async () => makeBridge().bridge,
          ...dependencies,
        })
      ).resolves.toBeDefined();
    }
  });

  it("never removes anything outside the export root", async () => {
    const state = makeBridge({
      existingDirectories: [`${EXPORT_ROOT_DIRECTORY}/old`],
    });
    // Unrelated cache content the sweep must not see: `readdir` is only ever
    // called on the export root, so it is not even listed.
    state.directories.add("other-app-cache/important");

    await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "now",
      ...fixedClock,
    });

    expect(state.directories.has("other-app-cache/important")).toBe(true);
    expect(state.removed.every((p) => p.startsWith(`${EXPORT_ROOT_DIRECTORY}/`))).toBe(true);
  });

  it("gives two sequential exports independent files", async () => {
    const state = makeBridge();
    await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "one",
      ...fixedClock,
    });
    const firstPath = state.writeFile.mock.calls[0][0];
    await exportFile(request(), {
      platform: "ios",
      loadNativeBridge: async () => state.bridge,
      newExportId: () => "two",
      ...fixedClock,
    });
    const secondPath = state.writeFile.mock.calls[1][0];

    // Same display name, different owned paths — neither overwrote the other.
    expect(firstPath).not.toBe(secondPath);
    expect(firstPath.endsWith("/Session.csv")).toBe(true);
    expect(secondPath.endsWith("/Session.csv")).toBe(true);
  });
});

describe("cancellation detection", () => {
  it.each(["Share canceled", "share canceled", "  Share canceled  "])(
    "accepts the plugin's exact signal %j",
    (message) => {
      expect(isConfirmedShareCancellation(new Error(message))).toBe(true);
      expect(isConfirmedShareCancellation(message)).toBe(true);
    }
  );

  it.each([
    "Share cancelled",
    "The user cancelled",
    "Error sharing item",
    "dismissed",
    "abort",
    "",
  ])("rejects %j as a cancellation", (message) => {
    expect(isConfirmedShareCancellation(new Error(message))).toBe(false);
  });

  it("rejects values with no usable message", () => {
    for (const value of [null, undefined, 42, {}, { message: 7 }]) {
      expect(isConfirmedShareCancellation(value)).toBe(false);
    }
  });
});
