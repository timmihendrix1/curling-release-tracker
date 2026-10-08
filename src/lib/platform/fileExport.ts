// The one delivery boundary for every file this application hands to the user.
//
// SERIALIZATION IS NOT DELIVERY. Callers build their CSV or JSON exactly as they
// always have — same columns, same field semantics, same privacy filtering — and
// hand the finished string here. Nothing in this module inspects, reshapes or
// adds to that content.
//
// Web keeps the anchor download it has always used. iOS and Android write a real
// UTF-8 file into an app-owned export cache and present the native share sheet,
// because a WebView download produces nothing a person can keep.
//
// See docs/MOBILE_APP_MIGRATION.md §3.3 (the file-export adapter) and Stage M3a.
import { detectRuntimePlatform, type RuntimePlatform } from "./runtimePlatform";

/** What a caller asks to be delivered. */
export type FileExportRequest = {
  /**
   * The name the user should see, extension included — e.g. `"My Session.csv"`.
   * This is a DISPLAY value: it never becomes a path on its own (see
   * `buildExportPaths`).
   */
  displayFileName: string;
  content: string;
  /** Used for the Web `Blob` type. Native delivery is by file extension. */
  mimeType: string;
  /** Share-sheet subject on native. Ignored on Web. */
  shareTitle?: string;
};

/**
 * What actually happened. These are deliberately distinct outcomes, because
 * telling a person their data is safe when it is not is the failure that matters:
 *
 *  - `shared`       the native plugin resolved. What that MEANS differs by
 *                   platform, and neither meaning is durable saving:
 *                   on **iOS** the chosen activity finished with the items it
 *                   was given; on **Android** the CHOOSER returned, which says
 *                   nothing about whether the recipient has read the
 *                   FileProvider URI yet. See `retentionPolicyFor` for the
 *                   mechanism behind each. Nothing here may claim the receiving
 *                   app saved anything.
 *  - `unconfirmed`  the download was handed to the browser. The Web platform
 *                   exposes no completion signal at all, so this is the honest
 *                   ceiling of what can be known.
 *  - `cancelled`    the plugin explicitly reported a dismissed share sheet.
 *  - `write_failed` the file could not be created. Nothing was shared.
 *  - `share_unavailable` sharing is not offered on this device/build.
 *  - `share_failed` sharing errored for a reason that is NOT a cancellation.
 *  - `busy`         another native attempt already holds the single share claim.
 *  - `retired`      the attempt's owner went away (unmount, Profile switch) BEFORE
 *                   the irreversible share call. Nothing was handed to the OS.
 *  - `unsupported_platform` a native platform this build does not implement.
 */
export type FileExportOutcome =
  | { kind: "shared"; activityType: string | null }
  | { kind: "unconfirmed" }
  | { kind: "cancelled" }
  | { kind: "write_failed" }
  | { kind: "share_unavailable" }
  | { kind: "share_failed" }
  | { kind: "busy" }
  | { kind: "retired" }
  | { kind: "unsupported_platform" };

/** The narrow slice of Capacitor's Filesystem/Share this boundary uses. */
export type NativeExportBridge = {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, data: string): Promise<{ uri: string }>;
  rmdir(path: string): Promise<void>;
  readdir(path: string): Promise<readonly string[]>;
  canShare(): Promise<boolean>;
  share(options: { title?: string; files: string[] }): Promise<{ activityType?: string }>;
};

export type FileExportDependencies = {
  platform?: RuntimePlatform;
  /** Resolves the native bridge, or `null` when the plugins are unavailable. */
  loadNativeBridge?: () => Promise<NativeExportBridge | null>;
  /** Web delivery, injected so the anchor mechanics stay testable. */
  webDeliver?: (request: FileExportRequest) => void;
  /** Unique, path-safe id per export. Injected for determinism in tests. */
  newExportId?: () => string;
  /**
   * Asks whether this attempt still has an owner.
   *
   * Consulted after every asynchronous preparation boundary and once more
   * immediately before `share()`, which is the irreversible step. A retired
   * attempt is abandoned and its temporary file removed; it never opens a
   * share sheet.
   */
  isRetired?: () => boolean;
  /** Injected clock, so retention windows are testable without waiting. */
  now?: () => number;
};

