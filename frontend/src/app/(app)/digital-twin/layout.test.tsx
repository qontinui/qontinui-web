/**
 * The digital twin's own lens tree (plan
 * `2026-10-23-console-presentation-spaces` D1, D4). The twin sits outside the
 * console layout, so its layout mounts the lens itself: `?present=1` on the
 * twin's URL presents it, and its page body is gated like every lens page's —
 * withheld until the twin is registered as presentation-ready, with the mode
 * toggle offered in its place because the page's own header carried it.
 *
 * The REAL layout, lens and gate; the page is a probe that reports the mode it
 * was handed and keeps a control behind `OperatorOnly`. Readiness is the
 * test's to declare (`readiness.routes`), through the real matcher.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationReadyRoute } from "@/components/presentation/presentationReadiness";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
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

import DigitalTwinLayout from "./layout";
import {
  OperatorOnly,
  WITHHELD_PAGE_TITLE,
  defaultPresentationModeStore,
  defaultPresentationScopeStore,
  usePresentationMode,
} from "@/components/presentation";

function TwinPageProbe() {
  const { presenting, source } = usePresentationMode();
  return (
    <div
      data-testid="twin-page"
      data-presenting={String(presenting)}
      data-source={source}
    >
      <OperatorOnly>
        <button type="button">Ask the twin</button>
      </OperatorOnly>
    </div>
  );
}

function renderTwin(search: string) {
  window.history.replaceState(null, "", `/digital-twin${search}`);
  return render(
    <DigitalTwinLayout>
      <TwinPageProbe />
    </DigitalTwinLayout>
  );
}

beforeEach(() => {
  defaultPresentationModeStore.recordChoice(false, { remember: false });
  defaultPresentationScopeStore.invalidate();
  window.sessionStorage.clear();
  window.localStorage.clear();
  readiness.routes = [];
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("DigitalTwinLayout — not yet prepared for presentation", () => {
  it("presents /digital-twin?present=1 by withholding the page behind the twin's caption, offering the toggle", () => {
    renderTwin("?present=1");
    expect(screen.queryByTestId("twin-page")).toBeNull();
    expect(screen.queryByText("Ask the twin")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "Digital Twin" })
    ).toBeInTheDocument();
    expect(screen.getByText(WITHHELD_PAGE_TITLE)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Presentation mode" })
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("returns to the operator view from the offered toggle, where the page renders", () => {
    renderTwin("?present=1");
    fireEvent.click(screen.getByRole("button", { name: "Presentation mode" }));
    expect(screen.getByTestId("twin-page")).toHaveAttribute(
      "data-presenting",
      "false"
    );
    expect(screen.getByText("Ask the twin")).toBeInTheDocument();
  });

  it("renders the page for the operator", () => {
    renderTwin("");
    expect(screen.getByTestId("twin-page")).toHaveAttribute(
      "data-presenting",
      "false"
    );
    expect(screen.getByText("Ask the twin")).toBeInTheDocument();
    expect(screen.queryByText(WITHHELD_PAGE_TITLE)).toBeNull();
  });
});

describe("DigitalTwinLayout — registered as presentation-ready", () => {
  beforeEach(() => {
    readiness.routes = [
      {
        route: "/digital-twin",
        provenBy: "app/(app)/digital-twin/layout.test.tsx",
      },
    ];
  });

  it("hands the page the lens's mode, so its operator-only control is gone", () => {
    renderTwin("?present=1");
    const page = screen.getByTestId("twin-page");
    expect(page).toHaveAttribute("data-presenting", "true");
    expect(page).toHaveAttribute("data-source", "url");
    expect(screen.queryByText("Ask the twin")).toBeNull();
  });
});
