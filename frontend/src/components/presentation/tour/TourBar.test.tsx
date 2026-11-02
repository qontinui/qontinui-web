/**
 * The tour bar (plan `2026-10-23-console-presentation-spaces` D5, Phase 8):
 * when it renders — presenting AND on the tour, never in operator mode,
 * never under `?present=0`, and on the URL's marker alone until the client
 * can read the tab — what it says, where its controls lead, End tour, and
 * that it is safe to show, with every control that does something
 * registered with the UI Bridge as navigation-only. The arrow keys are
 * `TourBar.keys.test.tsx`.
 *
 * The readiness registry is the test's to state (`readiness.routes`), through
 * the real `isPresentationReady`.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import type { PresentationReadyRoute } from "@/components/presentation/presentationReadiness";

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
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

import {
  PresentationModeProvider,
  TourBar,
  createPresentationModeStore,
  createTourStore,
  decodeTourState,
  type TourStore,
} from "@/components/presentation";
import {
  expectPresentationSafe,
  renderInPresentationMode,
  type UiBridgeRegistryView,
} from "@/test/presentation";
import { TODAY, onTourStore, renderBar, visit } from "@/test/tourBar";

const bar = () => screen.queryByTestId("tour-bar");

beforeEach(() => {
  readiness.routes = TODAY;
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  visit("/");
});

describe("TourBar — when it renders", () => {
  it("renders nothing in operator mode, on the tour or not", () => {
    visit("/admin/coord/ui-bridge?present=1&tour=1");
    const { container } = renderBar(false, onTourStore());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while presenting a tab that is not on the tour", () => {
    visit("/admin/coord/ui-bridge?present=1");
    const { container } = renderBar(true);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders on a tour link's marker, and puts the tab on the tour", () => {
    visit("/admin/coord/ui-bridge?present=1&tour=1");
    const { store } = renderBar(true);
    expect(bar()).toBeInTheDocument();
    expect(decodeTourState(store.getSnapshot()).onTour).toBe(true);
  });

  it("stays on a page whose URL carries no marker while the tab is on the tour", () => {
    visit("/admin/coord/devops");
    renderBar(true, onTourStore());
    expect(bar()).toBeInTheDocument();
  });

  it("is off under ?present=0, whatever the tab's tour state", () => {
    visit("/admin/coord/devops?present=0&tour=1");
    const store = onTourStore();
    const { container } = render(
      <PresentationModeProvider store={createPresentationModeStore()}>
        <TourBar store={store} />
      </PresentationModeProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("records no tour from a marker outside presentation mode", () => {
    visit("/admin/coord/devops?tour=1");
    const { store } = renderBar(false);
    expect(decodeTourState(store.getSnapshot()).onTour).toBe(false);
  });
});

describe("TourBar — before the client knows (server and hydration renders)", () => {
  // The real mode provider: on the server its stores read as unresolved, so
  // the URL's `?present=1` is what presents here.
  const lens = (store: TourStore) => (
    <PresentationModeProvider store={createPresentationModeStore()}>
      <TourBar store={store} />
    </PresentationModeProvider>
  );
  const BAR = '[data-testid="tour-bar"]';

  it("draws the bar from a URL carrying the marker, with no state to read", () => {
    visit("/admin/coord/ui-bridge?present=1&tour=1");
    const container = document.createElement("div");
    container.innerHTML = renderToString(lens(createTourStore()));
    expect(container.querySelector(BAR)).not.toBeNull();
  });

  it("reads the tab's state as off until hydration, then shows the bar it asks for, without a mismatch", async () => {
    visit("/admin/coord/devops?present=1");
    const store = onTourStore();
    const container = document.createElement("div");
    let root: ReturnType<typeof hydrateRoot> | undefined;
    // Torn down even when an assertion fails, so a failure here never
    // leaves a bar in the document for a later test's `screen` to find.
    onTestFinished(() => {
      act(() => root?.unmount());
      container.remove();
    });
    container.innerHTML = renderToString(lens(store));
    // On the tour, but the server cannot know: no marker, so no bar.
    expect(container.querySelector(BAR)).toBeNull();

    document.body.appendChild(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      root = hydrateRoot(container, lens(store));
    });
    expect(errors).not.toHaveBeenCalled();
    expect(container.querySelector(BAR)).not.toBeNull();
  });
});

describe("TourBar — what it shows at a stop", () => {
  beforeEach(() => visit("/admin/coord/ui-bridge?present=1&tour=1"));

  it("counts the stop over the presentable stops, names it, and says how many more are not presentable", () => {
    renderBar(true);
    const position = screen.getByTestId("tour-bar-position");
    expect(position).toHaveTextContent(
      "Stop 2 of 3 · UI Bridge · 2 more are not yet presentable"
    );
    expect(position).toHaveAttribute("aria-live", "polite");
  });

  it("drops the not-presentable count when every stop can be presented", () => {
    readiness.routes = [
      ...TODAY,
      { route: "/admin/coord/home", provenBy: "x.test.tsx" },
      { route: "/admin/coord/spawns", provenBy: "x.test.tsx" },
    ];
    renderBar(true);
    expect(screen.getByTestId("tour-bar-position")).toHaveTextContent(
      "Stop 4 of 5 · UI Bridge"
    );
    expect(screen.queryByTestId("tour-bar-withheld")).toBeNull();
  });

  it("shows every stop in order: the one on screen aria-current, the presentable ones linked, the rest labelled and unlinked", () => {
    renderBar(true);
    const strip = screen.getByTestId("tour-bar-progress");
    const items = within(strip).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-tour-stop"))).toEqual([
      "digital-twin",
      "coordination-overview",
      "agentic-activity",
      "ui-bridge",
      "dev-ops",
    ]);
    const current = strip.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("UI Bridge");
    expect(current[0]!.closest("a")).toBeNull();

    expect(
      [...strip.querySelectorAll("a")].map((a) => a.getAttribute("href"))
    ).toEqual([
      "/digital-twin?present=1&tour=1",
      "/admin/coord/devops?present=1&tour=1",
    ]);
    for (const id of ["coordination-overview", "agentic-activity"]) {
      const item = strip.querySelector(`[data-tour-stop="${id}"]`)!;
      expect(item.getAttribute("data-tour-stop-state")).toBe("not-presentable");
      expect(item).toHaveTextContent("Not yet presentable");
      expect(item.querySelector("a")).toBeNull();
    }
  });

  it("leads previous and next to the neighbouring presentable stops, declaring their keys", () => {
    renderBar(true);
    const previous = screen.getByRole("link", {
      name: "Previous stop: Digital Twin",
    });
    expect(previous).toHaveAttribute("href", "/digital-twin?present=1&tour=1");
    expect(previous).toHaveAttribute("aria-keyshortcuts", "ArrowLeft");
    const next = screen.getByRole("link", { name: "Next stop: Dev Ops" });
    expect(next).toHaveAttribute("href", "/admin/coord/devops?present=1&tour=1");
    expect(next).toHaveAttribute("aria-keyshortcuts", "ArrowRight");
  });

  it("does not repeat the stop's own caption, which the stop page renders", () => {
    renderBar(true);
    const tourBar = bar()!;
    expect(tourBar.querySelector("[data-presentation-caption]")).toBeNull();
    expect(tourBar).not.toHaveTextContent("How agents see and operate");
  });

  it("remembers the stop shown as the way back from off the route", () => {
    const { store } = renderBar(true);
    expect(decodeTourState(store.getSnapshot()).lastStopId).toBe("ui-bridge");
  });
});

describe("TourBar — at the ends, and between them", () => {
  it("at the first stop, previous is a disabled control saying why — never a link", () => {
    visit("/digital-twin?present=1&tour=1");
    renderBar(true);
    const previous = screen.getByTestId("tour-bar-previous");
    expect(previous.tagName).toBe("BUTTON");
    expect(previous).toBeDisabled();
    expect(previous).toHaveAccessibleName("Previous: this is the first stop");
    expect(previous).not.toHaveAttribute("aria-keyshortcuts");
    expect(screen.getByTestId("tour-bar-position")).toHaveTextContent(
      "Stop 1 of 3 · Digital Twin"
    );
  });

  it("at the last stop, next goes back to the tour's start", () => {
    visit("/admin/coord/devops?present=1&tour=1");
    renderBar(true);
    const next = screen.getByTestId("tour-bar-next");
    expect(next).toHaveAccessibleName("Back to the tour start");
    expect(next).toHaveAttribute(
      "href",
      "/admin/coord/tour?present=1&tour=1"
    );
  });

  it("on a stop it cannot present: labelled, uncounted, and not remembered", () => {
    visit("/admin/coord/spawns?present=1&tour=1");
    const store = onTourStore();
    store.recordStop("digital-twin");
    renderBar(true, store);
    expect(screen.getByTestId("tour-bar-position")).toHaveTextContent(
      "Not yet presentable · Agentic activity"
    );
    expect(screen.getByTestId("tour-bar-current-stop")).toHaveAttribute(
      "aria-current",
      "step"
    );
    expect(screen.getByTestId("tour-bar-next")).toHaveAttribute(
      "href",
      "/admin/coord/ui-bridge?present=1&tour=1"
    );
    expect(decodeTourState(store.getSnapshot()).lastStopId).toBe(
      "digital-twin"
    );
  });

  it("at the tour page: the start, with nothing before it and the first stop next", () => {
    visit("/admin/coord/tour?present=1&tour=1");
    renderBar(true);
    expect(screen.getByTestId("tour-bar-position")).toHaveTextContent(
      "Start of the tour"
    );
    expect(screen.getByTestId("tour-bar-previous")).toHaveAccessibleName(
      "Previous: this is the start of the tour"
    );
    expect(screen.getByTestId("tour-bar-next")).toHaveAttribute(
      "href",
      "/digital-twin?present=1&tour=1"
    );
    expect(
      screen
        .getByTestId("tour-bar-progress")
        .querySelector('[aria-current="step"]')
    ).toBeNull();
  });

  it("off the route, says so and leads back to where the tour left off", () => {
    visit("/admin/coord/work-units/abc?present=1");
    const store = onTourStore();
    store.recordStop("digital-twin");
    renderBar(true, store);
    expect(bar()).toHaveAttribute("data-tour-place", "off-route");
    expect(screen.getByTestId("tour-bar-position")).toHaveTextContent(
      "Off the tour route. This page is not one of the tour's stops."
    );
    expect(
      screen.getByRole("link", { name: "Back to Digital Twin" })
    ).toHaveAttribute("href", "/digital-twin?present=1&tour=1");
    expect(screen.getByTestId("tour-bar-next")).toHaveAttribute(
      "href",
      "/admin/coord/ui-bridge?present=1&tour=1"
    );
    expect(
      screen
        .getByTestId("tour-bar-progress")
        .querySelector('[aria-current="step"]')
    ).toBeNull();
  });
});

describe("TourBar — End tour", () => {
  it("takes the tab off the tour and drops the marker, leaving the page presenting", () => {
    visit("/admin/coord/ui-bridge?present=1&tour=1#x");
    const { store } = renderBar(true);
    fireEvent.click(screen.getByRole("button", { name: "End tour" }));
    expect(bar()).toBeNull();
    expect(decodeTourState(store.getSnapshot())).toEqual({
      onTour: false,
      lastStopId: null,
    });
    expect(`${window.location.search}${window.location.hash}`).toBe(
      "?present=1#x"
    );
  });

  it("says what it does and does not do", () => {
    visit("/admin/coord/ui-bridge?present=1&tour=1");
    renderBar(true);
    expect(screen.getByRole("button", { name: "End tour" })).toHaveAttribute(
      "title",
      "Leave the tour in this tab. The page stays in presentation mode."
    );
  });
});

function registryOf(view: { uiBridge: unknown }): UiBridgeRegistryView {
  const observed = view.uiBridge as { registry?: UiBridgeRegistryView };
  if (!observed.registry) throw new Error("no UI Bridge registry was read");
  return observed.registry;
}

describe("TourBar — safe to show, and navigation-only to the UI Bridge", () => {
  it("is safe to show an audience: links that keep the presentation, no other control", () => {
    visit("/admin/coord/ui-bridge?present=1&tour=1");
    const view = renderInPresentationMode(<TourBar store={createTourStore()} />);
    expect(bar()).toBeInTheDocument();
    expectPresentationSafe(view);
  });

  it("registers each control where it renders, each declaring one read action", () => {
    visit("/admin/coord/ui-bridge?present=1&tour=1");
    const view = renderInPresentationMode(<TourBar store={createTourStore()} />);
    const elements = registryOf(view).getAllElements();
    expect(elements.map((e) => e.id).sort()).toEqual(
      [
        "tour-bar-end",
        "tour-bar-next",
        "tour-bar-previous",
        "tour-bar-stop-dev-ops",
        "tour-bar-stop-digital-twin",
      ].sort()
    );
    for (const element of elements) {
      const actions = Object.values(element.customActions ?? {});
      expect(actions, element.id).toHaveLength(1);
      expect(actions[0]?.effect, element.id).toBe("read");
    }
  });

  it("makes no registration for a control that does nothing", () => {
    visit("/digital-twin?present=1&tour=1");
    const view = renderInPresentationMode(<TourBar store={createTourStore()} />);
    const ids = registryOf(view)
      .getAllElements()
      .map((e) => e.id);
    expect(ids).not.toContain("tour-bar-previous");
    expect(ids).toContain("tour-bar-next");
  });

  it("follows the link on screen when an automated walk fires a link's action", async () => {
    visit("/admin/coord/ui-bridge?present=1&tour=1");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const view = renderInPresentationMode(<TourBar store={createTourStore()} />);
    const next = registryOf(view)
      .getAllElements()
      .find((e) => e.id === "tour-bar-next");
    const open = (next?.customActions as Record<string, { handler: () => unknown }>)
      .open;
    await act(async () => {
      await open!.handler();
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0]).toBe(screen.getByTestId("tour-bar-next"));
  });

  it("ends the tour when an automated walk fires End tour's action", async () => {
    visit("/admin/coord/ui-bridge?present=1&tour=1");
    const store = createTourStore();
    const view = renderInPresentationMode(<TourBar store={store} />);
    const end = registryOf(view)
      .getAllElements()
      .find((e) => e.id === "tour-bar-end");
    const action = (
      end?.customActions as Record<string, { handler: () => unknown }>
    )["end-tour"];
    await act(async () => {
      await action!.handler();
    });
    expect(bar()).toBeNull();
    expect(decodeTourState(store.getSnapshot()).onTour).toBe(false);
  });
});
