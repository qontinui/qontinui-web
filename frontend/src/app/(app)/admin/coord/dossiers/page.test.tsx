/**
 * Component test for /admin/coord/dossiers.
 *
 * Plan `2026-10-03-dossier-query-door-filters-sort-cursor`, Phase 5. Pinned:
 *
 *  - a row per dossier, painted with the LIVE remediation state;
 *  - the "No plan yet" preset sends `readiness=ready_for_pvi`,
 *    `remediation_state=none` and the recurrence sort;
 *  - clicking a sort key reorders the read (the second click flips the order);
 *  - "Load more" follows `next_cursor` under the SAME query and appends;
 *  - a degraded proxy answer reads as UNKNOWN, never as "no dossiers".
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string) =>
      new Response(JSON.stringify((await httpGet(url)) ?? null)),
  },
}));

import CoordDossiersPage from "./page";

const ID_A = "fec41291-67ed-4cf8-b331-888ad1126b45";
const ID_B = "0f4d1a2b-6c8e-4f10-9a33-2b7c5d8e1f90";

function dossier(over: Record<string, unknown> = {}) {
  return {
    finding_id: ID_A,
    slug: "worktree-sibling-build-dependency",
    title: "DOSSIER worktree-sibling-build-dependency",
    readiness: "ready_for_pvi",
    recurrence_count: 27,
    first_seen: "2026-06-01",
    last_seen: "2026-10-20",
    updated_at: new Date(Date.now() - 86_400_000).toISOString(),
    remediations: [],
    remediation_state: "none",
    has_open_remediation: false,
    scope: "tenant",
    ...over,
  };
}

function page(
  rows: Record<string, unknown>[],
  over: Record<string, unknown> = {}
) {
  return {
    available: true,
    count: rows.length,
    dossiers: rows,
    facets: {
      readiness: { ready_for_pvi: 1, accumulating: 4 },
      remediation_state: {
        none: 1,
        draft: 0,
        vetted: 0,
        in_progress: 2,
        shipped: 0,
        closed: 0,
        unknown: 0,
      },
    },
    truncated: false,
    bound_kind: "complete",
    next_cursor: null,
    total: rows.length,
    shown: rows.length,
    limit: 50,
    ...over,
  };
}

function urls(): string[] {
  return httpGet.mock.calls.map((c) => String(c[0]));
}

function lastQuery(): URLSearchParams {
  const u = urls().at(-1) ?? "";
  return new URLSearchParams(u.split("?")[1] ?? "");
}

describe("CoordDossiersPage", () => {
  beforeEach(() => {
    httpGet.mockReset();
  });

  it("renders a row per dossier with the live remediation badge", async () => {
    httpGet.mockResolvedValue(
      page([
        dossier(),
        dossier({
          finding_id: ID_B,
          slug: "other",
          title: "DOSSIER other",
          remediation_state: "in_progress",
          recurrence_count: null,
          readiness: null,
        }),
      ])
    );
    render(<CoordDossiersPage />);

    const rows = await screen.findAllByTestId("coord-dossier-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("no plan yet")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("plan in progress")).toBeInTheDocument();
    // UNKNOWN is said, never defaulted to 0 or a readiness.
    expect(
      screen.getByTestId(`coord-dossier-recurrence-${ID_B}`).textContent
    ).toMatch(/recurrences unknown · readiness unknown/);
    expect(screen.getByTestId("coord-dossiers-count").textContent).toBe(
      "all 2 shown"
    );
  });

  it("sends only the limit and the default sort on first read", async () => {
    httpGet.mockResolvedValue(page([]));
    render(<CoordDossiersPage />);
    await waitFor(() => expect(httpGet).toHaveBeenCalled());
    expect([...lastQuery().entries()]).toEqual([
      ["limit", "50"],
      ["sort", "last_seen"],
      ["order", "desc"],
    ]);
    expect(
      await screen.findByTestId("coord-dossiers-empty")
    ).toBeInTheDocument();
  });

  it("the No plan yet preset asks for ready dossiers with no plan, most recurrences first", async () => {
    httpGet.mockResolvedValue(page([dossier()]));
    render(<CoordDossiersPage />);
    await screen.findAllByTestId("coord-dossier-row");

    await userEvent.click(screen.getByTestId("coord-dossiers-preset-no-plan"));
    await waitFor(() =>
      expect(lastQuery().getAll("remediation_state")).toEqual(["none"])
    );
    const q = lastQuery();
    expect(q.getAll("readiness")).toEqual(["ready_for_pvi"]);
    expect(q.get("sort")).toBe("recurrence_count");
    expect(q.get("order")).toBe("desc");
  });

  it("a sort click re-reads with that key, and a second click flips the order", async () => {
    httpGet.mockResolvedValue(page([dossier()]));
    render(<CoordDossiersPage />);
    await screen.findAllByTestId("coord-dossier-row");

    await userEvent.click(screen.getByTestId("coord-dossiers-sort-slug"));
    await waitFor(() => expect(lastQuery().get("sort")).toBe("slug"));
    expect(lastQuery().get("order")).toBe("asc");

    await userEvent.click(screen.getByTestId("coord-dossiers-sort-slug"));
    await waitFor(() => expect(lastQuery().get("order")).toBe("desc"));
  });

  it("Load more follows next_cursor under the same query and appends", async () => {
    httpGet.mockImplementation(async (url: string) =>
      url.includes("cursor=")
        ? page([dossier({ finding_id: ID_B, slug: "second" })], {
            bound_kind: "complete",
            total: 2,
          })
        : page([dossier()], {
            truncated: true,
            bound_kind: "at_least",
            next_cursor: "c/1",
            total: 2,
          })
    );
    render(<CoordDossiersPage />);
    await screen.findAllByTestId("coord-dossier-row");

    await userEvent.click(screen.getByTestId("coord-dossiers-load-more"));
    await waitFor(() =>
      expect(screen.getAllByTestId("coord-dossier-row")).toHaveLength(2)
    );
    const q = lastQuery();
    expect(q.get("cursor")).toBe("c/1");
    expect(q.get("sort")).toBe("last_seen");
    expect(screen.queryByTestId("coord-dossiers-load-more")).toBeNull();
  });

  it("a typed search re-queries once it settles, not per keystroke", async () => {
    httpGet.mockResolvedValue(page([dossier()]));
    render(<CoordDossiersPage />);
    await screen.findAllByTestId("coord-dossier-row");

    await userEvent.type(screen.getByTestId("coord-dossiers-q"), "sib");
    await waitFor(() => expect(lastQuery().get("q")).toBe("sib"));
    expect(urls().filter((u) => /[?&]q=s(&|$)/.test(u))).toEqual([]);
  });

  it("a non-numeric recurrence bound is flagged and not sent", async () => {
    httpGet.mockResolvedValue(page([dossier()]));
    render(<CoordDossiersPage />);
    await screen.findAllByTestId("coord-dossier-row");

    const input = screen.getByTestId("coord-dossiers-recurrence-min");
    await userEvent.type(input, "abc");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(urls().some((u) => u.includes("recurrence_min"))).toBe(false);
  });

  it("a degraded answer reads as unknown, never as no dossiers", async () => {
    httpGet.mockResolvedValue({
      available: false,
      count: 0,
      dossiers: [],
      facets: null,
      bound_kind: "unknown",
      unavailable: "coord's dossier door is not answering",
      unavailable_kind: "not_deployed",
    });
    render(<CoordDossiersPage />);

    expect(
      await screen.findByTestId("coord-dossiers-unavailable")
    ).toHaveTextContent("not answering");
    expect(screen.getByTestId("coord-dossiers-unknown")).toBeInTheDocument();
    expect(screen.queryByTestId("coord-dossiers-empty")).toBeNull();
    expect(screen.getByTestId("coord-dossiers-count").textContent).toBe(
      "– shown"
    );
  });
});
