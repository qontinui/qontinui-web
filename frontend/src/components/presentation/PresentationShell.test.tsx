/**
 * The app shell's presentation mode (plan
 * `2026-10-23-console-presentation-spaces` D3): one provider around the whole
 * authenticated shell, so the sidebar beside a lens page is in the page's
 * mode — enabled on a lens-tree route only — and the lens layouts reuse it.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
// The lens's scope read is not under test here.
vi.mock("./presentationScopeLoader", () => ({
  usePresentationScope: () => ({ status: "unknown" }),
}));

import {
  FixedPresentationMode,
  usePresentationMode,
} from "./PresentationModeProvider";
import { PresentationLens } from "./PresentationLens";
import { PresentationShell } from "./PresentationShell";
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
let store: PresentationModeStore;

function Probe({ id }: { id: string }) {
  const { presenting, source } = usePresentationMode();
  return (
    <span
      data-testid={id}
      data-presenting={String(presenting)}
      data-source={source}
    />
  );
}

function probe(id: string) {
  const el = screen.getByTestId(id);
  return {
    presenting: el.getAttribute("data-presenting"),
    source: el.getAttribute("data-source"),
  };
}

function visit(url: string) {
  window.history.replaceState(null, "", url);
}

beforeEach(() => {
  session = memoryStorage();
  store = createPresentationModeStore({
    session: () => session,
    viewer: memoryStorage,
  });
  visit("/");
});

describe("PresentationShell", () => {
  it("puts the shell beside a lens page in the page's mode", () => {
    visit("/admin/coord/devops?present=1");
    render(
      <PresentationShell store={store}>
        <Probe id="sidebar" />
      </PresentationShell>
    );
    expect(probe("sidebar")).toEqual({ presenting: "true", source: "url" });
  });

  it("supplies no presentation mode, and records nothing, on a route outside every lens tree", () => {
    visit("/settings?present=1");
    render(
      <PresentationShell store={store}>
        <Probe id="sidebar" />
      </PresentationShell>
    );
    expect(probe("sidebar")).toEqual({ presenting: "false", source: "absent" });
    expect(session.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBeNull();
  });

  it("is the provider the lens layouts reuse: shell and page answer as one", () => {
    visit("/digital-twin?present=1");
    render(
      <PresentationShell store={store}>
        <Probe id="sidebar" />
        <PresentationLens>
          <Probe id="page" />
        </PresentationLens>
      </PresentationShell>
    );
    expect(probe("sidebar")).toEqual(probe("page"));
    expect(probe("page")).toEqual({ presenting: "true", source: "url" });
  });
});

describe("PresentationLens", () => {
  it("reuses a mode already above it instead of resolving its own", () => {
    // A second provider would let the URL win over the fixed mode above.
    visit("/admin/coord/devops?present=0");
    render(
      <FixedPresentationMode presenting>
        <PresentationLens>
          <Probe id="page" />
        </PresentationLens>
      </FixedPresentationMode>
    );
    expect(probe("page")).toEqual({ presenting: "true", source: "fixed" });
  });

  it("resolves the mode itself where no provider is above it", () => {
    visit("/admin/coord/devops?present=1");
    render(
      <PresentationLens>
        <Probe id="page" />
      </PresentationLens>
    );
    expect(probe("page")).toEqual({ presenting: "true", source: "url" });
  });
});
