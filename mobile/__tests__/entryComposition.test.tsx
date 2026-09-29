// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { isValidElement, type ComponentType, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Home from "../../src/app/page";
import TrackerApp from "../../src/components/TrackerApp";
import IdentityProvider from "../../src/components/identity/IdentityProvider";
import AuthenticatedSportingPersistence from "../../src/components/ProfileScopedSportingPersistence";
import { resetIdentityRuntimeForTests } from "../../src/lib/identity/identityRuntime";
import MobileApp from "../src/MobileApp";

/**
 * Two independent checks, because they prove different things.
 *
 * 1. **Structural composition** (`composition` below) compares the React element
 *    trees `src/app/page.tsx` and `mobile/src/MobileApp.tsx` *return*, without
 *    rendering them. Component identity is compared by function reference, so a
 *    same-named stub does not satisfy it. This is the check that actually closes
 *    the Candidate A duplication risk (docs/MOBILE_APP_MIGRATION.md §3.1).
 *
 * 2. **Rendered behaviour** (`rendered gate` below) proves the identity gate
 *    stands in front of the sporting workspace and that missing or malformed
 *    cloud configuration fails closed.
 *
 * The DOM comparison in (2) is DELIBERATELY NOT treated as a composition check.
 * With no cloud configured, `IdentityProvider` renders `IdentityGateScreen`
 * INSTEAD of its children, so `AuthenticatedSportingPersistence` and
 * `TrackerApp` never mount and their removal is invisible in the DOM. The
 * "gated DOM comparison cannot see a missing provider" test below pins that
 * limitation deliberately, so nobody mistakes the rendered comparison for
 * composition coverage again.
 */

/** Host tag name, or the component function itself — compared by identity. */
type ElementType = string | ComponentType<unknown>;

type StructuralNode = {
  type: ElementType;
  className?: string;
  children: StructuralNode[];
};

/**
 * Walks a returned element tree WITHOUT rendering it. Nothing here mounts a
 * component, so the identity gate is not involved and cannot hide anything.
 */
function describeTree(node: ReactNode): StructuralNode[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(describeTree);
  if (!isValidElement(node)) return []; // text and numbers carry no composition
  const element = node as ReactElement<{ className?: string; children?: ReactNode }>;
  const described: StructuralNode = {
    type: element.type as ElementType,
    children: describeTree(element.props.children),
  };
  if (element.props.className !== undefined) described.className = element.props.className;
  return [described];
}

function displayName(type: ElementType): string {
  if (typeof type === "string") return type;
  return type.displayName ?? type.name ?? "<anonymous>";
}

/** Readable "main > div > IdentityProvider > …" paths, for legible failures. */
function namePaths(nodes: StructuralNode[], prefix = ""): string[] {
  return nodes.flatMap((node) => {
    const here = prefix === "" ? displayName(node.type) : `${prefix} > ${displayName(node.type)}`;
    return [here, ...namePaths(node.children, here)];
  });
}

const container = (children: ReactNode) => (
  <main className="min-h-screen bg-slate-100 px-4 py-4 sm:px-6 sm:py-8">
    <div className="mx-auto w-full max-w-md sm:max-w-xl">{children}</div>
  </main>
);

/** A component with the right NAME but the wrong identity. */
function TrackerAppLookalike() {
  return null;
}

// Deliberately broken roots, defined here as in-memory fixtures. No protected
// application file is modified to produce them.
const BROKEN_ROOTS: ReadonlyArray<{ label: string; root: () => ReactElement }> = [
  {
    label: "AuthenticatedSportingPersistence removed",
    root: () =>
      container(
        <IdentityProvider>
          <TrackerApp />
        </IdentityProvider>
      ),
  },
  {
    label: "TrackerApp replaced by a same-named lookalike",
    root: () =>
      container(
        <IdentityProvider>
          <AuthenticatedSportingPersistence>
            <TrackerAppLookalike />
          </AuthenticatedSportingPersistence>
        </IdentityProvider>
      ),
  },
  {
    label: "TrackerApp removed entirely",
    root: () =>
      container(
        <IdentityProvider>
          <AuthenticatedSportingPersistence>{null}</AuthenticatedSportingPersistence>
        </IdentityProvider>
      ),
  },
  {
    label: "provider nesting inverted",
    root: () =>
      container(
        <AuthenticatedSportingPersistence>
          <IdentityProvider>
            <TrackerApp />
          </IdentityProvider>
        </AuthenticatedSportingPersistence>
      ),
  },
  {
    label: "container markup changed",
    root: () => (
      <main className="min-h-screen bg-white p-2">
        <div className="mx-auto w-full max-w-md sm:max-w-xl">
          <IdentityProvider>
            <AuthenticatedSportingPersistence>
              <TrackerApp />
            </AuthenticatedSportingPersistence>
          </IdentityProvider>
        </div>
      </main>
    ),
  },
];

