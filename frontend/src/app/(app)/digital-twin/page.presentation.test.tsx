/**
 * The Digital Twin page's title in presentation mode (plan
 * `2026-10-23-console-presentation-spaces`).
 *
 * Split from `page.test.tsx` because it renders under `FixedPresentationMode`,
 * a module the phase adds. `page.test.tsx` then imports nothing the phase
 * added, so its operator-mode caption test is the phase's arming test for
 * `Caption`: without the phase it fails on an assertion, not on an import
 * (`qontinui-claude-config/scripts/arming-record.sh`, D4).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FixedPresentationMode } from "@/components/presentation";

const idle = vi.hoisted(() => ({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
}));

vi.mock("./_hooks/useDigitalTwinSubspaces", () => ({
  useDigitalTwinSubspaces: () => idle,
}));
vi.mock("./_hooks/useTwinCatalog", () => ({ useTwinCatalog: () => idle }));
vi.mock("./_hooks/useSubspaceRaw", () => ({ useSubspaceRaw: () => idle }));
vi.mock("./_hooks/useDeliveryVerdict", () => ({
  useDeliveryVerdict: () => idle,
}));
// The Twin map is the default tab (Phase 5): its two data hooks, idle, so the
// title is rendered over a page that has read nothing.
vi.mock("./_hooks/useTwinWorkUnits", () => ({ useTwinWorkUnits: () => idle }));
vi.mock("./_hooks/useAppTwin", () => ({
  useAppTwin: () => ({ deviceId: null, apps: idle, graph: idle }),
}));
vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => undefined }),
}));
// The runner-only panels, as in `page.test.tsx`.
vi.mock("./_components/TwinCatalog", () => ({ TwinCatalog: () => null }));
vi.mock("./_components/AskTheTwin", () => ({ AskTheTwin: () => null }));
vi.mock("./_components/UiBridgePanel", () => ({ UiBridgePanel: () => null }));

import DigitalTwinPage from "./page";

describe("DigitalTwinPage title — the presentation lens (plan 2026-10-23-console-presentation-spaces)", () => {
  it("adds why it matters in presentation mode, and leaves the toggle to the layout", () => {
    render(
      <FixedPresentationMode presenting>
        <DigitalTwinPage />
      </FixedPresentationMode>
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Digital Twin" })
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-caption-part="why-it-matters"]')
    ).not.toBeNull();
    // The toggle is the layout's, outside the gate this page sits behind: a
    // toggle in here would be unmounted by its own press.
    expect(screen.queryByTestId("presentation-mode-chip")).toBeNull();
    expect(screen.queryByTestId("presentation-mode-toggle")).toBeNull();
  });
});
