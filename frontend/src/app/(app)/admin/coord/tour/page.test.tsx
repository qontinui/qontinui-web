/**
 * /admin/coord/tour over a registry the test states (plan
 * `2026-10-23-console-presentation-spaces` Phase 8). The presentation-mode
 * proof over the REAL registry is `page.presentation.test.tsx`; this file
 * pins what the page does with each shape of the registry, and in operator
 * mode — where the operator starts the tour, so every link on the page still
 * carries the presentation and the tour.
 */

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationReadyRoute } from "@/components/presentation/presentationReadiness";

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

import { FixedPresentationMode } from "@/components/presentation";
import { TODAY, ready } from "@/test/tourBar";
import TourPage from "./page";

function renderPage(presenting: boolean) {
  return render(
    <FixedPresentationMode presenting={presenting}>
      <TourPage />
    </FixedPresentationMode>
  );
}

const stateOf = (container: HTMLElement, id: string) =>
  container
    .querySelector(`[data-tour-stop="${id}"]`)
    ?.getAttribute("data-tour-stop-state");

beforeEach(() => {
  readiness.routes = TODAY;
});

describe("the tour page in operator mode", () => {
  it("renders the tour's heading and one-liner, and every stop with its state", () => {
    const { container } = renderPage(false);
    expect(
      screen.getByRole("heading", { level: 1, name: "Tour" })
    ).toBeInTheDocument();
    expect(
      ["digital-twin", "coordination-overview", "agentic-activity", "ui-bridge", "dev-ops"].map(
        (id) => stateOf(container, id)
      )
    ).toEqual(["ready", "not-presentable", "not-presentable", "ready", "ready"]);
    expect(screen.getByTestId("coord-tour-ready-count")).toHaveTextContent(
      "3 of 5 stops are ready to present."
    );
  });

  it("links into the tour presenting and on the tour, though the page itself is not presenting", () => {
    const { container } = renderPage(false);
    const links = [...container.querySelectorAll("a[href]")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/digital-twin?present=1&tour=1",
    ]);
    expect(links[0]).toHaveTextContent("Start the tour");
  });

  it("says why a stop matters only while presenting, as every caption does", () => {
    renderPage(false);
    expect(
      document.querySelector('[data-caption-part="why-it-matters"]')
    ).toBeNull();
  });
});

describe("the tour page in presentation mode", () => {
  it("says why each ready stop matters, and keeps that off a stop it does not show", () => {
    const { container } = renderPage(true);
    const why = (id: string) =>
      container
        .querySelector(`[data-tour-stop="${id}"]`)
        ?.querySelector('[data-caption-part="why-it-matters"]');
    expect(why("digital-twin")).not.toBeNull();
    expect(why("dev-ops")).not.toBeNull();
    expect(why("coordination-overview")).toBeNull();
    expect(why("agentic-activity")).toBeNull();
  });

  it("explains each state that occurs, under the list", () => {
    renderPage(true);
    const key = screen.getByTestId("coord-tour-state-key");
    expect(
      within(key)
        .getAllByText(/Ready to present|Not yet presentable/)
        .map((badge) => badge.textContent)
    ).toEqual(["Ready to present", "Not yet presentable"]);
  });
});

describe("the tour page over other registries", () => {
  it("starts at the first stop the registry lets it present", () => {
    readiness.routes = ready("/admin/coord/devops", "/admin/coord/ui-bridge");
    renderPage(true);
    expect(screen.getByTestId("coord-tour-start-link")).toHaveAttribute(
      "href",
      "/admin/coord/ui-bridge?present=1&tour=1"
    );
  });

  it("with no stop it can present, says so in a labelled line — no start link, no empty list", () => {
    readiness.routes = [];
    const { container } = renderPage(true);
    expect(screen.queryByTestId("coord-tour-start-link")).toBeNull();
    const none = screen.getByTestId("coord-tour-no-stops");
    expect(none).toHaveAttribute("role", "status");
    expect(none).toHaveTextContent("No stop can be presented yet");
    expect(container.querySelectorAll("a[href]")).toHaveLength(0);
    // The stops are still listed, each labelled.
    expect(
      within(screen.getByTestId("coord-tour-stop-list")).getAllByRole(
        "listitem"
      )
    ).toHaveLength(5);
    expect(screen.getByTestId("coord-tour-ready-count")).toHaveTextContent(
      "0 of 5 stops are ready to present."
    );
    expect(
      within(screen.getByTestId("coord-tour-state-key")).queryByText(
        "Ready to present"
      )
    ).toBeNull();
  });

  it("with every stop presentable, shows no not-presentable state at all", () => {
    readiness.routes = ready(
      "/digital-twin",
      "/admin/coord/home",
      "/admin/coord/spawns",
      "/admin/coord/ui-bridge",
      "/admin/coord/devops"
    );
    renderPage(true);
    expect(screen.queryByText("Not yet presentable")).toBeNull();
    expect(screen.getByTestId("coord-tour-ready-count")).toHaveTextContent(
      "5 of 5 stops are ready to present."
    );
  });
});