/**
 * The single directory this application writes into, inside the OS-managed app
 * cache container. Cleanup is confined to it, so nothing here can reach a file
 * this application did not create — and it is NOT the Documents directory, which
 * would expose exports to other apps and to the Files browser permanently.
 */
export const EXPORT_ROOT_DIRECTORY = "curling-exports";

/** Extensions this boundary is willing to name a file with. */
const ALLOWED_EXTENSIONS = new Set(["csv", "json"]);

const MAX_DISPLAY_BASE_LENGTH = 80;

/** Ceiling on stale export directories removed per sweep, so tidying stays cheap. */
const MAX_SWEEP_PER_EXPORT = 20;

/** Windows-reserved and separator characters, plus anything non-printable. */
const PATH_HOSTILE = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;

function extensionFor(mimeType: string): string {
  return mimeType.includes("json") ? "json" : "csv";
}

/**
 * Turns a display name into a safe basename, and decides the extension.
 *
 * The result is only ever the LAST path segment: `..`, `/`, `\` and NUL cannot
 * survive, so no title — however hostile — can redirect where the file lands.
 * The generated directory above it is what guarantees uniqueness, so this
 * function is free to keep the name readable.
 */
export function sanitizeDisplayFileName(
  displayFileName: string,
  mimeType: string
): string {
  const lastSegment = displayFileName.split(/[/\\]/).pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  const rawBase = dot > 0 ? lastSegment.slice(0, dot) : lastSegment;
  const rawExtension = dot > 0 ? lastSegment.slice(dot + 1).toLowerCase() : "";

  const base =
    rawBase
      .replace(PATH_HOSTILE, "-")
      .replace(/\s+/g, " ")
      // Leading dots would hide the file; trailing dots/spaces are invalid on
      // some filesystems and are silently stripped by others.
      .replace(/^[.\s]+/, "")
      .replace(/[.\s]+$/, "")
      .slice(0, MAX_DISPLAY_BASE_LENGTH)
      .trim() || "export";

  const extension = ALLOWED_EXTENSIONS.has(rawExtension)
    ? rawExtension
    : extensionFor(mimeType);

  return `${base}.${extension}`;
}

/**
 * Every export gets its OWN generated directory.
 *
 * That is what lets the file keep a readable, user-meaningful name while still
 * being collision-free: two exports of "Session.csv" are two different
 * directories, so neither can overwrite the other, and cleanup of one cannot
 * reach the other.
 */
export function buildExportPaths(
  exportId: string,
  displayFileName: string,
  mimeType: string,
  createdAtMs: number = 0
): { directory: string; file: string; fileName: string } {
  const safeId = exportId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) || "export";
  const fileName = sanitizeDisplayFileName(displayFileName, mimeType);
  // The creation time is encoded in the directory NAME so a later sweep can
  // tell a file still inside its retention window from an abandoned one,
  // without a `stat` call and without a second source of truth.
  const stamp = Number.isFinite(createdAtMs) ? Math.max(0, Math.trunc(createdAtMs)) : 0;
  const directory = `${EXPORT_ROOT_DIRECTORY}/${stamp}-${safeId}`;
  return { directory, file: `${directory}/${fileName}`, fileName };
}

