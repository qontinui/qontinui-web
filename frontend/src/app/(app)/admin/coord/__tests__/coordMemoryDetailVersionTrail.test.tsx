/**
 * `/admin/coord/memory/[name]` — the version trail on a deleted memory's page
 * (plan `2026-10-16-coord-memories-latest-view-crosses-tenants`, Phase 1b).
 *
 * After coord's view honours tombstones, `GET /memory/{name}` 404s a deleted
 * memory. The page's not-found branch then reads the memory's versions one by
 * one (`fetchMemoryVersionTrail`) and links each to its `/version/<n>` page,
 * which is where "Restore this version" lives. These pin:
 *
 * - the trail and its literal hrefs, with the tombstone version marked;
 * - "none" for a name that never had a version;
 * - "unknown, not none" when the trail read fails (R6);
 * - a delete keeps the operator on the page and shows the trail, rather than
 *   sending them to a list the deleted memory no longer appears in;
 * - the removed `tombstoned` badge stays removed.
 *
 * `fetch` is stubbed below `httpClient.fetch`, so the page's real client code
 * builds every URL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ButtonHTMLAttributes } from "react";

const fetchMock = vi.fn();
const push = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ name: "proj_notes" }),
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

// DestructiveButton refuses synthetic clicks BY DESIGN (a destructive action
// needs a real keystroke), and every Testing Library click is synthetic. The
// gate is not what this file tests, so a plain button stands in for it.
vi.mock("@/components/ui/destructive-button", () => ({
  DestructiveButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props} />
  ),
}));

import CoordMemoryDetailPage from "../memory/[name]/page";

const BASE = "/api/v1/operations/memory/proj_notes";

type Route = { status: number; body: unknown };

/** Answer each request by method + URL; an unrouted request fails the test. */
function routes(table: Record<string, Route | Route[]>) {
  const queues = new Map(
    Object.entries(table).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]])
  );
  fetchMock.mockImplementation(
    async (url: string, init?: { method?: string }) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      const queue = queues.get(key);
      if (!queue || queue.length === 0)
        throw new Error(`unrouted request: ${key}`);
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      const text =
        typeof next.body === "string" ? next.body : JSON.stringify(next.body);
      return new Response(text, { status: next.status });
    }
  );
}

const LIVE_V1 = {
  name: "proj_notes",
  version: 1,
  content: "first body",
  is_tombstone: false,
  written_at: "2026-10-01T00:00:00Z",
};
const TOMBSTONE_V2 = {
  name: "proj_notes",
  version: 2,
  content: "",
  is_tombstone: true,
  written_at: "2026-10-02T00:00:00Z",
};
const NOT_FOUND = { status: 404, body: 'no live memory named "proj_notes"' };

describe("CoordMemoryDetailPage version trail", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    push.mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  it("lists a deleted memory's versions with links to restore", async () => {
    routes({
      [`GET ${BASE}`]: NOT_FOUND,
      [`GET ${BASE}/version/1`]: { status: 200, body: LIVE_V1 },
      [`GET ${BASE}/version/2`]: { status: 200, body: TOMBSTONE_V2 },
      [`GET ${BASE}/version/3`]: { status: 404, body: "no version 3" },
    });
    render(<CoordMemoryDetailPage />);

    const trail = await screen.findByTestId("coord-memory-version-trail");
    expect(trail.textContent).toContain("Memory proj_notes was deleted at v2.");
    expect(
      screen
        .getByTestId("coord-memory-version-trail-link-1")
        .getAttribute("href")
    ).toBe("/admin/coord/memory/proj_notes/version/1");
    expect(
      screen
        .getByTestId("coord-memory-version-trail-link-2")
        .getAttribute("href")
    ).toBe("/admin/coord/memory/proj_notes/version/2");
    expect(
      screen.queryByTestId("coord-memory-version-trail-link-3")
    ).toBeNull();
    // The tombstone is marked, the live version is not.
    const items = trail.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[1].textContent).toContain("deleted");
    expect(items[0].textContent).not.toContain("deleted");
    // Inside the frozen not-found container.
    expect(
      screen.getByTestId("coord-memory-detail-missing").contains(trail)
    ).toBe(true);
  });

  it("says a name with no versions has none", async () => {
    routes({
      [`GET ${BASE}`]: NOT_FOUND,
      [`GET ${BASE}/version/1`]: { status: 404, body: "no version 1" },
    });
    render(<CoordMemoryDetailPage />);

    const none = await screen.findByTestId("coord-memory-version-trail-none");
    expect(none.textContent).toBe(
      "Memory proj_notes not found; it has no versions."
    );
    expect(screen.queryByTestId("coord-memory-version-trail")).toBeNull();
  });

  it("renders unknown, not none, when the trail read fails", async () => {
    routes({
      [`GET ${BASE}`]: NOT_FOUND,
      [`GET ${BASE}/version/1`]: { status: 500, body: "boom" },
    });
    render(<CoordMemoryDetailPage />);

    const unknown = await screen.findByTestId(
      "coord-memory-version-trail-unknown"
    );
    expect(unknown.textContent).toContain("unknown, not no");
    expect(screen.queryByTestId("coord-memory-version-trail-none")).toBeNull();
    expect(screen.queryByTestId("coord-memory-version-trail")).toBeNull();
  });

  it("stays on the memory's page after a delete and shows its versions", async () => {
    routes({
      // The entry is live, then 404s once the delete has appended a tombstone.
      [`GET ${BASE}`]: [
        { status: 200, body: { ...LIVE_V1, history: [LIVE_V1] } },
        NOT_FOUND,
      ],
      [`DELETE ${BASE}`]: {
        status: 200,
        body: { tombstoned: true, version: 2 },
      },
      [`GET ${BASE}/version/1`]: { status: 200, body: LIVE_V1 },
      [`GET ${BASE}/version/2`]: { status: 200, body: TOMBSTONE_V2 },
      [`GET ${BASE}/version/3`]: { status: 404, body: "no version 3" },
    });
    render(<CoordMemoryDetailPage />);

    fireEvent.click(await screen.findByTestId("coord-memory-delete-btn"));
    fireEvent.click(await screen.findByTestId("coord-memory-delete-confirm"));

    const trail = await screen.findByTestId("coord-memory-version-trail");
    expect(trail.textContent).toContain("was deleted at v2");
    expect(push).not.toHaveBeenCalledWith("/admin/coord/memory");
    // The deleted memory's old content is no longer on screen.
    expect(screen.queryByText("first body")).toBeNull();
  });

  it("renders no tombstoned badge on a live memory", async () => {
    // The removed badge keyed on a `tombstoned` field coord's read never
    // sends. Even a payload that carried it must not bring the badge back.
    routes({
      [`GET ${BASE}`]: {
        status: 200,
        body: { ...LIVE_V1, history: [LIVE_V1], tombstoned: true },
      },
    });
    render(<CoordMemoryDetailPage />);

    await screen.findByTestId("coord-memory-delete-btn");
    expect(screen.queryByTestId("coord-memory-tombstoned-badge")).toBeNull();
  });
});
