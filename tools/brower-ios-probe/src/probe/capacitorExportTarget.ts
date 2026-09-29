// The real export target: a file in the app's own cache directory, handed to the iOS
// share sheet.
//
// Ordering is the load-bearing part. The temporary file must still exist while the
// share sheet is open, because the receiving app reads it from that URL — so cleanup
// happens only after `share()` has settled, in a `finally`, whichever way it settled.
// Deleting first and sharing second would produce a share sheet that appears to work
// and delivers an empty or missing file.
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { ProbeExportOutcome, ProbeExportTarget } from "./exportTarget";

/**
 * The probe's own subdirectory inside the app cache container. Everything the probe
 * writes lives here and nowhere else, so cleanup can never reach a file the probe did
 * not create.
 */
const EXPORT_DIRECTORY = "brower-ios-probe-exports";

/**
 * Ceiling on temporary export files kept around. Each export deletes its own file once
 * sharing has settled; this sweep is the backstop for the case where the app was
 * killed mid-share and the `finally` never ran.
 */
const MAX_RETAINED_EXPORT_FILES = 5;

/**
 * iOS reports a dismissed share sheet as an error, not as a resolved "no-op" result.
 *
 * Only a genuinely string-shaped message is inspected. Coercing an arbitrary object
 * would produce "[object Object]", which matches nothing and would silently turn every
 * odd failure into "not a cancellation" for the wrong reason — the caller already has
 * the right default for an unrecognised error, so it is left to make it.
 */
function isShareCancellation(error: unknown): boolean {
  let message = "";
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (typeof error === "object" && error !== null) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string") message = candidate;
  }
  return /cancel|abort|dismiss/i.test(message);
}

async function ensureExportDirectory(): Promise<void> {
  try {
    await Filesystem.mkdir({
      path: EXPORT_DIRECTORY,
      directory: Directory.Cache,
      recursive: true,
    });
  } catch {
    // `mkdir` rejects when the directory already exists, which is the ordinary case
    // after the first export. A genuine failure surfaces on the write that follows.
  }
}

/**
 * Deletes the probe's own older export files, newest kept. Best effort by design: a
 * failure to tidy a cache file must never turn a successful export into a failed one,
 * and the files are in the OS-managed cache container anyway.
 */
async function sweepOldExports(keepFileName: string): Promise<void> {
  try {
    const listing = await Filesystem.readdir({
      path: EXPORT_DIRECTORY,
      directory: Directory.Cache,
    });
    const stale = listing.files
      .filter((file) => file.name !== keepFileName && file.name.endsWith(".json"))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(MAX_RETAINED_EXPORT_FILES);
    for (const file of stale) {
      try {
        await Filesystem.deleteFile({
          path: `${EXPORT_DIRECTORY}/${file.name}`,
          directory: Directory.Cache,
        });
      } catch {
        // Ignore: see above.
      }
    }
  } catch {
    // Ignore: see above.
  }
}

export function createCapacitorExportTarget(): ProbeExportTarget {
  return {
    async exportJson(fileName: string, content: string): Promise<ProbeExportOutcome> {
      const path = `${EXPORT_DIRECTORY}/${fileName}`;
      let uri: string;
      try {
        await ensureExportDirectory();
        const written = await Filesystem.writeFile({
          path,
          directory: Directory.Cache,
          data: content,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        uri = written.uri;
      } catch {
        return {
          kind: "failed",
          reason: "The log could not be written to this device's storage.",
        };
      }

      try {
        await Share.share({
          title: "Brower iOS BLE probe log",
          // `files` is the file-sharing form; `url` is for links. Using the wrong one
          // produces a share sheet that offers the path as text.
          files: [uri],
        });
        return { kind: "shared", fileName };
      } catch (error) {
        if (isShareCancellation(error)) {
          return { kind: "cancelled", fileName };
        }
        return { kind: "failed", reason: "The share sheet could not be opened." };
      } finally {
        // Only now — never before `share()` settles — is the file removable.
        try {
          await Filesystem.deleteFile({ path, directory: Directory.Cache });
        } catch {
          // Left for the sweep below, and ultimately for the OS cache policy.
        }
        await sweepOldExports(fileName);
      }
    },
  };
}
