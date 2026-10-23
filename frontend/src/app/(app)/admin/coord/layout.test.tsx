/**
 * The console layout mounts the presentation lens (plan
 * `2026-10-23-console-presentation-spaces` Phase 1 Arming: "a console page
 * loaded with `?present=1` renders captions and no write control").
 *
 * The page body here is the lens primitives a real page composes; the
 * layout's own chrome (the header and its toggle) is under test with it. The
 * header's live-badge row and the red-main banner fetch, and are covered by
 * their own suites, so they are stubbed to what they render that matters here
 * — a navigation link, and nothing.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UIBridgeProvider,
  useUIBridgeOptional,
  useUIComponent,
} from "@qontinui/ui-bridge/react";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/components/admin/coord/CoordNav", () => ({
  default: () => (
    <nav data-testid="coord-nav">
      <a href="/admin/coord/notifications">Notifications</a>
    </nav>
  ),
}));
vi.mock("@/components/admin/coord/RedMainBanner", () => ({
  default: () => null,
}));

import CoordLayout from "./layout";
import {
  Caption,
  OperatorOnly,
  defaultPresentationModeStore,
} from "@/components/presentation";
import { findPresentationViolations } from "@/test/presentation";

type Registry = NonNullable<ReturnType<typeof useUIBridgeOptional>>["registry"];

function DrainLever() {
  useUIComponent({
    id: "layout-test-drain",
    name: "Drain lever",
    actions: [
      {
        id: "drain",
        label: "Drain",
        effect: "write",
        handler: async () => true,
      },
    ],
  });
  return <button type="button">Drain this machine</button>;
}

function ConsolePage() {
  return (
    <div>
      <Caption id="dev-ops.page" />
      <p>12 machines</p>
      <OperatorOnly>
        <DrainLever />
      </OperatorOnly>
    </div>
  );
}

function renderConsole() {
  const holder: { registry: Registry | null } = { registry: null };
  function Probe() {
    holder.registry = useUIBridgeOptional()?.registry ?? null;
    return null;
  }
  const view = render(
    <UIBridgeProvider>
      <Probe />
      <CoordLayout>
        <ConsolePage />
      </CoordLayout>
    </UIBridgeProvider>
  );
  return { view, holder };
}

function setUrl(search: string) {
  window.history.replaceState(null, "", `/admin/coord/devops${search}`);
}

beforeEach(() => {
  // The layout shares the tab-wide store, whose memory outlives a test: start
  // each one from an explicit operator choice, then empty storage.
  defaultPresentationModeStore.recordChoice(false, { remember: false });
  window.sessionStorage.clear();
  window.localStorage.clear();
  setUrl("");
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("CoordLayout — the presentation lens", () => {
  it("renders captions and no write control on a console page loaded with ?present=1", () => {
    setUrl("?present=1");
    const { holder } = renderConsole();

    expect(
      screen.getByRole("button", { name: "Presentation mode" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      document.querySelector('[data-presentation-caption="dev-ops.page"]')
    ).not.toBeNull();
    expect(screen.queryByText("Drain this machine")).not.toBeInTheDocument();
    expect(holder.registry).not.toBeNull();
    expect(
      findPresentationViolations(
        { uiBridge: { registry: holder.registry! } },
        { captions: ["dev-ops.page"] }
      )
    ).toEqual([]);
  });

  it("is the operator console when not presenting, and the header toggle switches the lens", () => {
    renderConsole();
    const toggle = screen.getByRole("button", { name: "Presentation mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Drain this machine")).toBeInTheDocument();
    expect(document.querySelector("[data-presentation-caption]")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Drain this machine")).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-presentation-caption="dev-ops.page"]')
    ).not.toBeNull();
  });

  it("keeps the header title operators and specs assert on", () => {
    setUrl("?present=1");
    renderConsole();
    expect(
      screen.getByRole("heading", { level: 1, name: "Coord operator console" })
    ).toBeInTheDocument();
  });
});