describe("mobile entry composition (structural)", () => {
  it("returns the same element tree as the Web build's page root", () => {
    const web = describeTree(Home());
    const mobile = describeTree(MobileApp());

    // Readable first, so a failure names the divergence rather than printing
    // two trees of function objects.
    expect(namePaths(mobile)).toEqual(namePaths(web));
    // Then by identity: `toEqual` compares functions by reference, so a stub
    // that merely shares a name does not pass this.
    expect(mobile).toEqual(web);
  });

  it("composes the real, expected provider tree", () => {
    // Pinned explicitly so the previous assertion cannot pass vacuously by both
    // roots drifting together.
    expect(namePaths(describeTree(MobileApp()))).toEqual([
      "main",
      "main > div",
      "main > div > IdentityProvider",
      "main > div > IdentityProvider > AuthenticatedSportingPersistence",
      "main > div > IdentityProvider > AuthenticatedSportingPersistence > TrackerApp",
    ]);
  });

  it.each(BROKEN_ROOTS)("detects a broken root: $label", ({ root }) => {
    const web = describeTree(Home());
    const broken = describeTree(root());

    expect(broken).not.toEqual(web);
  });

  it("holds the real component identities, not same-named stand-ins", () => {
    const tree = describeTree(MobileApp());
    const provider = tree[0]?.children[0]?.children[0];
    const persistence = provider?.children[0];
    const tracker = persistence?.children[0];

    expect(provider?.type).toBe(IdentityProvider);
    expect(persistence?.type).toBe(AuthenticatedSportingPersistence);
    expect(tracker?.type).toBe(TrackerApp);
    // The lookalike shares TrackerApp's role and a plausible name, and is still
    // not the same component.
    expect(tracker?.type).not.toBe(TrackerAppLookalike);
  });
});

/** Both roots read the cloud configuration at render time via
 * `resolveCloudConfig()`'s optional parameters, so clearing these is what makes
 * the two renders comparable regardless of the developer machine's .env files. */
function withoutCloudConfiguration(): void {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function renderRootMarkup(root: () => ReactElement): string {
  // A genuinely fresh page-scoped identity runtime, so the second render does
  // not observe the first one's cached cell.
  resetIdentityRuntimeForTests();
  const { container: mounted } = render(root());
  return mounted.innerHTML;
}

describe("mobile entry rendered gate", () => {
  beforeEach(withoutCloudConfiguration);
  afterEach(cleanup);

  it("renders DOM identical to the Web build's page root", () => {
    const web = renderRootMarkup(() => <Home />);
    cleanup();
    const mobile = renderRootMarkup(() => <MobileApp />);

    expect(mobile).toBe(web);
    // Guard against the test passing vacuously if either root ever renders
    // nothing at all.
    expect(mobile).toContain("Athlete access");
    expect(mobile).toContain("min-h-screen bg-slate-100");
  });

  it("gated DOM comparison cannot see a missing provider — which is why the structural check exists", () => {
    // This is a PROOF OF THE LIMITATION, not a desired property. With no cloud
    // configured the gate replaces its children, so a root missing
    // AuthenticatedSportingPersistence renders byte-identical DOM. Treating the
    // comparison above as composition coverage would therefore be wrong.
    const web = renderRootMarkup(() => <Home />);
    cleanup();
    const brokenRoot = BROKEN_ROOTS[0].root;
    const broken = renderRootMarkup(() => brokenRoot());

    expect(broken).toBe(web);
    // The structural check does see it.
    expect(describeTree(brokenRoot())).not.toEqual(describeTree(Home()));
  });

  it("puts the real identity gate in front of the sporting workspace", () => {
    resetIdentityRuntimeForTests();
    render(<MobileApp />);

    expect(
      screen.getByRole("heading", { name: "Athlete access" })
    ).toBeInTheDocument();
    // TrackerApp's own chrome. Its absence is the proof that
    // AuthenticatedSportingPersistence and TrackerApp never mounted.
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText(/Curling Release Tracker/i)).not.toBeInTheDocument();
  });

  it("reports missing cloud configuration honestly instead of crashing", () => {
    resetIdentityRuntimeForTests();
    render(<MobileApp />);

    expect(
      screen.getByText(
        "Athlete sign-in is unavailable in this build. The training application remains locked."
      )
    ).toBeInTheDocument();
  });

  it("treats malformed cloud configuration as unavailable, not as configured", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_testonlyvalue";
    resetIdentityRuntimeForTests();
    render(<MobileApp />);

    expect(
      screen.getByText(
        "Athlete sign-in is unavailable in this build. The training application remains locked."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

describe("mobile bootstrap", () => {
  beforeEach(withoutCloudConfiguration);

  it("mounts the mobile root into the shell's #root container", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    resetIdentityRuntimeForTests();

    // Imported for its mount side effect, which is the entry's whole job.
    // `createRoot().render()` commits concurrently, so the import is flushed
    // inside act() rather than assumed to have painted synchronously.
    await act(async () => {
      await import("../src/main");
    });

    const root = document.getElementById("root");
    expect(root).not.toBeNull();
    expect(root?.querySelector("main")).not.toBeNull();
    expect(root?.textContent).toContain("Athlete access");
  });
});