/** Parses the creation stamp back out of a directory name. */
export function exportDirectoryCreatedAt(entryName: string): number | null {
  const match = /^(\d+)-/.exec(entryName);
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * How long an exported file must remain readable, per platform. This is the
 * load-bearing platform difference and it follows each plugin's actual
 * mechanism.
 *
 * The value governs two things:
 *
 *  1. whether an attempt deletes its OWN directory as soon as `share()`
 *     settles — `0` means yes, which is the iOS case below;
 *  2. the age a sibling directory must reach before a later sweep may reclaim
 *     it.
 *
 * (2) is MEASURED FROM DIRECTORY CREATION, not from settlement of the share
 * promise. The threshold is compared against the creation timestamp encoded in
 * the directory name (`buildExportPaths`, stamped before `mkdir`), because that
 * is the only age a later sweep can recover without a second source of truth:
 * by then the attempt that shared the file is long gone. The practical
 * consequence on Android is that the window a recipient actually gets is
 * shorter than the nominal value by however long the share sheet stayed open
 * before a target was chosen.
 *
 * **iOS — delete immediately (0).** `UIActivityViewController`'s
 * `completionWithItemsHandler` fires with `completed == true` only once the
 * chosen activity has finished with the items it was given
 * (`SharePlugin.swift`). The file has been consumed by then.
 *
 * **Android — retain.** `SharePlugin.java` builds a `FileProvider` URI, sets
 * `FLAG_GRANT_READ_URI_PERMISSION`, wraps it in `Intent.createChooser` and
 * calls `startActivityForResult`. The `activityResult` callback therefore
 * reports that the CHOOSER returned — **not** that the recipient finished
 * reading, and not that it saved anything. A mail client that queues a draft,
 * or a cloud app that uploads in the background, reads the content URI after
 * our activity has already resumed. Deleting on the callback would hand the
 * recipient a URI whose bytes are gone.
 * See https://developer.android.com/training/secure-file-sharing/share-file.
 *
 * The window is bounded, not indefinite: these are small files in the
 * OS-managed cache container, which the system may reclaim sooner under
 * storage pressure. That residual limit — together with the creation-time
 * measurement above — is real and is documented rather than engineered away.
 */
export const ANDROID_RECIPIENT_RETENTION_MS = 24 * 60 * 60 * 1000;

export function retentionPolicyFor(platform: RuntimePlatform): number {
  return platform === "android" ? ANDROID_RECIPIENT_RETENTION_MS : 0;
}

/**
 * The plugin's OWN cancellation signal, matched exactly.
 *
 * Capacitor 8's Share plugin rejects a dismissed sheet with literally
 * `"Share canceled"` on both iOS (`SharePlugin.swift`) and Android
 * (`SharePlugin.java`). Matching that exact string — rather than a fuzzy
 * /cancel|abort|dismiss/ regex — is what keeps an unrelated failure whose
 * message merely contains "cancel" from being reported to the user as
 * "you cancelled", which would be a lie about their data.
 *
 * An empty `activityType` is deliberately NOT treated as cancellation: the
 * plugin resolves only when iOS reported `completed`, and an empty identifier is
 * documented as an ordinary possibility.
 */
export function isConfirmedShareCancellation(error: unknown): boolean {
  let message: string | null = null;
  if (typeof error === "string") message = error;
  else if (error instanceof Error) message = error.message;
  else if (typeof error === "object" && error !== null) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string") message = candidate;
  }
  if (message === null) return false;
  return message.trim().toLowerCase() === "share canceled";
}

/**
 * Directories a live attempt owns.
 *
 * Registered BEFORE `mkdir`/`writeFile`, not after: a directory that exists on
 * disk but is not yet registered is exactly the window in which another
 * attempt's sweep would delete a file still being written.
 */
const protectedDirectories = new Set<string>();

/**
 * The single native share claim.
 *
 * Claimed SYNCHRONOUSLY at the top of `exportViaNative`, before the first
 * `await`. Checking a boolean before an await and setting it afterwards leaves
 * a window in which two callers both pass the check — which is how two share
 * sheets get opened.
 *
 * It is a token, not a boolean, so a stale attempt finishing late can only
 * release ITS OWN claim and never a newer one.
 */
let activeShareClaim: symbol | null = null;

/**
 * Directories retained past their own attempt because a recipient may still
 * read them (Android — see `retentionPolicyFor`). Swept later, by age.
 */
const retainedDirectories = new Set<string>();

/** Test-only: the directories a live attempt currently owns. Lets a test
 * observe that protection is in place BEFORE the write resolves, which is the
 * ordering the sweep depends on. */
export function protectedExportDirectoriesForTests(): readonly string[] {
  return [...protectedDirectories];
}

/** Test-only: module-level registries must not leak across tests. */
export function resetFileExportStateForTests(): void {
  protectedDirectories.clear();
  retainedDirectories.clear();
  activeShareClaim = null;
}

