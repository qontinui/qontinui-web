/**
 * /admin/coord/members — a failed section read is UNKNOWN, never "none".
 *
 * Post-merge follow-up to web #1111, which closed exactly this defect for the
 * **blast-radius** read of `/coord/group-tenant-roles` and left its three
 * siblings on the same page open.
 *
 * ## The shape, and why the panels make it worse
 *
 * Both sections here follow the same three-arm render: `loading` → `error` →
 * `rows.length === 0` → the table. That ordering is correct, and it is *not*
 * what these tests pin. The gap is one layer up:
 *
 * 1. **The read accepted any 200.** `setRows(json.group_tenant_roles ?? [])`
 *    and `setGroups(json.groups ?? [])` treat a body that never carried the
 *    list as a successful, empty read — so `error` is null, the error arm is
 *    skipped, and the page prints "No mappings yet." / "No Cognito groups
 *    yet." for a table it never saw. A `?? []` is dead per the types (both
 *    fields are declared non-optional) and live at runtime, which is precisely
 *    why it survived review. A non-array value is worse than a missing one:
 *    `.length` succeeds on a string, so the empty check passes it through to
 *    `.map()` and the panel throws.
 *
 * 2. **The COLLAPSED header asserted a count.** `summary` renders inside
 *    `CollapsibleTrigger` (`CollapsiblePanel.tsx:131`), so the badge is on
 *    screen while the body — including the error text — is unmounted by Radix.
 *    Both panels are `defaultOpen={false}`. `{loading ? "–" : rows.length}`
 *    therefore published `mappings 0` / `groups 0` from a read that failed,
 *    with nothing else visible to contradict it. The count is on the header
 *    deliberately ("an empty mapping set is the thing a reader might need to
 *    notice without opening") — that intent is what makes a false `0` load
 *    bearing rather than cosmetic.
 *
 * `groups 0` is the sharper of the two: that badge sits on the section holding
 * the pool-wide Cognito **Delete**, so "there is nothing here" is the last
 * claim it should make on an answer that never arrived.
 *
 * ## Reading these tests
 *
 * Each negative test asserts in BOTH directions — the unknown marker is
 * present AND the absence claim is gone. A build that rendered both would
 * still be telling the operator there is nothing to break, so asserting only
 * the marker would let the regression back in.
 *
 * The two `still reports a genuinely empty` tests are the positive controls.
 * Without them the fix could degrade into a blanket "unknown", which destroys
 * the signal instead of qualifying it — the same failure in the other
 * direction.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    isCoordAdmin: true,
    user: { is_superuser: true },
    loading: false,
  }),
}));

vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import MembersPage from "./page";

/**
 * How a list read answers.
 *
 * `"malformed"` and `"notArray"` are separate on purpose. The first is the
 * body that lost the key (`?? []` fabricates an empty read); the second is the
 * body that kept it and put something else there — the arm that reaches
 * `.map()` and throws, because `"nope".length` is 4 and so the `=== 0` guard
 * above it does not fire.
 */
type ReadMode = "ok" | "error" | "malformed" | "notArray";

interface RouteState {
  groups: Array<Record<string, unknown>>;
  groupsMode: ReadMode;
  mappings: Array<Record<string, unknown>>;
  mappingsMode: ReadMode;
}

let state: RouteState;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Build the response for a list read under `mode`. */
function listResponse(
  mode: ReadMode,
  key: string,
  rows: Array<Record<string, unknown>>
): Response {
  if (mode === "error") return jsonResponse(502, { detail: "coord unreachable" });
  // 200 with `res.ok === true` in both malformed arms: the status says the read
  // worked, the body says we have no answer.
  if (mode === "malformed") return jsonResponse(200, { unexpected: "shape" });
  if (mode === "notArray") return jsonResponse(200, { [key]: "nope" });
  return jsonResponse(200, { [key]: rows });
}

function installRouter() {
  fetchMock.mockImplementation(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");

    if (path.endsWith("/coord/cognito/groups")) {
      return listResponse(state.groupsMode, "groups", state.groups);
    }
    if (/\/coord\/cognito\/groups\/[^/]+\/users(\?|$)/.test(path)) {
      return jsonResponse(200, { users: [] });
    }
    if (path.endsWith("/coord/group-tenant-roles")) {
      return listResponse(
        state.mappingsMode,
        "group_tenant_roles",
        state.mappings
      );
    }
    if (path.endsWith("/coord/my-tenants")) {
      return jsonResponse(200, { home_tenant_id: null, tenants: [] });
    }
    if (path.endsWith("/coord/members")) {
      return jsonResponse(200, { operators: [] });
    }
    return jsonResponse(200, {});
  });
}

