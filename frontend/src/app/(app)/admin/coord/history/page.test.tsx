/**
 * `/admin/coord/history` reads the envelope `list_coord_plans` actually
 * serves: `{ work_units: [...], limit, offset }`
 * (`backend/app/api/v1/endpoints/operations/__init__.py`). The page used to
 * read only the legacy `plans` key, so every answered section rendered as
 * "No shipped plans in the last 50." over a coord that had returned rows.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/history",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("@/services/service-factory", async () => {
  // The plan reads go through `httpClient.fetch` (the typed /operations
  // client); `withVerbFetch` routes them through the `get` mock.
  const { withVerbFetch } = await import("@/test/verbFetch");
  return {
    httpClient: withVerbFetch({
      get: (...args: unknown[]) => get(...args),
    }),
  };
});

import CoordHistoryPage from "./page";

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    const status = new URL(url, "http://x").searchParams.get("status");
    return {
      work_units: [
        {
          slug: `2026-10-01-a-${status}-unit`,
          title: `A ${status} unit`,
          status,
          updated_at: "2026-10-02T00:00:00Z",
        },
      ],
      limit: 50,
      offset: 0,
    };
  });
});

describe("/admin/coord/history", () => {
  it("lists the rows coord serves under work_units", async () => {
    render(<CoordHistoryPage />);

    await waitFor(() =>
      expect(screen.getByTestId("coord-history-health")).toHaveTextContent(
        "1 shipped, 1 archived"
      )
    );
    // The active (shipped) tab lists the one row coord served for it.
    expect(screen.getAllByTestId("coord-plan-card")).toHaveLength(1);
    expect(
      screen.getByTitle("2026-10-01-a-shipped-unit — A shipped unit")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No shipped plans in the last 50.")
    ).not.toBeInTheDocument();
    expect(get.mock.calls.map((c) => String(c[0])).sort()).toEqual([
      "/api/v1/operations/plans?status=archived&limit=50",
      "/api/v1/operations/plans?status=shipped&limit=50",
    ]);
  });
});
