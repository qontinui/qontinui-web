/**
 * `/admin/coord/spawn` reads a BOUNDED page and says so — R3 of round 3 on plan
 * `2026-09-12-admin-coord-plans-shows-a-rotating-3-minute-slice-so-plans-get-lost`.
 *
 * The defect: this page sent no `limit`, the proxy forwards none
 * (`operations.py` `list_coord_plans`), and coord's list defaults to
 * `q.limit.unwrap_or(100)` (`work_unit_registry.rs`) with no truncation flag in
 * the body. So it read the first 100 rows of a ~1.8k-row corpus with no way to
 * know it, and `derivePlansHealth` — the strip it shares with `/plans` — painted
 * the green "No plan is blocked" all-clear over them. That is the same
 * over-claim the `incomplete` argument was added to `/plans` to close, on the
 * sibling page whose docstring claimed to be exempt.
 *
 * Two properties, pinned here: the request names its own bound, and a page that
 * comes back full disqualifies the whole-corpus verdict.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const get = vi.fn();

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

import CoordSpawnPage from "./page";

/** coord's own page clamp, which is what this page asks for. */
const LIMIT = 500;

function unit(slug: string, status = "in_progress") {
  return { slug, title: `Title ${slug}`, status };
}

function listCalls(): string[] {
  return get.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/operations/plans"));
}

beforeEach(() => {
  get.mockReset();
});

describe("/admin/coord/spawn — a bounded read that admits its bound", () => {
  it("asks coord for an explicit limit instead of inheriting its 100-row default", async () => {
    get.mockResolvedValue({ work_units: [unit("2026-09-01-a-plan")] });
    render(<CoordSpawnPage />);

    await screen.findByText(/Title 2026-09-01-a-plan/);
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    expect(listCalls()[0]).toContain(`limit=${LIMIT}`);
  });

  it("a page that came back FULL is not a whole-corpus all-clear", async () => {
    // Every row is a clean, non-blocked status: unqualified, this is exactly
    // the green "No plan is blocked" the operator reads as "stop looking".
    get.mockResolvedValue({
      work_units: Array.from({ length: LIMIT }, (_, i) =>
        unit(`2026-09-01-full-page-${i}`)
      ),
    });
    render(<CoordSpawnPage />);

    const strip = await screen.findByTestId("coord-spawn-health");
    await waitFor(() => expect(strip).toHaveTextContent("list INCOMPLETE"));
    expect(strip).toHaveTextContent(
      "No plan is blocked in the part of the list that was read"
    );
    expect(strip).not.toHaveTextContent(/^No plan is blocked$/);
  });

  it("a page short of the limit keeps the unqualified verdict", async () => {
    get.mockResolvedValue({
      work_units: Array.from({ length: 3 }, (_, i) =>
        unit(`2026-09-01-short-page-${i}`)
      ),
    });
    render(<CoordSpawnPage />);

    const strip = await screen.findByTestId("coord-spawn-health");
    await waitFor(() => expect(strip).toHaveTextContent("No plan is blocked"));
    expect(strip).not.toHaveTextContent("INCOMPLETE");
  });
});
