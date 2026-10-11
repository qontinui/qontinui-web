/**
 * The Explorer's tab contract — what Spec CI's `digital-twin-lifecycle-view`
 * transition walks (specs/pages/digital-twin/state-machine.derived.json):
 * Completeness is the default tab, Lifecycle sits second, and switching to it
 * mounts the stage pipeline while UNMOUNTING the matrix (Radix Tabs unmounts
 * inactive content) — which is what lets the two views register different
 * UI Bridge ids for the same row without ever colliding.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubspaceProbe, SubspacesProbeResponse } from "./_lib/types";

const state = vi.hoisted(() => ({
  probe: {
    data: undefined as SubspacesProbeResponse | undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
}));

vi.mock("./_hooks/useDigitalTwinSubspaces", () => ({
  useDigitalTwinSubspaces: () => state.probe,
}));
vi.mock("./_hooks/useSubspaceRaw", () => ({
  useSubspaceRaw: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));
vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
}));
// The tab contract under test needs none of the runner / catalog panels.
vi.mock("./_components/TwinCatalog", () => ({ TwinCatalog: () => null }));
vi.mock("./_components/AskTheTwin", () => ({ AskTheTwin: () => null }));
vi.mock("./_components/DeliveryVerdictCard", () => ({
  DeliveryVerdictCard: () => null,
}));
vi.mock("./_components/UiBridgePanel", () => ({ UiBridgePanel: () => null }));

import { manifest } from "./_lib/resolve";
import DigitalTwinPage from "./page";

beforeEach(() => {
  const subspaces: SubspaceProbe[] = manifest.subspaces
    .filter((s) => s.query_kind === "snapshot")
    .map((s) => ({ id: s.id, status: "implemented" }));
  state.probe = {
    data: { subspaces, probed: subspaces.length, restricted: false },
    isLoading: false,
    isError: false,
    error: null,
  };
});

describe("DigitalTwinPage tabs", () => {
  it("orders the tabs Completeness, Lifecycle, Delivery, UI Bridge", () => {
    render(<DigitalTwinPage />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Completeness",
      "Lifecycle",
      "Delivery",
      "UI Bridge",
    ]);
  });

  it("opens on Completeness, and Lifecycle swaps the matrix for the stage pipeline and back", () => {
    render(<DigitalTwinPage />);
    // Default: the matrix cells Spec CI asserts are mounted; no stage is.
    expect(screen.getByTestId("digital-twin-cell-schema")).toBeInTheDocument();
    expect(screen.queryByTestId("digital-twin-stage-verify")).toBeNull();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Lifecycle" }));
    expect(screen.getByTestId("digital-twin-stage-verify")).toBeInTheDocument();
    // The matrix unmounted, so its unscoped cell ids are gone while the
    // stage-scoped ones for the same row are present.
    expect(screen.queryByTestId("digital-twin-cell-schema")).toBeNull();
    expect(
      screen.getByTestId("digital-twin-stage-release-cell-schema")
    ).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Completeness" }));
    expect(screen.getByTestId("digital-twin-cell-schema")).toBeInTheDocument();
    expect(screen.queryByTestId("digital-twin-stage-verify")).toBeNull();
  });
});
