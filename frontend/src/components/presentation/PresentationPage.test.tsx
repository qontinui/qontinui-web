/**
 * The gate around a lens page's body (plan
 * `2026-10-23-console-presentation-spaces` D3: fails closed by construction):
 * in presentation mode a page renders only when its route is registered as
 * presentation-ready; any other lens page is withheld — not hidden, NOT
 * RENDERED — behind its surface caption.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationReadyRoute } from "./presentationReadiness";

const route = vi.hoisted(() => ({ path: "/admin/coord/devops" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.path,
  useSearchParams: () => new URLSearchParams(),
}));

const readiness = vi.hoisted(() => ({
  routes: [] as PresentationReadyRoute[],
}));
vi.mock("./presentationReadiness", async (importOriginal) => {
  const real = await importOriginal<typeof import("./presentationReadiness")>();
  return {
    ...real,
    isPresentationReady: (pathname: string) =>
      real.isPresentationReady(pathname, readiness.routes),
  };
});

import {
  PresentationPage,
  WITHHELD_PAGE_TEXT,
  WITHHELD_PAGE_TITLE,
} from "./PresentationPage";
import { FixedPresentationMode } from "./PresentationModeProvider";

const rendered = vi.fn();

/** A page body that records every time it renders. */
function PageBody() {
  rendered();
  return <button type="button">Drain this machine</button>;
}

function renderGate(presenting: boolean | null) {
  const gate = (
    <PresentationPage>
      <PageBody />
    </PresentationPage>
  );
  return render(
    presenting === null ? (
      gate
    ) : (
      <FixedPresentationMode presenting={presenting}>
        {gate}
      </FixedPresentationMode>
    )
  );
}

beforeEach(() => {
  rendered.mockReset();
  readiness.routes = [];
  route.path = "/admin/coord/devops";
});

describe("PresentationPage", () => {
  it("renders the page in operator mode", () => {
    renderGate(false);
    expect(screen.getByText("Drain this machine")).toBeInTheDocument();
    expect(screen.queryByText(WITHHELD_PAGE_TITLE)).not.toBeInTheDocument();
  });

  it("renders the page where no lens is mounted", () => {
    renderGate(null);
    expect(screen.getByText("Drain this machine")).toBeInTheDocument();
  });

  it("withholds a page not registered as ready: never rendered, its surface caption in its place", () => {
    const { container } = renderGate(true);
    expect(rendered).not.toHaveBeenCalled();
    expect(screen.queryByText("Drain this machine")).not.toBeInTheDocument();
    expect(screen.getByText(WITHHELD_PAGE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(WITHHELD_PAGE_TEXT)).toBeInTheDocument();
    expect(
      container.querySelector('[data-presentation-caption="dev-ops.page"]')
    ).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Dev Ops"
    );
  });

  it("withholds a page below a surface under that surface's caption", () => {
    route.path = "/digital-twin/anything";
    const { container } = renderGate(true);
    expect(
      container.querySelector('[data-presentation-caption="digital-twin.page"]')
    ).not.toBeNull();
  });

  it("withholds a console page that is no lens surface, with no caption to stand in", () => {
    route.path = "/admin/coord/pipeline";
    const { container } = renderGate(true);
    expect(rendered).not.toHaveBeenCalled();
    expect(screen.getByText(WITHHELD_PAGE_TITLE)).toBeInTheDocument();
    expect(container.querySelector("[data-presentation-caption]")).toBeNull();
  });

  it("renders a page registered as ready", () => {
    readiness.routes = [
      { route: "/admin/coord/devops", provenBy: "devops.test.tsx" },
    ];
    renderGate(true);
    expect(rendered).toHaveBeenCalled();
    expect(screen.queryByText(WITHHELD_PAGE_TITLE)).not.toBeInTheDocument();
  });

  it("matches a ready route's [param] segment", () => {
    readiness.routes = [
      { route: "/admin/coord/work-units/[slug]", provenBy: "wu.test.tsx" },
    ];
    route.path = "/admin/coord/work-units/2026-10-23-console";
    renderGate(true);
    expect(rendered).toHaveBeenCalled();
  });

  it("never carries the mode toggle itself: a layout's toggle sits outside the gate", () => {
    renderGate(true);
    expect(screen.queryByText("Presentation mode")).not.toBeInTheDocument();
  });
});
