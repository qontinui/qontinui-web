/**
 * The presentation mode as React sees it (plan
 * `2026-10-23-console-presentation-spaces` D2): the URL wins and is carried
 * into the tab, the toggle flips and remembers, a server or hydration render
 * fails closed and never mismatches, and no lens means no presentation mode.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real hook reads Next's search-params context, which Next keeps in step
// with `window.history.replaceState`. Reading `window.location` on each render
// is that contract without a router.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import {
  FixedPresentationMode,
  PresentationModeProvider,
  usePresentationMode,
} from "./PresentationModeProvider";
import { PresentationModeToggle } from "./PresentationModeToggle";
import {
  PRESENTATION_MODE_STORAGE_KEY,
  createPresentationModeStore,
  type PresentationModeStore,
} from "./presentationModeStore";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

let session: Storage;
let viewer: Storage;
let store: PresentationModeStore;

function setUrl(search: string) {
  window.history.replaceState(null, "", `/admin/coord/devops${search}`);
}

function Probe() {
  const { presenting, source, setPresenting } = usePresentationMode();
  return (
    <div
      data-testid="probe"
      data-presenting={String(presenting)}
      data-source={source}
      data-can-toggle={String(setPresenting !== null)}
    />
  );
}

function probe() {
  const el = screen.getByTestId("probe");
  return {
    presenting: el.getAttribute("data-presenting"),
    source: el.getAttribute("data-source"),
    canToggle: el.getAttribute("data-can-toggle"),
  };
}

function Lens({ withToggle = false }: { withToggle?: boolean }) {
  return (
    <PresentationModeProvider store={store}>
      {withToggle && <PresentationModeToggle />}
      <Probe />
    </PresentationModeProvider>
  );
}

beforeEach(() => {
  session = memoryStorage();
  viewer = memoryStorage();
  store = createPresentationModeStore({
    session: () => session,
    viewer: () => viewer,
  });
  setUrl("");
});

afterEach(() => {
  vi.restoreAllMocks();
  setUrl("");
});

describe("PresentationModeProvider — D2's order", () => {
  it("is absent, and off, where no lens is mounted", () => {
    render(<Probe />);
    expect(probe()).toEqual({
      presenting: "false",
      source: "absent",
      canToggle: "false",
    });
  });

  it("defaults to off", () => {
    render(<Lens />);
    expect(probe()).toMatchObject({ presenting: "false", source: "default" });
  });

  it("lets ?present=1 win, and carries it into the tab for links that lack it", () => {
    setUrl("?present=1");
    const { rerender } = render(<Lens />);
    expect(probe()).toMatchObject({ presenting: "true", source: "url" });

    // The presenter follows an in-app link that carries no ?present=.
    setUrl("");
    rerender(<Lens />);
    expect(probe()).toMatchObject({ presenting: "true", source: "session" });
  });

  it("does not let a shared ?present= link change the viewer's remembered setting", () => {
    setUrl("?present=1");
    render(<Lens />);
    expect(session.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBe("1");
    expect(viewer.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBeNull();
  });

  it("lets ?present=0 beat a remembered presentation", () => {
    viewer.setItem(PRESENTATION_MODE_STORAGE_KEY, "1");
    setUrl("?present=0");
    render(<Lens />);
    expect(probe()).toMatchObject({ presenting: "false", source: "url" });
  });

  it("opens on the viewer's remembered presentation, and makes it the tab's own choice", () => {
    viewer.setItem(PRESENTATION_MODE_STORAGE_KEY, "1");
    render(<Lens />);
    // Resolved from the remembered setting, then latched into the tab.
    expect(probe()).toMatchObject({ presenting: "true", source: "session" });
    expect(session.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBe("1");
    expect(viewer.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBe("1");
  });

  it("falls back to a remembered operator view without latching it", () => {
    viewer.setItem(PRESENTATION_MODE_STORAGE_KEY, "0");
    render(<Lens />);
    expect(probe()).toMatchObject({ presenting: "false", source: "storage" });
    expect(session.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBeNull();
  });
});

describe("PresentationModeProvider — another tab changing the remembered setting", () => {
  function anotherTabWrites(value: "0" | "1") {
    viewer.setItem(PRESENTATION_MODE_STORAGE_KEY, value);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: PRESENTATION_MODE_STORAGE_KEY })
      );
    });
  }

  it("never turns a presenting tab off: the operator pressing OFF elsewhere does not reveal this one", () => {
    viewer.setItem(PRESENTATION_MODE_STORAGE_KEY, "1");
    render(<Lens />);
    expect(probe()).toMatchObject({ presenting: "true" });

    anotherTabWrites("0");
    expect(probe()).toMatchObject({ presenting: "true", source: "session" });
  });

  it("does follow another tab turning presentation ON, the direction that fails closed", () => {
    viewer.setItem(PRESENTATION_MODE_STORAGE_KEY, "0");
    render(<Lens />);
    expect(probe()).toMatchObject({ presenting: "false", source: "storage" });

    anotherTabWrites("1");
    expect(probe()).toMatchObject({ presenting: "true" });
    // …and once presenting, it is this tab's own choice too.
    anotherTabWrites("0");
    expect(probe()).toMatchObject({ presenting: "true", source: "session" });
  });

  it("is turned off in this tab by this tab's own toggle", () => {
    viewer.setItem(PRESENTATION_MODE_STORAGE_KEY, "1");
    render(<Lens withToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Presentation mode" }));
    expect(probe()).toMatchObject({ presenting: "false", source: "session" });
  });
});

describe("PresentationModeToggle", () => {
  it("flips the mode and remembers it for this tab and the next", () => {
    render(<Lens withToggle />);
    const toggle = screen.getByRole("button", { name: "Presentation mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    // Navigation-only: it is the one control that stays live in front of an audience.
    expect(toggle).toHaveAttribute("data-presentation-nav");

    fireEvent.click(toggle);
    expect(probe()).toMatchObject({ presenting: "true", source: "session" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(session.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBe("1");
    expect(viewer.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBe("1");

    fireEvent.click(toggle);
    expect(probe()).toMatchObject({ presenting: "false", source: "session" });
    expect(viewer.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBe("0");
  });

  it("rewrites a ?present= the URL carries, since the URL would otherwise win", () => {
    setUrl("?tab=machines&present=1#rows");
    render(<Lens withToggle />);
    expect(probe()).toMatchObject({ presenting: "true", source: "url" });

    fireEvent.click(screen.getByRole("button", { name: "Presentation mode" }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("present")).toBe("0");
    expect(params.get("tab")).toBe("machines");
    expect(window.location.hash).toBe("#rows");
    expect(probe()).toMatchObject({ presenting: "false", source: "url" });
  });

  it("leaves a URL without ?present= alone", () => {
    setUrl("?tab=machines");
    render(<Lens withToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Presentation mode" }));
    expect(window.location.search).toBe("?tab=machines");
    expect(probe()).toMatchObject({ presenting: "true", source: "session" });
  });

  it("renders nothing where no lens is mounted", () => {
    render(<PresentationModeToggle />);
    expect(screen.queryByText("Presentation mode")).not.toBeInTheDocument();
  });

  it("is a non-interactive chip under a fixed presentation, and absent under a fixed operator view", () => {
    const { rerender } = render(
      <FixedPresentationMode presenting>
        <PresentationModeToggle />
        <Probe />
      </FixedPresentationMode>
    );
    expect(screen.getByTestId("presentation-mode-chip")).toHaveTextContent(
      "Presentation mode"
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(probe()).toEqual({
      presenting: "true",
      source: "fixed",
      canToggle: "false",
    });

    rerender(
      <FixedPresentationMode presenting={false}>
        <PresentationModeToggle />
      </FixedPresentationMode>
    );
    expect(screen.queryByText("Presentation mode")).not.toBeInTheDocument();
  });
});

describe("PresentationModeProvider — server and hydration renders", () => {
  it("fails CLOSED on a server render with no URL answer", () => {
    const html = renderToString(<Lens />);
    expect(html).toContain('data-presenting="true"');
    expect(html).toContain('data-source="unresolved"');
  });

  it("lets the URL decide even on the server", () => {
    setUrl("?present=0");
    const html = renderToString(<Lens />);
    expect(html).toContain('data-presenting="false"');
    expect(html).toContain('data-source="url"');
  });

  it("hydrates the server HTML without a mismatch, then resolves on the client", async () => {
    viewer.setItem(PRESENTATION_MODE_STORAGE_KEY, "0");
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(<Lens />);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <Lens />);
    });

    expect(errors).not.toHaveBeenCalled();
    const el = container.querySelector('[data-testid="probe"]');
    expect(el?.getAttribute("data-source")).toBe("storage");
    expect(el?.getAttribute("data-presenting")).toBe("false");
    act(() => root?.unmount());
    container.remove();
  });
});
