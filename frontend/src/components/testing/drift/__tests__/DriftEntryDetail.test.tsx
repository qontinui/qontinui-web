/**
 * DriftEntryDetail dispatcher tests.
 *
 * Verify that the component picks the correct kind-specific renderer based
 * on `DriftEntry.kind`:
 *   - "visual-drift"        -> <VisualDriftDetail />
 *   - "missing-in-runtime"  -> <SpecDriftDetail />
 *   - "missing-in-ir"       -> <SpecDriftDetail />
 *   - "shape-mismatch"      -> <SpecDriftDetail />
 *   - anything else         -> the unknown-kind fallback
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PLATFORM_ADMIN_REFUSAL } from "@/lib/api/fleet";
import { DriftEntryDetail } from "../DriftEntryDetail";
import { DRIFT_ADMIN_ONLY } from "../drift-api";
import type {
  DriftEntryView,
  SpecDriftEntryView,
  VisualDriftEntryView,
} from "../drift-api";

// next/navigation has no-op behavior in jsdom — stub the bits the component touches.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Replace the kind-specific renderers with simple sentinels so the test
// asserts the dispatch decision, not the renderers' output.
vi.mock("../VisualDriftDetail", () => ({
  VisualDriftDetail: ({ entry }: { entry: VisualDriftEntryView }) => (
    <div data-testid="visual-drift-detail" data-entry-id={entry.id}>
      visual-drift renderer
    </div>
  ),
}));

vi.mock("../SpecDriftDetail", () => ({
  SpecDriftDetail: ({ entry }: { entry: SpecDriftEntryView }) => (
    <div
      data-testid="spec-drift-detail"
      data-entry-id={entry.id}
      data-kind={entry.kind}
    >
      spec-drift renderer
    </div>
  ),
}));

const fetchDriftEntryMock = vi.fn();

/** What `httpClient` throws for the backend's `require_admin` refusal. */
const ADMIN_REFUSED = new Error(
  `GET /api/v1/runs/run-1/drift/x failed: 403 - ${JSON.stringify({
    message: PLATFORM_ADMIN_REFUSAL,
  })}`,
);

vi.mock("../drift-api", async () => {
  const actual = await vi.importActual<typeof import("../drift-api")>(
    "../drift-api",
  );
  return {
    ...actual,
    fetchDriftEntry: (...args: Parameters<typeof actual.fetchDriftEntry>) =>
      fetchDriftEntryMock(...args),
  };
});

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0, gcTime: 0, staleTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("DriftEntryDetail", () => {
  beforeEach(() => {
    fetchDriftEntryMock.mockReset();
  });

  it("dispatches visual-drift entries to VisualDriftDetail", async () => {
    const entry: VisualDriftEntryView = {
      id: "btn-submit",
      kind: "visual-drift",
      detail: "visual drift on btn-submit: 12.5% pixels differ",
      diffPercentage: 12.5,
      diffPixelCount: 1500,
      totalPixels: 12000,
    };
    fetchDriftEntryMock.mockResolvedValueOnce(entry);

    render(<DriftEntryDetail runId="run-1" entryId="btn-submit" />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByTestId("visual-drift-detail")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("spec-drift-detail")).not.toBeInTheDocument();
  });

  it.each<SpecDriftEntryView["kind"]>([
    "missing-in-runtime",
    "missing-in-ir",
    "shape-mismatch",
  ])("dispatches %s entries to SpecDriftDetail", async (kind) => {
    const entry: SpecDriftEntryView = {
      id: "state-login",
      kind,
      detail: `state state-login: detail for ${kind}`,
    };
    fetchDriftEntryMock.mockResolvedValueOnce(entry);

    render(<DriftEntryDetail runId="run-1" entryId="state-login" />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByTestId("spec-drift-detail")).toBeInTheDocument();
    });
    expect(screen.getByTestId("spec-drift-detail")).toHaveAttribute(
      "data-kind",
      kind,
    );
    expect(screen.queryByTestId("visual-drift-detail")).not.toBeInTheDocument();
  });

  it("falls back to the unknown-kind renderer for unrecognised kinds", async () => {
    const entry: DriftEntryView = {
      id: "future-thing",
      kind: "future-kind-not-yet-implemented",
      detail: "something",
    };
    fetchDriftEntryMock.mockResolvedValueOnce(entry);

    render(<DriftEntryDetail runId="run-1" entryId="future-thing" />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText(/unknown drift kind/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("visual-drift-detail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("spec-drift-detail")).not.toBeInTheDocument();
  });

  it("surfaces a fetch error in the error panel", async () => {
    fetchDriftEntryMock.mockRejectedValue(new Error("boom"));

    render(<DriftEntryDetail runId="run-1" entryId="x" />, {
      wrapper: makeWrapper(),
    });

    await waitFor(() => {
      expect(
        screen.getByText(/failed to load drift entry/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it("shows a viewer who is not a platform admin the admin-only state", async () => {
    fetchDriftEntryMock.mockRejectedValueOnce(ADMIN_REFUSED);

    render(<DriftEntryDetail runId="run-1" entryId="x" />, {
      wrapper: makeWrapper(),
    });

    expect(await screen.findByTestId("drift-admin-only")).toHaveTextContent(
      DRIFT_ADMIN_ONLY,
    );
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
  });

  it("shows the not-found panel when the runner has no such entry", async () => {
    fetchDriftEntryMock.mockRejectedValue(
      new Error(
        `GET /api/v1/runs/run-1/drift/x failed: 404 - ${JSON.stringify({
          message: "drift-entry-not-found",
        })}`,
      ),
    );

    render(<DriftEntryDetail runId="run-1" entryId="x" />, {
      wrapper: makeWrapper(),
    });

    expect(await screen.findByText(/drift entry not found/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
    expect(fetchDriftEntryMock).toHaveBeenCalledTimes(1);
  });

  it("does not ask again after the refusal, as it does after a failure", async () => {
    fetchDriftEntryMock.mockRejectedValue(ADMIN_REFUSED);

    render(<DriftEntryDetail runId="run-1" entryId="x" />, {
      wrapper: makeWrapper(),
    });

    await screen.findByTestId("drift-admin-only");
    expect(fetchDriftEntryMock).toHaveBeenCalledTimes(1);
  });
});
