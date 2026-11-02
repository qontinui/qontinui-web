/**
 * DriftListContent: what the drift report page shows for each answer of its
 * read. A refusal is an answer, so it is never the failure card or the empty
 * state; any other failure stays one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PLATFORM_ADMIN_REFUSAL } from "@/lib/api/fleet";
import { DriftListContent } from "../DriftListContent";
import { DRIFT_ADMIN_ONLY } from "../drift-api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const fetchDriftReportMock = vi.fn();

vi.mock("../drift-api", async () => {
  const actual =
    await vi.importActual<typeof import("../drift-api")>("../drift-api");
  return {
    ...actual,
    fetchDriftReport: (...args: unknown[]) => fetchDriftReportMock(...args),
  };
});

const statusError = (status: number, body: string) =>
  new Error(`GET /api/v1/runs/run-1/drift failed: ${status} - ${body}`);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    // The page sets its own `retry`, so only the delay is the test's to set.
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("DriftListContent", () => {
  beforeEach(() => {
    fetchDriftReportMock.mockReset();
  });

  it("shows a viewer who is not a platform admin the admin-only state", async () => {
    fetchDriftReportMock.mockRejectedValue(
      statusError(403, JSON.stringify({ message: PLATFORM_ADMIN_REFUSAL }))
    );

    render(<DriftListContent runId="run-1" />, { wrapper });

    expect(await screen.findByTestId("drift-admin-only")).toHaveTextContent(
      DRIFT_ADMIN_ONLY
    );
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
  });

  it("keeps a 403 that is not the backend's refusal a failure", async () => {
    fetchDriftReportMock.mockRejectedValue(
      statusError(403, "<html>blocked</html>")
    );

    render(<DriftListContent runId="run-1" />, { wrapper });

    expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();
    expect(screen.queryByTestId("drift-admin-only")).not.toBeInTheDocument();
  });

  it("says a run with no report has no report, never that it did not drift", async () => {
    fetchDriftReportMock.mockRejectedValue(
      statusError(404, JSON.stringify({ message: "drift-report-not-found" }))
    );

    render(<DriftListContent runId="run-1" />, { wrapper });

    expect(await screen.findByTestId("drift-no-report")).toBeInTheDocument();
    expect(screen.queryByText("No drift detected")).not.toBeInTheDocument();
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
    expect(fetchDriftReportMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a 404 that is not the runner's answer a failure", async () => {
    fetchDriftReportMock.mockRejectedValue(statusError(404, "Not Found"));

    render(<DriftListContent runId="run-1" />, { wrapper });

    expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();
    expect(screen.queryByTestId("drift-no-report")).not.toBeInTheDocument();
  });

  it("says no drift was detected only when a report came back empty", async () => {
    fetchDriftReportMock.mockResolvedValue({ runId: "run-1", entries: [] });

    render(<DriftListContent runId="run-1" />, { wrapper });

    expect(await screen.findByText("No drift detected")).toBeInTheDocument();
  });

  it("renders a report's entries, linked by their encoded ids", async () => {
    fetchDriftReportMock.mockResolvedValue({
      runId: "run:1",
      entries: [{ id: "state:a", kind: "missing-in-ir", detail: "d" }],
    });

    render(<DriftListContent runId="run:1" />, { wrapper });

    const link = (await screen.findByText("state:a")).closest("a");
    expect(link).toHaveAttribute("href", "/runs/run%3A1/drift/state%3Aa");
  });
});
