/**
 * Smoke test for /settings/co-pilot/activity (§4.8 of the production-safe
 * UI Bridge plan).
 *
 * The fetch is fully mocked so this test exercises only the page shell:
 * header, filter controls, and the empty-state rendering. Heavier UI
 * behavior (cursor pagination, react-window row layout, filter wiring)
 * is verified end-to-end at runtime; this test guards against import
 * regressions + simple render-time errors.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/co-pilot-activity", () => ({
  fetchCoPilotActivity: vi.fn(async () => ({ items: [], next_before: null })),
}));

// react-window's ResizeObserver dependency isn't polyfilled by the test
// environment. Stub `List` to a trivial div so this smoke test doesn't
// have to reproduce the runtime layout — we cover row rendering at
// runtime via the actual page, not here.
vi.mock("react-window", () => ({
  List: () => null,
}));

import CoPilotActivityPage from "./page";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CoPilotActivityPage />
    </QueryClientProvider>,
  );
}

describe("/settings/co-pilot/activity", () => {
  it("renders the page header + filters + empty state", async () => {
    renderPage();
    expect(screen.getByText(/Co-Pilot Activity/i)).toBeInTheDocument();
    expect(screen.getByText(/Time range/i)).toBeInTheDocument();
    // There are several "Command" strings (filter label + table column);
    // use a more specific role-based query so the smoke check is stable
    // against future style tweaks.
    expect(screen.getByLabelText(/Command/i)).toBeInTheDocument();
    // After the (empty) query resolves we render the empty state.
    await waitFor(() => {
      expect(
        screen.getByText(/No co-pilot activity in this window/i),
      ).toBeInTheDocument();
    });
  });
});
