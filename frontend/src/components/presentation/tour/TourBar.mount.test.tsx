/**
 * Where the tour bar is mounted (plan `2026-10-23-console-presentation-spaces`
 * Phase 8): ONCE, by `PresentationLens`, so both lens trees — the console and
 * the digital twin — carry it, above the layout and outside its
 * `PresentationPage` gate, in a column the lens owns.
 *
 * The REAL layouts; only their network-reading chrome (the console's nav
 * badges and red-main banner) and the lens's scope read are stubbed. The
 * readiness registry is the test's to state.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationReadyRoute } from "@/components/presentation/presentationReadiness";

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/components/admin/coord/CoordNav", () => ({
  default: () => <nav data-testid="coord-nav" />,
}));
vi.mock("@/components/admin/coord/RedMainBanner", () => ({
  default: () => null,
}));
vi.mock("@/lib/api/presentationScope", () => ({
  fetchPresentationScope: vi.fn(async () => ({
    tenant_id: "00000000-0000-0000-0000-00000000000a",
    first_party_owners: ["qontinui"],
    first_party_owners_source: "registered_repos",
    first_party_owners_unknown_reason: null,
    confidential_terms: [],
    configured: {
      first_party_owners: null,
      confidential_terms: [],
      version: 0,
      updated_at: null,
      updated_by: null,
    },
    defaults: {
      registered_repo_owners: ["qontinui"],
      registered_repo_owners_unknown_reason: null,
      viewer_other_tenant_names: [],
    },
    can_edit: false,
  })),
  savePresentationScope: vi.fn(),
}));

const readiness = vi.hoisted(() => ({
  routes: [] as PresentationReadyRoute[],
}));
vi.mock(
  "@/components/presentation/presentationReadiness",
  async (importOriginal) => {
    const real =
      await importOriginal<
        typeof import("@/components/presentation/presentationReadiness")
      >();
    return {
      ...real,
      isPresentationReady: (pathname: string) =>
        real.isPresentationReady(pathname, readiness.routes),
    };
  }
);

import CoordLayout from "@/app/(app)/admin/coord/layout";
import DigitalTwinLayout from "@/app/(app)/digital-twin/layout";
import {
  WITHHELD_PAGE_TITLE,
  defaultPresentationModeStore,
  defaultTourStore,
} from "@/components/presentation";
import { TODAY, visit } from "@/test/tourBar";

function reset() {
  window.sessionStorage.clear();
  window.localStorage.clear();
  defaultPresentationModeStore.recordChoice(false, { remember: false });
  defaultTourStore.endTour();
}

beforeEach(() => {
  readiness.routes = TODAY;
  reset();
});
afterEach(() => {
  reset();
  visit("/");
});

const LAYOUTS = [
  {
    name: "the console",
    path: "/admin/coord/devops",
    root: "coord-layout",
    Layout: CoordLayout,
  },
  {
    name: "the digital twin",
    path: "/digital-twin",
    root: "digital-twin-layout",
    Layout: DigitalTwinLayout,
  },
] as const;

describe.each(LAYOUTS)("$name's layout", ({ path, root, Layout }) => {
  it("carries exactly one tour bar while presenting on the tour, above the layout", () => {
    visit(`${path}?present=1&tour=1`);
    render(
      <Layout>
        <p>Page body</p>
      </Layout>
    );
    const bars = screen.getAllByTestId("tour-bar");
    expect(bars).toHaveLength(1);
    const lens = screen.getByTestId("presentation-lens");
    // The lens's column: the bar, then the layout in the space left.
    expect(lens.firstElementChild).toBe(bars[0]);
    expect(lens.lastElementChild?.contains(screen.getByTestId(root))).toBe(
      true
    );
    expect(screen.getByText("Page body")).toBeInTheDocument();
  });

  it("carries none in operator mode, even on a tour link", () => {
    visit(`${path}?present=0&tour=1`);
    render(
      <Layout>
        <p>Page body</p>
      </Layout>
    );
    expect(screen.queryByTestId("tour-bar")).toBeNull();
  });

  it("fills the lens instead of fixing its own height, so the bar pushes nothing off screen", () => {
    visit(path);
    render(
      <Layout>
        <p>Page body</p>
      </Layout>
    );
    const layout = screen.getByTestId(root);
    expect(layout).toHaveClass("h-full");
    expect(layout.className).not.toMatch(/100vh/);
    expect(screen.getByTestId("presentation-lens")).toHaveClass(
      "flex",
      "h-full",
      "flex-col"
    );
  });
});

describe("the bar stays outside the page gate", () => {
  it("is on a withheld page too, leading on", () => {
    visit("/admin/coord/spawns?present=1&tour=1");
    render(
      <CoordLayout>
        <p>Spawn ledger</p>
      </CoordLayout>
    );
    expect(screen.getByText(WITHHELD_PAGE_TITLE)).toBeInTheDocument();
    expect(screen.queryByText("Spawn ledger")).toBeNull();
    expect(screen.getByTestId("tour-bar-next")).toHaveAttribute(
      "href",
      "/admin/coord/ui-bridge?present=1&tour=1"
    );
  });
});

/** `src/`, resolved from this file. */
const SRC = join(__dirname, "..", "..", "..");

/** Every app module under `dir`: not a test, and not a test helper (`src/test/`). */
function modules(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (path !== join(SRC, "test")) modules(path, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe("the mount", () => {
  it("renders <TourBar> in PresentationLens and nowhere else", () => {
    const mounts = modules(SRC)
      .filter((file) =>
        /<TourBar\b/.test(
          readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")
        )
      )
      .map((file) => relative(SRC, file).split(sep).join("/"));
    expect(mounts).toEqual(["components/presentation/PresentationLens.tsx"]);
  });
});
