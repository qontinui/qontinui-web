/**
 * Regression test for the prod defect where the Workflows page rendered the
 * literal API error code `UNAUTHORIZED` in place of the workflow list:
 *
 * 1. `lib/api/unified-workflows` used a bare `fetch` (no Bearer) → 401 in prod.
 * 2. The sidebar interpolated the raw error message straight into JSX.
 *
 * This asserts (2): a 401 from the API surfaces friendly, actionable copy and
 * NEVER the raw backend code.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowListSidebar } from "./WorkflowListSidebar";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

vi.mock("@qontinui/ui-bridge", () => ({
  useUIComponent: () => undefined,
}));

vi.mock("@/lib/runner/hooks/misc-hooks", () => ({
  useRunnerHealth: () => ({ data: null, isOffline: true }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderSidebar() {
  return render(
    <WorkflowListSidebar
      selectedWorkflowId={null}
      onSelectWorkflow={vi.fn()}
      onDeselectWorkflow={vi.fn()}
      onRunWorkflow={vi.fn()}
    />
  );
}

describe("WorkflowListSidebar error copy", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders friendly sign-in copy — not the raw code — on a 401", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ detail: "UNAUTHORIZED" }),
    });

    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText(/session has expired/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/sign in again/i)).toBeInTheDocument();
    expect(screen.queryByText(/UNAUTHORIZED/)).not.toBeInTheDocument();
  });

  it("renders generic copy — not the raw code — on a 500", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ detail: "INTERNAL_ERROR" }),
    });

    renderSidebar();

    await waitFor(() => {
      expect(
        screen.getByText(/temporarily unavailable/i)
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/INTERNAL_ERROR/)).not.toBeInTheDocument();
  });
});