function group(name: string) {
  return {
    group_name: name,
    description: null,
    creation_date: "2026-08-01T00:00:00Z",
    last_modified_date: null,
    precedence: null,
  };
}

function mapping(group_id: string, tenant_slug: string) {
  return {
    group_id,
    tenant_slug,
    role: "operator",
    auto_create_tenant: true,
    created_at: "2026-08-01T00:00:00Z",
    tenant_id: null,
  };
}

/** The badge text, with the `&nbsp;` the markup uses folded to a plain space. */
function badgeText(el: HTMLElement): string {
  return (el.textContent ?? "").replace(/ /g, " ").trim();
}

describe("/admin/coord/members — an unreadable section is unknown, not empty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `CollapsiblePanel` persists open/closed to localStorage; without this the
    // first test's click would leave every later test pre-opened.
    window.localStorage.clear();
    state = {
      groups: [group("acme-devs")],
      groupsMode: "ok",
      mappings: [mapping("acme-devs", "acme")],
      mappingsMode: "ok",
    };
    installRouter();
  });

  // -----------------------------------------------------------------------
  // Section d — Group → tenant → role mappings
  // -----------------------------------------------------------------------

  it("does not print a mapping count on the collapsed header when the read failed", async () => {
    state.mappingsMode = "error";
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-group-roles-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));
    // The whole point: no digit may stand in for an answer we never got.
    expect(badgeText(badge)).not.toMatch(/\d/);
  });

  it("treats a malformed 200 as unknown rather than 'No mappings yet.'", async () => {
    state.mappingsMode = "malformed";
    const user_ = userEvent.setup();
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-group-roles-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));

    // Open the panel: the absence copy inside must be gone too, not merely
    // out of sight behind the fold.
    await user_.click(
      await screen.findByRole("button", { name: /role mappings/i })
    );
    const panel = await screen.findByTestId("coord-members-group-roles");
    await waitFor(() =>
      expect(panel.textContent ?? "").toMatch(/malformed group-tenant-roles/i)
    );
    expect(panel.textContent ?? "").not.toMatch(/no mappings yet/i);
  });

  it("survives a 200 whose mapping list is not a list", async () => {
    // `"nope".length === 4`, so the `rows.length === 0` arm does NOT fire and
    // the value reaches `rows.map()`. Before the guard this threw and took the
    // panel down; the read must be refused before the render sees it.
    state.mappingsMode = "notArray";
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-group-roles-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));
    expect(screen.queryByTestId("coord-group-roles-table")).toBeNull();
  });

  it("still reports a genuinely empty mapping table as zero", async () => {
    state.mappings = [];
    const user_ = userEvent.setup();
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-group-roles-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/mappings 0$/));
    expect(badgeText(badge)).not.toMatch(/unknown/i);

    await user_.click(
      await screen.findByRole("button", { name: /role mappings/i })
    );
    expect(
      await screen.findByText(/no mappings yet/i)
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Cognito Groups — the section that carries the pool-wide Delete
  // -----------------------------------------------------------------------

  it("does not print a group count on the collapsed header when the read failed", async () => {
    state.groupsMode = "error";
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-cognito-groups-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));
    expect(badgeText(badge)).not.toMatch(/\d/);
  });

  it("treats a malformed 200 as unknown rather than 'No Cognito groups yet.'", async () => {
    state.groupsMode = "malformed";
    const user_ = userEvent.setup();
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-cognito-groups-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));

    await user_.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    await waitFor(() =>
      expect(
        screen.getByText(/malformed cognito groups payload/i)
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/no cognito groups yet/i)).toBeNull();
  });

  it("survives a 200 whose group list is not a list", async () => {
    state.groupsMode = "notArray";
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-cognito-groups-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));
    expect(screen.queryByTestId("coord-cognito-groups-table")).toBeNull();
  });

  it("still reports a genuinely empty group list as zero", async () => {
    state.groups = [];
    const user_ = userEvent.setup();
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-cognito-groups-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/groups 0$/));
    expect(badgeText(badge)).not.toMatch(/unknown/i);

    await user_.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    expect(
      await screen.findByText(/no cognito groups yet/i)
    ).toBeInTheDocument();
  });
});
