/**
 * `/plans` and `/spawn` must never surface coord's own `shepherd-*`
 * merge-escalation work units — see `SHEPHERD_SLUG_PREFIX` in
 * `plansHealth.tsx` for why. Pinned at the wire: both pages must ask coord to
 * exclude them, on the very first fetch, not just after some later filter
 * change.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const get = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/plans",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

import CoordPlansListPage from "./page";
import CoordSpawnPage from "../spawn/page";

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ work_units: [] });
});

describe.each([
  { name: "/admin/coord/plans", Page: CoordPlansListPage },
  { name: "/admin/coord/spawn", Page: CoordSpawnPage },
])("$name excludes shepherd rows", ({ Page }) => {
  it("asks coord to exclude shepherd-* on the first fetch", async () => {
    render(<Page />);

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining("exclude_slug_prefix=shepherd-")
    );
  });
});
