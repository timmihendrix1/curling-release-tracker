// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mobileRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(mobileRoot, "..");

/**
 * The shell contract: what `mobile/index.html` must carry for the shared
 * application's layout and safe-area handling to behave on a device the way it
 * behaves in a mobile browser.
 *
 * This is a function, not a set of inline assertions, so the tests can run it
 * against a deliberately broken copy of the shell as well as the real one. A
 * check nobody has watched fail is not a check.
 */
type ShellViolation = string;

function inspectShell(html: string): ShellViolation[] {
  const violations: ShellViolation[] = [];
  const viewport = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html);

  if (viewport === null) {
    violations.push("no viewport meta tag");
  } else {
    const content = viewport[1].replace(/\s+/g, " ");
    // Without viewport-fit=cover, iOS resolves every env(safe-area-inset-*) to
    // 0. `.app-content-clearance` and the shell's own inset rules then silently
    // do nothing, and content sits under the notch and the Home Indicator.
    if (!content.includes("viewport-fit=cover")) {
      violations.push("viewport is missing viewport-fit=cover");
    }
    if (!content.includes("width=device-width")) {
      violations.push("viewport is missing width=device-width");
    }
    if (!/initial-scale=1\b/.test(content)) {
      violations.push("viewport is missing initial-scale=1");
    }
  }

  if (!/<html[^>]*\slang="en"/.test(html)) violations.push("html has no lang");
  if (!/<html[^>]*class="[^"]*\bh-full\b/.test(html)) {
    violations.push("html is missing the h-full layout class");
  }
  if (!/<html[^>]*class="[^"]*\bantialiased\b/.test(html)) {
    violations.push("html is missing the antialiased class");
  }
  if (!/<body[^>]*class="[^"]*\bmin-h-full\b/.test(html)) {
    violations.push("body is missing the min-h-full layout class");
  }
  if (!/<body[^>]*class="[^"]*\bflex\b/.test(html)) {
    violations.push("body is missing the flex layout class");
  }
  if (!/<body[^>]*class="[^"]*\bflex-col\b/.test(html)) {
    violations.push("body is missing the flex-col layout class");
  }
  if (!/id="root"/.test(html)) violations.push("no #root mount container");

  return violations;
}

async function readShell(): Promise<string> {
  return readFile(path.join(mobileRoot, "index.html"), "utf8");
}

describe("mobile HTML shell", () => {
  it("satisfies the shell contract", async () => {
    expect(inspectShell(await readShell())).toEqual([]);
  });

  it("detects a shell that drops viewport-fit=cover", async () => {
    // A temporary in-memory fixture. The real shell on disk is never modified,
    // and no protected source file is touched to produce this failure.
    const broken = (await readShell()).replace(", viewport-fit=cover", "");

    expect(inspectShell(broken)).toContain("viewport is missing viewport-fit=cover");
  });

  it("detects a shell that drops the document layout classes", async () => {
    const broken = (await readShell())
      .replace('class="h-full antialiased"', 'class=""')
      .replace('class="min-h-full flex flex-col"', 'class=""');

    expect(inspectShell(broken)).toEqual(
      expect.arrayContaining([
        "html is missing the h-full layout class",
        "html is missing the antialiased class",
        "body is missing the min-h-full layout class",
        "body is missing the flex-col layout class",
      ])
    );
  });

  it("carries the same document layout Next's layout.tsx emits", async () => {
    // The Web build's <html>/<body> classes and theme colour live in
    // src/app/layout.tsx, which a Vite entry cannot import. Reading the real
    // file here is what keeps the two from drifting apart unnoticed.
    const layout = await readFile(
      path.join(repositoryRoot, "src/app/layout.tsx"),
      "utf8"
    );
    const shell = await readShell();

    for (const layoutClass of ["h-full antialiased", "min-h-full flex flex-col"]) {
      expect(layout).toContain(layoutClass);
      expect(shell).toContain(layoutClass);
    }
    expect(layout).toContain('viewportFit: "cover"');
    expect(layout).toContain('themeColor: "#0f172a"');
    expect(shell).toContain('content="#0f172a"');
  });

  it("depends on no remote origin and no Next runtime", async () => {
    const shell = await readShell();

    // A release bundle must load entirely from the app container. A stylesheet,
    // script or font pulled from a remote origin would make the shell fail
    // offline and reintroduce exactly the remote-wrapper model §3.4 rejects.
    expect(shell).not.toMatch(/(?:href|src)="https?:\/\//);
    expect(shell).not.toContain("_next");
  });
});

describe("mobile stylesheet", () => {
  it("imports the application's real stylesheet rather than forking it", async () => {
    const css = await readFile(path.join(mobileRoot, "src/mobile.css"), "utf8");

    expect(css).toContain('@import "../../src/app/globals.css"');
    // Tailwind's automatic source detection is rooted at the stylesheet that
    // imports Tailwind (src/app/globals.css). Without these the shared UI's
    // classes would never be scanned and the app would ship unstyled.
    expect(css).toContain('@source "../../src/components"');
    expect(css).toContain('@source "../../src/lib"');
  });

  it("adds only the safe-area edges the application does not already own", async () => {
    // Comments stripped: this is about what the stylesheet DECLARES, and the
    // prose in mobile.css necessarily names the inset it deliberately leaves
    // alone.
    const css = (await readFile(path.join(mobileRoot, "src/mobile.css"), "utf8"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const globals = await readFile(
      path.join(repositoryRoot, "src/app/globals.css"),
      "utf8"
    );

    // The application pays the bottom inset itself.
    expect(globals).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("env(safe-area-inset-left)");
    expect(css).toContain("env(safe-area-inset-right)");
    // Paying it a second time here is the double-padding this stage must avoid.
    expect(css).not.toContain("env(safe-area-inset-bottom)");
  });
});