function defaultExportId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Math.random()}`.slice(2);
  return random.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
}

function defaultWebDeliver(request: FileExportRequest): void {
  const blob = new Blob([request.content], { type: request.mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", request.displayFileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    // Released even if the DOM steps throw, so a failed export cannot leak the
    // blob for the lifetime of the document.
    URL.revokeObjectURL(url);
  }
}

/**
 * Loads the real Capacitor bridge, and only on native.
 *
 * Dynamic so the Web bundle never pulls in the plugins' web shims: the Web path
 * is the anchor download it has always been, unchanged.
 */
async function loadCapacitorBridge(): Promise<NativeExportBridge | null> {
  try {
    const [{ Directory, Encoding, Filesystem }, { Share }, { Capacitor }] =
      await Promise.all([
        import("@capacitor/filesystem"),
        import("@capacitor/share"),
        import("@capacitor/core"),
      ]);
    if (
      !Capacitor.isPluginAvailable("Filesystem") ||
      !Capacitor.isPluginAvailable("Share")
    ) {
      return null;
    }
    return {
      async mkdir(path) {
        await Filesystem.mkdir({ path, directory: Directory.Cache, recursive: true });
      },
      async writeFile(path, data) {
        const written = await Filesystem.writeFile({
          path,
          directory: Directory.Cache,
          data,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        return { uri: written.uri };
      },
      async rmdir(path) {
        await Filesystem.rmdir({ path, directory: Directory.Cache, recursive: true });
      },
      async readdir(path) {
        const listing = await Filesystem.readdir({ path, directory: Directory.Cache });
        return listing.files.map((entry) => entry.name);
      },
      async canShare() {
        const result = await Share.canShare();
        return result.value === true;
      },
      async share(options) {
        return Share.share(options);
      },
    };
  } catch {
    // A missing or broken plugin is reported honestly by the caller below; it
    // must never fall back to the browser implementation on a native platform.
    return null;
  }
}

/**
 * Tidies the export root: this attempt's own directory when its platform allows
 * it, then a bounded number of abandoned siblings.
 *
 * LIFETIME, against actual platform behaviour — see `retentionPolicyFor`. On
 * iOS the file is removed as soon as `share()` settles, because the activity is
 * finished with it by then. On Android it is RETAINED, because the chooser
 * callback is not a consumption receipt, and reclaimed only once it is older
 * than the retention window.
 *
 * Deleting before `share()` settles is never correct on either platform: the
 * recipient reads the bytes from the URL it was handed.
 *
 * Everything here is best effort on an OS-managed cache: a failure to tidy must
 * never turn a successful export into a failed one. It can only ever reach
 * `EXPORT_ROOT_DIRECTORY`, never a directory another attempt is preparing,
 * sharing, or still retaining for a recipient.
 */
async function tidyExports(
  bridge: NativeExportBridge,
  ownDirectory: string,
  platform: RuntimePlatform,
  nowMs: number
): Promise<void> {
  const retentionMs = retentionPolicyFor(platform);

  if (retentionMs === 0) {
    try {
      await bridge.rmdir(ownDirectory);
    } catch {
      // Left to a later sweep, and ultimately to the OS cache policy.
    }
  } else {
    // Still readable by the recipient; a later sweep reclaims it by age.
    retainedDirectories.add(ownDirectory);
  }

  try {
    const entries = await bridge.readdir(EXPORT_ROOT_DIRECTORY);
    let swept = 0;
    for (const entry of entries) {
      if (swept >= MAX_SWEEP_PER_EXPORT) break;
      const candidate = `${EXPORT_ROOT_DIRECTORY}/${entry}`;
      // Never a directory a live attempt owns — including one whose file is
      // still being written.
      if (candidate === ownDirectory || protectedDirectories.has(candidate)) continue;

      // Never a file a recipient may still be reading. An unparseable name has
      // no known age, so it is treated as too young to remove rather than
      // deleted on a guess.
      const createdAt = exportDirectoryCreatedAt(entry);
      if (createdAt === null) continue;
      const age = nowMs - createdAt;
      const requiredAge = retainedDirectories.has(candidate)
        ? ANDROID_RECIPIENT_RETENTION_MS
        : Math.max(retentionMs, ANDROID_RECIPIENT_RETENTION_MS);
      if (age < requiredAge) continue;

      swept += 1;
      try {
        await bridge.rmdir(candidate);
        retainedDirectories.delete(candidate);
      } catch {
        // Ignore: see above.
      }
    }
  } catch {
    // Ignore: see above.
  }
}

/** Removes an attempt's own unshared file after it was abandoned. */
async function discardUnshared(
  bridge: NativeExportBridge,
  directory: string
): Promise<void> {
  try {
    await bridge.rmdir(directory);
  } catch {
    // A later sweep will reclaim it; it was never handed to anyone.
  }
}

async function exportViaNative(
  request: FileExportRequest,
  dependencies: FileExportDependencies,
  platform: RuntimePlatform
): Promise<FileExportOutcome> {
  // Claimed synchronously, before ANY await. A boolean checked here and set
  // after the first await would let two callers both pass.
  if (activeShareClaim !== null) return { kind: "busy" };
  const claim = Symbol("native-export");
  activeShareClaim = claim;

  const isRetired = dependencies.isRetired ?? (() => false);
  const now = dependencies.now ?? (() => Date.now());
  let directory: string | null = null;
  let shareWasInvoked = false;

  try {
    let bridge: NativeExportBridge | null;
    try {
      bridge = await (dependencies.loadNativeBridge ?? loadCapacitorBridge)();
    } catch {
      // An injected or dynamic loader that REJECTS must not escape this
      // boundary: the contract is that exportFile never rejects.
      return { kind: "share_unavailable" };
    }
    if (bridge === null) return { kind: "share_unavailable" };
    if (isRetired()) return { kind: "retired" };

    let shareable: boolean;
    try {
      shareable = await bridge.canShare();
    } catch {
      return { kind: "share_unavailable" };
    }
    if (!shareable) return { kind: "share_unavailable" };
    if (isRetired()) return { kind: "retired" };

    const paths = buildExportPaths(
      (dependencies.newExportId ?? defaultExportId)(),
      request.displayFileName,
      request.mimeType,
      now()
    );
    directory = paths.directory;
    // Protected BEFORE creation, so no sweep can reach a file mid-write.
    protectedDirectories.add(paths.directory);

    let uri: string;
    try {
      await bridge.mkdir(paths.directory);
      const written = await bridge.writeFile(paths.file, request.content);
      uri = written.uri;
    } catch {
      return { kind: "write_failed" };
    }

    // The last check before the irreversible step. Everything after this point
    // is visible to the operating system and cannot be recalled.
    if (isRetired()) {
      await discardUnshared(bridge, paths.directory);
      return { kind: "retired" };
    }

    shareWasInvoked = true;
    try {
      const result = await bridge.share({
        ...(request.shareTitle === undefined ? {} : { title: request.shareTitle }),
        // `files` is the file-sharing form. `url` would offer the path as text.
        files: [uri],
      });
      return {
        kind: "shared",
        activityType:
          typeof result?.activityType === "string" && result.activityType.length > 0
            ? result.activityType
            : null,
      };
    } catch (error) {
      return isConfirmedShareCancellation(error)
        ? { kind: "cancelled" }
        : { kind: "share_failed" };
    } finally {
      try {
        await tidyExports(bridge, paths.directory, platform, now());
      } catch {
        // Tidying must never change the outcome.
      }
    }
  } catch {
    // Anything unforeseen in preparation — id generation, path building — is
    // still a named outcome, never a rejection and never "you cancelled".
    return { kind: "write_failed" };
  } finally {
    if (directory !== null) {
      protectedDirectories.delete(directory);
      // An abandoned attempt that never shared leaves nothing to retain.
      if (!shareWasInvoked) retainedDirectories.delete(directory);
    }
    // Only this attempt's own claim: a stale completion must not clear a
    // newer attempt's claim.
    if (activeShareClaim === claim) activeShareClaim = null;
  }
}

/**
 * Delivers one file to the user on whichever platform this is.
 *
 * Never throws: every failure is a named outcome, because a caller that has to
 * wrap this in a try/catch will eventually forget to.
 */
export async function exportFile(
  request: FileExportRequest,
  dependencies: FileExportDependencies = {}
): Promise<FileExportOutcome> {
  const platform = dependencies.platform ?? detectRuntimePlatform();

  if (platform === "web") {
    try {
      (dependencies.webDeliver ?? defaultWebDeliver)(request);
    } catch {
      return { kind: "write_failed" };
    }
    // The browser exposes no completion signal. Saying anything stronger than
    // this would be inventing a confirmation that does not exist.
    return { kind: "unconfirmed" };
  }

  if (platform === "ios" || platform === "android") {
    return exportViaNative(request, dependencies, platform);
  }

  // An unrecognized native platform must fail honestly rather than silently
  // borrow the Web implementation, whose anchor download would produce nothing.
  return { kind: "unsupported_platform" };
}
